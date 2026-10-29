import { deleteModel, model, models, Schema } from "mongoose";
import { TRASH_DAYS } from "@/lib/liveChatOptions";

// 실시간 상담 대화방 — 카카오 상담 연결을 대체한다.
// 고객은 visitorToken(브라우저 localStorage 보관)으로만 자기 대화방에 접근할 수 있다.
// messageSeq 는 메시지 순번 발급용 카운터로, 폴링 시 "이 순번 이후" 조회에 쓴다.
const liveChatSchema = new Schema(
  {
    // 상담번호(LC-YYMMDD-NNN) — 날짜별 일련번호. 전화·클레임에서 상담을 가리킬 때 쓴다.
    ticketNo: { type: String, default: "", index: true },
    channel: { type: String, required: true, index: true },
    visitorToken: { type: String, required: true },
    sessionId: { type: String, default: "" },
    memberId: { type: String, default: "" },
    status: {
      type: String,
      enum: ["waiting", "active", "closed"],
      default: "waiting",
      index: true,
    },
    entry: {
      faqId: { type: String, default: "" },
      faqQuestion: { type: String, default: "" },
      category: { type: String, default: "" },
      aiQuery: { type: String, default: "" },
    },
    // 상담 시작 전 사전 질문 — 구매처는 lib/liveChatOptions 의 key, 문의 유형은 FAQ 카테고리명.
    intake: {
      purchasePlace: { type: String, default: "" },
      inquiryType: { type: String, default: "" },
      orderNumber: { type: String, default: "" },
    },
    // 유입 경로(lib/visitSource) — 자사몰 iframe, 카카오톡, 전화 연결 문자 링크 등.
    source: {
      via: { type: String, default: "" },
      app: { type: String, default: "" },
      embedded: { type: Boolean, default: false },
      parentOrigin: { type: String, default: "" },
      referrer: { type: String, default: "" },
      param: { type: String, default: "" },
    },
    // 네이버 톡톡 상담(source.via = "talktalk") — user 는 톡톡 사용자 식별값(답변을 톡톡으로 보낼 때만 쓰고 화면에는 내보내지 않는다).
    // openUser 는 진행 중(대기·상담중)일 때만 user 와 같은 값 — 고유 인덱스로 고객마다 진행 중 상담을 하나로 막는다
    // (인덱스는 톡톡을 처음 받을 때 lib/naverTalk 가 만든다). 상품 페이지의 '톡톡문의'로 들어오면 그 상품을 남긴다.
    // 셀프가이드 상담에는 이 값이 없다.
    talk: {
      user: { type: String },
      openUser: { type: String },
      productName: { type: String },
      productUrl: { type: String },
      // 둘째 톡톡 계정으로 들어온 상담이면 "2"(lib/naverTalk 의 계정 key) — 첫 계정은 비어 있다.
      account: { type: String },
    },
    // 운영시간 외·휴무 시간에 받은 상담 — 실시간 대화 대신 '문의 접수'로 받는다.
    offHours: { type: Boolean, default: false },
    // 문의 접수 때 받은 답변 안내용 휴대폰과 개인정보 수집·이용 동의 시각.
    contact: {
      phone: { type: String, default: "" },
      consentAt: { type: Date },
    },
    // 답변 안내 문자를 보낸 때 — 지금은 상담원이 직접 보내고 표시한다(문자 발송 서비스를 붙이면 자동 기록).
    notifiedAt: { type: Date },
    messageSeq: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, default: "" },
    lastSender: { type: String, default: "" },
    agentUnread: { type: Number, default: 0 },
    visitorSeenAt: { type: Date },
    firstResponseAt: { type: Date },
    closedAt: { type: Date },
    closedBy: { type: String, default: "" },
    // 상담 결과(lib/liveChatOptions 의 CHAT_OUTCOMES key) — 상담원이 종료할 때 고른다. 고객이 직접 종료하면 비어 있다(미분류).
    outcome: {
      result: { type: String, default: "" },
      memo: { type: String, default: "" },
      decidedAt: { type: Date },
    },
    // 휴지통 — deletedAt 이 있으면 목록·검색·통계에서 빠지고, TTL 인덱스가 TRASH_DAYS 뒤 문서를 지운다.
    deletedAt: { type: Date },
    deleteReason: { type: String, default: "" },
    // 이 상담을 응대 자산(클레임)으로 보냈으면 그 클레임 id — 중복 승격을 막는다.
    assetClaimId: { type: String, default: "" },
  },
  { timestamps: true },
);

liveChatSchema.index({ createdAt: -1 });
liveChatSchema.index({ deletedAt: 1 }, { expireAfterSeconds: TRASH_DAYS * 24 * 60 * 60 });

// 개발 서버(HMR)는 예전 스키마로 만든 모델을 계속 들고 있어 새 필드가 저장 때 버려진다.
// 개발 중에는 모듈이 다시 읽힐 때마다 모델을 새 스키마로 다시 등록한다(운영 빌드에는 영향 없음).
if (process.env.NODE_ENV !== "production" && models.LiveChat) deleteModel("LiveChat");

export const LiveChat = models.LiveChat || model("LiveChat", liveChatSchema);
