import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { serializeSnippet, snippetSchema, type SnippetDoc } from "@/lib/liveChatSnippets";
import { LiveChatSnippet } from "@/models/LiveChatSnippet";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = { error: "문구를 찾을 수 없습니다." };

export async function PATCH(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidObjectId(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const parsed = snippetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "제목과 내용을 확인해 주세요." }, { status: 400 });

  await connectDB();
  const doc = await LiveChatSnippet.findByIdAndUpdate(id, { $set: parsed.data }, { returnDocument: "after" }).lean<SnippetDoc | null>();
  if (!doc) return NextResponse.json(NOT_FOUND, { status: 404 });
  return NextResponse.json({ snippet: serializeSnippet(doc) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidObjectId(id)) return NextResponse.json(NOT_FOUND, { status: 404 });

  await connectDB();
  const doc = await LiveChatSnippet.findByIdAndDelete(id);
  if (!doc) return NextResponse.json(NOT_FOUND, { status: 404 });
  return NextResponse.json({ ok: true });
}
