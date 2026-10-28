import { BOARD_ANSWER_MAX, BOARD_PERIODS, type BoardFolder } from "@/lib/boards";
import { connectDB } from "@/lib/db";
import { getClientIp } from "@/lib/ipBlock";
import { kstToday, shiftDay } from "@/lib/liveChatHours";
import { BoardAnswerLog } from "@/models/BoardAnswerLog";

// 목록 기간(?days=7|30|90, 기본 30) → 작성일 범위. 끝은 오늘이라 그 사이에 달린 답도 함께 온다.
export function boardRange(value: string | null) {
  const days = BOARD_PERIODS.find((period) => String(period) === value) ?? 30;
  const to = kstToday();
  return { days, from: shiftDay(to, -days), to };
}

// 답변 본문 — 1~2000자 평문
export async function readAnswerText(request: Request) {
  const body = (await request.json().catch(() => null)) as { content?: unknown } | null;
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  return content && content.length <= BOARD_ANSWER_MAX ? content : null;
}

// cafe24 는 작성자 IP(IPv4)를 필수로 받는다 — 상담원 IP, 없거나 IPv6 면 자리 값
export function writerIp(request: Request) {
  const ip = getClientIp(request);
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : "127.0.0.1";
}

// 등록 중인 채로 멈춘 기록(서버가 중간에 꺼진 경우)은 이만큼 지나면 다시 잡을 수 있다.
const STALE_POSTING_MS = 2 * 60_000;

// 답변 등록 자리 잡기 — 이 글을 다른 창에서 '등록 중'이면 null(동시 등록 막기), 아니면 이번 시도의 기록 id.
// 이미 답이 있는지는 원격(cafe24·스마트스토어)이 기준이라 여기서 보지 않는다.
export async function claimBoardAnswer(key: string, folder: BoardFolder, content: string) {
  await connectDB();
  await BoardAnswerLog.init(); // '등록 중은 하나' 인덱스가 있어야 잠금이 된다
  await BoardAnswerLog.updateMany(
    { key, status: "posting", updatedAt: { $lt: new Date(Date.now() - STALE_POSTING_MS) } },
    { $set: { status: "failed", error: "등록 중에 멈춤(시간 초과)" } },
  );
  try {
    const attempt = await BoardAnswerLog.create({ key, folder, status: "posting", content });
    return String(attempt._id);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return null;
    throw error;
  }
}

// 등록된 답변 고치기 기록 — 잠금 없이 결과만 남긴다(나중에 고친 쪽이 남는다).
export async function logBoardEdit(
  key: string,
  folder: BoardFolder,
  content: string,
  result: { remoteId: string } | { error: string },
) {
  await connectDB();
  await BoardAnswerLog.create({
    key,
    folder,
    action: "edit",
    content,
    ...("remoteId" in result
      ? { status: "posted", remoteId: result.remoteId, postedAt: new Date() }
      : { status: "failed", error: result.error.slice(0, 500) }),
  });
}

// 고칠 답변의 번호 — cafe24 는 답글 글 번호, 스마트스토어는 답변 번호(answerContentId)
export async function readAnswerId(request: Request) {
  const body = (await request.clone().json().catch(() => null)) as { answerId?: unknown } | null;
  const id = Number(body?.answerId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function finishBoardAnswer(attemptId: string, result: { remoteId: string } | { error: string }) {
  await connectDB();
  const update =
    "remoteId" in result
      ? { status: "posted", remoteId: result.remoteId, postedAt: new Date() }
      : { status: "failed", error: result.error.slice(0, 500) };
  await BoardAnswerLog.updateOne({ _id: attemptId }, { $set: update });
}
