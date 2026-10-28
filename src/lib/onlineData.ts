import type { BoardPost } from "@/lib/boards";
import type { OrderCandidate } from "@/lib/cafe24/service";

// onlineData(cloudtype MCP 서버) — CS 주문 찾기(스마트스토어 동기화 사본 + 매장 택배 업로드 사본)와
// 게시판 관리의 스마트스토어 고객문의(네이버는 허용 IP 에서만 불려 onlineData 를 거친다).
// 미답변 배지(api/cs/unanswered)와 같이 토큰은 서버 env 로만 쓰고 브라우저에 내보내지 않는다.
const ONLINEDATA_BASE_URL = (
  process.env.ONLINEDATA_BASE_URL ?? "https://port-0-yogibo-onmcp-lzgmwhc4d9883c97.sel4.cloudtype.app"
).replace(/\/$/, "");
const ONLINEDATA_MCP_TOKEN = process.env.ONLINEDATA_MCP_TOKEN;
const SEARCH_TIMEOUT_MS = 15_000;

type OnlineDataOrder = {
  채널: string;
  주문번호?: string;
  주문일?: string;
  발송일?: string;
  매장?: string;
  상품?: string[];
  상태?: string;
  배송?: { 택배사?: string; 송장번호?: string } | null;
  주문자?: string;
  연락처끝4?: string;
  기준?: string;
};

export function isOnlineDataConfigured() {
  return Boolean(ONLINEDATA_MCP_TOKEN);
}

function toCandidate(row: OnlineDataOrder): OrderCandidate {
  const carrier = row.배송?.택배사 ?? "";
  const tracking = row.배송?.송장번호 ?? "";
  // 매장 택배 업로드에는 주문일이 없고 발송일만 있다 — 주문일로 보이지 않게 덧붙임에 적는다.
  const note = [row.매장 && `${row.매장} 매장 주문`, row.발송일 && `발송일 ${row.발송일}`].filter(Boolean).join(" · ");
  return {
    channel: row.채널,
    orderId: row.주문번호 ?? "",
    orderDate: row.주문일 ?? "",
    matchedBy: ["buyer"],
    buyerName: row.주문자 ?? "",
    receiverName: "",
    phoneLast4: row.연락처끝4 ?? "",
    // onlineData 는 상품을 "상품명(옵션) x수량" 한 줄로 준다.
    items: (row.상품 ?? []).map((text) => ({ name: text, option: "", quantity: 0 })),
    status: row.상태 ?? "",
    shipment: tracking
      ? {
          orderId: row.주문번호 ?? "",
          status: "",
          carrierName: carrier,
          trackingNumber: tracking,
          trackingUrl: `https://search.naver.com/search.naver?query=${encodeURIComponent(`${carrier} 배송조회 ${tracking}`)}`,
        }
      : null,
    asOf: row.기준 ?? "",
    note,
  };
}

// 주문자 이름 + 주문일 범위(YYYY-MM-DD, 매장 택배는 발송일 범위)
export async function searchOtherChannelOrders(name: string, from: string, to: string) {
  const params = new URLSearchParams({ name, start: from, end: to });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${ONLINEDATA_BASE_URL}/api/cs/orders?${params}`, {
      headers: { Authorization: `Bearer ${ONLINEDATA_MCP_TOKEN}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`onlineData 주문 찾기 ${response.status}`);
    const body = (await response.json()) as { 결과?: OnlineDataOrder[] };
    return (body.결과 ?? []).map(toCandidate);
  } finally {
    clearTimeout(timeout);
  }
}

// ── 게시판 관리: 스마트스토어 고객문의 목록·답변 등록 ──────────────────────────────
const INQUIRY_TIMEOUT_MS = 25_000; // 네이버를 그때그때 부르므로 넉넉히

type OnlineDataInquiry = {
  inquiryNo: number;
  category?: string;
  title?: string;
  content?: string;
  createdAt?: string;
  customer?: string;
  productName?: string;
  productOption?: string;
  orderId?: string;
  answered?: boolean;
  answer?: { id?: number | null; content?: string; createdAt?: string } | null;
};

export class OnlineDataError extends Error {
  status: number;
  post?: BoardPost;
  constructor(message: string, status: number, post?: BoardPost) {
    super(message);
    this.status = status;
    this.post = post;
  }
}

function toBoardPost(item: OnlineDataInquiry): BoardPost {
  return {
    key: `smartstore:${item.inquiryNo}`,
    folder: "smartstore",
    inquiryNo: item.inquiryNo,
    title: item.title ?? "",
    content: item.content ?? "",
    createdAt: item.createdAt ?? "",
    writer: item.customer ?? "",
    category: item.category ?? "",
    productName: item.productName ?? "",
    productOption: item.productOption ?? "",
    orderId: item.orderId ?? "",
    answered: Boolean(item.answered),
    // 스마트스토어 답변은 평문이라 답변 번호만 있으면 여기서 고칠 수 있다.
    answers: item.answer
      ? [
          {
            id: String(item.answer.id ?? ""),
            content: item.answer.content ?? "",
            createdAt: item.answer.createdAt ?? "",
            writer: "판매자 답변",
            editable: Boolean(item.answer.id),
          },
        ]
      : [],
  };
}

function inquiryErrorMessage(status: number, error?: string) {
  if (status === 401) return "onlineData 토큰(ONLINEDATA_MCP_TOKEN)이 맞지 않아요.";
  if (status === 403) return "onlineData 토큰에 답변 등록(answer) 권한이 없어요. onlineData 의 MCP_TOKENS 에서 이 앱 토큰 권한을 answer 로 바꿔 주세요.";
  return error ? `스마트스토어 요청 실패: ${error}` : `onlineData 요청 실패 (${status})`;
}

async function inquiryRequest(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INQUIRY_TIMEOUT_MS);
  try {
    const response = await fetch(`${ONLINEDATA_BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${ONLINEDATA_MCP_TOKEN}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      items?: unknown[];
      inquiry?: OnlineDataInquiry | null;
      qna?: OnlineDataQna | null;
    };
    return { status: response.status, body };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new OnlineDataError(aborted ? "onlineData 응답이 늦어요. 잠시 후 다시 시도해 주세요." : "onlineData 에 연결하지 못했어요.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

// 네이버는 답변을 등록·수정한 직후 다시 읽으면 답변 내용이 비어 오거나 예전 내용이 온다(몇 초 뒤 채워짐).
// 요청이 성공했으면 방금 보낸 내용으로 맞춰 화면이 빈 칸·옛 답을 보이지 않게 한다.
function withSentAnswer(post: BoardPost | undefined, content: string, answerId = "") {
  if (!post) return post;
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
  const last = post.answers.at(-1);
  const answer = {
    id: last?.id || answerId,
    content,
    createdAt: last?.createdAt || now,
    writer: last?.writer || "판매자 답변",
    editable: Boolean(last?.id || answerId),
  };
  return { ...post, answered: true, answers: [...post.answers.slice(0, -1), answer] };
}

export async function listSmartstoreInquiries(from: string, to: string) {
  const { status, body } = await inquiryRequest(`/api/cs/smartstore/inquiries?${new URLSearchParams({ start: from, end: to })}`);
  if (status === 404) throw new OnlineDataError("onlineData 에 게시판 관리 기능이 아직 배포되지 않았어요.", 502);
  if (status !== 200) throw new OnlineDataError(inquiryErrorMessage(status, body.error), 502);
  return ((body.items ?? []) as OnlineDataInquiry[]).map(toBoardPost);
}

// 답변 등록 — date 는 문의한 날(YYYY-MM-DD). onlineData 가 그날 목록에서 다시 찾아 이미 답변됐으면 409.
export async function answerSmartstoreInquiry(inquiryNo: number, content: string, date: string) {
  const { status, body } = await inquiryRequest(`/api/cs/smartstore/inquiries/${inquiryNo}/answer`, {
    method: "POST",
    body: JSON.stringify({ answer: content, date }),
  });
  const post = body.inquiry ? toBoardPost(body.inquiry) : undefined;
  if (status === 200) return { post: withSentAnswer(post, content), replyId: String(body.inquiry?.answer?.id ?? "") };
  if (status === 409) throw new OnlineDataError("이미 답변된 문의예요. 목록을 새로고침해 주세요.", 409, post);
  if (status === 404) throw new OnlineDataError(body.error ? `${body.error}.` : "onlineData 에 게시판 관리 기능이 아직 배포되지 않았어요.", 404);
  throw new OnlineDataError(inquiryErrorMessage(status, body.error), 502);
}

// 등록된 답변 고치기 — answerId 는 답변 번호(answerContentId). 그사이 답변이 바뀌었으면 409.
export async function editSmartstoreAnswer(inquiryNo: number, answerId: number, content: string, date: string) {
  const { status, body } = await inquiryRequest(`/api/cs/smartstore/inquiries/${inquiryNo}/answer/${answerId}`, {
    method: "PUT",
    body: JSON.stringify({ answer: content, date }),
  });
  const post = body.inquiry ? toBoardPost(body.inquiry) : undefined;
  if (status === 200) return { post: withSentAnswer(post, content, String(answerId)), replyId: String(answerId) };
  if (status === 409) throw new OnlineDataError("그사이 답변이 바뀌었어요. 목록을 새로고침해 주세요.", 409, post);
  if (status === 404) throw new OnlineDataError(body.error ? `${body.error}.` : "onlineData 에 답변 고치기 기능이 아직 배포되지 않았어요.", 404);
  throw new OnlineDataError(inquiryErrorMessage(status, body.error), 502);
}

// ── 게시판 관리: 스마트스토어 상품문의(상품 페이지 Q&A) ──────────────────────────────
type OnlineDataQna = {
  questionId: number;
  content?: string;
  createdAt?: string;
  customer?: string;
  productName?: string;
  answered?: boolean;
  answer?: { content?: string; createdAt?: string } | null;
};

function toQnaPost(item: OnlineDataQna): BoardPost {
  const content = item.content ?? "";
  return {
    key: `smartstore:qna:${item.questionId}`,
    folder: "smartstore",
    kind: "qna",
    questionId: item.questionId,
    // 상품문의는 제목이 없어 질문 첫 줄을 제목처럼 보여 준다
    title: content.split(/\r?\n/)[0].slice(0, 40),
    content,
    createdAt: item.createdAt ?? "",
    writer: item.customer ?? "",
    productName: item.productName ?? "",
    answered: Boolean(item.answered),
    // 답변 등록과 고치기가 같은 API(질문 번호로)라 답변은 늘 고칠 수 있다
    answers: item.answer
      ? [{ id: String(item.questionId), content: item.answer.content ?? "", createdAt: item.answer.createdAt ?? "", writer: "판매자 답변", editable: true }]
      : [],
  };
}

export async function listSmartstoreQnas(from: string, to: string) {
  const { status, body } = await inquiryRequest(`/api/cs/smartstore/qnas?${new URLSearchParams({ start: from, end: to })}`);
  if (status === 404) throw new OnlineDataError("onlineData 에 상품문의 기능이 아직 배포되지 않았어요.", 502);
  if (status !== 200) throw new OnlineDataError(inquiryErrorMessage(status, body.error), 502);
  return ((body.items ?? []) as OnlineDataQna[]).map(toQnaPost);
}

// 상품문의 답변 등록(answer — 아직 답이 없을 때) · 고치기(edit — 답이 있을 때). date 는 문의한 날(YYYY-MM-DD).
export async function saveSmartstoreQna(questionId: number, content: string, date: string, mode: "answer" | "edit") {
  const { status, body } = await inquiryRequest(`/api/cs/smartstore/qnas/${questionId}/answer`, {
    method: mode === "answer" ? "POST" : "PUT",
    body: JSON.stringify({ answer: content, date }),
  });
  const post = body.qna ? toQnaPost(body.qna) : undefined;
  if (status === 200) return { post: withSentAnswer(post, content, String(questionId)), replyId: String(questionId) };
  if (status === 409) {
    throw new OnlineDataError(mode === "answer" ? "이미 답변된 문의예요. 목록을 새로고침해 주세요." : "아직 답변이 없는 문의예요. 목록을 새로고침해 주세요.", 409, post);
  }
  if (status === 404) throw new OnlineDataError(body.error ? `${body.error}.` : "onlineData 에 상품문의 기능이 아직 배포되지 않았어요.", 404);
  throw new OnlineDataError(inquiryErrorMessage(status, body.error), 502);
}
