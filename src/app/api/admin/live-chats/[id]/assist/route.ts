import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { findChatById, getMessagesAfter } from "@/lib/liveChat";
import {
  assistFailureMessage,
  buildAssistContext,
  chatOrderContext,
  isAssistConfigured,
  runAssist,
  splitAssistAnswer,
} from "@/lib/liveChatAssist";

type RouteContext = { params: Promise<{ id: string }> };

// Sonnet 은 사고 시간 때문에 수 초~수십 초 걸리고, 주문 조회를 하면 한 번 더 부르므로 실행 한도를 넉넉히 요청한다.
export const maxDuration = 120;

const assistSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("draft") }),
  z.object({ mode: z.literal("ask"), question: z.string().trim().min(2).max(500) }),
]);

// 상담 도움 AI — 답변 초안(draft) 또는 상담원 질문(ask). 결과는 상담원 화면에만 보여준다.
export async function POST(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  const parsed = assistSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "질문을 확인해 주세요." }, { status: 400 });
  if (!isAssistConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY 가 설정되지 않아 AI 상담 도우미를 쓸 수 없습니다." }, { status: 503 });
  }

  const chat = await findChatById(id);
  if (!chat) return NextResponse.json({ error: "상담을 찾을 수 없습니다." }, { status: 404 });

  const payload = parsed.data;
  const question = payload.mode === "ask" ? payload.question : "";

  try {
    const messages = await getMessagesAfter(chat._id, 0);
    const { context: assistContext, sources } = await buildAssistContext(chat, messages, question);
    const { answer, orders } = await runAssist(payload.mode, assistContext, question, chatOrderContext(chat, messages, question));
    if (!answer) return NextResponse.json({ error: "AI 답변이 비어 있습니다. 다시 시도해 주세요." }, { status: 502 });
    const { internal, customerText } = splitAssistAnswer(payload.mode, answer);
    return NextResponse.json({ mode: payload.mode, internal, customerText, sources, orders });
  } catch (error) {
    return NextResponse.json({ error: assistFailureMessage(error) }, { status: 502 });
  }
}
