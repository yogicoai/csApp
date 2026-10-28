"use client";

import { Loader2, Lock, MessageSquareReply, Paperclip, Pencil, RefreshCw, Search, Send, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistPanel } from "@/components/AssistPanel";
import {
  type AnswerFrame,
  BOARD_ANSWER_FOOTER,
  BOARD_ANSWER_HEADER,
  BOARD_ANSWER_MAX,
  BOARD_PERIODS,
  BOARDS_CHANGED_EVENT,
  type BoardFolder,
  type BoardPost,
  boardPlaceLabel,
  composeAnswer,
  HOMEPAGE_BOARDS,
  homepageBoard,
  needsAnswer,
  SMARTSTORE_BOARDS,
  type SmartstoreKind,
} from "@/lib/boards";

// 게시판 관리 — 홈페이지(cafe24 게시판)·스마트스토어(고객문의) 글을 기간별로 불러와 답변 상태를 보고,
// 답이 없는 글에는 여기서 답변을 써서 그 게시판에 바로 등록하고, 등록된 답변도 고친다(고객에게 바로 보이므로 확인 창을 거친다).
// 답변창에는 본문만 쓰고, 머리말·꼬리말은 켜 둔 것만 등록할 때 앞뒤에 붙는다.

type StatusFilter = "all" | "open" | "done";
type Snippet = { id: string; title: string; body: string };
type LoadedList = { posts: BoardPost[]; from: string; to: string };
// 확인 창 — 새 답변 등록이거나 등록된 답변 고치기
type Confirm = { kind: "answer" } | { kind: "edit"; answerId: string };
type Editing = { postKey: string; answerId: string; original: string; text: string };

const FOLDERS: Array<{ id: BoardFolder; label: string }> = [
  { id: "homepage", label: "홈페이지" },
  { id: "smartstore", label: "스마트스토어" },
];
const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "전체" },
  { id: "open", label: "미답변" },
  { id: "done", label: "답변 완료" },
];
// 머리말·꼬리말을 켜 둘지 — 상담원마다 브라우저에 기억
const FRAME_KEY = "cs_board_answer_frame";

function sourceKey(folder: BoardFolder, boardNo: number, kind: SmartstoreKind, days: number) {
  return folder === "homepage" ? `homepage?board=${boardNo}&days=${days}` : `smartstore?kind=${kind}&days=${days}`;
}

function answerUrl(post: BoardPost) {
  if (post.folder === "homepage") return `/api/admin/boards/homepage/${post.boardNo}/${post.articleNo}/answer`;
  return post.kind === "qna"
    ? `/api/admin/boards/smartstore/qna/${post.questionId}/answer`
    : `/api/admin/boards/smartstore/${post.inquiryNo}/answer`;
}

function statusChip(post: BoardPost) {
  if (post.answered) return { label: "답변 완료", tone: "is-done" };
  return needsAnswer(post) ? { label: "미답변", tone: "is-open" } : { label: "답글 없음", tone: "is-muted" };
}

function destinationText(post: BoardPost, kind: Confirm["kind"]) {
  const place = post.kind === "qna" ? "스마트스토어 상품문의(상품 페이지 Q&A)" : "스마트스토어 고객문의";
  if (kind === "edit") {
    return post.folder === "smartstore"
      ? `${place}에 달린 판매자 답변이 이 내용으로 바뀌어요. 고객에게 바로 보여요.`
      : "홈페이지 게시판에 달린 답글이 이 내용으로 바뀌어요. 고객에게 바로 보여요.";
  }
  if (post.folder === "smartstore") {
    return `${place}에 판매자 답변으로 올라가요. 고객에게 바로 보이고, 등록한 뒤에도 여기서 고칠 수 있어요.`;
  }
  const board = homepageBoard(post.boardNo ?? 0)?.name ?? "게시판";
  return `홈페이지 ${board} 게시판에 '(주)요기코퍼레이션' 이름의 ${post.secret ? "비밀 " : ""}답글로 올라가고 고객에게 답변 알림 메일이 가요. 등록한 뒤에도 여기서 고칠 수 있어요.`;
}

function readFrame(): AnswerFrame {
  try {
    const saved = JSON.parse(window.localStorage.getItem(FRAME_KEY) ?? "{}") as Partial<AnswerFrame>;
    return { header: saved.header !== false, footer: saved.footer !== false };
  } catch {
    return { header: true, footer: true };
  }
}

const appendParagraph = (base: string, text: string) => (base.trim() ? `${base.trimEnd()}\n\n${text}` : text);

export function BoardManager() {
  const [folder, setFolder] = useState<BoardFolder>("homepage");
  const [boardNo, setBoardNo] = useState<number>(HOMEPAGE_BOARDS[0].no);
  const [ssKind, setSsKind] = useState<SmartstoreKind>(SMARTSTORE_BOARDS[0].id);
  const [days, setDays] = useState<number>(30);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [lists, setLists] = useState<Record<string, LoadedList>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [frame, setFrame] = useState<AnswerFrame>({ header: true, footer: true });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [notice, setNotice] = useState("");
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const requestSeq = useRef(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const source = sourceKey(folder, boardNo, ssKind, days);
  const current = lists[source] ?? null;

  const load = useCallback(async (key: string) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/admin/boards/${key}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (seq !== requestSeq.current) return; // 그사이 다른 폴더·기간을 골랐으면 버린다
      if (!response.ok) {
        setLoadError(body.error ?? `불러오지 못했어요 (${response.status})`);
        return;
      }
      setLists((prev) => ({ ...prev, [key]: { posts: body.posts ?? [], from: body.from ?? "", to: body.to ?? "" } }));
    } catch {
      if (seq === requestSeq.current) setLoadError("불러오는 중 오류가 났어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // 처음 여는 폴더·게시판·기간만 불러온다(한 번 불러온 건 새로고침 전까지 그대로)
  useEffect(() => {
    if (lists[source]) return;
    const timer = window.setTimeout(() => void load(source), 0);
    return () => window.clearTimeout(timer);
  }, [source, lists, load]);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/live-chat-snippets", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { snippets: [] }))
      .then((body: { snippets?: Snippet[] }) => {
        if (alive) setSnippets(body.snippets ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 첫 페인트 뒤에 기억해 둔 머리말·꼬리말 설정을 반영한다(SSR과 첫 화면을 맞추기 위해).
  useEffect(() => {
    const timer = window.setTimeout(() => setFrame(readFrame()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleFrame(part: keyof AnswerFrame) {
    setFrame((prev) => {
      const next = { ...prev, [part]: !prev[part] };
      try {
        window.localStorage.setItem(FRAME_KEY, JSON.stringify(next));
      } catch {
        // 저장이 막힌 브라우저면 이번 창에서만 유지
      }
      return next;
    });
  }

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (current?.posts ?? []).filter((post) => {
      if (statusFilter === "open" && !needsAnswer(post)) return false;
      if (statusFilter === "done" && !post.answered) return false;
      if (!words) return true;
      return [post.title, post.content, post.writer, post.productName, post.orderId, post.category]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(words));
    });
  }, [current, statusFilter, query]);

  const openCount = (current?.posts ?? []).filter(needsAnswer).length;
  const selected = current?.posts.find((post) => post.key === selectedKey) ?? null;
  const draft = selected ? (drafts[selected.key] ?? "") : "";
  const composed = composeAnswer(draft, frame);
  const editingHere = editing && selected && editing.postKey === selected.key ? editing : null;

  function replacePost(post: BoardPost) {
    setLists((prev) => {
      const next = { ...prev };
      for (const [key, list] of Object.entries(prev)) {
        if (list.posts.some((item) => item.key === post.key)) {
          next[key] = { ...list, posts: list.posts.map((item) => (item.key === post.key ? post : item)) };
        }
      }
      return next;
    });
  }

  function choose(post: BoardPost) {
    setSelectedKey(post.key);
    setNotice("");
    setPostError("");
  }

  function setDraft(text: string) {
    if (!selected) return;
    setDrafts((prev) => ({ ...prev, [selected.key]: text }));
  }

  // AI 도우미의 [답변창에 넣기]·[배송 안내 넣기] — 고치는 중인 답변이 있으면 거기에, 아니면 새 답변 본문에 붙인다.
  // 새 답변을 쓸 수 없는(답변이 끝난) 글이면 복사만 해 둔다.
  function insertIntoDraft(text: string) {
    if (!selected) return;
    if (editingHere) {
      setEditing({ ...editingHere, text: appendParagraph(editingHere.text, text) });
      return;
    }
    if (selected.answered) {
      void navigator.clipboard?.writeText(text);
      setNotice("답변이 끝난 글이라 답변창 대신 복사해 뒀어요. 답변의 [고치기]를 눌러 붙여 넣을 수 있어요.");
      return;
    }
    setDraft(appendParagraph(draft, text));
    editorRef.current?.focus();
  }

  async function submit() {
    if (!selected || !confirm || posting) return;
    const isEdit = confirm.kind === "edit";
    const content = isEdit ? (editingHere?.text ?? "").trim() : composed;
    if (!content || (!isEdit && !draft.trim())) return;
    setPosting(true);
    setPostError("");
    try {
      const response = await fetch(answerUrl(selected), {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          date: selected.createdAt.slice(0, 10),
          ...(isEdit ? { answerId: confirm.answerId } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { post?: BoardPost | null; error?: string };
      if (body.post) replacePost(body.post);
      if (!response.ok) {
        setPostError(body.error ?? `${isEdit ? "고치지" : "등록하지"} 못했어요 (${response.status})`);
        if (response.status === 409 && body.post) setConfirm(null);
        return;
      }
      if (isEdit) {
        setEditing(null);
        setNotice("답변을 고쳤어요. 고객에게 바로 보여요.");
      } else {
        if (!body.post) {
          // 등록은 됐는데 최신 글을 못 받았으면 화면에서만 답변 완료로 바꿔 둔다.
          replacePost({
            ...selected,
            answered: true,
            answers: [...selected.answers, { id: "", content, createdAt: "", writer: "방금 등록" }],
          });
        }
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[selected.key];
          return next;
        });
        setNotice("답변을 등록했어요. 고객에게 바로 보여요.");
        window.dispatchEvent(new Event(BOARDS_CHANGED_EVENT));
      }
      setConfirm(null);
    } catch {
      setPostError(`${isEdit ? "고치는" : "등록"} 중 연결이 끊겼어요. 게시판에서 확인한 뒤 새로고침해 주세요.`);
    } finally {
      setPosting(false);
    }
  }

  useEffect(() => {
    if (!confirm) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !posting) setConfirm(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirm, posting]);

  const canAnswer = Boolean(selected && !selected.answered);
  const tooLong = composed.length > BOARD_ANSWER_MAX;
  const editLength = editingHere?.text.trim().length ?? 0;
  const editUnchanged = editingHere ? editingHere.text.trim() === editingHere.original.trim() : true;
  const anyEditable = Boolean(selected?.answers.some((answer) => answer.editable));
  const confirmText = confirm?.kind === "edit" ? (editingHere?.text ?? "").trim() : composed;

  return (
    <div className="bd-admin">
      <aside className="bd-side">
        <div className="bd-folders" role="tablist" aria-label="게시판 폴더">
          {FOLDERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={folder === item.id}
              onClick={() => {
                setFolder(item.id);
                setSelectedKey("");
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {folder === "homepage" ? (
          <div className="bd-boards" role="tablist" aria-label="홈페이지 게시판">
            {HOMEPAGE_BOARDS.map((board) => (
              <button
                key={board.no}
                type="button"
                role="tab"
                aria-selected={boardNo === board.no}
                onClick={() => {
                  setBoardNo(board.no);
                  setSelectedKey("");
                }}
              >
                {board.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="bd-boards" role="tablist" aria-label="스마트스토어 문의">
            {SMARTSTORE_BOARDS.map((board) => (
              <button
                key={board.id}
                type="button"
                role="tab"
                aria-selected={ssKind === board.id}
                onClick={() => {
                  setSsKind(board.id);
                  setSelectedKey("");
                }}
              >
                {board.name}
              </button>
            ))}
          </div>
        )}

        <div className="bd-filters">
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="기간">
            {BOARD_PERIODS.map((period) => (
              <option key={period} value={period}>
                최근 {period}일
              </option>
            ))}
          </select>
          <div className="bd-status" role="tablist" aria-label="답변 상태">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={statusFilter === item.id}
                onClick={() => setStatusFilter(item.id)}
              >
                {item.label}
                {item.id === "open" && current ? <span className="bd-count">{openCount}</span> : null}
              </button>
            ))}
          </div>
          <button type="button" className="bd-refresh" onClick={() => void load(source)} disabled={loading} aria-label="새로고침">
            {loading ? <Loader2 size={15} className="spin-icon" /> : <RefreshCw size={15} />}
          </button>
        </div>

        <label className="bd-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목·내용·작성자 찾기" />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="검색어 지우기">
              <X size={14} />
            </button>
          )}
        </label>

        {loadError && <p className="bd-error">{loadError}</p>}
        {current && (
          <p className="bd-range">
            {current.from} ~ {current.to} · {current.posts.length}건{query || statusFilter !== "all" ? ` 중 ${visible.length}건` : ""}
          </p>
        )}

        <div className="bd-list">
          {!current && loading && (
            <p className="bd-empty">
              <Loader2 size={15} className="spin-icon" /> 불러오는 중…
            </p>
          )}
          {current && visible.length === 0 && <p className="bd-empty">조건에 맞는 글이 없어요.</p>}
          {visible.map((post) => {
            const chip = statusChip(post);
            return (
              <button
                key={post.key}
                type="button"
                className={post.key === selectedKey ? "bd-item is-selected" : "bd-item"}
                onClick={() => choose(post)}
              >
                <div className="bd-item-top">
                  <strong>
                    {post.secret && <Lock size={12} aria-label="비밀글" />}
                    {post.title || "(제목 없음)"}
                  </strong>
                  <span>{post.createdAt.slice(5, 16)}</span>
                </div>
                <p>{post.content || "(내용 없음)"}</p>
                <div className="bd-item-tags">
                  <span className={`bd-chip ${chip.tone}`}>{chip.label}</span>
                  {post.category && <span className="bd-chip is-muted">{post.category}</span>}
                  {post.productName && <span className="bd-chip is-muted bd-product">{post.productName}</span>}
                  {post.writer && <span className="bd-writer">{post.writer}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="bd-detail" aria-live="polite">
        {!selected ? (
          <div className="bd-placeholder">
            <MessageSquareReply size={28} />
            <p>왼쪽 목록에서 글을 고르면 내용과 답변을 볼 수 있어요.</p>
            <p className="bd-placeholder-sub">답이 없는 글은 여기서 답변을 써서 게시판에 바로 등록하고, 등록된 답변도 고칠 수 있어요.</p>
          </div>
        ) : (
          <>
            <header className="bd-detail-head">
              <div>
                <strong>
                  {selected.secret && <Lock size={14} aria-label="비밀글" />}
                  {selected.title || "(제목 없음)"}
                </strong>
                <span>
                  {boardPlaceLabel(selected)} · {selected.createdAt}
                  {selected.writer && ` · ${selected.writer}`}
                  {selected.folder === "homepage" && (selected.memberId ? ` (회원 ${selected.memberId})` : " (비회원)")}
                </span>
                {(selected.productName || selected.orderId) && (
                  <span>
                    {selected.productName}
                    {selected.productOption && ` · ${selected.productOption}`}
                    {selected.orderId && ` · 주문번호 ${selected.orderId}`}
                  </span>
                )}
              </div>
              <span className={`bd-chip ${statusChip(selected).tone}`}>{statusChip(selected).label}</span>
            </header>

            <div className="bd-detail-body">
              <div className="bd-detail-main">
                <div className="bd-card">
                  <h3>{selected.folder === "smartstore" ? "문의 내용" : "글 내용"}</h3>
                  <p>{selected.content || "(내용 없음)"}</p>
                  {(selected.attachments ?? []).length > 0 && (
                    <ul className="bd-files">
                      {selected.attachments?.map((file) => (
                        <li key={file.url}>
                          <a href={file.url} target="_blank" rel="noreferrer">
                            <Paperclip size={13} /> {file.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {selected.answers.map((answer, index) =>
                  editingHere && editingHere.answerId === answer.id ? (
                    <div key={answer.id || index} className="bd-card is-answer is-editing">
                      <h3>답변 고치기 · {answer.writer}</h3>
                      <textarea
                        value={editingHere.text}
                        onChange={(event) => setEditing({ ...editingHere, text: event.target.value })}
                        rows={12}
                        aria-label="고칠 답변"
                      />
                      <div className="bd-editor-foot">
                        <span className={editLength > BOARD_ANSWER_MAX ? "bd-length is-over" : "bd-length"}>
                          {editLength} / {BOARD_ANSWER_MAX}
                        </span>
                        <div className="bd-edit-actions">
                          <button type="button" onClick={() => setEditing(null)}>
                            취소
                          </button>
                          <button
                            type="button"
                            className="bd-submit"
                            disabled={!editLength || editLength > BOARD_ANSWER_MAX || editUnchanged}
                            onClick={() => {
                              setPostError("");
                              setConfirm({ kind: "edit", answerId: answer.id });
                            }}
                          >
                            <Send size={15} /> 고친 내용 저장
                          </button>
                        </div>
                      </div>
                      {postError && !confirm && <p className="bd-error">{postError}</p>}
                    </div>
                  ) : (
                    <div key={answer.id || index} className="bd-card is-answer">
                      <div className="bd-answer-head">
                        <h3>
                          답변 · {answer.writer}
                          {answer.createdAt && ` · ${answer.createdAt}`}
                        </h3>
                        {answer.editable && !editingHere && (
                          <button
                            type="button"
                            className="bd-answer-edit"
                            onClick={() => {
                              setPostError("");
                              setNotice("");
                              setEditing({ postKey: selected.key, answerId: answer.id, original: answer.content, text: answer.content });
                            }}
                          >
                            <Pencil size={12} /> 고치기
                          </button>
                        )}
                      </div>
                      <p>{answer.content}</p>
                    </div>
                  ),
                )}

                {notice && <p className="bd-notice">{notice}</p>}

                {canAnswer ? (
                  <div className="bd-editor">
                    <div className="bd-editor-head">
                      <h3>{needsAnswer(selected) ? "답변 쓰기" : "답글 달기"}</h3>
                      <div className="bd-frame-toggles" role="group" aria-label="머리말·꼬리말 붙이기">
                        <button type="button" aria-pressed={frame.header} onClick={() => toggleFrame("header")}>
                          머리말
                        </button>
                        <button type="button" aria-pressed={frame.footer} onClick={() => toggleFrame("footer")}>
                          꼬리말
                        </button>
                      </div>
                      {snippets.length > 0 && (
                        <select
                          value=""
                          onChange={(event) => {
                            const snippet = snippets.find((item) => item.id === event.target.value);
                            if (snippet) setDraft(appendParagraph(draft, snippet.body));
                          }}
                          aria-label="자주 쓰는 답변 넣기"
                        >
                          <option value="">자주 쓰는 답변 넣기</option>
                          {snippets.map((snippet) => (
                            <option key={snippet.id} value={snippet.id}>
                              {snippet.title}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {frame.header && <p className="bd-frame">{BOARD_ANSWER_HEADER}</p>}
                    <textarea
                      ref={editorRef}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      rows={9}
                      placeholder="답변 본문을 적어 주세요. 켜 둔 머리말·꼬리말은 등록할 때 앞뒤에 붙어요."
                    />
                    {frame.footer && <p className="bd-frame">{BOARD_ANSWER_FOOTER}</p>}
                    <div className="bd-editor-foot">
                      <span className={tooLong ? "bd-length is-over" : "bd-length"}>
                        {composed.length} / {BOARD_ANSWER_MAX}
                      </span>
                      <button
                        type="button"
                        className="bd-submit"
                        disabled={!draft.trim() || tooLong}
                        onClick={() => {
                          setPostError("");
                          setConfirm({ kind: "answer" });
                        }}
                      >
                        <Send size={15} /> 답변 등록
                      </button>
                    </div>
                    {postError && !confirm && !editingHere && <p className="bd-error">{postError}</p>}
                  </div>
                ) : (
                  !editingHere && (
                    <p className="bd-done-note">
                      {anyEditable
                        ? "답변이 끝난 글이에요. 답변의 [고치기]로 여기서 바로 고칠 수 있어요."
                        : `답변이 끝난 글이에요. 서식이 있거나 직원 답글이 아니면 ${selected.folder === "homepage" ? "cafe24 관리자 게시판 관리" : "스마트스토어 판매자센터"}에서 고쳐 주세요.`}
                    </p>
                  )
                )}
              </div>
              <aside className="bd-assist" aria-label="AI 도우미">
                <h3 className="bd-assist-title">
                  <Sparkles size={15} /> AI 도우미
                </h3>
                <AssistPanel
                  key={selected.key}
                  endpoint="/api/admin/boards/assist"
                  extraBody={{ post: selected }}
                  onInsert={insertIntoDraft}
                  intro="[답변 초안 만들기]를 누르면 FAQ와 검증된 응대 사례를 근거로 이 글에 올릴 답변 본문을 만들어요. 주문·배송을 물으면 주문도 찾아봐요."
                  askPlaceholder="AI에게 물어보기 (예: 이 고객 주문 배송 상태 알려줘)"
                />
              </aside>
            </div>
          </>
        )}
      </section>

      {confirm && selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => !posting && setConfirm(null)}>
          <div className="modal-card bd-confirm" onClick={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <div className="modal-title">
                <Send size={18} />
                <h3>{confirm.kind === "edit" ? "답변을 고칠까요?" : "답변을 등록할까요?"}</h3>
              </div>
              <button type="button" className="modal-close" aria-label="닫기" disabled={posting} onClick={() => setConfirm(null)}>
                <X size={18} />
              </button>
            </header>
            <p className="bd-confirm-where">{destinationText(selected, confirm.kind)}</p>
            <p className="bd-confirm-target">원글: {selected.title || "(제목 없음)"}</p>
            <div className="bd-confirm-preview">{confirmText}</div>
            {postError && <p className="bd-error">{postError}</p>}
            <div className="bd-confirm-actions">
              <button type="button" onClick={() => setConfirm(null)} disabled={posting}>
                취소
              </button>
              <button type="button" className="is-primary" onClick={() => void submit()} disabled={posting}>
                {posting ? <Loader2 size={15} className="spin-icon" /> : <Send size={15} />}{" "}
                {confirm.kind === "edit" ? "고치기" : "등록하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
