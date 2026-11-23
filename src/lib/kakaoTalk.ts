import { createHmac, timingSafeEqual } from "node:crypto";
import { connectDB } from "@/lib/db";
import { appendMessage, createVisitorToken, type LiveChatRecord, nextTicketNo } from "@/lib/liveChat";
import { todayClosureState } from "@/lib/liveChatClosures";
import { isLiveChatOpen } from "@/lib/liveChatHours";
import { KAKAO_VIA, purchasePlaceLabel, TALK_PHOTO_PREFIX } from "@/lib/liveChatOptions";
import { detectTalkPlace } from "@/lib/talkPurchasePlace";
import { KakaoSignal } from "@/models/KakaoSignal";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatBlock } from "@/models/LiveChatBlock";
import { LiveChatMessage } from "@/models/LiveChatMessage";

// 카카오톡 채널 상담톡 — 공식 딜러사 톡브릿지(TalkBridge)를 거쳐 카카오 상담을 실시간 상담으로 받고, 상담원 답을 고객 카카오톡으로 보낸다.
//  받기: 톡브릿지 센터 [연동 관리 → 개발자 모드]의 웹훅 URL = https://<운영 서버>/api/kakao-talk
//        요청마다 HMAC 서명(X-Bridge-Signature)을 확인하고, 신호에는 글이 없어 고객 메시지는 조회 API 로 가져온다.
//  보내기: POST {API}/api/agent/send · 종료 /api/agent/end · 전화번호 요청 /api/agent/personal-info/request (Bearer 연동 키, BrandWrite)
//  톡톡과 달리 종료 API 가 있어, 이 화면에서 종료하면 카카오 상담도 실제로 끝난다.
//  고객이 보낸 사진은 카카오 CDN 주소로 오고 열흘쯤 지나면 안 열린다(톡브릿지 문서) — 지금은 주소만 남긴다.
// 문서: https://api.talkbridge.io (개발환경: api.talkbridge-dev.com — 키는 환경마다 따로)

const DEFAULT_API_URL = "https://api.talkbridge.io";
// 서명 시각이 이보다 벗어나면 다시 보낸 요청(리플레이)으로 보고 받지 않는다.
const SIGNATURE_WINDOW_S = 5 * 60;
const MAX_TEXT = 4000;
// 이 화면에서 보낸 답의 사본을 글로 짝지을 때 보는 시간 — 그 밖의 사본은 다른 곳(톡브릿지 등)에서 보낸 메시지로 본다.
const ECHO_WINDOW_MS = 10 * 60_000;
// 지난 상담을 찾는 범위(사본·삭제·개인정보 동의를 붙일 상담)
const RECENT_CHAT_MS = 30 * 24 * 60 * 60_000;
// 같은 고객 메시지를 두 번 넣지 않게 저널 번호를 비교하는 범위
const DEDUPE_MS = 7 * 24 * 60 * 60_000;

export type KakaoConfig = { apiUrl: string; brand: string; agentKey: string; webhookSecret: string; name: string };

// 연결 설정 — 셋(브랜드 키·연동 키·서명 검증 키) 중 하나라도 없으면 카카오 상담톡은 꺼진다.
//  KAKAO_TALKBRIDGE_BRAND(Brand Key) · KAKAO_TALKBRIDGE_AGENT_KEY(blumnb-…) · KAKAO_TALKBRIDGE_WEBHOOK_SECRET(whsec_…)
//  KAKAO_TALKBRIDGE_API_URL(비우면 운영 https://api.talkbridge.io) · KAKAO_TALKBRIDGE_NAME(화면 이름, 선택)
export function kakaoConfig(): KakaoConfig | null {
  const brand = process.env.KAKAO_TALKBRIDGE_BRAND?.trim() ?? "";
  const agentKey = process.env.KAKAO_TALKBRIDGE_AGENT_KEY?.trim() ?? "";
  const webhookSecret = process.env.KAKAO_TALKBRIDGE_WEBHOOK_SECRET?.trim() ?? "";
  if (!brand || !agentKey || !webhookSecret) return null;
  return {
    apiUrl: (process.env.KAKAO_TALKBRIDGE_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, ""),
    brand,
    agentKey,
    webhookSecret,
    name: process.env.KAKAO_TALKBRIDGE_NAME?.trim() || "카카오 상담톡",
  };
}

export function isKakaoConfigured() {
  return kakaoConfig() !== null;
}

// 웹훅 서명 — "v0=" + hex(HMAC_SHA256(서명 검증 키, "v0:" + 시각 + ":" + 받은 그대로의 본문)). 시각이 5분 넘게 어긋나도 거절.
export function verifyKakaoSignature(raw: Buffer, timestamp: string, signature: string, secret: string, nowMs = Date.now()) {
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_WINDOW_S) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:`).update(raw).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 톡브릿지가 보내는 신호(글 없음). 웹훅 경로에서 형식을 거른 뒤 넘긴다.
export type KakaoSignalEvent = {
  brand: string;
  userKey: string;
  kind: string;
  seq?: number;
  serial?: string;
  phase?: string;
  extra?: string;
  reference?: { extra?: string };
  lastReference?: { extra?: string; bot?: string; botEvent?: string };
  personalInfo?: { phoneNumber?: string; nickname?: string };
  consentedAt?: number;
};

type JournalItem = { seq?: number; kind?: string; text?: string; serial?: string };

export class KakaoSendError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const REQUEST_ERRORS: Record<string, string> = {
  FORBIDDEN: "톡브릿지 연동 키에 보내기 권한(BrandWrite)이 없어요. 톡브릿지 센터에서 키 권한을 확인해 주세요.",
  NO_BRAND_SCOPE: "톡브릿지 연동 키가 이 채널(브랜드 키)에 연결돼 있지 않아요. KAKAO_TALKBRIDGE_BRAND 를 확인해 주세요.",
  NO_BRAND: "톡브릿지에 없는 브랜드 키예요. KAKAO_TALKBRIDGE_BRAND 를 확인해 주세요.",
  QUOTA_EXHAUSTED: "이번 달 카카오 상담 건수를 모두 써서 보내지 못했어요. 톡브릿지에서 다시 결제해야 보낼 수 있어요.",
  NO_CONFIG: "톡브릿지 채널 발신 설정이 끝나지 않았어요. 톡브릿지 센터에서 채널 연동 상태를 확인해 주세요.",
};

function clip(text: string, max = MAX_TEXT) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// 톡브릿지 API 호출 — 실패는 HTTP 오류이거나 HTTP 200 + ok:false(카카오가 받지 않음)로 온다. 실패면 상담원이 읽을 문장으로 던진다.
async function talkBridge(
  config: KakaoConfig,
  path: string,
  { method = "POST", body, query = "" }: { method?: "GET" | "POST"; body?: Record<string, unknown>; query?: string } = {},
) {
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.agentKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // 응답을 못 받았을 뿐 카카오에는 갔을 수 있다(톡브릿지 문서: EXCEPTION 은 한 번만 다시 보내기).
    throw new KakaoSendError("EXCEPTION", "카카오(톡브릿지)에서 응답이 오지 않았어요. 고객에게 갔을 수도 있으니 잠시 뒤 대화를 확인하고 필요하면 한 번만 다시 보내 주세요.");
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    ok?: boolean;
    code?: string;
    message?: string | null;
  };
  if (response.status === 401) {
    throw new KakaoSendError("401", "톡브릿지 연동 키(KAKAO_TALKBRIDGE_AGENT_KEY)가 맞지 않아요. 운영·개발환경 키가 섞이지 않았는지도 확인해 주세요.");
  }
  if (response.ok && data.ok === true) return data;
  const code = typeof data.code === "string" && data.code ? data.code : response.ok ? "?" : `HTTP ${response.status}`;
  const said = typeof data.message === "string" && data.message.trim() ? clip(data.message.trim(), 200) : "";
  throw new KakaoSendError(code, REQUEST_ERRORS[code] ?? (said || `카카오(톡브릿지)가 요청을 받지 않았어요(${code}).`));
}

// 고객의 최근 저널(최신순) — 신호의 seq 와 같은 항목에서 글을 꺼낸다.
async function fetchJournal(config: KakaoConfig, userKey: string, max: number) {
  const data = await talkBridge(config, `/api/agent/rooms/${encodeURIComponent(userKey)}/messages`, {
    method: "GET",
    query: `?brand=${encodeURIComponent(config.brand)}&max=${max}`,
  });
  return Array.isArray(data.messages) ? (data.messages as JournalItem[]) : [];
}

async function journalItem(config: KakaoConfig, userKey: string, seq: number | undefined, kind: string) {
  for (const max of [30, 300]) {
    const items = await fetchJournal(config, userKey, max);
    const found = typeof seq === "number" ? items.find((item) => item.seq === seq) : items.find((item) => item.kind === kind);
    if (found) return found;
    if (items.length < max) break;
  }
  return null;
}

// 카카오 CDN 첨부 주소만 첨부로 본다 — 고객이 직접 친 다른 주소는 글 그대로(문서: 호스트를 정확히 비교, 사용자 정보가 붙은 주소 거부).
function kakaoCdnUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "talk.kakaocdn.net" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

const ATTACHMENT_LINE = /^\[(photo|video|audio|file)\]\s+(\S+)(?:\s+(.*))?$/;
const ATTACHMENT_LABEL: Record<string, string> = { video: "[동영상] ", audio: "[음성] ", file: "[파일] " };

// 고객 메시지 글 → 상담 대화에 남길 메시지들. 사진은 한 장씩 "[사진] <주소>"(화면이 사진으로 보여 줌), 동영상·음성·파일은
// "[동영상] <주소>" 처럼, 나머지 글은 순서대로 묶는다. 묶음 사진은 한 줄에 한 장씩 온다(문서).
export function kakaoMessageTexts(text: string) {
  const out: string[] = [];
  let plain: string[] = [];
  const flush = () => {
    const body = plain.join("\n").trim();
    if (body) out.push(clip(body));
    plain = [];
  };
  for (const raw of text.split("\n")) {
    const match = ATTACHMENT_LINE.exec(raw.trim());
    const url = match ? kakaoCdnUrl(match[2]) : "";
    if (!match || !url) {
      plain.push(raw);
      continue;
    }
    flush();
    out.push(`${match[1] === "photo" ? TALK_PHOTO_PREFIX : ATTACHMENT_LABEL[match[1]]}${url}`);
    if (match[3]?.trim()) plain.push(match[3].trim());
  }
  flush();
  return out;
}

// 카카오 전화번호(국가번호 포함 "8210…") → "010…"(그 밖의 형식은 숫자만)
export function kakaoPhone(value: string | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.startsWith("82") && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

function formatPhone(digits: string) {
  if (/^01\d{8,9}$/.test(digits)) return digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
  return digits;
}

// 진행 중 카카오 상담은 고객마다 하나 — kakao.openUser 고유 인덱스로 막는다(같은 고객 신호가 동시에 와도).
// 처음 받을 때 만든다(이미 있으면 그대로). 만들지 못해도 메시지는 받는다.
let kakaoIndex: Promise<void> | null = null;
function ensureKakaoIndex() {
  kakaoIndex ??= LiveChat.collection
    .createIndex(
      { "kakao.openUser": 1 },
      { name: "kakao_open_user", unique: true, partialFilterExpression: { "kakao.openUser": { $type: "string" } } },
    )
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error("[kakao-talk] 진행 중 상담 고유 인덱스를 만들지 못함", error);
      kakaoIndex = null;
    });
  return kakaoIndex;
}

function isDuplicateKey(error: unknown) {
  return (error as { code?: number } | null)?.code === 11000;
}

async function findOpenKakaoChat(userKey: string) {
  return LiveChat.findOne({ "kakao.openUser": userKey }).lean<LiveChatRecord | null>();
}

async function recentKakaoChats(userKey: string) {
  return LiveChat.find({ "kakao.userKey": userKey, lastMessageAt: { $gte: new Date(Date.now() - RECENT_CHAT_MS) } })
    .sort({ lastMessageAt: -1 })
    .limit(5)
    .lean<LiveChatRecord[]>();
}

// 새 카카오 상담 — 그사이 같은 고객의 다른 신호가 먼저 상담을 열었으면(고유 인덱스 충돌) 그 상담을 쓴다.
async function openKakaoChat(userKey: string, status: "waiting" | "active" = "waiting") {
  const closure = await todayClosureState().catch(() => null);
  try {
    const created = await LiveChat.create({
      channel: KAKAO_VIA,
      ticketNo: await nextTicketNo(),
      visitorToken: createVisitorToken(),
      status,
      offHours: !isLiveChatOpen() || Boolean(closure?.closedNow),
      source: { via: KAKAO_VIA },
      kakao: { userKey, openUser: userKey },
    });
    return created.toObject() as LiveChatRecord;
  } catch (error) {
    const open = isDuplicateKey(error) ? await findOpenKakaoChat(userKey) : null;
    if (open) return open;
    throw error;
  }
}

// 신호를 한 번만 처리하려고 표시를 남긴다 — 이미 있으면 false(처리했거나 처리 중). 처리에 실패하면 releaseKakaoSignal 로 지운다.
export async function claimKakaoSignal(key: string, kind: string) {
  await connectDB();
  try {
    await KakaoSignal.create({ key, kind });
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    throw error;
  }
}

export async function releaseKakaoSignal(key: string) {
  await KakaoSignal.deleteOne({ key }).catch(() => undefined);
}

// 신호 하나 처리 — 종류(kind)마다 나눈다. 다른 브랜드 신호는 무시한다.
export async function receiveKakaoSignal(signal: KakaoSignalEvent, config: KakaoConfig) {
  if (signal.brand !== config.brand) return;
  await connectDB();
  await ensureKakaoIndex();
  switch (signal.kind) {
    case "message":
      return receiveKakaoMessage(signal, config);
    case "reference":
      return receiveKakaoReference(signal);
    case "expired":
    case "ended":
      return receiveKakaoEnded(signal);
    case "agent":
      // 보낸 직후의 '접수' 신호는 저장하지 않는다(약 1초 뒤 저널 항목으로 한 번 더 온다).
      if (signal.phase === "accepted" || typeof signal.seq !== "number") return;
      return receiveKakaoAgent(signal, config);
    case "deleted":
      return receiveKakaoDeleted(signal);
    case "personal_info":
      return receiveKakaoPersonalInfo(signal);
    default:
      return;
  }
}

// 고객 메시지 — 저널에서 글을 가져와 그 고객의 진행 중 상담에 붙이고, 없으면 새 상담(대기)을 연다.
async function receiveKakaoMessage(signal: KakaoSignalEvent, config: KakaoConfig) {
  const { userKey, seq } = signal;
  // 스팸으로 지운 고객은 차단 기간 동안 받지 않는다(셀프가이드·톡톡 상담과 같은 규칙).
  if (await LiveChatBlock.exists({ key: `kakao:${userKey}`, until: { $gt: new Date() } })) return;
  if (typeof seq === "number") {
    const chats = await LiveChat.find({ "kakao.userKey": userKey }, { _id: 1 }).sort({ lastMessageAt: -1 }).limit(5).lean<{ _id: unknown }[]>();
    const seen = await LiveChatMessage.exists({
      chatId: { $in: chats.map((chat) => chat._id) },
      "talk.seq": seq,
      sender: "visitor",
      createdAt: { $gte: new Date(Date.now() - DEDUPE_MS) },
    });
    if (seen) return;
  }

  const item = await journalItem(config, userKey, seq, "message");
  const texts = item ? kakaoMessageTexts(item.text ?? "") : ["(카카오 메시지 내용을 불러오지 못했어요 — 고객 카카오톡 대화를 확인해 주세요)"];
  if (!texts.length) return;

  const chat = (await findOpenKakaoChat(userKey)) ?? (await openKakaoChat(userKey));
  for (const text of texts) {
    await appendMessage(chat._id, "visitor", text, {}, typeof seq === "number" ? { talk: { seq } } : {});
  }

  // 고객이 구매처(스마트스토어 / 요기보 공식몰)를 말하면 상담에 적어 둔다 — AI 도우미가 그 기준으로 쓰고 그 구매처 주문만 찾는다.
  // 이미 적힌 구매처(상담원이 고른 것 포함)는 바꾸지 않는다(네이버 톡톡과 같은 규칙).
  const place = texts.map(detectTalkPlace).find(Boolean);
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

// 새 상담 연결 — 상담 연결 링크·버튼·챗봇에 심은 값(어디서 들어왔는지)을 적어 둔다.
async function receiveKakaoReference(signal: KakaoSignalEvent) {
  const extra = clip((signal.reference?.extra || signal.lastReference?.extra || "").trim(), 200);
  const fromBot = !signal.reference?.extra && Boolean(signal.lastReference?.bot && signal.lastReference.bot !== "false");
  const chat = (await findOpenKakaoChat(signal.userKey)) ?? (await openKakaoChat(signal.userKey));
  if (extra) await LiveChat.updateOne({ _id: chat._id }, { $set: { "kakao.extra": extra } });
  const where = [extra && `들어온 곳 ${extra}`, fromBot && "챗봇에서 넘어옴"].filter(Boolean).join(" · ");
  await appendMessage(chat._id, "system", `카카오 상담이 연결됐어요${where ? ` (${where})` : ""}.`);
}

// 카카오 쪽에서 상담이 끝남(고객이 끝냈거나 다른 곳에서 종료 · 오래 지나 만료) — 이 화면의 상담도 닫는다(그 상담방엔 답장이 안 간다).
async function receiveKakaoEnded(signal: KakaoSignalEvent) {
  const chat = await findOpenKakaoChat(signal.userKey);
  if (!chat) return;
  const expired = signal.kind === "expired";
  const changed = await LiveChat.updateOne(
    { _id: chat._id, status: { $ne: "closed" } },
    { $set: { status: "closed", closedAt: new Date(), closedBy: expired ? "system" : "visitor" }, $unset: { "kakao.openUser": 1 } },
  );
  if (!changed.modifiedCount) return;
  await appendMessage(
    chat._id,
    "system",
    expired
      ? "카카오 상담이 시간이 지나 자동으로 끝났어요. 고객이 다시 메시지를 보내면 새 상담으로 들어와요."
      : "카카오에서 상담이 끝났어요(고객이 상담을 끝냈거나 다른 곳에서 종료). 고객이 다시 메시지를 보내면 새 상담으로 들어와요.",
  );
}

// 보낸 메시지의 사본(저널 항목) — 이 화면에서 보낸 답이면 '보냄'으로 확인만 하고, 다른 곳(톡브릿지 등)에서 보낸 메시지면 대화에 남긴다.
async function receiveKakaoAgent(signal: KakaoSignalEvent, config: KakaoConfig) {
  const { userKey, serial, seq } = signal;
  const recent = await recentKakaoChats(userKey);
  const chatIds = recent.map((chat) => chat._id);
  if (serial && chatIds.length) {
    const mine = await LiveChatMessage.findOneAndUpdate(
      { chatId: { $in: chatIds }, "talk.serial": serial },
      { $set: { "talk.echoed": true, "talk.state": "sent" } },
    );
    if (mine) return;
  }
  const item = await journalItem(config, userKey, seq, "agent");
  const text = item?.text ? clip(item.text) : "";
  if (!text) return;
  if (chatIds.length) {
    // 응답을 못 받아 번호가 없는 답·종료 인사말 — 글로 짝짓는다.
    const mine = await LiveChatMessage.findOneAndUpdate(
      {
        chatId: { $in: chatIds },
        sender: "agent",
        "talk.state": { $exists: true },
        "talk.echoed": { $ne: true },
        text,
        createdAt: { $gte: new Date(Date.now() - ECHO_WINDOW_MS) },
      },
      { $set: { "talk.echoed": true, "talk.state": "sent", ...(serial ? { "talk.serial": serial } : {}) } },
      { sort: { createdAt: 1 } },
    );
    if (mine) return;
  }
  const chat =
    (await findOpenKakaoChat(userKey)) ?? recent.find((item) => !item.deletedAt) ?? (await openKakaoChat(userKey, "active"));
  const open = chat.status !== "closed";
  await appendMessage(
    chat._id,
    "agent",
    text,
    open ? { status: "active", ...(chat.firstResponseAt ? {} : { firstResponseAt: new Date() }) } : {},
    { talk: { partner: true, ...(serial ? { serial } : {}), seq } },
  );
}

// 보낸 메시지가 지워짐(발신 취소) — 그 말풍선에 표시하고 상담원에게 알린다.
async function receiveKakaoDeleted(signal: KakaoSignalEvent) {
  if (!signal.serial) return;
  const recent = await recentKakaoChats(signal.userKey);
  if (!recent.length) return;
  const message = await LiveChatMessage.findOneAndUpdate(
    { chatId: { $in: recent.map((chat) => chat._id) }, "talk.serial": signal.serial, "talk.deleted": { $ne: true } },
    { $set: { "talk.deleted": true } },
  ).lean<{ chatId: LiveChatRecord["_id"]; seq: number } | null>();
  if (!message) return;
  await appendMessage(message.chatId, "system", "보낸 메시지 하나가 지워졌어요. 고객 카카오톡에는 '메시지가 삭제되었습니다'로 보여요.");
}

// 고객이 개인정보 제공에 동의함 — 값은 이때 한 번만 온다(톡브릿지는 저장하지 않음). 상담에 바로 적는다.
async function receiveKakaoPersonalInfo(signal: KakaoSignalEvent) {
  const phone = kakaoPhone(signal.personalInfo?.phoneNumber);
  const nickname = clip((signal.personalInfo?.nickname ?? "").trim(), 40);
  const chat = (await findOpenKakaoChat(signal.userKey)) ?? (await recentKakaoChats(signal.userKey))[0];
  if (!chat) {
    console.warn("[kakao-talk] 개인정보 동의를 붙일 상담이 없음");
    return;
  }
  const consentedAt = typeof signal.consentedAt === "number" && signal.consentedAt > 0 ? new Date(signal.consentedAt) : new Date();
  await LiveChat.updateOne({ _id: chat._id }, { $set: { "kakao.phone": phone, "kakao.nickname": nickname, "kakao.consentedAt": consentedAt } });
  const parts = [nickname && `닉네임 ${nickname}`, phone ? `전화번호 ${formatPhone(phone)}` : "카카오에 등록된 전화번호 없음"].filter(Boolean);
  await appendMessage(chat._id, "system", `고객이 개인정보 제공에 동의했어요 — ${parts.join(" · ")}`);
}

function configOrThrow() {
  const config = kakaoConfig();
  if (!config) throw new KakaoSendError("NO_SETTING", "카카오 상담톡(톡브릿지) 연결 설정이 없어 보낼 수 없어요.");
  return config;
}

function userKeyOrThrow(chat: LiveChatRecord) {
  const userKey = chat.kakao?.userKey;
  if (!userKey) throw new KakaoSendError("NO_USER", "카카오 고객 정보가 없어 보낼 수 없어요.");
  return userKey;
}

// 상담원 답 — 대화에 먼저 '보내는 중'으로 남기고(사본이 먼저 와도 짝을 찾게) 카카오로 보낸 뒤 결과를 적는다.
// 못 보낸 답도 '못 보냄'으로 남는다(상담원이 다시 보내면 새 메시지).
export async function replyByKakao(chat: LiveChatRecord, text: string) {
  const config = configOrThrow();
  const userKey = userKeyOrThrow(chat);
  const result = await appendMessage(chat._id, "agent", text, {}, { talk: { state: "sending" } });
  if (!result) return null;
  const { seq } = result.message;

  try {
    const data = await talkBridge(config, "/api/agent/send", { body: { brandKey: config.brand, userKey, text } });
    const serial = typeof data.serial === "string" ? data.serial : "";
    await LiveChatMessage.updateOne({ chatId: chat._id, seq }, { $set: { "talk.state": "sent", ...(serial ? { "talk.serial": serial } : {}) } });
  } catch (cause) {
    const error = cause instanceof KakaoSendError ? cause.message : "카카오톡으로 보내지 못했어요.";
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

// 이 화면에서 종료할 때 — 카카오 상담도 끝낸다(종료 인사말을 먼저 보내고 끝남). 인사말은 상담원 말풍선으로 남겨 사본과 짝짓는다.
//  "done" 끝냄 · "already" 카카오 상담이 이미 끝나 있었음 · "failed" 끝내지 못함 · "off" 연결 설정 없음
export async function endKakaoChat(chat: LiveChatRecord, greeting: string): Promise<{ state: "done" | "already" | "failed" | "off"; reason?: string }> {
  const config = kakaoConfig();
  const userKey = chat.kakao?.userKey;
  if (!config || !userKey) return { state: "off" };
  const result = await appendMessage(chat._id, "agent", greeting, {}, { talk: { state: "sending" } });
  const seq = result?.message.seq;
  try {
    const data = await talkBridge(config, "/api/agent/end", { body: { brandKey: config.brand, userKey, greeting } });
    const serial = typeof data.serial === "string" ? data.serial : "";
    if (seq) await LiveChatMessage.updateOne({ chatId: chat._id, seq }, { $set: { "talk.state": "sent", ...(serial ? { "talk.serial": serial } : {}) } });
    return { state: "done" };
  } catch (error) {
    if (seq) await LiveChatMessage.updateOne({ chatId: chat._id, seq, "talk.echoed": { $ne: true } }, { $set: { "talk.state": "failed" } });
    if (error instanceof KakaoSendError && error.code === "-502") return { state: "already" };
    return { state: "failed", reason: error instanceof KakaoSendError ? error.message : "카카오(톡브릿지)에 연결하지 못했어요." };
  }
}

// 종료 뒤 상담원에게 남기는 안내
export function kakaoClosedNote(result: { state: "done" | "already" | "failed" | "off"; reason?: string }) {
  const again = " 고객이 다시 메시지를 보내면 새 상담으로 들어와요.";
  if (result.state === "done") return `상담을 종료했어요. 카카오 상담도 끝났고 고객에게 종료 인사말을 보냈어요.${again}`;
  if (result.state === "already") return `상담을 종료했어요. 카카오 상담은 이미 끝나 있어서 종료 인사말은 가지 않았어요.${again}`;
  if (result.state === "off") return `상담을 종료했어요. 카카오 상담톡 연결 설정이 없어 카카오 상담은 끝내지 못했어요.${again}`;
  return `상담을 이 화면에서 종료했지만 카카오 상담은 끝내지 못했어요 — ${result.reason ?? ""}${again}`;
}

// 전화번호 요청 — 카카오 개인정보 제공 동의 말풍선을 보낸다(상담 세션당 1회, 3일 안에 동의해야 유효). 동의하면 웹훅으로 번호가 온다.
export async function requestKakaoPhone(chat: LiveChatRecord) {
  const config = configOrThrow();
  const userKey = userKeyOrThrow(chat);
  try {
    await talkBridge(config, "/api/agent/personal-info/request", { body: { brandKey: config.brand, userKey } });
  } catch (error) {
    if (error instanceof KakaoSendError && error.code === "-520") {
      throw new KakaoSendError("-520", "이 상담에서 이미 전화번호를 요청했어요(카카오 상담당 한 번). 고객이 새 상담을 시작하면 다시 요청할 수 있어요.");
    }
    throw error;
  }
  await LiveChat.updateOne({ _id: chat._id }, { $set: { "kakao.phoneRequestedAt": new Date() } });
  return appendMessage(
    chat._id,
    "system",
    "고객에게 전화번호 제공 동의를 요청했어요. 고객이 [동의]를 누르면 여기에 번호가 남아요(3일 안에 동의해야 해요).",
  );
}
