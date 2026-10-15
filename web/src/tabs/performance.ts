// The Performance chapter's words that are not a card's own: the one-line finding beside each More row
// (at most twenty words, a figure the card under it then shows in full), the lead card's title and
// sub-line, and the More lists' keys, which are also the rows' anchors (`perf-<key>`, `perf-risk-<key>`).
//
// Each finding is computed from the same model functions the card draws from, so a row never promises a
// figure its card does not carry. A finding that cannot be stated (a missing figure) says what is missing.
import { format } from "../format.ts";
import type { Analysis } from "../types.ts";
import type { Series } from "./returns/years.ts";
import { monthTitle, monthView, yearRows } from "./returns/years.ts";
import { MIX } from "../overview/model.ts";
import { summaryRows } from "./returns/model.ts";
import { fallsInWindow } from "./risk/falls.ts";
import { betaChart, betaTitle, capmRows, DEFAULT_WINDOW, headline as riskHeadline, riskRows, tailRows, volChart, volTitle } from "./risk/model.ts";

/** The two More lists and their rows, in the order the chapter shows them. */
export const PERF_LIST = "perf";
export const RISK_LIST = "perf-risk";
export const PERF_ROWS = { years: "Calendar years", months: "Month by month", summary: "Summary Statistics", dist: "Return Distribution" } as const;
export const RISK_ROWS = {
  falls: "The portfolios in a fall",
  drawdowns: "Drawdowns",
  volatility: "Rolling volatility",
  tail: "Value at risk and expected shortfall",
  metrics: "Risk-adjusted metrics",
  capm: "CAPM beta and alpha",
} as const;
export const PERF_HEADING = "More on the returns";
export const RISK_HEADING = "How deep the falls went";

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

// A series in a finding: the plain name first, the scorecard's beside it, since the card under the row still
// heads its columns with the scorecard's ("Best-tradeoff (Tangency)"). The benchmark keeps its own name.
const PLAIN: Partial<Record<Series["id"], string>> = { tangency: MIX.tangency.short, ew: MIX.ew.short, gmv: MIX.gmv.short, custom: "Your mix" };
const named = (s: Series) => (PLAIN[s.id] ? `${PLAIN[s.id]} (${s.label})` : s.label);

// The best and the worst whole calendar year any of the series had. A partial year (the window's first or
// last) is left out: its label carries a comma ("2019, from 2019-01-02").
export function yearsFinding(a: Analysis, series: readonly Series[]): string {
  const rows = yearRows(a, series).filter((r) => !String(r.year).includes(","));
  type Pick = { v: number; who: string; year: string };
  let best: Pick | null = null as Pick | null;
  let worst: Pick | null = null as Pick | null;
  for (const r of rows) {
    for (const s of series) {
      const v = r[s.id];
      if (!num(v)) continue;
      if (!best || v > best.v) best = { v, who: named(s), year: String(r.year) };
      if (!worst || v < worst.v) worst = { v, who: named(s), year: String(r.year) };
    }
  }
  if (!best || !worst) return "No whole calendar year in this window.";
  return `Best whole year: ${best.who}, ${format(best.v, "pct1")} in ${best.year}. Worst: ${worst.who}, ${format(worst.v, "pct1")} in ${worst.year}.`;
}

// The first series' months (Equal-Weight, the one the grid opens on), as the grid's own title says them.
export function monthsFinding(a: Analysis, series: readonly Series[]): string {
  const s = series[0];
  if (!s) return "No portfolio to show months for.";
  const v = monthView(a, s);
  if (v.status !== "ready") return v.status === "empty" ? v.reason : "Its months could not be computed.";
  // The grid's own title, under the plain name ("The equal split's months ran from ...").
  const plain = PLAIN[s.id];
  return `${monthTitle(plain ? { ...v.value, label: `The ${plain.toLowerCase()}` } : v.value)}.`;
}

// Which asset swung most and least, a year, among the rows that have the figure (the benchmark included).
export function summaryFinding(a: Analysis): string {
  const rows = summaryRows(a).filter((r) => num(r.annVol));
  if (!rows.length) return "No volatility figure in this window.";
  let hi = rows[0];
  let lo = rows[0];
  for (const r of rows) {
    if ((r.annVol as number) > (hi.annVol as number)) hi = r;
    if ((r.annVol as number) < (lo.annVol as number)) lo = r;
  }
  return `${hi.asset} swung most, ${format(hi.annVol as number, "pct1")} a year; ${lo.asset} least, ${format(lo.annVol as number, "pct1")}.`;
}

// How many of the assets had more extreme days than a normal curve allows (excess kurtosis above zero).
// The distribution card offers the assets only, not the benchmark, so the count is over the assets.
export function distFinding(a: Analysis): string {
  const rows = summaryRows(a).slice(0, a.tickers.length).filter((r) => num(r.exKurt));
  if (!rows.length) return "No distribution could be measured.";
  const fat = rows.filter((r) => (r.exKurt as number) > 0).length;
  const n = rows.length;
  if (fat === n) return `All ${n} assets had more extreme days than a normal curve allows.`;
  if (fat === 0) return `None of the ${n} assets had more extreme days than a normal curve allows.`;
  return `${fat} of ${n} assets had more extreme days than a normal curve allows.`;
}

export function fallsFinding(a: Analysis): string {
  const n = fallsInWindow(a).length;
  if (n === 0) return "Each portfolio's deepest falls; no named market fall lies wholly inside this window.";
  return `Each portfolio's deepest falls, and its return over the ${n} named market ${n === 1 ? "fall" : "falls"} in this window.`;
}

// The old Risk tab's headline, kept whole: which asset fell furthest, from when to when, and whether it was back
// at that level by the end. At up to 25 words it is the one row finding over twenty, since the recovery is
// what a reader asks next.
export function drawdownsFinding(a: Analysis): string {
  return riskHeadline(a);
}

export function volatilityFinding(a: Analysis): string {
  const v = volChart(a, DEFAULT_WINDOW);
  return v.status === "ready" ? `${volTitle(v.value)}.` : v.status === "empty" ? v.reason : "The volatility could not be computed.";
}

// The asset with the largest one-day value at risk, and the average of its days past it (expected shortfall).
export function tailFinding(a: Analysis): string {
  const assets = tailRows(a).slice(0, a.tickers.length).filter((r) => num(r.var) && num(r.es));
  if (!assets.length) return "No value at risk could be measured.";
  const top = assets.reduce((x, y) => ((y.var as number) > (x.var as number) ? y : x));
  return `On a bad day, 1 in 20, ${top.asset} lost ${format(top.var as number, "pct1")} or more; those days averaged ${format(top.es as number, "pct1")}.`;
}

// The asset with the highest Sharpe ratio, and the benchmark's beside it.
export function metricsFinding(a: Analysis): string {
  const rows = riskRows(a);
  const bench = rows[rows.length - 1];
  const assets = rows.slice(0, -1).filter((r) => num(r.sharpe));
  if (!assets.length) return "No Sharpe ratio could be measured.";
  const top = assets.reduce((x, y) => ((y.sharpe as number) > (x.sharpe as number) ? y : x));
  const b = num(bench.sharpe) ? `; the ${a.benchLabel}'s was ${format(bench.sharpe, "num3")}` : "";
  return `${top.asset} had the highest Sharpe ratio, ${format(top.sharpe as number, "num3")}${b}.`;
}

export function capmFinding(a: Analysis): string {
  const b = betaChart(capmRows(a));
  return b.status === "ready" ? `${betaTitle(b.value, a.benchLabel)}.` : b.status === "empty" ? b.reason : "The betas could not be computed.";
}

/**
 * A row's finding, computed as the row is drawn. A throw costs the line only, never the list: the row says
 * so, the console names it, and the card under it still opens inside its own Boundary.
 */
export function said(name: string, finding: () => string): string {
  try {
    return finding();
  } catch (e) {
    console.error(`the "${name}" finding could not be stated:`, e);
    return "This finding could not be stated.";
  }
}
