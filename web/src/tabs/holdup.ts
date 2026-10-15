// The Does it hold up? chapter's words that are not a card's own: the finding, its sub-line, the one-line finding
// beside each More row (at most twenty words) and the two More lists' keys, which are also the rows' anchor prefixes
// (`wf-<key>`, `sens-<key>`).
//
// The finding is counted from the published strings (src/content/published.ts), never recomputed; the rows' findings
// come from the same model functions their cards draw from, so a row never promises a figure its card does not carry.
import { PUBLISHED_SETS } from "../content/published.ts";
import { WALK_RUNS } from "../content/walkforward.ts";
import { format } from "../format.ts";
import { MIX } from "../overview/model.ts";
import { customWeights, metricRows, sharpeChartTitle, sharpeGroups, type Port, type WindowFit } from "./sensitivity/model.ts";
import type { CustomWeights } from "../types.ts";

/** The walk-forward test's More list and its rows, in the order the chapter shows them. */
export const WF_LIST = "wf";
export const WF_ROWS = {
  basket: "Your basket: the same test, run now",
  holds: "Hold by hold, as published",
} as const;
export const WF_HEADING = "More on the test";

/** The estimation-window rows, the chapter's second list. */
export const SENS_LIST = "sens";
export const SENS_ROWS = {
  weights: "Weights across windows",
  metrics: "Portfolio metrics across windows (in-sample)",
  custom: "Your mix across windows (Custom)",
} as const;
export const SENS_HEADING = "If the fitting window changed";

// A published string as the number it reads: the note writes a negative with the minus sign U+2212.
const valueOf = (published: string) => Number(published.replace("−", "-"));

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const said = (n: number) => NUMBER_WORDS[n] ?? format(n, "int");

/** The published sets on which the equal split's out-of-sample Sharpe ratio beat both fitted mixes'. */
export function equalWins(): string[] {
  return PUBLISHED_SETS.filter((p) => valueOf(p.ew) > Math.max(valueOf(p.gmv), valueOf(p.tangency))).map((p) => p.name);
}

/** The chapter's finding: on how many published baskets the equal split beat both fitted mixes on days they had not seen. */
export function holdupFinding(): string {
  const n = equalWins().length;
  return `On years the weights had not seen, an ${MIX.ew.short.toLowerCase()} beat both fitted mixes on ${said(n)} of the ${said(PUBLISHED_SETS.length)} published baskets.`;
}

/** The finding's sub-line: what the test did, counted from the stored record of the run. */
export function holdupSub(): string {
  const holds = WALK_RUNS[0]?.folds.length ?? 0;
  return `Weights fitted on earlier prices, then held unchanged through the next year: ${said(holds)} holds, each refitted first.`;
}

/** Your basket's finding: the run is solved after the row opens, so the line says what it will hold. */
export function basketFinding(): string {
  return "The same test solved on the basket in the bar: in-sample against out-of-sample, and every hold.";
}

/** Hold by hold's finding: what each published set's tables hold. */
export function holdsFinding(): string {
  const holds = WALK_RUNS[0]?.folds.length ?? 0;
  return `Each published set's ${said(holds)} holds: the days held, each hold's Sharpe ratio, and the weights chosen before it.`;
}

/** The metrics row's finding: how far the tangency's in-sample Sharpe ratio moves with the window. */
export function metricsFinding(fits: WindowFit[], rf: number, p: Port = "tan"): string {
  let lo: { v: number; w: string } | null = null;
  let hi: { v: number; w: string } | null = null;
  for (const row of metricRows(fits, p, rf)) {
    const v = row.sharpe;
    if (typeof v !== "number") continue;
    const w = String(row.window);
    if (!lo || v < lo.v) lo = { v, w };
    if (!hi || v > hi.v) hi = { v, w };
  }
  if (!lo || !hi) return "No window's tangency portfolio could be scored.";
  return `In-sample, the tangency's Sharpe ratio runs from ${format(lo.v, "num3")} (${lo.w}) to ${format(hi.v, "num3")} (${hi.w}).`;
}

/** The custom row's finding: its Sharpe chart's title, or that the weights cannot be scored. */
export function customFinding(fits: WindowFit[], tickers: readonly string[], weights: CustomWeights, rf: number, allowShort: boolean): string {
  const c = customWeights(tickers, weights, allowShort);
  if (!c.ok) return "Not evaluated: your mix's weights cannot be scored as they stand.";
  return `${sharpeChartTitle(sharpeGroups(fits, c.w, rf), fits[0].to)}.`;
}
