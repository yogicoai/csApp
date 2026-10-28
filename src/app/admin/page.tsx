import { AdminInsightButton } from "@/components/AdminInsightButton";
import { BoardStats } from "@/components/BoardStats";
import { UnansweredBadge } from "@/components/UnansweredBadge";
import { EngagementDashboard } from "@/components/EngagementDashboard";
import { WeeklyReport } from "@/components/WeeklyReport";
import { getAdminFaqs } from "@/lib/repositories/faqRepository";

// 상담 지표 — 셀프가이드 사용량과 상담 전환 흐름을 한눈에 본다.
export default async function AdminPage() {
  const faqs = await getAdminFaqs();

  return (
    <main className="admin-shell">
      <section className="admin-header">
        <div>
          <p className="eyebrow">CS Center</p>
          <h1>상담 지표</h1>
          <p className="admin-header-desc">고객이 셀프가이드에서 얼마나 해결했고, 어디서 상담으로 넘어오는지 봅니다.</p>
        </div>
        <div className="admin-header-actions">
          <UnansweredBadge />
          <AdminInsightButton />
        </div>
      </section>

      <WeeklyReport />

      <BoardStats />

      <EngagementDashboard faqCount={faqs.length} />
    </main>
  );
}
