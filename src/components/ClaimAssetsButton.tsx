"use client";

import { FileSpreadsheet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ClaimManager } from "@/components/ClaimManager";
import type { ClaimItem } from "@/lib/repositories/claimRepository";

// 응대 자산(클레임) 관리 — 별도 메뉴 대신 FAQ 관리 화면 위쪽 버튼으로 팝업을 띄운다.
// 실시간 상담·녹취에서 승격된 자산이 '검토 대기'로 쌓이므로 버튼에 그 수를 보여준다.
export function ClaimAssetsButton({
  initialClaims,
  reviewCount,
  autoOpen = false,
}: {
  initialClaims: ClaimItem[];
  reviewCount: number;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    // 팝업이 열려 있는 동안 뒤 화면이 스크롤되지 않게
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button type="button" className="guide-link claim-assets-link" onClick={() => setOpen(true)}>
        <FileSpreadsheet size={16} />
        응대 자산 관리
        {reviewCount > 0 && <span className="claim-assets-count">검토 대기 {reviewCount}</span>}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="응대 자산 관리">
          <div className="modal-card claim-assets-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-head">
              <div className="modal-title">
                <FileSpreadsheet size={18} />
                <h3>응대 자산 관리</h3>
              </div>
              <button type="button" className="modal-close" aria-label="닫기" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <p className="claim-assets-desc">
              과거 문의·응대 기록과 실시간 상담·녹취에서 보낸 응대를 검수해 ‘라이브’로 바꾸면 AI 답변 근거로 쓰여요. 고객
              화면에는 노출되지 않아요.
            </p>
            <div className="claim-assets-body">
              <ClaimManager initialClaims={initialClaims} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
