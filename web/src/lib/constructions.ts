// Four more ways to build a portfolio from the same window, for the scorecard's added columns.
//
//   tan.1y   maximum Sharpe on the last year of the window only
//   tan.bs   maximum Sharpe on Bayes-Stein shrunk means (Jorion, 1986)
//   tan.cap  maximum Sharpe, long-only, no weight above CAP
//   rp       risk parity: every asset contributes the same share of the portfolio's variance
//
// Every one of them is solved on the same prices it is then shown on, so each is an in-sample
// construction like the tangency column, and nothing here ranks them.
//
// Units, throughout, are the engine's: `m` is the MEAN DAILY return per asset, `S` the DAILY covariance
// (ddof 1), `T` the number of daily return rows they came from, `rf` the ANNUAL risk-free rate. The
// weights are decimal fractions summing to 1; a Solution's mu and sigma are annual decimals.
import { cholSolve, dot, sum, type Mat, type Vec } from "./num.ts";
import { riskParity, tangency, tangencyCapped, type Solution } from "./optimize.ts";
import { windowMoments } from "./portfolio.ts";
import { loadVerdict, TRADING_DAYS } from "./stats.ts";

export type AddedId = "tan.1y" | "tan.bs" | "tan.cap" | "rp";

/** The added constructions, in the order the scorecard offers them. */
export const ADDED_IDS: readonly AddedId[] = ["tan.1y", "tan.bs", "tan.cap", "rp"];

export function isAddedId(x: string): x is AddedId {
  return (ADDED_IDS as readonly string[]).includes(x);
}

/** The last-year window: 252 daily return rows, ending on the window's last day. */
export const YEAR_ROWS = TRADING_DAYS;

/** The capped construction's largest weight, a decimal (0.25 is 25%). */
export const CAP = 0.25;

/** Below five assets a 25% cap forces equal weight (four) or leaves no mix at all (fewer). */
export const CAP_MIN_ASSETS = 5;

/**
 * Why a construction cannot be offered on this window. These are identifiers, not page copy.
 *   window-is-one-year  the window holds 252 rows or fewer, so the last year is the whole window
 *   year-too-thin       the last year is too few days per asset to estimate (loadVerdict refuses it)
 *   too-few-rows        T <= n + 2, where the Bayes-Stein intensity is undefined
 *   too-few-assets      fewer than CAP_MIN_ASSETS assets for the cap
 */
export type Unavailable = "window-is-one-year" | "year-too-thin" | "too-few-rows" | "too-few-assets";

/** Null when construction `id` can be offered on T daily return rows of n assets, else the reason. */
export function unavailable(id: AddedId, T: number, n: number): Unavailable | null {
  switch (id) {
    case "tan.1y":
      if (T <= YEAR_ROWS) return "window-is-one-year";
      return loadVerdict(YEAR_ROWS, n) === "refuse" ? "year-too-thin" : null;
    case "tan.bs":
      return T > n + 2 ? null : "too-few-rows";
    case "tan.cap":
      return n >= CAP_MIN_ASSETS ? null : "too-few-assets";
    case "rp":
      return null;
  }
}

/** unavailable() for every added construction at once. */
export function availability(T: number, n: number): Record<AddedId, Unavailable | null> {
  return {
    "tan.1y": unavailable("tan.1y", T, n),
    "tan.bs": unavailable("tan.bs", T, n),
    "tan.cap": unavailable("tan.cap", T, n),
    rp: unavailable("rp", T, n),
  };
}

/** The moments a construction is estimated from: daily means, daily covariance, and their row count. */
export interface Moments {
  m: Vec;
  S: Mat;
  T: number;
}

/**
 * The window construction `id` reads. The last-year construction reads the LAST 252 rows of `cols` (one
 * daily return column per asset) and T = 252; the others read every row. Callers check unavailable()
 * first: with 252 rows or fewer, the last year is the whole window.
 */
export function ownWindow(id: AddedId, cols: Vec[]): Moments {
  if (id === "tan.1y") {
    const { m, S } = windowMoments(cols, YEAR_ROWS);
    return { m, S, T: YEAR_ROWS };
  }
  const T = cols[0].length;
  const { m, S } = windowMoments(cols, T);
  return { m, S, T };
}

/** Bayes-Stein shrunk means, with how far they were shrunk and toward what. */
export interface Shrunk {
  /** The shrunk means, daily decimals: (1 - phi) m + phi mu0. */
  means: Vec;
  /** The shrinkage intensity, 0 to 1 (0 keeps the sample means, 1 replaces them all with mu0). */
  phi: number;
  /** The target, a daily decimal: the mean return of the unconstrained minimum-variance portfolio. */
  mu0: number;
}

/**
 * Jorion's (1986) Bayes-Stein estimator of the means, on daily moments from T daily rows. The covariance
 * it weighs distances with is S (T - 1) / (T - n - 2); every mean is pulled toward one target, mu0 =
 * 1'Sigma^-1 m / 1'Sigma^-1 1, the mean return of the minimum-variance portfolio with no bounds (whatever
 * the shorting switch: the target is a statistic of the window, not a portfolio on offer), by
 *   phi = (n + 2) / ((n + 2) + T (m - mu0 1)' Sigma^-1 (m - mu0 1)).
 * Null when T <= n + 2, where that covariance is undefined, or when it is not positive definite.
 */
export function bayesStein(m: Vec, S: Mat, T: number): Shrunk | null {
  const n = m.length;
  if (!(T > n + 2)) return null;
  const Sig = S.map((row) => row.map((v) => (v * (T - 1)) / (T - n - 2)));
  const a = cholSolve(Sig, new Array<number>(n).fill(1));
  if (!a) return null;
  const mu0 = dot(a, m) / sum(a);
  const d = m.map((x) => x - mu0);
  const b = cholSolve(Sig, d);
  if (!b) return null;
  const phi = (n + 2) / (n + 2 + T * dot(d, b));
  return { means: m.map((x) => (1 - phi) * x + phi * mu0), phi, mu0 };
}

/** One added construction solved on its own window's moments. */
export interface AddedSolution extends Solution {
  id: AddedId;
  /**
   * The tangency constructions: true when the mix earns more than the risk-free rate on the means it was
   * solved with (long-only, the last-year and shrunk-mean tangencies can return the least-negative mix, as
   * the tangency column does). Risk parity reads no means: null.
   */
  beatsRf: boolean | null;
  /** tan.bs only: the shrunk means, the intensity and the target. Null for the others. */
  shrink: Shrunk | null;
}

/**
 * Solve construction `id` on its OWN window's moments (ownWindow(id, cols) gives them). mu and sigma are
 * annual decimals on the means the weights were solved with: for tan.bs the shrunk means, for tan.1y the
 * last year's. The shorting switch reaches only the last-year and shrunk-mean tangencies; the capped
 * tangency and risk parity are long-only whatever it says. Null when the solve has no answer: shorting on
 * and nothing inside the box beats the risk-free rate (tan.1y, tan.bs), no capped mix beats it (tan.cap),
 * T <= n + 2 (tan.bs), or a failed solve.
 */
export function solveAdded(
  id: AddedId,
  m: Vec,
  S: Mat,
  T: number,
  rf: number,
  allowShort: boolean,
): AddedSolution | null {
  switch (id) {
    case "tan.1y": {
      const t = tangency(m, S, rf, allowShort);
      return t && { id, w: t.w, mu: t.mu, sigma: t.sigma, beatsRf: t.beatsRf, shrink: null };
    }
    case "tan.bs": {
      const shrink = bayesStein(m, S, T);
      const t = shrink && tangency(shrink.means, S, rf, allowShort);
      return t && { id, w: t.w, mu: t.mu, sigma: t.sigma, beatsRf: t.beatsRf, shrink };
    }
    case "tan.cap": {
      const t = tangencyCapped(m, S, rf, CAP);
      return t && { id, w: t.w, mu: t.mu, sigma: t.sigma, beatsRf: t.beatsRf, shrink: null };
    }
    case "rp": {
      const r = riskParity(m, S);
      return r && { id, w: r.w, mu: r.mu, sigma: r.sigma, beatsRf: null, shrink: null };
    }
  }
}
