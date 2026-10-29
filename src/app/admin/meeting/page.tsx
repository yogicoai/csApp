import { MeetingNotes } from "@/components/MeetingNotes";

// 회의 기록(회의용) — 확인할 것·받은 답·결정. 사용 가이드 아래 [요금 정리]와 같이 쓴다.
export default function AdminMeetingPage() {
  return (
    <main className="admin-shell mt-shell">
      <section className="admin-header">
        <div>
          <p className="eyebrow">CS Center · 회의용</p>
          <h1>회의 기록</h1>
          <p className="admin-header-desc">
            회의 때 확인할 것을 누구에게 물을지와 함께 남기고, 받은 답과 결정을 바로 적어요. [목록 복사]로 메신저나 회의록에 붙여 넣을 수
            있어요.
          </p>
        </div>
      </section>
      <MeetingNotes />
    </main>
  );
}
