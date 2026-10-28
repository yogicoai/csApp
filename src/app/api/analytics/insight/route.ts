import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import {
  getEngagementAnalytics,
  normalizeDateRange,
  normalizeDays,
  normalizeGroupBy,
} from "@/lib/analytics";
import { getAdminFaqs } from "@/lib/repositories/faqRepository";
import { getAllClaims } from "@/lib/repositories/claimRepository";

// 어드민 AI 데이터 분석: 사용자가 자유 질문을 입력하면, 서버가 DB 컨텍스트
// (참여도 분석 + FAQ 목록 + 최근 클레임)를 모아 Claude Haiku 4.5 에 전달한다.
// Haiku 4.5 는 output_config.effort 와 adaptive thinking 을 지원하지 않으므로
// 그 파라미터를 보내지 않는다.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

const insightSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  groupBy: z.string().optional(),
  days: z.number().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  channel: z.string().optional(),
});

const SYSTEM_PROMPT = `당신은 Yogibo 고객센터의 데이터 분석가입니다.

[목적]
이 앱은 'CS 전화 콜 진입 시 고객이 앱에서 스스로 답을 찾아 통화를 줄이는 것'이 목적이며, 가장 좋은 결과는 전화 연결 없이 해결되는 것입니다.

[작업]
사용자가 던지는 질문에 대해, 이어서 전달되는 'DB 컨텍스트' 안의 사실만 사용해서 한국어 마크다운으로 답하세요.

[규칙]
- 컨텍스트에 근거가 없는 추측·일반론은 하지 말 것. 모르면 "데이터에 근거가 부족하다"고 명시.
- 수치를 인용할 때는 그 수치가 어떤 지표인지 한 줄로 같이 말할 것.
- 표본이 적은 구간은 표본 크기를 함께 적고 신뢰도가 낮다고 언급할 것.
- 행동 제안을 할 때는 어떤 데이터 근거에서 나왔는지 같이 적을 것.
- 출력은 마크다운(헤딩 ##, 불릿 -, 번호 1.)을 활용해 간결하게 구성하되, 형식은 질문 성격에 맞게 자율적으로 선택할 것.`;

function summarizeContext(
  analytics: Awaited<ReturnType<typeof getEngagementAnalytics>>,
  faqs: Awaited<ReturnType<typeof getAdminFaqs>>,
  claims: Awaited<ReturnType<typeof getAllClaims>>,
) {
  const periodLabel = { day: "일별", week: "주별", month: "월별" }[analytics.range.groupBy];
  const s = analytics.summary;

  const faqLines = faqs
    .slice(0, 200)
    .map((f) => `- [${f.category}${f.subcategory ? ` > ${f.subcategory}` : ""}] ${f.question}`)
    .join("\n");
  const faqTrunc = faqs.length > 200 ? `\n... (총 ${faqs.length}건 중 상위 200개만 표시)` : "";

  const liveClaims = claims.filter((c) => c.status === "live");
  const reviewClaims = claims.filter((c) => c.status === "review");
  const recentClaims = claims.slice(0, 50);
  const claimLines = recentClaims
    .map((c) => {
      const sit = c.situation.replace(/\s+/g, " ").slice(0, 80);
      return `- [${c.status}] [${c.category || "미분류"}${c.subcategory ? ` > ${c.subcategory}` : ""}] ${sit}`;
    })
    .join("\n");

  return `[참여도 요약] (${analytics.range.since.slice(0, 10)} ~ ${analytics.range.until.slice(0, 10)}, ${periodLabel})
- 방문 ${s.visits} / 세션 ${s.sessions}
- 질문 열람 ${s.questionViews}
- AI 직접 질문 ${s.aiQueries} (결과 없음 ${s.noResults})
- 해결됐어요 ${s.resolved}
- 상담 클릭 ${s.contactClicks} (실시간 상담 ${s.liveChatClicks} / 카카오 ${s.kakaoClicks} / 전화 ${s.phoneClicks})
- 만족도 ${s.satisfactionRate}% (좋아요 ${s.feedbackPositive} / 아쉬워요 ${s.feedbackNegative})
- 자가해결률 ${s.deflectionRate}% / 해결 전환율 ${s.resolutionRate}%

[채널별]
${analytics.byChannel.map((c) => `- ${c.channel}: 방문 ${c.visits}, 상담클릭 ${c.contactClicks}, 만족도 ${c.satisfactionRate}%`).join("\n") || "- 데이터 없음"}

[검색 결과 없음 키워드]
${analytics.topNoResults.map((n, i) => `${i + 1}. "${n.query}" (${n.count}회)`).join("\n") || "- 없음"}

[전체 인기 검색어]
${analytics.topSearchKeywords.map((n, i) => `${i + 1}. "${n.query}" (${n.count}회)`).join("\n") || "- 없음"}

[많이 본 질문]
${analytics.topQuestions.map((q, i) => `${i + 1}. [${q.category}] ${q.question} (${q.views}회)`).join("\n") || "- 없음"}

[${periodLabel} 추세]
${analytics.trend.map((t) => `- ${t.date.slice(0, 10)}: 방문 ${t.visit}, 열람 ${t.question_view}, AI ${t.ai_query}, 해결 ${t.resolved}, 상담클릭 ${t.contact_click}`).join("\n") || "- 없음"}

[FAQ 목록 — 총 ${faqs.length}건]
${faqLines || "- 없음"}${faqTrunc}

[클레임 현황] 라이브 ${liveClaims.length} / 검토중 ${reviewClaims.length} / 전체 ${claims.length}
[최근 클레임 ${recentClaims.length}건]
${claimLines || "- 없음"}`;
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문(JSON 파싱 실패)" }, { status: 400 });
  }
  const parsed = insightSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "질문을 입력해주세요.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY가 설정되지 않아 AI 분석을 사용할 수 없습니다." },
      { status: 503 },
    );
  }

  const groupBy = normalizeGroupBy(body.groupBy ?? null);
  const days = normalizeDays(body.days != null ? String(body.days) : null, groupBy);
  const { since, until } = normalizeDateRange(body.from ?? null, body.to ?? null, days);
  const channel = body.channel?.trim() || undefined;

  try {
    const [analytics, faqs, claims] = await Promise.all([
      getEngagementAnalytics({ groupBy, since, until, channel }),
      getAdminFaqs(),
      getAllClaims(),
    ]);

    const context = summarizeContext(analytics, faqs, claims);
    const userMessage = `[DB 컨텍스트]
${context}

[질문]
${body.question}`;

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    let insight = "";
    for (const block of response.content) {
      if (block.type === "text") insight += block.text;
    }
    insight = insight.trim();

    if (!insight) {
      return NextResponse.json({ error: "AI 응답이 비어 있습니다." }, { status: 502 });
    }

    return NextResponse.json({
      insight,
      range: analytics.range,
      summary: analytics.summary,
      usage: response.usage,
    });
  } catch (error) {
    console.error("[api/analytics/insight] Claude 호출 실패", error);
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY 인증 실패." }, { status: 401 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "AI 호출 한도 초과. 잠시 후 다시 시도하세요." }, { status: 429 });
    }
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json(
      { error: "AI 분석 요청에 실패했습니다.", detail: message.slice(0, 300) },
      { status: 502 },
    );
  }
}
