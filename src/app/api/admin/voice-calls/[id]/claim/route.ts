import { isValidObjectId } from "mongoose";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { invalidateLiveClaims } from "@/lib/repositories/claimRepository";
import { Claim } from "@/models/Claim";
import { VoiceCall } from "@/models/VoiceCall";

type Params = { params: Promise<{ id: string }> };

// 분석이 끝난 녹취를 응대 자산(클레임, 검토 대기)으로 승격한다.
// 분석 결과에 질문·답변이 이미 있으므로 추가 AI 호출 없이 그대로 옮긴다.
export async function POST(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;
  await connectDB();

  const { id } = await params;
  const call = isValidObjectId(id) ? await VoiceCall.findById(id) : null;
  if (!call) return NextResponse.json({ error: "녹취를 찾을 수 없어요." }, { status: 404 });
  if (call.assetClaimId) return NextResponse.json({ claimId: call.assetClaimId, already: true });
  if (call.status !== "done" || !call.analysis) {
    return NextResponse.json({ error: "분석이 끝난 녹취만 보낼 수 있어요." }, { status: 409 });
  }

  const analysis = call.analysis;
  const situation = (analysis.faqCandidate || analysis.inquiry || analysis.summary || "").trim();
  const csAnswer = (analysis.response || analysis.draftAnswer || "").trim();
  if (!situation || !csAnswer) {
    return NextResponse.json({ error: "분석 결과에 질문·답변이 부족해요. 다시 분석해 주세요." }, { status: 409 });
  }

  // 분석의 "대분류 > 소분류"를 클레임의 카테고리/세부유형으로 나눠 담는다.
  const [category, subcategory] = analysis.category.split(">").map((part: string) => part.trim());
  const callDateLabel = call.callDate
    ? new Date(call.callDate.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
    : "";

  const claim = await Claim.create({
    category: category || "일반문의",
    subcategory: subcategory || "",
    situation,
    keywords: analysis.tags ?? [],
    csAnswer,
    status: "review",
    source: "voice_call",
    note: `전화 녹취${call.phoneNumber ? ` ${call.phoneNumber}` : ""}${callDateLabel ? ` (${callDateLabel})` : ""}에서 승격`,
  });
  invalidateLiveClaims();
  call.assetClaimId = String(claim._id);
  await call.save();

  return NextResponse.json({ claimId: String(claim._id) }, { status: 201 });
}
