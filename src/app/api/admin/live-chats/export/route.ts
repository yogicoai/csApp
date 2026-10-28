import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { NOT_DELETED, type LiveChatRecord } from "@/lib/liveChat";
import { isDayString, kstDayRange } from "@/lib/liveChatHours";
import { outcomeLabel, purchasePlaceLabel, viaLabel } from "@/lib/liveChatOptions";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatMessage } from "@/models/LiveChatMessage";

export const maxDuration = 60;

const MAX_ROWS = 2000;

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function kstStamp(date?: Date) {
  if (!date) return "";
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

// 상담 기록 CSV 내보내기 — ?from=YYYY-MM-DD&to=YYYY-MM-DD (KST 접수일 기준, 휴지통 제외).
// 엑셀에서 바로 열리도록 UTF-8 BOM 을 붙인다.
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!isDayString(from) || !isDayString(to) || from > to) {
    return NextResponse.json({ error: "기간(from·to)을 YYYY-MM-DD 로 넣어 주세요." }, { status: 400 });
  }

  const { start } = kstDayRange(from);
  const { end } = kstDayRange(to);
  const chats = await LiveChat.find({ ...NOT_DELETED, createdAt: { $gte: start, $lt: end } })
    .sort({ createdAt: 1 })
    .limit(MAX_ROWS)
    .lean<LiveChatRecord[]>();

  // 대화 전문 — 상담별로 "고객/상담원/안내: 내용" 줄로 합친다.
  const messages = await LiveChatMessage.find({ chatId: { $in: chats.map((chat) => chat._id) } })
    .sort({ chatId: 1, seq: 1 })
    .lean<Array<{ chatId: unknown; sender: string; text: string }>>();
  const SENDER_LABEL: Record<string, string> = { visitor: "고객", agent: "상담원", system: "안내" };
  const byChat = new Map<string, string[]>();
  for (const message of messages) {
    const key = String(message.chatId);
    if (!byChat.has(key)) byChat.set(key, []);
    byChat.get(key)!.push(`${SENDER_LABEL[message.sender] ?? message.sender}: ${message.text}`);
  }

  const header = [
    "상담번호", "접수일시", "상태", "결과", "메모", "채널", "유입 경로", "구매처", "문의유형",
    "주문번호", "회원ID", "첫 응답(초)", "종료일시", "종료 주체", "메시지 수", "대화 내용",
  ];
  const rows = chats.map((chat) => {
    const firstResponseSec =
      chat.firstResponseAt && chat.createdAt
        ? Math.max(0, Math.round((chat.firstResponseAt.getTime() - chat.createdAt.getTime()) / 1000))
        : "";
    const lines = byChat.get(String(chat._id)) ?? [];
    return [
      chat.ticketNo ?? "",
      kstStamp(chat.createdAt),
      chat.status === "closed" ? "종료" : chat.status === "active" ? "상담중" : "대기",
      chat.status === "closed" ? outcomeLabel(chat.outcome?.result ?? "") : "",
      chat.outcome?.memo ?? "",
      chat.channel,
      viaLabel(chat.source?.via ?? ""),
      chat.intake?.purchasePlace ? purchasePlaceLabel(chat.intake.purchasePlace) : "",
      chat.intake?.inquiryType ?? "",
      chat.intake?.orderNumber ?? "",
      chat.memberId ?? "",
      firstResponseSec,
      kstStamp(chat.closedAt),
      chat.closedBy === "agent" ? "상담원" : chat.closedBy === "visitor" ? "고객" : "",
      lines.length,
      lines.join("\n"),
    ]
      .map(csvCell)
      .join(",");
  });

  const csv = "﻿" + [header.map(csvCell).join(","), ...rows].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="live-chats_${from}_${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
