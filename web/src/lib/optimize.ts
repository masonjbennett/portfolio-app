// Portfolio optimisation, solved exactly.
//
// The Streamlit app calls scipy's SLSQP with its default ftol of 1e-6 and finite-difference
// gradients. Measured on 300+ synthetic problems, that stops its weights up to ~1e-2 short of the
// optimum while the objective is good to ~1e-6. Every problem here is a small convex QP, so the
// port solves it exactly with Goldfarb-Idnani (quadprog) and never reproduces the SLSQP noise.
//
// Bounds are the app's: [0, 1] per asset long-only, [-1, 1] with shorting. Weights sum to 1.
import { solveQP } from "quadprog";
import { cholSolve, dot, linspace, matVec, type Mat, type Vec } from "./num.ts";
import { TRADING_DAYS } from "./stats.ts";

export interface Solution {
  w: Vec;
  mu: number; // annualised
  sigma: number; // annualised
}

// quadprog is a Fortran port: 1-based arrays, and it overwrites Dmat and dvec, so every call
// builds fresh ones. It minimises 1/2 x'Dx - d'x subject to A'x >= b, the first `meq` as equalities.
function qp(D: Mat, cons: { a: Vec; b: number }[], meq: number): Vec | null {
  const n = D.length;
  const Dm: number[][] = [[]];
  const dv: number[] = [0];
  for (let i = 0; i < n; i++) {
    Dm.push([0, ...D[i]]);
    dv.push(0);
  }
  const Am: number[][] = [[]];
  for (let i = 0; i < n; i++) Am.push([0, ...cons.map((c) => c.a[i])]);
  const bv = [0, ...cons.map((c) => c.b)];
  const flag = [0, 0];
  const out = solveQP(Dm, dv, Am, bv, meq, flag);
  if (out.message || flag[1] !== 0 || !out.solution) return null;
  const x = out.solution.slice(1, n + 1);
  return x.every(Number.isFinite) ? x : null;
}

// The daily covariance is ~1e-4; scale it to a unit mean diagonal so the solver's tolerances,
// which are absolute, sit where they should. The argmin does not move.
function scaled(S: Mat): Mat {
  const k = S.reduce((s, row, i) => s + row[i], 0) / S.length;
  return S.map((row) => row.map((v) => (2 * v) / k));
}

function boxCons(n: number, allowShort: boolean) {
  const cons: { a: Vec; b: number }[] = [];
  for (let i = 0; i < n; i++) {
    const e = new Array<number>(n).fill(0);
    e[i] = 1;
    cons.push({ a: e, b: allowShort ? -1 : 0 });
    // Long-only, w <= 1 is implied by w >= 0 and sum = 1; a redundant row only invites a
    // degenerate active set.
    if (allowShort) cons.push({ a: e.map((v) => -v), b: -1 });
  }
  return cons;
}

export function perf(w: Vec, m: Vec, S: Mat): { mu: number; sigma: number } {
  return { mu: dot(w, m) * TRADING_DAYS, sigma: Math.sqrt(dot(w, matVec(S, w)) * TRADING_DAYS) };
}

// Global minimum variance (optimize_gmv, 926-933).
export function gmv(m: Vec, S: Mat, allowShort: boolean): Solution | null {
  const n = m.length;
  const w = qp(scaled(S), [{ a: new Array<number>(n).fill(1), b: 1 }, ...boxCons(n, allowShort)], 1);
  return w && { w, ...perf(w, m, S) };
}

// The highest annual return the bounds allow: a linear programme whose answer is greedy. Put
// every asset at its lower bound, then spend what is left of the 100% on the best means first.
export function maxReturn(m: Vec, allowShort: boolean): Solution {
  const n = m.length;
  const lo = allowShort ? -1 : 0;
  const w = new Array<number>(n).fill(lo);
  let left = 1 - lo * n;
  for (const i of m.map((_, i) => i).sort((a, b) => m[b] - m[a])) {
    const add = Math.min(1 - lo, left);
    w[i] += add;
    left -= add;
  }
  return { w, mu: dot(w, m) * TRADING_DAYS, sigma: NaN };
}

export interface FrontierPoint {
  target: number;
  sigma: number;
  feasible: boolean;
  w: Vec | null;
}

// Minimum volatility at each target annual return (the inner loop of efficient_frontier, 958-970).
// Targets are explicit so the parity suite can evaluate the app's exact grid.
export function frontierAt(m: Vec, S: Mat, targets: Vec, allowShort: boolean): FrontierPoint[] {
  const n = m.length;
  const D = scaled(S);
  // 252*m'w = t, divided through by s so the row is O(1). The row is built as (m_i*252)/s and the
  // right-hand side as t/s, so at t = 252*max(m) the vertex satisfies it to the bit.
  const s = Math.max(...m.map((x) => Math.abs(x * TRADING_DAYS))) || 1;
  const row = m.map((x) => (x * TRADING_DAYS) / s);
  const box = boxCons(n, allowShort);
  const top = maxReturn(m, allowShort);
  return targets.map((t) => {
    const w = qp(D, [{ a: new Array<number>(n).fill(1), b: 1 }, { a: row, b: t / s }, ...box], 2);
    if (w) return { target: t, sigma: perf(w, m, S).sigma, feasible: true, w };
    // At the highest reachable return the only feasible portfolio is a vertex of the box, and the
    // QP can reject it by one rounding error (measured: the long-only top target of `cross`).
    if (Math.abs(t - top.mu) <= 1e-12 * Math.abs(top.mu)) {
      return { target: t, sigma: perf(top.w, m, S).sigma, feasible: true, w: top.w };
    }
    return { target: t, sigma: NaN, feasible: false, w: null };
  });
}

// The port's frontier: from the GMV return up to the highest return the bounds allow, so every
// point is reachable. The app runs short mode to 1.5x the best asset's mean, an arbitrary ceiling
// most of whose targets are infeasible and silently dropped.
export function frontier(m: Vec, S: Mat, allowShort: boolean, points: number): FrontierPoint[] {
  const g = gmv(m, S, allowShort);
  if (!g) return [];
  return frontierAt(m, S, linspace(g.mu, maxReturn(m, allowShort).mu, points), allowShort);
}

export interface Tangency extends Solution {
  sharpe: number;
  beatsRf: boolean;
}

function sharpeOf(w: Vec, m: Vec, S: Mat, rf: number): Tangency {
  const p = perf(w, m, S);
  const sharpe = p.sigma > 0 ? (p.mu - rf) / p.sigma : NaN;
  return { w, ...p, sharpe, beatsRf: sharpe > 0 };
}

// The face walk below costs 2^n - 1 small solves, so it doubles with every asset. tangency() uses it
// only up to FACES_UP_TO assets (4,095 faces), and only when no asset beats the risk-free rate.
export const FACES_UP_TO = 12;
// The walk itself refuses more than FACES_CAP assets, whoever calls it. `1 << n` is 2^n only while
// n <= 30: at 31 it is negative and at 32 it is 1 again, so an unguarded walk returns nothing there
// and, past 32, a portfolio drawn from a handful of faces. 2^20 faces already take seconds.
export const FACES_CAP = 20;

// Long-only: every face of the simplex, at most 2^FACES_CAP - 1 of them. On a face F the Sharpe
// ratio is stationary exactly at w proportional to S_F^-1 (m_F - rf/252); the best feasible one is
// the global maximum. This is also right when no asset beats the risk-free rate, where it returns
// the least-negative portfolio, as the app's SLSQP does; beatsRf says so.
export function tangencyFaces(m: Vec, S: Mat, rf: number): Tangency | null {
  const n = m.length;
  if (n > FACES_CAP) return null;
  const e = m.map((x) => x - rf / TRADING_DAYS);
  let best: Tangency | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    const F: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) F.push(i);
    const y = cholSolve(F.map((i) => F.map((j) => S[i][j])), F.map((i) => e[i]));
    if (!y) continue;
    const tot = y.reduce((a, b) => a + b, 0);
    if (tot === 0) continue;
    const wF = y.map((v) => v / tot);
    if (!wF.every((v) => v > 0)) continue;
    const w = new Array<number>(n).fill(0);
    F.forEach((i, k) => (w[i] = wF[k]));
    const cand = sharpeOf(w, m, S, rf);
    if (!best || cand.sharpe > best.sharpe) best = cand;
  }
  return best;
}

// Long-only, when at least one asset earns more than the risk-free rate: the homogenised QP, the
// long-only twin of the shorting branch in tangency(). Minimise y'Sy subject to e'y = 1 and y >= 0,
// then w = y / 1'y. A long-only mix beats the risk-free rate exactly when one of its assets does, so
// the problem is feasible exactly then; otherwise the result is null. One solve at any n.
export function tangencyLongQP(m: Vec, S: Mat, rf: number): Tangency | null {
  const n = m.length;
  const e = m.map((x) => x - rf / TRADING_DAYS);
  if (!e.some((x) => x > 0)) return null;
  // The daily excess means are ~1e-4; divided by the largest, the row is O(1).
  const c = Math.max(...e.map(Math.abs));
  const y = qp(scaled(S), [{ a: e.map((x) => x / c), b: 1 }, ...boxCons(n, false)], 1);
  if (!y) return null;
  // y >= 0 holds to rounding at the active bounds; a weight of -1e-18 is that rounding, not a short.
  const yp = y.map((v) => Math.max(v, 0));
  const tot = yp.reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return null;
  return sharpeOf(yp.map((v) => v / tot), m, S, rf);
}

// Long-only, when no asset earns more than the risk-free rate, the best mix is one asset alone: the
// one with the highest Sharpe ratio of its own. Every excess mean is then negative (or zero), so any
// mix z can be scaled to (-e)'z = 1, and maximising Sharpe becomes maximising z'Sz, a convex function,
// over a simplex; the maximum of a convex function over a simplex sits at a vertex. Exact at any n, and
// the same portfolio the face walk finds through its one-asset faces.
export function bestLoneAsset(m: Vec, S: Mat, rf: number): Tangency | null {
  const n = m.length;
  let best: Tangency | null = null;
  for (let i = 0; i < n; i++) {
    const w = new Array<number>(n).fill(0);
    w[i] = 1;
    const cand = sharpeOf(w, m, S, rf);
    if (Number.isFinite(cand.sharpe) && (!best || cand.sharpe > best.sharpe)) best = cand;
  }
  return best;
}

// Maximum Sharpe ratio (optimize_tangency, 936-944).
//
// Long-only, when at least one asset beats the risk-free rate: tangencyLongQP, one exact solve. It
// replaced the face walk, which visits up to 2^n - 1 faces, so its time doubles with every asset
// added, and whose `1 << n` fails from 31 up.
//
// Long-only, when none does: the least-negative portfolio, as the app's SLSQP does; beatsRf says so.
// Up to FACES_UP_TO assets the face walk finds it, as it always has; past that, bestLoneAsset, which
// is exact and returns the same portfolio.
//
// Shorting: the homogenised QP. With y = w / (excess return), maximising Sharpe is minimising
// y'Sy subject to e'y = 1 and -(1'y) <= y_i <= 1'y, then w = y / 1'y. It is infeasible exactly when
// no portfolio inside the box earns more than the risk-free rate; then there is no tangency
// portfolio to show and the result is null.
export function tangency(m: Vec, S: Mat, rf: number, allowShort: boolean): Tangency | null {
  const n = m.length;
  const e = m.map((x) => x - rf / TRADING_DAYS);
  if (allowShort) {
    const c = Math.max(...e.map(Math.abs)) || 1;
    const cons: { a: Vec; b: number }[] = [{ a: e.map((x) => x / c), b: 1 }];
    for (let i = 0; i < n; i++) {
      cons.push({ a: new Array<number>(n).fill(1).map((v, k) => (k === i ? v + 1 : v)), b: 0 });
      cons.push({ a: new Array<number>(n).fill(1).map((v, k) => (k === i ? v - 1 : v)), b: 0 });
    }
    const y = qp(scaled(S), cons, 1);
    if (!y) return null;
    const tot = y.reduce((a, b) => a + b, 0);
    if (!(tot > 0)) return null;
    return sharpeOf(y.map((v) => v / tot), m, S, rf);
  }
  if (e.some((x) => x > 0)) return tangencyLongQP(m, S, rf);
  return n <= FACES_UP_TO ? tangencyFaces(m, S, rf) : bestLoneAsset(m, S, rf);
}

// ---- two more constructions: a capped maximum Sharpe and risk parity ------------------------------

// Long-only maximum Sharpe with no weight above `cap`, whatever the shorting switch. It is the
// homogenised QP of tangencyLongQP with n more rows, cap * (1'y) - y_i >= 0. Those rows are homogeneous
// in y, so once w = y / 1'y they read w_i <= cap exactly, at any scale of y.
//
// Null when the cap leaves no mix that sums to 1 (cap * n < 1), and when no capped long-only mix earns
// more than the risk-free rate: the most excess return the capped simplex reaches is found greedily (the
// cap on the highest excess means first), and when that is not positive the QP has no feasible point, so
// there is no portfolio to show. At cap * n = 1 the only feasible mix is equal weight.
export function tangencyCapped(m: Vec, S: Mat, rf: number, cap: number): Tangency | null {
  const n = m.length;
  if (!(cap > 0) || cap * n < 1 - 1e-12) return null;
  const e = m.map((x) => x - rf / TRADING_DAYS);
  let left = 1;
  let reach = 0;
  for (const i of e.map((_, i) => i).sort((a, b) => e[b] - e[a])) {
    const add = Math.min(cap, left);
    reach += add * e[i];
    left -= add;
  }
  if (!(reach > 0)) return null;
  const c = Math.max(...e.map(Math.abs));
  const cons: { a: Vec; b: number }[] = [{ a: e.map((x) => x / c), b: 1 }, ...boxCons(n, false)];
  for (let i = 0; i < n; i++) cons.push({ a: e.map((_, k) => (k === i ? cap - 1 : cap)), b: 0 });
  const y = qp(scaled(S), cons, 1);
  if (!y) return null;
  // As in tangencyLongQP: a weight of -1e-18 at an active bound is rounding, not a short.
  const kept = y.map((v) => Math.max(v, 0));
  const scale = kept.reduce((a, b) => a + b, 0);
  if (!(scale > 0)) return null;
  return sharpeOf(kept.map((v) => v / scale), m, S, rf);
}

// Risk parity (equal risk contribution): long-only whatever the shorting switch, and from the covariance
// alone. Like gmv() it never reads the expected returns; `m` only prices the result.
//
// Why the minimiser below has equal contributions. With A the scaled covariance, minimise
//   F(x) = (n / 2) x'Ax - sum_i ln x_i   over x > 0.
// F is strictly convex there (a convex quadratic plus a strictly convex barrier), so it has exactly one
// minimiser, and at it the gradient n Ax - 1/x is zero: x_i (Ax)_i = 1/n for every i. Summing over i,
// x'Ax = 1, so each asset contributes the same 1/n of the portfolio's variance. Dividing x by its sum
// scales every contribution by the same factor and leaves those shares alone, and the barrier keeps every
// x_i > 0, so w = x / 1'x is long-only with equal risk contributions. (The 1/n on the barrier in the usual
// statement, 1/2 x'Ax - (1/n) sum ln x_i, is the same problem divided by n.)
//
// Newton's method with a backtracking line search. F is self-concordant (a convex quadratic plus the
// standard log barrier), so the damped iteration converges from any positive start, and once the Newton
// decrement is below 1/4 the full step stays inside x > 0 and convergence is quadratic (Boyd and
// Vandenberghe, Convex Optimization, section 9.6). It stops when every asset's share of the portfolio
// variance is within RP_TOL of 1/n, and returns null if that has not happened in RP_MAX_STEPS steps.
export const RP_TOL = 1e-10;
export const RP_MAX_STEPS = 100;

export function riskParity(m: Vec, S: Mat): Solution | null {
  const n = S.length;
  if (!n) return null;
  const A = scaled(S);
  const F = (x: Vec) => (n / 2) * dot(x, matVec(A, x)) - x.reduce((s, v) => s + Math.log(v), 0);
  // Inverse volatility to start, where n x_i^2 A_ii = 1.
  let x = A.map((row, i) => 1 / Math.sqrt(n * row[i]));
  if (!x.every((v) => Number.isFinite(v) && v > 0)) return null;
  for (let step = 0; ; step++) {
    const Ax = matVec(A, x);
    const v = dot(x, Ax);
    if (x.every((xi, i) => Math.abs((xi * Ax[i]) / v - 1 / n) <= RP_TOL)) {
      const tot = x.reduce((a, b) => a + b, 0);
      const w = x.map((xi) => xi / tot);
      return { w, ...perf(w, m, S) };
    }
    if (step >= RP_MAX_STEPS) return null;
    const g = Ax.map((a, i) => n * a - 1 / x[i]);
    const H = A.map((row, i) => row.map((a, j) => n * a + (i === j ? 1 / (x[i] * x[i]) : 0)));
    const dx = cholSolve(H, g.map((gi) => -gi));
    if (!dx) return null;
    const dec = -dot(g, dx); // the Newton decrement, squared
    let t = 1;
    if (dec >= 1 / 16) {
      const f0 = F(x);
      for (;;) {
        const xt = x.map((xi, i) => xi + t * dx[i]);
        if (xt.every((xi) => xi > 0) && F(xt) <= f0 - 0.25 * t * dec) break;
        t /= 2;
        if (t < 1e-12) return null;
      }
    }
    x = x.map((xi, i) => xi + t * dx[i]);
    if (!x.every((xi) => xi > 0)) return null;
  }
}
