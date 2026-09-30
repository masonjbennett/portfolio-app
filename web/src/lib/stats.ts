// Return statistics: tabs 1-3 of the Streamlit app (Returns & Statistics, Risk Analysis,
// Correlation). Line numbers cite portfolio_app.py.
import { mean, std, sum, variance, type Vec } from "./num.ts";
import { captureRatios, monthlyReturns, monthStats } from "./monthly.ts";

export const TRADING_DAYS = 252;

export interface AnnualStats {
  mu: number;
  sigma: number;
  sharpe: number;
  sortino: number;
}

// annualized_stats (893-901). Sortino's downside deviation averages the squared shortfall below
// the daily risk-free rate over ALL days, zeros included: the standard target downside deviation,
// not the RMS of the negative days only.
export function annualizedStats(r: Vec, rf: number): AnnualStats {
  const mu = mean(r) * TRADING_DAYS;
  const sigma = std(r) * Math.sqrt(TRADING_DAYS);
  const sharpe = sigma > 0 ? (mu - rf) / sigma : NaN;
  const downside = downsideDeviation(r, rf);
  const sortino = downside > 0 ? (mu - rf) / downside : NaN;
  return { mu, sigma, sharpe, sortino };
}

// The annualised downside deviation Sortino divides by (the definition above), decimal a year.
export function downsideDeviation(r: Vec, rf: number): number {
  const rfDaily = rf / TRADING_DAYS;
  const sq = r.map((x) => Math.min(x - rfDaily, 0) ** 2);
  const downside = Math.sqrt(mean(sq)) * Math.sqrt(TRADING_DAYS);
  return downside;
}

// Wealth index. The app's (1 + r).cumprod() starts at 1 + r1, so its first plotted point is the
// first day's close, never the amount invested; the port prepends the start (includeStart).
export function wealth(r: Vec, w0 = 1, includeStart = true): Vec {
  const out: Vec = includeStart ? [w0] : [];
  let c = 1;
  for (const x of r) {
    c *= 1 + x;
    out.push(c * w0);
  }
  return out;
}

// drawdown_series (911-914) with includeStart=false. With the start included, a fall that begins
// on day one is measured from the amount invested, which is the standard definition.
export function drawdowns(r: Vec, includeStart = true): Vec {
  const cum = wealth(r, 1, includeStart);
  const out: Vec = [];
  let peak = -Infinity;
  for (const c of cum) {
    if (c > peak) peak = c;
    out.push((c - peak) / peak);
  }
  return out;
}

// max_drawdown (904-908).
export function maxDrawdown(r: Vec, includeStart = true): number {
  let m = Infinity;
  for (const d of drawdowns(r, includeStart)) if (d < m) m = d;
  return m;
}

// pandas zeroes a central moment below 1e-14 before dividing (nanops._zero_out_fperr).
function zeroFp(x: number): number {
  return Math.abs(x) < 1e-14 ? 0 : x;
}

function moments(r: Vec): { n: number; m2: number; m3: number; m4: number } {
  const n = r.length;
  const avg = sum(r) / n;
  const d = r.map((x) => x - avg);
  const d2 = d.map((x) => x * x);
  return {
    n,
    m2: zeroFp(sum(d2)),
    m3: zeroFp(sum(d2.map((x, i) => x * d[i]))),
    m4: zeroFp(sum(d2.map((x) => x * x))),
  };
}

// Series.skew(): the adjusted Fisher-Pearson coefficient G1.
export function skew(r: Vec): number {
  const { n, m2, m3 } = moments(r);
  if (n < 3) return NaN;
  if (m2 === 0) return 0;
  return ((n * (n - 1) ** 0.5) / (n - 2)) * (m3 / m2 ** 1.5);
}

// Series.kurtosis(): EXCESS kurtosis G2, bias-corrected, so a normal distribution scores 0. The
// app labels it plain "Kurtosis"; the port says "excess kurtosis".
export function excessKurtosis(r: Vec): number {
  const { n, m2, m4 } = moments(r);
  if (n < 4) return NaN;
  if (m2 === 0) return 0;
  const num = n * (n + 1) * (n - 1) * m4;
  const den = (n - 2) * (n - 3) * m2 ** 2;
  const adj = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return num / den - adj;
}

// rolling(w).std(): NaN until a full window. Computed directly per window, which is at least as
// accurate as pandas' add/remove online update (the two agree to about 1e-12 here).
export function rollingStd(r: Vec, w: number): Vec {
  return r.map((_, i) => (i + 1 < w ? NaN : Math.sqrt(variance(r.slice(i + 1 - w, i + 1)))));
}

export function rollingCorr(a: Vec, b: Vec, w: number): Vec {
  return a.map((_, i) => {
    if (i + 1 < w) return NaN;
    const x = a.slice(i + 1 - w, i + 1);
    const y = b.slice(i + 1 - w, i + 1);
    const mx = mean(x);
    const my = mean(y);
    const sxy = sum(x.map((v, k) => (v - mx) * (y[k] - my)));
    const sxx = sum(x.map((v) => (v - mx) ** 2));
    const syy = sum(y.map((v) => (v - my) ** 2));
    const den = Math.sqrt(sxx * syy);
    return den === 0 ? NaN : sxy / den;
  });
}

export interface Fit {
  slope: number;
  intercept: number;
  r: number;
}

// scipy.stats.linregress(x, y): slope = cov(x,y)/var(x) from the biased covariance.
export function linregress(x: Vec, y: Vec): Fit {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  const ssxm = sum(x.map((v) => (v - mx) ** 2)) / n;
  const ssym = sum(y.map((v) => (v - my) ** 2)) / n;
  const ssxym = sum(x.map((v, i) => (v - mx) * (y[i] - my))) / n;
  const den = Math.sqrt(ssxm * ssym);
  const r = den === 0 ? 0 : Math.min(1, Math.max(-1, ssxym / den));
  const slope = ssxym / ssxm;
  return { slope, intercept: my - slope * mx, r };
}

export interface Capm {
  beta: number;
  alphaAnn: number;
  r2: number;
}

// CAPM table (1377-1392): regress the stock's daily excess return on the benchmark's.
export function capm(stock: Vec, bench: Vec, rf: number): Capm {
  const rfd = rf / TRADING_DAYS;
  const fit = linregress(bench.map((x) => x - rfd), stock.map((x) => x - rfd));
  return { beta: fit.slope, alphaAnn: fit.intercept * TRADING_DAYS, r2: fit.r ** 2 };
}

// Standard normal quantile, Wichura's AS241 (PPND16): about 1e-16 relative, which is what
// scipy's ndtri delivers.
export function normPpf(p: number): number {
  if (p <= 0) return p === 0 ? -Infinity : NaN;
  if (p >= 1) return p === 1 ? Infinity : NaN;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q *
        (((((((r * 2509.0809287301226727 + 33430.575583588128105) * r + 67265.770927008700853) * r +
          45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r +
          133.14166789178437745) * r + 3.387132872796366608)) /
      (((((((r * 5226.495278852545925 + 28729.085735721942674) * r + 39307.89580009271061) * r +
        21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r +
        42.313330701600911252) * r + 1)
    );
  }
  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let val: number;
  if (r <= 5) {
    r -= 1.6;
    val =
      (((((((r * 7.7454501427834140764e-4 + 0.0227238449892691845833) * r + 0.24178072517745061177) * r +
        1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r +
        4.6303378461565452959) * r + 1.42343711074968357734) /
      (((((((r * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r +
        0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r +
        2.05319162663775882187) * r + 1);
  } else {
    r -= 5;
    val =
      (((((((r * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r +
        0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r +
        5.4637849111641143699) * r + 6.6579046435011037772) /
      (((((((r * 2.04426310338993978564e-15 + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r +
        7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r +
        0.59983220655588793769) * r + 1);
  }
  return q < 0 ? -val : val;
}

export function normPdf(x: number, mu = 0, sigma = 1): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (Math.sqrt(2 * Math.PI) * sigma);
}

export interface QQ {
  osm: Vec;
  osr: Vec;
  slope: number;
  intercept: number;
}

// scipy.stats.probplot(x, dist="norm") (Q-Q chart, 1296): Filliben's order-statistic medians.
export function probplot(x: Vec): QQ {
  const n = x.length;
  const osr = [...x].sort((a, b) => a - b);
  const med = new Array<number>(n);
  med[n - 1] = 0.5 ** (1 / n);
  med[0] = 1 - med[n - 1];
  for (let i = 2; i < n; i++) med[i - 1] = (i - 0.3175) / (n + 0.365);
  const osm = med.map(normPpf);
  const fit = linregress(osm, osr);
  return { osm, osr, slope: fit.slope, intercept: fit.intercept };
}

// ---- The scorecard's arithmetic ------------------------------------------------------------------
// Pure functions of a daily simple-return series (and, where one is taken, the benchmark's over the
// same dates), on the conventions above: 252 trading days a year, sample (ddof=1) moments, rf a
// decimal annual rate. Every result is a decimal unless its comment says otherwise.

function growth(r: Vec): number {
  const path = wealth(r);
  return path[path.length - 1];
}

// Growth of 1 over the whole series, less the 1: the cumulative return.
export function cumulativeReturn(r: Vec): number {
  return growth(r) - 1;
}

// The COMPOUND annual rate over the series' trading days, (growth)^(252 / T) - 1. It is not the
// arithmetic mean times 252 that annualizedStats().mu reports (and Sharpe uses); the two differ by
// roughly half the variance, which is why both exist. NaN on an empty series.
export function annualReturn(r: Vec): number {
  const T = r.length;
  if (T < 1) return NaN;
  return growth(r) ** (TRADING_DAYS / T) - 1;
}

export interface DrawdownSpell {
  /** Trading days from the peak's close to the first close back at or above it (or to the last day). */
  trading: number;
  /** The same span in calendar days. */
  calendar: number;
  /** ISO dates of the peak and of the recovery (or of the last day); null when the path never fell. */
  peak: string | null;
  end: string | null;
  /** False when the spell was still open on the last day. */
  recovered: boolean;
}

const DAY_MS = 86_400_000;
const calendarDays = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

// The longest drawdown: from a peak to the first day the path is back at or above it, or to the last
// day when it never got back. The longest is picked on trading days, a tie going to the longer
// calendar span and then to the earlier spell. `start` is the date the amount was invested (the
// first price, the day before the first return): given, the path starts at 1 on that date, as the
// port's drawdowns do by default; null starts it at the first day's close, as the app's did.
export function longestDrawdown(r: Vec, dates: readonly string[], start: string | null = null): DrawdownSpell {
  if (r.length !== dates.length) throw new Error(`longestDrawdown: ${r.length} returns but ${dates.length} dates`);
  const path = wealth(r, 1, start !== null);
  const when = start !== null ? [start, ...dates] : dates;
  let best: DrawdownSpell = { trading: 0, calendar: 0, peak: null, end: null, recovered: true };
  const consider = (pk: number, stop: number, recovered: boolean) => {
    const trading = stop - pk;
    const calendar = calendarDays(when[pk], when[stop]);
    if (trading > best.trading || (trading === best.trading && calendar > best.calendar)) {
      best = { trading, calendar, peak: when[pk], end: when[stop], recovered };
    }
  };
  let pk = 0; // index of the running peak
  for (let j = 1; j < path.length; j++) {
    if (path[j] >= path[pk]) {
      if (j - pk > 1) consider(pk, j, true);
      pk = j;
    }
  }
  if (pk < path.length - 1) consider(pk, path.length - 1, false);
  return best;
}

// Calmar: the compound annual return over the size of the worst drawdown. NaN when the path never fell.
export function calmar(r: Vec, includeStart = true): number {
  const dd = maxDrawdown(r, includeStart);
  return dd < 0 ? annualReturn(r) / Math.abs(dd) : NaN;
}

function sameLength(a: Vec, b: Vec, what: string): void {
  if (a.length !== b.length) throw new Error(`${what}: series of ${a.length} and ${b.length} days`);
}

// Pearson correlation of two daily series. NaN when either is flat or there are fewer than two days.
export function correlation(a: Vec, b: Vec): number {
  sameLength(a, b, "correlation");
  if (a.length < 2) return NaN;
  const ma = mean(a);
  const mb = mean(b);
  const sab = sum(a.map((v, k) => (v - ma) * (b[k] - mb)));
  const saa = sum(a.map((v) => (v - ma) ** 2));
  const sbb = sum(b.map((v) => (v - mb) ** 2));
  const den = Math.sqrt(saa * sbb);
  return den === 0 ? NaN : Math.min(1, Math.max(-1, sab / den));
}

function activeReturns(r: Vec, b: Vec): Vec {
  sameLength(r, b, "active returns");
  return r.map((x, i) => x - b[i]);
}

// Tracking error: the sample standard deviation of the DAILY active returns (portfolio less
// benchmark), times the square root of 252.
export function trackingError(r: Vec, b: Vec): number {
  return std(activeReturns(r, b)) * Math.sqrt(TRADING_DAYS);
}

// Information ratio: the annualised mean active return (daily mean times 252) over the tracking
// error. NaN when the tracking error is zero, e.g. the benchmark scored against itself.
export function informationRatio(r: Vec, b: Vec): number {
  const te = trackingError(r, b);
  return te > 0 ? (mean(activeReturns(r, b)) * TRADING_DAYS) / te : NaN;
}

export interface TailLoss {
  /** One-day historical value at risk, a POSITIVE loss (0.02 = a 2% fall). */
  var: number;
  /** Expected shortfall: the mean of the days at or below the VaR return, also a positive loss. */
  es: number;
}

// Historical one-day VaR and expected shortfall. `tail` is the tail probability, 0.05 for 95%. The
// quantile is numpy's default "linear" percentile, reproduced step for step (virtual index (n-1)p,
// and its two-sided interpolation) so the set of days "at or below" it is the same set numpy finds.
export function historicalTail(r: Vec, tail = 0.05): TailLoss {
  const n = r.length;
  if (n < 1) return { var: NaN, es: NaN };
  const s = [...r].sort((x, y) => x - y);
  const v = (n - 1) * tail;
  let q: number;
  if (v >= n - 1) q = s[n - 1];
  else {
    const lo = Math.floor(v);
    const g = v - lo;
    const d = s[lo + 1] - s[lo];
    q = g >= 0.5 ? s[lo + 1] - d * (1 - g) : s[lo] + d * g;
  }
  const worst = r.filter((x) => x <= q);
  return { var: -q, es: -mean(worst) };
}

// Standard error of the ANNUALISED Sharpe ratio: Lo (2002) under iid returns with Mertens' (2002)
// allowance for skew and fat tails, on the DAILY Sharpe SR = (mean - rf/252) / sd,
//   SE_daily = sqrt((1 + SR^2/2 - skew*SR + (excess kurtosis/4)*SR^2) / T),
// then times sqrt(252). The moments are the sample estimators this file already ships: sd with
// ddof=1, skew() the adjusted G1 and excessKurtosis() the bias-corrected G2, so the error sits on the
// same figures the Returns tab prints beside it; over hundreds of days the population versions move
// it far less than its own uncertainty. NaN below four days (the kurtosis needs them) or on a flat
// series, and NaN rather than a clipped zero if the bracket ever goes negative.
export function sharpeSE(r: Vec, rf: number): number {
  const T = r.length;
  if (T < 2) return NaN;
  const sd = std(r);
  if (!(sd > 0)) return NaN;
  const sr = (mean(r) - rf / TRADING_DAYS) / sd;
  const g1 = skew(r);
  const g2 = excessKurtosis(r);
  const bracket = 1 + (sr * sr) / 2 - g1 * sr + (g2 / 4) * sr * sr;
  return Math.sqrt(bracket / T) * Math.sqrt(TRADING_DAYS);
}

export interface ReturnShare {
  /** w_i mu_i / sum_j w_j mu_j per asset, never clipped: below 0 or above 1 when a mean or a weight is negative. */
  share: Vec;
  /** True when the portfolio's expected return is within SHARE_EPS of zero; every share is then NaN. */
  degenerate: boolean;
}

export const SHARE_EPS = 1e-12;

// Return share, the counterpart of riskContribution: each asset's part of the portfolio's expected
// return. `mu` may be daily or annual means (the shares do not depend on the scale), but SHARE_EPS
// is an absolute test on the denominator in that same unit.
export function returnShare(w: Vec, mu: Vec): ReturnShare {
  sameLength(w, mu, "returnShare");
  const parts = w.map((x, i) => x * mu[i]);
  const total = sum(parts);
  const degenerate = !(Math.abs(total) > SHARE_EPS);
  return { share: parts.map((p) => (degenerate ? NaN : p / total)), degenerate };
}

// How much the optimizer has to estimate, against how much data it has.
export const TN_WARN = 25; // days per asset below which the window is thin
export const TN_REFUSE = 10; // days per asset below which the one-year window is not offered

export interface AssetLoad {
  /** Standard error of the asset's annualised mean return: annual volatility / sqrt(years), decimal. */
  se: number;
  /** Years of daily data needed to pin that mean to plus or minus h: (annual volatility / h)^2. */
  yearsNeeded: number;
}

export interface EstimationLoad {
  n: number;
  days: number;
  /** days / 252. */
  years: number;
  /** One expected return per asset. */
  means: number;
  /** Variances and covariances, N(N+1)/2. */
  covariances: number;
  /** days / N. */
  daysPerAsset: number;
  /** The h the years are counted for, decimal (0.02 = 2 points a year). */
  h: number;
  assets: AssetLoad[];
}

export function estimationLoad(cols: Vec[], h = 0.02): EstimationLoad {
  const n = cols.length;
  const days = n ? cols[0].length : 0;
  const years = days / TRADING_DAYS;
  const assets = cols.map((c) => {
    const sigma = std(c) * Math.sqrt(TRADING_DAYS);
    return { se: sigma / Math.sqrt(years), yearsNeeded: (sigma / h) ** 2 };
  });
  return {
    n, days, years, means: n, covariances: (n * (n + 1)) / 2, daysPerAsset: days / n, h, assets,
  };
}

export type LoadVerdict = "ok" | "warn" | "refuse";

// Which threshold a window of `days` trading days over `n` assets crosses. The caller asks it of the
// SHORTEST window on offer: "warn" below TN_WARN days per asset, "refuse" (do not offer the one-year
// window) below TN_REFUSE.
export function loadVerdict(days: number, n: number): LoadVerdict {
  const tn = days / n;
  if (tn < TN_REFUSE) return "refuse";
  if (tn < TN_WARN) return "warn";
  return "ok";
}

export interface ScoreRow {
  // Return
  annualReturn: number; // compound, decimal a year
  cumulative: number; // decimal
  mu: number; // arithmetic mean x 252, decimal a year (what the plates print)
  bestMonth: number; // decimal, complete months only
  worstMonth: number;
  positiveMonths: number; // share of complete months above zero, 0..1
  completeMonths: number; // count
  // Risk
  volatility: number; // decimal a year
  downside: number; // decimal a year
  maxDrawdown: number; // decimal, negative (as maxDrawdown returns it)
  longest: DrawdownSpell;
  // Risk-adjusted
  sharpe: number;
  sharpeSE: number; // annualised, same units as the Sharpe
  sortino: number;
  calmar: number;
  // Against the benchmark
  beta: number;
  alphaAnn: number; // decimal a year, CAPM on excess returns
  correlation: number;
  r2: number;
  trackingError: number; // decimal a year
  informationRatio: number;
  upCapture: number; // ratio, 1 = 100%
  downCapture: number;
  upMonths: number;
  downMonths: number;
  // Tail
  var95: number; // one-day, positive loss, decimal
  es95: number;
}

// Every scorecard figure for one column. `r` is the column's daily returns, `b` the benchmark's on
// the same `dates`; `start` as in longestDrawdown (it also decides whether the drawdown and Calmar
// count from the amount invested).
export function scorecardRow(r: Vec, b: Vec, dates: readonly string[], start: string | null, rf: number): ScoreRow {
  const s = annualizedStats(r, rf);
  const m = monthStats(monthlyReturns(r, dates));
  const cap = captureRatios(r, b, dates);
  const fit = capm(r, b, rf);
  const corr = correlation(r, b);
  const t = historicalTail(r, 0.05);
  const withStart = start !== null;
  return {
    annualReturn: annualReturn(r),
    cumulative: cumulativeReturn(r),
    mu: s.mu,
    bestMonth: m.best,
    worstMonth: m.worst,
    positiveMonths: m.positive,
    completeMonths: m.months,
    volatility: s.sigma,
    downside: downsideDeviation(r, rf),
    maxDrawdown: maxDrawdown(r, withStart),
    longest: longestDrawdown(r, dates, start),
    sharpe: s.sharpe,
    sharpeSE: sharpeSE(r, rf),
    sortino: s.sortino,
    calmar: calmar(r, withStart),
    beta: fit.beta,
    alphaAnn: fit.alphaAnn,
    correlation: corr,
    r2: corr ** 2,
    trackingError: trackingError(r, b),
    informationRatio: informationRatio(r, b),
    upCapture: cap.up,
    downCapture: cap.down,
    upMonths: cap.upMonths,
    downMonths: cap.downMonths,
    var95: t.var,
    es95: t.es,
  };
}
