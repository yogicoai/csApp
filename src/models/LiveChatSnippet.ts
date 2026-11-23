import { model, models, Schema } from "mongoose";

// 실시간 채팅상담 '자주 쓰는 답변' — 상담원이 콘솔 오른쪽 상담 도움 영역에서 눌러 답변창에 넣는다.
// defaultKey: 기본 문구(lib/liveChatOptions DEFAULT_SNIPPETS)로 처음 넣은 문구의 이름 — 목록에서 기본 문구 순서대로 앞에 둔다.
//  기본 문구도 고치고 지울 수 있다(지우면 다시 생기지 않는다).
const liveChatSnippetSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    defaultKey: { type: String },
  },
  { timestamps: true },
);

export const LiveChatSnippet = models.LiveChatSnippet || model("LiveChatSnippet", liveChatSnippetSchema);
