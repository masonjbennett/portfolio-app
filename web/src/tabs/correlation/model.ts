// The Correlation tab's arithmetic and copy, pure, so the suite reaches every number and sentence
// without a DOM. The tab is the app's tab 3 (portfolio_app.py 1421-1462): a pairwise correlation
// heatmap (1425-1436), a rolling correlation of two chosen assets (1441-1458) and the daily covariance
// matrix (1461-1462).
//
// Every figure comes from the engine: corrMatrix is pandas' DataFrame.corr() step for step and
// rollingCorr is Series.rolling(w).corr(); nothing here re-derives a statistic. What lives here is
// which pair is highest and lowest, what each chart's title says, the table rows, and the heatmap's
// colour scale and geometry. The sentence under the heatmap (spread) is the one place a volatility is
// worked out here, and it uses the engine's own pieces: portfolioPerformance for the equal-weight mix and
// the covariance matrix's diagonal, annualised by √252 as the engine annualises every volatility.
import { format } from "../../format.ts";
import { corrMatrix } from "../../lib/num.ts";
import { portfolioPerformance } from "../../lib/portfolio.ts";
import { rollingCorr, TRADING_DAYS } from "../../lib/stats.ts";
import { tokens } from "../../styles/tokens.ts";
import type { Analysis, Column, LoadState, TableRow } from "../../types.ts";

// ---- the correlation matrix ------------------------------------------------------------------------

/** One pair of distinct assets: indices into the ticker list, i < j, and its correlation. */
export interface Pair {
  a: string;
  b: string;
  i: number;
  j: number;
  r: number;
}

export interface CorrView {
  /** The portfolio's assets in the visitor's order; the benchmark is not a row (stock_returns, 1426). */
  tickers: string[];
  /** Pearson correlation of daily returns; NaN where it is undefined (an asset whose returns never varied). */
  matrix: number[][];
  /** Every pair i < j whose correlation is defined, in row order. */
  pairs: Pair[];
  /** The most and least correlated pairs; the first in row order wins a tie. null when no pair is defined. */
  high: Pair | null;
  low: Pair | null;
  /** How many defined pairs are above and below zero. */
  positive: number;
  negative: number;
  /** How many pairs are undefined. */
  undefinedPairs: number;
  /** The return rows the matrix is computed over: how many, the first and the last date. */
  days: number;
  first: string;
  last: string;
}

export function corrView(a: Analysis): CorrView {
  const matrix = corrMatrix(a.returns);
  const n = a.tickers.length;
  const pairs: Pair[] = [];
  let undefinedPairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = matrix[i][j];
      if (Number.isFinite(r)) pairs.push({ a: a.tickers[i], b: a.tickers[j], i, j, r });
      else undefinedPairs += 1;
    }
  }
  let high: Pair | null = null;
  let low: Pair | null = null;
  for (const p of pairs) {
    if (!high || p.r > high.r) high = p;
    if (!low || p.r < low.r) low = p;
  }
  return {
    tickers: a.tickers,
    matrix,
    pairs,
    high,
    low,
    positive: pairs.filter((p) => p.r > 0).length,
    negative: pairs.filter((p) => p.r < 0).length,
    undefinedPairs,
    days: a.dates.length,
    first: a.dates[0] ?? "",
    last: a.dates[a.dates.length - 1] ?? "",
  };
}

// Correlations print as the heatmap prints them: two decimals (text_auto=".2f", 1428).
const r2 = (x: number) => format(x, "num2");

/** The tab's headline: the finding, literally. */
export function headline(v: CorrView): string {
  const { high, low } = v;
  if (!high || !low) return "No pair of assets has a defined correlation over this period.";
  if (high === low) return `${high.a} and ${high.b} are the only pair with a defined correlation (${r2(high.r)}).`;
  return `${high.a} and ${high.b} were the most correlated pair (${r2(high.r)}), ${low.a} and ${low.b} the least (${r2(low.r)}).`;
}

/** The heatmap's state: drawn only when at least one pair is defined. */
export function heatState(v: CorrView): LoadState<CorrView> {
  if (!v.pairs.length) {
    return { status: "empty", reason: "No pair has a defined correlation: at least one asset's returns never varied over this period." };
  }
  return { status: "ready", value: v };
}

/** The heatmap's title: how many pairs moved against each other on balance. */
export function heatTitle(v: CorrView): string {
  const n = v.pairs.length;
  if (!n) return "No pair has a defined correlation";
  if (v.positive === n) return `All ${n} pairs were positively correlated`;
  if (v.negative === 0) return "No pair was negatively correlated";
  if (v.negative === n) return `All ${n} pairs were negatively correlated`;
  return `${v.negative} of ${n} pairs ${v.negative === 1 ? "was" : "were"} negatively correlated`;
}

/** What the heatmap plots, over which period. */
export function heatSubtitle(v: CorrView): string {
  const undef = v.undefinedPairs
    ? ` ${v.undefinedPairs} ${v.undefinedPairs === 1 ? "pair has" : "pairs have"} no defined correlation and ${v.undefinedPairs === 1 ? "shows" : "show"} a dash.`
    : "";
  return `Pearson correlation of daily returns, ${format(v.first, "date")} to ${format(v.last, "date")} (${format(v.days, "int")} daily returns).${undef}`;
}

// ---- what holding them together did to volatility -------------------------------------------------

/** Equal weights against the assets one by one, over the window on screen (in-sample). */
export interface Spread {
  /** How many assets. */
  n: number;
  /** The equal-weight portfolio's annual volatility, sqrt(w'Sw) at w = 1/n: portfolioPerformance's own. */
  together: number;
  /** The same weights over each asset's own annual volatility, sum of w_i sigma_i: the average of the n. */
  apart: number;
  /** The mean of the matrix's off-diagonal entries: the heatmap's average cell, the diagonal left out. */
  meanCorr: number;
}

/**
 * What holding the assets together in equal weights did to volatility, from the covariance the optimiser
 * uses and the correlation the heatmap draws. Each volatility is annualised as the engine annualises one,
 * the daily figure times √252: an asset's from its own daily variance on S's diagonal, the portfolio's
 * from the quadratic form. Null with fewer than two assets, a matrix that is missing or the wrong shape,
 * or any figure that is not finite (an undefined pair makes the mean undefined, so nothing is said).
 */
export function spread(a: Analysis, v: CorrView): Spread | null {
  const n = a.tickers.length;
  const { S, ew } = a;
  const square = (M: unknown): M is number[][] => Array.isArray(M) && M.length === n && M.every((row) => Array.isArray(row) && row.length === n);
  if (n < 2 || !square(S) || !square(v.matrix) || !Array.isArray(ew) || ew.length !== n || !Array.isArray(a.m) || a.m.length !== n) return null;
  const together = portfolioPerformance(ew, a.m, S, a.rf).sigma;
  let apart = 0;
  for (let i = 0; i < n; i++) apart += ew[i] * Math.sqrt(S[i][i] * TRADING_DAYS);
  let sumCorr = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) sumCorr += v.matrix[i][j];
  const meanCorr = sumCorr / (n * (n - 1));
  if (![together, apart, meanCorr].every(Number.isFinite)) return null;
  return { n, together, apart, meanCorr };
}

// The count in words, as a sentence says it; the ticker limit is ten.
const COUNT = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** The one sentence under the heatmap, the same at every level; null where spread() says nothing. */
export function spreadSentence(s: Spread | null): string | null {
  if (!s) return null;
  const many = COUNT[s.n] ?? format(s.n, "int");
  return (
    `Held in equal weights over this window, the ${many} assets had a volatility of ${format(s.together, "pct1")} a year ` +
    `together, against an average of ${format(s.apart, "pct1")} each on their own, and the average correlation between ` +
    `any two of them was ${r2(s.meanCorr)}.`
  );
}

/** What the heatmap's readout line says for a cell, or the hint when no cell is chosen. */
export function readout(v: CorrView, at: readonly [number, number] | null): string {
  if (!at) return "Point at or tap a cell to read its pair.";
  const [i, j] = at;
  const a = v.tickers[i];
  const b = v.tickers[j];
  const r = r2(v.matrix[i]?.[j] ?? NaN);
  return i === j ? `${a} with itself: ${r}` : `${a} and ${b}: ${r}`;
}

// ---- tables ------------------------------------------------------------------------------------

// The label column's field. Tickers are upper-case symbols, so a lower-case key cannot collide.
const LABEL = "asset";

/** A square matrix's columns: the asset label, then one column per asset in the given format. */
export function matrixColumns(tickers: string[], fmt: "num3" | "num6"): Column[] {
  return [{ key: LABEL, label: "Asset", format: "text", first: true }, ...tickers.map((t) => ({ key: `c:${t}`, label: t, format: fmt }))];
}

/** A square matrix's rows, raw numbers; NaN is kept and printed as a dash by format(). */
export function matrixRows(tickers: string[], M: number[][]): TableRow[] {
  return tickers.map((t, i) => {
    const row: TableRow = { [LABEL]: t };
    tickers.forEach((u, j) => (row[`c:${u}`] = M[i][j]));
    return row;
  });
}

// The covariance matrix is DAILY and ddof 1, as the app shows it (cov_matrix, 1164, printed {:.6f} at
// 1462): num6, because num4 would print most daily covariances as 0.0000 or 0.0001.
export const COV_FORMAT = "num6";
// The correlation table sits under the heatmap, one decimal finer than its cells.
export const CORR_FORMAT = "num3";

// ---- the rolling correlation -------------------------------------------------------------------

/** The window choices, in trading days: the select_slider's options (1448). */
export const WINDOWS = [30, 60, 90, 120] as const;
export type RollWindow = (typeof WINDOWS)[number];
/** The slider's value=60 (1448). */
export const DEFAULT_WINDOW: RollWindow = 60;

/** The default pair: the first asset and the second, as the two selectboxes open (1444, 1446). */
export function defaultPair(tickers: string[]): [string, string] {
  return [tickers[0], tickers[Math.min(1, tickers.length - 1)]];
}

export interface RollPoint {
  date: string;
  /** null where the window's correlation is undefined, so the line breaks there instead of joining. */
  r: number | null;
}

export interface RollMark {
  date: string;
  r: number;
  text: string;
  side: "top" | "bottom" | "right";
}

export interface RollView {
  a: string;
  b: string;
  w: number;
  /** rolling(w).corr(), aligned with the analysis's dates, NaN until a full window. */
  series: number[];
  /** What is plotted: one point per date from the first full window on. */
  points: RollPoint[];
  /** The lowest, the highest and the last defined value, each with its date. */
  low: { date: string; r: number };
  high: { date: string; r: number };
  latest: { date: string; r: number };
  /** The labels drawn on the line itself; a date is labelled once. */
  marks: RollMark[];
}

export function rollView(an: Analysis, a: string, b: string, w: number): LoadState<RollView> {
  // The app shows st.info("Select two different stocks.") (1458); the assets here are not all stocks.
  if (a === b) return { status: "empty", reason: "Select two different assets." };
  const ia = an.tickers.indexOf(a);
  const ib = an.tickers.indexOf(b);
  if (ia < 0 || ib < 0) return { status: "empty", reason: "Select two assets from the portfolio." };
  const series = rollingCorr(an.returns[ia], an.returns[ib], w);
  const points: RollPoint[] = [];
  for (let k = w - 1; k < series.length; k++) {
    points.push({ date: an.dates[k], r: Number.isFinite(series[k]) ? series[k] : null });
  }
  const defined = points.filter((p): p is { date: string; r: number } => p.r !== null);
  if (!defined.length) {
    const reason =
      an.dates.length < w
        ? `There are ${format(an.dates.length, "int")} daily returns, fewer than one ${w}-day window.`
        : `The ${w}-day correlation is not defined in any window: one of the two assets' returns never varied.`;
    return { status: "empty", reason };
  }
  let low = defined[0];
  let high = defined[0];
  for (const p of defined) {
    if (p.r < low.r) low = p;
    if (p.r > high.r) high = p;
  }
  const latest = defined[defined.length - 1];
  const marks: RollMark[] = [];
  const add = (p: { date: string; r: number }, text: string, side: RollMark["side"]) => {
    if (!marks.some((m) => m.date === p.date)) marks.push({ date: p.date, r: p.r, text, side });
  };
  add(high, `high ${r2(high.r)}`, "top");
  add(low, `low ${r2(low.r)}`, "bottom");
  add(latest, `latest ${r2(latest.r)}`, "right");
  return { status: "ready", value: { a, b, w, series, points, low, high, latest, marks } };
}

/** The rolling chart's title: the range the correlation moved in, and where it ended. */
export function rollTitle(v: RollView): string {
  return `The ${v.w}-day correlation of ${v.a} and ${v.b} ranged from ${r2(v.low.r)} to ${r2(v.high.r)}, and was ${r2(v.latest.r)} on ${format(v.latest.date, "date")}`;
}

/** What is plotted: the app's own chart title (1454), then the window and period in words. */
export function rollSubtitle(v: RollView): string {
  const first = v.points[0]?.date ?? "";
  return `${v.w}-Day Rolling Correlation: ${v.a} vs ${v.b}. Each point is the correlation of the previous ${v.w} daily returns, ${format(first, "date")} to ${format(v.latest.date, "date")}.`;
}

// ---- the heatmap's colour scale and geometry -----------------------------------------------------

// The app's scale runs blue at -1, white at 0, red at +1 (1429, zmin -1, zmax 1). Here: navy, paper,
// claret, all tokens. The tint stops at MAX_TINT of the full colour so that ink figures stay legible on
// every cell (contrast at least 4.5:1 at |r| = 1; the suite measures it across the whole scale), and
// every cell's figure is printed in ink.
export const MAX_TINT = 0.55;

type RGB = [number, number, number];

function hex(h: string): RGB {
  const s = h.replace("#", "");
  return [0, 2, 4].map((k) => parseInt(s.slice(k, k + 2), 16)) as RGB;
}

const PAPER = hex(tokens.color.paper);
const NEG = hex(tokens.color.navy);
const POS = hex(tokens.color.claret);

/** The fill for a correlation: paper at 0, towards navy below and claret above; hairline2 when undefined. */
export function tint(r: number): string {
  if (!Number.isFinite(r)) return tokens.color.hairline2;
  const t = MAX_TINT * Math.min(1, Math.abs(r));
  const to = r < 0 ? NEG : POS;
  const c = PAPER.map((p, k) => Math.round(p + (to[k] - p) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Cell size in SVG units, which are pixels at the grid's smallest drawn size; figures are FONT units high. */
export const CELL = 48;
export const FONT = 12;
/**
 * In a box too narrow for CELL, the cell shrinks to fit it, down to CELL_MIN, and its figure shrinks with
 * it. No figure is printed under FIGURE_FONT_MIN: where it would be, none is, and a tap, a pointer or the
 * arrow keys read the cell. Five-character figures ("-0.24") need a cell of 34 for that, four ("0.86") 28.
 */
export const CELL_MIN = 26;
export const FIGURE_FONT_MIN = 10;
// JetBrains Mono's advance is 0.6 em.
const CHAR = 0.6 * FONT;

export interface HeatLayout {
  /** Left gutter for the row labels, top band for the column labels. */
  left: number;
  top: number;
  /** Column labels are turned 45 degrees when a symbol is too wide for its cell. */
  turned: boolean;
  width: number;
  height: number;
  /** The cell's side, CELL unless the box is narrower (see CELL_MIN). */
  cell: number;
  /** Whether each cell prints its figure (at FIGURE_FONT_MIN or more), and at what size. */
  figures: boolean;
  font: number;
}

/**
 * The grid's layout. With no `box` (the width the grid may take, in px; unknown before it is measured)
 * or a box wide enough, every cell is CELL. In a narrower box the cell shrinks to fit it, never below
 * CELL_MIN (the grid then scrolls inside its own box), and a figure shrinks with its cell so that the
 * widest one, `figureChars` characters, stays inside it; a figure that would be under FIGURE_FONT_MIN
 * is not printed.
 */
export function heatLayout(tickers: string[], box?: number, figureChars = 5): HeatLayout {
  const longest = Math.max(1, ...tickers.map((t) => t.length));
  const left = Math.ceil(longest * CHAR) + 12;
  const n = tickers.length;
  const measured = box !== undefined && box > 0 && n > 0;
  let cell = Math.max(CELL_MIN, Math.min(CELL, measured ? Math.floor((box - left) / n) : CELL));
  let turned = longest * CHAR > cell - 6;
  if (turned && measured) {
    // A turned label runs up and right from its column's centre, so the last one reaches past the grid by
    // turnReach less half a cell: room the box must hold too (and 1px for rounding that reach up), so
    // the cell is fitted again with that room taken off.
    cell = Math.max(CELL_MIN, Math.min(cell, Math.floor((box - left - turnReach(longest) - 1) / (n - 0.5))));
    turned = longest * CHAR > cell - 6;
  }
  const reach = turned ? Math.max(0, Math.ceil(turnReach(longest) - cell / 2)) : 0;
  const top = turned ? Math.ceil(longest * CHAR * Math.SQRT1_2) + 14 : FONT + 12;
  // JetBrains Mono's advance is 0.6 em: the widest figure keeps 2px clear each side of its cell.
  const font = Math.min(FONT, Math.floor(((cell - 4) / (Math.max(1, figureChars) * 0.6)) * 10) / 10);
  const figures = font >= FIGURE_FONT_MIN;
  return { left, top, turned, width: left + n * cell + reach, height: top + n * cell, cell, figures, font };
}

/**
 * How far right of its column's centre a label turned 45 degrees reaches: its run of `chars` characters
 * at the labels' size (FONT - 1, 0.6 em an advance) and the depth of its glyphs, each across by √½.
 */
export function turnReach(chars: number): number {
  return (chars * (FONT - 1) * 0.6 + (FONT - 1) * 0.75) * Math.SQRT1_2;
}

/** The cell an arrow key moves the reading to from `at` (the first cell when nothing is read yet), or null for any other key. */
export function stepCell(at: readonly [number, number] | null, key: string, n: number): [number, number] | null {
  const move: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const d = move[key];
  if (!d || n < 1) return null;
  if (!at) return [0, 0];
  const clamp = (k: number) => Math.max(0, Math.min(n - 1, k));
  return [clamp(at[0] + d[0]), clamp(at[1] + d[1])];
}

/**
 * How wide the grid may draw: never narrower than its own units (below that a figure would draw smaller
 * than its size in units, which FIGURE_FONT_MIN holds, so the grid scrolls sideways instead) and at most
 * 1.5 times them.
 */
export const MAX_SCALE = 1.5;
