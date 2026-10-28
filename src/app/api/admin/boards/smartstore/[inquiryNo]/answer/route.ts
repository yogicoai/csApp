import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { claimBoardAnswer, finishBoardAnswer, logBoardEdit, readAnswerId, readAnswerText } from "@/lib/boardAnswerLog";
import { BOARD_ANSWER_MAX } from "@/lib/boards";
import { answerSmartstoreInquiry, editSmartstoreAnswer, isOnlineDataConfigured, OnlineDataError } from "@/lib/onlineData";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ inquiryNo: string }> };

// 게시판 관리 · 스마트스토어 고객문의 답변 등록 — 고객에게 바로 보이는 글이라 화면에서 확인을 거친 뒤에만 부른다.
//   body: { content, date } (date = 문의한 날 YYYY-MM-DD — onlineData 가 그날 목록에서 다시 찾아 이미 답변됐으면 409)
export async function POST(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isOnlineDataConfigured()) {
    return NextResponse.json({ error: "onlineData 연결 설정(ONLINEDATA_MCP_TOKEN)이 없어 답변을 등록할 수 없어요." }, { status: 503 });
  }
  const inquiryNo = Number((await context.params).inquiryNo);
  if (!Number.isInteger(inquiryNo) || inquiryNo <= 0) {
    return NextResponse.json({ error: "문의 번호가 잘못됐어요." }, { status: 404 });
  }
  const body = (await request.clone().json().catch(() => null)) as { date?: unknown } | null;
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "";
  const content = await readAnswerText(request);
  if (!content) return NextResponse.json({ error: `답변 내용을 1~${BOARD_ANSWER_MAX}자로 적어 주세요.` }, { status: 400 });
  if (!date) return NextResponse.json({ error: "문의한 날짜가 필요해요. 목록을 새로고침해 주세요." }, { status: 400 });

  const key = `smartstore:${inquiryNo}`;
  const attemptId = await claimBoardAnswer(key, "smartstore", content);
  if (!attemptId) {
    return NextResponse.json({ error: "다른 창에서 이 문의에 답변을 등록하고 있어요. 잠시 후 새로고침해 주세요." }, { status: 409 });
  }
  try {
    const result = await answerSmartstoreInquiry(inquiryNo, content, date);
    await finishBoardAnswer(attemptId, { remoteId: result.replyId });
    return NextResponse.json({ post: result.post ?? null });
  } catch (error) {
    await finishBoardAnswer(attemptId, { error: error instanceof Error ? error.message : "등록 실패" }).catch(() => {});
    if (error instanceof OnlineDataError) {
      return NextResponse.json({ error: error.message, post: error.post ?? null }, { status: error.status });
    }
    console.warn(`[boards] 스마트스토어 답변 등록 실패 ${key}`, error);
    return NextResponse.json({ error: "스마트스토어 답변 등록에 실패했어요." }, { status: 502 });
  }
}

// 등록된 답변 고치기 — body { answerId(답변 번호), content, date }
export async function PUT(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isOnlineDataConfigured()) {
    return NextResponse.json({ error: "onlineData 연결 설정(ONLINEDATA_MCP_TOKEN)이 없어 답변을 고칠 수 없어요." }, { status: 503 });
  }
  const inquiryNo = Number((await context.params).inquiryNo);
  if (!Number.isInteger(inquiryNo) || inquiryNo <= 0) {
    return NextResponse.json({ error: "문의 번호가 잘못됐어요." }, { status: 404 });
  }
  const body = (await request.clone().json().catch(() => null)) as { date?: unknown } | null;
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "";
  const answerId = await readAnswerId(request);
  const content = await readAnswerText(request);
  if (!answerId) return NextResponse.json({ error: "고칠 답변이 정해지지 않았어요. 목록을 새로고침해 주세요." }, { status: 400 });
  if (!content) return NextResponse.json({ error: `답변 내용을 1~${BOARD_ANSWER_MAX}자로 적어 주세요.` }, { status: 400 });
  if (!date) return NextResponse.json({ error: "문의한 날짜가 필요해요. 목록을 새로고침해 주세요." }, { status: 400 });

  const key = `smartstore:${inquiryNo}`;
  try {
    const result = await editSmartstoreAnswer(inquiryNo, answerId, content, date);
    await logBoardEdit(key, "smartstore", content, { remoteId: result.replyId }).catch(() => {});
    return NextResponse.json({ post: result.post ?? null });
  } catch (error) {
    await logBoardEdit(key, "smartstore", content, { error: error instanceof Error ? error.message : "고치기 실패" }).catch(() => {});
    if (error instanceof OnlineDataError) {
      return NextResponse.json({ error: error.message, post: error.post ?? null }, { status: error.status });
    }
    console.warn(`[boards] 스마트스토어 답변 고치기 실패 ${key}`, error);
    return NextResponse.json({ error: "스마트스토어 답변을 고치지 못했어요." }, { status: 502 });
  }
}
