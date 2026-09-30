// How much the optimised weights rest on the expected returns: what-ifs on these prices.
//
// Everything here re-solves the shipping tangency() and gmv() on expected returns that differ from the
// window's sample means, and nothing else. The covariance is always the window's own in-sample estimate,
// and every what-if is a what-if on the same prices: none of it is an out-of-sample result or a forecast.
//
// Units, throughout: `m` is the window's MEAN DAILY return per asset and `S` its DAILY covariance (the
// shapes tangency() and gmv() take); `rf` is the ANNUAL risk-free rate; `T` is the number of daily return
// rows the window's estimates came from. Every expected return this module RETURNS is ANNUAL and a
// decimal (0.12 is 12% a year), and every weight is a decimal fraction of the portfolio (0.45 is 45%).
import { gmv, tangency, type Solution, type Tangency } from "./optimize.ts";
import type { Mat, Vec } from "./num.ts";
import { TRADING_DAYS } from "./stats.ts";
import { DEFAULT_SEED, mulberry32, normals } from "./rng.ts";

// ---- the noise in one expected return ------------------------------------------------------------

/**
 * The standard error of each asset's annualised expected return, from T daily returns: a daily mean
 * has standard error sqrt(S_ii / T), and the annual figure is 252 times the daily mean. Annual decimal.
 */
export function meanStdErrors(S: Mat, T: number): Vec {
  return S.map((row, i) => TRADING_DAYS * Math.sqrt(row[i] / T));
}

/** One asset's annualised expected return with one and two standard errors either side. Annual decimals. */
export interface ReturnBand {
  /** The window's sample estimate. */
  estimate: number;
  /** Its standard error. */
  se: number;
  /** estimate - se and estimate + se: the band drawn on the track. */
  lo1: number;
  hi1: number;
  /** estimate - 2 se and estimate + 2 se: how far a what-if may move it. */
  lo2: number;
  hi2: number;
}

export function returnBand(m: Vec, S: Mat, T: number, asset: number): ReturnBand {
  const estimate = m[asset] * TRADING_DAYS;
  const se = meanStdErrors(S, T)[asset];
  return { estimate, se, lo1: estimate - se, hi1: estimate + se, lo2: estimate - 2 * se, hi2: estimate + 2 * se };
}

/**
 * The index of the largest weight: the largest LONG position when shorting is on, since a short is
 * not a holding in the plain sense. On a tie the first in ticker order wins. -1 for an empty vector.
 */
export function largestHolding(w: Vec): number {
  let best = -1;
  for (let i = 0; i < w.length; i++) if (best < 0 || w[i] > w[best]) best = i;
  return best;
}

/**
 * The largest holding of the maximum-Sharpe portfolio on these estimates, or null when there is no
 * such portfolio (shorting on and nothing inside the box beats the risk-free rate). Long-only with no
 * asset beating the risk-free rate, tangency() returns the least-negative portfolio and this is its
 * largest holding.
 */
export function largestTangencyHolding(m: Vec, S: Mat, rf: number, allowShort: boolean): number | null {
  const t = tangency(m, S, rf, allowShort);
  return t ? largestHolding(t.w) : null;
}

/** A re-solve with one asset's expected return replaced. */
export interface Nudge {
  /** The asset whose expected return was replaced. */
  asset: number;
  /** The annual expected return that was asked for. */
  requested: number;
  /** The one used: `requested` held inside the asset's two-SE range. */
  mu: number;
  /** True when `requested` lay outside that range and was moved to its edge. */
  clamped: boolean;
  /** The asset's own estimate and its one- and two-SE band. */
  band: ReturnBand;
  /** The daily mean vector the solves ran on: the window's, with this one asset replaced. */
  means: Vec;
  /**
   * The maximum-Sharpe portfolio on `means`. Long-only it always answers; when no asset beats the
   * risk-free rate it is the least-negative portfolio and `beatsRf` is false. With shorting on it is
   * null when nothing inside the box beats the risk-free rate.
   */
  tangency: Tangency | null;
  /**
   * The minimum-variance portfolio on the same inputs. It never reads the expected returns, so its
   * weights equal the window's GMV weights whatever the what-if; only its reported return moves.
   * Null only when the solve itself fails, exactly as the window's GMV would.
   */
  gmv: Solution | null;
  /** The largest holding of `tangency`, or null when `tangency` is null. */
  largest: number | null;
}

/**
 * Re-solve the maximum-Sharpe and minimum-variance portfolios with asset `asset`'s annual expected
 * return set to `annualMu`, held to the asset's estimate plus or minus two standard errors. Null when
 * `asset` is not an index into `m` or `annualMu` is not a finite number.
 */
export function nudgeTangency(
  m: Vec,
  S: Mat,
  rf: number,
  allowShort: boolean,
  T: number,
  asset: number,
  annualMu: number,
): Nudge | null {
  if (!Number.isInteger(asset) || asset < 0 || asset >= m.length || !Number.isFinite(annualMu)) return null;
  const band = returnBand(m, S, T, asset);
  const mu = Math.min(band.hi2, Math.max(band.lo2, annualMu));
  const means = m.slice();
  means[asset] = mu / TRADING_DAYS;
  const tan = tangency(means, S, rf, allowShort);
  return {
    asset,
    requested: annualMu,
    mu,
    clamped: mu !== annualMu,
    band,
    means,
    tangency: tan,
    gmv: gmv(means, S, allowShort),
    largest: tan ? largestHolding(tan.w) : null,
  };
}

// ---- redraws: the means drawn again within their own noise ---------------------------------------

/** How many times a redraw re-solves the portfolios. */
export const REDRAWS = 200;

/** The lower-triangular L with L L' = A, for a symmetric positive-definite A; null when A is not. */
export function cholFactor(A: Mat): Mat | null {
  const n = A.length;
  const L: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) return null;
        L[i][i] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

/**
 * `count` daily mean vectors drawn from a normal with mean `m` and covariance S / T: the spread a
 * sample mean of T days has around the true one. Each draw is m + L z / sqrt(T), with L the Cholesky
 * factor of S and z standard normals from the seeded generator, drawn in order, asset by asset. The
 * same seed gives the same draws. Null when S has no Cholesky factor. Daily units, like `m`.
 */
export function drawMeans(m: Vec, S: Mat, T: number, count: number, seed: number = DEFAULT_SEED): Vec[] | null {
  const L = cholFactor(S);
  if (!L) return null;
  const z = normals(mulberry32(seed));
  const n = m.length;
  const scale = 1 / Math.sqrt(T);
  const out: Vec[] = [];
  for (let d = 0; d < count; d++) {
    const zs = Array.from({ length: n }, () => z());
    out.push(m.map((mi, i) => {
      let s = 0;
      for (let k = 0; k <= i; k++) s += L[i][k] * zs[k];
      return mi + s * scale;
    }));
  }
  return out;
}

/**
 * numpy's default percentile ("linear"): sort, then interpolate at position (n - 1) q / 100.
 * `q` runs 0 to 100. NaN for an empty list.
 */
export function percentile(xs: ArrayLike<number>, q: number): number {
  const a = Array.from(xs).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const pos = ((a.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/** One portfolio's weights across the redraws. */
export interface Strip {
  /** Per draw, in draw order: the solved weights, or null where that draw's solve failed. */
  w: (Vec | null)[];
  /** How many draws solved. */
  solved: number;
  /** Per asset: its weight in every solved draw, in draw order. */
  weights: Vec[];
  /** Per asset: the 10th and 90th percentiles of those weights (numpy linear); NaN when none solved. */
  p10: Vec;
  p90: Vec;
  /** Per asset: in how many solved draws it was the largest holding (ties go to the first ticker). */
  largest: number[];
}

function strip(ws: (Vec | null)[], n: number): Strip {
  const ok = ws.filter((w): w is Vec => w !== null);
  const weights = Array.from({ length: n }, (_, i) => ok.map((w) => w[i]));
  const largest = new Array<number>(n).fill(0);
  for (const w of ok) largest[largestHolding(w)] += 1;
  return {
    w: ws,
    solved: ok.length,
    weights,
    p10: weights.map((xs) => percentile(xs, 10)),
    p90: weights.map((xs) => percentile(xs, 90)),
    largest,
  };
}

/** The portfolios re-solved on each of `count` redrawn mean vectors. */
export interface Redraws {
  seed: number;
  count: number;
  /** Per draw: the drawn expected return of each asset, annual decimal. */
  means: Vec[];
  /** The maximum-Sharpe portfolio on each draw (a draw with shorting on can fail: then null). */
  tan: Strip;
  /** Solved maximum-Sharpe draws whose best mix still does not beat the risk-free rate (long-only). */
  belowRf: number;
  /** The minimum-variance portfolio on each draw; it never reads the means, so every draw agrees. */
  gmv: Strip;
}

/**
 * Draw the mean vector `count` times from N(m, S / T) with the seeded generator and re-solve both
 * optimised portfolios on each draw, the covariance held at its in-sample estimate. Null when S has
 * no Cholesky factor. Long-only with no asset beating the risk-free rate, a draw's tangency is the
 * least-negative portfolio and is counted in `belowRf`; with shorting on, a draw on which nothing
 * inside the box beats the risk-free rate has no tangency and its entry is null.
 */
export function redraw(
  m: Vec,
  S: Mat,
  rf: number,
  allowShort: boolean,
  T: number,
  count: number = REDRAWS,
  seed: number = DEFAULT_SEED,
): Redraws | null {
  const draws = drawMeans(m, S, T, count, seed);
  if (!draws) return null;
  const tans = draws.map((d) => tangency(d, S, rf, allowShort));
  const gmvs = draws.map((d) => gmv(d, S, allowShort));
  return {
    seed,
    count,
    means: draws.map((d) => d.map((x) => x * TRADING_DAYS)),
    tan: strip(tans.map((t) => (t ? t.w : null)), m.length),
    belowRf: tans.filter((t) => t && !t.beatsRf).length,
    gmv: strip(gmvs.map((g) => (g ? g.w : null)), m.length),
  };
}

// ---- fragility: four rows per portfolio -----------------------------------------------------------

/** The four portfolios the rows describe. Equal weight and a custom mix are fixed: nothing is solved. */
export type Construction = "ew" | "custom" | "gmv" | "tan";

/** Row 1: the widest range any one asset's weight covers across the lookback windows. */
export interface LookbackSpread {
  /** The asset with the widest range. For a fixed portfolio: null, and so are lo and hi. */
  asset: number | null;
  lo: number | null;
  hi: number | null;
  /** hi - lo, decimal (0.61 is 61 percentage points). */
  spread: number;
}

/**
 * Given one weight vector per lookback window (null where that window's solve failed), the asset whose
 * weight moves most across the windows that solved, with its lowest and highest weight. Ties go to the
 * first ticker. Null when fewer than two windows solved.
 */
export function lookbackSpread(perWindow: (Vec | null)[]): LookbackSpread | null {
  const ok = perWindow.filter((w): w is Vec => w !== null);
  if (ok.length < 2) return null;
  let best: LookbackSpread | null = null;
  for (let i = 0; i < ok[0].length; i++) {
    const xs = ok.map((w) => w[i]);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    if (!best || hi - lo > best.spread) best = { asset: i, lo, hi, spread: hi - lo };
  }
  return best;
}

/** Row 2: the largest holding once its own expected return is cut by one standard error. */
export interface CutRow {
  /** The largest holding before the cut, and its weight. For a fixed portfolio every field but drop is null. */
  from: number | null;
  weightBefore: number | null;
  /** The same asset's weight after the cut. */
  weightAfter: number | null;
  /** weightBefore - weightAfter, decimal. */
  drop: number;
  /** The largest holding after the cut, and its weight. */
  to: number | null;
  toWeight: number | null;
}

/**
 * Cut the portfolio's largest holding's expected return by one standard error, re-solve, and say what
 * the largest holding is then. Null when the solve fails before or after the cut (shorting on and
 * nothing inside the box beats the risk-free rate).
 */
export function cutLargest(
  kind: "gmv" | "tan",
  m: Vec,
  S: Mat,
  rf: number,
  allowShort: boolean,
  T: number,
): CutRow | null {
  const base = kind === "tan" ? tangency(m, S, rf, allowShort) : gmv(m, S, allowShort);
  if (!base) return null;
  const from = largestHolding(base.w);
  const band = returnBand(m, S, T, from);
  const cut = nudgeTangency(m, S, rf, allowShort, T, from, band.lo1);
  const after = cut && (kind === "tan" ? cut.tangency : cut.gmv);
  if (!after) return null;
  const to = largestHolding(after.w);
  return {
    from,
    weightBefore: base.w[from],
    weightAfter: after.w[from],
    drop: base.w[from] - after.w[from],
    to,
    toWeight: after.w[to],
  };
}

/** Row 3: the 10th to 90th percentile of the largest holding's weight across the redraws. */
export interface DrawRow {
  /** The largest holding on the window's own estimates. For a fixed portfolio: null, and so are p10 and p90. */
  asset: number | null;
  p10: number | null;
  p90: number | null;
  /** p90 - p10, decimal. */
  width: number;
}

/** Row 3 for one solved portfolio: its strip's percentiles for asset `asset`. Null when no draw solved. */
export function drawSpread(s: Strip, asset: number): DrawRow | null {
  if (!s.solved) return null;
  return { asset, p10: s.p10[asset], p90: s.p90[asset], width: s.p90[asset] - s.p10[asset] };
}

/**
 * Row 4: how many parameters the portfolio's weights were estimated from. Minimum variance reads the
 * covariance only (n variances and n(n - 1)/2 covariances); maximum Sharpe reads the n expected returns
 * too. Equal weight and a custom mix estimate nothing.
 */
export function paramCount(kind: Construction, n: number): number {
  if (kind === "gmv") return (n * (n + 1)) / 2;
  if (kind === "tan") return n + (n * (n + 1)) / 2;
  return 0;
}

/** The four rows for one portfolio. A null row means the solve it needs failed. */
export interface Fragility {
  lookback: LookbackSpread | null;
  cut: CutRow | null;
  draws: DrawRow | null;
  /** Row 4: parameters estimated, and the daily return rows they were estimated from. */
  params: number;
  days: number;
}

export interface FragilityInput {
  m: Vec;
  S: Mat;
  rf: number;
  allowShort: boolean;
  T: number;
  /** This portfolio's weights on each lookback window (null where a window's solve failed). */
  lookbacks: (Vec | null)[];
  /** The redraws from redraw() on the same inputs, or null when there are none. */
  redraws: Redraws | null;
}

/**
 * The four fragility rows for one portfolio. Equal weight and a custom mix are the same weights on
 * every window, every what-if and every draw, so their rows 1-3 are zero by construction and are
 * returned as zero, not computed.
 */
export function fragility(kind: Construction, x: FragilityInput): Fragility {
  const n = x.m.length;
  const days = x.T;
  if (kind === "ew" || kind === "custom") {
    return {
      lookback: { asset: null, lo: null, hi: null, spread: 0 },
      cut: { from: null, weightBefore: null, weightAfter: null, drop: 0, to: null, toWeight: null },
      draws: { asset: null, p10: null, p90: null, width: 0 },
      params: 0,
      days,
    };
  }
  const base = kind === "tan" ? tangency(x.m, x.S, x.rf, x.allowShort) : gmv(x.m, x.S, x.allowShort);
  const s = x.redraws ? (kind === "tan" ? x.redraws.tan : x.redraws.gmv) : null;
  return {
    lookback: lookbackSpread(x.lookbacks),
    cut: cutLargest(kind, x.m, x.S, x.rf, x.allowShort, x.T),
    draws: base && s ? drawSpread(s, largestHolding(base.w)) : null,
    params: paramCount(kind, n),
    days,
  };
}
