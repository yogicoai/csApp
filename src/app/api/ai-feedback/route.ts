import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { isRequestBlocked } from "@/lib/ipBlock";
import { maskPersonalInfo } from "@/lib/pii";
import { EventLog } from "@/models/EventLog";

// 'AI에게 바로 질문하기' 답변 👍/👎 — 👎 는 어드민 상담 지표의 'AI 답변 보강 필요' 목록으로 모인다.
const aiFeedbackSchema = z.object({
  channel: z.string().min(1).max(40),
  sessionId: z.string().max(120).optional(),
  query: z.string().min(1).max(500),
  helpful: z.boolean(),
  status: z.enum(["answered", "answered_handoff", "needs_handoff"]).optional(),
  answer: z.string().max(4000).optional(),
  sourceIds: z.array(z.string().max(40)).max(5).optional(),
});

export async function POST(request: Request) {
  // 차단 IP(회사 IP 등)는 통계 기록에서 제외
  if (isRequestBlocked(request)) {
    return NextResponse.json({ skipped: true, reason: "blocked_ip" }, { status: 200 });
  }

  const parsed = aiFeedbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid feedback" }, { status: 400 });
  const payload = parsed.data;

  try {
    await connectDB();
    await EventLog.create({
      channel: payload.channel,
      sessionId: payload.sessionId ?? "",
      eventType: payload.helpful ? "ai_feedback_positive" : "ai_feedback_negative",
      query: maskPersonalInfo(payload.query),
      metadata: {
        status: payload.status ?? "",
        // 보강할 때 무엇이 아쉬웠는지 보도록 답변도 남긴다(길면 자름)
        answer: maskPersonalInfo((payload.answer ?? "").slice(0, 800)),
        sourceIds: payload.sourceIds ?? [],
      },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ queued: false, reason: "database_not_configured" }, { status: 202 });
  }
}
