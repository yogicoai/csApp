import { dayLabel, kstDayRange, type LeaveType, nextBusinessDay, shiftDay } from "@/lib/liveChatHours";

// 홈페이지 휴무 팝업 — 연차 관리에 지정한 휴무를 '휴무 기간'으로 묶어 팝업 문구(휴무일·상담 재개 일정)를 만든다.
// cafe24 에 한 번 심어 둔 스크립트(public/leave-notice.js)가 /api/notice/leave 를 불러 노출 기간에만 띄우고,
// 같은 내용을 이미지(PNG)로도 내려받아 톡톡·카카오 공지에 쓴다. DB 의존성 없이 두어 서버·화면이 같이 쓴다.

export type NoticeNote = { text: string; highlight: boolean };

export type LeaveNoticeSettings = {
  leadDays: number; // 휴무 며칠 전부터 띄울지
  title: string;
  body: string; // 줄바꿈 그대로, {휴무일} 자리에 휴무 날짜가 굵게 들어간다
  resumePrefix: string;
  notes: NoticeNote[];
  qrUrl: string;
};

export const DATE_TOKEN = "{휴무일}";
export const LEAD_DAYS_MAX = 14;
export const NOTES_MAX = 4;

// 기본 문구 — 예전에 쓰던 '고객센터 임시 휴무 안내' 이미지 그대로(사유만 연차에 맞게 '내부 사정'으로).
export const DEFAULT_LEAVE_NOTICE: LeaveNoticeSettings = {
  leadDays: 3,
  title: "[고객센터 임시 휴무 안내]",
  body: `오늘도 저희 Yogibo를 찾아주셔서 감사합니다.\n고객센터 내부 사정으로 인하여 ${DATE_TOKEN} 고객센터 운영이 임시중단 됩니다.\n부디 너른 양해 부탁드립니다.`,
  resumePrefix: "상담 재개 일정",
  notes: [
    {
      text: "상담 재개 전까지 전화 / 카카오톡 / 네이버톡톡 / 게시글 문의 및 취소 / 교환 / 반품 접수가 임시 중단됩니다.",
      highlight: false,
    },
    { text: "단순 문의는 챗봇 상담을 이용 부탁드리며, 하단에 있는 QR 코드로 확인하실 수 있습니다.", highlight: false },
    {
      text: "주문 건은 정상적으로 접수 후 출고되며, 소파 및 바디필로우 외 일부 제품은 오후 1시 이전 주문 시 당일 출고될 수 있습니다.",
      highlight: true,
    },
  ],
  qrUrl: "https://buly.kr/E7B8rPM",
};

export type LeaveDay = { date: string; type: LeaveType; popup?: boolean };

export type LeavePeriod = {
  id: string; // "시작일_끝일" — '오늘 하루 보지 않기'와 화면 선택에 쓴다
  start: string;
  end: string;
  days: LeaveDay[];
  popup: boolean;
  dateLabel: string; // "10월 30일(금)" · "10월 30일(금) 오후 ~ 11월 2일(월)"
  resumeDay: string;
  resumeTime: "10:00" | "14:00";
  resumeLabel: string; // "11월 2일(월) AM 10:00"
  showFrom: string; // 이날 0시부터 노출
};

function partLabel(day: LeaveDay) {
  const label = dayLabel(day.date);
  if (day.type === "am") return `${label} 오전`;
  if (day.type === "pm") return `${label} 오후`;
  return label;
}

// 휴무를 기간으로 묶는다 — 앞날이 끝까지 닫혀 있고(연차·오후반차) 바로 다음 평일이 아침부터 닫혀 있으면(연차·오전반차) 한 기간.
// 상담 재개는 기간이 오전반차로 끝나면 그날 오후 2시, 아니면 다음 영업일(주말·연차 건너뜀) 10시(그날이 오전반차면 오후 2시).
export function leavePeriods(days: LeaveDay[], leadDays: number): LeavePeriod[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const typeOf = new Map(sorted.map((day) => [day.date, day.type]));
  const groups: LeaveDay[][] = [];
  for (const day of sorted) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    const joins =
      last &&
      (last.type === "full" || last.type === "pm") &&
      (day.type === "full" || day.type === "am") &&
      nextBusinessDay(last.date, () => false) === day.date;
    if (group && joins) group.push(day);
    else groups.push([day]);
  }

  return groups.map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    let resumeDay = last.date;
    let resumeTime: LeavePeriod["resumeTime"] = "14:00";
    if (last.type !== "am") {
      resumeDay = nextBusinessDay(last.date, (day) => typeOf.get(day) === "full");
      resumeTime = typeOf.get(resumeDay) === "am" ? "14:00" : "10:00";
    }
    return {
      id: `${first.date}_${last.date}`,
      start: first.date,
      end: last.date,
      days: group,
      popup: group.some((day) => day.popup !== false),
      dateLabel: group.length === 1 ? partLabel(first) : `${partLabel(first)} ~ ${partLabel(last)}`,
      resumeDay,
      resumeTime,
      resumeLabel: `${dayLabel(resumeDay)} ${resumeTime === "14:00" ? "PM 02:00" : "AM 10:00"}`,
      showFrom: shiftDay(first.date, -leadDays),
    };
  });
}

export function resumeAt(period: LeavePeriod) {
  return new Date(Date.parse(`${period.resumeDay}T${period.resumeTime}:00+09:00`));
}

// 지금 홈페이지에 띄울 때인가 — 노출 시작일 0시부터 상담이 다시 열릴 때까지
export function isNoticeShowing(period: LeavePeriod, now = new Date()) {
  return period.popup && now >= kstDayRange(period.showFrom).start && now < resumeAt(period);
}

export const SAMPLE_PERIOD_ID = "sample";

// 예정된 휴무가 없을 때 화면에 보여 줄 예시 — 다음 영업일 하루 연차(홈페이지에는 뜨지 않는다)
export function samplePeriod(leadDays: number, today: string): LeavePeriod {
  const [period] = leavePeriods([{ date: nextBusinessDay(today, () => false), type: "full" }], leadDays);
  return { ...period, id: SAMPLE_PERIOD_ID };
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export const NOTICE_COLORS = { border: "#3cc4d6", title: "#2f3a45", text: "#333d47", banner: "#ff8a1f", highlight: "#139fb5" };
// 홈페이지(yogibo.kr)가 쓰는 Pretendard — 홈페이지는 이미 불러와 두고 있어 팝업도 그대로 쓴다. 관리 화면 미리보기는 같은 CSS 를 불러온다.
export const NOTICE_FONT = "Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif";
export const PRETENDARD_CSS_URL = "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/static/pretendard.min.css";
export const YOGIBO_LOGO_URL = "https://yogibo.kr/web/img/icon/logo3_on.png";

// 상담원 헤드셋 + 말풍선 아이콘
export const HEADSET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><path d="M18 52V45a30 30 0 0 1 60 0v7" fill="none" stroke="#2b3440" stroke-width="7" stroke-linecap="round"/><rect x="9" y="45" width="17" height="27" rx="8" fill="#2b3440"/><rect x="70" y="45" width="17" height="27" rx="8" fill="#2b3440"/><path d="M79 70q0 15-19 17" fill="none" stroke="#2b3440" stroke-width="5" stroke-linecap="round"/><circle cx="48" cy="54" r="21" fill="${NOTICE_COLORS.border}"/><path d="M35 70l-7 13 15-8z" fill="${NOTICE_COLORS.border}"/><circle cx="39.5" cy="54" r="3.4" fill="#fff"/><circle cx="48" cy="54" r="3.4" fill="#fff"/><circle cx="56.5" cy="54" r="3.4" fill="#fff"/></svg>`;

// 본문 줄 — {휴무일} 자리를 굵은 날짜로 바꾼다(글은 모두 이스케이프).
export function bodyLines(settings: LeaveNoticeSettings, period: LeavePeriod) {
  return settings.body.split(/\r?\n/).map((line) => {
    const index = line.indexOf(DATE_TOKEN);
    return index < 0
      ? { before: line, date: "", after: "" }
      : { before: line.slice(0, index), date: period.dateLabel, after: line.slice(index + DATE_TOKEN.length) };
  });
}

// cafe24 팝업·미리보기용 HTML(인라인 스타일 한 덩어리) — qrSvg 는 서버가 qrcode 로 만든 SVG
// 글자·여백은 clamp 로 PC 에서는 원래 크기, 휴대폰처럼 좁은 화면에서만 줄인다(인라인이라 미디어 쿼리 대신).
export function noticeHtml(period: LeavePeriod, settings: LeaveNoticeSettings, qrSvg: string) {
  const c = NOTICE_COLORS;
  // 좁은 화면에서 '10월 29일 / (목)', 'AM / 10:00' 처럼 끊기지 않게 날짜 덩어리는 한 줄로(기간은 ~ 에서만 넘어감)
  const keep = (text: string) => `<span style="white-space:nowrap">${escapeHtml(text)}</span>`;
  const body = bodyLines(settings, period)
    .map(
      (line) =>
        `${escapeHtml(line.before)}${line.date ? `<strong style="font-weight:800;color:${c.title}">${line.date.split(" ~ ").map(keep).join(" ~ ")}</strong>` : ""}${escapeHtml(line.after)}`,
    )
    .join("<br>");
  const notes = settings.notes
    .filter((note) => note.text.trim())
    .map(
      (note) =>
        `<div style="padding-left:1.3em;text-indent:-1.3em;margin-top:6px;color:${note.highlight ? c.highlight : c.text}">※ ${escapeHtml(note.text.trim())}</div>`,
    )
    .join("");
  return [
    `<div style="box-sizing:border-box;width:100%;max-width:640px;margin:0 auto;border:6px solid ${c.border};background:#fff;padding:clamp(18px,5vw,30px) clamp(16px,5vw,34px) clamp(16px,4vw,24px);font-family:${NOTICE_FONT};color:${c.text};text-align:center;word-break:keep-all">`,
    `<div style="font-size:clamp(21px,6vw,28px);font-weight:800;color:${c.title};letter-spacing:-0.5px">${escapeHtml(settings.title)}</div>`,
    `<div style="width:clamp(64px,18vw,92px);height:clamp(64px,18vw,92px);margin:clamp(12px,3.5vw,18px) auto clamp(8px,2.5vw,12px)">${HEADSET_SVG.replace('width="96" height="96"', 'width="100%" height="100%"')}</div>`,
    `<div style="font-size:clamp(15px,4.3vw,18px);line-height:1.75">${body}</div>`,
    `<div style="margin:clamp(14px,4vw,18px) 0 12px;background:${c.banner};color:#fff;font-size:clamp(16px,4.6vw,20px);font-weight:800;padding:8px 10px">${escapeHtml(settings.resumePrefix)} : ${keep(period.resumeLabel)}</div>`,
    `<div style="text-align:left;font-size:clamp(13px,3.6vw,14px);line-height:1.55">${notes}</div>`,
    `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px">`,
    settings.qrUrl
      ? `<div style="width:clamp(66px,18vw,86px);height:clamp(66px,18vw,86px)">${qrSvg.replace("<svg ", '<svg width="100%" height="100%" ')}</div>`
      : "<div></div>",
    `<img src="${YOGIBO_LOGO_URL}" alt="Yogibo" style="height:clamp(24px,6.5vw,30px);width:auto">`,
    `</div></div>`,
  ].join("");
}
