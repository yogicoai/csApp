import { BoardManager } from "@/components/BoardManager";

// 게시판 관리 — 홈페이지(cafe24 Q&A·상품 후기)와 스마트스토어(고객문의) 글을 불러와 답변하고, 그 게시판에 바로 등록한다.
export default function AdminBoardsPage() {
  return (
    <main className="admin-shell bd-shell">
      <section className="admin-header">
        <div>
          <p className="eyebrow">CS Center</p>
          <h1>게시판 관리</h1>
          <p className="admin-header-desc">
            홈페이지·스마트스토어에 올라온 글을 기간별로 보고, 답이 없는 글에 여기서 답변을 쓰면 그 게시판에 바로 등록돼요.
            이전에 올라온 글과 달린 답변도 함께 볼 수 있어요.
          </p>
        </div>
      </section>

      <BoardManager />
    </main>
  );
}
