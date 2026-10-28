import { Cafe24ApiError, cafe24Request } from "@/lib/cafe24/api";
import { type BoardAnswer, type BoardPost, homepageBoard, htmlToText, textToHtml } from "@/lib/boards";
import { kstToday, shiftDay } from "@/lib/liveChatHours";

// 홈페이지(cafe24) 게시판 — 글 목록(답글 포함)과 직원 답글 등록.
// 답글은 원글의 reply_article_no 로 다는 '답글 글'이다(onlineData 미답변 체크도 답글 유무로 센다).

type Cafe24Article = {
  article_no: number;
  parent_article_no?: number | null;
  reply_depth?: number;
  created_date?: string;
  writer?: string;
  member_id?: string;
  title?: string;
  content?: string;
  secret?: string;
  deleted?: string;
  reply_status?: string | null;
  order_id?: string | null;
  product_no?: number | string | null;
  category_no?: number | null;
  board_category_no?: number | null;
  attached_file_detail?: Array<{ name?: string; path?: string }> | null;
};

const PAGE_SIZE = 100; // cafe24 최대
const MAX_PAGES = 10; // 기간 안 글이 많아도 1,000건까지
const YEAR_DAYS = 365; // 한 번에 1년까지만 찾을 수 있다

// 직원 답글 관례 — 관리자 화면에서 단 Q&A 답글(2026-10-27, 60일 30건 모두 같음):
//   작성자 (주)요기코퍼레이션 · 회원 ID yogibo · 제목은 원글 그대로 · 원글이 비밀글이면 비밀글 · PC
//   · 답변 알림 메일(reply_mail Y) · 원글의 상품·분류(product_no·category_no·board_category_no)를 그대로
const REPLY_WRITER = "(주)요기코퍼레이션";
const REPLY_MEMBER_ID = "yogibo";

export class BoardError extends Error {
  status: number;
  post?: BoardPost;
  constructor(message: string, status: number, post?: BoardPost) {
    super(message);
    this.status = status;
    this.post = post;
  }
}

// cafe24 오류를 상담원이 알아듣는 말로 — 권한이 없으면 무엇을 켜야 하는지까지
export function describeCafe24Error(error: unknown, action: "read" | "write") {
  if (error instanceof Cafe24ApiError && error.status === 403) {
    return action === "write"
      ? "cafe24 앱에 게시판 쓰기 권한(mall.write_community)이 없어 답글을 달 수 없어요. cafe24 개발자센터에서 권한을 추가한 뒤 토큰을 다시 받아야 해요."
      : "cafe24 앱에 게시판 읽기 권한(mall.read_community)이 없어요.";
  }
  if (error instanceof Error) return error.message.slice(0, 300);
  return "cafe24 요청에 실패했어요.";
}

const minute = (value?: string | null) => (value ? value.slice(0, 16).replace("T", " ") : "");

async function fetchArticles(boardNo: number, from: string, to: string) {
  const all: Cafe24Article[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { articles = [] } = await cafe24Request<{ articles?: Cafe24Article[] }>(`/api/v2/admin/boards/${boardNo}/articles`, {
      params: { shop_no: 1, start_date: from, end_date: to, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
    });
    all.push(...articles);
    if (articles.length < PAGE_SIZE) break;
  }
  return all.filter((article) => article.deleted !== "T");
}

// 평문으로 다시 저장해도 잃는 게 없는 답글인가 — 문단·줄바꿈 말고 다른 태그(링크·이미지·굵게 등)가 없을 때
function isPlainHtml(html: string) {
  return !/<\/?(?!(?:p|br|div|span)\b)[a-z][a-z0-9]*/i.test(html);
}

function toAnswer(reply: Cafe24Article): BoardAnswer {
  return {
    id: String(reply.article_no),
    content: htmlToText(reply.content ?? ""),
    createdAt: minute(reply.created_date),
    writer: reply.writer ?? "",
    editable: reply.member_id === REPLY_MEMBER_ID && isPlainHtml(reply.content ?? ""),
  };
}

// 글에 붙은 상품의 이름 — 상담원·AI 도우미가 어떤 상품 이야기인지 알게. 못 받으면(권한 등) 이름 없이 둔다.
async function productNames(articles: Cafe24Article[]) {
  // 상품이 없는 글은 product_no 가 "" 로 온다
  const numbers = Array.from(new Set(articles.map((article) => Number(article.product_no)).filter((no) => no > 0)));
  const names = new Map<number, string>();
  for (let i = 0; i < numbers.length; i += PAGE_SIZE) {
    try {
      const { products = [] } = await cafe24Request<{ products?: Array<{ product_no: number; product_name?: string }> }>(
        "/api/v2/admin/products",
        { params: { shop_no: 1, product_no: numbers.slice(i, i + PAGE_SIZE).join(","), limit: PAGE_SIZE } },
      );
      for (const product of products) {
        if (product.product_name) names.set(Number(product.product_no), htmlToText(product.product_name));
      }
    } catch (error) {
      console.warn("[boards] 상품 이름 조회 실패", error);
      break;
    }
  }
  return names;
}

function toPost(boardNo: number, root: Cafe24Article, replies: Cafe24Article[], products = new Map<number, string>()): BoardPost {
  return {
    key: `homepage:${boardNo}:${root.article_no}`,
    folder: "homepage",
    boardNo,
    articleNo: root.article_no,
    title: root.title ?? "",
    content: htmlToText(root.content ?? ""),
    createdAt: minute(root.created_date),
    writer: root.writer ?? "",
    memberId: root.member_id ?? "",
    secret: root.secret === "T",
    productName: products.get(Number(root.product_no)) ?? "",
    orderId: root.order_id ?? "",
    attachments: (root.attached_file_detail ?? [])
      .filter((file) => file.path)
      .map((file) => ({ name: file.name || "첨부 파일", url: file.path ?? "" })),
    // 관리자 화면에서 답을 달면 원글이 C(답변 완료)가 된다 — 답글이 기간 밖에 있어도 C 면 답변된 글
    answered: replies.length > 0 || root.reply_status === "C",
    answers: replies.sort((a, b) => a.article_no - b.article_no).map(toAnswer),
  };
}

// 기간(작성일) 안의 원글과 그 답글. 끝 날짜가 오늘이라 기간 안 원글의 답글은 모두 함께 온다.
//   withProducts: 상품 이름까지(메뉴 숫자처럼 개수만 셀 때는 끈다)
export async function listHomepagePosts(boardNo: number, from: string, to: string, { withProducts = true } = {}) {
  const articles = await fetchArticles(boardNo, from, to);
  const replies = new Map<number, Cafe24Article[]>();
  for (const article of articles) {
    if (!article.reply_depth || !article.parent_article_no) continue;
    replies.set(article.parent_article_no, [...(replies.get(article.parent_article_no) ?? []), article]);
  }
  const roots = articles.filter((article) => !article.reply_depth);
  const products = withProducts ? await productNames(roots) : undefined;
  return roots
    .map((root) => toPost(boardNo, root, replies.get(root.article_no) ?? [], products))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.articleNo ?? 0) - (a.articleNo ?? 0));
}

// 원글 하나와 지금 달린 답글 — 답글을 달기 직전에 다시 확인하는 용도
async function currentPost(boardNo: number, articleNo: number) {
  const today = kstToday();
  const yearAgo = shiftDay(today, -YEAR_DAYS);
  const { articles = [] } = await cafe24Request<{ articles?: Cafe24Article[] }>(`/api/v2/admin/boards/${boardNo}/articles`, {
    params: { shop_no: 1, article_no: articleNo, start_date: yearAgo, end_date: today },
  });
  const root = articles.find((article) => article.article_no === articleNo && article.deleted !== "T" && !article.reply_depth);
  if (!root) return null;
  const written = (root.created_date ?? "").slice(0, 10);
  const from = written && written > yearAgo ? written : yearAgo;
  const replies = (await fetchArticles(boardNo, from, today)).filter(
    (article) => article.parent_article_no === articleNo && article.reply_depth,
  );
  return { root, replies };
}

// 직원 답글 등록 — 이미 답이 달렸으면(다른 상담원·cafe24 관리자) 409 와 최신 글을 돌려준다.
//   beforePost: 답이 없는 걸 확인한 직후·등록 직전에 부른다(같은 글 동시 등록 막는 잠금).
export async function replyToHomepagePost(
  boardNo: number,
  articleNo: number,
  text: string,
  clientIp: string,
  beforePost?: () => Promise<void>,
) {
  const board = homepageBoard(boardNo);
  if (!board) throw new BoardError("관리하지 않는 게시판이에요.", 404);
  const found = await currentPost(boardNo, articleNo);
  if (!found) throw new BoardError("원글을 찾지 못했어요. 삭제됐을 수 있어요.", 404);
  const products = await productNames([found.root]);
  if (found.replies.length > 0 || (board.needsAnswer && found.root.reply_status === "C")) {
    throw new BoardError("이미 답변이 달린 글이에요. 목록을 새로고침해 주세요.", 409, toPost(boardNo, found.root, found.replies, products));
  }
  await beforePost?.();

  const { articles = [] } = await cafe24Request<{ articles?: Cafe24Article[] }>(`/api/v2/admin/boards/${boardNo}/articles`, {
    method: "POST",
    body: {
      shop_no: 1,
      requests: [
        {
          writer: REPLY_WRITER,
          member_id: REPLY_MEMBER_ID,
          title: found.root.title ?? "",
          content: textToHtml(text),
          client_ip: clientIp,
          reply_article_no: articleNo,
          secret: found.root.secret === "T" ? "T" : "F",
          input_channel: "P",
          reply_mail: "Y",
          ...(Number(found.root.product_no) > 0 ? { product_no: Number(found.root.product_no) } : {}),
          ...(Number(found.root.category_no) > 0 ? { category_no: Number(found.root.category_no) } : {}),
          ...(Number(found.root.board_category_no) > 0 ? { board_category_no: Number(found.root.board_category_no) } : {}),
        },
      ],
    },
  });
  const reply = articles[0];
  if (!reply?.article_no) throw new Error("cafe24 가 등록된 답글을 돌려주지 않았어요. 게시판에서 직접 확인해 주세요.");

  // 원글을 '답변 완료'로 — 관리자 화면에서 답을 단 글과 같게. 실패해도 답글은 이미 달렸으니 기록만 남긴다.
  let root = found.root;
  if (board.needsAnswer && root.reply_status !== "C") {
    try {
      await cafe24Request(`/api/v2/admin/boards/${boardNo}/articles/${articleNo}`, {
        method: "PUT",
        body: { shop_no: 1, request: { reply_status: "C" } },
      });
      root = { ...root, reply_status: "C" };
    } catch (error) {
      console.warn(`[boards] 원글 답변 완료 표시 실패 board=${boardNo} article=${articleNo}`, error);
    }
  }
  return { post: toPost(boardNo, root, [...found.replies, reply], products), replyId: String(reply.article_no) };
}

// 등록된 직원 답글 고치기 — 서식이 없는 직원 답글만(평문으로 다시 저장해도 잃는 게 없게).
export async function editHomepageReply(boardNo: number, articleNo: number, replyNo: number, text: string) {
  if (!homepageBoard(boardNo)) throw new BoardError("관리하지 않는 게시판이에요.", 404);
  const found = await currentPost(boardNo, articleNo);
  if (!found) throw new BoardError("원글을 찾지 못했어요. 삭제됐을 수 있어요.", 404);
  const products = await productNames([found.root]);
  const reply = found.replies.find((article) => article.article_no === replyNo);
  if (!reply) {
    throw new BoardError("고칠 답글을 찾지 못했어요. 목록을 새로고침해 주세요.", 404, toPost(boardNo, found.root, found.replies, products));
  }
  if (reply.member_id !== REPLY_MEMBER_ID || !isPlainHtml(reply.content ?? "")) {
    throw new BoardError(
      "서식(링크·이미지 등)이 있거나 직원 답글이 아니라 여기서는 고칠 수 없어요. cafe24 관리자에서 고쳐 주세요.",
      409,
      toPost(boardNo, found.root, found.replies, products),
    );
  }
  const response = await cafe24Request<{ article?: Cafe24Article; articles?: Cafe24Article[] }>(
    `/api/v2/admin/boards/${boardNo}/articles/${replyNo}`,
    { method: "PUT", body: { shop_no: 1, request: { content: textToHtml(text) } } },
  );
  const saved = response.article ?? response.articles?.[0];
  const updated = { ...reply, ...saved, content: saved?.content ?? textToHtml(text) };
  const replies = found.replies.map((article) => (article.article_no === replyNo ? updated : article));
  return { post: toPost(boardNo, found.root, replies, products), replyId: String(replyNo) };
}
