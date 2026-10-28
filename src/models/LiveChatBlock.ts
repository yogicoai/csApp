import { model, models, Schema } from "mongoose";

// 스팸 차단 — key: "member:<회원ID>" | "session:<세션ID>". until 이 지나면 TTL 인덱스가 문서를 지운다.
// chatId 는 차단을 만든 상담(복구하면 그 상담이 만든 차단을 푼다).
const liveChatBlockSchema = new Schema(
  {
    key: { type: String, required: true, index: true },
    chatId: { type: Schema.Types.ObjectId, ref: "LiveChat", required: true, index: true },
    until: { type: Date, required: true },
  },
  { timestamps: true },
);

liveChatBlockSchema.index({ until: 1 }, { expireAfterSeconds: 0 });

export const LiveChatBlock = models.LiveChatBlock || model("LiveChatBlock", liveChatBlockSchema);
