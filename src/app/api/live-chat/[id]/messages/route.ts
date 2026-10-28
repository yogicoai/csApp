import { NextResponse } from "next/server";
import { z } from "zod";
import { appendMessage, findVisitorChat, LIVE_CHAT_MAX_TEXT } from "@/lib/liveChat";

type RouteContext = { params: Promise<{ id: string }> };

const messageSchema = z.object({ text: z.string().trim().min(1).max(LIVE_CHAT_MAX_TEXT) });

// 고객 메시지 전송
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "메시지를 확인해 주세요." }, { status: 400 });

  const chat = await findVisitorChat(request, id).catch(() => null);
  if (!chat) return NextResponse.json({ error: "상담 내역을 찾을 수 없어요." }, { status: 404 });
  if (chat.status === "closed") {
    return NextResponse.json({ error: "종료된 상담이에요. 새 상담을 시작해 주세요." }, { status: 409 });
  }

  const result = await appendMessage(chat._id, "visitor", parsed.data.text);
  if (!result) return NextResponse.json({ error: "상담 내역을 찾을 수 없어요." }, { status: 404 });
  return NextResponse.json({ message: result.message }, { status: 201 });
}
