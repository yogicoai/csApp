import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { lookupCustomer } from "@/lib/customerLookup";
import { isPhoneDigits, phoneDigits } from "@/lib/phone";

// cafe24·onlineData 를 여러 번 부르므로(주문·배송·게시판) 넉넉히 잡는다.
export const maxDuration = 60;

// 고객 조회 — ?phone=010-1234-5678 하나로 녹취·상담·게시판·주문·블랙컨슈머를 모은다(lib/customerLookup).
export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const digits = phoneDigits(new URL(request.url).searchParams.get("phone"));
  if (!isPhoneDigits(digits)) {
    return NextResponse.json({ error: "전화번호를 확인해 주세요. (예: 010-1234-5678)" }, { status: 400 });
  }
  try {
    return NextResponse.json(await lookupCustomer(digits));
  } catch (error) {
    console.warn("[customer-lookup] 조회 실패", error);
    return NextResponse.json({ error: "고객 정보를 불러오지 못했어요." }, { status: 503 });
  }
}
