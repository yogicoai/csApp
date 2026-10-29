import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { chatCautions } from "@/lib/blackConsumerServer";
import { connectDB } from "@/lib/db";
import { adminView, NOT_DELETED, type LiveChatRecord } from "@/lib/liveChat";
import { isDayString, kstDayRange } from "@/lib/liveChatHours";
import { CHAT_OUTCOME_KEYS, type ChatOutcome, TALK_VIA } from "@/lib/liveChatOptions";
import { talkAccounts } from "@/lib/naverTalk";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatMessage } from "@/models/LiveChatMessage";

// 결과가 비어 있거나 필드가 없는 종료 상담(고객이 직접 종료 등) = 미분류
const UNCLASSIFIED = { "outcome.result": { $in: ["", null] } };
// 처리할 일이 남은 목록은 날짜와 상관없이 전부 보여준다(날짜 때문에 묻히지 않게).
const ACTION_QUEUES = new Set(["follow_up", "unclassified"]);
const IN_TRASH = { deletedAt: { $ne: null } };

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 어드민 실시간 상담 목록 — 휴지통 상담은 status=trash 일 때만 나온다.
//  - 기본(status=open): 대기·상담중 전부(날짜 무관 — 끝나지 않은 상담은 계속 보여야 함)
//  - status=closed: date(YYYY-MM-DD, KST) 하루에 접수된 종료 상담. outcome=<결과 key>|unclassified 로 거른다.
//    단, 후속 조치·미분류는 처리할 일이므로 날짜와 상관없이 전체.
//  - status=trash: 휴지통(삭제 후 30일 안, 날짜 무관)
//  - q: 상담번호·주문번호·회원ID·대화 내용 검색(상태·날짜 무관, 휴지통 제외, 최근 50건)
//  - via=talktalk: 네이버 톡톡 상담만, via=web: 셀프가이드 상담만(목록·건수 모두). 비우면 전체.
// 헤더 배지도 이 응답의 counts 를 쓴다(counts.talk 는 거르기와 상관없이 톡톡 대기·안 읽음).
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const statusParam = params.get("status");
  const status = statusParam === "closed" || statusParam === "trash" ? statusParam : "open";
  const outcome = params.get("outcome") ?? "";
  const day = params.get("date") ?? "";
  const q = (params.get("q") ?? "").trim().slice(0, 50);
  const via = params.get("via") ?? "";
  const viaFilter =
    via === TALK_VIA ? { "source.via": TALK_VIA } : via === "web" ? { "source.via": { $ne: TALK_VIA } } : {};
  const isTalk = (chat: LiveChatRecord) => chat.source?.via === TALK_VIA;
  const inVia = (chat: LiveChatRecord) => (via === TALK_VIA ? isTalk(chat) : via === "web" ? !isTalk(chat) : true);
  const outcomeFilter =
    outcome === "unclassified"
      ? UNCLASSIFIED
      : CHAT_OUTCOME_KEYS.includes(outcome as ChatOutcome)
        ? { "outcome.result": outcome }
        : {};
  const dayFilter =
    isDayString(day) && !ACTION_QUEUES.has(outcome)
      ? (() => {
          const { start, end } = kstDayRange(day);
          return { createdAt: { $gte: start, $lt: end } };
        })()
      : {};

  try {
    await connectDB();
    const [allOpen, followUp, unclassified, trash] = await Promise.all([
      LiveChat.find({ status: { $in: ["waiting", "active"] }, ...NOT_DELETED })
        .sort({ lastMessageAt: -1 })
        .limit(100)
        .lean<LiveChatRecord[]>(),
      LiveChat.countDocuments({ status: "closed", "outcome.result": "follow_up", ...viaFilter, ...NOT_DELETED }),
      LiveChat.countDocuments({ status: "closed", ...UNCLASSIFIED, ...viaFilter, ...NOT_DELETED }),
      LiveChat.countDocuments({ ...IN_TRASH, ...viaFilter }),
    ]);
    const open = allOpen.filter(inVia);

    let chats: LiveChatRecord[];
    if (q) {
      const pattern = new RegExp(escapeRegex(q), "i");
      const messageChatIds = await LiveChatMessage.distinct("chatId", { text: pattern, ...NOT_DELETED });
      chats = await LiveChat.find({
        ...NOT_DELETED,
        ...viaFilter,
        $or: [{ _id: { $in: messageChatIds } }, { ticketNo: pattern }, { "intake.orderNumber": pattern }, { memberId: pattern }],
      })
        .sort({ lastMessageAt: -1 })
        .limit(50)
        .lean<LiveChatRecord[]>();
    } else if (status === "trash") {
      chats = await LiveChat.find({ ...IN_TRASH, ...viaFilter }).sort({ deletedAt: -1 }).limit(100).lean<LiveChatRecord[]>();
    } else if (status === "closed") {
      chats = await LiveChat.find({ status: "closed", ...outcomeFilter, ...dayFilter, ...viaFilter, ...NOT_DELETED })
        .sort({ closedAt: -1 })
        .limit(100)
        .lean<LiveChatRecord[]>();
    } else {
      chats = open;
    }

    const talkOpen = allOpen.filter(isTalk);
    const counts = {
      waiting: open.filter((chat) => chat.status === "waiting").length,
      active: open.filter((chat) => chat.status === "active").length,
      unread: open.reduce((sum, chat) => sum + (chat.agentUnread ?? 0), 0),
      followUp,
      unclassified,
      trash,
      talk: {
        waiting: talkOpen.filter((chat) => chat.status === "waiting").length,
        unread: talkOpen.reduce((sum, chat) => sum + (chat.agentUnread ?? 0), 0),
      },
      // 거르기와 상관없는 전체 대기·안 읽음 — 콘솔 알림·탭 제목용(거르기를 바꿔도 소리가 나거나 빠지지 않게)
      all: {
        waiting: allOpen.filter((chat) => chat.status === "waiting").length,
        unread: allOpen.reduce((sum, chat) => sum + (chat.agentUnread ?? 0), 0),
      },
    };

    return NextResponse.json({
      mode: q ? "search" : "list",
      chats: chats.map(adminView),
      // 블랙컨슈머로 등록된 고객의 상담 — 상담 id → 주의 표시
      cautions: await chatCautions(chats),
      counts,
      talkConnected: talkAccounts().length > 0,
      // 연결한 톡톡 계정 이름(계정이 둘 이상이면 상담마다 어느 계정인지 보여 준다) — 키·비밀값은 내보내지 않는다.
      talkAccounts: talkAccounts().map((account) => ({ key: account.key, name: account.name })),
    });
  } catch {
    return NextResponse.json({ error: "실시간 상담 목록을 불러오지 못했습니다." }, { status: 503 });
  }
}
