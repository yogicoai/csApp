import { AdminVoiceCalls } from "@/components/AdminVoiceCalls";

// 음성 상담 분석 — 전화 녹음을 올리면 전사 → CS 티켓 양식으로 자동 정리 (TWC 대체 3단계).
// ?q=번호&call=녹취id(고객 조회에서 녹취를 눌렀을 때) 면 그 번호로 찾아 바로 연다.
export default async function AdminVoicePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { q, call } = await searchParams;
  const initialQuery = typeof q === "string" ? q.slice(0, 50) : "";
  const initialCallId = typeof call === "string" ? call.slice(0, 40) : "";
  return (
    <main className="admin-shell vc-shell">
      <section className="admin-header">
        <div>
          <p className="eyebrow">CS Center</p>
          <h1>음성 상담 분석</h1>
          <p className="admin-header-desc">
            통화 녹음을 올리면 자동으로 받아 적고(전사) 상담유형·요약·후속 조치·답변 초안까지 정리해요. 번호나 내용으로
            지난 녹취를 찾을 수 있어요.
          </p>
        </div>
      </section>

      <AdminVoiceCalls key={`${initialQuery}:${initialCallId}`} initialQuery={initialQuery} initialCallId={initialCallId} />
    </main>
  );
}
