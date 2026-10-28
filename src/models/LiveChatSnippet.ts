import { model, models, Schema } from "mongoose";

// 실시간 채팅상담 '자주 쓰는 답변' — 상담원이 콘솔 오른쪽 상담 도움 영역에서 눌러 답변창에 넣는다.
const liveChatSnippetSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
  },
  { timestamps: true },
);

export const LiveChatSnippet = models.LiveChatSnippet || model("LiveChatSnippet", liveChatSnippetSchema);
