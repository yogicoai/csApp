import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import {
  DEFAULT_LEAVE_NOTICE,
  isNoticeShowing,
  LEAD_DAYS_MAX,
  type LeavePeriod,
  noticeHtml,
  NOTES_MAX,
  resumeAt,
  samplePeriod,
} from "@/lib/leaveNotice";
import { getNoticeSettings, mergeNoticeSettings, noticeQrSvg, openPeriods } from "@/lib/leaveNoticeServer";
import { kstToday } from "@/lib/liveChatHours";
import { LeaveNoticeSetting } from "@/models/LeaveNoticeSetting";

// 연차 관리 '홈페이지 휴무 팝업' — 문구 설정 + 끝나지 않은 휴무 기간별 미리보기(HTML)와 지금 노출 중인지.
// 예정된 휴무가 없으면 예시 기간(sample)을 같이 줘서 화면이 어떤 모습으로 뜨는지 보여 준다.
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const settings = await getNoticeSettings();
    const [periods, qrSvg] = await Promise.all([openPeriods(settings), noticeQrSvg(settings.qrUrl)]);
    const view = (period: LeavePeriod, showing: boolean) => ({
      ...period,
      showing,
      until: resumeAt(period).toISOString(),
      html: noticeHtml(period, settings, qrSvg),
    });
    return NextResponse.json({
      settings,
      defaults: DEFAULT_LEAVE_NOTICE,
      periods: periods.map((period) => view(period, isNoticeShowing(period))),
      sample: periods.length ? null : view(samplePeriod(settings.leadDays, kstToday()), false),
    });
  } catch {
    return NextResponse.json({ error: "휴무 팝업 정보를 불러오지 못했어요." }, { status: 503 });
  }
}

const settingsSchema = z.object({
  leadDays: z.number().int().min(0).max(LEAD_DAYS_MAX),
  title: z.string().trim().max(60),
  body: z.string().trim().max(600),
  resumePrefix: z.string().trim().max(30),
  notes: z.array(z.object({ text: z.string().trim().max(200), highlight: z.boolean() })).max(NOTES_MAX),
  qrUrl: z.union([z.literal(""), z.string().trim().max(300).regex(/^https?:\/\/[^\s<>"']+$/)]),
});

// 문구 저장 — 비운 칸은 기본 문구로 돌아간다(QR 주소는 비우면 QR 없이).
export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "문구를 확인해 주세요(QR 주소는 https:// 로 시작)." }, { status: 400 });
  await connectDB();
  const saved = await LeaveNoticeSetting.findOneAndUpdate(
    { _id: "default" },
    { $set: { ...parsed.data, notes: parsed.data.notes.filter((note) => note.text) } },
    { upsert: true, returnDocument: "after" },
  ).lean();
  return NextResponse.json({ settings: mergeNoticeSettings(saved as Parameters<typeof mergeNoticeSettings>[0]) });
}
