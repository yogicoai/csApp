"use client";

import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageCircle,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Trash2,
  UserSearch,
  X,
} from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AdminLiveChatAssist } from "@/components/AdminLiveChatAssist";
import { type CautionView, cautionText } from "@/lib/blackConsumer";
import { kstDateString, kstToday, shiftDay } from "@/lib/liveChatHours";
import {
  appLabel,
  CHAT_OUTCOMES,
  type ChatOutcome,
  DEFAULT_SNIPPETS,
  DELETE_REASONS,
  type DeleteReason,
  deleteReasonLabel,
  outcomeLabel,
  purchasePlaceLabel,
  TALK_PHOTO_PREFIX,
  TALK_VIA,
  TRASH_DAYS,
  viaLabel,
} from "@/lib/liveChatOptions";

// 어드민 실시간 상담 콘솔 — 상담원이 대화를 읽고 답하는 흐름에 맞춘 배치(일반적인 CS 상담 툴 구성).
//  위: 날짜 바(달력·일별 통계) / 왼쪽: 상담 목록(검색·대기 시간) / 가운데: 고객 맥락 바 + 대화 + 빠른 문구 + 답변창
//  오른쪽: 상담 도움 탭(AI 도우미·고객·주문·자주 쓰는 답변)
// 진행 중 상담과 후속 조치·미분류는 처리할 일이라 날짜와 상관없이 보이고, 날짜는 종료 상담 이력과 통계에 적용된다.
// 서버리스 배포라 웹소켓 대신 폴링으로 갱신한다(목록 4초, 열어 둔 대화 2.5초, 통계 15초).

export type Snippet = { id: string; title: string; body: string };

type ChatStatus = "waiting" | "active" | "closed";
export type ChatSummary = {
  id: string;
  ticketNo: string;
  channel: string;
  status: ChatStatus;
  memberId: string;
  entry: { faqId: string; faqQuestion: string; category: string; aiQuery: string };
  intake: { purchasePlace: string; inquiryType: string; orderNumber: string };
  source: { via: string; app: string; embedded: boolean; parentOrigin: string; referrer: string; param: string };
  // 네이버 톡톡 상담이 '톡톡문의'로 시작된 상품 페이지
  talk: { productName: string; productUrl: string };
  offHours: boolean;
  // 운영시간 외 문의 접수 때 받은 휴대폰(답변 안내 문자용)과 문자를 보낸 때
  contactPhone: string;
  notifiedAt: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastSender: string;
  agentUnread: number;
  visitorOnline: boolean;
  createdAt: string;
  firstResponseAt: string;
  closedAt: string;
  closedBy: string;
  outcome: { result: string; memo: string; decidedAt: string };
  deletedAt: string;
  deleteReason: string;
  assetClaimId: string;
};
// delivery·partner 는 톡톡 상담에만 — 톡톡으로 보내는 중·보냄·못 보냄 / 톡톡 파트너센터에서 직접 보낸 메시지
type ChatMessage = {
  seq: number;
  sender: "visitor" | "agent" | "system";
  text: string;
  createdAt: string;
  delivery?: "sending" | "sent" | "failed";
  partner?: boolean;
};
type Counts = {
  waiting: number;
  active: number;
  unread: number;
  followUp: number;
  unclassified: number;
  trash: number;
  talk: { waiting: number; unread: number };
  // 거르기와 상관없는 전체 — 알림·탭 제목은 이 값으로(거르기를 바꿔도 소리가 나거나 빠지지 않게)
  all: { waiting: number; unread: number };
};

const EMPTY_COUNTS: Counts = {
  waiting: 0,
  active: 0,
  unread: 0,
  followUp: 0,
  unclassified: 0,
  trash: 0,
  talk: { waiting: 0, unread: 0 },
  all: { waiting: 0, unread: 0 },
};

// 경로로 거르기 — 왼쪽 메뉴의 [네이버 톡톡]은 ?via=talktalk 로 이 거르기를 켠 채 연다.
const VIA_FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "전체" },
  { key: "web", label: "셀프가이드" },
  { key: TALK_VIA, label: "네이버 톡톡" },
];

// 처리할 일이 남은 거르기와 휴지통 — 날짜와 상관없이 전체를 본다(서버도 같은 규칙).
const ACTION_FILTERS = new Set(["follow_up", "unclassified", "trash"]);

// 종료 탭 거르기 — 후속 조치(남은 처리)와 미분류(고객이 직접 종료 등)를 앞에 둔다.
const CLOSED_FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "전체" },
  { key: "follow_up", label: "후속 조치" },
  { key: "unclassified", label: "미분류" },
  { key: "resolved", label: "해결" },
  { key: "handed_off", label: "다른 곳 안내" },
  { key: "unresolved", label: "미해결" },
  { key: "trash", label: "휴지통" },
];
type NotifyState = NotificationPermission | "unsupported";

const LIST_POLL_MS = 4000;
const CHAT_POLL_MS = 2500;
const PAGE_TITLE = "실시간 상담";

const CHANNEL_LABELS: Record<string, string> = {
  ownmall: "자사몰",
  marketplace: "외부몰",
  "29cm": "29CM",
  chat: "채팅상담",
};

const STATUS_LABEL: Record<ChatStatus, string> = { waiting: "대기", active: "상담중", closed: "종료" };

function channelLabel(slug: string) {
  return CHANNEL_LABELS[slug] ?? slug;
}

// 유입 경로가 기록된 상담은 경로(자사몰·카카오톡·전화 연결 등)로, 그 전 상담은 셀프가이드 채널로 표시한다.
function originLabel(chat: ChatSummary) {
  return chat.source?.via ? viaLabel(chat.source.via) : channelLabel(chat.channel);
}

// 목록·헤더의 상태 칩 — 진행 중이면 대기·상담중, 종료면 상담 결과(미분류 포함)를 보여준다.
function statusChip(chat: ChatSummary) {
  if (chat.deletedAt) return { className: "is-deleted", label: `삭제됨 · ${deleteReasonLabel(chat.deleteReason)}` };
  if (chat.status !== "closed") return { className: `is-${chat.status}`, label: STATUS_LABEL[chat.status] };
  const result = chat.outcome.result;
  return { className: `is-outcome-${result || "unclassified"}`, label: outcomeLabel(result) };
}

function clipText(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatMobile(digits: string) {
  return digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
}

// 운영시간 외 문의 접수 — 답변을 남긴 뒤 고객 휴대폰으로 보낼 안내 문자.
// 문자 발송 서비스가 붙기 전까지는 문구를 복사해 통화매니저 등으로 직접 보내고 [보냈어요]로 표시한다.
function ReplyNotice({ chat, onNotified }: { chat: ChatSummary; onNotified: (notifiedAt: string) => void }) {
  const [notice, setNotice] = useState<{ phone: string; text: string } | null>(null);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/admin/live-chats/${chat.id}/notify`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!alive) return;
        if (response.ok) setNotice({ phone: body.phone, text: body.text });
        else setError(body.error ?? "문자 문구를 불러오지 못했어요.");
      } catch {
        if (alive) setError("문자 문구를 불러오지 못했어요.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [chat.id]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setError("복사하지 못했어요. 문구를 직접 선택해 복사해 주세요.");
    }
  }

  async function markSent() {
    setError("");
    try {
      const response = await fetch(`/api/admin/live-chats/${chat.id}/notify`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (response.ok) onNotified(body.notifiedAt);
      else setError(body.error ?? "보낸 것으로 표시하지 못했어요.");
    } catch {
      setError("보낸 것으로 표시하지 못했어요.");
    }
  }

  return (
    <div className="lc-notice" aria-label="답변 안내 문자">
      <div className="lc-notice-head">
        <Smartphone size={14} />
        <strong>답변 안내 문자</strong>
        <span>{formatMobile(notice?.phone || chat.contactPhone)}</span>
        {chat.notifiedAt ? (
          <em className="is-sent">보냄 · {formatDateTime(chat.notifiedAt)}</em>
        ) : (
          <em>{chat.lastSender === "agent" ? "답변을 남겼으면 보내 주세요" : "답변을 남긴 뒤 보내 주세요"}</em>
        )}
      </div>
      {notice && <p className="lc-notice-text">{notice.text}</p>}
      {error && <p className="lc-error">{error}</p>}
      <div className="lc-notice-actions">
        <button type="button" disabled={!notice} onClick={() => notice && void copy("text", notice.text)}>
          {copied === "text" ? "복사됨" : "문자 내용 복사"}
        </button>
        <button type="button" disabled={!notice} onClick={() => notice && void copy("phone", notice.phone)}>
          {copied === "phone" ? "복사됨" : "번호 복사"}
        </button>
        <button type="button" className="is-primary" onClick={() => void markSent()}>
          {chat.notifiedAt ? "다시 보냄으로 표시" : "보냈어요"}
        </button>
      </div>
    </div>
  );
}

// 대화 위 '고객 맥락 바' — 대화를 읽으면서 바로 봐야 하는 정보만 칩으로 보여준다(상세는 오른쪽 고객·주문 탭).
function contextChips(chat: ChatSummary) {
  const talk = chat.source.via === TALK_VIA;
  const chips: Array<{ label: string; value: string; href?: string }> = [];
  if (chat.source.via) {
    chips.push({ label: "경로", value: [viaLabel(chat.source.via), chat.source.app && appLabel(chat.source.app)].filter(Boolean).join(" · ") });
  }
  if (talk && chat.talk.productName) {
    chips.push({ label: "상품", value: clipText(chat.talk.productName, 28), href: chat.talk.productUrl || undefined });
  }
  if (chat.intake.purchasePlace) chips.push({ label: "구매처", value: purchasePlaceLabel(chat.intake.purchasePlace) });
  if (chat.intake.inquiryType) chips.push({ label: "유형", value: chat.intake.inquiryType });
  if (chat.intake.orderNumber) chips.push({ label: "주문번호", value: chat.intake.orderNumber });
  if (chat.entry.faqQuestion) chips.push({ label: "보던 FAQ", value: clipText(chat.entry.faqQuestion, 28) });
  else if (chat.entry.aiQuery) chips.push({ label: "AI 질문", value: clipText(chat.entry.aiQuery, 28) });
  if (chat.offHours) chips.push({ label: "접수", value: "운영시간 외" });
  // 톡톡 상담은 셀프가이드 사전 질문을 거치지 않는다.
  if (!talk && !chat.intake.purchasePlace && !chat.intake.inquiryType) chips.push({ label: "사전 질문", value: "없음" });
  return chips;
}

// 톡톡 고객이 보낸 사진("[사진] <주소>")은 사진으로 보여 주고, 누르면 원본을 새 창에서 연다.
function MessageText({ text }: { text: string }) {
  const url = text.startsWith(TALK_PHOTO_PREFIX) ? text.slice(TALK_PHOTO_PREFIX.length).trim() : "";
  if (!/^https?:\/\//.test(url)) return <>{text}</>;
  return (
    <a className="lc-photo" href={url} target="_blank" rel="noreferrer noopener">
      <img src={url} alt="고객이 보낸 사진" loading="lazy" />
      <span>사진 원본 보기</span>
    </a>
  );
}

function formatDateTime(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const time = date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

type DayStats = {
  date: string;
  total: number;
  open: number;
  resolved: number;
  followUp: number;
  handedOff: number;
  unresolved: number;
  unclassified: number;
  offHours: number;
  avgFirstResponseSec: number | null;
};

// 상담원 답을 기다리기 시작한 시각(SLA) — 대기 중이면 접수 시각, 상담 중인데 마지막 메시지가 고객이면 그 시각.
function waitingSince(chat: ChatSummary) {
  if (chat.status === "waiting") return chat.createdAt;
  if (chat.status === "active" && chat.lastSender === "visitor") return chat.lastMessageAt;
  return "";
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}분`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}시간`;
  return `${Math.floor(minutes / (60 * 24))}일`;
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  return seconds < 60 ? `${seconds}초` : formatMinutes(Math.round(seconds / 60));
}

// 목록의 대기 시간 배지 — 5분 넘으면 주의, 15분 넘으면 경고 색(일반적인 CS 툴의 SLA 표시).
function WaitBadge({ chat, now }: { chat: ChatSummary; now: number }) {
  const since = waitingSince(chat);
  if (!since || !now) return null;
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  const level = minutes >= 15 ? "lc-wait is-late" : minutes >= 5 ? "lc-wait is-warn" : "lc-wait";
  return <span className={level}>대기 {formatMinutes(minutes)}</span>;
}

function createdDay(chat: ChatSummary) {
  return chat.createdAt ? kstDateString(new Date(chat.createdAt)) : "";
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dayTitle(day: string, today: string) {
  const date = new Date(`${day}T00:00:00Z`);
  const label = `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 (${WEEKDAYS[date.getUTCDay()]})`;
  if (day === today) return `${label} · 오늘`;
  if (day === shiftDay(today, -1)) return `${label} · 어제`;
  return label;
}

function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]) {
  if (incoming.length === 0) return prev;
  const bySeq = new Map(prev.map((message) => [message.seq, message]));
  for (const message of incoming) bySeq.set(message.seq, message);
  return Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
}

// 빈틈 없이 이어진 마지막 순번 — 동시에 저장된 메시지가 늦게 조회돼도 놓치지 않게 한다.
function contiguousSeq(messages: ChatMessage[]) {
  let seq = 0;
  for (const message of messages) {
    if (message.seq !== seq + 1) break;
    seq = message.seq;
  }
  return seq;
}

function subscribeNothing() {
  return () => {};
}

function readNotifyPermission(): NotifyState {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

// 새 메시지 알림음 — 브라우저 정책상 페이지를 한 번 클릭한 뒤부터 소리가 난다.
function beep() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.35);
    oscillator.onended = () => void context.close();
  } catch {
    // 소리를 못 내는 환경은 무시
  }
}

// initialQuery·initialChatId — 고객 조회에서 상담을 눌러 왔을 때 그 상담번호로 찾아 바로 연다.
export function AdminLiveChat({
  initialVia = "",
  initialQuery = "",
  initialChatId = "",
}: {
  initialVia?: string;
  initialQuery?: string;
  initialChatId?: string;
}) {
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [closedFilter, setClosedFilter] = useState("");
  // 경로 거르기(전체·셀프가이드·네이버 톡톡) — 진행 중·종료·검색 목록과 건수에 모두 적용된다.
  const [via, setVia] = useState(initialVia);
  // 네이버 톡톡 연결 설정 여부(서버 환경변수) — 톡톡 거르기에서 아직 연결 전이면 안내한다.
  const [talkConnected, setTalkConnected] = useState<boolean | null>(null);
  // 날짜 바 — 고른 날의 종료 상담 이력과 일별 통계(진행 중·후속 조치·미분류는 날짜와 상관없이 전체).
  const [today, setToday] = useState(kstToday);
  const [day, setDay] = useState(kstToday);
  const [stats, setStats] = useState<DayStats | null>(null);
  // 검색 — 입력이 0.3초 멈추면 검색어로 반영한다(상태·날짜와 상관없이 찾는다).
  const [search, setSearch] = useState(initialQuery);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [listMode, setListMode] = useState<"list" | "search">("list");
  // 목록을 받은 시각 — 대기 시간(SLA) 계산 기준
  const [loadedAt, setLoadedAt] = useState(0);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [listLoaded, setListLoaded] = useState(false);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<ChatSummary | null>(null);
  // 블랙컨슈머 주의 표시 — 목록의 상담별 표시와, 열어 둔 상담의 최신 표시(undefined = 아직 대화를 받기 전이라 목록 값을 쓴다)
  const [cautions, setCautions] = useState<Record<string, CautionView>>({});
  const [selectedCaution, setSelectedCaution] = useState<CautionView | null | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  // 상담 결과 고르기 — close: 결과를 고르면 종료, edit: 종료된 상담의 결과만 변경
  const [outcomePicker, setOutcomePicker] = useState<"close" | "edit" | null>(null);
  const [outcomeMemo, setOutcomeMemo] = useState("");
  // 삭제 사유 고르기 — 고르면 휴지통으로 이동(스팸은 같은 고객의 새 상담도 막는다)
  const [deletePicker, setDeletePicker] = useState(false);
  // 해결로 종료한 상담을 응대 자산(클레임 검토 대기)으로 승격하는 중인지
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetError, setAssetError] = useState("");
  // 자주 쓰는 답변 — 답변창 위 빠른 문구와 오른쪽 탭이 같은 목록을 쓴다(콘솔을 열 때 한 번 불러옴).
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  // 서버 렌더에는 Notification 이 없으므로 외부 스토어로 읽고, 권한 요청 뒤에는 그 응답을 쓴다.
  const permission = useSyncExternalStore(subscribeNothing, readNotifyPermission, () => "unsupported" as NotifyState);
  const [answered, setAnswered] = useState<NotifyState | null>(null);
  const notify = answered ?? permission;
  const selectedRef = useRef("");
  const lastSeqRef = useRef(0);
  const prevAlertRef = useRef<number | null>(null);
  const prevTalkAlertRef = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const alertCount = counts.all.waiting + counts.all.unread;
  const talkAlertCount = counts.talk.waiting + counts.talk.unread;
  const closed = selected?.status === "closed";
  const caution = selected ? (selectedCaution === undefined ? (cautions[selected.id] ?? null) : selectedCaution) : null;

  const loadList = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) {
        params.set("q", searchQuery);
      } else {
        params.set("status", tab);
        if (tab === "closed" && closedFilter === "trash") {
          params.set("status", "trash");
        } else if (tab === "closed") {
          params.set("date", day);
          if (closedFilter) params.set("outcome", closedFilter);
        }
      }
      if (via) params.set("via", via);
      const response = await fetch(`/api/admin/live-chats?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setListError(body.error ?? "상담 목록을 불러오지 못했습니다.");
        return;
      }
      setListError("");
      setChats(body.chats ?? []);
      setCautions(body.cautions ?? {});
      setCounts({ ...EMPTY_COUNTS, ...body.counts });
      setTalkConnected(typeof body.talkConnected === "boolean" ? body.talkConnected : null);
      setListMode(body.mode === "search" ? "search" : "list");
      setLoadedAt(Date.now());
      setListLoaded(true);
    } catch {
      setListError("상담 목록을 불러오지 못했습니다.");
    }
  }, [tab, closedFilter, day, searchQuery, via]);

  const applyMessages = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const merged = mergeMessages(prev, incoming);
      lastSeqRef.current = contiguousSeq(merged);
      return merged;
    });
  }, []);

  const loadChat = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/api/admin/live-chats/${id}?after=${lastSeqRef.current}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        // 응답이 오기 전에 다른 상담으로 옮겼으면 버린다.
        if (selectedRef.current !== id) return;
        if (!response.ok) {
          setChatError(body.error ?? "대화를 불러오지 못했습니다.");
          return;
        }
        setChatError("");
        setSelected(body.chat);
        setSelectedCaution(body.caution ?? null);
        applyMessages(body.messages ?? []);
      } catch {
        if (selectedRef.current === id) setChatError("대화를 불러오지 못했습니다.");
      }
    },
    [applyMessages],
  );

  useEffect(() => {
    const tick = () => void loadList();
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, LIST_POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [loadList]);

  // 날짜 바의 일별 통계 — 고른 날짜가 바뀌거나 15초마다 다시 받는다(자정이 지나면 '오늘'도 갱신).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/admin/live-chats/stats?date=${day}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as DayStats;
        if (!alive) return;
        setStats(body);
        setToday(kstToday());
      } catch {
        // 다음 주기에 다시 시도
      }
    };
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, 15_000);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [day]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!selectedId) return;
    const tick = () => void loadChat(selectedId);
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, CHAT_POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [selectedId, loadChat]);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages.length, selectedId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/admin/live-chat-snippets", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { snippets?: Snippet[] };
        if (alive) setSnippets(body.snippets ?? []);
      } catch {
        // 불러오지 못해도 기본 문구는 쓸 수 있다.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const originalTitle = document.title;
    return () => {
      document.title = originalTitle;
    };
  }, []);

  // 대기 상담이나 안 읽은 메시지가 늘면 소리 + (다른 창을 보고 있으면) 데스크톱 알림 — 톡톡이면 톡톡이라고 알린다.
  useEffect(() => {
    document.title = alertCount > 0 ? `(${alertCount}) ${PAGE_TITLE}` : PAGE_TITLE;
    const prev = prevAlertRef.current;
    const prevTalk = prevTalkAlertRef.current;
    prevAlertRef.current = alertCount;
    prevTalkAlertRef.current = talkAlertCount;
    if (prev === null || alertCount <= prev) return;
    beep();
    if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const fromTalk = prevTalk !== null && talkAlertCount > prevTalk;
      new Notification(PAGE_TITLE, { body: fromTalk ? "네이버 톡톡 새 메시지가 도착했어요." : "새 상담 메시지가 도착했어요." });
    }
  }, [alertCount, talkAlertCount]);

  const selectChat = useCallback((chat: ChatSummary) => {
    if (chat.id === selectedRef.current) return;
    selectedRef.current = chat.id;
    lastSeqRef.current = 0;
    setSelectedId(chat.id);
    setSelected(chat);
    setSelectedCaution(undefined);
    setMessages([]);
    setDraft("");
    setAssetError("");
    setChatError("");
    setOutcomePicker(null);
    setOutcomeMemo("");
    setDeletePicker(false);
  }, []);

  // 고객 조회에서 고른 상담 — 검색 결과에 나오면 한 번 연다.
  const pendingChatRef = useRef(initialChatId);
  useEffect(() => {
    const target = pendingChatRef.current ? chats.find((chat) => chat.id === pendingChatRef.current) : undefined;
    if (!target) return;
    pendingChatRef.current = "";
    window.setTimeout(() => selectChat(target), 0);
  }, [chats, selectChat]);

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    setAnswered(await Notification.requestPermission());
  }

  async function sendReply(event?: React.FormEvent) {
    event?.preventDefault();
    const id = selectedId;
    const text = draft.trim();
    if (!id || !text || sending || closed) return;
    setSending(true);
    setChatError("");
    try {
      const response = await fetch(`/api/admin/live-chats/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await response.json().catch(() => ({}));
      if (selectedRef.current !== id) return;
      if (!response.ok) {
        // 톡톡으로 못 보낸 답변은 대화에 '못 보냄'으로 남는다 — 바로 보여 주고, 글은 다시 보낼 수 있게 그대로 둔다.
        if (body.message) applyMessages([body.message]);
        setChatError(body.error ?? "답변을 보내지 못했습니다.");
        return;
      }
      applyMessages([body.message]);
      setSelected(body.chat);
      setDraft("");
      void loadList();
    } catch {
      setChatError("답변을 보내지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  // 거르기를 바꾸면 주소(?via=)도 맞춰 둔다 — 새로고침하거나 메뉴로 다시 들어와도 같은 목록이 보이게.
  function changeVia(next: string) {
    setVia(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("via", next);
    else url.searchParams.delete("via");
    window.history.replaceState(null, "", url);
  }

  async function patchChat(payload: object) {
    const id = selectedId;
    if (!id) return false;
    try {
      const response = await fetch(`/api/admin/live-chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setChatError(body.error ?? "상태를 바꾸지 못했습니다.");
        return false;
      }
      if (selectedRef.current === id) setSelected(body.chat);
      void loadChat(id);
      void loadList();
      return true;
    } catch {
      setChatError("상태를 바꾸지 못했습니다.");
      return false;
    }
  }

  function openOutcomePicker(mode: "close" | "edit") {
    setOutcomeMemo(mode === "edit" ? (selected?.outcome.memo ?? "") : "");
    setDeletePicker(false);
    setOutcomePicker(mode);
  }

  // 휴지통으로 이동 — 선택은 그대로 두어 바로 [복구]로 되돌릴 수 있게 한다.
  async function trashChat(reason: DeleteReason) {
    const id = selectedId;
    if (!id) return;
    try {
      const response = await fetch(`/api/admin/live-chats/${id}?reason=${reason}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setChatError(body.error ?? "상담을 삭제하지 못했습니다.");
        return;
      }
      if (selectedRef.current === id) setSelected(body.chat);
      setDeletePicker(false);
      void loadList();
    } catch {
      setChatError("상담을 삭제하지 못했습니다.");
    }
  }

  async function restoreChat() {
    const id = selectedId;
    if (!id) return;
    try {
      const response = await fetch(`/api/admin/live-chats/${id}/restore`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setChatError(body.error ?? "상담을 복구하지 못했습니다.");
        return;
      }
      if (selectedRef.current === id) setSelected(body.chat);
      void loadList();
    } catch {
      setChatError("상담을 복구하지 못했습니다.");
    }
  }

  // 휴지통에서 바로 영구 삭제 — 대화 내용까지 지워지므로 한 번 더 확인한다.
  async function purgeChat() {
    const id = selectedId;
    if (!id || !window.confirm("영구 삭제하면 대화 내용까지 지워지고 되돌릴 수 없어요. 삭제할까요?")) return;
    try {
      const response = await fetch(`/api/admin/live-chats/${id}?permanent=1`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setChatError(body.error ?? "영구 삭제하지 못했습니다.");
        return;
      }
      selectedRef.current = "";
      setSelectedId("");
      setSelected(null);
      setMessages([]);
      void loadList();
    } catch {
      setChatError("영구 삭제하지 못했습니다.");
    }
  }

  // 결과를 고르면 close 모드는 종료와 함께 저장하고, edit 모드는 결과만 바꾼다.
  async function submitOutcome(result: ChatOutcome) {
    const outcome = { result, memo: outcomeMemo.trim() || undefined };
    const saved = await patchChat(outcomePicker === "close" ? { status: "closed", outcome } : { outcome });
    if (saved) {
      setOutcomePicker(null);
      setOutcomeMemo("");
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 한글 조합 중 Enter 는 글자 확정이므로 전송하지 않는다.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void sendReply();
  }

  // 상담 도움 영역(자주 쓰는 답변·AI 초안·배송 안내)에서 고른 문구를 답변창에 이어 붙인다. 보내기는 상담원이 직접.
  function insertIntoReply(text: string) {
    if (closed) {
      setChatError("종료된 상담입니다. 다시 열고 답변해 주세요.");
      return;
    }
    setDraft((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text));
    replyRef.current?.focus();
  }

  const dayStats = stats?.date === day ? stats : null;
  const summaryText =
    listMode === "search"
      ? `검색 결과 ${chats.length}건 · 상태·날짜와 상관없이 찾아요`
      : tab === "open"
        ? `대기 ${counts.waiting} · 상담중 ${counts.active}${counts.unread > 0 ? ` · 안 읽음 ${counts.unread}` : ""} · 날짜와 상관없이 전체`
        : closedFilter === "trash"
          ? `휴지통 ${chats.length}건 · 삭제 후 ${TRASH_DAYS}일이 지나면 자동으로 영구 삭제돼요`
          : ACTION_FILTERS.has(closedFilter)
            ? `${closedFilter === "follow_up" ? "후속 조치" : "미분류"} ${chats.length}건 · 날짜와 상관없이 전체`
            : `${dayTitle(day, today)} 접수 · 종료 ${chats.length}건`;

  return (
    <div className="lc-console">
      <div className="lc-daybar">
        <div className="lc-daynav">
          <button type="button" aria-label="이전 날" onClick={() => setDay(shiftDay(day, -1))}>
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            aria-label="날짜 선택"
            value={day}
            max={today}
            onChange={(event) => event.target.value && setDay(event.target.value)}
          />
          <button type="button" aria-label="다음 날" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}>
            <ChevronRight size={16} />
          </button>
          <button type="button" className={day === today ? "lc-today active" : "lc-today"} onClick={() => setDay(today)}>
            오늘
          </button>
          <strong className="lc-day-title">{dayTitle(day, today)}</strong>
        </div>
        <div className="lc-daystats" aria-label="일별 통계">
          <span>
            <em>접수</em>
            {dayStats?.total ?? "—"}
          </span>
          <span>
            <em>진행 중</em>
            {dayStats?.open ?? "—"}
          </span>
          <span className="is-outcome-resolved">
            <em>해결</em>
            {dayStats?.resolved ?? "—"}
          </span>
          <span className="is-outcome-follow_up">
            <em>후속 조치</em>
            {dayStats?.followUp ?? "—"}
          </span>
          <span className="is-outcome-handed_off">
            <em>다른 곳 안내</em>
            {dayStats?.handedOff ?? "—"}
          </span>
          <span className="is-outcome-unresolved">
            <em>미해결</em>
            {dayStats?.unresolved ?? "—"}
          </span>
          <span>
            <em>미분류</em>
            {dayStats?.unclassified ?? "—"}
          </span>
          <span title="운영시간 안에 접수된 상담 기준">
            <em>평균 첫 응답</em>
            {dayStats ? formatDuration(dayStats.avgFirstResponseSec) : "—"}
          </span>
        </div>
      </div>

      <section className="lc-admin">
        <aside className="lc-list">
          <div className="lc-list-head">
            <div className="lc-tabs" role="tablist" aria-label="상담 상태">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "open"}
                className={tab === "open" ? "active" : ""}
                onClick={() => setTab("open")}
              >
                진행 중 <span>{counts.waiting + counts.active}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "closed"}
                className={tab === "closed" ? "active" : ""}
                onClick={() => setTab("closed")}
              >
                종료
                {counts.followUp > 0 && <em className="lc-tab-alert">후속 {counts.followUp}</em>}
              </button>
            </div>
            {notify === "default" && (
              <button type="button" className="lc-notify" onClick={() => void enableNotifications()}>
                <Bell size={14} />
                알림 켜기
              </button>
            )}
          </div>
          <div className="lc-filter lc-via" aria-label="들어온 곳으로 거르기">
            {VIA_FILTERS.map((filter) => {
              const count = filter.key === TALK_VIA ? counts.talk.waiting + counts.talk.unread : 0;
              return (
                <button
                  type="button"
                  key={filter.key || "all"}
                  aria-pressed={via === filter.key}
                  className={via === filter.key ? "active" : ""}
                  onClick={() => changeVia(filter.key)}
                >
                  {filter.label}
                  {count > 0 && <span>{count}</span>}
                </button>
              );
            })}
          </div>
          {via === TALK_VIA && talkConnected === false && (
            <p className="lc-talk-off">
              네이버 톡톡이 아직 연결되지 않았어요. 연결하면 톡톡으로 온 문의가 여기로 들어오고, 여기서 쓴 답이 고객 톡톡으로 가요.
            </p>
          )}
          <label className="lc-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="상담번호·주문번호·회원ID·대화 내용 검색"
            />
            {search && (
              <button type="button" aria-label="검색 지우기" onClick={() => setSearch("")}>
                <X size={13} />
              </button>
            )}
          </label>
          <p className="lc-list-summary">{summaryText}</p>
          {tab === "closed" && listMode !== "search" && (
            <div className="lc-filter" aria-label="상담 결과로 거르기">
              {CLOSED_FILTERS.map((filter) => {
                const count =
                  filter.key === "follow_up"
                    ? counts.followUp
                    : filter.key === "unclassified"
                      ? counts.unclassified
                      : filter.key === "trash"
                        ? counts.trash
                        : null;
                return (
                  <button
                    type="button"
                    key={filter.key || "all"}
                    aria-pressed={closedFilter === filter.key}
                    className={closedFilter === filter.key ? "active" : ""}
                    onClick={() => setClosedFilter(filter.key)}
                  >
                    {filter.label}
                    {count !== null && count > 0 && <span>{count}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {listError && <p className="lc-error">{listError}</p>}
          {!listLoaded && !listError && (
            <p className="lc-empty">
              <Loader2 size={15} className="spin-icon" /> 불러오는 중…
            </p>
          )}
          {listLoaded && chats.length === 0 && (
            <p className="lc-empty">
              {listMode === "search"
                ? "검색 결과가 없어요."
                : tab === "open"
                  ? "진행 중인 상담이 없어요."
                  : "이 조건의 종료 상담이 없어요."}
            </p>
          )}

          <ul className="lc-items">
            {chats.map((chat) => (
              <li key={chat.id}>
                <button
                  type="button"
                  className={chat.id === selectedId ? "lc-item active" : "lc-item"}
                  onClick={() => selectChat(chat)}
                >
                  <span className="lc-item-top">
                    <span className={`lc-chip ${statusChip(chat).className}`}>{statusChip(chat).label}</span>
                    <span className="lc-item-channel">{originLabel(chat)}</span>
                    {cautions[chat.id] && (
                      <span className="bc-flag" title={`블랙컨슈머 · ${cautionText(cautions[chat.id])}`}>
                        <ShieldAlert size={11} /> 블랙
                      </span>
                    )}
                    {chat.visitorOnline && chat.status !== "closed" && (
                      <span className="lc-online" title="고객이 상담 화면을 보고 있어요" />
                    )}
                    <WaitBadge chat={chat} now={loadedAt} />
                    <time>{formatDateTime(chat.lastMessageAt)}</time>
                  </span>
                  <span className="lc-item-preview">
                    {chat.lastSender === "agent" ? "상담원: " : ""}
                    {chat.lastMessagePreview.startsWith(TALK_PHOTO_PREFIX)
                      ? "[사진]"
                      : chat.lastMessagePreview || "(메시지 없음)"}
                  </span>
                  {(chat.intake.purchasePlace ||
                    chat.intake.inquiryType ||
                    chat.contactPhone ||
                    createdDay(chat) !== today) && (
                    <span className="lc-item-tags">
                      {chat.contactPhone &&
                        (chat.notifiedAt ? (
                          <span>문자 안내 보냄</span>
                        ) : (
                          <span className="is-notice">문자 안내 전</span>
                        ))}
                      {createdDay(chat) && createdDay(chat) !== today && (
                        <span className="is-day">{createdDay(chat).slice(5).replace("-", "/")} 접수</span>
                      )}
                      {chat.intake.purchasePlace && <span>{purchasePlaceLabel(chat.intake.purchasePlace)}</span>}
                      {chat.intake.inquiryType && <span>{chat.intake.inquiryType}</span>}
                    </span>
                  )}
                  {(chat.entry.faqQuestion || chat.entry.aiQuery) && (
                    <span className="lc-item-entry">
                      {chat.entry.faqQuestion ? `FAQ · ${chat.entry.faqQuestion}` : `AI 질문 · ${chat.entry.aiQuery}`}
                    </span>
                  )}
                  {chat.id !== selectedId && chat.agentUnread > 0 && <span className="lc-unread">{chat.agentUnread}</span>}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="lc-conv">
          {!selected ? (
            <div className="lc-placeholder">
              <MessageCircle size={28} />
              <p>왼쪽 목록에서 상담을 선택하세요.</p>
            </div>
          ) : (
            <>
              <header className="lc-conv-head">
                <div className="lc-conv-info">
                  <div className="lc-conv-title">
                    <span className={`lc-chip ${statusChip(selected).className}`}>{statusChip(selected).label}</span>
                    <strong>{originLabel(selected)} 고객</strong>
                    {selected.ticketNo && <span className="lc-ticket">{selected.ticketNo}</span>}
                    {/* 톡톡 고객은 이 화면을 보지 않아 접속 여부를 알 수 없다 */}
                    {!closed && selected.source.via !== TALK_VIA && (
                      <span className={selected.visitorOnline ? "lc-presence is-online" : "lc-presence"}>
                        {selected.visitorOnline ? "접속 중" : "오프라인"}
                      </span>
                    )}
                  </div>
                  <p className="lc-conv-sub">
                    {formatDateTime(selected.createdAt)} 시작
                    {closed && selected.outcome.memo && ` · 메모: ${selected.outcome.memo}`}
                    {selected.deletedAt &&
                      ` · ${formatDateTime(selected.deletedAt)} 삭제 · ${TRASH_DAYS}일 안에 복구할 수 있어요`}
                  </p>
                </div>
                <div className="lc-conv-actions">
                  {!selected.deletedAt && closed && selected.outcome.result === "resolved" && (
                    selected.assetClaimId ? (
                      <button type="button" className="is-asset" disabled>
                        <Sparkles size={15} />
                        자산 검토 대기 ✓
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="is-asset"
                        disabled={assetBusy}
                        title="이 상담을 AI 답변 근거(응대 자산) 후보로 보냅니다. 검토 후 라이브 전환해야 사용돼요."
                        onClick={async () => {
                          if (assetBusy) return;
                          setAssetBusy(true);
                          setAssetError("");
                          try {
                            const response = await fetch(`/api/admin/live-chats/${selected.id}/claim`, {
                              method: "POST",
                            });
                            const body = (await response.json().catch(() => ({}))) as {
                              claimId?: string;
                              error?: string;
                            };
                            if (response.ok && body.claimId) {
                              setSelected((prev) =>
                                prev && prev.id === selected.id ? { ...prev, assetClaimId: body.claimId! } : prev,
                              );
                            } else {
                              setAssetError(body.error ?? "응대 자산으로 보내지 못했어요.");
                            }
                          } finally {
                            setAssetBusy(false);
                          }
                        }}
                      >
                        <Sparkles size={15} />
                        {assetBusy ? "정리 중…" : "AI 자산으로 보내기"}
                      </button>
                    )
                  )}
                  {selected.deletedAt ? (
                    <>
                      <button type="button" onClick={() => void restoreChat()}>
                        <RotateCcw size={15} />
                        복구
                      </button>
                      <button type="button" className="is-danger" onClick={() => void purgeChat()}>
                        <Trash2 size={15} />
                        영구 삭제
                      </button>
                    </>
                  ) : closed ? (
                    <>
                      <button type="button" onClick={() => openOutcomePicker("edit")}>
                        {selected.outcome.result ? "결과 변경" : "결과 고르기"}
                      </button>
                      <button type="button" onClick={() => void patchChat({ status: "active" })}>
                        <RotateCcw size={15} />
                        다시 열기
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => {
                          setOutcomePicker(null);
                          setDeletePicker(true);
                        }}
                      >
                        <Trash2 size={15} />
                        삭제
                      </button>
                    </>
                  ) : (
                    <button type="button" className="is-danger" onClick={() => openOutcomePicker("close")}>
                      <CheckCircle2 size={15} />
                      상담 종료
                    </button>
                  )}
                </div>
              </header>

              {assetError && <p className="lc-asset-error">{assetError}</p>}

              {outcomePicker && (
                <div className="lc-outcome" role="dialog" aria-label="상담 결과">
                  <p className="lc-outcome-title">
                    {outcomePicker === "close" ? "상담 결과를 고르면 종료돼요" : "상담 결과를 골라 주세요"}
                  </p>
                  <div className="lc-outcome-options">
                    {CHAT_OUTCOMES.map((option) => (
                      <button
                        type="button"
                        key={option.key}
                        className={`lc-outcome-option is-outcome-${option.key}`}
                        onClick={() => void submitOutcome(option.key)}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.hint}</span>
                      </button>
                    ))}
                  </div>
                  <div className="lc-outcome-foot">
                    <input
                      value={outcomeMemo}
                      onChange={(event) => setOutcomeMemo(event.target.value)}
                      maxLength={200}
                      placeholder="메모 (선택) 예: 사진 받으면 교환 접수"
                    />
                    <button type="button" onClick={() => setOutcomePicker(null)}>
                      취소
                    </button>
                  </div>
                </div>
              )}

              {deletePicker && !selected.deletedAt && (
                <div className="lc-outcome is-delete" role="dialog" aria-label="상담 삭제">
                  <p className="lc-outcome-title">
                    삭제 사유를 고르면 휴지통으로 옮겨요 · {TRASH_DAYS}일 안에는 복구할 수 있어요
                  </p>
                  <div className="lc-outcome-options">
                    {DELETE_REASONS.map((reason) => (
                      <button
                        type="button"
                        key={reason.key}
                        className={`lc-outcome-option is-reason-${reason.key}`}
                        onClick={() => void trashChat(reason.key)}
                      >
                        <strong>{reason.label}</strong>
                        <span>{reason.hint}</span>
                      </button>
                    ))}
                  </div>
                  <div className="lc-outcome-foot">
                    <span className="lc-outcome-note">실제 고객 상담은 분쟁 기록(3년 보관)이라 지우지 마세요.</span>
                    <button type="button" onClick={() => setDeletePicker(false)}>
                      취소
                    </button>
                  </div>
                </div>
              )}

              {caution && (
                <div className="lc-caution" role="alert">
                  <ShieldAlert size={16} />
                  <span>
                    <strong>블랙컨슈머</strong> {cautionText(caution)} — 응대에 주의하세요
                  </span>
                  <Link href={`/admin/black-consumers?id=${caution.id}`}>자세히</Link>
                </div>
              )}

              <div className="lc-context" aria-label="고객 맥락">
                {contextChips(selected).map((chip) =>
                  chip.href ? (
                    <a key={chip.label} className="lc-context-chip" href={chip.href} target="_blank" rel="noreferrer noopener">
                      <em>{chip.label}</em>
                      {chip.value}
                    </a>
                  ) : (
                    <span key={chip.label} className="lc-context-chip">
                      <em>{chip.label}</em>
                      {chip.value}
                    </span>
                  ),
                )}
                {!selected.deletedAt && (
                  <span className="lc-context-tools">
                    {selected.contactPhone && (
                      <Link href={`/admin/customers?phone=${selected.contactPhone}`}>
                        <UserSearch size={12} /> 고객 조회
                      </Link>
                    )}
                    {!caution && (
                      <Link
                        href={`/admin/black-consumers?${new URLSearchParams({
                          new: "1",
                          chat: selected.id,
                          ticket: selected.ticketNo,
                          talk: selected.source.via === TALK_VIA ? "1" : "",
                          phone: selected.contactPhone,
                          memberId: selected.memberId,
                        })}`}
                      >
                        <ShieldAlert size={12} /> 블랙컨슈머 등록
                      </Link>
                    )}
                  </span>
                )}
              </div>

              <div className="lc-messages" ref={bodyRef}>
                {messages.map((message) =>
                  message.sender === "system" ? (
                    <p className="lc-system" key={message.seq}>
                      {message.text}
                    </p>
                  ) : (
                    <div className={message.sender === "agent" ? "lc-msg is-mine" : "lc-msg"} key={message.seq}>
                      <div className={message.delivery === "failed" ? "lc-bubble is-failed" : "lc-bubble"}>
                        <MessageText text={message.text} />
                      </div>
                      <time>{formatDateTime(message.createdAt)}</time>
                      {message.delivery === "sending" && <span className="lc-delivery">톡톡으로 보내는 중…</span>}
                      {message.delivery === "failed" && (
                        <span className="lc-delivery is-failed">톡톡으로 보내지 못했어요 — 고객에게 가지 않았어요</span>
                      )}
                      {message.partner && <span className="lc-delivery">톡톡 파트너센터에서 보냄</span>}
                    </div>
                  ),
                )}
              </div>

              {selected.contactPhone && (
                <ReplyNotice
                  key={selected.id}
                  chat={selected}
                  onNotified={(notifiedAt) => {
                    setSelected((prev) => (prev && prev.id === selected.id ? { ...prev, notifiedAt } : prev));
                    void loadList();
                  }}
                />
              )}

              {chatError && <p className="lc-error">{chatError}</p>}

              <div className="lc-quick" aria-label="빠른 문구">
                {[
                  ...DEFAULT_SNIPPETS.map((snippet) => ({ key: `default-${snippet.title}`, ...snippet })),
                  ...snippets.map((snippet) => ({ key: snippet.id, title: snippet.title, body: snippet.body })),
                ].map((snippet) => (
                  <button
                    type="button"
                    key={snippet.key}
                    title={snippet.body}
                    disabled={closed}
                    onClick={() => insertIntoReply(snippet.body)}
                  >
                    {snippet.title}
                  </button>
                ))}
              </div>

              <form className="lc-reply" onSubmit={sendReply}>
                <textarea
                  ref={replyRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={closed}
                  maxLength={1000}
                  rows={3}
                  placeholder={
                    closed
                      ? "종료된 상담입니다. 다시 열면 답변할 수 있어요."
                      : selected.source.via === TALK_VIA
                        ? "답변 입력 — 고객의 네이버 톡톡으로 바로 가요 (Enter 전송 · Shift+Enter 줄바꿈)"
                        : "답변 입력 (Enter 전송 · Shift+Enter 줄바꿈)"
                  }
                />
                <button type="submit" disabled={closed || sending || !draft.trim()}>
                  {sending ? <Loader2 size={16} className="spin-icon" /> : <Send size={16} />}
                  보내기
                </button>
              </form>
            </>
          )}
        </div>

        <aside className="lc-assist" aria-label="상담 도움">
          {selected ? (
            <AdminLiveChatAssist
              key={selected.id}
              chat={selected}
              snippets={snippets}
              onSnippetsChange={setSnippets}
              onInsert={insertIntoReply}
              onOpenChat={selectChat}
            />
          ) : (
            <div className="lc-placeholder">
              <Sparkles size={26} />
              <p>상담을 선택하면 AI 도우미·고객 주문 정보·자주 쓰는 답변이 여기에 표시돼요.</p>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
