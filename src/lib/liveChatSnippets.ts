import { z } from "zod";

// '자주 쓰는 답변' API 공용 — 입력 검증과 응답 형태.
export const snippetSchema = z.object({
  title: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1).max(1000),
});

export type SnippetDoc = { _id: unknown; title: string; body: string; updatedAt?: Date };

export function serializeSnippet(doc: SnippetDoc) {
  return { id: String(doc._id), title: doc.title, body: doc.body, updatedAt: doc.updatedAt?.toISOString() ?? "" };
}
