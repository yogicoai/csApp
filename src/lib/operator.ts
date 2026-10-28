// 처리하는 사람 — 관리자 계정을 같이 쓰므로 화면에서 이름을 받아 이 브라우저에 기억하고, 쿠키로도 실어 보내
// 블랙컨슈머 이력·조회 기록에 남긴다(녹취 재생·파일 내려받기처럼 헤더를 못 붙이는 요청도 같이 기록되게).
// 스스로 적는 이름이라 조회 기록에서는 로그인 세션·접속 IP 와 같이 본다. (화면·서버 공용 — 함수는 브라우저에서만 부른다)

export const OPERATOR_COOKIE = "cs_operator";
export const OPERATOR_MAX = 20;
const OPERATOR_KEY = "cs_admin_operator";
const LEGACY_KEY = "cs_admin_black_by"; // 블랙컨슈머 화면이 처음에 쓰던 자리

export function readOperator() {
  try {
    return (window.localStorage.getItem(OPERATOR_KEY) ?? window.localStorage.getItem(LEGACY_KEY) ?? "").trim().slice(0, OPERATOR_MAX);
  } catch {
    return "";
  }
}

export function saveOperator(name: string) {
  const value = name.trim().slice(0, OPERATOR_MAX);
  try {
    window.localStorage.setItem(OPERATOR_KEY, value);
  } catch {
    // 저장이 막힌 브라우저면 쿠키만으로 이번 접속 동안 쓴다.
  }
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${OPERATOR_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax${secure}`;
}
