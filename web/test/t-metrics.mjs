// The scorecard's arithmetic (src/lib/stats.ts, src/lib/monthly.ts) held to the numpy / pandas
// oracle on every frozen basket, then the branches no basket reaches: a flat asset, a benchmark that
// never fell, a return share with nothing to divide by, and series too short to have a spread.
//
// Series covered per basket: every ticker, the benchmark, and the equal-weight, GMV and tangency
// portfolios (long-only, plus GMV and tangency with shorting), built from the oracle's own weights.
// Tolerances: 1e-12 relative, with an absolute floor where a figure can sit at zero (a monthly
// return, a mean active return). Durations, dates, counts and flags are compared exactly.
import { check, near, nearAll, close, done } from "./_assert.mjs";
import { SETS, derive } from "./_fixtures.mjs";
import { portfolioReturns } from "../src/lib/portfolio.ts";
import { MAX_TICKERS } from "../src/lib/clean.ts";
import { monthlyReturns, monthStats, captureRatios } from "../src/lib/monthly.ts";
import {
  TRADING_DAYS, annualizedStats, maxDrawdown, capm, downsideDeviation, cumulativeReturn, annualReturn,
  longestDrawdown, calmar, correlation, trackingError, informationRatio, historicalTail, sharpeSE,
  returnShare, SHARE_EPS, estimationLoad, loadVerdict, TN_WARN, TN_REFUSE, scorecardRow,
} from "../src/lib/stats.ts";

const REL = 1e-12;
const FLOOR = 1e-15;
const same = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));
const nan = (label, x) => check(Number.isNaN(x), label, `got ${x}`);

function spell(label, got, want) {
  check(
    got.trading === want.trading && got.calendar === want.calendar && got.peak === want.peak &&
      got.end === want.end && got.recovered === want.recovered,
    label, `port ${JSON.stringify(got)} oracle ${JSON.stringify(want)}`,
  );
}

// ---- 1. Every basket against the oracle --------------------------------------------------------
let series = 0;
for (const name of SETS) {
  const d = derive(name);
  const o = d.oracle;
  if (!d.cleaned.ok) {
    check(!o.metrics, `${name}: no scorecard figures when the prices do not clean`);
    continue;
  }
  const om = o.metrics;
  const dates = d.returns.dates;
  const start = d.cleaned.frame.dates[0];
  check(start === om.start, `${name}: the start date is the first price's date`, `${start} vs ${om.start}`);
  const n = d.cols.length;

  const all = {};
  d.cleaned.tickers.forEach((t, i) => (all[t] = d.cols[i]));
  all[d.px.benchmark] = d.bench;
  for (const mode of ["long", "short"]) {
    const sol = o.modes[mode].shipping;
    const ws = { gmv: sol.gmv.x, tan: sol.tan.x };
    if (mode === "long") Object.assign(ws, { ew: new Array(n).fill(1 / n) });
    for (const [k, w] of Object.entries(ws)) all[`${mode}.${k}`] = portfolioReturns(d.cols, w);
  }
  check(
    JSON.stringify(Object.keys(all).sort()) === JSON.stringify(Object.keys(om.series).sort()),
    `${name}: the same series as the oracle`,
  );

  for (const [k, r] of Object.entries(all)) {
    const x = om.series[k];
    if (!x) continue;
    series += 1;
    const L = `${name} ${k}`;
    const b = d.bench;

    // Return
    near(`${L}: cumulative return`, cumulativeReturn(r), x.cumulative, REL);
    near(`${L}: compound annual return`, annualReturn(r), x.annual, REL);
    const ms = monthStats(monthlyReturns(r, dates));
    near(`${L}: best complete month`, ms.best, x.best, REL, FLOOR);
    near(`${L}: worst complete month`, ms.worst, x.worst, REL, FLOOR);
    near(`${L}: share of positive months`, ms.positive, x.positive, REL);
    check(ms.months === x.months, `${L}: complete months counted`, `${ms.months} vs ${x.months}`);

    // Risk
    near(`${L}: downside deviation`, downsideDeviation(r, o.rf), x.downside, REL);
    near(`${L}: max drawdown from the first close`, maxDrawdown(r, false), x.mdd, REL);
    near(`${L}: max drawdown from the amount invested`, maxDrawdown(r, true), x.mddStart, REL);
    spell(`${L}: longest drawdown from the first close`, longestDrawdown(r, dates, null), x.longest);
    spell(`${L}: longest drawdown from the amount invested`, longestDrawdown(r, dates, start), x.longestStart);

    // Risk-adjusted
    near(`${L}: Calmar from the first close`, calmar(r, false), x.calmar, REL);
    near(`${L}: Calmar from the amount invested`, calmar(r, true), x.calmarStart, REL);
    near(`${L}: Sharpe standard error (Lo, Mertens)`, sharpeSE(r, o.rf), x.sharpeSE, REL);

    // Against the benchmark
    near(`${L}: correlation with the benchmark`, correlation(r, b), x.corr, REL);
    near(`${L}: tracking error`, trackingError(r, b), x.te, REL, FLOOR);
    near(`${L}: information ratio`, informationRatio(r, b), x.ir, REL, 1e-13);
    const cap = captureRatios(r, b, dates);
    near(`${L}: up capture`, cap.up, x.up, REL);
    near(`${L}: down capture`, cap.down, x.down, REL);
    check(cap.upMonths === x.upMonths && cap.downMonths === x.downMonths, `${L}: up and down months counted`,
      `${cap.upMonths}/${cap.downMonths} vs ${x.upMonths}/${x.downMonths}`);

    // Tail
    const t = historicalTail(r);
    near(`${L}: 95% one-day VaR`, t.var, x.var, REL);
    near(`${L}: 95% expected shortfall`, t.es, x.es, REL);

    // The row builder: the oracle's figures, and exactly what the functions above return.
    const row = scorecardRow(r, b, dates, start, o.rf);
    near(`${L}: row r-squared`, row.r2, x.r2, REL);
    near(`${L}: row beta`, row.beta, x.beta, REL);
    near(`${L}: row alpha`, row.alphaAnn, x.alphaAnn, REL, FLOOR);
    near(`${L}: row mu`, row.mu, x.mu, REL);
    near(`${L}: row volatility`, row.volatility, x.sigma, REL);
    near(`${L}: row Sharpe`, row.sharpe, x.sharpe, REL);
    near(`${L}: row Sortino`, row.sortino, x.sortino, REL);
    const s = annualizedStats(r, o.rf);
    const fit = capm(r, b, o.rf);
    const direct = {
      annualReturn: annualReturn(r), cumulative: cumulativeReturn(r), mu: s.mu, bestMonth: ms.best,
      worstMonth: ms.worst, positiveMonths: ms.positive, completeMonths: ms.months, volatility: s.sigma,
      downside: downsideDeviation(r, o.rf), maxDrawdown: maxDrawdown(r, true), sharpe: s.sharpe,
      sharpeSE: sharpeSE(r, o.rf), sortino: s.sortino, calmar: calmar(r, true), beta: fit.beta,
      alphaAnn: fit.alphaAnn, correlation: correlation(r, b), trackingError: trackingError(r, b),
      informationRatio: informationRatio(r, b), upCapture: cap.up, downCapture: cap.down,
      upMonths: cap.upMonths, downMonths: cap.downMonths, var95: t.var, es95: t.es,
    };
    const off = Object.keys(direct).filter((f) => !same(row[f], direct[f]));
    check(!off.length, `${L}: the row is the functions' own figures`, off.join(", "));
    spell(`${L}: the row's longest drawdown counts from the start`, row.longest, x.longestStart);
    const row0 = scorecardRow(r, b, dates, null, o.rf);
    check(same(row0.maxDrawdown, maxDrawdown(r, false)) && same(row0.calmar, calmar(r, false)),
      `${L}: with no start date the row counts from the first close`);
  }

  // Calendar months, in full, for the benchmark and the portfolios.
  for (const [k, want] of Object.entries(om.months)) {
    const got = monthlyReturns(all[k], dates);
    const L = `${name} ${k} months`;
    check(got.length === want.length, `${L}: count`, `${got.length} vs ${want.length}`);
    check(got.every((m, i) => want[i] && m.ym === want[i][0]), `${L}: labels`);
    check(got.every((m, i) => want[i] && m.days === want[i][2]), `${L}: trading days per month`);
    check(got.every((m, i) => want[i] && m.partial === want[i][3]), `${L}: first and last flagged partial, no other`);
    nearAll(`${L}: compounded returns`, got.map((m) => m.ret), want.map((m) => m[1]), REL, FLOOR);
  }

  // Return share, fed the oracle's weights and daily means.
  for (const mode of ["long", "short"]) {
    for (const [k, x] of Object.entries(om.share[mode])) {
      const got = returnShare(x.w, o.mean);
      const L = `${name} ${mode} ${k} return share`;
      check(!got.degenerate, `${L}: not flagged`);
      nearAll(L, got.share, x.share, REL, FLOOR);
    }
  }

  // Estimation load over the full window and the one-year window.
  for (const [k, cols] of [["full", d.cols], ["1y", d.cols.map((c) => c.slice(c.length - TRADING_DAYS))]]) {
    const got = estimationLoad(cols);
    const x = om.load[k];
    const L = `${name} ${k} estimation load`;
    check(got.n === x.n && got.days === x.days && got.means === x.means && got.covariances === x.covariances,
      `${L}: counts`, `${got.means}+${got.covariances} vs ${x.means}+${x.covariances}`);
    near(`${L}: years`, got.years, x.years, REL);
    near(`${L}: days per asset`, got.daysPerAsset, x.daysPerAsset, REL);
    check(got.h === x.h, `${L}: default h`);
    nearAll(`${L}: SE of each annual mean`, got.assets.map((a) => a.se), x.se, REL);
    nearAll(`${L}: years needed`, got.assets.map((a) => a.yearsNeeded), x.yearsNeeded, REL);
  }
}
check(series >= 40, "every basket's series were compared", `${series}`);

// ---- 2. Branches no basket reaches -------------------------------------------------------------
const days = (n, from = "2024-01-02") => {
  const out = [];
  const t = new Date(`${from}T00:00:00Z`);
  while (out.length < n) {
    const wd = t.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
};
const sine = (n, a, f) => Array.from({ length: n }, (_, i) => a * Math.sin(i * f) + a * 0.1 * Math.cos(i * 1.7));

// A flat asset: exactly zero spread (2^-11 sums exactly, so the mean and every deviation are exact).
{
  const flat = new Array(300).fill(2 ** -11);
  const noisy = sine(300, 0.01, 0.37);
  const load = estimationLoad([flat, noisy]);
  check(load.assets[0].se === 0 && load.assets[0].yearsNeeded === 0, "flat asset: no uncertainty in its mean, no years needed");
  check(load.assets[1].se > 0 && load.assets[1].yearsNeeded > 0, "flat asset: the other asset's figures are positive");
  nan("flat asset: Sharpe SE is undefined", sharpeSE(flat, 0.04));
  nan("flat asset: correlation is undefined", correlation(flat, noisy));
  check(trackingError(flat, flat) === 0, "flat asset: zero tracking error against itself");
  nan("flat asset: information ratio undefined at zero tracking error", informationRatio(flat, flat));
  const tl = historicalTail(flat);
  check(tl.var === -(2 ** -11) && tl.es === -(2 ** -11), "flat asset: VaR and ES are the (negative) loss of the one value");
  nan("flat asset: Calmar undefined when the path never falls", calmar(flat));
  const sp = longestDrawdown(flat, days(300), "2023-12-29");
  check(sp.trading === 0 && sp.calendar === 0 && sp.peak === null && sp.recovered, "flat asset: no drawdown spell");
}

// A benchmark that never had a down month, and one-day months where the convention can be done by hand.
{
  const dates = ["2023-01-31", "2023-02-15", "2023-03-15", "2023-04-14", "2023-05-15", "2023-06-15"];
  const b = [0.05, 0.02, -0.01, 0.04, -0.03, 0.07];
  const r = [0.9, 0.03, -0.005, 0.02, -0.03, -0.5];
  const cap = captureRatios(r, b, dates);
  near("capture by hand: up = mean(3%, 2%) / mean(2%, 4%), partial months left out", cap.up, 0.025 / 0.03, 1e-12);
  near("capture by hand: down = mean(-0.5%, -3%) / mean(-1%, -3%)", cap.down, 0.0175 / 0.02, 1e-12);
  check(cap.upMonths === 2 && cap.downMonths === 2, "capture by hand: two up and two down complete months");
  const bUp = b.map(Math.abs);
  const up = captureRatios(r, bUp, dates);
  nan("benchmark with no down month: down capture undefined", up.down);
  check(up.downMonths === 0 && up.upMonths === 4 && Number.isFinite(up.up), "benchmark with no down month: up capture over four months");
  nan("benchmark with no down month: the row's down capture is undefined", scorecardRow(r, bUp, dates, null, 0.04).downCapture);
  const ms = monthStats(monthlyReturns(r, dates));
  check(close(ms.best, 0.03, 1e-12) && close(ms.worst, -0.03, 1e-12) && ms.positive === 0.5 && ms.months === 4,
    "month stats by hand: partial months left out", JSON.stringify(ms));
}

// Months: compounding, labels across a year end, the flags.
{
  const got = monthlyReturns([0.1, 0.1, 0.05, -0.02], ["2022-12-29", "2022-12-30", "2023-01-03", "2023-02-01"]);
  check(got.map((m) => m.ym).join() === "2022-12,2023-01,2023-02", "months: labelled year and month across a year end");
  check(got[0].ret === 1.1 * 1.1 - 1 && got[0].days === 2, "months: a month's days compounded");
  check(got.map((m) => m.partial).join() === "true,false,true", "months: only the first and last flagged partial");
  const one = monthlyReturns([0.01, 0.02], ["2024-03-04", "2024-03-05"]);
  check(one.length === 1 && one[0].partial, "months: a single month is partial");
  const st = monthStats(one);
  check(st.months === 0 && Number.isNaN(st.best) && Number.isNaN(st.positive), "months: no complete month, no statistics");
  let threw = false;
  try {
    monthlyReturns([0.01], []);
  } catch {
    threw = true;
  }
  check(threw, "months: returns and dates of different lengths are refused");
}

// Longest drawdown by hand: a recovered spell, then one still open at the end.
{
  const dates = ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12", "2024-01-16", "2024-01-17", "2024-01-18"];
  const r = [0.1, -0.1, 0.02, 0.1, -0.01, 0, 0, 0];
  spell("longest drawdown by hand: the open spell (4 trading, 7 calendar days) beats the recovered one (3, 3)",
    longestDrawdown(r, dates, "2024-01-05"),
    { trading: 4, calendar: 7, peak: "2024-01-11", end: "2024-01-18", recovered: false });
  spell("longest drawdown by hand: cut short, the recovered spell is the longer",
    longestDrawdown(r.slice(0, 6), dates.slice(0, 6), "2024-01-05"),
    { trading: 3, calendar: 3, peak: "2024-01-08", end: "2024-01-11", recovered: true });
  spell("longest drawdown by hand: a fall on day one counts from the amount invested",
    longestDrawdown([-0.05, 0.01, 0.1], ["2024-01-08", "2024-01-09", "2024-01-10"], "2024-01-05"),
    { trading: 3, calendar: 5, peak: "2024-01-05", end: "2024-01-10", recovered: true });
  spell("longest drawdown by hand: with no start the first close is the first peak, so day one's fall is not counted",
    longestDrawdown([-0.05, -0.01, 0.1], ["2024-01-08", "2024-01-09", "2024-01-10"], null),
    { trading: 2, calendar: 2, peak: "2024-01-08", end: "2024-01-10", recovered: true });
  spell("longest drawdown by hand: equal trading days, the longer calendar span wins",
    longestDrawdown([-0.1, 0.2, -0.1, 0.2], ["2024-01-09", "2024-01-10", "2024-01-12", "2024-01-16"], "2024-01-08"),
    { trading: 2, calendar: 6, peak: "2024-01-10", end: "2024-01-16", recovered: true });
}

// Return share: nothing to divide by, a negative total, and shares far outside 0..1, never clipped.
{
  const z = returnShare([0.5, 0.5], [1e-4, -1e-4]);
  check(z.degenerate && z.share.every(Number.isNaN), "return share: a zero total is flagged and no share is printed");
  const nearZero = returnShare([0.5, 0.5], [1e-4, -1e-4 + 1e-12]);
  check(nearZero.degenerate, `return share: a total within ${SHARE_EPS} of zero is flagged`);
  const small = returnShare([1, 1], [1e-4, -1e-4 + 4e-12]);
  check(!small.degenerate && small.share[0] > 1e6 && small.share[1] < -1e6, "return share: just past the threshold, huge shares are returned unclipped");
  near("return share: huge shares still sum to one", small.share[0] + small.share[1], 1, 1e-3);
  const neg = returnShare([1, 1], [-2e-4, 1e-4]);
  check(!neg.degenerate, "return share: a negative total is not degenerate");
  nearAll("return share: a negative total gives 200% and -100%", neg.share, [2, -1], 1e-12);
  const agg = returnShare([0.6, 0.4], [3e-4, -1e-4]);
  nearAll("return share: a losing asset carries a negative share and the rest more than its weight",
    agg.share, [1.8e-4 / 1.4e-4, -0.4e-4 / 1.4e-4], 1e-12);
}

// Too short to have a spread.
{
  const one = [0.01];
  const d1 = ["2024-03-05"];
  nan("T = 1: Sharpe SE undefined", sharpeSE(one, 0.04));
  nan("T = 1: tracking error undefined", trackingError(one, [0.02]));
  nan("T = 1: information ratio undefined", informationRatio(one, [0.02]));
  nan("T = 1: correlation undefined", correlation(one, [0.02]));
  nan("T = 1: SE of the mean undefined", estimationLoad([one, [0.02]]).assets[0].se);
  near("T = 1: the compound annual return is one day compounded 252 times", annualReturn(one), 1.01 ** 252 - 1, 1e-12);
  const t1 = historicalTail(one);
  check(t1.var === -0.01 && t1.es === -0.01, "T = 1: VaR and ES are the one day's (negative) loss");
  const row = scorecardRow(one, [0.02], d1, "2024-03-04", 0.04);
  check(Number.isNaN(row.sharpeSE) && Number.isNaN(row.bestMonth) && row.completeMonths === 0, "T = 1: the row builds, undefined where it must be");
  nan("T = 0: annual return undefined", annualReturn([]));
  check(cumulativeReturn([]) === 0, "T = 0: nothing compounded, nothing gained");
  nan("T = 0: VaR undefined", historicalTail([]).var);
  check(longestDrawdown([], [], "2024-03-04").trading === 0, "T = 0: no drawdown spell");
  nan("T = 3: Sharpe SE undefined without a kurtosis", sharpeSE([0.01, -0.02, 0.03], 0.04));
  check(Number.isFinite(sharpeSE([0.01, -0.02, 0.03, 0.005], 0.04)), "T = 4: Sharpe SE defined");
}

// The Sharpe SE formula by hand on a series with known moments.
{
  const r = sine(500, 0.012, 0.61).map((x, i) => x + 0.0004 + (i % 17 === 0 ? -0.03 : 0));
  const T = r.length;
  const m = r.reduce((a, x) => a + x, 0) / T;
  const sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (T - 1));
  const sr = (m - 0.03 / 252) / sd;
  const z = r.map((x) => x - m);
  const m2 = z.reduce((a, x) => a + x * x, 0);
  const m3 = z.reduce((a, x) => a + x ** 3, 0);
  const m4 = z.reduce((a, x) => a + x ** 4, 0);
  const g1 = ((T * Math.sqrt(T - 1)) / (T - 2)) * (m3 / m2 ** 1.5);
  const g2 = (T * (T + 1) * (T - 1) * m4) / ((T - 2) * (T - 3) * m2 ** 2) - (3 * (T - 1) ** 2) / ((T - 2) * (T - 3));
  check(Math.abs(g1) > 0.3 && g2 > 1, "Sharpe SE by hand: the series is skewed and fat-tailed", `${g1} ${g2}`);
  const want = Math.sqrt((1 + sr ** 2 / 2 - g1 * sr + (g2 / 4) * sr ** 2) / T) * Math.sqrt(252);
  near("Sharpe SE by hand: Lo with Mertens' skew and kurtosis terms, annualised", sharpeSE(r, 0.03), want, 1e-9);
  const iid = Math.sqrt((1 + sr ** 2 / 2) / T) * Math.sqrt(252);
  check(!close(sharpeSE(r, 0.03), iid, 1e-6), "Sharpe SE by hand: the skew and kurtosis terms move it off the plain Lo figure");
}

// Estimation load: the counts and the thresholds.
{
  const cols = [sine(504, 0.01, 0.3), sine(504, 0.02, 0.5), sine(504, 0.015, 0.7)];
  const L = estimationLoad(cols);
  check(L.means === 3 && L.covariances === 6 && L.days === 504 && L.years === 2 && L.daysPerAsset === 168,
    "estimation load: 3 means, 6 variances and covariances, 504 days = 2 years");
  const sig = Math.sqrt(cols[1].reduce((a, x, _, v) => a + (x - v.reduce((s, y) => s + y, 0) / v.length) ** 2, 0) / 503) * Math.sqrt(252);
  near("estimation load: SE of a mean is the annual volatility over root years", L.assets[1].se, sig / Math.sqrt(2), 1e-9);
  near("estimation load: years needed to pin a mean to 2 points", L.assets[1].yearsNeeded, (sig / 0.02) ** 2, 1e-9);
  near("estimation load: a wider h needs fewer years", estimationLoad(cols, 0.04).assets[1].yearsNeeded, (sig / 0.04) ** 2, 1e-9);
  check(TN_WARN === 25 && TN_REFUSE === 10, "estimation load: thresholds warn below 25 and refuse below 10 days per asset");
  check(loadVerdict(250, 10) === "ok", "verdict: exactly 25 days per asset is fine");
  check(loadVerdict(249, 10) === "warn", "verdict: just under 25 warns");
  check(loadVerdict(100, 10) === "warn", "verdict: exactly 10 days per asset warns, it does not refuse");
  check(loadVerdict(99, 10) === "refuse", "verdict: under 10 refuses");
  // At today's cap the one-year window cannot trip either threshold; raising the cap is what turns the warning on.
  check(loadVerdict(TRADING_DAYS, MAX_TICKERS) === "ok", `verdict: at the ${MAX_TICKERS}-ticker cap the one-year window neither warns nor refuses`);
}

done("t-metrics");
