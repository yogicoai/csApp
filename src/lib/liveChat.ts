import { randomBytes, timingSafeEqual } from "node:crypto";
import { isValidObjectId, type Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { kstDateString } from "@/lib/liveChatHours";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatCounter } from "@/models/LiveChatCounter";
import { LiveChatMessage } from "@/models/LiveChatMessage";

export const LIVE_CHAT_TOKEN_HEADER = "x-live-chat-token";
// 휴지통에 없는 상담(deletedAt 이 없거나 null) — 목록·검색·통계·고객 API 는 모두 이 조건으로 거른다.
export const NOT_DELETED = { deletedAt: null };
export const LIVE_CHAT_MAX_TEXT = 1000;
// 고객 화면은 3초마다 폴링하므로, 이 시간 안에 폴링이 있었으면 "접속 중"으로 본다.
const VISITOR_ONLINE_MS = 15_000;

export const LIVE_CHAT_MESSAGES = {
  waiting: "상담원에게 연결하고 있어요. 순서대로 답변드릴게요.",
  closedByAgent: "상담이 종료되었어요. 이용해 주셔서 감사합니다.",
  closedByVisitor: "고객님이 상담을 종료했어요.",
  reopened: "상담이 다시 열렸어요.",
  // 톡톡 상담은 고객 화면이 없어 종료 안내가 고객에게 가지 않는다 — 상담원이 헷갈리지 않게 따로 적는다.
  closedTalk: "상담을 종료했어요. 고객 톡톡에는 종료 안내가 가지 않고, 고객이 다시 메시지를 보내면 새 상담으로 들어와요.",
};

// 운영시간 외 문의 접수 — 답변 안내 문자를 받을 휴대폰(010 등 휴대폰만, 숫자만 남김). 형식이 틀리면 "".
export function normalizeMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  return /^01[016789]\d{7,8}$/.test(digits) ? digits : "";
}

export function maskMobile(digits: string) {
  return digits.length >= 10 ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : "";
}

// 접수 직후 고객에게 남기는 안내 — 언제부터, 어떻게 답이 오는지 분명히 알린다.
export function receiptMessage(openLabel: string, phone: string) {
  return `문의가 접수됐어요. ${openLabel}부터 순서대로 확인하고, 답변을 남기면 ${maskMobile(phone)}로 알림 문자를 보내 드릴게요. 문자 속 링크나 이 화면에서 답변을 볼 수 있어요.`;
}

export type LiveChatSender = "visitor" | "agent" | "system";
export type LiveChatStatus = "waiting" | "active" | "closed";

export type LiveChatRecord = {
  _id: Types.ObjectId;
  ticketNo?: string;
  channel: string;
  visitorToken: string;
  sessionId?: string;
  memberId?: string;
  status: LiveChatStatus;
  entry?: { faqId?: string; faqQuestion?: string; category?: string; aiQuery?: string };
  intake?: { purchasePlace?: string; inquiryType?: string; orderNumber?: string };
  source?: {
    via?: string;
    app?: string;
    embedded?: boolean;
    parentOrigin?: string;
    referrer?: string;
    param?: string;
  };
  talk?: { user?: string; openUser?: string; productName?: string; productUrl?: string; account?: string };
  offHours?: boolean;
  contact?: { phone?: string; consentAt?: Date };
  notifiedAt?: Date;
  messageSeq: number;
  lastMessageAt?: Date;
  lastMessagePreview?: string;
  lastSender?: string;
  agentUnread?: number;
  visitorSeenAt?: Date;
  firstResponseAt?: Date;
  closedAt?: Date;
  closedBy?: string;
  outcome?: { result?: string; memo?: string; decidedAt?: Date };
  deletedAt?: Date;
  deleteReason?: string;
  assetClaimId?: string;
  createdAt?: Date;
};

type LiveChatMessageRecord = {
  seq: number;
  sender: LiveChatSender;
  text: string;
  createdAt?: Date;
  talk?: { state?: string; partner?: boolean };
};

export function createVisitorToken() {
  return randomBytes(24).toString("base64url");
}

// 상담번호 LC-YYMMDD-NNN — 날짜(KST)별 카운터를 원자적으로 올려 발급한다.
export async function nextTicketNo(now = new Date()) {
  const day = kstDateString(now).replace(/-/g, "");
  const counter = await LiveChatCounter.findOneAndUpdate(
    { _id: `livechat-${day}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  ).lean<{ seq: number } | null>();
  return `LC-${day.slice(2)}-${String(counter?.seq ?? 1).padStart(3, "0")}`;
}

export function serializeMessage(doc: LiveChatMessageRecord) {
  return {
    seq: doc.seq,
    sender: doc.sender,
    text: doc.text,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    // 톡톡 상담에만 붙는다 — delivery: 톡톡으로 보내는 중·보냄·못 보냄, partner: 톡톡 파트너센터에서 보낸 메시지
    ...(doc.talk?.state ? { delivery: doc.talk.state } : {}),
    ...(doc.talk?.partner ? { partner: true } : {}),
  };
}

// 고객에게는 대화방 상태만 내려준다(토큰·회원ID 등은 제외).
export function visitorView(chat: LiveChatRecord) {
  return { id: String(chat._id), ticketNo: chat.ticketNo ?? "", status: chat.status, offHours: Boolean(chat.offHours) };
}

export function adminView(chat: LiveChatRecord) {
  return {
    id: String(chat._id),
    ticketNo: chat.ticketNo ?? "",
    channel: chat.channel,
    status: chat.status,
    memberId: chat.memberId ?? "",
    entry: {
      faqId: chat.entry?.faqId ?? "",
      faqQuestion: chat.entry?.faqQuestion ?? "",
      category: chat.entry?.category ?? "",
      aiQuery: chat.entry?.aiQuery ?? "",
    },
    intake: {
      purchasePlace: chat.intake?.purchasePlace ?? "",
      inquiryType: chat.intake?.inquiryType ?? "",
      orderNumber: chat.intake?.orderNumber ?? "",
    },
    source: {
      via: chat.source?.via ?? "",
      app: chat.source?.app ?? "",
      embedded: Boolean(chat.source?.embedded),
      parentOrigin: chat.source?.parentOrigin ?? "",
      referrer: chat.source?.referrer ?? "",
      param: chat.source?.param ?? "",
    },
    talk: { productName: chat.talk?.productName ?? "", productUrl: chat.talk?.productUrl ?? "", account: chat.talk?.account ?? "" },
    offHours: Boolean(chat.offHours),
    contactPhone: chat.contact?.phone ?? "",
    notifiedAt: chat.notifiedAt?.toISOString() ?? "",
    lastMessageAt: chat.lastMessageAt?.toISOString() ?? "",
    lastMessagePreview: chat.lastMessagePreview ?? "",
    lastSender: chat.lastSender ?? "",
    agentUnread: chat.agentUnread ?? 0,
    visitorOnline: Boolean(chat.visitorSeenAt && Date.now() - chat.visitorSeenAt.getTime() < VISITOR_ONLINE_MS),
    createdAt: chat.createdAt?.toISOString() ?? "",
    firstResponseAt: chat.firstResponseAt?.toISOString() ?? "",
    closedAt: chat.closedAt?.toISOString() ?? "",
    closedBy: chat.closedBy ?? "",
    outcome: {
      result: chat.outcome?.result ?? "",
      memo: chat.outcome?.memo ?? "",
      decidedAt: chat.outcome?.decidedAt?.toISOString() ?? "",
    },
    deletedAt: chat.deletedAt?.toISOString() ?? "",
    deleteReason: chat.deleteReason ?? "",
    assetClaimId: chat.assetClaimId ?? "",
  };
}

// 메시지 추가 — 대화방의 messageSeq 를 원자적으로 올려 순번을 발급한 뒤 저장한다.
// 시스템 안내는 어드민 목록 미리보기를 덮지 않도록 미리보기·마지막 발신자를 갱신하지 않는다.
// fields 는 메시지 문서에 함께 저장할 값(톡톡 전송 상태 등).
export async function appendMessage(
  chatId: Types.ObjectId | string,
  sender: LiveChatSender,
  text: string,
  set: Record<string, unknown> = {},
  fields: Record<string, unknown> = {},
) {
  const inc: Record<string, number> = { messageSeq: 1 };
  if (sender === "visitor") inc.agentUnread = 1;

  const preview = sender === "system" ? {} : { lastMessagePreview: text.slice(0, 80), lastSender: sender };
  const chat = await LiveChat.findByIdAndUpdate(
    chatId,
    { $inc: inc, $set: { lastMessageAt: new Date(), ...preview, ...set } },
    { returnDocument: "after" },
  ).lean<LiveChatRecord | null>();

  if (!chat) return null;

  const message = await LiveChatMessage.create({ chatId: chat._id, seq: chat.messageSeq, sender, text, ...fields });
  return { chat, message: serializeMessage(message) };
}

export async function getMessagesAfter(chatId: Types.ObjectId | string, after: number) {
  const docs = await LiveChatMessage.find({ chatId, seq: { $gt: after } })
    .sort({ seq: 1 })
    .limit(300)
    .lean<LiveChatMessageRecord[]>();
  return docs.map(serializeMessage);
}

export function parseAfter(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("after") ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function sameToken(stored: string, given: string) {
  const a = Buffer.from(stored);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 고객 API 공통 — 헤더의 토큰이 대화방 토큰과 일치할 때만 대화방을 돌려준다.
// 휴지통으로 간 상담은 고객에게 없는 상담과 같다(고객 화면은 새 상담 시작으로 돌아간다).
export async function findVisitorChat(request: Request, id: string) {
  const token = request.headers.get(LIVE_CHAT_TOKEN_HEADER) ?? "";
  if (!token || !isValidObjectId(id)) return null;
  await connectDB();
  const chat = await LiveChat.findById(id).lean<LiveChatRecord | null>();
  if (!chat || chat.deletedAt || !sameToken(chat.visitorToken, token)) return null;
  return chat;
}

// 스팸 차단 키 — 회원ID(자사몰 로그인)와 같은 브라우저 세션, 톡톡 상담은 톡톡 사용자
export function spamBlockKeys(chat: { memberId?: string; sessionId?: string; talk?: { user?: string } }) {
  return [
    chat.memberId && `member:${chat.memberId}`,
    chat.sessionId && `session:${chat.sessionId}`,
    chat.talk?.user && `talk:${chat.talk.user}`,
  ].filter((key): key is string => Boolean(key));
}

export async function findChatById(id: string) {
  if (!isValidObjectId(id)) return null;
  await connectDB();
  return LiveChat.findById(id).lean<LiveChatRecord | null>();
}
