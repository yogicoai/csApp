"use client";

import Image from "next/image";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Headphones,
  Loader2,
  MessageCircle,
  Phone,
  Search,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Truck,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DeliveryInquiry } from "@/components/DeliveryInquiry";
import {
  LiveChatButton,
  LiveChatPanel,
  rememberLiveChat,
  useLiveChatClosure,
  useLiveChatHoursOpen,
} from "@/components/LiveChat";
import { RichAnswer } from "@/components/RichAnswer";
import { getSessionId } from "@/lib/session";
import type { FaqItem } from "@/lib/sample-data";
import { rememberVisitSource } from "@/lib/visitSource";

// 자사몰(ownmall) 채널에서만 사용하는 가상 카테고리.
// FAQ 목록에 존재하지 않으며, 카테고리 리스트 최상단에 강제 삽입되어
// 클릭 시 cafe24 배송 조회 UI 를 띄운다.
const DELIVERY_CATEGORY = "배송문의";

type ChannelCopy = {
  name: string;
  greeting: string;
  closingMessage: string;
  phoneNumber: string;
};

type SelfGuideProps = {
  channel: string;
  channelCopy: ChannelCopy;
  faqs: FaqItem[];
};

type AiAnswer = {
  status: "answered" | "answered_handoff" | "needs_handoff";
  answer: string;
  sources: Array<{
    id: string;
    question: string;
    category: string;
    subcategory?: string;
  }>;
  suggestions: Array<{
    id: string;
    question: string;
    category: string;
    subcategory?: string;
  }>;
  // "delivery" 면 [주문번호로 배송 조회하기] 버튼을 보여준다(배송·주문 상태 질문)
  action?: string;
  // 상담사 휴가(연차·반차)로 지금 실시간 채팅상담이 닫혀 있는지와 다시 여는 때
  chatClosed?: boolean;
  reopenLabel?: string;
};

export function SelfGuide({ channel, channelCopy, faqs }: SelfGuideProps) {
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [selectedFaqId, setSelectedFaqId] = useState("");
  const [query, setQuery] = useState("");
  const [aiAnswer, setAiAnswer] = useState<AiAnswer | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  // AI 답변 👍/👎(답변마다 한 번). 질문한 문장은 따로 기억해 피드백·상담 연결에 쓴다(입력창은 바뀔 수 있으므로).
  const [aiFeedback, setAiFeedback] = useState<"positive" | "negative" | "">("");
  const [aiAsked, setAiAsked] = useState("");
  const [feedback, setFeedback] = useState<"positive" | "negative" | "">("");
  const [resolved, setResolved] = useState(false);
  const [questionFilter, setQuestionFilter] = useState("");
  // cafe24 자사몰의 부모 페이지가 postMessage 로 넘겨주는 memberId.
  // 배송문의 카테고리에서 사용되며, ownmall 채널일 때만 리스너를 켠다.
  const [memberId, setMemberId] = useState("");
  // 배송문의 화면에서 "실시간 배송조회" CTA 를 눌렀을 때만 cafe24 조회 패널을 연다.
  // (기본은 일반 FAQ 목록을 그대로 노출)
  const [showDeliveryLookup, setShowDeliveryLookup] = useState(false);
  // 화면 안의 실시간 채팅상담 버튼들이 대화창 하나를 공유하도록, 지금 열린 자리만 기억한다.
  // header 는 단계를 옮겨도 유지되고, AI 답변 자리는 새로 질문하면 닫히며, 답변 자리는 FAQ 별로 구분된다.
  const [liveChatSpot, setLiveChatSpot] = useState("");
  const liveChatHoursOpen = useLiveChatHoursOpen();
  const liveChatClosure = useLiveChatClosure();
  // 지금 실시간 대화가 가능한지 — 아니면(운영시간 외·휴무) 버튼은 '문의 남기기'로 열린다. 확인 전에는 대화로 둔다.
  const liveChatLive = liveChatHoursOpen !== false && !liveChatClosure?.closedNow;
  const aiAnswerRef = useRef<HTMLDivElement>(null);
  const loggedNoResultFilters = useRef<Set<string>>(new Set());

  const isOwnmall = channel === "ownmall";
  const rawCategories = useMemo(() => Array.from(new Set(faqs.map((faq) => faq.category))), [faqs]);
  // 자사몰에서는 배송문의를 최상단에 강제 삽입 (FAQ 데이터에 없어도 노출)
  const categories = useMemo(
    () => (isOwnmall ? [DELIVERY_CATEGORY, ...rawCategories.filter((c) => c !== DELIVERY_CATEGORY)] : rawCategories),
    [isOwnmall, rawCategories],
  );
  const categoryFaqs = useMemo(() => faqs.filter((faq) => faq.category === category), [category, faqs]);
  const subcategories = useMemo(
    () => Array.from(new Set(categoryFaqs.map((faq) => faq.subcategory).filter(Boolean) as string[])),
    [categoryFaqs],
  );
  const needsSubcategory = subcategories.length > 0;
  const visibleFaqs =
    needsSubcategory && subcategory
      ? categoryFaqs.filter((faq) => faq.subcategory === subcategory)
      : needsSubcategory
        ? []
        : categoryFaqs;
  const filterText = questionFilter.trim().toLowerCase();
  const displayedFaqs = filterText
    ? visibleFaqs.filter((faq) =>
        `${faq.question} ${faq.keywords.join(" ")}`.toLowerCase().includes(filterText),
      )
    : visibleFaqs;
  const selectedFaq = faqs.find((faq) => faq.id === selectedFaqId);
  const currentStep = selectedFaq ? "answer" : category ? "question" : "category";
  const questionHeading = needsSubcategory && !subcategory ? `${category} 유형을 선택해 주세요.` : "이 중에서 가까운 질문을 골라주세요.";
  const headerTitle = currentStep === "category"
    ? "A/S문의를 도와드릴게요"
    : selectedFaq
      ? "답변을 확인해 주세요"
      : `${category}를 도와드릴게요`;
  const headerDescription = subcategory
      ? `${subcategory} 관련 질문만 정리했어요.`
      : "원하는 유형을 고르면 관련 질문만 보여드릴게요.";

  function logEvent(eventType: string, payload: Record<string, unknown> = {}) {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, sessionId: getSessionId(), eventType, ...payload }),
    });
  }

  useEffect(() => {
    // 링크의 src 파라미터(전화 문자·카카오 메뉴 등)를 첫 방문 때 기억해 실시간 채팅상담 유입 경로로 쓴다.
    rememberVisitSource();
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, sessionId: getSessionId(), eventType: "visit" }),
    });
  }, [channel]);

  // 답변 안내 문자 속 링크(?chat=id.token) — 그 대화를 이 브라우저에 보관해 바로 열고, 열쇠는 주소에서 지운다.
  // 개발 모드에서 효과가 두 번 돌아도 열리도록 타이머는 정리하지 않는다(두 번째에는 주소에 열쇠가 없다).
  useEffect(() => {
    const url = new URL(window.location.href);
    const match = (url.searchParams.get("chat") ?? "").match(/^([a-f0-9]{24})\.([A-Za-z0-9_-]{20,})$/);
    if (!match) return;
    rememberLiveChat(channel, match[1], match[2]);
    url.searchParams.delete("chat");
    window.history.replaceState(window.history.state, "", url.toString());
    window.setTimeout(() => setLiveChatSpot("header"), 0);
  }, [channel]);

  // 자사몰 iframe embed 시 회원ID 를 받는 두 경로:
  //  (1) URL 파라미터 mid — 부모가 iframe src 에 ?mid=<회원ID> 로 심어 전달 (가장 확실, 핸드셰이크 불필요)
  //  (2) postMessage cs:member — 로그인이 늦게 확인되는 경우 동적 갱신
  // ownmall 채널에서만 동작.
  useEffect(() => {
    if (!isOwnmall || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mid = (params.get("mid") || params.get("memberId") || "").trim();
    if (!mid) return;
    // 첫 페인트 뒤에 반영해 렌더 중 상태 변경을 피한다.
    const timer = window.setTimeout(() => setMemberId(mid), 0);
    return () => window.clearTimeout(timer);
  }, [isOwnmall]);

  useEffect(() => {
    if (!isOwnmall || typeof window === "undefined") return;

    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "cs:member" && typeof data.memberId === "string") {
        const next = data.memberId.trim();
        if (next) setMemberId(next);
      } else if (data.type === "cs:logout") {
        setMemberId("");
      }
    }

    window.addEventListener("message", onMessage);
    // 부모에게 "준비됐다" 신호 — 부모는 이걸 받고 memberId 를 회신한다.
    window.parent?.postMessage({ type: "cs:ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [isOwnmall]);

  // iframe 높이 자동조정: 콘텐츠 실제 높이를 측정해 부모에게 알린다.
  // 부모는 cs:height 를 받아 iframe.style.height 를 갱신 → 스크롤/잘림 없이 딱 맞게 늘어남.
  useEffect(() => {
    if (!isOwnmall || typeof window === "undefined") return;

    let lastSent = 0;
    const postHeight = () => {
      const height = Math.ceil(
        Math.max(
          document.body?.scrollHeight ?? 0,
          document.documentElement?.scrollHeight ?? 0,
        ),
      );
      if (height > 0 && height !== lastSent) {
        lastSent = height;
        window.parent?.postMessage({ type: "cs:height", height }, "*");
      }
    };

    postHeight();
    const observer = new ResizeObserver(() => postHeight());
    observer.observe(document.body);
    // 이미지/폰트 늦은 로드로 높이가 바뀌는 경우 대비
    window.addEventListener("load", postHeight);
    const settleTimer = window.setTimeout(postHeight, 400);

    return () => {
      observer.disconnect();
      window.removeEventListener("load", postHeight);
      window.clearTimeout(settleTimer);
    };
  }, [isOwnmall]);

  useEffect(() => {
    const queryText = questionFilter.trim();
    if (queryText.length < 2 || visibleFaqs.length === 0 || displayedFaqs.length > 0) {
      return;
    }

    const key = `${channel}|${category}|${subcategory}|${queryText.toLowerCase()}`;
    if (loggedNoResultFilters.current.has(key)) {
      return;
    }

    const timer = window.setTimeout(() => {
      loggedNoResultFilters.current.add(key);
      logEvent("no_result", {
        category,
        query: queryText,
        metadata: { source: "question_filter", subcategory },
      });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [category, channel, displayedFaqs.length, questionFilter, subcategory, visibleFaqs.length]);

  // 실시간 채팅상담 버튼 공통 속성 — 열린 자리 공유 + 사전 질문의 문의 유형 선택지(FAQ 카테고리).
  function liveChatButtonProps(spot: string) {
    return {
      open: liveChatSpot === spot,
      onOpenChange: (next: boolean) => setLiveChatSpot(next ? spot : ""),
      inquiryTypes: categories,
    };
  }

  function openHeaderLiveChat() {
    if (liveChatSpot === "header") return;
    logEvent("contact_click", { faqId: selectedFaq?.id, metadata: { method: "live_chat", from: "header" } });
    setLiveChatSpot("header");
  }

  function chooseCategory(nextCategory: string) {
    setCategory(nextCategory);
    setSubcategory("");
    setSelectedFaqId("");
    setFeedback("");
    setResolved(false);
    setQuery("");
    setAiAnswer(null);
    setShowDeliveryLookup(false);
    logEvent("category_view", { category: nextCategory });
  }

  function goBack() {
    // 배송조회 패널이 열려 있으면 먼저 그걸 닫아 FAQ 목록으로 돌아간다.
    if (showDeliveryLookup) {
      setShowDeliveryLookup(false);
      return;
    }

    if (selectedFaqId) {
      setSelectedFaqId("");
      setFeedback("");
    setResolved(false);
      return;
    }

    if (subcategory) {
      setSubcategory("");
      setAiAnswer(null);
      return;
    }

    if (category) {
      setCategory("");
      setQuery("");
      setAiAnswer(null);
    }
  }

  function resetGuide() {
    setCategory("");
    setSubcategory("");
    setSelectedFaqId("");
    setQuery("");
    setAiAnswer(null);
    setFeedback("");
    setResolved(false);
    setShowDeliveryLookup(false);
  }

  function chooseSubcategory(nextSubcategory: string) {
    setSubcategory(nextSubcategory);
    setSelectedFaqId("");
    setFeedback("");
    setResolved(false);
    setAiAnswer(null);
    logEvent("subcategory_view", { category, subcategory: nextSubcategory });
  }

  function chooseFaq(faqId: string) {
    setSelectedFaqId(faqId);
    setFeedback("");
    setResolved(false);
    setAiAnswer(null);
    logEvent("question_view", { faqId });
  }

  function submitFeedback(helpful: boolean) {
    if (!selectedFaq) {
      return;
    }

    setFeedback(helpful ? "positive" : "negative");
    void fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, sessionId: getSessionId(), faqId: selectedFaq.id, helpful }),
    });
  }

  function markResolved() {
    if (!selectedFaq) {
      return;
    }
    setResolved(true);
    logEvent("resolved", { faqId: selectedFaq.id });
  }

  // AI 답변 👍/👎 — 👎 는 어드민 상담 지표의 'AI 답변 보강' 목록으로 모인다.
  function submitAiFeedback(helpful: boolean) {
    if (!aiAnswer || aiFeedback) return;
    setAiFeedback(helpful ? "positive" : "negative");
    void fetch("/api/ai-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel,
        sessionId: getSessionId(),
        query: aiAsked || query.trim(),
        helpful,
        status: aiAnswer.status,
        answer: aiAnswer.answer,
        sourceIds: aiAnswer.sources.map((source) => source.id),
      }),
    }).catch(() => {});
  }

  // 배송·주문 상태 질문 → 배송문의의 실시간 배송조회(주문번호)로 바로 이동
  function openDeliveryLookup() {
    chooseCategory(DELIVERY_CATEGORY);
    setShowDeliveryLookup(true);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  }

  async function askAi(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (query.trim().length < 2 || aiLoading) {
      return;
    }

    setAiLoading(true);
    setAiAnswer(null);
    setAiFeedback("");
    setAiAsked(query.trim());
    setLiveChatSpot((spot) => (spot === "header" ? spot : ""));

    try {
      const response = await fetch("/api/ai-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          sessionId: getSessionId(),
          category,
          subcategory,
          query,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("AI query failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let scrolled = false;

      const scrollToAnswer = () => {
        if (scrolled) {
          return;
        }
        scrolled = true;
        window.setTimeout(() => {
          aiAnswerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) {
            continue;
          }
          const message = JSON.parse(raw) as
            | ({ type: "meta"; answer?: string } & Omit<AiAnswer, "answer">)
            | { type: "delta"; text: string }
            | { type: "done" };

          if (message.type === "meta") {
            setAiAnswer({
              status: message.status,
              answer: message.answer ?? "",
              sources: message.sources ?? [],
              suggestions: message.suggestions ?? [],
              action: message.action ?? "",
              chatClosed: Boolean(message.chatClosed),
              reopenLabel: message.reopenLabel ?? "",
            });
            scrollToAnswer();
          } else if (message.type === "delta") {
            setAiAnswer((prev) => (prev ? { ...prev, answer: prev.answer + message.text } : prev));
          }
        }
      }
    } catch {
      setAiAnswer({
        status: "needs_handoff",
        answer: "답변을 불러오지 못했습니다. 잠시 후 다시 시도하시거나 상담으로 문의해 주세요.",
        sources: [],
        suggestions: [],
      });
      window.setTimeout(() => {
        aiAnswerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } finally {
      setAiLoading(false);
    }
  }

  // AI 답변 카드 — 첫 화면(ai-start)과 질문 목록 화면(ai-question)이 같이 쓴다.
  function renderAiAnswer(spot: "ai-start" | "ai-question") {
    if (!aiAnswer) return null;
    const chatClosed = Boolean(liveChatClosure?.closedNow) || Boolean(aiAnswer.chatClosed);
    const reopenLabel = liveChatClosure?.nextOpenLabel || aiAnswer.reopenLabel || "다음 영업일";
    const answerDone = !aiLoading && aiAnswer.answer.trim().length > 0;

    return (
      <div className={aiAnswer.status === "answered" ? "ai-answer" : "ai-answer needs-handoff"} ref={aiAnswerRef}>
        <div className="ai-answer-head">
          <Bot size={18} />
          <strong>AI 답변</strong>
        </div>
        <RichAnswer text={aiAnswer.answer} />
        {aiAnswer.action === "delivery" && isOwnmall && (
          <button type="button" className="ai-delivery-button" onClick={openDeliveryLookup}>
            <Truck size={16} />
            주문번호로 배송 조회하기
          </button>
        )}
        {aiAnswer.sources.length > 0 && (
          <div className="source-list">
            <strong>참고한 FAQ</strong>
            {aiAnswer.sources.map((source) => (
              <button key={source.id} onClick={() => chooseFaq(source.id)} type="button">
                {source.subcategory && <span>{source.subcategory}</span>}
                {source.question}
              </button>
            ))}
          </div>
        )}
        {aiAnswer.suggestions.length > 0 && aiAnswer.sources.length === 0 && (
          <div className="source-list">
            <strong>가까운 질문</strong>
            {aiAnswer.suggestions.map((suggestion) => (
              <button key={suggestion.id} onClick={() => chooseFaq(suggestion.id)} type="button">
                {suggestion.question}
              </button>
            ))}
          </div>
        )}
        {aiAnswer.status !== "answered" && (
          <div className="ai-contact-actions">
            {chatClosed && (
              // 상담사 휴무에는 실시간 대화가 닫혀 있고, 문의 접수(문자로 답변 안내)만 받는다.
              <p className="ai-contact-closed">
                실시간 채팅상담은 {reopenLabel}부터 열려요. 지금은 문의를 남기시면 문자로 답변 안내를 드려요.
              </p>
            )}
            <LiveChatButton
              channel={channel}
              className="ai-contact-live"
              entry={{ aiQuery: aiAsked || query.trim(), category: spot === "ai-question" ? category || undefined : undefined }}
              memberId={memberId}
              onOpen={() => logEvent("contact_click", { metadata: { method: "live_chat", from: "ai" } })}
              {...liveChatButtonProps(spot)}
            >
              <MessageCircle size={16} />
              {liveChatLive && !chatClosed ? "실시간 채팅상담으로 이어서 확인하기" : "문의 남기기"}
            </LiveChatButton>
            <a href={`tel:${channelCopy.phoneNumber}`} onClick={() => logEvent("contact_click", { metadata: { method: "phone" } })}>
              <Phone size={15} />
              {channelCopy.phoneNumber}
            </a>
          </div>
        )}
        {answerDone && (
          <div className="ai-feedback-row" aria-label="AI 답변 만족도">
            {aiFeedback ? (
              <span className="ai-feedback-done">
                <Check size={14} /> 의견 고마워요. 답변 개선에 반영할게요.
              </span>
            ) : (
              <>
                <span>이 답변이 도움이 됐나요?</span>
                <button type="button" onClick={() => submitAiFeedback(true)}>
                  <ThumbsUp size={14} /> 도움 됐어요
                </button>
                <button type="button" onClick={() => submitAiFeedback(false)}>
                  <ThumbsDown size={14} /> 아쉬워요
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <main className={`guide-shell guide-shell--${channel}`}>
      <div className="guide-logo">
        <Image
          src="https://yogibo.openhost.cafe24.com/web/img/icon/logo3_on.png"
          alt="Yogibo"
          width={104}
          height={32}
          priority
          unoptimized
        />
      </div>
      <section className="guide-header compact">
        <div className="guide-avatar">
          <Image
            src="https://yogibo.openhost.cafe24.com/web/test/tmp-3922227795.webp"
            alt=""
            aria-hidden="true"
            width={96}
            height={96}
            priority
          />
        </div>
        <div className="guide-copy">
          <h1>{headerTitle}</h1>
          <p>{headerDescription}</p>
          <button type="button" className="guide-live-chat-pill" onClick={openHeaderLiveChat}>
            <MessageCircle size={14} />
            실시간 채팅상담
            {liveChatHoursOpen !== null && (
              <span
                className={
                  liveChatHoursOpen && !liveChatClosure?.closedNow ? "guide-live-chat-state is-on" : "guide-live-chat-state"
                }
              >
                {liveChatClosure?.closedNow
                  ? liveChatClosure.type === "am"
                    ? "14시부터 상담"
                    : liveChatClosure.type === "pm"
                      ? "오늘 상담 종료"
                      : "오늘 휴무"
                  : liveChatHoursOpen
                    ? "상담 가능"
                    : "운영시간 외"}
              </span>
            )}
          </button>
        </div>
      </section>

      {liveChatSpot === "header" && (
        <section className="guide-live-chat" aria-label="실시간 채팅상담">
          <LiveChatPanel
            channel={channel}
            entry={
              selectedFaq
                ? { faqId: selectedFaq.id, faqQuestion: selectedFaq.question, category: selectedFaq.category }
                : { aiQuery: query.trim() || undefined, category: category || undefined }
            }
            memberId={memberId}
            inquiryTypes={categories}
            onClose={() => setLiveChatSpot("")}
          />
        </section>
      )}

      <section className="mobile-step-view" aria-label="FAQ 탐색 단계">
        {currentStep !== "category" && (
          <button className="back-button" onClick={goBack} type="button">
            <ArrowLeft size={18} />
            이전
          </button>
        )}

        {currentStep === "category" && (
          <div className="step-panel">
            <div className="direct-question">
              <div className="step-title">
                <Sparkles size={20} className="ai-icon" />
                <h2>
                  <span className="ai-accent">AI</span>에게 바로 질문하기
                </h2>
              </div>
              <p>키워드나 문장으로 직접 질문해 보세요.<br/>등록된 FAQ 안에서 가장 가까운 답변을 찾아드립니다.</p>
              <form className="ai-question-form ai-question-form--inline" onSubmit={askAi}>
                <label className="search-field">
                  <Search size={18} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="예 : 비즈를 보충하고 싶어요"
                  />
                </label>
                <button disabled={query.trim().length < 2 || aiLoading} type="submit" aria-label="AI에게 직접 질문하기">
                  {aiLoading ? <Loader2 size={18} className="spin-icon" /> : <Send size={18} />}
                </button>
              </form>
              {renderAiAnswer("ai-start")}
            </div>

            <div className="browse-block">
              <div className="step-title compact-title">
                <h2>또는 문의 종류 선택</h2>
              </div>
              <div className="option-list">
                {categories.map((item) => (
                  <button
                    className={item === category ? "option active" : "option"}
                    key={item}
                    onClick={() => chooseCategory(item)}
                    type="button"
                  >
                    {item}
                    <ChevronRight size={18} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {currentStep === "question" && isOwnmall && category === DELIVERY_CATEGORY && showDeliveryLookup && (
          <div className="step-panel">
            <div className="selection-context">
              <button onClick={resetGuide} type="button">{DELIVERY_CATEGORY}</button>
              <button onClick={() => setShowDeliveryLookup(false)} type="button">실시간 배송조회</button>
            </div>
            <div className="step-title">
              <h2>배송 상태를 확인해 드릴게요</h2>
            </div>
            <DeliveryInquiry memberId={memberId} />
          </div>
        )}

        {currentStep === "question" && !(isOwnmall && category === DELIVERY_CATEGORY && showDeliveryLookup) && (
          <div className="step-panel">
          <div className="selection-context">
            <button onClick={resetGuide} type="button">{category}</button>
            {subcategory && <button onClick={() => setSubcategory("")} type="button">{subcategory}</button>}
          </div>
          <div className="step-title">
            <h2>{questionHeading}</h2>
          </div>
          {category ? (
            <>
              {isOwnmall && category === DELIVERY_CATEGORY && !subcategory && (
                <button
                  type="button"
                  className="delivery-cta"
                  onClick={() => {
                    setShowDeliveryLookup(true);
                    logEvent("delivery_lookup_open", { category });
                  }}
                >
                  <span className="delivery-cta-icon">
                    <Truck size={20} />
                  </span>
                  <span className="delivery-cta-copy">
                    <strong>실시간 배송조회</strong>
                    <em>내 주문의 배송 상태를 바로 확인하세요</em>
                  </span>
                  <ChevronRight size={18} />
                </button>
              )}
              {needsSubcategory && !subcategory && (
                <div className="option-list">
                  {subcategories.map((item) => (
                    <button
                      className={item === subcategory ? "option active" : "option"}
                      key={item}
                      onClick={() => chooseSubcategory(item)}
                      type="button"
                    >
                      {item}
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </div>
              )}
              {visibleFaqs.length > 5 && (
                <label className="search-field list-filter">
                  <Search size={18} />
                  <input
                    value={questionFilter}
                    onChange={(event) => setQuestionFilter(event.target.value)}
                    placeholder="질문 검색으로 빠르게 찾기"
                  />
                </label>
              )}
              {displayedFaqs.length > 0 && (
                <div className="option-list">
                  {displayedFaqs.map((faq) => (
                    <button
                      className={faq.id === selectedFaqId ? "option active" : "option"}
                      key={faq.id}
                      onClick={() => chooseFaq(faq.id)}
                      type="button"
                    >
                      {faq.question}
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </div>
              )}
              {visibleFaqs.length > 0 && displayedFaqs.length === 0 && (
                <p className="empty-state">검색 결과가 없어요. 아래에서 AI에게 직접 물어보세요.</p>
              )}
              {visibleFaqs.length === 0 && !needsSubcategory && (
                <p className="empty-state">등록된 세부 질문이 없습니다.</p>
              )}
              {needsSubcategory && !subcategory && (
                <p className="empty-state">
                  먼저 문의 유형을 선택하면 관련 질문만 정리해서 보여드릴게요.
                </p>
              )}
              <div className="ai-box">
                <div className="ai-title">
                  <Bot size={18} />
                  <strong>원하는 답변을 찾지 못하셨나요?</strong>
                </div>
                <p>키워드나 문장으로 직접 질문해 보세요. 등록된 FAQ 안에서 가장 가까운 답변을 찾아드립니다.</p>
                <form className="ai-question-form" onSubmit={askAi}>
                  <label className="search-field">
                    <Search size={18} />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="예: 비즈를 보충하고 싶어요"
                    />
                  </label>
                  <button className="ai-ask-button" disabled={query.trim().length < 2 || aiLoading} type="submit">
                    {aiLoading ? <Loader2 size={18} className="spin-icon" /> : <Send size={18} />}
                    AI에게 직접 질문하기
                  </button>
                </form>
                {renderAiAnswer("ai-question")}
              </div>
            </>
          ) : (
            <p className="empty-state">먼저 카테고리를 선택해 주세요.</p>
          )}
          </div>
        )}

        {currentStep === "answer" && (
          <div className="step-panel answer-panel">
          <div className="selection-context">
            <button onClick={resetGuide} type="button">{selectedFaq?.category}</button>
            {selectedFaq?.subcategory && <button onClick={goBack} type="button">{selectedFaq.subcategory}</button>}
          </div>
          {selectedFaq ? (
            <>
              <h3>{selectedFaq.question}</h3>
              {channelCopy.greeting && <p className="answer-greeting">{channelCopy.greeting}</p>}
              <RichAnswer text={selectedFaq.answer} />
              {channelCopy.closingMessage && <p className="answer-closing">{channelCopy.closingMessage}</p>}
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
                    <span>
                      {liveChatLive
                        ? "채팅으로 남겨주시면 상담원이 순서대로 답변드려요."
                        : "지금은 운영시간 외라 문의를 남겨 주시면 문자로 답변 안내를 드려요."}
                    </span>
                  </div>
                </div>
                <div className="contact-actions">
                  <LiveChatButton
                    channel={channel}
                    className="contact-cta contact-cta-live"
                    entry={{ faqId: selectedFaq.id, faqQuestion: selectedFaq.question, category: selectedFaq.category }}
                    memberId={memberId}
                    onOpen={() => logEvent("contact_click", { faqId: selectedFaq?.id, metadata: { method: "live_chat", from: "answer" } })}
                    {...liveChatButtonProps(`answer:${selectedFaq.id}`)}
                  >
                    <MessageCircle size={18} />
                    {liveChatLive ? "실시간 채팅상담으로 문의하기" : "문의 남기기"}
                  </LiveChatButton>
                  <a
                    className="contact-cta contact-cta-ghost"
                    href={`tel:${channelCopy.phoneNumber}`}
                    onClick={() => logEvent("contact_click", { metadata: { method: "phone" } })}
                  >
                    <Phone size={15} />
                    전화 상담 {channelCopy.phoneNumber}
                  </a>
                </div>
              </div>
            </>
          ) : (
            <p className="empty-state">질문을 선택하면 답변과 상담 연결 안내가 표시됩니다.</p>
          )}
          </div>
        )}
      </section>
    </main>
  );
}
