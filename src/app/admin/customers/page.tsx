import { CustomerLookup } from "@/components/CustomerLookup";

// 고객 조회 — 전화번호 하나로 녹취·상담·게시판·주문·블랙컨슈머를 모아 본다(TWC 의 번호별 상담 이력 대신).
// ?phone=01012345678 로 열면 바로 조회한다(녹취·상담 화면의 [고객 조회] 링크). 조회한 뒤 주소에서 번호를 지워
// 새로 고치면 빈 화면으로 돌아간다(결과가 화면에 계속 남지 않게).
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { phone } = await searchParams;
  const initialPhone = typeof phone === "string" ? phone.slice(0, 30) : "";
  return (
    <main className="admin-shell cu-shell">
      <section className="admin-header">
        <div>
          <p className="eyebrow">CS Center</p>
          <h1>고객 조회</h1>
          <p className="admin-header-desc">
            전화번호를 넣으면 같은 고객의 녹취, 실시간 상담·네이버 톡톡, 홈페이지 게시판 글, 주문과 블랙컨슈머 여부를 한 화면에 모아 보여
            줘요. 전화가 왔을 때 지난 이력을 바로 확인할 때 쓰세요.
          </p>
        </div>
      </section>
      <CustomerLookup key={initialPhone} initialPhone={initialPhone} />
    </main>
  );
}
