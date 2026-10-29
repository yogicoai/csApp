import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isTalkSourceAllowed,
  talkAccountBySecret,
  receiveTalkEcho,
  receiveTalkMessage,
} from "@/lib/naverTalk";

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
export async function POST(request: Request, context: RouteContext) {
  const { secret } = await context.params;
  const account = talkAccountBySecret(secret);
  if (!account) return new NextResponse(null, { status: 404 });
  if (!isTalkSourceAllowed(request)) return new NextResponse(null, { status: 403 });
  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const { user, ...event } = parsed.data;
  try {
    if (user && event.event === "send") await receiveTalkMessage({ ...event, user }, account);
    else if (user && event.event === "echo" && (event.echoedEvent ?? "send") === "send") await receiveTalkEcho({ ...event, user }, account);
  } catch {
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 200 });
}
