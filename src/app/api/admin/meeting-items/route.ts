import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { DEFAULT_MEETING_ITEMS, FIRST_SEED_KEYS } from "@/lib/meetingNotes";
import { meetingFields, type MeetingItemRecord, serializeMeetingItem } from "@/lib/meetingNotesServer";
import { MeetingItem } from "@/models/MeetingItem";

// 기본 확인 목록은 항목마다 한 번만 넣는다 — 넣은 이름(key)을 표시해 두어, 지운 항목은 다시 생기지 않고
// 나중에 더한 기본 항목만 이미 목록이 있는 곳에도 들어간다(이름 없는 예전 표시는 처음 목록을 넣은 것으로 본다).
async function seedDefaults() {
  const marks = MeetingItem.db.collection<{ _id: string; keys?: string[] }>("meetingsettings");
  const mark = await marks.findOne({ _id: "seeded" });
  const seeded = new Set(mark ? (mark.keys ?? FIRST_SEED_KEYS) : []);
  const fresh = DEFAULT_MEETING_ITEMS.filter((item) => !seeded.has(item.key));
  if (!fresh.length && mark?.keys) return;
  if (fresh.length) {
    await MeetingItem.insertMany(
      fresh.map((item) => ({ question: item.question, why: item.why, target: item.target, status: item.status ?? "open", answer: item.answer ?? "" })),
    );
  }
  await marks.updateOne(
    { _id: "seeded" },
    { $set: { at: new Date() }, $addToSet: { keys: { $each: [...seeded, ...fresh.map((item) => item.key)] } } },
    { upsert: true },
  );
}

// 회의 기록 — 확인할 것 목록(먼저 넣은 순서)
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    await connectDB();
    await seedDefaults();
    const items = await MeetingItem.find({}).sort({ createdAt: 1 }).lean<MeetingItemRecord[]>();
    return NextResponse.json({ items: items.map(serializeMeetingItem) });
  } catch {
    return NextResponse.json({ error: "회의 기록을 불러오지 못했어요." }, { status: 503 });
  }
}

const createSchema = z.object({ question: meetingFields.question, why: meetingFields.why.default(""), target: meetingFields.target });

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "확인할 내용을 적어 주세요." }, { status: 400 });
  try {
    await connectDB();
    const doc = await MeetingItem.create(parsed.data);
    return NextResponse.json({ item: serializeMeetingItem(doc.toObject() as MeetingItemRecord) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "추가하지 못했어요." }, { status: 503 });
  }
}
