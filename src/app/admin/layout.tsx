import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { isAuthed } from "@/lib/adminAuth";

// 어드민 공통 셸 — 왼쪽에 CS 콘솔식 내비게이션, 오른쪽에 업무 화면.
// 여기서 로그인 화면을 그려도 페이지가 그린 내용은 응답에 같이 실린다 — 내용을 서버에서 그리는 페이지는 직접 isAuthed 로 막는다.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authed = await isAuthed();
  if (!authed) {
    return <AdminLogin />;
  }
  return (
    <div className="admin-app">
      <AdminNav />
      <div className="admin-main">{children}</div>
    </div>
  );
}
