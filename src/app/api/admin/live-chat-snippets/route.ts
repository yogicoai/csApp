import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { serializeSnippet, snippetSchema, type SnippetDoc } from "@/lib/liveChatSnippets";
import { LiveChatSnippet } from "@/models/LiveChatSnippet";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    await connectDB();
    const docs = await LiveChatSnippet.find({}).sort({ updatedAt: -1 }).limit(200).lean<SnippetDoc[]>();
    return NextResponse.json({ snippets: docs.map(serializeSnippet) });
  } catch {
    return NextResponse.json({ error: "자주 쓰는 답변을 불러오지 못했습니다." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const parsed = snippetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "제목과 내용을 확인해 주세요." }, { status: 400 });

  await connectDB();
  const doc = await LiveChatSnippet.create(parsed.data);
  return NextResponse.json({ snippet: serializeSnippet(doc) }, { status: 201 });
}
