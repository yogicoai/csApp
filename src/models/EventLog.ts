import { deleteModel, model, models, Schema } from "mongoose";

const eventLogSchema = new Schema(
  {
    channel: { type: String, required: true, index: true },
    sessionId: { type: String, default: "", index: true },
    eventType: {
      type: String,
      enum: [
        "visit",
        "category_view",
        "subcategory_view",
        "question_view",
        "feedback_positive",
        "feedback_negative",
        "ai_query",
        "no_result",
        "contact_click",
        "resolved",
        // 'AI에게 바로 질문하기' 답변에 대한 👍/👎 — query 는 개인정보를 가린 질문, metadata 에 답변·근거
        "ai_feedback_positive",
        "ai_feedback_negative",
      ],
      required: true,
      index: true,
    },
    category: { type: String, default: "" },
    faqId: { type: Schema.Types.ObjectId, ref: "Faq" },
    query: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// dev 서버가 이전 스키마(새 eventType 이 없는 enum)를 캐시하지 않도록 다시 등록한다(운영에서는 한 번만 등록).
if (process.env.NODE_ENV !== "production" && models.EventLog) deleteModel("EventLog");
export const EventLog = models.EventLog || model("EventLog", eventLogSchema);
