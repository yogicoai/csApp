import { Schema, type Model } from "mongoose";
import { connectTokenDB } from "@/lib/cafe24/tokenDb";

// adminChat·yChat 과 동일한 `tokens` 컬렉션을 공유한다(이 앱은 읽기 전용 — 쓰지 않는다).
// 이 모델은 별도 mongoose 연결(CAFE24_TOKEN_MONGODB_URI)에 바인딩되어,
// cs-self-guide 의 일반 데이터와는 독립적으로 토큰 DB 를 향한다.
const cafe24TokenSchema = new Schema(
  {
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
  },
  { timestamps: true, collection: "tokens" },
);

export type Cafe24TokenDoc = {
  accessToken: string;
  refreshToken: string;
  updatedAt?: Date;
};

// 각 요청에서 연결을 확보한 뒤 모델을 발급. 서버리스 인스턴스 재사용 시 캐시된 모델을 반환.
export async function getCafe24TokenModel(): Promise<Model<Cafe24TokenDoc>> {
  const conn = await connectTokenDB();
  return (
    (conn.models.Cafe24Token as Model<Cafe24TokenDoc> | undefined) ??
    conn.model<Cafe24TokenDoc>("Cafe24Token", cafe24TokenSchema)
  );
}
