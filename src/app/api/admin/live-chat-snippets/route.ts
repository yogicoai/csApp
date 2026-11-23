import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { connectDB } from "@/lib/db";
import { DEFAULT_SNIPPETS, sortSnippets } from "@/lib/liveChatOptions";
import { serializeSnippet, snippetSchema, type SnippetDoc } from "@/lib/liveChatSnippets";
import { LiveChatSnippet } from "@/models/LiveChatSnippet";

type SeedMark = { _id: string; keys?: string[] };

// 기본 문구는 문구마다 한 번만 넣는다 — 넣은 이름(key)을 표시해 두어, 고친 문구는 그대로 두고 지운 문구는 다시 생기지 않는다.
// 표시를 먼저 차지한 요청만 넣어서, 화면 두 개가 동시에 처음 열려도 두 번 들어가지 않는다.
async function seedDefaultSnippets() {
  const marks = LiveChatSnippet.db.collection<SeedMark>("livechatsnippetsettings");
  const keys = DEFAULT_SNIPPETS.map((snippet) => snippet.key);
  const mark = await marks.findOne({ _id: "seeded" });
  if (mark && keys.every((key) => mark.keys?.includes(key))) return;

  let before: SeedMark | null;
  try {
    before = await marks.findOneAndUpdate(
      { _id: "seeded" },
      { $set: { at: new Date() }, $addToSet: { keys: { $each: keys } } },
      { upsert: true, returnDocument: "before" },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return; // 다른 요청이 같은 순간 표시를 만들었다 — 그쪽이 넣는다.
    throw error;
  }
  const done = new Set(before?.keys ?? []);
  const fresh = DEFAULT_SNIPPETS.filter((snippet) => !done.has(snippet.key));
  if (!fresh.length) return;
  try {
    await LiveChatSnippet.insertMany(fresh.map((snippet) => ({ title: snippet.title, body: snippet.body, defaultKey: snippet.key })));
  } catch (error) {
    // 넣지 못했으면 표시를 되돌려 다음에 다시 넣게 한다.
    await marks.updateOne({ _id: "seeded" }, { $pull: { keys: { $in: fresh.map((snippet) => snippet.key) } } });
    throw error;
  }
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    await connectDB();
    await seedDefaultSnippets();
    const docs = await LiveChatSnippet.find({}).sort({ updatedAt: -1 }).limit(200).lean<SnippetDoc[]>();
    return NextResponse.json({ snippets: sortSnippets(docs.map(serializeSnippet)) });
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
