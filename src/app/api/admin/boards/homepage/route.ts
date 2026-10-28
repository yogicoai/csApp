import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { boardRange } from "@/lib/boardAnswerLog";
import { HOMEPAGE_BOARDS, homepageBoard } from "@/lib/boards";
import { isCafe24Configured } from "@/lib/cafe24/api";
import { describeCafe24Error, listHomepagePosts } from "@/lib/cafe24/boards";

export const maxDuration = 60;

// 게시판 관리 · 홈페이지 — 게시판 하나의 기간 안 글과 답글. ?board=6&days=30
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isCafe24Configured()) {
    return NextResponse.json({ error: "cafe24 연결 설정(CAFE24_MALLID)이 없어 홈페이지 게시판을 불러올 수 없어요." }, { status: 503 });
  }
  const url = new URL(request.url);
  const board = homepageBoard(Number(url.searchParams.get("board"))) ?? HOMEPAGE_BOARDS[0];
  const { days, from, to } = boardRange(url.searchParams.get("days"));
  try {
    const posts = await listHomepagePosts(board.no, from, to);
    return NextResponse.json({ board: board.no, days, from, to, posts });
  } catch (error) {
    console.warn(`[boards] 홈페이지 게시판 불러오기 실패 board=${board.no}`, error);
    return NextResponse.json({ error: describeCafe24Error(error, "read") }, { status: 502 });
  }
}
