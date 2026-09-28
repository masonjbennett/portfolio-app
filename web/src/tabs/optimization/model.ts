// The Portfolio Optimization tab's arithmetic (portfolio_app.py 1467-1703), pure: everything the tab
// prints is computed here from an Analysis, so the suite reaches every figure without a DOM. The
// components only lay out what these functions return; the two shared charts (src/charts/Frontier.tsx,
// src/charts/Wealth.tsx) take their data from frontierData and wealthData.
//
// Where the port departs from the app, on purpose:
// - The GMV and tangency weights are exact solves (src/lib/optimize.ts), not SLSQP at its default
//   ftol (932, 943), so a weight no longer carries solver noise in its third significant figure.
// - A failed solve is SAID, in the tiles, the weights and the summary. The app stops the whole script
//   at a failed tab-4 solve (1481-1483, 1492-1494), which also blanks tabs 5 and 6, and its snapshot
//   band shows equal-weight figures under the Tangency labels (1200-1202).
// - Every table holds numbers, so both downloads carry numbers: the app's summary is f-strings
//   (1686-1694), so its CSV and Excel hold text.
// - The risk contribution has a table beside its chart, weights and PRC side by side, with both
//   downloads: the app builds that frame (1563-1566), charts only the PRC columns and offers no download,
//   although its caption (1557-1560) asks the reader to compare weight with PRC.
// - Max DD is measured from the amount invested (the port's drawdowns include the start); the app's
//   path starts at 1 + r1 (904-908), so a loss on the first day is not a drawdown there.
// - Custom weights that cannot be normalised honestly (all zero, a net exposure near zero with
//   shorting, a weight pushed outside the bounds) are refused and named; the app divides by any
//   non-zero total (1582-1586).
import { format, MINUS } from "../../format.ts";
import type { Vec } from "../../lib/num.ts";
import { normalizeCustom, portfolioReturns, riskContribution, summaryRow, type Custom, type Row } from "../../lib/portfolio.ts";
import { maxDrawdown, wealth } from "../../lib/stats.ts";
import type { Analysis, Column, CustomWeights, FormatId, LoadState, TableRow, TipKey } from "../../types.ts";

// ---- the three portfolios (1470-1502) --------------------------------------------------------------

/** The portfolios the tab solves, in the app's tile order (1505, 1517, 1524). */
export type PortId = "ew" | "gmv" | "tangency";
export const PORT_IDS: readonly PortId[] = ["ew", "gmv", "tangency"];

/** Short names, as the app's charts and tables use them (1535, 1683). */
export const PORT_LABEL: Readonly<Record<PortId, string>> = { ew: "Equal-Weight", gmv: "GMV", tangency: "Tangency" };

/** The tile headings (1505, 1517, 1524). */
export const TILE_TITLE: Readonly<Record<PortId, string>> = {
  ew: "Equal-Weight Portfolio (1/N)",
  gmv: "Global Min Variance",
  tangency: "Max Sharpe (Tangency)",
};

/** What the page says where a solve failed. The Frontier's caption says the same of its tangency point. */
export const FAILED: Readonly<Record<"gmv" | "tangency", string>> = {
  gmv: "GMV failed: the minimum-variance solve returned no portfolio, so there are no GMV figures.",
  tangency: "Tangency failed: the maximum-Sharpe solve returned no portfolio, so there are no Tangency figures.",
};

/** A failed portfolio's label in a table: the row or column says it failed, never a stand-in figure. */
export const failedLabel = (id: PortId) => `${PORT_LABEL[id]} (failed)`;

/** The weights of one portfolio, or null when its solve failed. */
export function weightsOf(a: Analysis, id: PortId): Vec | null {
  if (id === "ew") return a.ew;
  if (id === "gmv") return a.gmv ? a.gmv.w : null;
  return a.tangency ? a.tangency.w : null;
}

/** One portfolio's five figures (1474-1499): portfolio_performance, then Sortino and Max DD of R @ w. */
export function portRow(a: Analysis, w: Vec, includeStart = true): Row {
  return summaryRow(a.returns, w, a.m, a.S, a.rf, includeStart);
}

// ---- the tiles (1504-1530) --------------------------------------------------------------------------

/** One tile's figure: the app's st.metric label, format and tooltip (1507-1511). */
export interface Metric {
  key: "mu" | "sigma" | "sharpe" | "sortino" | "mdd";
  label: string;
  format: FormatId;
  tip: TipKey;
}

export const METRICS: readonly Metric[] = [
  { key: "mu", label: "Return", format: "pct2", tip: "return" },
  { key: "sigma", label: "Volatility", format: "pct2", tip: "volatility" },
  { key: "sharpe", label: "Sharpe", format: "num3", tip: "sharpe" },
  { key: "sortino", label: "Sortino", format: "num3", tip: "sortino" },
  { key: "mdd", label: "Max DD", format: "pct2", tip: "max_dd" },
];

export interface Tile {
  id: PortId;
  title: string;
  /** The figures, or null when the solve failed (the plates then print a dash and "not available"). */
  row: Row | null;
  /** The failure sentence, or null. */
  failed: string | null;
}

export function tiles(a: Analysis): Tile[] {
  return PORT_IDS.map((id) => {
    const w = weightsOf(a, id);
    return {
      id,
      title: TILE_TITLE[id],
      row: w ? portRow(a, w) : null,
      failed: w ? null : FAILED[id as "gmv" | "tangency"],
    };
  });
}

// ---- the custom portfolio (1579-1588) ---------------------------------------------------------------

/** The raw custom weights in ticker order, 1/n where none was set (1581), normalised by the shared rule. */
export function customWeights(a: Analysis, weights: CustomWeights): Custom {
  const n = a.tickers.length;
  const raw = a.tickers.map((t) => {
    const v = weights[t];
    return typeof v === "number" && Number.isFinite(v) ? v : 1 / n;
  });
  return normalizeCustom(raw, a.allowShort);
}

/** Why the custom weights are not plotted or scored, in words. */
export const CUSTOM_REFUSAL: Readonly<Record<"zero" | "net-short" | "leverage", string>> = {
  zero: "Custom is not shown: every custom weight is zero. Set at least one on the Custom Portfolio tab.",
  "net-short":
    "Custom is not shown: its weights add up to less than 5% net long, and dividing by a total that small would multiply every weight many times over. Adjust them on the Custom Portfolio tab.",
  leverage:
    "Custom is not shown: normalised to sum to 100%, its weights would put an asset outside the -100% to 100% range the optimiser uses. Adjust them on the Custom Portfolio tab.",
};

/** True when the custom weights are still equal weights, the app's default before tab 5 is touched (1581). */
export function customIsEqual(a: Analysis, c: Custom): boolean {
  return c.ok && c.w.every((x, i) => Math.abs(x - a.ew[i]) < 1e-12);
}

/** The sentence under the summary about the Custom row, or null when there is nothing to say. */
export function customNote(a: Analysis, c: Custom): string | null {
  if (!c.ok) return CUSTOM_REFUSAL[c.reason];
  const parts: string[] = [];
  if (customIsEqual(a, c)) {
    parts.push("Custom holds the weights set on the Custom Portfolio tab. They are still equal weights, so its row repeats Equal-Weight's and its point sits on Equal-Weight's.");
  } else {
    parts.push("Custom holds the weights set on the Custom Portfolio tab, scaled to sum to 100%.");
  }
  if (c.clamped) parts.push("Some were outside the current bounds and were clamped to them first.");
  return parts.join(" ");
}

// ---- tables ------------------------------------------------------------------------------------------

export interface TableData {
  columns: Column[];
  rows: TableRow[];
}

const finiteRow = (r: TableRow) => Object.values(r).every((v) => typeof v !== "number" || Number.isFinite(v));

// A table's state: every number finite, or the table is refused by name. A dash in a table means
// "no figure" (a failed solve), and a NaN from arithmetic must never pass for one.
function tableState(t: TableData, name: string): LoadState<TableData> {
  const bad = t.rows.find((r) => !finiteRow(r));
  if (bad) return { status: "error", name, message: `A figure in the ${String(bad[t.columns[0].key])} row is not a finite number.` };
  return { status: "ready", value: t };
}

/**
 * The weights table (1535): a row per ticker in the entered order, columns GMV, Tangency, Equal-Weight
 * in the app's order. A failed portfolio keeps its column, labelled failed, with no figures.
 */
export function weightTable(a: Analysis): LoadState<TableData> {
  const order: PortId[] = ["gmv", "tangency", "ew"];
  const ws = order.map((id) => weightsOf(a, id));
  const columns: Column[] = [
    { key: "asset", label: "Asset", format: "text", first: true },
    ...order.map((id, k): Column => ({ key: id, label: ws[k] ? PORT_LABEL[id] : failedLabel(id), format: "pct2" })),
  ];
  const rows = a.tickers.map((t, i) => {
    const row: TableRow = { asset: t };
    order.forEach((id, k) => (row[id] = ws[k] ? (ws[k] as Vec)[i] : null));
    return row;
  });
  return tableState({ columns, rows }, "the weights table");
}

/**
 * The risk contribution table: the frame the app builds (1563-1566), GMV Weight, GMV PRC, Tangency
 * Weight, Tangency PRC, which it never shows. risk_contribution (974-979): w_i (S w)_i / w'S w.
 */
export function prcTable(a: Analysis): LoadState<TableData> {
  const g = a.gmv ? riskContribution(a.gmv.w, a.S) : null;
  const t = a.tangency ? riskContribution(a.tangency.w, a.S) : null;
  const gl = a.gmv ? "GMV" : failedLabel("gmv");
  const tl = a.tangency ? "Tangency" : failedLabel("tangency");
  const columns: Column[] = [
    { key: "asset", label: "Asset", format: "text", first: true },
    { key: "gmvW", label: `${gl} Weight`, format: "pct2" },
    { key: "gmvPrc", label: `${gl} PRC`, format: "pct2" },
    { key: "tanW", label: `${tl} Weight`, format: "pct2" },
    { key: "tanPrc", label: `${tl} PRC`, format: "pct2" },
  ];
  const rows = a.tickers.map((ticker, i): TableRow => ({
    asset: ticker,
    gmvW: a.gmv ? a.gmv.w[i] : null,
    gmvPrc: g ? g[i] : null,
    tanW: a.tangency ? a.tangency.w[i] : null,
    tanPrc: t ? t[i] : null,
  }));
  return tableState({ columns, rows }, "the risk contribution table");
}

export const SUMMARY_COLUMNS: Column[] = [
  { key: "portfolio", label: "Portfolio", format: "text", first: true },
  { key: "mu", label: "Ann. Return", format: "pct2" },
  { key: "sigma", label: "Ann. Volatility", format: "pct2" },
  { key: "sharpe", label: "Sharpe", format: "num3" },
  { key: "sortino", label: "Sortino", format: "num3" },
  { key: "mdd", label: "Max DD", format: "pct2" },
];

const EMPTY = { mu: null, sigma: null, sharpe: null, sortino: null, mdd: null };

/**
 * The summary comparison (1678-1695): Equal-Weight, GMV, Tangency, Custom, then the benchmark under its
 * display name, as numbers. A failed solve or a refused Custom keeps its row, labelled, with no figures.
 */
export function summaryTable(a: Analysis, c: Custom): LoadState<TableData> {
  const rows: TableRow[] = PORT_IDS.map((id) => {
    const w = weightsOf(a, id);
    if (!w) return { portfolio: failedLabel(id), ...EMPTY };
    const r = portRow(a, w);
    return { portfolio: PORT_LABEL[id], mu: r.mu, sigma: r.sigma, sharpe: r.sharpe, sortino: r.sortino, mdd: r.mdd };
  });
  if (c.ok) {
    const r = portRow(a, c.w);
    rows.push({ portfolio: "Custom", mu: r.mu, sigma: r.sigma, sharpe: r.sharpe, sortino: r.sortino, mdd: r.mdd });
  } else {
    rows.push({ portfolio: "Custom (not shown)", ...EMPTY });
  }
  const b = a.benchStats;
  rows.push({ portfolio: a.benchLabel, mu: b.mu, sigma: b.sigma, sharpe: b.sharpe, sortino: b.sortino, mdd: maxDrawdown(a.bench) });
  return tableState({ columns: SUMMARY_COLUMNS, rows }, "the summary comparison");
}

// ---- the two bar charts (1534-1572) ----------------------------------------------------------------

/** One group of bars: a ticker, and one value per series (null draws no bar). */
export interface Group {
  name: string;
  values: (number | null)[];
}

/** One series of bars: its name, written on the chart, and its role colour (src/charts/theme.ts ROLE). */
export interface BarSeries {
  label: string;
  role: "gmv" | "tangency" | "ew";
}

export interface Bars {
  groups: Group[];
  series: BarSeries[];
}

function barsState(bars: Bars, name: string, none: string): LoadState<Bars> {
  if (!bars.series.length) return { status: "empty", reason: none };
  for (const g of bars.groups) {
    if (g.values.some((v) => v === null || !Number.isFinite(v))) {
      return { status: "error", name, message: `${g.name}'s value is not a finite number.` };
    }
  }
  return { status: "ready", value: bars };
}

/** The weights chart (1534-1541): a group per ticker, bars GMV, Tangency, Equal-Weight; a failed solve has no bars. */
export function weightBars(a: Analysis): LoadState<Bars> {
  const order: PortId[] = ["gmv", "tangency", "ew"];
  const live = order.filter((id) => weightsOf(a, id));
  const series = live.map((id): BarSeries => ({ label: PORT_LABEL[id], role: id }));
  const groups = a.tickers.map((t, i) => ({ name: t, values: live.map((id) => (weightsOf(a, id) as Vec)[i]) }));
  return barsState({ groups, series }, "the weights chart", "No portfolio to draw.");
}

/** The risk contribution chart (1561-1572): GMV PRC and Tangency PRC per ticker. */
export function prcBars(a: Analysis): LoadState<Bars> {
  const live = (["gmv", "tangency"] as const).filter((id) => weightsOf(a, id));
  const prc = live.map((id) => riskContribution(weightsOf(a, id) as Vec, a.S));
  const series = live.map((id): BarSeries => ({ label: `${PORT_LABEL[id]} PRC`, role: id }));
  const groups = a.tickers.map((t, i) => ({ name: t, values: prc.map((p) => p[i]) }));
  return barsState({ groups, series }, "the risk contribution chart", "Neither optimisation solved, so there is no risk contribution to show.");
}

/**
 * Where the series names go and how tall the axis runs: the names are written up one bar each, in the
 * group with the most room above its bars (`host`), and the axis top is raised until `labelPx` of text
 * fits above that group's tallest bar in a plot `plotPx` tall.
 */
export function barLayout(groups: Group[], labelPx: number, plotPx: number): { host: number; lo: number; hi: number } {
  const fin = (vs: (number | null)[]) => vs.filter((v): v is number => v !== null && Number.isFinite(v));
  const all = groups.flatMap((g) => fin(g.values));
  const lo = Math.min(0, ...all);
  const top = Math.max(0, ...all);
  let host = 0;
  let hostTop = Infinity;
  groups.forEach((g, i) => {
    const t = Math.max(0, ...fin(g.values));
    if (t < hostTop) {
      hostTop = t;
      host = i;
    }
  });
  if (!Number.isFinite(hostTop)) hostTop = 0;
  // The label needs (hi - hostTop) / (hi - lo) >= f of the plot:  hi >= (hostTop - f lo) / (1 - f).
  const f = Math.min(0.6, labelPx / plotPx);
  let hi = Math.max(top, (hostTop - f * lo) / (1 - f));
  if (!(hi > lo)) hi = lo + 1;
  return { host, lo, hi };
}

// ---- the sentences ------------------------------------------------------------------------------------

const pct1 = (x: number) => format(x, "pct1");
const pct2 = (x: number) => format(x, "pct2");
// Every Sharpe ratio on the page prints to three places, the app's own `:.3f` (test/t-sharpe.mjs).
const num3 = (x: number) => format(x, "num3");
// A weight under 0.05% prints as 0.0%: the sentences do not count it as a holding.
const HELD = 5e-4;

function listing(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/**
 * "holds 54.2% GLD and 45.8% VTI" when those are all it holds; otherwise "puts its largest weights on
 * VTI (100.0%) and GLD (98.4%)", with a count of the short positions.
 */
export function mixPhrase(w: Vec, tickers: readonly string[]): string {
  const idx = w.map((_, i) => i);
  const longs = idx.filter((i) => w[i] > HELD).sort((x, y) => w[y] - w[x]);
  const shorts = idx.filter((i) => w[i] < -HELD);
  const top = longs.slice(0, 2);
  let s =
    longs.length <= 2 && !shorts.length
      ? `holds ${listing(top.map((i) => `${pct1(w[i])} ${tickers[i]}`))}`
      : `puts its largest ${top.length === 1 ? "weight" : "weights"} on ${listing(top.map((i) => `${tickers[i]} (${pct1(w[i])})`))}`;
  if (shorts.length) s += `, with ${shorts.length} short ${shorts.length === 1 ? "position" : "positions"}`;
  return s;
}

/** The tab's headline: what the maximum-Sharpe solve found, against equal weights. */
export function headline(a: Analysis): string {
  const ew = portRow(a, a.ew);
  const t = a.tangency;
  if (!t) {
    return a.gmv
      ? `The maximum-Sharpe solve failed, so there is no tangency portfolio; the minimum-variance portfolio's volatility is ${pct2(a.gmv.sigma)}.`
      : `Both optimisations failed, so only equal weights are shown, at a Sharpe ratio of ${num3(ew.sharpe)}.`;
  }
  if (!t.beatsRf) {
    // Only the mixes inside the current bounds were searched, so the sentence names them (as the Band does).
    const which = a.allowShort ? `mix of these assets with weights inside [${MINUS}1, 1]` : "long-only mix of these assets";
    return `No ${which} earned more than the ${pct2(a.rf)} risk-free rate: the best Sharpe ratio is ${num3(t.sharpe)}.`;
  }
  return `The maximum-Sharpe portfolio ${mixPhrase(t.w, a.tickers)}, for a Sharpe ratio of ${num3(t.sharpe)} against ${num3(ew.sharpe)} for equal weights.`;
}

/** The frontier's title: where the two optimised portfolios sit on it. */
export function frontierTitle(a: Analysis): string {
  const parts: string[] = [];
  if (a.tangency) parts.push(`Tangency has the highest Sharpe ratio on the frontier, at ${pct2(a.tangency.sigma)} volatility`);
  if (a.gmv) parts.push(`${a.tangency ? "GMV" : "GMV has"} the lowest volatility, ${pct2(a.gmv.sigma)}`);
  return parts.length ? parts.join("; ") : "Efficient Frontier";
}

function largest(w: Vec, tickers: readonly string[]): { ticker: string; w: number } {
  let k = 0;
  w.forEach((x, i) => {
    if (x > w[k]) k = i;
  });
  return { ticker: tickers[k], w: w[k] };
}

/** The weights chart's title: each optimised portfolio's largest weight. */
export function weightsTitle(a: Analysis): string {
  const parts: string[] = [];
  if (a.gmv) {
    const g = largest(a.gmv.w, a.tickers);
    parts.push(`GMV's largest weight is ${g.ticker}, ${pct1(g.w)}`);
  }
  if (a.tangency) {
    const t = largest(a.tangency.w, a.tickers);
    parts.push(a.gmv ? `Tangency's is ${t.ticker}, ${pct1(t.w)}` : `Tangency's largest weight is ${t.ticker}, ${pct1(t.w)}`);
  }
  return parts.length ? parts.join("; ") : `Equal weights: ${pct1(a.ew[0])} in each asset`;
}

/** The risk contribution chart's title: the asset carrying most of each portfolio's variance. */
export function prcTitle(a: Analysis): string {
  const parts: string[] = [];
  if (a.gmv) {
    const g = largest(riskContribution(a.gmv.w, a.S), a.tickers);
    parts.push(`${g.ticker} carries ${pct1(g.w)} of GMV's risk`);
  }
  if (a.tangency) {
    const t = largest(riskContribution(a.tangency.w, a.S), a.tickers);
    parts.push(`${t.ticker} carries ${pct1(t.w)} of Tangency's`);
  }
  return parts.length ? parts.join("; ") : "Risk Contribution (PRC)";
}

/** Where each line of the wealth chart ends, in wealthData's order: Equal-Weight, GMV, Tangency, Custom, the benchmark. */
export function wealthEnds(a: Analysis, custom: Vec | null, amount: number): { label: string; end: number; bench: boolean }[] {
  const out: { label: string; end: number; bench: boolean }[] = [];
  const add = (label: string, r: Vec, bench = false) => out.push({ label, end: wealth(r, amount).at(-1) as number, bench });
  add("Equal-Weight", portfolioReturns(a.returns, a.ew));
  if (a.gmv) add("GMV", portfolioReturns(a.returns, a.gmv.w));
  if (a.tangency) add("Tangency", portfolioReturns(a.returns, a.tangency.w));
  if (custom) add("Custom", portfolioReturns(a.returns, custom));
  add(a.benchLabel, a.bench, true);
  return out;
}

/** The wealth chart's title: which line ended highest, and where the benchmark ended. */
export function wealthTitle(a: Analysis, custom: Vec | null, amount: number): string {
  const fallback = "Portfolio Comparison: Cumulative Wealth";
  if (!(Number.isFinite(amount) && amount > 0)) return fallback;
  const ends = wealthEnds(a, custom, amount);
  if (!ends.every((e) => Number.isFinite(e.end))) return fallback;
  let best = ends[0];
  for (const e of ends) if (e.end > best.end) best = e;
  const bench = ends[ends.length - 1];
  const lead = `${best.bench ? `The ${best.label}` : best.label} ended highest, at ${format(best.end, "usd0")} from ${format(amount, "usd0")}`;
  return best.bench ? lead : `${lead}; the ${bench.label} ended at ${format(bench.end, "usd0")}`;
}
