import { deleteModel, model, models, Schema } from "mongoose";

// 네이버 톡톡 웹훅 받은 기록 — 연결 점검용(메시지 내용은 남기지 않는다). 14일 지나면 지운다.
//  account: 맞은 계정 key("" 첫 계정 · "2" 둘째 계정) / "?" = 비밀값이 맞는 계정 없음
//  status: 서버가 돌려준 응답(200 받음 · 403 IP 확인에서 막음 · 404 주소 틀림 · 400 내용 못 읽음 · 500 처리 실패)
const talkWebhookLogSchema = new Schema(
  {
    account: { type: String, default: "?" },
    event: { type: String, default: "" },
    status: { type: Number, required: true },
    ip: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

talkWebhookLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

if (process.env.NODE_ENV !== "production" && models.TalkWebhookLog) deleteModel("TalkWebhookLog");
export const TalkWebhookLog = models.TalkWebhookLog || model("TalkWebhookLog", talkWebhookLogSchema);
