// The phone's basket bar: one row saying what the page is computing ("5 tickers · 2019– ·
// rf 4.1%") over the benchmark and the day the prices run to, which opens a sheet holding every setting.
// Computed from the settings, never typed.
import { useEffect, useRef, type ReactNode } from "react";
import { format } from "../format.ts";
import { benchDisplay } from "../state/defaults.ts";
import type { LoadState, RfRate, Settings, SummaryChipProps } from "../types.ts";
import { PricesLine } from "./BasketBar.tsx";
import { rateInUse } from "./Settings.tsx";
import "./SummaryChip.css";

export const SHEET_ID = "settings-sheet";

// The years as a span, in the fewest characters that stay unambiguous: "2019–" runs to today (the line under it
// says the day the prices reach), "2019–24" ends in a set year of the same century, "1999–2004" crosses one.
// The long form ("2019 to today") needed 269 px of the 233 a 375 px phone gives the line, which cut the rate
// to "r…" (review F6, Oct 14 2026).
export function yearSpan(start: string, end: string | null): string {
  const from = start.slice(0, 4);
  if (end === null) return `${from}–`;
  const to = end.slice(0, 4);
  return `${from}–${to.slice(0, 2) === from.slice(0, 2) ? to.slice(2) : to}`;
}

export function summaryText(settings: Settings, rf: LoadState<RfRate>): string {
  const n = settings.tickers.length;
  const rate = rateInUse(settings, rf);
  return `${n} ${n === 1 ? "ticker" : "tickers"} · ${yearSpan(settings.start, settings.end)} · rf ${rate === null ? "loading" : format(rate, "pct1")}`;
}

export default function SummaryChip({ settings, rf, open, onToggle, analysis, fetching = false }: SummaryChipProps) {
  return (
    <button type="button" className="chip" aria-expanded={open} aria-controls={SHEET_ID} onClick={onToggle}>
      <span className="chip-lines">
        <span className="chip-summary">{summaryText(settings, rf)}</span>
        <span className="chip-sub">
          {benchDisplay(settings.benchmark)}
          {analysis ? <PricesLine analysis={analysis} fetching={fetching} className="chip-prices" /> : null}
        </span>
      </span>
      <span className="chip-label">Settings</span>
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
