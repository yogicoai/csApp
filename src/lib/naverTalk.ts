import { timingSafeEqual } from "node:crypto";
import { connectDB } from "@/lib/db";
import { getClientIp, inCidr } from "@/lib/ipBlock";
import { appendMessage, createVisitorToken, type LiveChatRecord, nextTicketNo } from "@/lib/liveChat";
import { todayClosureState } from "@/lib/liveChatClosures";
import { isLiveChatOpen } from "@/lib/liveChatHours";
import { TALK_PHOTO_PREFIX, TALK_VIA } from "@/lib/liveChatOptions";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatBlock } from "@/models/LiveChatBlock";
import { LiveChatMessage } from "@/models/LiveChatMessage";

// 네이버 톡톡 챗봇 API — 톡톡으로 들어온 고객 메시지를 실시간 상담으로 받고, 상담원 답변을 톡톡으로 보낸다.
//  받기: 톡톡 파트너센터 [챗봇API 설정]의 '이벤트 받을 URL' = https://<운영 서버>/api/naver-talk/<NAVER_TALK_WEBHOOK_SECRET>
//        이벤트는 send·open·leave·echo 를 고른다(open·leave 는 받기만 한다).
//  보내기: POST https://gw.talk.naver.com/chatbot/v1/event + Authorization(파트너센터 [보내기 API]에서 만든 키)
//  톡톡 요청에는 서명이 없어 주소의 비밀값으로 막고, NAVER_TALK_CHECK_IP=1 이면 네이버 IP 대역도 확인한다.
//  지난 대화를 가져오는 API 는 없다 — 연결한 뒤 들어온 대화부터 쌓인다.
// 문서: https://github.com/navertalk/chatbot-api

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
  textContent?: { text?: string; inputType?: string };
  imageContent?: { imageUrl?: string };
  compositeContent?: { compositeList?: Array<{ title?: string; description?: string }> };
  options?: { product?: { name?: string; url?: string } };
};

export class TalkSendError extends Error {}

// 연결한 톡톡 계정 — 톡톡 계정마다 받는 주소(비밀값)와 보내기 키가 따로다.
//  첫 계정: NAVER_TALK_AUTH_KEY · NAVER_TALK_WEBHOOK_SECRET · NAVER_TALK_NAME(화면 이름, 선택)
//  둘째 계정: 같은 이름 끝에 _2 (NAVER_TALK_AUTH_KEY_2 · NAVER_TALK_WEBHOOK_SECRET_2 · NAVER_TALK_NAME_2)
// 첫 계정 상담은 talk.account 가 비어 있고(예전 데이터 그대로), 둘째 계정 상담은 talk.account = "2".
export type TalkAccount = { key: string; name: string; authKey: string; secret: string };

const ACCOUNT_SLOTS = [
  { key: "", suffix: "", fallback: "네이버 톡톡" },
  { key: "2", suffix: "_2", fallback: "네이버 톡톡 2" },
] as const;

export function talkAccounts(): TalkAccount[] {
  return ACCOUNT_SLOTS.flatMap(({ key, suffix, fallback }) => {
    const authKey = process.env[`NAVER_TALK_AUTH_KEY${suffix}`] ?? "";
    const secret = process.env[`NAVER_TALK_WEBHOOK_SECRET${suffix}`] ?? "";
    if (!authKey || secret.length < MIN_SECRET_LENGTH) return [];
    return [{ key, name: process.env[`NAVER_TALK_NAME${suffix}`]?.trim() || fallback, authKey, secret }];
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
function openKey(account: TalkAccount, user: string) {
  return account.key ? `${account.key}:${user}` : user;
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
}

// 톡톡이 되돌려 주는 '보낸 메시지' 사본 — 이 화면에서 보낸 답변이면 이미 대화에 있으니 전송 확인만 하고,
// 톡톡 파트너센터(앱 포함)에서 직원이 직접 보낸 메시지면 대화에 남긴다(진행 중 상담이면 상담중으로).
export async function receiveTalkEcho(event: TalkEvent, account: TalkAccount) {
  await connectDB();
  await ensureTalkIndex();
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

// 고객 톡톡으로 글 보내기 — 그 상담이 들어온 계정의 보내기 키로. 톡톡은 실패도 HTTP 200 으로 주므로 success 를 본다.
export async function sendTalkText(account: TalkAccount, user: string, text: string) {
  let response: Response;
  try {
    response = await fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", Authorization: account.authKey },
      body: JSON.stringify({ event: "send", user, textContent: { text } }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new TalkSendError("네이버 톡톡에 연결하지 못했어요. 잠시 뒤 다시 보내 주세요.");
  }
  const body = (await response.json().catch(() => ({}))) as { success?: boolean; resultCode?: string; resultMessage?: string };
  if (response.ok && body.success === true) return;
  const detail = body.resultMessage ? ` (${clip(body.resultMessage, 120)})` : response.ok ? "" : ` (HTTP ${response.status})`;
  throw new TalkSendError(SEND_ERRORS[body.resultCode ?? ""] ?? `네이버 톡톡이 메시지를 받지 않았어요${detail}.`);
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
