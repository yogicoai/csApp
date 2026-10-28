import type { Types } from "mongoose";
import type { ZodError } from "zod";
import {
  type BlackConsumerView,
  type BlackHistoryAction,
  type BlackSettings,
  type BlackStatus,
  type CautionView,
  DEFAULT_RETENTION_MONTHS,
  ENDING_SOON_DAYS,
  isRetentionMonths,
} from "@/lib/blackConsumer";
import { connectDB } from "@/lib/db";
import type { LiveChatRecord } from "@/lib/liveChat";
import { kstToday, shiftDay } from "@/lib/liveChatHours";
import { isPhoneDigits, phoneDigits } from "@/lib/phone";
import type { VoiceCallRecord } from "@/lib/voiceCall";
import { BlackConsumer } from "@/models/BlackConsumer";
import { BlackConsumerSetting } from "@/models/BlackConsumerSetting";

export type BlackConsumerRecord = {
  _id: Types.ObjectId;
  phone?: string;
  memberId?: string;
  talkUser?: string;
  talkTicket?: string;
  name?: string;
  reasons?: string[];
  detail?: string;
  refs?: string;
  registeredBy?: string;
  until: string;
  releasedAt?: Date | null;
  releasedBy?: string;
  releaseNote?: string;
  history?: Array<{ at?: Date; action: BlackHistoryAction; by?: string; note?: string }>;
  createdAt?: Date;
};

// 지금 주의 중 — 해제하지 않았고 끝나는 날이 오늘 이후
export function currentFilter(today = kstToday()) {
  return { releasedAt: null, until: { $gte: today } };
}

// 끝남 — 해제했거나 끝나는 날이 지났다
export function endedFilter(today = kstToday()) {
  return { $or: [{ releasedAt: { $ne: null } }, { until: { $lt: today } }] };
}

export function blackStatus(entry: BlackConsumerRecord, today = kstToday()): BlackStatus {
  if (entry.releasedAt) return "released";
  if (entry.until < today) return "expired";
  return entry.until <= shiftDay(today, ENDING_SOON_DAYS) ? "ending" : "active";
}

export function serializeBlackConsumer(entry: BlackConsumerRecord, today = kstToday()): BlackConsumerView {
  return {
    id: String(entry._id),
    phone: entry.phone ?? "",
    memberId: entry.memberId ?? "",
    talk: Boolean(entry.talkUser),
    talkTicket: entry.talkTicket ?? "",
    name: entry.name ?? "",
    reasons: entry.reasons ?? [],
    detail: entry.detail ?? "",
    refs: entry.refs ?? "",
    registeredBy: entry.registeredBy ?? "",
    createdAt: entry.createdAt?.toISOString() ?? "",
    until: entry.until,
    releasedAt: entry.releasedAt?.toISOString() ?? "",
    releasedBy: entry.releasedBy ?? "",
    releaseNote: entry.releaseNote ?? "",
    status: blackStatus(entry, today),
    history: (entry.history ?? []).map((item) => ({
      at: item.at?.toISOString() ?? "",
      action: item.action,
      by: item.by ?? "",
      note: item.note ?? "",
    })),
  };
}

export function cautionOf(entry: BlackConsumerRecord): CautionView {
  return { id: String(entry._id), name: entry.name ?? "", reasons: entry.reasons ?? [], until: entry.until };
}

const FIELD_ERRORS: Record<string, string> = {
  reasons: "사유를 하나 이상 골라 주세요.",
  detail: "무슨 일이 있었는지 1,000자 안으로 적어 주세요.",
  registeredBy: "처리하는 사람 이름을 적어 주세요.",
  by: "처리하는 사람 이름을 적어 주세요.",
  note: "해제 사유를 200자 안으로 적어 주세요.",
  criteria: "운영 기준은 2,000자 안으로 적어 주세요.",
};

// 입력 검사에 걸린 첫 칸을 상담원이 고칠 수 있는 말로
export function blackInputError(error: ZodError) {
  const field = String(error.issues[0]?.path[0] ?? "");
  return FIELD_ERRORS[field] ?? "입력한 내용을 확인해 주세요.";
}

export async function getBlackSettings(): Promise<BlackSettings> {
  await connectDB();
  const doc = await BlackConsumerSetting.findById("default").lean<{ criteria?: string; defaultMonths?: number } | null>();
  return {
    criteria: doc?.criteria ?? "",
    defaultMonths: isRetentionMonths(doc?.defaultMonths) ? doc.defaultMonths : DEFAULT_RETENTION_MONTHS,
  };
}

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

type CautionKeys = { phones?: string[]; memberIds?: string[]; talkUsers?: string[] };

// 번호·회원 ID·톡톡 고객 중 하나라도 같은, 지금 주의 중인 블랙컨슈머(최근 등록 순)
export async function findCurrentEntries({ phones = [], memberIds = [], talkUsers = [] }: CautionKeys) {
  const or: Array<Record<string, unknown>> = [];
  const phoneList = unique(phones.map(phoneDigits)).filter(isPhoneDigits);
  const memberList = unique(memberIds.map((id) => id.trim()));
  const talkList = unique(talkUsers);
  if (phoneList.length) or.push({ phone: { $in: phoneList } });
  if (memberList.length) or.push({ memberId: { $in: memberList } });
  if (talkList.length) or.push({ talkUser: { $in: talkList } });
  if (!or.length) return [];
  await connectDB();
  return BlackConsumer.find({ ...currentFilter(), $or: or }).sort({ createdAt: -1 }).lean<BlackConsumerRecord[]>();
}

function matchEntry(entries: BlackConsumerRecord[], keys: { phones: string[]; memberId?: string; talkUser?: string }) {
  const phones = keys.phones.map(phoneDigits).filter(isPhoneDigits);
  return entries.find(
    (entry) =>
      (entry.phone && phones.includes(entry.phone)) ||
      (entry.memberId && keys.memberId && entry.memberId === keys.memberId) ||
      (entry.talkUser && keys.talkUser && entry.talkUser === keys.talkUser),
  );
}

// 상담마다 주의 표시 — 문의 접수 휴대폰·로그인 회원·톡톡 고객으로 맞춘다. 표시용이라 실패해도 상담 목록은 그대로 보낸다.
export async function chatCautions(chats: LiveChatRecord[]) {
  const result: Record<string, CautionView> = {};
  try {
    const entries = await findCurrentEntries({
      phones: chats.map((chat) => chat.contact?.phone ?? ""),
      memberIds: chats.map((chat) => chat.memberId ?? ""),
      talkUsers: chats.map((chat) => chat.talk?.user ?? ""),
    });
    if (!entries.length) return result;
    for (const chat of chats) {
      const hit = matchEntry(entries, { phones: [chat.contact?.phone ?? ""], memberId: chat.memberId, talkUser: chat.talk?.user });
      if (hit) result[String(chat._id)] = cautionOf(hit);
    }
  } catch (error) {
    console.warn("[black-consumer] 상담 주의 표시를 확인하지 못했어요", error);
  }
  return result;
}

// 녹취마다 주의 표시 — 통화 번호와 분석에서 나온 고객 연락처로 맞춘다.
export async function callCautions(calls: VoiceCallRecord[]) {
  const result: Record<string, CautionView> = {};
  try {
    const phonesOf = (call: VoiceCallRecord) => [call.phoneNumber ?? "", call.analysis?.customerPhone ?? ""];
    const entries = await findCurrentEntries({ phones: calls.flatMap(phonesOf) });
    if (!entries.length) return result;
    for (const call of calls) {
      const hit = matchEntry(entries, { phones: phonesOf(call) });
      if (hit) result[String(call._id)] = cautionOf(hit);
    }
  } catch (error) {
    console.warn("[black-consumer] 녹취 주의 표시를 확인하지 못했어요", error);
  }
  return result;
}
