import { NextResponse } from "next/server";
import { z } from "zod";
import {
  appendMessage,
  findVisitorChat,
  getMessagesAfter,
  LIVE_CHAT_MESSAGES,
  parseAfter,
  visitorView,
} from "@/lib/liveChat";
import { LiveChat } from "@/models/LiveChat";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = { error: "상담 내역을 찾을 수 없어요." };

// 고객 화면 폴링 — after 이후의 새 메시지와 대화방 상태를 돌려준다.
// 폴링 시각을 남겨 어드민에서 고객이 아직 화면을 보고 있는지 표시한다.
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const chat = await findVisitorChat(request, id).catch(() => null);
  if (!chat) return NextResponse.json(NOT_FOUND, { status: 404 });

  await LiveChat.updateOne({ _id: chat._id }, { $set: { visitorSeenAt: new Date() } });
  const messages = await getMessagesAfter(chat._id, parseAfter(request));
  return NextResponse.json({ chat: visitorView(chat), messages });
}

const patchSchema = z.object({ status: z.literal("closed") });

// 고객이 직접 상담 종료
export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });

  const chat = await findVisitorChat(request, id).catch(() => null);
  if (!chat) return NextResponse.json(NOT_FOUND, { status: 404 });

  // 중복 요청이 와도 종료 안내는 한 번만 남도록 아직 열려 있을 때만 전환한다.
  const closed = await LiveChat.updateOne(
    { _id: chat._id, status: { $ne: "closed" } },
    { $set: { status: "closed", closedAt: new Date(), closedBy: "visitor" } },
  );
  if (closed.modifiedCount) {
    await appendMessage(chat._id, "system", LIVE_CHAT_MESSAGES.closedByVisitor);
  }
  return NextResponse.json({ chat: { ...visitorView(chat), status: "closed" } });
}
