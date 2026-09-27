// Return statistics: tabs 1-3 of the Streamlit app (Returns & Statistics, Risk Analysis,
// Correlation). Line numbers cite portfolio_app.py.
import { mean, std, sum, variance, type Vec } from "./num.ts";

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
  const rfDaily = rf / TRADING_DAYS;
  const sharpe = sigma > 0 ? (mu - rf) / sigma : NaN;
  const sq = r.map((x) => Math.min(x - rfDaily, 0) ** 2);
  const downside = Math.sqrt(mean(sq)) * Math.sqrt(TRADING_DAYS);
  const sortino = downside > 0 ? (mu - rf) / downside : NaN;
  return { mu, sigma, sharpe, sortino };
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
