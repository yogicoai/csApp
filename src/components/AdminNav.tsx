"use client";

import {
  BarChart3,
  BellRing,
  BookOpen,
  CalendarDays,
  ClipboardList,
  MessagesSquare,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Volume2,
  VolumeX,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AdminPasswordButton } from "@/components/AdminPasswordButton";
import { BOARDS_CHANGED_EVENT } from "@/lib/boards";
import { type LiveChatClosureInfo, useLiveChatClosure, useLiveChatHoursOpen } from "@/components/LiveChat";
import { LIVE_CHAT_HOURS_LABEL } from "@/lib/liveChatHours";
import { TALK_VIA } from "@/lib/liveChatOptions";

const POLL_MS = 10_000;
const BOARD_POLL_MS = 5 * 60_000;
const SOUND_KEY = "cs_admin_sound";
const COLLAPSE_KEY = "cs_admin_nav_collapsed";

// 어드민 왼쪽 내비게이션 — CS 콘솔처럼 업무별 화면으로 바로 이동한다(맨 위는 전체 데이터를 보는 상담 지표).
// 새 상담·새 메시지가 오면 어느 어드민 화면에 있어도 소리 + 탭 깜빡임 + PC(브라우저) 알림으로 알려준다.
const MENU = [
  { href: "/admin", label: "상담 지표", icon: BarChart3 },
  { href: "/admin/live-chat", label: "실시간 상담", icon: MessagesSquare },
  { href: "/admin/boards", label: "게시판 관리", icon: ClipboardList },
  { href: "/admin/voice", label: "음성 상담 분석", icon: Mic },
  { href: "/admin/faqs", label: "FAQ 관리", icon: Pencil },
  { href: "/admin/leave", label: "연차 관리", icon: CalendarDays },
  { href: "/admin/guide", label: "사용 가이드", icon: BookOpen },
];

function readSoundOn() {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

// 사이드바 상단 상태 — 오늘 휴가가 있을 때 지금 상담이 열려 있는지까지 보여준다.
function leaveStateText(closure: LiveChatClosureInfo) {
  if (closure.type === "am") return closure.closedNow ? "오전반차 · 14:00부터 상담" : "오전반차 · 지금 상담 가능";
  if (closure.type === "pm") return closure.closedNow ? "오후반차 · 실시간 상담 닫힘" : "오후반차 · 13:00까지 상담";
  return "오늘 연차 · 실시간 상담 닫힘";
}

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

// 새 상담 알림음 — 파일 없이 브라우저 오디오로 "딩동" 두 음을 낸다.
function playChime() {
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const tone = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.32);
    };
    tone(880, 0);
    tone(1174.7, 0.18);
    window.setTimeout(() => void ctx.close(), 900);
  } catch {
    // 소리가 막힌 환경(자동재생 차단 등)에서는 조용히 넘어간다.
  }
}

function subscribeNotificationPermission(callback: () => void) {
  // 권한 변경 이벤트가 없어, 버튼 동작 후 수동 갱신에 의존한다.
  void callback;
  return () => {};
}

export function AdminNav() {
  const pathname = usePathname();
  const closure = useLiveChatClosure();
  const hoursOpen = useLiveChatHoursOpen();
  // 실시간 상담 배지 — 대기 상담 + 안 읽은 메시지 수(그중 네이버 톡톡은 아래 [네이버 톡톡]에도 따로)
  const [chatCount, setChatCount] = useState<number | null>(null);
  const [talkCount, setTalkCount] = useState<number | null>(null);
  const [boardCount, setBoardCount] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  // 사이드바 접힘 — 상담할 때 화면을 넓게 쓰도록 아이콘만 남긴다(브라우저에 기억)
  const [collapsed, setCollapsed] = useState(false);
  const [notifTick, setNotifTick] = useState(0);
  const prevCountRef = useRef<number | null>(null);
  const prevTalkRef = useRef<number | null>(null);
  const pathRef = useRef(pathname);
  const soundRef = useRef(true);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const notifPermission = useSyncExternalStore(
    subscribeNotificationPermission,
    () => (typeof Notification === "undefined" ? ("unsupported" as const) : Notification.permission),
    () => "unsupported" as const,
  );
  void notifTick;

  useEffect(() => {
    const on = readSoundOn();
    const folded = readCollapsed();
    // 첫 페인트 뒤에 저장값을 반영한다(SSR과 초기 화면을 맞추기 위해).
    const timer = window.setTimeout(() => {
      setSoundOn(on);
      soundRef.current = on;
      setCollapsed(folded);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const response = await fetch("/api/admin/live-chats", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as {
          counts?: { waiting: number; unread: number; talk?: { waiting: number; unread: number } };
        };
        if (!alive || !body.counts) return;
        const next = body.counts.waiting + body.counts.unread;
        const talk = body.counts.talk ? body.counts.talk.waiting + body.counts.talk.unread : 0;
        setChatCount(next);
        setTalkCount(talk);

        // 수가 늘었을 때만 알린다(처음 로드는 기준값으로만 쓴다). 늘어난 게 톡톡이면 톡톡이라고 알린다.
        const prev = prevCountRef.current;
        const prevTalk = prevTalkRef.current;
        prevCountRef.current = next;
        prevTalkRef.current = talk;
        if (prev === null || next <= prev) return;
        const fromTalk = prevTalk !== null && talk > prevTalk;

        // 콘솔 화면은 자체 알림음이 있으므로, 다른 화면이거나 창이 숨겨져 있을 때만 알린다.
        const away = document.hidden || !pathRef.current.startsWith("/admin/live-chat");
        if (!away) return;
        if (soundRef.current) playChime();
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const notification = new Notification(fromTalk ? "요기보 네이버 톡톡" : "요기보 실시간 상담", {
            body: fromTalk
              ? `네이버 톡톡 새 문의·메시지가 있어요(대기·안 읽음 ${talk}건). 눌러서 바로 답변하세요.`
              : `대기·안 읽은 메시지가 ${next}건 있어요. 눌러서 바로 답변하세요.`,
            tag: "cs-live-chat",
          });
          notification.onclick = () => {
            window.focus();
            window.location.href = fromTalk ? `/admin/live-chat?via=${TALK_VIA}` : "/admin/live-chat";
          };
        }
      } catch {
        // 다음 주기에 다시 시도
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // 게시판 관리 배지 — 최근 30일 미답변(홈페이지 Q&A + 스마트스토어 고객문의).
  // cafe24·네이버를 부르는 숫자라 몇 분마다만 세고, 게시판 관리에서 답을 달면 바로 다시 센다.
  useEffect(() => {
    let alive = true;
    async function load(fresh = false) {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/admin/boards/open-count${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { total?: number };
        if (alive && typeof body.total === "number") setBoardCount(body.total);
      } catch {
        // 다음 주기에 다시 시도
      }
    }
    const refresh = () => void load(true);
    void load();
    const timer = window.setInterval(() => void load(), BOARD_POLL_MS);
    window.addEventListener(BOARDS_CHANGED_EVENT, refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(BOARDS_CHANGED_EVENT, refresh);
    };
  }, []);

  // 다른 화면을 보고 있을 때 새 상담이 있으면 탭 제목을 깜빡여 눈에 띄게 한다.
  // 실시간 상담 콘솔 화면은 자체적으로 제목에 건수를 표시하므로 건드리지 않는다.
  useEffect(() => {
    if (!chatCount || pathname.startsWith("/admin/live-chat")) return;
    const base = document.title;
    let flipped = false;
    const timer = window.setInterval(() => {
      flipped = !flipped;
      document.title = flipped ? `🔔 상담 ${chatCount}건 — 확인해 주세요` : base;
    }, 1200);
    return () => {
      window.clearInterval(timer);
      document.title = base;
    };
  }, [chatCount, pathname]);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    soundRef.current = next;
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // 저장이 막혀도 이 화면에서는 동작한다.
    }
    if (next) playChime();
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // 저장이 막혀도 이 화면에서는 동작한다.
    }
  }

  async function enableDesktopNotification() {
    if (typeof Notification === "undefined") return;
    await Notification.requestPermission();
    setNotifTick((tick) => tick + 1);
  }

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className={collapsed ? "admin-nav is-collapsed" : "admin-nav"}>
      <div className="admin-nav-top">
        <Link href="/admin" className="admin-nav-brand" aria-label="CS 센터 메인(상담 지표)으로 이동">
          <img
            className="admin-nav-logo"
            src="https://yogibo.kr/web/img/icon/logo3_on.png"
            alt="Yogibo"
            width={96}
            height={38}
          />
          <strong>CS 센터</strong>
          <span className={hoursOpen && !closure?.closedNow ? "admin-nav-state is-on" : "admin-nav-state"}>
            {closure ? leaveStateText(closure) : hoursOpen === null
              ? LIVE_CHAT_HOURS_LABEL
              : `${hoursOpen ? "상담 가능" : "운영시간 외"} · ${LIVE_CHAT_HOURS_LABEL}`}
          </span>
        </Link>
        <button
          type="button"
          className="admin-nav-toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
          title={collapsed ? "메뉴 펼치기" : "메뉴 접기 — 상담 화면을 넓게 써요"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <nav className="admin-nav-menu" aria-label="어드민 메뉴">
        {MENU.map((item) => {
          const count = item.href === "/admin/live-chat" ? chatCount : item.href === "/admin/boards" ? boardCount : null;
          const off = item.href === "/admin/leave" && Boolean(closure);
          const offLabel = closure?.type === "am" ? "오전반차" : closure?.type === "pm" ? "오후반차" : "오늘 연차";
          return (
            <Fragment key={item.href}>
              <Link
                href={item.href}
                className={isActive(item.href) ? "is-active" : undefined}
                title={collapsed ? `${item.label}${count ? ` (${count})` : ""}${off ? ` · ${offLabel}` : ""}` : undefined}
              >
                <span className="admin-nav-icon">
                  <item.icon size={17} />
                  {/* 접힌 상태에서는 숫자·휴무 표시를 아이콘 위에 작게 */}
                  {collapsed && count ? <i className="admin-nav-bubble">{count}</i> : null}
                  {collapsed && off ? <i className="admin-nav-bubble is-dot" /> : null}
                </span>
                <span className="admin-nav-label">{item.label}</span>
                {!collapsed && count ? <span className="unanswered-count">{count}</span> : null}
                {!collapsed && off ? <span className="admin-nav-off">{offLabel}</span> : null}
              </Link>
              {/* 실시간 상담 아래 — 네이버 톡톡 상담만 거른 콘솔로 바로 간다(접힌 상태에서는 숨김) */}
              {item.href === "/admin/live-chat" && !collapsed && (
                <Link href={`/admin/live-chat?via=${TALK_VIA}`} className="admin-nav-sub">
                  <span className="admin-nav-label">네이버 톡톡</span>
                  {talkCount ? <span className="unanswered-count">{talkCount}</span> : null}
                </Link>
              )}
            </Fragment>
          );
        })}
      </nav>
      <div className="admin-nav-foot">
        <div className="admin-nav-alerts">
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label={soundOn ? "소리 켬" : "소리 끔"}
            title="새 상담이 오면 딩동 소리로 알려요"
          >
            {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            <span className="admin-nav-label">{soundOn ? "소리 켬" : "소리 끔"}</span>
          </button>
          <button
            type="button"
            onClick={() => void enableDesktopNotification()}
            disabled={notifPermission === "granted" || notifPermission === "unsupported"}
            aria-label={notifPermission === "granted" ? "PC 알림 켜짐" : "PC 알림 켜기"}
            title="다른 창을 보고 있어도 Windows 알림으로 띄워요"
          >
            <BellRing size={14} />
            <span className="admin-nav-label">{notifPermission === "granted" ? "PC 알림 켜짐" : "PC 알림 켜기"}</span>
          </button>
        </div>
        {!collapsed && <AdminPasswordButton />}
      </div>
    </aside>
  );
}
