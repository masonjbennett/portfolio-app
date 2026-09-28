// The phone's rail: one line saying what the page is computing ("5 tickers · 2019 to today ·
// rf 4.1%"), which opens a sheet holding the same Rail. Computed from the settings, never typed.
import { useEffect, useRef, type ReactNode } from "react";
import { format } from "../format.ts";
import { RF_FALLBACK } from "../state/defaults.ts";
import type { LoadState, RfRate, Settings, SummaryChipProps } from "../types.ts";
import "./SummaryChip.css";

export const SHEET_ID = "settings-sheet";

// The rate the page is using: the typed one, else the live one, else the placeholder the page
// falls back to when the live lookup fails (711). null while the lookup is still out.
function rateInUse(settings: Settings, rf: LoadState<RfRate>): number | null {
  if (settings.rf !== null) return settings.rf;
  if (rf.status === "ready") return rf.value.rate;
  return rf.status === "loading" ? null : RF_FALLBACK;
}

export function summaryText(settings: Settings, rf: LoadState<RfRate>): string {
  const n = settings.tickers.length;
  const to = settings.end === null ? "today" : settings.end.slice(0, 4);
  const rate = rateInUse(settings, rf);
  return `${n} ${n === 1 ? "ticker" : "tickers"} · ${settings.start.slice(0, 4)} to ${to} · rf ${rate === null ? "loading" : format(rate, "pct1")}`;
}

export default function SummaryChip({ settings, rf, open, onToggle }: SummaryChipProps) {
  return (
    <button type="button" className="chip" aria-expanded={open} aria-controls={SHEET_ID} onClick={onToggle}>
      <span className="chip-label">Settings</span>
      <span className="chip-summary">{summaryText(settings, rf)}</span>
    </button>
  );
}

// The sheet the chip opens: the rail, over the page, from the bottom edge. Escape, the backdrop
// and Done close it; focus moves into it on open and back to the chip on close.
export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        id={SHEET_ID}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="sheet-title">Settings</span>
          <button type="button" className="sheet-done" onClick={onClose}>
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
