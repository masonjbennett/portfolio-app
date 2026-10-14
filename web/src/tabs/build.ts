// The Build a portfolio chapter's words that are not a card's own: the one-line finding beside each More row (at
// most twenty words, a figure the card under it then shows in full) and the More list's key, which is also the rows'
// anchor prefix (`build-<key>`).
//
// Each finding is computed from the same model functions the card draws from, so a row never promises a figure its
// card does not carry. A finding that cannot be stated (a missing figure) says what is missing.
import { format } from "../format.ts";
import type { Custom } from "../lib/portfolio.ts";
import { MIX } from "../overview/model.ts";
import type { Analysis } from "../types.ts";
import { stripRows } from "./optimization/DotStrips.tsx";
import { portRow, prcTitle, weightsOf, weightsTitle, type PortId } from "./optimization/model.ts";
import type { RedrawState } from "./optimization/scorecard.ts";

/** The More list and its rows, in the order the chapter shows them. */
export const BUILD_LIST = "build";
export const BUILD_ROWS = {
  scorecard: "Scorecard",
  holdings: "What each mix holds",
  redraws: "If the averages were a little off",
  prc: "Risk contribution",
  whatif: "What if one expected return were different?",
} as const;
export const BUILD_HEADING = "More on the mixes";

// A mix in a finding: the plain name first, the scorecard's column head beside it.
const NAMED: Readonly<Record<PortId | "custom", string>> = {
  tangency: `${MIX.tangency.short} (Tangency)`,
  ew: `${MIX.ew.short} (Equal-Weight)`,
  gmv: `${MIX.gmv.short} (GMV)`,
  custom: "Your mix (Custom)",
};

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

// Which mix had the highest Sharpe ratio, and where the reader's own mix and the benchmark stand. The figures are
// the scorecard's Sharpe row (the same returns, the same rate).
export function scorecardFinding(a: Analysis, c: Custom): string {
  const ids: PortId[] = ["tangency", "gmv", "ew"];
  let top: { who: string; s: number } | null = null;
  for (const id of ids) {
    const w = weightsOf(a, id);
    const s = w ? portRow(a, w).sharpe : NaN;
    if (num(s) && (!top || s > top.s)) top = { who: NAMED[id], s };
  }
  if (!top) return "No mix could be scored on this window.";
  const mine = c.ok ? portRow(a, c.w).sharpe : NaN;
  const bench = a.benchStats.sharpe;
  const rest = [num(mine) ? `Your mix ${format(mine, "num3")}` : null, num(bench) ? `${a.benchLabel} ${format(bench, "num3")}` : null].filter(Boolean);
  return `Highest Sharpe: ${top.who}, ${format(top.s, "num3")}.${rest.length ? ` ${rest.join("; ")}.` : ""}`;
}

// Each optimised mix's largest holding: the weights chart's own title.
export function holdingsFinding(a: Analysis): string {
  return `${weightsTitle(a)}.`;
}

// The asset whose tangency weight the redraws spread widest, 10th to 90th percentile. The draws are solved after the
// chapter paints, so until then the finding says they are on their way.
export function redrawsFinding(a: Analysis, redraws: RedrawState): string {
  if (redraws.status === "pending") return "Solving the redraws of both optimised mixes.";
  if (redraws.status === "error") return "The redraws failed.";
  if (!redraws.value) return "No draws: the covariance matrix has no Cholesky factor.";
  let wide: { ticker: string; p10: number; p90: number } | null = null;
  for (const r of stripRows(a, redraws.value)) {
    if (num(r.p10) && num(r.p90) && (!wide || r.p90 - r.p10 > wide.p90 - wide.p10)) wide = r;
  }
  if (!wide) return "No redraw could be solved.";
  return `Over ${redraws.value.count} redraws, ${wide.ticker}'s Tangency weight spans ${format(wide.p10, "pct1")} to ${format(wide.p90, "pct1")}, 10th to 90th.`;
}

// The asset carrying most of each optimised mix's risk: the old risk-contribution chart's title.
export function prcFinding(a: Analysis): string {
  return `${prcTitle(a)}.`;
}

export const WHATIF_FINDING = "Move one asset's expected return and both optimised mixes are solved again, on these prices.";
