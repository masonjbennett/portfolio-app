// Mutation check for the engine: every mutation below reintroduces a plausible defect, and the suite
// must FAIL on each one. A mutation the suite survives is an assertion that checks nothing.
//
//   node test/_mutate-engine.mjs                          every mutation
//   node test/_mutate-engine.mjs src/lib/optimize.ts      only that file's mutations
//
// A file argument that no mutation names is an ERROR (exit 2), so a typo cannot pass as zero survivors.
// It refuses to start if the suite is red unmutated, and a `find` that no longer matches is an ERROR
// (that is how a refactor shows up), never a silent skip. Files are restored after every mutation.
//
// An entry is [file, find, replace, why] or [file, find, replace, why, suite]. With no fifth field the
// mutant is judged by the WHOLE run (test/run.mjs), as every entry written before the field existed
// still is. A fifth field names the one suite that must catch it (e.g. "t-metrics"): only that suite
// runs for that mutant, which keeps a mutant of a new function from costing a full run each. A named
// suite that does not exist is an ERROR before anything is mutated: a spawn that fails to start
// exits non-zero, and would otherwise count every mutant as killed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const loader = new URL("./_tsx.mjs", import.meta.url).href;
const suitePath = (suite) => `${root}test/${suite}.mjs`;
const run = (suite) =>
  suite
    ? spawnSync(process.execPath, ["--import", loader, suitePath(suite)], { encoding: "utf8" }).status
    : spawnSync(process.execPath, [root + "test/run.mjs"], { encoding: "utf8" }).status;

const M = [
  // num.ts
  ["src/lib/num.ts", "return sum(sq) / (n - ddof);", "return sum(sq) / n;", "population variance instead of ddof=1"],
  ["src/lib/num.ts", "const v = dot(centred[i], centred[j]) / (n - ddof);", "const v = dot(centred[i], centred[j]) / n;", "covariance divided by n"],
  ["src/lib/num.ts", "const divisor = Math.sqrt(ssqdmx * ssqdmy);", "const divisor = Math.sqrt(ssqdmx * ssqdmx);", "correlation normalised by the wrong variance"],
  ["src/lib/num.ts", "out[num - 1] = stop;", "", "linspace endpoint not pinned to stop"],
  ["src/lib/num.ts", "for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];", "for (let k = i + 1; k < n; k++) s -= L[i][k] * x[k];", "Cholesky back-substitution transposed"],
  // stats.ts
  ["src/lib/stats.ts", "const sq = r.map((x) => Math.min(x - rfDaily, 0) ** 2);", "const sq = r.map((x) => Math.min(x, 0) ** 2);", "Sortino target ignores the risk-free rate"],
  ["src/lib/stats.ts", "const downside = Math.sqrt(mean(sq)) * Math.sqrt(TRADING_DAYS);", "const downside = Math.sqrt(mean(sq.filter((x) => x > 0))) * Math.sqrt(TRADING_DAYS);", "downside averaged over the negative days only (the README misreading)"],
  ["src/lib/stats.ts", "const sharpe = sigma > 0 ? (mu - rf) / sigma : NaN;", "const sharpe = sigma > 0 ? mu / sigma : NaN;", "Sharpe without the risk-free rate"],
  ["src/lib/stats.ts", "export function wealth(r: Vec, w0 = 1, includeStart = true): Vec {", "export function wealth(r: Vec, w0 = 1, includeStart = false): Vec {", "wealth path loses its starting value"],
  ["src/lib/stats.ts", "return ((n * (n - 1) ** 0.5) / (n - 2)) * (m3 / m2 ** 1.5);", "return (m3 / n) / (m2 / n) ** 1.5;", "biased skew instead of pandas' adjusted G1"],
  ["src/lib/stats.ts", "return num / den - adj;", "return num / den;", "raw kurtosis instead of excess"],
  ["src/lib/stats.ts", "return r.map((_, i) => (i + 1 < w ? NaN : Math.sqrt(variance(r.slice(i + 1 - w, i + 1)))));", "return r.map((_, i) => (i + 1 < w ? NaN : Math.sqrt(variance(r.slice(i - w, i)))));", "rolling window off by one"],
  ["src/lib/stats.ts", "const y = b.slice(i + 1 - w, i + 1);", "const y = b.slice(i - w, i);", "rolling correlation windows misaligned"],
  ["src/lib/stats.ts", "return { slope, intercept: my - slope * mx, r };", "return { slope, intercept: my - slope * my, r };", "regression intercept wrong"],
  ["src/lib/stats.ts", "const fit = linregress(bench.map((x) => x - rfd), stock.map((x) => x - rfd));", "const fit = linregress(bench.map((x) => x - rfd), stock);", "CAPM alpha on raw, not excess, returns"],
  ["src/lib/stats.ts", "r * 2509.0809287301226727", "r * 2509.08", "an AS241 coefficient rounded to six figures"],
  ["src/lib/stats.ts", "for (let i = 2; i < n; i++) med[i - 1] = (i - 0.3175) / (n + 0.365);", "for (let i = 2; i < n; i++) med[i - 1] = (i - 0.375) / (n + 0.25);", "Blom plotting positions instead of Filliben's"],
  // optimize.ts
  ["src/lib/optimize.ts", "cons.push({ a: e, b: allowShort ? -1 : 0 });", "cons.push({ a: e, b: allowShort ? -2 : 0 });", "short lower bound -2 instead of -1"],
  ["src/lib/optimize.ts", "if (allowShort) cons.push({ a: e.map((v) => -v), b: -1 });", "", "short mode loses its upper bound"],
  ["src/lib/optimize.ts", "if (!wF.every((v) => v > 0)) continue;", "if (!wF.every((v) => v > -0.5)) continue;", "tangency accepts infeasible supports"],
  ["src/lib/optimize.ts", "cons.push({ a: new Array<number>(n).fill(1).map((v, k) => (k === i ? v - 1 : v)), b: 0 });", "", "short tangency loses its upper bound"],
  ["src/lib/optimize.ts", "if (Math.abs(t - top.mu) <= 1e-12 * Math.abs(top.mu)) {", "if (false) {", "no vertex fallback at the top of the frontier"],
  ["src/lib/optimize.ts", "for (const i of m.map((_, i) => i).sort((a, b) => m[b] - m[a])) {", "for (const i of m.map((_, i) => i).sort((a, b) => m[a] - m[b])) {", "maximum return spends on the worst means first"],
  ["src/lib/optimize.ts", "if (n > FACES_CAP) return null;", "", "the face walk runs past its cap, into `1 << n` overflow"],
  ["src/lib/optimize.ts", "if (e.some((x) => x > 0)) return tangencyLongQP(m, S, rf);", "if (e.every((x) => x > 0)) return tangencyLongQP(m, S, rf);", "long-only tangency skips the QP unless every asset beats rf"],
  ["src/lib/optimize.ts", "return n <= FACES_UP_TO ? tangencyFaces(m, S, rf) : bestLoneAsset(m, S, rf);", "return tangencyFaces(m, S, rf);", "the face walk serves every size when nothing beats rf"],
  ["src/lib/optimize.ts", "[{ a: e.map((x) => x / c), b: 1 }, ...boxCons(n, false)], 1);", "[{ a: e.map((x) => x / c), b: 1 }, ...boxCons(n, true)], 1);", "long-only tangency QP allows short positions"],
  ["src/lib/optimize.ts", "if (!e.some((x) => x > 0)) return null;", "if (e.some((x) => x > 0)) return null;", "long-only tangency QP refuses exactly the problems it can solve"],
  ["src/lib/optimize.ts", "return sharpeOf(yp.map((v) => v / tot), m, S, rf);", "return sharpeOf(yp, m, S, rf);", "long-only tangency QP weights not normalised to 1"],
  ["src/lib/optimize.ts", "if (Number.isFinite(cand.sharpe) && (!best || cand.sharpe > best.sharpe)) best = cand;", "if (Number.isFinite(cand.sharpe) && (!best || cand.sharpe < best.sharpe)) best = cand;", "nothing beats rf: the worst single asset instead of the best"],
  // portfolio.ts
  ["src/lib/portfolio.ts", "return w.map((x, i) => (x * marginal[i]) / v);", "return w.map((x, i) => x * marginal[i]);", "risk contribution not normalised"],
  ["src/lib/portfolio.ts", "return { ...p, sortino: annualizedStats(r, rf).sortino, mdd: maxDrawdown(r, includeStart) };", "return { ...p, sortino: annualizedStats(r, 0).sortino, mdd: maxDrawdown(r, includeStart) };", "portfolio Sortino at rf 0"],
  ["src/lib/portfolio.ts", "for (let i = 0; i < cols.length; i++) s += cols[i][t] * w[i];", "for (let i = 0; i < cols.length; i++) s += cols[i][t] * w[0];", "portfolio returns use one weight"],
  ["src/lib/portfolio.ts", "if (!(total > 0.05)) return { ok: false, reason: \"net-short\", total };", "if (!(total > 0)) return { ok: false, reason: \"net-short\", total };", "custom accepts a 1% net book"],
  ["src/lib/portfolio.ts", "const v = raw.map((x) => Math.min(1, Math.max(lo, x)));", "const v = raw.slice();", "custom does not clamp to the bounds"],
  ["src/lib/portfolio.ts", "[252, \"1 Year\", 1],", "[250, \"1 Year\", 1],", "1-year window is not 252 rows"],
  ["src/lib/portfolio.ts", "const sub = cols.map((c) => c.slice(c.length - lb));", "const sub = cols.map((c) => c.slice(c.length - lb - 1, c.length - 1));", "windows do not end on the last date"],
  // clean.ts
  ["src/lib/clean.ts", "export const MAX_MISSING = 0.05;", "export const MAX_MISSING = 0.06;", "missing-data threshold moved"],
  ["src/lib/clean.ts", "(c, j) => c !== benchmark && raw.values[j].filter((v) => Number.isNaN(v)).length / n > MAX_MISSING,", "(c, j) => raw.values[j].filter((v) => Number.isNaN(v)).length / n > MAX_MISSING,", "benchmark no longer exempt from the 5% rule"],
  ["src/lib/clean.ts", "values: frame.values.map((p) => p.slice(1).map((x, i) => x / p[i] - 1)),", "values: frame.values.map((p) => p.slice(1).map((x, i) => (x - p[i]) / p[i])),", "returns computed in a different operation order"],
  ["src/lib/clean.ts", "const keep = opts.keepBenchmarkTicker ?? true;", "const keep = opts.keepBenchmarkTicker ?? false;", "port drops a benchmark that is also a ticker"],
  ["src/lib/clean.ts", "if (days(start, end) <= 0) return \"reversed\";", "", "reversed range gets the two-year message"],
  ["src/lib/clean.ts", "export const MIN_ROWS = 252;", "export const MIN_ROWS = 250;", "overlap minimum moved"],
  ["src/lib/clean.ts", "if (s) seen.add(s);", "seen.add(s);", "blank tickers kept"],
  // monthly.ts (the scorecard's calendar months), judged by t-metrics alone
  ["src/lib/monthly.ts", "const key = dates[i].slice(0, 7);", "const key = dates[i].slice(0, 4);", "months keyed by year: the wrong month boundary", "t-metrics"],
  ["src/lib/monthly.ts", "out[out.length - 1].partial = true;", "", "the last month, cut off by the window's end, scored as complete", "t-metrics"],
  ["src/lib/monthly.ts", "const done = months.filter((m) => !m.partial);", "const done = months;", "partial months scored in best, worst and % positive", "t-metrics"],
  ["src/lib/monthly.ts", "if (bm[i].partial) continue;", "", "capture counts the partial months", "t-metrics"],
  ["src/lib/monthly.ts", "up: bUp.length ? mean(pUp) / mean(bUp) : NaN,", "up: bUp.length ? mean(bUp) / mean(pUp) : NaN,", "up capture inverted: benchmark over portfolio", "t-metrics"],
  // stats.ts, the scorecard's figures, judged by t-metrics alone
  ["src/lib/stats.ts", "return growth(r) ** (TRADING_DAYS / T) - 1;", "return growth(r) ** (1 / T) - 1;", "compound return per day, not per year", "t-metrics"],
  ["src/lib/stats.ts", "const trading = stop - pk;", "const trading = stop - pk - 1;", "longest drawdown counted from the first day under water, not from the peak", "t-metrics"],
  ["src/lib/stats.ts", "const calendar = calendarDays(when[pk], when[stop]);", "const calendar = stop - pk;", "calendar span counted in trading days", "t-metrics"],
  ["src/lib/stats.ts", "if (pk < path.length - 1) consider(pk, path.length - 1, false);", "", "a drawdown still open on the last day is never counted", "t-metrics"],
  ["src/lib/stats.ts", "const when = start !== null ? [start, ...dates] : dates;", "const when = dates;", "spell dates a day off when the path starts at the amount invested", "t-metrics"],
  ["src/lib/stats.ts", "return dd < 0 ? annualReturn(r) / Math.abs(dd) : NaN;", "return dd < 0 ? annualizedStats(r, 0).mu / Math.abs(dd) : NaN;", "Calmar on the arithmetic mean, not the compound rate", "t-metrics"],
  ["src/lib/stats.ts", "const den = Math.sqrt(saa * sbb);", "const den = Math.sqrt(saa * saa);", "correlation normalised by one series' variance twice", "t-metrics"],
  ["src/lib/stats.ts", "r2: corr ** 2,", "r2: corr,", "R-squared left unsquared", "t-metrics"],
  ["src/lib/stats.ts", "return std(activeReturns(r, b)) * Math.sqrt(TRADING_DAYS);", "return std(activeReturns(r, b), 0) * Math.sqrt(TRADING_DAYS);", "tracking error on the population, not the sample, deviation", "t-metrics"],
  ["src/lib/stats.ts", "return te > 0 ? (mean(activeReturns(r, b)) * TRADING_DAYS) / te : NaN;", "return te > 0 ? mean(activeReturns(r, b)) / te : NaN;", "information ratio on a daily mean over an annual tracking error", "t-metrics"],
  ["src/lib/stats.ts", "const v = (n - 1) * tail;", "const v = n * tail;", "percentile index n*p, not numpy's (n-1)*p", "t-metrics"],
  ["src/lib/stats.ts", "return { var: -q, es: -mean(worst) };", "return { var: -q, es: mean(worst) };", "expected shortfall signed as a return, not a loss", "t-metrics"],
  ["src/lib/stats.ts", "const sd = std(r);", "const sd = std(r, 0);", "Sharpe SE on the population, not the sample, deviation", "t-metrics"],
  ["src/lib/stats.ts", "const bracket = 1 + (sr * sr) / 2 - g1 * sr + (g2 / 4) * sr * sr;", "const bracket = 1 + (sr * sr) / 2 + g1 * sr + (g2 / 4) * sr * sr;", "the Mertens skew term's sign flipped", "t-metrics"],
  ["src/lib/stats.ts", "const bracket = 1 + (sr * sr) / 2 - g1 * sr + (g2 / 4) * sr * sr;", "const bracket = 1 + (sr * sr) / 2 - g1 * sr + ((g2 + 3) / 4) * sr * sr;", "raw kurtosis where the formula takes excess", "t-metrics"],
  ["src/lib/stats.ts", "return Math.sqrt(bracket / T) * Math.sqrt(TRADING_DAYS);", "return Math.sqrt(bracket / T);", "Sharpe SE left daily, not annualised", "t-metrics"],
  ["src/lib/stats.ts", "return { share: parts.map((p) => (degenerate ? NaN : p / total)), degenerate };", "return { share: parts.map((p) => (degenerate ? NaN : Math.min(1, Math.max(0, p / total)))), degenerate };", "return share clipped to 0..100%", "t-metrics"],
  ["src/lib/stats.ts", "const degenerate = !(Math.abs(total) > SHARE_EPS);", "const degenerate = !(total > SHARE_EPS);", "a negative expected return flagged as no return", "t-metrics"],
  ["src/lib/stats.ts", "covariances: (n * (n + 1)) / 2", "covariances: (n * (n - 1)) / 2", "covariances counted without the variances", "t-metrics"],
  ["src/lib/stats.ts", "return { se: sigma / Math.sqrt(years), yearsNeeded: (sigma / h) ** 2 };", "return { se: sigma / Math.sqrt(days), yearsNeeded: (sigma / h) ** 2 };", "SE of a mean over root days, not root years", "t-metrics"],
  ["src/lib/stats.ts", "return { se: sigma / Math.sqrt(years), yearsNeeded: (sigma / h) ** 2 };", "return { se: sigma / Math.sqrt(years), yearsNeeded: sigma / h };", "years needed not squared", "t-metrics"],
  ["src/lib/stats.ts", "if (tn < TN_WARN) return \"warn\";", "if (tn <= TN_WARN) return \"warn\";", "warns at exactly 25 days per asset", "t-metrics"],
  ["src/lib/stats.ts", "if (tn < TN_REFUSE) return \"refuse\";", "if (tn <= TN_REFUSE) return \"refuse\";", "refuses at exactly 10 days per asset", "t-metrics"],
  // robust.ts and rng.ts (the what-if, redraw and fragility arithmetic), judged by t-robust alone
  ["src/lib/robust.ts", "return S.map((row, i) => TRADING_DAYS * Math.sqrt(row[i] / T));", "return S.map((row, i) => TRADING_DAYS * Math.sqrt(row[i] / (T - 1)));", "standard error from T - 1 days", "t-robust"],
  ["src/lib/robust.ts", "const mu = Math.min(band.hi2, Math.max(band.lo2, annualMu));", "const mu = annualMu;", "what-if not held to two standard errors", "t-robust"],
  ["src/lib/robust.ts", "means[asset] = mu / TRADING_DAYS;", "means[asset] = mu;", "what-if mean left annual in a daily vector", "t-robust"],
  ["src/lib/robust.ts", "for (let i = 0; i < w.length; i++) if (best < 0 || w[i] > w[best]) best = i;", "for (let i = 0; i < w.length; i++) if (best < 0 || Math.abs(w[i]) > Math.abs(w[best])) best = i;", "largest holding by size, a short counted as a holding", "t-robust"],
  ["src/lib/robust.ts", "const scale = 1 / Math.sqrt(T);", "const scale = 1;", "draws spread as S, not S / T", "t-robust"],
  ["src/lib/robust.ts", "for (let k = 0; k <= i; k++) s += L[i][k] * zs[k];", "for (let k = 0; k <= i; k++) s += L[k][i] * zs[k];", "Cholesky factor transposed in the draw", "t-robust"],
  ["src/lib/robust.ts", "const hi = Math.ceil(pos);", "const hi = Math.floor(pos);", "lower percentile instead of numpy's linear", "t-robust"],
  ["src/lib/robust.ts", "const a = Array.from(xs).sort((x, y) => x - y);", "const a = Array.from(xs).sort();", "percentile sorts as strings", "t-robust"],
  ["src/lib/robust.ts", "for (const w of ok) largest[largestHolding(w)] += 1;", "for (const w of ok) largest[largestHolding(w)] = 1;", "largest-holding counts never pass one", "t-robust"],
  ["src/lib/robust.ts", "belowRf: tans.filter((t) => t && !t.beatsRf).length,", "belowRf: 0,", "draws below the risk-free rate never counted", "t-robust"],
  ["src/lib/robust.ts", "means: draws.map((d) => d.map((x) => x * TRADING_DAYS)),", "means: draws,", "drawn means reported daily, not annual", "t-robust"],
  ["src/lib/robust.ts", "if (ok.length < 2) return null;", "if (ok.length < 1) return null;", "lookback row from a single window", "t-robust"],
  ["src/lib/robust.ts", "const cut = nudgeTangency(m, S, rf, allowShort, T, from, band.lo1);", "const cut = nudgeTangency(m, S, rf, allowShort, T, from, band.lo2);", "cut row at two standard errors, not one", "t-robust"],
  ["src/lib/robust.ts", "const base = kind === \"tan\" ? tangency(x.m, x.S, x.rf, x.allowShort) : gmv(x.m, x.S, x.allowShort);", "const base = tangency(x.m, x.S, x.rf, x.allowShort);", "GMV's draw row reads the tangency's largest holding", "t-robust"],
  ["src/lib/robust.ts", "if (kind === \"tan\") return n + (n * (n + 1)) / 2;", "if (kind === \"tan\") return (n * (n + 1)) / 2;", "tangency's parameters leave out the means", "t-robust"],
  ["src/lib/rng.ts", "let a = seed >>> 0;", "let a = 0;", "the seed is ignored", "t-robust"],
  ["src/lib/rng.ts", "const theta = 2 * Math.PI * uniform();", "const theta = Math.PI * uniform();", "Box-Muller angle over half a circle", "t-robust"],
  ["src/lib/rng.ts", "spare = r * Math.sin(theta);", "spare = r * Math.cos(theta);", "the second normal of each pair repeats the first", "t-robust"],
];

const missing = [...new Set(M.map(([, , , , suite]) => suite).filter((s) => s && !existsSync(suitePath(s))))];
if (missing.length) {
  console.log(`ERROR  no such suite: ${missing.join(", ")}`);
  process.exit(2);
}

const only = process.argv[2] ? process.argv[2].replace(/\\/g, "/").replace(/^\.\//, "") : null;
const todo = only ? M.filter(([file]) => file === only) : M;
if (!todo.length) {
  console.log(`ERROR  no mutation names ${only}; files with mutations: ${[...new Set(M.map(([f]) => f))].join(", ")}`);
  process.exit(2);
}
if (run() !== 0) {
  console.log("The suite is red UNMUTATED; fix that first.");
  process.exit(2);
}
let killed = 0;
const survivors = [];
for (const [file, find, replace, why, suite] of todo) {
  const path = root + file;
  const src = readFileSync(path, "utf8");
  const hits = src.split(find).length - 1;
  if (hits !== 1) {
    console.log(`ERROR  ${file}: find matched ${hits} times: ${why}`);
    process.exit(2);
  }
  writeFileSync(path, src.replace(find, replace));
  try {
    if (run(suite) !== 0) killed += 1;
    else survivors.push(`${file}: ${why}${suite ? ` (${suite})` : ""}`);
  } finally {
    writeFileSync(path, src);
  }
}
for (const s of survivors) console.log(`SURVIVED  ${s}`);
console.log(`_mutate-engine: ${killed}/${todo.length} mutations killed${only ? ` (${only} only)` : ""}`);
process.exit(survivors.length ? 1 : 0);
