import mongoose from "mongoose";

// cafe24 토큰은 adminChat·yChat 이 갱신해 공유 DB 의 tokens 컬렉션에 저장한다.
// 이 앱은 그 컬렉션을 '읽기만' 한다(갱신·저장하지 않음 — refresh_token 이 1회용이라 충돌 방지).
//
// ⚠️ 중요: yogiChat 은 DB 이름을 URI 경로가 아니라 별도의 DB_NAME 환경변수로 지정한다
//   ( client.db(DB_NAME) ). 그래서 URI 만으로 mongoose 연결을 만들면 엉뚱한 기본 DB 에
//   붙어 tokens 컬렉션을 못 찾는다. → CAFE24_TOKEN_DB_NAME 으로 DB 이름을 명시한다.
//
// 필요한 환경변수:
//   CAFE24_TOKEN_MONGODB_URI  = yogiChat 의 MONGODB_URI (클러스터 접속 문자열)
//   CAFE24_TOKEN_DB_NAME      = yogiChat 의 DB_NAME (예: "yogibo")
// (개발 편의: 위 값이 없으면 각각 MONGODB_URI / URI 기본 DB 로 fallback)
const CAFE24_TOKEN_MONGODB_URI = process.env.CAFE24_TOKEN_MONGODB_URI ?? process.env.MONGODB_URI;
const CAFE24_TOKEN_DB_NAME = process.env.CAFE24_TOKEN_DB_NAME;

type CachedConnection = {
  conn: mongoose.Connection | null;
  promise: Promise<mongoose.Connection> | null;
};

const globalWithTokenDb = global as typeof globalThis & {
  cafe24TokenDb?: CachedConnection;
};

const cached = globalWithTokenDb.cafe24TokenDb ?? { conn: null, promise: null };
globalWithTokenDb.cafe24TokenDb = cached;

export async function connectTokenDB(): Promise<mongoose.Connection> {
  if (cached.conn) return cached.conn;

  if (!CAFE24_TOKEN_MONGODB_URI) {
    throw new Error("CAFE24_TOKEN_MONGODB_URI 또는 MONGODB_URI 가 필요합니다.");
  }

  const options: mongoose.ConnectOptions = { bufferCommands: false };
  // DB 이름이 명시되면 URI 경로 값 대신 이 이름으로 접속한다.
  if (CAFE24_TOKEN_DB_NAME) {
    options.dbName = CAFE24_TOKEN_DB_NAME;
  }

  cached.promise ??= mongoose.createConnection(CAFE24_TOKEN_MONGODB_URI, options).asPromise();

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    // 실패한 연결을 계속 들고 있으면 서버를 다시 켤 때까지 조회가 전부 실패하므로, 다음 요청에서 새로 연결한다.
    cached.promise = null;
    throw error;
  }
  return cached.conn;
}
