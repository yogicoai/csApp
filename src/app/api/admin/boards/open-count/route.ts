import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { boardRange } from "@/lib/boardAnswerLog";
import { HOMEPAGE_BOARDS, needsAnswer } from "@/lib/boards";
import { isCafe24Configured } from "@/lib/cafe24/api";
import { listHomepagePosts } from "@/lib/cafe24/boards";
import { isOnlineDataConfigured, listSmartstoreInquiries, listSmartstoreQnas } from "@/lib/onlineData";

// 왼쪽 메뉴 '게시판 관리' 숫자 — 최근 30일 미답변(홈페이지 Q&A + 스마트스토어 상품문의·고객문의).
// 어드민을 켜 둔 창마다 몇 분마다 부르므로 2분 동안은 같은 숫자를 돌려준다(?fresh=1 이면 새로 센다).
const CACHE_MS = 2 * 60_000;
type OpenCount = { homepage: number | null; smartstore: number | null; total: number };
let cache: { at: number; value: OpenCount } | null = null;

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return NextResponse.json(cache.value);

  const { from, to } = boardRange("30");
  const answerBoards = HOMEPAGE_BOARDS.filter((board) => board.needsAnswer);
  const [homepage, smartstore] = await Promise.all([
    isCafe24Configured()
      ? Promise.all(answerBoards.map((board) => listHomepagePosts(board.no, from, to, { withProducts: false })))
          .then((lists) => lists.flat().filter(needsAnswer).length)
          .catch(() => null)
      : null,
    isOnlineDataConfigured()
      ? Promise.all([listSmartstoreQnas(from, to), listSmartstoreInquiries(from, to)])
          .then((lists) => lists.flat().filter(needsAnswer).length)
          .catch(() => null)
      : null,
  ]);
  const value = { homepage, smartstore, total: (homepage ?? 0) + (smartstore ?? 0) };
  cache = { at: Date.now(), value };
  return NextResponse.json(value);
}
