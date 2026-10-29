import { ArrowRight, MessageCircle, PhoneCall, Receipt, Sparkles, TrendingDown } from "lucide-react";

// 요금 정리 — 회의용. TWC 지금 비용, 바꾼 뒤 예상 비용(전화 구성안별), 이번에 만든 기능의 사용료, 카카오톡 상담을 API 로 받을 때 비용.
// 근거: docs/twc 회의자료(2026-10-22)·결재요청서 2판(CS팀 1차 회신 반영), 카카오 상담톡 딜러사 공개 요금(2026-10-28 조사).
// 금액은 부가세 포함 추정(카카오 딜러사 요금은 부가세 별도) — 통신사·딜러사 견적에 따라 달라진다.

type Row = { item: string; detail: string; amount: string };

const NOW_ROWS: Row[] = [
  { item: "AI 상담요약", detail: "10계정 제공 상품, CS팀 실사용 확인 필요", amount: "100,000원" },
  { item: "콜상담", detail: "정가 109,000원에서 30,000원 할인", amount: "79,000원" },
  { item: "VPN", detail: "용도 확인 필요(TWC 접속용이면 해지 때 같이 끝)", amount: "45,000원" },
  { item: "통화료", detail: "월 4,808~17,545원, 대부분 고객에게 거는 전화", amount: "평균 약 11,000원" },
];

const AFTER_ROWS: Row[] = [
  { item: "LG U+ ARS + 안내 멘트", detail: "녹음 고지·폭언 금지 안내, 1번 챗봇 / 0번 상담사", amount: "7,480원" },
  { item: "U+ 통화매니저 + 자동 녹음", detail: "전화 오면 고객 정보·메모·블랙 표시, 녹음 12개월", amount: "12,100원" },
  { item: "링크 문자", detail: "월 약 240건(장문 30원)", amount: "7,140원" },
  { item: "챗봇 AI 사용료", detail: "대화당 약 10원", amount: "2,380원" },
  { item: "AI 요약·답변 초안", detail: "녹음 받아쓰기 + 요약(최대)", amount: "5,000원" },
  { item: "녹음 보관", detail: "회사 드롭박스 csVoice, 3년(약 10~20GB)", amount: "0원" },
  { item: "고객에게 거는 전화", detail: "지금 TWC 통화료 평균 그대로", amount: "12,252원" },
];

const OPTIONS: Array<{ name: string; how: string; monthly: string; yearly: string; note: string }> = [
  { name: "지금(TWC 그대로)", how: "고정비 계속", monthly: "258,680원", yearly: "—", note: "1~9월 실납부 평균" },
  { name: "TWC 유지 + AI 요약만 해지", how: "개발 없음", monthly: "148,652원", yearly: "약 132만 원", note: "CS팀이 AI 요약을 안 쓸 때만" },
  { name: "① LG U+ 유지 (추천)", how: "지금 회선 + ARS·통화매니저·녹음 + 자체 개발", monthly: "41,352~46,352원", yearly: "약 255만~261만 원", note: "ARS 1번 링크 문자 가능 여부 LG U+ 확인" },
  { name: "② KT 번호이동", how: "KT 통화매니저 + AI통화레코딩(3년)", monthly: "71,832원", yearly: "약 224만 원", note: "번호이동 절차·기간" },
  { name: "③ 클라우드 ARS", how: "착신전환 + 알림톡으로 챗봇 연결", monthly: "48,166원~", yearly: "—", note: "사람 통화가 많으면 월 8.4만 원까지" },
];

const BUILT_ROWS: Row[] = [
  { item: "실시간 상담 · 게시판 관리 · 고객 조회 · 블랙컨슈머", detail: "자체 개발 — 사용료 없음", amount: "0원" },
  { item: "네이버 톡톡 연결(챗봇 API)", detail: "톡톡 파트너센터 기능 — 별도 과금 항목 확인되지 않음", amount: "0원" },
  { item: "AI 도우미(답변 초안·질문·주문 찾기)", detail: "상담원이 누를 때만 호출 — 쓰는 만큼", amount: "위 AI 사용료에 포함" },
  { item: "통화 녹음 받아쓰기(STT)", detail: "분당 약 $0.003 × 월 약 820분(하루 12건·평균 3분 7초)", amount: "약 3,500원" },
  { item: "답변 안내 문자", detail: "지금은 통화매니저로 직접 발송(단문 15원·장문 30원)", amount: "건당" },
];

const KAKAO_ROWS: Array<{ name: string; price: string; note: string }> = [
  {
    name: "지금 — 카카오톡 채널 관리자센터 1:1 채팅",
    price: "무료",
    note: "대화를 가져오는 API 가 없어요. 필요한 대화만 관리자센터에서 손으로 내보내기.",
  },
  {
    name: "톡브릿지 Pro (해피톡 운영)",
    price: "월 100건 15,000원 · 300건 45,000원 · 500건 75,000원 · 1,000건 140,000원",
    note: "건당 150→140원, 1,000건 넘으면 견적. 가입비·약정 없음. API·웹훅은 Pro 부터. '1건'의 정의는 공개 자료에 없어 문의 필요.",
  },
  { name: "해피톡 상담톡 웹훅 직접", price: "비공개(협의)", note: "메시지 받기·보내기·사진·파일 지원, 인증키는 조건 협의 후 발급." },
  {
    name: "채널톡",
    price: "상담 1건 80원(크레딧) / 100원(후불)",
    note: "1건 = 같은 고객 24시간에 1번. 우리 서버로 받는 Open API·웹훅은 스타트업 요금(월 20만 원·1년 계약)부터.",
  },
];

const KAKAO_NOTES = [
  "카카오 대화를 우리 서버로 받으려면 '상담톡' 공식 딜러사를 거쳐야 해요(카카오 1:1 채팅 API 는 없음).",
  "상담톡을 켜면 관리자센터 1:1 채팅이 멈추고, 그동안의 대화는 넘어오지 않아요. 채널 하나에 딜러사 하나.",
  "월 카카오 상담 건수를 알면 톡브릿지 기준 월 비용을 바로 계산할 수 있어요(예: 월 300건이면 45,000원 + 부가세).",
  "계획한 '카카오 챗봇 → 쇼핑몰 챗봇 연결'은 상담톡이 아니라 챗봇 연결이라 위 요금과 별개예요(AI 사용료만, 위 표의 챗봇 AI 사용료).",
];

const OTHER_ROWS: Row[] = [
  { item: "LG U+ AI 대화록", detail: "통화 뒤 받아쓰기 상품, 상담사 1명당 · 3년 약정", amount: "월 15,400원" },
  { item: "LG U+ AI 상담 어드바이저", detail: "통화 중 실시간 받아쓰기 — 영업 문의", amount: "비공개" },
  { item: "KT AI통화레코딩 3년 보관", detail: "② KT 번호이동안에 포함", amount: "월 28,600원" },
];

function CostTable({ rows, total }: { rows: Row[]; total?: string }) {
  return (
    <table className="cost-table">
      <tbody>
        {rows.map((row) => (
          <tr key={row.item}>
            <th>{row.item}</th>
            <td>{row.detail}</td>
            <td className="cost-amount">{row.amount}</td>
          </tr>
        ))}
      </tbody>
      {total && (
        <tfoot>
          <tr>
            <th>합계</th>
            <td />
            <td className="cost-amount">{total}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

export default function AdminCostsPage() {
  return (
    <main className="admin-shell guide-page">
      <header className="guide-hero">
        <p className="eyebrow">CS Center · 요금 정리</p>
        <h1>요금 정리</h1>
        <p>TWC 를 정리하고 새 구성으로 바꿨을 때의 월 비용과, 카카오톡 상담을 API 로 받을 때 드는 비용입니다.</p>
      </header>

      <section className="guide-block">
        <div className="guide-block-head">
          <TrendingDown size={20} />
          <h2>한눈에</h2>
        </div>
        <div className="cost-summary">
          <div>
            <span>지금 TWC</span>
            <strong>월 258,680원</strong>
            <em>연 약 310만 원</em>
          </div>
          <ArrowRight className="cost-arrow" size={22} />
          <div>
            <span>바꾼 뒤(① LG U+ 유지)</span>
            <strong>월 약 46,000원</strong>
            <em>LG U+ 부가서비스 + 사용료</em>
          </div>
          <div className="is-save">
            <span>절감</span>
            <strong>월 약 21만 원</strong>
            <em>연 약 255만 원 · 개발비 0원(내부 개발)</em>
          </div>
        </div>
      </section>

      <section className="guide-block">
        <div className="guide-block-head">
          <Receipt size={20} />
          <h2>지금 TWC (월, 1~9월 청구서 기준)</h2>
        </div>
        <CostTable rows={NOW_ROWS} total="평균 258,680원 (부가세 포함)" />
        <p className="cost-note">고정비 224,000원(부가세 별도)은 1~9월 한 번도 바뀌지 않았고, 달마다 다른 건 통화료뿐이에요. 1~9월 누적 2,328,117원.</p>
      </section>

      <section className="guide-block">
        <div className="guide-block-head">
          <PhoneCall size={20} />
          <h2>바꾼 뒤 (① LG U+ 유지안, 월)</h2>
        </div>
        <CostTable rows={AFTER_ROWS} total="46,352원 (부가세 포함 추정)" />
        <p className="cost-note">LG U+ 회선 기본료는 지금도 따로 내고 있어요. 고급형 센트릭스로 바꿔야 하면 기본료가 달라질 수 있어 견적으로 확인해요(최악의 경우에도 절감 월 약 19.6만 원).</p>
      </section>

      <section className="guide-block">
        <div className="guide-block-head">
          <TrendingDown size={20} />
          <h2>구성안별 비교</h2>
        </div>
        <table className="cost-table is-compare">
          <thead>
            <tr>
              <th>구성</th>
              <th>방식</th>
              <th>월 비용</th>
              <th>연 절감</th>
              <th>확인할 것</th>
            </tr>
          </thead>
          <tbody>
            {OPTIONS.map((option) => (
              <tr key={option.name} className={option.name.includes("추천") ? "is-pick" : undefined}>
                <th>{option.name}</th>
                <td>{option.how}</td>
                <td className="cost-amount">{option.monthly}</td>
                <td className="cost-amount">{option.yearly}</td>
                <td>{option.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="guide-block">
        <div className="guide-block-head">
          <Sparkles size={20} />
          <h2>이번에 만든 기능의 사용료 (월)</h2>
        </div>
        <CostTable rows={BUILT_ROWS} />
        <p className="cost-note">AI·받아쓰기 사용료는 쓰는 만큼 나가요. 위 금액은 지금 통화량(하루 약 12건) 기준 추정이에요.</p>
      </section>

      <section className="guide-block">
        <div className="guide-block-head">
          <MessageCircle size={20} />
          <h2>카카오톡 상담을 API 로 받을 때 (상담톡 딜러사, 부가세 별도)</h2>
        </div>
        <table className="cost-table is-compare">
          <thead>
            <tr>
              <th>방법</th>
              <th>요금</th>
              <th>참고</th>
            </tr>
          </thead>
          <tbody>
            {KAKAO_ROWS.map((row) => (
              <tr key={row.name}>
                <th>{row.name}</th>
                <td className="cost-amount">{row.price}</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="cost-list">
          {KAKAO_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <section className="guide-block">
        <div className="guide-block-head">
          <PhoneCall size={20} />
          <h2>참고 — 통신사 AI 상품</h2>
        </div>
        <CostTable rows={OTHER_ROWS} />
      </section>

      <p className="cost-source">
        근거: TWC 정리 회의자료(2026-10-22) · CS 상담 개편 결재요청서 2판(CS팀 1차 회신 반영) · LG U+ 공식 안내 · 카카오 상담톡 딜러사 공개
        요금(2026-10-28 조사). 금액은 부가세 포함 추정(카카오 딜러사 요금은 부가세 별도)이며 견적에 따라 달라질 수 있어요.
      </p>
    </main>
  );
}
