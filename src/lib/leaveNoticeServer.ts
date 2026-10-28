import QRCode from "qrcode";
import { connectDB } from "@/lib/db";
import {
  DEFAULT_LEAVE_NOTICE,
  isNoticeShowing,
  LEAD_DAYS_MAX,
  type LeaveDay,
  type LeaveNoticeSettings,
  type LeavePeriod,
  leavePeriods,
  noticeHtml,
  NOTES_MAX,
  resumeAt,
  SAMPLE_PERIOD_ID,
  samplePeriod,
} from "@/lib/leaveNotice";
import { kstToday, shiftDay } from "@/lib/liveChatHours";
import { LeaveNoticeSetting } from "@/models/LeaveNoticeSetting";
import { LiveChatClosure } from "@/models/LiveChatClosure";

// 홈페이지 휴무 팝업 — 서버 쪽(문구 설정·휴무 기간 읽기·QR·HTML). 계산 규칙은 lib/leaveNotice.

type SettingDoc = Partial<LeaveNoticeSettings> | null;

// 저장된 문구에 빈 값이 있으면 기본 문구로 채운다(QR 주소는 비우면 QR 없이).
export function mergeNoticeSettings(doc: SettingDoc): LeaveNoticeSettings {
  const fallback = DEFAULT_LEAVE_NOTICE;
  return {
    leadDays:
      typeof doc?.leadDays === "number" ? Math.min(LEAD_DAYS_MAX, Math.max(0, Math.round(doc.leadDays))) : fallback.leadDays,
    title: doc?.title?.trim() || fallback.title,
    body: doc?.body?.trim() || fallback.body,
    resumePrefix: doc?.resumePrefix?.trim() || fallback.resumePrefix,
    notes: Array.isArray(doc?.notes)
      ? doc.notes.slice(0, NOTES_MAX).map((note) => ({ text: String(note.text ?? ""), highlight: Boolean(note.highlight) }))
      : fallback.notes,
    qrUrl: typeof doc?.qrUrl === "string" ? doc.qrUrl.trim() : fallback.qrUrl,
  };
}

export async function getNoticeSettings() {
  await connectDB();
  return mergeNoticeSettings(await LeaveNoticeSetting.findById("default").lean<SettingDoc>());
}

// 아직 끝나지 않은(상담이 다시 열리기 전) 휴무 기간 — 진행 중인 기간이 며칠 전부터 이어졌을 수 있어 조금 앞부터 읽는다.
export async function openPeriods(settings: LeaveNoticeSettings, now = new Date()) {
  await connectDB();
  const today = kstToday();
  const docs = await LiveChatClosure.find({ date: { $gte: shiftDay(today, -31), $lte: shiftDay(today, 120) } })
    .select({ date: 1, type: 1, popup: 1 })
    .lean<Array<{ date: string; type?: string; popup?: boolean }>>();
  const days: LeaveDay[] = docs.map((doc) => ({
    date: doc.date,
    type: doc.type === "am" || doc.type === "pm" ? doc.type : "full",
    popup: doc.popup !== false,
  }));
  return leavePeriods(days, settings.leadDays).filter((period) => resumeAt(period) > now);
}

// 화면·이미지가 고른 휴무 기간 — SAMPLE_PERIOD_ID 는 예정된 휴무가 없을 때의 예시
export async function findNoticePeriod(settings: LeaveNoticeSettings, id: string) {
  if (id === SAMPLE_PERIOD_ID) return samplePeriod(settings.leadDays, kstToday());
  return (await openPeriods(settings)).find((period) => period.id === id) ?? null;
}

export async function noticeQrSvg(url: string) {
  return url ? QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : "";
}

export async function buildNoticeHtml(period: LeavePeriod, settings: LeaveNoticeSettings) {
  return noticeHtml(period, settings, await noticeQrSvg(settings.qrUrl));
}

// 지금 홈페이지에 띄울 팝업 — 노출 중인 기간 가운데 가장 이른 것 하나
export async function currentLeaveNotice(now = new Date()) {
  const settings = await getNoticeSettings();
  const period = (await openPeriods(settings, now)).find((item) => isNoticeShowing(item, now));
  if (!period) return null;
  return { period, html: await buildNoticeHtml(period, settings) };
}
