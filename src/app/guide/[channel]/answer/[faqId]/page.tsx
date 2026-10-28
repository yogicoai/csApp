import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { AnswerActions } from "@/components/AnswerActions";
import { RichAnswer } from "@/components/RichAnswer";
import { getChannel } from "@/lib/repositories/channelRepository";
import { getFaqById } from "@/lib/repositories/faqRepository";

export const dynamic = "force-dynamic";

type AnswerPageProps = {
  params: Promise<{
    channel: string;
    faqId: string;
  }>;
};

export default async function AnswerPage({ params }: AnswerPageProps) {
  const { channel, faqId } = await params;
  const [channelCopy, faq] = await Promise.all([getChannel(channel), getFaqById(faqId)]);

  if (!channelCopy || !faq) {
    notFound();
  }

  return (
    <main className="guide-shell answer-shell">
      <nav className="breadcrumb" aria-label="답변 경로">
        <Link href={`/guide/${channel}`}>{channelCopy.name} 상담 가이드</Link>
        <span>/</span>
        <span>{faq.category}</span>
        {faq.subcategory && (
          <>
            <span>/</span>
            <span>{faq.subcategory}</span>
          </>
        )}
      </nav>

      <section className="answer-detail">
        <div className="answer-heading">
          <div>
            <p className="eyebrow">{channelCopy.name} 답변 페이지</p>
            <h1>{faq.question}</h1>
          </div>
          <Image
            src="https://yogibo.openhost.cafe24.com/web/test/tmp-3922227795.webp"
            alt=""
            aria-hidden="true"
            width={120}
            height={104}
            priority
          />
        </div>
        {channelCopy.greeting && <p className="answer-greeting">{channelCopy.greeting}</p>}
        <RichAnswer text={faq.answer} />
        {faq.keywords.length > 0 && (
          <div className="keyword-row">
            {faq.keywords.map((keyword) => (
              <span key={keyword}>{keyword}</span>
            ))}
          </div>
        )}
        {channelCopy.closingMessage && <p className="answer-closing">{channelCopy.closingMessage}</p>}
      </section>

      <section className="answer-next">
        <AnswerActions
          channel={channel}
          faqId={faq.id}
          faqQuestion={faq.question}
          faqCategory={faq.category}
          phoneNumber={channelCopy.phoneNumber}
        />
      </section>
    </main>
  );
}
