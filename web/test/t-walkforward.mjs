// The walk-forward engine, src/lib/walkforward.ts, and the proof that the page and the published note cannot
// disagree.
//
// Two oracles, both written by test/oracle/walkforward.py from the app's own Python functions:
//   - fixtures/walkforward.json, the published run (`dump`): its schedule, the per-fold weights the app's own
//     solver fitted ("ship"), and the same run solved exactly ("tight");
//   - fixtures/walkforward-options.json (`options`): the page's fit and hold options on the cross-asset set at
//     2%, and all three sets at each period's own 3-month bill rate (fixtures/dgs3mo.csv, FRED's DGS3MO as
//     saved once), with the exact solver.
// The prices are the frozen fixtures cut at 2026-09-04, the run's last bar, daily returns computed once on the
// cut frame. Tolerances:
//   - replaying stored weights: 1e-9. Only sums, means and standard deviations stand between the two sides.
//   - anything this engine SOLVES against the oracle's tight solve: 1e-6. quadprog is exact; the tight SLSQP
//     run stops within about 3e-8 of the optimum.
// Every published figure is read from src/content/published.ts or the fixture's own published fields, never
// typed here, and compared as the page prints it (format()).
import { readFileSync } from "node:fs";
import { check, done, json } from "./_assert.mjs";

const W = await import("../src/lib/walkforward.ts");
const C = await import("../src/lib/constructions.ts");
const O = await import("../src/lib/optimize.ts");
const { computeReturns, column } = await import("../src/lib/clean.ts");
const { covMatrix, mean } = await import("../src/lib/num.ts");
const { portfolioPerformance, portfolioReturns } = await import("../src/lib/portfolio.ts");
const { annualizedStats, sharpeSE, TRADING_DAYS } = await import("../src/lib/stats.ts");
const { format } = await import("../src/format.ts");
const P = await import("../src/content/published.ts");
const { parseRfSeries } = await import("../src/state/rfwindow.ts");

const WF = json(new URL("./fixtures/walkforward.json", import.meta.url));
const OPT = json(new URL("./fixtures/walkforward-options.json", import.meta.url));
const DGS = parseRfSeries(readFileSync(new URL("./fixtures/dgs3mo.csv", import.meta.url), "utf8"));
const FIXTURE = { megacap5: "megacap5", sectors7: "sectors", cross: "cross" };
const SETS = Object.keys(FIXTURE);
const KEYS = { ew: "ew", gmv: "gmv", tan: "tangency" }; // fixture key -> published.ts field
// The schedule's two constants, held here rather than read from the engine, so a changed constant cannot
// carry the checks below along with it: the first fit's rows as the oracle used them, and the fewest held
// rows a hold's own Sharpe is reported from (about a quarter of trading days).
const FIRST = OPT.first_fit;
const FLOOR = 63;
check(W.FIRST_FIT === FIRST, `the first fit is the oracle's ${FIRST} rows`, String(W.FIRST_FIT));
check(W.MIN_HOLD === FLOOR, `a hold's own Sharpe is reported from ${FLOOR} rows`, String(W.MIN_HOLD));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A side that is not a list of the same length (a fold with no weights, a schedule with another count of folds)
// is an infinite gap, so its check fails by name rather than the suite throwing and skipping every check after it.
const gapOf = (a, b) => (Array.isArray(a) && Array.isArray(b) && a.length === b.length ? Math.max(0, ...a.map((x, i) => Math.abs(x - b[i]))) : Infinity);
const worst = {};
function within(label, a, b, tol, bucket) {
  const g = Array.isArray(b) ? gapOf(a, b) : Math.abs(a - b);
  if (bucket) worst[bucket] = Math.max(worst[bucket] ?? 0, g);
  check(g <= tol, label, `engine ${a} oracle ${b} gap ${g}`);
}

// The study's frame: the first bar on or after 2019-01-01 through the run's last bar, the set's own tickers
// plus the benchmark, returns computed once on that frame.
function cut(set) {
  const entry = WF.sets[set];
  const px = json(new URL(`./fixtures/prices-${FIXTURE[set]}.json`, import.meta.url));
  const rows = px.rows.filter((r) => r[0] >= "2019-01-01" && r[0] <= entry.last_bar);
  const names = [...entry.tickers, px.benchmark];
  const values = names.map((t) => {
    const j = px.columns.indexOf(t);
    return rows.map((r) => r[j + 1]);
  });
  check(values.every((v) => v.every(Number.isFinite)), `${set}: the cut frame has no gaps`);
  check(rows[0][0] === entry.first_bar && rows.at(-1)[0] === entry.last_bar, `${set}: the cut frame spans the run's first to last bar`);
  const ret = computeReturns({ dates: rows.map((r) => r[0]), columns: names, values });
  return { tickers: entry.tickers, dates: ret.dates, cols: entry.tickers.map((t) => column(ret, t)), bench: column(ret, px.benchmark) };
}
const DATA = Object.fromEntries(SETS.map((s) => [s, cut(s)]));
const published = (set) => P.PUBLISHED_SETS.find((p) => same([...p.tickers], WF.sets[set].tickers));

// ---- 1. the schedule, the replay of the published weights, and the nine strings ------------------------

for (const set of SETS) {
  const d = DATA[set];
  const entry = WF.sets[set];
  const pub = published(set);
  check(Boolean(pub), `${set}: published.ts carries this set`);
  const plan = W.schedule(d.dates.length, W.DEFAULT_WALK);
  check(plan.ok, `${set}: the schedule runs`);
  const dates = plan.folds.map((f) => ({ fit_last: d.dates[f.fitTo - 1], hold_first: d.dates[f.holdFrom], hold_last: d.dates[f.holdTo - 1] }));
  check(same(dates, entry.folds), `${set}: the schedule's fold dates are the published run's`, JSON.stringify(dates));
  check(plan.folds.every((f) => f.fitFrom === 0 && f.fitTo === f.holdFrom), `${set}: every published fit is expanding and ends where its hold starts`);
  // A schedule with another count of folds than the record cannot replay it: say so by name and move on, rather
  // than throwing on a fold the record has no weights for and skipping every check after this one.
  const holds = plan.ok ? plan.folds.length : 0;
  if (!Object.values(entry.ship.weights).every((ws) => ws.length === holds)) {
    check(false, `${set}: the schedule has the record's count of folds`, `${holds} against ${entry.ship.weights.ew.length}`);
    continue;
  }

  for (const [k, field] of Object.entries(KEYS)) {
    const rep = W.replay(d.cols, plan.folds, entry.ship.weights[k], WF.rf);
    within(`${set} ${k}: replayed fold Sharpes`, rep.folds.map((f) => f.sharpe), entry.ship.fold_sharpe[k], 1e-9, "ship fold");
    within(`${set} ${k}: replayed joined Sharpe`, rep.sharpe, entry.ship.sharpe[k], 1e-9, "ship joined");
    check(format(rep.sharpe, "num3") === pub[field], `${set} ${k}: prints the published ${pub[field]}`, format(rep.sharpe, "num3"));
    check(rep.joined.length === d.dates.length - plan.folds[0].holdFrom, `${set} ${k}: every held day joins the series`);
    within(`${set} ${k}: the standard error is sharpeSE of the joined series`, rep.se, sharpeSE(rep.joined, WF.rf), 0);
    if (set === "sectors7" && k === "gmv") {
      const edge = Number(pub.gmv) - 0.0005; // the lowest raw value that prints the published string
      const margin = rep.sharpe - edge;
      console.log(`  sectors7 minimum variance: ${rep.sharpe.toFixed(9)}, ${margin.toExponential(3)} above its rounding edge`);
      check(margin > 0, `sectors7 minimum variance sits ${margin.toExponential(3)} above its rounding edge`);
    }
  }
}

// ---- 2. the exact engine against the tight solve, at the published 2.0%, long-only ----------------------

const flat = {};
for (const set of SETS) {
  const d = DATA[set];
  const tight = WF.sets[set].tight;
  const run = W.walkForward({ cols: d.cols, dates: d.dates, bench: d.bench, rates: WF.rf, allowShort: false, added: false });
  flat[set] = run;
  check(run.ok && run.convention === "flat", `${set}: the flat walk-forward runs`);
  // Exactly the three published constructions, so every loop below reads a record the fixture holds.
  check(same(run.runs.map((r) => r.id), Object.keys(KEYS)), `${set}: the flat run carries the three published constructions`, run.runs.map((r) => r.id).join(" "));
  for (const r of run.runs) {
    tight.weights[r.id].forEach((w, f) => within(`${set} ${r.id}: fold ${f} weights`, r.weights[f], w, 1e-6, "tight weights"));
    within(`${set} ${r.id}: fold Sharpes`, r.foldSharpe, tight.fold_sharpe[r.id], 1e-6, "tight fold");
    within(`${set} ${r.id}: joined Sharpe`, r.sharpe, tight.sharpe[r.id], 1e-6, "tight joined");
    // The solver note on the page is formatted from the record's exact solve: the engine the page runs must print
    // the same three decimals, not merely sit within 1e-6 of a figure that could round the other way.
    check(format(r.sharpe, "num3") === format(tight.sharpe[r.id], "num3"), `${set} ${r.id}: the exact engine prints what the solver note says`,
      `${format(r.sharpe, "num3")} against ${format(tight.sharpe[r.id], "num3")}`);
  }
  check(same(run.folds.map((f) => f.fitRate), run.folds.map(() => WF.rf)), `${set}: every flat fit is at the flat rate`);
  // In-sample at a flat rate is the figure the Optimization tab prints for the whole window.
  const m = d.cols.map(mean);
  const S = covMatrix(d.cols);
  for (const [id, sol] of [["gmv", O.gmv(m, S, false)], ["tan", O.tangency(m, S, WF.rf, false)]]) {
    const r = run.runs.find((x) => x.id === id);
    within(`${set} ${id}: in-sample is the whole-window figure the Optimization tab prints`, r.inSample, portfolioPerformance(sol.w, m, S, WF.rf).sharpe, 1e-12);
  }
  // The whole window under the oracle's exact solve (the record's whole_window.tight, which the As published chart
  // sets beside each published figure): every construction's in-sample figure and the weights behind it.
  const whole = WF.sets[set].whole_window?.tight;
  for (const r of run.runs) {
    within(`${set} ${r.id}: the whole-window figure against the tight solve`, r.inSample, whole?.sharpe?.[r.id], 1e-6, "tight whole window");
    within(`${set} ${r.id}: the whole-window weights against the tight solve`, r.inSampleWeights, whole?.weights?.[r.id], 1e-6, "tight whole weights");
    check(format(r.inSample, "num3") === whole?.prints?.[r.id], `${set} ${r.id}: the exact engine prints the tight solve's whole-window figure`,
      `${format(r.inSample, "num3")} against ${whole?.prints?.[r.id]}`);
  }
  const b = run.bench;
  within(`${set}: the benchmark's joined Sharpe is annualizedStats on its held rows`, b.sharpe, annualizedStats(d.bench.slice(run.folds[0].holdFrom), WF.rf).sharpe, 1e-12);
  within(`${set}: the benchmark's in-sample is its whole window`, b.inSample, annualizedStats(d.bench, WF.rf).sharpe, 1e-12);
}

// The other published figures: the mega-caps' 1.107 from the engine's own solve, the AGG and Apple weights stored.
{
  const tan = flat.megacap5.runs.find((r) => r.id === "tan");
  check(format(tan.inSample, "num3") === P.MEGA_CAP_IN_SAMPLE, `megacap5: the whole-window tangency prints ${P.MEGA_CAP_IN_SAMPLE}`, format(tan.inSample, "num3"));
  within("megacap5: the whole-window tangency against the tight solve", tan.inSample, WF.sets.megacap5.tight.in_sample_tangency, 1e-6, "tight in-sample");
  const cross = WF.sets.cross;
  const agg = cross.tickers.indexOf("AGG");
  const k = cross.folds.findIndex((f) => f.hold_first.startsWith("2022-01"));
  check(k >= 0 && cross.ship.weights.gmv[k][agg] === cross.ship.gmv_agg_into_2022, "cross: the stored AGG weight is the minimum-variance weight held from January 2022");
  check(format(cross.ship.gmv_agg_into_2022, "pct1") === cross.published_agg_into_2022, `cross: the stored AGG weight prints ${cross.published_agg_into_2022}`);
  const apple = WF.sets.megacap5.sensitivity_apple;
  check(same(apple.windows.map((w) => format(w.tangency_aapl, "pct1")), apple.published), "megacap5: the stored Apple weights print the published five", JSON.stringify(apple.windows.map((w) => format(w.tangency_aapl, "pct1"))));
}

// ---- 3. the options and each period's own rate, against the oracle ---------------------------------------

function againstOracle(label, run, o, d) {
  const dates = run.folds.map((f) => ({ fit_first: f.fitFirst, fit_last: f.fitLast, hold_first: f.holdFirst, hold_last: f.holdLast, fit_rows: f.fitTo - f.fitFrom, bars: f.bars }));
  const want = o.folds.map(({ fit_first, fit_last, hold_first, hold_last, fit_rows, bars }) => ({ fit_first, fit_last, hold_first, hold_last, fit_rows, bars }));
  check(same(dates, want), `${label}: fold dates and rows`, JSON.stringify(dates.at(-1)));
  within(`${label}: each fit's rate`, run.folds.map((f) => f.fitRate), o.folds.map((f) => f.rate), 0);
  for (const r of run.runs) {
    o.weights[r.id]?.forEach((w, f) => within(`${label} ${r.id}: fold ${f} weights`, r.weights[f], w, 1e-6, "options weights"));
    // A hold under MIN_HOLD rows reports no Sharpe of its own; the oracle scores every hold.
    const short = run.folds.map((f) => f.bars < FLOOR);
    check(same(r.foldSharpe.map((x) => x === null), short), `${label} ${r.id}: no fold Sharpe exactly where the hold is under ${FLOOR} rows`);
    within(`${label} ${r.id}: fold Sharpes`, r.foldSharpe.filter((_, f) => !short[f]), o.fold_sharpe[r.id].filter((_, f) => !short[f]), 1e-6, "options fold");
    within(`${label} ${r.id}: joined Sharpe`, r.sharpe, o.sharpe[r.id], 1e-6, "options joined");
    within(`${label} ${r.id}: in-sample`, r.inSample, o.in_sample[r.id], 1e-6, "options in-sample");
  }
  const short = run.folds.map((f) => f.bars < FLOOR);
  within(`${label} benchmark: fold Sharpes`, run.bench.foldSharpe.filter((_, f) => !short[f]), o.fold_sharpe.bench.filter((_, f) => !short[f]), 1e-9);
  within(`${label} benchmark: joined Sharpe`, run.bench.sharpe, o.sharpe.bench, 1e-9);
  within(`${label} benchmark: in-sample`, run.bench.inSample, o.in_sample.bench, 1e-9);
  within(`${label}: the in-sample fit's rate`, run.inSampleRate, o.in_sample.rate, 0);
  within(`${label}: the in-sample tangency weights`, run.runs.find((r) => r.id === "tan").inSampleWeights, o.in_sample.tan_weights, 1e-6, "options weights");
  check(run.heldRows === d.dates.length - FIRST, `${label}: every row after the first fit is held once`);
}

check(same(OPT.flat.tickers, WF.sets[OPT.flat.set].tickers), "the options oracle ran on the cross-asset set");
let sawShortHold = false;
for (const [key, o] of Object.entries(OPT.flat.runs)) {
  const [fit, hold] = key.split("|");
  const d = DATA[OPT.flat.set];
  const run = W.walkForward({ cols: d.cols, dates: d.dates, bench: d.bench, rates: OPT.flat.rf, allowShort: false, added: false }, { fit, hold: Number(hold) });
  check(run.ok && run.options.fit === fit && run.options.hold === Number(hold), `cross ${key}: runs with its options`);
  if (fit === "rolling") check(run.folds.every((f) => f.fitTo - f.fitFrom === FIRST), `cross ${key}: every rolling fit is ${FIRST} rows`);
  sawShortHold ||= run.folds.some((f) => f.bars < FLOOR);
  againstOracle(`cross ${key}`, run, o, d);
}
check(sawShortHold, "the options oracle includes a last hold under the floor");

for (const set of SETS) {
  const o = OPT.rfhist.sets[set];
  const d = DATA[set];
  check(same(o.tickers, d.tickers), `${set} rfhist: the oracle's tickers`);
  const run = W.walkForward({ cols: d.cols, dates: d.dates, bench: d.bench, rates: DGS, allowShort: false, added: false });
  check(run.ok && run.convention === "per-period", `${set}: the per-period walk-forward runs`);
  againstOracle(`${set} rfhist`, run, o, d);
  // The rates really do move: a per-period run that took one rate would not have passed the line above.
  check(new Set(run.folds.map((f) => f.fitRate)).size > 3, `${set} rfhist: the fits sit at different rates`);
}

// Whether each maximum-Sharpe fit's mix earned more than its fit's rate, per fold, as the solver itself says on
// that fold's rows: the cross-asset set per period, rolling fits, with the added constructions. Some fit there sits
// below its rate, so the check reads both answers.
{
  const d = DATA.cross;
  const run = W.walkForward({ cols: d.cols, dates: d.dates, bench: d.bench, rates: DGS, allowShort: false, added: true }, { fit: "rolling", hold: 252 });
  const bad = [];
  let below = 0;
  for (const r of run.runs) {
    run.folds.forEach((f, k) => {
      const fit = d.cols.map((c) => c.slice(f.fitFrom, f.fitTo));
      let want = null;
      if (r.id === "tan") want = O.tangency(fit.map(mean), covMatrix(fit), f.fitRate, false)?.beatsRf ?? null;
      else if (r.id !== "ew" && r.id !== "gmv" && !r.unavailable[k]) {
        const own = C.ownWindow(r.id, fit);
        want = C.solveAdded(r.id, own.m, own.S, own.T, f.fitRate, false)?.beatsRf ?? null;
      }
      if (r.beatsRf[k] !== want) bad.push(`${r.id} fold ${k}: ${r.beatsRf[k]} against ${want}`);
      if (r.beatsRf[k] === false) below += 1;
    });
  }
  check(bad.length === 0 && below > 0, "cross rfhist rolling: each fold's maximum-Sharpe fits say whether they beat the fit's rate, as the solver does",
    bad.slice(0, 3).join(" | ") || `${below} fits below their rate`);
}

// ---- 4. synthetic baskets: the added constructions per fold, the edges, the rate ------------------------

function rng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-300)) * Math.cos(2 * Math.PI * u());
}
function weekdays(n, from = "2019-01-02") {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
// n assets on a common factor; drift(t, i) is each row's mean, vol each asset's own noise.
function basket(T, n, seed, drift = (t, i) => 0.0003 + 0.0002 * i, vol = (i) => 0.008 + 0.003 * i) {
  const z = rng(seed);
  const cols = Array.from({ length: n }, () => new Array(T));
  const bench = new Array(T);
  for (let t = 0; t < T; t++) {
    const f = 0.006 * z();
    bench[t] = 0.0003 + f + 0.002 * z();
    for (let i = 0; i < n; i++) cols[i][t] = drift(t, i) + (0.5 + 0.2 * i) * f + vol(i) * z();
  }
  return { cols, bench, dates: weekdays(T) };
}
const runOf = (b, over = {}, opts) => W.walkForward({ cols: b.cols, dates: b.dates, bench: b.bench, rates: 0.02, allowShort: false, added: true, ...over }, opts);

// The added constructions, refitted per fold on exactly that fold's fit rows. The rows on both sides of every
// fit boundary carry shocks, so a fit one row long or short lands visibly elsewhere.
{
  const T = FIRST + 3 * 252 + 100;
  const b = basket(T, 5, 11);
  for (const at of [FIRST, FIRST + 252, FIRST + 504, FIRST + 756]) {
    b.cols.forEach((c, i) => {
      c[at - 1] += i % 2 ? 0.12 : -0.09;
      c[at] += i % 2 ? -0.15 : 0.11;
    });
  }
  for (const fit of ["expanding", "rolling"]) {
    const run = runOf(b, {}, { fit, hold: 252 });
    check(run.ok && run.runs.map((r) => r.id).join() === ["ew", "gmv", "tan", ...C.ADDED_IDS].join(), `synthetic ${fit}: the added constructions follow the three, in the scorecard's order`);
    let moved = 0;
    for (const r of run.runs.filter((x) => C.isAddedId(x.id))) {
      run.folds.forEach((f, k) => {
        const solve = (from, to) => {
          const own = C.ownWindow(r.id, b.cols.map((c) => c.slice(from, to)));
          return C.solveAdded(r.id, own.m, own.S, own.T, 0.02, false)?.w ?? null;
        };
        within(`synthetic ${fit} ${r.id} fold ${k}: solveAdded on exactly the fold's fit rows`, r.weights[k], solve(f.fitFrom, f.fitTo), 1e-15);
        if (gapOf(solve(f.fitFrom, f.fitTo + 1), r.weights[k]) > 1e-6 && gapOf(solve(f.fitFrom, f.fitTo - 1), r.weights[k]) > 1e-6) moved += 1;
        check(r.unavailable[k] === C.unavailable(r.id, f.fitTo - f.fitFrom, 5), `synthetic ${fit} ${r.id} fold ${k}: availability is the fold's own`);
      });
      check(r.sharpe !== null && r.failed.length === 0, `synthetic ${fit} ${r.id}: a joined figure on every fold`);
    }
    check(moved >= 12, `synthetic ${fit}: a fit one row long or short moves the added weights`, `${moved} of 16`);
    // The last-year construction reads the fold's LAST 252 fit rows, computed here without ownWindow.
    const y = run.runs.find((r) => r.id === "tan.1y");
    run.folds.forEach((f, k) => {
      const last = b.cols.map((c) => c.slice(f.fitTo - 252, f.fitTo));
      const want = O.tangency(last.map(mean), covMatrix(last), 0.02, false)?.w ?? null;
      within(`synthetic ${fit} tan.1y fold ${k}: the tangency of the fold's last 252 fit rows`, y.weights[k], want, 1e-15);
    });
  }
  // Four assets: the cap leaves no room on any fold, and says why, on every fold and on the whole window.
  const four = { ...b, cols: b.cols.slice(0, 4) };
  const r4 = runOf(four).runs.find((r) => r.id === "tan.cap");
  check(r4.unavailable.every((x) => x === "too-few-assets") && r4.failed.length === 0 && r4.sharpe === null && r4.inSampleUnavailable === "too-few-assets", "four assets: the capped construction is unavailable on every fold, named, with no joined figure");
  const r5 = runOf(b).runs.find((r) => r.id === "tan.cap");
  check(r5.unavailable.every((x) => x === null) && r5.sharpe !== null, "five assets: the capped construction runs on every fold");
}

// The floor: one reportable hold is the least the walk-forward runs on.
{
  const need = FIRST + FLOOR;
  const b = basket(need, 3, 5);
  const short = { cols: b.cols.map((c) => c.slice(0, need - 1)), bench: b.bench.slice(0, need - 1), dates: b.dates.slice(0, need - 1) };
  const refused = runOf(short);
  check(!refused.ok && refused.reason === "too-few-rows" && refused.rows === need - 1 && refused.need === need, `${need - 1} rows refuse, with the count`, JSON.stringify(refused));
  const ran = runOf(b, { added: false });
  check(ran.ok && ran.folds.length === 1 && ran.folds[0].bars === FLOOR && ran.runs.every((r) => r.foldSharpe[0] !== null), `${need} rows run one reportable hold`);
}

// A last hold under the floor joins the series and reports no Sharpe of its own.
{
  const T = FIRST + 252 + 40;
  const b = basket(T, 4, 7);
  const run = runOf(b, { added: false });
  check(run.ok && run.folds.length === 2 && run.folds[1].bars === 40, "a 40-row last hold is kept");
  for (const r of run.runs) {
    check(r.foldSharpe[0] !== null && r.foldSharpe[1] === null, `${r.id}: the short last hold has no Sharpe of its own`);
    const held = run.folds.flatMap((f, k) => portfolioReturns(b.cols.map((c) => c.slice(f.holdFrom, f.holdTo)), r.weights[k]));
    check(held.length === 292, `${r.id}: all 292 held rows join`);
    within(`${r.id}: the joined Sharpe is annualizedStats of every held row`, r.sharpe, annualizedStats(held, 0.02).sharpe, 1e-12);
  }
  const ew = run.runs[0];
  const foldMean = mean([ew.foldSharpe[0], W.sharpeOn(portfolioReturns(b.cols.map((c) => c.slice(FIRST + 252)), [0.25, 0.25, 0.25, 0.25]), 0, 0.02)]);
  check(Math.abs(ew.sharpe - foldMean) > 1e-6, "the joined Sharpe is not the mean of the folds' Sharpes");
  within("the benchmark's joined Sharpe is annualizedStats on its held rows", run.bench.sharpe, annualizedStats(b.bench.slice(FIRST), 0.02).sharpe, 1e-12);
  check(run.bench.foldSharpe[1] === null, "the benchmark's short last hold has no Sharpe of its own");
}

// Weights are constant, rebalanced daily: a held day's return is r_t . w, never a drifted mix.
{
  const b = basket(FIRST + 252, 3, 13);
  const run = runOf(b, { added: false });
  const g = run.runs.find((r) => r.id === "gmv");
  const f = run.folds[0];
  const want = [];
  for (let t = f.holdFrom; t < f.holdTo; t++) want.push(b.cols.reduce((s, c, i) => s + c[t] * g.weights[0][i], 0));
  check(run.folds.length === 1, "a window of the first fit and one hold has one hold", String(run.folds.length));
  const rep = run.folds.length === 1 ? W.replay(b.cols, run.folds, [g.weights[0]], 0.02) : null;
  within("a held day's return is r_t . w", rep?.joined ?? null, want, 1e-15);
}

// A construction whose solve fails on one fold: no joined figure, the fold named, nothing standing in.
{
  const T = FIRST + 3 * 252;
  const drift = (t) => (t < FIRST ? 0.001 : t < FIRST + 252 ? -0.006 : 0.01);
  const b = basket(T, 5, 3, drift, () => 0.005);
  const run = runOf(b);
  const cap = run.runs.find((r) => r.id === "tan.cap");
  check(same(cap.failed, [1]) && cap.weights[1] === null && cap.weights[0] !== null && cap.weights[2] !== null, "the capped construction fails on fold 1 alone, and that fold is named", JSON.stringify(cap.failed));
  check(cap.sharpe === null && cap.se === null, "a failed fold leaves no joined figure");
  check(cap.foldSharpe[0] !== null && cap.foldSharpe[1] === null && cap.foldSharpe[2] !== null, "the folds that solved keep their own Sharpe");
  check(run.runs.filter((r) => ["ew", "gmv"].includes(r.id)).every((r) => r.sharpe !== null), "the other constructions still have joined figures");

  // The same basket under a daily rate that moves every day: a fold that solved is scored from its own hold's
  // first row of the rate series, never from the window's first, even though another fold failed.
  const moving = b.dates.map((d, t) => [d, 0.02 + 1e-5 * t]);
  const per = runOf(b, { rates: moving });
  const pcap = per.runs.find((r) => r.id === "tan.cap");
  const daily = W.dayRates(moving, b.dates);
  check(per.convention === "per-period" && daily.ok && pcap.failed.length > 0 && pcap.sharpe === null,
    "per period: the capped construction still fails on a fold and has no joined figure", JSON.stringify(pcap.failed));
  const solved = per.folds.flatMap((f, k) => (pcap.weights[k] ? [k] : []));
  const own = solved.map((k) => W.sharpeOn(W.heldReturns(b.cols, per.folds[k], pcap.weights[k]), per.folds[k].holdFrom, daily.rates));
  const fromZero = solved.map((k) => W.sharpeOn(W.heldReturns(b.cols, per.folds[k], pcap.weights[k]), 0, daily.rates));
  within("per period: a solved fold's own Sharpe beside a failed one is scored on its own days' rates", solved.map((k) => pcap.foldSharpe[k]), own, 1e-12);
  check(solved.length > 0 && solved.every((k, i) => Math.abs(own[i] - fromZero[i]) > 1e-6),
    "per period: the rates from the window's first row would print another figure, so the check above can tell them apart",
    solved.map((k, i) => Math.abs(own[i] - fromZero[i]).toExponential(2)).join(" "));
}

// Shorting reaches minimum variance and maximum Sharpe.
{
  const z = rng(21);
  const T = FIRST + 252;
  const f = Array.from({ length: T }, () => 0.01 * z());
  const cols = [
    f.map((x) => 0.0008 + x + 0.002 * z()),
    f.map((x) => 0.0001 + 2 * x + 0.002 * z()),
    f.map(() => 0.0004 + 0.01 * z()),
  ];
  const b = { cols, bench: f, dates: weekdays(T) };
  const on = runOf(b, { allowShort: true, added: false });
  const off = runOf(b, { allowShort: false, added: false });
  for (const id of ["gmv", "tan"]) {
    const w = on.runs.find((r) => r.id === id).weights[0];
    check(Math.min(...w) < -0.01, `${id}: shorting on holds a short`, JSON.stringify(w));
    check(Math.min(...off.runs.find((r) => r.id === id).weights[0]) >= -1e-12, `${id}: shorting off holds none`);
    const fit = cols.map((c) => c.slice(0, FIRST));
    const m = fit.map(mean);
    const S = covMatrix(fit);
    const want = id === "gmv" ? O.gmv(m, S, true).w : O.tangency(m, S, 0.02, true).w;
    within(`${id}: the shorting solve on the fold's fit`, w, want, 1e-15);
  }
}

// The rate.
{
  const s = [["2021-01-04", 0.01], ["2021-01-06", 0.03], ["2021-01-07", 0.09]];
  check(W.rateOn(s, "2021-01-06") === 0.03, "a day with an observation takes it");
  check(W.rateOn(s, "2021-01-05") === 0.01, "a day without one takes the one before, never the next");
  check(W.rateOn(s, "2021-01-03") === null, "a day before the series has no rate");
  const dr = W.dayRates(s, ["2021-01-04", "2021-01-05", "2021-01-06", "2021-01-08"]);
  check(dr.ok && same(dr.rates, [0.01, 0.01, 0.03, 0.09]), "unpublished days carry the previous rate forward", JSON.stringify(dr));
  const late = W.dayRates(s, ["2021-01-01", "2021-01-04"]);
  check(!late.ok && late.reason === "rates-start-late" && late.first === "2021-01-04" && late.day === "2021-01-01", "a day before the series' first observation is a named error");

  const T = FIRST + 252;
  const b = basket(T, 4, 9);
  const fitLast = b.dates[FIRST - 1];
  const next = b.dates[FIRST];
  const before = b.dates[FIRST - 2];
  // A daily series on every row at 0.01, with 0.03 on the fit's last day and 0.09 the day after.
  const series = b.dates.map((d) => [d, d === fitLast ? 0.03 : d === next ? 0.09 : 0.01]);
  const run = runOf(b, { rates: series, added: false });
  check(run.ok && run.convention === "per-period" && run.folds[0].fitRate === 0.03, "a fit takes the rate on its last row's day");
  const run2 = runOf(b, { rates: series.filter(([d]) => d !== fitLast), added: false });
  check(run2.ok && run2.folds[0].fitRate === 0.01 && W.rateOn(series, before) === 0.01, "with none that day, the one before it, never the day after");
  const t = run.runs.find((r) => r.id === "tan");
  const tanWant = (() => {
    const fit = b.cols.map((c) => c.slice(0, FIRST));
    return O.tangency(fit.map(mean), covMatrix(fit), 0.03, false).w;
  })();
  within("the fit's tangency is solved at the fit's rate", t.weights[0], tanWant, 1e-15);

  // A held day FRED did not publish carries the rate before it; every held day is scored at its own rate.
  const gapDay = b.dates[FIRST + 10];
  const holed = series.filter(([d]) => d !== gapDay).map(([d, r]) => [d, d > fitLast ? 0.01 + (d < gapDay ? 0.02 : 0.04) : r]);
  const run3 = runOf(b, { rates: holed, added: false });
  const ew = run3.runs[0];
  const own = W.dayRates(holed, b.dates).rates;
  check(own[FIRST + 10] === own[FIRST + 9] && own[FIRST + 9] === 0.03, "the unpublished held day carries the day before's rate");
  const held = portfolioReturns(b.cols.map((c) => c.slice(FIRST)), [0.25, 0.25, 0.25, 0.25]);
  const ex = held.map((x, k) => x - own[FIRST + k] / TRADING_DAYS);
  within("per-period: the joined Sharpe is annualizedStats of the excess series at zero", ew.sharpe, annualizedStats(ex, 0).sharpe, 1e-15);
  within("per-period: its standard error is sharpeSE of the excess series", ew.se, sharpeSE(ex, 0), 1e-15);
  const atFit = held.map((x) => x - run3.folds[0].fitRate / TRADING_DAYS);
  check(Math.abs(ew.sharpe - annualizedStats(atFit, 0).sharpe) > 1e-6, "held days are not scored at the fit's rate");
  const avg = mean(own);
  check(Math.abs(ew.sharpe - annualizedStats(held, avg).sharpe) > 1e-6, "held days are not scored at the window's average rate");

  // A series that starts after the first held day cannot score the walk: named, never a silent zero.
  const lateRun = runOf(b, { rates: series.filter(([d]) => d > next), added: false });
  check(!lateRun.ok && lateRun.reason === "rates-start-late" && lateRun.first === b.dates[FIRST + 1] && lateRun.day === b.dates[0], "a series starting after the first held day is a named error", JSON.stringify(lateRun));

  // One flat rate equal to every day of a constant series gives the same figures both ways.
  const flatRun = runOf(b, { rates: 0.035 });
  const constRun = runOf(b, { rates: b.dates.map((d) => [d, 0.035]) });
  check(flatRun.convention === "flat" && constRun.convention === "per-period", "the two conventions are named");
  for (let i = 0; i < flatRun.runs.length; i++) {
    const a = flatRun.runs[i];
    const c = constRun.runs[i];
    within(`${a.id}: flat and constant series, joined Sharpe`, c.sharpe, a.sharpe, 1e-12);
    within(`${a.id}: flat and constant series, standard error`, c.se, a.se, 1e-12);
    within(`${a.id}: flat and constant series, in-sample`, c.inSample, a.inSample, 1e-12);
    within(`${a.id}: flat and constant series, weights`, c.weights[0], a.weights[0], 0);
  }
  within("benchmark: flat and constant series", constRun.bench.sharpe, flatRun.bench.sharpe, 1e-12);
}

for (const [k, v] of Object.entries(worst)) console.log(`  largest gap, ${k}: ${v.toExponential(2)}`);
done("t-walkforward");
