import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
// universal 진입점(ArrayBuffer 입력) — /node 는 unzipper 를 거쳐 쓰지 않는 S3 모듈까지 끌어와 Next 빌드가 실패한다.
import readXlsxFile from "read-excel-file/universal";

// TWC(클라우드게이트) 티켓 엑셀 → 티켓 목록. DB·드롭박스와 무관한 변환만 한다(lib/twcTickets 가 가져오기를 맡는다).
// 머리글 이름으로 칸을 찾는다 — 연도마다 이름이 조금 다르다(요청일자/요청일시, 녹취시작시간/통화시작시간).

export type TwcTicketRow = {
  ticketId: string;
  brand: string;
  channel: string;
  status: string;
  title: string;
  category: string; // "대분류 > 중분류 > 소분류"(있는 것만)
  customerName: string;
  phone: string; // 숫자만
  agent: string;
  requestedAt?: Date;
  callStartedAt?: Date;
  recordingFile: string;
  memo: string;
  tags: string[];
};

type Cell = string | number | boolean | Date | null | undefined;

const COLUMNS = {
  ticketId: ["ID"],
  brand: ["브랜드명"],
  channel: ["인입채널", "접수채널"],
  status: ["티켓상태"],
  title: ["제목"],
  major: ["대분류"],
  middle: ["중분류"],
  minor: ["소분류"],
  customerName: ["고객명"],
  phone: ["고객연락처", "연락처"],
  agent: ["담당자"],
  requestedAt: ["요청일자", "요청일시"],
  callStartedAt: ["녹취시작시간", "통화시작시간"],
  recordingFile: ["녹취파일명"],
  memo: ["메모"],
  tags: ["태그"],
} as const;

type Field = keyof typeof COLUMNS;

function text(value: Cell) {
  if (value === null || value === undefined || value instanceof Date) return "";
  return String(value).trim();
}

// 엑셀 날짜 칸은 시간대가 없어 UTC 시각으로 읽힌다 — 적힌 시각이 한국 시간이므로 9시간을 빼서 실제 시각으로 바꾼다.
// 엑셀 날짜는 소수라 10:00:00 이 09:59:59.999 로 읽히기도 해서 초 단위로 반올림한다.
// 글자로 적힌 날짜("2025-01-02 10:11:12")도 한국 시간으로 읽는다.
export function kstCellDate(value: Cell): Date | undefined {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : new Date(Math.round(time / 1000) * 1000 - 9 * 3600_000);
  }
  const match = text(value).match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return undefined;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = match;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - 9 * 3600_000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// 연락처 — 숫자만 남긴다. 숫자 칸으로 저장돼 앞의 0 이 빠진 번호(1012345678)는 0 을 되살린다.
// 1588 같은 대표번호(8자리)는 그대로 둔다.
export function cellPhone(value: Cell) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const digits = String(Math.round(value));
    return digits.length >= 9 && !digits.startsWith("0") ? `0${digits}` : digits;
  }
  const digits = text(value).replace(/\D/g, "");
  if (/^1[016789]\d{7,8}$/.test(digits)) return `0${digits}`;
  return digits;
}

function splitTags(value: Cell) {
  const tags = text(value)
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  return Array.from(new Set(tags)).slice(0, 8);
}

// 머리글 줄 — 칸이 3개 이상 찬 첫 줄.
function findHeader(rows: Cell[][]) {
  const index = rows.findIndex((row) => row.filter((cell) => text(cell) !== "").length >= 3);
  if (index < 0) return null;
  const names = rows[index].map((cell) => text(cell));
  const columns = {} as Record<Field, number>;
  for (const [field, aliases] of Object.entries(COLUMNS) as Array<[Field, readonly string[]]>) {
    columns[field] = names.findIndex((name) => aliases.includes(name));
  }
  return { index, columns };
}

export class TwcSheetError extends Error {}

// 시트 하나를 티켓으로 바꾼다. 티켓 ID 가 없는 줄은 건너뛰고(skipped), 같은 ID 가 또 나오면 뒤의 것을 쓴다.
export function parseTwcSheet(rows: Cell[][]) {
  const header = findHeader(rows);
  if (!header || header.columns.ticketId < 0) throw new TwcSheetError("TWC 티켓 엑셀 형식이 아니에요(ID 칸을 찾지 못했어요).");
  const { columns } = header;
  const cell = (row: Cell[], field: Field) => (columns[field] >= 0 ? row[columns[field]] : undefined);

  const tickets = new Map<string, TwcTicketRow>();
  let skipped = 0;
  for (const row of rows.slice(header.index + 1)) {
    if (!row.some((value) => text(value) !== "" || value instanceof Date)) continue;
    const ticketId = text(cell(row, "ticketId"));
    if (!ticketId) {
      skipped++;
      continue;
    }
    tickets.set(ticketId, {
      ticketId,
      brand: text(cell(row, "brand")),
      channel: text(cell(row, "channel")),
      status: text(cell(row, "status")),
      title: text(cell(row, "title")),
      category: [cell(row, "major"), cell(row, "middle"), cell(row, "minor")].map(text).filter(Boolean).join(" > "),
      customerName: text(cell(row, "customerName")),
      phone: cellPhone(cell(row, "phone")),
      agent: text(cell(row, "agent")),
      requestedAt: kstCellDate(cell(row, "requestedAt")),
      callStartedAt: kstCellDate(cell(row, "callStartedAt")),
      recordingFile: text(cell(row, "recordingFile")),
      memo: text(cell(row, "memo")),
      tags: splitTags(cell(row, "tags")),
    });
  }
  return { tickets: [...tickets.values()], skipped };
}

// TWC 내보내기는 빈 칸을 <c t="inlineStr"></c> 로 적는데 read-excel-file 이 이 모양을 읽지 못한다 — 그런 칸은 빈 칸으로 바꾼다.
function dropEmptyInlineCells(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  let changed = false;
  for (const [name, data] of Object.entries(files)) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) continue;
    const xml = strFromU8(data);
    const fixed = xml.replace(/<c ([^>]*?)\s*t="inlineStr"([^>]*?)\s*(?:\/>|>(?:<is\s*\/>|<is>\s*<\/is>|<is><t\s*\/><\/is>)?<\/c>)/g, "<c $1$2/>");
    if (fixed !== xml) {
      files[name] = strToU8(fixed);
      changed = true;
    }
  }
  return changed ? zipSync(files, { level: 0 }) : bytes;
}

// 엑셀 파일 전체(모든 시트) → 티켓.
export async function readTwcWorkbook(buffer: Buffer) {
  const bytes = dropEmptyInlineCells(new Uint8Array(buffer));
  const sheets = await readXlsxFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const tickets: TwcTicketRow[] = [];
  let skipped = 0;
  for (const { data } of sheets) {
    const parsed = parseTwcSheet(data as Cell[][]);
    tickets.push(...parsed.tickets);
    skipped += parsed.skipped;
  }
  return { tickets, skipped };
}
