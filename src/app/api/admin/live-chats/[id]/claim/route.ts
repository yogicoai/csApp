import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { findChatById } from "@/lib/liveChat";
import { maskPersonalInfo } from "@/lib/pii";
import { runClaimDraft } from "@/lib/liveChatAsset";
import { invalidateLiveClaims } from "@/lib/repositories/claimRepository";
import { Claim } from "@/models/Claim";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatMessage } from "@/models/LiveChatMessage";

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

// 해결로 종료한 상담을 응대 자산(클레임, 검토 대기)으로 승격한다.
// AI가 질문·답변 한 쌍으로 일반화해 초안을 만들고, CS가 응대 자산 화면에서 검토 후 라이브로 전환한다.
export async function POST(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const { id } = await params;
  const chat = await findChatById(id);
  if (!chat) return NextResponse.json({ error: "상담을 찾을 수 없습니다." }, { status: 404 });
  if (chat.deletedAt) return NextResponse.json({ error: "휴지통에 있는 상담은 보낼 수 없습니다." }, { status: 409 });
  if (chat.status !== "closed" || chat.outcome?.result !== "resolved") {
    return NextResponse.json({ error: "'해결'로 종료한 상담만 응대 자산으로 보낼 수 있어요." }, { status: 409 });
  }
  if (chat.assetClaimId) {
    return NextResponse.json({ claimId: chat.assetClaimId, already: true });
  }

  const messages = await LiveChatMessage.find({ chatId: chat._id, sender: { $in: ["visitor", "agent"] } })
    .sort({ seq: 1 })
    .lean<Array<{ sender: string; text: string }>>();
  if (!messages.length) return NextResponse.json({ error: "대화 내용이 없어요." }, { status: 409 });

  const transcript = maskPersonalInfo(
    messages.map((message) => `${message.sender === "visitor" ? "고객" : "상담원"}: ${message.text}`).join("\n"),
  );

  try {
    const draft = await runClaimDraft(transcript, {
      inquiryType: chat.intake?.inquiryType,
      faqQuestion: chat.entry?.faqQuestion,
    });
    const claim = await Claim.create({
      category: draft.category || chat.intake?.inquiryType || "",
      subcategory: draft.subcategory,
      situation: draft.situation,
      keywords: draft.keywords,
      csAnswer: draft.csAnswer,
      status: "review",
      source: "live_chat",
      note: `실시간 상담 ${chat.ticketNo || String(chat._id)}에서 승격`,
    });
    invalidateLiveClaims();
    await LiveChat.updateOne({ _id: chat._id }, { $set: { assetClaimId: String(claim._id) } });
    return NextResponse.json(
      { claimId: String(claim._id), draft: { situation: draft.situation, csAnswer: draft.csAnswer } },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "자산 정리에 실패했어요.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
