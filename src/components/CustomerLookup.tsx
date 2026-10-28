"use client";

import { ClipboardList, Eye, History, Loader2, MessageCircle, Mic, Phone, Search, ShieldAlert, Truck } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { shipmentStatusLabel } from "@/components/AssistPanel";
import { reasonLabel } from "@/lib/blackConsumer";
import type { OrderCandidate } from "@/lib/cafe24/service";
import type { CustomerLookup as LookupResult, LookupSection } from "@/lib/customerLookup";
import { outcomeLabel, TALK_PHOTO_PREFIX } from "@/lib/liveChatOptions";
import { OPERATOR_MAX, readOperator, saveOperator } from "@/lib/operator";
import { formatPhone, isPhoneDigits, phoneDigits } from "@/lib/phone";

// 고객 조회 — 전화번호 하나로 녹취·실시간 상담(톡톡 포함)·홈페이지 게시판·주문·블랙컨슈머를 한 화면에 모은다.
// 처음엔 무엇이 있는지만(이름·내용·회원 ID·송장은 가림) 보이고, [자세히 보기]를 누르면 서버가 조회 기록을 남긴 뒤 전체를 보낸다.
// 각 칸에서 원래 화면(녹취·상담 콘솔)으로 바로 넘어간다.

const STATUS_LABEL: Record<string, string> = { waiting: "대기", active: "상담중", closed: "종료" };
const MATCH_LABEL: Record<string, string> = { buyer: "주문자", receiver: "받는 분", member: "회원", orderId: "주문번호" };
const HIDDEN = "자세히 보기를 누르면 보여요";

function kstText(iso: string, withTime = false) {
  if (!iso) return "";
  const text = new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString();
  return withTime ? `${text.slice(0, 10)} ${text.slice(11, 16)}` : text.slice(0, 10);
}

function formatDuration(sec: number) {
  if (!sec) return "";
  return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
}

function orderItemsText(order: OrderCandidate) {
  const [first, ...rest] = order.items;
  if (!first) return "상품 정보 없음";
  const name = `${first.name}${first.option ? ` (${first.option})` : ""}${first.quantity ? ` ${first.quantity}개` : ""}`;
  return rest.length ? `${name} 외 ${rest.length}건` : name;
}

function SectionNote({ section }: { section: LookupSection<unknown> }) {
  if (!section.note) return null;
  return <p className={section.state === "error" ? "cu-note is-error" : "cu-note"}>{section.note}</p>;
}

// 가린 결과에서 비워 보낸 글 — 자리만 표시한다
function Hidden({ masked, text, fallback }: { masked: boolean; text: string; fallback: string }) {
  if (text) return <>{text}</>;
  return masked ? <em className="cu-hidden">{HIDDEN}</em> : <>{fallback}</>;
}

function OrderList({ orders }: { orders: OrderCandidate[] }) {
  return (
    <ul className="lc-orders cu-orders">
      {orders.map((order) => (
        <li key={`${order.channel}:${order.orderId}`}>
          <div className="lc-order-top">
            <strong>{order.orderId || "주문번호 없음"}</strong>
            {order.orderDate && <span>{order.orderDate.slice(0, 10)}</span>}
          </div>
          <p className="lc-order-channel">
            <span className={order.asOf ? "is-copy" : ""}>{order.channel}</span>
            {order.note && ` ${order.note}`}
            {order.asOf && ` · ${order.asOf} 기준`}
          </p>
          <p>{orderItemsText(order)}</p>
          <p className="lc-order-status">
            {order.status || (order.shipment ? shipmentStatusLabel(order.shipment.status) : "") || "상태 확인 불가"}
            {order.shipment &&
              ` · ${order.shipment.carrierName}${order.shipment.trackingNumber ? ` ${order.shipment.trackingNumber}` : ""}`}
          </p>
          <p className="lc-order-people">
            {[
              order.buyerName && `주문자 ${order.buyerName}`,
              order.receiverName && order.receiverName !== order.buyerName && `받는 분 ${order.receiverName}`,
              order.phoneLast4 && `휴대폰 끝 ${order.phoneLast4}`,
              order.matchedBy.length > 0 && `찾은 이유: ${order.matchedBy.map((key) => MATCH_LABEL[key] ?? key).join("·")}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function CustomerLookup({ initialPhone }: { initialPhone: string }) {
  const initialDigits = phoneDigits(initialPhone);
  const [input, setInput] = useState(isPhoneDigits(initialDigits) ? formatPhone(initialDigits) : initialPhone);
  const [phone, setPhone] = useState(isPhoneDigits(initialDigits) ? initialDigits : "");
  const [operator, setOperator] = useState("");
  const [operatorLoaded, setOperatorLoaded] = useState(false);
  const [data, setData] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState<"" | "lookup" | "detail">("");
  const [error, setError] = useState("");
  // 자세히 보기를 연 시각 — 조회 기록에 남았다는 안내에 쓴다
  const [revealedAt, setRevealedAt] = useState("");
  const operatorRef = useRef<HTMLInputElement>(null);

  const lookup = useCallback(async (digits: string, detail: boolean) => {
    // 처리하는 사람은 쿠키로 서버에 가므로 요청 직전에 기억해 둔 이름과 맞춘다.
    const name = readOperator();
    if (name) saveOperator(name);
    setLoading(detail ? "detail" : "lookup");
    setError("");
    try {
      const response = await fetch(`/api/admin/customers?phone=${digits}${detail ? "&detail=1" : ""}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "고객 정보를 불러오지 못했어요.");
        if (body.needOperator) operatorRef.current?.focus();
        if (!detail) setData(null);
        return;
      }
      setData(body as LookupResult);
      setRevealedAt(detail ? kstText(new Date().toISOString(), true).slice(11) : "");
    } catch {
      setError("고객 정보를 불러오지 못했어요.");
    } finally {
      setLoading("");
    }
  }, []);

  // 이 브라우저에 기억해 둔 '조회하는 사람'을 채운 뒤에 주소로 받은 번호를 조회한다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const name = readOperator();
      setOperator(name);
      if (name) saveOperator(name);
      setOperatorLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!phone || !operatorLoaded) return;
    const timer = window.setTimeout(() => void lookup(phone, false), 0);
    return () => window.clearTimeout(timer);
  }, [phone, operatorLoaded, lookup]);

  // 다른 화면에서 ?phone= 으로 열었으면 한 번 조회한 뒤 주소에서 번호를 지운다 — 새로 고치면 빈 화면으로 돌아간다.
  // (라우터가 첫 화면에서 주소를 다시 적는 일이 끝난 뒤에, 라우터 상태는 그대로 두고 주소만 바꾼다)
  useEffect(() => {
    if (!window.location.search) return;
    const timer = window.setTimeout(() => window.history.replaceState(window.history.state, "", "/admin/customers"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const digits = phoneDigits(input);
    if (!isPhoneDigits(digits)) {
      setError("전화번호를 확인해 주세요. (예: 010-1234-5678)");
      return;
    }
    if (!operator.trim()) {
      setError("조회하는 사람 이름을 먼저 적어 주세요.");
      operatorRef.current?.focus();
      return;
    }
    saveOperator(operator);
    setInput(formatPhone(digits));
    // 주소에는 번호를 남기지 않는다(새로 고치면 처음 화면으로).
    if (digits === phone) void lookup(digits, false);
    else setPhone(digits);
  }

  function reveal() {
    if (!data || loading) return;
    if (!operator.trim()) {
      setError("조회하는 사람 이름을 먼저 적어 주세요.");
      operatorRef.current?.focus();
      return;
    }
    saveOperator(operator);
    void lookup(data.phone, true);
  }

  const masked = data?.masked ?? true;
  const current = data?.blacklist.filter((entry) => entry.status === "active" || entry.status === "ending") ?? [];
  const past = data?.blacklist.filter((entry) => entry.status === "expired" || entry.status === "released") ?? [];
  const orderCount = data ? data.mallOrders.items.length + data.otherOrders.items.length : 0;
  // 블랙컨슈머 등록 칸에 채울 이름·회원 ID — 가린 결과면 채우지 않는다(가린 값이 저장되지 않게).
  const guessName =
    data && !masked
      ? (data.mallOrders.items.find((order) => order.buyerName)?.buyerName ?? data.calls.find((call) => call.customerName)?.customerName ?? "")
      : "";
  const registerHref = data
    ? `/admin/black-consumers?${new URLSearchParams({ new: "1", phone: data.phone, memberId: masked ? "" : (data.memberIds[0] ?? ""), name: guessName })}`
    : "";

  return (
    <section className="cu-panel">
      <form className="cu-search" onSubmit={submit}>
        <Phone size={16} />
        <input
          type="tel"
          value={input}
          maxLength={20}
          onChange={(event) => setInput(event.target.value)}
          placeholder="전화번호 (예: 010-1234-5678)"
          aria-label="전화번호"
          autoFocus={!phone}
        />
        <label className="cu-operator">
          <span>조회하는 사람</span>
          <input
            ref={operatorRef}
            value={operator}
            maxLength={OPERATOR_MAX}
            onChange={(event) => setOperator(event.target.value)}
            placeholder="이름"
          />
        </label>
        <button type="submit" className="bc-primary" disabled={Boolean(loading)}>
          {loading === "lookup" ? <Loader2 size={15} className="spin-icon" /> : <Search size={15} />} 조회
        </button>
      </form>
      <div className="cu-tools">
        <p className="cu-note">조회와 [자세히 보기]는 조회하는 사람 이름과 함께 조회 기록에 남아요.</p>
        <Link className="cu-more" href="/admin/access-logs">
          <History size={13} /> 조회 기록
        </Link>
      </div>

      {error && <p className="sc-error">{error}</p>}
      {!data && !loading && !error && (
        <p className="cu-intro">
          전화번호 하나로 이 고객의 녹취, 실시간 상담(네이버 톡톡 포함), 홈페이지 게시판 글, 주문(자사몰·스마트스토어·매장 택배)과 블랙컨슈머
          여부를 한 번에 봐요. 처음엔 무엇이 있는지만 보이고, 이름·내용은 [자세히 보기]를 눌러야 보여요.
        </p>
      )}

      {data && (
        <div className={loading ? "cu-result is-loading" : "cu-result"}>
          <div className="cu-head">
            <strong>{data.phoneLabel}</strong>
            <span>
              녹취 {data.calls.length} · 상담 {data.chats.length} · 게시판 {data.posts.items.length} · 주문 {orderCount}
            </span>
            {data.memberIds.length > 0 && <span className="cu-members">자사몰 회원 {data.memberIds.join(", ")}</span>}
            <span className="bc-spacer" />
            {masked ? (
              <button type="button" className="bc-primary" disabled={Boolean(loading)} onClick={reveal}>
                {loading === "detail" ? <Loader2 size={15} className="spin-icon" /> : <Eye size={15} />} 자세히 보기
              </button>
            ) : (
              <span className="cu-revealed">자세히 보는 중 · {revealedAt} 조회 기록에 남김</span>
            )}
            {current.length ? (
              <Link className="ln-ghost" href={`/admin/black-consumers?id=${current[0].id}`}>
                <ShieldAlert size={14} /> 블랙컨슈머 보기
              </Link>
            ) : (
              <Link className="ln-ghost" href={registerHref}>
                <ShieldAlert size={14} /> 블랙컨슈머 등록
              </Link>
            )}
          </div>

          {current.map((entry) => (
            <div key={entry.id} className="cu-caution" role="alert">
              <ShieldAlert size={18} />
              <div>
                <strong>
                  블랙컨슈머 · {entry.reasons.map(reasonLabel).join(" · ")} · {entry.until}까지
                </strong>
                <p>
                  <Hidden masked={masked} text={entry.detail} fallback="" />
                </p>
              </div>
            </div>
          ))}
          {past.length > 0 && (
            <p className="cu-note">
              예전에 블랙컨슈머로 등록된 적이 있어요(해제·기간 끝 {past.length}건) —{" "}
              <Link href={`/admin/black-consumers?id=${past[0].id}`}>기록 보기</Link>
            </p>
          )}

          <div className="cu-grid">
            <section className="cu-card" aria-label="녹취">
              <h3>
                <Mic size={15} /> 녹취 <span>{data.calls.length}</span>
              </h3>
              {data.calls.length === 0 ? (
                <p className="cu-empty">이 번호의 녹취가 없어요.</p>
              ) : (
                <ul className="cu-list">
                  {data.calls.map((call) => (
                    <li key={call.id}>
                      <Link href={`/admin/voice?q=${data.phone}&call=${call.id}`}>
                        <span className="cu-item-top">
                          <strong>{kstText(call.callDate, true) || "일시 미상"}</strong>
                          {call.durationSec > 0 && <span>{formatDuration(call.durationSec)}</span>}
                          {call.category && <span className="cu-chip">{call.category}</span>}
                        </span>
                        <span className="cu-item-text">
                          {call.status === "failed" ? (
                            "분석 실패"
                          ) : (
                            <Hidden masked={masked} text={call.summary} fallback={call.status === "pending" ? "분석 중" : "요약 없음"} />
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="cu-card" aria-label="실시간 상담">
              <h3>
                <MessageCircle size={15} /> 실시간 상담·네이버 톡톡 <span>{data.chats.length}</span>
              </h3>
              {data.chats.length === 0 ? (
                <p className="cu-empty">이어지는 상담이 없어요.</p>
              ) : (
                <ul className="cu-list">
                  {data.chats.map((chat) => (
                    <li key={chat.id}>
                      <Link href={`/admin/live-chat?${new URLSearchParams({ q: chat.ticketNo, chat: chat.id })}`}>
                        <span className="cu-item-top">
                          <strong>{chat.ticketNo || "상담"}</strong>
                          <span className={chat.talk ? "cu-chip is-talk" : "cu-chip"}>{chat.talk ? "네이버 톡톡" : "셀프가이드"}</span>
                          <span>{chat.status === "closed" ? outcomeLabel(chat.outcome) || "종료" : STATUS_LABEL[chat.status] ?? chat.status}</span>
                          <time>{kstText(chat.createdAt, true)}</time>
                        </span>
                        <span className="cu-item-text">
                          {chat.preview.startsWith(TALK_PHOTO_PREFIX) ? (
                            "[사진]"
                          ) : (
                            <Hidden masked={masked} text={chat.preview} fallback="(메시지 없음)" />
                          )}
                        </span>
                        <span className="cu-reasons">
                          {chat.matchedBy.map((reason) => (
                            <em key={reason}>{reason}</em>
                          ))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="cu-note">톡톡 상담은 대화에 이 번호가 적혔거나 블랙컨슈머로 이 번호와 함께 등록된 경우에만 이어져요.</p>
            </section>

            <section className="cu-card cu-wide" aria-label="주문">
              <h3>
                <Truck size={15} /> 주문 <span>{orderCount}</span>
                <small>최근 {data.days}일</small>
              </h3>
              <div className="cu-orders-cols">
                <div>
                  <h4>자사몰 (cafe24 실시간)</h4>
                  {data.mallOrders.items.length > 0 ? (
                    <OrderList orders={data.mallOrders.items} />
                  ) : (
                    data.mallOrders.state === "ok" && <p className="cu-empty">이 번호로 찾은 자사몰 주문이 없어요.</p>
                  )}
                  <SectionNote section={data.mallOrders} />
                </div>
                <div>
                  <h4>스마트스토어·매장 택배</h4>
                  {data.otherOrders.items.length > 0 ? (
                    <OrderList orders={data.otherOrders.items} />
                  ) : (
                    data.otherOrders.state === "ok" && <p className="cu-empty">이 번호로 찾은 주문이 없어요.</p>
                  )}
                  <SectionNote section={data.otherOrders} />
                </div>
              </div>
              {masked && orderCount > 0 && <p className="cu-note">주문자 이름·송장번호는 가려져 있어요. [자세히 보기]를 누르면 보여요.</p>}
            </section>

            <section className="cu-card" aria-label="홈페이지 게시판">
              <h3>
                <ClipboardList size={15} /> 홈페이지 게시판 <span>{data.posts.items.length}</span>
                <small>최근 {data.days}일</small>
              </h3>
              {data.posts.items.length > 0 ? (
                <ul className="cu-list">
                  {data.posts.items.map((post) => (
                    <li key={post.key}>
                      <div className="cu-post">
                        <span className="cu-item-top">
                          <strong>
                            <Hidden masked={masked} text={post.title} fallback="(제목 없음)" />
                          </strong>
                          <span className="cu-chip">{post.boardName}</span>
                          <span>{post.answered ? "답변 완료" : "답변 전"}</span>
                          <time>{post.createdAt}</time>
                        </span>
                        {!masked && <span className="cu-item-text">{post.content}</span>}
                        <span className="cu-reasons">
                          {post.matchedBy.map((reason) => (
                            <em key={reason}>{reason}</em>
                          ))}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                data.posts.state === "ok" && <p className="cu-empty">이 번호·회원의 글이 없어요.</p>
              )}
              <SectionNote section={data.posts} />
              {data.posts.items.some((post) => !post.answered) && (
                <Link className="cu-more" href="/admin/boards">
                  게시판 관리에서 답하기
                </Link>
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
