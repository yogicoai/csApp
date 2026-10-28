import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { addMonths, BLACK_REASON_KEYS, ENDING_SOON_DAYS, isRetentionMonths } from "@/lib/blackConsumer";
import {
  blackInputError,
  type BlackConsumerRecord,
  currentFilter,
  endedFilter,
  findCurrentEntries,
  getBlackSettings,
  serializeBlackConsumer,
} from "@/lib/blackConsumerServer";
import { connectDB } from "@/lib/db";
import { findChatById } from "@/lib/liveChat";
import { kstToday, shiftDay } from "@/lib/liveChatHours";
import { TALK_VIA } from "@/lib/liveChatOptions";
import { isPhoneDigits, phoneDigits } from "@/lib/phone";
import { BlackConsumer } from "@/models/BlackConsumer";

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function endingFilter(today: string) {
  return { releasedAt: null, until: { $gte: today, $lte: shiftDay(today, ENDING_SOON_DAYS) } };
}

// 블랙컨슈머 목록 — status: current(주의 중, 기본) · ending(곧 끝남) · ended(기간 끝·해제) · all
//  q: 번호·이름·회원 ID·내용·관련 기록으로 찾기. 운영 기준(settings)과 탭별 건수를 같이 준다.
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? "current";
  const q = (params.get("q") ?? "").trim().slice(0, 50);
  const today = kstToday();
  const statusFilter =
    status === "ended" ? endedFilter(today) : status === "ending" ? endingFilter(today) : status === "all" ? {} : currentFilter(today);
  const digits = phoneDigits(q);
  const text = { $regex: escapeRegex(q), $options: "i" };
  const searchFilter = q
    ? {
        $or: [
          ...(digits.length >= 4 ? [{ phone: { $regex: escapeRegex(digits) } }] : []),
          { name: text },
          { memberId: text },
          { detail: text },
          { refs: text },
          { talkTicket: text },
        ],
      }
    : {};

  try {
    await connectDB();
    const [entries, current, ending, ended, settings] = await Promise.all([
      BlackConsumer.find({ $and: [statusFilter, searchFilter] }).sort({ createdAt: -1 }).limit(300).lean<BlackConsumerRecord[]>(),
      BlackConsumer.countDocuments(currentFilter(today)),
      BlackConsumer.countDocuments(endingFilter(today)),
      BlackConsumer.countDocuments(endedFilter(today)),
      getBlackSettings(),
    ]);
    return NextResponse.json({
      entries: entries.map((entry) => serializeBlackConsumer(entry, today)),
      counts: { current, ending, ended },
      settings,
    });
  } catch {
    return NextResponse.json({ error: "블랙컨슈머 목록을 불러오지 못했어요." }, { status: 503 });
  }
}

const createSchema = z.object({
  phone: z.string().trim().max(40).default(""),
  memberId: z.string().trim().max(60).default(""),
  // 상담 화면에서 등록 — 서버가 그 상담의 네이버 톡톡 고객(식별값은 화면에 없음)·문의 접수 휴대폰·회원 ID 를 붙인다.
  chatId: z.string().trim().max(40).default(""),
  name: z.string().trim().max(40).default(""),
  reasons: z.array(z.enum(BLACK_REASON_KEYS)).min(1).max(BLACK_REASON_KEYS.length),
  detail: z.string().trim().min(1).max(1000),
  refs: z.string().trim().max(200).default(""),
  registeredBy: z.string().trim().min(1).max(20),
  months: z.number().int().optional(),
});

// 블랙컨슈머 등록 — 번호·회원 ID·톡톡 고객 중 하나는 있어야 하고, 같은 고객이 이미 주의 중이면 409(그 등록을 고친다).
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: blackInputError(parsed.error) }, { status: 400 });
  const data = parsed.data;

  let phone = phoneDigits(data.phone);
  if (data.phone && !isPhoneDigits(phone)) return NextResponse.json({ error: "전화번호를 확인해 주세요." }, { status: 400 });
  let memberId = data.memberId;
  let talkUser = "";
  let talkTicket = "";
  try {
    if (data.chatId) {
      const chat = await findChatById(data.chatId);
      if (!chat) return NextResponse.json({ error: "상담을 찾을 수 없어요." }, { status: 404 });
      if (chat.source?.via === TALK_VIA && chat.talk?.user) {
        talkUser = chat.talk.user;
        talkTicket = chat.ticketNo ?? "";
      }
      const chatPhone = phoneDigits(chat.contact?.phone);
      if (!phone && isPhoneDigits(chatPhone)) phone = chatPhone;
      if (!memberId && chat.memberId) memberId = chat.memberId;
    }
    if (!phone && !memberId && !talkUser) {
      return NextResponse.json({ error: "전화번호나 회원 ID 중 하나는 적어 주세요." }, { status: 400 });
    }

    const [existing] = await findCurrentEntries({ phones: [phone], memberIds: [memberId], talkUsers: [talkUser] });
    if (existing) {
      return NextResponse.json({ error: "이미 주의 중인 고객이에요. 그 등록을 고쳐 주세요.", id: String(existing._id) }, { status: 409 });
    }

    const settings = await getBlackSettings();
    const months = isRetentionMonths(data.months) ? data.months : settings.defaultMonths;
    const doc = await BlackConsumer.create({
      phone,
      memberId,
      talkUser,
      talkTicket,
      name: data.name,
      reasons: data.reasons,
      detail: data.detail,
      refs: data.refs,
      registeredBy: data.registeredBy,
      until: addMonths(kstToday(), months),
      history: [{ action: "register", by: data.registeredBy, note: `${months}개월` }],
    });
    return NextResponse.json({ entry: serializeBlackConsumer(doc.toObject() as BlackConsumerRecord) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "블랙컨슈머를 등록하지 못했어요." }, { status: 503 });
  }
}
