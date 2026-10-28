// 방문자 카운트에서 특정 IP(회사 IP 등)를 제외하기 위한 유틸.
//
// 차단 목록은 환경변수 BLOCKED_IPS 로 관리한다 (쉼표 또는 공백 구분).
//   예: BLOCKED_IPS="211.234.100.5, 118.44.0.0/16, 203.0.113."
//   - 정확한 IP:        211.234.100.5
//   - CIDR 대역:        118.44.0.0/16
//   - 프리픽스(부분일치): 203.0.113.  (해당 문자열로 시작하는 IP 전부)
//
// Vercel/서버리스에서 클라이언트 IP 는 x-forwarded-for 헤더 맨 앞 값이 원 클라이언트다.

function parseBlockList(): string[] {
  const raw = process.env.BLOCKED_IPS ?? "";
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 요청 헤더에서 클라이언트 IP 추출 (x-forwarded-for 맨 앞, 없으면 x-real-ip).
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    // "client, proxy1, proxy2" → 맨 앞이 원 클라이언트
    const first = xff.split(",")[0]?.trim();
    if (first) return normalizeIp(first);
  }
  const real = request.headers.get("x-real-ip");
  if (real) return normalizeIp(real.trim());
  return "";
}

// IPv6 매핑된 IPv4(::ffff:1.2.3.4) 를 순수 IPv4 로 정규화.
function normalizeIp(ip: string): string {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : ip;
}

// IPv4 를 32bit 정수로 (CIDR 판정용). 실패 시 null.
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    acc = (acc << 8) | n;
  }
  return acc >>> 0;
}

export function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

// 주어진 IP 가 차단 목록에 해당하는지 판정.
export function isBlockedIp(ip: string): boolean {
  if (!ip) return false;
  const list = parseBlockList();
  if (list.length === 0) return false;

  for (const entry of list) {
    if (entry.includes("/")) {
      if (inCidr(ip, entry)) return true;
    } else if (entry.endsWith(".")) {
      // 프리픽스 부분일치 (예: "203.0.113.")
      if (ip.startsWith(entry)) return true;
    } else if (ip === entry) {
      return true;
    }
  }
  return false;
}

// Request 하나로 바로 차단 여부 확인.
export function isRequestBlocked(request: Request): boolean {
  return isBlockedIp(getClientIp(request));
}
