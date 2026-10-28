import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { DropboxError, freePath, isDropboxConfigured, temporaryUploadLink } from "@/lib/dropbox";
import { parseRecordingFileName, sttFileProblem, voiceDropboxPath } from "@/lib/voiceCall";

// 녹음 원본을 드롭박스에 바로 올릴 임시 주소 — 브라우저가 이 주소로 올린 뒤, 그 경로로 녹취 등록(POST /api/admin/voice-calls)을 부른다.
// 파일이 우리 서버를 거치지 않아 Vercel 요청 크기 제한(4.5MB)에 걸리지 않는다.
const schema = z.object({
  fileName: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
  phoneNumber: z.string().trim().max(20).optional(),
  callDate: z.string().trim().max(40).optional(),
});

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isDropboxConfigured()) return NextResponse.json({ error: "드롭박스 연결 설정이 없어요." }, { status: 409 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "파일 정보를 확인해 주세요." }, { status: 400 });
  const { fileName, size, phoneNumber, callDate } = parsed.data;
  const problem = sttFileProblem(fileName, size);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const guessed = parseRecordingFileName(fileName);
  const inputDate = callDate ? new Date(callDate) : undefined;
  const date = inputDate && !Number.isNaN(inputDate.getTime()) ? inputDate : guessed.callDate;
  const phone = (phoneNumber || guessed.phoneNumber || "").replace(/[-\s]/g, "");
  try {
    // 같은 녹음을 다시 올려도 앞 파일을 가리키지 않게 빈 이름을 정해서 그 경로로 받는다.
    const path = await freePath(voiceDropboxPath(fileName, date, phone));
    return NextResponse.json({ link: await temporaryUploadLink(path), path });
  } catch (error) {
    console.warn("[voice] 드롭박스 업로드 주소 실패", error);
    const message = error instanceof DropboxError ? error.message : "드롭박스 업로드 주소를 받지 못했어요.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
