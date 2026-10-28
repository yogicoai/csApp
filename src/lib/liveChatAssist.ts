import { type BoardPost, boardPlaceLabel } from "@/lib/boards";
import { isCafe24Configured } from "@/lib/cafe24/api";
import {
  getMemberOrderCandidates,
  getOrderCandidate,
  searchOrdersByName,
  type OrderCandidate,
  type OrderMatch,
} from "@/lib/cafe24/service";
import type { LiveChatRecord } from "@/lib/liveChat";
import { dayLabel, kstToday, shiftDay } from "@/lib/liveChatHours";
import { isOnlineDataConfigured, searchOtherChannelOrders } from "@/lib/onlineData";
import { appLabel, purchasePlaceLabel, TALK_VIA, viaLabel } from "@/lib/liveChatOptions";
import { maskPersonalInfo } from "@/lib/pii";
import { getLiveClaims, type ClaimItem } from "@/lib/repositories/claimRepository";
import { getPublishedFaqs } from "@/lib/repositories/faqRepository";
import type { FaqItem } from "@/lib/sample-data";

// 실시간 채팅상담 '상담 도움' AI — 상담원 전용.
// 대화 내용 + 사전 질문 + 근거(FAQ, CS가 확정한 라이브 클레임)를 Claude 에 넘겨
// ① 고객에게 보낼 답변 초안 ② 상담원 질문에 대한 답 을 만든다. 고객에게 자동 발송하지 않는다.
// 호출 방식은 고객용 AI(api/ai-query)와 같은 Messages API 직접 호출이다(설치된 SDK 0.40 에는 effort·fallbacks 필드가 없음).
// 모델은 답변 품질을 위해 Sonnet 을 쓰고(고객용 AI 는 가벼운 모델 그대로), ANTHROPIC_ASSIST_MODEL 로 바꿀 수 있다.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ASSIST_MODEL = process.env.ANTHROPIC_ASSIST_MODEL ?? "claude-sonnet-5-5";
// Sonnet 5.5 는 사고(thinking)가 기본으로 켜져 있고 사고 토큰도 max_tokens 에 포함된다.
// 답이 잘리지 않게 넉넉히 두고, 깊이·속도는 effort 로 조절한다(초안은 빠르게, 상담원 질문은 조금 더 깊게).
const ASSIST_MAX_TOKENS = 8000;
const ASSIST_EFFORT: Record<AssistMode, "low" | "medium"> = { draft: "low", ask: "medium" };
const ASSIST_TIMEOUT_MS = 60_000;
const TRANSCRIPT_LIMIT = 20;
// 주문 조회 도구를 연달아 부를 수 있는 횟수 — 넘으면 도구 없이 답만 받는다.
const MAX_TOOL_ROUNDS = 3;

export type AssistMode = "draft" | "ask";

type TranscriptMessage = { sender: "visitor" | "agent" | "system"; text: string };

export type AssistSource = { type: "faq" | "claim"; id: string; title: string; category: string };

// 근거에 없는 정책을 지어내지 않도록 구매처·연락 채널 같은 '그럴듯한 추측'을 명시적으로 막는다.
const DRAFT_INSTRUCTIONS = `당신은 Yogibo 고객센터 상담원을 돕는 상담 도우미입니다. 상담원이 지금 고객에게 보낼 답변 초안을 작성합니다.
- 제공된 FAQ와 검증된 CS 응대 사례에 적힌 내용만 근거로 쓰세요. 근거에 없는 정책·절차·금액·일정·기간·연락 채널은 지어내지 마세요.
- 구매처(스마트스토어 등)에 따라 절차가 다르다는 말은 근거에 그렇게 적혀 있을 때만 쓰세요. 근거에 없으면 구매처를 이유로 다른 곳에 문의하라고 안내하지 마세요.
- 상담 정보에 '응대 기준'이 있으면 그 기준의 고객으로 보고 답하세요(예: 네이버 톡톡 상담은 스마트스토어 고객). 이때도 정책·절차는 근거에 있는 것만 씁니다.
- 정보가 부족하면 단정하지 말고 필요한 정보(주문번호, 제품명, 증상 등)를 정중히 요청하거나 확인 후 안내드리겠다고 하세요.
- "연락드리겠다", "접수해 드리겠다" 같은 약속은 근거나 대화에 그런 절차가 있을 때만 쓰세요.
- [주문번호]·[전화번호]처럼 대괄호로 가려진 값은 개인정보 보호로 가린 것일 뿐 고객은 실제 값을 적었습니다. 그 값을 다시 요청하거나 "적혀 있지 않다"고 말하지 마세요.
- URL은 근거에 있는 원문 그대로만 쓰세요.
- 고객에게 그대로 보낼 문장이므로 "FAQ 1", "사례 2" 같은 내부 근거 표시는 넣지 마세요.
- 마크다운 기호(**, #, 목록 기호) 없이 평문으로, 존댓말 2~5문장. 인사말을 반복하지 말고 바로 본론으로. 답변 본문만 출력하세요.`;

// 게시판(홈페이지 Q&A·상품 후기, 스마트스토어 고객문의) 답변 초안 — 근거 규칙은 채팅과 같고, 게시판 글 형식만 다르다.
const BOARD_DRAFT_INSTRUCTIONS = `당신은 Yogibo 고객센터 상담원을 돕는 상담 도우미입니다. 고객이 게시판(홈페이지 Q&A·상품 후기, 스마트스토어 고객문의)에 남긴 글에 상담원이 올릴 답변 초안을 작성합니다.
- 제공된 FAQ와 검증된 CS 응대 사례에 적힌 내용만 근거로 쓰세요. 근거에 없는 정책·절차·금액·일정·기간·연락 채널은 지어내지 마세요.
- 구매처(스마트스토어 등)에 따라 절차가 다르다는 말은 근거에 그렇게 적혀 있을 때만 쓰세요.
- 정보가 부족하면 단정하지 말고 필요한 정보(주문번호, 제품명, 증상, 사진 등)를 정중히 요청하세요.
- "연락드리겠다", "접수해 드리겠다" 같은 약속은 근거에 그런 절차가 있을 때만 쓰세요.
- [주문번호]·[전화번호]처럼 대괄호로 가려진 값은 개인정보 보호로 가린 것일 뿐 고객은 실제 값을 적었습니다. 그 값을 다시 요청하거나 "적혀 있지 않다"고 말하지 마세요.
- URL은 근거에 있는 원문 그대로만 쓰세요.
- 머리말(인사·회사 소개)과 꼬리말(운영시간·대표번호·FAQ 링크·카카오 채널)은 등록할 때 자동으로 앞뒤에 붙습니다. 인사말·맺음말·연락처 없이 본문만 쓰세요. 상품 후기에는 감사의 뜻을 중심으로, 불편을 적었으면 근거 범위에서 안내하세요.
- 고객에게 그대로 보일 문장이므로 "FAQ 1", "사례 2" 같은 내부 근거 표시는 넣지 마세요.
- 마크다운 기호(**, #, 목록 기호) 없이 평문으로, 존댓말 3~7문장. 답변 본문만 출력하세요.`;

const ASK_INSTRUCTIONS = `당신은 Yogibo 고객센터 상담원을 돕는 상담 도우미입니다. 상담원의 질문에 근거(FAQ, 검증된 CS 응대 사례, 주문 조회 결과)와 지금 상담 내용(채팅 대화 또는 게시판 글)을 바탕으로 짧고 정확하게 답하세요.
- [주문번호]·[전화번호]처럼 대괄호로 가려진 값은 개인정보 보호로 가린 것일 뿐 고객은 실제 값을 적었습니다. 그 값을 다시 요청하거나 "적혀 있지 않다"고 말하지 마세요.
- 상담 정보에 '응대 기준'이 있으면 그 기준의 고객으로 보고 답하세요(예: 네이버 톡톡 상담은 스마트스토어 고객).
- 근거 번호(예: FAQ 2, 사례 1, 주문 A)를 함께 밝히세요. 근거에 없는 정책·절차·연락 채널은 "근거 없음"이라고 분명히 말하고 추측하지 마세요.
- 주문·배송 상태를 확인해야 하면 주문 조회 도구를 쓰세요. 이 상담(글)에 주문번호나 로그인 회원 정보가 있으면 find_orders_from_chat, 고객이 이름과 주문한 날만 알려 줬으면 find_orders_by_name을 쓰세요. "25일"처럼 날짜만 있으면 오늘을 기준으로 가장 최근의 그날로 보세요. 네이버 톡톡(스마트스토어 기준) 상담은 스마트스토어 주문번호로는 찾을 수 없으니 이름·주문일로 find_orders_by_name을 쓰세요 — 이 조회 제약은 상담원에게만 말하고 고객 안내 문구에는 쓰지 마세요.
- 주문 조회 결과에 있는 사실만 말하세요. 주문이 여러 건이면 단정하지 말고 후보를 짧게 정리한 뒤, 고객에게 휴대폰 번호 끝 4자리로 본인 확인을 요청하는 문구를 제안하세요. 한 건도 없으면 이름·주문일을 다시 확인하거나 주문번호를 요청하고, 조회 결과에 '찾지 못했어요'로 적힌 채널(외부몰 등)에서 산 주문일 수 있다고 상담원에게 알려 주세요.
- 스마트스토어·매장 택배 결과는 실시간이 아닌 사본이라 상담원에게 '○시 기준'을 함께 말하고, 그 뒤 바뀐 상태는 스마트스토어면 판매자센터, 매장 택배면 택배사 송장 조회로 확인하라고 알려 주세요. 기준 시각은 고객 안내 문구에 넣지 마세요.
- 마크다운 기호(**, #, 목록 기호) 없이 평문으로 5문장 이내로 답하세요.
- 고객에게 보낼 문구가 도움이 되면 마지막 줄에 "고객 안내 문구:" 다음에 근거에 있는 내용만으로 존댓말 문구를 한 단락으로 제안하세요. 이 문구에는 "FAQ 1", "주문 A" 같은 내부 근거 표시를 넣지 마세요.`;

// 주문 조회 도구 — 상담원 질문(ask)에서만 준다. 결과의 주문번호·이름·연락처는 모델에 넘기지 않고 '주문 A'처럼 부른다.
const ORDER_TOOLS = [
  {
    name: "find_orders_by_name",
    description:
      "주문자 이름과 주문일로 주문을 찾아 채널·주문 상태·상품·택배사·송장번호를 돌려준다. 자사몰(cafe24, 실시간 · 받는 분 이름도 찾음)과 스마트스토어·매장 택배(동기화 사본, 기준 시각 함께 표시)를 한 번에 찾는다. 고객이 주문번호 없이 이름과 주문한 날을 알려 줬을 때 쓴다. 매장 택배는 주문일이 아니라 발송일로 찾으므로, 매장에서 산 주문이면 주문일부터 2주 뒤까지 넓혀 찾는다.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "주문자 또는 받는 분 이름 (예: 정은경)" },
        date_from: {
          type: "string",
          description: "주문일 범위 시작 YYYY-MM-DD. 하루만 말했으면 date_to 와 같은 날로 둔다. 날짜를 모르면 비워 두면 최근 30일을 찾는다.",
        },
        date_to: { type: "string", description: "주문일 범위 끝 YYYY-MM-DD" },
      },
      required: ["name"],
    },
  },
  {
    name: "find_orders_from_chat",
    description:
      "이 상담(게시판 글)에서 확인되는 자사몰 주문을 찾는다. 고객이 사전 질문·대화·글에 적은 주문번호와 상담원 질문에 적힌 주문번호(내용에는 [주문번호]로 가려져 보인다), 로그인 회원(글쓴 회원)의 최근 14일 주문을 조회해 주문 상태·상품·택배사·송장번호를 돌려준다.",
    input_schema: { type: "object", properties: {} },
  },
];


// 한국어는 조사가 붙어 그대로 비교하면 놓치므로, 3글자 이상 단어는 끝 글자를 뗀 형태도 함께 찾는다.
function tokenize(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2);
  const tokens = new Set<string>();
  for (const word of words) {
    tokens.add(word);
    if (word.length >= 3) tokens.add(word.slice(0, -1));
  }
  return Array.from(tokens);
}

function scoreText(tokens: string[], parts: Array<[string, number]>) {
  let score = 0;
  for (const token of tokens) {
    for (const [text, weight] of parts) {
      if (text.includes(token)) score += weight;
    }
  }
  return score;
}

function rankFaqs(tokens: string[], faqs: FaqItem[], inquiryType: string, entryFaqId: string, limit: number) {
  return faqs
    .map((faq) => {
      let score = scoreText(tokens, [
        [faq.question.toLowerCase(), 3],
        [faq.keywords.join(" ").toLowerCase(), 2],
        [faq.answer.toLowerCase(), 1],
      ]);
      if (inquiryType && faq.category === inquiryType) score += 2;
      if (faq.id === entryFaqId) score += 100;
      return { faq, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.faq);
}

function rankClaims(tokens: string[], claims: ClaimItem[], limit: number) {
  return claims
    .map((claim) => ({
      claim,
      score: scoreText(tokens, [
        [claim.situation.toLowerCase(), 3],
        [claim.keywords.join(" ").toLowerCase(), 2],
        [claim.answer.toLowerCase(), 1],
      ]),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.claim);
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// 네이버 톡톡 상담의 응대 기준 — 지금 연결한 톡톡 계정은 스마트스토어 Yogibo 하나라 스마트스토어 고객으로 본다.
// (네이버페이·자사몰 쪽 톡톡 계정을 더 붙이면 계정별로 기준을 나눈다.)
const TALK_BASIS =
  "응대 기준: 네이버 스마트스토어 — 스마트스토어 Yogibo 톡톡으로 들어온 상담이다. 고객이 다른 구매처를 말하지 않으면 스마트스토어 구매 고객으로 보고, 주문·배송·교환·반품·환불은 스마트스토어(네이버페이 주문) 기준으로 안내한다. 자사몰(요기보 공식몰) 전용 혜택·적립금·쿠폰·회원 정보·자사몰 주문 조회 경로는 안내하지 않는다.";

function isTalkChat(chat: LiveChatRecord) {
  return chat.source?.via === TALK_VIA;
}

function describeChat(chat: LiveChatRecord) {
  const today = kstToday();
  const talk = isTalkChat(chat);
  const lines = [
    `오늘: ${dayLabel(today)} (${today})`,
    `유입 경로: ${chat.source?.via ? viaLabel(chat.source.via) : "알 수 없음"}${chat.source?.app ? ` (${appLabel(chat.source.app)})` : ""}`,
    `구매처: ${chat.intake?.purchasePlace ? purchasePlaceLabel(chat.intake.purchasePlace) : talk ? "네이버 스마트스토어(톡톡 상담 기본값)" : "미입력"}`,
    ...(talk ? [TALK_BASIS] : []),
    `문의 유형: ${chat.intake?.inquiryType || "미입력"}`,
    `주문번호: ${chat.intake?.orderNumber ? "고객이 입력함" : "없음"}`,
  ];
  if (chat.entry?.faqQuestion) lines.push(`고객이 보던 FAQ: ${chat.entry.faqQuestion}`);
  if (chat.entry?.aiQuery) lines.push(`고객이 AI에게 한 질문: ${chat.entry.aiQuery}`);
  if (chat.talk?.productName) lines.push(`톡톡 문의를 시작한 상품 페이지: ${chat.talk.productName}`);
  if (chat.offHours) lines.push("운영시간 외에 접수된 상담");
  return lines.join("\n");
}

// 고객이 쓴 말과 가까운 FAQ·검증된 응대 사례 — 채팅과 게시판이 같이 쓴다.
async function findGrounds(text: string, inquiryType = "", entryFaqId = "") {
  const tokens = tokenize(text);
  const [faqs, claims] = await Promise.all([getPublishedFaqs(), getLiveClaims()]);
  const topFaqs = rankFaqs(tokens, faqs, inquiryType, entryFaqId, 4);
  const topClaims = rankClaims(tokens, claims, 3);

  const faqText = topFaqs.length
    ? topFaqs.map((faq, i) => `[FAQ ${i + 1}] (${faq.category}) ${faq.question}\n${clip(faq.answer, 700)}`).join("\n\n")
    : "(관련 FAQ 없음)";
  const claimText = topClaims.length
    ? topClaims.map((claim, i) => `[사례 ${i + 1}] 상황: ${claim.situation}\n응대: ${clip(claim.answer, 500)}`).join("\n\n")
    : "(관련 사례 없음)";
  const sources: AssistSource[] = [
    ...topFaqs.map((faq) => ({ type: "faq" as const, id: faq.id, title: faq.question, category: faq.category })),
    ...topClaims.map((claim) => ({ type: "claim" as const, id: claim.id, title: claim.situation, category: claim.category })),
  ];
  return { faqText, claimText, sources };
}

export async function buildAssistContext(chat: LiveChatRecord, messages: TranscriptMessage[], question = "") {
  const transcript = messages.filter((message) => message.sender !== "system").slice(-TRANSCRIPT_LIMIT);
  const visitorText = transcript
    .filter((message) => message.sender === "visitor")
    .slice(-6)
    .map((message) => message.text)
    .join(" ");
  const { faqText, claimText, sources } = await findGrounds(
    // 톡톡 상담은 스마트스토어 기준이라 스마트스토어를 다룬 FAQ·사례가 먼저 걸리게 한다.
    [visitorText, question, chat.intake?.inquiryType ?? "", chat.entry?.faqQuestion ?? "", chat.talk?.productName ?? "", isTalkChat(chat) ? "스마트스토어" : ""].join(" "),
    chat.intake?.inquiryType ?? "",
    chat.entry?.faqId ?? "",
  );

  const transcriptText = transcript.length
    ? transcript
        .map((message) => `${message.sender === "visitor" ? "고객" : "상담원"}: ${maskPersonalInfo(message.text)}`)
        .join("\n")
    : "(아직 대화 없음)";

  const context = `[상담 정보]
${describeChat(chat)}

[대화 내용]
${transcriptText}

[근거 FAQ]
${faqText}

[검증된 CS 응대 사례]
${claimText}`;

  return { context, sources };
}

// 게시판 관리의 글 하나 — 글과 이미 달린 답변(개인정보는 가림), 근거 FAQ·사례
export async function buildBoardAssistContext(post: BoardPost, question = "") {
  const today = kstToday();
  const { faqText, claimText, sources } = await findGrounds(
    [post.title, post.content, post.category ?? "", post.productName ?? "", question].join(" "),
  );
  const writer = post.folder === "smartstore" ? "스마트스토어 구매 고객" : post.memberId ? "회원" : "비회원";
  const lines = [
    `오늘: ${dayLabel(today)} (${today})`,
    `게시판: ${boardPlaceLabel(post)}${post.secret ? " · 비밀글" : ""}`,
    `작성: ${post.createdAt || "알 수 없음"} · ${writer}`,
  ];
  if (post.category) lines.push(`문의 분류: ${post.category}`);
  if (post.productName) lines.push(`상품: ${post.productName}${post.productOption ? ` (${post.productOption})` : ""}`);
  lines.push(`주문번호: ${post.orderId ? "있음" : "없음"}`);
  const answers = post.answers.length
    ? post.answers.map((answer) => `${answer.writer || "답변"}: ${maskPersonalInfo(clip(answer.content, 600))}`).join("\n")
    : "(아직 없음)";

  const context = `[게시판 글 정보]
${lines.join("\n")}

[고객 글]
제목: ${maskPersonalInfo(post.title)}
${maskPersonalInfo(clip(post.content, 2000))}

[이미 달린 답변]
${answers}

[근거 FAQ]
${faqText}

[검증된 CS 응대 사례]
${claimText}`;

  return { context, sources };
}

export function isAssistConfigured() {
  return Boolean(ANTHROPIC_API_KEY);
}

// 실패를 상담원이 알아듣는 말로 — 늦음·거절·그 밖
export function assistFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("abort")) return "AI 응답이 늦어지고 있어요. 다시 시도해 주세요.";
  if (message.includes("refusal")) return "AI가 이 요청에는 답하지 않았어요. 질문을 바꿔 다시 시도해 주세요.";
  return "AI 상담 도우미 호출에 실패했습니다.";
}

type ContentBlock = { type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
type AssistTurn = { role: "user" | "assistant"; content: unknown };
type ToolResult = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export type AssistOrder = OrderCandidate & { label: string };
// 주문 찾기 단서 — 고객이 쓴 글(사전 질문·대화·게시판 글)과 상담원 질문, 로그인 회원 ID
export type OrderContext = { texts: string[]; memberId?: string };
// 채팅이냐 게시판이냐에 따라 초안 형식(지시문·요청 문구)이 다르다.
export type AssistTarget = "chat" | "board";

export function chatOrderContext(chat: LiveChatRecord, messages: TranscriptMessage[], question: string): OrderContext {
  const visitorTexts = messages.filter((message) => message.sender === "visitor").map((message) => message.text);
  return { texts: [chat.intake?.orderNumber ?? "", question, ...visitorTexts], memberId: chat.memberId || undefined };
}

export function boardOrderContext(post: BoardPost, question: string): OrderContext {
  // 스마트스토어 주문번호(16자리)는 자사몰 형식이 아니라 주문번호 찾기에 걸리지 않는다.
  return {
    texts: [post.orderId ?? "", post.title, post.content, question],
    memberId: post.folder === "homepage" ? post.memberId || undefined : undefined,
  };
}

const SYSTEM_PROMPT: Record<AssistTarget, Record<AssistMode, string>> = {
  chat: { draft: DRAFT_INSTRUCTIONS, ask: ASK_INSTRUCTIONS },
  board: { draft: BOARD_DRAFT_INSTRUCTIONS, ask: ASK_INSTRUCTIONS },
};
const DRAFT_TASK: Record<AssistTarget, string> = {
  chat: "위 대화의 마지막 고객 메시지에 대해, 상담원이 보낼 답변 초안을 작성하세요.",
  board: "위 게시판 글에 대해, 상담원이 게시판에 올릴 답변 초안을 작성하세요.",
};

async function requestClaude(
  mode: AssistMode,
  target: AssistTarget,
  messages: AssistTurn[],
  toolChoice?: "auto" | "none",
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASSIST_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        // 안전 분류기가 거절하면 서버가 권장 대체 모델로 다시 실행한다(fallbacks: "default").
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ASSIST_MODEL,
        max_tokens: ASSIST_MAX_TOKENS,
        output_config: { effort: ASSIST_EFFORT[mode] },
        fallbacks: "default",
        system: SYSTEM_PROMPT[target][mode],
        messages,
        ...(toolChoice ? { tools: ORDER_TOOLS, tool_choice: { type: toolChoice } } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`assist ${response.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await response.json()) as { stop_reason?: string; content?: ContentBlock[] };
    // 대체 모델까지 거절하면 HTTP 200 + stop_reason "refusal" 로 온다 — 본문을 읽기 전에 확인한다.
    if (data.stop_reason === "refusal") throw new Error("assist refusal");
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// 사고(thinking)·대체 전환(fallback)·도구 호출 블록은 건너뛰고 답변 텍스트만 모은다.
function answerText(content: ContentBlock[]) {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

// 도구 결과와 함께 다시 보낼 때 assistant 내용은 사고 블록까지 그대로 돌려준다.
// 대체 모델로 넘어간 응답이면 마지막 fallback 표시 앞은 거절된 시도라 빼고 보낸다.
function echoContent(content: ContentBlock[]) {
  const boundary = content.map((block) => block.type).lastIndexOf("fallback");
  return content.slice(boundary + 1);
}

export async function runAssist(
  mode: AssistMode,
  context: string,
  question = "",
  orderContext?: OrderContext,
  target: AssistTarget = "chat",
) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const task = mode === "draft" ? DRAFT_TASK[target] : `[상담원 질문]\n${maskPersonalInfo(question)}`;
  const messages: AssistTurn[] = [{ role: "user", content: `${context}\n\n${task}` }];
  const orders: AssistOrder[] = [];
  // 주문 조회는 상담원 질문에만 쓴다 — 초안은 고객에게 바로 나갈 문구라 본인 확인 전에 주문 정보를 넣지 않는다.
  const lookup = mode === "ask" ? orderContext : undefined;

  let answer = "";
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const data = await requestClaude(mode, target, messages, lookup ? (round < MAX_TOOL_ROUNDS ? "auto" : "none") : undefined);
    const content = data.content ?? [];
    answer = answerText(content);
    const calls = content.filter((block) => block.type === "tool_use");
    if (!lookup || data.stop_reason !== "tool_use" || calls.length === 0) break;
    messages.push({ role: "assistant", content: echoContent(content) });
    const results: ToolResult[] = [];
    for (const call of calls) results.push(await runOrderTool(call, lookup, orders));
    messages.push({ role: "user", content: results });
  }
  return { answer, orders };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// 모델이 넘긴 이름·날짜를 정리한다. 날짜가 없거나 미래면 최근 30일, cafe24 한도(3개월)를 넘으면 줄인다.
function normalizeSearch(input: Record<string, unknown>) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 30) : "";
  if (!name) return null;
  const today = kstToday();
  const pick = (value: unknown) => (typeof value === "string" && DAY.test(value) ? value : "");
  let from = pick(input.date_from);
  let to = pick(input.date_to);
  // 미래 날짜는 버리되, 과거부터 넓혀 찾다 미래로 넘어간 끝 날짜(매장 택배 발송일 등)는 오늘로 당긴다.
  if (from > today) from = "";
  if (to > today) to = from ? today : "";
  if (!from && !to) {
    from = shiftDay(today, -30);
    to = today;
  } else if (!from) from = to;
  else if (!to) to = from;
  if (from > to) [from, to] = [to, from];
  if (from < shiftDay(to, -90)) from = shiftDay(to, -90);
  return { name, from, to };
}

// 사전 질문·고객 메시지·상담원 질문에 적힌 자사몰 주문번호(YYYYMMDD-XXXXXXX, 하이픈 없이 적은 것 포함)
const ORDER_ID_IN_TEXT = /(?<!\d)(20\d{6})-?(\d{7})(?!\d)/g;

async function findChatOrders({ texts, memberId }: OrderContext) {
  const ids = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(ORDER_ID_IN_TEXT)) ids.add(`${match[1]}-${match[2]}`);
  const orderIds = Array.from(ids).slice(0, 3);

  const byId = (await Promise.all(orderIds.map((id) => getOrderCandidate(id)))).filter(
    (order): order is OrderCandidate => Boolean(order),
  );
  const byMember = memberId ? await getMemberOrderCandidates(memberId) : [];
  const basis = [orderIds.length ? `이 상담(글)에 적힌 주문번호 ${orderIds.length}개` : "", memberId ? "로그인 회원의 최근 14일 주문" : ""]
    .filter(Boolean)
    .join(" · ");
  // 주문번호로도, 회원 주문으로도 잡힌 같은 주문은 한 건으로 — 찾은 방법만 합친다.
  const merged = new Map<string, OrderCandidate>();
  for (const order of [...byId, ...byMember]) {
    const existing = merged.get(order.orderId);
    if (existing) existing.matchedBy = Array.from(new Set([...existing.matchedBy, ...order.matchedBy]));
    else merged.set(order.orderId, { ...order, matchedBy: [...order.matchedBy] });
  }
  return { found: Array.from(merged.values()), basis };
}

// 같은 주문은 같은 이름표를 쓰고, 새 주문에만 다음 글자(주문 A, B, …)를 준다.
function labelOrders(found: OrderCandidate[], orders: AssistOrder[]) {
  return found.map((order) => {
    // 채널마다 주문번호 체계가 달라 채널까지 같아야 같은 주문 — 번호 없는 매장 택배 건은 묶지 않는다.
    const seen = order.orderId
      ? orders.find((item) => item.channel === order.channel && item.orderId === order.orderId)
      : undefined;
    if (seen) return seen;
    const labeled = { ...order, label: `주문 ${String.fromCharCode(65 + orders.length)}` };
    orders.push(labeled);
    return labeled;
  });
}

const MATCH_LABEL: Record<OrderMatch, string> = {
  buyer: "주문자 이름 일치",
  receiver: "받는 분 이름 일치",
  orderId: "주문번호로 조회",
  member: "로그인 회원의 주문",
};
const SHIPMENT_LABEL: Record<string, string> = { standby: "배송 대기", shipping: "배송 중", shipped: "배송 완료" };

function describeOrders(condition: string, found: AssistOrder[], notes: string[] = []) {
  const noteText = notes.length ? `\n${notes.join("\n")}` : "";
  if (found.length === 0) return `조회 조건: ${condition}\n결과 없음 — 조건에 맞는 주문이 없어요.${noteText}`;
  const lines = found.map((order) => {
    const items = order.items
      .map((item) => `${item.name}${item.option ? ` (${item.option})` : ""}${item.quantity ? ` ${item.quantity}개` : ""}`)
      .join(", ");
    const shipment = order.shipment
      ? [SHIPMENT_LABEL[order.shipment.status] ?? order.shipment.status, order.shipment.carrierName]
          .filter(Boolean)
          .join(" · ") + (order.shipment.trackingNumber ? ` 송장 ${order.shipment.trackingNumber}` : "")
      : "송장 미등록";
    const date = order.orderDate ? order.orderDate.slice(0, 16).replace("T", " ") : "확인 불가";
    const extra = [order.note, order.asOf && `${order.asOf} 기준 사본(실시간 아님)`].filter(Boolean).join(" · ");
    return `${order.label} — ${order.channel} · 주문일 ${date} · ${order.matchedBy.map((m) => MATCH_LABEL[m]).join(", ")} · 상품: ${items || "확인 불가"} · 주문 상태: ${order.status || "확인 불가"} · 배송: ${shipment}${extra ? ` · ${extra}` : ""}`;
  });
  return `조회 조건: ${condition}\n결과 ${found.length}건\n${lines.join("\n")}${noteText}`;
}

// 주문을 찾는 곳 하나 — 설정이 없거나 실패해도 다른 곳 결과는 살리고, 왜 빠졌는지만 적는다.
async function fromSource(enabled: boolean, label: string, run: () => Promise<OrderCandidate[]>) {
  if (!enabled) return { found: [] as OrderCandidate[], note: `${label}: 연결 설정이 없어 찾지 못했어요.` };
  try {
    return { found: await run(), note: "" };
  } catch (error) {
    console.warn(`[assist] ${label} 주문 조회 실패`, error);
    return { found: [] as OrderCandidate[], note: `${label}: 조회에 실패했어요(잠시 후 다시 시도).` };
  }
}

async function runOrderTool(call: ContentBlock, context: OrderContext, orders: AssistOrder[]): Promise<ToolResult> {
  const reply = (content: string, isError = false): ToolResult => ({
    type: "tool_result",
    tool_use_id: call.id ?? "",
    content,
    ...(isError ? { is_error: true } : {}),
  });
  try {
    if (call.name === "find_orders_by_name") {
      const search = normalizeSearch(call.input ?? {});
      if (!search) return reply("찾을 이름이 필요해요.", true);
      if (!isCafe24Configured() && !isOnlineDataConfigured()) {
        return reply("주문 조회 연결 설정(cafe24·onlineData)이 없어 찾을 수 없어요. 상담원에게 cafe24 관리자·스마트스토어 판매자센터에서 직접 확인하라고 알려 주세요.", true);
      }
      const [mall, others] = await Promise.all([
        fromSource(isCafe24Configured(), "자사몰(cafe24)", () => searchOrdersByName(search.name, search.from, search.to)),
        fromSource(isOnlineDataConfigured(), "스마트스토어·매장 택배", () =>
          searchOtherChannelOrders(search.name, search.from, search.to),
        ),
      ]);
      const notes = [mall.note, others.note].filter(Boolean);
      return reply(
        describeOrders(`이름 ${search.name} · 주문일 ${search.from} ~ ${search.to}`, labelOrders([...mall.found, ...others.found], orders), notes),
      );
    }
    if (!isCafe24Configured()) {
      return reply("cafe24 연동 설정이 없어 주문을 조회할 수 없어요. 상담원에게 cafe24 관리자에서 직접 확인하라고 알려 주세요.", true);
    }
    if (call.name === "find_orders_from_chat") {
      const { found, basis } = await findChatOrders(context);
      if (!basis) {
        return reply("이 상담(글)에는 주문번호나 로그인 회원 정보가 없어요. 고객에게 이름과 주문일을 받아 find_orders_by_name 으로 찾아보세요.");
      }
      return reply(describeOrders(basis, labelOrders(found, orders)));
    }
    return reply(`알 수 없는 도구예요: ${call.name}`, true);
  } catch (error) {
    console.warn("[assist] cafe24 주문 조회 실패", error);
    return reply("cafe24 주문 조회에 실패했어요. 상담원에게 잠시 후 다시 시도하거나 cafe24 관리자에서 확인하라고 알려 주세요.", true);
  }
}

// 고객에게 나갈 문구 — 모델이 지시를 어기고 붙인 마크다운 굵게 표시, 감싼 따옴표,
// "(FAQ 1)"·"(사례 2)"·"(주문 A)" 같은 내부 근거 표시를 걷어낸다.
function cleanCustomerText(text: string) {
  return text
    .replace(/\*\*/g, "")
    .replace(/\s*[(（]\s*(?:(?:FAQ|사례)\s*\d+|주문\s*[A-Z])[^)）]*[)）]/g, "")
    .replace(/^["“'\s]+|["”'\s]+$/g, "")
    .trim();
}

const CUSTOMER_MARKER = "고객 안내 문구:";

// 상담원 참고(internal)와 고객 안내 문구(customerText)로 나눈다.
// 초안은 전체가 고객 안내 문구이고, 질문 답변은 "고객 안내 문구:" 뒤만 고객 문구로 본다.
export function splitAssistAnswer(mode: AssistMode, answer: string) {
  if (mode === "draft") return { internal: "", customerText: cleanCustomerText(answer) };
  const marker = answer.lastIndexOf(CUSTOMER_MARKER);
  if (marker < 0) return { internal: answer.replace(/\*\*/g, "").trim(), customerText: "" };
  return {
    internal: answer.slice(0, marker).replace(/\*\*/g, "").trim(),
    customerText: cleanCustomerText(answer.slice(marker + CUSTOMER_MARKER.length)),
  };
}
