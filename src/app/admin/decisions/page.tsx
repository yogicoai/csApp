import { ArrowLeftRight, CircleHelp, ExternalLink, ListChecks, type LucideIcon, Receipt, Route, Scale, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { isAuthed } from "@/lib/adminAuth";

// 결정 사항 — 아직 결정 전인 건을 폴더별로 자세히 설명한다(연결하면 어떻게 되는지, 비용, 한계, 순서, 아직 모르는 것). 회의 기록과 따로 둔다.
// 근거: 톡브릿지 공식 문서·채널톡 안내·사방넷 공식 사용설명서·개발자센터 안내·사방넷 화면·CS팀 답변(2026-11-02~03 확인). 두 API 모두 실제로 호출해 보지는 않았다.
// 공개 저장소라 매출·문의 건수는 여기에 적지 않는다(몰별 숫자는 저장소 밖 보고서에 있다).

const FOLDERS = [
  { id: "sabangnet", label: "사방넷 API" },
  { id: "kakao", label: "카카오 상담" },
] as const;

type FlowStep = { who: string; what: string };
type Compare = { item: string; now: string; after: string };

const SABANGNET_NOW: FlowStep[] = [
  { who: "쇼핑몰", what: "자사몰·스마트스토어·외부몰에 주문과 문의가 쌓여요." },
  { who: "사방넷", what: "직원이 수집 버튼을 눌러야 모여요. 스케줄러(자동 수집)를 쓰지 않아 주말분은 월요일에 몰려요." },
  { who: "담당 직원", what: "아침에 사방넷에서 내려받아 이카운트에 올려요. 이때 온라인 매출을 알 수 있어요." },
  { who: "CS팀", what: "자사몰·스마트스토어 문의는 [게시판 관리]에서 답하고, 그 외 몰은 사방넷이나 쇼핑몰에 들어가서 답해요." },
];

const SABANGNET_AFTER: FlowStep[] = [
  { who: "사방넷", what: "주문·클레임·문의를 모으는 일은 지금처럼 사방넷이 해요. API 는 모아 둔 자료를 꺼내 오는 통로예요." },
  { who: "onlineData 서버", what: "사방넷은 호출하는 서버의 IP 를 등록해야 해요. 이 프로그램의 서버는 IP 가 고정이 아니어서, IP 가 고정된 onlineData 서버를 거쳐요." },
  { who: "이 프로그램", what: "외부몰 문의와 주문을 [게시판 관리]·[고객 조회]에 보여 줘요." },
  { who: "CS팀", what: "그 화면에서 답을 적으면 사방넷으로 전달돼요." },
  { who: "사방넷 → 쇼핑몰", what: "사방넷이 쇼핑몰로 답변을 보내요. 고객에게 보이기까지 시차가 있어요." },
];

const SABANGNET_USES: Array<Compare & { status: string }> = [
  { item: "외부몰 문의 답변", now: "사방넷이나 쇼핑몰에 들어가서 답변", after: "[게시판 관리]에서 답변", status: "공개 안내에 문의 수집·답변 전송이 있음. 몰별 동작은 미확인" },
  { item: "전화 중 외부몰 주문 찾기", now: "사방넷에서 따로 검색", after: "[고객 조회]에서 함께 검색", status: "전화번호로 찾을 수 있는지 미확인" },
  { item: "외부몰 매출 합치기", now: "사방넷 통계를 따로 확인", after: "자사몰·스마트스토어와 합쳐서 확인", status: "사방넷 통계에 취소·반품이 0으로 나와 클레임 자료 확인 필요" },
  { item: "이카운트 등록", now: "내려받아 사람이 업로드", after: "자동 등록의 재료로 사용", status: "API 없이 엑셀 변환으로도 시작할 수 있음" },
  { item: "주말 주문 공백", now: "월요일에 몰림", after: "API 만으로는 해결되지 않을 것으로 봄", status: "수집이 늦는 문제라 스케줄러가 해결책(추정)" },
];

const SABANGNET_PRICES = [
  { plan: "싱글·레귤러·브론즈", api: "5만 원", scheduler: "3만 원", both: "8만 원" },
  { plan: "실버·골드", api: "10만 원", scheduler: "5만 원", both: "15만 원" },
  { plan: "스페셜1·2", api: "30만 원", scheduler: "5만 원", both: "35만 원" },
  { plan: "스페셜3·4", api: "40만 원", scheduler: "5만 원", both: "45만 원" },
  { plan: "플래티넘1·2", api: "50만 원", scheduler: "5만 원", both: "55만 원" },
];

const SABANGNET_LIMITS = [
  "사방넷이 모은 문의만 볼 수 있어요. 미답변 문의만 수집되고, 재문의는 수집되지 않으며, 몰에 따라 일부 게시판은 빠져요.",
  "답변이 쇼핑몰에 바로 반영되지 않아요. CS팀도 이 시차 때문에 쿠팡·오늘의집은 쇼핑몰에서 직접 답하고 있어요. API 로 답해도 같을 것으로 봐요(추정).",
  "쇼핑몰로 보내지 못한 답변은 '답변저장' 상태로 남아요. 처리 상태를 되돌리거나 수집된 문의를 지울 수는 없어요.",
  "자사몰·스마트스토어는 이미 직접 연결돼 있어요. 사방넷 쪽 자료와 겹치면 같은 문의에 두 번 답할 수 있어 빼고 보여 줘야 해요.",
  "후기(리뷰) 수집·답글은 공개 자료에서 확인하지 못했어요.",
  "자세한 API 문서는 결제한 뒤 초대받은 개발자만 볼 수 있어요. 결제 전에는 항목을 다 확인할 수 없어요.",
  "주문 정보에는 고객 개인정보가 들어 있어요. [고객 조회]의 기본 가림과 조회 기록을 그대로 적용해야 해요.",
];

const SABANGNET_STEPS: FlowStep[] = [
  { who: "결제 전 확인", what: "아래 '결제 전에 사방넷에 물어볼 것'을 기술 문의(api_sb@daou.co.kr)나 고객센터(1599-1311)로 확인해요." },
  { who: "버전 확인", what: "사방넷 홈페이지 마이페이지 > 약정서관리에서 우리 버전과 요금을 봐요." },
  { who: "신청", what: "약정서관리 > 부가서비스 신청 > API 3.0 자체개발 신규 연동을 신청해요." },
  { who: "개발 준비", what: "마이페이지 > 연동관리에서 개발자 초대 메일을 보내고, Client ID·Secret 을 받아 onlineData 서버 IP 를 등록해요." },
  { who: "시험", what: "고정된 답이 오는 시험 환경(샌드박스)에서 먼저 맞춰 봐요. 자체 개발용 '앱'은 심사 없이 실제 연결로 넘어가요." },
  { who: "개발·반영", what: "onlineData 에 사방넷 연결을 만들고 이 프로그램 화면에 붙여요. 처음에는 조회만 켜고, 답변 보내기는 시험한 뒤에 켜요." },
];

const SABANGNET_QUESTIONS = [
  "쇼핑몰별로 API 답변 등록이 되는지",
  "1:1 문의와 쿠팡 고객센터 문의가 API 에 포함되는지",
  "후기(리뷰)를 가져오거나 답글을 달 수 있는지",
  "전화번호로 주문을 찾을 수 있는지",
  "API 로 받는 자료가 얼마나 자주 새로 들어오는지(스케줄러가 필요한지)",
  "결제 전에 문서를 보거나 시험해 볼 수 있는지",
];

const SABANGNET_CHOICES: Compare[] = [
  { item: "CS팀 업무", now: "[게시판 관리]의 링크로 사방넷에 들어가 확인", after: "외부몰 문의까지 이 프로그램에서 처리" },
  { item: "월 비용", now: "추가 없음", after: "버전에 따라 5만~50만 원 추가" },
  { item: "개발", now: "없음(링크만)", after: "onlineData 연결과 화면 개발 필요" },
  { item: "답변 반영 시차", now: "쇼핑몰에서 직접 답하면 시차 없음", after: "사방넷을 거치는 시차 있음" },
];

const SABANGNET_RECHECK = [
  "전화 응대 중에 외부몰 주문까지 이 프로그램에서 찾아야 할 때",
  "외부몰 매출을 자사몰·스마트스토어와 합쳐서 봐야 할 때",
  "외부몰 문의가 지금보다 크게 늘어 사방넷을 오가는 일이 부담될 때",
];

const KAKAO_FLOW: FlowStep[] = [
  { who: "고객", what: "평소처럼 카카오톡 채널에서 상담을 시작해요. 따로 설치할 것은 없어요." },
  { who: "톡브릿지", what: "카카오 상담톡으로 들어온 메시지를 받아 '새 메시지가 왔다'는 신호를 이 프로그램에 보내요." },
  { who: "이 프로그램", what: "신호를 받으면 대화 내용을 가져와 [실시간 상담]에 띄우고 알림을 울려요. 톡톡과 달리 신호에는 내용이 없어서 한 번 더 가져와요." },
  { who: "상담원", what: "[실시간 상담]에서 답을 적어요. 사진·파일도 보낼 수 있고, AI 답변 초안도 톡톡처럼 쓸 수 있게 만들어요." },
  { who: "고객", what: "톡브릿지를 거쳐 답이 카카오톡 채팅방에 도착해요. 고객 화면은 평소 카카오톡 상담과 같아요." },
];

const KAKAO_WORK: Compare[] = [
  { item: "상담하는 곳", now: "카카오톡 채널 관리자센터 1:1 채팅", after: "이 프로그램 [실시간 상담]. 관리자센터 1:1 채팅은 쓰지 않음" },
  { item: "톡톡과 함께 보기", now: "카카오와 톡톡을 따로 확인", after: "한 화면에서 같이 확인" },
  { item: "AI 답변 초안", now: "없음", after: "톡톡과 같은 AI 도우미 사용(개발 필요)" },
  { item: "대화 기록", now: "필요한 대화만 관리자센터에서 손으로 내보내기", after: "연결한 뒤의 대화가 프로그램에 자동으로 남음" },
  { item: "고객 확인", now: "주문 조회와 연결되어 있지 않음", after: "고객이 동의하면 전화번호를 받아 [고객 조회]와 연결 가능(개발 필요)" },
  { item: "운영 시간", now: "관리자센터 채팅 설정", after: "톡브릿지에서 요일별로 설정. 하루 한 구간만 되어 점심시간을 따로 뺄 수 없고, 비워 두면 24시간" },
];

const KAKAO_ENDS = [
  "상담원이 상담을 종료했을 때",
  "고객이 채팅방에 !종료 를 입력했을 때",
  "고객이 채팅방을 나갔거나 채널을 차단했을 때",
  "상담원이 고객을 차단했을 때",
  "고객의 마지막 메시지 후 30일이 지났을 때(채널톡 안내 기준)",
];

const KAKAO_PLANS = [
  { plan: "Free(체험)", count: "30일 동안 총 3건", price: "0원", vat: "0원", pick: false },
  { plan: "Pro 100 (현재 안)", count: "월 100건", price: "15,000원", vat: "16,500원", pick: true },
  { plan: "Pro 300", count: "월 300건", price: "45,000원", vat: "49,500원", pick: false },
  { plan: "Pro 500", count: "월 500건", price: "75,000원", vat: "82,500원", pick: false },
  { plan: "Pro 1000", count: "월 1,000건", price: "140,000원", vat: "154,000원", pick: false },
  { plan: "Enterprise", count: "1,000건 초과", price: "견적", vat: "—", pick: false },
];

const KAKAO_COUNTS = [
  { case: "같은 고객이 월요일 오전과 오후에 문의", count: "1건" },
  { case: "같은 고객이 월요일에 문의하고 화요일에 다시 문의", count: "2건" },
  { case: "고객 3명이 같은 날 문의", count: "3건" },
];

const KAKAO_BILLING = [
  "건수를 다 쓰면 추가 요금 없이 새 상담이 멈춰요. 요금제가 자동으로 올라가지도 않아요.",
  "이어서 쓰려면 같은 요금제를 한 번 더 결제하거나(다 쓴 뒤에만 가능, 16,500원), Pro 300 으로 올려요(49,500원 바로 결제, 남은 건수는 더해지고 결제일은 오늘로 바뀜).",
  "80% 를 쓰면 한 번, 다 쓰면 한 번 이메일이 와요. CS 담당자가 이 메일을 받아야 멈추기 전에 대처할 수 있어요.",
  "남은 건수는 다음 달로 넘어가지 않아요.",
  "그만두면 이용 종료일까지 쓰고 다음 결제가 되지 않아요. 환불은 첫 결제 후 7일 안에 한 건도 쓰지 않았을 때만 돼요.",
  "예상 비용: 100건 안이면 월 16,500원, 넘는 달은 33,000원 정도예요. 건수는 회의 기록의 '카카오톡 상담은 한 달에 몇 건' 답을 보고 판단해요.",
];

const KAKAO_CAUTIONS = [
  "연결하면 관리자센터 1:1 채팅을 쓸 수 없어요. 카카오 정책상 두 곳에서 같이 운영할 수 없다고 안내돼 있어요(채널톡 안내 기준).",
  "전환 전에 진행 중인 상담을 끝내야 해요. 이전 대화는 넘어오지 않으니 필요한 대화는 미리 내려받아 둬요.",
  "되돌릴 수 있어요. 연결을 해제하면 진행 중인 상담은 자동으로 끝나고, 관리자센터 채팅 설정에서 1:1 채팅을 다시 켜면 돼요. 프로그램에서 나눈 대화는 관리자센터로 넘어가지 않아요(채널톡 안내 기준).",
  "진행 중인 상담에만 답할 수 있어요. 상담이 끝나면 답장이 전송되지 않고, 고객이 다시 메시지를 보내야 새 상담으로 이어져요. 상담원이 먼저 말을 걸 수는 없어요.",
  "상담 시작 때 나오는 '1:1채팅을 요청하셨습니다…' 안내는 끌 수 없어요. 대화 저장·종료 방법 안내는 카카오 필수 문구예요. 그 위에 브랜드 소개 문구를 넣을 수는 있어요(카카오 검수 필요).",
  "고객이 보낸 사진·파일은 카카오 주소로 와요. 주소가 영구적이지 않아서(열흘 뒤 안 열린 사례 있음) 받자마자 우리 저장소에 옮겨 둬야 해요.",
  "고객 전화번호는 동의 요청을 보내야 받을 수 있어요. 상담당 1번, 동의는 3일 안에만 유효하고, 받을 때 저장하지 못하면 다시 받을 수 없어요. 개인정보 처리방침에 수집 항목과 목적을 안내해야 해요.",
  "고객 대화가 외부 서비스(톡브릿지)를 거치게 돼요. 개인정보 처리방침에 적어야 하는지 확인이 필요해요.",
];

const KAKAO_STEPS: FlowStep[] = [
  { who: "먼저 확인", what: "아래 '톡브릿지에 물어볼 것'을 help@talkbridge.io 로 확인해요. 답에 따라 진행 여부가 달라질 수 있어요." },
  { who: "가입·채널 등록", what: "브랜드를 만들고 카카오 채널(채널 이름·검색용 아이디·채널 URL)을 등록한 뒤 관리자 휴대폰으로 인증해요. 비즈니스 인증은 이미 끝났어요." },
  { who: "개발", what: "톡브릿지에서 연동 키를 받아 [실시간 상담]에 카카오를 붙여요. 받기·답장·종료·사진 보관·전화번호 요청을 만들고, 톡브릿지의 연결 테스트 신호로 먼저 확인해요." },
  { who: "전환 준비", what: "전환 시간을 정해 CS팀에 알리고, 진행 중인 상담을 끝내고, 필요한 대화를 내려받아요." },
  { who: "상담 활성화·결제", what: "톡브릿지에서 상담을 활성화하면 고객 상담이 들어오기 시작해요. 무료는 3건뿐이라 다 쓰면 멈춰요. 같은 날 Pro 100 을 결제해요(결제는 연결을 마쳐야 열려요)." },
  { who: "첫 주 점검", what: "받기·답장·사진이 잘 되는지, 건수가 얼마나 빨리 줄어드는지 CS팀과 확인해요." },
];

const KAKAO_QUESTIONS = [
  "톡브릿지로 연결해도 관리자센터 1:1 채팅이 멈추는지, 상담이 고객 마지막 메시지 후 30일에 자동 종료되는지(채널톡 안내와 같은지)",
  "고객이 쓰는 채널에 영향 없이 시험할 방법이 있는지(문서에 도입 검토용 개발 환경이 별도 안내로 제공된다고 나와 있음)",
  "상담 하나가 다음 날까지 이어지면 건수가 어떻게 세지는지",
  "건수를 다 썼을 때 진행 중인 상담과 고객 화면이 어떻게 되는지",
];

const KAKAO_CHOICES: Compare[] = [
  { item: "CS팀 업무", now: "관리자센터와 이 프로그램을 오가며 응대", after: "이 프로그램 한 화면에서 응대" },
  { item: "월 비용", now: "무료", after: "16,500원부터" },
  { item: "대화 기록·AI 초안", now: "자동 저장 없음, AI 초안 없음", after: "자동 저장, AI 초안 사용" },
  { item: "건수 위험", now: "없음", after: "건수를 다 쓰면 다시 결제할 때까지 새 상담이 멈춤" },
  { item: "개발", now: "없음", after: "톡톡 연결과 같은 구조로 개발 필요" },
];

function Block({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="guide-block">
      <div className="guide-block-head">
        <Icon size={20} />
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Flow({ steps }: { steps: FlowStep[] }) {
  return (
    <ol className="dc-flow">
      {steps.map((step) => (
        <li key={`${step.who}:${step.what}`}>
          <strong>{step.who}</strong>
          <span>{step.what}</span>
        </li>
      ))}
    </ol>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="cost-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function CompareTable({ rows, head }: { rows: Compare[]; head: [string, string, string] }) {
  return (
    <table className="cost-table is-compare">
      <thead>
        <tr>
          {head.map((label) => (
            <th key={label}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.item}>
            <th>{row.item}</th>
            <td>{row.now}</td>
            <td>{row.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Decision({ question, plan, cards }: { question: string; plan: string; cards: Array<{ label: string; value: string; note: string }> }) {
  return (
    <section className="guide-block">
      <div className="dc-decision-head">
        <span className="dc-state">결정 전</span>
        <h2>{question}</h2>
      </div>
      <div className="cost-summary dc-summary">
        {cards.map((card) => (
          <div key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <em>{card.note}</em>
          </div>
        ))}
      </div>
      <p className="dc-plan">
        <b>현재 안</b> {plan}
      </p>
    </section>
  );
}

function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children} <ExternalLink size={11} />
    </a>
  );
}

function SabangnetFolder() {
  return (
    <>
      <Decision
        question="사방넷 API 를 결제해 이 프로그램에 연결할까요?"
        plan="지금은 연결하지 않아요. 자사몰·스마트스토어는 직접 연결을 그대로 쓰고, 그 외 몰은 CS팀이 [게시판 관리]의 링크로 사방넷에 들어가 확인해요."
        cards={[
          { label: "추가 비용", value: "월 5만 원부터", note: "사방넷 사용료와 별도, 우리 버전에 따라 달라짐" },
          { label: "얻는 것", value: "외부몰 자료를 여기서", note: "문의 답변, 주문 찾기, 매출 합치기" },
          { label: "풀리지 않는 것", value: "답변 반영 시차", note: "주말 주문 공백도 API 가 아니라 스케줄러 쪽" },
        ]}
      />
      <Block icon={Route} title="지금은 이렇게 돌아가요">
        <Flow steps={SABANGNET_NOW} />
      </Block>
      <Block icon={ArrowLeftRight} title="연결하면 이렇게 바뀌어요">
        <Flow steps={SABANGNET_AFTER} />
      </Block>
      <Block icon={Users} title="일별로 무엇이 달라지나요">
        <table className="cost-table is-compare">
          <thead>
            <tr>
              <th>일</th>
              <th>지금</th>
              <th>연결 후</th>
              <th>확인 상태</th>
            </tr>
          </thead>
          <tbody>
            {SABANGNET_USES.map((row) => (
              <tr key={row.item}>
                <th>{row.item}</th>
                <td>{row.now}</td>
                <td>{row.after}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
      <Block icon={Receipt} title="비용 (월, 사방넷 사용료 별도)">
        <table className="cost-table is-compare">
          <thead>
            <tr>
              <th>사방넷 버전</th>
              <th>API</th>
              <th>스케줄러(자동 수집)</th>
              <th>둘 다</th>
            </tr>
          </thead>
          <tbody>
            {SABANGNET_PRICES.map((row) => (
              <tr key={row.plan}>
                <th>{row.plan}</th>
                <td className="cost-amount">{row.api}</td>
                <td className="cost-amount">{row.scheduler}</td>
                <td className="cost-amount">{row.both}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cost-note">우리 버전은 아직 확인 전이에요. 사방넷 공식 안내 금액이고, 부가세 포함 여부는 신청 화면에서 확인해야 해요. 스케줄러는 API 와 별개로 결제할 수 있어요.</p>
      </Block>
      <Block icon={TriangleAlert} title="한계와 주의할 점">
        <Bullets items={SABANGNET_LIMITS} />
      </Block>
      <Block icon={ListChecks} title="연결하기로 하면 이 순서로 해요">
        <Flow steps={SABANGNET_STEPS} />
      </Block>
      <Block icon={CircleHelp} title="결제 전에 사방넷에 물어볼 것">
        <Bullets items={SABANGNET_QUESTIONS} />
      </Block>
      <Block icon={Scale} title="두 선택 비교">
        <CompareTable rows={SABANGNET_CHOICES} head={["항목", "연결 안 함(현재 안)", "연결함"]} />
        <p className="cost-note">연결하지 않아도 주말 주문 공백은 스케줄러로 줄일 수 있고, 이카운트 자동 등록은 엑셀 변환으로 시작할 수 있어요. 아래와 같을 때 다시 검토해요.</p>
        <Bullets items={SABANGNET_RECHECK} />
      </Block>
      <p className="cost-source dc-source">
        근거(2026-11-02~03 확인): <Source href="https://docs.sabangnet.co.kr:1975/sabangnet">사방넷 공식 사용설명서</Source> ·{" "}
        <Source href="https://developer.sabangnet.co.kr">사방넷 개발자센터</Source> · 사방넷 관리 화면 · CS팀 답변. 상세 API 문서를 보지 못했고 실제 호출도 하지 않았어요. 몰별 건수와 매출은 온라인몰 연동 방안 보고(2026-11-03)에 있어요.
      </p>
    </>
  );
}

function KakaoFolder() {
  return (
    <>
      <Decision
        question="카카오톡 상담을 톡브릿지로 연결해 [실시간 상담]에서 받고 답할까요?"
        plan="연결한다면 Pro 100(월 16,500원)으로 시작해요. 연결 전에 아래 '톡브릿지에 물어볼 것'을 먼저 확인해요."
        cards={[
          { label: "월 비용", value: "16,500원부터", note: "100건까지, 부가세 포함, 가입비·약정 없음" },
          { label: "건수를 다 쓰면", value: "새 상담 멈춤", note: "추가 요금은 없고, 다시 결제하면 이어져요" },
          { label: "크게 바뀌는 것", value: "관리자센터 채팅 중지", note: "상담은 이 프로그램에서만(채널톡 안내 기준)" },
        ]}
      />
      <Block icon={Route} title="연결하면 상담이 이렇게 흘러가요">
        <Flow steps={KAKAO_FLOW} />
        <p className="cost-note">카카오 1:1 채팅에는 대화를 가져오는 API 가 없어요. 그래서 카카오 공식 상품인 상담톡을 쓰고, 톡브릿지가 그 연결을 대신해 줘요(해피톡과 제휴). 지금은 공식 문서만 확인했고 실제 연결은 해 보지 않았어요.</p>
      </Block>
      <Block icon={Users} title="CS팀 일은 이렇게 달라져요">
        <CompareTable rows={KAKAO_WORK} head={["항목", "지금", "연결 후"]} />
      </Block>
      <Block icon={ArrowLeftRight} title="상담은 이럴 때 끝나요">
        <Bullets items={KAKAO_ENDS} />
        <p className="cost-note">이 조건이라면 밤에 온 문의에 다음 날 아침 답할 수 있어요. 고객이 먼저 나가거나 종료하면 답장이 가지 않아요. 톡브릿지 문서에는 기간이 나와 있지 않아 확인이 필요해요.</p>
      </Block>
      <Block icon={Receipt} title="요금">
        <table className="cost-table is-compare">
          <thead>
            <tr>
              <th>요금제</th>
              <th>상담 건수</th>
              <th>월 요금</th>
              <th>부가세 포함</th>
            </tr>
          </thead>
          <tbody>
            {KAKAO_PLANS.map((row) => (
              <tr key={row.plan} className={row.pick ? "is-pick" : undefined}>
                <th>{row.plan}</th>
                <td>{row.count}</td>
                <td className="cost-amount">{row.price}</td>
                <td className="cost-amount">{row.vat}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="dc-subhead">1건을 세는 법 — 하루에 응대한 고객 1명</h3>
        <table className="cost-table">
          <tbody>
            {KAKAO_COUNTS.map((row) => (
              <tr key={row.case}>
                <td>{row.case}</td>
                <td className="cost-amount">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cost-note">메시지 수나 상담원 수로는 세지 않아요. 날짜는 한국 시간 자정으로 나눠요.</p>
        <h3 className="dc-subhead">결제와 건수 관리</h3>
        <Bullets items={KAKAO_BILLING} />
      </Block>
      <Block icon={TriangleAlert} title="연결 전에 알아 둘 것">
        <Bullets items={KAKAO_CAUTIONS} />
      </Block>
      <Block icon={ListChecks} title="연결하기로 하면 이 순서로 해요">
        <Flow steps={KAKAO_STEPS} />
        <p className="cost-note">상담 활성화 전까지는 고객 상담이 들어오지 않아요. 활성화를 끄면 새 상담이 멈추니, 관리자센터로 돌아가려면 위 '되돌리기' 절차를 따라요.</p>
      </Block>
      <Block icon={CircleHelp} title="톡브릿지에 물어볼 것 (help@talkbridge.io)">
        <Bullets items={KAKAO_QUESTIONS} />
        <p className="cost-note">CS팀에는 회의 기록의 월 건수가 고객 수 기준인지 상담 수 기준인지 확인해요. 같은 고객이 여러 날 문의하면 톡브릿지 건수는 더 많아져요.</p>
      </Block>
      <Block icon={Scale} title="두 선택 비교">
        <CompareTable rows={KAKAO_CHOICES} head={["항목", "연결 안 함(지금처럼)", "연결함"]} />
      </Block>
      <p className="cost-source dc-source">
        근거(2026-11-03 확인): <Source href="https://api.talkbridge.io/center/billing/">톡브릿지 요금·결제</Source> ·{" "}
        <Source href="https://api.talkbridge.io/center/setup-status/">설정 단계</Source> · <Source href="https://api.talkbridge.io/webhooks/payload/">수신 신호</Source> ·{" "}
        <Source href="https://api.talkbridge.io/api/outbound/">발신 API</Source> · <Source href="https://api.talkbridge.io/faq/">자주 묻는 질문</Source> ·{" "}
        <Source href="https://docs.channel.io/help/ko/articles/%EC%B9%B4%EC%B9%B4%EC%98%A4%ED%86%A1-%EC%97%B0%EB%8F%99%ED%95%98%EA%B8%B0-04f5721d">채널톡 카카오톡 연동 안내</Source>. &apos;채널톡 안내 기준&apos;은 다른 딜러사 문서라 톡브릿지 확인이 필요해요.
      </p>
    </>
  );
}

export default async function AdminDecisionsPage({ searchParams }: { searchParams: Promise<{ folder?: string | string[] }> }) {
  if (!(await isAuthed())) return null; // 로그인 전에는 내용을 응답에 싣지 않는다(layout 참고).
  const { folder } = await searchParams;
  const current = FOLDERS.find((item) => item.id === folder)?.id ?? FOLDERS[0].id;
  return (
    <main className="admin-shell guide-page">
      <header className="guide-hero">
        <p className="eyebrow">CS Center · 결정 사항</p>
        <h1>결정 사항</h1>
        <p>아직 결정 전인 건이에요. 폴더를 골라 연결하면 어떻게 되는지, 비용과 한계, 진행 순서를 볼 수 있어요.</p>
      </header>

      <nav className="dc-folders" aria-label="결정 사항 폴더">
        {FOLDERS.map((item) => (
          <Link key={item.id} href={`/admin/decisions?folder=${item.id}`} aria-current={current === item.id ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      {current === "kakao" ? <KakaoFolder /> : <SabangnetFolder />}
    </main>
  );
}
