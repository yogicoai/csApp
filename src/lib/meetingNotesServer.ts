import type { Types } from "mongoose";
import { z } from "zod";
import { MEETING_STATUS_KEYS, MEETING_TARGETS, type MeetingItemView, type MeetingStatus } from "@/lib/meetingNotes";

export type MeetingItemRecord = {
  _id: Types.ObjectId;
  question: string;
  why?: string;
  target?: string;
  status: MeetingStatus;
  answer?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export function serializeMeetingItem(item: MeetingItemRecord): MeetingItemView {
  return {
    id: String(item._id),
    question: item.question,
    why: item.why ?? "",
    target: item.target ?? "기타",
    status: item.status,
    answer: item.answer ?? "",
    createdAt: item.createdAt?.toISOString() ?? "",
    updatedAt: item.updatedAt?.toISOString() ?? "",
  };
}

export const meetingFields = {
  question: z.string().trim().min(1).max(500),
  why: z.string().trim().max(1000),
  target: z.enum(MEETING_TARGETS),
  status: z.enum(MEETING_STATUS_KEYS),
  answer: z.string().trim().max(3000),
};
