"use client";

import { Download, History, Loader2, Pencil, Plus, RotateCcw, Search, ShieldAlert, ShieldOff, Trash2, UserSearch, X } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BLACK_REASONS,
  BLACK_STATUS_LABEL,
  type BlackConsumerView,
  type BlackSettings,
  HISTORY_LABEL,
  reasonLabel,
  RETENTION_MONTHS,
} from "@/lib/blackConsumer";
import { formatPhone, phoneDigits } from "@/lib/phone";

// 블랙컨슈머 관리 — CS 가 주의 고객을 등록·수정·연장·해제한다. 자동으로 막지 않고 상담·녹취 화면에 주의 표시만 한다.
// 계정이 하나라 누가 처리했는지는 '처리하는 사람'으로 받아 이력에 남긴다(이 브라우저에 기억).

type Tab = "current" | "ending" | "ended" | "all";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "current", label: "주의 중" },
  { id: "ending", label: "곧 끝남" },
  { id: "ended", label: "끝남·해제" },
  { id: "all", label: "전체" },
];
type Counts = { current: number; ending: number; ended: number };

// 다른 화면(상담·녹취·고객 조회)에서 넘어올 때 채워 둘 값
export type BlackPrefill = {
  open: boolean;
  phone: string;
  memberId: string;
  chatId: string;
  ticket: string;
  talk: boolean;
  name: string;
  refs: string;
  focusId: string;
  query: string;
};

type FormState = {
  mode: "new" | "edit";
  id: string;
  phone: string;
  memberId: string;
  chatId: string;
  talkNote: string;
  name: string;
  reasons: string[];
  detail: string;
  refs: string;
  months: number;
};

type Dialog = { kind: "extend" | "release" | "reopen" | "delete"; entry: BlackConsumerView; months: number; note: string };

const BY_KEY = "cs_admin_black_by";
const JSON_HEADERS = { "Content-Type": "application/json" };
const CRITERIA_EXAMPLE = [
  "예)",
  "· 등록: 폭언·욕설·성희롱 1회, 같은 민원 하루 3회 이상 반복, 근거 없는 과도한 보상 요구",
  "· 응대: 녹음 고지 후 경고 1회, 계속되면 통화를 끝내고 상담 기록에 남기기",
  "· 해제: 기간이 끝나면 다시 검토, 잘못 등록했거나 사과가 확인되면 바로 해제",
].join("\n");

function readBy() {
  try {
    return window.localStorage.getItem(BY_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveBy(value: string) {
  try {
    window.localStorage.setItem(BY_KEY, value);
  } catch {
    // 저장이 막힌 브라우저면 다음에 다시 적으면 된다.
  }
}

// ISO 시각 → KST 날짜(·시각)
function kstText(iso: string, withTime = false) {
  if (!iso) return "";
  const text = new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString();
  return withTime ? `${text.slice(0, 10)} ${text.slice(11, 16)}` : text.slice(0, 10);
}

function identity(entry: Pick<BlackConsumerView, "phone" | "memberId" | "talk">) {
  if (entry.phone) return formatPhone(entry.phone);
  if (entry.memberId) return `회원 ${entry.memberId}`;
  return entry.talk ? "네이버 톡톡 고객" : "고객";
}

function emptyForm(months: number): FormState {
  return { mode: "new", id: "", phone: "", memberId: "", chatId: "", talkNote: "", name: "", reasons: [], detail: "", refs: "", months };
}

export function BlackConsumerManager({ prefill }: { prefill: BlackPrefill }) {
  const [tab, setTab] = useState<Tab>(prefill.focusId ? "all" : "current");
  const [search, setSearch] = useState(prefill.query);
  const [query, setQuery] = useState(prefill.query);
  const [entries, setEntries] = useState<BlackConsumerView[]>([]);
  const [counts, setCounts] = useState<Counts>({ current: 0, ending: 0, ended: 0 });
  const [settings, setSettings] = useState<BlackSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [by, setBy] = useState("");
  const [openHistory, setOpenHistory] = useState<string[]>([]);
  const [criteriaEdit, setCriteriaEdit] = useState<{ criteria: string; months: number } | null>(null);
  const [focusId, setFocusId] = useState(prefill.focusId);
  const prefillRef = useRef(prefill.open);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: tab });
      if (query) params.set("q", query);
      const response = await fetch(`/api/admin/black-consumers?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "블랙컨슈머 목록을 불러오지 못했어요.");
        return;
      }
      setEntries(body.entries ?? []);
      setCounts(body.counts ?? { current: 0, ending: 0, ended: 0 });
      setSettings(body.settings ?? null);
    } catch {
      setError("블랙컨슈머 목록을 불러오지 못했어요.");
    } finally {
      setLoaded(true);
    }
  }, [tab, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // 검색어는 입력이 0.3초 멈추면 반영한다.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // 처리하는 사람 — 첫 화면을 그린 뒤 이 브라우저에 기억해 둔 이름을 채운다.
  useEffect(() => {
    const timer = window.setTimeout(() => setBy(readBy()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 상담·녹취·고객 조회에서 [블랙컨슈머 등록]으로 왔으면 그 값을 채워 등록 칸을 연다(기본 기간을 받은 뒤 한 번).
  useEffect(() => {
    if (!prefillRef.current || !settings) return;
    const timer = window.setTimeout(() => {
      if (!prefillRef.current) return;
      prefillRef.current = false;
      const phone = phoneDigits(prefill.phone);
      setForm({
        ...emptyForm(settings.defaultMonths),
        phone: phone ? formatPhone(phone) : "",
        memberId: prefill.memberId,
        chatId: prefill.chatId,
        talkNote: prefill.talk ? `네이버 톡톡 고객으로 함께 등록돼요${prefill.ticket ? ` (상담 ${prefill.ticket})` : ""}.` : "",
        name: prefill.name,
        refs: prefill.refs || prefill.ticket,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [settings, prefill]);

  // 다른 화면에서 고른 등록(또는 방금 저장한 등록)으로 스크롤
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`bc-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusId, entries]);

  function startNew() {
    setNotice("");
    setError("");
    setForm(emptyForm(settings?.defaultMonths ?? 12));
  }

  function startEdit(entry: BlackConsumerView) {
    setNotice("");
    setError("");
    setForm({
      mode: "edit",
      id: entry.id,
      phone: entry.phone ? formatPhone(entry.phone) : "",
      memberId: entry.memberId,
      chatId: "",
      talkNote: entry.talk ? `네이버 톡톡 고객으로 등록돼 있어요${entry.talkTicket ? ` (상담 ${entry.talkTicket})` : ""}.` : "",
      name: entry.name,
      reasons: entry.reasons,
      detail: entry.detail,
      refs: entry.refs,
      months: settings?.defaultMonths ?? 12,
    });
  }

  function needBy() {
    if (by.trim()) {
      saveBy(by.trim());
      return false;
    }
    setError("처리하는 사람 이름을 먼저 적어 주세요.");
    document.getElementById("bc-by")?.focus();
    return true;
  }

  async function submitForm(event: React.FormEvent) {
    event.preventDefault();
    if (!form || busy || needBy()) return;
    if (!form.reasons.length) {
      setError("사유를 하나 이상 골라 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const fields = { phone: form.phone, memberId: form.memberId, name: form.name, reasons: form.reasons, detail: form.detail, refs: form.refs };
    try {
      const response =
        form.mode === "new"
          ? await fetch("/api/admin/black-consumers", {
              method: "POST",
              headers: JSON_HEADERS,
              body: JSON.stringify({ ...fields, chatId: form.chatId, months: form.months, registeredBy: by.trim() }),
            })
          : await fetch(`/api/admin/black-consumers/${form.id}`, {
              method: "PATCH",
              headers: JSON_HEADERS,
              body: JSON.stringify({ action: "edit", ...fields, by: by.trim() }),
            });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "저장하지 못했어요.");
        if (response.status === 409 && body.id) {
          setFocusId(body.id);
          setTab("all");
        }
        return;
      }
      setForm(null);
      setNotice(form.mode === "new" ? "등록했어요. 이 고객의 상담·녹취에 주의 표시가 떠요." : "고쳤어요.");
      setFocusId(body.entry?.id ?? "");
      if (form.mode === "new" && tab !== "current" && tab !== "all") setTab("current");
      else await load();
    } catch {
      setError("저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function runDialog() {
    if (!dialog || busy || needBy()) return;
    if (dialog.kind === "release" && !dialog.note.trim()) {
      setError("해제 사유를 적어 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { entry, kind } = dialog;
      const response =
        kind === "delete"
          ? await fetch(`/api/admin/black-consumers/${entry.id}`, { method: "DELETE" })
          : await fetch(`/api/admin/black-consumers/${entry.id}`, {
              method: "PATCH",
              headers: JSON_HEADERS,
              body: JSON.stringify(
                kind === "release"
                  ? { action: "release", by: by.trim(), note: dialog.note.trim() }
                  : { action: kind, by: by.trim(), months: dialog.months },
              ),
            });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "처리하지 못했어요.");
        return;
      }
      setDialog(null);
      setNotice(
        kind === "delete"
          ? "지웠어요."
          : kind === "release"
            ? "해제했어요. 주의 표시가 꺼져요."
            : `${body.entry?.until ?? ""}까지 주의 표시가 떠요.`,
      );
      setFocusId(kind === "delete" ? "" : entry.id);
      await load();
    } catch {
      setError("처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCriteria() {
    if (!criteriaEdit || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/black-consumers/settings", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ criteria: criteriaEdit.criteria, defaultMonths: criteriaEdit.months }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "운영 기준을 저장하지 못했어요.");
        return;
      }
      setSettings(body.settings);
      setCriteriaEdit(null);
      setNotice("운영 기준을 저장했어요.");
    } catch {
      setError("운영 기준을 저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  function toggleReason(key: string) {
    setForm((prev) =>
      prev ? { ...prev, reasons: prev.reasons.includes(key) ? prev.reasons.filter((item) => item !== key) : [...prev.reasons, key] } : prev,
    );
  }

  function toggleHistory(id: string) {
    setOpenHistory((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  const tabCount = (id: Tab) => (id === "current" ? counts.current : id === "ending" ? counts.ending : id === "ended" ? counts.ended : null);

  return (
    <section className="bc-panel">
      <div className="bc-toolbar">
        <div className="bc-tabs" role="tablist" aria-label="상태">
          {TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
              {item.label}
              {tabCount(item.id) !== null && <span>{tabCount(item.id)}</span>}
            </button>
          ))}
        </div>
        <label className="bc-search">
          <Search size={14} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="번호·이름·회원 ID·내용으로 찾기" />
          {search && (
            <button type="button" aria-label="검색어 지우기" onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          )}
        </label>
        <label className="bc-by">
          <span>처리하는 사람</span>
          <input id="bc-by" value={by} maxLength={20} onChange={(event) => setBy(event.target.value)} placeholder="이름" />
        </label>
        <div className="bc-toolbar-actions">
          <a className="ln-ghost" href="/api/admin/black-consumers/export" download title="주의 중인 고객 중 전화번호가 있는 고객만 담겨요">
            <Download size={14} /> 통화매니저 주소록 파일
          </a>
          <button type="button" className="bc-primary" onClick={startNew}>
            <Plus size={15} /> 블랙컨슈머 등록
          </button>
        </div>
      </div>

      <details className="bc-criteria" open={Boolean(settings && !settings.criteria) || Boolean(criteriaEdit)}>
        <summary>
          등록·해제 기준
          <span>새로 등록할 때 기본 기간 {settings?.defaultMonths ?? 12}개월</span>
        </summary>
        {criteriaEdit ? (
          <div className="bc-criteria-edit">
            <textarea
              value={criteriaEdit.criteria}
              maxLength={2000}
              rows={6}
              placeholder={CRITERIA_EXAMPLE}
              onChange={(event) => setCriteriaEdit({ ...criteriaEdit, criteria: event.target.value })}
            />
            <div className="bc-row">
              <label className="bc-inline">
                기본 주의 표시 기간
                <select value={criteriaEdit.months} onChange={(event) => setCriteriaEdit({ ...criteriaEdit, months: Number(event.target.value) })}>
                  {RETENTION_MONTHS.map((months) => (
                    <option key={months} value={months}>
                      {months}개월
                    </option>
                  ))}
                </select>
              </label>
              <span className="bc-spacer" />
              <button type="button" className="ln-ghost" onClick={() => setCriteriaEdit(null)}>
                취소
              </button>
              <button type="button" className="bc-primary" disabled={busy} onClick={() => void saveCriteria()}>
                저장
              </button>
            </div>
          </div>
        ) : (
          <div className="bc-criteria-view">
            {settings?.criteria ? (
              <p>{settings.criteria}</p>
            ) : (
              <p className="bc-muted">
                아직 정한 기준이 없어요. CS팀이 정한 등록·해제 기준과 응대 방법을 적어 두면, 등록할 때 같은 기준으로 판단할 수 있어요.
              </p>
            )}
            <button
              type="button"
              className="ln-ghost"
              disabled={!settings}
              onClick={() => settings && setCriteriaEdit({ criteria: settings.criteria, months: settings.defaultMonths })}
            >
              <Pencil size={13} /> 기준 {settings?.criteria ? "고치기" : "적기"}
            </button>
          </div>
        )}
      </details>

      {error && <p className="sc-error">{error}</p>}
      {notice && <p className="sc-notice">{notice}</p>}

      {form && (
        <form className="bc-form" onSubmit={(event) => void submitForm(event)} aria-label={form.mode === "new" ? "블랙컨슈머 등록" : "블랙컨슈머 수정"}>
          <strong className="bc-form-title">
            <ShieldAlert size={16} /> {form.mode === "new" ? "블랙컨슈머 등록" : "블랙컨슈머 수정"}
          </strong>
          {form.talkNote && <p className="bc-form-note">{form.talkNote}</p>}
          <div className="bc-grid">
            <label>
              <span>전화번호</span>
              <input
                type="tel"
                value={form.phone}
                maxLength={20}
                placeholder="010-1234-5678"
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </label>
            <label>
              <span>자사몰 회원 ID</span>
              <input value={form.memberId} maxLength={60} placeholder="있으면" onChange={(event) => setForm({ ...form, memberId: event.target.value })} />
            </label>
            <label>
              <span>이름</span>
              <input value={form.name} maxLength={40} placeholder="선택" onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
          </div>
          <p className="bc-hint">전화번호·회원 ID 중 하나는 있어야 해요. 같은 번호·회원·톡톡 고객의 상담과 녹취에 주의 표시가 떠요.</p>
          <div className="bc-field">
            <span>사유</span>
            <div className="bc-reasons" role="group" aria-label="사유">
              {BLACK_REASONS.map((reason) => (
                <button
                  key={reason.key}
                  type="button"
                  aria-pressed={form.reasons.includes(reason.key)}
                  onClick={() => toggleReason(reason.key)}
                >
                  {reason.label}
                </button>
              ))}
            </div>
          </div>
          <label className="bc-field">
            <span>무슨 일이 있었나요</span>
            <textarea
              value={form.detail}
              required
              maxLength={1000}
              rows={4}
              placeholder="예: 10/28 통화 중 욕설 3회, 경고 뒤에도 계속해 통화 종료. 같은 교환 요청을 하루 5번 반복."
              onChange={(event) => setForm({ ...form, detail: event.target.value })}
            />
          </label>
          <div className="bc-grid">
            <label className="bc-wide">
              <span>관련 기록</span>
              <input
                value={form.refs}
                maxLength={200}
                placeholder="상담번호·주문번호·통화 일시 (예: LC-261028-003, 20261025-0000101)"
                onChange={(event) => setForm({ ...form, refs: event.target.value })}
              />
            </label>
            {form.mode === "new" && (
              <label>
                <span>주의 표시 기간</span>
                <select value={form.months} onChange={(event) => setForm({ ...form, months: Number(event.target.value) })}>
                  {RETENTION_MONTHS.map((months) => (
                    <option key={months} value={months}>
                      {months}개월
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="bc-row">
            <span className="bc-muted">처리하는 사람: {by.trim() || "위에 이름을 적어 주세요"}</span>
            <span className="bc-spacer" />
            <button type="button" className="ln-ghost" onClick={() => setForm(null)}>
              취소
            </button>
            <button type="submit" className="bc-primary" disabled={busy}>
              {busy && <Loader2 size={14} className="spin-icon" />}
              {form.mode === "new" ? "등록" : "저장"}
            </button>
          </div>
        </form>
      )}

      {dialog && (
        <div className="bc-dialog" role="dialog" aria-label="블랙컨슈머 처리">
          <strong>
            {identity(dialog.entry)}
            {dialog.entry.name && ` · ${dialog.entry.name}`} —{" "}
            {dialog.kind === "extend"
              ? "기간 연장"
              : dialog.kind === "reopen"
                ? "다시 주의"
                : dialog.kind === "release"
                  ? "해제"
                  : "영구 삭제"}
          </strong>
          {(dialog.kind === "extend" || dialog.kind === "reopen") && (
            <label className="bc-inline">
              {dialog.kind === "extend" ? `지금 끝나는 날(${dialog.entry.until})이나 오늘부터` : "오늘부터"}
              <select value={dialog.months} onChange={(event) => setDialog({ ...dialog, months: Number(event.target.value) })}>
                {RETENTION_MONTHS.map((months) => (
                  <option key={months} value={months}>
                    {months}개월
                  </option>
                ))}
              </select>
              더 주의 표시
            </label>
          )}
          {dialog.kind === "release" && (
            <label className="bc-field">
              <span>해제 사유</span>
              <input
                value={dialog.note}
                maxLength={200}
                placeholder="예: 잘못 등록함 / 사과 확인 / 기준 재검토"
                onChange={(event) => setDialog({ ...dialog, note: event.target.value })}
              />
            </label>
          )}
          {dialog.kind === "delete" && (
            <p className="bc-hint">잘못 등록했을 때만 지워 주세요. 기록을 남겨야 하면 [해제]를 쓰세요. 지우면 되돌릴 수 없어요.</p>
          )}
          <div className="bc-row">
            <span className="bc-muted">처리하는 사람: {by.trim() || "위에 이름을 적어 주세요"}</span>
            <span className="bc-spacer" />
            <button type="button" className="ln-ghost" onClick={() => setDialog(null)}>
              취소
            </button>
            <button type="button" className={dialog.kind === "delete" ? "bc-danger" : "bc-primary"} disabled={busy} onClick={() => void runDialog()}>
              {dialog.kind === "delete" ? "영구 삭제" : dialog.kind === "release" ? "해제" : "확인"}
            </button>
          </div>
        </div>
      )}

      {!loaded ? (
        <p className="bc-muted">불러오는 중…</p>
      ) : entries.length === 0 ? (
        <p className="sc-empty bc-empty">
          {query ? "찾는 고객이 없어요." : tab === "current" ? "주의 중인 고객이 없어요." : "해당하는 고객이 없어요."}
        </p>
      ) : (
        <ul className="bc-list">
          {entries.map((entry) => {
            const ended = entry.status === "expired" || entry.status === "released";
            const historyOpen = openHistory.includes(entry.id);
            return (
              <li key={entry.id} id={`bc-${entry.id}`} className={`bc-item is-${entry.status}${focusId === entry.id ? " is-focus" : ""}`}>
                <div className="bc-item-head">
                  <span className={`bc-status is-${entry.status}`}>{BLACK_STATUS_LABEL[entry.status]}</span>
                  <strong>{identity(entry)}</strong>
                  {entry.name && <span className="bc-name">{entry.name}</span>}
                  <span className="bc-until">{entry.status === "released" ? `해제 ${kstText(entry.releasedAt)}` : `${entry.until}까지`}</span>
                </div>
                <div className="bc-tags">
                  {entry.reasons.map((reason) => (
                    <span key={reason}>{reasonLabel(reason)}</span>
                  ))}
                  {entry.phone && entry.memberId && <span className="is-id">회원 {entry.memberId}</span>}
                  {entry.talk && (entry.phone || entry.memberId) && <span className="is-id">네이버 톡톡</span>}
                </div>
                <p className="bc-detail">{entry.detail}</p>
                <p className="bc-meta">
                  {entry.refs && <span>관련 {entry.refs}</span>}
                  {entry.talkTicket && <span>톡톡 상담 {entry.talkTicket}</span>}
                  <span>
                    등록 {kstText(entry.createdAt)} · {entry.registeredBy || "기록 없음"}
                  </span>
                  {entry.status === "released" && (
                    <span>
                      해제 {entry.releasedBy}
                      {entry.releaseNote && ` — ${entry.releaseNote}`}
                    </span>
                  )}
                </p>
                <div className="bc-actions">
                  {entry.phone && (
                    <Link href={`/admin/customers?phone=${entry.phone}`}>
                      <UserSearch size={13} /> 고객 조회
                    </Link>
                  )}
                  <button type="button" onClick={() => startEdit(entry)}>
                    <Pencil size={13} /> 수정
                  </button>
                  {ended ? (
                    <button type="button" onClick={() => setDialog({ kind: "reopen", entry, months: settings?.defaultMonths ?? 12, note: "" })}>
                      <RotateCcw size={13} /> 다시 주의
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => setDialog({ kind: "extend", entry, months: settings?.defaultMonths ?? 12, note: "" })}>
                        <RotateCcw size={13} /> 기간 연장
                      </button>
                      <button type="button" onClick={() => setDialog({ kind: "release", entry, months: 0, note: "" })}>
                        <ShieldOff size={13} /> 해제
                      </button>
                    </>
                  )}
                  <button type="button" className="is-danger" onClick={() => setDialog({ kind: "delete", entry, months: 0, note: "" })}>
                    <Trash2 size={13} /> 삭제
                  </button>
                  <button type="button" aria-expanded={historyOpen} onClick={() => toggleHistory(entry.id)}>
                    <History size={13} /> 이력 {entry.history.length}
                  </button>
                </div>
                {historyOpen && (
                  <ol className="bc-history">
                    {entry.history.map((item, index) => (
                      <li key={index}>
                        <time>{kstText(item.at, true)}</time>
                        <strong>{HISTORY_LABEL[item.action] ?? item.action}</strong>
                        <span>{item.by}</span>
                        {item.note && <em>{item.note}</em>}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
