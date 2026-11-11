import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { DropboxError, isDropboxConfigured, listFiles, VOICE_FOLDER } from "@/lib/dropbox";
import { sttFileProblem } from "@/lib/voiceCall";
import { VoiceCall } from "@/models/VoiceCall";

// 드롭박스 녹음 폴더에 쌓였지만 아직 분석하지 않은 녹음 — 화면에서 [진행]을 누르면 그 경로로 녹취 등록(전사·분석)을 부른다.
// 이 화면에서 올린 녹음과 이미 진행한 녹음은 기록(dropboxPath)이 있어 빠진다.
const AUDIO = /\.(mp3|m4a|wav|ogg|webm|flac|mp4|mpeg|mpga|amr|aac|wma|3gp)$/i;
const LIMIT = 200;

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isDropboxConfigured()) return NextResponse.json({ configured: false, folder: "", files: [], total: 0 });

  try {
    const files = (await listFiles(VOICE_FOLDER)).filter((file) => AUDIO.test(file.name));
    await connectDB();
    const registered = await VoiceCall.find({ dropboxPath: { $regex: `^${escapeRegex(VOICE_FOLDER)}/`, $options: "i" } })
      .select({ dropboxPath: 1 })
      .lean<Array<{ dropboxPath?: string }>>();
    const done = new Set(registered.map((call) => (call.dropboxPath ?? "").toLowerCase()));
    const pending = files
      .filter((file) => !done.has(file.path.toLowerCase()))
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return NextResponse.json({
      configured: true,
      folder: VOICE_FOLDER,
      total: pending.length,
      // 최근에 들어온 것부터. 전사할 수 없는 파일(.amr·25MB 초과)은 이유를 같이 준다.
      files: pending.slice(0, LIMIT).map((file) => ({ ...file, problem: sttFileProblem(file.name, file.size) })),
    });
  } catch (error) {
    console.warn("[voice] 녹음 폴더 보기 실패", error);
    const message = error instanceof DropboxError ? error.message : "드롭박스 녹음 폴더를 읽지 못했어요.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
