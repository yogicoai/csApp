"use client";

import { CalendarRange, Copy, Download, FileText, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { kstToday, shiftDay } from "@/lib/liveChatHours";

// 주간 리포트 + 상담 기록 CSV 내려받기 — TWC 대체 계획의 "주간 리포트" 화면.
// 기간을 고르면 실시간 상담·음성 상담을 요약하고, 메신저에 붙여넣을 텍스트 보고서를 만들어 준다.

type CountRow = { label: string; count: number };
type Report = {
  from: string;
  to: string;
  chat: {
    total: number;
    open: number;
    offHours: number;
    outcomes: Record<"resolved" | "follow_up" | "handed_off" | "unresolved" | "unclassified", number>;
    avgFirstResponseSec: number;
    byType: CountRow[];
    byPlace: CountRow[];
    byVia: CountRow[];
    assetCount: number;
    questions: string[];
  };
  voice: { total: number; byCategory: CountRow[] };
};

function fmtSec(sec: number) {
  if (!sec) return "—";
  if (sec < 60) return `${sec}초`;
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

function fmtRows(rows: CountRow[], limit = 5) {
  return rows
    .slice(0, limit)
    .map((row) => `${row.label} ${row.count}`)
    .join(" · ");
}

export function WeeklyReport() {
  const [from, setFrom] = useState(() => shiftDay(kstToday(), -6));
  const [to, setTo] = useState(() => kstToday());
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (fromDay: string, toDay: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/live-chats/report?from=${fromDay}&to=${toDay}`, { cache: "no-store" });
      if (response.ok) setReport((await response.json()) as Report);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // 첫 로드는 다음 틱으로 미뤄 렌더 중 상태 변경을 피한다.
    const timer = window.setTimeout(() => void load(shiftDay(kstToday(), -6), kstToday()), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function buildText(data: Report) {
    const { chat, voice } = data;
    const lines = [
      `[요기보 CS 리포트] ${data.from} ~ ${data.to}`,
      `실시간 상담 접수 ${chat.total}건 (진행 중 ${chat.open} · 운영시간 외 ${chat.offHours}) · 평균 첫 응답 ${fmtSec(chat.avgFirstResponseSec)}`,
      `결과: 해결 ${chat.outcomes.resolved} · 후속 조치 ${chat.outcomes.follow_up} · 다른 곳 안내 ${chat.outcomes.handed_off} · 미해결 ${chat.outcomes.unresolved} · 미분류 ${chat.outcomes.unclassified}`,
      chat.byType.length ? `문의유형: ${fmtRows(chat.byType)}` : "",
      chat.byPlace.length ? `구매처: ${fmtRows(chat.byPlace)}` : "",
      chat.byVia.length ? `유입: ${fmtRows(chat.byVia)}` : "",
      `음성 상담 분석 ${voice.total}건${voice.byCategory.length ? ` (${fmtRows(voice.byCategory, 3)})` : ""}`,
      chat.assetCount ? `응대 자산으로 승격 ${chat.assetCount}건` : "",
    ].filter(Boolean);
    if (chat.questions.length) {
      lines.push("주요 문의:");
      for (const question of chat.questions.slice(0, 8)) lines.push(`- ${question}`);
    }
    return lines.join("\n");
  }

  async function copyReport() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(buildText(report));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드가 막힌 환경에서는 무시
    }
  }

  return (
    <section className="wr-card">
      <header className="wr-head">
        <div className="wr-title">
          <FileText size={17} />
          <h2>기간 리포트 · 상담 기록 내려받기</h2>
        </div>
        <div className="wr-range">
          <CalendarRange size={14} />
          <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          <span>~</span>
          <input type="date" value={to} min={from} max={kstToday()} onChange={(event) => setTo(event.target.value)} />
          <button type="button" className="wr-apply" disabled={busy} onClick={() => void load(from, to)}>
            {busy ? <Loader2 size={13} className="spin-icon" /> : "조회"}
          </button>
        </div>
      </header>

      {report && (
        <>
          <div className="wr-stats">
            <span className="wr-stat"><strong>{report.chat.total}</strong> 접수</span>
            <span className="wr-stat"><strong>{report.chat.outcomes.resolved}</strong> 해결</span>
            <span className="wr-stat"><strong>{report.chat.outcomes.follow_up}</strong> 후속 조치</span>
            <span className="wr-stat"><strong>{report.chat.outcomes.unresolved}</strong> 미해결</span>
            <span className="wr-stat"><strong>{report.chat.offHours}</strong> 운영시간 외</span>
            <span className="wr-stat"><strong>{fmtSec(report.chat.avgFirstResponseSec)}</strong> 평균 첫 응답</span>
            <span className="wr-stat"><strong>{report.voice.total}</strong> 음성 분석</span>
            <span className="wr-stat"><strong>{report.chat.assetCount}</strong> 자산 승격</span>
          </div>
          <div className="wr-rows">
            {report.chat.byType.length > 0 && (
              <p><strong>문의유형</strong> {fmtRows(report.chat.byType, 8)}</p>
            )}
            {report.chat.byPlace.length > 0 && (
              <p><strong>구매처</strong> {fmtRows(report.chat.byPlace, 8)}</p>
            )}
            {report.chat.byVia.length > 0 && <p><strong>유입</strong> {fmtRows(report.chat.byVia, 8)}</p>}
            {report.voice.byCategory.length > 0 && (
              <p><strong>음성 유형</strong> {fmtRows(report.voice.byCategory, 6)}</p>
            )}
          </div>
        </>
      )}

      <div className="wr-actions">
        <button type="button" onClick={() => void copyReport()} disabled={!report}>
          <Copy size={14} />
          {copied ? "복사됨!" : "리포트 텍스트 복사"}
        </button>
        <a className="wr-download" href={`/api/admin/live-chats/export?from=${from}&to=${to}`} download>
          <Download size={14} />
          상담 기록 CSV(엑셀) 내려받기
        </a>
      </div>
    </section>
  );
}
