import { NextResponse } from "next/server";
import { maskPhone } from "@/lib/accessLog";
import { accessContext, recordAccess, recordAccessQuietly } from "@/lib/accessLogServer";
import { requireAdmin } from "@/lib/adminAuth";
import { lookupCustomer, lookupSummary, maskLookup } from "@/lib/customerLookup";
import { isPhoneDigits, phoneDigits } from "@/lib/phone";

// cafe24·onlineData 를 여러 번 부르므로(주문·배송·게시판) 넉넉히 잡는다.
export const maxDuration = 60;

// 고객 조회 — ?phone=010-1234-5678 하나로 녹취·상담·게시판·주문·블랙컨슈머를 모은다(lib/customerLookup).
//  기본은 이름·내용·회원 ID·송장을 가린 결과(조회 기록에 '고객 조회')이고, &detail=1([자세히 보기])이면 전체를 보낸다.
//  자세히 보기는 기록('자세히 보기')을 남겨야만 보여 준다. 둘 다 처리하는 사람 이름(쿠키)이 있어야 한다.
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const digits = phoneDigits(params.get("phone"));
  if (!isPhoneDigits(digits)) {
    return NextResponse.json({ error: "전화번호를 확인해 주세요. (예: 010-1234-5678)" }, { status: 400 });
  }
  const context = await accessContext();
  if (!context.operator) {
    return NextResponse.json({ error: "조회하는 사람 이름을 먼저 적어 주세요.", needOperator: true }, { status: 400 });
  }
  const detail = params.get("detail") === "1";

  let result;
  try {
    result = await lookupCustomer(digits);
  } catch (error) {
    console.warn("[customer-lookup] 조회 실패", error);
    return NextResponse.json({ error: "고객 정보를 불러오지 못했어요." }, { status: 503 });
  }

  const summary = `${maskPhone(digits)} · ${lookupSummary(result)}`;
  if (!detail) {
    await recordAccessQuietly({ action: "lookup", target: digits, detail: summary }, context);
    return NextResponse.json(maskLookup(result));
  }
  try {
    await recordAccess({ action: "reveal", target: digits, detail: summary }, context);
  } catch (error) {
    console.warn("[customer-lookup] 자세히 보기 기록 실패", error);
    return NextResponse.json({ error: "조회 기록을 남기지 못해 자세한 내용을 보여 드릴 수 없어요. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  return NextResponse.json(result);
}
