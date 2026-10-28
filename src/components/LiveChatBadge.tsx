"use client";

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { useEffect, useState } from "react";

const POLL_MS = 20_000;

// 어드민 헤더의 실시간 상담 바로가기 — 대기 상담 + 안 읽은 메시지 수를 표시한다.
export function LiveChatBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const response = await fetch("/api/admin/live-chats", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { counts?: { waiting: number; unread: number } };
        if (alive && body.counts) setCount(body.counts.waiting + body.counts.unread);
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

  return (
    <Link
      href="/admin/live-chat"
      className={count ? "unanswered-link has-unanswered" : "unanswered-link"}
      title="실시간 상담 콘솔 — 대기 상담과 안 읽은 메시지"
    >
      <MessagesSquare size={16} />
      실시간 상담
      {count !== null && <span className="unanswered-count">{count}</span>}
    </Link>
  );
}
