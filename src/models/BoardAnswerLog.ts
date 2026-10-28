import { deleteModel, model, models, Schema } from "mongoose";

// 게시판 관리에서 단 답변 기록 — 등록 시도마다 하나. 같은 글에 두 창(두 상담원)이 동시에 등록하는 것도 막는다.
//   key: homepage:6:123 · smartstore:456
//   status: posting(등록 중) → posted(등록됨) | failed(실패)
//   '등록 중'은 글마다 하나만 있을 수 있다(부분 유니크 인덱스) — 그게 동시 등록 잠금이다.
// 고객 글 내용은 저장하지 않는다(원본은 cafe24·스마트스토어에 있다). 우리가 보낸 답변만 남긴다.
const boardAnswerLogSchema = new Schema(
  {
    key: { type: String, required: true, index: true },
    folder: { type: String, enum: ["homepage", "smartstore"], required: true },
    action: { type: String, enum: ["answer", "edit"], default: "answer" }, // 새 답변 등록 · 등록된 답변 고치기
    status: { type: String, enum: ["posting", "posted", "failed"], required: true },
    content: { type: String, required: true },
    remoteId: { type: String, default: "" }, // cafe24 답글 번호 · 스마트스토어 답변 번호
    error: { type: String, default: "" },
    postedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
boardAnswerLogSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { status: "posting" }, name: "one_posting_per_key" });

if (process.env.NODE_ENV !== "production" && models.BoardAnswerLog) deleteModel("BoardAnswerLog");
export const BoardAnswerLog = models.BoardAnswerLog || model("BoardAnswerLog", boardAnswerLogSchema);
