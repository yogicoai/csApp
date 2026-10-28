// 블랙컨슈머 — CS 가 직접 등록·해제하는 주의 고객 목록. 자동으로 막지는 않고, 상담·녹취 화면에 주의 표시만 한다.
// 화면(클라이언트)과 서버가 같이 쓰므로 서버 전용 모듈을 들이지 않는다.

export const BLACK_REASONS = [
  { key: "abuse", label: "폭언·욕설" },
  { key: "threat", label: "위협·성희롱" },
  { key: "repeat", label: "같은 민원 반복" },
  { key: "demand", label: "무리한 보상 요구" },
  { key: "other", label: "기타" },
] as const;
export type BlackReason = (typeof BLACK_REASONS)[number]["key"];
export const BLACK_REASON_KEYS = BLACK_REASONS.map((reason) => reason.key) as [BlackReason, ...BlackReason[]];

export function reasonLabel(key: string) {
  return BLACK_REASONS.find((reason) => reason.key === key)?.label ?? key;
}

// 주의 표시 기간(개월) — 끝나는 날이 지나면 표시가 꺼지고 '기간 끝'으로 남는다(연장하거나 다시 주의로 돌릴 수 있다).
export const RETENTION_MONTHS = [3, 6, 12, 24, 36] as const;
export const DEFAULT_RETENTION_MONTHS = 12;
// 끝나는 날까지 이만큼 남으면 '곧 끝남'으로 보여 연장·해제를 검토하게 한다.
export const ENDING_SOON_DAYS = 30;

export function isRetentionMonths(value: unknown): value is (typeof RETENTION_MONTHS)[number] {
  return RETENTION_MONTHS.includes(value as (typeof RETENTION_MONTHS)[number]);
}

// 날짜(YYYY-MM-DD)에서 N개월 뒤 같은 날 — 그 달에 없는 날(31일 등)이면 그 달 마지막 날
export function addMonths(day: string, months: number) {
  const [year, month, date] = day.split("-").map(Number);
  const lastDate = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(date, lastDate))).toISOString().slice(0, 10);
}

// active: 주의 중 · ending: 주의 중이지만 곧 끝남 · expired: 기간 끝 · released: 해제
export type BlackStatus = "active" | "ending" | "expired" | "released";

export const BLACK_STATUS_LABEL: Record<BlackStatus, string> = {
  active: "주의 중",
  ending: "곧 끝남",
  expired: "기간 끝",
  released: "해제",
};

export type BlackHistoryAction = "register" | "edit" | "extend" | "release" | "reopen";

export const HISTORY_LABEL: Record<BlackHistoryAction, string> = {
  register: "등록",
  edit: "수정",
  extend: "기간 연장",
  release: "해제",
  reopen: "다시 주의",
};

export type BlackConsumerView = {
  id: string;
  phone: string;
  memberId: string;
  // 네이버 톡톡 고객으로 등록했는지 — 톡톡 식별값은 화면에 내보내지 않고, 등록한 상담번호만 보여 준다.
  talk: boolean;
  talkTicket: string;
  name: string;
  reasons: string[];
  detail: string;
  refs: string;
  registeredBy: string;
  createdAt: string;
  until: string; // YYYY-MM-DD(KST) — 이날까지 주의 표시
  releasedAt: string;
  releasedBy: string;
  releaseNote: string;
  status: BlackStatus;
  history: Array<{ at: string; action: BlackHistoryAction; by: string; note: string }>;
};

// 상담·녹취·고객 조회 화면의 주의 표시
export type CautionView = { id: string; name: string; reasons: string[]; until: string };

export type BlackSettings = { criteria: string; defaultMonths: number };

export function cautionText(caution: CautionView) {
  return `${caution.reasons.map(reasonLabel).join(" · ") || "주의 고객"} · ${caution.until}까지`;
}
