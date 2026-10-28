// 해결된 실시간 상담을 응대 자산(클레임) 초안으로 바꾸는 AI 정리.
// 승격된 클레임은 status=review 로 들어가며, CS가 더블체크 후 라이브 전환해야 AI 응대에 쓰인다.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ASSET_MODEL = process.env.ANTHROPIC_ASSIST_MODEL ?? "claude-sonnet-5-5";
const ASSET_MAX_TOKENS = 8000;
const ASSET_TIMEOUT_MS = 60_000;

export type ClaimDraft = {
  category: string;
  subcategory: string;
  situation: string;
  csAnswer: string;
  keywords: string[];
};

const CLAIM_DRAFT_INSTRUCTIONS = `당신은 Yogibo(요기보) 고객센터의 상담 기록을 '응대 자산'으로 정리하는 도우미입니다.
해결된 실시간 채팅 상담을 읽고, 나중에 같은 문의가 오면 AI가 근거로 쓸 질문·답변 한 쌍으로 정리하세요.
아래 JSON 형식으로만 답하세요. 설명·마크다운·코드펜스 없이 JSON 하나만 출력하세요.
{
  "category": "문의 카테고리 (예: A/S문의, 교환/환불, 배송문의, 세탁방법, 제품문의, 일반문의)",
  "subcategory": "세부 유형 짧게",
  "situation": "고객 문의를 일반화한 질문 한 문장 (개인 사정은 빼고 상황만)",
  "csAnswer": "상담원이 실제로 안내한 내용을 정리한 답변 2~5문장 (존댓말, 평문)",
  "keywords": ["검색용 키워드 3~6개"]
}
규칙:
- 상담원이 실제로 안내한 내용만 쓰세요. 대화에 없는 정책·금액·기간을 만들지 마세요.
- 이름·전화번호·주소·주문번호 같은 개인정보는 situation 과 csAnswer 에 넣지 마세요.
- 특정 고객 상황(며칠에 주문했는지 등)은 빼고, 다른 고객에게도 그대로 쓸 수 있는 일반형으로 쓰세요.`;

export async function runClaimDraft(transcript: string, hint: { inquiryType?: string; faqQuestion?: string } = {}) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const header = [
    hint.inquiryType ? `문의 유형: ${hint.inquiryType}` : "",
    hint.faqQuestion ? `고객이 보던 FAQ: ${hint.faqQuestion}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ASSET_MODEL,
        max_tokens: ASSET_MAX_TOKENS,
        output_config: { effort: "low" },
        fallbacks: "default",
        system: CLAIM_DRAFT_INSTRUCTIONS,
        messages: [
          { role: "user", content: `${header ? `${header}\n\n` : ""}[상담 대화]\n${transcript.slice(0, 20_000)}` },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`자산 정리 실패 (${response.status}) ${detail.slice(0, 300)}`);
    }
    const body = (await response.json()) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    if (body.stop_reason === "refusal") throw new Error("asset draft refusal");
    const text = (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    return parseClaimDraft(text);
  } finally {
    clearTimeout(timeout);
  }
}

function parseClaimDraft(text: string): ClaimDraft {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`자산 초안을 읽지 못했어요: ${text.slice(0, 160)}`);
  const raw = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
  const str = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");
  const draft: ClaimDraft = {
    category: str("category"),
    subcategory: str("subcategory"),
    situation: str("situation"),
    csAnswer: str("csAnswer"),
    keywords: Array.isArray(raw.keywords) ? (raw.keywords as unknown[]).map(String).filter(Boolean).slice(0, 8) : [],
  };
  if (!draft.situation || !draft.csAnswer) throw new Error("자산 초안에 질문/답변이 비어 있어요.");
  return draft;
}
