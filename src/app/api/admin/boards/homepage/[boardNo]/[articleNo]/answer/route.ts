import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import {
  claimBoardAnswer,
  finishBoardAnswer,
  logBoardEdit,
  readAnswerId,
  readAnswerText,
  writerIp,
} from "@/lib/boardAnswerLog";
import { BOARD_ANSWER_MAX, homepageBoard } from "@/lib/boards";
import { isCafe24Configured } from "@/lib/cafe24/api";
import { BoardError, describeCafe24Error, editHomepageReply, replyToHomepagePost } from "@/lib/cafe24/boards";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ boardNo: string; articleNo: string }> };

// 게시판 관리 · 홈페이지 답글 등록 — 고객에게 바로 보이는 글이라 화면에서 확인을 거친 뒤에만 부른다.
//   cafe24 에 답이 이미 있으면 409 · 같은 글을 다른 창에서 등록 중이면 409 · 아니면 답글 + 원글 '답변 완료'
export async function POST(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isCafe24Configured()) {
    return NextResponse.json({ error: "cafe24 연결 설정(CAFE24_MALLID)이 없어 답글을 달 수 없어요." }, { status: 503 });
  }
  const { boardNo, articleNo } = await context.params;
  const board = homepageBoard(Number(boardNo));
  const article = Number(articleNo);
  if (!board || !Number.isInteger(article) || article <= 0) {
    return NextResponse.json({ error: "관리하지 않는 게시판이거나 글 번호가 잘못됐어요." }, { status: 404 });
  }
  const content = await readAnswerText(request);
  if (!content) return NextResponse.json({ error: `답변 내용을 1~${BOARD_ANSWER_MAX}자로 적어 주세요.` }, { status: 400 });

  const key = `homepage:${board.no}:${article}`;
  const attempt: { id: string | null } = { id: null };
  try {
    // cafe24 에 답이 없는 걸 확인한 다음, 등록 직전에 자리를 잡는다.
    const result = await replyToHomepagePost(board.no, article, content, writerIp(request), async () => {
      attempt.id = await claimBoardAnswer(key, "homepage", content);
      if (!attempt.id) throw new BoardError("다른 창에서 이 글에 답변을 등록하고 있어요. 잠시 후 새로고침해 주세요.", 409);
    });
    if (attempt.id) await finishBoardAnswer(attempt.id, { remoteId: result.replyId });
    return NextResponse.json({ post: result.post });
  } catch (error) {
    if (attempt.id) {
      await finishBoardAnswer(attempt.id, { error: error instanceof Error ? error.message : "등록 실패" }).catch(() => {});
    }
    if (error instanceof BoardError) {
      return NextResponse.json({ error: error.message, post: error.post ?? null }, { status: error.status });
    }
    console.warn(`[boards] 홈페이지 답글 등록 실패 ${key}`, error);
    return NextResponse.json({ error: describeCafe24Error(error, "write") }, { status: 502 });
  }
}

// 등록된 답글 고치기 — body { answerId(답글 글 번호), content }. 서식 없는 직원 답글만 고칠 수 있다.
export async function PUT(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isCafe24Configured()) {
    return NextResponse.json({ error: "cafe24 연결 설정(CAFE24_MALLID)이 없어 답글을 고칠 수 없어요." }, { status: 503 });
  }
  const { boardNo, articleNo } = await context.params;
  const board = homepageBoard(Number(boardNo));
  const article = Number(articleNo);
  if (!board || !Number.isInteger(article) || article <= 0) {
    return NextResponse.json({ error: "관리하지 않는 게시판이거나 글 번호가 잘못됐어요." }, { status: 404 });
  }
  const replyNo = await readAnswerId(request);
  const content = await readAnswerText(request);
  if (!replyNo) return NextResponse.json({ error: "고칠 답글이 정해지지 않았어요. 목록을 새로고침해 주세요." }, { status: 400 });
  if (!content) return NextResponse.json({ error: `답변 내용을 1~${BOARD_ANSWER_MAX}자로 적어 주세요.` }, { status: 400 });

  const key = `homepage:${board.no}:${article}`;
  try {
    const result = await editHomepageReply(board.no, article, replyNo, content);
    await logBoardEdit(key, "homepage", content, { remoteId: result.replyId }).catch(() => {});
    return NextResponse.json({ post: result.post });
  } catch (error) {
    await logBoardEdit(key, "homepage", content, { error: error instanceof Error ? error.message : "고치기 실패" }).catch(() => {});
    if (error instanceof BoardError) {
      return NextResponse.json({ error: error.message, post: error.post ?? null }, { status: error.status });
    }
    console.warn(`[boards] 홈페이지 답글 고치기 실패 ${key}`, error);
    return NextResponse.json({ error: describeCafe24Error(error, "write") }, { status: 502 });
  }
}
