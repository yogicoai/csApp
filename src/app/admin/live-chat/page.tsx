import { AdminLiveChat } from "@/components/AdminLiveChat";
import { LIVE_CHAT_HOURS_LABEL } from "@/lib/liveChatHours";
import { TALK_VIA } from "@/lib/liveChatOptions";

// ?via=talktalk(왼쪽 메뉴 [네이버 톡톡]) · ?via=web 이면 그 경로로 거른 채 연다. 메뉴로 거르기가 바뀌면 콘솔을 새로 그린다.
export default async function AdminLiveChatPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { via } = await searchParams;
  const initialVia = via === TALK_VIA || via === "web" ? via : "";
  return (
    <main className="admin-shell lc-shell">
      <section className="lc-page-head">
        <div>
          <p className="eyebrow">CS Center</p>
          <h1>실시간 상담</h1>
        </div>
        <p>
          고객 셀프가이드의 ‘실시간 채팅상담’과 네이버 톡톡으로 들어온 문의입니다. 톡톡 상담에 쓴 답은 고객 톡톡으로 바로 가요.
          운영시간({LIVE_CHAT_HOURS_LABEL}) 외와 연차일에는 셀프가이드 고객이 휴대폰을 남겨 ‘문의 접수’로 들어오고, 답변을 남긴
          뒤 대화 아래 [답변 안내 문자]로 알려 주면 돼요.
        </p>
      </section>
      <AdminLiveChat key={initialVia} initialVia={initialVia} />
    </main>
  );
}
