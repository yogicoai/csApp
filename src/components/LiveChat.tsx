"use client";

import { Loader2, MessageCircle, Send, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { isLiveChatOpen, LIVE_CHAT_HOURS_LABEL } from "@/lib/liveChatHours";
import {
  DEFAULT_INQUIRY_TYPES,
  OTHER_INQUIRY_TYPE,
  PURCHASE_PLACES,
  purchasePlaceLabel,
  type PurchasePlace,
} from "@/lib/liveChatOptions";
import { getSessionId } from "@/lib/session";
import { getVisitSource } from "@/lib/visitSource";

// 고객용 실시간 상담 — 카카오 상담 버튼을 대체한다.
// 자사몰 iframe 이 콘텐츠 높이만큼 늘어나는 구조라 화면 고정 팝업 대신 버튼 자리에서 펼쳐지는 카드로 띄운다.
// 진행 중인 대화방은 localStorage 에 보관해, 대화창을 접거나 페이지를 다시 열어도 이어서 볼 수 있다.

type ChatStatus = "waiting" | "active" | "closed";
type ChatMessage = {
  seq: number;
  sender: "visitor" | "agent" | "system";
  text: string;
  createdAt: string;
};
type StoredChat = { id: string; token: string };

export type LiveChatEntry = {
  faqId?: string;
  faqQuestion?: string;
  category?: string;
  aiQuery?: string;
};

const POLL_MS = 3000;
const TOKEN_HEADER = "x-live-chat-token";
const STATUS_LABEL: Record<ChatStatus, string> = {
  waiting: "상담원 연결 대기 중",
  active: "상담원과 대화 중",
  closed: "종료된 상담",
};

function storageKey(channel: string) {
  return `cs_live_chat:${channel}`;
}

function readStoredChat(channel: string): StoredChat | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(channel)) ?? "null");
    return typeof value?.id === "string" && typeof value?.token === "string" ? value : null;
  } catch {
    return null;
  }
}

function writeStoredChat(channel: string, value: StoredChat | null) {
  try {
    if (value) window.localStorage.setItem(storageKey(channel), JSON.stringify(value));
    else window.localStorage.removeItem(storageKey(channel));
  } catch {
    // 저장소가 막힌 환경(시크릿 모드 등)에서는 이 화면에서만 대화가 유지된다.
  }
}

// 답변 안내 문자 속 링크(?chat=id.token)로 들어오면 그 대화를 이 브라우저에 보관해, 어느 기기에서든 이어서 보게 한다.
export function rememberLiveChat(channel: string, id: string, token: string) {
  writeStoredChat(channel, { id, token });
}

function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]) {
  if (incoming.length === 0) return prev;
  const bySeq = new Map(prev.map((message) => [message.seq, message]));
  for (const message of incoming) bySeq.set(message.seq, message);
  return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
}

// 동시에 저장된 메시지는 늦게 조회될 수 있어, 빈틈 없이 이어진 마지막 순번까지만 받은 것으로 친다.
function contiguousSeq(messages: ChatMessage[]) {
  let seq = 0;
  for (const message of messages) {
    if (message.seq !== seq + 1) break;
    seq = message.seq;
  }
  return seq;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function subscribeEveryMinute(callback: () => void) {
  const timer = window.setInterval(callback, 60_000);
  return () => window.clearInterval(timer);
}

// 상담 시작 전 사전 질문을 채팅 말풍선처럼 보여주는 봇 멘트.
function BotMsg({ author, children }: { author?: boolean; children: React.ReactNode }) {
  return (
    <div className="live-chat-msg is-bot">
      {author && <span className="live-chat-author">요기보 고객센터</span>}
      <div className="live-chat-bubble">{children}</div>
    </div>
  );
}

// 봇이 입력 중인 것처럼 보여주는 점 세 개 — 다음 질문이 나오기 직전에 잠깐 표시한다.
function BotTyping() {
  return (
    <div className="live-chat-msg is-bot">
      <div className="live-chat-bubble live-chat-typing" aria-label="입력 중">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

// 고객이 칩으로 고른 답 — 보낸 메시지처럼 보여주고, 상담 시작 전에는 다시 고를 수 있다.
function PickedAnswer({ text, onRedo }: { text: string; onRedo?: () => void }) {
  return (
    <div className="live-chat-msg is-mine">
      <div className="live-chat-bubble">{text}</div>
      {onRedo && (
        <button type="button" className="live-chat-redo" onClick={onRedo}>
          다시 고르기
        </button>
      )}
    </div>
  );
}

// 지금 상담 운영시간인지 — 서버 렌더에서는 null(표시 안 함), 브라우저에서는 1분마다 다시 계산한다.
export function useLiveChatHoursOpen() {
  return useSyncExternalStore(subscribeEveryMinute, isLiveChatOpen, () => null);
}

// 연차 관리에서 지정/해제했을 때 같은 화면의 다른 표시(사이드바 상태 등)도 바로 갱신하기 위한 신호.
export const CLOSURE_CHANGED_EVENT = "cs-closure-changed";

export type LiveChatClosureInfo = {
  date: string;
  type: "full" | "am" | "pm";
  closedNow: boolean;
  hoursLabel: string;
  nextOpenLabel: string;
  message: string;
};

const CLOSURE_REFRESH_MS = 5 * 60_000;

// 상담 가능 상태 — closure: 오늘 상담사 휴가(undefined 확인 중, null 없음, 객체면 closedNow 로 지금 닫혔는지),
// nextOpenLabel: 지금 닫혀 있으면(운영시간 외·휴무) 다음에 답변을 시작하는 때.
// 반차는 시간이 지나면 열리고 닫히므로 5분마다 다시 확인한다.
export function useLiveChatStatus() {
  const [closure, setClosure] = useState<LiveChatClosureInfo | null | undefined>(undefined);
  const [nextOpenLabel, setNextOpenLabel] = useState("");

  useEffect(() => {
    let alive = true;

    async function load() {
      // 조회가 늦거나 실패하면 운영시간 기준으로만 동작하도록 '열림'으로 본다.
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch("/api/live-chat/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = response.ok
          ? ((await response.json()) as {
              closure?: LiveChatClosureInfo | null;
              nextOpenLabel?: string;
            })
          : null;
        if (!alive) return;
        setClosure(body?.closure ?? null);
        setNextOpenLabel(body?.nextOpenLabel ?? "");
      } catch {
        if (alive) setClosure(null);
      } finally {
        window.clearTimeout(timeout);
      }
    }

    const timer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), CLOSURE_REFRESH_MS);
    const onChanged = () => void load();
    window.addEventListener(CLOSURE_CHANGED_EVENT, onChanged);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener(CLOSURE_CHANGED_EVENT, onChanged);
    };
  }, []);

  return { closure, nextOpenLabel };
}

export function useLiveChatClosure() {
  return useLiveChatStatus().closure;
}

// 문의 접수 휴대폰 — 서버와 같은 규칙(010 등 휴대폰, 숫자만).
function validMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  return /^01[016789]\d{7,8}$/.test(digits) ? digits : "";
}

type LiveChatButtonProps = {
  channel: string;
  entry?: LiveChatEntry;
  memberId?: string;
  inquiryTypes?: string[];
  className?: string;
  onOpen?: () => void;
  // 한 화면에 버튼이 여러 개일 때 대화창이 하나만 열리도록 부모가 열림 상태를 제어할 수 있다.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
};

export function LiveChatButton({
  channel,
  entry,
  memberId,
  inquiryTypes,
  className,
  onOpen,
  open: controlledOpen,
  onOpenChange,
  children,
}: LiveChatButtonProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;

  function setOpen(next: boolean) {
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  }

  if (open) {
    return (
      <LiveChatPanel
        channel={channel}
        entry={entry}
        memberId={memberId}
        inquiryTypes={inquiryTypes}
        onClose={() => setOpen(false)}
      />
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onOpen?.();
        setOpen(true);
      }}
    >
      {children}
    </button>
  );
}

type LiveChatPanelProps = {
  channel: string;
  entry?: LiveChatEntry;
  memberId?: string;
  // 문의 유형 선택지 — 셀프가이드의 FAQ 카테고리. 없으면 기본 목록을 쓴다.
  inquiryTypes?: string[];
  onClose: () => void;
};

export function LiveChatPanel({ channel, entry, memberId, inquiryTypes, onClose }: LiveChatPanelProps) {
  // 패널은 버튼 클릭 후에만 마운트되므로 첫 렌더에서 바로 localStorage 를 읽어도 된다.
  const [stored, setStored] = useState<StoredChat | null>(() => readStoredChat(channel));
  // 상담 시작 전 사전 질문 — 구매처는 필수, 문의 유형은 보던 FAQ 카테고리로 미리 고른다.
  const baseTypes = inquiryTypes?.length ? inquiryTypes : DEFAULT_INQUIRY_TYPES;
  // 보던 FAQ 카테고리가 목록에 없으면(새 카테고리 등) 맨 앞에 넣어 미리 선택되게 한다.
  const withEntry = entry?.category && !baseTypes.includes(entry.category) ? [entry.category, ...baseTypes] : baseTypes;
  // 어느 유형에도 맞지 않는 문의를 위해 '기타문의'는 항상 맨 끝에 둔다.
  const typeOptions = withEntry.includes(OTHER_INQUIRY_TYPE) ? withEntry : [...withEntry, OTHER_INQUIRY_TYPE];
  const [purchasePlace, setPurchasePlace] = useState<PurchasePlace | "">("");
  const [inquiryType, setInquiryType] = useState(() => entry?.category ?? "");
  const [orderNumber, setOrderNumber] = useState("");
  // 주문번호 질문에 답했는지(입력 또는 건너뛰기) — 답해야 입력창이 열린다.
  const [orderDone, setOrderDone] = useState(false);
  // 이 화면에서 사전 질문을 진행했을 때만 질문 말풍선을 계속 보여준다(이어보기로 돌아오면 숨김).
  const [showScript, setShowScript] = useState(() => !readStoredChat(channel));
  // 사전 질문 말풍선을 지금까지 몇 개 보여줬는지 — 실제 봇이 말하듯 하나씩 늘린다.
  const [revealed, setRevealed] = useState(() => (readStoredChat(channel) ? 8 : 0));
  const orderInputId = useId();
  const [status, setStatus] = useState<ChatStatus | null>(null);
  // 상담번호 — 고객이 전화 등 다른 경로로 문의할 때 이 상담을 가리킬 수 있게 보여준다.
  const [ticketNo, setTicketNo] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [error, setError] = useState("");
  const lastSeqRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const closed = status === "closed";
  const { closure, nextOpenLabel } = useLiveChatStatus();
  // 상담사 휴가 시간(연차 종일, 오전반차 14시 전, 오후반차 13시 후)이면 실시간 대화는 닫힘
  const closedToday = Boolean(closure?.closedNow);
  const closureKnown = closure !== undefined;
  const hoursFlag = useLiveChatHoursOpen();
  const hoursOpen = hoursFlag === true && !closedToday;
  // 문의 접수 — 운영시간 외·휴무에는 실시간 대화 대신 휴대폰(답변 안내 문자)과 동의를 받고 접수한다.
  // 화면 시계와 서버 판단이 경계 시각에 어긋나면 서버 응답(needContact)을 따른다.
  const [needContact, setNeedContact] = useState(false);
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [offHoursChat, setOffHoursChat] = useState(false);
  const ticketMode = !stored && ((closureKnown && hoursFlag !== null && !hoursOpen) || needContact);
  const receiptView = ticketMode || offHoursChat;
  const openLabel = nextOpenLabel || closure?.nextOpenLabel || "다음 영업일";

  const applyMessages = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const merged = mergeMessages(prev, incoming);
      lastSeqRef.current = contiguousSeq(merged);
      return merged;
    });
  }, []);

  const resetChat = useCallback(() => {
    writeStoredChat(channel, null);
    lastSeqRef.current = 0;
    setStored(null);
    setStatus(null);
    setTicketNo("");
    setMessages([]);
    setConfirmEnd(false);
    // 새 상담은 사전 질문부터 다시 시작한다.
    setPurchasePlace("");
    setInquiryType(entry?.category ?? "");
    setOrderNumber("");
    setOrderDone(false);
    setShowScript(true);
    setRevealed(0);
    setError("");
    setNeedContact(false);
    setOffHoursChat(false);
  }, [channel, entry?.category]);

  const poll = useCallback(
    async (chat: StoredChat) => {
      try {
        const response = await fetch(`/api/live-chat/${chat.id}?after=${lastSeqRef.current}`, {
          headers: { [TOKEN_HEADER]: chat.token },
          cache: "no-store",
        });
        if (response.status === 404) {
          resetChat();
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as {
          chat: { status: ChatStatus; ticketNo?: string; offHours?: boolean };
          messages: ChatMessage[];
        };
        setStatus(body.chat.status);
        setTicketNo(body.chat.ticketNo ?? "");
        setOffHoursChat(Boolean(body.chat.offHours));
        applyMessages(body.messages ?? []);
      } catch {
        // 일시적인 네트워크 오류는 다음 폴링에서 다시 시도한다.
      }
    },
    [applyMessages, resetChat],
  );

  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  useEffect(() => {
    if (!stored || closed) return;
    const tick = () => {
      if (!document.hidden) void poll(stored);
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [stored, closed, poll]);

  const intakeReady = Boolean(purchasePlace && inquiryType && orderDone);

  // 사전 질문 말풍선을 한 번에 다 보여주지 않고, 실제 봇이 말하듯 하나씩 차례로 보여준다.
  // revealed = 지금까지 보여준 항목 수. 항목 순서:
  // 0 인사 → 1 구매처 질문 → 2 구매처 칩 → 3 문의유형 질문 → 4 문의유형 칩 → 5 주문번호 질문 → 6 주문번호 입력 → 7 마지막 안내
  const answeredCount = (purchasePlace ? 1 : 0) + (purchasePlace && inquiryType ? 1 : 0) + (intakeReady ? 1 : 0);
  const scriptTarget = [3, 5, 7, 8][answeredCount];
  const nextIsBot = [0, 1, 3, 5, 7].includes(revealed);
  // 입력창은 상담이 이어지는 중이거나, 사전 질문이 모두 끝나 마지막 안내가 나온 뒤에만 보인다.
  const composerVisible = Boolean(stored) || (intakeReady && revealed >= 8);
  // 새 상담을 시작하는 사전 질문은 오늘 휴무인지(실시간 대화인지 문의 접수인지) 확인된 뒤에 보여준다.
  const scriptActive = showScript && !stored && closureKnown;

  // 입력창이 나타나는 순간 바로 쓸 수 있게 포커스를 준다.
  useEffect(() => {
    if (!stored && composerVisible) draftRef.current?.focus();
  }, [stored, composerVisible]);

  useEffect(() => {
    if (!scriptActive || revealed >= scriptTarget) return;
    const delay = revealed === 0 ? 350 : [0, 1, 3, 5, 7].includes(revealed) ? 700 : 250;
    const timer = window.setTimeout(() => setRevealed((prev) => Math.min(scriptTarget, prev + 1)), delay);
    return () => window.clearTimeout(timer);
  }, [scriptActive, revealed, scriptTarget]);

  // 사전 질문이 한 단계씩 열릴 때도 채팅처럼 아래로 따라 내려간다.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages.length, purchasePlace, inquiryType, orderDone, revealed]);

  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");

    try {
      if (!stored) {
        if (!intakeReady) {
          setError("위 질문에 먼저 답해 주세요.");
          return;
        }
        const mobile = validMobile(phone);
        if (ticketMode && !mobile) {
          setError("답변 안내를 받을 휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)");
          return;
        }
        if (ticketMode && !consent) {
          setError("개인정보 수집·이용에 동의해 주셔야 문의를 접수할 수 있어요.");
          return;
        }
        const response = await fetch("/api/live-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel,
            sessionId: getSessionId(),
            memberId: memberId || undefined,
            text,
            entry,
            intake: {
              purchasePlace,
              inquiryType: inquiryType || undefined,
              orderNumber: orderNumber.trim() || undefined,
            },
            source: getVisitSource(),
            ...(ticketMode ? { contact: { phone: mobile, consent } } : {}),
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          // 운영시간이 막 끝난 경우 등 — 서버가 문의 접수로 받겠다고 하면 연락처 입력을 띄운다.
          if (body.needContact) setNeedContact(true);
          setError(body.error ?? "실시간 상담을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
          return;
        }
        const next = {
          id: body.chat.id as string,
          token: body.token as string,
        };
        writeStoredChat(channel, next);
        applyMessages(body.messages ?? []);
        setStatus(body.chat.status);
        setTicketNo(body.chat.ticketNo ?? "");
        setOffHoursChat(Boolean(body.chat.offHours));
        setStored(next);
      } else {
        const response = await fetch(`/api/live-chat/${stored.id}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [TOKEN_HEADER]: stored.token,
          },
          body: JSON.stringify({ text }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.status === 409) {
          setStatus("closed");
          setError(body.error ?? "종료된 상담이에요.");
          return;
        }
        if (!response.ok) {
          setError(body.error ?? "메시지를 보내지 못했어요. 다시 시도해 주세요.");
          return;
        }
        applyMessages([body.message]);
      }
      setDraft("");
    } catch {
      setError("메시지를 보내지 못했어요. 네트워크 상태를 확인해 주세요.");
    } finally {
      setSending(false);
    }
  }

  async function endChat() {
    if (!stored) return;
    setConfirmEnd(false);
    try {
      const response = await fetch(`/api/live-chat/${stored.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          [TOKEN_HEADER]: stored.token,
        },
        body: JSON.stringify({ status: "closed" }),
      });
      if (response.ok) await poll(stored);
    } catch {
      setError("상담을 종료하지 못했어요. 다시 시도해 주세요.");
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중 Enter 는 글자 확정이라 보내지 않는다. 모바일은 Enter 를 줄바꿈으로 둔다.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    event.preventDefault();
    void send();
  }

  const statusText = status
    ? status === "waiting" && offHoursChat
      ? "접수 완료 · 답변 대기"
      : STATUS_LABEL[status]
    : closure?.closedNow
      ? `${closure.type === "am" ? "오전 휴무" : "오늘 휴무"} · ${openLabel}부터 답변`
      : hoursOpen
        ? `상담 가능 · ${closure?.hoursLabel || LIVE_CHAT_HOURS_LABEL}`
        : `운영시간 외 · ${openLabel}부터 답변`;

  return (
    <div className="live-chat" ref={panelRef}>
      <header className="live-chat-head">
        <div className="live-chat-title">
          <span className="live-chat-title-icon">
            <MessageCircle size={16} />
          </span>
          <div>
            <strong>{receiptView ? "문의 접수" : "실시간 채팅상담"}</strong>
            <span
              className={status === "active" || (!status && hoursOpen) ? "live-chat-status is-on" : "live-chat-status"}
            >
              {statusText}
            </span>
            {ticketNo && <span className="live-chat-ticket">상담번호 {ticketNo}</span>}
          </div>
        </div>
        <div className="live-chat-head-actions">
          {stored && status && !closed && !confirmEnd && (
            <button type="button" className="live-chat-end" onClick={() => setConfirmEnd(true)}>
              상담 종료
            </button>
          )}
          {confirmEnd && (
            <>
              <button type="button" className="live-chat-end is-danger" onClick={() => void endChat()}>
                종료하기
              </button>
              <button type="button" className="live-chat-end" onClick={() => setConfirmEnd(false)}>
                취소
              </button>
            </>
          )}
          <button type="button" className="live-chat-close" aria-label="대화창 접기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="live-chat-body" ref={bodyRef}>
        {showScript && (
          <>
            {revealed >= 1 &&
              (receiptView ? (
                // 운영시간 외·휴무 — 실시간 대화 대신 문의를 접수하고, 답변은 휴대폰 문자로 안내한다.
                <div className="live-chat-closed-day">
                  <BotMsg author>
                    {closure?.closedNow
                      ? closure.message
                      : `지금은 상담 운영시간(${LIVE_CHAT_HOURS_LABEL})이 아니라 실시간 대화 대신 문의를 접수해요.`}
                  </BotMsg>
                  <p className="live-chat-offhours">
                    남겨 주시면 {openLabel}부터 순서대로 확인해 휴대폰 문자로 답변 안내를 드려요. 그 전에 자주 묻는
                    질문이나 ‘AI에게 바로 질문하기’로 찾아보시면 바로 해결될 수도 있어요.
                  </p>
                </div>
              ) : (
                <BotMsg author>궁금한 내용을 남겨주시면 상담원이 이 화면에서 바로 답변드려요.</BotMsg>
              ))}
            {revealed >= 2 && <BotMsg>어디서 구매하셨나요?</BotMsg>}
            {revealed >= 3 &&
              (purchasePlace ? (
                <PickedAnswer
                  text={purchasePlaceLabel(purchasePlace)}
                  onRedo={stored ? undefined : () => setPurchasePlace("")}
                />
              ) : (
                <div className="live-chat-chips">
                  {PURCHASE_PLACES.map((place) => (
                    <button
                      type="button"
                      key={place.key}
                      className="live-chat-chip"
                      onClick={() => setPurchasePlace(place.key)}
                    >
                      {place.label}
                    </button>
                  ))}
                </div>
              ))}
            {purchasePlace && revealed >= 4 && <BotMsg>어떤 문의인가요?</BotMsg>}
            {purchasePlace &&
              revealed >= 5 &&
              (inquiryType ? (
                <PickedAnswer text={inquiryType} onRedo={stored ? undefined : () => setInquiryType("")} />
              ) : (
                <div className="live-chat-chips">
                  {typeOptions.map((type) => (
                    <button type="button" key={type} className="live-chat-chip" onClick={() => setInquiryType(type)}>
                      {type}
                    </button>
                  ))}
                </div>
              ))}
            {purchasePlace && inquiryType && revealed >= 6 && (
              <BotMsg>주문번호를 알고 계시면 적어 주세요. 몰라도 괜찮아요.</BotMsg>
            )}
            {purchasePlace && inquiryType && revealed >= 7 && (
              <>
                {orderDone ? (
                  <PickedAnswer
                    text={orderNumber.trim() || "주문번호를 몰라요"}
                    onRedo={stored ? undefined : () => setOrderDone(false)}
                  />
                ) : (
                  <>
                    <div className="live-chat-order-row">
                      <input
                        id={orderInputId}
                        className="live-chat-order"
                        value={orderNumber}
                        onChange={(event) => setOrderNumber(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                          event.preventDefault();
                          if (orderNumber.trim()) setOrderDone(true);
                        }}
                        placeholder="예: 20261020-0001234"
                        maxLength={40}
                      />
                      <button
                        type="button"
                        className="live-chat-chip"
                        disabled={!orderNumber.trim()}
                        onClick={() => setOrderDone(true)}
                      >
                        입력
                      </button>
                    </div>
                    <div className="live-chat-chips">
                      <button
                        type="button"
                        className="live-chat-chip"
                        onClick={() => {
                          setOrderNumber("");
                          setOrderDone(true);
                        }}
                      >
                        주문번호를 몰라요
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            {intakeReady && !stored && revealed >= 8 && (
              <BotMsg>
                {ticketMode
                  ? "답변 안내를 받을 휴대폰 번호와 문의 내용을 남겨 주세요. 자세히 적어 주실수록 빠르게 도와드릴 수 있어요."
                  : "문의 내용을 아래 입력창에 적어 주세요. 자세히 적어 주실수록 빠르게 도와드릴 수 있어요."}
              </BotMsg>
            )}
            {!stored && revealed < scriptTarget && nextIsBot && <BotTyping />}
          </>
        )}
        {stored && !status && (
          <p className="live-chat-loading">
            <Loader2 size={16} className="spin-icon" /> 상담 내역을 불러오는 중…
          </p>
        )}
        {messages.map((message) =>
          message.sender === "system" ? (
            <p className="live-chat-system" key={message.seq}>
              {message.text}
            </p>
          ) : (
            <div
              className={message.sender === "visitor" ? "live-chat-msg is-mine" : "live-chat-msg is-agent"}
              key={message.seq}
            >
              {message.sender === "agent" && <span className="live-chat-author">상담원</span>}
              <div className="live-chat-bubble">{message.text}</div>
              <time className="live-chat-time">{formatTime(message.createdAt)}</time>
            </div>
          ),
        )}
      </div>

      {error && <p className="live-chat-error">{error}</p>}

      {closed ? (
        <div className="live-chat-closed">
          <span>상담이 종료되었어요.</span>
          <button type="button" onClick={resetChat}>
            새 상담 시작
          </button>
        </div>
      ) : (
        // 입력창도 사전 질문이 끝난 뒤에야 나타난다 — 질문 단계에서는 칩만 보인다.
        composerVisible && (
          <>
            {ticketMode && (
              <div className="live-chat-contact">
                <input
                  className="live-chat-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="답변 받을 휴대폰 번호 (예: 010-1234-5678)"
                  aria-label="답변 안내를 받을 휴대폰 번호"
                  maxLength={13}
                />
                <label className="live-chat-consent">
                  <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                  <span>[필수] 개인정보 수집·이용 동의</span>
                </label>
                <p className="live-chat-consent-detail">
                  수집 항목: 휴대폰 번호 · 이용 목적: 문의 답변 안내 문자 발송 · 보유 기간: 상담 기록과 함께 3년 보관 후
                  파기. 동의하지 않으시면 문의 접수가 어려워요.
                </p>
              </div>
            )}
            <form className="live-chat-form" onSubmit={send}>
              <textarea
                ref={draftRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  stored
                    ? "메시지를 입력해 주세요"
                    : ticketMode
                      ? "문의 내용 (예: 주문한 제품 커버 지퍼가 고장났어요)"
                      : "예: 주문한 제품 커버 지퍼가 고장났어요"
                }
                maxLength={1000}
                rows={2}
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending || Boolean(stored && !status)}
                aria-label={ticketMode ? "문의 접수하기" : "보내기"}
              >
                {sending ? <Loader2 size={18} className="spin-icon" /> : <Send size={18} />}
              </button>
            </form>
          </>
        )
      )}
      {(composerVisible || closed) && (
        <p className="live-chat-note">
          카드번호·비밀번호 같은 민감한 정보는 입력하지 마세요. 상담 내용은 상담 품질 향상과 AI 상담 보조를 위해 처리될
          수 있어요.
        </p>
      )}
    </div>
  );
}
