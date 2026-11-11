import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { DropboxError, isDropboxConfigured, isTwcTicketPath } from "@/lib/dropbox";
import { TwcSheetError } from "@/lib/twcTicketRows";
import { importTwcFile, twcFolderStatus } from "@/lib/twcTickets";

// 큰 연도 파일(약 1만 5천 건)도 한 번에 가져오도록 넉넉히.
export const maxDuration = 300;

// TWC 지난 티켓 — GET: 드롭박스 티켓 폴더의 엑셀과 파일별로 가져온 건수 / POST { path }: 엑셀 하나 가져오기.
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isDropboxConfigured()) return NextResponse.json({ configured: false, folder: "", total: 0, files: [] });
  try {
    return NextResponse.json({ configured: true, ...(await twcFolderStatus()) });
  } catch (error) {
    console.warn("[twc] 티켓 폴더 보기 실패", error);
    const message = error instanceof DropboxError ? error.message : "TWC 티켓 폴더를 읽지 못했어요.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isDropboxConfigured()) return NextResponse.json({ error: "드롭박스 연결 설정이 없어요." }, { status: 409 });

  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  if (!isTwcTicketPath(path)) return NextResponse.json({ error: "TWC 티켓 폴더의 엑셀이 아니에요." }, { status: 400 });

  try {
    return NextResponse.json({ result: await importTwcFile(path) });
  } catch (error) {
    console.warn("[twc] 티켓 가져오기 실패", path, error);
    if (error instanceof TwcSheetError) return NextResponse.json({ error: error.message }, { status: 422 });
    const message = error instanceof DropboxError ? error.message : "티켓을 가져오지 못했어요.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
