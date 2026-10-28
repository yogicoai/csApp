import { AdminLogin } from "@/components/AdminLogin";
import { AdminNav } from "@/components/AdminNav";
import { isAuthed } from "@/lib/adminAuth";

// 어드민 공통 셸 — 왼쪽에 CS 콘솔식 내비게이션, 오른쪽에 업무 화면.
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
