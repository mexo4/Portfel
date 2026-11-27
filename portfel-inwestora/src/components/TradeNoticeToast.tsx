"use client";

import { useEffect } from "react";
import type { TradeNotice } from "@/lib/trade-notice";

const VISIBLE_MS = 10_000;

/** A confirmation that stays on screen for a while, whatever part of the page is in view. */
export default function TradeNoticeToast({ notice, onClose }: { notice: TradeNotice | null; onClose: () => void }) {
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onClose, VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, onClose]);

  // The live region is always present, so screen readers announce what appears in it.
  return (
    <div className="trade-notice-region" role="status" aria-live="polite">
      {notice ? (
        <div key={notice.id} className={`trade-notice is-${notice.side}`}>
          <span className="trade-notice-mark" aria-hidden="true">{notice.side === "buy" ? "+" : "−"}</span>
          <p><strong>{notice.title}</strong><span>{notice.detail}</span></p>
          <button type="button" onClick={onClose} aria-label="Zamknij powiadomienie">×</button>
        </div>
      ) : null}
    </div>
  );
}
