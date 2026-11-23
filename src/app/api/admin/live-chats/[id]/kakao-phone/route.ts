import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { KakaoSendError, requestKakaoPhone } from "@/lib/kakaoTalk";
import { adminView, findChatById } from "@/lib/liveChat";
import { KAKAO_VIA } from "@/lib/liveChatOptions";

type RouteContext = { params: Promise<{ id: string }> };

// 카카오 상담톡 — 고객에게 전화번호 제공 동의(카카오 개인정보 제공 동의 말풍선)를 요청한다.
// 고객이 동의하면 웹훅으로 번호가 와서 상담에 남는다(lib/kakaoTalk). 상담 세션당 한 번.
export async function POST(_request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;

  const chat = await findChatById(id);
  if (!chat || chat.deletedAt) return NextResponse.json({ error: "상담을 찾을 수 없습니다." }, { status: 404 });
  if (chat.source?.via !== KAKAO_VIA) return NextResponse.json({ error: "카카오 상담에서만 요청할 수 있어요." }, { status: 400 });
  if (chat.status === "closed") return NextResponse.json({ error: "종료된 상담이에요. 고객이 다시 메시지를 보내면 요청할 수 있어요." }, { status: 409 });

  try {
    const result = await requestKakaoPhone(chat);
    if (!result) return NextResponse.json({ error: "상담을 찾을 수 없습니다." }, { status: 404 });
    const updated = await findChatById(id);
    return NextResponse.json({ message: result.message, chat: adminView(updated ?? result.chat) });
  } catch (error) {
    if (error instanceof KakaoSendError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
