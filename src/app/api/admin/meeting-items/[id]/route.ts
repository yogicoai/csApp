import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { meetingFields, type MeetingItemRecord, serializeMeetingItem } from "@/lib/meetingNotesServer";
import { MeetingItem } from "@/models/MeetingItem";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = { error: "회의 기록을 찾을 수 없어요." };
const patchSchema = z
  .object({
    question: meetingFields.question.optional(),
    why: meetingFields.why.optional(),
    target: meetingFields.target.optional(),
    status: meetingFields.status.optional(),
    answer: meetingFields.answer.optional(),
  })
  .refine((body) => Object.keys(body).length > 0);

// 확인할 것 고치기 — 상태·받은 답·내용
export async function PATCH(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidObjectId(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "입력한 내용을 확인해 주세요." }, { status: 400 });
  try {
    await connectDB();
    const doc = await MeetingItem.findByIdAndUpdate(id, { $set: parsed.data }, { returnDocument: "after" }).lean<MeetingItemRecord | null>();
    if (!doc) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ item: serializeMeetingItem(doc) });
  } catch {
    return NextResponse.json({ error: "저장하지 못했어요." }, { status: 503 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidObjectId(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  try {
    await connectDB();
    const doc = await MeetingItem.findByIdAndDelete(id);
    if (!doc) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "지우지 못했어요." }, { status: 503 });
  }
}
