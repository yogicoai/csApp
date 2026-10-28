import { AdminFaqManager } from "@/components/AdminFaqManager";
import { ClaimAssetsButton } from "@/components/ClaimAssetsButton";
import { getAllClaims } from "@/lib/repositories/claimRepository";
import { getAdminFaqs } from "@/lib/repositories/faqRepository";

// FAQ 관리 — 셀프가이드에 노출되는 질문·답변을 관리한다.
// 응대 자산(클레임)은 위쪽 [응대 자산 관리] 버튼의 팝업에서 관리한다(?assets=1 로 들어오면 바로 열림).
export default async function AdminFaqsPage({ searchParams }: { searchParams: Promise<{ assets?: string }> }) {
  const [faqs, claims, params] = await Promise.all([getAdminFaqs(), getAllClaims(), searchParams]);
  const liveClaims = claims.filter((claim) => claim.status === "live" && claim.answer);
  const reviewCount = claims.filter((claim) => claim.status === "review").length;

  return (
    <main className="admin-shell">
      <section className="admin-header">
        <div>
          <p className="eyebrow">CS Center</p>
          <h1>FAQ 관리</h1>
          <p className="admin-header-desc">고객 셀프가이드와 AI 답변의 근거가 되는 질문·답변을 관리합니다.</p>
        </div>
        <div className="admin-header-actions">
          <ClaimAssetsButton initialClaims={claims} reviewCount={reviewCount} autoOpen={params.assets === "1"} />
        </div>
      </section>

      <AdminFaqManager initialFaqs={faqs} initialLiveClaims={liveClaims} />
    </main>
  );
}
