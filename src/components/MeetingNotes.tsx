"use client";

import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
  MEETING_STATUSES,
  MEETING_TARGETS,
  type MeetingItemView,
  type MeetingStatus,
  meetingStatusLabel,
} from "@/lib/meetingNotes";

// 회의 기록 — 확인할 것(누구에게 · 왜)을 남기고, 받은 답과 상태(확인 대기 → 답변 받음 → 결정·완료)를 바로 적는다.
// [목록 복사]로 메신저·회의록에 붙여 넣는다.

type Filter = "all" | MeetingStatus;
const JSON_HEADERS = { "Content-Type": "application/json" };

function kstDay(iso: string) {
  return iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : "";
}

function MeetingCard({
  item,
  onSaved,
  onDeleted,
}: {
  item: MeetingItemView;
  onSaved: (item: MeetingItemView) => void;
  onDeleted: (id: string) => void;
}) {
  const [answer, setAnswer] = useState(item.answer);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(item.question);
  const [why, setWhy] = useState(item.why);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(body: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/meeting-items/${item.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "저장하지 못했어요.");
        return false;
      }
      onSaved(result.item);
      return true;
    } catch {
      setError("저장하지 못했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("이 확인 항목을 지울까요?")) return;
    const response = await fetch(`/api/admin/meeting-items/${item.id}`, { method: "DELETE" });
    if (response.ok) onDeleted(item.id);
    else setError("지우지 못했어요.");
  }

  // 답을 적어 저장하면 '확인 대기'는 '답변 받음'으로 넘긴다.
  async function saveAnswer() {
    await save({ answer, ...(answer.trim() && item.status === "open" ? { status: "answered" } : {}) });
  }

  return (
    <li className={`mt-item is-${item.status}`}>
      <div className="mt-item-head">
        <span className="mt-target">{item.target}</span>
        <select
          value={item.status}
          disabled={busy}
          aria-label="상태"
          className={`mt-status is-${item.status}`}
          onChange={(event) => void save({ status: event.target.value })}
        >
          {MEETING_STATUSES.map((status) => (
            <option key={status.key} value={status.key}>
              {status.label}
            </option>
          ))}
        </select>
        <time>{kstDay(item.createdAt)} 추가</time>
        <span className="bc-spacer" />
        <button type="button" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>
          <Pencil size={13} /> 고치기
        </button>
        <button type="button" className="is-danger" onClick={() => void remove()}>
          <Trash2 size={13} /> 삭제
        </button>
      </div>
      {editing ? (
        <div className="mt-edit">
          <textarea value={question} maxLength={500} rows={2} onChange={(event) => setQuestion(event.target.value)} aria-label="확인할 것" />
          <textarea value={why} maxLength={1000} rows={2} onChange={(event) => setWhy(event.target.value)} aria-label="왜 필요한지" placeholder="왜 필요한지(선택)" />
          <div className="bc-row">
            <span className="bc-spacer" />
            <button type="button" className="ln-ghost" onClick={() => setEditing(false)}>
              취소
            </button>
            <button
              type="button"
              className="bc-primary"
              disabled={busy || !question.trim()}
              onClick={async () => {
                if (await save({ question, why })) setEditing(false);
              }}
            >
              저장
            </button>
          </div>
        </div>
      ) : (
        <>
          <strong className="mt-question">{item.question}</strong>
          {item.why && <p className="mt-why">{item.why}</p>}
        </>
      )}
      <div className="mt-answer">
        <textarea
          value={answer}
          maxLength={3000}
          rows={answer ? 3 : 1}
          placeholder="받은 답·결정한 내용을 적어 주세요"
          onChange={(event) => setAnswer(event.target.value)}
          aria-label="받은 답"
        />
        {answer !== item.answer && (
          <button type="button" className="bc-primary" disabled={busy} onClick={() => void saveAnswer()}>
            답 저장
          </button>
        )}
      </div>
      {item.answer && <p className="mt-updated">마지막 수정 {kstDay(item.updatedAt)}</p>}
      {error && <p className="sc-error">{error}</p>}
    </li>
  );
}

export function MeetingNotes() {
  const [items, setItems] = useState<MeetingItemView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [question, setQuestion] = useState("");
  const [why, setWhy] = useState("");
  const [target, setTarget] = useState<string>("CS팀");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/meeting-items", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "회의 기록을 불러오지 못했어요.");
        return;
      }
      setItems(body.items ?? []);
    } catch {
      setError("회의 기록을 불러오지 못했어요.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/meeting-items", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ question, why, target }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "추가하지 못했어요.");
        return;
      }
      setItems((prev) => [...prev, body.item]);
      setQuestion("");
      setWhy("");
      setNotice("추가했어요.");
    } catch {
      setError("추가하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  const shown = filter === "all" ? items : items.filter((item) => item.status === filter);
  const count = (key: Filter) => (key === "all" ? items.length : items.filter((item) => item.status === key).length);

  async function copyList() {
    const text = shown
      .map((item, index) =>
        [
          `${index + 1}. [${item.target}·${meetingStatusLabel(item.status)}] ${item.question}`,
          item.why && `   - 왜: ${item.why}`,
          item.answer && `   - 답: ${item.answer}`,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setNotice("목록을 복사했어요. 메신저·회의록에 붙여 넣으면 돼요.");
    } catch {
      setError("복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.");
    }
  }

  return (
    <section className="mt-panel">
      <form className="mt-add" onSubmit={(event) => void add(event)}>
        <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="누구에게">
          {MEETING_TARGETS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input value={question} maxLength={500} onChange={(event) => setQuestion(event.target.value)} placeholder="확인할 것 (예: 쿠팡 상품문의는 누가 어디서 답하나요?)" aria-label="확인할 것" />
        <input value={why} maxLength={1000} onChange={(event) => setWhy(event.target.value)} placeholder="왜 필요한지(선택)" aria-label="왜 필요한지" />
        <button type="submit" className="bc-primary" disabled={busy || !question.trim()}>
          <Plus size={15} /> 추가
        </button>
      </form>

      <div className="bc-toolbar">
        <div className="bc-tabs" role="tablist" aria-label="상태">
          {(["all", ...MEETING_STATUSES.map((status) => status.key)] as Filter[]).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>
              {key === "all" ? "전체" : meetingStatusLabel(key)}
              <span>{count(key)}</span>
            </button>
          ))}
        </div>
        <span className="bc-spacer" />
        <button type="button" className="ln-ghost" disabled={!shown.length} onClick={() => void copyList()}>
          <Copy size={14} /> 목록 복사
        </button>
      </div>

      {error && <p className="sc-error">{error}</p>}
      {notice && <p className="sc-notice">{notice}</p>}
      {!loaded ? (
        <p className="bc-muted">불러오는 중…</p>
      ) : (
        <ol className="mt-list">
          {shown.map((item) => (
            <MeetingCard
              key={`${item.id}:${item.updatedAt}`}
              item={item}
              onSaved={(saved) => setItems((prev) => prev.map((one) => (one.id === saved.id ? saved : one)))}
              onDeleted={(id) => setItems((prev) => prev.filter((one) => one.id !== id))}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
