// The Diversification chapter's words that are not a card's own: the one-line finding beside each More row
// (at most twenty words, a figure the card under it then shows in full) and the More list's key, which is
// also the rows' anchor prefix (`div-<key>`).
//
// Each finding is computed from the same model functions the card draws from, so a row never promises a
// figure its card does not carry. A finding that cannot be stated (a missing figure) says what is missing.
import { format } from "../format.ts";
import type { Analysis } from "../types.ts";
import { corrView, DEFAULT_WINDOW, defaultPair, rollTitle, rollView, spread } from "./correlation/model.ts";

/** The More list and its rows, in the order the chapter shows them. */
export const DIV_LIST = "div";
export const DIV_ROWS = {
  rolling: "Rolling pairwise correlation",
  spread: "Equal weights against each on its own",
  covariance: "Daily covariance matrix",
} as const;
export const DIV_HEADING = "More on how they move together";

// The rolling card opens on the app's default pair and window, so its finding is that chart's own title.
export function rollingFinding(a: Analysis): string {
  const [x, y] = defaultPair(a.tickers);
  const v = rollView(a, x, y, DEFAULT_WINDOW);
  return v.status === "ready" ? `${rollTitle(v.value)}.` : v.status === "empty" ? v.reason : "The rolling correlation could not be computed.";
}

// The two volatilities the card's sentence sets side by side, without the correlation it adds.
export function spreadFinding(a: Analysis): string {
  const s = spread(a, corrView(a));
  if (!s) return "Not enough data to set equal weights against the assets on their own.";
  return `Together in equal weights, ${format(s.together, "pct1")} volatility a year; on their own, ${format(s.apart, "pct1")} on average.`;
}

// The asset that swung most on its own: the largest figure on the matrix's diagonal.
export function covarianceFinding(a: Analysis): string {
  const { tickers, S } = a;
  let top = -1;
  for (let i = 0; i < tickers.length; i++) {
    const v = S?.[i]?.[i];
    if (typeof v === "number" && Number.isFinite(v) && (top < 0 || v > S[top][top])) top = i;
  }
  if (top < 0) return "No daily variance could be measured.";
  return `The optimiser's input. ${tickers[top]} swung most on its own: a daily variance of ${format(S[top][top], "num6")}.`;
}
