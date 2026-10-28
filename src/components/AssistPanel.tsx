"use client";

import { Copy, Loader2, Send, Sparkles, Truck } from "lucide-react";
import type React from "react";
import { useState } from "react";

// AI 도우미 — 답변 초안 만들기 + AI에게 묻기(근거·주문 조회). 실시간 상담과 게시판 관리가 같이 쓴다.
// 어떤 결과도 고객에게 바로 보내지 않고, '고객 안내 문구'만 [답변창에 넣기]로 옮겨 상담원이 다듬어 보낸다.
// 부모가 상담·글마다 key 를 바꿔 렌더링하므로 결과는 상담·글별로 초기화된다.

export type Shipment = { status: string; carrierName: string; trackingNumber: string; trackingUrl: string };
type AssistSource = { type: "faq" | "claim"; id: string; title: string; category: string };
// AI 도우미가 찾은 주문 — 답변에서는 '주문 A'처럼 부르고, 주문번호·이름·연락처는 이 카드에만 보인다.
type AssistOrder = {
  label: string;
  // 자사몰(실시간) · 스마트스토어 · 매장 택배(사본 — asOf 기준 시각)
  channel: string;
  asOf?: string;
  note?: string;
  orderId: string;
  orderDate: string;
  matchedBy: Array<"buyer" | "receiver" | "orderId" | "member">;
  buyerName: string;
  receiverName: string;
  phoneLast4: string;
  items: Array<{ name: string; option: string; quantity: number }>;
  status: string;
  shipment: Shipment | null;
};
type AssistResult = {
  key: number;
  mode: "draft" | "ask";
  question: string;
  internal: string;
  customerText: string;
  sources: AssistSource[];
  orders: AssistOrder[];
};

const SHIPMENT_STATUS: Record<string, string> = { standby: "배송 대기", shipping: "배송 중", shipped: "배송 완료" };

export function shipmentStatusLabel(status: string) {
  return SHIPMENT_STATUS[status] ?? status;
}

export function shippingText(order: { shipment: Shipment | null; status?: string }) {
  if (!order.shipment) return "주문하신 상품은 아직 배송 정보가 등록되지 않았어요. 출고되면 송장번호로 배송을 조회하실 수 있어요.";
  const { status, carrierName, trackingNumber, trackingUrl } = order.shipment;
  // 스마트스토어·매장 택배 사본은 송장에 상태가 따로 없어 주문 상태로 말한다.
  const label = shipmentStatusLabel(status) || order.status;
  const parts = label ? [`주문하신 상품은 현재 '${label}' 상태예요.`] : [];
  if (trackingNumber) parts.push(`${carrierName ? `${carrierName} ` : ""}송장번호 ${trackingNumber}로 배송 위치를 확인하실 수 있어요.`);
  if (trackingUrl && trackingUrl !== "#") parts.push(trackingUrl);
  return parts.join(" ");
}

function orderItemsText(order: AssistOrder) {
  const [first, ...rest] = order.items;
  if (!first) return "상품 정보 없음";
  const name = `${first.name}${first.option ? ` (${first.option})` : ""}${first.quantity ? ` ${first.quantity}개` : ""}`;
  return rest.length ? `${name} 외 ${rest.length}건` : name;
}

function orderPeopleText(order: AssistOrder) {
  const parts = [order.buyerName && `주문자 ${order.buyerName}`];
  if (order.receiverName && order.receiverName !== order.buyerName) parts.push(`받는 분 ${order.receiverName}`);
  if (order.phoneLast4) parts.push(`휴대폰 끝 ${order.phoneLast4}`);
  return parts.filter(Boolean).join(" · ");
}

type AssistPanelProps = {
  endpoint: string;
  // 요청에 함께 보낼 값 — 게시판 관리는 보고 있는 글을 같이 보낸다.
  extraBody?: Record<string, unknown>;
  onInsert: (text: string) => void;
  intro: string;
  askPlaceholder?: string;
  hidden?: boolean;
};

export function AssistPanel({ endpoint, extraBody, onInsert, intro, askPlaceholder, hidden }: AssistPanelProps) {
  const [question, setQuestion] = useState("");
  const [results, setResults] = useState<AssistResult[]>([]);
  const [busy, setBusy] = useState<"" | "draft" | "ask">("");
  const [error, setError] = useState("");

  async function requestAssist(mode: "draft" | "ask") {
    const asked = question.trim();
    if (busy || (mode === "ask" && asked.length < 2)) return;
    setBusy(mode);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...extraBody, ...(mode === "ask" ? { mode, question: asked } : { mode }) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "AI 상담 도우미 호출에 실패했습니다.");
        return;
      }
      const result: AssistResult = {
        key: Date.now(),
        mode,
        question: mode === "ask" ? asked : "",
        internal: body.internal ?? "",
        customerText: body.customerText ?? "",
        sources: body.sources ?? [],
        orders: body.orders ?? [],
      };
      setResults((prev) => [result, ...prev].slice(0, 10));
      if (mode === "ask") setQuestion("");
    } catch {
      setError("AI 상담 도우미 호출에 실패했습니다.");
    } finally {
      setBusy("");
    }
  }

  function onAskKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void requestAssist("ask");
  }

  // 탭을 오가도 결과가 남도록 숨기기만 한다(.lc-assist-section 이 display 를 정해 hidden 속성은 안 먹는다).
  return (
    <section className="lc-assist-section" style={hidden ? { display: "none" } : undefined}>
      <button type="button" className="lc-assist-btn is-primary" onClick={() => void requestAssist("draft")} disabled={Boolean(busy)}>
        {busy === "draft" ? <Loader2 size={15} className="spin-icon" /> : <Sparkles size={15} />}
        답변 초안 만들기
      </button>
      <form
        className="lc-ask"
        onSubmit={(event) => {
          event.preventDefault();
          void requestAssist("ask");
        }}
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onAskKeyDown}
          rows={2}
          maxLength={500}
          placeholder={askPlaceholder ?? "AI에게 물어보기 (예: 스마트스토어 구매 건도 교환 접수가 되나요?)"}
        />
        <button type="submit" aria-label="AI에게 묻기" disabled={Boolean(busy) || question.trim().length < 2}>
          {busy === "ask" ? <Loader2 size={15} className="spin-icon" /> : <Send size={15} />}
        </button>
      </form>
      {error && <p className="lc-error">{error}</p>}
      {results.length === 0 && !busy && <p className="lc-assist-note">{intro}</p>}
      <ul className="lc-assist-results">
        {results.map((result) => (
          <li key={result.key} className="lc-assist-result">
            <span className="lc-assist-tag">{result.mode === "draft" ? "답변 초안" : `질문 · ${result.question}`}</span>
            {result.internal && <p className="lc-assist-internal">{result.internal}</p>}
            {result.orders.length > 0 && (
              <div className="lc-assist-orders">
                <span className="lc-assist-orders-title">
                  <Truck size={13} /> 찾은 주문 {result.orders.length}건
                </span>
                <ul className="lc-orders">
                  {result.orders.map((order) => (
                    <li key={order.label}>
                      <div className="lc-order-top">
                        <strong>
                          {order.label}
                          {order.orderId && ` · ${order.orderId}`}
                        </strong>
                        {order.orderDate && <span>{order.orderDate.slice(0, 10)}</span>}
                      </div>
                      <p className="lc-order-channel">
                        <span className={order.asOf ? "is-copy" : ""}>{order.channel}</span>
                        {order.note && ` ${order.note}`}
                        {order.asOf && ` · ${order.asOf} 기준`}
                      </p>
                      <p>{orderItemsText(order)}</p>
                      <p className="lc-order-status">
                        {order.status || "상태 확인 불가"}
                        {order.shipment &&
                          ` · ${order.shipment.carrierName}${order.shipment.trackingNumber ? ` ${order.shipment.trackingNumber}` : ""}`}
                      </p>
                      {orderPeopleText(order) && <p className="lc-order-people">{orderPeopleText(order)}</p>}
                      <button type="button" className="lc-assist-link" onClick={() => onInsert(shippingText(order))}>
                        배송 안내 넣기
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.customerText && (
              <div className="lc-assist-customer">
                <span>고객 안내 문구</span>
                <p>{result.customerText}</p>
                <div className="lc-assist-actions">
                  <button type="button" onClick={() => onInsert(result.customerText)}>
                    답변창에 넣기
                  </button>
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(result.customerText)}>
                    <Copy size={12} /> 복사
                  </button>
                </div>
              </div>
            )}
            {result.sources.length > 0 && (
              <details className="lc-assist-sources">
                <summary>근거 {result.sources.length}개 보기</summary>
                <ul>
                  {result.sources.map((item) => (
                    <li key={`${item.type}-${item.id}`}>
                      {item.type === "faq" ? "FAQ" : "사례"} · {item.title}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
