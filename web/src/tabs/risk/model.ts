// The Risk Analysis tab's arithmetic (portfolio_app.py 1317-1416), pure: everything the tab prints is
// computed here from an Analysis, so the suite reaches every figure without a DOM. The components in
// this folder only draw what these functions return.
//
// Where the port departs from the app, on purpose:
// - Drawdowns start at the amount invested (the first close), not at 1 + r1 (drawdown_series,
//   911-914): a fall that begins on the first day is a drawdown here and is not in the app.
// - The beta bars take their height and their colour from the beta itself. The app draws
//   float(f"{slope:.3f}") (1396) and colours on that rounded value (1398), so a beta of 1.0004 is
//   drawn as "not above the market".
// - Every table holds numbers, so both downloads carry numbers; the app's risk table is f-strings
//   (1357-1358) and its CAPM table (1388-1392) has no download at all.
// - A figure that is not a number fails its chart closed and named, and prints as a dash in a table:
//   never "nan" (the app prints f"{nan:.3f}" as "nan").
import { format } from "../../format.ts";
import { spreadLabels } from "../../charts/labels.ts";
import { annualizedStats, capm, drawdowns, rollingStd, TRADING_DAYS } from "../../lib/stats.ts";
import { monthYear } from "../../chrome/when.ts";
import type { Analysis, Column, LoadState, TableRow } from "../../types.ts";

// ---- rolling volatility (1321-1328) ----------------------------------------------------------------

/** The window slider's options and default: select_slider(options=[30, 60, 90, 120], value=60) (1322). */
export const VOL_WINDOWS = [30, 60, 90, 120] as const;
export type VolWindow = (typeof VOL_WINDOWS)[number];
export const DEFAULT_WINDOW: VolWindow = 60;

/**
 * rolling(w).std() * sqrt(252) per ticker (1324), aligned with `a.dates`: NaN for the first w - 1
 * days, as pandas' min_periods = w leaves them. The benchmark is not included, as in the app.
 */
export function volSeries(a: Analysis, w: number): number[][] {
  const k = Math.sqrt(TRADING_DAYS);
  return a.returns.map((r) => rollingStd(r, w).map((x) => x * k));
}

/** One chart row: the date, then `s0`, `s1`, ... per ticker (keys never carry a symbol's dots). */
export type SeriesRow = { date: string } & Record<string, number | string>;

export interface VolChart {
  /** The window, in trading days. */
  window: number;
  /** Rows from the first full window on; every value finite. */
  rows: SeriesRow[];
  /** The tickers, in order: series `s${i}` is `names[i]`. */
  names: string[];
  /** Each series' last value, where its line ends. */
  last: number[];
  /** The highest value any series reached, and where; `late` when it is in the chart's right half (its label goes left). */
  peak: { name: string; index: number; value: number; date: string; late: boolean };
  /** The y-axis ceiling: the peak rounded up to the next 10%. */
  yMax: number;
  /** One x tick per calendar year: the first date of each year on the chart. */
  ticks: string[];
}

export const seriesKey = (i: number) => `s${i}`;

export function volChart(a: Analysis, w: number): LoadState<VolChart> {
  const n = a.dates.length;
  if (n < w) {
    return { status: "empty", reason: `A ${w}-day window needs at least ${w} daily returns; these prices give ${n}.` };
  }
  const series = volSeries(a, w);
  const rows: SeriesRow[] = [];
  let peak = { name: "", index: -1, value: -Infinity, date: "", late: false };
  for (let i = w - 1; i < n; i++) {
    const row: SeriesRow = { date: a.dates[i] };
    for (let j = 0; j < series.length; j++) {
      const v = series[j][i];
      if (!Number.isFinite(v)) {
        return { status: "error", name: "the rolling volatility", message: `${a.tickers[j]} has a window on ${a.dates[i]} that is not a number.` };
      }
      row[seriesKey(j)] = v;
      if (v > peak.value) peak = { name: a.tickers[j], index: j, value: v, date: a.dates[i], late: i - (w - 1) > (n - w + 1) / 2 };
    }
    rows.push(row);
  }
  return {
    status: "ready",
    value: {
      window: w,
      rows,
      names: a.tickers,
      last: series.map((s) => s[n - 1]),
      peak,
      yMax: Math.max(0.1, Math.ceil(peak.value * 10) / 10),
      ticks: yearTicks(rows.map((r) => r.date)),
    },
  };
}

// The chart's title: the finding, the highest volatility any asset reached in this window.
export function volTitle(v: VolChart): string {
  return `${v.peak.name} swung hardest: its ${v.window}-day volatility reached ${format(v.peak.value, "pct1")} on ${v.peak.date}`;
}

// ---- drawdowns (1333-1348) ---------------------------------------------------------------------------

export interface Drawdown {
  /** The ticker, or the benchmark's display name. */
  name: string;
  /** The path's dates: the first PRICE date (the amount invested), then every return date. */
  dates: string[];
  /** Drawdown on each date, <= 0; the first is 0, the start. */
  values: number[];
  /** The lowest value on the path (the maximum drawdown), <= 0. */
  max: number;
  /** Index of the lowest point; of the high it fell from; of the first return to that high, or null. */
  trough: number;
  peak: number;
  recovered: number | null;
}

// A path's worst point and the high before it. The first minimum is taken, as pandas' idxmin would.
function summarise(name: string, dates: string[], values: number[]): Drawdown {
  let trough = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[trough]) trough = i;
  let peak = trough;
  while (peak > 0 && values[peak] !== 0) peak--;
  let recovered: number | null = null;
  for (let i = trough + 1; i < values.length; i++) {
    if (values[i] === 0) {
      recovered = i;
      break;
    }
  }
  return { name, dates, values, max: values[trough], trough, peak, recovered };
}

// The drawdown path's dates: the first close, then the return dates. analyze() takes the return
// dates as the price dates minus the first (889-890), so the two line up one to one.
function pathDates(a: Analysis): string[] {
  return [a.prices.dates[0], ...a.dates];
}

/** The drawdown path of one return series, measured from the amount invested (the port's start). */
export function drawdownOf(a: Analysis, name: string, r: number[]): Drawdown {
  return summarise(name, pathDates(a), drawdowns(r, true));
}

const DD_CACHE = new WeakMap<Analysis, Drawdown[]>();

/** Every ticker's drawdown, in ticker order; computed once per analysis. */
export function tickerDrawdowns(a: Analysis): Drawdown[] {
  let dd = DD_CACHE.get(a);
  if (!dd) {
    dd = a.tickers.map((t, j) => drawdownOf(a, t, a.returns[j]));
    DD_CACHE.set(a, dd);
  }
  return dd;
}

/** The ticker with the deepest drawdown (the first, on a tie), or null for an empty list. */
export function worstDrawdown(list: Drawdown[]): Drawdown | null {
  let worst: Drawdown | null = null;
  for (const d of list) if (Number.isFinite(d.max) && (!worst || d.max < worst.max)) worst = d;
  return worst;
}

/**
 * The tab's headline: which asset fell furthest, by how much, and when. Months, as the title chip
 * prints its dates (monthYear); the table below gives the days.
 */
export function headline(a: Analysis): string {
  const w = worstDrawdown(tickerDrawdowns(a));
  const n = a.tickers.length;
  if (!w) return `No drawdown could be measured for these ${n} assets.`;
  if (w.max === 0) return `None of these ${n} assets ever closed below its first close or an earlier high.`;
  const from = w.peak === 0 ? `where it started, in ${monthYear(w.dates[0])}` : `its high in ${monthYear(w.dates[w.peak])}`;
  const back =
    w.recovered === null
      ? `and had not regained that level by ${monthYear(a.asOf)}`
      : `and was back at that level by ${monthYear(w.dates[w.recovered])}`;
  return `${w.name} fell furthest: ${format(-w.max, "pct1")} from ${from} to its low in ${monthYear(w.dates[w.trough])}, ${back}.`;
}

export interface DrawdownChart {
  /** One row per path date: the first is the start, drawdown 0. */
  rows: { date: string; dd: number }[];
  /** The lowest point, labelled in the chart. */
  low: { date: string; value: number; late: boolean };
  /** The y-axis floor: the low with a margin under it for its label. */
  yMin: number;
  ticks: string[];
}

export function drawdownChart(d: Drawdown): LoadState<DrawdownChart> {
  if (d.values.length < 2) return { status: "empty", reason: `There are no returns for ${d.name}.` };
  const bad = d.values.findIndex((v) => !Number.isFinite(v));
  if (bad >= 0) return { status: "error", name: `${d.name}'s drawdown`, message: `The value on ${d.dates[bad]} is not a number.` };
  const rows = d.values.map((dd, i) => ({ date: d.dates[i], dd }));
  return {
    status: "ready",
    value: {
      rows,
      low: { date: d.dates[d.trough], value: d.max, late: d.trough > d.values.length / 2 },
      yMin: Math.min(-0.1, Math.floor(d.max * 11) / 10),
      ticks: yearTicks(d.dates),
    },
  };
}

// The hero chart's title: the finding for the asset on show.
export function drawdownTitle(d: Drawdown): string {
  if (d.max === 0) return `${d.name} never closed below its first close or an earlier high`;
  return `${d.name} was ${format(-d.max, "pct2")} below its high at the worst, on ${d.dates[d.trough]}`;
}

export const DRAWDOWN_COLUMNS: Column[] = [
  { key: "asset", label: "Asset", format: "text", first: true },
  { key: "mdd", label: "Maximum Drawdown", format: "pct2" },
  { key: "peak", label: "High", format: "date" },
  { key: "low", label: "Low", format: "date" },
  { key: "back", label: "Back at the high", format: "date" },
];

// Tickers, then the benchmark (as the risk table orders its rows, 1356-1358). A path that never fell
// has no high or low to date.
export function drawdownRows(a: Analysis): TableRow[] {
  const list = [...tickerDrawdowns(a), drawdownOf(a, a.benchLabel, a.bench)];
  return list.map((d) => {
    const fell = Number.isFinite(d.max) && d.max < 0;
    return {
      asset: d.name,
      mdd: Number.isFinite(d.max) ? d.max : null,
      peak: fell ? d.dates[d.peak] : null,
      low: fell ? d.dates[d.trough] : null,
      back: fell && d.recovered !== null ? d.dates[d.recovered] : null,
    };
  });
}

// ---- risk-adjusted metrics (1353-1367) ------------------------------------------------------------

export const RISK_COLUMNS: Column[] = [
  { key: "asset", label: "Asset", format: "text", first: true },
  { key: "sharpe", label: "Sharpe Ratio", format: "num3" },
  { key: "sortino", label: "Sortino Ratio", format: "num3" },
];

const fin = (x: number): number | null => (Number.isFinite(x) ? x : null);

// annualized_stats at the analysis's rate for each ticker, then the benchmark's (1355-1358).
export function riskRows(a: Analysis): TableRow[] {
  const rows: TableRow[] = a.tickers.map((t, j) => {
    const s = annualizedStats(a.returns[j], a.rf);
    return { asset: t, sharpe: fin(s.sharpe), sortino: fin(s.sortino) };
  });
  rows.push({ asset: a.benchLabel, sharpe: fin(a.benchStats.sharpe), sortino: fin(a.benchStats.sortino) });
  return rows;
}

// ---- CAPM (1372-1416) --------------------------------------------------------------------------------

export const CAPM_COLUMNS: Column[] = [
  { key: "asset", label: "Asset", format: "text", first: true },
  { key: "beta", label: "Beta", format: "num3" },
  { key: "alpha", label: "Alpha (Ann.)", format: "pct2" },
  { key: "r2", label: "R²", format: "num3" },
];

export interface CapmRow {
  name: string;
  beta: number;
  alphaAnn: number;
  r2: number;
}

// Each ticker's excess return regressed on the benchmark's (1377-1392). Tickers only, no benchmark
// row, as in the app. After cleaning no return is missing, so the app's dropna (1383) drops nothing.
export function capmRows(a: Analysis): CapmRow[] {
  return a.tickers.map((t, j) => ({ name: t, ...capm(a.returns[j], a.bench, a.rf) }));
}

export function capmTableRows(list: CapmRow[]): TableRow[] {
  return list.map((c) => ({ asset: c.name, beta: fin(c.beta), alpha: fin(c.alphaAnn), r2: fin(c.r2) }));
}

/** Above the market line: the beta itself above 1, never its 3-decimal print (the app's 1396-1398). */
export function aboveMarket(beta: number): boolean {
  return beta > 1;
}

export interface BetaChart {
  bars: { name: string; beta: number; above: boolean }[];
  /** The asset with the highest beta. */
  top: { name: string; beta: number };
  /** The count of assets above 1. */
  above: number;
  yMin: number;
  yMax: number;
}

export function betaChart(list: CapmRow[]): LoadState<BetaChart> {
  if (!list.length) return { status: "empty", reason: "There are no assets to estimate a beta for." };
  const bad = list.find((c) => !Number.isFinite(c.beta));
  if (bad) {
    return { status: "error", name: "the beta estimates", message: `${bad.name}'s beta is not a number: the benchmark's returns do not vary.` };
  }
  const bars = list.map((c) => ({ name: c.name, beta: c.beta, above: aboveMarket(c.beta) }));
  let top = bars[0];
  for (const b of bars) if (b.beta > top.beta) top = b;
  const lo = Math.min(0, ...bars.map((b) => b.beta));
  const hi = Math.max(1, ...bars.map((b) => b.beta));
  return {
    status: "ready",
    value: {
      bars,
      top: { name: top.name, beta: top.beta },
      above: bars.filter((b) => b.above).length,
      yMin: lo < 0 ? round2(Math.floor(lo * 5) / 5 - 0.2) : 0,
      yMax: round2(Math.ceil(hi * 5) / 5 + 0.2),
    },
  };
}

// An axis bound without binary noise (1.6, not 1.5999999999999999).
const round2 = (x: number) => Math.round(x * 100) / 100;

// The beta chart's title: how many assets sit above the market line, and the highest beta.
export function betaTitle(b: BetaChart, benchLabel: string): string {
  const n = b.bars.length;
  const top = `${b.top.name}'s ${format(b.top.beta, "num2")} is the highest`;
  if (b.above === 0) return `No asset has a beta above 1 against the ${benchLabel}; ${top}`;
  if (b.above === n) return `Every asset has a beta above 1 against the ${benchLabel}; ${top}`;
  return `${b.above} of ${n} assets ${b.above === 1 ? "has" : "have"} a beta above 1 against the ${benchLabel}; ${top}`;
}

// ---- axes and labels ----------------------------------------------------------------------------------

/** The first date of each calendar year in `dates` (ascending ISO days): one x tick per year. */
export function yearTicks(dates: string[]): string[] {
  const out: string[] = [];
  let year = "";
  for (const d of dates) {
    const y = d.slice(0, 4);
    if (y !== year) {
      out.push(d);
      year = y;
    }
  }
  return out;
}

/** A percentage axis tick with no decimals, "-40%" with a true minus. */
export function pctTick(v: number): string {
  if (!Number.isFinite(v)) return "";
  const p = Math.round(v * 100);
  return `${p < 0 ? "−" : ""}${Math.abs(p)}%`;
}

/** The year of an ISO day, for the date axes. */
export function yearOf(d: unknown): string {
  return typeof d === "string" ? d.slice(0, 4) : "";
}

/**
 * Where the end-of-line labels sit, in data units: each at its line's last value, moved apart so no
 * two are closer than `gapPx` on a plot `plotPx` tall spanning [0, yMax].
 */
export function endLabels(last: number[], yMax: number, plotPx: number, gapPx = 14): number[] {
  const unit = plotPx > 0 && yMax > 0 ? (gapPx * yMax) / plotPx : 0;
  return spreadLabels(last, unit);
}
