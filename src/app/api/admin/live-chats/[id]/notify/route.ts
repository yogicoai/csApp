import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { findChatById, type LiveChatRecord } from "@/lib/liveChat";
import { LiveChat } from "@/models/LiveChat";

type RouteContext = { params: Promise<{ id: string }> };

// 운영시간 외 문의 접수의 답변 안내 문자.
// 문자 발송 서비스가 붙기 전까지는 상담원이 이 문구를 통화매니저 등으로 직접 보내고, 보냈다고 표시한다.
//  GET  — 받는 번호와 문자 문구(고객이 어느 기기에서든 대화를 여는 링크 포함)
//  POST — 보낸 때 기록
async function findContactChat(context: RouteContext): Promise<LiveChatRecord | NextResponse> {
  const { id } = await context.params;
  const chat = await findChatById(id);
  if (!chat || chat.deletedAt) return NextResponse.json({ error: "상담을 찾을 수 없습니다." }, { status: 404 });
  if (!chat.contact?.phone) return NextResponse.json({ error: "답변 안내 연락처가 없는 상담이에요." }, { status: 404 });
  return chat;
}

export async function GET(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const chat = await findContactChat(context);
  if (chat instanceof NextResponse) return chat;

  // 링크의 대화 열쇠(id.token)는 그 대화만 열 수 있다 — 고객 브라우저가 받아 보관한 뒤 주소에서 지운다.
  const link = `${new URL(request.url).origin}/guide/${encodeURIComponent(chat.channel)}?chat=${chat._id}.${chat.visitorToken}`;
  const text = `[요기보 고객센터] 남겨 주신 문의(${chat.ticketNo})에 답변을 드렸어요. 아래 링크에서 확인해 주세요.\n${link}`;
  return NextResponse.json({
    phone: chat.contact?.phone ?? "",
    text,
    link,
    notifiedAt: chat.notifiedAt?.toISOString() ?? "",
  });
}

export async function POST(_request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const chat = await findContactChat(context);
  if (chat instanceof NextResponse) return chat;

  const notifiedAt = new Date();
  await LiveChat.updateOne({ _id: chat._id }, { $set: { notifiedAt } });
  return NextResponse.json({ notifiedAt: notifiedAt.toISOString() });
}
