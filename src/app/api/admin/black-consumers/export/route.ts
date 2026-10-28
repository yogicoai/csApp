import { NextResponse } from "next/server";
import { recordAccess } from "@/lib/accessLogServer";
import { requireAdmin } from "@/lib/adminAuth";
import { reasonLabel } from "@/lib/blackConsumer";
import { type BlackConsumerRecord, currentFilter } from "@/lib/blackConsumerServer";
import { connectDB } from "@/lib/db";
import { kstToday } from "@/lib/liveChatHours";
import { formatPhone } from "@/lib/phone";
import { BlackConsumer } from "@/models/BlackConsumer";

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// U+ 통화매니저 주소록에 올릴 파일(CSV, 엑셀로 열림) — 지금 주의 중이고 전화번호가 있는 고객만.
// 전화가 오면 통화매니저가 주소록 이름·메모를 띄우므로 이름 앞에 [블랙]을 붙이고 메모에 사유·기간만 적는다(자세한 내용은 콘솔에서).
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    await connectDB();
    const today = kstToday();
    const entries = await BlackConsumer.find({ ...currentFilter(today), phone: { $ne: "" } })
      .sort({ createdAt: -1 })
      .lean<BlackConsumerRecord[]>();
    const rows = [
      ["이름", "휴대폰", "메모"],
      ...entries.map((entry) => [
        `[블랙] ${entry.name || "고객"}`,
        formatPhone(entry.phone ?? ""),
        `주의 고객 · ${(entry.reasons ?? []).map(reasonLabel).join("/")} · ${entry.until}까지`,
      ]),
    ];
    // 개인정보를 파일로 내보내므로 조회 기록에 남긴 뒤에만 준다.
    await recordAccess({ action: "export", detail: `블랙컨슈머 주소록 파일 · ${entries.length}명` });
    // 엑셀이 한글을 깨뜨리지 않게 UTF-8 BOM 을 붙인다.
    const csv = `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="black-consumers-${today}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "주소록 파일을 만들지 못했어요." }, { status: 503 });
  }
}
