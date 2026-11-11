// 네이버 톡톡 상담의 구매처 — 톡톡 계정에 따라 스마트스토어 고객만 오기도 하고(스마트스토어 Yogibo 계정),
// 스마트스토어와 요기보 공식몰(yogibo.kr, 네이버페이 결제 포함) 고객이 함께 오기도 한다(요기보 Yogibo 계정).
// AI 도우미는 이 구매처 기준으로 쓰고, 주문도 그 구매처에서만 찾는다. 서버에서만 쓴다(계정 기본값을 env 에서 읽는다).

export type TalkPlace = "smartstore" | "official" | "";

const SMARTSTORE = /스마트\s*스토어|smart\s*store|네이버\s*스토어/i;
const OFFICIAL = /공식\s*(?:몰|홈페이지|홈피|사이트|스토어)|요기보\s*(?:홈페이지|홈피|사이트|몰)|홈페이지|홈피|자사\s*몰|yogibo\.(?:kr|co\.kr)|공홈/i;
const BOUGHT = /구매|주문|샀|구입|결제/;
const ONLY_LOOKED = /봤|보고|보니|보는/;
// 이 길이 이하는 구매처를 묻는 말에 대한 짧은 답("스마트스토어요")으로 본다.
const SHORT_ANSWER = 25;

// 고객 메시지 한 건에서 구매처를 읽는다 — 짧은 답이거나 '샀어요·주문했어요'처럼 구매를 말할 때만.
// 둘 다 말하거나 구경만 했다고 하면 모른다고 본다(상담원이 바로잡을 수 있다).
export function detectTalkPlace(text: string): TalkPlace {
  const value = text.trim();
  if (!value) return "";
  const smart = SMARTSTORE.test(value);
  const official = OFFICIAL.test(value);
  if (smart === official) return "";
  const bought = BOUGHT.test(value);
  if (!bought && (ONLY_LOOKED.test(value) || value.length > SHORT_ANSWER)) return "";
  return smart ? "smartstore" : "official";
}

// 계정마다 기본 구매처 — 첫 계정(스마트스토어 Yogibo)은 스마트스토어, 둘째 계정(요기보 Yogibo)은 두 곳 고객이 섞여 모름.
// NAVER_TALK_PLACE · NAVER_TALK_PLACE_2 로 바꿀 수 있다(smartstore | official | 빈 값 = 모름).
export function talkDefaultPlace(accountKey = ""): TalkPlace {
  const value = process.env[`NAVER_TALK_PLACE${accountKey ? `_${accountKey}` : ""}`];
  if (value === "smartstore" || value === "official") return value;
  if (value !== undefined) return "";
  return accountKey ? "" : "smartstore";
}

// 상담에 적힌 구매처(고객이 말했거나 상담원이 고른 것)가 먼저, 없으면 계정 기본값.
// 매장·기타·'잘 모르겠어요'를 고른 상담은 모름으로 본다(두 곳 모두 찾는다).
export function resolveTalkPlace(purchasePlace: string | undefined, accountKey = ""): TalkPlace {
  if (purchasePlace === "smartstore" || purchasePlace === "official") return purchasePlace;
  if (purchasePlace) return "";
  return talkDefaultPlace(accountKey);
}
