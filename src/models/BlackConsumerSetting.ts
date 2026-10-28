import { deleteModel, model, models, Schema } from "mongoose";

// 블랙컨슈머 운영 기준 — 하나만 둔다(_id "default"). CS팀이 정한 등록·해제 기준 글과 기본 주의 표시 기간.
const blackConsumerSettingSchema = new Schema(
  {
    _id: { type: String, default: "default" },
    criteria: { type: String },
    defaultMonths: { type: Number },
  },
  { timestamps: true },
);

if (process.env.NODE_ENV !== "production" && models.BlackConsumerSetting) deleteModel("BlackConsumerSetting");
export const BlackConsumerSetting =
  models.BlackConsumerSetting || model("BlackConsumerSetting", blackConsumerSettingSchema);
