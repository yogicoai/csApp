import { NextResponse } from "next/server";
import { todayClosureState, upcomingOpenLabel } from "@/lib/liveChatClosures";
import { isLiveChatOpen } from "@/lib/liveChatHours";

// 고객용 상담 가능 상태 — 운영시간 + 오늘 상담사 휴가(연차·반차) 상태.
//   closure: null(휴가 없음) | { type, closedNow, hoursLabel, nextOpenLabel, message }
//   nextOpenLabel: 지금 닫혀 있으면(운영시간 외·휴무) 다음에 답변을 시작하는 때, 열려 있으면 ""
export async function GET() {
  const hoursOpen = isLiveChatOpen();
  let closure = null;
  let nextOpenLabel = "";
  try {
    closure = await todayClosureState();
    if (!hoursOpen || closure?.closedNow) nextOpenLabel = await upcomingOpenLabel();
  } catch {
    // 상태 조회가 실패해도 채팅 자체는 운영시간 기준으로 동작한다.
  }
  return NextResponse.json({ hoursOpen, closure, nextOpenLabel }, { headers: { "Cache-Control": "no-store" } });
}
