// Beta and alpha as the page reports them (capmFit, olsHAC in src/lib/stats.ts): monthly excess returns over
// 36 full calendar months or more, daily under, alpha with a Newey-West standard error. FDA2 Week 5, 5.4.4 and
// 5.4.6; t-ledger's "monthly-capm".
//
// (a) olsHAC against statsmodels on three seeded cases (test/fixtures/capm-hac.json, written by
//     test/oracle/capm_hac.py): coefficients, both standard errors, the t, R².
// (b) Hand-computed small cases: an exact line, lag 0 equal to White's errors, the Bartlett weight at lag 1.
// (c) capmFit: the 36-month floor and its fallback, partial months left out, rf / 12, alpha x 12.
import { check, near, done, json } from "./_assert.mjs";
import {
  olsHAC, neweyWestLag, capmFit, capm, fullMonths, alphaReading, capmBasisWords, linregress, CAPM_MIN_MONTHS,
} from "../src/lib/stats.ts";
import { monthlyReturns } from "../src/lib/monthly.ts";

// ---- (a) statsmodels ----------------------------------------------------------------------------------
const fx = json(new URL("./fixtures/capm-hac.json", import.meta.url));
check(/statsmodels/.test(fx.source) && fx.cases.length === 3, "statsmodels: the fixture names its source and holds three cases");
for (const c of fx.cases) {
  check(neweyWestLag(c.x.length) === c.lag, `ledger:monthly-capm ${c.name}: the lag is floor(4 (T/100)^(2/9)), as the fixture used`, `${neweyWestLag(c.x.length)} vs ${c.lag}`);
  const h = olsHAC(c.x, c.y, c.lag);
  near(`${c.name}: slope`, h.slope, c.slope, 1e-12);
  near(`${c.name}: intercept`, h.intercept, c.intercept, 1e-12, 1e-16);
  near(`${c.name}: R²`, h.r2, c.r2, 1e-12);
  near(`${c.name}: the slope's Newey-West SE`, h.slopeSE, c.slopeSE, 1e-12);
  near(`${c.name}: the intercept's Newey-West SE`, h.interceptSE, c.interceptSE, 1e-12);
  near(`${c.name}: the intercept's t`, h.intercept / h.interceptSE, c.interceptT, 1e-12);
}
check(neweyWestLag(36) === 3 && neweyWestLag(93) === 3 && neweyWestLag(100) === 4 && neweyWestLag(2500) === 8,
  "the lag rule at 36, 93, 100 and 2,500 observations", [36, 93, 100, 2500].map(neweyWestLag).join());

// ---- (b) by hand ----------------------------------------------------------------------------------------
{
  const x = [1, 2, 3, 4, 5];
  const h = olsHAC(x, x.map((v) => 0.5 + 2 * v), 1);
  near("exact line: slope", h.slope, 2, 1e-14);
  near("exact line: intercept", h.intercept, 0.5, 1e-14);
  check(h.slopeSE < 1e-12 && h.interceptSE < 1e-12, "exact line: no residual, no standard error", `${h.slopeSE} ${h.interceptSE}`);
  // Lag 0 is White's HC0: Var(slope) = sum((x - mx)^2 e^2) / Sxx^2.
  const y = [1.0, 2.5, 2.0, 4.5, 4.0];
  const f = linregress(x, y);
  const e = y.map((v, i) => v - f.intercept - f.slope * x[i]);
  const mx = 3;
  const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0);
  const s0 = x.reduce((s, v, i) => s + (v - mx) ** 2 * e[i] ** 2, 0);
  near("lag 0: the slope's SE is White's", olsHAC(x, y, 0).slopeSE, Math.sqrt(s0) / sxx, 1e-12);
  // Lag 1 adds the weight 1 - 1/2 times the first autocovariance of the slope's scores, both ways round.
  let g = 0;
  for (let t = 1; t < 5; t++) g += (x[t] - mx) * e[t] * (x[t - 1] - mx) * e[t - 1];
  near("lag 1: the Bartlett weight 1 - 1/2 on the first autocovariance", olsHAC(x, y, 1).slopeSE, Math.sqrt(s0 + 2 * 0.5 * g) / sxx, 1e-12);
}

// ---- (c) capmFit ---------------------------------------------------------------------------------------
// Daily dates, 20 a month, starting mid-January so the first month is partial; the last is flagged partial too.
function window(months) {
  const dates = [];
  for (let m = 0; m < months; m++) {
    const y = 2015 + Math.floor(m / 12);
    const mm = String((m % 12) + 1).padStart(2, "0");
    for (let d = m === 0 ? 15 : 1; d <= 20; d++) dates.push(`${y}-${mm}-${String(d).padStart(2, "0")}`);
  }
  return dates;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
function series(n) {
  const b = Array.from({ length: n }, rnd);
  const r = b.map((v) => 0.0001 + 1.3 * v + rnd());
  return { b, r };
}
const rf = 0.03;
{
  const dates = window(38);
  check(fullMonths(dates) === 36, "full months: 38 calendar months, the first and last partial, are 36 full", String(fullMonths(dates)));
  const { b, r } = series(dates.length);
  const f = capmFit(r, b, dates, rf);
  check(f.basis === "monthly" && f.obs === 36 && f.lag === 3,
    "ledger:monthly-capm at 36 full months the regression is monthly, 36 observations, lag 3", JSON.stringify([f.basis, f.obs, f.lag]));
  const full = (s) => monthlyReturns(s, dates).filter((m) => !m.partial).map((m) => m.ret);
  const X = full(b).map((v) => v - rf / 12);
  const Y = full(r).map((v) => v - rf / 12);
  check(X.length === 36, "the partial first and last months are left out");
  const h = olsHAC(X, Y, 3);
  near("monthly: beta is the slope on monthly excess returns at rf / 12", f.beta, h.slope, 1e-14);
  near("monthly: alpha is the monthly intercept x 12", f.alphaAnn, h.intercept * 12, 1e-14, 1e-17);
  near("monthly: alpha's SE is annual too", f.alphaSE, h.interceptSE * 12, 1e-14);
  near("monthly: t", f.alphaT, h.intercept / h.interceptSE, 1e-12);
  near("monthly: beta's SE", f.betaSE, h.slopeSE, 1e-14);
  // A shock in the partial months changes nothing: they are not regressed.
  const r2 = r.slice();
  r2[0] += 0.05;
  r2[r2.length - 1] -= 0.05;
  const g = capmFit(r2, b, dates, rf);
  check(g.beta === f.beta && g.alphaAnn === f.alphaAnn, "ledger:monthly-capm a shock in the partial first and last months does not move the monthly beta");
  // The rate is rf / 12 a month: a different rate moves alpha by (1 - beta) times the change, annual.
  near("monthly: alpha moves by (1 - beta) x the rate's change", capmFit(r, b, dates, rf + 0.01).alphaAnn - f.alphaAnn, -(1 - f.beta) * 0.01, 1e-12, 1e-15);
  check(Math.abs(capm(r, b, rf).beta - f.beta) > 1e-6, "the monthly beta is not the daily one on the same data");
}
{
  const dates = window(37);
  const { b, r } = series(dates.length);
  const f = capmFit(r, b, dates, rf);
  const d = capm(r, b, rf);
  check(fullMonths(dates) === 35 && CAPM_MIN_MONTHS === 36, "35 full months is one short of the floor");
  check(f.basis === "daily" && f.obs === dates.length && f.beta === d.beta && f.alphaAnn === d.alphaAnn && f.r2 === d.r2,
    "ledger:monthly-capm under 36 full months it falls back to the daily regression, the app's own figures");
  const h = olsHAC(b.map((v) => v - rf / 252), r.map((v) => v - rf / 252), neweyWestLag(dates.length));
  near("daily: alpha's t is the daily intercept's over its Newey-West SE", f.alphaT, h.intercept / h.interceptSE, 1e-12);
  near("daily: alpha's SE x 252", f.alphaSE, h.interceptSE * 252, 1e-12);
}
check(fullMonths([]) === 0 && fullMonths(["2020-01-02"]) === 0 && fullMonths(["2020-01-31", "2020-02-03", "2020-03-02"]) === 1, "full months of a short window");

// ---- words ----------------------------------------------------------------------------------------------
check(alphaReading(0.8) === "not distinguishable from zero" && alphaReading(-1.99) === "not distinguishable from zero" &&
  alphaReading(2) === "above zero, beyond its noise" && alphaReading(-2.4) === "below zero, beyond its noise" && alphaReading(NaN) === "no reading",
  "ledger:monthly-capm the reading: within two standard errors it cannot be told from zero");
check(capmBasisWords({ basis: "monthly", obs: 93 }) === "93 monthly returns" && capmBasisWords({ basis: "daily", obs: 600 }) === "daily returns: under 3 years of full months",
  "the basis in words, as the brief has it");

done("t-capm");
