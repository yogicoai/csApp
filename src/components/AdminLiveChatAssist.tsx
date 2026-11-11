"use client";

import { ExternalLink, Loader2, Pencil, Plus, Search, Trash2, Truck } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { ChatSummary, Snippet } from "@/components/AdminLiveChat";
import { AssistPanel, type Shipment, shipmentStatusLabel, shippingText } from "@/components/AssistPanel";
import { appLabel, DEFAULT_SNIPPETS, outcomeLabel, purchasePlaceLabel, TALK_VIA, viaLabel } from "@/lib/liveChatOptions";

// 실시간 채팅상담 콘솔 오른쪽 '상담 도움' — 탭 3개.
//  AI 도우미(기본): 대화를 보고 고객 안내 문구 초안을 만들거나, 상담원 질문에 근거와 함께 답한다.
//  고객·주문: 사전 질문·유입 경로 상세와 자사몰(cafe24) 주문·배송 조회.
//  자주 쓰는 답변: 답변창 위 빠른 문구와 같은 목록의 검색·추가·수정·삭제.
// 어떤 결과도 고객에게 바로 보내지 않고, '고객 안내 문구'만 [답변창에 넣기]로 옮겨 상담원이 다듬어 보낸다.
// 부모가 상담마다 key 를 바꿔 렌더링하므로 AI 결과·주문 조회는 상담별로 초기화된다.

type Tab = "ai" | "customer" | "snippets";
type SnippetDraft = { id: string; title: string; body: string };
type OrderRow = {
  orderId: string;
  orderDate?: string;
  totalItems: number;
  firstItemName?: string;
  paymentAmount?: number;
  shipment: Shipment | null;
};

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "ai", label: "AI 도우미" },
  { key: "customer", label: "고객·주문" },
  { key: "snippets", label: "자주 쓰는 답변" },
];

function formatDateTime(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

function matches(query: string, snippet: { title: string; body: string }) {
  return !query || `${snippet.title} ${snippet.body}`.toLowerCase().includes(query);
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

type AdminLiveChatAssistProps = {
  chat: ChatSummary;
  snippets: Snippet[];
  onSnippetsChange: React.Dispatch<React.SetStateAction<Snippet[]>>;
  onInsert: (text: string) => void;
  // 이전 상담을 누르면 콘솔에서 그 상담을 연다.
  onOpenChat: (chat: ChatSummary) => void;
};

export function AdminLiveChatAssist({ chat, snippets, onSnippetsChange, onInsert, onOpenChat }: AdminLiveChatAssistProps) {
  const [tab, setTab] = useState<Tab>("ai");
  const [related, setRelated] = useState<ChatSummary[] | null>(null);
  const [relatedNote, setRelatedNote] = useState("");
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [ordersNote, setOrdersNote] = useState("");
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [snippetQuery, setSnippetQuery] = useState("");
  const [editing, setEditing] = useState<SnippetDraft | null>(null);
  const [snippetError, setSnippetError] = useState("");
  // 톡톡 상담 구매처 — 상담원이 고른 값(saved)은 상담 정보가 새로 올 때까지만 앞세운다(그사이 고객 답으로 바뀌면 그쪽을 따른다).
  const [placeSaved, setPlaceSaved] = useState<{ value: string; base: string } | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeError, setPlaceError] = useState("");

  // 같은 고객의 이전 상담 — 고객·주문 탭을 처음 열 때 한 번 불러온다.
  useEffect(() => {
    if (tab !== "customer" || related !== null) return;
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/admin/live-chats/${chat.id}/related`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!alive) return;
        setRelated(body.chats ?? []);
        setRelatedNote(response.ok ? (body.reason ?? "") : (body.error ?? "이전 상담을 불러오지 못했습니다."));
      } catch {
        if (alive) setRelatedNote("이전 상담을 불러오지 못했습니다.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, related, chat.id]);

  async function loadOrders() {
    setOrdersBusy(true);
    setOrdersNote("");
    try {
      const response = await fetch(`/api/admin/live-chats/${chat.id}/orders`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOrders(null);
        setOrdersNote(body.error ?? "주문을 조회하지 못했습니다.");
        return;
      }
      setOrders(body.orders ?? []);
      if (body.reason) setOrdersNote(body.reason);
      else if (!body.orders?.length) setOrdersNote("최근 14일 동안의 주문이 없어요.");
    } catch {
      setOrdersNote("주문을 조회하지 못했습니다.");
    } finally {
      setOrdersBusy(false);
    }
  }

  async function changePlace(value: string) {
    setPlaceBusy(true);
    setPlaceError("");
    try {
      const response = await fetch(`/api/admin/live-chats/${chat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchasePlace: value }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setPlaceError(body.error ?? "구매처를 바꾸지 못했어요.");
        return;
      }
      setPlaceSaved({ value, base: chat.intake.purchasePlace });
    } catch {
      setPlaceError("구매처를 바꾸지 못했어요.");
    } finally {
      setPlaceBusy(false);
    }
  }

  async function saveSnippet(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const isNew = !editing.id;
    setSnippetError("");
    try {
      const response = await fetch(isNew ? "/api/admin/live-chat-snippets" : `/api/admin/live-chat-snippets/${editing.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editing.title, body: editing.body }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSnippetError(body.error ?? "문구를 저장하지 못했습니다.");
        return;
      }
      const saved = body.snippet as Snippet;
      onSnippetsChange((prev) => (isNew ? [saved, ...prev] : prev.map((item) => (item.id === saved.id ? saved : item))));
      setEditing(null);
    } catch {
      setSnippetError("문구를 저장하지 못했습니다.");
    }
  }

  async function deleteSnippet(snippet: Snippet) {
    if (!window.confirm(`'${snippet.title}' 문구를 삭제할까요?`)) return;
    try {
      const response = await fetch(`/api/admin/live-chat-snippets/${snippet.id}`, { method: "DELETE" });
      if (!response.ok) {
        setSnippetError("문구를 삭제하지 못했습니다.");
        return;
      }
      onSnippetsChange((prev) => prev.filter((item) => item.id !== snippet.id));
    } catch {
      setSnippetError("문구를 삭제하지 못했습니다.");
    }
  }

  const query = snippetQuery.trim().toLowerCase();
  const defaultSnippets = DEFAULT_SNIPPETS.filter((snippet) => matches(query, snippet));
  const customSnippets = snippets.filter((snippet) => matches(query, snippet));
  const source = chat.source;
  const sourceText = source.via
    ? [viaLabel(source.via), source.app ? appLabel(source.app) : "", source.parentOrigin.replace(/^https?:\/\//, "")]
        .filter(Boolean)
        .join(" · ")
    : "기록 없음";
  const isTalk = source.via === TALK_VIA;
  const place = placeSaved && placeSaved.base === chat.intake.purchasePlace ? placeSaved.value : chat.intake.purchasePlace;
  const defaultPlace = chat.talk.defaultPlace ?? "";
  // AI 도우미가 실제로 쓰는 기준 — 스마트스토어·공식몰만 기준이 되고, 그 밖의 값은 모름
  const placeBasis = place === "smartstore" || place === "official" ? place : place ? "" : defaultPlace;
  const autoLabel = defaultPlace ? `자동 — ${purchasePlaceLabel(defaultPlace)}(톡톡 계정 기준)` : "모름 — AI가 먼저 물어봐요";

  return (
    <div className="lc-assist-inner">
      <div className="lc-tabs lc-assist-tabs" role="tablist" aria-label="상담 도움">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={tab === item.key ? "active" : ""}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "ai" && isTalk && (
        <div className="lc-place">
          <label>
            고객 구매처
            <select value={place} disabled={placeBusy} onChange={(event) => void changePlace(event.target.value)}>
              <option value="">{autoLabel}</option>
              <option value="smartstore">네이버 스마트스토어</option>
              <option value="official">요기보 공식몰(네이버페이 결제 포함)</option>
              {place && place !== "smartstore" && place !== "official" && <option value={place}>{purchasePlaceLabel(place)}</option>}
            </select>
          </label>
          <p>
            {placeBasis === "smartstore"
              ? "AI 도우미가 스마트스토어 기준으로 쓰고, 주문은 스마트스토어에서만 찾아요."
              : placeBasis === "official"
                ? "AI 도우미가 공식몰 기준으로 쓰고, 주문은 자사몰에서만 찾아요."
                : "구매처에 따라 달라지는 문의면 AI 초안이 먼저 구매처를 물어봐요. 주문은 두 곳 모두에서 찾아요."}
          </p>
          {placeError && <p className="lc-place-error">{placeError}</p>}
        </div>
      )}

      <AssistPanel
        hidden={tab !== "ai"}
        endpoint={`/api/admin/live-chats/${chat.id}/assist`}
        onInsert={onInsert}
        intro="고객 메시지를 읽고 [답변 초안 만들기]를 누르면 FAQ와 검증된 응대 사례를 근거로 고객 안내 문구를 만들어요. 확인 후 [답변창에 넣기]로 옮겨 보내세요."
      />

      {tab === "customer" && (
        <section className="lc-assist-section">
          <dl className="lc-facts">
            <Fact label="상담번호">{chat.ticketNo || "—"}</Fact>
            <Fact label="유입 경로">{sourceText}</Fact>
            <Fact label="구매처">
              {place ? purchasePlaceLabel(place) : isTalk ? (defaultPlace ? `${purchasePlaceLabel(defaultPlace)}(톡톡 계정 기준)` : "모름") : "미입력"}
            </Fact>
            <Fact label="문의 유형">{chat.intake.inquiryType || "미입력"}</Fact>
            <Fact label="주문번호">{chat.intake.orderNumber || "미입력"}</Fact>
            {chat.memberId && <Fact label="회원ID">{chat.memberId}</Fact>}
            {chat.entry.faqQuestion && (
              <Fact label="보던 FAQ">
                {chat.entry.faqId ? (
                  <a href={`/guide/${chat.channel}/answer/${chat.entry.faqId}`} target="_blank" rel="noreferrer">
                    {chat.entry.faqQuestion} <ExternalLink size={12} />
                  </a>
                ) : (
                  chat.entry.faqQuestion
                )}
              </Fact>
            )}
            {chat.entry.aiQuery && <Fact label="AI 질문">{chat.entry.aiQuery}</Fact>}
            <Fact label="접수">
              {formatDateTime(chat.createdAt)}
              {chat.offHours && " · 운영시간 외"}
            </Fact>
          </dl>
          <button type="button" className="lc-assist-btn" onClick={() => void loadOrders()} disabled={ordersBusy}>
            {ordersBusy ? <Loader2 size={14} className="spin-icon" /> : <Truck size={14} />}
            자사몰 주문·배송 조회
          </button>
          {ordersNote && <p className="lc-assist-note">{ordersNote}</p>}
          {orders && orders.length > 0 && (
            <ul className="lc-orders">
              {orders.map((order) => (
                <li key={order.orderId}>
                  <div className="lc-order-top">
                    <strong>{order.orderId}</strong>
                    {order.orderDate && <span>{order.orderDate.slice(0, 10)}</span>}
                  </div>
                  {order.firstItemName && (
                    <p>
                      {order.firstItemName}
                      {order.totalItems > 1 && ` 외 ${order.totalItems - 1}건`}
                    </p>
                  )}
                  <p className="lc-order-status">
                    {order.shipment
                      ? `${shipmentStatusLabel(order.shipment.status)} · ${order.shipment.carrierName}${order.shipment.trackingNumber ? ` ${order.shipment.trackingNumber}` : ""}`
                      : "배송 정보 없음"}
                  </p>
                  <button type="button" className="lc-assist-link" onClick={() => onInsert(shippingText(order))}>
                    배송 안내 넣기
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="lc-related">
            <p className="lc-related-title">이전 상담</p>
            {related === null && !relatedNote && (
              <p className="lc-assist-note">
                <Loader2 size={13} className="spin-icon" /> 불러오는 중…
              </p>
            )}
            {relatedNote && <p className="lc-assist-note">{relatedNote}</p>}
            {related?.length === 0 && !relatedNote && <p className="lc-assist-note">같은 고객의 다른 상담이 없어요.</p>}
            {related && related.length > 0 && (
              <ul>
                {related.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => onOpenChat(item)}>
                      <span className="lc-related-top">
                        <strong>{item.ticketNo || "번호 없음"}</strong>
                        <span>{formatDateTime(item.createdAt)}</span>
                      </span>
                      <span className="lc-related-meta">
                        {item.status === "closed" ? outcomeLabel(item.outcome.result) : "진행 중"} · {item.lastMessagePreview}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {tab === "snippets" && (
        <section className="lc-assist-section">
          <div className="lc-assist-head">
            <label className="lc-assist-search">
              <Search size={14} />
              <input value={snippetQuery} onChange={(event) => setSnippetQuery(event.target.value)} placeholder="문구 검색" />
            </label>
            <button type="button" className="lc-assist-link" onClick={() => setEditing({ id: "", title: "", body: "" })}>
              <Plus size={13} /> 문구 추가
            </button>
          </div>
          {editing && (
            <form className="lc-snippet-form" onSubmit={saveSnippet}>
              <input
                value={editing.title}
                onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                placeholder="제목 (예: 반품 주소 안내)"
                maxLength={40}
              />
              <textarea
                value={editing.body}
                onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                placeholder="답변창에 들어갈 내용"
                maxLength={1000}
                rows={3}
              />
              <div className="lc-snippet-form-actions">
                <button type="submit" disabled={!editing.title.trim() || !editing.body.trim()}>
                  저장
                </button>
                <button type="button" onClick={() => setEditing(null)}>
                  취소
                </button>
              </div>
            </form>
          )}
          {snippetError && <p className="lc-error">{snippetError}</p>}
          <p className="lc-assist-note">누르면 답변창에 들어가요. 답변창 위 빠른 문구에도 같은 목록이 보여요.</p>
          <ul className="lc-snippets">
            {defaultSnippets.map((snippet) => (
              <li key={`default-${snippet.title}`}>
                <button type="button" className="lc-snippet" onClick={() => onInsert(snippet.body)}>
                  <strong>{snippet.title}</strong>
                  <span>{snippet.body}</span>
                </button>
              </li>
            ))}
            {customSnippets.map((snippet) => (
              <li key={snippet.id} className="is-custom">
                <button type="button" className="lc-snippet" onClick={() => onInsert(snippet.body)}>
                  <strong>{snippet.title}</strong>
                  <span>{snippet.body}</span>
                </button>
                <div className="lc-snippet-actions">
                  <button type="button" aria-label="수정" onClick={() => setEditing({ ...snippet })}>
                    <Pencil size={13} />
                  </button>
                  <button type="button" aria-label="삭제" onClick={() => void deleteSnippet(snippet)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
