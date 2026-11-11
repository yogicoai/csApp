import type { AnyBulkWriteOperation } from "mongoose";
import { connectDB } from "@/lib/db";
import { downloadFile, isTwcTicketPath, listFiles, TWC_TICKET_FOLDER } from "@/lib/dropbox";
import { readTwcWorkbook, type TwcTicketRow } from "@/lib/twcTicketRows";
import { VoiceCall } from "@/models/VoiceCall";

// TWC(클라우드게이트) 지난 티켓 — 고객지원 드롭박스 폴더의 연도·월별 엑셀을 음성 상담 분석 자료로 옮긴다.
// 칸을 그대로 옮기고(AI 로 다시 분석하지 않음), 티켓 ID 로 합쳐서 같은 엑셀을 다시 가져와도 겹치지 않는다.
// 기록 시각(createdAt)은 TWC 요청일자로 둔다 — 목록·기간 리포트에서 실제 상담한 때에 놓이게.

const BATCH = 1000;

// 폴더의 엑셀과 파일별로 가져온 건수.
export async function twcFolderStatus() {
  const files = (await listFiles(TWC_TICKET_FOLDER))
    .filter((file) => isTwcTicketPath(file.path))
    .sort((a, b) => a.path.localeCompare(b.path, "ko"));
  await connectDB();
  // 한 티켓이 엑셀 여러 개에 들어 있으면(기간이 겹치게 내보낸 경우) 파일마다 센다 — 합계는 티켓 수로 따로 센다.
  const [counts, total] = await Promise.all([
    VoiceCall.aggregate<{ _id: string | null; count: number }>([
      { $match: { source: "twc" } },
      { $unwind: "$twc.sourceFiles" },
      { $group: { _id: "$twc.sourceFiles", count: { $sum: 1 } } },
    ]),
    VoiceCall.countDocuments({ source: "twc" }),
  ]);
  const byFile = new Map(counts.map((row) => [String(row._id ?? "").toLowerCase(), row.count]));
  return {
    folder: TWC_TICKET_FOLDER,
    total,
    files: files.map((file) => ({ ...file, imported: byFile.get(file.path.toLowerCase()) ?? 0 })),
  };
}

function toUpsert(ticket: TwcTicketRow, sourceFile: string, now: Date): AnyBulkWriteOperation {
  return {
    updateOne: {
      filter: { "twc.ticketId": ticket.ticketId },
      update: {
        $set: {
          source: "twc",
          "twc.ticketId": ticket.ticketId,
          "twc.brand": ticket.brand,
          "twc.channel": ticket.channel,
          "twc.status": ticket.status,
          "twc.agent": ticket.agent,
          "twc.recordingFile": ticket.recordingFile,
          fileName: ticket.recordingFile || `TWC ${ticket.ticketId}`,
          callDate: ticket.callStartedAt ?? ticket.requestedAt ?? null,
          phoneNumber: ticket.phone,
          status: "done",
          error: "",
          analysis: {
            category: ticket.category,
            tags: ticket.tags,
            summary: ticket.title, // 티켓 제목
            inquiry: ticket.memo, // 상담원이 남긴 메모(문의와 안내가 함께 적혀 있다)
            response: "",
            customerName: ticket.customerName,
            customerPhone: "",
            product: "",
            orderInfo: "",
            followUp: "",
            draftAnswer: "",
            faqCandidate: "",
            sentiment: "",
          },
        },
        // 이 티켓이 들어 있던 엑셀 — 파일별 '가져온 건수'에 쓴다.
        $addToSet: { "twc.sourceFiles": sourceFile },
        // 수정 시각은 처음 넣을 때만 — 매번 바꾸면 내용이 같아도 '바뀜'으로 세어진다.
        $setOnInsert: {
          createdAt: ticket.requestedAt ?? ticket.callStartedAt ?? now,
          updatedAt: now,
          audioPath: "",
          dropboxPath: "",
          mimeType: "",
          durationSec: 0,
          transcript: "",
          assetClaimId: "",
        },
      },
      upsert: true,
    },
  };
}

// 엑셀 하나를 가져온다 — 새로 넣은 건(inserted)·바뀐 건(updated)·그대로인 건(unchanged)·ID 없어 건너뛴 줄(skipped).
export async function importTwcFile(path: string) {
  const { tickets, skipped } = await readTwcWorkbook(await downloadFile(path));

  await connectDB();
  await VoiceCall.init(); // 티켓 ID 고유 인덱스가 있어야 두 번 가져와도 겹치지 않는다
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  for (let start = 0; start < tickets.length; start += BATCH) {
    const ops = tickets.slice(start, start + BATCH).map((ticket) => toUpsert(ticket, path, now));
    const result = await VoiceCall.bulkWrite(ops, { ordered: false, timestamps: false });
    inserted += result.upsertedCount;
    updated += result.modifiedCount;
  }
  return { path, rows: tickets.length, inserted, updated, unchanged: tickets.length - inserted - updated, skipped };
}
