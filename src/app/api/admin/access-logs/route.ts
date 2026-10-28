import { NextResponse } from "next/server";
import { ACCESS_ACTIONS, ACCESS_LOG_PERIODS } from "@/lib/accessLog";
import { type AccessLogRecord, serializeAccessLog } from "@/lib/accessLogServer";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { AccessLog } from "@/models/AccessLog";

const LIMIT = 500;

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 조회 기록 — days: 최근 N일(1·7·30·90·365, 기본 30) · action: 한 일 · q: 고객 번호(4자리 이상 숫자)·처리하는 사람·내용
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const days = ACCESS_LOG_PERIODS.find((period) => String(period) === params.get("days")) ?? 30;
  const action = ACCESS_ACTIONS.some((item) => item.key === params.get("action")) ? params.get("action") : "";
  const q = (params.get("q") ?? "").trim().slice(0, 40);
  const digits = q.replace(/\D/g, "");
  const text = { $regex: escapeRegex(q), $options: "i" };
  const filter = {
    createdAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    ...(action ? { action } : {}),
    ...(q
      ? { $or: [...(digits.length >= 4 ? [{ target: { $regex: escapeRegex(digits) } }] : []), { operator: text }, { detail: text }, { ip: text }] }
      : {}),
  };
  try {
    await connectDB();
    const [logs, total] = await Promise.all([
      AccessLog.find(filter).sort({ createdAt: -1 }).limit(LIMIT).lean<AccessLogRecord[]>(),
      AccessLog.countDocuments(filter),
    ]);
    return NextResponse.json({ logs: logs.map(serializeAccessLog), total, limit: LIMIT, days });
  } catch {
    return NextResponse.json({ error: "조회 기록을 불러오지 못했어요." }, { status: 503 });
  }
}
