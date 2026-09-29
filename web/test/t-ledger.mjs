// The divergence ledger: every place the port deliberately differs from the Streamlit app.
//
// Each entry asserts BOTH sides, the app's value (reproduced, or read from the oracle dump) and the
// port's, so a divergence cannot quietly become a match or a different divergence. Entries that live
// in the page rather than the engine were listed as PENDING until the page existed; they are CLOSED
// now, each mapped to the suites that assert it, and this suite holds that map to the suites' text.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { transformSync } from "esbuild";
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

// In the page, not the engine. These ten were PENDING until the shell and the six tabs existed; each
// sentence is kept word for word as it was listed, and now maps to the ids that assert it and the
// suites that carry each id's "ledger:<id>" checks. Between them an id's suites assert both sides, the
// app's behaviour and the port's; one suite may hold only one side (t-components tests the Boundary
// alone, t-app the app's st.stop()). This suite proves each listed suite tags the id in a real check,
// never only in a comment. That each side is really asserted is a reviewer's job, not a regex's.
const CLOSED = {
  "st.stop() in one tab blanks the later tabs -> per-card boundary": {
    boundary: ["t-app", "t-components", "t-tab-correlation", "t-tab-custom", "t-tab-optimization", "t-tab-risk", "t-tab-sensitivity"],
  },
  "failed tangency shows EW figures labelled Tangency -> say it failed": {
    "failed-tangency": ["t-app", "t-tab-custom", "t-tab-optimization", "t-tab-sensitivity"],
  },
  "rf edit ignored until Run -> live": {
    "rf-live": ["t-tab-custom", "t-tab-optimization", "t-tab-risk", "t-workbench"],
  },
  "'Kurtosis' is excess kurtosis -> label it": {
    "excess-kurtosis": ["t-tab-returns"],
  },
  "downloads carry formatted text -> numbers with number formats": {
    "numeric-downloads": ["t-tab-custom", "t-tab-optimization", "t-tab-returns", "t-tab-risk", "t-tab-sensitivity", "t-tables"],
  },
  "tables without downloads -> CSV + Excel for every table": {
    "downloads-everywhere": ["t-tab-correlation", "t-tab-custom", "t-tab-optimization", "t-tab-returns", "t-tab-risk", "t-tab-sensitivity", "t-tables"],
  },
  "tab-6 metrics in-sample, wealth daily-rebalanced, unlabelled -> say so": {
    "in-sample-label": ["t-tab-sensitivity"],
    "daily-rebalanced-label": ["t-charts-portfolio", "t-tab-custom", "t-tab-optimization"],
  },
  "short frontier called unconstrained; tooltips say long-only with shorting on -> [-1, 1], follow the toggle": {
    "short-bounds-copy": ["t-app", "t-charts-portfolio", "t-tab-custom", "t-tab-optimization", "t-tooltips"],
  },
  "frontier hover x-unified by accident -> closest point": {
    "frontier-hover": ["t-charts", "t-charts-portfolio", "t-tab-custom"],
  },
  "start date floor 2009-01-01 -> what Yahoo returns": {
    "start-date-floor": ["t-api", "t-app"],
  },
};
// Found while building the tabs, never on the list above.
const FOUND = {
  "beta rounded to 3 dp before it is coloured -> colour on the raw beta": {
    "beta-rounding": ["t-tab-risk"],
  },
  "one risk-free rate, the latest, for every window -> the mean 3-month yield over the window, the latest beside it": { "rf-window": ["t-api", "t-workbench"] },
  "presets are the app's baskets only -> the three published sets first, marked, the app's under More baskets": { "published-presets": ["t-contract"] },
  "the default-level tips call the tangency mix the best possible -> the highest over this window, in-sample": { "plain-tip-words": ["t-app", "t-tooltips"] },
};
const PENDING = [];

// The ids the page's entries were built against; each must be asserted somewhere.
const PAGE_IDS = [
  "boundary", "failed-tangency", "rf-live", "excess-kurtosis", "numeric-downloads", "downloads-everywhere",
  "in-sample-label", "daily-rebalanced-label", "short-bounds-copy", "frontier-hover", "start-date-floor",
];

for (const [name, fn] of Object.entries(LEDGER)) fn(name);

// Every suite's CODE, comments stripped by esbuild, and the ids it tags. A tag named only in a comment
// (a suite's header lists its ids) proves nothing, so it does not count. A tag is "ledger:<id>" not
// followed by more of an id, so "ledger:boundary" is not found inside "ledger:boundary-x".
const suiteDir = new URL("./", import.meta.url);
const suites = readdirSync(suiteDir).filter((f) => /^t-.*\.mjs$/.test(f) && f !== "t-ledger.mjs");
const code = (src) => transformSync(src, { loader: "js", format: "esm" }).code;
const source = Object.fromEntries(suites.map((f) => [f.replace(/\.mjs$/, ""), code(readFileSync(new URL(f, suiteDir), "utf8"))]));
const tagged = (src, id) => new RegExp(`ledger:${id}(?![a-z0-9-])`).test(src); // ids are [a-z0-9-]: nothing to escape

check(PENDING.length === 0, "ledger: nothing is pending the page", PENDING.join(" | "));
const listed = { ...CLOSED, ...FOUND };
let tags = 0;
for (const [sentence, ids] of Object.entries(listed)) {
  check(Object.keys(ids).length > 0, `ledger: "${sentence}" names at least one id`);
  for (const [id, files] of Object.entries(ids)) {
    check(files.length > 0, `ledger: ${id} lists at least one suite`);
    for (const f of files) {
      check(existsSync(new URL(`${f}.mjs`, suiteDir)), `ledger: ${id}'s suite ${f}.mjs exists`);
      check(tagged(source[f] ?? "", id), `ledger: ${f}.mjs asserts ledger:${id}`);
      tags += 1;
    }
    // The other direction: a suite that tags the id is on the list, so the list cannot fall behind.
    const carriers = Object.keys(source).filter((f) => tagged(source[f], id)).sort();
    check(carriers.join() === [...files].sort().join(), `ledger: every suite that asserts ledger:${id} is listed`,
      `listed ${[...files].sort().join()} / found ${carriers.join()}`);
  }
}
const closedIds = new Set(Object.values(listed).flatMap((ids) => Object.keys(ids)));
for (const id of PAGE_IDS) check(closedIds.has(id), `ledger: ${id} is closed by at least one suite`);
// Every tag in any suite belongs to an engine entry above or to a page entry: none is unregistered.
const known = new Set([...Object.keys(LEDGER), ...closedIds]);
const stray = [...new Set(Object.values(source).flatMap((src) => [...src.matchAll(/ledger:([a-z0-9-]+)/g)].map((m) => m[1])))].filter((id) => !known.has(id));
check(stray.length === 0, "ledger: every ledger:<id> tag in the suites is a registered entry", stray.join(", "));

console.log(
  `t-ledger: ${Object.keys(LEDGER).length} engine entries asserted here; ${Object.keys(CLOSED).length} page entries closed ` +
    `and ${Object.keys(FOUND).length} found in the tabs (${closedIds.size} ids, ${tags} suite tags); ${PENDING.length} pending`,
);
void load;
done("t-ledger");
