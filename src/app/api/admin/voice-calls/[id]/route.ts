import { unlink } from "node:fs/promises";
import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { runVoiceAnalysis, serializeVoiceCall, type VoiceCallRecord } from "@/lib/voiceCall";
import { VoiceCall } from "@/models/VoiceCall";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

async function findCall(id: string) {
  if (!isValidObjectId(id)) return null;
  return VoiceCall.findById(id);
}

export async function GET(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const { id } = await params;
  const call = await VoiceCall.findById(isValidObjectId(id) ? id : undefined).lean<VoiceCallRecord | null>();
  if (!call) return NextResponse.json({ error: "녹취를 찾을 수 없어요." }, { status: 404 });
  return NextResponse.json({ call: serializeVoiceCall(call) });
}

// 전사 텍스트 수정·다시 분석.
export async function PATCH(request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const { id } = await params;
  const call = await findCall(id);
  if (!call) return NextResponse.json({ error: "녹취를 찾을 수 없어요." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { transcript?: string; reanalyze?: boolean };
  if (typeof body.transcript === "string" && body.transcript.trim()) {
    call.transcript = body.transcript.trim();
  }
  if (!call.transcript) return NextResponse.json({ error: "분석할 녹취 텍스트가 없어요." }, { status: 400 });

  try {
    call.analysis = await runVoiceAnalysis(call.transcript, {
      phoneNumber: call.phoneNumber,
      callDate: call.callDate ?? undefined,
    });
    call.status = "done";
    call.error = "";
  } catch (error) {
    call.status = "failed";
    call.error = error instanceof Error ? error.message : "분석에 실패했어요.";
  }
  await call.save();

  const saved = await VoiceCall.findById(call._id).lean<VoiceCallRecord>();
  return NextResponse.json(
    { call: saved ? serializeVoiceCall(saved) : null },
    { status: saved?.status === "failed" ? 502 : 200 },
  );
}

export async function DELETE(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const { id } = await params;
  const call = await findCall(id);
  if (!call) return NextResponse.json({ error: "녹취를 찾을 수 없어요." }, { status: 404 });

  // 베타 로컬 파일만 지운다 — 드롭박스 원본은 녹음 보관(3년) 대상이라 그대로 둔다.
  if (call.audioPath) {
    try {
      await unlink(call.audioPath);
    } catch {
      // 파일이 이미 없어도 기록 삭제는 계속한다.
    }
  }
  await VoiceCall.deleteOne({ _id: call._id });
  return NextResponse.json({ ok: true });
}
