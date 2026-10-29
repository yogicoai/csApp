// 회의 기록 — 회의 때 확인할 것(누구에게 물을지)과 받은 답·결정을 남긴다. 화면(클라이언트)과 서버가 같이 쓴다.

export const MEETING_TARGETS = ["CS팀", "LG U+", "TWC", "개발", "기타"] as const;
export type MeetingTarget = (typeof MEETING_TARGETS)[number];

export const MEETING_STATUSES = [
  { key: "open", label: "확인 대기" },
  { key: "answered", label: "답변 받음" },
  { key: "done", label: "결정·완료" },
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number]["key"];
export const MEETING_STATUS_KEYS = MEETING_STATUSES.map((status) => status.key) as [MeetingStatus, ...MeetingStatus[]];

export function meetingStatusLabel(key: string) {
  return MEETING_STATUSES.find((status) => status.key === key)?.label ?? key;
}

export type MeetingItemView = {
  id: string;
  question: string;
  why: string;
  target: string;
  status: MeetingStatus;
  answer: string;
  createdAt: string;
  updatedAt: string;
};

// 처음 열 때 넣어 두는 확인할 것 — TWC 정리 회의자료·확인 답변록(10/21~22)에서 아직 답이 없던 것 + 10/28~29 새로 생긴 것
export const DEFAULT_MEETING_ITEMS: Array<{ question: string; why: string; target: MeetingTarget }> = [
  {
    target: "CS팀",
    question: "네이버 톡톡 파트너센터에서 최근 고객 문의는 어느 계정에 쌓이나요? (Yogibo W5X4LF 스마트스토어 / 요기보 Yogibo WC4U67 네이버페이·yogibo.kr)",
    why: "콘솔에는 W5X4LF 만 연결돼 있고, 10/28 연결 뒤 들어온 고객 문의가 0건이에요. WC4U67 이면 그 계정도 연결해야 해요.",
  },
  {
    target: "CS팀",
    question: "카카오톡 상담은 한 달에 몇 건인가요?",
    why: "카카오 상담을 API 로 받을 때(상담톡 딜러사) 월 비용 계산용 — 톡브릿지 월 300건이면 45,000원 + 부가세.",
  },
  {
    target: "CS팀",
    question: "TWC AI 상담요약을 실제로 쓰고 있나요?",
    why: "안 쓰면 TWC 를 끊기 전이라도 이 옵션(월 11만 원)부터 해지할 수 있어요.",
  },
  {
    target: "CS팀",
    question: "전화·카카오톡으로 자주 오는 문의 유형과 대략적인 비율은?",
    why: "챗봇이 먼저 답할 범위와 FAQ 보강 순서를 정해요.",
  },
  {
    target: "CS팀",
    question: "통화 시작 때 녹음 고지·폭언 금지 안내를 쓰고 있나요? 고객응대 매뉴얼 문서가 있나요?",
    why: "새 ARS 첫 멘트와 고객 응대 직원 보호 조치(산업안전보건법)에 반영해요.",
  },
  {
    target: "CS팀",
    question: "블랙컨슈머 등록·해제 기준을 정해 주세요.",
    why: "정하면 [블랙컨슈머] 화면 위쪽 '등록·해제 기준' 칸에 적어 두고 같은 기준으로 등록해요.",
  },
  {
    target: "CS팀",
    question: "U+ 통화매니저 주소록 엑셀 양식(열 이름)을 알려 주세요.",
    why: "[블랙컨슈머]의 주소록 파일을 그 양식에 맞추면 전화가 올 때 [블랙]으로 보여요.",
  },
  {
    target: "LG U+",
    question: "02-557-0920 회선 상품(고급형 센트릭스인지), ARS 1번에서 링크 문자가 나가는지, 통화매니저 녹음이 PC 폴더에 자동 저장되는지(파일 형식)?",
    why: "전화 구성(① LG U+ 유지)과 녹음 자동 수집·분석이 여기에 달려 있어요.",
  },
  {
    target: "TWC",
    question: "위약금 없이 30일 전 서면 통보로 해지되는지, 녹취·상담 이력 반납 형식, VPN(월 45,000원) 용도, AI 상담요약만 먼저 해지할 수 있는지?",
    why: "TWC 종료 일정과 백업 범위를 정해요.",
  },
  {
    target: "기타",
    question: "쿠팡·오늘의집에서 고객 문의·리뷰(댓글)가 어디에 어떻게 남나요?",
    why: "외부몰 매출은 대부분 쿠팡·오늘의집. 쿠팡은 Open API 로 상품문의·고객센터 문의 조회·답변이 되고, 오늘의집은 API 확인이 필요해요 — 되면 [게시판 관리]에 붙여요.",
  },
  {
    target: "개발",
    question: "고객 조회 — cafe24 휴대폰으로 회원·주문 찾기가 실제 데이터에서 되는지 확인",
    why: "cafe24 문서에서 휴대폰 검색 조건을 확인하지 못해 5830(운영 데이터)에서 실제 번호로 확인이 필요해요.",
  },
];
