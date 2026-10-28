import { AccessLogList } from "@/components/AccessLogList";

// 조회 기록 — 고객 개인정보를 본 기록(고객 조회·자세히 보기·녹취 재생·파일 내려받기)과 로그인 성공·실패.
export default function AdminAccessLogsPage() {
  return (
    <main className="admin-shell al-shell">
      <section className="admin-header">
        <div>
          <p className="eyebrow">CS Center · 고객 조회</p>
          <h1>조회 기록</h1>
          <p className="admin-header-desc">
            누가 언제 어떤 고객의 정보를 봤는지 남겨요. 관리자 계정을 같이 쓰므로 &lsquo;처리하는 사람&rsquo;은 화면에서 적은 이름이고, 같은
            로그인(세션)과 접속 IP 로 함께 확인해요.
          </p>
        </div>
      </section>
      <AccessLogList />
    </main>
  );
}
