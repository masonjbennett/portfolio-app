// Six more ways to build a portfolio from the same window, for the scorecard's added columns.
//
//   tan.1y   maximum Sharpe on the last year of the window only
//   tan.bs   maximum Sharpe on Bayes-Stein shrunk means (Jorion, 1986)
//   tan.lw   maximum Sharpe on the Ledoit-Wolf shrunk covariance, constant-correlation target (2004)
//   tan.rs   resampled maximum Sharpe: the average of the maximum-Sharpe weights over block-bootstrapped
//            copies of the window's rows (Michaud, 1998; ./resample.ts)
//   tan.cap  maximum Sharpe, long-only, no weight above CAP
//   rp       risk parity: every asset contributes the same share of the portfolio's variance
//
// Every one of them is solved on the same prices it is then shown on, so each is an in-sample
// construction like the tangency column, and nothing here ranks them.
//
// Units, throughout, are the engine's: `m` is the MEAN DAILY return per asset, `S` the DAILY covariance
// (ddof 1), `T` the number of daily return rows they came from, `rf` the ANNUAL risk-free rate. The
// weights are decimal fractions summing to 1; a Solution's mu and sigma are annual decimals.
import { cholSolve, covMatrix, dot, mean, sum, type Mat, type Vec } from "./num.ts";
import { perf, riskParity, tangency, tangencyCapped, type Solution } from "./optimize.ts";
import { resample, type Resampled } from "./resample.ts";
import { windowMoments } from "./portfolio.ts";
import { loadVerdict } from "./stats.ts";
import { CAP, CAP_MIN_ASSETS, YEAR_ROWS, type AddedId } from "./added.ts";

// The ids, their order, the guard and the three numbers that define the constructions (YEAR_ROWS, CAP,
// CAP_MIN_ASSETS) live in ./added.ts, which imports no solver; they are re-exported here so every import
// of them from this module stays as it was.
export { ADDED_IDS, CAP, CAP_MIN_ASSETS, isAddedId, YEAR_ROWS, type AddedId } from "./added.ts";

/**
 * Why a construction cannot be offered on this window. These are identifiers, not page copy.
 *   window-is-one-year  the window holds 252 rows or fewer, so the last year is the whole window
 *   year-too-thin       the last year is too few days per asset to estimate (loadVerdict refuses it)
 *   too-few-rows        T <= n + 2, where the Bayes-Stein intensity is undefined
 *   too-few-assets      fewer than CAP_MIN_ASSETS assets for the cap
 *   one-correlation     two assets: the constant-correlation target's one correlation is the sample's own
 */
export type Unavailable = "window-is-one-year" | "year-too-thin" | "too-few-rows" | "too-few-assets" | "one-correlation";

/** Null when construction `id` can be offered on T daily return rows of n assets, else the reason. */
export function unavailable(id: AddedId, T: number, n: number): Unavailable | null {
  switch (id) {
    case "tan.1y":
      if (T <= YEAR_ROWS) return "window-is-one-year";
      return loadVerdict(YEAR_ROWS, n) === "refuse" ? "year-too-thin" : null;
    case "tan.bs":
      return T > n + 2 ? null : "too-few-rows";
    case "tan.lw":
      return n >= 3 ? null : "one-correlation";
    case "tan.rs":
      return null;
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
    "tan.lw": unavailable("tan.lw", T, n),
    "tan.rs": unavailable("tan.rs", T, n),
    "tan.cap": unavailable("tan.cap", T, n),
    rp: unavailable("rp", T, n),
  };
}

/** The moments a construction is estimated from: daily means, daily covariance, and their row count. */
export interface Moments {
  m: Vec;
  S: Mat;
  T: number;
  /** tan.lw only: the shrinkage that made S (S is then the shrunk matrix, not the sample one). */
  lw?: LedoitWolf;
  /** tan.rs only: the daily return columns m and S came from, which it resamples (solveAdded takes them). */
  rows?: Vec[];
}

/**
 * The window construction `id` reads. The last-year construction reads the LAST 252 rows of `cols` (one
 * daily return column per asset) and T = 252; the others read every row. The Ledoit-Wolf construction's S is
 * the shrunk covariance of those rows (ledoitWolf), so whatever re-solves it on its own window (the walk-forward
 * folds, the cut and redraw rows, which keep S and move the means) reads the shrunk matrix too. Callers check
 * unavailable() first: with 252 rows or fewer, the last year is the whole window.
 */
export function ownWindow(id: AddedId, cols: Vec[]): Moments {
  if (id === "tan.1y") {
    const { m, S } = windowMoments(cols, YEAR_ROWS);
    return { m, S, T: YEAR_ROWS };
  }
  const T = cols[0].length;
  const { m, S } = windowMoments(cols, T);
  if (id === "tan.lw") {
    const lw = ledoitWolf(cols);
    return { m, S: lw.S, T, lw };
  }
  if (id === "tan.rs") return { m, S, T, rows: cols };
  return { m, S, T };
}

/** The Ledoit-Wolf shrunk covariance, with how far it was shrunk and the target's one correlation. */
export interface LedoitWolf {
  /** The shrunk covariance, daily: (1 - intensity) S + intensity F, on the engine's S (ddof 1). */
  S: Mat;
  /** The shrinkage intensity, 0 to 1 (0 keeps the sample covariance, 1 replaces it with the target). */
  intensity: number;
  /** The target's correlation: the average of the sample correlations between distinct assets. */
  rBar: number;
}

/**
 * Ledoit and Wolf (2004), "Honey, I Shrunk the Sample Covariance Matrix", on daily return columns. The target F
 * keeps every asset's own variance and sets every correlation to rBar, their average; the intensity is the
 * paper's estimate of the one that minimises the expected squared distance to the true matrix, computed as the
 * authors' covCor.m does (moments over T, on demeaned returns):
 *   intensity = max(0, min(1, (pi - rho) / gamma / T)),
 * pi the summed asymptotic variances of the sample covariances, rho their covariance with the target's entries,
 * gamma the squared distance from the sample matrix to the target. That intensity is applied to the engine's S
 * (ddof 1) and the target built from it, so the diagonal is S's. With fewer than 3 assets the target's one
 * correlation is the sample's own, so the target IS the sample matrix (gamma is zero but for rounding, which would
 * read as any intensity at all); there, and wherever the estimate is not a number, the intensity is 0 and S is returned.
 * test/fixtures/ledoit-wolf.json holds it to a numpy implementation (test/oracle/ledoit_wolf.py).
 */
export function ledoitWolf(cols: Vec[]): LedoitWolf {
  const n = cols.length;
  const T = cols[0].length;
  const d = cols.map((c) => {
    const mu = mean(c);
    return c.map((v) => v - mu);
  });
  const s: Mat = d.map((di) => d.map((dj) => dot(di, dj) / T));
  const sd = s.map((row, i) => Math.sqrt(row[i]));
  let rSum = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) rSum += s[i][j] / (sd[i] * sd[j]);
  const rBar = rSum / (n * (n - 1));
  let pi = 0;
  let rho = 0;
  let gamma = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sq = 0;
      let cube = 0;
      for (let t = 0; t < T; t++) {
        const a = d[i][t] * d[j][t];
        sq += a * a;
        cube += d[i][t] * d[i][t] * a;
      }
      const piIJ = sq / T - s[i][j] * s[i][j];
      pi += piIJ;
      if (i === j) {
        rho += piIJ;
      } else {
        rho += rBar * (sd[j] / sd[i]) * (cube / T - s[i][i] * s[i][j]);
        gamma += (s[i][j] - rBar * sd[i] * sd[j]) ** 2;
      }
    }
  }
  const kappa = (pi - rho) / gamma;
  const intensity = n >= 3 && Number.isFinite(kappa) ? Math.max(0, Math.min(1, kappa / T)) : 0;
  const S = covMatrix(cols);
  const shrunk = S.map((row, i) =>
    row.map((v, j) => (i === j ? v : (1 - intensity) * v + intensity * rBar * Math.sqrt(S[i][i] * S[j][j]))),
  );
  return { S: shrunk, intensity, rBar };
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

// A resample costs tens of milliseconds, and the scorecard asks for the same one twice (the column, then its cut
// row's starting point), so each is kept per return columns and centre means, by identity: ownWindow hands both on
// unchanged, and a caller that moves the means passes a new array.
const RESAMPLED = new WeakMap<Vec[], WeakMap<Vec, Map<string, Resampled | null>>>();

function resampledOn(rows: Vec[], m: Vec, rf: number, allowShort: boolean): Resampled | null {
  let byM = RESAMPLED.get(rows);
  if (!byM) RESAMPLED.set(rows, (byM = new WeakMap()));
  let byRate = byM.get(m);
  if (!byRate) byM.set(m, (byRate = new Map()));
  const key = `${rf}|${allowShort}`;
  if (!byRate.has(key)) byRate.set(key, resample(rows, rf, allowShort, { m }));
  return byRate.get(key) ?? null;
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
  /** tan.bs only: the shrunk means, the intensity and the target. Null for the others (tan.lw's shrinkage is its window's, Moments.lw). */
  shrink: Shrunk | null;
  /** tan.rs only: the averaged weights' spread across the draws, and how many draws were averaged. Null for the others. */
  rs: Resampled | null;
}

/**
 * Solve construction `id` on its OWN window's moments (ownWindow(id, cols) gives them). mu and sigma are
 * annual decimals on the means the weights were solved with: for tan.bs the shrunk means, for tan.1y the
 * last year's; for tan.lw, sigma is on the covariance passed in, which ownWindow makes the shrunk one. The shorting switch reaches only the last-year and shrunk-mean tangencies; the capped
 * tangency and risk parity are long-only whatever it says. Null when the solve has no answer: shorting on
 * and nothing inside the box beats the risk-free rate (tan.1y, tan.bs), no capped mix beats it (tan.cap),
 * T <= n + 2 (tan.bs), or a failed solve.
 *
 * tan.rs re-solves on resampled ROWS, so it needs `rows`, the daily return columns m came from (ownWindow puts them
 * in Moments.rows); without them it is null. Each draw's means are centred on `m` (./resample.ts), so a caller that
 * moves the means (the cut row) moves every draw by the same amount. Its mu and sigma are the averaged weights'
 * on m and S, and beatsRf says whether those earn more than the risk-free rate. Null also when no draw's
 * maximum-Sharpe mix beat the rate.
 */
export function solveAdded(
  id: AddedId,
  m: Vec,
  S: Mat,
  T: number,
  rf: number,
  allowShort: boolean,
  rows?: Vec[],
): AddedSolution | null {
  switch (id) {
    case "tan.1y": {
      const t = tangency(m, S, rf, allowShort);
      return t && { id, w: t.w, mu: t.mu, sigma: t.sigma, beatsRf: t.beatsRf, shrink: null, rs: null };
    }
    case "tan.bs": {
      const shrink = bayesStein(m, S, T);
      const t = shrink && tangency(shrink.means, S, rf, allowShort);
      return t && { id, w: t.w, mu: t.mu, sigma: t.sigma, beatsRf: t.beatsRf, shrink, rs: null };
    }
    case "tan.lw": {
      const t = tangency(m, S, rf, allowShort);
      return t && { id, w: t.w, mu: t.mu, sigma: t.sigma, beatsRf: t.beatsRf, shrink: null, rs: null };
    }
    case "tan.rs": {
      const rs = rows ? resampledOn(rows, m, rf, allowShort) : null;
      if (!rs) return null;
      const p = perf(rs.w, m, S);
      return { id, w: rs.w, mu: p.mu, sigma: p.sigma, beatsRf: p.mu > rf, shrink: null, rs };
    }
    case "tan.cap": {
      const t = tangencyCapped(m, S, rf, CAP);
      return t && { id, w: t.w, mu: t.mu, sigma: t.sigma, beatsRf: t.beatsRf, shrink: null, rs: null };
    }
    case "rp": {
      const r = riskParity(m, S);
      return r && { id, w: r.w, mu: r.mu, sigma: r.sigma, beatsRf: null, shrink: null, rs: null };
    }
  }
}
