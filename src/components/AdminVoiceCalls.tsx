"use client";

import {
  Copy,
  FileAudio,
  FolderOpen,
  History,
  Loader2,
  Mic,
  Play,
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
// 드롭박스 고객지원 폴더와 이어져 있다 — 녹음 폴더에 쌓인 녹음은 [진행]으로 분석하고, TWC 지난 티켓 엑셀은 가져와 같이 찾는다.

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

type TwcInfo = { ticketId: string; brand: string; channel: string; status: string; agent: string; recordingFile: string };

type VoiceCallItem = {
  id: string;
  // recording: 올린 녹음 · twc: TWC 지난 티켓(녹음·전사 없음)
  source: "recording" | "twc";
  twc: TwcInfo | null;
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

// 드롭박스 녹음 폴더에 있지만 아직 분석하지 않은 녹음 — problem 이 있으면 전사할 수 없는 파일
type InboxFile = { path: string; name: string; size: number; modified: string; problem: string };
// TWC 티켓 폴더의 엑셀 — imported: 이 파일에서 가져온 티켓 수
type TwcFile = { path: string; name: string; size: number; modified: string; imported: number };
type TwcResult = { rows: number; inserted: number; updated: number; unchanged: number; skipped: number };
type SourceFilter = "" | "recording" | "twc";

const SOURCE_FILTERS: Array<[SourceFilter, string]> = [
  ["", "전체"],
  ["recording", "녹음"],
  ["twc", "TWC 티켓"],
];

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function formatCallDate(iso: string) {
  if (!iso) return "일시 미상";
  const date = new Date(iso);
  // TWC 지난 티켓은 몇 년 전 것도 있어 올해가 아니면 연도를 붙인다.
  const year = date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" as const };
  return date.toLocaleString("ko-KR", { ...year, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("");
  // 드롭박스 녹음 폴더에 쌓인, 아직 분석하지 않은 녹음
  const [inbox, setInbox] = useState<{ files: InboxFile[]; total: number } | null>(null);
  const [inboxError, setInboxError] = useState("");
  const [runningPath, setRunningPath] = useState("");
  // TWC 지난 티켓 엑셀(펼쳤을 때 읽는다)
  const [twc, setTwc] = useState<{ files: TwcFile[]; total: number } | null>(null);
  const [twcProgress, setTwcProgress] = useState("");
  const [twcMessage, setTwcMessage] = useState("");
  const [twcError, setTwcError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async (query: string, source: SourceFilter) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (source) params.set("source", source);
    try {
      const response = await fetch(`/api/admin/voice-calls${params.size ? `?${params}` : ""}`, {
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
    const timer = window.setTimeout(() => void loadList(q.trim(), sourceFilter), q ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [q, sourceFilter, loadList]);

  const loadInbox = useCallback(async () => {
    const response = await fetch("/api/admin/voice-calls/inbox", { cache: "no-store" }).catch(() => null);
    const body = (response ? await response.json().catch(() => ({})) : {}) as {
      configured?: boolean;
      files?: InboxFile[];
      total?: number;
      error?: string;
    };
    if (!response?.ok) {
      setInboxError(body.error ?? "드롭박스 녹음 폴더를 읽지 못했어요.");
      return;
    }
    setInboxError("");
    setInbox(body.configured ? { files: body.files ?? [], total: body.total ?? 0 } : null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadInbox(), 0);
    return () => window.clearTimeout(timer);
  }, [loadInbox]);

  const loadTwc = useCallback(async () => {
    const response = await fetch("/api/admin/voice-calls/twc", { cache: "no-store" }).catch(() => null);
    const body = (response ? await response.json().catch(() => ({})) : {}) as {
      configured?: boolean;
      files?: TwcFile[];
      total?: number;
      error?: string;
    };
    if (!response?.ok) {
      setTwcError(body.error ?? "TWC 티켓 폴더를 읽지 못했어요.");
      return;
    }
    setTwcError("");
    setTwc({ files: body.files ?? [], total: body.total ?? 0 });
  }, []);

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
      await loadList(q.trim(), sourceFilter);
    } catch {
      setError("등록에 실패했어요. 네트워크 상태를 확인해 주세요.");
    } finally {
      setBusy(false);
      setNotice("");
    }
  }

  // 녹음 폴더에 쌓인 녹음을 분석한다 — 이미 드롭박스에 있으니 올리지 않고 그 경로로 등록(전사·분석)만 부른다.
  async function analyzeFromFolder(item: InboxFile) {
    if (busy) return;
    setBusy(true);
    setRunningPath(item.path);
    setInboxError("");
    // 실패 문구는 목록을 다시 읽은 뒤에 띄운다(다시 읽으면 오류 칸이 비워진다).
    let failure = "";
    try {
      const response = await fetch("/api/admin/voice-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropboxPath: item.path, fileName: item.name }),
      });
      const body = (await response.json().catch(() => ({}))) as { call?: VoiceCallItem; error?: string };
      if (body.call) {
        setShowTranscript(false);
        setSelected(body.call);
        setSelectedCaution(undefined);
        if (body.call.status === "failed") failure = `${item.name}: ${body.call.error || "처리에 실패했어요."}`;
      } else if (!response.ok) {
        failure = `${item.name}: ${body.error ?? "분석에 실패했어요."}`;
      }
      await Promise.all([loadList(q.trim(), sourceFilter), loadInbox()]);
    } catch {
      failure = "분석을 시작하지 못했어요. 네트워크 상태를 확인해 주세요.";
    } finally {
      setBusy(false);
      setRunningPath("");
    }
    if (failure) setInboxError(failure);
  }

  // TWC 티켓 엑셀 가져오기 — 파일 하나씩 차례로(큰 연도 파일은 수십 초). 같은 파일을 다시 가져와도 겹치지 않는다.
  async function importTwc(files: TwcFile[]) {
    if (twcProgress || !files.length) return;
    const question = `TWC 티켓 엑셀 ${files.length}개를 가져올까요?\n고객 이름·연락처·상담 메모가 이 프로그램에 저장되고, 고객 조회에서도 함께 보여요.`;
    if (!window.confirm(question)) return;
    setTwcError("");
    setTwcMessage("");
    const total: TwcResult = { rows: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
    let done = 0;
    // 실패 문구는 폴더를 다시 읽은 뒤에 띄운다(다시 읽으면 오류 칸이 비워진다).
    let failure = "";
    try {
      for (const file of files) {
        setTwcProgress(`${done + 1}/${files.length} ${file.name} 가져오는 중…`);
        const response = await fetch("/api/admin/voice-calls/twc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: file.path }),
        });
        const body = (await response.json().catch(() => ({}))) as { result?: TwcResult; error?: string };
        if (!response.ok || !body.result) {
          failure = `${file.name}: ${body.error ?? "가져오지 못했어요."}`;
          break;
        }
        for (const key of Object.keys(total) as Array<keyof TwcResult>) total[key] += body.result[key];
        done++;
      }
    } catch {
      failure = "가져오다 연결이 끊겼어요. 다시 누르면 이어서 가져와요(겹치지 않아요).";
    } finally {
      setTwcProgress("");
    }
    if (done) {
      setTwcMessage(
        `${done}개 파일 · 새로 ${total.inserted.toLocaleString()}건 · 바뀜 ${total.updated.toLocaleString()}건 · 그대로 ${total.unchanged.toLocaleString()}건`,
      );
    }
    await Promise.all([loadTwc(), loadList(q.trim(), sourceFilter)]);
    if (failure) setTwcError(failure);
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
      await loadList(q.trim(), sourceFilter);
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
      await loadList(q.trim(), sourceFilter);
    } finally {
      setBusy(false);
    }
  }

  async function removeCall() {
    if (!selected) return;
    const question =
      selected.source === "twc"
        ? "이 TWC 티켓 기록을 삭제할까요? 원본 엑셀은 드롭박스에 그대로 남고, 같은 엑셀을 다시 가져오면 다시 생겨요."
        : selected.dropboxPath
          ? "이 녹취 기록(분석 자료)을 삭제할까요? 원본 녹음은 드롭박스 녹음 폴더에 그대로 남아요."
          : "이 녹취 기록을 삭제할까요? 보관된 음성 파일도 함께 지워져요.";
    if (!window.confirm(question)) return;
    const response = await fetch(`/api/admin/voice-calls/${selected.id}`, { method: "DELETE" });
    if (response.ok) {
      setSelected(null);
      await Promise.all([loadList(q.trim(), sourceFilter), selected.dropboxPath ? loadInbox() : null]);
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
                {storage === "dropbox" && " 원본은 드롭박스 11_고객지원/음성 상담 녹음 폴더에 연도·통화일별로 보관돼요."}
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

        {storage === "dropbox" && (
          <section className="vc-folder" aria-label="드롭박스 녹음 폴더">
            <div className="vc-folder-head">
              <h3>
                <FolderOpen size={15} /> 녹음 폴더 · 분석 전 <span>{inbox ? inbox.total.toLocaleString() : "…"}</span>
              </h3>
              <button type="button" aria-label="녹음 폴더 새로고침" disabled={busy} onClick={() => void loadInbox()}>
                <RefreshCw size={13} />
              </button>
            </div>
            <p className="vc-hint">드롭박스 11_고객지원/음성 상담 녹음 폴더에 넣은 녹음 중 아직 분석하지 않은 것이에요.</p>
            {inboxError && <p className="vc-error">{inboxError}</p>}
            {inbox && inbox.files.length === 0 && !inboxError && <p className="vc-folder-empty">분석할 녹음이 없어요.</p>}
            {inbox && inbox.files.length > 0 && (
              <ul className="vc-folder-list">
                {inbox.files.map((item) => (
                  <li key={item.path}>
                    <div>
                      <strong title={item.path}>{item.name}</strong>
                      <span>
                        {item.modified ? formatCallDate(item.modified) : ""} · {formatFileSize(item.size)}
                      </span>
                      {item.problem && <em>{item.problem}</em>}
                    </div>
                    <button type="button" disabled={busy || Boolean(item.problem)} onClick={() => void analyzeFromFolder(item)}>
                      {runningPath === item.path ? <Loader2 size={13} className="spin-icon" /> : <Play size={13} />}
                      {runningPath === item.path ? "분석 중" : "진행"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {inbox && inbox.total > inbox.files.length && (
              <p className="vc-hint">최근 {inbox.files.length}개만 보여요. 진행하면 다음 것이 이어서 보여요.</p>
            )}
          </section>
        )}

        {storage === "dropbox" && (
          <details
            className="vc-folder"
            onToggle={(event) => {
              if (event.currentTarget.open && !twc) void loadTwc();
            }}
          >
            <summary>
              <History size={15} /> TWC 지난 티켓
              {twc && <span>{twc.total.toLocaleString()}건 가져옴</span>}
            </summary>
            <p className="vc-hint">
              드롭박스 11_고객지원/클라우드게이트 티켓의 엑셀을 가져와 녹취처럼 찾고 볼 수 있어요. 고객 조회에도 같이 나와요. 같은 파일을
              다시 가져와도 겹치지 않아요.
            </p>
            {!twc && !twcError && <p className="vc-folder-empty">불러오는 중…</p>}
            {twcError && <p className="vc-error">{twcError}</p>}
            {twc && twc.files.length === 0 && <p className="vc-folder-empty">티켓 엑셀이 없어요.</p>}
            {twc && twc.files.length > 0 && (
              <>
                <ul className="vc-folder-list">
                  {twc.files.map((item) => (
                    <li key={item.path}>
                      <div>
                        <strong title={item.path}>{item.name}</strong>
                        <span>
                          {item.imported ? `${item.imported.toLocaleString()}건 가져옴` : "아직 안 가져옴"} · {formatFileSize(item.size)}
                        </span>
                      </div>
                      <button type="button" disabled={Boolean(twcProgress)} onClick={() => void importTwc([item])}>
                        {item.imported ? "다시" : "가져오기"}
                      </button>
                    </li>
                  ))}
                </ul>
                {twc.files.some((item) => !item.imported) && (
                  <button
                    type="button"
                    className="vc-folder-all"
                    disabled={Boolean(twcProgress)}
                    onClick={() => void importTwc(twc.files.filter((item) => !item.imported))}
                  >
                    안 가져온 파일 모두 가져오기 ({twc.files.filter((item) => !item.imported).length}개)
                  </button>
                )}
              </>
            )}
            {twcProgress && (
              <p className="vc-notice">
                <Loader2 size={13} className="spin-icon" /> {twcProgress}
              </p>
            )}
            {twcMessage && <p className="vc-hint">{twcMessage}</p>}
          </details>
        )}

        <div className="vc-filter" role="group" aria-label="녹취 종류">
          {SOURCE_FILTERS.map(([value, label]) => (
            <button key={label} type="button" aria-pressed={sourceFilter === value} onClick={() => setSourceFilter(value)}>
              {label}
            </button>
          ))}
        </div>

        <div className="vc-search">
          <Search size={14} />
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="전화번호·이름·내용·티켓 ID로 찾기"
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
                  {item.source === "twc" && <span className="vc-chip is-twc">TWC</span>}
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
                  {selected.twc ? ` · TWC 티켓 ${selected.twc.ticketId}` : selected.fileName && ` · ${selected.fileName}`}
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
                {/* TWC 티켓은 녹취·답변 초안이 없어 자산 보내기·다시 분석을 하지 않는다 */}
                {selected.source !== "twc" &&
                  selected.status === "done" &&
                  (selected.assetClaimId ? (
                    <button type="button" className="is-sent" disabled>
                      <Sparkles size={14} /> 자산 검토 대기 ✓
                    </button>
                  ) : (
                    <button type="button" className="is-primary" onClick={() => void promoteToAsset()} disabled={busy}>
                      <Sparkles size={14} /> 응대 자산으로 보내기
                    </button>
                  ))}
                {selected.source !== "twc" && (
                  <button type="button" onClick={() => void reanalyze()} disabled={busy}>
                    <RefreshCw size={14} /> 다시 분석
                  </button>
                )}
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
            {selected.twc && (
              <p className="vc-hint">
                TWC 에서 상담원이 남긴 티켓이에요(녹음 없음) · {[selected.twc.status, selected.twc.channel && `인입 ${selected.twc.channel}`, selected.twc.agent && `담당 ${selected.twc.agent}`, selected.twc.brand !== "요기보" && selected.twc.brand, selected.twc.recordingFile && `TWC 녹취 ${selected.twc.recordingFile}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
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
                  <h3>{selected.source === "twc" ? "티켓 제목" : "상담요약"}</h3>
                  <p>{analysis.summary || "—"}</p>
                </section>

                {selected.source === "twc" ? (
                  <section className="vc-card is-wide">
                    <h3>상담 메모</h3>
                    <p className="vc-memo">{analysis.inquiry || "—"}</p>
                  </section>
                ) : (
                  <>
                    <section className="vc-card">
                      <h3>문의 내용</h3>
                      <p>{analysis.inquiry || "—"}</p>
                    </section>

                    <section className="vc-card">
                      <h3>안내한 내용</h3>
                      <p>{analysis.response || "—"}</p>
                    </section>
                  </>
                )}

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
