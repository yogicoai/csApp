import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { adminView, findChatById, NOT_DELETED, type LiveChatRecord } from "@/lib/liveChat";
import { LiveChat } from "@/models/LiveChat";

type RouteContext = { params: Promise<{ id: string }> };

// 같은 고객의 이전 상담 — 회원ID, 주문번호, 같은 브라우저 세션, 같은 톡톡 사용자 중 하나라도 같으면 같은 고객으로 본다(최근 10건).
export async function GET(_request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;

  const chat = await findChatById(id);
  if (!chat) return NextResponse.json({ error: "상담을 찾을 수 없습니다." }, { status: 404 });

  const sameCustomer: Array<Record<string, string>> = [];
  if (chat.memberId) sameCustomer.push({ memberId: chat.memberId });
  if (chat.intake?.orderNumber) sameCustomer.push({ "intake.orderNumber": chat.intake.orderNumber });
  if (chat.sessionId) sameCustomer.push({ sessionId: chat.sessionId });
  if (chat.talk?.user) sameCustomer.push({ "talk.user": chat.talk.user });
  if (sameCustomer.length === 0) {
    return NextResponse.json({ chats: [], reason: "회원ID·주문번호가 없어 같은 고객의 상담을 찾을 수 없어요." });
  }

  const related = await LiveChat.find({ _id: { $ne: chat._id }, $or: sameCustomer, ...NOT_DELETED })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean<LiveChatRecord[]>();
  return NextResponse.json({ chats: related.map(adminView) });
}
