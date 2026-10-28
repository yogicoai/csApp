import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { boardRange } from "@/lib/boardAnswerLog";
import { type BoardFolder, type BoardPost, HOMEPAGE_BOARDS, summarizePosts } from "@/lib/boards";
import { isCafe24Configured } from "@/lib/cafe24/api";
import { describeCafe24Error, listHomepagePosts } from "@/lib/cafe24/boards";
import { connectDB } from "@/lib/db";
import { isOnlineDataConfigured, listSmartstoreInquiries, listSmartstoreQnas, OnlineDataError } from "@/lib/onlineData";
import { BoardAnswerLog } from "@/models/BoardAnswerLog";

export const maxDuration = 60;

// 상담 지표 · 게시판 — 홈페이지(게시판별)와 스마트스토어(상품문의·고객문의)를 따로 요약한다. ?days=7|30|90
//   한쪽이 설정 없음·실패여도 다른 쪽은 보여 주고, 그쪽에는 이유를 적는다.
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { days, from, to } = boardRange(new URL(request.url).searchParams.get("days"));
  const since = new Date(Date.parse(`${from}T00:00:00+09:00`));

  const appAnswers = async (folder: BoardFolder) => {
    try {
      await connectDB();
      // 새로 등록한 답변만 센다(고친 기록은 빼고)
      return await BoardAnswerLog.countDocuments({ folder, status: "posted", action: { $ne: "edit" }, postedAt: { $gte: since } });
    } catch {
      return null;
    }
  };

  const homepage = async () => {
    if (!isCafe24Configured()) return { error: "cafe24 연결 설정(CAFE24_MALLID)이 없어요.", boards: [] };
    try {
      const boards = await Promise.all(
        HOMEPAGE_BOARDS.map(async (board) => ({
          no: board.no,
          name: board.name,
          needsAnswer: board.needsAnswer,
          ...summarizePosts(await listHomepagePosts(board.no, from, to, { withProducts: false })),
        })),
      );
      return { boards };
    } catch (error) {
      return { error: describeCafe24Error(error, "read"), boards: [] };
    }
  };

  const summarize = (load: Promise<BoardPost[]>) =>
    load
      .then((posts) => ({ summary: summarizePosts(posts) }))
      .catch((error) => ({ error: error instanceof OnlineDataError ? error.message : "스마트스토어 문의를 불러오지 못했어요." }));
  const smartstore = async () => {
    if (!isOnlineDataConfigured()) return { error: "onlineData 연결 설정(ONLINEDATA_MCP_TOKEN)이 없어요." };
    const [qna, inquiry] = await Promise.all([summarize(listSmartstoreQnas(from, to)), summarize(listSmartstoreInquiries(from, to))]);
    return { qna, inquiry };
  };

  const [home, store, homeAnswers, storeAnswers] = await Promise.all([
    homepage(),
    smartstore(),
    appAnswers("homepage"),
    appAnswers("smartstore"),
  ]);
  return NextResponse.json({
    days,
    from,
    to,
    homepage: { ...home, appAnswers: homeAnswers },
    smartstore: { ...store, appAnswers: storeAnswers },
  });
}
