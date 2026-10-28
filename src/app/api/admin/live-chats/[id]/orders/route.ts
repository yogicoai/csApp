import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { isCafe24Configured } from "@/lib/cafe24/api";
import { getRecentOrdersWithShipments, getShipmentDetail } from "@/lib/cafe24/service";
import { findChatById } from "@/lib/liveChat";

type RouteContext = { params: Promise<{ id: string }> };

const CAFE24_ORDER_ID = /^\d{8}-\d{7}$/;

// 상담 도움 — 자사몰(cafe24) 주문·배송 조회. 회원ID가 있으면 최근 14일 주문, 없으면 고객이 적은 주문번호로 조회한다.
// 셀프가이드 배송조회(api/cafe24/shipment)와 같은 cafe24 연동을 상담원 권한으로 쓴다.
export async function GET(_request: Request, context: RouteContext) {
  const denied = await requireAdmin();
  if (denied) return denied;
  if (!isCafe24Configured()) {
    return NextResponse.json({ error: "cafe24 연동 설정(CAFE24_MALLID 등)이 없어 주문을 조회할 수 없습니다." }, { status: 503 });
  }

  const { id } = await context.params;
  const chat = await findChatById(id);
  if (!chat) return NextResponse.json({ error: "상담을 찾을 수 없습니다." }, { status: 404 });

  const orderNumber = (chat.intake?.orderNumber ?? "").trim();
  try {
    if (chat.memberId) {
      const orders = await getRecentOrdersWithShipments(chat.memberId);
      return NextResponse.json({ mode: "member", orders });
    }
    if (CAFE24_ORDER_ID.test(orderNumber)) {
      const shipment = await getShipmentDetail(orderNumber);
      return NextResponse.json({ mode: "order", orders: [{ orderId: orderNumber, totalItems: 0, shipment }] });
    }
    return NextResponse.json({
      mode: "none",
      orders: [],
      reason: "회원ID나 자사몰 주문번호(YYYYMMDD-XXXXXXX)가 없어 조회할 수 없어요.",
    });
  } catch {
    return NextResponse.json({ error: "cafe24 주문 조회에 실패했습니다." }, { status: 502 });
  }
}
