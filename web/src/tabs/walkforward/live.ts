// "Your basket": what the walk-forward test on the reader's own basket prints, and the words around it. Pure,
// like the other tabs' model files, so the suite reaches every figure without a DOM; the component
// (./Live.tsx) only lays it out, and the solve itself runs after paint (./liveSolve.ts).
//
// Every figure comes from the engine's walkForward() (src/lib/walkforward.ts) on the analysis on screen, in
// the page's own units: Sharpe ratios annual, weights and rates decimal. The one exception is the in-sample
// column at a flat rate, which is read the way the scorecard reads it (scorecardRow over the page's own fitted
// weights), so the two tabs cannot print different numbers for the same portfolio on the same window.
//
// The rate. With FRED's daily 3-month bill series held over the window and no rate typed in the rail, each
// refit is solved at the rate on its last day and each held day is scored on its return minus that day's rate;
// the in-sample column then uses the same convention, at the window's last day's rate, so the two columns are
// like for like and it differs from the other tabs by the rate convention alone. Otherwise the run is flat at
// the analysis' own rate, and the label says why.
//
// Results are kept per analysis (an analysis never changes once built) and per options, so switching the
// explanation level or coming back to an option already seen never solves again.
//
// The solve is taken in steps (walkSteps): one refit per step, then the whole window, then the scoring. At ten
// assets with short holds and the added constructions on, one call of walkForward() holds the page for longer
// than a frame, so ./liveSolve.ts runs the steps across macrotasks. The steps are the engine's own generator
// (walkForwardSteps, which walkForward() itself drains), so the page and the engine run one code path;
// test/t-tab-walkforward.mjs holds what is left to this file: one step per refit and one for the whole window,
// the engine's inputs taken from ratePlan(), and a series that starts too late refused by name.
import { PUBLISHED_SETS } from "../../content/published.ts";
import { format } from "../../format.ts";
import { CAP_MIN_ASSETS, YEAR_ROWS, type Unavailable } from "../../lib/constructions.ts";
import type { Vec } from "../../lib/num.ts";
import { portfolioReturns } from "../../lib/portfolio.ts";
import { scorecardRow } from "../../lib/stats.ts";
import {
  DEFAULT_WALK,
  FIRST_FIT,
  MIN_HOLD,
  rateOn,
  type Construction,
  type ConstructionRun,
  type DayRate,
  type FitMode,
  type HoldRows,
  type TooFewRows,
  type Walk,
  type WalkOptions,
  walkForwardSteps,
} from "../../lib/walkforward.ts";
import type { Analysis, Column, TableRow, WalkRates } from "../../types.ts";
import { tableSpan } from "../caption.ts";
import { ADDED_LABEL, addedFit, weightsOf } from "../optimization/model.ts";

// ---- the rate -----------------------------------------------------------------------------------------

/** Why a run is flat: a rate typed in the rail, or the daily series loading, missing, or not reaching back. */
export type FlatWhy = "typed" | "loading" | "unavailable" | "uncovered" | "late";

/** The rate the run uses: the daily series, or one flat annual rate (always the analysis' own). */
export type RatePlan = { kind: "per-period"; points: readonly DayRate[] } | { kind: "flat"; rate: number; why: FlatWhy };

/**
 * The run's rate from the page's rate input. The series is used only when it has an observation on or before
 * the window's first return day, which is exactly when walkForward() can score every row from it; a series
 * that starts later runs flat and says the daily series could not be had for this window.
 */
export function ratePlan(a: Analysis, r: WalkRates): RatePlan {
  if (r.points) {
    return a.dates.length && rateOn(r.points, a.dates[0]) !== null
      ? { kind: "per-period", points: r.points }
      : { kind: "flat", rate: a.rf, why: "late" };
  }
  return { kind: "flat", rate: a.rf, why: r.flat ?? "unavailable" };
}

// ---- the solve, kept per analysis and options ---------------------------------------------------------

/** A run's result: the walk, or why the window is too short for one. */
export type LiveWalk = Walk | TooFewRows;

const CACHE = new WeakMap<Analysis, Map<string, LiveWalk>>();

/** How many times walkForward() has run. The suites read it to tell a re-solve from a repaint. */
export const SOLVES = { count: 0 };

function keyOf(plan: RatePlan, opts: WalkOptions, added: boolean): string {
  const rate = plan.kind === "flat" ? `flat:${plan.rate}` : `series:${plan.points.length}:${plan.points.at(-1)?.[0] ?? ""}`;
  return `${opts.fit}|${opts.hold}|${added ? "added" : "core"}|${rate}`;
}

/** The three core constructions of a run that also holds the added ones, as a run without them would be. */
function coreOf(w: LiveWalk): LiveWalk {
  if (!w.ok) return w;
  return { ...w, runs: w.runs.filter((r) => r.id === "ew" || r.id === "gmv" || r.id === "tan") };
}

/** The result already solved for these inputs, or undefined. A run without the added constructions reads one with them. */
export function peekWalk(a: Analysis, plan: RatePlan, opts: WalkOptions, added: boolean): LiveWalk | undefined {
  const per = CACHE.get(a);
  if (!per) return undefined;
  const key = keyOf(plan, opts, added);
  const hit = per.get(key);
  if (hit) return hit;
  if (added) return undefined;
  const full = per.get(keyOf(plan, opts, true));
  if (!full) return undefined;
  const core = coreOf(full);
  per.set(key, core);
  return core;
}

/**
 * walkForward() on the analysis under these inputs, one step at a time: each `yield` is a point where the work
 * may pause (after each refit, after the whole-window fit). The return value is what walkForward() returns.
 * A series that starts after the first return row cannot reach here: ratePlan() has already sent it flat.
 */
export function* walkSteps(a: Analysis, plan: RatePlan, opts: WalkOptions, added: boolean): Generator<void, LiveWalk, void> {
  const rates = plan.kind === "per-period" ? plan.points : plan.rate;
  const res = yield* walkForwardSteps({ cols: a.returns, dates: a.dates, bench: a.bench, rates, allowShort: a.allowShort, added }, opts);
  // Fails here, named, rather than printing figures under the wrong label.
  if (!res.ok && res.reason === "rates-start-late") throw new Error(`the rate series starts on ${res.first ?? "no day"}, after ${res.day}`);
  return res;
}

/** Keeps a finished run for these inputs and counts it. */
export function keepWalk(a: Analysis, plan: RatePlan, opts: WalkOptions, added: boolean, res: LiveWalk): LiveWalk {
  SOLVES.count += 1;
  let per = CACHE.get(a);
  if (!per) {
    per = new Map();
    CACHE.set(a, per);
  }
  per.set(keyOf(plan, opts, added), res);
  return res;
}

/** The walk-forward on the analysis under these inputs, solved in one go (every step at once) and kept. */
export function solveWalk(a: Analysis, plan: RatePlan, opts: WalkOptions, added: boolean): LiveWalk {
  const hit = peekWalk(a, plan, opts, added);
  if (hit) return hit;
  const steps = walkSteps(a, plan, opts, added);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return keepWalk(a, plan, opts, added, r.value);
}

// ---- the options ----------------------------------------------------------------------------------------

export const FIT_OPTIONS: readonly { value: FitMode; label: string }[] = [
  { value: "expanding", label: "All prior history" },
  { value: "rolling", label: `The last ${format(FIRST_FIT, "int")} returns` },
];

export const HOLD_ROWS: readonly HoldRows[] = [252, 126];
export const HOLD_OPTIONS: readonly { value: string; label: string }[] = HOLD_ROWS.map((h) => ({ value: String(h), label: `${format(h, "int")} returns` }));

// ---- dates and labels -----------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-04" -> "Sep 4 2026". Anything that is not an ISO day prints as it came. */
export function longDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${Number(m[3])} ${m[1]}` : iso;
}

/** The three constructions every run has, as this segment names them. */
const CORE_LABEL: Readonly<Record<"ew" | "gmv" | "tan", string>> = {
  ew: "Equal weight",
  gmv: "Minimum variance (GMV)",
  tan: "Maximum Sharpe (Tangency)",
};

export function labelOf(id: Construction): string {
  return id === "ew" || id === "gmv" || id === "tan" ? CORE_LABEL[id] : ADDED_LABEL[id];
}

/** The sub-line under a fitted row's name: its weights were chosen before each hold, never on the hold. */
export const FOLD_FITTED = "weights chosen on the fit window before each hold";
const FOLD_LAST_YEAR = "weights chosen on the last year of the fit window before each hold";
export const EW_SUB = "fixed weights, nothing fitted";
export const BENCH_SUB = "the benchmark, held, not fitted";

export function rowSub(id: Construction, allowShort: boolean): string {
  if (id === "ew") return EW_SUB;
  const base = id === "tan.1y" ? FOLD_LAST_YEAR : FOLD_FITTED;
  return allowShort && (id === "tan.cap" || id === "rp") ? `${base}, long only` : base;
}

// ---- the label line -------------------------------------------------------------------------------------

/** The published run's last price day and rate, as the tab holds them. */
export interface PublishedRun {
  lastBar: string;
  rf: number;
}

/**
 * A flat rate as the label prints it: to one decimal of a percent when that is the rate exactly (a typed 2.0%
 * reads as the published 2.0% beside it), to two otherwise.
 */
export function rateWords(rate: number): string {
  return Math.abs(rate * 1000 - Math.round(rate * 1000)) < 1e-9 ? format(rate, "pct1") : format(rate, "pct2");
}

/** What the run was computed on, against what the published note used: one to three sentences. */
export function labelLine(a: Analysis, plan: RatePlan, pub: PublishedRun): string[] {
  const asOf = longDay(a.asOf);
  const then = longDay(pub.lastBar);
  const out =
    plan.kind === "per-period"
      ? [
          `Recomputed on prices through ${asOf}, each refit and each held day at the 3-month Treasury bill rate of its time; the published note used prices through ${then} at a flat ${format(pub.rf, "pct1")} risk-free rate.`,
        ]
      : [
          `Recomputed on prices through ${asOf} at a ${rateWords(plan.rate)} risk-free rate; the published note used prices through ${then} at a ${format(pub.rf, "pct1")} risk-free rate.`,
        ];
  if (plan.kind === "flat" && plan.why === "loading") {
    out.push("The daily 3-month Treasury bill series is still loading, so every refit and every held day uses that one rate for now.");
  } else if (plan.kind === "flat" && plan.why !== "typed") {
    out.push("The daily 3-month Treasury bill series could not be had for this window, so every refit and every held day uses that one rate.");
  }
  if (a.allowShort) out.push("The published test was long-only; this run allows shorting.");
  return out;
}

/** The one line the segment prints when the window is too short to run. */
export function cannotRun(t: TooFewRows): string {
  return (
    `The walk-forward test cannot run on this window: it needs at least ${format(t.need, "int")} daily returns, ` +
    `${format(FIRST_FIT, "int")} for the first fit and ${format(MIN_HOLD, "int")} for one hold, and this window has ${format(t.rows, "int")}.`
  );
}

/** "1 day", "62 days". */
export function dayCount(n: number): string {
  return `${format(n, "int")} ${n === 1 ? "day" : "days"}`;
}

/** "1 hold", "6 holds". */
export function holdCount(n: number): string {
  return `${format(n, "int")} ${n === 1 ? "hold" : "holds"}`;
}

/** The convention in plain words, every number read from the run. */
export function conventionLine(w: Walk): string {
  const f = w.folds;
  const first = f[0];
  const last = f[f.length - 1];
  const fit =
    w.options.fit === "expanding"
      ? "each refit reads every daily return before its hold"
      : `each refit reads the ${format(FIRST_FIT, "int")} daily returns right before its hold`;
  const partial = last.bars < w.options.hold ? ` The last hold is partial: ${dayCount(last.bars)}, ${last.holdFirst} to ${last.holdLast}.` : "";
  return (
    `The first fit is the window's first ${format(FIRST_FIT, "int")} daily returns (${first.fitFirst} to ${first.fitLast}). ` +
    `Then come ${holdCount(f.length)} of ${format(w.options.hold, "int")} daily returns counted forward, and ${fit}.${partial} ` +
    "Weights are held constant through each hold and rebalanced daily, and the held days of every hold are joined into one series and scored once."
  );
}

// ---- the rows ---------------------------------------------------------------------------------------------

export interface LiveRow {
  /** The construction, or "bench". */
  key: Construction | "bench";
  label: string;
  sub: string;
  /** Fitted on the whole window and scored on it, under the run's rate convention; null without weights. */
  inSample: number | null;
  /** The joined held days' Sharpe ratio; null when any hold has no weights. */
  oos: number | null;
  /** One standard error of `oos`. */
  se: number | null;
  /** Each hold's own Sharpe ratio; null below MIN_HOLD days or without weights. */
  folds: (number | null)[];
  /** Why there is no out-of-sample figure, as sentences; null when there is one. */
  missing: string | null;
}

// The weights the page's other tabs hold for a construction: the scorecard's columns read exactly these.
function pageWeights(a: Analysis, id: Construction): Vec | null {
  if (id === "ew") return weightsOf(a, "ew");
  if (id === "gmv") return weightsOf(a, "gmv");
  if (id === "tan") return weightsOf(a, "tangency");
  return addedFit(a, id).sol?.w ?? null;
}

/** The scorecard's Sharpe ratio for a series on this window, at the analysis' own rate. */
function scorecardSharpe(a: Analysis, r: Vec): number {
  return scorecardRow(r, a.bench, a.dates, a.prices.dates[0] ?? null, a.rf).sharpe;
}

/** A construction's in-sample figure: the scorecard's at a flat rate, the engine's like-for-like reading per period. */
export function inSampleOf(a: Analysis, w: Walk, run: ConstructionRun): number | null {
  if (w.convention === "per-period") return run.inSample;
  const wt = pageWeights(a, run.id);
  return wt ? scorecardSharpe(a, portfolioReturns(a.returns, wt)) : null;
}

const holdName = (w: Walk, k: number) => `hold ${k + 1} (fitted through ${w.folds[k].fitLast})`;

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// Why an added construction cannot be had on a fold's fit window, as a clause.
function whyWords(reason: Unavailable, n: number): string {
  switch (reason) {
    case "too-few-assets":
      return `it needs at least ${CAP_MIN_ASSETS} assets and this basket has ${n}`;
    case "year-too-thin":
      return `the last ${YEAR_ROWS} daily returns of the fit are too few to estimate ${n} assets' covariance`;
    case "too-few-rows":
      return `it needs more than ${n + 2} daily returns for ${n} assets`;
    case "window-is-one-year":
      return `it needs more than ${YEAR_ROWS} daily returns to fit on`;
  }
}

/** Why a construction has no joined figure: the holds it could not be had in, and the holds whose solve found nothing. */
export function missingWords(w: Walk, run: ConstructionRun, n: number): string | null {
  const parts: string[] = [];
  const byReason = new Map<Unavailable, number[]>();
  run.unavailable.forEach((why, k) => {
    if (why) byReason.set(why, [...(byReason.get(why) ?? []), k]);
  });
  for (const [why, ks] of byReason) {
    const where = ks.length === w.folds.length ? "in every hold" : `in ${list(ks.map((k) => holdName(w, k)))}`;
    parts.push(`${where}, ${whyWords(why, n)}`);
  }
  if (run.failed.length) parts.push(`its solve found no weights in ${list(run.failed.map((k) => holdName(w, k)))}`);
  if (!parts.length) return null;
  return `${labelOf(run.id)} has no out-of-sample figure: ${parts.join("; ")}.`;
}

/** The rows the segment prints, in order: the runs, then the benchmark. */
export function liveRows(a: Analysis, w: Walk): LiveRow[] {
  const n = a.tickers.length;
  const rows = w.runs.map(
    (run): LiveRow => ({
      key: run.id,
      label: labelOf(run.id),
      sub: rowSub(run.id, a.allowShort),
      inSample: inSampleOf(a, w, run),
      oos: run.sharpe,
      se: run.se,
      folds: run.foldSharpe,
      missing: run.sharpe === null ? missingWords(w, run, n) : null,
    }),
  );
  if (w.bench) {
    rows.push({
      key: "bench",
      label: a.benchLabel,
      sub: BENCH_SUB,
      inSample: w.convention === "per-period" ? w.bench.inSample : scorecardSharpe(a, a.bench),
      oos: w.bench.sharpe,
      se: w.bench.se,
      folds: w.bench.foldSharpe,
      missing: null,
    });
  }
  return rows;
}

// ---- the tables -------------------------------------------------------------------------------------------

export interface LiveTable {
  title: string;
  columns: Column[];
  rows: TableRow[];
  span: string;
  subs: Record<string, string>;
  filename: string;
}

export const IN_SAMPLE_HEAD = "In-sample Sharpe";
export const OOS_HEAD = "Out-of-sample Sharpe";
export const SE_HEAD = "± 1 standard error";

/**
 * The sub-line under the in-sample head: the window it was fitted and scored on (the last-year row is fitted on
 * the window's last year), and under the daily rates how that differs from the other tabs, which fit and score
 * at one rate: here the fit is at the bill rate of the window's last day and each day is scored at its own.
 */
export function inSampleSub(w: Walk): string {
  const lastYear = w.runs.some((r) => r.id === "tan.1y") ? " (the last-year row on the window's last year)" : "";
  return w.convention === "per-period"
    ? `fitted${lastYear} at the bill rate of the window's last day and scored on the whole window, held-out years included, each day at its own rate; the other tabs fit and score at one rate`
    : `fitted${lastYear} and scored on the whole window, held-out years included`;
}

/** In-sample beside out-of-sample, with the out-of-sample figure's standard error. */
export function rowsTable(a: Analysis, w: Walk, rows: readonly LiveRow[]): LiveTable {
  return {
    title: "In-sample and out-of-sample Sharpe ratios",
    columns: [
      { key: "label", label: "Portfolio", format: "text", first: true },
      { key: "inSample", label: IN_SAMPLE_HEAD, format: "num3" },
      { key: "oos", label: OOS_HEAD, format: "num3" },
      { key: "se", label: SE_HEAD, format: "num3" },
    ],
    rows: rows.map((r) => ({ label: r.label, inSample: r.inSample, oos: r.oos, se: r.oos === null ? null : r.se })),
    span: tableSpan(a.dates[0], a.asOf),
    subs: {
      ...Object.fromEntries(rows.map((r) => [r.label, r.sub])),
      [IN_SAMPLE_HEAD]: inSampleSub(w),
      [OOS_HEAD]: "every hold's held-out days, joined",
      [SE_HEAD]: "of the out-of-sample figure",
    },
    filename: "walkforward_sharpe",
  };
}

/** One row per hold: its fit, its rate, its held days, and each row's Sharpe ratio over the hold. */
export function foldTable(a: Analysis, w: Walk, rows: readonly LiveRow[]): LiveTable {
  return {
    title: "Each hold, and the Sharpe ratio it held",
    columns: [
      { key: "hold", label: "Hold", format: "text", first: true },
      { key: "fitFirst", label: "Fit from", format: "date" },
      { key: "fitLast", label: "Fit to", format: "date" },
      { key: "fitDays", label: "Fit days", format: "int" },
      { key: "rate", label: "Fit rate", format: "pct2" },
      { key: "holdFirst", label: "Held from", format: "date" },
      { key: "holdLast", label: "Held to", format: "date" },
      { key: "bars", label: "Held days", format: "int" },
      ...rows.map((r): Column => ({ key: r.key, label: r.label, format: "num3" })),
    ],
    rows: w.folds.map((f, k) => ({
      hold: `Hold ${k + 1}`,
      fitFirst: f.fitFirst,
      fitLast: f.fitLast,
      fitDays: f.fitTo - f.fitFrom,
      rate: f.fitRate,
      holdFirst: f.holdFirst,
      holdLast: f.holdLast,
      bars: f.bars,
      ...Object.fromEntries(rows.map((r) => [r.key, r.folds[k]])),
    })),
    span: tableSpan(a.dates[0], a.asOf),
    subs: {
      "Fit rate": w.convention === "per-period" ? "the bill rate on the fit's last day" : "one rate throughout",
    },
    filename: "walkforward_holds",
  };
}

/** Why a hold's own Sharpe ratio is a dash: too few days. Its days still join the series. */
export function shortHoldNote(w: Walk): string | null {
  const short = w.folds.flatMap((f, k) => (f.bars < MIN_HOLD ? [k] : []));
  if (!short.length) return null;
  const which = list(short.map((k) => `hold ${k + 1} has ${dayCount(w.folds[k].bars)}`));
  return `A hold's own Sharpe ratio is printed from ${format(MIN_HOLD, "int")} days up: ${which}, so it shows a dash, but its days are in every joined figure.`;
}

/** The fitted constructions whose per-fold weights the reader can pick (equal weight fits nothing). */
export function weightChoices(w: Walk): { value: string; label: string }[] {
  return w.runs.filter((r) => r.id !== "ew").map((r) => ({ value: r.id, label: labelOf(r.id) }));
}

/** One construction's weights in every hold, one row per asset. */
export function weightsTable(a: Analysis, w: Walk, id: Construction): LiveTable | null {
  const run = w.runs.find((r) => r.id === id);
  if (!run) return null;
  const head = (k: number) => `Hold ${k + 1}`;
  return {
    title: `Weights held in each hold: ${labelOf(id)}`,
    columns: [{ key: "ticker", label: "Asset", format: "text", first: true }, ...w.folds.map((_, k): Column => ({ key: `h${k}`, label: head(k), format: "pct1" }))],
    rows: a.tickers.map((t, i) => ({ ticker: t, ...Object.fromEntries(run.weights.map((wt, k) => [`h${k}`, wt ? wt[i] : null])) })),
    span: tableSpan(w.folds[0].fitFirst, w.folds[w.folds.length - 1].fitLast),
    subs: { Asset: rowSub(id, a.allowShort), ...Object.fromEntries(w.folds.map((f, k) => [head(k), `fitted through ${f.fitLast}`])) },
    filename: "walkforward_weights",
  };
}

/**
 * The holds in which a maximum-Sharpe fit found no mix earning more than its fit's rate on the fit window, and
 * what it held there instead, as the scorecard says it of the whole window; null when there is none.
 */
export function belowRateNote(a: Analysis, w: Walk, id: Construction): string | null {
  const run = w.runs.find((r) => r.id === id);
  if (!run) return null;
  const mix = a.allowShort ? "no mix" : "no long-only mix";
  const out = run.beatsRf.flatMap((b, k) => {
    const wt = run.weights[k];
    if (b !== false || !wt) return [];
    const held = wt.map((x, i) => (x > 1e-9 ? i : -1)).filter((i) => i >= 0);
    const what = held.length === 1 ? `${a.tickers[held[0]]} alone` : "the mix whose Sharpe ratio is least negative there";
    const f = w.folds[k];
    return [`In hold ${k + 1}, ${mix} earned more than the ${format(f.fitRate, "pct2")} rate on the fit window through ${f.fitLast}, so it holds ${what}.`];
  });
  return out.length ? `${labelOf(id)}: ${out.join(" ")}` : null;
}

// ---- the sentences ------------------------------------------------------------------------------------------

/** What the window promised against what the held-out days paid, for maximum Sharpe; null without both figures. */
export function decayLine(rows: readonly LiveRow[]): string | null {
  const tan = rows.find((r) => r.key === "tan");
  if (!tan || tan.inSample === null || tan.oos === null) return null;
  return (
    `What the window promised against what the held-out days paid: maximum Sharpe scored ${format(tan.inSample, "num3")} on the whole ` +
    `window it was fitted to, held-out years included, and ${format(tan.oos, "num3")} on days its weights had not seen.`
  );
}

/** Equal weight and the benchmark fit nothing, so their drop is the period alone. */
export const YARDSTICK =
  "Equal weight and the benchmark fit nothing, so the gap between their two columns comes from the period alone, the held-out days " +
  "against the whole window. That gap is the yardstick for the fitted rows' drop.";

/** The typical standard error across the printed out-of-sample figures; null when none is printed. */
export function typicalSE(rows: readonly LiveRow[]): number | null {
  const ses = rows.flatMap((r) => (r.oos !== null && r.se !== null && Number.isFinite(r.se) ? [r.se] : []));
  return ses.length ? ses.reduce((s, x) => s + x, 0) / ses.length : null;
}

/** How much a gap between two out-of-sample figures can carry, with its values read from the run. */
export function seSentence(w: Walk, rows: readonly LiveRow[]): string | null {
  const x = typicalSE(rows);
  if (x === null) return null;
  return (
    `With ${holdCount(w.folds.length)}, ${format(w.heldRows, "int")} held days in all, each out-of-sample Sharpe ratio above carries about ` +
    `±${format(x, "num3")} (one standard error). A gap smaller than about one of them is well inside the noise of either figure; rows held ` +
    `over the same days move together, so this is a scale for reading a gap, not a test of one.`
  );
}

/**
 * On the published run's own terms (a published set, prices from the app's default start through the published
 * last bar, the published rate typed in the rail, long-only, the default schedule), which of the three figures
 * print differently from the published note, and why they can. Null off those terms. The published strings are
 * read from src/content/published.ts and compared with this run's own figures as the table prints them.
 */
export function publishedTermsNote(a: Analysis, plan: RatePlan, w: Walk, opts: WalkOptions, pub: PublishedRun, start: string): string | null {
  const key = (t: readonly string[]) => [...t].sort().join(",");
  const set = PUBLISHED_SETS.find((s) => key(s.tickers) === key(a.tickers));
  if (
    set === undefined ||
    a.requested.start !== start ||
    a.asOf !== pub.lastBar ||
    plan.kind !== "flat" ||
    plan.why !== "typed" ||
    Math.abs(plan.rate - pub.rf) > 1e-12 ||
    a.allowShort ||
    opts.fit !== DEFAULT_WALK.fit ||
    opts.hold !== DEFAULT_WALK.hold
  )
    return null;
  const quoted: Record<"ew" | "gmv" | "tan", string> = { ew: set.ew, gmv: set.gmv, tan: set.tangency };
  const off = (["ew", "gmv", "tan"] as const).flatMap((id) => {
    const run = w.runs.find((r) => r.id === id);
    const here = run && run.sharpe !== null ? format(run.sharpe, "num3") : null;
    if (here === null || here === quoted[id]) return [];
    const name = labelOf(id);
    return [`${name.charAt(0).toLowerCase()}${name.slice(1)}, ${here} where the note prints ${quoted[id]}`];
  });
  const terms = "This is the published run's own set, prices, rate and schedule";
  if (off.length === 0) return `${terms}, and all three figures print as the published note prints them.`;
  return (
    `${terms}, and ${off.length} of the three figures ${off.length === 1 ? "prints" : "print"} differently from the published ` +
    `note: ${off.join("; ")}. This segment solves every fit exactly, on prices as the source serves them today; the published ` +
    `weights are where the app's solver stopped, a little short of the exact solution (the solver note under As published).`
  );
}

/** The one citation: the published test this one repeats on the reader's basket. */
export const CITE_AUTHORS = "DeMiguel, Garlappi and Uppal (2009)";
export const CITE_TITLE = "Optimal Versus Naive Diversification: How Inefficient Is the 1/N Portfolio Strategy?";
