import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { NOT_DELETED, type LiveChatRecord } from "@/lib/liveChat";
import { isDayString, kstDayRange, kstToday } from "@/lib/liveChatHours";
import { LiveChat } from "@/models/LiveChat";

// 콘솔 날짜 바의 일별 통계 — date(YYYY-MM-DD, KST, 기본 오늘)에 접수된 상담 기준.
// 평균 첫 응답은 운영시간 안에 접수된 상담만 센다(밤사이 접수 건이 평균을 왜곡하지 않게).
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const param = new URL(request.url).searchParams.get("date") ?? "";
  const day = isDayString(param) ? param : kstToday();
  const { start, end } = kstDayRange(day);

  try {
    await connectDB();
    // 휴지통 상담(테스트·스팸·중복)은 통계에서 뺀다.
    const chats = await LiveChat.find({ createdAt: { $gte: start, $lt: end }, ...NOT_DELETED })
      .select("status outcome offHours createdAt firstResponseAt")
      .lean<LiveChatRecord[]>();

    const count = (result: string) => chats.filter((chat) => chat.status === "closed" && chat.outcome?.result === result).length;
    const responded = chats.filter((chat) => chat.firstResponseAt && chat.createdAt && !chat.offHours);
    const avgFirstResponseSec = responded.length
      ? Math.round(
          responded.reduce((sum, chat) => sum + (chat.firstResponseAt!.getTime() - chat.createdAt!.getTime()), 0) /
            responded.length /
            1000,
        )
      : null;

    return NextResponse.json({
      date: day,
      total: chats.length,
      open: chats.filter((chat) => chat.status !== "closed").length,
      resolved: count("resolved"),
      followUp: count("follow_up"),
      handedOff: count("handed_off"),
      unresolved: count("unresolved"),
      unclassified: chats.filter((chat) => chat.status === "closed" && !chat.outcome?.result).length,
      offHours: chats.filter((chat) => chat.offHours).length,
      avgFirstResponseSec,
    });
  } catch {
    return NextResponse.json({ error: "일별 통계를 불러오지 못했습니다." }, { status: 503 });
  }
}
