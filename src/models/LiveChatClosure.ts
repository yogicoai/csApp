import { deleteModel, model, models, Schema } from "mongoose";

// CS 연차·반차일 — 상담사가 1명이라 휴가로 지정한 시간에는 실시간 대화를 닫고 운영시간 외처럼 '문의 접수'로만 받는다.
//   full: 연차(종일) / am: 오전반차(14:00부터 상담) / pm: 오후반차(13:00까지 상담)
// 어드민 '연차 관리' 달력에서 지정·해제한다.
const liveChatClosureSchema = new Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD (KST)
    type: { type: String, enum: ["full", "am", "pm"], default: "full" },
    // 홈페이지 휴무 팝업(lib/leaveNotice)에 넣을지 — 휴무 기간 단위로 켜고 끈다(기간 안 하루라도 켜져 있으면 팝업).
    popup: { type: Boolean, default: true },
  },
  { timestamps: true },
);

if (process.env.NODE_ENV !== "production" && models.LiveChatClosure) deleteModel("LiveChatClosure");
export const LiveChatClosure = models.LiveChatClosure || model("LiveChatClosure", liveChatClosureSchema);
