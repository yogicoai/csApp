import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <main className="home-shell">
      <section className="home-hero">
        <div className="mascot-hero">
          <Image
            src="https://yogibo.openhost.cafe24.com/web/test/tmp-3922227795.webp"
            alt=""
            aria-hidden="true"
            width={260}
            height={220}
            priority
          />
        </div>
        <p className="eyebrow">Yogibo CS Guide</p>
        <h1>궁금한 내용을 먼저 골라보세요.</h1>
        <p>배송, 교환/환불, A/S 문의를 모바일에서 빠르게 확인하고 상담으로 이어갈 수 있습니다.</p>
        <div className="home-actions">
          <Link href="/guide/ownmall">채팅봇 바로가기</Link>
          <Link href="/admin">어드민 보기</Link>
        </div>
      </section>
    </main>
  );
}
