// 드롭박스 — 통화 녹음 원본을 회사 공용 드롭박스에 보관한다(3년 보관, 앱 DB 에는 분석 자료만).
//  · 올리기: 서버가 임시 업로드 주소를 받아 주고 브라우저가 그 주소로 바로 올린다(Vercel 요청 크기 제한 4.5MB 를 피함).
//  · 분석: 서버가 드롭박스에서 받아 전사한다 / 다시 듣기: 몇 시간짜리 임시 재생 주소로 넘긴다(공개 링크 없음).
// 키: DROPBOX_APP_KEY·DROPBOX_APP_SECRET·DROPBOX_REFRESH_TOKEN(처음 한 번 '허용'으로 받는 오래 쓰는 키).
// 회사 계정은 팀 스페이스라, 팀 공용 폴더 경로("/2026_요기코퍼레이션…/csVoice")를 쓰도록 루트 네임스페이스를 기준으로 부른다.

const API = process.env.DROPBOX_API_URL || "https://api.dropboxapi.com";
const CONTENT = process.env.DROPBOX_CONTENT_URL || "https://content.dropboxapi.com";
export const VOICE_FOLDER = (
  process.env.DROPBOX_VOICE_FOLDER || "/2026_요기코퍼레이션_온라인·마케팅·디자인/04_개발/cs/csVoice"
).replace(/\/+$/, "");

export class DropboxError extends Error {}

export function isDropboxConfigured() {
  return Boolean(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN);
}

type Session = { token: string; expiresAt: number; pathRoot: string };
let session: Session | null = null;

// 드롭박스 헤더(Dropbox-API-Arg·Path-Root)는 ASCII 만 받아 한글은 \uXXXX 로 적는다.
function headerJson(value: unknown) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

async function failure(response: Response, what: string) {
  const text = await response.text().catch(() => "");
  return new DropboxError(`드롭박스 ${what} 실패(${response.status})${text ? `: ${text.slice(0, 160)}` : ""}`);
}

async function getSession(): Promise<Session> {
  if (session && session.expiresAt > Date.now() + 60_000) return session;
  const { DROPBOX_APP_KEY: key, DROPBOX_APP_SECRET: secret, DROPBOX_REFRESH_TOKEN: refresh } = process.env;
  if (!key || !secret || !refresh) throw new DropboxError("드롭박스 연결 설정(DROPBOX_*)이 없어요.");
  const response = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  if (!response.ok) throw await failure(response, "로그인");
  const body = (await response.json()) as { access_token: string; expires_in?: number };

  const account = await fetch(`${API}/2/users/get_current_account`, {
    method: "POST",
    headers: { Authorization: `Bearer ${body.access_token}` },
  });
  if (!account.ok) throw await failure(account, "계정 확인");
  const info = (await account.json()) as { root_info?: { root_namespace_id?: string; home_namespace_id?: string } };
  const root = info.root_info?.root_namespace_id ?? "";
  session = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 14_400) * 1000,
    pathRoot: root && root !== info.root_info?.home_namespace_id ? root : "",
  };
  return session;
}

async function authHeaders() {
  const current = await getSession();
  return {
    Authorization: `Bearer ${current.token}`,
    ...(current.pathRoot ? { "Dropbox-API-Path-Root": headerJson({ ".tag": "root", root: current.pathRoot }) } : {}),
  };
}

async function rpc<T>(endpoint: string, args: unknown, what: string): Promise<T> {
  const response = await fetch(`${API}/2/${endpoint}`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw await failure(response, what);
  return (await response.json()) as T;
}

// 녹음 폴더 안의 경로인지 — 다른 경로의 파일을 읽거나 재생하지 못하게 막는다.
export function isVoicePath(path: string) {
  return path.startsWith(`${VOICE_FOLDER}/`) && !path.includes("/../") && !path.includes("\\");
}

async function pathExists(path: string) {
  const response = await fetch(`${API}/2/files/get_metadata`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (response.ok) return true;
  if (response.status === 409) return false; // path/not_found
  throw await failure(response, "파일 확인");
}

// 비어 있는 경로 — 같은 이름이 있으면 " (2)", " (3)"… 을 붙인다. 드롭박스 업로드 주소는 올린 경로를 돌려주지 않으므로
// 우리가 정한 경로 그대로 저장되게(드롭박스가 이름을 바꾸지 못하게) 미리 빈 이름을 찾는다.
export async function freePath(path: string) {
  if (!(await pathExists(path))) return path;
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const [base, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  for (let n = 2; n <= 20; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new DropboxError("같은 이름의 녹음이 너무 많아요. 파일 이름을 바꿔 올려 주세요.");
}

// 브라우저가 바로 올릴 임시 주소(1시간) — 정한 경로에 그대로 저장한다(이미 있으면 업로드가 실패).
export async function temporaryUploadLink(path: string) {
  const body = await rpc<{ link: string }>(
    "files/get_temporary_upload_link",
    { commit_info: { path, mode: "add", autorename: false, mute: true }, duration: 3600 },
    "업로드 주소 받기",
  );
  return body.link;
}

export async function downloadFile(path: string) {
  const response = await fetch(`${CONTENT}/2/files/download`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Dropbox-API-Arg": headerJson({ path }) },
  });
  if (!response.ok) throw await failure(response, "파일 받기");
  return Buffer.from(await response.arrayBuffer());
}

// 다시 듣기용 임시 주소(4시간) — 공개 공유 링크를 만들지 않는다.
export async function temporaryLink(path: string) {
  const body = await rpc<{ link: string }>("files/get_temporary_link", { path }, "재생 주소 받기");
  return body.link;
}
