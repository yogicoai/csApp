import { deleteModel, model, models, Schema } from "mongoose";

// 홈페이지 휴무 팝업 문구 — 하나만 둔다(_id "default"). 비어 있는 값은 lib/leaveNotice 의 기본 문구를 쓴다.
const leaveNoticeSettingSchema = new Schema(
  {
    _id: { type: String, default: "default" },
    leadDays: { type: Number },
    title: { type: String },
    body: { type: String },
    resumePrefix: { type: String },
    notes: [{ _id: false, text: { type: String }, highlight: { type: Boolean } }],
    qrUrl: { type: String },
  },
  { timestamps: true },
);

if (process.env.NODE_ENV !== "production" && models.LeaveNoticeSetting) deleteModel("LeaveNoticeSetting");
export const LeaveNoticeSetting = models.LeaveNoticeSetting || model("LeaveNoticeSetting", leaveNoticeSettingSchema);
