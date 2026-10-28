import type { Types } from "mongoose";
import { VOICE_FOLDER } from "@/lib/dropbox";

// 전화 녹취 분석 — 전사(OpenAI)와 티켓 정리(Claude)를 담당한다.
// 호출 방식은 liveChatAssist 와 같은 Messages API 직접 호출(설치 SDK 에 effort·fallbacks 없음).

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANALYSIS_MODEL = process.env.ANTHROPIC_ASSIST_MODEL ?? "claude-sonnet-5-5";
const ANALYSIS_MAX_TOKENS = 8000;
const ANALYSIS_TIMEOUT_MS = 90_000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STT_MODEL = process.env.OPENAI_STT_MODEL ?? "gpt-4o-mini-transcribe";
const STT_TIMEOUT_MS = 180_000;
// OpenAI 전사 API 가 받는 형식과 파일 크기 한도
const STT_EXTENSIONS = new Set(["flac", "m4a", "mp3", "mp4", "mpeg", "mpga", "ogg", "wav", "webm"]);
const STT_MAX_BYTES = 25 * 1024 * 1024;
// gpt-4o 계열은 긴 녹음을 한 덩어리로 받으면 뒷부분을 빼고 돌려주는 일이 있어, 이보다 긴 통화는 무음 기준으로 나눠 전사시킨다.
const STT_CHUNK_AFTER_SEC = 5 * 60;

export type VoiceAnalysis = {
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

export type VoiceCallRecord = {
  _id: Types.ObjectId;
  fileName: string;
  audioPath: string;
  dropboxPath?: string;
  mimeType: string;
  callDate?: Date;
  phoneNumber: string;
  durationSec: number;
  transcript: string;
  status: "pending" | "done" | "failed";
  error: string;
  analysis?: VoiceAnalysis;
  assetClaimId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeVoiceCall(call: VoiceCallRecord, { withTranscript = true } = {}) {
  return {
    id: String(call._id),
    fileName: call.fileName,
    hasAudio: Boolean(call.audioPath || call.dropboxPath),
    // 원본 위치 — 드롭박스에 두었으면 그 경로(녹음 폴더 기준), 원본을 찾을 때 쓴다
    dropboxPath: call.dropboxPath ?? "",
    callDate: call.callDate ? call.callDate.toISOString() : "",
    phoneNumber: call.phoneNumber,
    durationSec: call.durationSec,
    transcript: withTranscript ? call.transcript : "",
    status: call.status,
    error: call.error,
    assetClaimId: call.assetClaimId ?? "",
    analysis: call.analysis
      ? {
          category: call.analysis.category ?? "",
          tags: call.analysis.tags ?? [],
          summary: call.analysis.summary ?? "",
          inquiry: call.analysis.inquiry ?? "",
          response: call.analysis.response ?? "",
          customerName: call.analysis.customerName ?? "",
          customerPhone: call.analysis.customerPhone ?? "",
          product: call.analysis.product ?? "",
          orderInfo: call.analysis.orderInfo ?? "",
          followUp: call.analysis.followUp ?? "",
          draftAnswer: call.analysis.draftAnswer ?? "",
          faqCandidate: call.analysis.faqCandidate ?? "",
          sentiment: call.analysis.sentiment ?? "",
        }
      : null,
    createdAt: call.createdAt.toISOString(),
  };
}

// LG U+ 통화매니저/TWC 녹음 파일명에서 통화 일시·고객 번호를 추정한다.
// 예: "20261023_1432_01012345678.mp3", "녹음_2026-10-23 14시32분_010-1234-5678.m4a"
export function parseRecordingFileName(name: string): { callDate?: Date; phoneNumber?: string } {
  const result: { callDate?: Date; phoneNumber?: string } = {};
  const digitsOnly = name.replace(/[-.\s]/g, "");

  const dateMatch = digitsOnly.match(/(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])[_]?([01]\d|2[0-3])([0-5]\d)(?:([0-5]\d))?/);
  if (dateMatch) {
    const [, y, mo, d, h, mi, s] = dateMatch;
    // 파일명의 시각은 한국 시간이므로 UTC+9 를 빼서 저장한다.
    const kst = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? "0"));
    result.callDate = new Date(kst - 9 * 3600_000);
  }

  const phoneMatch = name.replace(/[-.\s]/g, "").match(/01[016789]\d{7,8}|0\d{1,2}\d{7,8}/g);
  if (phoneMatch) {
    // 대표번호(02-557-0920)가 같이 들어 있으면 휴대폰 번호를 우선한다.
    const mobile = phoneMatch.find((num) => num.startsWith("01"));
    result.phoneNumber = mobile ?? phoneMatch[phoneMatch.length - 1];
  }
  return result;
}

// 드롭박스 보관 경로 — 녹음 폴더/통화일(KST)/시각_번호_원래이름. 통화일을 모르면 올린 때로.
// 원래 이름에 번호가 이미 들어 있으면(LG U+ 녹음 파일 등) 번호를 또 붙이지 않는다.
export function voiceDropboxPath(fileName: string, callDate?: Date, phoneNumber = "") {
  const kst = new Date((callDate ?? new Date()).getTime() + 9 * 3600_000).toISOString();
  const safeName = (fileName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "recording").slice(-120);
  const phone = phoneNumber && !safeName.replace(/[-.\s]/g, "").includes(phoneNumber) ? `${phoneNumber}_` : "";
  return `${VOICE_FOLDER}/${kst.slice(0, 10)}/${kst.slice(11, 19).replace(/:/g, "")}_${phone}${safeName}`;
}

// 전사할 수 없는 파일이면 안내 문구를, 괜찮으면 빈 문자열을 돌려준다.
export function sttFileProblem(fileName: string, size: number) {
  const ext = fileName.includes(".") ? (fileName.split(".").pop() ?? "").toLowerCase() : "";
  if (ext && !STT_EXTENSIONS.has(ext)) return `.${ext} 파일은 전사할 수 없어요. mp3·m4a·wav 로 바꿔서 올려 주세요.`;
  if (size > STT_MAX_BYTES) return "전사는 25MB 이하 파일만 할 수 있어요. mp3 로 저장하거나 통화를 나눠서 올려 주세요.";
  return "";
}

// 음성 파일 → 텍스트 (OpenAI). 키가 없으면 안내 메시지와 함께 실패한다.
// durationSec 는 브라우저가 잰 녹음 길이 — 0 이면 모르는 것으로 보고 나눠 전사한다.
export async function transcribeAudio(buffer: Buffer, fileName: string, mimeType: string, { durationSec = 0 } = {}) {
  if (!OPENAI_API_KEY || OPENAI_API_KEY.startsWith("sk-ant")) {
    // sk-ant 로 시작하면 Anthropic 키가 잘못 들어간 것 — 전사는 OpenAI 키(sk-…)가 필요하다.
    throw new Error(
      "녹음 전사용 OpenAI 키가 설정되어 있지 않아요. .env.local 의 OPENAI_API_KEY 에 OpenAI 키를 넣어 주세요. 그 전에는 '녹취 붙여넣기'로 등록할 수 있어요.",
    );
  }

  const isWhisper = STT_MODEL.startsWith("whisper");
  const knownShort = durationSec > 0 && durationSec <= STT_CHUNK_AFTER_SEC;
  const form = new FormData();
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  form.append("file", new Blob([bytes], { type: mimeType || "audio/mpeg" }), fileName || "recording.mp3");
  form.append("model", STT_MODEL);
  form.append("language", "ko");
  // 녹음 길이까지 주는 verbose_json 은 whisper-1 만 받고, gpt-4o 계열은 json 만 받는다.
  form.append("response_format", isWhisper ? "verbose_json" : "json");
  if (!isWhisper && !knownShort) form.append("chunking_strategy", "auto");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`전사 실패 (${response.status}) ${detail.slice(0, 300)}`);
    }
    const body = (await response.json()) as { text?: string; duration?: number };
    return { text: (body.text ?? "").trim(), durationSec: Math.round(body.duration ?? 0) };
  } finally {
    clearTimeout(timeout);
  }
}

// CS팀 티켓 양식(상담유형·구분태그·상담요약·상담내용)에 맞춘 녹취 분석.
// TWC 인콜 분석의 분류 체계를 예시로 줘서 지금 쓰는 분류와 비슷하게 나오게 한다.
const ANALYSIS_INSTRUCTIONS = `당신은 Yogibo(요기보) 고객센터의 전화 녹취를 CS 티켓으로 정리하는 도우미입니다.
녹취록을 읽고 아래 JSON 형식으로만 답하세요. 설명·마크다운·코드펜스 없이 JSON 하나만 출력하세요.
{
  "category": "대분류 > 소분류",
  "tags": ["구분태그"],
  "summary": "상담요약 — 고객이 쓰는 상품, 고객 정보, 핵심 요구를 2~3문장으로",
  "inquiry": "고객이 문의한 내용 정리",
  "response": "상담원이 안내한 내용 정리",
  "customerName": "고객 성함",
  "customerPhone": "고객 연락처",
  "product": "언급된 제품명",
  "orderInfo": "주문번호·구매 시기·구매처 등 주문 관련 정보",
  "followUp": "상담 후 남은 처리(회수 접수, 재연락 약속 등)",
  "draftAnswer": "같은 고객이 다시 문의하면 바로 보낼 수 있는 존댓말 답변 초안 2~4문장",
  "faqCandidate": "이 상담을 FAQ로 만들면 좋을 때 그 질문 한 줄, 아니면 빈 문자열",
  "sentiment": "차분 | 아쉬움 | 불만 | 화남 중 하나"
}
규칙:
- 녹취에 실제로 나온 내용만 쓰세요. 없는 정보는 빈 문자열("")로 두고 지어내지 마세요.
- 대분류는 주문 / 문의 / A\\S / 기타 중에서 고르고, 소분류는 배송일정문의·커버구매·케어서비스·주문내역확인·반품·재고문의·자가충전방법 같은 실제 문의 유형으로 짧게 쓰세요.
- draftAnswer 는 상담원이 한 안내를 근거로만 쓰고, 새로운 정책·금액·기간을 만들지 마세요.
- 전사 오류로 보이는 어색한 단어는 문맥으로 바로잡아 정리하세요.`;

export async function runVoiceAnalysis(transcript: string, meta: { phoneNumber?: string; callDate?: Date } = {}) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  const header = [
    meta.callDate ? `통화 일시: ${meta.callDate.toISOString()}` : "",
    meta.phoneNumber ? `발신 번호: ${meta.phoneNumber}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        // 안전 분류기가 거절하면 서버가 권장 대체 모델로 다시 실행한다(fallbacks: "default").
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        max_tokens: ANALYSIS_MAX_TOKENS,
        output_config: { effort: "medium" },
        fallbacks: "default",
        system: ANALYSIS_INSTRUCTIONS,
        messages: [{ role: "user", content: `${header ? `${header}\n\n` : ""}[녹취록]\n${transcript.slice(0, 30_000)}` }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`분석 실패 (${response.status}) ${detail.slice(0, 300)}`);
    }
    const body = (await response.json()) as {
      stop_reason?: string;
      content?: Array<{ type: string; text?: string }>;
    };
    if (body.stop_reason === "refusal") throw new Error("analysis refusal");
    const text = (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    return parseAnalysisJson(text);
  } finally {
    clearTimeout(timeout);
  }
}

function parseAnalysisJson(text: string): VoiceAnalysis {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`분석 결과를 읽지 못했어요: ${text.slice(0, 160)}`);
  const raw = JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
  const str = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");
  return {
    category: str("category"),
    tags: Array.isArray(raw.tags) ? (raw.tags as unknown[]).map(String).filter(Boolean).slice(0, 6) : [],
    summary: str("summary"),
    inquiry: str("inquiry"),
    response: str("response"),
    customerName: str("customerName"),
    customerPhone: str("customerPhone"),
    product: str("product"),
    orderInfo: str("orderInfo"),
    followUp: str("followUp"),
    draftAnswer: str("draftAnswer"),
    faqCandidate: str("faqCandidate"),
    sentiment: str("sentiment"),
  };
}
