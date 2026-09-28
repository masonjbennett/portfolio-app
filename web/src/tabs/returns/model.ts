// The Returns & Statistics tab as numbers: everything the tab prints or draws, computed from an
// Analysis with no DOM, so test/t-tab-returns.mjs holds it to the app's own figures. Line numbers
// cite portfolio_app.py (the tab is 1225-1312).
//
// Where the tab departs from the app, on purpose:
// - The app's "Kurtosis" column (1236, 1241) is pandas' Series.kurtosis(), which is EXCESS kurtosis
//   (a normal distribution scores 0). The label here says so.
// - The app's table cells are f-strings (1235-1242), so its CSV and Excel files hold text such as
//   "17.55%". Rows here hold the raw numbers; the Table prints them and the downloads keep them.
// - The app's growth line starts at amount x (1 + r1) (1261): it never plots the amount invested.
//   Here every line starts at the amount on the first price date.
// - The app's histogram asks plotly for at most 80 "nice" bins (1280), which cannot be reproduced;
//   here it is 80 equal-width bins from the lowest day to the highest, said in the subtitle.
import { linspace, mean, std, type Vec } from "../../lib/num.ts";
import { annualizedStats, excessKurtosis, normPdf, probplot, skew, wealth } from "../../lib/stats.ts";
import { assetColors, ROLE } from "../../charts/theme.ts";
import { format, MINUS } from "../../format.ts";
import type { Analysis, Column, LoadState, TableRow } from "../../types.ts";

// ---- the lines: the tickers, then the benchmark (1229-1244, 1260) ------------------------------

export interface Line {
  /** Stable key for the chart and the series toggles: s0, s1, ... (a ticker such as BRK.B is not a safe data key). */
  key: string;
  /** The symbol as requested (the benchmark's raw symbol, ^GSPC). */
  symbol: string;
  /** What the page calls it: the ticker, or the benchmark's display name (1261 renames it). */
  name: string;
  /** Its colour: the asset's by position, ink for the benchmark (src/charts/theme.ts). */
  color: string;
  /** Daily simple returns, aligned with analysis.dates. */
  returns: Vec;
  /** The benchmark line. */
  bench: boolean;
}

export function linesOf(a: Analysis): Line[] {
  const colors = assetColors(a.tickers);
  const out: Line[] = a.tickers.map((t, i) => ({
    key: `s${i}`,
    symbol: t,
    name: t,
    color: colors[t],
    returns: a.returns[i],
    bench: false,
  }));
  out.push({
    key: `s${a.tickers.length}`,
    symbol: a.benchmark,
    name: a.benchLabel,
    color: ROLE.bench,
    returns: a.bench,
    bench: true,
  });
  return out;
}

// The lowest and highest finite value; NaN for both when there is none.
export function extent(xs: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (!Number.isFinite(x)) continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return lo <= hi ? [lo, hi] : [NaN, NaN];
}

// ---- T1: Summary Statistics (1229-1253) ----------------------------------------------------------

// The app's six columns in its order, with its formats ({:.2%} and {:.3f}). "Kurtosis" is renamed
// for what it is. The label column has no header in the app (a DataFrame index).
export const SUMMARY_COLUMNS: Column[] = [
  { key: "asset", label: "Asset", format: "text", first: true },
  { key: "annReturn", label: "Ann. Return", format: "pct2" },
  { key: "annVol", label: "Ann. Volatility", format: "pct2" },
  { key: "skew", label: "Skewness", format: "num3" },
  { key: "exKurt", label: "Excess kurtosis", format: "num3" },
  { key: "minDaily", label: "Min Daily", format: "pct2" },
  { key: "maxDaily", label: "Max Daily", format: "pct2" },
];

// The app's download names (1250, 1252), without the extension.
export const SUMMARY_FILE = "summary_statistics";

// A figure that is not a finite number is a missing figure, printed as the dash.
const fin = (x: number): number | null => (Number.isFinite(x) ? x : null);

// One row per ticker in order, then the benchmark under its display name (1239). The benchmark's
// return and volatility are the analysis' benchStats, the app's mu_b and sig_b (1169, 1240). A line
// whose returns are not all numbers gets no figures at all, rather than figures from part of it.
export function summaryRows(a: Analysis): TableRow[] {
  return linesOf(a).map((l) => {
    if (!l.returns.every(Number.isFinite)) {
      return { asset: l.name, annReturn: null, annVol: null, skew: null, exKurt: null, minDaily: null, maxDaily: null };
    }
    const s = l.bench ? a.benchStats : annualizedStats(l.returns, a.rf);
    const [lo, hi] = extent(l.returns);
    return {
      asset: l.name,
      annReturn: fin(s.mu),
      annVol: fin(s.sigma),
      skew: fin(skew(l.returns)),
      exKurt: fin(excessKurtosis(l.returns)),
      minDaily: fin(lo),
      maxDaily: fin(hi),
    };
  });
}

// ---- C1: Cumulative Growth (1257-1266) -----------------------------------------------------------

export interface GrowthLine extends Line {
  /** The value on each price date: the amount on the first, amount x cumprod(1 + r) after (1261). */
  values: Vec;
  /** The last value. */
  end: number;
  /** The growth of 1 over the whole span, minus 1: the same whatever the amount. */
  total: number;
}

export interface Growth {
  /** The price dates: the first is the day the amount goes in, one more than the return dates. */
  dates: string[];
  amount: number;
  lines: GrowthLine[];
}

// The amount must be a positive finite number; anything else draws nothing (see growthState).
export const amountOk = (amount: number) => Number.isFinite(amount) && amount > 0;

export function growth(a: Analysis, amount: number): Growth {
  // The growth of $1 first: the total return does not depend on the amount, and multiplying by it
  // is the same arithmetic wealth(r, amount) does, so the values match the app's to the last bit.
  const lines = linesOf(a).map((l) => {
    const unit = wealth(l.returns, 1);
    const values = unit.map((v) => v * amount);
    return { ...l, values, end: values[values.length - 1], total: unit[unit.length - 1] - 1 };
  });
  return { dates: a.prices.dates, amount, lines };
}

// The chart's state for the lines the visitor chose. Nothing chosen draws nothing, as in the app
// (1260), and says so; a bad amount or a path that is not all finite numbers fails closed, named.
export function growthState(g: Growth, shown: readonly string[]): LoadState<GrowthLine[]> {
  if (!amountOk(g.amount)) return { status: "empty", reason: "Enter a starting amount above $0 to draw the growth lines." };
  const lines = g.lines.filter((l) => shown.includes(l.key));
  if (!lines.length) return { status: "empty", reason: "No line selected. Choose at least one above." };
  const bad = lines.find((l) => l.values.length !== g.dates.length || !l.values.every(Number.isFinite));
  if (bad) return { status: "error", name: `the ${bad.name} growth line`, message: "Its values are not all numbers." };
  return { status: "ready", value: lines };
}

// The growth table under the chart: where each line ended. The app has no table or download for
// the chart (1257-1266); the numbers behind the headline are here, raw, with both downloads.
export const GROWTH_COLUMNS: Column[] = [
  { key: "asset", label: "Asset", format: "text", first: true },
  { key: "end", label: "Ending value", format: "usd0" },
  { key: "total", label: "Total return", format: "pct2" },
];

export const GROWTH_FILE = "cumulative_growth";

export function growthRows(g: Growth): TableRow[] {
  return g.lines.map((l) => ({ asset: l.name, end: amountOk(g.amount) ? fin(l.end) : null, total: fin(l.total) }));
}

export function growthTitle(amount: number): string {
  return `Growth of ${amountOk(amount) ? format(amount, "usd0") : "the starting amount"}`;
}

// ---- the headline -------------------------------------------------------------------------------

// A line's name inside a sentence: "the S&P 500", but "VTI".
export const inSentence = (l: Line) => (l.bench ? `the ${l.name}` : l.name);

// The tab's lead sentence: where the amount ended highest and lowest, over every line (the
// benchmark included), whatever the chart's toggles show. It says only what the numbers say, and
// names no winner while any line's figure is missing: the missing one might have been it.
export function headline(g: Growth): string {
  const bad = g.lines.filter((l) => !Number.isFinite(l.end) || !Number.isFinite(l.total));
  if (bad.length) return `No growth figure for ${bad.map(inSentence).join(", ")}: its returns are not all numbers.`;
  let best = g.lines[0];
  let worst = g.lines[0];
  for (const l of g.lines) {
    if (l.end > best.end) best = l;
    if (l.end < worst.end) worst = l;
  }
  const [hi, lo] = [inSentence(best), inSentence(worst)];
  if (!amountOk(g.amount)) {
    return `${hi} returned the most, ${format(best.total, "pct2")}, and ${lo} the least, ${format(worst.total, "pct2")}.`;
  }
  const amt = format(g.amount, "usd0");
  const b = format(best.end, "usd0");
  const w = format(worst.end, "usd0");
  if (worst.end >= g.amount) return `${amt} grew most in ${hi}, to ${b}, and least in ${lo}, to ${w}.`;
  if (best.end >= g.amount) return `${amt} grew most in ${hi}, to ${b}, and fell most in ${lo}, to ${w}.`;
  return `${amt} fell least in ${hi}, to ${b}, and most in ${lo}, to ${w}.`;
}

// The line under it: the span the figures cover, the price dates actually used (never the request).
export function dek(a: Analysis): string {
  const d = a.prices.dates;
  const k = a.tickers.length;
  return `Daily closes from ${format(d[0], "date")} to ${format(d[d.length - 1], "date")}, ${format(d.length, "int")} trading days: ${k} ${k === 1 ? "asset" : "assets"} and the ${a.benchLabel}.`;
}

// ---- C2: the histogram with its normal fit (1277-1293) ---------------------------------------------

export const BINS = 80;
export const FIT_POINTS = 200;

export interface Hist {
  /** Lowest and highest daily return: the first bin's left edge and the last bin's right edge. */
  lo: number;
  hi: number;
  /** Bin width. */
  width: number;
  /** Days in each bin; the last bin includes its right edge. */
  counts: number[];
  /** counts / (n x width): a probability density, so the bars' area is 1 (histnorm, 1280). */
  density: number[];
  /** Number of returns. */
  n: number;
  /** Mean and standard deviation (ddof 1) of the returns: the normal fit's parameters (1285). */
  mean: number;
  sd: number;
  /** The normal fit at FIT_POINTS points from lo to hi (1284-1285). */
  fitX: Vec;
  fitY: Vec;
}

export function histogram(r: Vec, bins = BINS): LoadState<Hist> {
  if (!r.every(Number.isFinite)) return { status: "error", name: "the return series", message: "It holds a value that is not a number." };
  if (r.length < 2) return { status: "empty", reason: "Too few returns to draw a distribution." };
  const [lo, hi] = extent(r);
  const sd = std(r);
  if (!(hi > lo) || !(sd > 0)) return { status: "empty", reason: "Every daily return is the same, so there is no distribution to draw." };
  const width = (hi - lo) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const x of r) counts[Math.min(bins - 1, Math.floor((x - lo) / width))] += 1;
  const n = r.length;
  const m = mean(r);
  const fitX = linspace(lo, hi, FIT_POINTS);
  return {
    status: "ready",
    value: {
      lo, hi, width, counts, n, mean: m, sd, fitX,
      density: counts.map((c) => c / (n * width)),
      fitY: fitX.map((x) => normPdf(x, m, sd)),
    },
  };
}

// The histogram's title states the finding: tails fatter or thinner than the normal fit, by the
// sign of the excess kurtosis, which is what that number measures.
export function histTitle(name: string, r: Vec): string {
  const k = excessKurtosis(r);
  if (!Number.isFinite(k)) return `${name}: daily return distribution`;
  const shape = k > 0 ? "fatter tails than" : k < 0 ? "thinner tails than" : "the tails of";
  return `${name} has ${shape} a normal curve: excess kurtosis ${format(k, "num2")}`;
}

// ---- C3: the Q-Q plot (1294-1312) --------------------------------------------------------------------

export interface QQView {
  /** Theoretical quantiles (Filliben medians through the normal quantile) and the sorted returns. */
  osm: Vec;
  osr: Vec;
  /** The least-squares line of osr on osm (probplot's fit). */
  slope: number;
  intercept: number;
  /** The drawn line: from the lowest to the highest theoretical quantile (1302). */
  line: [[number, number], [number, number]];
}

export function qqState(r: Vec): LoadState<QQView> {
  if (!r.every(Number.isFinite)) return { status: "error", name: "the return series", message: "It holds a value that is not a number." };
  if (r.length < 3) return { status: "empty", reason: "Too few returns to draw a Q-Q plot." };
  const [lo, hi] = extent(r);
  if (!(hi > lo)) return { status: "empty", reason: "Every daily return is the same, so there is no distribution to draw." };
  const q = probplot(r);
  const x0 = q.osm[0];
  const x1 = q.osm[q.osm.length - 1];
  return {
    status: "ready",
    value: { ...q, line: [[x0, q.slope * x0 + q.intercept], [x1, q.slope * x1 + q.intercept]] },
  };
}

// The Q-Q title states the finding: the worst day against where the normal line puts the lowest day.
export function qqTitle(name: string, q: LoadState<QQView>): string {
  if (q.status !== "ready") return `${name}: Q-Q plot`;
  const worst = q.value.osr[0];
  const expected = q.value.line[0][1];
  return `${name}'s worst day was ${format(worst, "pct2")}; the normal line puts its lowest day at ${format(expected, "pct2")}`;
}

// ---- axes -----------------------------------------------------------------------------------------

// A 1-2-2.5-5 step giving about `target` intervals over `span`.
export function niceStep(span: number, target = 5): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

// Ticks on whole steps covering [lo, hi]; the first and last are the axis ends. A span of zero is
// widened by one unit of its own size so the axis still has two ends.
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (!(hi > lo)) {
    const pad = Math.abs(lo) || 1;
    lo -= pad / 2;
    hi += pad / 2;
  }
  const step = niceStep(hi - lo, target);
  const a = Math.floor(lo / step + 1e-9);
  const b = Math.ceil(hi / step - 1e-9);
  const out: number[] = [];
  for (let k = a; k <= b; k++) out.push(Number((k * step).toPrecision(12)));
  return out;
}

// A tick's text: the fewest decimals that print it exactly (0.025 -> 2.5%), with a true minus.
export function tickText(x: number, kind: "pct" | "num" | "usd"): string {
  if (kind === "usd") return format(x, "usd0");
  const v = kind === "pct" ? x * 100 : x;
  const s = Number(Math.abs(v).toFixed(6)).toString();
  return `${v < 0 && s !== "0" ? MINUS : ""}${s}${kind === "pct" ? "%" : ""}`;
}

// X ticks for a date axis: the first trading day of each year, thinned to at most `max` labels.
export function yearTicks(dates: readonly string[], max = 8): string[] {
  const firsts: string[] = [];
  let year = "";
  for (const d of dates) {
    const y = d.slice(0, 4);
    if (y !== year) {
      year = y;
      firsts.push(d);
    }
  }
  // The first date starts the data, not a year, unless it happens to open one: label years only.
  if (firsts.length && dates.length && firsts[0] === dates[0] && !/-01-0[1-9]$/.test(dates[0])) firsts.shift();
  const every = Math.max(1, Math.ceil(firsts.length / Math.max(1, max)));
  return firsts.filter((_, i) => i % every === 0);
}
