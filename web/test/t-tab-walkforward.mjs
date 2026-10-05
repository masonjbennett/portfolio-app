// The walk-forward tab's "Your basket" segment (src/tabs/walkforward/Live.tsx), rendered, against the engine.
//
// Every figure the segment prints is read off the page and compared with walkForward() (src/lib/walkforward.ts)
// run here on the same analysis, formatted as the page formats it: the in-sample, out-of-sample and standard
// error of every row, every hold's dates, rate, days and Sharpe ratio, and every per-fold weight. The in-sample
// column at a flat rate is held to the scorecard's own figure for the same portfolio (the Optimization tab's),
// and per period to the engine's like-for-like reading. The label line is checked word for word in each of the
// rate states, with its dates written by the platform's own date formatter and the published run's last bar
// and rate read from the published record (fixtures/walkforward.json), never typed here.
//
// Also: the cannot-run state one row either side of its edge, a construction whose solve fails in a hold named
// with the hold, an unavailable added construction named with its reason, the solving state before the run
// lands, no re-solve on a repaint and one on an option change, none of the words that would crown a portfolio,
// no row set apart from the others, and the one citation.
import { readFileSync } from "node:fs";
import { check, done, json } from "./_assert.mjs";
import { act, render, text } from "./_dom.mjs";

const { createElement: h } = await import("react");
const { default: Live, ADDED_SWITCH } = await import("../src/tabs/walkforward/Live.tsx");
const L = await import("../src/tabs/walkforward/live.ts");
const W = await import("../src/lib/walkforward.ts");
const { default: WalkForward } = await import("../src/tabs/WalkForward.tsx");
const { default: Boundary } = await import("../src/components/Boundary.tsx");
const { format } = await import("../src/format.ts");
const { parseRfSeries } = await import("../src/state/rfwindow.ts");
const { analyze } = await import("../src/state/analyze.ts");
const { ADDED_IDS, CAP_MIN_ASSETS } = await import("../src/lib/constructions.ts");
const { columnFigures } = await import("../src/tabs/optimization/scorecard.ts");
const { customWeights, tiles } = await import("../src/tabs/optimization/model.ts");
const { SCORE_TIPS } = await import("../src/content/tooltips.ts");
const { exampleAnalysis, examplePayload, fixtureAnalysis, settingsFor, ORACLE_RF } = await import("./_analysis.mjs");

const RECORD = json(new URL("./fixtures/walkforward.json", import.meta.url));
const DGS = parseRfSeries(readFileSync(new URL("./fixtures/dgs3mo.csv", import.meta.url), "utf8"));
const SERIES = { basis: "window", points: DGS, flat: null };
const NONE = { basis: "fallback", points: null, flat: "unavailable" };
const TYPED = { basis: "manual", points: null, flat: "typed" };
const LOADING = { basis: "window", points: null, flat: "loading" };

const quietly = async (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};
// Lets the deferred solve run: it waits one macrotask for the paint, then steps through the run, a slice of
// work per macrotask, until it lands.
const flush = () => act(async () => {
  for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 0));
});
const click = (el) => act(() => el.click());

// The published run's last bar and rate, from its own record: every set ends on the same bar at the same rate.
const lastBars = new Set(Object.values(RECORD.sets).map((s) => s.last_bar));
check(lastBars.size === 1, "record: the published sets share one last bar", [...lastBars].join());
const PUB_LAST = [...lastBars][0];
const PUB_RF = RECORD.rf;
// An ISO day as "Sep 4 2026", by the platform's own formatter rather than the page's.
const longDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).replace(",", "");

// ---- reading the page -------------------------------------------------------------------------------------

const tableBy = (root, title) => [...root.querySelectorAll(".tbl")].find((t) => text(t.querySelector(".tbl-title")) === title) ?? null;
// A head or a label cell without its sub-line.
const own = (cell) => {
  const c = cell.cloneNode(true);
  for (const s of c.querySelectorAll(".tbl-sub, .tip")) s.remove();
  return text(c);
};
function readTable(tb) {
  if (!tb) return null;
  const heads = [...tb.querySelectorAll("thead th")].map(own);
  const rows = [...tb.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c, k) => (k === 0 ? own(c) : text(c))));
  return { heads, rows };
}

// ---- what the engine says the page should print -------------------------------------------------------------

const ratesOf = (a, plan) => (plan.kind === "per-period" ? plan.points : plan.rate);
function expected(a, rates, opts, added) {
  const plan = L.ratePlan(a, rates);
  const w = W.walkForward({ cols: a.returns, dates: a.dates, bench: a.bench, rates: ratesOf(a, plan), allowShort: a.allowShort, added }, opts);
  return { plan, w };
}
// The scorecard's Sharpe ratio for each construction on this analysis: the figures the Optimization tab prints.
const SCORE_ID = { ew: "ew", gmv: "gmv", tan: "tangency" };
function scorecardSharpes(a) {
  const ids = ["ew", "gmv", "tangency", "custom", ...ADDED_IDS, "bench"];
  const figs = columnFigures(a, customWeights(a, {}), null, ADDED_IDS);
  return Object.fromEntries(ids.map((id, k) => [id, figs[k].row ? figs[k].row.sharpe : null]));
}

const seen = { cells: 0, renders: 0, label: 0 };
const allText = [];
function holdChecks(name, root, a, w, added) {
  const score = w.convention === "flat" ? scorecardSharpes(a) : null;
  const rows = [...w.runs.map((r) => ({ key: r.id, label: L.labelOf(r.id), run: r })), ...(w.bench ? [{ key: "bench", label: a.benchLabel, run: null }] : [])];
  // In-sample beside out-of-sample.
  const t = readTable(tableBy(root, "In-sample and out-of-sample Sharpe ratios"));
  check(!!t && t.rows.length === rows.length && t.heads.join("|") === `Portfolio|${L.IN_SAMPLE_HEAD}|${L.OOS_HEAD}|${L.SE_HEAD}`,
    `${name}: the figures table has a row per construction${added ? ", the four added among them" : ""}, then the benchmark, under its four heads`,
    t ? `${t.rows.map((r) => r[0]).join(" | ")} / ${t.heads.join(" | ")}` : "no table");
  const bad = [];
  rows.forEach((r, i) => {
    const got = t?.rows[i] ?? [];
    const inSample = r.run
      ? (w.convention === "flat" ? score[SCORE_ID[r.key] ?? r.key] : r.run.inSample)
      : (w.convention === "flat" ? score.bench : w.bench.inSample);
    const oos = r.run ? r.run.sharpe : w.bench.sharpe;
    const se = oos === null ? null : r.run ? r.run.se : w.bench.se;
    const want = [r.label, format(inSample, "num3"), format(oos, "num3"), format(se, "num3")];
    seen.cells += 3;
    if (want.join("|") !== got.join("|")) bad.push(`${want.join(" ")} vs ${got.join(" ")}`);
    // At a flat rate the engine's own whole-window reading is the scorecard's figure; per period it is what prints.
    if (r.run && w.convention === "flat" && r.run.inSample !== null && Math.abs(r.run.inSample - inSample) > 1e-12) bad.push(`${r.key} engine in-sample ${r.run.inSample} vs scorecard ${inSample}`);
  });
  check(bad.length === 0, `${name}: every row's in-sample, out-of-sample and standard error is the engine's, formatted (in-sample at a flat rate the scorecard's)`, bad.slice(0, 3).join(" | "));
  // Hold by hold.
  const f = readTable(tableBy(root, "Each hold, and the Sharpe ratio it held"));
  const fb = [];
  w.folds.forEach((fold, k) => {
    const want = [`Hold ${k + 1}`, fold.fitFirst, fold.fitLast, format(fold.fitRate, "pct2"), fold.holdFirst, fold.holdLast, format(fold.bars, "int"),
      ...rows.map((r) => format(r.run ? r.run.foldSharpe[k] : w.bench.foldSharpe[k], "num3"))];
    seen.cells += want.length - 1;
    if (want.join("|") !== (f?.rows[k] ?? []).join("|")) fb.push(`${want.join(" ")} vs ${(f?.rows[k] ?? []).join(" ")}`);
  });
  check(!!f && f.rows.length === w.folds.length && fb.length === 0, `${name}: every hold's fit, rate, held days and each row's held Sharpe ratio are the engine's`, fb.slice(0, 2).join(" | ") || `${f?.rows.length} rows`);
  return rows;
}
function weightChecks(name, root, a, w, id) {
  const run = w.runs.find((r) => r.id === id);
  const choice = pill(root, "Weights of", L.labelOf(id));
  if (choice && choice.getAttribute("aria-checked") !== "true") click(choice);
  const t = readTable(tableBy(root, `Weights held in each hold: ${L.labelOf(id)}`));
  const bad = [];
  a.tickers.forEach((tk, i) => {
    const want = [tk, ...run.weights.map((wt) => format(wt ? wt[i] : null, "pct2"))];
    seen.cells += want.length - 1;
    if (want.join("|") !== (t?.rows[i] ?? []).join("|")) bad.push(`${want.join(" ")} vs ${(t?.rows[i] ?? []).join(" ")}`);
  });
  check(!!t && bad.length === 0, `${name}: the weights ${L.labelOf(id)} held in each hold are the engine's, per asset and hold`, bad.slice(0, 2).join(" | ") || (t ? "" : "no table"));
}
const segText = (root) => {
  const c = root.cloneNode(true);
  for (const cite of c.querySelectorAll("cite")) cite.remove();
  return c.textContent;
};

async function mount(a, rates, level = "plain") {
  const settings = settingsFor({ tickers: a.tickers, start: a.requested.start, end: a.requested.end, benchmark: a.benchmark }, { allowShort: a.allowShort });
  // Inside a Boundary, as the tab mounts it, so a segment that fails shows its named line instead of ending the suite.
  const r = await quietly(() => render(h(Boundary, { name: "Your basket", resetKey: a }, h(Live, { analysis: a, settings, level, rates }))));
  await quietly(flush);
  seen.renders += 1;
  return { r, root: r.container, settings };
}
const pill = (root, group, label) => [...root.querySelectorAll(`[role=radiogroup][aria-label="${group}"] [role=radio]`)].find((b) => text(b) === label);
const toggle = (root) => [...root.querySelectorAll("button[aria-pressed]")].find((b) => text(b) === ADDED_SWITCH);
const OPTS = [
  { fit: "expanding", hold: 252 },
  { fit: "rolling", hold: 252 },
  { fit: "rolling", hold: 126 },
  { fit: "expanding", hold: 126 },
];
const optLabel = (o) => `${o.fit}, ${o.hold}-return holds`;
async function setOptions(root, o) {
  await quietly(() => click(pill(root, "Fit on", L.FIT_OPTIONS.find((x) => x.value === o.fit).label)));
  await quietly(() => click(pill(root, "Hold for", L.HOLD_OPTIONS.find((x) => x.value === String(o.hold)).label)));
  await quietly(flush);
}
async function setAdded(root, on) {
  const b = toggle(root);
  if ((b.getAttribute("aria-pressed") === "true") !== on) await quietly(() => click(b));
  await quietly(flush);
}

// ---- 0. the steps the page solves in are walkForward(), field for field --------------------------------------

{
  const drain = (a, rates, opts, added) => {
    const g = L.walkSteps(a, L.ratePlan(a, rates), opts, added);
    let r = g.next();
    let n = 0;
    while (!r.done) {
      n += 1;
      r = g.next();
    }
    return { value: r.value, steps: n };
  };
  const cases = [];
  for (const o of [{ fit: "expanding", hold: 252 }, { fit: "rolling", hold: 126 }]) {
    for (const added of [false, true]) {
      for (const rates of [NONE, SERIES]) cases.push([`example, ${o.fit} ${o.hold}, added ${added}, ${rates.points ? "per period" : "flat"}`, exampleAnalysis(), rates, o, added]);
    }
  }
  cases.push(["sectors, shorting on, added", fixtureAnalysis("sectors", { allowShort: true }), NONE, { fit: "rolling", hold: 126 }, true]);
  cases.push(["cross, a failing tangency", fixtureAnalysis("cross", { allowShort: true, rf: 5 }), NONE, W.DEFAULT_WALK, true]);
  const bad = [];
  for (const [name, a, rates, o, added] of cases) {
    const { value, steps } = drain(a, rates, o, added);
    const want = W.walkForward({ cols: a.returns, dates: a.dates, bench: a.bench, rates: ratesOf(a, L.ratePlan(a, rates)), allowShort: a.allowShort, added }, o);
    if (JSON.stringify(value) !== JSON.stringify(want)) bad.push(name);
    if (value.ok && steps !== value.folds.length + 1) bad.push(`${name}: ${steps} steps for ${value.folds.length} folds`);
  }
  check(bad.length === 0 && cases.length === 10, "steps: the stepwise solve the page runs equals walkForward() field for field, one step per refit and one for the whole window", bad.join(" | "));
}

// ---- 1. the default cross-asset example, every option, the added constructions off and on -----------------

const EX = exampleAnalysis();
{
  const { r, root } = await mount(EX, NONE);
  check(!!pill(root, "Fit on", L.FIT_OPTIONS[0].label) && pill(root, "Fit on", L.FIT_OPTIONS[0].label).getAttribute("aria-checked") === "true" &&
    pill(root, "Hold for", L.HOLD_OPTIONS[0].label).getAttribute("aria-checked") === "true" && toggle(root)?.getAttribute("aria-pressed") === "false",
    "options: the segment opens on an expanding fit, 252-return holds, and the four added constructions off");
  check(root.querySelectorAll("[role=switch]").length === 0, "options: no option is a [role=switch] (the page's one switch is the shorting switch)");
  for (const added of [false, true]) {
    await setAdded(root, added);
    for (const o of OPTS) {
      await setOptions(root, o);
      const { w } = expected(EX, NONE, o, added);
      const name = `example, ${optLabel(o)}, added ${added ? "on" : "off"}`;
      holdChecks(name, root, EX, w, added);
      weightChecks(name, root, EX, w, "tan");
      allText.push(segText(root));
    }
  }
  // Each fitted construction's weights, the added ones included, on the last options set.
  const o = OPTS[OPTS.length - 1];
  const { w } = expected(EX, NONE, o, true);
  for (const id of ["gmv", "tan.1y", "tan.bs", "tan.cap", "rp"]) {
    weightChecks(`example, ${optLabel(o)}`, root, EX, w, id);
  }
  r.unmount();
}

// ---- 2. the mega-cap and sector fixtures, and shorting on -----------------------------------------------------

for (const [name, a] of [
  ["mega-caps", fixtureAnalysis("megacap")],
  ["sectors", fixtureAnalysis("sectors")],
  ["cross-asset, shorting on", fixtureAnalysis("cross", { allowShort: true })],
]) {
  const { r, root } = await mount(a, NONE);
  for (const added of [false, true]) {
    await setAdded(root, added);
    const { w } = expected(a, NONE, W.DEFAULT_WALK, added);
    holdChecks(`${name}, added ${added ? "on" : "off"}`, root, a, w, added);
    weightChecks(`${name}`, root, a, w, "gmv");
    allText.push(segText(root));
  }
  await setOptions(root, OPTS[2]);
  const { w } = expected(a, NONE, OPTS[2], true);
  holdChecks(`${name}, ${optLabel(OPTS[2])}, added on`, root, a, w, true);
  if (a.allowShort) {
    check(text(root.querySelector(".wfl-label")).endsWith("The published test was long-only; this run allows shorting."),
      "shorting: the label line says the published test was long-only and this run allows shorting", text(root.querySelector(".wfl-label")));
  }
  r.unmount();
}

// ---- 3. the three rate states: each prints its own label and its own figures ------------------------------------

{
  const asOf = longDay(EX.asOf);
  const then = longDay(PUB_LAST);
  const pubRf = format(PUB_RF, "pct1");
  const flatLine = (rate) => `Recomputed on prices through ${asOf} at a ${format(rate, "pct2")} risk-free rate; the published note used prices through ${then} at a ${pubRf} risk-free rate.`;
  const COULD_NOT = "The daily 3-month Treasury bill series could not be had for this window, so every refit and every held day uses that one rate.";
  const STATES = [
    ["the series held, a FRED basis", SERIES, `Recomputed on prices through ${asOf}, each refit and each held day at the 3-month Treasury bill rate of its time; the published note used prices through ${then} at a flat ${pubRf} risk-free rate.`, "per-period"],
    ["a rate typed in the rail", TYPED, flatLine(EX.rf), "flat"],
    ["no series", NONE, `${flatLine(EX.rf)}${COULD_NOT}`, "flat"],
    ["the series still loading", LOADING, `${flatLine(EX.rf)}The daily 3-month Treasury bill series is still loading, so every refit and every held day uses that one rate for now.`, "flat"],
    ["a series that starts after the window", { basis: "window", points: DGS.filter(([d]) => d >= "2020-01-01"), flat: null }, `${flatLine(EX.rf)}${COULD_NOT}`, "flat"],
  ];
  const figures = {};
  for (const [name, rates, line, convention] of STATES) {
    const { r, root } = await mount(EX, rates);
    const lab = root.querySelector(".wfl-label");
    const got = lab ? text(lab) : `(no label line: ${text(root)})`;
    check(got === line, `rates, ${name}: the label line, word for word`, `${got} // ${line}`);
    seen.label += 1;
    const { plan, w } = expected(EX, rates, W.DEFAULT_WALK, false);
    check(plan.kind === convention && w.convention === convention, `rates, ${name}: the run is ${convention}`, `${plan.kind} ${w.convention}`);
    holdChecks(`rates, ${name}`, root, EX, w, false);
    const fr = readTable(tableBy(root, "Each hold, and the Sharpe ratio it held")) ?? { heads: [], rows: [] };
    const rateCol = fr.heads.indexOf("Fit rate");
    const wantRates = w.folds.map((f) => format(convention === "per-period" ? W.rateOn(DGS, f.fitLast) : EX.rf, "pct2"));
    check(fr.rows.map((x) => x[rateCol]).join() === wantRates.join(), `rates, ${name}: each fit's rate is ${convention === "per-period" ? "the bill rate on the fit's last day" : "the one flat rate"}`, wantRates.join());
    figures[name] = (readTable(tableBy(root, "In-sample and out-of-sample Sharpe ratios"))?.rows ?? []).map((x) => x.join(" ")).join(" / ");
    if (convention === "per-period") {
      const sub = text(root.querySelector(".tbl thead th:nth-child(2) .tbl-sub") ?? { textContent: "" });
      check(sub === L.inSampleSub(w) && /each day at its own bill rate; the other tabs score it at one rate/.test(sub),
        "rates, per period: the in-sample head says it differs from the other tabs by the rate convention", sub);
    }
    allText.push(segText(root));
    r.unmount();
  }
  check(figures["the series held, a FRED basis"] !== figures["no series"], "rates: per period and flat print different figures on the same prices",
    `${figures["the series held, a FRED basis"]} // ${figures["no series"]}`);
  // A typed rate other than the analysis' own: the typed analysis is built at it, and the run follows it.
  const typed = exampleAnalysis({ rf: PUB_RF });
  const { r, root } = await mount({ ...typed, rfSource: "manual" }, TYPED);
  check(text(root.querySelector(".wfl-label")) === flatLine(PUB_RF), "rates, typed: a typed 2.0% prints its own label", text(root.querySelector(".wfl-label")));
  const { w } = expected(typed, TYPED, W.DEFAULT_WALK, false);
  check(w.inSampleRate === PUB_RF && w.folds.every((f) => f.fitRate === PUB_RF), "rates, typed: every fit and the in-sample column use the typed rate");
  r.unmount();
}

// ---- 4. the in-sample column against the Optimization tab -------------------------------------------------------

{
  const tl = tiles(EX);
  const { w } = expected(EX, NONE, W.DEFAULT_WALK, false);
  const rows = L.liveRows(EX, w);
  const byPort = { ew: "ew", gmv: "gmv", tan: "tangency" };
  const bad = rows.filter((r) => byPort[r.key]).filter((r) => format(r.inSample, "num3") !== format(tl.find((t) => t.id === byPort[r.key]).row?.sharpe ?? null, "num3"));
  check(bad.length === 0, "in-sample: at a flat rate the column prints the Optimization tab's Sharpe ratio for equal weight, GMV and tangency", bad.map((r) => r.key).join());
  check(format(rows.find((r) => r.key === "bench").inSample, "num3") === format(EX.benchStats.sharpe, "num3"), "in-sample: the benchmark's is the band's benchmark Sharpe ratio");
  const per = expected(EX, SERIES, W.DEFAULT_WALK, true).w;
  const perRows = L.liveRows(EX, per);
  check(perRows.every((r, i) => (i < per.runs.length ? r.inSample === per.runs[i].inSample : r.inSample === per.bench.inSample)),
    "in-sample: per period the column is the engine's whole-window reading under the daily rates");
}

// ---- 5. the cannot-run edge, and the solving state -----------------------------------------------------------------

{
  const p = examplePayload();
  const cutAt = (prices) => {
    const q = { ...p, dates: p.dates.slice(0, prices), prices: p.prices.map((c) => c.slice(0, prices)) };
    q.end = p.dates[prices];
    const a = analyze(q, settingsFor(q, { rf: ORACLE_RF }), { rate: ORACLE_RF, source: "example" });
    if (!a.ok) throw new Error(a.message);
    return a;
  };
  const need = W.FIRST_FIT + W.MIN_HOLD;
  const short = cutAt(need); // need prices = need - 1 returns
  const enough = cutAt(need + 1);
  check(short.dates.length === need - 1 && enough.dates.length === need, "edge: the two cut windows hold one return row either side of the edge", `${short.dates.length} ${enough.dates.length}`);
  let { r, root } = await mount(short, NONE);
  const want = `The walk-forward test cannot run on this window: it needs at least ${format(need, "int")} daily returns, ${format(W.FIRST_FIT, "int")} for the first fit and ${format(W.MIN_HOLD, "int")} for one hold, and this window has ${format(need - 1, "int")}.`;
  check(text(root) === want && !root.querySelector(".tbl, .wfl-options, svg, [role=radiogroup]"),
    `edge: at ${need - 1} returns the segment says it cannot run, why, and the count, and shows nothing else`, text(root));
  r.unmount();
  ({ r, root } = await mount(enough, NONE));
  const { w } = expected(enough, NONE, W.DEFAULT_WALK, false);
  check(w.folds.length === 1 && w.folds[0].bars === W.MIN_HOLD, "edge: at the edge the run has one hold of the fewest days a hold's figure is printed from");
  holdChecks(`edge, ${need} returns`, root, enough, w, false);
  check(readTable(tableBy(root, "Each hold, and the Sharpe ratio it held")).rows[0].slice(7).every((x) => x !== "–"), "edge: that one hold prints its own figures");
  r.unmount();

  // Before the run lands: the label and the options are there, the figures say they are being solved.
  const before = L.SOLVES.count;
  const fresh = exampleAnalysis();
  const settings = settingsFor({ tickers: fresh.tickers, start: fresh.requested.start, end: fresh.requested.end, benchmark: fresh.benchmark });
  const pr = await quietly(() => render(h(Live, { analysis: fresh, settings, level: "plain", rates: NONE })));
  const busy = pr.container.querySelector(".wfl-results[aria-busy=true] [role=status]");
  check(!!busy && /^Solving the test/.test(text(busy)) && !pr.container.querySelector(".tbl") && !!pr.container.querySelector(".wfl-label") && L.SOLVES.count === before,
    "solving: before the run lands the figures are marked busy and say so, nothing is solved inside the render, and the label is already up", busy ? text(busy) : "no status");
  await quietly(flush);
  check(L.SOLVES.count === before + 1 && !!pr.container.querySelector(".tbl") && !pr.container.querySelector("[aria-busy=true]"),
    "solving: after paint the run is solved once and lands", `${L.SOLVES.count - before}`);
  // A repaint (a new explanation level) does not solve again; an option change does; an option seen before does not.
  let n = L.SOLVES.count;
  await quietly(() => act(() => pr.rerender(h(Live, { analysis: fresh, settings, level: "formula", rates: NONE }))));
  await quietly(flush);
  check(L.SOLVES.count === n, "solving: an explanation level repaints without solving again", `${L.SOLVES.count - n}`);
  await setOptions(pr.container, OPTS[1]);
  check(L.SOLVES.count === n + 1, "solving: an option change solves once", `${L.SOLVES.count - n}`);
  n = L.SOLVES.count;
  await setOptions(pr.container, OPTS[0]);
  check(L.SOLVES.count === n, "solving: back to options already solved, nothing is solved again", `${L.SOLVES.count - n}`);
  await setAdded(pr.container, true);
  n = L.SOLVES.count;
  await setAdded(pr.container, false);
  check(L.SOLVES.count === n, "solving: switching the added constructions off reads the run that has them", `${L.SOLVES.count - n}`);
  pr.unmount();
}

// ---- 6. a failing fold and an unavailable construction, named ------------------------------------------------------

{
  const a = fixtureAnalysis("cross", { allowShort: true, rf: 5 });
  const { r, root } = await mount(a, NONE);
  const { w } = expected(a, NONE, W.DEFAULT_WALK, false);
  const tan = w.runs.find((x) => x.id === "tan");
  check(tan.failed.length > 0 && tan.sharpe === null, "failing: at a 500% rate with shorting the tangency finds no weights in some hold", tan.failed.join());
  const holds = tan.failed.map((k) => `hold ${k + 1} (fitted through ${w.folds[k].fitLast})`);
  const list = holds.length > 1 ? `${holds.slice(0, -1).join(", ")} and ${holds.at(-1)}` : holds[0];
  const want = `${L.labelOf("tan")} has no out-of-sample figure: its solve found no weights in ${list}.`;
  const notes = [...root.querySelectorAll(".wfl-note--missing")].map(text);
  check(notes.includes(want), "failing: the construction is named with every hold its solve failed in", notes.join(" | "));
  const row = readTable(tableBy(root, "In-sample and out-of-sample Sharpe ratios")).rows.find((x) => x[0] === L.labelOf("tan"));
  check(row && row[2] === "–" && row[3] === "–", "failing: its out-of-sample figure and error are dashes, never a stand-in portfolio", row?.join(" "));
  holdChecks("failing", root, a, w, false);
  allText.push(segText(root));
  r.unmount();

  // Four assets: the capped tangency cannot be had in any hold.
  const p = examplePayload();
  const keep = [0, 1, 2, 3, p.columns.length - 1];
  const q = { ...p, tickers: p.tickers.slice(0, 4), columns: keep.map((j) => p.columns[j]), prices: keep.map((j) => p.prices[j]) };
  const four = analyze(q, settingsFor(q, { rf: ORACLE_RF }), { rate: ORACLE_RF, source: "example" });
  check(four.ok && four.tickers.length === 4, "unavailable: a four-asset basket builds", four.ok ? four.tickers.join() : four.message);
  const m = await mount(four, NONE);
  await setAdded(m.root, true);
  const fw = expected(four, NONE, W.DEFAULT_WALK, true).w;
  const capNote = `${L.labelOf("tan.cap")} has no out-of-sample figure: in every hold, it needs at least ${CAP_MIN_ASSETS} assets and this basket has 4.`;
  check(fw.runs.find((x) => x.id === "tan.cap").unavailable.every((u) => u === "too-few-assets") && [...m.root.querySelectorAll(".wfl-note--missing")].map(text).includes(capNote),
    "unavailable: the capped tangency is named with its reason in every hold", [...m.root.querySelectorAll(".wfl-note--missing")].map(text).join(" | "));
  holdChecks("four assets, added on", m.root, four, fw, true);
  m.r.unmount();
}

// ---- 7. the sentences: the standard error, the decay, the yardstick, the one citation -------------------------------

{
  const { r, root } = await mount(EX, NONE);
  await setAdded(root, true);
  const { w } = expected(EX, NONE, W.DEFAULT_WALK, true);
  const ses = [...w.runs.filter((x) => x.sharpe !== null).map((x) => x.se), w.bench.se];
  const x = ses.reduce((s, v) => s + v, 0) / ses.length;
  const want = `With ${w.folds.length} holds, ${format(w.heldRows, "int")} held days in all, each out-of-sample Sharpe ratio above carries about ±${format(x, "num3")} (one standard error), so a gap smaller than about two of them, ${format(2 * x, "num3")}, is not evidence either way.`;
  const notes = [...root.querySelectorAll(".wfl-note")].map(text);
  check(notes.includes(want), "sentence: the standard error sentence, its values read from the run", notes.find((n) => n.startsWith("With")) ?? "(none)");
  const tan = w.runs.find((q) => q.id === "tan");
  const inS = scorecardSharpes(EX).tangency;
  check(text(root.querySelector(".wfl-finding")) === `What the window promised against what the held-out days paid: maximum Sharpe scored ${format(inS, "num3")} on the whole window it was fitted to, held-out years included, and ${format(tan.sharpe, "num3")} on days its weights had not seen.`,
    "sentence: the decay line names what the window promised and what the held-out days paid", text(root.querySelector(".wfl-finding")));
  check(notes.some((n) => /^Equal weight and the benchmark fit nothing, so the gap between their two columns comes from the period alone/.test(n)),
    "sentence: equal weight's and the benchmark's gap is the period alone, the yardstick for the fitted rows");
  const all = root.textContent;
  check((all.match(/DeMiguel/g) ?? []).length === 1 && root.querySelectorAll("cite").length === 1 && text(root.querySelector("cite")) === L.CITE_TITLE,
    "sentence: DeMiguel, Garlappi and Uppal (2009) is cited once, by authors, year and title");
  check(!/\d\.\d+/.test(text(root.querySelector(".wfl-cite"))), "sentence: the citation carries no figure from the paper", text(root.querySelector(".wfl-cite")));
  // The dumbbells: one per row, both values printed, and every row drawn the same way.
  const bells = [...root.querySelectorAll("li.wfl-bell")];
  const rows = L.liveRows(EX, w);
  check(bells.length === rows.length && bells.every((b, i) => text(b.querySelector(".wfl-bell-values")) === `${format(rows[i].inSample, "num3")} to ${format(rows[i].oos, "num3")}`),
    "dumbbell: one per row, each printing its in-sample and out-of-sample figures", bells.map((b) => text(b)).join(" | "));
  check(bells.every((b) => b.className === bells[0].className && b.querySelectorAll("circle.wfl-bell-in").length <= 1 && b.querySelectorAll("circle.wfl-bell-out").length <= 1) &&
    root.querySelectorAll(".wfl-bell-list circle.wfl-bell-in").length === rows.filter((q) => q.inSample !== null).length,
    "dumbbell: every row is drawn alike, a hollow dot in-sample and a filled one out-of-sample");
  allText.push(segText(root));
  r.unmount();
}

// ---- 8. inside the tab, on the page's own wiring ------------------------------------------------------------------

{
  const settings = settingsFor(examplePayload(), { rf: EX.rf });
  const r = await quietly(() => render(h(WalkForward, { analysis: EX, settings, level: "plain", weights: {}, setWeights() {}, requestSettings() {} })));
  await quietly(flush);
  check(!!r.container.querySelector('[data-segment="basket"] .tbl'), "tab: the tab opens on Your basket and its figures land", text(r.container).slice(0, 120));
  allText.push(segText(r.container));
  r.unmount();
}

// ---- 9. the words: nothing crowned, nothing set apart ---------------------------------------------------------------

{
  const BANNED = /\b(best|optimal|winners?|race|contenders?|outperform\w*)\b/i;
  const hits = allText.flatMap((t, i) => (BANNED.test(t) ? [`render ${i}: ${t.match(BANNED)[0]}`] : []));
  check(allText.length >= 20 && hits.length === 0, "words: no render of the segment says best, optimal, winner, race, contender or outperform (outside the cited title)", hits.slice(0, 3).join(" | ") || `${allText.length} renders`);
  const tips = ["wf_oos", "wf_se", "wf_fit", "wf_hold", "wf_added"].flatMap((k) => Object.values(SCORE_TIPS[k]));
  check(tips.length === 15 && tips.every((t) => !BANNED.test(t) && !/better|beats?|wins?\b/i.test(t)), "words: the segment's five tooltips, at every level, claim no construction does better");
  // No row set apart: render the busiest state and look at every row and mark.
  const { r, root } = await mount(fixtureAnalysis("sectors"), NONE);
  await setAdded(root, true);
  const trs = [...root.querySelectorAll("tbody tr")];
  check(trs.length > 0 && trs.every((tr) => !tr.className && !tr.hasAttribute("style") && !tr.hasAttribute("aria-current")) &&
    !root.querySelector("mark, strong, b, [data-highlight], [style*=color], [style*=background]"),
    "highlight: no row and no figure is marked, coloured or emphasised apart from the others", `${trs.length} rows`);
  r.unmount();
}

check(seen.cells > 1500 && seen.renders >= 12 && seen.label >= 5, "coverage: the suite read the segment's figures across its renders", JSON.stringify(seen));
done("t-tab-walkforward");
