import { getCafe24TokenModel } from "@/models/Cafe24Token";

// ─────────────────────────────────────────────────────────────
// Cafe24 Admin API 클라이언트 — 토큰은 '읽기 전용'
// ─────────────────────────────────────────────────────────────
// cafe24 refresh_token 은 1회용(rotation)이라, 갱신은 adminChat(매시 30분 keepalive)·yChat(정각)만 맡는다.
// 세 번째 앱이 갱신하면 서로 invalid_grant 를 일으켜 모든 앱의 cafe24 연동이 끊길 수 있으므로
// 이 앱은 공유 tokens 컬렉션에서 access_token 을 읽기만 하고, 절대 갱신·저장하지 않는다.
//  • access_token 은 60초 캐시(서버리스 인스턴스 단위)
//  • 401 이면 다른 앱이 방금 갱신했을 수 있어 DB 를 다시 읽고(필요하면 잠깐 기다린 뒤) 1회 재시도
// ─────────────────────────────────────────────────────────────

const CAFE24_MALLID = process.env.CAFE24_MALLID;
const CAFE24_API_VERSION = process.env.CAFE24_API_VERSION ?? "2025-12-01";
// 테스트·스테이징에서 cafe24 대신 모의 서버를 붙일 때만 쓴다(비우면 https://{mallid}.cafe24api.com).
const CAFE24_API_BASE_URL = process.env.CAFE24_API_BASE_URL?.replace(/\/$/, "");
const TOKEN_CACHE_MS = 60_000;
// 다른 앱이 갱신 중이면 새 토큰이 DB 에 저장될 때까지 잠깐 기다렸다 다시 읽는다.
const REFRESH_SETTLE_MS = 1500;

let tokenCache: { accessToken: string; at: number } | null = null;

export function isCafe24Configured() {
  return Boolean(CAFE24_MALLID);
}

async function readAccessToken({ fresh = false } = {}): Promise<string | null> {
  if (!fresh && tokenCache && Date.now() - tokenCache.at < TOKEN_CACHE_MS) return tokenCache.accessToken;

  const Token = await getCafe24TokenModel();
  const doc = await Token.findOne({})
    .sort({ updatedAt: -1 })
    .select({ accessToken: 1 })
    .lean<{ accessToken?: string } | null>();
  if (!doc?.accessToken) {
    tokenCache = null;
    return null;
  }
  tokenCache = { accessToken: doc.accessToken, at: Date.now() };
  return doc.accessToken;
}

type QueryValue = string | number | boolean | undefined;

// GET 쿼리 파라미터 조립
function buildQuery(params: Record<string, QueryValue>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.append(k, String(v));
  }
  return sp.toString();
}

export class Cafe24ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type Cafe24RequestOptions = {
  method?: "GET" | "POST" | "PUT";
  params?: Record<string, QueryValue>;
  body?: unknown;
};

// 인증 헤더 붙여 cafe24 admin API 호출. 401 이면 DB 의 최신 토큰을 다시 읽어 1회 재시도(갱신은 하지 않음).
export async function cafe24Request<T>(path: string, opts: Cafe24RequestOptions = {}): Promise<T> {
  if (!isCafe24Configured()) {
    throw new Error("Cafe24 환경변수 미설정 (CAFE24_MALLID)");
  }

  const { method = "GET", params, body } = opts;
  const query = params ? `?${buildQuery(params)}` : "";
  const url = `${CAFE24_API_BASE_URL ?? `https://${CAFE24_MALLID}.cafe24api.com`}${path}${query}`;

  const accessToken = await readAccessToken();
  if (!accessToken) throw new Error("Cafe24 access_token 없음 (공유 tokens 컬렉션 확인 필요)");

  const performRequest = async (token: string) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Cafe24-Api-Version": CAFE24_API_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let response = await performRequest(accessToken);

  if (response.status === 401) {
    // adminChat·yChat 이 방금 갱신했을 수 있다 → 캐시를 버리고 DB 재조회, 그대로면 잠깐 기다렸다 한 번 더.
    let latest = await readAccessToken({ fresh: true });
    if (latest === accessToken) {
      await new Promise((resolve) => setTimeout(resolve, REFRESH_SETTLE_MS));
      latest = await readAccessToken({ fresh: true });
    }
    if (latest && latest !== accessToken) {
      response = await performRequest(latest);
    }
  }

  if (response.status === 401) {
    tokenCache = null;
    throw new Cafe24ApiError("Cafe24 API 401: 공유 토큰이 만료됐어요. adminChat 의 자동 갱신(keepalive)이 동작하는지 확인해 주세요.", 401);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Cafe24ApiError(`Cafe24 API ${response.status}: ${detail.slice(0, 300)}`, response.status);
  }

  return (await response.json()) as T;
}
