import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import {
  appendMessage,
  createVisitorToken,
  getMessagesAfter,
  LIVE_CHAT_MAX_TEXT,
  LIVE_CHAT_MESSAGES,
  nextTicketNo,
  normalizeMobile,
  receiptMessage,
  spamBlockKeys,
  visitorView,
} from "@/lib/liveChat";
import { todayClosureState, upcomingOpenLabel } from "@/lib/liveChatClosures";
import { isLiveChatOpen } from "@/lib/liveChatHours";
import { PURCHASE_PLACE_KEYS } from "@/lib/liveChatOptions";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatBlock } from "@/models/LiveChatBlock";

const startSchema = z.object({
  channel: z.string().min(1).max(40),
  sessionId: z.string().max(100).optional(),
  memberId: z.string().max(100).optional(),
  text: z.string().trim().min(1).max(LIVE_CHAT_MAX_TEXT),
  entry: z
    .object({
      faqId: z.string().max(40).optional(),
      faqQuestion: z.string().max(300).optional(),
      category: z.string().max(60).optional(),
      aiQuery: z.string().max(300).optional(),
    })
    .optional(),
  intake: z
    .object({
      purchasePlace: z.enum(PURCHASE_PLACE_KEYS).optional(),
      inquiryType: z.string().trim().max(60).optional(),
      orderNumber: z.string().trim().max(40).optional(),
    })
    .optional(),
  source: z
    .object({
      via: z.string().max(20),
      app: z.string().max(20),
      embedded: z.boolean(),
      parentOrigin: z.string().max(200),
      referrer: z.string().max(200),
      param: z.string().max(20),
    })
    .partial()
    .optional(),
  // 운영시간 외·휴무 문의 접수 — 답변 안내 문자를 받을 휴대폰과 개인정보 수집·이용 동의
  contact: z.object({ phone: z.string().trim().max(20), consent: z.boolean() }).optional(),
});

// 실시간 상담 시작 — 대화방을 만들고 고객의 첫 메시지와 자동 안내를 남긴다.
// 운영시간 외·상담사 휴무 시간에는 실시간 대화 대신 '문의 접수'로 받는다: 휴대폰·동의가 있어야 하고, 답변은 문자 링크로 안내한다.
// 응답의 token 은 고객 브라우저에만 보관되며, 이후 고객 API 호출 시 헤더로 보낸다.
export async function POST(request: Request) {
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "메시지를 확인해 주세요." }, { status: 400 });
  }
  const { text, contact: contactInput, ...payload } = parsed.data;

  try {
    await connectDB();
    // 상담원이 스팸으로 지운 고객(회원ID·같은 브라우저 세션)은 차단 기간 동안 새 상담을 시작할 수 없다.
    const blockKeys = spamBlockKeys(payload);
    if (blockKeys.length && (await LiveChatBlock.exists({ key: { $in: blockKeys }, until: { $gt: new Date() } }))) {
      return NextResponse.json(
        { error: "지금은 실시간 채팅상담을 시작할 수 없어요. 대표번호로 문의해 주세요." },
        { status: 403 },
      );
    }
    // 상담사(1인) 연차·반차 시간도 운영시간 외와 같이 실시간 대화는 닫고 문의 접수만 받는다.
    const closure = await todayClosureState();
    const offHours = !isLiveChatOpen() || Boolean(closure?.closedNow);
    const phone = normalizeMobile(contactInput?.phone ?? "");
    if (offHours && (!phone || !contactInput?.consent)) {
      return NextResponse.json(
        { error: "지금은 문의 접수만 받고 있어요. 답변 안내를 받을 휴대폰 번호와 개인정보 수집·이용 동의가 필요해요.", needContact: true },
        { status: 400 },
      );
    }
    const token = createVisitorToken();
    const ticketNo = await nextTicketNo();
    const chat = await LiveChat.create({
      ...payload,
      ticketNo,
      visitorToken: token,
      offHours,
      ...(offHours ? { contact: { phone, consentAt: new Date() } } : {}),
    });

    await appendMessage(chat._id, "visitor", text);
    const result = await appendMessage(
      chat._id,
      "system",
      offHours ? receiptMessage(await upcomingOpenLabel(), phone) : LIVE_CHAT_MESSAGES.waiting,
    );
    const messages = await getMessagesAfter(chat._id, 0);

    return NextResponse.json(
      { chat: visitorView(result?.chat ?? chat), token, messages },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "실시간 상담을 연결하지 못했어요. 잠시 후 다시 시도하시거나 전화로 문의해 주세요." },
      { status: 503 },
    );
  }
}
