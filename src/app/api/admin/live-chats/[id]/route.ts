import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import {
  adminView,
  appendMessage,
  findChatById,
  getMessagesAfter,
  LIVE_CHAT_MESSAGES,
  parseAfter,
  spamBlockKeys,
} from "@/lib/liveChat";
import { CHAT_OUTCOME_KEYS, DELETE_REASON_KEYS, type DeleteReason, SPAM_BLOCK_DAYS, TALK_VIA } from "@/lib/liveChatOptions";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatBlock } from "@/models/LiveChatBlock";
import { LiveChatMessage } from "@/models/LiveChatMessage";

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = { error: "상담을 찾을 수 없습니다." };

// 어드민 대화 폴링 — after 이후 메시지. 상담사가 보고 있으므로 안 읽은 수를 0으로 돌린다.
export async function GET(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;

  const chat = await findChatById(id);
  if (!chat) return NextResponse.json(NOT_FOUND, { status: 404 });

  if (chat.agentUnread) {
    await LiveChat.updateOne({ _id: chat._id }, { $set: { agentUnread: 0 } });
  }
  const messages = await getMessagesAfter(chat._id, parseAfter(request));
  return NextResponse.json({ chat: { ...adminView(chat), agentUnread: 0 }, messages });
}

const patchSchema = z
  .object({
    status: z.enum(["closed", "active"]).optional(),
    outcome: z
      .object({
        result: z.enum(CHAT_OUTCOME_KEYS),
        memo: z.string().trim().max(200).optional(),
      })
      .optional(),
  })
  .refine((body) => body.status || body.outcome, { message: "status 또는 outcome 이 필요합니다." });

// 상담 종료(결과 함께) / 결과만 변경(종료된 상담) / 다시 열기(결과 초기화)
export async function PATCH(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const chat = await findChatById(id);
  if (!chat) return NextResponse.json(NOT_FOUND, { status: 404 });
  if (chat.deletedAt) {
    return NextResponse.json({ error: "휴지통에 있는 상담입니다. 먼저 복구해 주세요." }, { status: 409 });
  }

  const { status, outcome } = parsed.data;
  const outcomeSet = outcome
    ? { "outcome.result": outcome.result, "outcome.memo": outcome.memo ?? "", "outcome.decidedAt": new Date() }
    : {};

  if (status === "closed") {
    // 상태가 실제로 바뀔 때만 종료 안내를 남긴다(중복 클릭 방지). 이미 고객이 종료했다면 결과만 기록한다.
    // 톡톡 상담은 진행 중 표시(talk.openUser)도 지워, 고객이 다시 보내면 새 상담이 열리게 한다.
    const changed = await LiveChat.updateOne(
      { _id: chat._id, status: { $ne: "closed" } },
      { $set: { status: "closed", closedAt: new Date(), closedBy: "agent", ...outcomeSet }, $unset: { "talk.openUser": 1 } },
    );
    if (changed.modifiedCount) {
      const closedText = chat.source?.via === TALK_VIA ? LIVE_CHAT_MESSAGES.closedTalk : LIVE_CHAT_MESSAGES.closedByAgent;
      await appendMessage(chat._id, "system", closedText);
    } else if (outcome) {
      await LiveChat.updateOne({ _id: chat._id }, { $set: outcomeSet });
    }
  } else if (status === "active") {
    // 톡톡 고객은 진행 중 상담이 하나만(고유 인덱스) — 그사이 새 메시지로 새 상담이 열렸으면 그쪽에서 잇는다.
    const talkOpen = chat.talk?.user ? { "talk.openUser": chat.talk.user } : {};
    const changed = await LiveChat.updateOne(
      { _id: chat._id, status: "closed" },
      { $set: { status: "active", closedBy: "", ...talkOpen }, $unset: { closedAt: 1, outcome: 1 } },
    ).catch((error: { code?: number }) => {
      if (error?.code === 11000) return null;
      throw error;
    });
    if (!changed) {
      return NextResponse.json({ error: "이 고객의 새 톡톡 상담이 진행 중이에요. 그 상담에서 이어서 답해 주세요." }, { status: 409 });
    }
    if (changed.modifiedCount) {
      await appendMessage(chat._id, "system", LIVE_CHAT_MESSAGES.reopened);
    }
  } else if (outcome) {
    if (chat.status !== "closed") {
      return NextResponse.json({ error: "진행 중인 상담은 종료할 때 결과를 고릅니다." }, { status: 409 });
    }
    await LiveChat.updateOne({ _id: chat._id }, { $set: outcomeSet });
  }

  const updated = await findChatById(id);
  return NextResponse.json({ chat: updated ? adminView(updated) : adminView(chat) });
}

// 삭제 — 기본은 휴지통으로 이동(?reason=test|spam|duplicate|other, 종료된 상담만).
// 대화 메시지에도 같은 표시를 남겨 30일 뒤 함께 영구 삭제된다(TTL). 스팸이면 같은 고객의 새 상담을 막는다.
// ?permanent=1 은 휴지통에 있는 상담을 지금 바로 영구 삭제한다.
export async function DELETE(request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;

  const chat = await findChatById(id);
  if (!chat) return NextResponse.json(NOT_FOUND, { status: 404 });

  if (params.get("permanent") === "1") {
    if (!chat.deletedAt) {
      return NextResponse.json({ error: "휴지통에 있는 상담만 영구 삭제할 수 있습니다." }, { status: 409 });
    }
    await Promise.all([
      LiveChatMessage.deleteMany({ chatId: chat._id }),
      LiveChatBlock.deleteMany({ chatId: chat._id }),
      LiveChat.deleteOne({ _id: chat._id }),
    ]);
    return NextResponse.json({ ok: true });
  }

  const reason = params.get("reason") ?? "";
  if (!DELETE_REASON_KEYS.includes(reason as DeleteReason)) {
    return NextResponse.json({ error: "삭제 사유를 골라 주세요." }, { status: 400 });
  }
  if (chat.status !== "closed") {
    return NextResponse.json({ error: "진행 중인 상담은 먼저 종료해 주세요." }, { status: 409 });
  }
  if (chat.deletedAt) return NextResponse.json({ chat: adminView(chat) });

  const deletedAt = new Date();
  await Promise.all([
    LiveChat.updateOne({ _id: chat._id }, { $set: { deletedAt, deleteReason: reason } }),
    LiveChatMessage.updateMany({ chatId: chat._id }, { $set: { deletedAt } }),
  ]);
  if (reason === "spam") {
    const until = new Date(deletedAt.getTime() + SPAM_BLOCK_DAYS * 24 * 60 * 60 * 1000);
    const keys = spamBlockKeys(chat);
    if (keys.length) await LiveChatBlock.insertMany(keys.map((key) => ({ key, chatId: chat._id, until })));
  }

  const updated = await findChatById(id);
  return NextResponse.json({ chat: updated ? adminView(updated) : adminView(chat) });
}
