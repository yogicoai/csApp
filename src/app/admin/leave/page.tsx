import { LeaveManager } from "@/components/LeaveManager";

// CS 연차 관리 — 상담사(1인) 연차일에는 고객 화면의 실시간 채팅상담이 닫힌다.
export default function AdminLeavePage() {
  return (
    <main className="admin-shell sc-shell">
      <section className="admin-header">
        <div>
          <p className="eyebrow">CS Center</p>
          <h1>연차 관리</h1>
          <p className="admin-header-desc">
            상담사 연차일을 달력에 지정해 두면, 그날은 실시간 대화가 닫히고 문의 접수(답변은 문자 안내)로 받아요.
          </p>
        </div>
      </section>

      <LeaveManager />
    </main>
  );
}
