import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { boardRange } from "@/lib/boardAnswerLog";
import { isOnlineDataConfigured, listSmartstoreInquiries, listSmartstoreQnas, OnlineDataError } from "@/lib/onlineData";

export const maxDuration = 60;

// 게시판 관리 · 스마트스토어 — 상품문의(kind=qna) 또는 고객문의(kind=inquiry, 기본)와 답변.
// 네이버는 허용 IP 에서만 불려 onlineData 를 거친다. ?kind=qna&days=30
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isOnlineDataConfigured()) {
    return NextResponse.json({ error: "onlineData 연결 설정(ONLINEDATA_MCP_TOKEN)이 없어 스마트스토어 문의를 불러올 수 없어요." }, { status: 503 });
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "qna" ? "qna" : "inquiry";
  const { days, from, to } = boardRange(url.searchParams.get("days"));
  try {
    const posts = kind === "qna" ? await listSmartstoreQnas(from, to) : await listSmartstoreInquiries(from, to);
    return NextResponse.json({ kind, days, from, to, posts });
  } catch (error) {
    console.warn(`[boards] 스마트스토어 ${kind} 불러오기 실패`, error);
    const message = error instanceof OnlineDataError ? error.message : "스마트스토어 문의를 불러오지 못했어요.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
