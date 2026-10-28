import { maskId, maskName, maskTail } from "@/lib/accessLog";
import type { BlackConsumerView } from "@/lib/blackConsumer";
import { type BlackConsumerRecord, serializeBlackConsumer } from "@/lib/blackConsumerServer";
import { HOMEPAGE_BOARDS } from "@/lib/boards";
import { isCafe24Configured } from "@/lib/cafe24/api";
import { listHomepagePosts } from "@/lib/cafe24/boards";
import {
  attachLookupShipments,
  findMemberIdsByPhone,
  getMemberOrdersForLookup,
  type OrderCandidate,
  searchOrdersByPhone,
} from "@/lib/cafe24/service";
import { connectDB } from "@/lib/db";
import { type LiveChatRecord, NOT_DELETED } from "@/lib/liveChat";
import { kstToday, shiftDay } from "@/lib/liveChatHours";
import { TALK_VIA } from "@/lib/liveChatOptions";
import { isOnlineDataConfigured, searchOtherChannelOrdersByPhone } from "@/lib/onlineData";
import { formatPhone, phoneTextPattern } from "@/lib/phone";
import type { VoiceCallRecord } from "@/lib/voiceCall";
import { BlackConsumer } from "@/models/BlackConsumer";
import { LiveChat } from "@/models/LiveChat";
import { LiveChatMessage } from "@/models/LiveChatMessage";
import { VoiceCall } from "@/models/VoiceCall";

// 고객 조회 — 전화번호 하나로 녹취·실시간 상담(톡톡 포함)·홈페이지 게시판·주문·블랙컨슈머를 모은다(TWC 의 번호별 상담 이력 대신).
// 회원 ID 는 이 번호로 찾은 자사몰 회원·주문에서 얻어, 그 회원의 상담·게시판 글까지 잇는다.

// 주문·게시판은 최근 90일(cafe24 주문 검색은 한 번에 3개월까지, onlineData 도 92일까지)
export const LOOKUP_DAYS = 90;
const MALL_ORDER_LIMIT = 10;
const MEMBER_LIMIT = 3;

// ok: 찾음(0건 포함) · off: 연결 설정 없음 · error: 불러오지 못함 · unsupported: 이 방법으로는 찾을 수 없음(권한·조건)
export type SectionState = "ok" | "off" | "error" | "unsupported";
export type LookupSection<T> = { state: SectionState; items: T[]; note: string };

export type LookupCall = {
  id: string;
  callDate: string;
  durationSec: number;
  status: string;
  category: string;
  summary: string;
  customerName: string;
};

export type LookupChat = {
  id: string;
  ticketNo: string;
  talk: boolean;
  status: string;
  outcome: string;
  createdAt: string;
  lastMessageAt: string;
  preview: string;
  matchedBy: string[];
};

export type LookupPost = {
  key: string;
  boardName: string;
  title: string;
  content: string;
  createdAt: string;
  writer: string;
  answered: boolean;
  matchedBy: string[];
};

export type CustomerLookup = {
  phone: string;
  phoneLabel: string;
  days: number;
  // 가린 결과인가 — 기본 조회는 이름·내용·회원 ID·송장을 가리고, [자세히 보기](조회 기록에 남김)에서만 전체를 보낸다.
  masked: boolean;
  blacklist: BlackConsumerView[];
  calls: LookupCall[];
  chats: LookupChat[];
  memberIds: string[];
  members: SectionState;
  mallOrders: LookupSection<OrderCandidate>;
  otherOrders: LookupSection<OrderCandidate>;
  posts: LookupSection<LookupPost>;
};

type Attempt<T> = { ok: true; value: T } | { ok: false };

async function attempt<T>(label: string, run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    console.warn(`[customer-lookup] ${label} 실패`, error);
    return { ok: false };
  }
}

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

function toLookupCall(call: VoiceCallRecord): LookupCall {
  return {
    id: String(call._id),
    callDate: (call.callDate ?? call.createdAt)?.toISOString() ?? "",
    durationSec: call.durationSec ?? 0,
    status: call.status,
    category: call.analysis?.category ?? "",
    summary: call.analysis?.summary ?? "",
    customerName: call.analysis?.customerName ?? "",
  };
}

// 기본 조회 결과 — 무엇이 있는지(건수·날짜·종류·상태)는 보이고, 이름·회원 ID·송장·글 내용은 가린다.
// 블랙컨슈머는 응대 전에 바로 알아야 하므로 사유·기간은 그대로 둔다(있었던 일은 가린다).
export function maskLookup(result: CustomerLookup): CustomerLookup {
  const maskOrder = (order: OrderCandidate): OrderCandidate => ({
    ...order,
    buyerName: maskName(order.buyerName),
    receiverName: maskName(order.receiverName),
    shipment: order.shipment ? { ...order.shipment, trackingNumber: maskTail(order.shipment.trackingNumber), trackingUrl: "" } : null,
  });
  return {
    ...result,
    masked: true,
    memberIds: result.memberIds.map(maskId),
    blacklist: result.blacklist.map((entry) => ({
      ...entry,
      name: maskName(entry.name),
      memberId: maskId(entry.memberId),
      detail: "",
      refs: "",
      releaseNote: "",
      history: [],
    })),
    calls: result.calls.map((call) => ({ ...call, summary: "", customerName: maskName(call.customerName) })),
    chats: result.chats.map((chat) => ({ ...chat, preview: "" })),
    mallOrders: { ...result.mallOrders, items: result.mallOrders.items.map(maskOrder) },
    otherOrders: { ...result.otherOrders, items: result.otherOrders.items.map(maskOrder) },
    posts: { ...result.posts, items: result.posts.items.map((post) => ({ ...post, title: "", content: "", writer: maskName(post.writer) })) },
  };
}

// 조회 기록에 남길 한 줄 — 무엇이 몇 건 나왔는지
export function lookupSummary(result: CustomerLookup) {
  const orders = result.mallOrders.items.length + result.otherOrders.items.length;
  return `녹취 ${result.calls.length} · 상담 ${result.chats.length} · 게시판 ${result.posts.items.length} · 주문 ${orders}${
    result.blacklist.length ? ` · 블랙컨슈머 ${result.blacklist.length}` : ""
  }`;
}

// 자사몰 주문 합치기 — 같은 주문을 번호·회원으로 모두 찾았으면 찾은 이유를 합친다.
function mergeOrders(lists: OrderCandidate[][]) {
  const merged = new Map<string, OrderCandidate>();
  for (const order of lists.flat()) {
    const existing = merged.get(order.orderId);
    if (existing) existing.matchedBy = Array.from(new Set([...existing.matchedBy, ...order.matchedBy]));
    else merged.set(order.orderId, { ...order, matchedBy: [...order.matchedBy] });
  }
  return Array.from(merged.values()).sort((a, b) => b.orderDate.localeCompare(a.orderDate));
}

export async function lookupCustomer(digits: string): Promise<CustomerLookup> {
  const today = kstToday();
  const from = shiftDay(today, -LOOKUP_DAYS);
  const textPattern = phoneTextPattern(digits);
  const textRegex = new RegExp(textPattern);
  const cafe24 = isCafe24Configured();
  const onlineData = isOnlineDataConfigured();
  await connectDB();

  // 1) 번호로 바로 찾는 것 — 녹취·블랙컨슈머(이 DB), 자사몰 회원·주문(cafe24 실시간), 스마트스토어·매장 택배 주문(onlineData 사본)
  const [calls, blackByPhone, members, mallByPhone, other] = await Promise.all([
    VoiceCall.find({ $or: [{ phoneNumber: digits }, { "analysis.customerPhone": { $regex: `^${textPattern}$` } }] })
      .sort({ callDate: -1, createdAt: -1 })
      .limit(50)
      .lean<VoiceCallRecord[]>(),
    BlackConsumer.find({ phone: digits }).sort({ createdAt: -1 }).lean<BlackConsumerRecord[]>(),
    cafe24 ? attempt("자사몰 회원", () => findMemberIdsByPhone(digits)) : null,
    cafe24 ? attempt("자사몰 주문", () => searchOrdersByPhone(digits, from, today)) : null,
    onlineData ? attempt("스마트스토어·매장 주문", () => searchOtherChannelOrdersByPhone(digits, from, today)) : null,
  ]);

  const memberIds = unique([
    ...(members?.ok ? (members.value ?? []) : []),
    ...(mallByPhone?.ok ? (mallByPhone.value?.memberIds ?? []) : []),
  ]);

  // 2) 회원 ID 로 잇는 것 — 그 회원의 자사몰 주문, 홈페이지 게시판 글(글에 이 번호가 적힌 글도), 회원으로 등록된 블랙컨슈머
  const [memberOrders, boardLists, blackByMember] = await Promise.all([
    Promise.all(
      memberIds.slice(0, MEMBER_LIMIT).map((memberId) => attempt("회원 주문", () => getMemberOrdersForLookup(memberId, LOOKUP_DAYS))),
    ),
    cafe24
      ? attempt("홈페이지 게시판", () =>
          Promise.all(
            HOMEPAGE_BOARDS.map(async (board) => ({
              board,
              posts: await listHomepagePosts(board.no, from, today, { withProducts: false }),
            })),
          ),
        )
      : null,
    memberIds.length ? BlackConsumer.find({ memberId: { $in: memberIds } }).sort({ createdAt: -1 }).lean<BlackConsumerRecord[]>() : [],
  ]);

  const blackEntries = Array.from(new Map([...blackByPhone, ...blackByMember].map((entry) => [String(entry._id), entry])).values());

  // 자사몰 주문 — 번호로 찾은 주문 + 회원 주문(최근 순 10건, 배송 정보 붙임)
  let mallOrders: LookupSection<OrderCandidate>;
  if (!cafe24) {
    mallOrders = { state: "off", items: [], note: "자사몰(cafe24) 연결 설정이 없어요." };
  } else {
    const byPhone = mallByPhone?.ok ? (mallByPhone.value?.orders ?? []) : [];
    const byMember = memberOrders.flatMap((result) => (result.ok ? result.value : []));
    const merged = mergeOrders([byPhone, byMember]);
    const items = await attachLookupShipments(merged.slice(0, MALL_ORDER_LIMIT));
    const failed = !mallByPhone?.ok || memberOrders.some((result) => !result.ok);
    const phoneUnsupported = mallByPhone?.ok && mallByPhone.value === null;
    mallOrders = {
      state: failed && !items.length ? "error" : phoneUnsupported && !memberIds.length ? "unsupported" : "ok",
      items,
      note: [
        failed && "일부 자사몰 주문을 불러오지 못했어요.",
        phoneUnsupported && "자사몰은 회원 휴대폰으로 찾은 회원의 주문만 보여요(주문자 휴대폰 검색을 쓸 수 없음).",
        members?.ok && members.value === null && "회원 조회 권한이 없어 주문자 휴대폰으로만 찾았어요.",
        merged.length > MALL_ORDER_LIMIT && `최근 ${MALL_ORDER_LIMIT}건만 보여요(전체 ${merged.length}건).`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  const otherOrders: LookupSection<OrderCandidate> = !onlineData
    ? { state: "off", items: [], note: "onlineData 연결 설정이 없어요." }
    : other?.ok
      ? {
          state: "ok",
          items: other.value,
          note: "동기화·업로드 사본이에요. 사본 번호가 가려져 있으면 끝 4자리로만 맞춘 것이라 주문자 이름으로 본인인지 확인해 주세요.",
        }
      : { state: "error", items: [], note: "스마트스토어·매장 택배 주문을 불러오지 못했어요." };

  let posts: LookupSection<LookupPost>;
  if (!boardLists) {
    posts = { state: "off", items: [], note: "자사몰(cafe24) 연결 설정이 없어요." };
  } else if (!boardLists.ok) {
    posts = { state: "error", items: [], note: "홈페이지 게시판을 불러오지 못했어요." };
  } else {
    const items = boardLists.value
      .flatMap(({ board, posts: list }) =>
        list.map((post): LookupPost | null => {
          const matchedBy = [
            post.memberId && memberIds.includes(post.memberId) && "회원 ID",
            textRegex.test(`${post.title}\n${post.content}`) && "글에 적힌 번호",
          ].filter((reason): reason is string => Boolean(reason));
          return matchedBy.length
            ? {
                key: post.key,
                boardName: board.name,
                title: post.title,
                content: post.content.slice(0, 300),
                createdAt: post.createdAt,
                writer: post.writer,
                answered: post.answered,
                matchedBy,
              }
            : null;
        }),
      )
      .filter((post): post is LookupPost => Boolean(post))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    posts = { state: "ok", items, note: "스마트스토어 문의는 연락처가 없어 여기 나오지 않아요." };
  }

  // 3) 상담 — 문의 접수 휴대폰·회원 ID·대화에 적힌 번호·찾은 주문번호·블랙컨슈머로 등록한 톡톡 고객
  const orderIds = unique([...mallOrders.items, ...otherOrders.items].map((order) => order.orderId));
  const talkUsers = unique(blackEntries.map((entry) => entry.talkUser ?? ""));
  const messageChatIds = (await LiveChatMessage.distinct("chatId", { text: { $regex: textPattern }, ...NOT_DELETED })).map(String);
  const chatRecords = await LiveChat.find({
    ...NOT_DELETED,
    $or: [
      { "contact.phone": digits },
      { _id: { $in: messageChatIds } },
      ...(memberIds.length ? [{ memberId: { $in: memberIds } }] : []),
      ...(orderIds.length ? [{ "intake.orderNumber": { $in: orderIds } }] : []),
      ...(talkUsers.length ? [{ "talk.user": { $in: talkUsers } }] : []),
    ],
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean<LiveChatRecord[]>();

  const chats = chatRecords.map((chat) => ({
    id: String(chat._id),
    ticketNo: chat.ticketNo ?? "",
    talk: chat.source?.via === TALK_VIA,
    status: chat.status,
    outcome: chat.outcome?.result ?? "",
    createdAt: chat.createdAt?.toISOString() ?? "",
    lastMessageAt: chat.lastMessageAt?.toISOString() ?? "",
    preview: chat.lastMessagePreview ?? "",
    matchedBy: [
      chat.contact?.phone === digits && "문의 접수 연락처",
      messageChatIds.includes(String(chat._id)) && "대화에 적힌 번호",
      chat.memberId && memberIds.includes(chat.memberId) && "회원 ID",
      chat.intake?.orderNumber && orderIds.includes(chat.intake.orderNumber) && "주문번호",
      chat.talk?.user && talkUsers.includes(chat.talk.user) && "블랙컨슈머 등록",
    ].filter((reason): reason is string => Boolean(reason)),
  }));

  return {
    phone: digits,
    phoneLabel: formatPhone(digits),
    days: LOOKUP_DAYS,
    masked: false,
    blacklist: blackEntries.map((entry) => serializeBlackConsumer(entry, today)),
    calls: calls.map(toLookupCall),
    chats,
    memberIds,
    members: !cafe24 ? "off" : !members?.ok ? "error" : members.value === null ? "unsupported" : "ok",
    mallOrders,
    otherOrders,
    posts,
  };
}
