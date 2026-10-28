// 실시간 상담 운영시간 — 고객센터 운영시간(평일 10:00 ~ 17:30, KST)과 동일.
// 서버(자동 안내 멘트)와 고객 화면(운영 중 표시)에서 함께 쓰므로 DB 의존성 없이 둔다.
// 공휴일·상담사 휴무는 어드민 'CS 휴무 관리'에서 날짜로 지정한다(LiveChatClosure).
export const LIVE_CHAT_HOURS_LABEL = "평일 10:00 ~ 17:30";

const OPEN_MINUTES = 10 * 60;
const CLOSE_MINUTES = 17 * 60 + 30;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function isLiveChatOpen(now = new Date()) {
  // 한국은 서머타임이 없어 UTC+9 고정으로 계산해도 된다.
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = kstMinutes(now);
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES;
}

// 오늘 아직 운영시간 전인지(평일 10시 전) — 다음 상담 시작을 '오늘'로 안내할지 가를 때 쓴다.
export function beforeOpeningToday(now = new Date()) {
  return kstMinutes(now) < OPEN_MINUTES;
}

export function kstMinutes(now = new Date()) {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

// ── 날짜(KST) — 콘솔의 날짜 바·일별 통계·상담번호에서 쓴다. 날짜는 "YYYY-MM-DD" 문자열로 주고받는다.
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDayString(value: string) {
  return DAY_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function kstDateString(date: Date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function kstToday() {
  return kstDateString(new Date());
}

// KST 하루의 시작~끝(다음 날 0시 직전)을 UTC 시각으로
export function kstDayRange(day: string) {
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - KST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function shiftDay(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

// 0=일 … 6=토
export function weekdayOf(day: string) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function isWeekend(day: string) {
  const weekday = weekdayOf(day);
  return weekday === 0 || weekday === 6;
}

// "10월 28일(수)"
export function dayLabel(day: string) {
  const [, month, date] = day.split("-").map(Number);
  return `${month}월 ${date}일(${WEEKDAY_LABELS[weekdayOf(day)]})`;
}

// ── 상담사 연차·반차 — 연차는 종일, 오전반차는 점심 뒤 14:00부터, 오후반차는 점심 전 13:00까지 상담한다.
export type LeaveType = "full" | "am" | "pm";

export const HALF_DAY = { amOpenMinutes: 14 * 60, pmCloseMinutes: 13 * 60 };

export const LEAVE_TYPES = [
  { key: "full", label: "연차", hint: "종일 상담 닫힘" },
  { key: "am", label: "오전반차", hint: "14:00부터 상담" },
  { key: "pm", label: "오후반차", hint: "13:00까지 상담" },
] as const;

export function leaveLabel(type: string) {
  return LEAVE_TYPES.find((leave) => leave.key === type)?.label ?? "연차";
}

// 지금 이 휴가 때문에 실시간 상담이 닫혀 있는가
export function isLeaveClosedNow(type: string, now = new Date()) {
  if (type === "am") return kstMinutes(now) < HALF_DAY.amOpenMinutes;
  if (type === "pm") return kstMinutes(now) >= HALF_DAY.pmCloseMinutes;
  return true;
}

// 반차일의 실제 상담 시간
export function leaveHoursLabel(type: string) {
  if (type === "am") return "오늘 14:00 ~ 17:30";
  if (type === "pm") return "오늘 10:00 ~ 13:00";
  return "";
}

// 다음 영업일 — 주말과 휴무일을 건너뛴다(최대 60일까지 찾아봄).
export function nextBusinessDay(fromDay: string, isClosed: (day: string) => boolean) {
  let day = shiftDay(fromDay, 1);
  for (let i = 0; i < 60; i++) {
    if (!isWeekend(day) && !isClosed(day)) return day;
    day = shiftDay(day, 1);
  }
  return day;
}
