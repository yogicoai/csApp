import { NextResponse } from "next/server";
import { resumeAt } from "@/lib/leaveNotice";
import { currentLeaveNotice } from "@/lib/leaveNoticeServer";

// 홈페이지(cafe24) 휴무 팝업 — public/leave-notice.js 가 다른 도메인에서 부르므로 누구나 읽게 둔다(공개 공지라 비밀 없음).
// 노출 기간이 아니면 notice: null. 1분 캐시.
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60, s-maxage=60",
};

export async function GET() {
  try {
    const notice = await currentLeaveNotice();
    return NextResponse.json(
      { notice: notice ? { id: notice.period.id, html: notice.html, until: resumeAt(notice.period).toISOString() } : null },
      { headers: HEADERS },
    );
  } catch {
    return NextResponse.json({ notice: null }, { status: 503, headers: HEADERS });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
