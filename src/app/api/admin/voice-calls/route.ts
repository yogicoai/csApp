import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { downloadFile, isDropboxConfigured, isVoicePath } from "@/lib/dropbox";
import {
  parseRecordingFileName,
  runVoiceAnalysis,
  serializeVoiceCall,
  sttFileProblem,
  transcribeAudio,
  type VoiceCallRecord,
} from "@/lib/voiceCall";
import { VoiceCall } from "@/models/VoiceCall";

// 전사(최대 수 분) + 분석이 한 요청에서 돌므로 넉넉히 잡는다.
export const maxDuration = 300;

// 음성 원본 보관 — 드롭박스가 연결돼 있으면 브라우저가 드롭박스 녹음 폴더에 바로 올리고(upload-link),
// 여기서는 그 파일을 받아 전사·분석만 한다(앱에는 분석 자료와 원본 경로만).
// 연결이 없으면(베타) 프로젝트 옆 로컬 폴더에 둔다(.gitignore 대상, 쓰기 불가 서버에서는 저장 없이 분석만).
const VOICE_DIR = path.join(process.cwd(), ".voice-uploads");

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 녹취 찾기 — 번호·이름·내용으로 검색한다(최근 100건). storage: 녹음을 어디에 두는지(화면의 올리기 방식).
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  const filter = q
    ? {
        $or: [
          { phoneNumber: { $regex: escapeRegex(q.replace(/[-\s]/g, "")) } },
          { fileName: { $regex: escapeRegex(q), $options: "i" } },
          { transcript: { $regex: escapeRegex(q), $options: "i" } },
          { "analysis.summary": { $regex: escapeRegex(q), $options: "i" } },
          { "analysis.customerName": { $regex: escapeRegex(q), $options: "i" } },
          { "analysis.category": { $regex: escapeRegex(q), $options: "i" } },
        ],
      }
    : {};

  const calls = await VoiceCall.find(filter).sort({ createdAt: -1 }).limit(100).lean<VoiceCallRecord[]>();
  return NextResponse.json({
    calls: calls.map((call) => serializeVoiceCall(call, { withTranscript: false })),
    storage: isDropboxConfigured() ? "dropbox" : "local",
  });
}

type Upload = {
  fileName: string;
  mimeType: string;
  file: File | null; // 이 요청으로 올린 파일(로컬 보관 방식)
  dropboxPath: string; // 드롭박스에 이미 올린 녹음
  pastedTranscript: string;
  inputPhone: string;
  inputDate: string;
  durationHint: number;
};

function positiveSeconds(value: unknown) {
  const seconds = Math.round(Number(value ?? 0));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

// 요청 읽기 — JSON 이면 드롭박스에 올린 녹음, 폼이면 파일·녹취 텍스트를 직접 받은 것.
async function readUpload(request: Request): Promise<Upload | { error: string; status: number }> {
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const dropboxPath = typeof body?.dropboxPath === "string" ? body.dropboxPath : "";
    if (!isDropboxConfigured()) return { error: "드롭박스 연결 설정이 없어요.", status: 409 };
    if (!isVoicePath(dropboxPath)) return { error: "녹음 폴더의 파일이 아니에요.", status: 400 };
    return {
      fileName: String(body?.fileName ?? "").slice(0, 200) || dropboxPath.split("/").pop() || "",
      mimeType: String(body?.mimeType ?? "").slice(0, 100),
      file: null,
      dropboxPath,
      pastedTranscript: "",
      inputPhone: String(body?.phoneNumber ?? "").trim(),
      inputDate: String(body?.callDate ?? "").trim(),
      durationHint: positiveSeconds(body?.durationSec),
    };
  }
  const form = await request.formData().catch(() => null);
  if (!form) return { error: "업로드 형식이 올바르지 않아요.", status: 400 };
  const file = form.get("file");
  const picked = file instanceof File && file.size > 0 ? file : null;
  return {
    fileName: picked?.name ?? "",
    mimeType: picked?.type ?? "",
    file: picked,
    dropboxPath: "",
    pastedTranscript: String(form.get("transcript") ?? "").trim(),
    inputPhone: String(form.get("phoneNumber") ?? "").trim(),
    inputDate: String(form.get("callDate") ?? "").trim(),
    // 브라우저가 잰 녹음 길이(초) — gpt-4o 계열 전사 응답에는 길이가 없다.
    durationHint: positiveSeconds(form.get("durationSec")),
  };
}

// 녹취 등록 — 음성 파일(전사+분석) 또는 녹취 텍스트(분석만).
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const upload = await readUpload(request);
  if ("error" in upload) return NextResponse.json({ error: upload.error }, { status: upload.status });
  const { fileName, file, dropboxPath, pastedTranscript, durationHint } = upload;

  const hasAudio = Boolean(file || dropboxPath);
  if (!hasAudio && !pastedTranscript) {
    return NextResponse.json({ error: "음성 파일을 올리거나 녹취 텍스트를 붙여넣어 주세요." }, { status: 400 });
  }
  if (file && file.size > 60 * 1024 * 1024) {
    return NextResponse.json({ error: "60MB 이하 파일만 올릴 수 있어요." }, { status: 400 });
  }
  if (file && !pastedTranscript) {
    const problem = sttFileProblem(file.name, file.size);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const guessed = parseRecordingFileName(fileName);
  const callDate = upload.inputDate ? new Date(upload.inputDate) : guessed.callDate;
  const phoneNumber = (upload.inputPhone || guessed.phoneNumber || "").replace(/[-\s]/g, "");

  const call = await VoiceCall.create({
    fileName,
    mimeType: upload.mimeType,
    callDate: callDate && !Number.isNaN(callDate.getTime()) ? callDate : undefined,
    phoneNumber,
    transcript: pastedTranscript,
    dropboxPath,
    status: "pending",
  });

  try {
    let transcript = pastedTranscript;

    if (hasAudio) {
      let buffer: Buffer;
      if (dropboxPath) {
        buffer = await downloadFile(dropboxPath);
        const problem = sttFileProblem(fileName, buffer.byteLength);
        if (problem) throw new Error(problem);
      } else {
        buffer = Buffer.from(await file!.arrayBuffer());
        // 파일 보관은 실패해도 전사·분석은 계속한다(서버리스 등 쓰기 불가 환경).
        try {
          await mkdir(VOICE_DIR, { recursive: true });
          const safeName = `${call._id}-${fileName.replace(/[^\w.가-힣-]/g, "_")}`;
          const audioPath = path.join(VOICE_DIR, safeName);
          await writeFile(audioPath, buffer);
          call.audioPath = audioPath;
        } catch {
          call.audioPath = "";
        }
      }

      call.durationSec = durationHint;
      if (!transcript) {
        const stt = await transcribeAudio(buffer, fileName, upload.mimeType, { durationSec: durationHint });
        transcript = stt.text;
        if (stt.durationSec) call.durationSec = stt.durationSec;
      }
    }

    if (!transcript) throw new Error("전사 결과가 비어 있어요. 녹음 상태를 확인해 주세요.");
    call.transcript = transcript;

    call.analysis = await runVoiceAnalysis(transcript, {
      phoneNumber: call.phoneNumber,
      callDate: call.callDate ?? undefined,
    });
    if (!call.phoneNumber && call.analysis.customerPhone) {
      call.phoneNumber = call.analysis.customerPhone.replace(/[-\s]/g, "");
    }
    call.status = "done";
    call.error = "";
  } catch (error) {
    call.status = "failed";
    call.error = error instanceof Error ? error.message : "처리에 실패했어요.";
  }

  await call.save();
  const saved = await VoiceCall.findById(call._id).lean<VoiceCallRecord>();
  return NextResponse.json(
    { call: saved ? serializeVoiceCall(saved) : null },
    { status: saved?.status === "failed" ? 502 : 201 },
  );
}
