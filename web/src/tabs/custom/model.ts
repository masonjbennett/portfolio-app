// The Custom Portfolio tab's arithmetic and sentences (portfolio_app.py 1708-1837), pure so the suite
// reaches every figure without a DOM. ../Custom.tsx lays it out.
//
// What the tab does, in the app's order: a weight per ticker (1715-1720), divided by the weights'
// total (1722-1732), shown normalised (1734-1737), scored (1739-1749), placed on a 60-point frontier
// (1753-1819) and grown from the starting amount beside the other portfolios (1823-1837).
//
// Where it departs from the app, on purpose:
// - The division is the engine's normalizeCustom. The app divides by any nonzero total (1732): with
//   shorting on, a negative total turns every long into a short and every short into a long, and a
//   total near zero multiplies every weight by 1/total, far outside the [-1, 1] box its optimiser
//   honours, so the custom point can plot above the "efficient" frontier. Here a stored value is first
//   clamped to the current bounds (a -0.40 kept from when shorting was on counts as 0 once it is off),
//   and a book that would flip or blow up is refused, with the reason stated in numbers.
// - All-zero weights stop the app's whole script (st.stop() at 1727), so the Sensitivity tab after it
//   is never built. Here they are one refusal, and the charts still draw the other portfolios.
// - Max DD is measured from the amount invested (the engine's default), so a fall on day one counts;
//   the app's path starts a day in (904-908).
// - The normalised weights table carries CSV and Excel downloads of the raw numbers; the app's has
//   none and holds "{:.2%}" strings (1736).
import { format, MINUS } from "../../format.ts";
import type { Vec } from "../../lib/num.ts";
import { frontier, frontierAt, type FrontierPoint } from "../../lib/optimize.ts";
import { normalizeCustom, summaryRow, type Custom, type Row } from "../../lib/portfolio.ts";
import { wealth } from "../../lib/stats.ts";
import type { Analysis, Column, CustomWeights, FormatId, LoadState, TableRow, TipKey } from "../../types.ts";
import type { WealthData } from "../../charts/Wealth.tsx";

/** efficient_frontier(..., n_points=60) on this tab (1756); the Optimization tab's call uses 80. */
export const CUSTOM_FRONTIER_POINTS = 60;

/** The slider's step (1720). The typed field takes any decimal inside the bounds. */
export const WEIGHT_STEP = 0.01;

/** The slider's bounds (1719-1720): [0, 1], or [-1, 1] with shorting on. */
export function bounds(allowShort: boolean): { lo: number; hi: number } {
  return { lo: allowShort ? -1 : 0, hi: 1 };
}

/** A typed or dragged value held to the current bounds before it is stored (and put in the share link). */
export function clampWeight(x: number, allowShort: boolean): number {
  const { lo, hi } = bounds(allowShort);
  return Math.min(hi, Math.max(lo, x));
}

/** What a weight field shows: at most four decimals, a plain "-" (an input's value is ASCII). */
export function shownWeight(x: number): string {
  return String(Number(x.toFixed(4)));
}

/** A field's text as a weight, or null while it is not a number yet ("", "-", "."). */
export function parseWeight(s: string): number | null {
  if (!/^\s*-?(\d+\.?\d*|\.\d+)(e-?\d+)?\s*$/i.test(s)) return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

/**
 * The weights as entered, in ticker order. A ticker with no entry is exactly 1/n, the slider's
 * default before it is moved (1720, and 1581 for the Optimization tab's copy).
 */
export function rawWeights(tickers: readonly string[], weights: CustomWeights): number[] {
  const n = tickers.length;
  return tickers.map((t) => {
    const v = Object.hasOwn(weights, t) ? weights[t] : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : 1 / n;
  });
}

/** True when any of these tickers has a weight of its own (so "reset to equal weights" does something). */
export function hasEntries(tickers: readonly string[], weights: CustomWeights): boolean {
  return tickers.some((t) => Object.hasOwn(weights, t));
}

/** The weights with these tickers' entries removed: every one back to 1/n. Other tickers' entries stay. */
export function resetWeights(tickers: readonly string[], weights: CustomWeights): CustomWeights {
  const next: CustomWeights = { ...weights };
  for (const t of tickers) delete next[t];
  return next;
}

/** One entered value outside the current bounds, and what it counts as. */
export interface Clamp {
  ticker: string;
  entered: number;
  counts: number;
}

/** Why no custom portfolio is built: a headline clause and the full literal reason. */
export interface Refusal {
  reason: "zero" | "net-short" | "leverage";
  /** Completes "No custom portfolio: ...". */
  short: string;
  /** What is wrong, in numbers, and what to change. */
  detail: string;
}

/** Everything the tab builds from the entered weights. */
export interface CustomView {
  tickers: string[];
  /** As entered, 1/n where none. */
  raw: number[];
  /** The engine's normalisation of `raw` at the analysis's bounds. */
  custom: Custom;
  /** Present exactly when `custom` is refused. */
  refusal: Refusal | null;
  /** Entered values the bounds clamped. */
  clamps: Clamp[];
}

const pct = (x: number) => format(x, "pct2");
const n2 = (x: number) => format(x, "num2");
const n3 = (x: number) => format(x, "num3");
// A weight as its field shows it, with the page's minus sign.
const n4 = (x: number) => shownWeight(x).replace("-", MINUS);

// The refusal in words. The numbers are the engine's: the total is of the CLAMPED values, the ones
// normalizeCustom divides by.
function refusal(c: Extract<Custom, { ok: false }>, tickers: readonly string[], raw: readonly number[], allowShort: boolean): Refusal {
  const total = n2(c.total);
  const more = "Make the weights add up to more than 0.05.";
  if (c.reason === "zero") {
    return {
      reason: "zero",
      short: "every weight is zero",
      detail: "Every weight is zero, so there is no portfolio to build. Set at least one weight above zero.",
    };
  }
  if (c.reason === "net-short") {
    if (c.total < 0) {
      return {
        reason: "net-short",
        short: `the weights add up to ${total}, a net short`,
        detail:
          `The weights add up to ${total}. Dividing by a negative total would turn every long into a short and every short ` +
          `into a long, so no custom portfolio is built. ${more}`,
      };
    }
    if (c.total === 0) {
      return {
        reason: "net-short",
        short: "the weights add up to zero",
        detail: `The weights add up to zero, and no weights that add up to zero can be scaled to add up to 1, so no custom portfolio is built. ${more}`,
      };
    }
    return {
      reason: "net-short",
      short: `the weights add up to only ${total}`,
      detail:
        `The weights add up to ${total}. Dividing by a total of 0.05 or less would multiply every weight by 20 or more, so no ` +
        `custom portfolio is built. ${more}`,
    };
  }
  // leverage: name the first weight the division pushes out of the box.
  const { lo, hi } = bounds(allowShort);
  const w = raw.map((x) => clampWeight(x, allowShort) / c.total);
  const i = Math.max(0, w.findIndex((x) => x < lo - 1e-12 || x > hi + 1e-12));
  return {
    reason: "leverage",
    short: `divided by their total, the weights would put ${pct(w[i])} in ${tickers[i]}`,
    detail:
      `Divided by their total, ${total}, the weights would put ${pct(w[i])} in ${tickers[i]}, outside the ${MINUS}100% to 100% ` +
      `each weight is held to, so no custom portfolio is built. Lower the short weights or raise the long ones.`,
  };
}

/** The tab's weights, normalised and checked, for one analysis. */
export function customView(a: Analysis, weights: CustomWeights): CustomView {
  const raw = rawWeights(a.tickers, weights);
  const custom = normalizeCustom(raw, a.allowShort);
  const clamps: Clamp[] = [];
  // Listed only where the clamp shows at the field's four decimals: a solver's 1.0000000000000002 is
  // clamped by the engine too, but "1 counts as 1" would tell the reader nothing.
  raw.forEach((x, i) => {
    const counts = clampWeight(x, a.allowShort);
    if (shownWeight(counts) !== shownWeight(x)) clamps.push({ ticker: a.tickers[i], entered: x, counts });
  });
  return {
    tickers: a.tickers,
    raw,
    custom,
    refusal: custom.ok ? null : refusal(custom, a.tickers, raw, a.allowShort),
    clamps,
  };
}

/** The normalised weights, or null when they were refused. */
export function customWeights(v: CustomView): Vec | null {
  return v.custom.ok ? v.custom.w : null;
}

/** "Weight total: 1.00." and what is done with it (1729). */
export function totalLine(v: CustomView): string {
  const t = `Weight total: ${n2(v.custom.total)}${v.clamps.length ? ", counting the clamped values" : ""}.`;
  return v.custom.ok ? `${t} Each weight is divided by it, so the normalized weights add up to 1.00.` : t;
}

/** The clamp note: which entered values count as the nearest bound. Empty when none. */
export function clampLine(v: CustomView, allowShort: boolean): string {
  if (!v.clamps.length) return "";
  const { lo } = bounds(allowShort);
  const list = v.clamps.map((c) => `${c.ticker} (entered ${n4(c.entered)}, counts as ${n4(c.counts)})`).join(", ");
  const why = allowShort ? "" : " Shorting is off.";
  return `Outside the ${n4(lo)} to 1 range, so held to the nearest end of it: ${list}.${why}`;
}

/** The five figures the app shows as tiles (1739-1749): portfolio_performance, then Sortino and Max DD of R @ w. */
export function customMetrics(a: Analysis, w: Vec): Row {
  return summaryRow(a.returns, w, a.m, a.S, a.rf);
}

/** The tiles, in the app's order, labels, formats and tips (1745-1749). */
export const PLATES: readonly { key: "mu" | "sigma" | "sharpe" | "sortino" | "mdd"; label: string; format: FormatId; tip: TipKey }[] = [
  { key: "mu", label: "Return", format: "pct2", tip: "return" },
  { key: "sigma", label: "Volatility", format: "pct2", tip: "volatility" },
  { key: "sharpe", label: "Sharpe", format: "num3", tip: "sharpe" },
  { key: "sortino", label: "Sortino", format: "num3", tip: "sortino" },
  { key: "mdd", label: "Max DD", format: "pct2", tip: "max_dd" },
];

/** The line under the tiles: what the figures are, over which span, at which rate. */
export function platesNote(a: Analysis): string {
  return (
    `Annual figures from ${format(a.dates[0], "date")} to ${format(a.asOf, "date")} at the ${pct(a.rf)} risk-free rate this ` +
    `analysis used, for these weights held fixed and rebalanced daily. Max DD is measured from the amount invested, so a fall ` +
    `on the first day counts.`
  );
}

/** Every weight within 1e-12 of 1/n. */
export function isEqualWeight(w: Vec): boolean {
  const n = w.length;
  return n > 0 && w.every((x) => Math.abs(x - 1 / n) <= 1e-12);
}

/** The tab's headline: the custom mix's figures against the tangency portfolio, or why there is no mix. */
export function headline(a: Analysis, v: CustomView): string {
  if (!v.custom.ok) return `No custom portfolio: ${v.refusal?.short ?? "the weights were refused"}.`;
  const p = customMetrics(a, v.custom.w);
  const lead = isEqualWeight(v.custom.w) ? "At equal weights, the custom mix" : "The custom mix";
  const base = `${lead} returns ${pct(p.mu)} a year at ${pct(p.sigma)} volatility`;
  if (!Number.isFinite(p.sharpe)) return `${base}; its Sharpe ratio is undefined because its volatility is zero.`;
  const sh = n3(p.sharpe);
  if (!a.tangency) return `${base}, a Sharpe ratio of ${sh}; the tangency solve failed, so there is no best Sharpe ratio to set it against.`;
  const t = n3(a.tangency.sharpe);
  const cmp = sh === t ? "level with" : p.sharpe < a.tangency.sharpe ? "below" : "above";
  return `${base}, a Sharpe ratio of ${sh}, ${cmp} the tangency portfolio's ${t}.`;
}

/** This tab's frontier: the app's 60 targets (1756), from the GMV return to the highest the bounds allow. */
export function customFrontier(a: Analysis): FrontierPoint[] {
  return frontier(a.m, a.S, a.allowShort, CUSTOM_FRONTIER_POINTS);
}

// Two volatilities this close print the same at two decimals of a percent.
const ON_FRONTIER = 5e-5;

/**
 * The frontier chart's title: how far the custom mix sits from the frontier at its own return, by an
 * exact solve at that return (frontierAt), or that the GMV portfolio beats it on both counts when its
 * return is below the GMV's. Literal: every figure in it is printed from the numbers compared.
 */
export function frontierTitle(a: Analysis, v: CustomView): string {
  if (!v.custom.ok) return "The frontier with no custom portfolio on it: the weights above were refused";
  const p = customMetrics(a, v.custom.w);
  const plain = `The custom mix returns ${pct(p.mu)} a year at ${pct(p.sigma)} volatility`;
  if (!a.gmv || !Number.isFinite(p.mu) || !Number.isFinite(p.sigma)) return plain;
  if (p.mu < a.gmv.mu) {
    if (!(a.gmv.sigma < p.sigma)) return plain;
    return (
      `The GMV portfolio returns more than the custom mix, ${pct(a.gmv.mu)} a year against ${pct(p.mu)}, ` +
      `with less volatility, ${pct(a.gmv.sigma)} against ${pct(p.sigma)}`
    );
  }
  const f = frontierAt(a.m, a.S, [p.mu], a.allowShort)[0];
  if (!f || !f.feasible || !Number.isFinite(f.sigma)) return plain;
  const which = a.allowShort ? `mix with weights inside [${MINUS}1, 1]` : "long-only mix";
  if (p.sigma - f.sigma < ON_FRONTIER) {
    return `The custom mix sits on the frontier: no ${which} returns ${pct(p.mu)} a year with less than its ${pct(p.sigma)} volatility`;
  }
  return `The frontier reaches the custom mix's ${pct(p.mu)} return at ${pct(f.sigma)} volatility, against the mix's ${pct(p.sigma)}`;
}

/** Each line's value on the last day, from the amount invested. */
export function wealthEnds(d: WealthData, amount: number): { label: string; role: string; end: number }[] {
  return d.series.map((s) => {
    const path = wealth(s.returns as number[], amount);
    return { label: s.label, role: s.role, end: path[path.length - 1] };
  });
}

/** The wealth chart's title: where the custom mix ended, against the line that ended highest. */
export function wealthTitle(d: WealthData, amount: number, hasCustom: boolean): string {
  const start = format(amount, "usd0");
  if (!hasCustom) return `Growth of ${start} with no custom portfolio: the weights above were refused`;
  const ends = wealthEnds(d, amount);
  const c = ends.find((e) => e.role === "custom");
  const last = d.dates[d.dates.length - 1];
  if (!c || !last || !(amount > 0) || !ends.every((e) => Number.isFinite(e.end))) return `Growth of ${start}`;
  const lead = `${start} in the custom mix ended at ${format(c.end, "usd0")} on ${format(last, "date")}`;
  const others = ends.filter((e) => e !== c);
  const best = others.reduce<(typeof ends)[number] | null>((b, e) => (b === null || e.end > b.end ? e : b), null);
  if (!best) return lead;
  if (format(c.end, "usd0") === format(best.end, "usd0")) return `${lead}, the same as ${best.label}`;
  if (c.end > best.end) return `${lead}, more than any other line here`;
  return `${lead}; ${best.label} ended highest, at ${format(best.end, "usd0")}`;
}

/** The Normalized Weights table (1734-1737), one row per ticker in the entered order. */
export const WEIGHT_COLUMNS: Column[] = [
  { key: "ticker", label: "Ticker", format: "text", first: true },
  { key: "entered", label: "Entered", format: "num2" },
  { key: "weight", label: "Normalized weight", format: "pct2" },
];

/**
 * Raw numbers: the entered value and the normalised weight. Refused weights build no table: its place
 * says why, the way a chart's does, rather than printing a column of dashes.
 */
export function weightTable(v: CustomView): LoadState<TableRow[]> {
  if (!v.custom.ok) return { status: "empty", reason: `No normalized weights: ${v.refusal?.short ?? "the weights were refused"}.` };
  const w = v.custom.w;
  return { status: "ready", value: v.tickers.map((ticker, i) => ({ ticker, entered: v.raw[i], weight: w[i] })) };
}
