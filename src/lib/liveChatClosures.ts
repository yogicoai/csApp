import { connectDB } from "@/lib/db";
import {
  beforeOpeningToday,
  dayLabel,
  HALF_DAY,
  isLeaveClosedNow,
  isWeekend,
  kstMinutes,
  kstToday,
  leaveHoursLabel,
  type LeaveType,
  nextBusinessDay,
  shiftDay,
} from "@/lib/liveChatHours";
import { LiveChatClosure } from "@/models/LiveChatClosure";

// CS 연차·반차 조회·안내 — 휴가 시간에는 실시간 채팅상담을 닫는다(고객 상태 표시·상담 시작 API가 같이 쓴다).

export type ClosureRecord = { date: string; type?: LeaveType };

export async function findClosure(day = kstToday()) {
  await connectDB();
  return LiveChatClosure.findOne({ date: day }).lean<ClosureRecord | null>();
}

export function closureType(closure: ClosureRecord): LeaveType {
  return closure.type === "am" || closure.type === "pm" ? closure.type : "full";
}

// 다음에 상담이 열리는 때 — 주말·연차일은 건너뛰고, 그날이 오전반차면 "오후 2시"를 붙인다.
export async function nextOpenLabel(fromDay = kstToday()) {
  await connectDB();
  const upcoming = await LiveChatClosure.find({ date: { $gt: fromDay, $lte: shiftDay(fromDay, 60) } })
    .select({ date: 1, type: 1 })
    .lean<ClosureRecord[]>();
  const types = new Map(upcoming.map((closure) => [closure.date, closureType(closure)]));
  const day = nextBusinessDay(fromDay, (candidate) => types.get(candidate) === "full");
  return types.get(day) === "am" ? `${dayLabel(day)} 오후 2시` : dayLabel(day);
}

// 지금 상담이 닫혀 있을 때 다음에 열리는 때 — 오늘 아직 열기 전이면 오늘, 아니면 다음 영업일.
// 운영시간 외 문의 접수에서 "언제부터 답변하는지"를 알려 줄 때 쓴다.
export async function upcomingOpenLabel(now = new Date()) {
  const today = kstToday();
  const closure = await findClosure(today);
  const type = closure ? closureType(closure) : null;
  if (!isWeekend(today) && type !== "full") {
    if (type === "am" && kstMinutes(now) < HALF_DAY.amOpenMinutes) return "오늘 오후 2시";
    if (type !== "am" && beforeOpeningToday(now)) return "오늘 오전 10시";
  }
  return nextOpenLabel(today);
}

// 고객 안내 — 내부 사정(연차·반차)은 말하지 않고 휴무로 안내한다.
export function closedMessage(type: LeaveType, openLabel: string) {
  if (type === "am") {
    return "오늘 오전은 고객센터 휴무라 실시간 채팅상담이 닫혀 있어요. 오늘 오후 2시부터 다시 상담할 수 있어요.";
  }
  if (type === "pm") {
    return `오늘 오후는 고객센터 휴무라 실시간 채팅상담이 닫혀 있어요. ${openLabel}부터 다시 상담할 수 있어요.`;
  }
  return `오늘은 고객센터 휴무일이라 실시간 채팅상담이 닫혀 있어요. ${openLabel}부터 다시 상담할 수 있어요.`;
}

// 오늘 상담 상태 — 휴가가 없으면 null. 있으면 지금 닫혀 있는지와 고객 안내 문구.
export async function todayClosureState(now = new Date()) {
  const doc = await findClosure();
  if (!doc) return null;
  const type = closureType(doc);
  const closedNow = isLeaveClosedNow(type, now);
  const openLabel = type === "am" ? "오늘 오후 2시" : await nextOpenLabel();
  return {
    date: doc.date,
    type,
    closedNow,
    hoursLabel: leaveHoursLabel(type),
    nextOpenLabel: openLabel,
    message: closedNow ? closedMessage(type, openLabel) : "",
  };
}
