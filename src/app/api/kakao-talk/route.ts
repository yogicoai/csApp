import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { getClientIp } from "@/lib/ipBlock";
import {
  claimKakaoSignal,
  kakaoConfig,
  receiveKakaoSignal,
  releaseKakaoSignal,
  verifyKakaoSignature,
} from "@/lib/kakaoTalk";
import { TalkWebhookLog } from "@/models/TalkWebhookLog";

// 형식이 조금 달라도 신호 전체를 버리지 않게 너그럽게 읽는다 — 못 읽은 값은 없는 것으로.
const looseText = (max: number) => z.preprocess((value) => (typeof value === "string" ? value.slice(0, max) : undefined), z.string().optional());
const looseNumber = z.preprocess((value) => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}, z.number().optional());
const looseObject = <T extends z.ZodRawShape>(shape: T) =>
  z.preprocess((value) => (value && typeof value === "object" && !Array.isArray(value) ? value : undefined), z.object(shape).optional());

const signalSchema = z.object({
  brand: z.string().min(1).max(200),
  userKey: z.string().min(1).max(200),
  kind: z.string().min(1).max(40),
  seq: looseNumber,
  serial: looseText(200),
  phase: looseText(40),
  test: z.preprocess((value) => value === true || undefined, z.boolean().optional()),
  extra: looseText(1000),
  reference: looseObject({ extra: looseText(1000) }),
  lastReference: looseObject({ extra: looseText(1000), bot: looseText(20), botEvent: looseText(100) }),
  personalInfo: looseObject({ phoneNumber: looseText(40), nickname: looseText(100) }),
  consentedAt: looseNumber,
});

// 카카오 상담톡(톡브릿지) 웹훅 — 서명이 맞는 요청만 받는다. 톡브릿지는 2xx 가 아니면(4xx 포함) 다시 보내므로
// 처리한 신호·무시할 신호는 200, 서명이 틀리면 401(다시 와도 계속 거절), 처리하다 실패하면 500(재시도 때 다시 처리).
//  같은 신호는 전달 ID(X-Bridge-Delivery-Id)로 한 번만 처리한다. 받은 결과는 TalkWebhookLog(account "kakao")에 남긴다(내용은 안 남김).
export async function POST(request: Request) {
  const config = kakaoConfig();
  const raw = Buffer.from(await request.arrayBuffer());
  let kind = request.headers.get("x-bridge-event")?.slice(0, 40) ?? "";
  const log = async (status: number) => {
    if (config && status !== 404) {
      await connectDB()
        .then(() => TalkWebhookLog.create({ account: "kakao", event: kind, status, ip: getClientIp(request) }))
        .catch((error: unknown) => console.warn("[kakao-talk] 받은 기록을 남기지 못함", error));
    }
    return new NextResponse(null, { status });
  };

  if (!config) return log(404);
  const ok = verifyKakaoSignature(
    raw,
    request.headers.get("x-bridge-timestamp") ?? "",
    request.headers.get("x-bridge-signature") ?? "",
    config.webhookSecret,
  );
  if (!ok) return log(401);

  let body: unknown = null;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    body = null;
  }
  const parsed = signalSchema.safeParse(body);
  if (!parsed.success) return log(400);
  const signal = parsed.data;
  kind = signal.kind;
  // 톡브릿지 센터 [연결 테스트]의 수신 테스트 — 서명·응답만 확인한다(가상 고객이라 조회·답장이 안 됨).
  if (signal.test) return log(200);

  const deliveryId = (request.headers.get("x-bridge-delivery-id") ?? "").slice(0, 100);
  const key = deliveryId
    ? `delivery:${deliveryId}`
    : typeof signal.seq === "number"
      ? `seq:${signal.brand}:${signal.kind}:${signal.seq}`
      : "";
  if (key && !(await claimKakaoSignal(key, signal.kind).catch(() => true))) return log(200);

  try {
    await receiveKakaoSignal(signal, config);
  } catch (error) {
    console.error("[kakao-talk] 신호 처리 실패", signal.kind, error instanceof Error ? error.message : error);
    if (key) await releaseKakaoSignal(key);
    return log(500);
  }
  return log(200);
}
