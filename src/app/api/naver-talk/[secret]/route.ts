import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { getClientIp } from "@/lib/ipBlock";
import {
  isTalkSourceAllowed,
  talkAccountBySecret,
  receiveTalkEcho,
  receiveTalkMessage,
} from "@/lib/naverTalk";
import { TalkWebhookLog } from "@/models/TalkWebhookLog";

type RouteContext = { params: Promise<{ secret: string }> };

// 톡톡이 보내는 이벤트 중 상담에 쓰는 값만 읽는다(나머지 필드는 버린다).
const eventSchema = z.object({
  event: z.string().max(40),
  user: z.string().min(1).max(200).optional(),
  echoedEvent: z.string().max(40).optional(),
  textContent: z.object({ text: z.string().optional(), inputType: z.string().max(40).optional() }).optional(),
  imageContent: z.object({ imageUrl: z.string().max(2000).optional() }).optional(),
  compositeContent: z
    .object({ compositeList: z.array(z.object({ title: z.string().optional(), description: z.string().optional() })).optional() })
    .optional(),
  options: z.object({ product: z.object({ name: z.string().optional(), url: z.string().max(2000).optional() }).optional() }).optional(),
});

// 네이버 톡톡 웹훅 — 주소 끝의 비밀값으로 어느 톡톡 계정인지 찾고, 맞는 계정이 없으면 받지 않는다. 톡톡은 200 이 아니면 실패로 기록하므로 처리한 이벤트는 본문 없이 200.
//  send: 고객 메시지 → 실시간 상담 / echo: 보낸 메시지 사본(파트너센터에서 보낸 것만 대화에 남김) / 그 밖(open·leave·friend…)은 받기만 한다.
//  받은 결과는 TalkWebhookLog 에 남긴다(계정·이벤트·IP·응답만, 내용은 안 남김) — 네이버가 보내는지, 어디서 막히는지 점검용.
export async function POST(request: Request, context: RouteContext) {
  const { secret } = await context.params;
  const account = talkAccountBySecret(secret);
  const body = await request.json().catch(() => null);
  const eventName = typeof body?.event === "string" ? body.event.slice(0, 40) : "";
  const log = async (status: number) => {
    // 비밀값이 맞는 계정이 없는 요청(아무나 두드린 주소)은 남기지 않는다.
    if (account) {
      await connectDB()
        .then(() => TalkWebhookLog.create({ account: account.key, event: eventName, status, ip: getClientIp(request) }))
        .catch((error: unknown) => console.warn("[naver-talk] 받은 기록을 남기지 못함", error));
    }
    return new NextResponse(null, { status });
  };

  if (!account) return log(404);
  if (!isTalkSourceAllowed(request)) return log(403);
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return log(400);

  const { user, ...event } = parsed.data;
  try {
    if (user && event.event === "send") await receiveTalkMessage({ ...event, user }, account);
    else if (user && event.event === "echo" && (event.echoedEvent ?? "send") === "send") await receiveTalkEcho({ ...event, user }, account);
  } catch {
    return log(500);
  }
  return log(200);
}
