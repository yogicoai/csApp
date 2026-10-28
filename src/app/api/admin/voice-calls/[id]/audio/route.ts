import { readFile } from "node:fs/promises";
import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { recordAccessOnce } from "@/lib/accessLogServer";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { isDropboxConfigured, isVoicePath, temporaryLink } from "@/lib/dropbox";
import { phoneDigits } from "@/lib/phone";
import type { VoiceCallRecord } from "@/lib/voiceCall";
import { VoiceCall } from "@/models/VoiceCall";

type Params = { params: Promise<{ id: string }> };

// 같은 로그인에서 같은 녹취를 이 시간 안에 다시 받으면(앞뒤로 넘겨 듣기 등) 조회 기록을 한 줄만 남긴다.
const PLAY_LOG_WINDOW_MS = 10 * 60 * 1000;

function playLog(call: VoiceCallRecord) {
  const when = call.callDate ? new Date(call.callDate.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "일시 미상";
  return recordAccessOnce(
    {
      action: "play",
      target: call.phoneNumber || phoneDigits(call.analysis?.customerPhone),
      detail: `녹취 ${when} · ${call.fileName || String(call._id)}`,
    },
    PLAY_LOG_WINDOW_MS,
  );
}

// 보관 중인 녹음 파일 재생용 — 드롭박스 원본은 몇 시간짜리 임시 재생 주소로 넘기고, 베타 로컬 파일은 그대로 흘려준다.
// 재생(내려받기 포함)은 조회 기록에 남긴다.
export async function GET(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const { id } = await params;
  const call = await VoiceCall.findById(isValidObjectId(id) ? id : undefined).lean<VoiceCallRecord | null>();
  if (call?.dropboxPath && isVoicePath(call.dropboxPath)) {
    if (!isDropboxConfigured()) return NextResponse.json({ error: "드롭박스 연결 설정이 없어 재생할 수 없어요." }, { status: 409 });
    let link: string;
    try {
      link = await temporaryLink(call.dropboxPath);
    } catch {
      return NextResponse.json({ error: "드롭박스에서 원본을 찾지 못했어요(옮기거나 지웠을 수 있어요)." }, { status: 404 });
    }
    await playLog(call);
    return NextResponse.redirect(link, { headers: { "Cache-Control": "no-store" } });
  }
  if (!call?.audioPath) return NextResponse.json({ error: "보관된 음성 파일이 없어요." }, { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await readFile(call.audioPath);
  } catch {
    return NextResponse.json({ error: "음성 파일을 읽지 못했어요(로컬 보관 파일이 삭제됐을 수 있어요)." }, { status: 404 });
  }
  await playLog(call);
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return new Response(bytes, {
    headers: {
      "Content-Type": call.mimeType || "audio/mpeg",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
