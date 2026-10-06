// The formula line: at the Formula explanation level, each tab prints one line under its finding, the
// formula behind the finding's figure with the tab's own numbers in it. Plain and Finance print nothing.
//
// Every builder here takes the values the finding itself prints, chosen by the same calls the finding makes
// (the tab hands them over), and formats them with the finding's own formats, so the line and the finding
// cannot disagree. A branch whose finding carries no figure (a failed solve, nothing to measure, a run that
// cannot start) returns null, and no line is drawn. test/t-formula.mjs holds every numeral in a line to a
// figure the tab prints.
//
// The formulas are the ones the engine computes (src/lib/stats.ts, src/lib/portfolio.ts,
// src/lib/optimize.ts, src/lib/walkforward.ts): simple daily returns r; annual figures from daily ones by
// TRADING_DAYS (the mean times it, the standard deviation times its square root); a portfolio's annual
// return 252 x w'mu and volatility sqrt(252 x w'Sigma w) on the daily means mu and the sample covariance
// Sigma; Sharpe = (annual return - rate) / annual volatility.
//
// Only types are imported from the tabs' own modules: each tab is its own chunk, and a value import here
// would pull every tab's model into whichever tab loaded first.
import { format, MINUS } from "../format.ts";
import { TRADING_DAYS } from "../lib/stats.ts";
import type { Convention } from "../lib/walkforward.ts";
import type { Performance } from "../lib/portfolio.ts";
import type { Tangency } from "../lib/optimize.ts";
import type { CorrView } from "./correlation/model.ts";
import type { Growth, GrowthLine } from "./returns/model.ts";
import type { Drawdown } from "./risk/model.ts";
import type { Swing } from "./sensitivity/model.ts";
import type { LiveRow } from "./walkforward/live.ts";

const D = String(TRADING_DAYS);
const pct1 = (x: number) => format(x, "pct1");
const pct2 = (x: number) => format(x, "pct2");
const num2 = (x: number) => format(x, "num2");
const num3 = (x: number) => format(x, "num3");

/** A portfolio's Sharpe ratio, as the engine computes it from the daily means and covariance. */
const SHARPE = `Sharpe = (${D} × wᵀμ ${MINUS} r_f) / √(${D} × wᵀΣw)`;
/** The same ratio on one daily return series, flat rate. */
const SERIES_SHARPE = `Sharpe = (${D} × mean(r) ${MINUS} r_f) / (√${D} × sd(r))`;
/** ... and with each day's own rate taken off first. */
const EXCESS_SHARPE = `Sharpe = ${D} × mean(e) / (√${D} × sd(e)), e = r ${MINUS} r_f/${D} at each day's bill rate`;

/** The bounds every weight is held to, as the optimiser holds them. */
const bounds = (allowShort: boolean) => `weights summing to 1, each in [${allowShort ? `${MINUS}1` : "0"}, 1]`;

/** (return − rate) / volatility = Sharpe, each at the format the tab prints it in. */
const ratio = (p: Performance, rf: number) => `(${pct2(p.mu)} ${MINUS} ${pct2(rf)}) / ${pct2(p.sigma)} = ${num3(p.sharpe)}`;

// ---- Returns ---------------------------------------------------------------------------------------

/**
 * The growth of the starting amount: W = W₀ × ∏(1 + r) over the daily returns, at the lines the finding
 * names (the highest and the lowest end, first in line order on a tie, as the finding picks them).
 * `amountOk` is the finding's own test of the amount; without it the finding prints total returns.
 */
export function returnsFormula(g: Growth, amountOk: boolean): string | null {
  if (!g.lines.length || g.lines.some((l) => !Number.isFinite(l.end) || !Number.isFinite(l.total))) return null;
  let top: GrowthLine = g.lines[0];
  let bottom: GrowthLine = g.lines[0];
  for (const l of g.lines) {
    if (l.end > top.end) top = l;
    if (l.end < bottom.end) bottom = l;
  }
  if (!amountOk) {
    return `Total return = ∏(1 + r) ${MINUS} 1, r each daily return: ${pct2(top.total)} for ${top.name}, ${pct2(bottom.total)} for ${bottom.name}`;
  }
  const amt = format(g.amount, "usd0");
  return (
    `W = W₀ × ∏(1 + r), r each daily return: ${amt} × ∏(1 + r) = ${format(top.end, "usd0")} for ${top.name}, ` +
    `${format(bottom.end, "usd0")} for ${bottom.name}`
  );
}

// ---- Risk ------------------------------------------------------------------------------------------

/** The deepest fall: drawdown = W / (W's running high) − 1 on the growth of 1, its lowest value. */
export function riskFormula(worst: Drawdown | null): string | null {
  if (!worst || !Number.isFinite(worst.max) || worst.max === 0) return null;
  return `Drawdown = W / (highest W to date) ${MINUS} 1, W the growth of 1 from the first close; its lowest for ${worst.name}: ${pct1(worst.max)}`;
}

// ---- Correlation -----------------------------------------------------------------------------------

/** Pearson's correlation of two assets' daily returns, at the pairs the finding names. */
export function correlationFormula(v: CorrView): string | null {
  const { high, low } = v;
  if (!high || !low || !Number.isFinite(high.r) || !Number.isFinite(low.r)) return null;
  const head = "ρ = cov(rᵢ, rⱼ) / (σᵢ × σⱼ) on daily returns: ";
  const pair = (p: { a: string; b: string; r: number }) => `ρ(${p.a}, ${p.b}) = ${num2(p.r)}`;
  return high === low ? head + pair(high) : `${head}${pair(high)}, ${pair(low)}`;
}

// ---- Optimization ----------------------------------------------------------------------------------

/**
 * The maximum-Sharpe portfolio's ratio against equal weights', each as (return − rate) / volatility at the
 * figures the tab's plates print. `ew` is the equal-weight row the finding reads (portRow); `rf` the
 * analysis' rate. A failed tangency prints the formula of what the finding falls back to.
 */
export function optimizationFormula(
  t: Tangency | null,
  gmv: { sigma: number } | null,
  ew: Performance,
  rf: number,
  allowShort: boolean,
): string | null {
  const moments = "μ and Σ the daily means and covariance";
  if (!t) {
    if (gmv) {
      if (!Number.isFinite(gmv.sigma)) return null;
      return `Volatility = √(${D} × wᵀΣw), Σ the daily covariance, at its lowest over ${bounds(allowShort)}: ${pct2(gmv.sigma)}`;
    }
    if (![ew.mu, ew.sigma, ew.sharpe].every(Number.isFinite)) return null;
    return `${SHARPE}, ${moments}, at equal weights: ${ratio(ew, rf)}`;
  }
  if (![t.mu, t.sigma, t.sharpe].every(Number.isFinite)) return null;
  if (!t.beatsRf) return `${SHARPE}, ${moments}, at its highest over ${bounds(allowShort)}: ${ratio(t, rf)}`;
  if (![ew.mu, ew.sigma, ew.sharpe].every(Number.isFinite)) return null;
  return `${SHARPE}, ${moments}; maximum Sharpe, over ${bounds(allowShort)}: ${ratio(t, rf)}; equal weights: ${ratio(ew, rf)}`;
}

// ---- Custom ----------------------------------------------------------------------------------------

/**
 * The custom mix's ratio at the figures its plates print, then the tangency portfolio's, which the finding
 * sets it against (null when that solve failed); null when the weights were refused.
 */
export function customFormula(ok: boolean, p: Performance | null, rf: number, tangencySharpe: number | null): string | null {
  if (!ok || !p || !Number.isFinite(p.mu) || !Number.isFinite(p.sigma)) return null;
  if (!Number.isFinite(p.sharpe)) {
    return `Return = ${D} × wᵀμ = ${pct2(p.mu)}, volatility = √(${D} × wᵀΣw) = ${pct2(p.sigma)}, so (return ${MINUS} r_f) / volatility has no value`;
  }
  const line = `${SHARPE} at the custom weights, μ and Σ the daily means and covariance: ${ratio(p, rf)}`;
  return tangencySharpe !== null && Number.isFinite(tangencySharpe) ? `${line}; at the tangency weights: ${num3(tangencySharpe)}` : line;
}

// ---- Sensitivity -----------------------------------------------------------------------------------

/** The weight that moves most: each window k refits on its own means and covariance, at the page's rate. */
export function sensitivityFormula(windows: number, tan: Swing | null, gmv: Swing | null, rf: number, allowShort: boolean): string | null {
  if (!tan && !gmv) return null;
  const range = (s: Swing) => (pct1(s.lo) === pct1(s.hi) ? `w(${s.ticker}) = ${pct1(s.lo)} in every window` : `w(${s.ticker}) from ${pct1(s.lo)} to ${pct1(s.hi)}`);
  const parts: string[] = [];
  if (tan) parts.push(`tangency w = argmax (${D} × wᵀμₖ ${MINUS} r_f) / √(${D} × wᵀΣₖw) at r_f = ${pct2(rf)}: ${range(tan)}`);
  if (gmv) parts.push(`GMV w = argmin wᵀΣₖw: ${range(gmv)}`);
  return `For each window k = 1, …, ${format(windows, "int")}, μₖ and Σₖ its daily means and covariance, over ${bounds(allowShort)}: ${parts.join("; ")}`;
}

// ---- Walk-forward ----------------------------------------------------------------------------------

/**
 * Your basket: the maximum-Sharpe row's two figures, the whole window and the held-out days joined, each
 * one Sharpe ratio of that series under the run's rate convention.
 */
export function liveFormula(rows: readonly LiveRow[], convention: Convention): string | null {
  const tan = rows.find((r) => r.key === "tan");
  if (!tan || tan.inSample === null || tan.oos === null || !Number.isFinite(tan.inSample) || !Number.isFinite(tan.oos)) return null;
  const head = convention === "per-period" ? EXCESS_SHARPE : SERIES_SHARPE;
  return (
    `${head}, r the maximum-Sharpe weights' daily returns: ${num3(tan.inSample)} over the whole window, ` +
    `${num3(tan.oos)} over the held-out days joined`
  );
}

/** As published: the published pair, quoted as printed, at the published run's flat rate. */
export function publishedFormula(inSample: string, oos: string, rf: number): string | null {
  if (!inSample || !oos || !Number.isFinite(rf)) return null;
  return (
    `${SERIES_SHARPE}, r_f = ${pct1(rf)}, r the maximum-Sharpe weights' daily returns: ${inSample} over the whole window, ` +
    `${oos} over the held-out days joined`
  );
}
