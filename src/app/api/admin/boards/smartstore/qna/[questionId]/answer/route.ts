import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { claimBoardAnswer, finishBoardAnswer, logBoardEdit, readAnswerText } from "@/lib/boardAnswerLog";
import { BOARD_ANSWER_MAX } from "@/lib/boards";
import { isOnlineDataConfigured, OnlineDataError, saveSmartstoreQna } from "@/lib/onlineData";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ questionId: string }> };

// 게시판 관리 · 스마트스토어 상품문의 — POST 답변 등록 · PUT 등록된 답변 고치기. body: { content, date }
//   상품 페이지 Q&A 라 고객에게 바로 보인다(화면에서 확인을 거친 뒤에만 부른다). 등록·고치기 모두 같은 네이버 API 를 쓴다.
async function readRequest(request: Request, context: RouteContext) {
  const questionId = Number((await context.params).questionId);
  const body = (await request.clone().json().catch(() => null)) as { date?: unknown } | null;
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "";
  const content = await readAnswerText(request);
  if (!Number.isInteger(questionId) || questionId <= 0) return { error: NextResponse.json({ error: "문의 번호가 잘못됐어요." }, { status: 404 }) };
  if (!content) return { error: NextResponse.json({ error: `답변 내용을 1~${BOARD_ANSWER_MAX}자로 적어 주세요.` }, { status: 400 }) };
  if (!date) return { error: NextResponse.json({ error: "문의한 날짜가 필요해요. 목록을 새로고침해 주세요." }, { status: 400 }) };
  return { questionId, content, date };
}

// verb: "등록하지" · "고치지"
function failure(error: unknown, verb: string) {
  if (error instanceof OnlineDataError) {
    return NextResponse.json({ error: error.message, post: error.post ?? null }, { status: error.status });
  }
  console.warn(`[boards] 스마트스토어 상품문의 답변 실패(${verb})`, error);
  return NextResponse.json({ error: `스마트스토어 상품문의 답변을 ${verb} 못했어요.` }, { status: 502 });
}

export async function POST(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isOnlineDataConfigured()) {
    return NextResponse.json({ error: "onlineData 연결 설정(ONLINEDATA_MCP_TOKEN)이 없어 답변을 등록할 수 없어요." }, { status: 503 });
  }
  const parsed = await readRequest(request, context);
  if ("error" in parsed) return parsed.error;
  const key = `smartstore:qna:${parsed.questionId}`;
  const attemptId = await claimBoardAnswer(key, "smartstore", parsed.content);
  if (!attemptId) {
    return NextResponse.json({ error: "다른 창에서 이 문의에 답변을 등록하고 있어요. 잠시 후 새로고침해 주세요." }, { status: 409 });
  }
  try {
    const result = await saveSmartstoreQna(parsed.questionId, parsed.content, parsed.date, "answer");
    await finishBoardAnswer(attemptId, { remoteId: result.replyId });
    return NextResponse.json({ post: result.post ?? null });
  } catch (error) {
    await finishBoardAnswer(attemptId, { error: error instanceof Error ? error.message : "등록 실패" }).catch(() => {});
    return failure(error, "등록하지");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isOnlineDataConfigured()) {
    return NextResponse.json({ error: "onlineData 연결 설정(ONLINEDATA_MCP_TOKEN)이 없어 답변을 고칠 수 없어요." }, { status: 503 });
  }
  const parsed = await readRequest(request, context);
  if ("error" in parsed) return parsed.error;
  const key = `smartstore:qna:${parsed.questionId}`;
  try {
    const result = await saveSmartstoreQna(parsed.questionId, parsed.content, parsed.date, "edit");
    await logBoardEdit(key, "smartstore", parsed.content, { remoteId: result.replyId }).catch(() => {});
    return NextResponse.json({ post: result.post ?? null });
  } catch (error) {
    await logBoardEdit(key, "smartstore", parsed.content, { error: error instanceof Error ? error.message : "고치기 실패" }).catch(() => {});
    return failure(error, "고치지");
  }
}
