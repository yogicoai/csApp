// 고객이 셀프가이드에 어떤 경로로 들어왔는지(유입 경로) — 브라우저에서만 호출한다.
//
// 1) 링크에 붙인 src 파라미터가 있으면 그것을 우선한다(명시 표시).
//    예: 전화 상담 후 보내는 문자 링크 ?src=phone, 카카오톡 채널 메뉴 링크 ?src=kakao
//    단계 이동·답변 페이지 이동 후에도 유지되도록 첫 방문 때 sessionStorage 에 보관한다.
// 2) 없으면 자동 감지: 카카오톡·네이버 등 앱 내부 브라우저, iframe 안인지와 부모 사이트 출처.
// 개인정보를 남기지 않도록 전체 URL·User-Agent 는 저장하지 않고 출처(origin)와 앱 이름만 쓴다.

export type VisitSource = {
  via: string;
  app: string;
  embedded: boolean;
  parentOrigin: string;
  referrer: string;
  param: string;
};

const SOURCE_KEY = "cs_src";
const PARAM_PATTERN = /^[a-z0-9_-]{1,20}$/;

function readParam() {
  const param = (new URLSearchParams(window.location.search).get("src") ?? "").trim().toLowerCase();
  return PARAM_PATTERN.test(param) ? param : "";
}

export function rememberVisitSource() {
  try {
    const param = readParam();
    if (param) window.sessionStorage.setItem(SOURCE_KEY, param);
  } catch {
    // 저장소가 막힌 환경에서는 현재 URL 의 파라미터만 쓴다.
  }
}

function detectApp(userAgent: string) {
  if (/KAKAOTALK/i.test(userAgent)) return "kakaotalk";
  if (/NAVER\(inapp/i.test(userAgent)) return "naver";
  if (/Instagram/i.test(userAgent)) return "instagram";
  if (/FBAN|FBAV/i.test(userAgent)) return "facebook";
  if (/\bLine\//i.test(userAgent)) return "line";
  if (/BAND\//i.test(userAgent)) return "band";
  return "";
}

function originOf(url: string) {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

// 링크 파라미터 표기를 정해진 경로 이름으로 맞춘다(cafe24-popup → cafe24, sms·ars → phone).
function normalizeVia(param: string) {
  if (param.startsWith("cafe24")) return "cafe24";
  if (param.startsWith("kakao")) return "kakao";
  if (param === "sms" || param === "ars" || param.startsWith("phone")) return "phone";
  if (param.startsWith("naver")) return "naver";
  return param;
}

export function getVisitSource(): VisitSource {
  let param = "";
  try {
    param = window.sessionStorage.getItem(SOURCE_KEY) ?? "";
  } catch {
    // 아래에서 현재 URL 로 대신한다.
  }
  if (!param) param = readParam();

  const embedded = isEmbedded();
  const parentOrigin = embedded ? (window.location.ancestorOrigins?.[0] ?? "") || originOf(document.referrer) : "";
  const referrer = embedded ? "" : originOf(document.referrer);
  const app = detectApp(navigator.userAgent);

  let via = "web";
  if (param) via = normalizeVia(param);
  else if (embedded && /yogibo|cafe24/i.test(parentOrigin)) via = "cafe24";
  else if (app === "kakaotalk") via = "kakao";
  else if (app === "naver") via = "naver";
  else if (embedded) via = "embed";

  return { via, app, embedded, parentOrigin, referrer, param };
}
