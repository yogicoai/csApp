import { redirect } from "next/navigation";

// 응대 자산은 FAQ 관리 화면의 팝업으로 옮겼다 — 예전 주소로 들어오면 팝업을 연 상태로 보낸다.
export default function AdminClaimsPage() {
  redirect("/admin/faqs?assets=1");
}
