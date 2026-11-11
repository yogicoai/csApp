import { timingSafeEqual } from "node:crypto";
import { connectDB } from "@/lib/db";
import { getClientIp, inCidr } from "@/lib/ipBlock";
import { appendMessage, createVisitorToken, type LiveChatRecord, nextTicketNo } from "@/lib/liveChat";
import { todayClosureState } from "@/lib/liveChatClosures";
import { isLiveChatOpen } from "@/lib/liveChatHours";
import { purchasePlaceLabel, TALK_PHOTO_PREFIX, TALK_VIA } from "@/lib/liveChatOptions";
import { detectTalkPlace } from "@/lib/talkPurchasePlace";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatBlock } from "@/models/LiveChatBlock";
import { LiveChatMessage } from "@/models/LiveChatMessage";

// 네이버 톡톡 챗봇 API — 톡톡으로 들어온 고객 메시지를 실시간 상담으로 받고, 상담원 답변을 톡톡으로 보낸다.
//  받기: 톡톡 파트너센터 [챗봇API 설정]의 '이벤트 받을 URL' = https://<운영 서버>/api/naver-talk/<NAVER_TALK_WEBHOOK_SECRET>
//        이벤트는 send·open·leave·echo 를 고른다(open·leave 는 받기만 한다).
//  보내기: POST https://gw.talk.naver.com/chatbot/v1/event + Authorization(파트너센터 [보내기 API]에서 만든 키)
//  톡톡 요청에는 서명이 없어 주소의 비밀값으로 막고, NAVER_TALK_CHECK_IP=1 이면 네이버 IP 대역도 확인한다.
//  지난 대화를 가져오는 API 는 없다 — 연결한 뒤 들어온 대화부터 쌓인다.
//  핸드오버(NAVER_TALK_HANDOVER=1, 파트너센터 [개발자도구 > API 설정]에서 핸드오버 API 를 켠 계정만):
//   대화의 주도권이 챗봇(이 프로그램)에 있으면 파트너센터에는 [완료]로, 파트너센터 상담원에게 있으면 [대기]·[진행중]으로 보인다.
//   이 화면에서 종료하면 주도권을 가져와(takeThread) 파트너센터도 [완료]가 되게 하고,
//   파트너센터에서 [상담 완료하기]를 누르면 오는 handover(passThread) 이벤트는 상담원에게 안내로 남긴다.
// 문서: https://github.com/navertalk/chatbot-api (핸드오버: handover_v1.md)

const SEND_URL = process.env.NAVER_TALK_API_URL || "https://gw.talk.naver.com/chatbot/v1/event";
// 네이버가 웹훅을 보내는 IP 대역(챗봇 API 문서 기재값)
const TALK_IP_RANGES = ["211.249.40.0/27", "211.249.68.0/27", "220.230.168.0/27", "103.6.173.0/27"];
// 비밀값이 이보다 짧으면 연결하지 않은 것으로 본다(주소가 곧 비밀번호라).
const MIN_SECRET_LENGTH = 16;
const MAX_TEXT = 4000;
// 이 화면에서 보낸 답변의 사본(echo)을 짝짓는 시간 — 그 밖의 사본은 파트너센터에서 보낸 메시지로 본다.
const ECHO_WINDOW_MS = 10 * 60_000;
// 파트너센터 메시지를 붙일 같은 고객의 최근 상담을 찾는 범위
const RECENT_CHAT_MS = 30 * 24 * 60 * 60_000;

export type TalkEvent = {
  event: string;
  user: string;
  echoedEvent?: string;
  // 핸드오버를 켠 계정에서 주도권이 파트너센터 상담원에게 있을 때 고객 메시지에 true 로 온다.
  standby?: boolean;
  textContent?: { text?: string; inputType?: string };
  imageContent?: { imageUrl?: string };
  compositeContent?: { compositeList?: Array<{ title?: string; description?: string }> };
  options?: {
    product?: { name?: string; url?: string };
    // echo: 지금 주도권을 가진 쪽(1 = 파트너센터 상담원, 그 밖의 숫자 = 챗봇)
    threadOwnerId?: number;
    // handover: passThread·takeThread 와 부가 정보(JSON 글, 예: {"managerNickname":"…","autoEnd":false})
    control?: string;
    metadata?: string;
  };
};

export class TalkSendError extends Error {}

// 연결한 톡톡 계정 — 톡톡 계정마다 받는 주소(비밀값)와 보내기 키가 따로다.
//  첫 계정: NAVER_TALK_AUTH_KEY · NAVER_TALK_WEBHOOK_SECRET · NAVER_TALK_NAME(화면 이름, 선택) · NAVER_TALK_HANDOVER(=1 이면 핸드오버 사용)
//  둘째 계정: 같은 이름 끝에 _2 (NAVER_TALK_AUTH_KEY_2 · NAVER_TALK_WEBHOOK_SECRET_2 · NAVER_TALK_NAME_2 · NAVER_TALK_HANDOVER_2)
// 첫 계정 상담은 talk.account 가 비어 있고(예전 데이터 그대로), 둘째 계정 상담은 talk.account = "2".
export type TalkAccount = { key: string; name: string; authKey: string; secret: string; handover: boolean };

const ACCOUNT_SLOTS = [
  { key: "", suffix: "", fallback: "네이버 톡톡" },
  { key: "2", suffix: "_2", fallback: "네이버 톡톡 2" },
] as const;

export function talkAccounts(): TalkAccount[] {
  return ACCOUNT_SLOTS.flatMap(({ key, suffix, fallback }) => {
    const authKey = process.env[`NAVER_TALK_AUTH_KEY${suffix}`] ?? "";
    const secret = process.env[`NAVER_TALK_WEBHOOK_SECRET${suffix}`] ?? "";
    if (!authKey || secret.length < MIN_SECRET_LENGTH) return [];
    return [
      {
        key,
        name: process.env[`NAVER_TALK_NAME${suffix}`]?.trim() || fallback,
        authKey,
        secret,
        handover: process.env[`NAVER_TALK_HANDOVER${suffix}`] === "1",
      },
    ];
  });
}

export function talkAccountByKey(key = "") {
  return talkAccounts().find((account) => account.key === key) ?? null;
}

export function isNaverTalkConfigured() {
  return talkAccounts().length > 0;
}

// 주소 끝 비밀값으로 어느 계정의 웹훅인지 찾는다(맞는 계정이 없으면 null).
export function talkAccountBySecret(given: string) {
  const b = Buffer.from(given);
  return (
    talkAccounts().find((account) => {
      const a = Buffer.from(account.secret);
      return a.length === b.length && timingSafeEqual(a, b);
    }) ?? null
  );
}

// 계정마다 진행 중 상담을 고객당 하나로 — 둘째 계정은 계정 이름을 앞에 붙여 첫 계정 고객과 섞이지 않게 한다.
// (다시 열기도 같은 값을 써야 그 상담에 다음 메시지가 붙는다)
export function talkOpenKey(accountKey: string, user: string) {
  return accountKey ? `${accountKey}:${user}` : user;
}

function openKey(account: TalkAccount, user: string) {
  return talkOpenKey(account.key, user);
}

// 이 계정의 상담만 — 첫 계정 상담은 talk.account 가 없다.
function accountFilter(account: TalkAccount) {
  return account.key ? { "talk.account": account.key } : { "talk.account": { $in: [null, ""] } };
}

// 운영 서버가 x-forwarded-for 맨 앞에 실제 접속 IP를 넣는 환경에서만 켠다(NAVER_TALK_CHECK_IP=1).
export function isTalkSourceAllowed(request: Request) {
  if (process.env.NAVER_TALK_CHECK_IP !== "1") return true;
  const ip = getClientIp(request);
  return TALK_IP_RANGES.some((range) => inCidr(ip, range));
}

function clip(text: string, max = MAX_TEXT) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function httpUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

// 톡톡 메시지 한 건을 상담 대화에 남길 글로 — 상담 대화는 글만 다루므로 사진은 주소로 남긴다.
export function talkMessageText(event: TalkEvent) {
  const image = httpUrl(event.imageContent?.imageUrl);
  if (image) return `${TALK_PHOTO_PREFIX}${image}`;
  const text = (event.textContent?.text ?? "").trim();
  if (event.textContent?.inputType === "sticker") return "[이모티콘]";
  if (event.textContent?.inputType === "vphone") {
    const [number, until] = text.split(",");
    return `[안심번호로 상담 요청] ${number}${until ? ` · ${until}까지` : ""}`;
  }
  if (text) return clip(text);
  const card = event.compositeContent?.compositeList?.[0];
  return card ? clip(`[카드 메시지] ${card.title || card.description || ""}`.trim()) : "";
}

// 진행 중 톡톡 상담은 고객마다 하나 — talk.openUser 고유 인덱스로 막는다(같은 고객 메시지가 동시에 들어와도).
// 셀프가이드만 쓰는 동안 DB 를 건드리지 않도록 스키마가 아니라 톡톡을 처음 받을 때 만든다(이미 있으면 그대로).
// 만들지 못해도 메시지는 받는다(드물게 상담이 둘로 갈릴 수 있을 뿐) — 다음 메시지 때 다시 만든다.
let talkIndex: Promise<void> | null = null;
function ensureTalkIndex() {
  talkIndex ??= LiveChat.collection
    .createIndex(
      { "talk.openUser": 1 },
      { name: "talk_open_user", unique: true, partialFilterExpression: { "talk.openUser": { $type: "string" } } },
    )
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error("[naver-talk] 진행 중 상담 고유 인덱스를 만들지 못함", error);
      talkIndex = null;
    });
  return talkIndex;
}

function isDuplicateKey(error: unknown) {
  return (error as { code?: number } | null)?.code === 11000;
}

async function findOpenTalkChat(account: TalkAccount, user: string) {
  return LiveChat.findOne({ "talk.openUser": openKey(account, user) }).lean<LiveChatRecord | null>();
}

// 핸드오버 — 대화 주도권이 파트너센터 상담원에게 있으면 talk.threadOwner = "partner", 이 프로그램(챗봇)에 있으면 비운다.
// 실제로 바뀌었을 때만 true(같은 안내를 거듭 남기지 않게).
async function markThreadOwner(chatId: LiveChatRecord["_id"], owner: "partner" | "") {
  const changed = owner
    ? await LiveChat.updateOne({ _id: chatId, "talk.threadOwner": { $ne: owner } }, { $set: { "talk.threadOwner": owner } })
    : await LiveChat.updateOne({ _id: chatId, "talk.threadOwner": "partner" }, { $unset: { "talk.threadOwner": 1 } });
  return changed.modifiedCount > 0;
}

const PARTNER_OWNED_NOTE =
  "이 대화는 지금 톡톡 파트너센터 상담원이 맡고 있어요(파트너센터에 [대기]·[진행중]으로 보여요). 여기서 답해도 고객에게 가고, 이 화면에서 종료하면 파트너센터도 [완료]로 바뀌어요.";

// handover 이벤트의 metadata — JSON 글이지만 문서 예시에 작은따옴표로 온 것도 있어 둘 다 읽는다.
function handoverMeta(raw: string | undefined) {
  for (const text of raw ? [raw, raw.replace(/'/g, '"')] : []) {
    try {
      const value = JSON.parse(text) as { managerNickname?: unknown; autoEnd?: unknown } | null;
      if (value && typeof value === "object") {
        const nickname = typeof value.managerNickname === "string" ? clip(value.managerNickname.trim(), 40) : "";
        return { nickname, autoEnd: value.autoEnd === true };
      }
    } catch {
      // 다음 형식으로 다시 읽는다
    }
  }
  return { nickname: "", autoEnd: false };
}

// 새 톡톡 상담 — 그사이 같은 고객의 다른 메시지가 먼저 상담을 열었으면(고유 인덱스 충돌) 그 상담을 쓴다.
async function openTalkChat(account: TalkAccount, user: string, status: "waiting" | "active" = "waiting") {
  const closure = await todayClosureState().catch(() => null);
  try {
    const created = await LiveChat.create({
      channel: TALK_VIA,
      ticketNo: await nextTicketNo(),
      visitorToken: createVisitorToken(),
      status,
      offHours: !isLiveChatOpen() || Boolean(closure?.closedNow),
      source: { via: TALK_VIA },
      talk: { user, openUser: openKey(account, user), ...(account.key ? { account: account.key } : {}) },
    });
    return created.toObject() as LiveChatRecord;
  } catch (error) {
    const open = isDuplicateKey(error) ? await findOpenTalkChat(account, user) : null;
    if (open) return open;
    throw error;
  }
}

// 고객 메시지 — 그 계정에서 그 고객의 진행 중 톡톡 상담에 붙이고, 없으면 새 상담(대기)을 연다.
export async function receiveTalkMessage(event: TalkEvent, account: TalkAccount) {
  await connectDB();
  await ensureTalkIndex();
  // 스팸으로 지운 고객은 차단 기간 동안 받지 않는다(셀프가이드 상담과 같은 규칙).
  if (await LiveChatBlock.exists({ key: `talk:${event.user}`, until: { $gt: new Date() } })) return;
  const text = talkMessageText(event);
  const product = event.textContent?.inputType === "product" ? event.options?.product : undefined;
  const productName = clip((product?.name ?? "").trim(), 200);
  if (!text && !productName) return;

  const chat = (await findOpenTalkChat(account, event.user)) ?? (await openTalkChat(account, event.user));
  if (productName) {
    await appendMessage(chat._id, "system", `상품 페이지에서 톡톡 문의를 시작했어요 · ${productName}`, {
      "talk.productName": productName,
      "talk.productUrl": httpUrl(product?.url),
    });
  }
  if (text) await appendMessage(chat._id, "visitor", text);
  // standby = 핸드오버로 주도권이 파트너센터 상담원에게 가 있다는 뜻 — 상담원이 알 수 있게 한 번 남긴다.
  if (event.standby === true && (await markThreadOwner(chat._id, "partner"))) {
    await appendMessage(chat._id, "system", PARTNER_OWNED_NOTE);
  }

  // 고객이 구매처(스마트스토어 / 요기보 공식몰)를 말하면 상담에 적어 둔다 — AI 도우미가 그 기준으로 쓰고 그 구매처 주문만 찾는다.
  // 이미 적힌 구매처(상담원이 고른 것 포함)는 바꾸지 않는다.
  const place = detectTalkPlace(text);
  if (place && !chat.intake?.purchasePlace) {
    const noted = await LiveChat.updateOne(
      { _id: chat._id, "intake.purchasePlace": { $in: [null, ""] } },
      { $set: { "intake.purchasePlace": place } },
    );
    if (noted.modifiedCount) {
      await appendMessage(
        chat._id,
        "system",
        `고객이 말한 구매처를 '${purchasePlaceLabel(place)}'(으)로 적었어요. AI 도우미가 이 기준으로 쓰고 주문도 여기서만 찾아요. 다르면 오른쪽 [구매처]에서 바꿔 주세요.`,
      );
    }
  }
}

// 톡톡이 되돌려 주는 '보낸 메시지' 사본 — 이 화면에서 보낸 답변이면 이미 대화에 있으니 전송 확인만 하고,
// 톡톡 파트너센터(앱 포함)에서 직원이 직접 보낸 메시지면 대화에 남긴다(진행 중 상담이면 상담중으로).
export async function receiveTalkEcho(event: TalkEvent, account: TalkAccount) {
  await connectDB();
  await ensureTalkIndex();
  // 핸드오버를 켠 계정은 사본에 지금 주도권을 가진 쪽(threadOwnerId, 1 = 파트너센터 상담원)이 온다 — 진행 중 상담에 적어 둔다.
  const ownerId = event.options?.threadOwnerId;
  if (typeof ownerId === "number") {
    const open = await findOpenTalkChat(account, event.user);
    if (open && (await markThreadOwner(open._id, ownerId === 1 ? "partner" : "")) && ownerId === 1) {
      await appendMessage(open._id, "system", PARTNER_OWNED_NOTE);
    }
  }
  const text = talkMessageText(event);
  if (!text) return;
  const now = Date.now();
  const recent = await LiveChat.find({
    "talk.user": event.user,
    ...accountFilter(account),
    lastMessageAt: { $gte: new Date(now - RECENT_CHAT_MS) },
  })
    .sort({ lastMessageAt: -1 })
    .limit(5)
    .lean<LiveChatRecord[]>();

  if (recent.length) {
    const mine = await LiveChatMessage.findOneAndUpdate(
      {
        chatId: { $in: recent.map((chat) => chat._id) },
        sender: "agent",
        "talk.state": { $exists: true },
        "talk.echoed": { $ne: true },
        text,
        createdAt: { $gte: new Date(now - ECHO_WINDOW_MS) },
      },
      // 사본이 왔다는 건 고객에게 갔다는 뜻 — 응답이 늦어 '못 보냄'으로 적었어도 보냄으로 고친다.
      { $set: { "talk.echoed": true, "talk.state": "sent" } },
      { sort: { createdAt: 1 } },
    );
    if (mine) return;
  }

  const chat =
    (await findOpenTalkChat(account, event.user)) ??
    recent.find((item) => !item.deletedAt) ??
    (await openTalkChat(account, event.user, "active"));
  const open = chat.status !== "closed";
  await appendMessage(
    chat._id,
    "agent",
    text,
    open ? { status: "active", ...(chat.firstResponseAt ? {} : { firstResponseAt: new Date() }) } : {},
    { talk: { partner: true } },
  );
}

const SEND_ERRORS: Record<string, string> = {
  "01": "톡톡 보내기 키가 맞지 않아요. 파트너센터 [보내기 API]의 키(NAVER_TALK_AUTH_KEY)를 확인해 주세요.",
  "02": "톡톡이 보낼 내용을 읽지 못했어요.",
};

// 톡톡 보내기 API 호출 — 그 상담이 들어온 계정의 보내기 키로. 톡톡은 실패도 HTTP 200 으로 주므로 success 를 본다.
async function postTalkEvent(
  account: TalkAccount,
  payload: Record<string, unknown>,
  words = { unreachable: "네이버 톡톡에 연결하지 못했어요. 잠시 뒤 다시 보내 주세요.", rejected: "네이버 톡톡이 메시지를 받지 않았어요" },
) {
  let response: Response;
  try {
    response = await fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", Authorization: account.authKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new TalkSendError(words.unreachable);
  }
  const body = (await response.json().catch(() => ({}))) as { success?: boolean; resultCode?: string; resultMessage?: string };
  if (response.ok && body.success === true) return;
  const detail = body.resultMessage ? ` (${clip(body.resultMessage, 120)})` : response.ok ? "" : ` (HTTP ${response.status})`;
  throw new TalkSendError(SEND_ERRORS[body.resultCode ?? ""] ?? `${words.rejected}${detail}.`);
}

// 고객 톡톡으로 글 보내기
export async function sendTalkText(account: TalkAccount, user: string, text: string) {
  await postTalkEvent(account, { event: "send", user, textContent: { text } });
}

// 파트너센터 [상담 완료하기]를 누르면 오는 handover(passThread) — 주도권이 이 프로그램으로 돌아왔다.
// 이 화면의 상담은 닫지 않고(상담원이 아직 볼 수 있게) 안내만 남긴다. 진행 중 상담이 없으면 할 일이 없다.
export async function receiveTalkHandover(event: TalkEvent, account: TalkAccount) {
  if (event.options?.control !== "passThread") return;
  await connectDB();
  const chat = await findOpenTalkChat(account, event.user);
  if (!chat) return;
  await markThreadOwner(chat._id, "");
  const meta = handoverMeta(event.options.metadata);
  const what = meta.autoEnd
    ? "톡톡 파트너센터에서 상담이 자동으로 완료됐어요."
    : `톡톡 파트너센터에서 ${meta.nickname ? `${meta.nickname} 님이 ` : ""}[상담 완료하기]를 눌렀어요.`;
  await appendMessage(chat._id, "system", `${what} 이 화면의 상담은 그대로 열려 있어요 — 끝났으면 [종료]를 눌러 주세요.`);
}

export type TalkThreadResult = { state: "done" | "failed" | "off"; reason?: string };

// 이 화면에서 종료할 때 — 핸드오버를 켠 계정이면 주도권을 가져와(takeThread) 파트너센터에도 [완료]로 보이게 한다.
// 핸드오버를 안 켠 계정은 "off"(파트너센터 상태를 바꿀 방법이 없다).
export async function takeTalkThread(chat: LiveChatRecord): Promise<TalkThreadResult> {
  const user = chat.talk?.user;
  const account = talkAccountByKey(chat.talk?.account ?? "");
  if (!user || !account?.handover) return { state: "off" };
  try {
    await postTalkEvent(
      account,
      { event: "handover", user, options: { control: "takeThread", metadata: "" } },
      { unreachable: "네이버 톡톡에 연결하지 못했어요.", rejected: "네이버 톡톡이 상담 완료 요청을 받지 않았어요" },
    );
  } catch (error) {
    // 이미 이 프로그램이 주도권을 가진 대화(파트너센터 [완료])라 거절됐을 수 있다 — 상담원에게 넘어가 있던 대화만 실패로 알린다.
    if (chat.talk?.threadOwner !== "partner") {
      console.warn("[naver-talk] takeThread 거절 — 이미 이 프로그램이 맡은 대화로 봄", error instanceof Error ? error.message : error);
      return { state: "done" };
    }
    return { state: "failed", reason: error instanceof TalkSendError ? error.message : "네이버 톡톡에 연결하지 못했어요." };
  }
  await markThreadOwner(chat._id, "");
  return { state: "done" };
}

// 종료 뒤 상담원에게 남기는 안내 — 고객 톡톡 종료 안내를 보냈는지, 파트너센터 상태가 어떻게 됐는지.
export function talkClosedNote(sent: boolean, thread: TalkThreadResult) {
  const head = sent ? "상담을 종료하고 고객 톡톡에 종료 안내를 보냈어요." : "상담을 종료했지만 고객 톡톡에 종료 안내를 보내지 못했어요.";
  const partner =
    thread.state === "done"
      ? " 톡톡 파트너센터에서도 [완료]로 보여요."
      : thread.state === "failed"
        ? ` 톡톡 파트너센터 상태는 바꾸지 못했어요 — ${thread.reason ?? ""} 파트너센터에서 [상담 완료하기]를 눌러 주세요.`
        : " 톡톡 파트너센터의 상담 상태는 따로 바뀌지 않아요.";
  return `${head}${partner} 고객이 다시 메시지를 보내면 새 상담으로 들어와요.`;
}

// 상담원이 종료할 때 고객 톡톡에 보내는 안내 — 톡톡에는 고객 대화를 끝내는 API 가 없어(핸드오버로는 파트너센터 상태만 바뀐다)
// 고객이 끝난 걸 알 수 있게 글로 알린다. 대화에는 상담원 말풍선으로 남겨 톡톡 사본(echo)과 짝지어지게 한다
// (짝이 없으면 파트너센터 메시지로 보고 상담을 다시 열기 때문). 상담 상태는 바꾸지 않는다. 보냈으면 true.
export async function sendTalkClosing(chat: LiveChatRecord, text: string) {
  const user = chat.talk?.user;
  const account = talkAccountByKey(chat.talk?.account ?? "");
  if (!user || !account) return false;
  const result = await appendMessage(chat._id, "agent", text, {}, { talk: { state: "sending" } });
  if (!result) return false;
  const { seq } = result.message;
  try {
    await sendTalkText(account, user, text);
    await LiveChatMessage.updateOne({ chatId: chat._id, seq }, { $set: { "talk.state": "sent" } });
    return true;
  } catch {
    await LiveChatMessage.updateOne({ chatId: chat._id, seq, "talk.echoed": { $ne: true } }, { $set: { "talk.state": "failed" } });
    const saved = await LiveChatMessage.findOne({ chatId: chat._id, seq }).lean<{ talk?: { state?: string } } | null>();
    return saved?.talk?.state === "sent";
  }
}

// 상담원 답변 — 대화에 먼저 '보내는 중'으로 남기고(톡톡 사본이 먼저 와도 짝을 찾게) 톡톡으로 보낸 뒤 결과를 적는다.
// 못 보낸 답변도 대화에 '못 보냄'으로 남는다(상담원이 다시 보내면 새 메시지).
export async function replyByTalk(chat: LiveChatRecord, text: string) {
  const user = chat.talk?.user;
  if (!user) throw new TalkSendError("톡톡 고객 정보가 없어 보낼 수 없어요.");
  const account = talkAccountByKey(chat.talk?.account ?? "");
  if (!account) throw new TalkSendError("이 상담이 들어온 톡톡 계정의 연결 설정(보내기 키)이 없어요.");
  const result = await appendMessage(chat._id, "agent", text, {}, { talk: { state: "sending" } });
  if (!result) return null;
  const { seq } = result.message;

  let error = "";
  try {
    await sendTalkText(account, user, text);
    await LiveChatMessage.updateOne({ chatId: chat._id, seq }, { $set: { "talk.state": "sent" } });
  } catch (cause) {
    error = cause instanceof TalkSendError ? cause.message : "톡톡으로 보내지 못했어요.";
    await LiveChatMessage.updateOne({ chatId: chat._id, seq, "talk.echoed": { $ne: true } }, { $set: { "talk.state": "failed" } });
    // 응답은 실패였어도 그사이 사본이 와서 보냄으로 바뀌었으면 보낸 것으로 친다.
    const saved = await LiveChatMessage.findOne({ chatId: chat._id, seq }).lean<{ talk?: { state?: string } } | null>();
    if (saved?.talk?.state !== "sent") return { ok: false as const, error, message: { ...result.message, delivery: "failed" } };
  }

  const updated = await LiveChat.findByIdAndUpdate(
    chat._id,
    { $set: { status: "active", ...(chat.firstResponseAt ? {} : { firstResponseAt: new Date() }) } },
    { returnDocument: "after" },
  ).lean<LiveChatRecord | null>();
  return { ok: true as const, chat: updated ?? result.chat, message: { ...result.message, delivery: "sent" } };
}
