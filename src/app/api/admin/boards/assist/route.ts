import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import type { BoardPost } from "@/lib/boards";
import {
  assistFailureMessage,
  boardOrderContext,
  buildBoardAssistContext,
  isAssistConfigured,
  runAssist,
  splitAssistAnswer,
} from "@/lib/liveChatAssist";

// 실시간 상담 AI 도우미와 같은 모델·근거(FAQ·응대 사례)·주문 조회를 쓴다.
export const maxDuration = 120;

// 화면이 보고 있는 글을 그대로 받는다(관리자만 부르는 경로 — 다시 불러오면 cafe24·네이버를 한 번 더 부르게 된다).
const postSchema = z.object({
  key: z.string().max(80),
  folder: z.enum(["homepage", "smartstore"]),
  kind: z.enum(["qna", "inquiry"]).optional(),
  boardNo: z.number().int().optional(),
  title: z.string().max(500),
  content: z.string().max(20_000),
  createdAt: z.string().max(40),
  writer: z.string().max(100),
  memberId: z.string().max(40).optional(),
  secret: z.boolean().optional(),
  category: z.string().max(100).optional(),
  productName: z.string().max(300).optional(),
  productOption: z.string().max(300).optional(),
  orderId: z.string().max(60).optional(),
  answered: z.boolean(),
  answers: z
    .array(z.object({ id: z.string().max(40), content: z.string().max(5000), createdAt: z.string().max(40), writer: z.string().max(100) }))
    .max(10),
});

const assistSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("draft"), post: postSchema }),
  z.object({ mode: z.literal("ask"), question: z.string().trim().min(2).max(500), post: postSchema }),
]);

// 게시판 관리 AI 도우미 — 글 하나에 대한 답변 초안(draft) 또는 상담원 질문(ask). 결과는 상담원 화면에만 보인다.
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const parsed = assistSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "글 정보나 질문을 확인해 주세요." }, { status: 400 });
  if (!isAssistConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY 가 설정되지 않아 AI 상담 도우미를 쓸 수 없습니다." }, { status: 503 });
  }

  const payload = parsed.data;
  const question = payload.mode === "ask" ? payload.question : "";
  const post = payload.post as BoardPost;
  try {
    const { context, sources } = await buildBoardAssistContext(post, question);
    const { answer, orders } = await runAssist(payload.mode, context, question, boardOrderContext(post, question), "board");
    if (!answer) return NextResponse.json({ error: "AI 답변이 비어 있습니다. 다시 시도해 주세요." }, { status: 502 });
    const { internal, customerText } = splitAssistAnswer(payload.mode, answer);
    return NextResponse.json({ mode: payload.mode, internal, customerText, sources, orders });
  } catch (error) {
    return NextResponse.json({ error: assistFailureMessage(error) }, { status: 502 });
  }
}
