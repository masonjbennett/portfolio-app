// The scorecard: every portfolio on the page across, one figure per row, the benchmark last. It is pure,
// like ./model.ts: each cell is one field of the engine's scorecardRow (src/lib/stats.ts) or of its
// fragility() (src/lib/robust.ts), so the suite reaches every cell without a DOM and nothing here
// re-derives a statistic. The component (src/components/Scorecard.tsx) only lays this out.
//
// Conventions, printed in the caption because a figure without them cannot be compared with another
// report's:
// - Every row is computed from the window's daily returns, except the month rows and the capture ratios,
//   which compound those into calendar months and use complete months only (the first and last month of
//   the window may be part-months and are left out).
// - Tracking error is the standard deviation of the daily active returns times the square root of 252.
// - VaR and expected shortfall are historical, one day, at 95%, printed as positive losses.
// - Max drawdown, the longest drawdown and Calmar count from the amount invested, as the plates do.
// - The fragility rows are in-sample what-ifs on these prices. Equal weight and a typed mix hold the same
//   weights whatever the window or the draw, so their first three rows are zero, and the zero is printed.
import { format } from "../../format.ts";
import type { Vec } from "../../lib/num.ts";
import { portfolioReturns, type Custom } from "../../lib/portfolio.ts";
import { fragility, REDRAWS, type Construction, type Fragility, type Redraws } from "../../lib/robust.ts";
import { scorecardRow, type ScoreRow } from "../../lib/stats.ts";
import type { ScoreTipKey } from "../../content/tooltips.ts";
import type { Analysis, CellFormat, Column, FormatId, TableRow, TipKey } from "../../types.ts";
import { FITTED, tableSpan } from "../caption.ts";
import { fitWindows } from "../sensitivity/model.ts";
import { failedLabel, PORT_LABEL, weightsOf } from "./model.ts";

// ---- columns -----------------------------------------------------------------------------------------

/** The columns in order: the three solved or fixed portfolios, the typed mix, then the benchmark. */
export type ScoreColId = "ew" | "gmv" | "tangency" | "custom" | "bench";
export const SCORE_COL_IDS: readonly ScoreColId[] = ["ew", "gmv", "tangency", "custom", "bench"];

export interface ScoreColumn {
  id: ScoreColId;
  /** The head as the page and the downloads print it. */
  label: string;
  /** The sub-line under the head: "weights chosen on this window" for a solved GMV or Tangency. */
  sub: string | null;
  /** False for a failed solve or a refused custom mix: its cells are all dashes. */
  ok: boolean;
}

const CONSTRUCTION: Readonly<Record<Exclude<ScoreColId, "bench">, Construction>> = { ew: "ew", gmv: "gmv", tangency: "tan", custom: "custom" };

// ---- rows ---------------------------------------------------------------------------------------------

export type ScoreGroupId = "return" | "risk" | "adjusted" | "relative" | "tail" | "fragility";

export const SCORE_GROUPS: readonly { id: ScoreGroupId; label: string }[] = [
  { id: "return", label: "Return" },
  { id: "risk", label: "Risk" },
  { id: "adjusted", label: "Risk-adjusted" },
  { id: "relative", label: "Against the benchmark" },
  { id: "tail", label: "Tail" },
  { id: "fragility", label: "Fragility, in-sample" },
];

/** What one column hands a row: its scorecard figures and its fragility rows (null where there are none). */
export interface ColFigures {
  row: ScoreRow | null;
  frag: Fragility | null;
}

export interface ScoreMetric {
  id: string;
  group: ScoreGroupId;
  label: string;
  format: FormatId;
  /** In the short view: the bold rows shown before "Show every row". */
  short: boolean;
  tip: TipKey | ScoreTipKey;
  /** What the downloads say a number in this row is measured in. */
  unit: string;
  value: (f: ColFigures) => number | null;
  /** The Sharpe row's standard error, printed beside the figure. */
  se?: (f: ColFigures) => number | null;
}

const DEC = "decimal (0.01 = 1%)";
const RATIO = "ratio";
const r = (pick: (s: ScoreRow) => number) => (f: ColFigures) => (f.row ? pick(f.row) : null);

/** Every row, grouped and in order. The short view keeps the rows flagged `short`. */
export const SCORE_METRICS: readonly ScoreMetric[] = [
  { id: "annual", group: "return", label: "Annual return, compound", format: "pct2", short: true, tip: "annual_return", unit: DEC, value: r((s) => s.annualReturn) },
  { id: "mean", group: "return", label: "Mean daily return × 252", format: "pct2", short: false, tip: "return", unit: DEC, value: r((s) => s.mu) },
  { id: "cumulative", group: "return", label: "Cumulative return", format: "pct2", short: true, tip: "cumulative", unit: DEC, value: r((s) => s.cumulative) },
  { id: "best", group: "return", label: "Best month", format: "pct2", short: false, tip: "month_range", unit: DEC, value: r((s) => s.bestMonth) },
  { id: "worst", group: "return", label: "Worst month", format: "pct2", short: true, tip: "month_range", unit: DEC, value: r((s) => s.worstMonth) },
  { id: "positive", group: "return", label: "Positive months", format: "pct1", short: false, tip: "positive_months", unit: DEC, value: r((s) => s.positiveMonths) },
  { id: "vol", group: "risk", label: "Volatility", format: "pct2", short: true, tip: "volatility", unit: DEC, value: r((s) => s.volatility) },
  { id: "downside", group: "risk", label: "Downside deviation", format: "pct2", short: false, tip: "downside", unit: DEC, value: r((s) => s.downside) },
  { id: "mdd", group: "risk", label: "Max drawdown", format: "pct2", short: true, tip: "max_dd", unit: DEC, value: r((s) => s.maxDrawdown) },
  { id: "longest", group: "risk", label: "Longest drawdown, trading days", format: "int", short: true, tip: "longest_dd", unit: "trading days", value: r((s) => s.longest.trading) },
  { id: "longestCal", group: "risk", label: "Longest drawdown, calendar days", format: "int", short: false, tip: "longest_dd", unit: "calendar days", value: r((s) => s.longest.calendar) },
  { id: "sharpe", group: "adjusted", label: "Sharpe", format: "num3", short: true, tip: "sharpe_se", unit: RATIO, value: r((s) => s.sharpe), se: r((s) => s.sharpeSE) },
  { id: "sortino", group: "adjusted", label: "Sortino", format: "num3", short: true, tip: "sortino", unit: RATIO, value: r((s) => s.sortino) },
  { id: "calmar", group: "adjusted", label: "Calmar", format: "num2", short: false, tip: "calmar", unit: RATIO, value: r((s) => s.calmar) },
  { id: "beta", group: "relative", label: "Beta", format: "num2", short: true, tip: "beta", unit: RATIO, value: r((s) => s.beta) },
  { id: "alpha", group: "relative", label: "Alpha, annual", format: "pct2", short: false, tip: "alpha", unit: DEC, value: r((s) => s.alphaAnn) },
  { id: "corr", group: "relative", label: "Correlation", format: "num2", short: false, tip: "correlation", unit: RATIO, value: r((s) => s.correlation) },
  { id: "r2", group: "relative", label: "R²", format: "num2", short: false, tip: "r_squared", unit: RATIO, value: r((s) => s.r2) },
  { id: "te", group: "relative", label: "Tracking error", format: "pct2", short: true, tip: "tracking_error", unit: DEC, value: r((s) => s.trackingError) },
  { id: "ir", group: "relative", label: "Information ratio", format: "num2", short: false, tip: "information_ratio", unit: RATIO, value: r((s) => s.informationRatio) },
  { id: "up", group: "relative", label: "Up capture", format: "pct1", short: false, tip: "capture", unit: "ratio (1 = 100%)", value: r((s) => s.upCapture) },
  { id: "down", group: "relative", label: "Down capture", format: "pct1", short: true, tip: "capture", unit: "ratio (1 = 100%)", value: r((s) => s.downCapture) },
  { id: "var", group: "tail", label: "VaR, 95%, one day", format: "pct2", short: true, tip: "var", unit: "decimal loss (0.01 = 1%)", value: r((s) => s.var95) },
  { id: "es", group: "tail", label: "Expected shortfall, 95%, one day", format: "pct2", short: false, tip: "es", unit: "decimal loss (0.01 = 1%)", value: r((s) => s.es95) },
  {
    id: "lookback",
    group: "fragility",
    label: "Widest weight range across lookback windows",
    format: "pct1",
    short: true,
    tip: "frag_lookback",
    unit: "weight points, decimal",
    value: (f) => (f.frag?.lookback ? f.frag.lookback.spread : null),
  },
  {
    id: "cut",
    group: "fragility",
    label: "Weight the largest holding loses when its return is cut by 1 SE",
    format: "pct1",
    short: false,
    tip: "frag_cut",
    unit: "weight points, decimal",
    value: (f) => (f.frag?.cut ? f.frag.cut.drop : null),
  },
  {
    id: "draws",
    group: "fragility",
    label: `Largest holding's weight, 10th to 90th percentile over ${REDRAWS} redraws`,
    format: "pct1",
    short: false,
    tip: "frag_draws",
    unit: "weight points, decimal",
    value: (f) => (f.frag?.draws ? f.frag.draws.width : null),
  },
  { id: "params", group: "fragility", label: "Parameters estimated", format: "int", short: false, tip: "frag_params", unit: "count", value: (f) => (f.frag ? f.frag.params : null) },
];

// ---- the model ----------------------------------------------------------------------------------------

export interface ScoreCell {
  value: number | null;
  /** The Sharpe row's standard error; undefined on every other row. */
  se?: number | null;
}

export interface ScoreLine {
  metric: ScoreMetric;
  /** One cell per column, in column order. */
  cells: ScoreCell[];
}

export interface ScoreModel {
  columns: ScoreColumn[];
  lines: ScoreLine[];
  /** The caption: title, window and frequency, conventions. */
  title: string;
  span: string;
  conventions: string;
  /** The daily return rows every figure is estimated from (the fragility group names it). */
  days: number;
  /** The redraws the draw row used: null while they are still being solved, or when there are none. */
  seed: number | null;
}

/** The redraws the fragility group reads: ready (possibly none, when the covariance has no factor), or pending. */
export type RedrawState = { status: "pending" } | { status: "ready"; value: Redraws | null } | { status: "error"; message: string };

/** The weights behind a column, or null (a failed solve, a refused mix, or the benchmark). */
function columnWeights(a: Analysis, c: Custom, id: ScoreColId): Vec | null {
  if (id === "bench") return null;
  if (id === "custom") return c.ok ? c.w : null;
  return weightsOf(a, id);
}

/** The columns' heads: a failed solve and a refused mix keep their column, labelled. */
export function scoreColumns(a: Analysis, c: Custom): ScoreColumn[] {
  return SCORE_COL_IDS.map((id): ScoreColumn => {
    if (id === "bench") return { id, label: a.benchLabel, sub: null, ok: true };
    const w = columnWeights(a, c, id);
    if (id === "custom") return { id, label: w ? "Custom" : "Custom (not shown)", sub: null, ok: w !== null };
    const fitted = id === "gmv" || id === "tangency";
    return { id, label: w ? PORT_LABEL[id] : failedLabel(id), sub: w && fitted ? FITTED : null, ok: w !== null };
  });
}

/** The per-window weights of a solved portfolio, for the lookback row; [] when the window is too short to split. */
function lookbacks(fits: ReturnType<typeof fitWindows>, id: "gmv" | "tangency"): (Vec | null)[] {
  if (fits.status !== "ready") return [];
  return fits.value.map((f) => (id === "gmv" ? (f.gmv?.w ?? null) : (f.tan?.w ?? null)));
}

/** Every column's figures: scorecardRow over its daily returns, fragility() over its construction. */
export function columnFigures(a: Analysis, c: Custom, redraws: Redraws | null): ColFigures[] {
  const start = a.prices.dates[0] ?? null;
  const T = a.dates.length;
  // The lookback windows are solved once and read by both optimised columns.
  const fits = fitWindows(a);
  return SCORE_COL_IDS.map((id): ColFigures => {
    if (id === "bench") return { row: scorecardRow(a.bench, a.bench, a.dates, start, a.rf), frag: null };
    const w = columnWeights(a, c, id);
    if (!w) return { row: null, frag: null };
    const row = scorecardRow(portfolioReturns(a.returns, w), a.bench, a.dates, start, a.rf);
    const kind = CONSTRUCTION[id];
    const frag = fragility(kind, {
      m: a.m,
      S: a.S,
      rf: a.rf,
      allowShort: a.allowShort,
      T,
      lookbacks: id === "gmv" || id === "tangency" ? lookbacks(fits, id) : [],
      redraws,
    });
    return { row, frag };
  });
}

/** The caption's third line: the conventions every row follows. */
export function scoreConventions(rf: number): string {
  return (
    `Annual figures at the ${format(rf, "pct2")} risk-free rate. Month rows and capture ratios compound the daily returns into ` +
    `complete calendar months. Tracking error is the standard deviation of daily active returns × √252. VaR and expected ` +
    `shortfall are historical, one day, at 95%. Drawdowns count from the amount invested. Sharpe prints ± one standard error ` +
    `(Lo, adjusted for skew and fat tails). Every figure is in-sample.`
  );
}

/**
 * The scorecard for an analysis, a custom mix and the redraws on hand. `redraws` pending or failed
 * leaves the draw row a dash for the two solved portfolios; equal weight and a typed mix still read zero.
 */
export function scorecard(a: Analysis, c: Custom, redraws: RedrawState): ScoreModel {
  const value = redraws.status === "ready" ? redraws.value : null;
  const columns = scoreColumns(a, c);
  const figs = columnFigures(a, c, value);
  const lines = SCORE_METRICS.map(
    (metric): ScoreLine => ({
      metric,
      cells: figs.map((f) => (metric.se ? { value: metric.value(f), se: metric.se(f) } : { value: metric.value(f) })),
    }),
  );
  return {
    columns,
    lines,
    title: "Scorecard",
    span: tableSpan(a.dates[0], a.asOf),
    conventions: scoreConventions(a.rf),
    days: a.dates.length,
    seed: value ? value.seed : null,
  };
}

/** The rows a view shows: the short view keeps the bold rows, the full view every row. */
export function visibleLines(m: ScoreModel, full: boolean): ScoreLine[] {
  return full ? m.lines : m.lines.filter((l) => l.metric.short);
}

/** A cell as the page prints it: the figure, and on the Sharpe row "± SE" beside it. */
export function cellText(cell: ScoreCell, fmt: FormatId): string {
  const main = format(cell.value, fmt);
  if (cell.se === undefined || cell.value === null || !Number.isFinite(cell.value)) return main;
  return cell.se !== null && Number.isFinite(cell.se) ? `${main} ± ${format(cell.se, fmt)}` : main;
}

// ---- the downloads ------------------------------------------------------------------------------------

export interface ScoreSheet {
  columns: Column[];
  rows: TableRow[];
  /** The Excel number format of each row's figures (the page's own), one per row. */
  rowFormats: CellFormat[];
}

/**
 * The scorecard as a sheet: one row per figure, raw numbers, a unit column saying what each number is
 * measured in, and the Sharpe standard error as its own row so a spreadsheet can use it. Every row
 * the page can show is in the file, whichever view is on screen.
 */
export function scoreSheet(m: ScoreModel): ScoreSheet {
  const columns: Column[] = [
    { key: "group", label: "Group", format: "text", first: true },
    { key: "metric", label: "Figure", format: "text" },
    { key: "unit", label: "Unit", format: "text" },
    ...m.columns.map((c): Column => ({ key: c.id, label: c.label, format: "num4" })),
  ];
  const rows: TableRow[] = [];
  const rowFormats: CellFormat[] = [];
  const group = (id: ScoreGroupId) => SCORE_GROUPS.find((g) => g.id === id)?.label ?? id;
  for (const l of m.lines) {
    const row: TableRow = { group: group(l.metric.group), metric: l.metric.label, unit: l.metric.unit };
    m.columns.forEach((c, k) => (row[c.id] = finiteOrNull(l.cells[k].value)));
    rows.push(row);
    rowFormats.push(l.metric.format);
    if (l.metric.se) {
      const se: TableRow = { group: group(l.metric.group), metric: `${l.metric.label} standard error`, unit: l.metric.unit };
      m.columns.forEach((c, k) => (se[c.id] = finiteOrNull(l.cells[k].se ?? null)));
      rows.push(se);
      rowFormats.push(l.metric.format);
    }
  }
  return { columns, rows, rowFormats };
}

const finiteOrNull = (x: number | null) => (x !== null && Number.isFinite(x) ? x : null);

/** A note on the fragility group, or null: why the draw row is still a dash for the solved portfolios. */
export function drawRowNote(redraws: RedrawState): string | null {
  if (redraws.status === "pending") return `The redraw row fills in once the ${REDRAWS} redraws are solved.`;
  if (redraws.status === "error") return `The redraw row is empty: the redraws failed. ${redraws.message}`;
  if (redraws.value === null) return "The redraw row is empty: the covariance matrix has no Cholesky factor, so no means could be drawn.";
  return null;
}
