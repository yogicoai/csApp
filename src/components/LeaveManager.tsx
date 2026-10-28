"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Info, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LeaveNoticePanel } from "@/components/LeaveNoticePanel";
import { CLOSURE_CHANGED_EVENT } from "@/components/LiveChat";
import {
  dayLabel,
  isWeekend,
  kstToday,
  LEAVE_TYPES,
  leaveLabel,
  type LeaveType,
  LIVE_CHAT_HOURS_LABEL,
  nextBusinessDay,
  shiftDay,
  weekdayOf,
} from "@/lib/liveChatHours";

// CS 연차 관리 — 상담사가 1명이라, 휴가 시간에는 고객 화면의 실시간 채팅상담이 닫힌다.
//   연차: 종일 닫힘 / 오전반차: 14:00부터 상담 / 오후반차: 13:00까지 상담
// 월 달력에서 날짜를 눌러 지정·해제하고, 며칠짜리 연차는 기간으로 한 번에 지정한다.

type Closure = { date: string; type: LeaveType };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const CELL_TAG: Record<LeaveType, string> = { full: "연차 · 상담 닫힘", am: "오전반차", pm: "오후반차" };

function monthGrid(month: string) {
  const first = `${month}-01`;
  const [year, monthNo] = month.split("-").map(Number);
  const lastDate = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
  const last = `${month}-${String(lastDate).padStart(2, "0")}`;
  const start = shiftDay(first, -weekdayOf(first));
  const end = shiftDay(last, 6 - weekdayOf(last));
  const days: string[] = [];
  for (let day = start; day <= end; day = shiftDay(day, 1)) days.push(day);
  return { start, end, days };
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNo] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNo - 1 + delta, 1)).toISOString().slice(0, 7);
}

function monthTitle(month: string) {
  const [year, monthNo] = month.split("-").map(Number);
  return `${year}년 ${monthNo}월`;
}

function LeaveTypePicker({ value, onChange }: { value: LeaveType; onChange: (next: LeaveType) => void }) {
  return (
    <div className="sc-types" role="radiogroup" aria-label="휴가 종류">
      {LEAVE_TYPES.map((leave) => (
        <button
          type="button"
          key={leave.key}
          role="radio"
          aria-checked={value === leave.key}
          className={value === leave.key ? `sc-type is-${leave.key} is-selected` : `sc-type is-${leave.key}`}
          onClick={() => onChange(leave.key)}
        >
          <strong>{leave.label}</strong>
          <span>{leave.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function LeaveManager() {
  const [today] = useState(() => kstToday());
  const [month, setMonth] = useState(() => kstToday().slice(0, 7));
  const [leaves, setLeaves] = useState<Record<string, LeaveType>>({});
  const [chatCounts, setChatCounts] = useState<Record<string, number>>({});
  const [upcoming, setUpcoming] = useState<Closure[]>([]);
  const [selected, setSelected] = useState(() => kstToday());
  const [leaveType, setLeaveType] = useState<LeaveType>("full");
  const [rangeFrom, setRangeFrom] = useState(() => kstToday());
  const [rangeTo, setRangeTo] = useState(() => kstToday());
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editorRef = useRef<HTMLElement>(null);

  const grid = useMemo(() => monthGrid(month), [month]);

  const loadMonth = useCallback(async (start: string, end: string) => {
    const response = await fetch(`/api/admin/live-chat-closures?from=${start}&to=${end}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { closures: Closure[]; chatCounts?: Record<string, number> };
    setLeaves(Object.fromEntries(body.closures.map((closure) => [closure.date, closure.type ?? "full"])));
    setChatCounts(body.chatCounts ?? {});
  }, []);

  const loadUpcoming = useCallback(async () => {
    const response = await fetch("/api/admin/live-chat-closures", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { closures: Closure[] };
    setUpcoming(body.closures ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMonth(grid.start, grid.end), 0);
    return () => window.clearTimeout(timer);
  }, [grid.start, grid.end, loadMonth]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUpcoming(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUpcoming]);

  const selectedLeave = leaves[selected] ?? null;
  const selectedPast = selected < today;
  const todayLeave = leaves[today] ?? upcoming.find((closure) => closure.date === today)?.type ?? null;
  const monthLeaveCount = grid.days.filter((day) => day.slice(0, 7) === month && leaves[day]).length;

  function pickDay(day: string) {
    setSelected(day);
    setError("");
    setNotice("");
    setLeaveType(leaves[day] ?? "full");
    if (day.slice(0, 7) !== month) setMonth(day.slice(0, 7));
    // 좁은 화면에서는 편집 영역이 달력 아래에 있어, 날짜를 누르면 그쪽으로 내려간다.
    if (window.matchMedia("(max-width: 1080px)").matches) {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function refresh(message: string) {
    await Promise.all([loadMonth(grid.start, grid.end), loadUpcoming()]);
    window.dispatchEvent(new Event(CLOSURE_CHANGED_EVENT));
    setNotice(message);
  }

  async function addLeave(payload: Record<string, unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/live-chat-closures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; count?: number };
      if (!response.ok) {
        setError(body.error ?? "휴가를 저장하지 못했어요.");
        return;
      }
      await refresh(message.replace("{n}", String(body.count ?? 1)));
    } finally {
      setBusy(false);
    }
  }

  async function removeLeave(day: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fetch(`/api/admin/live-chat-closures?date=${day}`, { method: "DELETE" });
      await refresh(`${dayLabel(day)} 휴가를 해제했어요. 실시간 상담이 평소대로 열려요.`);
    } finally {
      setBusy(false);
    }
  }

  // 그날 고객 화면에 나가는 안내 미리보기(다음 영업일 = 주말·연차일 제외)
  function previewFor(type: LeaveType) {
    if (type === "am") return "오늘 오전은 고객센터 휴무라 실시간 채팅상담이 닫혀 있어요. 오늘 오후 2시부터 다시 상담할 수 있어요.";
    const reopen = nextBusinessDay(selected, (day) => leaves[day] === "full");
    const reopenLabel = leaves[reopen] === "am" ? `${dayLabel(reopen)} 오후 2시` : dayLabel(reopen);
    if (type === "pm") {
      return `(13:00까지는 평소처럼 상담) 오늘 오후는 고객센터 휴무라 실시간 채팅상담이 닫혀 있어요. ${reopenLabel}부터 다시 상담할 수 있어요.`;
    }
    return `오늘은 고객센터 휴무일이라 실시간 채팅상담이 닫혀 있어요. ${reopenLabel}부터 다시 상담할 수 있어요.`;
  }

  const todayText = todayLeave
    ? todayLeave === "am"
      ? "오전반차 — 14:00부터 실시간 상담이 열려요"
      : todayLeave === "pm"
        ? "오후반차 — 13:00까지 상담하고 그 뒤로 닫혀요"
        : "연차 — 실시간 채팅상담이 종일 닫혀 있어요"
    : isWeekend(today)
      ? "주말 — 운영시간 외 안내가 나가요"
      : `정상 운영 · ${LIVE_CHAT_HOURS_LABEL}`;

  return (
    <div className="sc-wrap">
      <section className="sc-explain">
        <Info size={16} />
        <p>
          CS 상담사가 1명이라, <strong>휴가로 지정한 시간에는 고객 화면의 실시간 대화가 닫혀요.</strong> 연차는 종일,
          오전반차는 14:00부터 상담, 오후반차는 13:00까지 상담이에요. 닫혀 있는 동안 고객에게는 다시 열리는 때를 안내하고,
          운영시간 외처럼 휴대폰 번호를 남기는 ‘문의 접수’로 받아요(답변은 문자로 안내). 이미 진행 중인 상담과 FAQ·AI
          질문은 그대로 이용할 수 있어요.
        </p>
      </section>

      <section className={todayLeave ? "sc-today is-closed" : "sc-today"}>
        <div>
          <strong>오늘 {dayLabel(today)}</strong>
          <span>{todayText}</span>
        </div>
        {todayLeave ? (
          <button type="button" className="sc-today-btn is-off" disabled={busy} onClick={() => void removeLeave(today)}>
            오늘 {leaveLabel(todayLeave)} 해제
          </button>
        ) : (
          <div className="sc-today-actions">
            {LEAVE_TYPES.map((leave) => (
              <button
                type="button"
                key={leave.key}
                className="sc-today-btn"
                disabled={busy}
                onClick={() =>
                  void addLeave({ date: today, type: leave.key }, `오늘을 ${leave.label}(으)로 지정했어요. ${leave.hint}.`)
                }
              >
                오늘 {leave.label}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="sc-main">
        <section className="sc-calendar" aria-label="연차 달력">
          <header className="sc-cal-head">
            <button type="button" aria-label="이전 달" onClick={() => setMonth((prev) => shiftMonth(prev, -1))}>
              <ChevronLeft size={16} />
            </button>
            <h2>{monthTitle(month)}</h2>
            <button type="button" aria-label="다음 달" onClick={() => setMonth((prev) => shiftMonth(prev, 1))}>
              <ChevronRight size={16} />
            </button>
            <button type="button" className="sc-cal-today" onClick={() => pickDay(today)}>
              오늘
            </button>
            <span className="sc-cal-summary">이번 달 휴가 {monthLeaveCount}일</span>
          </header>

          <div className="sc-grid">
            {WEEKDAYS.map((label, index) => (
              <span key={label} className={index === 0 ? "sc-wd is-sun" : index === 6 ? "sc-wd is-sat" : "sc-wd"}>
                {label}
              </span>
            ))}
            {grid.days.map((day) => {
              const leave = leaves[day];
              const count = chatCounts[day] ?? 0;
              const classes = [
                "sc-day",
                day.slice(0, 7) !== month && "is-out",
                isWeekend(day) && "is-weekend",
                weekdayOf(day) === 0 && "is-sun",
                leave === "full" && "is-closed",
                (leave === "am" || leave === "pm") && "is-half",
                day === today && "is-today",
                day < today && "is-past",
                day === selected && "is-selected",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  type="button"
                  key={day}
                  className={classes}
                  onClick={() => pickDay(day)}
                  aria-label={`${dayLabel(day)}${leave ? ` ${leaveLabel(leave)}` : ""}`}
                  aria-pressed={day === selected}
                >
                  <span className="sc-date">{Number(day.slice(8))}</span>
                  {leave && <span className={`sc-tag is-${leave}`}>{CELL_TAG[leave]}</span>}
                  {count > 0 && <span className="sc-count">상담 {count}</span>}
                </button>
              );
            })}
          </div>

          <div className="sc-legend">
            <span><i className="is-closed" /> 연차(종일 닫힘)</span>
            <span><i className="is-half" /> 반차(오전·오후)</span>
            <span><i className="is-weekend" /> 주말(운영시간 외)</span>
            <span><i className="is-today" /> 오늘</span>
            <span className="sc-legend-note">날짜를 누르면 연차·반차를 지정·해제할 수 있어요.</span>
          </div>
        </section>

        <aside className="sc-side">
          <section className="sc-editor" ref={editorRef}>
            <div className="sc-editor-head">
              <CalendarDays size={16} />
              <strong>{dayLabel(selected)}</strong>
              {selected === today && <span className="sc-pill">오늘</span>}
              {isWeekend(selected) && <span className="sc-pill is-muted">주말</span>}
              {selectedLeave && <span className="sc-pill is-closed">{leaveLabel(selectedLeave)}</span>}
            </div>
            {(chatCounts[selected] ?? 0) > 0 && (
              <p className="sc-editor-sub">이날 접수된 상담 {chatCounts[selected]}건</p>
            )}

            {selectedPast ? (
              <>
                <p className="sc-editor-sub">
                  지난 날짜예요. {selectedLeave ? `${leaveLabel(selectedLeave)}였어요.` : "휴가가 아니었어요."}
                </p>
                {selectedLeave && (
                  <button type="button" className="sc-ghost" disabled={busy} onClick={() => void removeLeave(selected)}>
                    <Trash2 size={13} /> 기록 삭제
                  </button>
                )}
              </>
            ) : (
              <>
                {isWeekend(selected) && !selectedLeave && (
                  <p className="sc-editor-sub">주말은 원래 운영시간 외 안내가 나가요. 필요하면 휴가로 지정해 상담을 닫을 수 있어요.</p>
                )}
                <LeaveTypePicker value={leaveType} onChange={setLeaveType} />
                <div className="sc-preview">
                  <span>{selectedLeave === leaveType ? "고객 화면 안내" : "지정하면 고객 화면 안내"}</span>
                  <p>{previewFor(leaveType)}</p>
                </div>
                <div className="sc-editor-actions">
                  {(!selectedLeave || selectedLeave !== leaveType) && (
                    <button
                      type="button"
                      className="sc-primary"
                      disabled={busy}
                      onClick={() =>
                        void addLeave(
                          { date: selected, type: leaveType },
                          selectedLeave
                            ? `${dayLabel(selected)}을 ${leaveLabel(leaveType)}(으)로 바꿨어요.`
                            : `${dayLabel(selected)}을 ${leaveLabel(leaveType)}(으)로 지정했어요.`,
                        )
                      }
                    >
                      {busy ? <Loader2 size={14} className="spin-icon" /> : null}
                      {selectedLeave ? `${leaveLabel(leaveType)}(으)로 변경` : `${leaveLabel(leaveType)}(으)로 지정`}
                    </button>
                  )}
                  {selectedLeave && (
                    <button type="button" className="sc-danger" disabled={busy} onClick={() => void removeLeave(selected)}>
                      {leaveLabel(selectedLeave)} 해제
                    </button>
                  )}
                </div>
              </>
            )}
            {notice && <p className="sc-notice">{notice}</p>}
            {error && <p className="sc-error">{error}</p>}
          </section>

          <section className="sc-range">
            <strong>여러 날 연차</strong>
            <p className="sc-editor-sub">휴가처럼 며칠을 한 번에 연차(종일)로 지정해요.</p>
            <div className="sc-range-dates">
              <input
                type="date"
                aria-label="시작일"
                value={rangeFrom}
                min={today}
                onChange={(event) => {
                  setRangeFrom(event.target.value);
                  if (event.target.value > rangeTo) setRangeTo(event.target.value);
                }}
              />
              <span>~</span>
              <input
                type="date"
                aria-label="종료일"
                value={rangeTo}
                min={rangeFrom || today}
                onChange={(event) => setRangeTo(event.target.value)}
              />
            </div>
            <label className="sc-check">
              <input type="checkbox" checked={skipWeekends} onChange={(event) => setSkipWeekends(event.target.checked)} />
              주말은 빼고 지정
            </label>
            <button
              type="button"
              className="sc-primary"
              disabled={busy || !rangeFrom || !rangeTo}
              onClick={() =>
                void addLeave(
                  { from: rangeFrom, to: rangeTo, skipWeekends, type: "full" },
                  `${dayLabel(rangeFrom)}부터 {n}일을 연차로 지정했어요.`,
                )
              }
            >
              기간 연차 지정
            </button>
          </section>

          <section className="sc-upcoming">
            <strong>예정된 휴가</strong>
            <ul>
              {upcoming.length === 0 && <li className="sc-empty">예정된 휴가가 없어요.</li>}
              {upcoming.map((closure) => (
                <li key={closure.date}>
                  <button type="button" className="sc-upcoming-day" onClick={() => pickDay(closure.date)}>
                    {dayLabel(closure.date)}
                  </button>
                  <span className={`sc-tag is-${closure.type}`}>{leaveLabel(closure.type)}</span>
                  <span className="sc-upcoming-note">
                    {closure.type === "am" ? "14:00부터 상담" : closure.type === "pm" ? "13:00까지 상담" : "종일 닫힘"}
                  </span>
                  <button
                    type="button"
                    className="sc-x"
                    aria-label={`${dayLabel(closure.date)} 휴가 해제`}
                    disabled={busy}
                    onClick={() => void removeLeave(closure.date)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <LeaveNoticePanel />
    </div>
  );
}
