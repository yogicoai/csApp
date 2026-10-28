import { type BlackPrefill, BlackConsumerManager } from "@/components/BlackConsumerManager";

// 블랙컨슈머 — CS 가 주의 고객을 등록·해제한다(자동 차단 없이 상담·녹취 화면에 주의 표시).
// 상담·녹취·고객 조회의 [블랙컨슈머 등록]은 ?new=1&phone=&memberId=&chat=&ticket=&talk=1&name=&refs= 로 등록 칸을 채워 연다.
// ?id= 는 그 등록으로, ?q= 는 그 검색어로 연다.
export default async function AdminBlackConsumersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const pick = (key: string) => (typeof params[key] === "string" ? params[key].slice(0, 200) : "");
  const prefill: BlackPrefill = {
    open: pick("new") === "1",
    phone: pick("phone"),
    memberId: pick("memberId"),
    chatId: pick("chat"),
    ticket: pick("ticket"),
    talk: pick("talk") === "1",
    name: pick("name"),
    refs: pick("refs"),
    focusId: pick("id"),
    query: pick("q"),
  };
  return (
    <main className="admin-shell bc-shell">
      <section className="admin-header">
        <div>
          <p className="eyebrow">CS Center</p>
          <h1>블랙컨슈머</h1>
          <p className="admin-header-desc">
            폭언·위협·같은 민원 반복처럼 응대에 주의가 필요한 고객을 CS가 직접 등록하고 해제해요. 막지는 않고, 같은 전화번호·회원·네이버
            톡톡 고객의 상담과 녹취에 주의 표시만 떠요. 전화로 올 때 보이게 하려면 주소록 파일을 U+ 통화매니저 주소록에 올려 주세요.
          </p>
        </div>
      </section>
      <BlackConsumerManager key={JSON.stringify(prefill)} prefill={prefill} />
    </main>
  );
}
