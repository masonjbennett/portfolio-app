// The walk-forward tab's "As published" segment: its data, src/content/walkforward.ts, and what it prints.
//
// The chain this suite holds, link by link:
//   1. the module is exactly what test/oracle/walkforward_module.mjs writes from test/fixtures/walkforward.json
//      (byte for byte), and carries the fixture's own numbers (deep-equal, field by field);
//   2. published.ts's AGG and Apple strings are the fixture's published fields;
//   3. the engine (src/lib/walkforward.ts) replaying the module's stored weights on the frozen price fixtures,
//      cut at the run's last bar, gives the module's own fold and joined Sharpe ratios within 1e-9 and prints
//      the published strings exactly, on the schedule the module states;
//   4. the view prints the published strings exactly as published.ts holds them and every other figure as the
//      module's value formatted, names in its solver note exactly the figures the exact solve prints
//      differently, reruns each set with its own tickers, fetches nothing, and links the method note once;
//   5. the chart of the nine pairs: each set and construction's whole-window figure (the module's, replayed in 3
//      from the fixture's stored whole-window weights; 1.107 quoted) against its published string, on one axis.
// Nothing here is typed from a published source: each expected value is read from published.ts, the fixture or
// the module, and compared as the page prints it.
import { readFileSync } from "node:fs";
import { check, done, json } from "./_assert.mjs";
import { act, render, text } from "./_dom.mjs";

const { createElement: h } = await import("react");
const { build } = await import("./oracle/walkforward_module.mjs");
const M = await import("../src/content/walkforward.ts");
const P = await import("../src/content/published.ts");
const W = await import("../src/lib/walkforward.ts");
const { computeReturns, column } = await import("../src/lib/clean.ts");
const { portfolioReturns } = await import("../src/lib/portfolio.ts");
const { annualizedStats } = await import("../src/lib/stats.ts");
const { bellDomain, bellTicks } = await import("../src/tabs/walkforward/Dumbbell.tsx");
const { format } = await import("../src/format.ts");
const View = await import("../src/tabs/walkforward/Published.tsx");
const { PAIR_HEADING, RERUN_START } = await import("../src/tabs/walkforward/terms.ts");

const WF = json(new URL("./fixtures/walkforward.json", import.meta.url));
const MODULE = new URL("../src/content/walkforward.ts", import.meta.url);
const VIEW = new URL("../src/tabs/walkforward/Published.tsx", import.meta.url);
const PRICES = { megacap5: "megacap5", sectors7: "sectors", cross: "cross" };
const KEYS = ["ew", "gmv", "tan"];
const FIELD = { ew: "ew", gmv: "gmv", tan: "tangency" }; // module key -> published.ts field
// How the view names each construction, as the table of the nine heads its columns.
const LABEL_OF = { ew: "Equal weight", gmv: "Minimum variance (GMV)", tan: "Maximum Sharpe (Tangency)" };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const gap = (a, b) => (a.length === b.length ? Math.max(0, ...a.map((x, i) => Math.abs(x - b[i]))) : Infinity);
// A set with no published counterpart reads as an empty one, so every check on it fails by name instead of throwing.
const NONE = { name: "(no published set)", tickers: [], ew: null, gmv: null, tangency: null };
const pubFor = (tickers) => P.PUBLISHED_SETS.find((p) => same([...p.tickers], [...tickers])) ?? NONE;

// ---- 1. the module is the generator's output, and the fixture's numbers ---------------------------------

check(build() === readFileSync(MODULE, "utf8"), "module: the generator, run again, writes the committed module byte for byte");

check(same(M.WALK_RUNS.map((r) => r.key), Object.keys(WF.sets)), "module: one run per set in the fixture, in its order", M.WALK_RUNS.map((r) => r.key).join(" "));
check(M.WALK_RF === WF.rf, "module: the run's rate is the fixture's", String(M.WALK_RF));
for (const run of M.WALK_RUNS) {
  const e = WF.sets[run.key];
  check(same(run.tickers, e.tickers) && run.firstBar === e.first_bar && run.lastBar === e.last_bar,
    `module ${run.key}: tickers, first and last bar are the fixture's`);
  check(same(run.folds.map((f) => ({ fit_last: f.fitLast, hold_first: f.holdFirst, hold_last: f.holdLast })), e.folds),
    `module ${run.key}: every fold's fit end, hold start and hold end are the fixture's`);
  check(same(run.ship.weights, e.ship.weights), `module ${run.key}: the stored weights deep-equal the fixture's`);
  check(same(run.ship.foldSharpe, e.ship.fold_sharpe), `module ${run.key}: the fold Sharpe ratios deep-equal the fixture's`);
  check(same(run.ship.sharpe, e.ship.sharpe), `module ${run.key}: the joined Sharpe ratios deep-equal the fixture's`);
  check(same(run.tight.sharpe, e.tight.sharpe), `module ${run.key}: the exact solve's joined Sharpe ratios deep-equal the fixture's`);
  check(same(run.wholeWindow, { ship: e.whole_window?.ship?.sharpe, tight: e.whole_window?.tight?.sharpe }),
    `module ${run.key}: the whole-window figures, both solvers, deep-equal the fixture's`);
  for (const o of ["ship", "tight"])
    check(KEYS.every((k) => e.whole_window?.[o]?.prints?.[k] === format(e.whole_window[o].sharpe[k], "num3")),
      `fixture ${run.key}: the whole-window prints (${o}) are its figures at three decimals`, JSON.stringify(e.whole_window?.[o]?.prints));
  // The whole-window block was added after the run was written, so it records the libraries that wrote it.
  const v = e.whole_window?.versions;
  check(!!v && ["python", "numpy", "scipy", "pandas"].every((x) => /^\d+\.\d+(\.\d+)?$/.test(v[x] ?? "")) && same(Object.keys(e.whole_window), ["ship", "tight", "versions"]),
    `fixture ${run.key}: the whole-window block says which Python, numpy, scipy and pandas wrote it`, JSON.stringify(v));
}
const mega = WF.sets.megacap5;
const cross = WF.sets.cross;
check(M.WALK_TANGENCY_IN_SAMPLE === mega.ship.in_sample_tangency, "module: the whole-window tangency is the fixture's");
check(M.WALK_RUNS.find((run) => run.key === "megacap5")?.wholeWindow.ship.tan === M.WALK_TANGENCY_IN_SAMPLE &&
  mega.whole_window?.tight?.sharpe?.tan === mega.tight.in_sample_tangency,
  "module: the mega-caps' whole-window maximum Sharpe is the in-sample tangency 1.107 rounds, under both solvers");
check(same(M.WALK_APPLE, mega.sensitivity_apple.windows.map((w) => ({ label: w.label, rows: w.bars, weight: w.tangency_aapl }))),
  "module: the Apple lookbacks, their lengths and weights are the fixture's");
check(M.WALK_AGG.weight === cross.ship.gmv_agg_into_2022 && cross.ship.weights.gmv[M.WALK_AGG.fold][cross.tickers.indexOf(M.WALK_AGG.ticker)] === M.WALK_AGG.weight &&
  cross.folds[M.WALK_AGG.fold].hold_first.startsWith("2022-01"),
  "module: the AGG weight is the cross-asset minimum-variance weight of the hold that began in January 2022");

// ---- 2. published.ts's added strings are the fixture's published fields ---------------------------------

check(P.CROSS_AGG_INTO_2022 === cross.published_agg_into_2022, "published: the AGG string is the fixture's", P.CROSS_AGG_INTO_2022);
check(same(P.MEGA_CAP_APPLE, mega.sensitivity_apple.published), "published: the five Apple strings are the fixture's", JSON.stringify(P.MEGA_CAP_APPLE));
check(P.MEGA_CAP_IN_SAMPLE === mega.published_in_sample, "published: 1.107 is the fixture's", P.MEGA_CAP_IN_SAMPLE);
// The band prints 1.107's window end and rate from published.ts, so the page's first chunk never loads the record.
const megaRun = M.WALK_RUNS.find((run) => run.key === "megacap5");
check(P.MEGA_CAP_IN_SAMPLE_END === megaRun?.lastBar && P.MEGA_CAP_IN_SAMPLE_END === mega.last_bar && P.MEGA_CAP_IN_SAMPLE_RF === M.WALK_RF,
  "published: 1.107's window end and rate are the run's last bar and rate", `${P.MEGA_CAP_IN_SAMPLE_END} ${P.MEGA_CAP_IN_SAMPLE_RF}`);
for (const run of M.WALK_RUNS) {
  const pub = pubFor(run.tickers);
  check(pub !== NONE && KEYS.every((k) => pub[FIELD[k]] === WF.sets[run.key].published[k]), `published ${run.key}: the three strings are the fixture's`);
}

// ---- 3. the engine's replay of the module's weights on the frozen prices --------------------------------

// The run's frame: the first bar on or after the run's first through its last, returns computed once on it.
function frame(run) {
  const px = json(new URL(`./fixtures/prices-${PRICES[run.key]}.json`, import.meta.url));
  const rows = px.rows.filter((r) => r[0] >= run.firstBar && r[0] <= run.lastBar);
  const values = run.tickers.map((t) => rows.map((r) => r[px.columns.indexOf(t) + 1]));
  const ret = computeReturns({ dates: rows.map((r) => r[0]), columns: [...run.tickers], values });
  return { dates: ret.dates, cols: run.tickers.map((t) => column(ret, t)) };
}

let worstFold = 0;
let worstJoined = 0;
for (const run of M.WALK_RUNS) {
  const d = frame(run);
  check(d.cols.every((c) => c.every(Number.isFinite)), `replay ${run.key}: the frozen frame has no gaps`);
  const plan = W.schedule(d.dates.length, W.DEFAULT_WALK);
  const stated = plan.ok
    ? plan.folds.map((f) => ({ fitFirst: d.dates[f.fitFrom], fitLast: d.dates[f.fitTo - 1], fitRows: f.fitTo - f.fitFrom, holdFirst: d.dates[f.holdFrom], holdLast: d.dates[f.holdTo - 1], rows: f.holdTo - f.holdFrom }))
    : null;
  check(same(stated, run.folds), `replay ${run.key}: the module's schedule (dates and counts) is the engine's on the frozen prices`, JSON.stringify(stated?.at(-1)));
  if (!plan.ok) continue;
  const pub = pubFor(run.tickers);
  for (const k of KEYS) {
    const rep = W.replay(d.cols, plan.folds, run.ship.weights[k], M.WALK_RF);
    const g = gap(rep.folds.map((f) => f.sharpe), run.ship.foldSharpe[k]);
    const j = Math.abs(rep.sharpe - run.ship.sharpe[k]);
    worstFold = Math.max(worstFold, g);
    worstJoined = Math.max(worstJoined, j);
    check(g <= 1e-9, `replay ${run.key} ${k}: the fold Sharpe ratios the page prints are the engine's within 1e-9`, `gap ${g}`);
    check(j <= 1e-9, `replay ${run.key} ${k}: the joined Sharpe ratio is the engine's within 1e-9`, `gap ${j}`);
    check(format(rep.sharpe, "num3") === pub[FIELD[k]], `replay ${run.key} ${k}: prints the published ${pub[FIELD[k]]}`, format(rep.sharpe, "num3"));
  }
}
console.log(`  replay of the module's weights: fold Sharpe gap ${worstFold.toExponential(2)}, joined ${worstJoined.toExponential(2)}`);

// The whole window: the fixture's stored whole-window weights, scored by the engine on every return of the frozen
// frame at the run's rate, give the module's whole-window figures, under both solvers.
let worstWhole = 0;
for (const run of M.WALK_RUNS) {
  const d = frame(run);
  const e = WF.sets[run.key].whole_window;
  for (const o of ["ship", "tight"])
    for (const k of KEYS) {
      const w = e?.[o]?.weights?.[k];
      const got = Array.isArray(w) && w.length === run.tickers.length ? annualizedStats(portfolioReturns(d.cols, w), M.WALK_RF).sharpe : NaN;
      const g = Math.abs(got - run.wholeWindow[o][k]);
      worstWhole = Math.max(worstWhole, g);
      check(g <= 1e-9, `replay ${run.key} ${k} (${o}): the whole-window figure is the engine's score of the stored whole-window weights within 1e-9`, `gap ${g}`);
    }
  check(same(e?.ship?.weights?.ew, run.tickers.map(() => 1 / run.tickers.length)), `replay ${run.key}: the whole window's equal weights are 1/N`);
}
console.log(`  replay of the whole-window weights: gap ${worstWhole.toExponential(2)}`);
check(format(M.WALK_TANGENCY_IN_SAMPLE, "num3") === P.MEGA_CAP_IN_SAMPLE, `module: the whole-window tangency prints ${P.MEGA_CAP_IN_SAMPLE}`);
check(format(M.WALK_AGG.weight, "pct1") === P.CROSS_AGG_INTO_2022, `module: the AGG weight prints ${P.CROSS_AGG_INTO_2022}`);
check(same(M.WALK_APPLE.map((w) => format(w.weight, "pct1")), P.MEGA_CAP_APPLE), "module: the Apple weights print the published five");

// ---- 4. the view ----------------------------------------------------------------------------------------

const calls = [];
const fetched = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  fetched.push(String(args[0]));
  return Promise.reject(new Error("the published segment fetches nothing"));
};
let r;
try {
  r = render(h(View.default, { level: "plain", rerun: (tickers) => calls.push([...tickers]) }));
} finally {
  globalThis.fetch = realFetch;
}
const found = r.container.querySelector("[data-segment=published]");
check(!!found, "view: the segment's root says it is the published one");
const root = found ?? r.container;

const tables = [...r.container.querySelectorAll(".tbl")];
const byTitle = (t) => tables.find((x) => text(x.querySelector(".tbl-title") ?? {}) === t) ?? null;
// A table's body as text: one array of cell texts per row, the row label's sub-line left out.
function cells(tbl) {
  return [...(tbl?.querySelectorAll("tbody tr") ?? [])].map((tr) =>
    [...tr.children].map((c) => text(stripSub(c))));
}
function stripSub(c) {
  const copy = c.cloneNode(true);
  for (const s of copy.querySelectorAll(".tbl-sub")) s.remove();
  return copy;
}
const heads = (tbl) => [...(tbl?.querySelectorAll("thead th") ?? [])].map((th) => text(stripSub(th)));

// The nine, quoted.
const nine = byTitle("Out-of-sample Sharpe ratios, as published");
check(same(cells(nine), P.PUBLISHED_SETS.map((p) => [p.name, p.tickers.join(" "), p.ew, p.gmv, p.tangency])),
  "view: the nine print exactly as published.ts holds them, three sets by three constructions", JSON.stringify(cells(nine)));
check(same(heads(nine), ["Set", "Tickers", "Equal weight", "Minimum variance (GMV)", "Maximum Sharpe (Tangency)"]),
  "view: the nine's columns are the three constructions, named as Your basket names them", heads(nine).join("|"));

// 1.107 and its out-of-sample figure, quoted.
const megaPub = pubFor(WF.sets.megacap5.tickers); // 1.107 is the mega-caps' own figure, whatever order the runs are in
const decay = [...r.container.querySelectorAll(".wfp-decay-figure")].map(text);
check(same(decay, [P.MEGA_CAP_IN_SAMPLE, megaPub.tangency]), "view: the decay prints the published in-sample and out-of-sample figures", decay.join(" "));
const decayText = text(r.container.querySelector(".wfp-decay") ?? {});
check(/whole window/.test(decayText) && /held-out years included/.test(decayText),
  "view: the in-sample figure says it was fitted on the whole window, held-out years included", decayText);

// Per set: each hold's dates, counts and Sharpe ratios, and the weights held, all formatted from the module.
const expectFolds = (run) => run.folds.map((f, i) => [`Hold ${i + 1}`, format(f.fitRows, "int"),
  format(f.holdFirst, "date"), format(f.holdLast, "date"), format(f.rows, "int"), ...KEYS.map((k) => format(run.ship.foldSharpe[k][i], "num3"))]);
for (const run of M.WALK_RUNS) {
  const pub = pubFor(run.tickers);
  const folds = byTitle(`${pub.name}: each hold`);
  check(same(cells(folds), expectFolds(run)), `view ${run.key}: the fold table is the module's schedule and fold Sharpe ratios, formatted`, JSON.stringify(cells(folds)[0]));
  for (const [k, word] of [["gmv", "minimum-variance"], ["tan", "maximum-Sharpe"]]) {
    const tbl = byTitle(`${pub.name}: ${word} weights`);
    const want = run.folds.map((f, i) => [`Hold ${i + 1}`, format(f.fitLast, "date"), ...run.tickers.map((t, j) =>
      run.key === "cross" && k === "gmv" && i === M.WALK_AGG.fold && t === M.WALK_AGG.ticker ? P.CROSS_AGG_INTO_2022 : format(run.ship.weights[k][i][j], "pct1"))]);
    check(same(cells(tbl), want), `view ${run.key}: the ${word} weights are the module's, formatted`, JSON.stringify(cells(tbl)[0]));
    check(same(heads(tbl).slice(2), [...run.tickers]), `view ${run.key}: the ${word} weights carry one column per ticker`);
  }
}
const aggCell = cells(byTitle(`${pubFor(cross.tickers).name}: minimum-variance weights`))[M.WALK_AGG.fold]?.[2 + cross.tickers.indexOf(M.WALK_AGG.ticker)];
check(aggCell === P.CROSS_AGG_INTO_2022, `view: the cross-asset AGG weight of the hold from January 2022 reads ${P.CROSS_AGG_INTO_2022}`, aggCell);
// The sentence that says which weight that is: its hold, the hold's first day and the year it went into, word for
// word, right under the minimum-variance table it reads from. The year is the one the record's published field
// is named for, so a sentence built from the wrong day of the hold goes red.
{
  const fold = M.WALK_RUNS.find((run) => run.key === "cross")?.folds[M.WALK_AGG.fold] ?? { holdFirst: "(no such hold)" };
  const year = JSON.stringify(WF.sets.cross).match(/"published_agg_into_(\d{4})"/)?.[1];
  const sentence = `The ${M.WALK_AGG.ticker} weight in hold ${format(M.WALK_AGG.fold + 1, "int")} of the minimum-variance table above, held from ${format(fold.holdFirst, "date")}, ` +
    `is the figure the published note gives for the minimum-variance portfolio going into ${fold.holdFirst.slice(0, 4)}.`;
  const aggNote = r.container.querySelector('[data-note="agg"]');
  const above = aggNote?.previousElementSibling;
  check(!!aggNote && text(aggNote) === sentence && fold.holdFirst.slice(0, 4) === year && !!above && text(above.querySelector(".tbl-title") ?? {}) === `${pubFor(cross.tickers).name}: minimum-variance weights`,
    "view: the AGG sentence names its hold, the hold's first day and the year it went into, under the minimum-variance table", `${aggNote ? text(aggNote) : "(none)"} / ${year}`);
}
const apple = byTitle("Maximum-Sharpe weight in AAPL by lookback, as published");
check(same(cells(apple), M.WALK_APPLE.map((w, i) => [w.label, format(w.rows, "int"), P.MEGA_CAP_APPLE[i]])),
  "view: the Apple weights print exactly as published.ts holds them, beside the module's lookbacks", JSON.stringify(cells(apple)));

// The solver note: exactly the figures an exact solve prints differently, by the oracle's own prints.
const want = M.WALK_RUNS.flatMap((run) => KEYS.filter((k) => WF.sets[run.key].tight.prints[k] !== WF.sets[run.key].published[k])
  .map((k) => `${pubFor(run.tickers).name}|${{ ew: "Equal weight", gmv: "Minimum variance (GMV)", tan: "Maximum Sharpe (Tangency)" }[k]}`));
const named = [...r.container.querySelectorAll("[data-note=solver] [data-differs]")].map((s) => s.getAttribute("data-differs"));
check(want.length > 0 && same(named, want), "view: the solver note names exactly the figures the exact solve prints differently", `${named.join(", ")} / ${want.join(", ")}`);
const note = text(r.container.querySelector("[data-note=solver]") ?? {});
const exactPrinted = M.WALK_RUNS.flatMap((run) => KEYS.filter((k) => WF.sets[run.key].tight.prints[k] !== WF.sets[run.key].published[k])
  .map((k) => [format(run.tight.sharpe[k], "num3"), WF.sets[run.key].tight.prints[k], pubFor(run.tickers)[FIELD[k]]]));
check(exactPrinted.every(([fmt, oracle, pub]) => fmt === oracle && note.includes(`${fmt} where the note prints ${pub}`)) &&
  note.includes(`${format(want.length, "int")} of the ${format(KEYS.length * M.WALK_RUNS.length, "int")} figures`),
  "view: the solver note prints each exact figure formatted from the module, beside the published one", note);

// Every figure in the prose is one the module or published.ts gives: nothing typed.
const allowed = new Set([P.MEGA_CAP_IN_SAMPLE, P.CROSS_AGG_INTO_2022, ...P.MEGA_CAP_APPLE, P.PUBLISHED_WHEN.split(" ").at(-1),
  ...P.PUBLISHED_SETS.flatMap((p) => [p.ew, p.gmv, p.tangency]), format(M.WALK_RF, "pct1"), format(M.WALK_APPLE.length, "int"),
  format(want.length, "int"), format(KEYS.length * M.WALK_RUNS.length, "int"), format(M.WALK_AGG.fold + 1, "int"), RERUN_START,
  format(View.wholeDiffers().length, "int"),
  ...M.WALK_RUNS.flatMap((run) => KEYS.flatMap((k) => [format(run.wholeWindow.ship[k], "num3"), format(run.wholeWindow.tight[k], "num3")])),
  ...M.WALK_RUNS.flatMap((run) => [run.firstBar, run.lastBar, format(run.folds.length, "int"), ...KEYS.map((k) => format(run.tight.sharpe[k], "num3")),
    ...run.folds.flatMap((f) => [f.fitFirst, f.fitLast, f.holdFirst, f.holdLast, f.holdFirst.slice(0, 4), format(f.fitRows, "int"), format(f.rows, "int")])])]);
const prose = root.cloneNode(true);
for (const t of prose.querySelectorAll(".tbl, .wfl-bells")) t.remove();
const figures = text(prose).match(/\d{4}-\d\d-\d\d|[−-]?\d+(?:,\d{3})*(?:\.\d+)?%?/g) ?? [];
const stray = figures.filter((x) => !allowed.has(x));
check(figures.length > 0 && stray.length === 0, "view: every figure in the prose is read from the module or quoted from published.ts", stray.join(" "));
const conv = text(prose);
const f0 = M.WALK_RUNS[0].folds[0];
const fl = M.WALK_RUNS[0].folds.at(-1);
check([format(f0.fitRows, "int"), f0.fitFirst, f0.fitLast, format(f0.rows, "int"), format(M.WALK_RUNS[0].folds.length, "int"), format(fl.rows, "int"), fl.holdFirst, fl.holdLast, format(M.WALK_RF, "pct1")]
  .every((x) => conv.includes(x)) && M.WALK_RUNS.every((run) => same(run.folds, M.WALK_RUNS[0].folds)),
  "view: the convention states the first fit, the hold length, the count of holds, the partial last hold and the rate, from the module (one schedule for all three sets)");
check(conv.includes("These are the weights the app's own solver fitted at the time."), "view: it says the weights are the ones the app's own solver fitted at the time");
check(conv.includes(`with prices from ${RERUN_START} through ${M.WALK_RUNS[0].lastBar}, a typed ${format(M.WALK_RF, "pct1")} risk-free rate`),
  "view: the rerun paragraph gives the rerun's first and last day and its rate", conv.match(/Each set's button[^.]*\./)?.[0] ?? "(none)");

// The rerun buttons: one per set, each with that set's tickers.
const buttons = [...r.container.querySelectorAll(".wfp-rerun-button")];
for (const b of buttons) act(() => b.click());
check(buttons.length === M.WALK_RUNS.length && buttons.every((b) => text(b) === "Rerun this set on fresh prices") &&
  same(calls, M.WALK_RUNS.map((run) => [...run.tickers])) && same(calls, P.PUBLISHED_SETS.map((p) => [...p.tickers])),
  "view: each set's rerun button asks for that set's tickers", JSON.stringify(calls));

// Nothing fetched, no price module, no solver.
const source = readFileSync(VIEW, "utf8");
const imports = [...source.matchAll(/^import[^"]*"([^"]+)"/gm)].map((m) => m[1]);
check(fetched.length === 0 && !/\bfetch\s*\(/.test(source) && imports.every((s) => !/\/(data|lib|state)\//.test(s)),
  "view: it fetches nothing and imports no price, solver or state module", `${fetched.join(" ")} | ${imports.join(" ")}`);

// Plain words, and no figure singled out.
const BANNED = /\b(best|optimal|winners?|race|contenders?|outperform\w*)\b/i;
check(!BANNED.test(text(root)), "view: none of the words best, optimal, winner, race, contender, outperform", text(root).match(BANNED)?.[0] ?? "");
const css = readFileSync(new URL("../src/tabs/walkforward/Published.css", import.meta.url), "utf8");
// The chart's axis labels are placed by an inline left offset (Dumbbell.tsx); nothing else may carry a style.
check(root.querySelectorAll("[style]:not(.wfl-bell-tick), mark, table strong, table b, table em").length === 0 && !/\b(td|th|tbl[\w-]*|tr)\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")),
  "view: no cell is highlighted: no inline style, no marked or bold cell, and the segment's stylesheet styles no table cell");

// The method note, linked once.
const links = [...root.querySelectorAll("a")];
check(links.length === 1 && links[0].getAttribute("href") === P.PUBLISHED_URL && !links[0].hasAttribute("target"),
  "view: one link, the method note's address from published.ts", links.map((a) => a.getAttribute("href")).join(" "));

// ---- 5. the chart of the nine pairs -----------------------------------------------------------------------

const chart = root.querySelector('[data-chart="published-pairs"]');
const head = chart?.querySelector("h2");
check(!!chart && !!head && text(head) === PAIR_HEADING && chart.getAttribute("aria-labelledby") === head.id && chart.querySelectorAll(".wfl-bells").length === 1,
  "chart: one element holds the heading and the strip, and is labelled by the heading", head ? text(head) : "(none)");
{
  // It heads the segment: the first thing after the lede, above the table of the nine.
  const order = [...root.children];
  const tableAt = order.findIndex((x) => x.contains(nine));
  check(order.indexOf(chart) === 1 && order[0].classList.contains("wfp-lede") && tableAt > 1,
    "chart: it comes straight after the lede, above the table of the nine", order.map((x) => x.className || x.tagName).slice(0, 3).join(" | "));
}
const groups = [...(chart?.querySelectorAll(".wfl-bell-group") ?? [])];
const rowsOf = (g) => [...g.querySelectorAll("li.wfl-bell")];
check(groups.length === M.WALK_RUNS.length && same(groups.map((g) => text(g.querySelector(".wfl-bell-group-name") ?? {})), M.WALK_RUNS.map((run) => pubFor(run.tickers).name)) &&
  same(M.WALK_RUNS.map((run) => pubFor(run.tickers).name), P.PUBLISHED_SETS.map((p) => p.name)) &&
  groups.every((g) => same(rowsOf(g).map((li) => text(li.querySelector(".wfl-bell-name"))), heads(nine).slice(2))),
  "chart: three groups, one per published set in published.ts's order, each with the three constructions named as the table names them",
  groups.map((g) => text(g)).join(" | ").slice(0, 200));
// What each row prints: the module's whole-window figure formatted (the mega-caps' maximum Sharpe quoted as
// published), then the published out-of-sample string verbatim.
const inWant = (run, k) => (run.key === "megacap5" && k === "tan" ? P.MEGA_CAP_IN_SAMPLE : format(run.wholeWindow.ship[k], "num3"));
const printedRows = groups.map((g) => rowsOf(g).map((li) => text(li.querySelector(".wfl-bell-values"))));
const wantRows = M.WALK_RUNS.map((run) => KEYS.map((k) => `${inWant(run, k)} to ${pubFor(run.tickers)[FIELD[k]]}`));
check(same(printedRows, wantRows), "chart: each row prints its whole-window figure and its published figure verbatim", JSON.stringify(printedRows));
check(format(M.WALK_RUNS.find((run) => run.key === "megacap5").wholeWindow.ship.tan, "num3") === P.MEGA_CAP_IN_SAMPLE,
  "chart: the quoted 1.107 is what the record's own whole-window figure prints");
// The text alternative: every row's picture names its set, its construction and both figures, so all nine pairs read.
const alts = groups.flatMap((g) => rowsOf(g).map((li) => li.querySelector("svg")?.getAttribute("aria-label") ?? ""));
const altWant = M.WALK_RUNS.flatMap((run) => KEYS.map((k) => `${pubFor(run.tickers).name}, ${LABEL_OF[k]}: in-sample ${inWant(run, k)}, out-of-sample ${pubFor(run.tickers)[FIELD[k]]}`));
check(same(alts, altWant) && (chart?.querySelectorAll("svg[role=img]").length ?? 0) === 9, "chart: the text alternative reads all nine pairs, each with its set and construction", alts.join(" / "));
// Drawn alike, on one axis: each row's two dots at its two figures on the shared domain, zero's gridline on every
// row, every gridline at the same place on every row, one hollow and one filled dot per row, and no colour set
// on any mark (the stylesheet inks them all alike).
{
  const pairs = View.publishedPairs();
  const dom = bellDomain(pairs.flatMap((g) => g.rows));
  const ticks = bellTicks(dom);
  const X = (v) => 8 + ((v - dom[0]) / (dom[1] - dom[0])) * (400 - 16);
  const lis = groups.flatMap(rowsOf);
  const flat = M.WALK_RUNS.flatMap((run) => KEYS.map((k) => [run.wholeWindow.ship[k], Number(pubFor(run.tickers)[FIELD[k]].replace("\u2212", "-"))]));
  const grid = (li) => [...li.querySelectorAll("line.wfl-bell-grid, line.wfl-bell-zero")].map((l) => l.getAttribute("x1")).join(",");
  const ok = lis.length === 9 && lis.every((li, i) => {
    const hollow = li.querySelectorAll("circle.wfl-bell-in");
    const filled = li.querySelectorAll("circle.wfl-bell-out");
    return hollow.length === 1 && filled.length === 1 && Math.abs(Number(hollow[0].getAttribute("cx")) - X(flat[i][0])) < 1e-9 &&
      Math.abs(Number(filled[0].getAttribute("cx")) - X(flat[i][1])) < 1e-9 && li.querySelectorAll("line.wfl-bell-zero").length === 1 &&
      grid(li) === grid(lis[0]) && li.className === lis[0].className;
  });
  check(ok && ticks.includes(0) && dom[0] < Math.min(...flat.flat()) && dom[1] > Math.max(...flat.flat()) &&
    (chart?.querySelectorAll("[fill], [stroke], [class~=up], [class~=down], [class*='-up'], [class*='-down']").length ?? 1) === 0,
    "chart: every row drawn alike on one shared axis with zero marked, its hollow dot at the whole-window figure and its filled dot at the published one");
  const tickText = [...(chart?.querySelectorAll(".wfl-bell-tick") ?? [])].map(text);
  check(tickText.length === ticks.length && ticks.length >= 3 && (chart?.querySelectorAll(".wfl-bell-tick[data-zero]").length ?? 0) === 1,
    "chart: the axis labels every gridline, zero among them", tickText.join(" "));
}
// The words: in-sample and the whole window with the held-out years on the hollow dot, published on the filled one.
const keyText = text(chart?.querySelector(".wfl-bells-key") ?? {});
const pairsNote = text(root.querySelector('[data-note="pairs"]') ?? {});
const f0w = M.WALK_RUNS[0].folds[0];
check(/in-sample, the run's whole window/.test(keyText) && /out-of-sample, as published/.test(keyText) &&
  pairsNote.includes("whole window") && pairsNote.includes("held-out years included") && pairsNote.includes(`${f0w.fitFirst} to ${M.WALK_RUNS[0].lastBar}`) &&
  pairsNote.includes(format(M.WALK_RF, "pct1")) && pairsNote.includes("equal weight held at equal weights with no fit") && pairsNote.includes(P.MEGA_CAP_IN_SAMPLE),
  "chart: the key and the note say in-sample on the whole window with the held-out years included, the window, the rate, that equal weight is not fitted, and which hollow dot is published",
  `${keyText} / ${pairsNote}`);
// The note prints one window for all three sets, read from the first run, so every run must span that window.
check(M.WALK_RUNS.length === 3 && M.WALK_RUNS.every((run) => run.folds[0].fitFirst === f0w.fitFirst && run.lastBar === M.WALK_RUNS[0].lastBar),
  "chart: every set's run spans the one window the note prints", M.WALK_RUNS.map((run) => `${run.key} ${run.folds[0].fitFirst}..${run.lastBar}`).join(" | "));
// Equal weight is fitted to nothing, so the note does not call its whole-window figure a fit's record.
check(!/record of the same fit/.test(pairsNote) && /stored record, scored the same way/.test(pairsNote),
  "chart: the note calls the eight unpublished whole-window figures a record scored the same way, not a fit", pairsNote);
// Each set's name is a heading under the chart's, and labels its list; the pair printed beside a row is hidden
// from a screen reader, since the row's picture reads both figures.
check(groups.every((g) => {
  const name = g.querySelector(".wfl-bell-group-name");
  return name?.tagName === "H3" && g.querySelector("ul")?.getAttribute("aria-labelledby") === name.id &&
    rowsOf(g).every((li) => li.querySelector(".wfl-bell-values")?.getAttribute("aria-hidden") === "true");
}), "chart: each set's name is a heading that labels its rows, and the printed pairs are hidden from a screen reader",
  groups.map((g) => g.querySelector(".wfl-bell-group-name")?.tagName).join(" "));
// The note under it: exactly the whole-window figures an exact solve prints differently, by the fixture's own prints.
{
  const differs = (run) => KEYS.filter((k) => WF.sets[run.key].whole_window.tight.prints[k] !== WF.sets[run.key].whole_window.ship.prints[k]);
  const wantW = M.WALK_RUNS.flatMap((run) => differs(run).map((k) => `${pubFor(run.tickers).name}|${LABEL_OF[k]}`));
  const namedW = [...root.querySelectorAll('[data-note="whole-solver"] [data-differs]')].map((x) => x.getAttribute("data-differs"));
  const noteW = text(root.querySelector('[data-note="whole-solver"]') ?? {});
  const printsW = M.WALK_RUNS.flatMap((run) => differs(run).map((k) =>
    `${WF.sets[run.key].whole_window.tight.prints[k]} where the chart prints ${WF.sets[run.key].whole_window.ship.prints[k]}`));
  // The two solver notes, one under the chart and one under the table, open differently.
  const noteT = text(root.querySelector('[data-note="solver"]') ?? {});
  check(noteW === "" || (noteW.startsWith("Solver note, whole window: solved exactly, ") && noteT.startsWith("Solver note: the published run's") && noteW.slice(0, 20) !== noteT.slice(0, 20)),
    "chart: the note under the chart opens with the whole window, so it reads apart from the table's solver note", `${noteW.slice(0, 60)} / ${noteT.slice(0, 60)}`);
  check(same(namedW, wantW) && printsW.every((x) => noteW.includes(x)) && (wantW.length === 0) === (noteW === "") &&
    (wantW.length === 0 || noteW.includes(`${format(wantW.length, "int")} of the ${format(KEYS.length * M.WALK_RUNS.length, "int")} whole-window figures`)),
    "chart: the note under it names exactly the whole-window figures the exact solve prints differently, with both prints", `${namedW.join(", ")} / ${wantW.join(", ")}`);
}

r.unmount();
done("t-walkforward-published");
