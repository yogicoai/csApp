import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { addMonths, BLACK_REASON_KEYS, isRetentionMonths, reasonLabel } from "@/lib/blackConsumer";
import {
  blackInputError,
  type BlackConsumerRecord,
  blackStatus,
  findCurrentEntries,
  serializeBlackConsumer,
} from "@/lib/blackConsumerServer";
import { connectDB } from "@/lib/db";
import { kstToday } from "@/lib/liveChatHours";
import { formatPhone, isPhoneDigits, phoneDigits } from "@/lib/phone";
import { BlackConsumer } from "@/models/BlackConsumer";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = { error: "블랙컨슈머 등록을 찾을 수 없어요." };
const by = z.string().trim().min(1).max(20);
const months = z.number().int().refine(isRetentionMonths);

// edit: 내용 고치기 · extend: 기간 연장 · release: 해제(사유 필수) · reopen: 기간 끝·해제된 고객을 다시 주의로
const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit"),
    by,
    phone: z.string().trim().max(40).default(""),
    memberId: z.string().trim().max(60).default(""),
    name: z.string().trim().max(40).default(""),
    reasons: z.array(z.enum(BLACK_REASON_KEYS)).min(1).max(BLACK_REASON_KEYS.length),
    detail: z.string().trim().min(1).max(1000),
    refs: z.string().trim().max(200).default(""),
  }),
  z.object({ action: z.literal("extend"), by, months }),
  z.object({ action: z.literal("release"), by, note: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal("reopen"), by, months }),
]);

// 같은 고객이 다른 등록으로 이미 주의 중인지(자기 자신은 뺀다)
async function otherCurrent(entry: BlackConsumerRecord, phone: string, memberId: string) {
  const found = await findCurrentEntries({ phones: [phone], memberIds: [memberId], talkUsers: [entry.talkUser ?? ""] });
  return found.find((other) => String(other._id) !== String(entry._id));
}

export async function PATCH(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidObjectId(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: blackInputError(parsed.error) }, { status: 400 });
  const body = parsed.data;

  try {
    await connectDB();
    const entry = await BlackConsumer.findById(id).lean<BlackConsumerRecord | null>();
    if (!entry) return NextResponse.json(NOT_FOUND, { status: 404 });
    const today = kstToday();
    const status = blackStatus(entry, today);
    let update: Record<string, unknown>;

    if (body.action === "edit") {
      const phone = phoneDigits(body.phone);
      if (body.phone && !isPhoneDigits(phone)) return NextResponse.json({ error: "전화번호를 확인해 주세요." }, { status: 400 });
      if (!phone && !body.memberId && !entry.talkUser) {
        return NextResponse.json({ error: "전화번호나 회원 ID 중 하나는 적어 주세요." }, { status: 400 });
      }
      if ((status === "active" || status === "ending") && (await otherCurrent(entry, phone, body.memberId))) {
        return NextResponse.json({ error: "같은 번호·회원이 다른 등록으로 이미 주의 중이에요." }, { status: 409 });
      }
      // 무엇을 바꿨는지 이력에 남긴다(번호는 바뀐 값까지).
      const changed = [
        phone !== (entry.phone ?? "") && `전화번호 ${phone ? formatPhone(phone) : "지움"}`,
        body.memberId !== (entry.memberId ?? "") && `회원 ID ${body.memberId || "지움"}`,
        body.name !== (entry.name ?? "") && "이름",
        body.reasons.join() !== (entry.reasons ?? []).join() && `사유 ${body.reasons.map(reasonLabel).join("·")}`,
        body.detail !== (entry.detail ?? "") && "내용",
        body.refs !== (entry.refs ?? "") && "관련 기록",
      ].filter(Boolean);
      if (!changed.length) return NextResponse.json({ entry: serializeBlackConsumer(entry, today) });
      update = {
        $set: { phone, memberId: body.memberId, name: body.name, reasons: body.reasons, detail: body.detail, refs: body.refs },
        $push: { history: { action: "edit", by: body.by, note: changed.join(", ") } },
      };
    } else if (body.action === "extend") {
      if (status === "released") {
        return NextResponse.json({ error: "해제된 등록이에요. [다시 주의]로 돌려 주세요." }, { status: 409 });
      }
      const until = addMonths(entry.until > today ? entry.until : today, body.months);
      update = { $set: { until }, $push: { history: { action: "extend", by: body.by, note: `${body.months}개월 · ${until}까지` } } };
    } else if (body.action === "release") {
      if (status === "released") return NextResponse.json({ error: "이미 해제된 등록이에요." }, { status: 409 });
      update = {
        $set: { releasedAt: new Date(), releasedBy: body.by, releaseNote: body.note },
        $push: { history: { action: "release", by: body.by, note: body.note } },
      };
    } else {
      if (status === "active" || status === "ending") return NextResponse.json({ error: "이미 주의 중이에요." }, { status: 409 });
      if (await otherCurrent(entry, entry.phone ?? "", entry.memberId ?? "")) {
        return NextResponse.json({ error: "같은 번호·회원이 다른 등록으로 이미 주의 중이에요." }, { status: 409 });
      }
      const until = addMonths(today, body.months);
      update = {
        $set: { until, releasedBy: "", releaseNote: "" },
        $unset: { releasedAt: 1 },
        $push: { history: { action: "reopen", by: body.by, note: `${body.months}개월 · ${until}까지` } },
      };
    }

    const saved = await BlackConsumer.findByIdAndUpdate(id, update, { returnDocument: "after" }).lean<BlackConsumerRecord | null>();
    if (!saved) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ entry: serializeBlackConsumer(saved, today) });
  } catch {
    return NextResponse.json({ error: "블랙컨슈머 등록을 바꾸지 못했어요." }, { status: 503 });
  }
}

// 영구 삭제 — 잘못 등록했을 때만. 기록을 남겨야 하는 경우는 [해제]를 쓴다.
export async function DELETE(_request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidObjectId(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  try {
    await connectDB();
    const doc = await BlackConsumer.findByIdAndDelete(id);
    if (!doc) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "블랙컨슈머 등록을 지우지 못했어요." }, { status: 503 });
  }
}
