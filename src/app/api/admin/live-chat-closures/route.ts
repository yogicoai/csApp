import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { NOT_DELETED } from "@/lib/liveChat";
import { isDayString, isWeekend, kstDayRange, kstToday, shiftDay } from "@/lib/liveChatHours";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatClosure } from "@/models/LiveChatClosure";

// CS 연차 관리 — 연차(종일)·오전반차(14:00부터)·오후반차(13:00까지) 시간에는 고객 화면의 실시간 채팅상담이 닫힌다.

type ClosureDoc = { date: string; type?: string };

function serialize(doc: ClosureDoc) {
  return { date: doc.date, type: doc.type === "am" || doc.type === "pm" ? doc.type : "full" };
}

const MAX_RANGE_DAYS = 62;

function daysBetween(from: string, to: string) {
  const days: string[] = [];
  for (let day = from; day <= to && days.length <= MAX_RANGE_DAYS; day = shiftDay(day, 1)) days.push(day);
  return days;
}

//  - ?from=YYYY-MM-DD&to=YYYY-MM-DD : 그 기간의 연차일(지난 날 포함) + 날짜별 접수 상담 수(달력용)
//  - 파라미터 없음 : 오늘 포함 앞으로의 연차일
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const today = kstToday();

  if (isDayString(from) && isDayString(to) && from <= to && daysBetween(from, to).length <= MAX_RANGE_DAYS) {
    const [docs, counts] = await Promise.all([
      LiveChatClosure.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean<ClosureDoc[]>(),
      LiveChat.aggregate<{ _id: string; n: number }>([
        { $match: { ...NOT_DELETED, createdAt: { $gte: kstDayRange(from).start, $lt: kstDayRange(to).end } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+09:00" } },
            n: { $sum: 1 },
          },
        },
      ]),
    ]);
    const chatCounts: Record<string, number> = {};
    for (const row of counts) chatCounts[row._id] = row.n;
    return NextResponse.json({ today, closures: docs.map(serialize), chatCounts });
  }

  const docs = await LiveChatClosure.find({ date: { $gte: today } }).sort({ date: 1 }).limit(60).lean<ClosureDoc[]>();
  return NextResponse.json({ today, closures: docs.map(serialize) });
}

const closureSchema = z
  .object({
    date: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    skipWeekends: z.boolean().optional(),
    type: z.enum(["full", "am", "pm"]).optional(),
  })
  .refine((value) => Boolean(value.date) || Boolean(value.from && value.to), { message: "날짜를 골라 주세요." });

// 연차·반차 지정 — 하루(date) 또는 여러 날(from~to, 주말 제외 선택). 같은 날을 다시 지정하면 종류(type)를 바꾼다.
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const parsed = closureSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "입력값을 확인해 주세요." }, { status: 400 });
  const body = parsed.data;
  const today = kstToday();

  const from = body.date ?? body.from ?? "";
  const to = body.date ?? body.to ?? "";
  if (!isDayString(from) || !isDayString(to) || from > to) {
    return NextResponse.json({ error: "날짜를 YYYY-MM-DD 로 넣어 주세요." }, { status: 400 });
  }
  if (from < today) return NextResponse.json({ error: "지난 날짜는 연차로 지정할 수 없어요." }, { status: 400 });

  const range = daysBetween(from, to);
  if (range.length > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `한 번에 ${MAX_RANGE_DAYS}일까지 지정할 수 있어요.` }, { status: 400 });
  }
  const targets = body.skipWeekends ? range.filter((day) => !isWeekend(day)) : range;
  if (!targets.length) return NextResponse.json({ error: "지정할 평일이 없어요." }, { status: 400 });

  const type = body.type ?? "full";
  await LiveChatClosure.bulkWrite(
    targets.map((date) => ({ updateOne: { filter: { date }, update: { $set: { type } }, upsert: true } })),
  );
  const closures = targets.map((date) => ({ date, type }));
  return NextResponse.json({ closure: closures[0], closures, count: closures.length }, { status: 201 });
}

const popupSchema = z.object({ dates: z.array(z.string()).min(1).max(MAX_RANGE_DAYS), popup: z.boolean() });

// 홈페이지 휴무 팝업 켜기·끄기 — 연차 관리의 휴무 기간 카드에서 그 기간 날짜를 한 번에 바꾼다.
export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const parsed = popupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.dates.every(isDayString)) {
    return NextResponse.json({ error: "날짜를 확인해 주세요." }, { status: 400 });
  }
  await connectDB();
  const result = await LiveChatClosure.updateMany({ date: { $in: parsed.data.dates } }, { $set: { popup: parsed.data.popup } });
  return NextResponse.json({ ok: true, count: result.matchedCount });
}

// 연차 해제 — ?date=YYYY-MM-DD
export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!isDayString(date)) return NextResponse.json({ error: "날짜가 올바르지 않아요." }, { status: 400 });
  await LiveChatClosure.deleteOne({ date });
  return NextResponse.json({ ok: true });
}
