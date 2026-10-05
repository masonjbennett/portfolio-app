// Mutation check for the engine: every mutation below reintroduces a plausible defect, and the suite
// must FAIL on each one. A mutation the suite survives is an assertion that checks nothing.
//
//   node test/_mutate-engine.mjs                                  every mutation
//   node test/_mutate-engine.mjs src/lib/optimize.ts              only that file's mutations
//   node test/_mutate-engine.mjs src/lib/optimize.ts t-constructions
//                                  only that file's mutations that name that suite (see the fifth field)
//
// A file argument that no mutation names is an ERROR (exit 2), so a typo cannot pass as zero survivors, and
// so is a suite argument that none of that file's mutations name. With a suite argument, only that suite is
// required to be green unmutated, so a file's newer entries can run without its whole-run entries.
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
  // episodes.ts (drawdown episodes, stretch returns, the related event), judged by t-periods alone
  ["src/lib/episodes.ts", "let hi = 0; // the amount invested is the first high", "let hi = 1; // the amount invested is the first high", "the first high taken at the first close, not at the amount invested", "t-periods"],
  ["src/lib/episodes.ts", "if (path[j] >= path[hi]) {", "if (path[j] > path[hi]) {", "recovery on the first close above the high, not at or above it", "t-periods"],
  ["src/lib/episodes.ts", "return { trading: b - a, calendar: calendarDays(when[a], when[b]) };", "return { trading: calendarDays(when[a], when[b]), calendar: calendarDays(when[a], when[b]) };", "trading days reported as calendar days", "t-periods"],
  ["src/lib/episodes.ts", "for (let i = hi + 2; i <= lastUnder; i++) if (path[i] < path[lo]) lo = i;", "", "the trough taken at the first close under water, not the lowest", "t-periods"],
  ["src/lib/episodes.ts", "if (hi < path.length - 1) all.push(episode(hi, path.length - 1, null));", "", "a fall still open on the last day is never listed", "t-periods"],
  ["src/lib/episodes.ts", "all.sort((a, b) => a.depth - b.depth || (a.start < b.start ? -1 : 1));", "all.sort((a, b) => a.depth - b.depth || (a.start < b.start ? 1 : -1));", "equal depths ordered later first", "t-periods"],
  ["src/lib/episodes.ts", "const a = lastOnOrBefore(when, from);", "const a = lastOnOrBefore(when, from) + 1;", "a stretch's first close taken after its first day", "t-periods"],
  ["src/lib/episodes.ts", "return start <= from && last >= to;", "return start <= from;", "a stretch that runs past the last close reported over the part the window holds", "t-periods"],
  ["src/lib/episodes.ts", "if (!(lo < hi)) continue;", "if (!(lo <= hi)) continue;", "a fall that shares a single date with an event counted as related", "t-periods"],
  ["src/lib/episodes.ts", "if (best === null || shared > most || (shared === most && e.from < best.from)) {", "if (best === null || shared < most || (shared === most && e.from < best.from)) {", "the related event is the one sharing the fewest days", "t-periods"],
  ["src/lib/episodes.ts", "(shared === most && e.from < best.from)", "(shared === most && e.from > best.from)", "an equal overlap goes to the later event", "t-periods"],
  // monthly.ts, calendar years and the month grid, judged by t-periods alone
  ["src/lib/monthly.ts", "for (let t = from; t < i; t++) g *= 1 + r[t];", "for (let t = from; t < i; t++) g += r[t];", "a year's returns added, not compounded", "t-periods"],
  ["src/lib/monthly.ts", "out.forEach((y, i) => (y.partial = i === 0 || i === lastYear));", "out.forEach((y, i) => (y.partial = !(i === 0 || i === lastYear)));", "the years' partial flag inverted", "t-periods"],
  ["src/lib/monthly.ts", "if (i < r.length && dates[i].slice(0, 4) === dates[from].slice(0, 4)) continue;", "if (i < r.length && dates[i].slice(0, 7) === dates[from].slice(0, 7)) continue;", "a year split at every month", "t-periods"],
  ["src/lib/monthly.ts", "first: dates[from], last: dates[i - 1],", "first: dates[Math.max(0, from - 1)], last: dates[i - 1],", "a year's first date taken from the year before", "t-periods"],
  ["src/lib/monthly.ts", ".months[Number(m.ym.slice(5, 7)) - 1] = m;", ".months[Number(m.ym.slice(5, 7)) % 12] = m;", "the grid's months one column late", "t-periods"],
  // the scorecard's added constructions (constructions.ts, the capped tangency and risk parity in
  // optimize.ts, their fragility rows in robust.ts), judged by t-constructions alone
  ["src/lib/constructions.ts", "  const phi = (n + 2) / (n + 2 + T * dot(d, b));", "  const phi = n / (n + T * dot(d, b));", "shrinkage intensity without the n + 2", "t-constructions"],
  ["src/lib/constructions.ts", "  const mu0 = dot(a, m) / sum(a);", "  const mu0 = sum(m) / n;", "shrinkage target from equal weights, not the minimum-variance mix", "t-constructions"],
  ["src/lib/constructions.ts", "  const Sig = S.map((row) => row.map((v) => (v * (T - 1)) / (T - n - 2)));", "  const Sig = S;", "the sample covariance left unadjusted by (T - 1) / (T - n - 2)", "t-constructions"],
  ["src/lib/constructions.ts", "  return { means: m.map((x) => (1 - phi) * x + phi * mu0), phi, mu0 };", "  return { means: m.map((x) => phi * x + (1 - phi) * mu0), phi, mu0 };", "the intensity applied the wrong way round", "t-constructions"],
  ["src/lib/constructions.ts", "      const t = shrink && tangency(shrink.means, S, rf, allowShort);", "      const t = shrink && tangency(m, S, rf, allowShort);", "the shrunk means computed and then not used", "t-constructions"],
  ["src/lib/constructions.ts", "    const { m, S } = windowMoments(cols, YEAR_ROWS);", "    const { m, S } = windowMoments(cols.map((c) => c.slice(0, YEAR_ROWS)), YEAR_ROWS);", "the year taken from the start of the window", "t-constructions"],
  ["src/lib/constructions.ts", "      if (T <= YEAR_ROWS) return \"window-is-one-year\";", "      if (T < YEAR_ROWS) return \"window-is-one-year\";", "a window of exactly one year offered as a last-year column", "t-constructions"],
  ["src/lib/constructions.ts", "      return loadVerdict(YEAR_ROWS, n) === \"refuse\" ? \"year-too-thin\" : null;", "      return loadVerdict(T, n) === \"refuse\" ? \"year-too-thin\" : null;", "the thin-year test run on the whole window", "t-constructions"],
  ["src/lib/constructions.ts", "      return T > n + 2 ? null : \"too-few-rows\";", "      return T >= n + 2 ? null : \"too-few-rows\";", "shrinkage offered at T = n + 2", "t-constructions"],
  ["src/lib/constructions.ts", "  const Sig = S.map((row) => row.map((v) => (v * (T - 1)) / (T - n - 2)));", "  const Sig = S.map((row) => row.map((v) => (v * (T - 1)) / (T - n - 1)));", "the covariance adjusted by T - n - 1, not T - n - 2", "t-constructions"],
  ["src/lib/constructions.ts", "      return n >= CAP_MIN_ASSETS ? null : \"too-few-assets\";", "      return n >= 4 ? null : \"too-few-assets\";", "the cap offered at four assets, where it forces equal weight", "t-constructions"],
  ["src/lib/constructions.ts", "      const t = tangencyCapped(m, S, rf, CAP);", "      const t = tangency(m, S, rf, allowShort);", "the capped column solved without its cap", "t-constructions"],
  ["src/lib/optimize.ts", "  for (let i = 0; i < n; i++) cons.push({ a: e.map((_, k) => (k === i ? cap - 1 : cap)), b: 0 });", "  for (let i = 0; i < n; i++) cons.push({ a: e.map((_, k) => (k === i ? -1 : 0)), b: -cap });", "the cap as y_i <= 0.25, not 0.25 * 1'y", "t-constructions"],
  ["src/lib/optimize.ts", "  const cons: { a: Vec; b: number }[] = [{ a: e.map((x) => x / c), b: 1 }, ...boxCons(n, false)];", "  const cons: { a: Vec; b: number }[] = [{ a: e.map((x) => x / c), b: 1 }, ...boxCons(n, true)];", "the capped tangency allows shorts", "t-constructions"],
  ["src/lib/optimize.ts", "      const w = x.map((xi) => xi / tot);", "      const w = x.map(() => 1 / n);", "risk parity stopping at equal weights", "t-constructions"],
  ["src/lib/optimize.ts", "    if (x.every((xi, i) => Math.abs((xi * Ax[i]) / v - 1 / n) <= RP_TOL)) {", "    if (true) {", "risk parity stopping at its inverse-volatility start", "t-constructions"],
  ["src/lib/robust.ts", "  if (kind === \"rp\") return (n * (n + 1)) / 2;", "  if (kind === \"rp\") return n + (n * (n + 1)) / 2;", "risk parity's parameter count including the means", "t-constructions"],
  ["src/lib/robust.ts", "      lookback: kind === \"tan.1y\" ? null : lookbackSpread(x.lookbacks),", "      lookback: lookbackSpread(x.lookbacks),", "the last-year tangency given a lookback row", "t-constructions"],
  ["src/lib/robust.ts", "  means[from] = returnBand(m, S, T, from).lo1 / TRADING_DAYS;", "  means[from] = returnBand(m, S, T, from).lo2 / TRADING_DAYS;", "an added column's cut at two standard errors, not one", "t-constructions"],
  ["src/lib/robust.ts", "  const ws = drawn.map((d) => solveAdded(id, d, S, T, rf, allowShort)?.w ?? null);", "  const ws = drawn.map((d) => tangency(d, S, rf, allowShort)?.w ?? null);", "every added strip re-solves the plain tangency", "t-constructions"],
  ["src/lib/robust.ts", "      draws: own && x.strip ? drawSpread(x.strip, largestHoldingTied(own.w)) : null,", "      draws: own && x.redraws ? drawSpread(x.redraws.tan, largestHoldingTied(own.w)) : null,", "an added column's draw row read from the tangency's redraws", "t-constructions"],
  ["src/lib/robust.ts", "  return top < 0 ? top : w.findIndex((x) => x >= w[top] - tol);", "  return top;", "holdings tied at the cap separated by rounding", "t-constructions"],
  // walkforward.ts
  ["src/lib/walkforward.ts", "  for (let holdFrom = FIRST_FIT; holdFrom < T; holdFrom += opts.hold) {", "  for (let holdFrom = opts.hold; holdFrom < T; holdFrom += opts.hold) {", "holds counted from the first fit's start instead of after it", "t-walkforward"],
  ["src/lib/walkforward.ts", "    folds.push({ fitFrom, fitTo: holdFrom, holdFrom, holdTo });", "    folds.push({ fitFrom, fitTo: holdFrom + 1, holdFrom, holdTo });", "each fit reads its hold's first day", "t-walkforward"],
  ["src/lib/walkforward.ts", "  for (let holdFrom = FIRST_FIT; holdFrom < T; holdFrom += opts.hold) {", "  for (let holdFrom = FIRST_FIT; holdFrom + opts.hold <= T; holdFrom += opts.hold) {", "the partial last hold dropped", "t-walkforward"],
  ["src/lib/walkforward.ts", "    const fitFrom = opts.fit === \"rolling\" ? holdFrom - FIRST_FIT : 0;", "    const fitFrom = 0;", "a rolling fit reading all history", "t-walkforward"],
  ["src/lib/walkforward.ts", "  return { folds: out, joined, sharpe: joinedScore.sharpe, se: joinedScore.se };", "  return { folds: out, joined, sharpe: mean(pieces.map((s) => scored(s, rates).sharpe)), se: joinedScore.se };", "the mean of the holds' Sharpes instead of the joined series'", "t-walkforward"],
  ["src/lib/walkforward.ts", "  return portfolioReturns(held, w);", "  let v = w.slice();\n  return held[0].map((_, t) => {\n    const before = v.reduce((a, b) => a + b, 0);\n    v = v.map((x, i) => x * (1 + held[i][t]));\n    return v.reduce((a, b) => a + b, 0) / before - 1;\n  });", "weights left to drift through a hold instead of rebalanced daily", "t-walkforward"],
  ["src/lib/walkforward.ts", "      const t = tangency(m, S, rf, allowShort);", "      const t = tangency(m, S, 0, allowShort);", "the risk-free rate left out of the maximum-Sharpe fit", "t-walkforward"],
  ["src/lib/walkforward.ts", "  const fitRates = folds.map((f) => (daily ? daily[f.fitTo - 1] : flatRate));", "  const fitRates = folds.map((f) => (daily ? daily[f.fitTo] : flatRate));", "a fit's rate read on the day after its last row", "t-walkforward"],
  ["src/lib/walkforward.ts", "  const scoreRates: RowRates = daily ? daily : flatRate;", "  const scoreRates: RowRates = daily ? daily.map((x, t) => { const k = folds.findIndex((f) => t >= f.holdFrom && t < f.holdTo); return k < 0 ? x : fitRates[k]; }) : flatRate;", "held days scored at their fit's rate instead of their own", "t-walkforward"],
  ["src/lib/walkforward.ts", "  return { ok: true, rates: out };", "  return { ok: true, rates: out.map(() => mean(out)) };", "every day scored at the window's average rate", "t-walkforward"],
  ["src/lib/walkforward.ts", "export const MIN_HOLD = 63;", "export const MIN_HOLD = 62;", "the reportable-hold floor at 62 rows", "t-walkforward"],
  ["src/lib/walkforward.ts", "    const b = replay([bench], folds, folds.map(() => [1]), scoreRates);", "    const b = replay([bench], [{ fitFrom: 0, fitTo: 0, holdFrom: 0, holdTo: T }], [[1]], scoreRates);", "the benchmark scored on the whole window instead of its held days", "t-walkforward"],
  ["src/lib/walkforward.ts", "  const inSampleRate = daily ? daily[T - 1] : flatRate;", "  const inSampleRate = daily ? mean(daily) : flatRate;", "the in-sample column fitted at the window's average rate", "t-walkforward"],
  ["src/lib/walkforward.ts", "          return r.length >= MIN_HOLD ? sharpeOn(r, f.holdFrom, scoreRates) : null;", "          return r.length >= MIN_HOLD ? sharpeOn(r, 0, scoreRates) : null;", "a solved fold beside a failed one scored on the rates from the window's first row", "t-walkforward"],
  ["src/lib/walkforward.ts", "      out[id] = { w: t?.w ?? null, unavailable: null, beatsRf: t ? t.beatsRf : null };", "      out[id] = { w: t?.w ?? null, unavailable: null, beatsRf: t ? true : null };", "a tangency below its fit's rate reported as beating it", "t-walkforward"],
  ["src/tabs/WalkForward.tsx", "  if (a.rfSource === \"manual\") return { basis, points: null, flat: \"typed\" };\n", "", "a rate typed in the rail run per period when the daily series is held", "t-tab-walkforward"],
  ["src/tabs/WalkForward.tsx", "      show(\"basket\", true);", "", "a rerun that leaves the published segment showing", "t-app"],
  ["src/tabs/WalkForward.tsx", "    document.getElementById(tabId(PREFIX, view))?.focus({ preventScroll: true });", "", "a landing that leaves the focus where the clicked control was", "t-app"],
  ["src/App.tsx", "        if (land) setLanding((n) => n + 1);", "", "a way in that switches the tab without landing the reader on it", "t-app"],
  ["src/App.tsx", "    if (n <= landed.current) return false;", "", "a landing taken again by every later mount of the tab", "t-app"],
  ["src/chrome/Band.tsx", "onClick={() => page.setTab(\"walkforward\", \"published\", true)}", "onClick={() => page.setTab(\"walkforward\", \"published\")}", "the band's control switching without landing", "t-app"],
  ["src/tabs/FittedNote.tsx", "onClick={() => page.setTab(\"walkforward\", \"published\", true)}", "onClick={() => page.setTab(\"walkforward\", \"published\")}", "the in-sample note switching without landing", "t-app"],
  ["src/tabs/walkforward/live.ts", "  const short = w.folds.flatMap((f, k) => (f.bars < MIN_HOLD ? [k] : []));", "  if (w) return null;\n  const short = w.folds.flatMap((f, k) => (f.bars < MIN_HOLD ? [k] : []));", "a short hold's dash printed with no reason", "t-tab-walkforward"],
  ["src/tabs/walkforward/live.ts", "n === 1 ? \"day\" : \"days\"", "\"days\"", "one day printed as \"1 days\"", "t-tab-walkforward"],
  ["src/tabs/walkforward/live.ts", "      fitDays: f.fitTo - f.fitFrom,", "      fitDays: f.holdTo - f.holdFrom,", "the fit's count of returns taken from its hold", "t-tab-walkforward"],
  ["src/tabs/walkforward/live.ts", "    if (b !== false || !wt) return [];", "    if (b === null || !wt) return [];", "every maximum-Sharpe hold named as below its rate", "t-tab-walkforward"],
  ["src/tabs/walkforward/live.ts", "  const lastYear = w.runs.some((r) => r.id === \"tan.1y\") ?", "  const lastYear = w.runs.some((r) => r.id === \"none\") ?", "the in-sample head silent on the last-year row's own window", "t-tab-walkforward"],
  ["src/tabs/walkforward/live.ts", "  if (!res.ok && res.reason === \"rates-start-late\") throw new Error(`the rate series starts on ${res.first ?? \"no day\"}, after ${res.day}`);", "", "a series that starts too late passed on unnamed", "t-tab-walkforward"],
  ["src/tabs/walkforward/live.ts", "  return Math.abs(rate * 1000 - Math.round(rate * 1000)) < 1e-9 ? format(rate, \"pct1\") : format(rate, \"pct2\");", "  return format(rate, \"pct2\");", "a typed 2.0% printed as 2.00% beside the published 2.0%", "t-tab-walkforward"],
  ["src/tabs/walkforward/Published.tsx", "{into.holdFirst.slice(0, 4)}.", "{into.holdLast.slice(0, 4)}.", "the AGG sentence's year read from the hold's last day", "t-walkforward-published"],
  ["src/content/tooltips.ts", "export const SCORE_TIPS: Readonly<Record<ScoreTipKey, Texts>> = {", "import { WALK_TIPS as WT } from \"../tabs/walkforward/tips.ts\";\nexport const SCORE_TIPS: Readonly<Record<ScoreTipKey, Texts>> = {\n  ...(Object.fromEntries(Object.entries(WT).map(([k, t]) => [`wf_${k}`, t.texts])) as Record<ScoreTipKey, Texts>),", "the walk-forward tab's tooltip texts registered with the page's own tooltips, in the first chunk", "t-split"],
  ["src/tabs/walkforward/Dumbbell.tsx", "  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;", "  return Math.min(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);", "the gridline step stopped at 1, a line per unit on a wide axis", "t-tab-walkforward"],
];

const missing = [...new Set(M.map(([, , , , suite]) => suite).filter((s) => s && !existsSync(suitePath(s))))];
if (missing.length) {
  console.log(`ERROR  no such suite: ${missing.join(", ")}`);
  process.exit(2);
}

const only = process.argv[2] ? process.argv[2].replace(/\\/g, "/").replace(/^\.\//, "") : null;
const suiteOnly = process.argv[3] ? process.argv[3].replace(/\\/g, "/").replace(/^.*\//, "").replace(/\.mjs$/, "") : null;
const ofFile = only ? M.filter(([file]) => file === only) : M;
if (!ofFile.length) {
  console.log(`ERROR  no mutation names ${only}; files with mutations: ${[...new Set(M.map(([f]) => f))].join(", ")}`);
  process.exit(2);
}
const todo = suiteOnly ? ofFile.filter(([, , , , suite]) => suite === suiteOnly) : ofFile;
if (!todo.length) {
  const named = [...new Set(ofFile.map(([, , , , suite]) => suite).filter(Boolean))];
  console.log(`ERROR  no mutation of ${only} names the suite ${suiteOnly}; suites its mutations name: ${named.join(", ") || "none (each is judged by the whole run)"}`);
  process.exit(2);
}
if (run(suiteOnly ?? undefined) !== 0) {
  console.log(`${suiteOnly ?? "The suite"} is red UNMUTATED; fix that first.`);
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
console.log(`_mutate-engine: ${killed}/${todo.length} mutations killed${only ? ` (${only}${suiteOnly ? `, ${suiteOnly}` : ""} only)` : ""}`);
process.exit(survivors.length ? 1 : 0);
