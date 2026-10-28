"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ACCESS_ACTIONS, ACCESS_LOG_PERIODS, type AccessLogView, accessActionLabel, maskPhone } from "@/lib/accessLog";

// 조회 기록 — 누가·언제·어떤 고객의 개인정보를 봤는지(고객 조회·자세히 보기·녹취 재생·파일 내려받기)와 로그인 성공·실패.
// 계정을 같이 쓰므로 '처리하는 사람'은 스스로 적은 이름이고, 같은 로그인(세션)·접속 IP 로 같이 확인한다.

const PERIOD_LABEL: Record<number, string> = { 1: "오늘(24시간)", 7: "최근 7일", 30: "최근 30일", 90: "최근 90일", 365: "최근 1년" };

function kstStamp(iso: string) {
  if (!iso) return "";
  const text = new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString();
  return `${text.slice(0, 10)} ${text.slice(11, 19)}`;
}

export function AccessLogList() {
  const [days, setDays] = useState(30);
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [logs, setLogs] = useState<AccessLogView[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(500);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (action) params.set("action", action);
      if (query) params.set("q", query);
      const response = await fetch(`/api/admin/access-logs?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "조회 기록을 불러오지 못했어요.");
        return;
      }
      setError("");
      setLogs(body.logs ?? []);
      setTotal(body.total ?? 0);
      setLimit(body.limit ?? 500);
    } catch {
      setError("조회 기록을 불러오지 못했어요.");
    } finally {
      setLoaded(true);
    }
  }, [days, action, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  return (
    <section className="al-panel">
      <p className="al-guide">
        고객 개인정보를 본 기록이에요. 2년 동안 보관하고 지나면 자동으로 지워져요. 한 달에 한 번은 이상한 조회가 없는지 확인해 주세요 — 이름이
        없는 조회, 처음 보는 IP, 늦은 밤 조회, 짧은 시간에 몰린 조회, 로그인 실패가 이어진 경우.
      </p>
      <div className="al-toolbar">
        <select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="기간">
          {ACCESS_LOG_PERIODS.map((period) => (
            <option key={period} value={period}>
              {PERIOD_LABEL[period]}
            </option>
          ))}
        </select>
        <select value={action} onChange={(event) => setAction(event.target.value)} aria-label="한 일">
          <option value="">한 일 전체</option>
          {ACCESS_ACTIONS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <label className="bc-search">
          <Search size={14} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="고객 번호·처리하는 사람·내용·IP 로 찾기" />
          {search && (
            <button type="button" aria-label="검색어 지우기" onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          )}
        </label>
      </div>

      {error && <p className="sc-error">{error}</p>}
      {!loaded ? (
        <p className="bc-muted">불러오는 중…</p>
      ) : logs.length === 0 ? (
        <p className="sc-empty">{query || action ? "찾는 기록이 없어요." : "이 기간에 남은 기록이 없어요."}</p>
      ) : (
        <div className="al-table-wrap">
          <table className="al-table">
            <thead>
              <tr>
                <th>시각</th>
                <th>처리하는 사람</th>
                <th>한 일</th>
                <th>고객</th>
                <th>내용</th>
                <th>접속(IP · 세션)</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className={`is-${log.action}`}>
                  <td className="al-time">{kstStamp(log.at)}</td>
                  <td>{log.operator || <span className="bc-muted">이름 없음</span>}</td>
                  <td>
                    <span className={`al-action is-${log.action}`}>{accessActionLabel(log.action)}</span>
                  </td>
                  <td>
                    {log.target ? (
                      <Link href={`/admin/customers?phone=${log.target}`} title="고객 조회로 열기(조회 기록에 남아요)">
                        {maskPhone(log.target)}
                      </Link>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="al-detail">{log.detail}</td>
                  <td className="al-where" title={log.userAgent}>
                    {log.ip || "—"}
                    {log.session && <span> · {log.session}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loaded && total > logs.length && <p className="cu-note">전체 {total}건 중 최근 {limit}건만 보여요. 기간·검색으로 좁혀 주세요.</p>}
    </section>
  );
}
