import { Cafe24ApiError, cafe24Request } from "@/lib/cafe24/api";
import { formatPhone, phoneDigits } from "@/lib/phone";

// yogiChat 의 services/cafe24Service.js 에서 배송문의에 필요한 부분만 이식.
// (상품 카탈로그 동기화, 구매이력 등은 이 프로젝트 스코프 밖이라 제외)

const CARRIER_MAP: Record<string, { name: string; url: string }> = {
  "0019": { name: "롯데 택배", url: "https://www.lotteglogis.com/" },
  "0039": { name: "경동 택배", url: "https://kdexp.com/index.do" },
  "0023": { name: "경동 택배", url: "https://kdexp.com/index.do" },
};

export type ShipmentInfo = {
  orderId: string;
  status: string;
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string;
};

type Cafe24Shipment = {
  status?: string;
  tracking_no?: string;
  tracking_url?: string;
  shipping_company_code?: string;
  shipping_company_name?: string;
};

type Cafe24OrderItem = {
  product_name?: string;
  quantity?: number;
  option_value?: string;
  order_status?: string;
};

type Cafe24Person = { name?: string; cellphone?: string; phone?: string };

type Cafe24Order = {
  order_id: string;
  member_id?: string;
  order_date?: string;
  order_place_name?: string;
  order_price_amount?: number | string;
  payment_amount?: number | string;
  billing_name?: string;
  shipping_status?: string;
  items?: Cafe24OrderItem[];
  buyer?: Cafe24Person;
  receivers?: Cafe24Person[];
};

function ymd(date: Date) {
  return date.toISOString().split("T")[0];
}

// 최근 N일간의 해당 회원 주문 목록 (기본 14일)
export async function getRecentOrders(memberId: string, days = 14) {
  const today = new Date();
  const start = new Date();
  start.setDate(today.getDate() - days);

  const response = await cafe24Request<{ orders?: Cafe24Order[] }>("/api/v2/admin/orders", {
    params: {
      member_id: memberId,
      start_date: ymd(start),
      end_date: ymd(today),
      limit: 10,
      embed: "items",
    },
  });
  return response.orders ?? [];
}

// 주문의 배송 상세 (택배사, 운송장 번호, 실시간 조회 URL 매핑까지)
export async function getShipmentDetail(orderId: string): Promise<ShipmentInfo | null> {
  const response = await cafe24Request<{ shipments?: Cafe24Shipment[] }>(
    `/api/v2/admin/orders/${orderId}/shipments`,
    { params: { shop_no: 1 } },
  );
  const shipment = response.shipments?.[0];
  if (!shipment) return null;

  const code = shipment.shipping_company_code ?? "";
  const carrier = CARRIER_MAP[code] ?? {
    name: shipment.shipping_company_name || "지정 택배사",
    url: "",
  };

  let trackingUrl = shipment.tracking_url && shipment.tracking_url !== "undefined" ? shipment.tracking_url : "";
  if (!trackingUrl && shipment.tracking_no) {
    if (carrier.url) {
      trackingUrl = carrier.url.endsWith("=") ? carrier.url + shipment.tracking_no : carrier.url;
    } else {
      trackingUrl = `https://search.naver.com/search.naver?query=${encodeURIComponent(
        `${carrier.name} 배송조회 ${shipment.tracking_no}`,
      )}`;
    }
  }

  return {
    orderId,
    status: shipment.status || "배송 준비중",
    carrierName: carrier.name,
    trackingNumber: shipment.tracking_no ?? "",
    trackingUrl: trackingUrl || "#",
  };
}

// 회원의 최근 주문 + 각 주문의 배송 정보를 묶어 반환
export type OrderWithShipment = {
  orderId: string;
  orderDate?: string;
  totalItems: number;
  firstItemName?: string;
  paymentAmount?: number;
  shipment: ShipmentInfo | null;
};

export async function getRecentOrdersWithShipments(memberId: string): Promise<OrderWithShipment[]> {
  const orders = await getRecentOrders(memberId, 14);
  if (orders.length === 0) return [];

  const results = await Promise.all(
    orders.slice(0, 5).map(async (order) => {
      let shipment: ShipmentInfo | null = null;
      try {
        shipment = await getShipmentDetail(order.order_id);
      } catch (error) {
        // 개별 주문의 배송 조회 실패는 전체를 막지 않는다.
        console.warn(`[cafe24] 배송 조회 실패 order=${order.order_id}`, error);
      }
      const paymentAmount = Number(order.payment_amount ?? order.order_price_amount ?? 0);
      return {
        orderId: order.order_id,
        orderDate: order.order_date,
        totalItems: (order.items ?? []).length,
        firstItemName: order.items?.[0]?.product_name,
        paymentAmount: Number.isFinite(paymentAmount) ? paymentAmount : undefined,
        shipment,
      };
    }),
  );

  return results;
}

// ── 상담 도우미용 주문 찾기: 이름+주문일, 주문번호, 로그인 회원 ──

// cafe24 order_status → 상담원이 읽는 말. 표에 없는 세부 코드는 앞 글자(N·C·R·E)로 묶어 부른다.
const ORDER_STATUS: Record<string, string> = {
  N00: "입금 전",
  N10: "상품 준비 중",
  N20: "배송 준비 중",
  N21: "배송 대기",
  N22: "배송 보류",
  N30: "배송 중",
  N40: "배송 완료",
  N50: "구매 확정",
  C00: "취소 신청",
  C10: "취소 접수",
  C11: "취소 거부",
  C40: "취소 완료",
  C47: "입금 전 취소",
  C48: "입금 전 취소",
  C49: "입금 전 취소",
  R00: "반품 신청",
  R10: "반품 접수",
  R11: "반품 거부",
  R20: "반품 수거 완료",
  R40: "반품 완료",
  E00: "교환 신청",
  E10: "교환 접수",
  E11: "교환 거부",
  E40: "교환 완료",
};
const ORDER_STATUS_GROUP: Record<string, string> = { N: "주문 처리 중", C: "취소 진행 중", R: "반품 진행 중", E: "교환 진행 중" };
// 주문 전체의 배송 상태(shipping_status) — 품목별 상태가 없을 때만 쓴다.
const SHIPPING_STATUS: Record<string, string> = { F: "배송 전", M: "배송 중", T: "배송 완료", W: "배송 보류", X: "발주 전" };

function orderStatusLabel(code = "") {
  return ORDER_STATUS[code] ?? ORDER_STATUS_GROUP[code.charAt(0)] ?? code;
}

export type OrderMatch = "buyer" | "receiver" | "orderId" | "member";

export type OrderCandidate = {
  // 자사몰(cafe24 실시간) · 스마트스토어 · 매장 택배(onlineData 사본)
  channel: string;
  orderId: string;
  orderDate: string;
  matchedBy: OrderMatch[];
  buyerName: string;
  receiverName: string;
  phoneLast4: string;
  items: Array<{ name: string; option: string; quantity: number }>;
  status: string;
  shipment: ShipmentInfo | null;
  // 사본이면 그 기준 시각(실시간이 아님), 매장 주문이면 매장명 같은 덧붙임
  asOf?: string;
  note?: string;
};

const CANDIDATE_LIMIT = 5;
// 주문자·수령인 정보(buyer·receivers)는 개인정보 권한이 필요할 수 있어, 거절되면 상품 정보만 받는다.
const FULL_EMBED = "items,buyer,receivers";

async function withEmbedFallback<T>(fetcher: (embed: string) => Promise<T>) {
  try {
    return await fetcher(FULL_EMBED);
  } catch (error) {
    if (error instanceof Cafe24ApiError && (error.status === 403 || error.status === 422)) return fetcher("items");
    throw error;
  }
}

function toCandidate(order: Cafe24Order, matchedBy: OrderMatch[]): OrderCandidate {
  const receiver = order.receivers?.[0];
  const phone = (receiver?.cellphone || order.buyer?.cellphone || receiver?.phone || order.buyer?.phone || "").replace(/\D/g, "");
  const items = order.items ?? [];
  const statuses = Array.from(new Set(items.map((item) => orderStatusLabel(item.order_status)).filter(Boolean)));
  return {
    channel: "자사몰",
    orderId: order.order_id,
    orderDate: order.order_date ?? "",
    matchedBy,
    buyerName: order.buyer?.name || order.billing_name || "",
    receiverName: receiver?.name ?? "",
    phoneLast4: phone.length >= 4 ? phone.slice(-4) : "",
    items: items.map((item) => ({
      name: item.product_name ?? "",
      option: item.option_value ?? "",
      quantity: Number(item.quantity ?? 1),
    })),
    status: statuses.join(" · ") || SHIPPING_STATUS[order.shipping_status ?? ""] || "",
    shipment: null,
  };
}

async function attachShipments(candidates: OrderCandidate[]) {
  return Promise.all(
    candidates.map(async (candidate) => {
      try {
        return { ...candidate, shipment: await getShipmentDetail(candidate.orderId) };
      } catch (error) {
        console.warn(`[cafe24] 배송 조회 실패 order=${candidate.orderId}`, error);
        return candidate;
      }
    }),
  );
}

// 주문자 이름 또는 받는 분 이름 + 주문일 범위(YYYY-MM-DD, 같은 날이면 그날만 · cafe24 는 한 번에 3개월까지).
export async function searchOrdersByName(name: string, from: string, to: string) {
  const search = (field: "buyer_name" | "receiver_name") =>
    withEmbedFallback(async (embed) => {
      const response = await cafe24Request<{ orders?: Cafe24Order[] }>("/api/v2/admin/orders", {
        params: { shop_no: 1, [field]: name, start_date: from, end_date: to, date_type: "order_date", limit: 20, embed },
      });
      return response.orders ?? [];
    });
  const [byBuyer, byReceiver] = await Promise.all([search("buyer_name"), search("receiver_name")]);

  const found = new Map<string, OrderCandidate>();
  const add = (orders: Cafe24Order[], match: OrderMatch) => {
    for (const order of orders) {
      const existing = found.get(order.order_id);
      if (existing) existing.matchedBy.push(match);
      else found.set(order.order_id, toCandidate(order, [match]));
    }
  };
  add(byBuyer, "buyer");
  add(byReceiver, "receiver");
  const newest = Array.from(found.values()).sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  return attachShipments(newest.slice(0, CANDIDATE_LIMIT));
}

export async function getOrderCandidate(orderId: string) {
  try {
    const order = await withEmbedFallback(async (embed) => {
      const response = await cafe24Request<{ order?: Cafe24Order }>(`/api/v2/admin/orders/${orderId}`, {
        params: { shop_no: 1, embed },
      });
      return response.order;
    });
    if (!order) return null;
    const [candidate] = await attachShipments([toCandidate(order, ["orderId"])]);
    return candidate;
  } catch (error) {
    if (error instanceof Cafe24ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getMemberOrderCandidates(memberId: string) {
  const orders = await getRecentOrders(memberId, 14);
  return attachShipments(orders.slice(0, CANDIDATE_LIMIT).map((order) => toCandidate(order, ["member"])));
}

// ── 고객 조회: 휴대폰 번호로 자사몰 회원·주문 찾기 ──

// 휴대폰 번호로 회원 ID 찾기 — 회원 조회 권한(read_customer)이 없으면 null.
// 번호 형식(하이픈 유무)을 받지 않으면(422) 다른 형식으로 한 번 더 묻는다.
export async function findMemberIdsByPhone(digits: string): Promise<string[] | null> {
  for (const cellphone of [formatPhone(digits), digits]) {
    try {
      const response = await cafe24Request<{ customers?: Array<{ member_id?: string; cellphone?: string }> }>(
        "/api/v2/admin/customers",
        { params: { shop_no: 1, cellphone } },
      );
      // 응답에 휴대폰이 있으면 한 번 더 맞춰 본다(다른 회원이 섞이지 않게).
      return (response.customers ?? [])
        .filter((customer) => !customer.cellphone || phoneDigits(customer.cellphone) === digits)
        .map((customer) => customer.member_id ?? "")
        .filter(Boolean);
    } catch (error) {
      if (error instanceof Cafe24ApiError && error.status === 403) return null;
      if (!(error instanceof Cafe24ApiError && error.status === 422)) throw error;
    }
  }
  return null;
}

// 휴대폰 번호로 주문 찾기(주문일 범위, 한 번에 3개월까지) — 주문자·받는 분 휴대폰 조건으로 묻고,
// 받은 주문의 주문자·받는 분 번호가 실제로 같은 것만 남긴다(조건을 받지 않거나 무시해도 엉뚱한 주문이 섞이지 않게).
// 두 조건을 모두 받지 않으면(422) null — 화면은 '전화번호로는 찾을 수 없음'으로 보여 준다.
export async function searchOrdersByPhone(digits: string, from: string, to: string) {
  const search = async (field: "buyer_cellphone" | "receiver_cellphone") => {
    try {
      const response = await cafe24Request<{ orders?: Cafe24Order[] }>("/api/v2/admin/orders", {
        params: { shop_no: 1, [field]: formatPhone(digits), start_date: from, end_date: to, date_type: "order_date", limit: 100, embed: FULL_EMBED },
      });
      return response.orders ?? [];
    } catch (error) {
      if (error instanceof Cafe24ApiError && error.status === 422) return null;
      throw error;
    }
  };
  const [byBuyer, byReceiver] = await Promise.all([search("buyer_cellphone"), search("receiver_cellphone")]);
  if (byBuyer === null && byReceiver === null) return null;

  const samePhone = (person?: Cafe24Person) => [person?.cellphone, person?.phone].some((value) => phoneDigits(value) === digits);
  const found = new Map<string, { order: Cafe24Order; matchedBy: OrderMatch[] }>();
  for (const order of [...(byBuyer ?? []), ...(byReceiver ?? [])]) {
    if (found.has(order.order_id)) continue;
    const matchedBy: OrderMatch[] = [];
    if (samePhone(order.buyer)) matchedBy.push("buyer");
    if (order.receivers?.some(samePhone)) matchedBy.push("receiver");
    if (matchedBy.length) found.set(order.order_id, { order, matchedBy });
  }
  const orders = Array.from(found.values()).sort((a, b) => (b.order.order_date ?? "").localeCompare(a.order.order_date ?? ""));
  return {
    orders: orders.map(({ order, matchedBy }) => toCandidate(order, matchedBy)),
    memberIds: Array.from(new Set(orders.map(({ order }) => order.member_id ?? "").filter(Boolean))),
  };
}

// 회원의 최근 주문(고객 조회용) — 배송 정보는 붙이지 않는다(합친 뒤 attachLookupShipments 로).
export async function getMemberOrdersForLookup(memberId: string, days = 90) {
  return (await getRecentOrders(memberId, days)).map((order) => toCandidate(order, ["member"]));
}

export function attachLookupShipments(candidates: OrderCandidate[]) {
  return attachShipments(candidates);
}
