import { deleteModel, model, models, Schema } from "mongoose";

// 전화 상담 녹취 — TWC 대체 계획의 "녹음 보관 + AI 요약·답변 초안 + 녹취 찾기".
// 음성 파일은 베타 동안 로컬 폴더에 두고, DB 에는 전사 텍스트와 분석 결과만 쌓는다.
// (운영 전환 때 파일 저장소만 공용 드롭박스/Blob 으로 바꾸면 된다.)

const analysisSchema = new Schema(
  {
    // CS팀이 티켓에 적는 4가지(상담유형·구분태그·상담요약·상담내용)를 그대로 따른다.
    category: { type: String, default: "" }, // 상담유형 — "대분류 > 소분류" (예: 주문 > 배송일정문의)
    tags: { type: [String], default: [] }, // 구분태그
    summary: { type: String, default: "" }, // 상담요약 — 상품·고객 정보 포함 한 단락
    inquiry: { type: String, default: "" }, // 상담 내용 — 고객이 문의한 것
    response: { type: String, default: "" }, // 상담 내용 — 상담원이 답한 것
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    product: { type: String, default: "" },
    orderInfo: { type: String, default: "" }, // 구매월·구매처·주문번호 등
    followUp: { type: String, default: "" }, // 남은 후속 조치
    draftAnswer: { type: String, default: "" }, // 재문의 때 바로 쓸 답변 초안
    faqCandidate: { type: String, default: "" }, // FAQ 로 만들면 좋은 내용(없으면 빈값)
    sentiment: { type: String, default: "" }, // 고객 감정(차분·불만·화남 등)
  },
  { _id: false },
);

const voiceCallSchema = new Schema(
  {
    fileName: { type: String, default: "" },
    audioPath: { type: String, default: "" }, // 베타: 로컬 보관 경로(서버 재배포 시 사라질 수 있음)
    dropboxPath: { type: String, default: "" }, // 드롭박스에 보관한 원본 경로(lib/dropbox — 연결돼 있으면 이쪽에 둔다)
    mimeType: { type: String, default: "" },
    callDate: { type: Date }, // 통화 일시 — 파일명에서 추정하거나 직접 입력
    phoneNumber: { type: String, default: "", index: true },
    durationSec: { type: Number, default: 0 },
    transcript: { type: String, default: "" },
    status: { type: String, enum: ["pending", "done", "failed"], default: "pending" },
    error: { type: String, default: "" },
    analysis: { type: analysisSchema, default: undefined },
    // 응대 자산(클레임)으로 승격했으면 그 클레임 id
    assetClaimId: { type: String, default: "" },
  },
  { timestamps: true },
);

voiceCallSchema.index({ createdAt: -1 });

// dev 서버가 이전 스키마를 캐시하지 않도록 다시 등록한다(운영에서는 한 번만 등록).
if (process.env.NODE_ENV !== "production" && models.VoiceCall) deleteModel("VoiceCall");
export const VoiceCall = models.VoiceCall || model("VoiceCall", voiceCallSchema);
