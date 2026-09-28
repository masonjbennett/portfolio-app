// analyze(): the prices to the state every tab shares (src/state/analyze.ts). Held three ways:
//   1. to the engine called directly, bit for bit, on every fixture, both bounds;
//   2. to the oracle dump's own numbers for the Snapshot (1192-1208), at the tiers t-parity uses;
//   3. every refusal returns its named error with its sentence, and nothing throws.
// Line numbers cite portfolio_app.py.
import { check, near, nearAll, maxAbsDiff, done } from "./_assert.mjs";
import { load, SETS } from "./_fixtures.mjs";
import { ORACLE_RF, examplePayload, fixturePayload, settingsFor } from "./_analysis.mjs";
import { analyze, isPricePayload, MESSAGES } from "../src/state/analyze.ts";
import { toFrame } from "../src/data/payload.ts";
import { cleanPrices, column, computeReturns } from "../src/lib/clean.ts";
import { covMatrix, mean } from "../src/lib/num.ts";
import { frontier, gmv, tangency } from "../src/lib/optimize.ts";
import { annualizedStats, TRADING_DAYS } from "../src/lib/stats.ts";
import { FRONTIER_POINTS } from "../src/state/defaults.ts";

const REL = 1e-12;
const TIGHT = 1e-7; // t-parity's bound on the ftol-1e-15 re-run
const bits = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const run = (p, allowShort = false, rf = ORACLE_RF) =>
  analyze(p, settingsFor(p, { allowShort }), { rate: rf, source: "manual" });

// ---- 1. the engine, called directly ------------------------------------------------------------------
for (const name of SETS) {
  const px = fixturePayload(name);
  for (const allowShort of [false, true]) {
    const tag = (s) => `${name} ${allowShort ? "short" : "long"}: ${s}`;
    const a = run(px, allowShort);
    check(a.ok, tag("analyze accepts the fixture"), a.ok ? "" : a.error);
    if (!a.ok) continue;
    const c = cleanPrices(toFrame(px), px.missing, px.tickers, px.benchmark, { keepBenchmarkTicker: true });
    const R = computeReturns(c.frame);
    const cols = c.tickers.map((t) => column(R, t));
    const bench = column(R, c.benchmark);
    const m = cols.map((x) => mean(x));
    const S = covMatrix(cols);
    check(bits(a.tickers, c.tickers) && a.benchmark === c.benchmark && bits(a.dates, R.dates), tag("tickers, benchmark and return dates"));
    check(a.asOf === c.frame.dates.at(-1) && a.source === "live", tag("asOf is the last cleaned price date; a row payload is 'live'"));
    check(a.returns.length === cols.length && a.returns.every((r, i) => bits(r, cols[i])) && bits(a.bench, bench),
      tag("returns and benchmark returns, bit for bit"));
    check(bits(a.m, m) && bits(a.S.flat(), S.flat()), tag("daily means and ddof-1 covariance, bit for bit"));
    const g = gmv(m, S, allowShort);
    const t = tangency(m, S, ORACLE_RF, allowShort);
    check(bits(a.gmv?.w, g?.w) && Object.is(a.gmv?.sigma, g?.sigma), tag("gmv = the engine's"));
    check(bits(a.tangency?.w, t?.w) && Object.is(a.tangency?.sharpe, t?.sharpe), tag("tangency = the engine's, at the rate handed in"));
    const f = frontier(m, S, allowShort, FRONTIER_POINTS);
    check(bits(a.frontier.map((p) => p.sigma), f.map((p) => p.sigma)) && bits(a.frontier.map((p) => p.target), f.map((p) => p.target)),
      tag("frontier = the engine's at FRONTIER_POINTS"));
    const bs = annualizedStats(bench, ORACLE_RF);
    check(["mu", "sigma", "sharpe", "sortino"].every((k) => Object.is(a.benchStats[k], bs[k])), tag("benchStats = annualized_stats at rf"));
    check(a.rf === ORACLE_RF && a.rfSource === "manual" && a.allowShort === allowShort, tag("rate, its source and the bounds carried"));
    check(a.ew.length === cols.length && a.ew.every((w) => w === 1 / cols.length), tag("equal weights 1/n"));
    check(JSON.stringify(a.events) === JSON.stringify(c.events), tag("cleaning events carried"));
  }
}

// A benchmark that is also a ticker: the app drops the ticker (864, 1080); the port keeps it.
{
  const px = fixturePayload("cross_vti");
  const a = run(px);
  const o = load("cross_vti").oracle;
  check(!o.clean.tickers.includes("VTI") && a.ok && a.tickers.includes("VTI") && a.tickers.length === px.tickers.length && a.benchmark === "VTI",
    "cross_vti: the app drops VTI as a ticker when it is the benchmark; analyze() keeps it (keepBenchmarkTicker)",
    `oracle ${o.clean.tickers} port ${a.tickers}`);
}

// ---- 2. the oracle's own numbers ---------------------------------------------------------------------
// cross_vti is left out: the app's portfolio there is four tickers, the port's five (above).
for (const name of SETS.filter((s) => s !== "cross_vti")) {
  const { oracle: o } = load(name);
  const px = fixturePayload(name);
  for (const mode of ["long", "short"]) {
    const tag = (s) => `${name} ${mode}: oracle ${s}`;
    const M = o.modes[mode];
    const a = run(px, mode === "short", o.rf);
    if (!a.ok) {
      check(false, tag("analyze accepts the fixture"));
      continue;
    }
    nearAll(tag("daily means (1165)"), a.m, o.mean, REL);
    nearAll(tag("daily covariance (1164)"), a.S.flat(), o.cov.flat(), REL, 1e-20);
    // The Snapshot's two benchmark plates (1207-1208), deterministic.
    for (const k of ["mu", "sigma", "sharpe", "sortino"]) near(tag(`benchmark ${k} (1169)`), a.benchStats[k], o.bench[k], REL);
    // Best Sharpe (Tangency), 1205: one-sided T1, as t-parity.
    const oSh = -M.shipping.tan.fun;
    check(a.tangency && a.tangency.sharpe >= oSh - 1e-9 && a.tangency.sharpe <= oSh + 5e-6, tag("tangency Sharpe no worse than, and within 5e-6 of, the app's"),
      `${a.tangency?.sharpe} vs ${oSh}`);
    // Tangency Return, 1206: the T2 weight tier carried through m (|dmu| <= |dw|max * sum|252 m|).
    const muTol = 5e-3 * a.m.reduce((s, x) => s + Math.abs(x * TRADING_DAYS), 0);
    near(tag("tangency return within the T2 tier"), a.tangency?.mu, M.perf.tan.mu, 0, muTol);
    const oVol = M.shipping.gmv.fun;
    check(a.gmv && a.gmv.sigma <= oVol * (1 + 1e-9) && a.gmv.sigma >= oVol * (1 - 2e-4), tag("GMV vol no worse than, and within 2e-4 of, the app's"),
      `${a.gmv?.sigma} vs ${oVol}`);
    check(maxAbsDiff(a.gmv.w, M.shipping.gmv.x) <= 1.5e-2 && maxAbsDiff(a.tangency.w, M.shipping.tan.x) <= 5e-3,
      tag("weights within the app's SLSQP noise (T2)"));
    check(maxAbsDiff(a.gmv.w, M.tight.gmv.x) <= TIGHT && maxAbsDiff(a.tangency.w, M.tight.tan.x) <= TIGHT, tag("weights = the tight re-run"),
      `${maxAbsDiff(a.gmv.w, M.tight.gmv.x).toExponential(2)} / ${maxAbsDiff(a.tangency.w, M.tight.tan.x).toExponential(2)}`);
    // The frontier: the app's point count (948, 1600), from the GMV return; long-only it ends where
    // the app's does, at the best asset's mean (the short ceiling is a ledger entry in t-ledger).
    check(a.frontier.length === M.frontier80.targets.length, tag("frontier has the app's 80 points"), `${a.frontier.length}`);
    near(tag("frontier starts at the GMV return"), a.frontier[0]?.target, a.gmv.mu, REL);
    if (mode === "long") near(tag("frontier ends at the app's top return"), a.frontier.at(-1)?.target, M.frontier80.muMax, REL);
  }
}

// ---- 3. every refusal, named -------------------------------------------------------------------------
const px = fixturePayload("cross");
const refuse = (p, label) => {
  try {
    return analyze(p, settingsFor(px), { rate: ORACLE_RF, source: "manual" });
  } catch (err) {
    check(false, `${label}: analyze throws`, err.message);
    return { ok: true };
  }
};
const subset = (keep) => {
  const idx = keep.map((c) => px.columns.indexOf(c));
  return { ...px, columns: keep, missing: px.tickers.filter((t) => !keep.includes(t)), rows: px.rows.map((r) => [r[0], ...idx.map((j) => r[j + 1])]) };
};
const cases = [
  ["too-few", { ...px, tickers: ["VTI", "AGG"] }, "two tickers (1011)"],
  ["too-many", { ...px, tickers: "ABCDEFGHIJK".split("") }, "eleven tickers (1014)"],
  ["reversed", { ...px, start: "2026-09-26", end: "2019-01-01" }, "an end before the start"],
  ["short-range", { ...px, start: "2025-09-27" }, "a range under 730 days (1017)"],
  ["bench-failed", { ...px, missing: ["GLD", "^GSPC"] }, "the benchmark failed to download (1043-1047)"],
  ["too-few-downloaded", subset(["VTI", "AGG", "^GSPC"]), "two tickers downloaded (1050-1052)"],
  ["short-overlap", { ...px, rows: px.rows.slice(-200) }, "200 overlapping days (1076-1078)"],
  ["too-few-valid", { ...px, rows: px.rows.map((r, i) => (i < 200 ? [r[0], null, null, null, ...r.slice(4)] : r)) },
    "three tickers dropped for missing data (1080-1083)"],
];
for (const [id, p, label] of cases) {
  const a = refuse(p, label);
  check(a.ok === false && a.error === id && a.message === MESSAGES[id], `refusal: ${label} is "${id}" with its sentence`, `${a.error}`);
}
// What cleaning recorded before it stopped rides along.
const benchGone = refuse({ ...px, missing: ["GLD", "^GSPC"] }, "bench");
check(JSON.stringify(benchGone.events) === '[{"kind":"failed","tickers":["GLD"]}]', "refusal: the failed-ticker event before a benchmark stop is carried",
  JSON.stringify(benchGone.events));
const fewValid = refuse(cases[7][1], "few valid");
check(fewValid.events?.some((e) => e.kind === "dropped" && e.tickers.join() === "VTI,AGG,GLD"), "refusal: the dropped tickers behind too-few-valid are named");
// The request is checked before anything downloaded is read, as the app does (1009-1021).
const both = refuse({ ...px, tickers: ["VTI", "AGG"], missing: ["^GSPC"] }, "both");
check(both.error === "too-few", "refusal: the request check comes before the download's", both.error);

// A payload of the wrong shape never reaches the engine: named, never thrown.
const ex = examplePayload();
const rowAt = (i, row) => ({ ...px, rows: px.rows.map((r, k) => (k === i ? row : r)) });
const malformed = [
  ["null", null],
  ["a string", "prices"],
  ["an empty object", {}],
  ["an ApiError body", { error: "upstream", message: "Yahoo did not answer." }],
  ["rows missing", { ...px, rows: undefined }],
  ["a short row", rowAt(5, px.rows[5].slice(0, 3))],
  ["a price as text", rowAt(5, [px.rows[5][0], "123.4", ...px.rows[5].slice(2)])],
  ["a zero price", rowAt(5, [px.rows[5][0], 0, ...px.rows[5].slice(2)])],
  ["a negative price", rowAt(5, [px.rows[5][0], -3, ...px.rows[5].slice(2)])],
  ["an infinite price", rowAt(5, [px.rows[5][0], Infinity, ...px.rows[5].slice(2)])],
  ["tickers not a list", { ...px, tickers: "VTI,AGG,GLD" }],
  ["a column-major payload missing a column", { ...ex, prices: ex.prices.slice(1) }],
  ["a column-major column one day short", { ...ex, prices: ex.prices.map((c, j) => (j === 2 ? c.slice(1) : c)) }],
  ["a column-major payload with no rate", { ...ex, rf: "3.89" }],
];
for (const [label, p] of malformed) {
  const a = refuse(p, label);
  check(a.ok === false && a.error === "fetch-failed" && a.message === MESSAGES["fetch-failed"] && !isPricePayload(p),
    `refusal: ${label} is "fetch-failed", not a throw`, `${a.error}`);
}
check(isPricePayload(px) && isPricePayload(ex) && isPricePayload(fixturePayload("dirty")),
  "shape gate: both real layouts, gaps included, pass");

// Pure: the payload is untouched and a second call gives the same numbers.
const before = JSON.stringify(px);
const a1 = run(px);
const a2 = run(px);
check(JSON.stringify(px) === before && bits(a1.tangency.w, a2.tangency.w) && bits(a1.frontier.map((p) => p.sigma), a2.frontier.map((p) => p.sigma)),
  "pure: the payload is not mutated and a second call is identical");

done("t-analyze");
