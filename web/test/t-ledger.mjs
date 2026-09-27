// The divergence ledger: every place the port deliberately differs from the Streamlit app.
//
// Each entry asserts BOTH sides, the app's value (reproduced, or read from the oracle dump) and the
// port's, so a divergence cannot quietly become a match or a different divergence. Entries that live
// in the page rather than the engine are listed as PENDING until the page exists to assert them;
// the suite prints how many remain, so the list cannot be forgotten.
import { check, near, maxAbsDiff, done } from "./_assert.mjs";
import { derive, load } from "./_fixtures.mjs";
import { mean, covMatrix, dot, matVec } from "../src/lib/num.ts";
import { maxDrawdown, drawdowns, wealth } from "../src/lib/stats.ts";
import { gmv, tangency, frontier, maxReturn } from "../src/lib/optimize.ts";
import { riskContribution, normalizeCustom } from "../src/lib/portfolio.ts";
import { cleanPrices, validateRequest } from "../src/lib/clean.ts";

const LEDGER = {
  "benchmark-as-ticker": () => {
    // App (864, 1080): benchmarked against VTI, the five-asset cross-asset set becomes four assets.
    const app = derive("cross_vti");
    check(app.oracle.clean.tickers.length === 4 && !app.oracle.clean.tickers.includes("VTI"),
      "benchmark-as-ticker: the app drops VTI from the portfolio");
    check(JSON.stringify(app.cleaned.tickers) === JSON.stringify(app.oracle.clean.tickers),
      "benchmark-as-ticker: reproduced with keepBenchmarkTicker false");
    const port = derive("cross_vti", {});
    check(port.cleaned.ok && port.cleaned.tickers.length === 5 && port.cleaned.tickers.includes("VTI") &&
      port.cleaned.benchmark === "VTI", "benchmark-as-ticker: the port keeps VTI and benchmarks against it");
  },

  "drawdown-and-wealth-start": () => {
    // App (905, 1261, 1669): the path starts at 1 + r1. A 10% loss on day one is not a drawdown.
    const r = [-0.1, 0.02, 0.01];
    check(maxDrawdown(r, false) === 0, "wealth start: the app's formula sees no drawdown after a first-day loss");
    near("wealth start: the port measures it from the amount invested", maxDrawdown(r), -0.1, 1e-15);
    check(wealth(r, 10000, false)[0] === 9000 && wealth(r, 10000)[0] === 10000,
      "wealth start: the app's growth line never plots $10,000; the port's starts there");
    const { oracle: o, bench } = derive("megacap");
    near("wealth start: the app's S&P max drawdown, reproduced", maxDrawdown(bench, false), o.bench.mdd, 1e-12);
    check(maxDrawdown(bench) <= maxDrawdown(bench, false) && drawdowns(bench)[0] === 0,
      "wealth start: the port's drawdown can only be as deep or deeper");
  },

  "exact-qp-weights": () => {
    // App (932, 943): SLSQP at ftol 1e-6 stops short. Port: exact, proved by KKT, not by agreement.
    let appGap = 0;
    for (const name of ["megacap", "sectors", "cross", "dirty"]) {
      const { oracle: o, cols } = derive(name);
      const m = cols.map(mean);
      const S = covMatrix(cols);
      const g = gmv(m, S, false);
      appGap = Math.max(appGap, maxAbsDiff(g.w, o.modes.long.shipping.gmv.x));
      // GMV long-only KKT: (Sw)_i equal on the support and no smaller off it.
      const Sw = matVec(S, g.w);
      const lam = dot(g.w, Sw);
      check(g.w.every((w, i) => (w > 1e-12 ? Math.abs(Sw[i] - lam) <= 1e-9 * lam : Sw[i] >= lam * (1 - 1e-9))),
        `exact QP: ${name} GMV satisfies KKT`);
      // ...which makes each asset's risk contribution equal its weight (the tab-4 risk-contribution chart).
      check(maxAbsDiff(riskContribution(g.w, S), g.w) <= 1e-9, `exact QP: ${name} GMV risk contribution = weight`);
      // Tangency long-only KKT: the Sharpe gradient vanishes on the support and is <= 0 off it.
      const t = tangency(m, S, o.rf, false);
      const e = m.map((x) => x - o.rf / 252);
      const St = matVec(S, t.w);
      const v = dot(t.w, St);
      const ex = dot(e, t.w);
      const grad = e.map((x, i) => x / Math.sqrt(v) - (ex * St[i]) / v ** 1.5);
      const scale = Math.max(...grad.map(Math.abs), ...e.map((x) => Math.abs(x) / Math.sqrt(v)));
      check(t.w.every((w, i) => (w > 1e-12 ? Math.abs(grad[i]) <= 1e-9 * scale : grad[i] <= 1e-9 * scale)),
        `exact QP: ${name} tangency satisfies KKT`);
    }
    check(appGap > 1e-4, "exact QP: the app's GMV weights really are off the optimum", appGap.toExponential(2));
  },

  "custom-normalisation": () => {
    // App (1732): raw / raw total. With shorting, a negative total flips every sign.
    const neg = [-0.2, -0.2, -0.2, -0.2, -0.2];
    const appNeg = neg.map((x) => x / neg.reduce((a, b) => a + b, 0));
    check(appNeg.every((w) => Math.abs(w - 0.2) < 1e-15), "custom: the app turns five 20% shorts into five 20% longs");
    const pNeg = normalizeCustom(neg, true);
    check(!pNeg.ok && pNeg.reason === "net-short", "custom: the port refuses a net-short book and says so");
    // ...and a total near zero multiplies every weight by 1/total, far outside the +/-1 box.
    const tiny = [0.3, -0.29, 0, 0, 0];
    const appTiny = tiny.map((x) => x / 0.01);
    check(appTiny[0] > 29, "custom: the app levers a 1% net book 100x");
    const pTiny = normalizeCustom(tiny, true);
    check(!pTiny.ok && pTiny.reason === "net-short", "custom: the port refuses it");
    const lev = normalizeCustom([0.9, -0.8, 0.5], true);
    check(!lev.ok && lev.reason === "leverage", "custom: the port refuses weights that leave the box");
    // A slider value left negative when shorting is switched off is clamped to the long-only bound.
    const cl = normalizeCustom([0.5, -0.4, 0.5], false);
    check(cl.ok && cl.clamped && cl.w[1] === 0 && cl.w[0] === 0.5, "custom: a stale short is clamped, and flagged");
    const small = normalizeCustom([0.01, 0, 0], false);
    check(small.ok && small.w[0] === 1, "custom: long-only, any positive total normalises");
    const zero = normalizeCustom([0, 0, 0], false);
    check(!zero.ok && zero.reason === "zero", "custom: all zero is refused, as in the app");
  },

  "nothing-beats-rf": () => {
    // App: SLSQP still reports success and a negative "Best Sharpe (Tangency)".
    const { oracle: o, cols } = derive("cross_vti");
    const m = cols.map(mean);
    const S = covMatrix(cols);
    check(o.rfHigh.short.res.success && o.rfHigh.short.sharpe < 0,
      "no tangency: the app reports a successful tangency with a negative Sharpe");
    check(tangency(m, S, o.rfHigh.rf, true) === null, "no tangency: with shorting the port finds none and says so");
    const t = tangency(m, S, o.rfHigh.rf, false);
    check(o.rfHigh.long.sharpe < 0 && t && !t.beatsRf, "no tangency: long-only, the port flags that nothing beats rf");
  },

  "frontier-ceiling": () => {
    // App (953): short mode runs its grid to 1.5x the best asset's mean and drops what it cannot reach.
    const { oracle: o, cols } = derive("dirty");
    const F = o.modes.short.frontier80;
    check(F.kept.length < 80, "frontier ceiling: the app drops unreachable short-mode targets", `${F.kept.length}/80`);
    const m = cols.map(mean);
    const S = covMatrix(cols);
    const pts = frontier(m, S, true, 80);
    const top = maxReturn(m, true);
    check(pts.length === 80 && pts.every((p) => p.feasible), "frontier ceiling: every port target is reachable");
    check(pts[79].target === top.mu && top.mu < F.muMax, "frontier ceiling: the port stops at the box's true maximum");
  },

  "reversed-dates": () => {
    // App (1016-1021): the two-year check runs first, so a reversed range is told it is too short.
    check(validateRequest(["A", "B", "C"], "2026-01-01", "2020-01-01") === "reversed",
      "reversed dates: the port says the end is before the start");
    check(validateRequest(["A", "B", "C"], "2025-01-01", "2026-01-01") === "short-range",
      "reversed dates: a forward range under two years still gets the two-year message");
  },
};

// In the page, not the engine: asserted when the page shell and its six tabs are built.
const PENDING = [
  "st.stop() in one tab blanks the later tabs -> per-card boundary",
  "failed tangency shows EW figures labelled Tangency -> say it failed",
  "rf edit ignored until Run -> live",
  "'Kurtosis' is excess kurtosis -> label it",
  "downloads carry formatted text -> numbers with number formats",
  "tables without downloads -> CSV + Excel for every table",
  "tab-6 metrics in-sample, wealth daily-rebalanced, unlabelled -> say so",
  "short frontier called unconstrained; tooltips say long-only with shorting on -> [-1, 1], follow the toggle",
  "frontier hover x-unified by accident -> closest point",
  "start date floor 2009-01-01 -> what Yahoo returns",
];

for (const [name, fn] of Object.entries(LEDGER)) fn(name);
console.log(`t-ledger: ${Object.keys(LEDGER).length} entries asserted, ${PENDING.length} pending the page`);
void load;
done("t-ledger");
