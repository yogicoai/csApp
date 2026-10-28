// 전화번호 — 비교는 숫자만으로 하고, 화면에는 하이픈을 넣어 보여 준다(화면·서버 공용).

export function phoneDigits(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  // 국제 형식(+82 10-…)은 0 으로 시작하는 국내 형식으로 맞춘다.
  return digits.startsWith("82") && digits.length >= 11 ? `0${digits.slice(2)}` : digits;
}

// 고객 조회·블랙컨슈머에 쓸 수 있는 번호 — 휴대폰·지역번호(9~11자리)와 15xx 같은 대표번호(8자리)
export function isPhoneDigits(digits: string) {
  return /^0\d{8,10}$/.test(digits) || /^1[5-9]\d{6}$/.test(digits);
}

export function formatPhone(digits: string) {
  if (/^01\d{8,9}$/.test(digits)) return digits.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3");
  if (/^02\d{7,8}$/.test(digits)) return digits.replace(/(02)(\d{3,4})(\d{4})/, "$1-$2-$3");
  if (/^0\d{9,10}$/.test(digits)) return digits.replace(/(0\d{2})(\d{3,4})(\d{4})/, "$1-$2-$3");
  if (/^1\d{7}$/.test(digits)) return digits.replace(/(\d{4})(\d{4})/, "$1-$2");
  return digits;
}

// 글 속에 적힌 번호를 찾는 정규식 원문 — 숫자 사이의 하이픈·빈칸·점은 있어도 없어도 같은 번호로 보고,
// 앞뒤에 숫자가 더 붙은 더 긴 번호는 다른 번호로 본다.
export function phoneTextPattern(digits: string) {
  return `(?<!\\d)${digits.split("").join("[-\\s.]?")}(?!\\d)`;
}
