import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { DEFAULT_MEETING_ITEMS } from "@/lib/meetingNotes";
import { meetingFields, type MeetingItemRecord, serializeMeetingItem } from "@/lib/meetingNotesServer";
import { MeetingItem } from "@/models/MeetingItem";

// 처음 한 번만 기본 확인 목록을 넣는다(다 지워도 다시 생기지 않게 표시를 남긴다).
async function seedOnce() {
  const marks = MeetingItem.db.collection("meetingsettings");
  if (await marks.findOne({ _id: "seeded" as never })) return;
  if ((await MeetingItem.countDocuments()) === 0) await MeetingItem.insertMany(DEFAULT_MEETING_ITEMS);
  await marks.updateOne({ _id: "seeded" as never }, { $set: { at: new Date() } }, { upsert: true });
}

// 회의 기록 — 확인할 것 목록(먼저 넣은 순서)
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    await connectDB();
    await seedOnce();
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
