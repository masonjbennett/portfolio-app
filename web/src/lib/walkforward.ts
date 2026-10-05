// The walk-forward test: fit on the past, hold the weights over days the fit never saw, refit, roll on.
//
// Units are the engine's throughout. `cols` holds one DAILY simple-return column per asset, every column the
// same length T and aligned with `dates`, the return rows' ISO days. A rate is an ANNUAL decimal (0.02 is
// 2%). Weights are decimal fractions summing to 1. Every Sharpe ratio is annual, through annualizedStats,
// and every standard error comes from sharpeSE on the same series.
//
// The schedule is counted in RETURN ROWS, never from a calendar: the first fit is the first FIRST_FIT rows;
// then holds of H rows follow one after another, each preceded by a refit, and the last one is whatever
// remains. An expanding fit reads every row before its hold; a rolling one reads the FIRST_FIT rows right
// before it. A fit's means and covariance are those rows' own (daily means, covariance with ddof 1), as the
// page builds them for the whole window. Weights stay constant through a hold and are rebalanced daily
// (portfolioReturns). The held days of every hold are joined into ONE series and scored once; a hold's own
// Sharpe is reported only from MIN_HOLD rows up, while every held day still joins the series.
//
// The rate is either one flat annual rate, used for every fit and every day, or a daily series of
// [ISO day, annual decimal] (FRED's 3-month bill as the page holds it). With the series, each fit takes the
// last observation on or before its last row's day, and each held day its own, carried forward over days
// the series did not publish; a day before the series' first observation is an error, never a zero. A
// per-period score is annualizedStats of the daily EXCESS series (r - rate / 252) at zero; a flat score is
// annualizedStats of the raw series at the rate.
import {
  ADDED_IDS,
  ownWindow,
  solveAdded,
  unavailable,
  type AddedId,
  type Unavailable,
} from "./constructions.ts";
import { covMatrix, mean, type Vec } from "./num.ts";
import { gmv, tangency } from "./optimize.ts";
import { portfolioReturns } from "./portfolio.ts";
import { annualizedStats, sharpeSE, TRADING_DAYS } from "./stats.ts";

/** Return rows in the first fit: two years of daily returns. */
export const FIRST_FIT = 504;

/** The fewest held rows a hold needs for its own Sharpe ratio to be reported (about a quarter). */
export const MIN_HOLD = 63;

/** Expanding: each fit reads every row before its hold. Rolling: the FIRST_FIT rows right before it. */
export type FitMode = "expanding" | "rolling";

/** Return rows per hold. */
export type HoldRows = 252 | 126;

export interface WalkOptions {
  fit: FitMode;
  hold: HoldRows;
}

export const DEFAULT_WALK: Readonly<WalkOptions> = { fit: "expanding", hold: 252 };

/** One refit and the hold after it, as half-open return-row ranges [fitFrom, fitTo) and [holdFrom, holdTo). */
export interface Fold {
  fitFrom: number;
  fitTo: number;
  holdFrom: number;
  holdTo: number;
}

/** Too few return rows for a first fit and one reportable hold. `need` is FIRST_FIT + MIN_HOLD. */
export interface TooFewRows {
  ok: false;
  reason: "too-few-rows";
  rows: number;
  need: number;
}

export type Schedule = { ok: true; folds: Fold[] } | TooFewRows;

/** The folds for T return rows under `opts`, or why there are none. */
export function schedule(T: number, opts: WalkOptions): Schedule {
  const need = FIRST_FIT + MIN_HOLD;
  if (!(T >= need)) return { ok: false, reason: "too-few-rows", rows: T, need };
  const folds: Fold[] = [];
  for (let holdFrom = FIRST_FIT; holdFrom < T; holdFrom += opts.hold) {
    const holdTo = Math.min(holdFrom + opts.hold, T);
    const fitFrom = opts.fit === "rolling" ? holdFrom - FIRST_FIT : 0;
    folds.push({ fitFrom, fitTo: holdFrom, holdFrom, holdTo });
  }
  return { ok: true, folds };
}

// ---- the rate -----------------------------------------------------------------------------------------

/** One observation of a daily rate series: its ISO day and the annual rate as a decimal. */
export type DayRate = readonly [string, number];

/** A flat annual rate, or a daily series ascending by day. */
export type Rates = number | readonly DayRate[];

/** The series starts after the first day that needs a rate from it. */
export interface RatesStartLate {
  ok: false;
  reason: "rates-start-late";
  /** The series' first day, or null when it is empty. */
  first: string | null;
  /** The first day that needed a rate. */
  day: string;
}

/** The last observation on or before `day`, or null when the series starts after it. */
export function rateOn(series: readonly DayRate[], day: string): number | null {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? series[lo - 1][1] : null;
}

/**
 * Each day's rate, carried forward over days the series did not publish: for every day in `days`
 * (ascending), the last observation on or before it.
 */
export function dayRates(series: readonly DayRate[], days: readonly string[]): { ok: true; rates: number[] } | RatesStartLate {
  const out = new Array<number>(days.length);
  let j = 0;
  let cur: number | null = null;
  for (let t = 0; t < days.length; t++) {
    while (j < series.length && series[j][0] <= days[t]) {
      cur = series[j][1];
      j++;
    }
    if (cur === null) return { ok: false, reason: "rates-start-late", first: series.length ? series[0][0] : null, day: days[t] };
    out[t] = cur;
  }
  return { ok: true, rates: out };
}

/** How held days are scored: one flat annual rate, or one annual rate per return row, aligned with the columns. */
export type RowRates = number | readonly number[];

/** A daily series ready to score: the raw returns for a flat rate, the excess returns for a per-row one. */
function toScore(r: Vec, from: number, rates: RowRates): Vec {
  if (typeof rates === "number") return r;
  return r.map((x, k) => x - rates[from + k] / TRADING_DAYS);
}

/** Sharpe ratio and its standard error of a series toScore() prepared. */
function scored(s: Vec, rates: RowRates): { sharpe: number; se: number } {
  const rf = typeof rates === "number" ? rates : 0;
  return { sharpe: annualizedStats(s, rf).sharpe, se: sharpeSE(s, rf) };
}

/** The Sharpe ratio of the return rows [from, from + r.length), scored under `rates`. */
export function sharpeOn(r: Vec, from: number, rates: RowRates): number {
  return scored(toScore(r, from, rates), rates).sharpe;
}

// ---- the replay ---------------------------------------------------------------------------------------

/** The portfolio's daily returns over one hold: weights `w` constant, rebalanced daily. */
export function heldReturns(cols: Vec[], f: Fold, w: Vec): Vec {
  const held = cols.map((c) => c.slice(f.holdFrom, f.holdTo));
  return portfolioReturns(held, w);
}

export interface HeldFold {
  /** Held return rows. */
  rows: number;
  /** The portfolio's daily returns over the hold. */
  returns: Vec;
  /** The hold's own Sharpe ratio; null below MIN_HOLD rows. */
  sharpe: number | null;
}

export interface Replayed {
  folds: HeldFold[];
  /** Every held day's return, the holds joined in order. */
  joined: Vec;
  /** The joined series' Sharpe ratio, annual. */
  sharpe: number;
  /** Its standard error (sharpeSE), annual. */
  se: number;
}

/**
 * Hold weights[k] through folds[k] for every k, join the held days, and score them once under `rates`. This is
 * all a stored set of weights needs: no fit runs here.
 */
export function replay(cols: Vec[], folds: readonly Fold[], weights: readonly Vec[], rates: RowRates): Replayed {
  const out: HeldFold[] = [];
  const pieces: Vec[] = [];
  const joined: Vec = [];
  folds.forEach((f, k) => {
    const r = heldReturns(cols, f, weights[k]);
    const s = toScore(r, f.holdFrom, rates);
    pieces.push(s);
    for (const x of r) joined.push(x);
    out.push({ rows: r.length, returns: r, sharpe: r.length >= MIN_HOLD ? scored(s, rates).sharpe : null });
  });
  const all = ([] as number[]).concat(...pieces);
  const joinedScore = scored(all, rates);
  return { folds: out, joined, sharpe: joinedScore.sharpe, se: joinedScore.se };
}

// ---- the live walk-forward ----------------------------------------------------------------------------

/** Equal weight, minimum variance and maximum Sharpe, then the added constructions. */
export type Construction = "ew" | "gmv" | "tan" | AddedId;

/** The three constructions every walk-forward runs, in the order the page lists them. */
export const CORE: readonly Construction[] = ["ew", "gmv", "tan"];

/** A construction's weights on one fit, or why there are none. */
export interface Fitted {
  /** Null when the construction is unavailable on this fit or its solve found no weights. */
  w: Vec | null;
  /** Why the construction cannot be offered on this fit (added constructions only), else null. */
  unavailable: Unavailable | null;
  /**
   * A maximum-Sharpe fit (the tangency and the three added tangencies): whether its mix earned more than the
   * fit's rate on the fit's own rows. False means none did, and the solver holds the mix whose Sharpe ratio is
   * least negative there (one asset, long-only). Null for the other constructions and where there are no weights.
   */
  beatsRf: boolean | null;
}

/**
 * Every construction in `ids` fitted on `fit` (one column per asset, the fit's rows only) at annual rate `rf`.
 * Equal weight is 1/n; minimum variance and maximum Sharpe are solved on the rows' daily means and covariance;
 * an added construction reads its own window of those rows (ownWindow: the last 252 for the last-year one).
 */
export function fitAll(ids: readonly Construction[], fit: Vec[], rf: number, allowShort: boolean): Record<string, Fitted> {
  const n = fit.length;
  const T = fit[0].length;
  const m = fit.map(mean);
  const S = covMatrix(fit);
  const out: Record<string, Fitted> = {};
  for (const id of ids) {
    if (id === "ew") {
      out[id] = { w: new Array<number>(n).fill(1 / n), unavailable: null, beatsRf: null };
    } else if (id === "gmv") {
      out[id] = { w: gmv(m, S, allowShort)?.w ?? null, unavailable: null, beatsRf: null };
    } else if (id === "tan") {
      const t = tangency(m, S, rf, allowShort);
      out[id] = { w: t?.w ?? null, unavailable: null, beatsRf: t ? t.beatsRf : null };
    } else {
      const why = unavailable(id, T, n);
      if (why) {
        out[id] = { w: null, unavailable: why, beatsRf: null };
        continue;
      }
      const own = ownWindow(id, fit);
      const sol = solveAdded(id, own.m, own.S, own.T, rf, allowShort);
      out[id] = { w: sol?.w ?? null, unavailable: null, beatsRf: sol ? sol.beatsRf : null };
    }
  }
  return out;
}

export interface WalkInput {
  /** One daily return column per asset, aligned with `dates`. */
  cols: Vec[];
  /** The return rows' ISO days, ascending. */
  dates: readonly string[];
  /** The benchmark's daily returns on the same rows, or null for none. */
  bench: Vec | null;
  /** A flat annual rate, or the daily series to take each period's rate from. */
  rates: Rates;
  allowShort: boolean;
  /** Also run the four added constructions. */
  added: boolean;
}

export interface FoldInfo extends Fold {
  fitFirst: string;
  fitLast: string;
  holdFirst: string;
  holdLast: string;
  /** Held return rows. */
  bars: number;
  /** The annual rate the fit's maximum Sharpe (and every added tangency) was solved at. */
  fitRate: number;
}

export interface ConstructionRun {
  id: Construction;
  /** Per fold: the weights held, or null where the construction is unavailable or its solve failed. */
  weights: (Vec | null)[];
  /** Per fold: why an added construction could not be offered, else null. */
  unavailable: (Unavailable | null)[];
  /** The folds (indices) whose solve found no weights. */
  failed: number[];
  /** Per fold: Fitted.beatsRf, whether a maximum-Sharpe fit's mix earned more than that fit's rate. */
  beatsRf: (boolean | null)[];
  /** Per fold: the hold's own Sharpe; null below MIN_HOLD rows or without weights. */
  foldSharpe: (number | null)[];
  /** The joined held days' Sharpe; null unless every fold has weights. */
  sharpe: number | null;
  /** Its standard error; null with it. */
  se: number | null;
  /** Fitted on the whole window and scored on it under the same rate convention; null without weights. */
  inSample: number | null;
  inSampleWeights: Vec | null;
  /** Why the construction cannot be offered on the whole window, else null. */
  inSampleUnavailable: Unavailable | null;
}

export interface BenchRun {
  foldSharpe: (number | null)[];
  sharpe: number;
  se: number;
  /** The benchmark scored on the whole window, under the same convention. */
  inSample: number;
}

/** "flat": one rate for every fit and day. "per-period": each fit's and each day's own rate from the series. */
export type Convention = "flat" | "per-period";

export interface Walk {
  ok: true;
  convention: Convention;
  options: WalkOptions;
  /** Return rows in the window. */
  rows: number;
  /** Held return rows, every hold joined. */
  heldRows: number;
  folds: FoldInfo[];
  runs: ConstructionRun[];
  bench: BenchRun | null;
  /** The rate the in-sample column was fitted at: the window's last row's (or the flat rate). */
  inSampleRate: number;
}

export type WalkResult = Walk | TooFewRows | RatesStartLate;

/**
 * walkForward(), one step at a time: it yields after each fold's refit and after the whole-window fit, the points
 * where a caller solving across several macrotasks may pause, and returns what walkForward() returns. The
 * page runs it this way (src/tabs/walkforward/liveSolve.ts), so the steps and walkForward() are one code path.
 */
export function* walkForwardSteps(input: WalkInput, opts: WalkOptions = DEFAULT_WALK): Generator<void, WalkResult, void> {
  const { cols, dates, bench, rates, allowShort } = input;
  const T = dates.length;
  const plan = schedule(T, opts);
  if (!plan.ok) return plan;
  const folds = plan.folds;
  const flatRate = typeof rates === "number" ? rates : NaN;
  let daily: number[] | null = null;
  if (typeof rates !== "number") {
    const d = dayRates(rates, dates);
    if (!d.ok) return d;
    daily = d.rates;
  }
  const fitRates = folds.map((f) => (daily ? daily[f.fitTo - 1] : flatRate));
  const scoreRates: RowRates = daily ? daily : flatRate;
  const ids: Construction[] = input.added ? [...CORE, ...ADDED_IDS] : [...CORE];
  const fits: Record<string, Fitted>[] = [];
  for (let k = 0; k < folds.length; k++) {
    const f = folds[k];
    fits.push(fitAll(ids, cols.map((c) => c.slice(f.fitFrom, f.fitTo)), fitRates[k], allowShort));
    yield;
  }
  const inSampleRate = daily ? daily[T - 1] : flatRate;
  const whole = fitAll(ids, cols, inSampleRate, allowShort);
  yield;
  const wholeScore = (r: Vec) => sharpeOn(r, 0, scoreRates);

  const runs = ids.map((id): ConstructionRun => {
    const weights = fits.map((f) => f[id].w);
    const why = fits.map((f) => f[id].unavailable);
    const failed = weights.flatMap((w, k) => (w === null && why[k] === null ? [k] : []));
    const complete = weights.every((w) => w !== null);
    const held = complete ? replay(cols, folds, weights as Vec[], scoreRates) : null;
    const foldSharpe = held
      ? held.folds.map((f) => f.sharpe)
      : folds.map((f, k) => {
          const w = weights[k];
          if (!w) return null;
          const r = heldReturns(cols, f, w);
          return r.length >= MIN_HOLD ? sharpeOn(r, f.holdFrom, scoreRates) : null;
        });
    const iw = whole[id].w;
    return {
      id,
      weights,
      unavailable: why,
      failed,
      beatsRf: fits.map((f) => f[id].beatsRf),
      foldSharpe,
      sharpe: held ? held.sharpe : null,
      se: held ? held.se : null,
      inSample: iw ? wholeScore(portfolioReturns(cols, iw)) : null,
      inSampleWeights: iw,
      inSampleUnavailable: whole[id].unavailable,
    };
  });

  let benchRun: BenchRun | null = null;
  if (bench) {
    const b = replay([bench], folds, folds.map(() => [1]), scoreRates);
    benchRun = { foldSharpe: b.folds.map((f) => f.sharpe), sharpe: b.sharpe, se: b.se, inSample: wholeScore(bench) };
  }

  return {
    ok: true,
    convention: daily ? "per-period" : "flat",
    options: { fit: opts.fit, hold: opts.hold },
    rows: T,
    heldRows: T - folds[0].holdFrom,
    folds: folds.map((f, k) => ({
      ...f,
      fitFirst: dates[f.fitFrom],
      fitLast: dates[f.fitTo - 1],
      holdFirst: dates[f.holdFrom],
      holdLast: dates[f.holdTo - 1],
      bars: f.holdTo - f.holdFrom,
      fitRate: fitRates[k],
    })),
    runs,
    bench: benchRun,
    inSampleRate,
  };
}

/** The walk-forward on `input` under `opts`, every construction refitted per fold. Pure; solve it off the render. */
export function walkForward(input: WalkInput, opts: WalkOptions = DEFAULT_WALK): WalkResult {
  const steps = walkForwardSteps(input, opts);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}
