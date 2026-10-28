import { model, models, Schema } from "mongoose";

// 상담번호 발급용 날짜별 카운터 — _id: "livechat-YYYYMMDD", seq 를 원자적으로 올려 쓴다.
const liveChatCounterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

export const LiveChatCounter = models.LiveChatCounter || model("LiveChatCounter", liveChatCounterSchema);
