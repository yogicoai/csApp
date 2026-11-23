import { deleteModel, model, models, Schema } from "mongoose";

// 카카오 상담톡(톡브릿지) 웹훅을 처리했다는 표시 — 톡브릿지는 같은 신호를 여러 번 보낼 수 있어(재시도) 한 번만 처리하려고 남긴다.
//  key: 전달 ID(X-Bridge-Delivery-Id, 재시도해도 같음) — 없으면 브랜드·종류·저널 번호. 처리에 실패하면 지워서 재시도 때 다시 처리한다.
//  내용(메시지 글)은 남기지 않는다. 14일 지나면 지운다.
const kakaoSignalSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    kind: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
kakaoSignalSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

if (process.env.NODE_ENV !== "production" && models.KakaoSignal) deleteModel("KakaoSignal");
export const KakaoSignal = models.KakaoSignal || model("KakaoSignal", kakaoSignalSchema);
