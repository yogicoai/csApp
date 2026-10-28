import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { adminView, appendMessage, findChatById, LIVE_CHAT_MAX_TEXT } from "@/lib/liveChat";
import { TALK_VIA } from "@/lib/liveChatOptions";
import { isNaverTalkConfigured, replyByTalk, TalkSendError } from "@/lib/naverTalk";

type RouteContext = { params: Promise<{ id: string }> };

const messageSchema = z.object({ text: z.string().trim().min(1).max(LIVE_CHAT_MAX_TEXT) });

// 상담사 답변 — 대기 중이던 상담은 첫 답변과 함께 '상담중'으로 바뀐다.
export async function POST(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "메시지를 입력해 주세요." }, { status: 400 });

  const chat = await findChatById(id);
  if (!chat) return NextResponse.json({ error: "상담을 찾을 수 없습니다." }, { status: 404 });
  if (chat.status === "closed") {
    return NextResponse.json({ error: "종료된 상담입니다. 다시 열고 답변해 주세요." }, { status: 409 });
  }

  // 네이버 톡톡 상담 — 답변을 고객 톡톡으로 보낸다. 못 보낸 답변도 대화에 '못 보냄'으로 남겨 함께 돌려준다.
  if (chat.source?.via === TALK_VIA) {
    if (!isNaverTalkConfigured()) {
      return NextResponse.json({ error: "네이버 톡톡 연결 설정이 없어 답변을 보낼 수 없어요." }, { status: 409 });
    }
    try {
      const sent = await replyByTalk(chat, parsed.data.text);
      if (!sent) return NextResponse.json({ error: "상담을 찾을 수 없습니다." }, { status: 404 });
      if (!sent.ok) return NextResponse.json({ error: sent.error, message: sent.message }, { status: 502 });
      return NextResponse.json({ message: sent.message, chat: adminView(sent.chat) }, { status: 201 });
    } catch (error) {
      if (error instanceof TalkSendError) return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
  }

  const result = await appendMessage(chat._id, "agent", parsed.data.text, {
    status: "active",
    ...(chat.firstResponseAt ? {} : { firstResponseAt: new Date() }),
  });
  if (!result) return NextResponse.json({ error: "상담을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ message: result.message, chat: adminView(result.chat) }, { status: 201 });
}
