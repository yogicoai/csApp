import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { adminView, findChatById } from "@/lib/liveChat";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatBlock } from "@/models/LiveChatBlock";
import { LiveChatMessage } from "@/models/LiveChatMessage";

type RouteContext = { params: Promise<{ id: string }> };

// 휴지통에서 복구 — 상담과 메시지의 삭제 표시(TTL 대상)를 지우고, 스팸 삭제로 만든 차단도 푼다.
export async function POST(_request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;

  const chat = await findChatById(id);
  if (!chat) return NextResponse.json({ error: "상담을 찾을 수 없습니다. 이미 영구 삭제되었을 수 있어요." }, { status: 404 });
  if (!chat.deletedAt) return NextResponse.json({ chat: adminView(chat) });

  await Promise.all([
    LiveChat.updateOne({ _id: chat._id }, { $unset: { deletedAt: 1 }, $set: { deleteReason: "" } }),
    LiveChatMessage.updateMany({ chatId: chat._id }, { $unset: { deletedAt: 1 } }),
    LiveChatBlock.deleteMany({ chatId: chat._id }),
  ]);

  const restored = await findChatById(id);
  return NextResponse.json({ chat: restored ? adminView(restored) : adminView(chat) });
}
