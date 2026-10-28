import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { NOT_DELETED, type LiveChatRecord } from "@/lib/liveChat";
import { isDayString, kstDayRange, kstToday, shiftDay } from "@/lib/liveChatHours";
import { purchasePlaceLabel, viaLabel } from "@/lib/liveChatOptions";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatMessage } from "@/models/LiveChatMessage";
import { VoiceCall } from "@/models/VoiceCall";

function countBy<T>(items: T[], pick: (item: T) => string) {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = pick(item) || "미지정";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

// 기간 리포트 — 기본 최근 7일(KST). 실시간 상담 + 음성 상담 분석을 한 번에 요약한다.
// (TWC 대체 계획의 "주간 리포트: 처리 건수·자주 묻는 질문 주간 정리")
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const params = new URL(request.url).searchParams;
  const to = isDayString(params.get("to") ?? "") ? (params.get("to") as string) : kstToday();
  const from = isDayString(params.get("from") ?? "") ? (params.get("from") as string) : shiftDay(to, -6);
  if (from > to) return NextResponse.json({ error: "기간이 올바르지 않아요." }, { status: 400 });

  const { start } = kstDayRange(from);
  const { end } = kstDayRange(to);
  const range = { createdAt: { $gte: start, $lt: end } };

  const chats = await LiveChat.find({ ...NOT_DELETED, ...range })
    .sort({ createdAt: 1 })
    .limit(3000)
    .lean<LiveChatRecord[]>();

  const closed = chats.filter((chat) => chat.status === "closed");
  const outcomes = {
    resolved: closed.filter((chat) => chat.outcome?.result === "resolved").length,
    follow_up: closed.filter((chat) => chat.outcome?.result === "follow_up").length,
    handed_off: closed.filter((chat) => chat.outcome?.result === "handed_off").length,
    unresolved: closed.filter((chat) => chat.outcome?.result === "unresolved").length,
    unclassified: closed.filter((chat) => !chat.outcome?.result).length,
  };
  const responded = chats.filter((chat) => chat.firstResponseAt && chat.createdAt);
  const avgFirstResponseSec = responded.length
    ? Math.round(
        responded.reduce(
          (sum, chat) => sum + (chat.firstResponseAt!.getTime() - chat.createdAt!.getTime()) / 1000,
          0,
        ) / responded.length,
      )
    : 0;

  // 주요 문의 — 각 상담의 첫 고객 메시지(순번 1)
  const firstMessages = await LiveChatMessage.find({
    chatId: { $in: chats.map((chat) => chat._id) },
    seq: 1,
    sender: "visitor",
  })
    .sort({ createdAt: -1 })
    .limit(40)
    .lean<Array<{ text: string }>>();

  const voiceCalls = await VoiceCall.find({ ...range, status: "done" })
    .sort({ createdAt: 1 })
    .limit(1000)
    .lean<Array<{ analysis?: { category?: string } }>>();

  return NextResponse.json({
    from,
    to,
    chat: {
      total: chats.length,
      open: chats.length - closed.length,
      offHours: chats.filter((chat) => chat.offHours).length,
      outcomes,
      avgFirstResponseSec,
      byType: countBy(chats, (chat) => chat.intake?.inquiryType ?? ""),
      byPlace: countBy(chats, (chat) => (chat.intake?.purchasePlace ? purchasePlaceLabel(chat.intake.purchasePlace) : "")),
      byVia: countBy(chats, (chat) => (chat.source?.via ? viaLabel(chat.source.via) : "")),
      assetCount: chats.filter((chat) => chat.assetClaimId).length,
      questions: firstMessages.map((message) => message.text.slice(0, 80)),
    },
    voice: {
      total: voiceCalls.length,
      byCategory: countBy(voiceCalls, (call) => call.analysis?.category ?? ""),
    },
  });
}
