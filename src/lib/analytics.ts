import { connectDB } from "@/lib/db";
import { EventLog } from "@/models/EventLog";
import { Faq } from "@/models/Faq";

export type GroupBy = "day" | "week" | "month";

export type TrendBucket = {
  date: string;
  visit: number;
  question_view: number;
  contact_click: number;
  ai_query: number;
  no_result: number;
  resolved: number;
  feedback_positive: number;
  feedback_negative: number;
};

export type EngagementAnalytics = {
  range: { groupBy: GroupBy; days: number; since: string; until: string };
  summary: {
    visits: number;
    sessions: number;
    questionViews: number;
    contactClicks: number;
    liveChatClicks: number;
    kakaoClicks: number;
    phoneClicks: number;
    aiQueries: number;
    noResults: number;
    resolved: number;
    feedbackPositive: number;
    feedbackNegative: number;
    satisfactionRate: number;
    deflectionRate: number;
    resolutionRate: number;
    // 'AI에게 바로 질문하기' — 답변률(FAQ로 답한 비율)과 답변 👍/👎
    aiAnswerRate: number;
    aiFeedbackPositive: number;
    aiFeedbackNegative: number;
    aiSatisfactionRate: number;
  };
  trend: TrendBucket[];
  topQuestions: Array<{ faqId: string; question: string; category: string; views: number }>;
  topNoResults: Array<{ query: string; count: number }>;
  // 👎 받은 AI 답변 — FAQ 보강 대상
  aiNegative: Array<{ query: string; answer: string; status: string; createdAt: string }>;
  topSearchKeywords: Array<{ query: string; count: number }>;
  byChannel: Array<{ channel: string; visits: number; contactClicks: number; satisfactionRate: number }>;
};

const TIMEZONE = "Asia/Seoul";
const EMPTY_BUCKET: Omit<TrendBucket, "date"> = {
  visit: 0,
  question_view: 0,
  contact_click: 0,
  ai_query: 0,
  no_result: 0,
  resolved: 0,
  feedback_positive: 0,
  feedback_negative: 0,
};

export function normalizeGroupBy(value: string | null): GroupBy {
  return value === "week" || value === "month" ? value : "day";
}

export function normalizeDays(value: string | null, groupBy: GroupBy): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 730) {
    return Math.round(parsed);
  }
  return groupBy === "month" ? 365 : groupBy === "week" ? 84 : 30;
}

// 달력 날짜 선택(from/to, YYYY-MM-DD)을 KST 기준 범위로 변환한다. 없으면 days 만큼 소급.
export function normalizeDateRange(from: string | null, to: string | null, days: number) {
  const parse = (s: string | null, endOfDay: boolean) => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return new Date(`${s}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+09:00`);
  };

  const fromDate = parse(from, false);
  const toDate = parse(to, true);

  let until = toDate ?? new Date();
  let since = fromDate ?? new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  if (since > until) {
    [since, until] = [until, since];
  }

  return { since, until, days: Math.max(1, Math.round((until.getTime() - since.getTime()) / 86_400_000)) };
}

function clampRate(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const STANDALONE_JAMO = /[㄰-㆏]/g;

// 표준화: 소문자화 + 단독 자모 제거 + 기호 제거 + 공백 정리 (오타/단편 병합·필터용).
export function normalizeQuery(value: string) {
  return value
    .toLowerCase()
    .replace(STANDALONE_JAMO, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rankQueries(queries: string[]) {
  const groups = new Map<string, { count: number; originals: Map<string, number> }>();

  for (const raw of queries) {
    const normalized = normalizeQuery(raw);
    if (normalized.length < 2) {
      continue;
    }
    const group = groups.get(normalized) ?? { count: 0, originals: new Map() };
    group.count += 1;
    const original = raw.trim();
    group.originals.set(original, (group.originals.get(original) ?? 0) + 1);
    groups.set(normalized, group);
  }

  return Array.from(groups.values())
    .map((group) => {
      const representative = Array.from(group.originals.entries()).sort(
        (a, b) => b[1] - a[1] || b[0].length - a[0].length,
      )[0][0];
      return { query: representative, count: group.count };
    })
    .sort((a, b) => b.count - a.count || b.query.length - a.query.length)
    .slice(0, 10);
}

export function emptyAnalytics(groupBy: GroupBy, since: Date, until: Date): EngagementAnalytics {
  return {
    range: {
      groupBy,
      days: Math.max(1, Math.round((until.getTime() - since.getTime()) / 86_400_000)),
      since: since.toISOString(),
      until: until.toISOString(),
    },
    summary: {
      visits: 0,
      sessions: 0,
      questionViews: 0,
      contactClicks: 0,
      liveChatClicks: 0,
      kakaoClicks: 0,
      phoneClicks: 0,
      aiQueries: 0,
      noResults: 0,
      resolved: 0,
      feedbackPositive: 0,
      feedbackNegative: 0,
      satisfactionRate: 0,
      deflectionRate: 0,
      resolutionRate: 0,
      aiAnswerRate: 0,
      aiFeedbackPositive: 0,
      aiFeedbackNegative: 0,
      aiSatisfactionRate: 0,
    },
    trend: [],
    topQuestions: [],
    topNoResults: [],
    aiNegative: [],
    topSearchKeywords: [],
    byChannel: [],
  };
}

export async function getEngagementAnalytics(options: {
  groupBy: GroupBy;
  since: Date;
  until: Date;
  channel?: string;
}): Promise<EngagementAnalytics> {
  const { groupBy, since, until, channel } = options;

  try {
    await connectDB();
  } catch {
    return emptyAnalytics(groupBy, since, until);
  }

  const match: Record<string, unknown> = { createdAt: { $gte: since, $lte: until } };
  if (channel) {
    match.channel = channel;
  }

  const [bucketRows, channelRows, topQuestionRows, queryRows, sessionRows, contactRows, aiNegativeRows] = await Promise.all([
    EventLog.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            bucket: { $dateTrunc: { date: "$createdAt", unit: groupBy, timezone: TIMEZONE } },
            type: "$eventType",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.bucket": 1 } },
    ]),
    EventLog.aggregate([
      { $match: match },
      { $group: { _id: { channel: "$channel", type: "$eventType" }, count: { $sum: 1 } } },
    ]),
    EventLog.aggregate([
      { $match: { ...match, eventType: "question_view", faqId: { $exists: true, $ne: null } } },
      { $group: { _id: "$faqId", views: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: 8 },
    ]),
    EventLog.find({ ...match, eventType: { $in: ["ai_query", "no_result"] }, query: { $nin: ["", null] } })
      .select("query eventType")
      .limit(5000)
      .lean(),
    EventLog.aggregate([
      { $match: { ...match, sessionId: { $nin: ["", null] } } },
      { $group: { _id: "$sessionId", types: { $addToSet: "$eventType" } } },
      {
        $group: {
          _id: null,
          sessions: { $sum: 1 },
          resolvedSessions: { $sum: { $cond: [{ $in: ["resolved", "$types"] }, 1, 0] } },
          contactSessions: { $sum: { $cond: [{ $in: ["contact_click", "$types"] }, 1, 0] } },
        },
      },
    ]),
    EventLog.aggregate([
      { $match: { ...match, eventType: "contact_click" } },
      { $group: { _id: "$metadata.method", count: { $sum: 1 } } },
    ]),
    EventLog.find({ ...match, eventType: "ai_feedback_negative" })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("query metadata createdAt")
      .lean(),
  ]);

  const trendMap = new Map<string, TrendBucket>();
  const summaryTotals: Record<string, number> = {};

  for (const row of bucketRows as Array<{ _id: { bucket: Date; type: string }; count: number }>) {
    const date = row._id.bucket.toISOString();
    const type = row._id.type;
    summaryTotals[type] = (summaryTotals[type] ?? 0) + row.count;

    const bucket = trendMap.get(date) ?? { date, ...EMPTY_BUCKET };
    if (type in EMPTY_BUCKET) {
      (bucket as unknown as Record<string, number>)[type] += row.count;
    }
    trendMap.set(date, bucket);
  }

  const trend = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const visits = summaryTotals.visit ?? 0;
  const questionViews = summaryTotals.question_view ?? 0;
  const contactClicks = summaryTotals.contact_click ?? 0;
  const aiQueries = summaryTotals.ai_query ?? 0;
  const noResults = summaryTotals.no_result ?? 0;
  const resolved = summaryTotals.resolved ?? 0;
  const feedbackPositive = summaryTotals.feedback_positive ?? 0;
  const feedbackNegative = summaryTotals.feedback_negative ?? 0;
  const totalFeedback = feedbackPositive + feedbackNegative;
  const satisfactionRate = totalFeedback ? clampRate((feedbackPositive / totalFeedback) * 100) : 0;
  const aiFeedbackPositive = summaryTotals.ai_feedback_positive ?? 0;
  const aiFeedbackNegative = summaryTotals.ai_feedback_negative ?? 0;
  const aiFeedbackTotal = aiFeedbackPositive + aiFeedbackNegative;
  const aiSatisfactionRate = aiFeedbackTotal ? clampRate((aiFeedbackPositive / aiFeedbackTotal) * 100) : 0;
  // AI 질문 중 FAQ·응대 자산으로 답한 비율(나머지는 '미해결 검색어'로 기록됨)
  const aiAnswerRate = aiQueries + noResults ? clampRate((aiQueries / (aiQueries + noResults)) * 100) : 0;
  const aiNegative = (
    aiNegativeRows as Array<{ query?: string; metadata?: { answer?: string; status?: string }; createdAt?: Date }>
  ).map((row) => ({
    query: row.query ?? "",
    answer: row.metadata?.answer ?? "",
    status: row.metadata?.status ?? "",
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : "",
  }));

  const sessionAgg = (sessionRows as Array<{ sessions: number; resolvedSessions: number; contactSessions: number }>)[0];
  const sessions = sessionAgg?.sessions ?? 0;
  const resolvedSessions = sessionAgg?.resolvedSessions ?? 0;
  const contactSessions = sessionAgg?.contactSessions ?? 0;

  // 세션 데이터가 있으면 세션 기준(더 정확), 없으면 방문 이벤트 기준으로 추정.
  const deflectionRate = sessions
    ? clampRate((1 - contactSessions / sessions) * 100)
    : visits
      ? clampRate((1 - contactClicks / visits) * 100)
      : 0;
  const resolutionRate = sessions ? clampRate((resolvedSessions / sessions) * 100) : 0;

  // 카카오 상담은 실시간 상담으로 교체됨 — kakao 는 교체 전 기간 집계용으로 남겨 둔다.
  let liveChatClicks = 0;
  let kakaoClicks = 0;
  let phoneClicks = 0;
  for (const row of contactRows as Array<{ _id: string | null; count: number }>) {
    if (row._id === "live_chat") liveChatClicks += row.count;
    else if (row._id === "kakao") kakaoClicks += row.count;
    else if (row._id === "phone") phoneClicks += row.count;
  }

  const channelMap = new Map<string, { visits: number; contactClicks: number; pos: number; neg: number }>();
  for (const row of channelRows as Array<{ _id: { channel: string; type: string }; count: number }>) {
    const entry = channelMap.get(row._id.channel) ?? { visits: 0, contactClicks: 0, pos: 0, neg: 0 };
    if (row._id.type === "visit") entry.visits += row.count;
    if (row._id.type === "contact_click") entry.contactClicks += row.count;
    if (row._id.type === "feedback_positive") entry.pos += row.count;
    if (row._id.type === "feedback_negative") entry.neg += row.count;
    channelMap.set(row._id.channel, entry);
  }

  const byChannel = Array.from(channelMap.entries())
    .map(([ch, v]) => ({
      channel: ch,
      visits: v.visits,
      contactClicks: v.contactClicks,
      satisfactionRate: v.pos + v.neg ? clampRate((v.pos / (v.pos + v.neg)) * 100) : 0,
    }))
    .sort((a, b) => b.visits - a.visits);

  const questionIds = (topQuestionRows as Array<{ _id: unknown; views: number }>).map((row) => row._id);
  const faqDocs = questionIds.length
    ? ((await Faq.find({ _id: { $in: questionIds } })
        .select("question category")
        .lean()) as Array<{ _id: unknown; question: string; category: string }>)
    : [];
  const faqMap = new Map(faqDocs.map((doc) => [String(doc._id), doc]));

  const topQuestions = (topQuestionRows as Array<{ _id: unknown; views: number }>).map((row) => {
    const doc = faqMap.get(String(row._id));
    return {
      faqId: String(row._id),
      question: doc?.question ?? "(삭제된 질문)",
      category: doc?.category ?? "",
      views: row.views,
    };
  });

  const allQueries = (queryRows as Array<{ query?: string; eventType?: string }>).map((r) => r.query ?? "");
  const noResultQueries = (queryRows as Array<{ query?: string; eventType?: string }>)
    .filter((r) => r.eventType === "no_result")
    .map((r) => r.query ?? "");

  return {
    range: {
      groupBy,
      days: Math.max(1, Math.round((until.getTime() - since.getTime()) / 86_400_000)),
      since: since.toISOString(),
      until: until.toISOString(),
    },
    summary: {
      visits,
      sessions,
      questionViews,
      contactClicks,
      liveChatClicks,
      kakaoClicks,
      phoneClicks,
      aiQueries,
      noResults,
      resolved,
      feedbackPositive,
      feedbackNegative,
      satisfactionRate,
      deflectionRate,
      resolutionRate,
      aiAnswerRate,
      aiFeedbackPositive,
      aiFeedbackNegative,
      aiSatisfactionRate,
    },
    trend,
    topQuestions,
    topNoResults: rankQueries(noResultQueries),
    aiNegative,
    topSearchKeywords: rankQueries(allQueries),
    byChannel,
  };
}
