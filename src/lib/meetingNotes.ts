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

export type DefaultMeetingItem = {
  key: string; // 기본 항목마다 한 번만 넣으려고 붙이는 이름(화면에는 안 보임)
  question: string;
  why: string;
  target: MeetingTarget;
  status?: MeetingStatus;
  answer?: string;
};

// 처음 만든 기본 목록(10/29 오전) — 이 이름들은 이미 넣은 것으로 본다(예전 표시엔 이름이 없음).
export const FIRST_SEED_KEYS = [
  "talk-account",
  "kakao-volume",
  "twc-ai-summary",
  "frequent-inquiries",
  "recording-notice",
  "black-criteria",
  "address-book-format",
  "lguplus",
  "twc-termination",
  "external-malls",
  "cafe24-phone-search",
];

// 기본 확인 목록 — TWC 정리 회의자료·확인 답변록(10/21~22)에서 아직 답이 없던 것 + 10/28~29 새로 생긴 것·확인한 것.
// 새 항목은 여기에 이름(key)을 붙여 더하면, 이미 목록이 있는 곳에도 한 번만 들어간다(지운 항목은 다시 안 생김).
export const DEFAULT_MEETING_ITEMS: DefaultMeetingItem[] = [
  {
    key: "talk-account",
    target: "CS팀",
    question: "네이버 톡톡 파트너센터에서 최근 고객 문의는 어느 계정에 쌓이나요? (Yogibo W5X4LF 스마트스토어 / 요기보 Yogibo WC4U67 네이버페이·yogibo.kr)",
    why: "콘솔에는 W5X4LF 만 연결돼 있고, 10/28 연결 뒤 들어온 고객 문의가 0건이에요(서버·연결은 정상 — 10/28 테스트 메시지 수신·답장 확인). WC4U67 이면 그 계정도 연결해야 해요.",
  },
  {
    key: "kakao-volume",
    target: "CS팀",
    question: "카카오톡 상담은 한 달에 몇 건인가요?",
    why: "카카오 상담을 API 로 받을 때(상담톡 딜러사) 월 비용 계산용 — 톡브릿지 월 300건이면 45,000원 + 부가세.",
  },
  {
    key: "twc-ai-summary",
    target: "CS팀",
    question: "TWC AI 상담요약을 실제로 쓰고 있나요?",
    why: "안 쓰면 TWC 를 끊기 전이라도 이 옵션(월 11만 원)부터 해지할 수 있어요.",
  },
  {
    key: "frequent-inquiries",
    target: "CS팀",
    question: "전화·카카오톡으로 자주 오는 문의 유형과 대략적인 비율은?",
    why: "챗봇이 먼저 답할 범위와 FAQ 보강 순서를 정해요.",
  },
  {
    key: "recording-notice",
    target: "CS팀",
    question: "통화 시작 때 녹음 고지·폭언 금지 안내를 쓰고 있나요? 고객응대 매뉴얼 문서가 있나요?",
    why: "새 ARS 첫 멘트와 고객 응대 직원 보호 조치(산업안전보건법)에 반영해요.",
  },
  {
    key: "black-criteria",
    target: "CS팀",
    question: "블랙컨슈머 등록·해제 기준을 정해 주세요.",
    why: "정하면 [블랙컨슈머] 화면 위쪽 '등록·해제 기준' 칸에 적어 두고 같은 기준으로 등록해요.",
  },
  {
    key: "address-book-format",
    target: "CS팀",
    question: "U+ 통화매니저 주소록 엑셀 양식(열 이름)을 알려 주세요.",
    why: "[블랙컨슈머]의 주소록 파일을 그 양식에 맞추면 전화가 올 때 [블랙]으로 보여요.",
  },
  {
    key: "lguplus",
    target: "LG U+",
    question: "02-557-0920 회선 상품(고급형 센트릭스인지), ARS 1번에서 링크 문자가 나가는지, 통화매니저 녹음이 PC 폴더에 자동 저장되는지(파일 형식)?",
    why: "전화 구성(① LG U+ 유지)과 녹음 자동 수집·분석이 여기에 달려 있어요. 통화 중 음성을 실시간으로 받는 기능·API 는 공개 자료에 없어요(실시간 받아쓰기는 LG U+ AICC 계약 필요).",
  },
  {
    key: "twc-termination",
    target: "TWC",
    question: "위약금 없이 30일 전 서면 통보로 해지되는지, 녹취·상담 이력 반납 형식, VPN(월 45,000원) 용도, AI 상담요약만 먼저 해지할 수 있는지?",
    why: "TWC 종료 일정과 백업 범위를 정해요.",
  },
  {
    key: "coupang-api",
    target: "개발",
    status: "answered",
    question: "쿠팡 — 상품문의·고객센터 문의를 API 로 받아 여기서 답할 수 있나요?",
    why: "외부몰 매출은 대부분 쿠팡·오늘의집이라 문의를 [게시판 관리]에 모을 수 있는지 확인.",
    answer: [
      "확인(10/29, 공개 자료 기준): 가능해요.",
      "· 쿠팡 Open API(WING 판매자) — 상품별 고객문의 조회·답변, 쿠팡 고객센터에서 넘어온 문의 조회·답변·확인.",
      "· 키: WING [추가판매정보]에서 Open API 키 발급, 180일마다 다시 발급.",
      "· 규칙: 답변 2~1,000자, 등록 뒤 수정 불가. 고객센터 문의는 24시간 지나면 쿠팡이 자동 답변완료 처리.",
      "· 리뷰를 가져오는 API 는 확인하지 못했어요.",
      "→ 할 일: CS팀이 쿠팡 문의를 누가 어디서 하루 몇 건 받는지 확인 → 키 발급 → [게시판 관리]에 '쿠팡' 폴더 추가(스마트스토어처럼 onlineData 를 거쳐 붙임).",
    ].join("\n"),
  },
  {
    key: "ohouse-api",
    target: "CS팀",
    question: "오늘의집 — 문의는 하루 몇 건이고 누가 어디서 답하나요? 연동 솔루션(사방넷 등)을 쓰고 있나요?",
    why: [
      "확인(10/29, 공개 자료 기준): 판매자가 직접 쓸 수 있는 공개 API 는 없어요.",
      "· 오늘의집 Open API 는 오늘의집이 정한 연동 솔루션에만 열려 있고(2023-05 공지), 다른 솔루션 추가 계획은 없다는 답변이 있어요.",
      "· 문의는 판매자 시스템(오로라) [문의/리뷰]에서 상품 문의와 고객센터 문의(2024-09 신설)로 나눠 관리해요.",
      "→ 연동 솔루션을 쓰고 있으면 그 솔루션으로 문의를 받을 수 있는지 확인, 아니면 지금처럼 오로라에서 직접 답해요.",
    ].join("\n"),
  },
  {
    key: "cafe24-phone-search",
    target: "개발",
    question: "고객 조회 — cafe24 휴대폰으로 회원·주문 찾기가 실제 데이터에서 되는지 확인",
    why: "cafe24 문서에서 휴대폰 검색 조건을 확인하지 못해 실제 번호로 확인이 필요해요(안 되면 화면에 그렇게 안내돼요).",
  },
  {
    key: "board-work-hours",
    target: "개발",
    status: "done",
    question: "게시판 '평균 답변 시간'은 무엇을 기준으로 셀까요?",
    why: "글이 올라온 뒤 실제 시간으로 세면 밤·주말이 섞여 너무 길게 나와요.",
    answer: "결정(10/29): 근무시간(평일 10:00~17:30)만 세요. '가장 오래 기다린 글'도 같은 기준. 공휴일은 아직 빼지 않아요.",
  },
  {
    key: "dev-status-1029",
    target: "개발",
    status: "answered",
    question: "개발 현황 — 무엇이 서버(cscom-two)에 올라갔고 무엇을 확인했나요? (10/29 기준)",
    why: "베타는 이 PC에서 같이 확인한 뒤 서버에 올려요.",
    answer: [
      "· 실시간 상담 + 네이버 톡톡: 서버 반영. 10/28 톡톡 수신·답장 실제 확인. 그 뒤 고객 문의 0건 → 계정 확인 중.",
      "· 게시판 관리(홈페이지 Q&A·후기, 스마트스토어 상품문의·고객문의): 서버 반영. 10/27 실제 답글·답변 등록 확인. 평균 답변 시간 근무시간 기준은 이 PC에만(다음 업로드 때).",
      "· 음성 상담 분석 + 드롭박스 보관: 서버 반영. 10/28 실제 드롭박스 업로드·받아쓰기·재생 확인. 서버에 드롭박스 설정값을 넣었는지 확인 필요.",
      "· 홈페이지 휴무 팝업: 서버 반영. yogibo.kr 메인·상품 목록에 설치 확인, 게시판·로그인·장바구니 화면은 아직.",
      "· 고객 조회·블랙컨슈머·조회 기록: 서버 반영. 테스트 서버에서 API 103개·화면 22개 통과. cafe24 휴대폰 검색은 실제 데이터로 확인 필요.",
      "· 요금 정리·회의 기록: 서버 반영. 화면 테스트 10개 통과.",
      "· 전환 때 할 것: 로그인 실패 잠금·비밀번호 8자 이상, 사람별 계정 또는 사무실 IP 제한, 관리자 비밀번호(기본 2026) 변경, 도메인 전환.",
    ].join("\n"),
  },
];
