// Portfolio arithmetic: tabs 4-6 of the Streamlit app, everything that is not a solve.
import { covMatrix, dot, mean, matVec, type Mat, type Vec } from "./num.ts";
import { annualizedStats, maxDrawdown, TRADING_DAYS } from "./stats.ts";

export interface Performance {
  mu: number;
  sigma: number;
  sharpe: number;
}

// portfolio_performance (917-923): quadratic-form volatility, which equals the std of the daily
// portfolio series exactly, so Sharpe and Sortino in one row agree.
export function portfolioPerformance(w: Vec, m: Vec, S: Mat, rf: number): Performance {
  const mu = dot(w, m) * TRADING_DAYS;
  const sigma = Math.sqrt(dot(w, matVec(S, w)) * TRADING_DAYS);
  return { mu, sigma, sharpe: sigma > 0 ? (mu - rf) / sigma : NaN };
}

// R @ w: constant weights, rebalanced every day. The page says so; the app did not.
export function portfolioReturns(cols: Vec[], w: Vec): Vec {
  const T = cols[0].length;
  const out = new Array<number>(T);
  for (let t = 0; t < T; t++) {
    let s = 0;
    for (let i = 0; i < cols.length; i++) s += cols[i][t] * w[i];
    out[t] = s;
  }
  return out;
}

export interface Row extends Performance {
  sortino: number;
  mdd: number;
}

// One row of the Summary Comparison table (1678-1695).
export function summaryRow(cols: Vec[], w: Vec, m: Vec, S: Mat, rf: number, includeStart = true): Row {
  const p = portfolioPerformance(w, m, S, rf);
  const r = portfolioReturns(cols, w);
  return { ...p, sortino: annualizedStats(r, rf).sortino, mdd: maxDrawdown(r, includeStart) };
}

// risk_contribution (974-979): each asset's share of portfolio variance; sums to 1.
export function riskContribution(w: Vec, S: Mat): Vec {
  const marginal = matVec(S, w);
  const v = dot(w, marginal);
  return w.map((x, i) => (x * marginal[i]) / v);
}

export type Custom =
  | { ok: true; w: Vec; total: number; clamped: boolean }
  | { ok: false; reason: "zero" | "net-short" | "leverage"; total: number };

// The custom builder's raw slider values become weights that sum to 1.
//
// The app divides by the raw total (1732). With shorting on, a negative total flips every sign and a
// total near zero multiplies every weight by 1/total, far outside the +/-1 box the optimiser honours,
// so the custom point can plot above the "efficient" frontier. The port clamps each value to the
// current bounds (a stored -0.4 must not survive shorting being switched off), then refuses the
// cases whose answer would mislead, and says which.
export function normalizeCustom(raw: Vec, allowShort: boolean): Custom {
  const lo = allowShort ? -1 : 0;
  const v = raw.map((x) => Math.min(1, Math.max(lo, x)));
  const clamped = v.some((x, i) => x !== raw[i]);
  const total = v.reduce((a, b) => a + b, 0);
  if (v.every((x) => x === 0)) return { ok: false, reason: "zero", total };
  // Long-only, every value is >= 0 and one is positive, so any total is safe to divide by.
  if (!allowShort) return { ok: true, w: v.map((x) => x / total), total, clamped };
  // With shorts, a net exposure under 5% is where 1/total explodes; nothing sensible lives there.
  if (!(total > 0.05)) return { ok: false, reason: "net-short", total };
  const w = v.map((x) => x / total);
  if (w.some((x) => x < lo - 1e-12 || x > 1 + 1e-12)) return { ok: false, reason: "leverage", total };
  return { ok: true, w, total, clamped };
}

export interface Window {
  label: string;
  lb: number;
}

// Estimation windows (1850-1872): trailing, nested, all ending on the last date. "N Years" is
// 252*N return rows; there is no 4-year window.
export function windows(totalDays: number): Window[] {
  const years = totalDays / TRADING_DAYS;
  const out: Window[] = [];
  for (const [lb, label, need] of [
    [252, "1 Year", 1],
    [504, "2 Years", 2],
    [756, "3 Years", 3],
    [1260, "5 Years", 5],
  ] as const) {
    if (years >= need) out.push({ label, lb });
  }
  out.push({ label: "Full Sample", lb: totalDays });
  return out;
}

export function windowMoments(cols: Vec[], lb: number): { m: Vec; S: Mat } {
  const sub = cols.map((c) => c.slice(c.length - lb));
  return { m: sub.map(mean), S: covMatrix(sub) };
}
