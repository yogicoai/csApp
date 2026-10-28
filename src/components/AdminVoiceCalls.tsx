"use client";

import {
  Copy,
  FileAudio,
  Loader2,
  Mic,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  UserSearch,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CautionView, cautionText } from "@/lib/blackConsumer";

// 음성 상담 분석 — TWC 대체 계획의 "녹음 보관 + AI 요약·답변 초안 + 녹취 찾기" 화면.
// 녹음 파일을 올리면 전사(OpenAI) 후 CS 티켓 양식(상담유형·구분태그·상담요약·상담내용)으로 정리한다.

type Analysis = {
  category: string;
  tags: string[];
  summary: string;
  inquiry: string;
  response: string;
  customerName: string;
  customerPhone: string;
  product: string;
  orderInfo: string;
  followUp: string;
  draftAnswer: string;
  faqCandidate: string;
  sentiment: string;
};

type VoiceCallItem = {
  id: string;
  fileName: string;
  hasAudio: boolean;
  // 드롭박스에 보관한 원본 경로(없으면 빈값)
  dropboxPath: string;
  callDate: string;
  phoneNumber: string;
  durationSec: number;
  transcript: string;
  status: "pending" | "done" | "failed";
  error: string;
  analysis: Analysis | null;
  assetClaimId: string;
  createdAt: string;
};

function formatCallDate(iso: string) {
  if (!iso) return "일시 미상";
  return new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatPhone(digits: string) {
  if (!digits) return "번호 미상";
  if (/^01\d{8,9}$/.test(digits)) return digits.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3");
  if (/^02\d{7,8}$/.test(digits)) return digits.replace(/(02)(\d{3,4})(\d{4})/, "$1-$2-$3");
  return digits;
}

function formatDuration(sec: number) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}분 ${s}초` : `${s}초`;
}

// 녹음 길이(초)를 브라우저에서 읽는다. 전사 응답에는 길이가 없어서 이 값을 같이 보낸다. 못 읽으면 0.
function readAudioDuration(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const finish = (seconds: number) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0);
    };
    const timer = window.setTimeout(() => finish(0), 4000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}

// initialQuery·initialCallId — 고객 조회에서 녹취를 눌러 왔을 때 그 번호로 찾아 바로 연다.
export function AdminVoiceCalls({ initialQuery = "", initialCallId = "" }: { initialQuery?: string; initialCallId?: string }) {
  const [calls, setCalls] = useState<VoiceCallItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [q, setQ] = useState(initialQuery);
  const [selected, setSelected] = useState<VoiceCallItem | null>(null);
  // 블랙컨슈머 주의 표시 — 목록의 녹취별 표시와, 고른 녹취의 최신 표시(undefined = 아직 상세를 받기 전이라 목록 값을 쓴다)
  const [cautions, setCautions] = useState<Record<string, CautionView>>({});
  const [selectedCaution, setSelectedCaution] = useState<CautionView | null | undefined>(undefined);
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  // 녹음 원본 보관 — dropbox: 회사 드롭박스 녹음 폴더에 바로 올림 / local: 베타 로컬 폴더
  const [storage, setStorage] = useState<"dropbox" | "local">("local");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async (query: string) => {
    try {
      const response = await fetch(`/api/admin/voice-calls${query ? `?q=${encodeURIComponent(query)}` : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        calls: VoiceCallItem[];
        cautions?: Record<string, CautionView>;
        storage?: "dropbox" | "local";
      };
      setCalls(body.calls ?? []);
      setCautions(body.cautions ?? {});
      setStorage(body.storage === "dropbox" ? "dropbox" : "local");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadList(q.trim()), q ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [q, loadList]);

  const selectCall = useCallback(async (item: VoiceCallItem) => {
    setShowTranscript(false);
    setSelected(item);
    setSelectedCaution(undefined);
    const response = await fetch(`/api/admin/voice-calls/${item.id}`, { cache: "no-store" });
    if (response.ok) {
      const body = (await response.json()) as { call: VoiceCallItem; caution?: CautionView | null };
      setSelected(body.call);
      setSelectedCaution(body.caution ?? null);
    }
  }, []);

  // 고객 조회에서 고른 녹취 — 목록에 나오면 한 번 연다.
  const pendingCallRef = useRef(initialCallId);
  useEffect(() => {
    const target = pendingCallRef.current ? calls.find((item) => item.id === pendingCallRef.current) : undefined;
    if (!target) return;
    pendingCallRef.current = "";
    window.setTimeout(() => void selectCall(target), 0);
  }, [calls, selectCall]);

  function onPickFile(next: File | null) {
    setFile(next);
    if (next) setMode("file");
  }

  // 드롭박스 녹음 폴더에 바로 올린다 — 서버가 받아 준 임시 주소로 브라우저가 올리고, 올라간 경로를 돌려준다.
  async function uploadToDropbox(picked: File) {
    const linkResponse = await fetch("/api/admin/voice-calls/upload-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: picked.name, size: picked.size, phoneNumber: phoneNumber.trim() || undefined }),
    });
    const link = (await linkResponse.json().catch(() => ({}))) as { link?: string; path?: string; error?: string };
    if (!linkResponse.ok || !link.link || !link.path) throw new Error(link.error ?? "드롭박스 업로드 주소를 받지 못했어요.");
    const put = await fetch(link.link, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: picked });
    if (!put.ok) throw new Error("드롭박스에 올리지 못했어요. 잠시 후 다시 시도해 주세요.");
    // 서버가 비어 있는 경로를 정해 그대로 저장되게 했으므로 그 경로가 실제 저장 위치다.
    return link.path;
  }

  async function upload() {
    if (busy) return;
    setError("");
    setBusy(true);
    setNotice(mode === "file" ? "전사하고 분석하는 중이에요… 통화 길이에 따라 1~2분 걸려요." : "녹취를 분석하는 중이에요…");
    try {
      let request: RequestInit;
      if (mode === "file" && storage === "dropbox") {
        if (!file) {
          setError("녹음 파일을 골라 주세요.");
          return;
        }
        setNotice("녹음을 드롭박스에 올리는 중이에요…");
        let dropboxPath: string;
        try {
          dropboxPath = await uploadToDropbox(file);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "드롭박스에 올리지 못했어요.");
          return;
        }
        setNotice("드롭박스에 올렸어요. 전사하고 분석하는 중이에요… 통화 길이에 따라 1~2분 걸려요.");
        const durationSec = await readAudioDuration(file);
        request = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dropboxPath,
            fileName: file.name,
            mimeType: file.type,
            durationSec: durationSec || undefined,
            phoneNumber: phoneNumber.trim() || undefined,
          }),
        };
      } else {
        const form = new FormData();
        if (mode === "file") {
          if (!file) {
            setError("녹음 파일을 골라 주세요.");
            return;
          }
          form.append("file", file);
          const durationSec = await readAudioDuration(file);
          if (durationSec) form.append("durationSec", String(durationSec));
        } else {
          if (!pasted.trim()) {
            setError("녹취 텍스트를 붙여넣어 주세요.");
            return;
          }
          form.append("transcript", pasted.trim());
        }
        if (phoneNumber.trim()) form.append("phoneNumber", phoneNumber.trim());
        request = { method: "POST", body: form };
      }

      const response = await fetch("/api/admin/voice-calls", request);
      const body = (await response.json().catch(() => ({}))) as { call?: VoiceCallItem; error?: string };
      if (!response.ok && !body.call) {
        setError(body.error ?? "등록에 실패했어요.");
        return;
      }
      if (body.call) {
        setSelected(body.call);
        if (body.call.status === "failed") setError(body.call.error || "처리에 실패했어요.");
      }
      setFile(null);
      setPasted("");
      setPhoneNumber("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadList(q.trim());
    } catch {
      setError("등록에 실패했어요. 네트워크 상태를 확인해 주세요.");
    } finally {
      setBusy(false);
      setNotice("");
    }
  }

  async function reanalyze() {
    if (!selected || busy) return;
    setBusy(true);
    setNotice("다시 분석하는 중이에요…");
    setError("");
    try {
      const response = await fetch(`/api/admin/voice-calls/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reanalyze: true }),
      });
      const body = (await response.json().catch(() => ({}))) as { call?: VoiceCallItem; error?: string };
      if (body.call) setSelected(body.call);
      if (!response.ok) setError(body.call?.error || body.error || "분석에 실패했어요.");
      await loadList(q.trim());
    } finally {
      setBusy(false);
      setNotice("");
    }
  }

  // 분석이 끝난 녹취를 응대 자산(검토 대기)으로 승격한다.
  async function promoteToAsset() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/voice-calls/${selected.id}/claim`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { claimId?: string; error?: string };
      if (!response.ok) {
        setError(body.error ?? "응대 자산으로 보내지 못했어요.");
        return;
      }
      setSelected({ ...selected, assetClaimId: body.claimId ?? "sent" });
      await loadList(q.trim());
    } finally {
      setBusy(false);
    }
  }

  async function removeCall() {
    if (!selected) return;
    const question = selected.dropboxPath
      ? "이 녹취 기록(분석 자료)을 삭제할까요? 원본 녹음은 드롭박스 녹음 폴더에 그대로 남아요."
      : "이 녹취 기록을 삭제할까요? 보관된 음성 파일도 함께 지워져요.";
    if (!window.confirm(question)) return;
    const response = await fetch(`/api/admin/voice-calls/${selected.id}`, { method: "DELETE" });
    if (response.ok) {
      setSelected(null);
      await loadList(q.trim());
    }
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      // 클립보드가 막힌 환경에서는 무시
    }
  }

  const analysis = selected?.analysis ?? null;
  const caution = selected ? (selectedCaution === undefined ? (cautions[selected.id] ?? null) : selectedCaution) : null;
  // 고객 조회·블랙컨슈머 등록에 쓸 번호 — 통화 번호가 없으면 분석에서 나온 고객 연락처
  const customerPhone = selected ? selected.phoneNumber || (analysis?.customerPhone ?? "").replace(/\D/g, "") : "";

  return (
    <div className="vc-admin">
      <aside className="vc-side">
        <section className="vc-upload">
          <div className="vc-upload-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "file"} onClick={() => setMode("file")}>
              <FileAudio size={14} /> 녹음 파일
            </button>
            <button type="button" role="tab" aria-selected={mode === "text"} onClick={() => setMode("text")}>
              녹취 붙여넣기
            </button>
          </div>

          {mode === "file" ? (
            <>
              <label className="vc-file">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm"
                  onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
                />
                <Upload size={15} />
                {file ? file.name : "통화 녹음 파일 선택 (mp3·m4a·wav)"}
              </label>
              <p className="vc-hint">
                파일명에 날짜·전화번호가 있으면 자동으로 읽어요. 25MB 이하.
                {storage === "dropbox" && " 원본은 드롭박스 csVoice 폴더에 통화일별로 보관돼요."}
              </p>
            </>
          ) : (
            <textarea
              className="vc-paste"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder="녹취록 텍스트를 붙여넣으면 전사 없이 바로 분석해요."
              rows={5}
            />
          )}

          <input
            className="vc-phone"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            placeholder="고객 전화번호 (선택, 파일명에서 자동 인식)"
            maxLength={20}
          />
          <button type="button" className="vc-submit" disabled={busy} onClick={() => void upload()}>
            {busy ? <Loader2 size={15} className="spin-icon" /> : <Mic size={15} />}
            {busy ? "처리 중…" : "전사·분석 시작"}
          </button>
          {notice && <p className="vc-notice">{notice}</p>}
          {error && <p className="vc-error">{error}</p>}
          <p className="vc-privacy">녹취는 전사(OpenAI)·분석(Anthropic) 처리돼요. 운영 전환 전에 개인정보 처리방침 반영이 필요해요.</p>
        </section>

        <div className="vc-search">
          <Search size={14} />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="전화번호·이름·내용으로 녹취 찾기"
          />
          {q && (
            <button type="button" aria-label="검색 지우기" onClick={() => setQ("")}>
              <X size={14} />
            </button>
          )}
        </div>

        <ul className="vc-list">
          {listLoading && <li className="vc-empty">불러오는 중…</li>}
          {!listLoading && calls.length === 0 && <li className="vc-empty">{q ? "검색 결과가 없어요." : "등록된 녹취가 없어요."}</li>}
          {calls.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={selected?.id === item.id ? "vc-item is-selected" : "vc-item"}
                onClick={() => void selectCall(item)}
              >
                <div className="vc-item-top">
                  <strong>{formatPhone(item.phoneNumber)}</strong>
                  {cautions[item.id] && (
                    <span className="bc-flag" title={`블랙컨슈머 · ${cautionText(cautions[item.id])}`}>
                      <ShieldAlert size={11} /> 블랙
                    </span>
                  )}
                  <span>{formatCallDate(item.callDate || item.createdAt)}</span>
                </div>
                <p>
                  {item.status === "failed"
                    ? `실패 — ${item.error || "원인 미상"}`
                    : item.analysis?.summary || item.fileName || "분석 대기"}
                </p>
                <div className="vc-item-tags">
                  {item.analysis?.category && <span className="vc-chip">{item.analysis.category}</span>}
                  {item.status === "failed" && <span className="vc-chip is-failed">실패</span>}
                  {item.durationSec > 0 && <span className="vc-chip is-muted">{formatDuration(item.durationSec)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="vc-detail">
        {!selected ? (
          <div className="vc-placeholder">
            <Mic size={28} />
            <p>왼쪽에서 녹취를 선택하거나 새 녹음을 올려 주세요.</p>
            <p className="vc-placeholder-sub">전화 상담도 실시간 채팅처럼 요약·분류돼서 AI 답변 자산으로 쌓여요.</p>
          </div>
        ) : (
          <>
            <header className="vc-detail-head">
              <div>
                <strong>{formatPhone(selected.phoneNumber)}</strong>
                <span>
                  {formatCallDate(selected.callDate || selected.createdAt)}
                  {selected.durationSec > 0 && ` · ${formatDuration(selected.durationSec)}`}
                  {selected.fileName && ` · ${selected.fileName}`}
                </span>
              </div>
              <div className="vc-detail-actions">
                {customerPhone && (
                  <Link href={`/admin/customers?phone=${customerPhone}`}>
                    <UserSearch size={14} /> 고객 조회
                  </Link>
                )}
                {caution ? (
                  <Link className="is-caution" href={`/admin/black-consumers?id=${caution.id}`}>
                    <ShieldAlert size={14} /> 블랙컨슈머 보기
                  </Link>
                ) : (
                  <Link
                    href={`/admin/black-consumers?${new URLSearchParams({
                      new: "1",
                      phone: customerPhone,
                      name: analysis?.customerName ?? "",
                      refs: `녹취 ${formatCallDate(selected.callDate || selected.createdAt)}`,
                    })}`}
                  >
                    <ShieldAlert size={14} /> 블랙컨슈머 등록
                  </Link>
                )}
                {selected.status === "done" &&
                  (selected.assetClaimId ? (
                    <button type="button" className="is-sent" disabled>
                      <Sparkles size={14} /> 자산 검토 대기 ✓
                    </button>
                  ) : (
                    <button type="button" className="is-primary" onClick={() => void promoteToAsset()} disabled={busy}>
                      <Sparkles size={14} /> 응대 자산으로 보내기
                    </button>
                  ))}
                <button type="button" onClick={() => void reanalyze()} disabled={busy}>
                  <RefreshCw size={14} /> 다시 분석
                </button>
                <button type="button" className="is-danger" onClick={() => void removeCall()}>
                  <Trash2 size={14} /> 삭제
                </button>
              </div>
            </header>

            {caution && (
              <div className="lc-caution" role="alert">
                <ShieldAlert size={16} />
                <span>
                  <strong>블랙컨슈머</strong> {cautionText(caution)} — 응대에 주의하세요
                </span>
                <Link href={`/admin/black-consumers?id=${caution.id}`}>자세히</Link>
              </div>
            )}

            {selected.hasAudio && (
              <audio className="vc-audio" controls preload="none" src={`/api/admin/voice-calls/${selected.id}/audio`} />
            )}
            {selected.dropboxPath && (
              <p className="vc-hint">원본: 드롭박스 {selected.dropboxPath.split("/").slice(-3).join("/")}</p>
            )}

            {selected.status === "failed" && <p className="vc-error">처리 실패: {selected.error}</p>}

            {analysis && (
              <div className="vc-grid">
                <section className="vc-card">
                  <h3>상담유형·태그</h3>
                  <div className="vc-item-tags">
                    {analysis.category && <span className="vc-chip">{analysis.category}</span>}
                    {analysis.sentiment && <span className={`vc-chip is-sentiment-${analysis.sentiment}`}>{analysis.sentiment}</span>}
                    {analysis.tags.map((tag) => (
                      <span key={tag} className="vc-chip is-muted">
                        {tag}
                      </span>
                    ))}
                  </div>
                </section>

                <section className="vc-card">
                  <h3>고객 정보</h3>
                  <dl className="vc-facts">
                    <div>
                      <dt>성함</dt>
                      <dd>{analysis.customerName || "—"}</dd>
                    </div>
                    <div>
                      <dt>연락처</dt>
                      <dd>{analysis.customerPhone || formatPhone(selected.phoneNumber)}</dd>
                    </div>
                    <div>
                      <dt>제품</dt>
                      <dd>{analysis.product || "—"}</dd>
                    </div>
                    <div>
                      <dt>주문 정보</dt>
                      <dd>{analysis.orderInfo || "—"}</dd>
                    </div>
                  </dl>
                </section>

                <section className="vc-card is-wide">
                  <h3>상담요약</h3>
                  <p>{analysis.summary || "—"}</p>
                </section>

                <section className="vc-card">
                  <h3>문의 내용</h3>
                  <p>{analysis.inquiry || "—"}</p>
                </section>

                <section className="vc-card">
                  <h3>안내한 내용</h3>
                  <p>{analysis.response || "—"}</p>
                </section>

                {analysis.followUp && (
                  <section className="vc-card is-wide is-follow">
                    <h3>후속 조치</h3>
                    <p>{analysis.followUp}</p>
                  </section>
                )}

                {analysis.draftAnswer && (
                  <section className="vc-card is-wide is-draft">
                    <div className="vc-card-head">
                      <h3>재문의 답변 초안</h3>
                      <button type="button" onClick={() => void copyText("draft", analysis.draftAnswer)}>
                        <Copy size={13} /> {copied === "draft" ? "복사됨" : "복사"}
                      </button>
                    </div>
                    <p>{analysis.draftAnswer}</p>
                  </section>
                )}

                {analysis.faqCandidate && (
                  <section className="vc-card is-wide">
                    <h3>FAQ 제안</h3>
                    <p>{analysis.faqCandidate}</p>
                  </section>
                )}
              </div>
            )}

            {selected.transcript && (
              <section className="vc-transcript">
                <button type="button" onClick={() => setShowTranscript((prev) => !prev)}>
                  {showTranscript ? "녹취 전문 접기" : `녹취 전문 보기 (${selected.transcript.length.toLocaleString()}자)`}
                </button>
                {showTranscript && <pre>{selected.transcript}</pre>}
              </section>
            )}
          </>
        )}
      </section>
    </div>
  );
}
