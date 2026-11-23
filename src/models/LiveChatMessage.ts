import { deleteModel, model, models, Schema } from "mongoose";
import { TRASH_DAYS } from "@/lib/liveChatOptions";

// 실시간 상담 메시지 — (chatId, seq) 로 대화방 안에서 순서가 고정된다.
const liveChatMessageSchema = new Schema(
  {
    chatId: { type: Schema.Types.ObjectId, ref: "LiveChat", required: true },
    seq: { type: Number, required: true },
    sender: { type: String, enum: ["visitor", "agent", "system"], required: true },
    text: { type: String, required: true },
    // 메신저(네이버 톡톡·카카오 상담톡) 상담의 메시지 — state: 메신저로 보내는 중·보냄·못 보냄, echoed: 메신저가 되돌려 준 사본(echo)을 받음,
    // partner: 이 화면이 아니라 톡톡 파트너센터(앱 포함)·톡브릿지 등 다른 곳에서 직원이 직접 보낸 메시지.
    // 카카오만: serial = 톡브릿지 발신 번호(사본·삭제와 짝짓기), seq = 톡브릿지 저널 번호(같은 고객 메시지를 두 번 넣지 않게),
    //  deleted = 보낸 뒤 지워진 메시지.
    talk: {
      state: { type: String, enum: ["sending", "sent", "failed"] },
      echoed: { type: Boolean },
      partner: { type: Boolean },
      serial: { type: String },
      seq: { type: Number },
      deleted: { type: Boolean },
    },
    // 대화방이 휴지통으로 가면 같이 표시되어, 대화방과 같은 시점에 TTL 로 영구 삭제된다.
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

liveChatMessageSchema.index({ chatId: 1, seq: 1 }, { unique: true });
liveChatMessageSchema.index({ deletedAt: 1 }, { expireAfterSeconds: TRASH_DAYS * 24 * 60 * 60 });

// 개발 서버(HMR)가 예전 스키마 모델을 들고 있으면 새 필드가 저장 때 버려지므로 개발 중에는 다시 등록한다.
if (process.env.NODE_ENV !== "production" && models.LiveChatMessage) deleteModel("LiveChatMessage");

export const LiveChatMessage = models.LiveChatMessage || model("LiveChatMessage", liveChatMessageSchema);
