import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { accessContext, recordAccessQuietly, sessionTag } from "@/lib/accessLogServer";
import { ADMIN_COOKIE, SESSION_TTL_MS, createSession, verifyPin } from "@/lib/adminAuth";

const schema = z.object({ pin: z.string().min(1) });

// 로그인 — 성공·실패를 조회 기록에 남긴다(접속 IP, 성공이면 새 세션 표시).
export async function POST(request: Request) {
  const { pin } = schema.parse(await request.json());
  const context = await accessContext();

  if (!(await verifyPin(pin))) {
    await recordAccessQuietly({ action: "login_failed" }, context);
    return NextResponse.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const { token, expiresAt } = await createSession();
  await recordAccessQuietly({ action: "login" }, { ...context, session: sessionTag(token) });
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return NextResponse.json({ ok: true });
}
