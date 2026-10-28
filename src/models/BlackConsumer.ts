import { deleteModel, model, models, Schema } from "mongoose";

// 블랙컨슈머(주의 고객) — CS 가 등록·해제한다. 자동으로 막지 않고, 같은 번호·회원·톡톡 고객의 상담·녹취에 주의 표시만 한다.
// 번호·회원 ID·톡톡 고객 중 하나 이상으로 가린다. 등록·수정·연장·해제는 history 에 누가·언제·왜를 남긴다.
const historySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    action: { type: String, enum: ["register", "edit", "extend", "release", "reopen"], required: true },
    by: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const blackConsumerSchema = new Schema(
  {
    phone: { type: String, default: "", index: true }, // 숫자만
    memberId: { type: String, default: "", index: true }, // 자사몰(cafe24) 회원 ID
    // 네이버 톡톡 사용자 식별값 — 톡톡 상담에서 등록할 때 서버가 붙인다(화면에는 내보내지 않는다).
    talkUser: { type: String, default: "", index: true },
    talkTicket: { type: String, default: "" }, // 톡톡 고객을 등록한 상담번호
    name: { type: String, default: "" },
    reasons: { type: [String], default: [] }, // lib/blackConsumer 의 BLACK_REASONS key
    detail: { type: String, default: "" }, // 무슨 일이 있었는지
    refs: { type: String, default: "" }, // 관련 상담번호·주문번호·통화 일시 등
    registeredBy: { type: String, default: "" },
    until: { type: String, required: true }, // YYYY-MM-DD(KST) — 이날까지 주의 표시
    releasedAt: { type: Date },
    releasedBy: { type: String, default: "" },
    releaseNote: { type: String, default: "" },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);

blackConsumerSchema.index({ createdAt: -1 });

if (process.env.NODE_ENV !== "production" && models.BlackConsumer) deleteModel("BlackConsumer");
export const BlackConsumer = models.BlackConsumer || model("BlackConsumer", blackConsumerSchema);
