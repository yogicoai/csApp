// 조회 기록 — 누가(처리하는 사람·로그인 세션·접속 IP)·언제·어떤 고객의 개인정보를 봤는지(고객 조회·자세히 보기·녹취 재생·
// 파일 내려받기)와 로그인 성공·실패를 남긴다. 화면(클라이언트)과 서버가 같이 쓰므로 서버 전용 모듈을 들이지 않는다.

export const ACCESS_ACTIONS = [
  { key: "lookup", label: "고객 조회" },
  { key: "reveal", label: "자세히 보기" },
  { key: "play", label: "녹취 재생" },
  { key: "export", label: "파일 내려받기" },
  { key: "login", label: "로그인" },
  { key: "login_failed", label: "로그인 실패" },
] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number]["key"];

export function accessActionLabel(key: string) {
  return ACCESS_ACTIONS.find((action) => action.key === key)?.label ?? key;
}

// 기록은 2년 보관 뒤 자동으로 지운다(개인정보 접속기록 보관 기간).
export const ACCESS_LOG_KEEP_DAYS = 730;
export const ACCESS_LOG_PERIODS = [1, 7, 30, 90, 365] as const;

export type AccessLogView = {
  id: string;
  at: string;
  action: string;
  operator: string;
  target: string; // 고객 번호(숫자만) — 화면에는 maskPhone 으로 가려 보여 준다
  detail: string;
  ip: string;
  session: string;
  userAgent: string;
};

// ── 가림 — 고객 조회는 기본으로 가린 값만 보내고, [자세히 보기]를 눌러야(기록에 남기고) 전체를 보낸다 ──

// 010-****-5678 · 02-****-5678 — 끝 4자리만
export function maskPhone(digits: string) {
  if (digits.length < 8) return digits ? `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : "";
  const head = digits.startsWith("02") ? "02" : digits.slice(0, 3);
  return `${head}-****-${digits.slice(-4)}`;
}

// 정은경 → 정*경 · 김민 → 김* · 이미 가려진 이름(정**)은 그대로
export function maskName(name: string) {
  const value = name.trim();
  if (!value || value.includes("*")) return value;
  const chars = Array.from(value);
  if (chars.length === 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

// 회원 ID — 앞 2자리만
export function maskId(id: string) {
  return id ? `${id.slice(0, 2)}${"*".repeat(Math.max(3, id.length - 2))}` : "";
}

// 송장번호 등 — 끝 4자리만
export function maskTail(value: string) {
  return value.length > 4 ? `${"*".repeat(value.length - 4)}${value.slice(-4)}` : value;
}
