"use client";

import { AlarmClock, ArrowRight, ClipboardList, Inbox, MessageSquareWarning, RefreshCw, Send, Star } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BOARD_PERIODS, type BoardSummary, formatWorkHours } from "@/lib/boards";

// 상담 지표 · 게시판 — 홈페이지(Q&A·상품 후기)와 스마트스토어(상품문의·고객문의)를 나란히 요약한다.
// 숫자는 /api/admin/boards/stats 가 cafe24·onlineData 에서 그때그때 세고, 우리 앱에서 단 답변은 기록에서 센다.

type HomepageBoardStat = BoardSummary & { no: number; name: string; needsAnswer: boolean };
type SummaryOrError = { summary?: BoardSummary; error?: string };
type BoardStatsData = {
  from: string;
  to: string;
  homepage: { error?: string; boards: HomepageBoardStat[]; appAnswers: number | null };
  smartstore: { error?: string; qna?: SummaryOrError; inquiry?: SummaryOrError; appAnswers: number | null };
};

type Tile = { label: string; value: string; hint: string; icon: typeof Inbox };

function answerTiles(name: string, summary: BoardSummary): Tile[] {
  return [
    { label: `${name} 글`, value: `${summary.total}건`, hint: `답변 완료 ${summary.answered}건`, icon: Inbox },
    {
      label: "미답변",
      value: `${summary.open}건`,
      hint: summary.open ? `가장 오래 근무시간 ${formatWorkHours(summary.oldestOpenHours)} 기다림` : "모두 답했어요",
      icon: MessageSquareWarning,
    },
    {
      label: "평균 답변 시간",
      value: formatWorkHours(summary.avgAnswerHours),
      hint: "근무시간(평일 10:00~17:30)만 셈 — 밤·주말 제외",
      icon: AlarmClock,
    },
  ];
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="metric-grid">
      {tiles.map((tile) => (
        <article className="metric-card" key={tile.label}>
          <div className="metric-top">
            <tile.icon size={16} />
            <span>{tile.label}</span>
          </div>
          <strong>{tile.value}</strong>
          <small>{tile.hint}</small>
        </article>
      ))}
    </div>
  );
}

export function BoardStats() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<BoardStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (period: number) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/boards/stats?days=${period}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "게시판 지표를 불러오지 못했어요.");
        return;
      }
      setData(body);
    } catch {
      setError("게시판 지표를 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(days), 0);
    return () => window.clearTimeout(timer);
  }, [days, load]);

  const homepage = data?.homepage;
  const qna = homepage?.boards.find((board) => board.needsAnswer);
  const reviews = homepage?.boards.filter((board) => !board.needsAnswer) ?? [];
  const store = data?.smartstore;

  return (
    <section className="dashboard bd-stats">
      <div className="dashboard-head">
        <div className="panel-title">
          <ClipboardList size={20} />
          <h2>게시판 지표</h2>
        </div>
        <div className="dashboard-controls">
          <div className="period-toggle" role="tablist" aria-label="게시판 지표 기간">
            {BOARD_PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                role="tab"
                aria-selected={period === days}
                className={period === days ? "active" : ""}
                onClick={() => setDays(period)}
              >
                최근 {period}일
              </button>
            ))}
          </div>
          <button className="icon-button" onClick={() => void load(days)} type="button" aria-label="게시판 지표 새로고침">
            <RefreshCw size={16} className={loading ? "spin-icon" : ""} />
          </button>
        </div>
      </div>

      {error ? (
        <p className="empty-state">{error}</p>
      ) : (
        <div className="bd-stats-grid">
          <article className="bd-stats-col">
            <header>
              <h3>홈페이지</h3>
              <span>{data ? `${data.from} ~ ${data.to}` : "불러오는 중…"}</span>
            </header>
            {homepage?.error ? (
              <p className="empty-state">{homepage.error}</p>
            ) : qna ? (
              <>
                <Tiles tiles={answerTiles(qna.name, qna)} />
                <Tiles
                  tiles={[
                    ...reviews.map((board) => ({
                      label: board.name,
                      value: `${board.total}건`,
                      hint: `답글 단 후기 ${board.answered}건`,
                      icon: Star,
                    })),
                    {
                      label: "여기서 등록한 답변",
                      value: homepage?.appAnswers == null ? "—" : `${homepage.appAnswers}건`,
                      hint: "게시판 관리에서 단 답글",
                      icon: Send,
                    },
                  ]}
                />
              </>
            ) : (
              !homepage && <p className="empty-state">불러오는 중…</p>
            )}
          </article>

          <article className="bd-stats-col">
            <header>
              <h3>스마트스토어</h3>
              <span>상품문의 · 고객문의</span>
            </header>
            {store?.error ? (
              <p className="empty-state">{store.error}</p>
            ) : store ? (
              <>
                {(
                  [
                    ["상품문의", store.qna],
                    ["고객문의", store.inquiry],
                  ] as const
                ).map(([name, part]) =>
                  part?.summary ? (
                    <Tiles key={name} tiles={answerTiles(name, part.summary)} />
                  ) : (
                    <p key={name} className="empty-state">
                      {name}: {part?.error ?? "불러오지 못했어요."}
                    </p>
                  ),
                )}
                <Tiles
                  tiles={[
                    {
                      label: "여기서 등록한 답변",
                      value: store.appAnswers === null ? "—" : `${store.appAnswers}건`,
                      hint: "게시판 관리에서 단 답변(상품문의·고객문의)",
                      icon: Send,
                    },
                  ]}
                />
              </>
            ) : (
              <p className="empty-state">불러오는 중…</p>
            )}
          </article>
        </div>
      )}

      <Link className="bd-stats-link" href="/admin/boards">
        게시판 관리에서 글 보기·답변하기 <ArrowRight size={14} />
      </Link>
    </section>
  );
}
