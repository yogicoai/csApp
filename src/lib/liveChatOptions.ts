import { LIVE_CHAT_HOURS_LABEL } from "@/lib/liveChatHours";

// 실시간 채팅상담 사전 질문·유입 경로의 선택지와 표시명.
// 고객 화면, 어드민 콘솔, API 검증이 같은 값을 쓰도록 DB 의존성 없이 둔다.
// 저장은 key 로 하고(나중에 AI 자산·통계로 쓰기 쉽게), 화면에는 label 을 보여준다.

export const PURCHASE_PLACES = [
  { key: "official", label: "요기보 공식몰" },
  { key: "smartstore", label: "네이버 스마트스토어" },
  { key: "online-etc", label: "29CM·기타 온라인몰" },
  { key: "offline", label: "매장·팝업스토어" },
  { key: "unknown", label: "선물·잘 모르겠어요" },
] as const;

export type PurchasePlace = (typeof PURCHASE_PLACES)[number]["key"];

export const PURCHASE_PLACE_KEYS = PURCHASE_PLACES.map((place) => place.key) as [PurchasePlace, ...PurchasePlace[]];

// 문의 유형은 FAQ 카테고리와 같은 이름을 쓴다(상담을 클레임으로 넘길 때 분류를 그대로 쓰기 위해).
// 셀프가이드는 실제 FAQ 카테고리를 넘겨주고, 목록을 모르는 화면에서만 이 기본값을 쓴다.
export const DEFAULT_INQUIRY_TYPES = [
  "A/S 접수",
  "교환/환불",
  "배송문의",
  "제품문의",
  "세탁방법",
  "공식 온라인 몰 이용 문의",
  "일반문의",
];

// 어느 유형에도 맞지 않을 때 고르는 선택지 — 고객 화면의 문의 유형 칩 맨 끝에 항상 붙는다.
export const OTHER_INQUIRY_TYPE = "기타문의";

// 상담 종료 때 고르는 결과 — 해결된 응대는 AI 자산 후보, 미해결은 FAQ 보강 후보, 후속 조치는 남은 처리 목록이 된다.
export const CHAT_OUTCOMES = [
  { key: "resolved", label: "해결", hint: "채팅 안내로 끝남" },
  { key: "follow_up", label: "후속 조치", hint: "사진 확인·회수·접수 등 남은 처리" },
  { key: "handed_off", label: "다른 곳 안내", hint: "전화·외부몰·B2B 담당 등으로 넘김" },
  { key: "unresolved", label: "미해결", hint: "고객 무응답, 답할 근거 없음" },
] as const;

export type ChatOutcome = (typeof CHAT_OUTCOMES)[number]["key"];

export const CHAT_OUTCOME_KEYS = CHAT_OUTCOMES.map((outcome) => outcome.key) as [ChatOutcome, ...ChatOutcome[]];

export function outcomeLabel(key: string) {
  return CHAT_OUTCOMES.find((outcome) => outcome.key === key)?.label ?? "미분류";
}

// 휴지통 — 테스트·스팸·중복 상담만 지운다(실제 고객 상담은 분쟁 기록 3년 보관 대상이라 지우지 않는다).
// 삭제한 상담은 목록·검색·통계에서 빠지고, TRASH_DAYS 안에는 복구할 수 있으며 그 뒤 자동으로 영구 삭제된다.
export const TRASH_DAYS = 30;
// 스팸으로 지우면 같은 고객(회원ID·같은 브라우저 세션)의 새 상담을 이 기간 동안 막는다(복구하면 풀린다).
export const SPAM_BLOCK_DAYS = 7;

export const DELETE_REASONS = [
  { key: "test", label: "테스트", hint: "베타·내부 테스트 상담" },
  { key: "spam", label: "스팸", hint: `같은 고객의 새 상담을 ${SPAM_BLOCK_DAYS}일간 막아요` },
  { key: "duplicate", label: "중복", hint: "같은 문의가 두 번 들어옴" },
  { key: "other", label: "기타", hint: "그 밖의 이유" },
] as const;

export type DeleteReason = (typeof DELETE_REASONS)[number]["key"];

export const DELETE_REASON_KEYS = DELETE_REASONS.map((reason) => reason.key) as [DeleteReason, ...DeleteReason[]];

export function deleteReasonLabel(key: string) {
  return DELETE_REASONS.find((reason) => reason.key === key)?.label ?? key;
}

// 상담 도움 영역의 '기본 문구' — 정책과 상관없는 공통 문구만 둔다(정책 안내는 FAQ·AI 초안으로).
export const DEFAULT_SNIPPETS = [
  {
    title: "첫 인사",
    body: "안녕하세요, 요기보 고객센터입니다. 문의 남겨 주셔서 감사합니다. 내용 확인 후 바로 안내드릴게요.",
  },
  { title: "확인 중", body: "확인 중이에요. 잠시만 기다려 주세요." },
  {
    title: "주문번호 요청",
    body: "정확한 확인을 위해 주문번호를 남겨 주시겠어요? 주문번호를 모르시면 구매하신 곳과 주문하신 날짜를 알려 주세요.",
  },
  {
    title: "운영시간 안내",
    body: `고객센터 운영시간은 ${LIVE_CHAT_HOURS_LABEL}입니다. 남겨 주신 내용은 운영시간에 순서대로 확인해 안내드릴게요.`,
  },
  {
    title: "마무리",
    body: "더 궁금하신 점이 있으면 언제든 편하게 문의해 주세요. 오늘도 좋은 하루 보내세요. 감사합니다.",
  },
];

// 네이버 톡톡으로 들어온 상담의 유입 경로 key(lib/naverTalk) — 셀프가이드 경로와 달리 고객 화면 없이 톡톡으로 주고받는다.
export const TALK_VIA = "talktalk";
// 톡톡 고객이 보낸 사진은 상담 대화에 "[사진] <주소>" 글로 남기고, 어드민 화면이 사진으로 보여준다.
export const TALK_PHOTO_PREFIX = "[사진] ";

const VIA_LABELS: Record<string, string> = {
  cafe24: "자사몰",
  kakao: "카카오톡",
  phone: "전화 연결",
  naver: "네이버",
  [TALK_VIA]: "네이버 톡톡",
  embed: "외부 사이트",
  web: "웹 직접 접속",
};

const APP_LABELS: Record<string, string> = {
  kakaotalk: "카카오톡 앱",
  naver: "네이버 앱",
  instagram: "인스타그램 앱",
  facebook: "페이스북 앱",
  line: "라인 앱",
  band: "밴드 앱",
};

export function purchasePlaceLabel(key: string) {
  return PURCHASE_PLACES.find((place) => place.key === key)?.label ?? key;
}

export function viaLabel(key: string) {
  return VIA_LABELS[key] ?? key;
}

export function appLabel(key: string) {
  return APP_LABELS[key] ?? key;
}
