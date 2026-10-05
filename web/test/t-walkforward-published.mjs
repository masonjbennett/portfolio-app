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
//      differently, reruns each set with its own tickers, fetches nothing, and links the method note once.
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
const { format } = await import("../src/format.ts");
const View = await import("../src/tabs/walkforward/Published.tsx");

const WF = json(new URL("./fixtures/walkforward.json", import.meta.url));
const MODULE = new URL("../src/content/walkforward.ts", import.meta.url);
const VIEW = new URL("../src/tabs/walkforward/Published.tsx", import.meta.url);
const PRICES = { megacap5: "megacap5", sectors7: "sectors", cross: "cross" };
const KEYS = ["ew", "gmv", "tan"];
const FIELD = { ew: "ew", gmv: "gmv", tan: "tangency" }; // module key -> published.ts field
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
}
const mega = WF.sets.megacap5;
const cross = WF.sets.cross;
check(M.WALK_TANGENCY_IN_SAMPLE === mega.ship.in_sample_tangency, "module: the whole-window tangency is the fixture's");
check(same(M.WALK_APPLE, mega.sensitivity_apple.windows.map((w) => ({ label: w.label, rows: w.bars, weight: w.tangency_aapl }))),
  "module: the Apple lookbacks, their lengths and weights are the fixture's");
check(M.WALK_AGG.weight === cross.ship.gmv_agg_into_2022 && cross.ship.weights.gmv[M.WALK_AGG.fold][cross.tickers.indexOf(M.WALK_AGG.ticker)] === M.WALK_AGG.weight &&
  cross.folds[M.WALK_AGG.fold].hold_first.startsWith("2022-01"),
  "module: the AGG weight is the cross-asset minimum-variance weight of the hold that began in January 2022");

// ---- 2. published.ts's added strings are the fixture's published fields ---------------------------------

check(P.CROSS_AGG_INTO_2022 === cross.published_agg_into_2022, "published: the AGG string is the fixture's", P.CROSS_AGG_INTO_2022);
check(same(P.MEGA_CAP_APPLE, mega.sensitivity_apple.published), "published: the five Apple strings are the fixture's", JSON.stringify(P.MEGA_CAP_APPLE));
check(P.MEGA_CAP_IN_SAMPLE === mega.published_in_sample, "published: 1.107 is the fixture's", P.MEGA_CAP_IN_SAMPLE);
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
check(same(heads(nine), ["Set", "Tickers", "Equal weight", "Minimum variance", "Maximum Sharpe"]), "view: the nine's columns are the three constructions", heads(nine).join("|"));

// 1.107 and its out-of-sample figure, quoted.
const megaPub = pubFor(WF.sets.megacap5.tickers); // 1.107 is the mega-caps' own figure, whatever order the runs are in
const decay = [...r.container.querySelectorAll(".wfp-decay-figure")].map(text);
check(same(decay, [P.MEGA_CAP_IN_SAMPLE, megaPub.tangency]), "view: the decay prints the published in-sample and out-of-sample figures", decay.join(" "));
const decayText = text(r.container.querySelector(".wfp-decay") ?? {});
check(/whole window/.test(decayText) && /held-out years included/.test(decayText),
  "view: the in-sample figure says it was fitted on the whole window, held-out years included", decayText);

// Per set: each hold's dates, counts and Sharpe ratios, and the weights held, all formatted from the module.
const expectFolds = (run) => run.folds.map((f, i) => [String(i + 1), format(f.fitRows, "int"),
  format(f.holdFirst, "date"), format(f.holdLast, "date"), format(f.rows, "int"), ...KEYS.map((k) => format(run.ship.foldSharpe[k][i], "num3"))]);
for (const run of M.WALK_RUNS) {
  const pub = pubFor(run.tickers);
  const folds = byTitle(`${pub.name}: each hold`);
  check(same(cells(folds), expectFolds(run)), `view ${run.key}: the fold table is the module's schedule and fold Sharpe ratios, formatted`, JSON.stringify(cells(folds)[0]));
  for (const [k, word] of [["gmv", "minimum-variance"], ["tan", "maximum-Sharpe"]]) {
    const tbl = byTitle(`${pub.name}: ${word} weights`);
    const want = run.folds.map((f, i) => [String(i + 1), format(f.fitLast, "date"), ...run.tickers.map((t, j) =>
      run.key === "cross" && k === "gmv" && i === M.WALK_AGG.fold && t === M.WALK_AGG.ticker ? P.CROSS_AGG_INTO_2022 : format(run.ship.weights[k][i][j], "pct1"))]);
    check(same(cells(tbl), want), `view ${run.key}: the ${word} weights are the module's, formatted`, JSON.stringify(cells(tbl)[0]));
    check(same(heads(tbl).slice(2), [...run.tickers]), `view ${run.key}: the ${word} weights carry one column per ticker`);
  }
}
const aggCell = cells(byTitle(`${pubFor(cross.tickers).name}: minimum-variance weights`))[M.WALK_AGG.fold]?.[2 + cross.tickers.indexOf(M.WALK_AGG.ticker)];
check(aggCell === P.CROSS_AGG_INTO_2022, `view: the cross-asset AGG weight of the hold from January 2022 reads ${P.CROSS_AGG_INTO_2022}`, aggCell);
const apple = byTitle("Maximum-Sharpe weight in AAPL by lookback, as published");
check(same(cells(apple), M.WALK_APPLE.map((w, i) => [w.label, format(w.rows, "int"), P.MEGA_CAP_APPLE[i]])),
  "view: the Apple weights print exactly as published.ts holds them, beside the module's lookbacks", JSON.stringify(cells(apple)));

// The solver note: exactly the figures an exact solve prints differently, by the oracle's own prints.
const want = M.WALK_RUNS.flatMap((run) => KEYS.filter((k) => WF.sets[run.key].tight.prints[k] !== WF.sets[run.key].published[k])
  .map((k) => `${pubFor(run.tickers).name}|${{ ew: "Equal weight", gmv: "Minimum variance", tan: "Maximum Sharpe" }[k]}`));
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
  format(want.length, "int"), format(KEYS.length * M.WALK_RUNS.length, "int"), format(M.WALK_AGG.fold + 1, "int"),
  ...M.WALK_RUNS.flatMap((run) => [run.firstBar, run.lastBar, format(run.folds.length, "int"), ...KEYS.map((k) => format(run.tight.sharpe[k], "num3")),
    ...run.folds.flatMap((f) => [f.fitFirst, f.fitLast, f.holdFirst, f.holdLast, f.holdFirst.slice(0, 4), format(f.fitRows, "int"), format(f.rows, "int")])])]);
const prose = root.cloneNode(true);
for (const t of prose.querySelectorAll(".tbl")) t.remove();
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
check(root.querySelectorAll("[style], mark, table strong, table b, table em").length === 0 && !/\b(td|th|tbl[\w-]*|tr)\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")),
  "view: no cell is highlighted: no inline style, no marked or bold cell, and the segment's stylesheet styles no table cell");

// The method note, linked once.
const links = [...root.querySelectorAll("a")];
check(links.length === 1 && links[0].getAttribute("href") === P.PUBLISHED_URL && !links[0].hasAttribute("target"),
  "view: one link, the method note's address from published.ts", links.map((a) => a.getAttribute("href")).join(" "));

r.unmount();
done("t-walkforward-published");
