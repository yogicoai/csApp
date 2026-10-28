import {
  ArrowRight,
  BarChart3,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  MessageCircle,
  Mic,
  Pencil,
  Phone,
  Search,
  Sparkles,
  Users,
} from "lucide-react";

const CUSTOMER_STEPS = [
  { title: "카테고리 선택", desc: "A/S문의 · 교환/환불 · 배송안내 등" },
  { title: "세부 유형 선택", desc: "카테고리 안에서 문의 유형을 좁힘" },
  { title: "답변 확인", desc: "인삿말·답변·마무리 멘트가 상담 답변처럼 표시" },
  { title: "AI에게 직접 질문", desc: "못 찾으면 키워드·문장으로 질문 → FAQ·승인 클레임 근거로 즉시 답변" },
  {
    title: "실시간 채팅상담",
    desc: "봇이 구매처 → 문의 유형 → 주문번호를 하나씩 묻고(칩 선택), 답이 끝나면 입력창이 열리며 상담 연결",
  },
  { title: "해결 확인", desc: "‘네, 해결됐어요’ 버튼으로 해결 여부 표시" },
];

const ADMIN_CARDS = [
  {
    icon: BarChart3,
    title: "상담 지표 · 기간 리포트",
    points: [
      "왼쪽 메뉴 맨 위 [상담 지표] — 상담·게시판·셀프가이드 전체 데이터를 한 화면에서 봐요(왼쪽 위 요기보 로고를 눌러도 이 화면)",
      "기간 리포트: 접수·결과 분포·평균 첫 응답·문의유형·구매처·유입·음성 분석 건수 요약",
      "[리포트 텍스트 복사] → 메신저·보고용으로 바로 붙여넣기",
      "[상담 기록 CSV 내려받기] → 대화 전문 포함 엑셀 파일",
      "게시판 지표: 홈페이지·스마트스토어 따로 — 글 수 · 미답변(가장 오래 기다린 글) · 평균 답변 시간 · 여기서 등록한 답변",
      "참여도 대시보드: 자가해결률 · 해결 전환율 · 전화 클릭 · 인기/미해결 검색어",
    ],
  },
  {
    icon: MessageCircle,
    title: "실시간 상담 콘솔",
    points: [
      "왼쪽 메뉴 [실시간 상담] — 대기·상담중 / 종료 탭, 날짜 바와 일별 통계로 그날그날 관리",
      "상담번호·주문번호·회원ID·대화 내용 검색, 대기 시간 배지로 급한 상담 먼저",
      "가운데: 고객 맥락 바(유입 경로·구매처·유형·주문번호·보던 FAQ) + 빠른 문구",
      "오른쪽: AI 도우미(답변 초안·질문) / 고객·주문(cafe24 조회·이전 상담) / 자주 쓰는 답변",
      "종료할 때 결과(해결·후속 조치·다른 곳 안내·미해결)를 고르면 분류·통계에 반영",
      "삭제는 휴지통(30일 복구 가능, 스팸은 같은 고객 7일 차단) — 실제 고객 상담은 3년 보관이라 지우지 않기",
      "네이버 톡톡 문의도 같은 목록에 '네이버 톡톡'으로 들어와요(메뉴 [실시간 상담] 아래 [네이버 톡톡]은 톡톡만) — 여기서 쓴 답은 고객 톡톡으로 바로 가고, 못 보낸 답은 '보내지 못했어요'로 표시돼요",
      "톡톡 고객이 보낸 사진은 대화에 사진으로 보이고, 톡톡 파트너센터(앱)에서 직접 보낸 답도 '파트너센터에서 보냄'으로 함께 남아요 · 상담을 종료해도 고객 톡톡에는 안내가 가지 않아요",
    ],
  },
  {
    icon: ClipboardList,
    title: "게시판 관리",
    points: [
      "왼쪽 메뉴 [게시판 관리] — 홈페이지(Q&A·상품 후기)와 스마트스토어(고객문의) 폴더를 따로 보고, 최근 7·30·90일 글을 불러와요",
      "전체·미답변·답변 완료로 거르고 제목·내용·작성자로 찾기, 이미 달린 답변도 함께 보여요",
      "답이 없는 글은 오른쪽 AI 도우미(답변 초안·질문·주문 조회)와 자주 쓰는 답변으로 쓰고 [답변 등록]",
      "등록 전 확인 창을 한 번 더 거쳐요 — 홈페이지는 '(주)요기코퍼레이션' 이름의 답글(원글이 비밀글이면 비밀 답글), 스마트스토어는 판매자 답변으로 바로 올라가 고객에게 보여요",
      "등록한 답변은 여기서 고치거나 지울 수 없어요 — cafe24 관리자·스마트스토어 판매자센터에서 수정",
      "다른 창(다른 상담원)이 먼저 답했거나 같은 글을 동시에 등록하면 막고 알려 줘요",
    ],
  },
  {
    icon: Mic,
    title: "음성 상담 분석 (TWC 대체)",
    points: [
      "통화 녹음 파일 업로드 → 자동 전사(받아 적기) → 상담유형·구분태그·상담요약·상담내용 티켓으로 정리",
      "고객 정보(성함·연락처·제품·주문)와 후속 조치, 재문의용 답변 초안까지 자동 생성",
      "녹취 텍스트만 붙여넣어도 분석 가능, 번호·이름·내용으로 지난 녹취 검색",
      "파일명에 날짜·전화번호가 있으면 자동 인식 (LG U+ 통화매니저 녹음 폴더 기준)",
    ],
  },
  {
    icon: Sparkles,
    title: "응대 자산 승격 (상담 → AI)",
    points: [
      "‘해결’로 종료한 채팅 상담: [AI 자산으로 보내기] → AI가 개인정보를 뺀 질문·답변으로 일반화",
      "분석이 끝난 녹취: [응대 자산으로 보내기] → 분석 결과를 그대로 자산 후보로",
      "둘 다 ‘검토 대기’로 들어오며, [FAQ 관리] 위쪽 [응대 자산 관리] 팝업에서 CS가 확인 후 라이브 전환해야 AI 응대에 사용",
      "같은 상담은 두 번 승격되지 않아요(버튼이 ‘자산 검토 대기 ✓’로 바뀜)",
    ],
  },
  {
    icon: CalendarDays,
    title: "연차·반차 관리",
    points: [
      "CS 상담사가 1명이라, 휴가 시간에는 실시간 대화가 닫히고 운영시간 외처럼 '문의 접수'(휴대폰 남기면 답변을 문자로 안내)로 받아요",
      "연차 = 종일 닫힘 · 오전반차 = 14:00부터 상담 · 오후반차 = 13:00까지 상담",
      "닫혀 있는 동안 고객에게는 다시 열리는 때(예: '오늘 오후 2시부터', '○월 ○일부터')를 안내해요",
      "왼쪽 메뉴 [연차 관리] — 달력에서 날짜를 눌러 종류 선택·지정·해제, 맨 위 [오늘 연차/오전반차/오후반차] 원클릭, 며칠짜리는 [여러 날 연차]",
      "이미 진행 중인 상담과 FAQ·AI 질문은 휴가 중에도 그대로 이용할 수 있어요",
    ],
  },
  {
    icon: BellRing,
    title: "새 상담 알림",
    points: [
      "새 상담·새 메시지가 오면 딩동 소리 + 탭 제목 깜빡임 (왼쪽 아래에서 소리 켜고 끄기)",
      "[PC 알림 켜기] → 다른 프로그램을 보고 있어도 Windows 알림이 뜨고, 누르면 콘솔로 바로 이동",
      "콘솔 화면 안에서는 [알림 켜기]로 메시지 내용까지 데스크톱 알림",
    ],
  },
  {
    icon: Pencil,
    title: "FAQ 관리 · 응대 자산",
    points: [
      "추가/수정/삭제 (삭제는 보관 처리, 변경 이력 자동 기록)",
      "카테고리는 드롭다운 선택 또는 새로 직접 입력",
      "‘AI에게 물어보기’로 중복 확인·답변 초안 활용",
      "위쪽 [응대 자산 관리] 버튼 → 팝업에서 클레임 엑셀 업로드·검토·라이브 전환 (검토 대기 수 표시)",
    ],
  },
];

const CLAIM_PIPELINE = [
  { title: "자산 모으기", desc: "엑셀 업로드 · 해결 상담 승격 · 녹취 승격" },
  { title: "AI 답변 들어보기", desc: "FAQ + CS답변 기반 추천·자동 분류" },
  { title: "CS 더블체크", desc: "최종 답변 확정" },
  { title: "라이브 전환", desc: "그때부터 AI 응대에 사용" },
];

const OPS_LOOP = [
  "실시간 상담·전화 녹취를 처리하고, 해결된 응대는 [자산으로 보내기]로 쌓기",
  "[FAQ 관리] → [응대 자산 관리] 팝업에서 검토 대기 건을 확인해 라이브 전환 (미해결 검색어는 FAQ 보강)",
  "기간 리포트·대시보드로 효과 확인 (자가해결률·해결 전환율↑, 전화 클릭↓)",
  "반복 → 상담할수록 AI가 똑똑해지는 선순환",
];

export default function AdminGuidePage() {
  return (
    <main className="admin-shell guide-page">
      <header className="guide-hero">
        <p className="eyebrow">CS Center · 사용 가이드</p>
        <h1>어드민 사용 가이드</h1>
        <p>실시간 상담 · 음성 상담 분석 · 응대 자산 운영을 위한 안내서입니다.</p>
      </header>

      <section className="guide-block">
        <div className="guide-block-head">
          <Users size={20} />
          <h2>고객 이용 흐름</h2>
        </div>
        <ol className="flow-steps">
          {CUSTOMER_STEPS.map((step, index) => (
            <li className="flow-step" key={step.title}>
              <span className="flow-num">{index + 1}</span>
              <strong>{step.title}</strong>
              <p>{step.desc}</p>
            </li>
          ))}
        </ol>
        <div className="flow-note">
          <MessageCircle size={15} />
          단순 문의는 셀프가이드·AI가 끝내고, 필요한 경우에만 실시간 채팅상담으로 연결되도록 설계되어 있습니다.
        </div>
      </section>

      <section className="guide-block">
        <div className="guide-block-head">
          <BarChart3 size={20} />
          <h2>어드민 기능 (왼쪽 메뉴 순서)</h2>
        </div>
        <div className="guide-cards">
          {ADMIN_CARDS.map((card) => (
            <article className="guide-card" key={card.title}>
              <div className="guide-card-head">
                <card.icon size={18} />
                <h3>{card.title}</h3>
              </div>
              <ul>
                {card.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-block">
        <div className="guide-block-head">
          <FileSpreadsheet size={20} />
          <h2>응대 자산 흐름 — 상담이 AI 답변이 되기까지</h2>
        </div>
        <p className="guide-lead">
          채팅·전화에서 <strong>잘 해결한 응대를 자산으로 승격</strong>하면 AI가 질문·답변으로 정리해 두고, CS가
          확정·라이브 전환한 것만 AI 응대에 쓰입니다. 이 데이터는{" "}
          <strong>고객 탐색 화면에는 절대 노출되지 않습니다.</strong>
        </p>
        <div className="pipeline">
          {CLAIM_PIPELINE.map((step, index) => (
            <div className="pipe-item" key={step.title}>
              <div className="pipe-step">
                <strong>{step.title}</strong>
                <span>{step.desc}</span>
              </div>
              {index < CLAIM_PIPELINE.length - 1 && <ArrowRight className="pipe-arrow" size={18} />}
            </div>
          ))}
        </div>
      </section>

      <section className="guide-block">
        <div className="guide-block-head">
          <CheckCircle2 size={20} />
          <h2>운영 루프 (권장)</h2>
        </div>
        <ol className="ops-loop">
          {OPS_LOOP.map((item, index) => (
            <li key={item}>
              <span className="ops-num">{index + 1}</span>
              {item}
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-block guide-contacts">
        <div className="guide-block-head">
          <Search size={20} />
          <h2>핵심 지표 한눈에</h2>
        </div>
        <div className="guide-metric-row">
          <div className="guide-metric"><Phone size={15} /> 전화 클릭 ↓ = 콜 감소</div>
          <div className="guide-metric"><CheckCircle2 size={15} /> 자가해결률 ↑</div>
          <div className="guide-metric"><Sparkles size={15} /> 라이브 자산 ↑ = AI 답변 품질 ↑</div>
        </div>
      </section>
    </main>
  );
}
