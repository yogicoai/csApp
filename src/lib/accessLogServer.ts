import { createHash } from "node:crypto";
import type { Types } from "mongoose";
import { cookies, headers } from "next/headers";
import type { AccessAction, AccessLogView } from "@/lib/accessLog";
import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { OPERATOR_COOKIE, OPERATOR_MAX } from "@/lib/operator";
import { AccessLog } from "@/models/AccessLog";

export type AccessContext = { operator: string; ip: string; session: string; userAgent: string };

type AccessLogRecord = {
  _id: Types.ObjectId;
  action: string;
  operator?: string;
  target?: string;
  detail?: string;
  ip?: string;
  session?: string;
  userAgent?: string;
  createdAt?: Date;
};

// 로그인 세션 토큰은 그대로 남기지 않고 해시 앞 8자리만(같은 로그인에서 한 일끼리 묶어 보는 용도)
export function sessionTag(token: string) {
  return token ? createHash("sha256").update(token).digest("hex").slice(0, 8) : "";
}

// 이 요청을 누가 보냈는지 — 처리하는 사람(쿠키)·접속 IP(Vercel 은 x-forwarded-for 첫 값)·로그인 세션·브라우저
export async function accessContext(): Promise<AccessContext> {
  const [jar, hdrs] = await Promise.all([cookies(), headers()]);
  let operator = "";
  try {
    operator = decodeURIComponent(jar.get(OPERATOR_COOKIE)?.value ?? "").trim().slice(0, OPERATOR_MAX);
  } catch {
    operator = "";
  }
  return {
    operator,
    ip: (hdrs.get("x-forwarded-for")?.split(",")[0] ?? hdrs.get("x-real-ip") ?? "").trim().slice(0, 64),
    session: sessionTag(jar.get(ADMIN_COOKIE)?.value ?? ""),
    userAgent: (hdrs.get("user-agent") ?? "").slice(0, 160),
  };
}

type AccessEntry = { action: AccessAction; target?: string; detail?: string };

// 기록 남기기 — 개인정보를 보여 주기 전에 부르고, 실패하면 던진다(자세히 보기·내려받기는 기록 없이는 보여 주지 않는다).
export async function recordAccess(entry: AccessEntry, context?: AccessContext) {
  const ctx = context ?? (await accessContext());
  await connectDB();
  await AccessLog.create({ action: entry.action, target: entry.target ?? "", detail: (entry.detail ?? "").slice(0, 300), ...ctx });
}

// 표시만 하는 기록(가린 조회·로그인 등) — 실패해도 하던 일은 계속한다.
export async function recordAccessQuietly(entry: AccessEntry, context?: AccessContext) {
  try {
    await recordAccess(entry, context);
  } catch (error) {
    console.warn("[access-log] 기록을 남기지 못했어요", error);
  }
}

// 같은 로그인에서 같은 대상을 최근에 이미 남겼으면 건너뛴다(녹취를 앞뒤로 넘겨 들을 때 여러 줄 쌓이지 않게).
export async function recordAccessOnce(entry: AccessEntry & { detail: string }, withinMs: number) {
  try {
    const ctx = await accessContext();
    await connectDB();
    const recent = await AccessLog.exists({
      action: entry.action,
      detail: entry.detail,
      session: ctx.session,
      createdAt: { $gte: new Date(Date.now() - withinMs) },
    });
    if (!recent) await recordAccess(entry, ctx);
  } catch (error) {
    console.warn("[access-log] 기록을 남기지 못했어요", error);
  }
}

export function serializeAccessLog(log: AccessLogRecord): AccessLogView {
  return {
    id: String(log._id),
    at: log.createdAt?.toISOString() ?? "",
    action: log.action,
    operator: log.operator ?? "",
    target: log.target ?? "",
    detail: log.detail ?? "",
    ip: log.ip ?? "",
    session: log.session ?? "",
    userAgent: log.userAgent ?? "",
  };
}

export type { AccessLogRecord };
