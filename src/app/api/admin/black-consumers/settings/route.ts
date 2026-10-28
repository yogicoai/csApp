import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { isRetentionMonths } from "@/lib/blackConsumer";
import { blackInputError, getBlackSettings } from "@/lib/blackConsumerServer";
import { connectDB } from "@/lib/db";
import { BlackConsumerSetting } from "@/models/BlackConsumerSetting";

const settingsSchema = z.object({
  criteria: z.string().trim().max(2000),
  defaultMonths: z.number().int().refine(isRetentionMonths),
});

// 운영 기준 저장 — CS팀이 정한 등록·해제 기준 글과, 새로 등록할 때 기본으로 고를 주의 표시 기간
export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: blackInputError(parsed.error) }, { status: 400 });
  try {
    await connectDB();
    await BlackConsumerSetting.updateOne({ _id: "default" }, { $set: parsed.data }, { upsert: true });
    return NextResponse.json({ settings: await getBlackSettings() });
  } catch {
    return NextResponse.json({ error: "운영 기준을 저장하지 못했어요." }, { status: 503 });
  }
}
