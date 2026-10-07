// The Sensitivity tab's arithmetic (portfolio_app.py 1842-2021), pure, so the suite reaches every
// figure without a DOM. The component only lays these out.
//
// Each window is the TRAILING lb return rows, all ending on the last date (1874), with its own mean
// and ddof-1 covariance (1876-1877), re-optimised with the same bounds and scored at the same annual
// risk-free rate (1878-1879). Where the port departs from the app, on purpose:
// - The solves are exact (src/lib/optimize.ts), not SLSQP at its default ftol (932, 943), so a
//   window's weights no longer carry the solver's noise in the third significant figure.
// - A failed solve keeps its window: the row prints a dash and the page names the window. The app
//   drops the rows silently (1883, 1891), and when EVERY solve of one kind fails its
//   metrics_df has no Portfolio column and line 1906 or 1907 raises.
// - The metrics are in-sample (optimised and scored on the same returns, 1884) and the page says so.
// - The too-short message states the rule the code applies (one year of returns, 1855, 1870); the
//   app's says two years (1871).
// - The Sharpe comparison uses the numbers, not the 3-dp strings parsed back (2011-2013).
// - Where a window is named in a sentence or a table row, it carries the day it ends ("5 years to
//   2026-09-28"), so a weight read off this tab cannot be mistaken for one fitted on some other,
//   earlier stretch of history. The app's own label ("5 Years") stays on the chart and the columns.
import { gmv, tangency, type Solution, type Tangency } from "../../lib/optimize.ts";
import { normalizeCustom, portfolioPerformance, windowMoments, windows, type Custom, type Performance } from "../../lib/portfolio.ts";
import type { Mat, Vec } from "../../lib/num.ts";
import { format, MINUS } from "../../format.ts";
import { cullLabels, textWidth, type Rect } from "../../charts/labels.ts";
import type { Analysis, Column, CustomWeights, LoadState, TableRow } from "../../types.ts";

/** The two optimised portfolios, as the app's radio names them (1938). */
export type Port = "gmv" | "tan";

export const PORT_NAME: Readonly<Record<Port, string>> = { gmv: "GMV", tan: "Tangency" };

/** One estimation window, re-estimated and re-optimised. */
export interface WindowFit {
  /** The app's label, e.g. "2 Years" (1854-1868). */
  label: string;
  /** The label on the chart, short enough to sit on a bar: "2Y". */
  short: string;
  /** The label with the day the window ends, for sentences and table rows: "2 years to 2026-09-28". */
  named: string;
  /** The last return date in the window, ISO: the same for every window. */
  to: string;
  /** Return rows in the window. */
  lb: number;
  /** The first return date in the window, ISO. */
  from: string;
  /** Mean daily return per ticker over the window. */
  m: Vec;
  /** Daily covariance over the window, ddof 1. */
  S: Mat;
  /** Minimum variance on this window; null when the solve failed. */
  gmv: Solution | null;
  /** Maximum Sharpe on this window; null when the solve failed. */
  tan: Tangency | null;
}

// The app's labels in sentence case, for "5 years to 2026-09-28".
const PLAIN: Readonly<Record<string, string>> = {
  "1 Year": "1 year",
  "2 Years": "2 years",
  "3 Years": "3 years",
  "5 Years": "5 years",
  "Full Sample": "Full sample",
};

/** A window's label with the day it ends. */
export function windowName(label: string, to: string): string {
  return `${PLAIN[label] ?? label} to ${format(to, "date")}`;
}

const SHORT: Readonly<Record<string, string>> = {
  "1 Year": "1Y",
  "2 Years": "2Y",
  "3 Years": "3Y",
  "5 Years": "5Y",
  "Full Sample": "Full",
};

/** The one requirement for comparing windows: two of them, i.e. at least 252 return rows (1870). */
export function tooShort(totalDays: number): string {
  return (
    `Comparing estimation windows needs at least one year (252 trading days) of overlapping returns; ` +
    `this range has ${totalDays}. Try a longer date range.`
  );
}

/** Every window re-estimated and re-optimised (1874-1901), or why there is nothing to compare. */
export function fitWindows(a: Analysis): LoadState<WindowFit[]> {
  const T = a.dates.length;
  const ws = windows(T);
  if (ws.length < 2) return { status: "empty", reason: tooShort(T) };
  const to = a.dates[T - 1];
  return {
    status: "ready",
    value: ws.map(({ label, lb }) => {
      const { m, S } = windowMoments(a.returns, lb);
      return {
        label,
        short: SHORT[label] ?? label,
        named: windowName(label, to),
        to,
        lb,
        from: a.dates[T - lb],
        m,
        S,
        gmv: gmv(m, S, a.allowShort),
        tan: tangency(m, S, a.rf, a.allowShort),
      };
    }),
  };
}

function weightsOf(f: WindowFit, p: Port): Vec | null {
  const s = p === "gmv" ? f.gmv : f.tan;
  return s ? s.w : null;
}

/** A window's figures for one weight vector: portfolio_performance on THAT window's moments (1884, 1987). */
export function scoreOn(f: WindowFit, w: Vec, rf: number): Performance {
  return portfolioPerformance(w, f.m, f.S, rf);
}

// A ratio of zero volatility is NaN; a cell prints null as a dash, never "NaN".
function fin(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

/** The metrics tables' columns (1886, 1905-1914), plus the day each window starts. */
export const METRIC_COLUMNS: Column[] = [
  { key: "window", label: "Window", format: "text", first: true },
  { key: "from", label: "From", format: "date" },
  { key: "mu", label: "Ann. Return", format: "pct2" },
  { key: "sigma", label: "Ann. Volatility", format: "pct2" },
  { key: "sharpe", label: "Sharpe", format: "num3" },
];

function metricRow(f: WindowFit, w: Vec | null, rf: number): TableRow {
  if (!w) return { window: f.named, from: f.from, mu: null, sigma: null, sharpe: null };
  const p = scoreOn(f, w, rf);
  return { window: f.named, from: f.from, mu: fin(p.mu), sigma: fin(p.sigma), sharpe: fin(p.sharpe) };
}

/** One portfolio's metrics per window, in window order; a failed window's row holds nulls. */
export function metricRows(fits: WindowFit[], p: Port, rf: number): TableRow[] {
  return fits.map((f) => metricRow(f, weightsOf(f, p), rf));
}

/** The fixed custom weights scored on every window (1981-1993): no solver, so every window has a row. */
export function customRows(fits: WindowFit[], w: Vec, rf: number): TableRow[] {
  return fits.map((f) => metricRow(f, w, rf));
}

/** The labels of the windows whose solve failed. */
export function failedWindows(fits: WindowFit[], p: Port): string[] {
  return fits.filter((f) => !weightsOf(f, p)).map((f) => f.label);
}

/** The windows whose tangency portfolio does not beat the risk-free rate (long-only returns the least-negative Sharpe). */
export function belowRf(fits: WindowFit[]): string[] {
  return fits.filter((f) => f.tan && !f.tan.beatsRf).map((f) => f.label);
}

/** A table state: ready rows, or an error naming the solve when it failed in every window. */
export function tableState(fits: WindowFit[], p: Port, rows: TableRow[]): LoadState<TableRow[]> {
  if (fits.every((f) => !weightsOf(f, p))) {
    return {
      status: "error",
      name: `The ${PORT_NAME[p]} optimisation`,
      message: "It failed in every window, so there is nothing to show.",
    };
  }
  return { status: "ready", value: rows };
}

// ---- weights across windows (1918-1932) -------------------------------------------------------

/** Each window column's sub-line on the weight tables: the day it ends ("to 2026-09-28"). */
export function windowSubs(fits: WindowFit[]): Record<string, string> {
  return Object.fromEntries(fits.map((f) => [f.label, `to ${format(f.to, "date")}`]));
}

/** The weight tables' columns: Ticker, then one per window in window order (the CSV header at 1930). */
export function weightColumns(fits: WindowFit[]): Column[] {
  return [
    { key: "ticker", label: "Ticker", format: "text", first: true },
    ...fits.map((f, i) => ({ key: `w${i}`, label: f.label, format: "pct2" as const })),
  ];
}

/**
 * One row per ticker, one raw weight per window; null where that window's solve failed. Rows are in
 * code-point order of the ticker, as the app's pivot sorts its index (1920); the chart keeps the
 * order the tickers were entered (1939).
 */
export function weightRows(fits: WindowFit[], p: Port, tickers: readonly string[]): TableRow[] {
  const order = tickers.map((t, i) => [t, i] as const).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return order.map(([t, i]) => {
    const row: TableRow = { ticker: t };
    fits.forEach((f, k) => {
      const w = weightsOf(f, p);
      row[`w${k}`] = w ? w[i] : null;
    });
    return row;
  });
}

// ---- the charts ---------------------------------------------------------------------------------

/** One chart group: its category label and one value per series (null where a solve failed). */
export interface Group {
  name: string;
  values: (number | null)[];
}

/** The weight comparison chart (1936-1944): a group per ticker in the entered order, a bar per window. */
export function weightGroups(fits: WindowFit[], p: Port, tickers: readonly string[]): Group[] {
  return tickers.map((t, i) => ({
    name: t,
    values: fits.map((f) => {
      const w = weightsOf(f, p);
      return w ? w[i] : null;
    }),
  }));
}

/** The Sharpe comparison chart (2008-2021): a group per window, bars GMV, Tangency, Custom. */
export function sharpeGroups(fits: WindowFit[], custom: Vec, rf: number): Group[] {
  return fits.map((f) => ({
    name: f.label,
    values: [weightsOf(f, "gmv"), weightsOf(f, "tan"), custom].map((w) => (w ? fin(scoreOn(f, w, rf).sharpe) : null)),
  }));
}

/**
 * Where to hang the series labels on a grouped bar chart, and a y range that leaves room for them.
 * The labels go on the group whose tallest bar is lowest; the top of the range is raised until that
 * group's bars plus `labelPx` of text fit under it in a plot `plotPx` tall. Pure pixel arithmetic:
 * y maps linearly from [lo, hi] onto the plot's height.
 */
export function labelLayout(groups: Group[], labelPx: number, plotPx: number): { host: number; lo: number; hi: number } {
  const vals = groups.flatMap((g) => g.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const lo = Math.min(0, ...vals);
  const top = Math.max(0, ...vals);
  let host = 0;
  let hostTop = Infinity;
  groups.forEach((g, i) => {
    const t = Math.max(0, ...g.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    if (t < hostTop) {
      hostTop = t;
      host = i;
    }
  });
  if (!Number.isFinite(hostTop)) hostTop = 0;
  // (hi - hostTop) / (hi - lo) >= f  <=>  hi >= (hostTop - f * lo) / (1 - f)
  const f = Math.min(0.6, labelPx / plotPx);
  let hi = Math.max(top, (hostTop - f * lo) / (1 - f));
  if (!(hi > lo)) hi = lo + 1;
  return { host, lo, hi };
}

/** The bars' spacing as GroupedBars asks Recharts for it: a gap of 16% of the band each side, 1px between bars. */
export const BAR_SPACING = { categoryGap: 0.16, barGap: 1 } as const;

/**
 * Where Recharts sets `k` bars side by side in a band `band` px wide (recharts 3's getBarPositions, for
 * bars with no size of their own): a gap of BAR_SPACING.categoryGap of the band each side, the rest less
 * the 1px gaps shared out and rounded to whole px once over 1px; the 1px gaps dropped when they leave no
 * room. `at(i)` is bar i's left edge from the band's left.
 */
export function barSlots(band: number, k: number): { size: number; at: (i: number) => number } {
  const gap = BAR_SPACING.categoryGap * band;
  const between = band - 2 * gap - (k - 1) * BAR_SPACING.barGap <= 0 ? 0 : BAR_SPACING.barGap;
  const share = (band - 2 * gap - (k - 1) * between) / k;
  const size = share > 1 ? Math.round(share) : share;
  return { size, at: (i) => gap + i * (size + between) };
}

// The ink of a name's letters across the bar: the face's cap height, measured as 8.00px at 11px in
// Chromium (canvas actualBoundingBoxAscent of "1Y"), and 0.2 em more for a descender.
const CAP_EM = 8 / 11;
const DESCENDER_EM = 0.2;

/**
 * Which series names are drawn on the label group, the last step after labelLayout: true drawn, false
 * left off, null for a series with no bar there to name (its value is missing), which is neither drawn
 * nor counted. Each name runs up from 4px over its own bar's top edge (the zero line for a bar that
 * points down), its box across the ink of its letters centred on its bar; it is left off when that box
 * meets a name drawn before it, another bar of the group, or runs out of the chart's top. `plot` is the
 * plot's box in px and [lo, hi] the y axis' domain; bars sit in their band as Recharts sets them (barSlots).
 */
export function namesDrawn(
  groups: readonly Group[],
  host: number,
  labels: readonly string[],
  plot: { x: number; y: number; width: number; height: number },
  lo: number,
  hi: number,
  fontPx = 11,
): (boolean | null)[] {
  const g = groups[host];
  const k = labels.length;
  const has = (i: number) => {
    const x = g?.values[i];
    return x !== null && x !== undefined && Number.isFinite(x);
  };
  if (!g || !k || !(plot.width > 0) || !(plot.height > 0) || !(hi > lo)) return labels.map((_, i) => (has(i) ? true : null));
  const band = plot.width / groups.length;
  const slot = barSlots(band, k);
  const py = (v: number) => plot.y + ((hi - v) / (hi - lo)) * plot.height;
  const left = (i: number) => plot.x + host * band + slot.at(i);
  const v = (i: number) => (has(i) ? (g.values[i] as number) : 0);
  // Only the bars drawn are in the way: a missing value draws none.
  const bars: Rect[] = labels.flatMap((_, i) =>
    has(i) ? [{ lo: left(i), hi: left(i) + slot.size, top: py(Math.max(0, v(i))), bot: py(Math.min(0, v(i))) }] : [],
  );
  const own = (i: number) => {
    const b = { lo: left(i), hi: left(i) + slot.size };
    return bars.filter((r) => r.lo !== b.lo || r.hi !== b.hi);
  };
  const spots = labels.map((t, i) => {
    if (!has(i)) return [];
    const cx = left(i) + slot.size / 2;
    const ink = (CAP_EM + (/[gjpqy,]/.test(t) ? DESCENDER_EM : 0)) * fontPx;
    const bot = py(Math.max(0, v(i))) - 4;
    return [{ lo: cx - ink / 2, hi: cx + ink / 2, top: bot - textWidth(t, fontPx), bot }];
  });
  const at = cullLabels(spots, own, { lo: -Infinity, hi: Infinity, top: 0, bot: Infinity });
  return at.map((x, i) => (has(i) ? x >= 0 : null));
}

/**
 * Round axis ticks covering [lo, hi]: about five steps of 1, 2, 2.5 or 5 times a power of ten, the
 * range widened outward to whole steps. `decimals` is how many places a tick needs in `unit`s (100
 * for a percent axis), so 2.5% prints as 2.5%, never rounded to 3%.
 */
export function niceTicks(lo: number, hi: number, unit = 1): { ticks: number[]; decimals: number } {
  const span = hi - lo > 0 ? hi - lo : Math.abs(hi) || 1;
  const raw = span / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw * (1 - 1e-9)) as number;
  const first = Math.floor(lo / step + 1e-9);
  const last = Math.ceil(hi / step - 1e-9);
  const ticks: number[] = [];
  for (let k = first; k <= Math.max(last, first + 1); k++) ticks.push(Number((k * step).toPrecision(12)));
  let decimals = 0;
  while (decimals < 6 && Math.abs(Math.round(step * unit * 10 ** decimals) - step * unit * 10 ** decimals) > 1e-6) decimals++;
  return { ticks, decimals };
}

/** A tick's text: a percent or a plain number at `decimals` places, a true minus, no sign on zero. */
export function tickText(v: number, kind: "pct" | "num", decimals: number): string {
  const s = Math.abs(kind === "pct" ? v * 100 : v).toFixed(decimals);
  return `${v < 0 && /[1-9]/.test(s) ? MINUS : ""}${s}${kind === "pct" ? "%" : ""}`;
}

// ---- the sentences ------------------------------------------------------------------------------

/** The ticker whose weight moves most across the windows that solved, and where it lands. */
export interface Swing {
  ticker: string;
  lo: number;
  hi: number;
  loWindow: string;
  hiWindow: string;
}

/**
 * A swing's size as the page prints it: the range in percentage points at one decimal, the pct1 the
 * weights are printed at. Two tickers whose ranges differ only in the solver's last digits print the same
 * (in a fit that holds two assets, one weight's range is the other's to within 1e-16), so the larger is
 * judged on this figure and a tie goes to the first ticker: the same data gives the same sentence on every
 * load. src/lib/robust.ts's lookbackSpread() applies the same rule, and test/t-robust.mjs holds the two equal.
 */
export function printedSwing(lo: number, hi: number): number {
  return Number(((hi - lo) * 100).toFixed(1));
}

export function swing(fits: WindowFit[], p: Port, tickers: readonly string[]): Swing | null {
  const ok = fits.filter((f) => weightsOf(f, p));
  if (!ok.length) return null;
  let best: Swing | null = null;
  tickers.forEach((t, i) => {
    let s: Swing | null = null;
    for (const f of ok) {
      const v = (weightsOf(f, p) as Vec)[i];
      if (!s) s = { ticker: t, lo: v, hi: v, loWindow: f.named, hiWindow: f.named };
      else {
        if (v < s.lo) Object.assign(s, { lo: v, loWindow: f.named });
        if (v > s.hi) Object.assign(s, { hi: v, hiWindow: f.named });
      }
    }
    if (s && (!best || printedSwing(s.lo, s.hi) > printedSwing(best.lo, best.hi))) best = s;
  });
  return best;
}

const PORT_PHRASE: Readonly<Record<Port, string>> = { gmv: "minimum-variance (GMV)", tan: "tangency (maximum-Sharpe)" };

function swingClause(p: Port, s: Swing): string {
  const lo = format(s.lo, "pct1");
  const hi = format(s.hi, "pct1");
  if (lo === hi) return `the ${PORT_PHRASE[p]} portfolio holds ${s.ticker} at ${lo} in every window`;
  return `the ${PORT_PHRASE[p]} portfolio's weight in ${s.ticker} runs from ${lo} (${s.loWindow}) to ${hi} (${s.hiWindow})`;
}

/** The tab's headline: which weight the choice of window moves most, for each portfolio. */
export function headline(fits: WindowFit[], tickers: readonly string[]): string {
  const t = swing(fits, "tan", tickers);
  const g = swing(fits, "gmv", tickers);
  const n = fits.length;
  const lead = `Re-estimated over ${n} trailing windows`;
  if (t && g) return `${lead}, ${swingClause("tan", t)}, and ${swingClause("gmv", g)}.`;
  if (g) return `${lead}, ${swingClause("gmv", g)}; the tangency optimisation failed in every window.`;
  if (t) return `${lead}, ${swingClause("tan", t)}; the GMV optimisation failed in every window.`;
  return `Neither optimisation succeeded in any of the ${n} windows, so no weights are shown.`;
}

/** The weight chart's title: the selected portfolio's biggest swing, or that it failed. */
export function weightChartTitle(fits: WindowFit[], p: Port, tickers: readonly string[]): string {
  const s = swing(fits, p, tickers);
  if (!s) return `The ${PORT_NAME[p]} optimisation failed in every window`;
  const lo = format(s.lo, "pct1");
  const hi = format(s.hi, "pct1");
  if (lo === hi) return `${PORT_NAME[p]}: ${s.ticker}'s weight is ${lo} in every window`;
  return `${PORT_NAME[p]}: ${s.ticker}'s weight runs from ${lo} to ${hi} depending on the window`;
}

/** The Sharpe chart's title: where the custom mix scores best and worst. */
export function sharpeChartTitle(groups: Group[]): string {
  let lo: { v: number; w: string } | null = null;
  let hi: { v: number; w: string } | null = null;
  for (const g of groups) {
    const v = g.values[2];
    if (v === null) continue;
    if (!lo || v < lo.v) lo = { v, w: g.name };
    if (!hi || v > hi.v) hi = { v, w: g.name };
  }
  if (!lo || !hi) return "The custom portfolio's Sharpe ratio is undefined in every window";
  return `The custom portfolio's Sharpe ratio runs from ${format(lo.v, "num3")} (${lo.w}) to ${format(hi.v, "num3")} (${hi.w})`;
}

// ---- the custom portfolio (1948-1977) -------------------------------------------------------------

/** The raw custom weights in ticker order, 1/n where none was set (1966), normalised by the shared rule. */
export function customWeights(tickers: readonly string[], weights: CustomWeights, allowShort: boolean): Custom {
  const n = tickers.length;
  const raw = tickers.map((t) => {
    const v = weights[t];
    return typeof v === "number" && Number.isFinite(v) ? v : 1 / n;
  });
  return normalizeCustom(raw, allowShort);
}

/** Why the custom weights cannot be scored, in words. */
export const CUSTOM_REFUSAL: Readonly<Record<"zero" | "net-short" | "leverage", string>> = {
  zero: "Every custom weight is zero, so there is no portfolio to evaluate. Set at least one weight on the Custom Portfolio tab.",
  "net-short":
    "The custom weights add up to less than 5% net long, and dividing by a total that small would multiply every weight many times over. Adjust them on the Custom Portfolio tab.",
  leverage:
    "Normalised to sum to 100%, the custom weights would put an asset outside the -100% to 100% range the optimiser uses. Adjust them on the Custom Portfolio tab.",
};

/** The custom weights table: one row, a column per ticker in the entered order (1974-1977). */
export function customWeightTable(tickers: readonly string[], w: Vec): { columns: Column[]; rows: TableRow[] } {
  const row: TableRow = { portfolio: "Custom" };
  tickers.forEach((_t, i) => (row[`t${i}`] = w[i]));
  return {
    columns: [
      { key: "portfolio", label: "Portfolio", format: "text", first: true },
      ...tickers.map((t, i) => ({ key: `t${i}`, label: t, format: "pct2" as const })),
    ],
    rows: [row],
  };
}
