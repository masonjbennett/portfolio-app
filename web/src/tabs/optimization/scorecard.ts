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
//
// The reader may add up to four more constructions (src/lib/constructions.ts), each a column of its own
// between Custom and the benchmark, always in the same order. They are in-sample like the tangency column,
// set side by side for comparison; nothing here orders, marks or counts them against one another.
import { format } from "../../format.ts";
import { ADDED_IDS, CAP, isAddedId, YEAR_ROWS, type AddedId } from "../../lib/constructions.ts";
import type { Vec } from "../../lib/num.ts";
import { portfolioReturns, type Custom } from "../../lib/portfolio.ts";
import { fragility, REDRAWS, type Construction, type Fragility, type Redraws, type Strip } from "../../lib/robust.ts";
import { scorecardRow, TRADING_DAYS, type ScoreRow } from "../../lib/stats.ts";
import type { ScoreTipKey } from "../../content/tooltips.ts";
import type { Analysis, CellFormat, Column, FormatId, TableRow, TipKey } from "../../types.ts";
import { FITTED, tableSpan } from "../caption.ts";
import { isEqualWeight } from "../custom/model.ts";
import { fitWindows } from "../sensitivity/model.ts";
import {
  ADDED_LABEL,
  addedFit,
  addedLookbacks,
  addedMissingLabel,
  addedMissingWords,
  addedSub,
  failedLabel,
  PORT_LABEL,
  shownAdded,
  weightsOf,
} from "./model.ts";

// ---- columns -----------------------------------------------------------------------------------------

type BaseColId = "ew" | "gmv" | "tangency" | "custom";

/**
 * The columns: the three solved or fixed portfolios, the typed mix, any added constructions, then the
 * benchmark. SCORE_COL_IDS is the default table, the one every page opens with.
 */
export type DefaultColId = BaseColId | "bench";
export type ScoreColId = DefaultColId | AddedId;
export const SCORE_COL_IDS: readonly DefaultColId[] = ["ew", "gmv", "tangency", "custom", "bench"];

/** The columns in order with added constructions: after Custom and before the benchmark, in ADDED_IDS order whatever order they come in. */
export function scoreColIds(added: readonly AddedId[] = []): ScoreColId[] {
  return ["ew", "gmv", "tangency", "custom", ...ADDED_IDS.filter((id) => added.includes(id)), "bench"];
}

/** The explanation behind each added head's info mark. */
export const ADDED_TIP: Readonly<Record<AddedId, ScoreTipKey>> = {
  "tan.1y": "col_last_year",
  "tan.bs": "col_shrunk",
  "tan.cap": "col_capped",
  rp: "col_parity",
};

export interface ScoreColumn<Id extends ScoreColId = ScoreColId> {
  id: Id;
  /** The head as the page and the downloads print it. */
  label: string;
  /**
   * The sub-line under the head: "weights chosen on this window" for every column solved on this window (GMV,
   * Tangency and the added constructions, addedSub() adding "long only" where the switch allows shorting),
   * LAST_YEAR for the last-year one, CUSTOM_EQUAL for a typed mix that is equal weight, and otherwise null.
   */
  sub: string | null;
  /** False for a failed solve or a refused custom mix: its cells are all dashes. */
  ok: boolean;
  /**
   * The weights behind the column's figures, in ticker order: the page's own solution or typed mix, so the
   * formula workbook (src/workbook.ts) can enter them as they are. Null for the benchmark and for a column
   * that is not ok.
   */
  weights: Vec | null;
}

const CONSTRUCTION: Readonly<Record<BaseColId, Construction>> = { ew: "ew", gmv: "gmv", tangency: "tan", custom: "custom" };

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
    label: `Spread of the largest holding's weight, 10th to 90th percentile, over ${REDRAWS} redraws`,
    format: "pct1",
    short: false,
    tip: "frag_draws",
    unit: "weight points, decimal (p90 − p10)",
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
  /** What the cut row's re-solve did to each solved portfolio, in words, or null when none was cut. */
  cut: string | null;
  /** Why the draw row is still a dash for an added column (its redraws pending or failed), or null. */
  addedDraws: string | null;
  /** One sentence per shown added column that found no weights, saying why its cells are dashes. */
  addedMissing: string[];
}

/** The redraws the fragility group reads: ready (possibly none, when the covariance has no factor), or pending. */
export type RedrawState = { status: "pending" } | { status: "ready"; value: Redraws | null } | { status: "error"; message: string };

/** One added construction's redraws (addedStrip on its own window), as a state: solved after paint, as the others are. */
export type StripState = { status: "pending" } | { status: "ready"; value: Strip | null } | { status: "error"; message: string };

/** The added columns' redraws on hand, by construction; one that is missing counts as pending. */
export type AddedDraws = Partial<Readonly<Record<AddedId, StripState>>>;

const NO_DRAWS: AddedDraws = {};

/** The weights behind a column, or null (a failed solve, a refused mix, or the benchmark). */
function columnWeights(a: Analysis, c: Custom, id: ScoreColId): Vec | null {
  if (id === "bench") return null;
  if (id === "custom") return c.ok ? c.w : null;
  if (isAddedId(id)) return addedFit(a, id).sol?.w ?? null;
  return weightsOf(a, id);
}

/** The sub-line under Custom's head when its weights are all 1/n: why its column repeats Equal-Weight's. */
export const CUSTOM_EQUAL = "equal weights, so it matches Equal-Weight";

/**
 * The columns' heads: a failed solve and a refused mix keep their column, labelled. `added` are the
 * constructions to show (shownAdded() has already dropped any this basket cannot have).
 */
export function scoreColumns(a: Analysis, c: Custom): ScoreColumn<DefaultColId>[];
export function scoreColumns(a: Analysis, c: Custom, added: readonly AddedId[]): ScoreColumn[];
export function scoreColumns(a: Analysis, c: Custom, added: readonly AddedId[] = []): ScoreColumn[] {
  return scoreColIds(added).map((id): ScoreColumn => {
    if (id === "bench") return { id, label: a.benchLabel, sub: null, ok: true, weights: null };
    const w = columnWeights(a, c, id);
    if (isAddedId(id)) return { id, label: w ? ADDED_LABEL[id] : addedMissingLabel(id), sub: w ? addedSub(id, a.allowShort) : null, ok: w !== null, weights: w };
    // Untyped tickers default to 1/n, so on a first visit the typed mix IS equal weight; the head says so.
    if (id === "custom") return { id, label: w ? "Custom" : "Custom (not shown)", sub: w && isEqualWeight(w) ? CUSTOM_EQUAL : null, ok: w !== null, weights: w };
    const fitted = id === "gmv" || id === "tangency";
    return { id, label: w ? PORT_LABEL[id] : failedLabel(id), sub: w && fitted ? FITTED : null, ok: w !== null, weights: w };
  });
}

/** The per-window weights of a solved portfolio, for the lookback row; [] when the window is too short to split. */
function lookbacks(fits: ReturnType<typeof fitWindows>, id: "gmv" | "tangency"): (Vec | null)[] {
  if (fits.status !== "ready") return [];
  return fits.value.map((f) => (id === "gmv" ? (f.gmv?.w ?? null) : (f.tan?.w ?? null)));
}

// An added column's fragility rows, kept per analysis, construction and strip. The scorecard is computed
// again each time one construction's redraws land, and the other columns' inputs have not moved, so their
// rows are read back here instead of re-solving the construction and its cut. A few strips per construction
// at most (pending, then one per redraw set), so the oldest is dropped past STRIPS_KEPT.
const ADDED_FRAG = new WeakMap<Analysis, Map<AddedId, Map<Strip | null, Fragility | null>>>();
const STRIPS_KEPT = 4;

/** fragility() for added construction `id` on analysis `a` with `strip`, solved once per strip. */
export function addedFragility(a: Analysis, id: AddedId, strip: Strip | null): Fragility | null {
  let per = ADDED_FRAG.get(a);
  if (!per) {
    per = new Map();
    ADDED_FRAG.set(a, per);
  }
  let byStrip = per.get(id);
  if (!byStrip) {
    byStrip = new Map();
    per.set(id, byStrip);
  }
  if (byStrip.has(strip)) return byStrip.get(strip) ?? null;
  const own = addedFit(a, id).own;
  const frag = own
    ? fragility(id, { m: own.m, S: own.S, rf: a.rf, allowShort: a.allowShort, T: own.T, lookbacks: addedLookbacks(a, id), redraws: null, strip })
    : null;
  if (byStrip.size >= STRIPS_KEPT) byStrip.delete(byStrip.keys().next().value as Strip | null);
  byStrip.set(strip, frag);
  return frag;
}

/**
 * Every column's figures: scorecardRow over its daily returns, fragility() over its construction. An added
 * construction's fragility rows are the engine's on its own window's moments, its lookback weights from
 * addedLookbacks(), and its draw row from its own redraws in `draws` (a dash until they are solved), through
 * addedFragility().
 */
export function columnFigures(a: Analysis, c: Custom, redraws: Redraws | null, added: readonly AddedId[] = [], draws: AddedDraws = NO_DRAWS): ColFigures[] {
  const start = a.prices.dates[0] ?? null;
  const T = a.dates.length;
  // The lookback windows are solved once and read by both optimised columns.
  const fits = fitWindows(a);
  return scoreColIds(added).map((id): ColFigures => {
    if (id === "bench") return { row: scorecardRow(a.bench, a.bench, a.dates, start, a.rf), frag: null };
    const w = columnWeights(a, c, id);
    if (!w) return { row: null, frag: null };
    const row = scorecardRow(portfolioReturns(a.returns, w), a.bench, a.dates, start, a.rf);
    if (isAddedId(id)) {
      const d = draws[id];
      return { row, frag: addedFragility(a, id, d && d.status === "ready" ? d.value : null) };
    }
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
    `complete calendar months; capture is the portfolio's average monthly return over the benchmark's, in the months the ` +
    `benchmark rose (up) or fell (down). Tracking error is the standard deviation of daily active returns × √252. VaR and expected ` +
    `shortfall are historical, one day, at 95%. Drawdowns count from the amount invested. Sharpe prints ± one standard error ` +
    `(Lo, adjusted for skew and fat tails). Every figure is in-sample.`
  );
}

/** How close two weight vectors must be, every weight, for the caption to call one column close to another: one percentage point. */
export const CLOSE_WEIGHTS = 0.01;

// What a long-only tangency that earned no more than the rate holds, in words: one asset alone (the usual answer, the one
// whose own Sharpe ratio is least negative), or, failing that, the mix the solve returned.
function heldInstead(a: Analysis, w: readonly number[]): string {
  const held = w.map((x, i) => (x > 1e-9 ? i : -1)).filter((i) => i >= 0);
  return held.length === 1
    ? `${a.tickers[held[0]]} alone, the asset whose own Sharpe ratio is least negative there`
    : "the long-only mix whose Sharpe ratio is least negative there";
}

/**
 * What the caption adds for the added columns shown: the last-year column's fixed window, the shrinkage
 * the engine applied (read from its answer, never typed), why risk parity's what-if rows are zero, and,
 * when the window makes them so, why a capped column's what-if rows can read zero, why the shrunk-mean
 * column sits close to Tangency's, and that a long-only tangency which earned no more than the rate holds one asset.
 * Every one of those is read from the engine's answer on this window. Null when none applies.
 */
export function addedConventions(a: Analysis, added: readonly AddedId[]): string | null {
  const out: string[] = [];
  const T = a.dates.length;
  const rate = `the ${format(a.rf, "pct2")} risk-free rate`;
  const y1 = added.includes("tan.1y") ? addedFit(a, "tan.1y").sol : null;
  if (y1) {
    out.push(
      `${ADDED_LABEL["tan.1y"]} has its weights solved on the window's last ${YEAR_ROWS} daily returns, from ${format(a.dates[T - YEAR_ROWS], "date")}, ` +
        `and held over the whole window like every other column; its window is fixed, so its lookback row is a dash and its other fragility rows read those ${YEAR_ROWS} days.`,
    );
    if (y1.beatsRf === false) out.push(`On those days no long-only mix earned more than ${rate}, so it holds ${heldInstead(a, y1.w)}.`);
  }
  const bs = added.includes("tan.bs") ? addedFit(a, "tan.bs").sol : null;
  const shrink = bs?.shrink;
  if (bs && shrink) {
    out.push(
      `${ADDED_LABEL["tan.bs"]} moves each asset's expected return ${format(shrink.phi, "pct1")} of the way toward the mean return of the ` +
        `minimum-variance portfolio with no weight bounds, ${format(shrink.mu0 * TRADING_DAYS, "pct2")} a year, before solving (the Bayes-Stein estimator, Jorion 1986).`,
    );
    if (bs.beatsRf === false) out.push(`On the shrunk means no long-only mix earns more than ${rate}, so it holds ${heldInstead(a, bs.w)}.`);
    // Each shrunk excess return is (1 - phi) times the sample one plus one amount common to every asset,
    // phi (mu0 - rf). A maximum-Sharpe mix does not move when every excess return is scaled alike, so only
    // that common amount can move the weights; when it is small the column sits close to Tangency's, which
    // is said, with the amount, only when the weights show it.
    const tw = a.tangency?.w;
    if (bs.beatsRf !== false && tw && tw.every((x, i) => Math.abs(x - bs.w[i]) < CLOSE_WEIGHTS)) {
      const common = shrink.phi * (shrink.mu0 * TRADING_DAYS - a.rf);
      out.push(
        `On this window each of its weights is within ${Math.round(CLOSE_WEIGHTS * 100)} percentage point of Tangency's: shrinking scales every ` +
          `excess return by the same factor, which leaves the maximum-Sharpe weights where they were, and adds one amount common to every ` +
          `asset, the intensity times the target's excess over the rate, here ${format(common, "pct2")} a year; only that amount moves them.`,
      );
    }
  }
  const cap = added.includes("tan.cap") ? addedFit(a, "tan.cap").sol : null;
  if (cap && Math.max(...cap.w) >= CAP - 1e-9) {
    out.push(
      `${ADDED_LABEL["tan.cap"]} holds its largest asset at the ${Math.round(CAP * 100)}% cap; its cut and redraw rows follow that one weight, ` +
        `so they can read zero while its other weights move.`,
    );
  }
  if (added.includes("rp") && addedFit(a, "rp").sol) out.push(`${ADDED_LABEL.rp} reads no expected returns, so its cut and redraw rows are zero.`);
  return out.length ? out.join(" ") : null;
}

/** One sentence per shown added column with no weights, saying why its cells are dashes. */
export function addedMissingNotes(a: Analysis, added: readonly AddedId[]): string[] {
  return added.filter((id) => !addedFit(a, id).sol).map((id) => addedMissingWords(a, id));
}

/** Why an added column's draw row is still a dash, or null when every shown one has its redraws. */
export function addedDrawNote(a: Analysis, added: readonly AddedId[], draws: AddedDraws): string | null {
  const solved = added.filter((id) => addedFit(a, id).sol);
  const waiting = solved.filter((id) => (draws[id]?.status ?? "pending") === "pending").map((id) => ADDED_LABEL[id]);
  const parts: string[] = [];
  if (waiting.length) parts.push(`The redraw row fills in for ${waiting.join("; ")} once ${waiting.length === 1 ? "its" : "their"} ${REDRAWS} redraws are solved.`);
  for (const id of solved) {
    const d = draws[id];
    if (d?.status === "error") parts.push(`The redraw row is empty for ${ADDED_LABEL[id]}: its redraws failed. ${d.message}`);
    else if (d?.status === "ready" && d.value === null) parts.push(`The redraw row is empty for ${ADDED_LABEL[id]}: its covariance matrix has no Cholesky factor, so no means could be drawn.`);
  }
  return parts.length ? parts.join(" ") : null;
}

/**
 * The scorecard for an analysis, a custom mix and the redraws on hand. `redraws` pending or failed
 * leaves the draw row a dash for the two solved portfolios; equal weight and a typed mix still read zero.
 * `added` are the constructions the reader added (any this basket cannot have are dropped), and `draws`
 * their own redraws on the same seed.
 */
export function scorecard(a: Analysis, c: Custom, redraws: RedrawState, added: readonly AddedId[] = [], draws: AddedDraws = NO_DRAWS): ScoreModel {
  const value = redraws.status === "ready" ? redraws.value : null;
  const shown = shownAdded(a, added);
  const columns = scoreColumns(a, c, shown);
  const figs = columnFigures(a, c, value, shown, draws);
  const extra = addedConventions(a, shown);
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
    conventions: extra ? `${scoreConventions(a.rf)} ${extra}` : scoreConventions(a.rf),
    days: a.dates.length,
    seed: value ? value.seed : null,
    cut: cutWords(a, columns, figs),
    addedDraws: addedDrawNote(a, shown, draws),
    addedMissing: addedMissingNotes(a, shown),
  };
}

/**
 * The cut row's re-solve in words, per solved column: which holding was cut, its weight before and after,
 * and the largest holding once it was re-solved. The row itself prints only the weight lost. A column
 * whose weights did not move at the printed precision (GMV reads no expected returns) is left to its zero.
 */
export function cutWords(a: Analysis, columns: ScoreColumn[], figs: ColFigures[]): string | null {
  const one = (k: number): string | null => {
    const cut = figs[k].frag?.cut;
    if (!cut || cut.from === null || cut.weightBefore === null || cut.weightAfter === null || cut.to === null || cut.toWeight === null) return null;
    if (cut.to === cut.from && format(cut.weightBefore, "pct1") === format(cut.weightAfter, "pct1")) return null;
    const from = a.tickers[cut.from];
    const moved = `${columns[k].label} held ${from} at ${format(cut.weightBefore, "pct1")}, ${format(cut.weightAfter, "pct1")} after the cut,`;
    return cut.to === cut.from ? `${moved} and it stayed the largest holding` : `${moved} and its largest holding became ${a.tickers[cut.to]} at ${format(cut.toWeight, "pct1")}`;
  };
  const parts = columns.map((_, k) => one(k)).filter((x): x is string => x !== null);
  return parts.length ? `With the largest holding's expected return cut by one standard error and the weights solved again: ${parts.join("; ")}.` : null;
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
  // The file names what it was computed on, so a copy saved after Redraw still says which draw set it holds.
  for (const [metric, unit] of sheetNotes(m)) {
    const row: TableRow = { group: "Notes", metric, unit };
    m.columns.forEach((c) => (row[c.id] = null));
    rows.push(row);
    rowFormats.push("text");
  }
  return { columns, rows, rowFormats };
}

const finiteOrNull = (x: number | null) => (x !== null && Number.isFinite(x) ? x : null);

/** The notes at the foot of the downloads: the window, the conventions (which carry the rate), the draw set. */
export function sheetNotes(m: ScoreModel): [string, string][] {
  return [
    ["Window", m.span],
    ["Conventions", m.conventions],
    ["Redraw seed", m.seed !== null ? String(m.seed) : "none: the redraws were not solved"],
  ];
}

/**
 * A note on the fragility group, or null: why the draw row is still a dash for the solved portfolios. These
 * redraws fill only GMV's and Tangency's draw cells; an added column with weights fills its own from its own
 * redraws (addedDrawNote speaks for it). So once `columns` shows such a column, the note names the columns it
 * speaks for, and says nothing when neither of them was solved: "the redraw row is empty" would be false of a
 * row with an added column's figure in it.
 */
export function drawRowNote(redraws: RedrawState, columns: readonly ScoreColumn[] = []): string | null {
  const ownDraws = columns.some((c) => isAddedId(c.id) && c.ok);
  const covered = columns.filter((c) => (c.id === "gmv" || c.id === "tangency") && c.ok).map((c) => c.label);
  if (ownDraws && !covered.length) return null;
  const which = ownDraws ? ` for ${covered.join(" and ")}` : "";
  if (redraws.status === "pending") return `The redraw row fills in${which} once the ${REDRAWS} redraws are solved.`;
  if (redraws.status === "error") return `The redraw row is empty${which}: the redraws failed. ${redraws.message}`;
  if (redraws.value === null) return `The redraw row is empty${which}: the covariance matrix has no Cholesky factor, so no means could be drawn.`;
  return null;
}
