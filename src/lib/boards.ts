// 게시판 관리 — 홈페이지(cafe24 게시판)와 스마트스토어(고객문의)의 글·답변을 한 모양으로 다룬다.
// 화면(클라이언트)과 서버가 같이 쓰므로 서버 전용 모듈을 들이지 않는다.

export type BoardFolder = "homepage" | "smartstore";

export type BoardAnswer = {
  id: string;
  content: string;
  createdAt: string; // "YYYY-MM-DD HH:mm" (KST)
  writer: string;
  // 여기서 고칠 수 있는 답변인가 — 직원 답글이면서 서식(링크·이미지 등)이 없어 평문으로 고쳐도 잃는 게 없을 때
  editable?: boolean;
};

export type BoardPost = {
  key: string; // homepage:6:123 · smartstore:456(고객문의) · smartstore:qna:789(상품문의) — 화면과 답변 기록이 같은 글을 가리키는 열쇠
  folder: BoardFolder;
  kind?: SmartstoreKind; // 스마트스토어 글의 종류
  boardNo?: number;
  articleNo?: number;
  inquiryNo?: number;
  questionId?: number;
  title: string;
  content: string; // 평문(cafe24 HTML 은 줄바꿈만 살려 벗긴다)
  createdAt: string; // "YYYY-MM-DD HH:mm" (KST)
  writer: string;
  memberId?: string;
  secret?: boolean;
  category?: string;
  productName?: string;
  productOption?: string;
  orderId?: string;
  attachments?: Array<{ name: string; url: string }>;
  answered: boolean;
  answers: BoardAnswer[];
};

// 홈페이지 게시판 — 최근 90일 동안 글이 올라온 곳만(2026-10-27 확인: Q&A·REVIEW, 나머지는 공지·FAQ·미사용).
//   needsAnswer: 답변을 달아야 하는 게시판(미답변으로 센다). 상품 후기는 답글이 없어도 미답변이 아니다.
export const HOMEPAGE_BOARDS = [
  { no: 6, name: "Q&A", needsAnswer: true },
  { no: 4, name: "상품 후기", needsAnswer: false },
] as const;

// 스마트스토어 — 상품문의(상품 페이지 Q&A, 훨씬 많음)와 고객문의(주문 건 1:1 문의)
export const SMARTSTORE_BOARDS = [
  { id: "qna", name: "상품문의" },
  { id: "inquiry", name: "고객문의" },
] as const;
export type SmartstoreKind = (typeof SMARTSTORE_BOARDS)[number]["id"];

export const BOARD_PERIODS = [7, 30, 90] as const;
export const BOARD_ANSWER_MAX = 2000;
// 게시판 관리에서 답을 달면 왼쪽 메뉴 숫자를 바로 다시 세도록 알리는 브라우저 이벤트
export const BOARDS_CHANGED_EVENT = "cs:boards-changed";

// 답변 기본 문구 — CS 가 늘 쓰는 머리말·꼬리말(2026-10-27 CS 지정). 답변창 위아래에 고정으로 보이고 켜고 끌 수 있다.
export const BOARD_ANSWER_HEADER = "안녕하세요, 고객님\n최고를 위한 최상의 휴식 Yogibo 입니다.";
export const BOARD_ANSWER_FOOTER = [
  "Discover the Feel",
  "www.yogibo.kr",
  "",
  "* 간편 FAQ : https://buly.kr/E7B8rPM",
  "",
  "(고객센터 운영시간: 평일 10:00 ~ 17:30)",
  "대표번호: 02-557-0920",
  "카카오 플러스 친구 채널 : @요기보",
].join("\n");
// 답변창에는 본문만 쓰고, 머리말·꼬리말은 켜 둔 것만 등록할 때 앞뒤에 붙인다.
export type AnswerFrame = { header: boolean; footer: boolean };
export function composeAnswer(body: string, frame: AnswerFrame) {
  return [frame.header ? BOARD_ANSWER_HEADER : "", body.trim(), frame.footer ? BOARD_ANSWER_FOOTER : ""]
    .filter(Boolean)
    .join("\n\n");
}

export function homepageBoard(boardNo: number) {
  return HOMEPAGE_BOARDS.find((board) => board.no === boardNo) ?? null;
}

export function boardPlaceLabel(post: Pick<BoardPost, "folder" | "boardNo" | "kind">) {
  if (post.folder === "homepage") return `홈페이지 ${homepageBoard(post.boardNo ?? 0)?.name ?? "게시판"}`;
  return post.kind === "qna" ? "스마트스토어 상품문의" : "스마트스토어 고객문의";
}

// 미답변으로 셀 글인가 — 답을 달아야 하는 게시판·문의에서 아직 답이 없는 것
export function needsAnswer(post: BoardPost) {
  if (post.answered) return false;
  return post.folder === "smartstore" || Boolean(homepageBoard(post.boardNo ?? 0)?.needsAnswer);
}

// ── 상담 지표의 게시판 요약 ──
export type BoardSummary = {
  total: number;
  answered: number;
  open: number; // 답을 달아야 하는데 아직 없는 글
  avgAnswerHours: number | null; // 글 → 첫 답변까지 평균
  oldestOpenHours: number | null; // 미답변 중 가장 오래 기다린 글
};

// "YYYY-MM-DD HH:mm"(KST) → ms
function kstMs(value: string) {
  const time = value.length > 10 ? `${value.slice(0, 16).replace(" ", "T")}:00` : `${value}T00:00:00`;
  return Date.parse(`${time}+09:00`);
}

const roundHours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;

export function summarizePosts(posts: BoardPost[], now = Date.now()): BoardSummary {
  const waits = posts
    .filter((post) => post.answered && post.answers[0]?.createdAt)
    .map((post) => kstMs(post.answers[0].createdAt) - kstMs(post.createdAt))
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const open = posts.filter(needsAnswer);
  const oldest = open.map((post) => now - kstMs(post.createdAt)).filter(Number.isFinite);
  return {
    total: posts.length,
    answered: posts.filter((post) => post.answered).length,
    open: open.length,
    avgAnswerHours: waits.length ? roundHours(waits.reduce((sum, ms) => sum + ms, 0) / waits.length) : null,
    oldestOpenHours: oldest.length ? roundHours(Math.max(...oldest)) : null,
  };
}

// 시간 → "3.5시간" / "2.1일"
export function formatHours(hours: number | null) {
  if (hours === null) return "—";
  return hours >= 48 ? `${Math.round((hours / 24) * 10) / 10}일` : `${hours}시간`;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// cafe24 게시글 HTML → 읽기용 평문(문단·줄바꿈만 살림)
export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 상담원이 쓴 평문 답변 → cafe24 게시글 HTML(줄마다 문단, 빈 줄은 빈 문단 — cafe24 에디터와 같은 모양)
export function textToHtml(text: string) {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      return escaped.trim() ? `<p>${escaped}</p>` : "<p><br></p>";
    })
    .join("");
}
