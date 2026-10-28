"use client";

import { ChevronDown, Copy, Download, Loader2, Megaphone, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CLOSURE_CHANGED_EVENT } from "@/components/LiveChat";
import {
  DATE_TOKEN,
  LEAD_DAYS_MAX,
  type LeaveNoticeSettings,
  type LeavePeriod,
  NOTES_MAX,
  NOTICE_FONT,
  PRETENDARD_CSS_URL,
} from "@/lib/leaveNotice";
import { dayLabel } from "@/lib/liveChatHours";

// 연차 관리 '홈페이지 휴무 팝업' — 지정한 휴무를 기간으로 묶어 cafe24 팝업으로 자동 노출하고(설치 코드 한 번),
// 같은 내용을 이미지(톡톡·카카오 공지용)·HTML 로도 내려받는다. 문구는 고칠 수 있고 비우면 기본 문구로 돌아간다.
// 미리보기는 홈페이지(PC·휴대폰)에 뜨는 모습과 공지 이미지를 보여 주고, 예정된 휴무가 없으면 예시 날짜로 보여 준다.

type PeriodView = LeavePeriod & { showing: boolean; until: string; html: string };
type NoticeData = {
  settings: LeaveNoticeSettings;
  defaults: LeaveNoticeSettings;
  periods: PeriodView[];
  sample: PeriodView | null;
};

type PreviewMode = "pc" | "mobile" | "image";

// 패널 펼침 여부 — 늘 펼쳐져 있으면 연차 관리 화면이 복잡해서 기본은 접고, 이 브라우저에 마지막 상태를 기억한다.
const OPEN_KEY = "cs_admin_leave_notice_open";

function readOpen() {
  try {
    return window.localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

const PREVIEW_MODES: Array<{ id: PreviewMode; label: string; caption: string }> = [
  {
    id: "pc",
    label: "홈페이지 · PC",
    caption:
      "고객이 홈페이지에 들어오면 화면 가운데에 이렇게 떠요. ‘닫기’나 바깥 어두운 곳을 누르면 닫히고, ‘오늘 하루 보지 않기’를 누르면 그 브라우저에서는 그날 다시 뜨지 않아요.",
  },
  { id: "mobile", label: "홈페이지 · 휴대폰", caption: "휴대폰에서는 화면 폭에 맞춰 뜨고, 내용이 길면 팝업 안에서 스크롤돼요." },
  { id: "image", label: "공지 이미지", caption: "‘이미지 내려받기’로 받는 그림이에요. 톡톡·카카오 공지에 올리면 돼요." },
];

// 홈페이지에 뜨는 모습 — 예시 쇼핑몰 화면 위에서 cafe24 에 심는 스크립트(public/leave-notice.js)를 그대로 돌린다.
// 스크립트는 이 미리보기 틀(srcdoc) 안에서만 넘겨받은 내용을 바로 띄운다.
const PREVIEW_SITE_CSS = [
  "*{box-sizing:border-box}",
  `body{margin:0;background:#fff;font-family:${NOTICE_FONT}}`,
  "header{display:flex;align-items:center;justify-content:space-between;height:64px;padding:0 28px;border-bottom:1px solid #eef0f2}",
  "header b{font-size:22px;color:#2f3a45;letter-spacing:-.5px}",
  "nav{display:flex;gap:16px}nav i{width:56px;height:10px;border-radius:5px;background:#e3e7eb}",
  ".hero{height:300px;margin:22px 28px;border-radius:16px;background:linear-gradient(135deg,#d9f2f5,#f5ebdd)}",
  ".grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;padding:0 28px 28px}",
  ".grid i{aspect-ratio:1;border-radius:12px;background:#f0f2f4}",
  "@media (max-width:600px){header{height:52px;padding:0 16px}nav{gap:8px}nav i{width:20px}",
  ".hero{height:200px;margin:14px 16px}.grid{grid-template-columns:repeat(2,1fr);gap:10px;padding:0 16px 16px}}",
].join("");
const PREVIEW_SITE_HTML = `<header><b>yogibo</b><nav><i></i><i></i><i></i><i></i></nav></header><div class="hero"></div><div class="grid">${"<i></i>".repeat(8)}</div>`;

function popupPreviewDoc(origin: string, period: PeriodView) {
  // 내용은 글자로만 넘긴다(</script> 가 끼어들지 않게 < 를 이스케이프).
  const notice = JSON.stringify({ id: period.id, html: period.html }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${PRETENDARD_CSS_URL}"><style>${PREVIEW_SITE_CSS}</style></head><body>${PREVIEW_SITE_HTML}<script>window.__yogiboLeaveNoticePreview=${notice}</script><script src="${origin}/leave-notice.js"></script></body></html>`;
}

// 미리보기 위 한 줄 — 언제 홈페이지에 뜨는지(예시면 예시라고)
function exposureNote(period: PeriodView, isSample: boolean) {
  if (isSample) {
    return `예시예요 — 예정된 휴무가 없어서 ${period.dateLabel} 하루 연차로 보여 드려요. 달력에서 휴무를 지정하면 그 날짜로 바뀌어요.`;
  }
  if (!period.popup) return "팝업이 꺼져 있어 홈페이지에는 뜨지 않아요. 이미지·HTML 은 그대로 쓸 수 있어요.";
  return `홈페이지 노출: ${dayLabel(period.showFrom)} 0시부터 상담 재개(${period.resumeLabel}) 전까지${period.showing ? " — 지금 노출 중" : ""}`;
}

// 공지 이미지 — 서버가 그때그때 만드는 PNG(글꼴을 받아 그려서 1~2초 걸린다)
function NoticeImage({ src }: { src: string }) {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  return (
    <div className="ln-stage is-image">
      {state === "loading" && (
        <p className="ln-stage-note">
          <Loader2 size={14} className="spin-icon" /> 이미지를 만드는 중이에요…
        </p>
      )}
      {state === "error" && <p className="ln-stage-note">이미지를 만들지 못했어요. 잠시 후 다시 열어 주세요.</p>}
      {/* eslint-disable-next-line @next/next/no-img-element -- 서버가 그때그때 만드는 PNG */}
      <img
        src={src}
        alt="톡톡·카카오 공지 이미지 미리보기"
        hidden={state !== "done"}
        onLoad={() => setState("done")}
        onError={() => setState("error")}
      />
    </div>
  );
}

function periodState(period: PeriodView) {
  if (!period.popup) return { className: "is-off", label: "팝업 꺼짐" };
  if (period.showing) return { className: "is-on", label: "지금 홈페이지에 노출 중" };
  return { className: "is-soon", label: `${dayLabel(period.showFrom)}부터 노출` };
}

// 접혀 있을 때 머리줄 한 줄 — 가장 가까운 휴무와 노출 상태(지금 떠 있는지는 접혀 있어도 보이게)
function ClosedSummary({ periods }: { periods: PeriodView[] }) {
  const [first, ...rest] = periods;
  if (!first) return <span>예정된 휴무가 없어요</span>;
  const state = periodState(first);
  return (
    <>
      <span>{first.dateLabel}</span>
      <em className={`ln-state ${state.className}`}>{state.label}</em>
      {rest.length > 0 && <span>외 {rest.length}건</span>}
    </>
  );
}

function withNoteRows(notes: LeaveNoticeSettings["notes"]) {
  const rows = notes.slice(0, NOTES_MAX).map((note) => ({ ...note }));
  while (rows.length < NOTES_MAX) rows.push({ text: "", highlight: false });
  return rows;
}

export function LeaveNoticePanel() {
  const [data, setData] = useState<NoticeData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<LeaveNoticeSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // 설치 코드에 넣을 이 앱 주소 — 서버 렌더와 어긋나지 않게 화면에서 읽는다.
  const [origin, setOrigin] = useState("");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PreviewMode>("pc");
  // 미리보기에서 닫은 팝업 다시 띄우기 · 문구를 고치면 공지 이미지도 새로 받기
  const [replay, setReplay] = useState(0);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/leave-notice", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as Partial<NoticeData> & { error?: string };
    if (!response.ok || !body.settings) {
      setError(body.error ?? "휴무 팝업 정보를 불러오지 못했어요.");
      return;
    }
    setError("");
    setData(body as NoticeData);
    setVersion((count) => count + 1);
    setSelectedId((prev) => (body.periods?.some((period) => period.id === prev) ? prev : (body.periods?.[0]?.id ?? "")));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOrigin(window.location.origin);
      setOpen(readOpen());
      void load();
    }, 0);
    const refresh = () => void load();
    window.addEventListener(CLOSURE_CHANGED_EVENT, refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(CLOSURE_CHANGED_EVENT, refresh);
    };
  }, [load]);

  const selected = data?.periods.find((period) => period.id === selectedId) ?? null;
  const shown = selected ?? data?.sample ?? null;
  const isSample = !selected && Boolean(shown);

  async function togglePopup(period: PeriodView) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/live-chat-closures", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates: period.days.map((day) => day.date), popup: !period.popup }),
      });
      if (!response.ok) {
        setError("팝업 설정을 바꾸지 못했어요.");
        return;
      }
      await load();
      setMessage(`${period.dateLabel} 휴무 팝업을 ${period.popup ? "껐어요" : "켰어요"}.`);
    } finally {
      setBusy(false);
    }
  }

  async function downloadImage(period: PeriodView) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/admin/leave-notice/image?id=${encodeURIComponent(period.id)}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "이미지를 만들지 못했어요.");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `고객센터-휴무-안내-${period.start}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMessage("이미지를 내려받았어요. 톡톡·카카오 공지에 올리면 돼요.");
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      setError("");
      setMessage(done);
    } catch {
      setError("복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.");
    }
  }

  function toggleOpen(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* 저장이 막힌 브라우저는 이 화면에서만 */
    }
  }

  function startEdit() {
    if (!data) return;
    setForm({ ...data.settings, notes: withNoteRows(data.settings.notes) });
    setEditing(true);
    setMessage("");
    if (!open) toggleOpen(true);
  }

  async function saveSettings(next: LeaveNoticeSettings) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/leave-notice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, notes: next.notes.filter((note) => note.text.trim()) }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "문구를 저장하지 못했어요.");
        return;
      }
      await load();
      setEditing(false);
      setMessage("팝업 문구를 저장했어요. 미리보기와 홈페이지 팝업에 바로 반영돼요.");
    } finally {
      setBusy(false);
    }
  }

  const installCode = origin ? `<script src="${origin}/leave-notice.js" defer></script>` : "";
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);

  return (
    <section className="ln-panel" aria-label="홈페이지 휴무 팝업">
      <header className="ln-head">
        <Megaphone size={17} />
        <div>
          <strong>홈페이지 휴무 팝업</strong>
          {open ? (
            <p>
              지정한 휴무를 기간으로 묶어 cafe24 홈페이지에 팝업으로 띄워요 — 휴무{" "}
              {data ? `${data.settings.leadDays}일` : "며칠"} 전부터 상담이 다시 열릴 때까지만 보여요. 같은 내용을 이미지로
              내려받아 톡톡·카카오 공지에도 쓸 수 있어요.
            </p>
          ) : (
            data && (
              <p className="ln-head-summary">
                <ClosedSummary periods={data.periods} />
              </p>
            )
          )}
        </div>
        <div className="ln-head-actions">
          <button type="button" className="ln-ghost" onClick={startEdit} disabled={!data}>
            문구 수정
          </button>
          <button type="button" className="ln-ghost ln-toggle" aria-expanded={open} onClick={() => toggleOpen(!open)}>
            <ChevronDown size={14} className={open ? "is-open" : undefined} />
            {open ? "접기" : "펼치기"}
          </button>
        </div>
      </header>

      {error && <p className="sc-error">{error}</p>}
      {message && <p className="sc-notice">{message}</p>}

      {open && editing && form && (
        <div className="ln-form">
          <label>
            <span>노출 시작</span>
            <span className="ln-inline">
              휴무
              <input
                type="number"
                min={0}
                max={LEAD_DAYS_MAX}
                value={form.leadDays}
                onChange={(event) => setForm({ ...form, leadDays: Math.max(0, Math.min(LEAD_DAYS_MAX, Number(event.target.value) || 0)) })}
              />
              일 전부터
            </span>
          </label>
          <label>
            <span>제목</span>
            <input value={form.title} maxLength={60} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            <span>본문</span>
            <textarea rows={3} value={form.body} maxLength={600} onChange={(event) => setForm({ ...form, body: event.target.value })} />
            <em>
              {DATE_TOKEN} 자리에 휴무 날짜가 굵게 들어가요.{" "}
              {!form.body.includes(DATE_TOKEN) && <b className="ln-warn">지금 본문에 {DATE_TOKEN} 가 없어요.</b>}
            </em>
          </label>
          <label>
            <span>재개 일정 앞말</span>
            <input value={form.resumePrefix} maxLength={30} onChange={(event) => setForm({ ...form, resumePrefix: event.target.value })} />
          </label>
          <div className="ln-notes">
            <span>※ 안내</span>
            {form.notes.map((note, index) => (
              <div key={index} className="ln-note-row">
                <input
                  value={note.text}
                  maxLength={200}
                  placeholder={`안내 ${index + 1} (비우면 빠져요)`}
                  onChange={(event) =>
                    setForm({ ...form, notes: form.notes.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)) })
                  }
                />
                <label className="sc-check">
                  <input
                    type="checkbox"
                    checked={note.highlight}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        notes: form.notes.map((item, i) => (i === index ? { ...item, highlight: event.target.checked } : item)),
                      })
                    }
                  />
                  파란색 강조
                </label>
              </div>
            ))}
          </div>
          <label>
            <span>QR 연결 주소</span>
            <input value={form.qrUrl} maxLength={300} placeholder="비우면 QR 없이" onChange={(event) => setForm({ ...form, qrUrl: event.target.value })} />
          </label>
          <div className="ln-form-actions">
            <button type="button" className="sc-primary" disabled={busy} onClick={() => void saveSettings(form)}>
              {busy ? <Loader2 size={14} className="spin-icon" /> : null}
              저장
            </button>
            <button
              type="button"
              className="ln-ghost"
              disabled={busy || !data}
              onClick={() => data && setForm({ ...data.defaults, notes: withNoteRows(data.defaults.notes) })}
            >
              기본 문구로
            </button>
            <button type="button" className="ln-ghost" onClick={() => setEditing(false)}>
              취소
            </button>
          </div>
        </div>
      )}

      {open && data && (
        <div className="ln-body">
          {data.periods.length === 0 ? (
            <p className="sc-empty ln-empty">
              예정된 휴무가 없어요. 달력에서 연차·반차를 지정하면 여기에 휴무 기간이 생기고, 그 기간에 맞춰 홈페이지에 팝업이 떠요.
            </p>
          ) : (
            <ul className="ln-periods">
              {data.periods.map((period) => {
                const state = periodState(period);
                return (
                  <li key={period.id} className={period.id === selectedId ? "is-selected" : ""}>
                    <button type="button" className="ln-period" onClick={() => setSelectedId(period.id)}>
                      <strong>{period.dateLabel}</strong>
                      <span>상담 재개 {period.resumeLabel}</span>
                      <em className={`ln-state ${state.className}`}>{state.label}</em>
                    </button>
                    <label className="ln-switch" title="이 휴무의 홈페이지 팝업 켜기·끄기">
                      <input type="checkbox" checked={period.popup} disabled={busy} onChange={() => void togglePopup(period)} />
                      <span>팝업</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {shown && (
            <div className="ln-preview-wrap">
              <p className={isSample ? "ln-when is-sample" : "ln-when"}>{exposureNote(shown, isSample)}</p>
              <div className="ln-modes">
                <div className="ln-mode-tabs" role="tablist" aria-label="미리보기">
                  {PREVIEW_MODES.map((item) => (
                    <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} onClick={() => setMode(item.id)}>
                      {item.label}
                    </button>
                  ))}
                </div>
                {mode !== "image" && (
                  <button type="button" className="ln-ghost" onClick={() => setReplay((count) => count + 1)}>
                    <RotateCcw size={13} /> 팝업 다시 띄우기
                  </button>
                )}
              </div>
              {mode === "image" ? (
                <NoticeImage
                  key={`${shown.id}:${version}`}
                  src={`/api/admin/leave-notice/image?id=${encodeURIComponent(shown.id)}&v=${version}`}
                />
              ) : (
                <div className={`ln-stage is-${mode}`}>
                  <div className={mode === "pc" ? "ln-browser" : "ln-phone"}>
                    {mode === "pc" && (
                      <div className="ln-browser-bar" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                        <span>yogibo.kr</span>
                      </div>
                    )}
                    <iframe
                      key={`${mode}:${replay}`}
                      title="홈페이지 팝업 미리보기"
                      sandbox="allow-scripts"
                      srcDoc={popupPreviewDoc(origin, shown)}
                    />
                  </div>
                </div>
              )}
              <p className="ln-caption">{PREVIEW_MODES.find((item) => item.id === mode)?.caption}</p>
              {!isSample && (
                <div className="ln-actions">
                  <button type="button" className="sc-primary" disabled={busy} onClick={() => void downloadImage(shown)}>
                    {busy ? <Loader2 size={14} className="spin-icon" /> : <Download size={14} />}
                    이미지 내려받기
                  </button>
                  <button
                    type="button"
                    className="ln-ghost"
                    onClick={() => void copyText(shown.html, "팝업 HTML 을 복사했어요. cafe24 팝업 내용(HTML)에 붙여 넣으면 돼요.")}
                  >
                    <Copy size={14} /> HTML 복사
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {open && (
        <details className="ln-install">
          <summary>cafe24 자동 팝업 설치 코드 (한 번만)</summary>
          <p>
            cafe24 디자인 편집에서 공통 레이아웃 맨 아래에 아래 한 줄을 넣어 두면, 위 목록의 &lsquo;팝업&rsquo;이 켜진 휴무만
            노출 기간에 자동으로 떠요(고객은 &lsquo;오늘 하루 보지 않기&rsquo;로 닫을 수 있어요).
            {isLocal && " 지금 주소는 이 PC 주소라, 서버에 올린 뒤 그 주소로 된 코드를 넣어야 해요."}
          </p>
          <div className="ln-code">
            <code>{installCode}</code>
            <button type="button" className="ln-ghost" onClick={() => void copyText(installCode, "설치 코드를 복사했어요.")}>
              <Copy size={14} /> 복사
            </button>
          </div>
        </details>
      )}
    </section>
  );
}
