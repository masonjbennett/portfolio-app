// Resampled maximum Sharpe (Michaud, 1998, Efficient Asset Management): the scorecard's tan.rs column. The window's
// return rows are bootstrapped, maximum Sharpe is re-solved on each draw's own means and covariance, and the weights
// are averaged across the draws. One solve on one window rests on averages that are a little off; the average of
// many solves on reshuffled months leans less on any one of them.
//
// Method (handoff-course-additions.md, C4, decided Oct 15 2026):
//   - The rows are drawn by the Range of outcomes' block bootstrap (blockRows in ./simulate.ts): blocks of BLOCK_DAYS
//     contiguous rows, every asset on the same days, strung together to the window's own length, seeded through
//     ./rng.ts. The Range of outcomes' PATHS draws, so the two simulations on the page draw alike.
//   - Each draw's means and covariance (ddof 1) are those of its rows. They are read from running sums over the
//     window's rows, centred on the window's means, so a draw costs one subtraction per block, not a pass over
//     every row; the figures are those of the drawn rows to rounding (t-resample holds them to a direct pass).
//   - A draw counts when its maximum-Sharpe mix earns more than the risk-free rate on that draw. Where none does
//     (long-only and no asset's mean above the rate, or shorting on and none in the box), there is no tangency to
//     average, so the draw is left out and counted as such. Long-only, the tangency column then holds the least
//     negative mix; averaging those would average portfolios no one would choose, and finding each costs up to
//     2^n - 1 solves.
//   - The weights are the plain average over the counted draws, so they sum to 1; each asset's 10th and 90th
//     percentile across the same draws is reported beside it (numpy linear, as the redraws).
//   - `m`, when given, is where each draw's means are centred: a draw's means are m plus how far its rows' averages
//     sit from the window's. With the window's own means that is the plain bootstrap; the cut row passes means
//     with one asset lowered, and every draw is moved by the same amount.
// In-sample like every added column: the rows it resamples are the rows it is then shown on.
import { mean, type Vec } from "./num.ts";
import { tangency } from "./optimize.ts";
import { percentile } from "./robust.ts";
import { DEFAULT_SEED, mulberry32 } from "./rng.ts";
import { BLOCK_DAYS, blockRows, PATHS } from "./simulate.ts";
import { TRADING_DAYS } from "./stats.ts";

// The draw count is the Range of outcomes' PATHS, read when a resample runs and never copied into a constant here: this
// module sits on an import cycle (./simulate.ts -> ./robust.ts -> ./constructions.ts -> here), so a top-level read of
// PATHS can run before ./simulate.ts has set it. Callers that name the count import PATHS from ./simulate.ts.

/** A resampled maximum-Sharpe mix: the averaged weights and their spread across the draws. */
export interface Resampled {
  /** The average of the counted draws' maximum-Sharpe weights, decimal fractions summing to 1. */
  w: Vec;
  /** Per asset, the 10th and 90th percentile of its weight across the counted draws. */
  p10: Vec;
  p90: Vec;
  /** Draws made, and draws whose maximum-Sharpe mix earned more than the risk-free rate (the ones averaged). */
  draws: number;
  counted: number;
}

export interface ResampleOptions {
  draws?: number;
  seed?: number;
  block?: number;
  /** The means each draw is centred on (daily); the window's own when absent. */
  m?: Vec;
}

/**
 * Resample maximum Sharpe on `cols` (one daily return column per asset, all the same length) at the annual rate
 * `rf`. Null when the window is shorter than one block, or when no draw counted.
 */
export function resample(cols: Vec[], rf: number, allowShort: boolean, opts: ResampleOptions = {}): Resampled | null {
  const n = cols.length;
  const T = cols[0].length;
  const draws = opts.draws ?? PATHS;
  const block = opts.block ?? BLOCK_DAYS;
  if (T < block || T < 2) return null;
  const bar = cols.map(mean);
  const centre = opts.m ?? bar;
  // Running sums of the centred rows and of their pairwise products (upper triangle), one entry per row boundary.
  const K = (n * (n + 1)) / 2;
  const P = new Float64Array((T + 1) * n);
  const Q = new Float64Array((T + 1) * K);
  const x = new Float64Array(n);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < n; i++) {
      x[i] = cols[i][t] - bar[i];
      P[(t + 1) * n + i] = P[t * n + i] + x[i];
    }
    for (let i = 0, k = 0; i < n; i++) for (let j = i; j < n; j++, k++) Q[(t + 1) * K + k] = Q[t * K + k] + x[i] * x[j];
  }
  const uniform = mulberry32(opts.seed ?? DEFAULT_SEED);
  const daily = rf / TRADING_DAYS;
  const sd = new Float64Array(n);
  const sq = new Float64Array(K);
  const kept: Vec[] = [];
  for (let p = 0; p < draws; p++) {
    const idx = blockRows(T, T, uniform, block);
    sd.fill(0);
    sq.fill(0);
    // Each run of consecutive rows (a block, or two that happen to abut) is one difference of the running sums.
    for (let d = 0; d < T; ) {
      const s = idx[d];
      let len = 1;
      while (d + len < T && idx[d + len] === s + len) len++;
      const a = s * n;
      const b = (s + len) * n;
      for (let i = 0; i < n; i++) sd[i] += P[b + i] - P[a + i];
      const qa = s * K;
      const qb = (s + len) * K;
      for (let k = 0; k < K; k++) sq[k] += Q[qb + k] - Q[qa + k];
      d += len;
    }
    const m = centre.map((c, i) => c + sd[i] / T);
    if (!allowShort && !m.some((v) => v > daily)) continue;
    const S: Vec[] = Array.from({ length: n }, () => new Array<number>(n));
    for (let i = 0, k = 0; i < n; i++) {
      for (let j = i; j < n; j++, k++) S[i][j] = S[j][i] = (sq[k] - (sd[i] * sd[j]) / T) / (T - 1);
    }
    const t = tangency(m, S, rf, allowShort);
    if (t && t.beatsRf) kept.push(t.w);
  }
  if (!kept.length) return null;
  const w = bar.map((_, i) => kept.reduce((acc, k) => acc + k[i], 0) / kept.length);
  const col = (i: number) => kept.map((k) => k[i]);
  return {
    w,
    p10: w.map((_, i) => percentile(col(i), 10)),
    p90: w.map((_, i) => percentile(col(i), 90)),
    draws,
    counted: kept.length,
  };
}
