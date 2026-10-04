// What the tabs' tables say about themselves, in one place so every tab says it the same way.
//
// The span: under each table's title, the dates its figures come from and how often the returns behind
// them were sampled. Every table on these tabs is computed from daily closes today; a table built from
// calendar-month returns passes "monthly" and says so.
//
// The fitted head: every column whose weights an optimiser chose from the same prices every figure beside it
// is computed on (GMV, Tangency, and on the scorecard each added construction solved on the whole window)
// says "weights chosen on this window"; the last-year construction says its own LAST_YEAR line instead.
// Equal weights are fixed in advance and a custom mix is whatever was typed, so theirs never carry it.
import { format } from "../format.ts";
import { FITTED } from "../content/words.ts";

export type Frequency = "daily" | "monthly";

const FREQ: Readonly<Record<Frequency, string>> = { daily: "Daily", monthly: "Monthly" };

/** "Daily returns, 2019-01-03 to 2026-09-28": the table's figures come from these dates. */
export function tableSpan(from: string, to: string, freq: Frequency = "daily", of: "returns" | "closes" = "returns"): string {
  return `${FREQ[freq]} ${of}, ${format(from, "date")} to ${format(to, "date")}`;
}

/** Tables with a row or a column per estimation window, every window ending on the same day. */
export function windowsSpan(to: string, freq: Frequency = "daily"): string {
  return `${FREQ[freq]} returns, each window ending ${format(to, "date")}`;
}

/**
 * The sub-line under the head of every column solved on this window (defined in content/words.ts, which the band
 * shares).
 */
export { FITTED };

/** A Table `subs` map giving each of these heads the fitted sub-line. */
export function fittedSubs(heads: readonly string[]): Record<string, string> {
  return Object.fromEntries(heads.map((h) => [h, FITTED]));
}
