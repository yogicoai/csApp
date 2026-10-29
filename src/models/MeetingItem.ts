import { deleteModel, model, models, Schema } from "mongoose";

// 회의 기록 — 확인할 것 하나(누구에게 · 왜 · 상태 · 받은 답).
const meetingItemSchema = new Schema(
  {
    question: { type: String, required: true },
    why: { type: String, default: "" },
    target: { type: String, default: "기타" }, // lib/meetingNotes 의 MEETING_TARGETS
    status: { type: String, enum: ["open", "answered", "done"], default: "open" },
    answer: { type: String, default: "" },
  },
  { timestamps: true },
);

meetingItemSchema.index({ createdAt: 1 });

if (process.env.NODE_ENV !== "production" && models.MeetingItem) deleteModel("MeetingItem");
export const MeetingItem = models.MeetingItem || model("MeetingItem", meetingItemSchema);
