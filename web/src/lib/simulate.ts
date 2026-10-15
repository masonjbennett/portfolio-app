// The range of outcomes: a block bootstrap of the window's own daily returns, so the reader sees how wide the endings
// of a few years can be if the future reshuffles the past's months. It is a spread under that one assumption, never a
// forecast: it cannot hold a month the window did not have, and it simulates no further out than the window is long.
//
// Method (handoff-montecarlo.md, decided Oct 14 2026):
//   - Blocks of BLOCK_DAYS contiguous return rows (about one month), drawn with replacement and strung together. A
//     block is a run of whole rows, every asset and the benchmark on the same days, so correlations and the shape of
//     a crash survive inside it. No normal or other parametric draw anywhere.
//   - The same rows drive every line on a path: each line's daily series is computed first (a mix rebalanced daily to
//     fixed weights, or the benchmark), then every series is read at the one list of rows the path drew.
//   - Which mixes: the equal split and the lowest-risk mix, neither of which uses the noisy average returns. The
//     best-tradeoff mix is left out: its weights come from the same window's average returns, so reshuffling those
//     months would replay the hindsight the walk-forward test exposes (outcomeLines never passes a tangency).
//   - PATHS paths seeded through mulberry32, so the page and any re-run agree; each line reports $START's ending at
//     the 10th, 50th and 90th percentiles at every monthly checkpoint.
// Pure functions, no React: the card is src/tabs/walkforward/Outcomes.tsx.
import { DEFAULT_SEED, mulberry32 } from "./rng.ts";
import { portfolioReturns } from "./portfolio.ts";
import { percentile } from "./robust.ts";
import { TRADING_DAYS } from "./stats.ts";
import type { Vec } from "./num.ts";

/** Rows per block: one trading month. */
export const BLOCK_DAYS = 21;
/** Rows between checkpoints: the fan is read once a month. */
export const CHECK_DAYS = 21;
/** Paths per fan. */
export const PATHS = 2000;
/** The amount each path starts with. */
export const START = 10_000;
/** The horizons offered, in years, and the one shown first. */
export const HORIZONS = [1, 3, 5] as const;
export type Horizon = (typeof HORIZONS)[number];
export const DEFAULT_HORIZON: Horizon = 3;
/** The percentiles reported: the band is the 10th to the 90th, so eight paths in ten end inside it. */
export const BAND = [10, 50, 90] as const;

/** The horizons a window of `rows` return rows can offer: never further out than the window is long. */
export function horizonsFor(rows: number): Horizon[] {
  return HORIZONS.filter((h) => h * TRADING_DAYS <= rows);
}

/** The horizon to show: the one asked for if the window allows it, else the longest it allows; null under a year. */
export function horizonFor(rows: number, wanted: Horizon = DEFAULT_HORIZON): Horizon | null {
  const ok = horizonsFor(rows);
  if (ok.includes(wanted)) return wanted;
  return ok.length ? ok[ok.length - 1] : null;
}

/**
 * One path's rows: `days` row indices into a window of `rows` rows, made of blocks of `block` contiguous rows whose
 * starts are drawn uniformly from the window (a moving-block bootstrap, no wrap-around). The last block is cut short
 * to end on `days`.
 */
export function blockRows(rows: number, days: number, uniform: () => number, block = BLOCK_DAYS): Int32Array {
  const out = new Int32Array(days);
  const starts = rows - block + 1;
  for (let d = 0; d < days; ) {
    const s = Math.floor(uniform() * starts);
    for (let k = 0; k < block && d < days; k++, d++) out[d] = s + k;
  }
  return out;
}

/** One line of the fan: $START's ending at each checkpoint's 10th, 50th and 90th percentiles. */
export interface FanLine {
  key: string;
  p10: number[];
  p50: number[];
  p90: number[];
  /** Every path's ending at the horizon, in path order (the tests read it; the card does not). */
  endings: Float64Array;
}

export interface Fan {
  /** The horizon in years, and in return rows. */
  horizon: number;
  days: number;
  /** Months from the start at each checkpoint, 0 first (where every path is $START). */
  months: number[];
  lines: FanLine[];
  paths: number;
}

export interface SimOptions {
  paths?: number;
  seed?: number;
  block?: number;
}

/**
 * The fan of `series` (one daily return series per line, all aligned on the same rows) over `horizon` years. Every
 * path draws ONE list of rows and every line reads its own series at those rows, so the lines stay joint.
 */
export function simulate(series: { key: string; r: Vec }[], horizon: number, opts: SimOptions = {}): Fan {
  const paths = opts.paths ?? PATHS;
  const block = opts.block ?? BLOCK_DAYS;
  const rows = series[0].r.length;
  const days = horizon * TRADING_DAYS;
  if (days > rows) throw new Error(`simulate: ${horizon} years is longer than the window's ${rows} rows`);
  const checks = Math.floor(days / CHECK_DAYS);
  const months = Array.from({ length: checks + 1 }, (_, i) => i);
  // at[line][checkpoint][path]: each path's wealth at each checkpoint after the start.
  const at = series.map(() => Array.from({ length: checks }, () => new Float64Array(paths)));
  const endings = series.map(() => new Float64Array(paths));
  const uniform = mulberry32(opts.seed ?? DEFAULT_SEED);
  const wealth = new Float64Array(series.length);
  for (let p = 0; p < paths; p++) {
    const idx = blockRows(rows, days, uniform, block);
    wealth.fill(START);
    for (let d = 0; d < days; d++) {
      const t = idx[d];
      for (let j = 0; j < series.length; j++) wealth[j] *= 1 + series[j].r[t];
      if ((d + 1) % CHECK_DAYS === 0) {
        const c = (d + 1) / CHECK_DAYS - 1;
        for (let j = 0; j < series.length; j++) at[j][c][p] = wealth[j];
      }
    }
    for (let j = 0; j < series.length; j++) endings[j][p] = wealth[j];
  }
  // Sorted once here, so percentile's own sort runs over data already in order.
  const lines = series.map((s, j) => {
    const p10 = [START];
    const p50 = [START];
    const p90 = [START];
    for (const xs of at[j]) {
      const sorted = xs.slice().sort();
      p10.push(percentile(sorted, BAND[0]));
      p50.push(percentile(sorted, BAND[1]));
      p90.push(percentile(sorted, BAND[2]));
    }
    return { key: s.key, p10, p50, p90, endings: endings[j] };
  });
  return { horizon, days, months, lines, paths };
}

/** The lines the page simulates: what an analysis carries, read without anything fitted on average returns. */
export interface OutcomeInput {
  returns: Vec[];
  bench: Vec;
  ew: Vec;
  /** The lowest-risk mix's weights, or null where its solve failed. */
  gmv: { w: Vec } | null;
}

export type OutcomeKey = "ew" | "gmv" | "bench";

/**
 * The equal split, the lowest-risk mix (when it solved) and the benchmark, each as its daily return series on the
 * window's rows. The best-tradeoff mix is never among them: see the method at the top of this file.
 */
export function outcomeLines(a: OutcomeInput): { key: OutcomeKey; w: Vec | null; r: Vec }[] {
  const out: { key: OutcomeKey; w: Vec | null; r: Vec }[] = [{ key: "ew", w: a.ew, r: portfolioReturns(a.returns, a.ew) }];
  if (a.gmv) out.push({ key: "gmv", w: a.gmv.w, r: portfolioReturns(a.returns, a.gmv.w) });
  out.push({ key: "bench", w: null, r: a.bench });
  return out;
}

/** The fan an analysis shows at `horizon`, or null when the window is shorter than that horizon. */
export function outcomes(a: OutcomeInput, horizon: number, opts: SimOptions = {}): Fan | null {
  if (horizon * TRADING_DAYS > a.bench.length) return null;
  return simulate(outcomeLines(a), horizon, opts);
}
