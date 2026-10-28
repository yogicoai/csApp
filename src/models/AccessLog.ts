import { deleteModel, model, models, Schema } from "mongoose";
import { ACCESS_LOG_KEEP_DAYS } from "@/lib/accessLog";

// 조회 기록(개인정보 접속기록) — 고칠 일이 없는 기록이라 만든 시각만 두고, 2년이 지나면 TTL 로 지운다.
const accessLogSchema = new Schema(
  {
    action: { type: String, required: true, index: true }, // lib/accessLog 의 ACCESS_ACTIONS key
    operator: { type: String, default: "" }, // 처리하는 사람(화면에서 적은 이름)
    target: { type: String, default: "", index: true }, // 본 고객의 번호(숫자만) — 없으면 빈값
    detail: { type: String, default: "" }, // 무엇을 봤는지(건수·녹취·파일 등)
    ip: { type: String, default: "" },
    session: { type: String, default: "" }, // 로그인 세션을 가린 값(해시 앞 8자리) — 같은 로그인에서 한 일끼리 묶어 본다
    userAgent: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

accessLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: ACCESS_LOG_KEEP_DAYS * 24 * 60 * 60 });

if (process.env.NODE_ENV !== "production" && models.AccessLog) deleteModel("AccessLog");
export const AccessLog = models.AccessLog || model("AccessLog", accessLogSchema);
