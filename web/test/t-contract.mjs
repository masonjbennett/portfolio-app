// The contract the page's parts are built against (src/types.ts) and the modules that hold its
// place. Every shared module imports and keeps its exports; every tab renders from a real Analysis;
// the hook, the analysis and the tab props carry exactly the fields types.ts declares (read out of
// types.ts here, not retyped); both payload layouts read the same; the shared components keep the
// promises their props make; and src/state/defaults.ts carries the app's literals, each read back
// out of portfolio_app.py at test time.
import { render, text, act } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { derive } from "./_fixtures.mjs";
import { examplePayload, exampleAnalysis, fixtureAnalysis, fixturePayload, tabProps, ORACLE_RF } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const web = new URL("../", import.meta.url);
const src = (rel) => readFileSync(new URL(rel, web), "utf8");
const app = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8");
const quiet = (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};

// ---- (a) every shared module imports and keeps its contract exports -------------------------------
const EXPORTS = {
  "src/types.ts": { LEVELS: "object", TAB_LABELS: "object", TAB_IDS: "object" },
  "src/App.tsx": { default: "function", TABS: "object", TAB_LOADERS: "object" },
  "src/chrome/Rail.tsx": { default: "function" },
  "src/chrome/SummaryChip.tsx": { default: "function" },
  "src/chrome/Band.tsx": { default: "function" },
  "src/state/analyze.ts": { analyze: "function", MESSAGES: "object" },
  "src/state/url.ts": { encodeShare: "function", decodeShare: "function" },
  "src/state/storage.ts": { loadPrefs: "function", savePrefs: "function", PREFS_KEY: "string" },
  "src/state/useWorkbench.ts": { useWorkbench: "function" },
  "src/state/defaults.ts": { PRESETS: "object", BENCHMARKS: "object", benchDisplay: "function", DEFAULT_SETTINGS: "object" },
  "src/data/payload.ts": { toFrame: "function", isExample: "function" },
  "src/components/Boundary.tsx": { default: "function" },
  "src/components/SegControl.tsx": { default: "function" },
  "src/components/Table.tsx": { default: "function" },
  "src/components/ChartFrame.tsx": { default: "function" },
  "src/components/Tip.tsx": { default: "function" },
  "src/components/Plate.tsx": { default: "function" },
  "src/components/Slug.tsx": { default: "function" },
  "src/format.ts": { format: "function", EXCEL_FORMATS: "object", DASH: "string" },
  "src/download.ts": { csvText: "function", downloadCsv: "function", downloadXlsx: "function" },
  "src/charts/theme.ts": { SERIES: "object", seriesColor: "function", chartTheme: "object" },
  "src/content/tooltips.ts": { tipText: "function" },
  "src/tabs/Returns.tsx": { default: "function" },
  "src/tabs/Risk.tsx": { default: "function" },
  "src/tabs/Correlation.tsx": { default: "function" },
  "src/tabs/Optimization.tsx": { default: "function" },
  "src/tabs/Custom.tsx": { default: "function" },
  "src/tabs/Sensitivity.tsx": { default: "function" },
  "api/prices.ts": { GET: "function" },
  "api/rf.ts": { GET: "function" },
};
const mods = {};
for (const [file, want] of Object.entries(EXPORTS)) {
  let mod = null;
  try {
    mod = await import(new URL(file, web).href);
  } catch (err) {
    check(false, `import: ${file} loads`, err.message.split("\n")[0]);
    continue;
  }
  mods[file] = mod;
  const wrong = Object.entries(want)
    .filter(([k, t]) => typeof mod[k] !== t)
    .map(([k, t]) => `${k} is ${typeof mod[k]}, want ${t}`);
  check(!wrong.length, `import: ${file} exports its contract`, wrong.join("; "));
}
const m = (file) => mods[file] ?? {};
const T = m("src/types.ts");
const D = m("src/state/defaults.ts");

// ---- (b) the declared fields, read out of types.ts -------------------------------------------------
function fields(name) {
  const re = new RegExp(`export interface ${name}(?:<[^>]*>)? \\{([\\s\\S]*?)\\n\\}`);
  const body = re.exec(src("src/types.ts"))?.[1] ?? "";
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((x) => x[1]).sort();
}
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const ANALYSIS = fields("Analysis");
const WORKBENCH = fields("Workbench");
const TABPROPS = fields("TabProps");
check(ANALYSIS.length === 23 && WORKBENCH.length === 12 && TABPROPS.length === 6,
  "types: the field reader finds Analysis, Workbench and TabProps", `${ANALYSIS.length} / ${WORKBENCH.length} / ${TABPROPS.length}`);

// ---- (c) analyze() on both layouts, against the engine called directly ------------------------------
const ex = exampleAnalysis();
const live = fixtureAnalysis("cross");
const ref = derive("cross");
check(same(Object.keys(ex), ANALYSIS), "analysis: carries exactly the fields types.ts declares", Object.keys(ex).sort().join(","));
check(ex.source === "example" && live.source === "live",
  "analysis: the column-major example is 'example', the row-major payload 'live'", `${ex.source} ${live.source}`);
check(JSON.stringify(ex.tickers) === JSON.stringify(ref.cleaned.tickers) && ex.benchmark === "^GSPC", "analysis: tickers and benchmark");
check(ex.benchLabel === "S&P 500" && live.benchLabel === "S&P 500",
  "analysis: benchLabel from the example and from BENCHMARKS agree", `${ex.benchLabel} / ${live.benchLabel}`);
check(JSON.stringify(ex.dates) === JSON.stringify(ref.returns.dates) && ex.asOf === ref.cleaned.frame.dates.at(-1),
  "analysis: return dates, and asOf is the last PRICE date", ex.asOf);
check(ex.returns.every((c, i) => c.every((v, t) => Object.is(v, ref.cols[i][t]))) && ex.bench.every((v, t) => Object.is(v, ref.bench[t])),
  "analysis: per-ticker and benchmark returns are the engine's, bit for bit");
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
check(ex.m.every((v, i) => Math.abs(v - mean(ref.cols[i])) < 1e-15), "analysis: m is the DAILY mean");
const [a0, a1] = [ref.cols[0], ref.cols[1]];
const cov01 = (mean(a0.map((x, t) => (x - mean(a0)) * (a1[t] - mean(a1)))) * a0.length) / (a0.length - 1);
check(Math.abs(ex.S[0][1] - cov01) < 1e-15 && ex.S.length === 5,
  "analysis: S is the DAILY covariance, ddof 1, benchmark excluded", `${ex.S[0][1]} vs ${cov01}`);
check(ex.rf === ORACLE_RF && ex.rfSource === "example", "analysis: the rate handed in is the rate used, with its source");
check(ex.ew.length === 5 && ex.ew.every((w) => w === 0.2), "analysis: equal weights");
const { tangency, gmv, frontier } = await import("../src/lib/optimize.ts");
const { annualizedStats } = await import("../src/lib/stats.ts");
const tan = tangency(ex.m, ex.S, ORACLE_RF, false);
check(ex.tangency !== null && Math.abs(ex.tangency.sharpe - tan.sharpe) < 1e-12,
  "analysis: tangency solved at the rate handed in", `${ex.tangency?.sharpe} vs ${tan.sharpe}`);
check(ex.gmv !== null && Math.abs(ex.gmv.sigma - gmv(ex.m, ex.S, false).sigma) < 1e-12, "analysis: gmv");
check(ex.frontier.length === D.FRONTIER_POINTS && ex.frontier.length === frontier(ex.m, ex.S, false, 80).length,
  "analysis: FRONTIER_POINTS frontier points", ex.frontier.length);
const bs = annualizedStats(ref.bench, ORACLE_RF);
check(ex.benchStats.mu === bs.mu && ex.benchStats.sortino === bs.sortino, "analysis: benchStats is annualized_stats of the benchmark at rf");
const short = exampleAnalysis({ allowShort: true });
check(short.allowShort && short.gmv.w.some((w) => w < 0) && !ex.gmv.w.some((w) => w < 0), "analysis: allowShort sets the bounds of every solve");
check(JSON.stringify(ex.requested) === '{"start":"2019-01-01","end":"2026-09-26"}', "analysis: requested dates are the payload's", JSON.stringify(ex.requested));

// Named failures, in the app's own sentences where the app has one.
const { analyze, MESSAGES } = m("src/state/analyze.ts");
const px = fixturePayload("cross");
const refuse = (p) => analyze(p, tabProps(ex).settings, { rate: ORACLE_RF, source: "manual" });
const few = refuse({ ...px, tickers: ["VTI", "AGG"] });
check(few.ok === false && few.error === "too-few" && few.message === "Please enter at least 3 unique tickers.",
  "analysis: too few tickers fails closed and named", few.error);
const benchGone = refuse({ ...px, missing: ["^GSPC"] });
check(benchGone.ok === false && benchGone.error === "bench-failed", "analysis: a failed benchmark download is named", benchGone.error);
for (const id of ["too-few", "too-many", "short-range", "reversed", "too-few-downloaded", "short-overlap", "too-few-valid"]) {
  check(app.includes(`st.error("${MESSAGES?.[id]}")`), `analysis: MESSAGES["${id}"] is the app's st.error text verbatim`);
}

// ---- (d) toFrame: both layouts, the same frame -----------------------------------------------------
const { toFrame } = m("src/data/payload.ts");
const fa = toFrame(examplePayload());
const fb = toFrame(px);
check(JSON.stringify(fa.dates) === JSON.stringify(fb.dates) && JSON.stringify(fa.columns) === JSON.stringify(fb.columns)
  && fa.values.length === 6 && fa.values.every((c, j) => c.length === fb.values[j].length && c.every((v, i) => Object.is(v, fb.values[j][i]))),
  "payload: the column-major example and the row-major fixture give the identical Frame");
const dirty = fixturePayload("dirty");
const fd = toFrame(dirty);
const nulls = dirty.rows.flatMap((r) => r.slice(1)).filter((v) => v === null).length;
const nans = fd.values.flat().filter((v) => Number.isNaN(v)).length;
check(nulls > 0 && nans === nulls && fd.values[0].length === dirty.rows.length, "payload: null becomes NaN, nothing else does", `${nulls} nulls, ${nans} NaN`);
// The same gappy prices laid out column-major, as the baked example is: the same Frame, NaN and all.
const { rows: _rows, ...dirtyCore } = dirty;
const dirtyCols = {
  ...dirtyCore,
  set: "dirty",
  benchLabel: "S&P 500",
  rf: ORACLE_RF,
  dates: dirty.rows.map((r) => r[0]),
  prices: dirty.columns.map((_, j) => dirty.rows.map((r) => r[j + 1])),
};
const fc = toFrame(dirtyCols);
check(JSON.stringify(fc.dates) === JSON.stringify(fd.dates) && fc.values.every((c, j) => c.every((v, i) => Object.is(v, fd.values[j][i]))),
  "payload: a column-major payload with gaps gives the same Frame as the row-major one");

// ---- (e) the hook and every tab, rendered --------------------------------------------------------
const { useWorkbench } = m("src/state/useWorkbench.ts");
let wb = null;
try {
  renderToStaticMarkup(h(function Probe() {
    wb = useWorkbench();
    return null;
  }));
} catch (err) {
  check(false, "hook: useWorkbench renders", err.message);
}
check(wb && same(Object.keys(wb), WORKBENCH), "hook: useWorkbench returns exactly the fields Workbench declares", wb && Object.keys(wb).sort().join(","));
check(wb && ["loading", "empty", "error", "ready"].includes(wb.analysis?.status) && T.TAB_IDS?.includes(wb.tab), "hook: analysis is a LoadState and tab a TabId");
check(same(Object.keys(tabProps(ex)), TABPROPS), "tabs: the test's props are exactly TabProps", Object.keys(tabProps(ex)).sort().join(","));
for (const id of T.TAB_IDS ?? []) {
  const file = `src/tabs/${id[0].toUpperCase()}${id.slice(1)}.tsx`;
  let html = "";
  try {
    html = renderToStaticMarkup(h(m(file).default, tabProps(ex)));
  } catch (err) {
    check(false, `tabs: ${file} renders`, err.message.split("\n")[0]);
    continue;
  }
  check(html.length > 0, `tabs: ${file} renders from a real Analysis`);
  const routed = await m("src/App.tsx").TAB_LOADERS?.[id]?.().catch(() => null);
  check(routed?.default === m(file).default, `tabs: App routes "${id}" to ${file}`);
}
let page = "";
try {
  page = renderToStaticMarkup(h(m("src/App.tsx").default));
} catch (err) {
  check(false, "app: App renders", err.message.split("\n")[0]);
}
check(page.length > 0, "app: App renders");

// ---- (f) the shared components keep their props' promises ------------------------------------------
const ChartFrame = m("src/components/ChartFrame.tsx").default;
let drew = [];
const draw = (v) => {
  drew.push(v);
  return h("svg", { "data-drawn": v });
};
for (const state of [{ status: "loading" }, { status: "empty", reason: "no rows" }, { status: "error", name: "prices", message: "down" }]) {
  drew = [];
  const html = renderToStaticMarkup(h(ChartFrame, { title: "Gold fell least", state, children: draw }));
  check(drew.length === 0 && html.includes("Gold fell least"), `chartframe: ${state.status} shows the title and never draws the chart`);
}
drew = [];
renderToStaticMarkup(h(ChartFrame, { title: "t", state: { status: "ready", value: 7 }, children: draw }));
check(drew.length === 1 && drew[0] === 7, "chartframe: ready draws the chart from its value", JSON.stringify(drew));
const errHtml = renderToStaticMarkup(h(ChartFrame, { title: "t", state: { status: "error", name: "prices", message: "down" }, children: draw }));
check(errHtml.includes("prices"), "chartframe: an error is shown with its name");

const Boundary = m("src/components/Boundary.tsx").default;
const Boom = () => {
  throw new Error("boom");
};
quiet(() => {
  let r = null;
  try {
    r = render(h("div", null, h(Boundary, { name: "Frontier chart" }, h(Boom)), h("p", null, "still here")));
  } catch (err) {
    check(false, "boundary: a throw inside stays inside", err.message);
  }
  check(r !== null && text(r.container).includes("Frontier chart") && text(r.container).includes("still here"),
    "boundary: a throw inside stays inside and the fallback names the card", r ? text(r.container) : "");
  r?.unmount();
});

const SegControl = m("src/components/SegControl.tsx").default;
let picked = null;
const seg = render(h(SegControl, {
  options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }],
  value: "a",
  onChange: (v) => (picked = v),
  ariaLabel: "Pick",
}));
const beta = [...seg.container.querySelectorAll("button, [role=tab], [role=radio]")].find((b) => text(b) === "Beta");
act(() => beta?.click());
check(picked === "b", "segcontrol: choosing an option calls onChange with its value", String(picked));
seg.unmount();

const Plate = m("src/components/Plate.tsx").default;
const plate = renderToStaticMarkup(h(Plate, { label: "Best Sharpe (Tangency)", value: null, format: "num3", level: "plain" }));
check(plate.includes("Best Sharpe (Tangency)") && plate.includes(m("src/format.ts").DASH), "plate: a null value prints the dash, never a number");

// format, download, tooltips, storage, url: the signatures answer with the right kinds.
const { format, EXCEL_FORMATS } = m("src/format.ts");
const FORMAT_IDS = /export type FormatId = ([^;]+);/.exec(src("src/types.ts"))?.[1].match(/"(\w+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
check(FORMAT_IDS.length >= 9 && same(Object.keys(EXCEL_FORMATS ?? {}), FORMAT_IDS), "format: an Excel number format for every FormatId", FORMAT_IDS.join(","));
check(typeof format?.(0.1234, "pct2") === "string" && format?.(null, "pct2") === m("src/format.ts").DASH, "format: returns a string, the dash for null");
check(typeof m("src/download.ts").csvText?.([{ key: "a", label: "A", format: "num2" }], [{ a: 1 }]) === "string", "download: csvText returns text");
check(typeof m("src/content/tooltips.ts").tipText?.("sharpe", "plain") === "string", "tooltips: tipText returns text");
const prefs = m("src/state/storage.ts").loadPrefs?.();
check(prefs && same(Object.keys(prefs), fields("Prefs")) && T.LEVELS?.some((l) => l.id === prefs.level),
  "storage: loadPrefs returns exactly Prefs", JSON.stringify(prefs));
const share = m("src/state/url.ts").decodeShare?.("");
check(share && same(Object.keys(share), fields("ShareState")) && !("amount" in share.settings),
  "url: decodeShare returns exactly ShareState, never an amount", JSON.stringify(share));

// ---- (g) defaults.ts against portfolio_app.py ------------------------------------------------------
const grab = (re, label) => {
  const hit = re.exec(app);
  check(hit !== null, `oracle: found ${label} in portfolio_app.py`);
  return hit ?? [];
};
const presetsBlock = grab(/^PRESETS = \{([\s\S]*?)^\}/m, "PRESETS")[1] ?? "";
const presets = [...presetsBlock.matchAll(/"([^"]+)": \{\s*"tickers": "([^"]+)",\s*"desc": "([^"]+)",\s*\}/g)]
  .map(([, name, tickers, desc]) => ({ name, tickers, desc }));
check(presets.length === 6 && JSON.stringify(D.PRESETS) === JSON.stringify(presets),
  "defaults: PRESETS are the app's, in order (60-85)", JSON.stringify(presets.map((p) => p.name)));
const benchBlock = grab(/bench_options = \{([\s\S]*?)\}/, "bench_options")[1] ?? "";
const [, from, to] = grab(/bench_label = bench_label_raw\.replace\("([^"]*)", "([^"]*)"\)/, "the bench_label rule");
const benches = [...benchBlock.matchAll(/"([^"]+)": "([^"]+)",/g)].map(([, label, symbol]) => ({ label, symbol, display: label.replace(from, to) }));
check(benches.length === 6 && JSON.stringify(D.BENCHMARKS) === JSON.stringify(benches),
  "defaults: BENCHMARKS are the app's options, symbols and display names (728-744)", JSON.stringify(D.BENCHMARKS?.map((b) => b.display)));
const benchIdx = Number(grab(/list\(bench_options\.keys\(\)\),\s*index=(\d+)/, "the benchmark index")[1]);
check(D.DEFAULT_BENCHMARK === benches[benchIdx]?.symbol && D.DEFAULT_SETTINGS?.benchmark === D.DEFAULT_BENCHMARK,
  "defaults: the default benchmark is the app's index", D.DEFAULT_BENCHMARK);
check(D.benchDisplay?.("^NDX") === "Nasdaq 100" && D.benchDisplay?.("QQQ") === "QQQ", "defaults: benchDisplay names a known symbol and shows an unknown one as itself");
const tickers = grab(/st\.session_state\["ticker_input_box"\] = "([^"]+)"/, "the default tickers")[1];
check(D.DEFAULT_TICKERS === tickers && JSON.stringify(D.DEFAULT_SETTINGS?.tickers) === JSON.stringify(tickers?.split(",").map((s) => s.trim())),
  "defaults: the ticker box default (691)", D.DEFAULT_TICKERS);
const [, y, mo, d] = grab(/date_input\("Start", value=date\((\d+), (\d+), (\d+)\)\)/, "the start date");
const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
check(D.DEFAULT_START === iso && D.DEFAULT_SETTINGS?.start === iso, "defaults: the start date (702)", `${D.DEFAULT_START} vs ${iso}`);
grab(/date_input\("End", value=date\.today\(\)\)/, "the end date's today default");
check(D.DEFAULT_SETTINGS?.end === null, "defaults: the end date is today, carried as null (704)");
const fallback = Number(grab(/^RF_FALLBACK = ([0-9.]+)/m, "RF_FALLBACK")[1]);
check(D.RF_FALLBACK === fallback / 100 && D.DEFAULT_SETTINGS?.rf === null,
  "defaults: RF_FALLBACK is the app's percent as a decimal, and the default rate is the live one (601)", `${D.RF_FALLBACK} vs ${fallback}`);
const step = Number(grab(/number_input\("Annualized Rf \(%\)", value=[^,]+, step=([0-9.]+)\)/, "the rate step")[1]);
check(D.RF_STEP === step / 100, "defaults: RF_STEP (717)", `${D.RF_STEP} vs ${step}`);
const [, amt, min, astep] = grab(/number_input\("Initial Amount \(\$\)", value=(\d+), min_value=(\d+), step=(\d+)/, "the amount field");
check(D.DEFAULT_AMOUNT === Number(amt) && D.MIN_AMOUNT === Number(min) && D.AMOUNT_STEP === Number(astep) && D.DEFAULT_SETTINGS?.amount === Number(amt),
  "defaults: amount, minimum and step (724)", `${D.DEFAULT_AMOUNT}/${D.MIN_AMOUNT}/${D.AMOUNT_STEP}`);
const shortDefault = grab(/st\.toggle\(\s*"Allow short positions",\s*value=(True|False)/, "the shorting toggle")[1];
check(D.DEFAULT_ALLOW_SHORT === (shortDefault === "True") && D.DEFAULT_SETTINGS?.allowShort === D.DEFAULT_ALLOW_SHORT, "defaults: shorting off (749)", shortDefault);
const levelNames = grab(/"Tooltip Detail Level",\s*options=\[([^\]]+)\]/, "the level radio")[1]?.match(/"(\w+)"/g)?.map((s) => s.slice(1, -1));
check(JSON.stringify(T.LEVELS?.map((l) => l.oracle)) === JSON.stringify(levelNames), "types: LEVELS are the app's radio options, in order (650-653)", JSON.stringify(levelNames));
const knowledge = grab(/st\.session_state\.knowledge = "(\w+)"/, "the knowledge default")[1];
check(T.LEVELS?.find((l) => l.id === D.DEFAULT_LEVEL)?.oracle === knowledge, "defaults: the level starts at the app's (17-18)", `${D.DEFAULT_LEVEL} vs ${knowledge}`);
const points = Number(grab(/def efficient_frontier\([^)]*n_points=(\d+)/, "efficient_frontier's n_points")[1]);
check(D.FRONTIER_POINTS === points, "defaults: FRONTIER_POINTS (948)", `${D.FRONTIER_POINTS} vs ${points}`);
const tabs = grab(/st\.tabs\(\[([\s\S]*?)\]\)/, "the tab labels")[1]?.match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1).trim());
check(JSON.stringify(T.TAB_IDS?.map((id) => T.TAB_LABELS[id])) === JSON.stringify(tabs) && D.DEFAULT_TAB === T.TAB_IDS?.[0],
  "types: TAB_LABELS are the app's six, trimmed, in order (1213-1220)", JSON.stringify(tabs));

// ---- (h) the published sets come first in the rail; the app's own follow -----------------------------
{
  const { PUBLISHED_SETS } = await import("../src/content/published.ts");
  const inOrder = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const names = (list) => (list ?? []).map((p) => p.name);
  // ledger:published-presets, the app's side: its six presets hold neither the five mega-caps nor
  // the seven sector ETFs the walk-forward tested; only Cross-asset is one of the published sets.
  const setKey = (t) => [...t].map((x) => x.trim()).sort().join(",");
  const appKeys = presets.map((p) => setKey(p.tickers.split(",")));
  const pubKeys = (PUBLISHED_SETS ?? []).map((x) => setKey(x.tickers));
  check(pubKeys.length === 3 && !appKeys.includes(pubKeys[0]) && !appKeys.includes(pubKeys[1]) && appKeys[0] === pubKeys[2],
    "ledger:published-presets: the app offers no preset for the published mega-cap or sector set; its Cross-asset is the third", JSON.stringify(pubKeys));
  // The port's side: the three published sets, in the published order, each marked, and the app's
  // presets that are not already among them, in the app's order.
  check(inOrder(D.PUBLISHED_PRESETS?.map((p) => [p.name, p.tickers, p.desc]), PUBLISHED_SETS?.map((x) => [x.name, x.tickers.join(", "), "Published"])) &&
    inOrder(names(D.PUBLISHED_PRESETS), ["Five mega-caps", "Seven sector ETFs", "Cross-asset"]),
    "ledger:published-presets: the rail's first presets are the published sets, marked Published", JSON.stringify(names(D.PUBLISHED_PRESETS)));
  check(inOrder(names(D.MORE_PRESETS), ["Mag 7", "Sectors", "Dividend", "Growth", "Blue Chip"]) &&
    inOrder(D.MORE_PRESETS, D.PRESETS.filter((p) => p.name !== "Cross-asset")),
    "defaults: More baskets holds the app's other five presets, word for word and in its order", JSON.stringify(names(D.MORE_PRESETS)));
  check(D.publishedPresetOf?.(["JPM", "AMZN", "GOOGL", "MSFT", "AAPL"])?.name === "Five mega-caps" && D.publishedPresetOf?.(["AAPL", "MSFT", "GOOGL"]) === null,
    "defaults: publishedPresetOf names a published set in any order, and nothing else");

  // The rail as rendered: the published row first, the app's under More baskets, no amount field.
  const Rail = m("src/chrome/Rail.tsx").default;
  const r = render(h(Rail, {
    settings: D.DEFAULT_SETTINGS, setSettings: () => {}, level: "plain", setLevel: () => {},
    rf: { status: "loading" }, fetching: false, failure: null,
  }));
  const buttons = [...r.container.querySelectorAll("button.rail-preset")];
  const labels = buttons.map((b) => b.querySelector(".rail-preset-name")?.textContent);
  const more = r.container.querySelector("details.rail-more");
  check(inOrder(labels.slice(0, 3), names(D.PUBLISHED_PRESETS)) && buttons.slice(0, 3).every((b) => b.classList.contains("rail-preset-published") && text(b).endsWith("Published")) &&
    buttons.slice(0, 3).every((b) => !more?.contains(b)),
    "ledger:published-presets: the rail shows the three published sets first, outside More baskets, each marked", JSON.stringify(labels));
  check(more && text(more.querySelector("summary")) === "More baskets" && inOrder(labels.slice(3), names(D.MORE_PRESETS)) &&
    buttons.slice(3).every((b) => more.contains(b) && !b.classList.contains("rail-preset-published")) && !more.open,
    "rail: the app's presets sit under a closed More baskets, unmarked", JSON.stringify(labels.slice(3)));
  check(r.container.querySelector('[name="amount"]') === null && !/Starting investment|Initial Amount/.test(text(r.container)) &&
    D.DEFAULT_SETTINGS?.amount === D.DEFAULT_AMOUNT,
    "rail: no starting-amount field (it is edited on the growth chart); the settings still hold the $10,000 default");
  r.unmount();

  // The rate group with the workbench's view: both rates on one line, and today's one click away.
  const patches = [];
  const view = { rate: 0.0455, date: "2026-09-25", source: "FRED DGS3MO", basis: "window", inUse: 0.0312,
    window: { rate: 0.0312, from: "2019-01-02", to: "2026-09-28", days: 1900 } };
  const v = render(h(Rail, {
    settings: D.DEFAULT_SETTINGS, setSettings: (x) => patches.push(x), level: "plain", setLevel: () => {},
    rf: { status: "ready", value: view }, fetching: false, failure: null,
  }));
  const rfGroup = v.container.querySelector('[name="rf"]')?.closest(".rail-group");
  const today = [...(rfGroup?.querySelectorAll("button") ?? [])].find((b) => text(b) === "Use today's rate instead");
  check(text(rfGroup?.querySelector(".rail-rates")) === "rf over window 3.12% · today 4.55%" && v.container.querySelector('[name="rf"]').value === "3.12" &&
    /from 2019-01-02 to 2026-09-28/.test(text(rfGroup)),
    "rail: the rate over the window is in use, shown beside today's on one line, with the days it covers", text(rfGroup));
  act(() => today?.click());
  check(inOrder(patches.at(-1), { rf: 0.0455 }), "rail: 'Use today's rate instead' sets the rate to today's yield", JSON.stringify(patches.at(-1)));
  v.unmount();
}

done("t-contract");
