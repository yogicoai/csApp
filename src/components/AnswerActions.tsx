"use client";

import { Check, Headphones, MessageCircle, Phone, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { LiveChatButton } from "@/components/LiveChat";
import { getSessionId } from "@/lib/session";
import { rememberVisitSource } from "@/lib/visitSource";

type AnswerActionsProps = {
  channel: string;
  faqId: string;
  faqQuestion: string;
  faqCategory: string;
  phoneNumber: string;
};

export function AnswerActions({
  channel,
  faqId,
  faqQuestion,
  faqCategory,
  phoneNumber,
}: AnswerActionsProps) {
  const [feedback, setFeedback] = useState<"positive" | "negative" | "">("");
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    rememberVisitSource();
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, sessionId: getSessionId(), eventType: "question_view", faqId }),
    });
  }, [channel, faqId]);

  function logContact(method: "live_chat" | "phone") {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, sessionId: getSessionId(), eventType: "contact_click", faqId, metadata: { method } }),
    });
  }

  function markResolved() {
    setResolved(true);
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, sessionId: getSessionId(), eventType: "resolved", faqId }),
    });
  }

  function submitFeedback(helpful: boolean) {
    setFeedback(helpful ? "positive" : "negative");

    void fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, sessionId: getSessionId(), faqId, helpful }),
    });
  }

  return (
    <>
      <div className="resolve-box">
        {resolved ? (
          <p className="resolve-done">
            <Check size={16} />
            해결되어 다행이에요! 이용해 주셔서 감사합니다.
          </p>
        ) : (
          <>
            <span>이 답변으로 궁금증이 해결되셨나요?</span>
            <button className="resolve-button" onClick={markResolved} type="button">
              <Check size={16} />네, 해결됐어요
            </button>
          </>
        )}
      </div>
      <div className="feedback-row" aria-label="만족도">
        <button
          className={feedback === "positive" ? "feedback active" : "feedback"}
          onClick={() => submitFeedback(true)}
          type="button"
        >
          <ThumbsUp size={17} />
          좋아요
        </button>
        <button
          className={feedback === "negative" ? "feedback active" : "feedback"}
          onClick={() => submitFeedback(false)}
          type="button"
        >
          <ThumbsDown size={17} />
          아쉬워요
        </button>
      </div>
      {feedback && (
        <p className="feedback-note">
          <Check size={16} />
          의견이 기록되었습니다. 답변 품질 개선에 반영할게요.
        </p>
      )}
      <div className="contact-box">
        <div className="contact-head">
          <span className="contact-head-icon">
            <Headphones size={18} />
          </span>
          <div className="contact-head-copy">
            <strong>아직 궁금한 점이 있으신가요?</strong>
            <span>채팅으로 남겨주시면 상담원이 순서대로 답변드려요.</span>
          </div>
        </div>
        <div className="contact-actions">
          <LiveChatButton
            channel={channel}
            className="contact-cta contact-cta-live"
            entry={{ faqId, faqQuestion, category: faqCategory }}
            onOpen={() => logContact("live_chat")}
          >
            <MessageCircle size={18} />
            실시간 채팅상담으로 문의하기
          </LiveChatButton>
          <a className="contact-cta contact-cta-ghost" href={`tel:${phoneNumber}`} onClick={() => logContact("phone")}>
            <Phone size={15} />
            전화 상담 {phoneNumber}
          </a>
        </div>
      </div>
    </>
  );
}
