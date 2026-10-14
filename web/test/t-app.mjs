// The page's chrome: masthead, basket bar and its drawer, phone chip and sheet, status line, the Overview, chapter switch,
// command palette.
//
// Drives the shipping components in jsdom (test/_dom.mjs) with a stand-in workbench, so nothing
// here waits on the state hook, and with stand-in tabs where a check is about the page rather
// than a tab. Three divergence-ledger entries close here: boundary (the page half), failed-tangency
// (the Overview half) and start-date-floor (the page half). Each asserts the app's side, read out of
// portfolio_app.py or reproduced with the engine, and the port's side, rendered.
import { readFileSync, readdirSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { act, expectUncaught, openAll, render, setMedia, text } from "./_dom.mjs";

const { createElement: h, Fragment, useState, lazy } = await import("react");
const { MIX_ANCHOR } = await import("../src/tabs/custom/YourMix.tsx");
const { AppView, TAB_LOADERS, TABS: AppTabs } = await import("../src/App.tsx");
const { default: Boundary } = await import("../src/components/Boundary.tsx");
const { snapshotPlates, finding, assetsOf, publishedSetOf, standing, nameInSentence, whoseFigures, figuresLine, lede, ledeText, hindsight, whyFacts, endsOf, mixRows, QUESTION } = await import("../src/overview/model.ts");
const { default: Overview, OPEN_PUBLISHED_TITLE } = await import("../src/overview/Overview.tsx");
const { default: WhatIfFold, seams: whatIfSeams } = await import("../src/chrome/WhatIfFold.tsx");
const A = await import("../src/content/about.tsx");
const OPT = await import("../src/tabs/optimization/model.ts");
const { default: Masthead } = await import("../src/chrome/Masthead.tsx");
const { default: Footer } = await import("../src/chrome/Footer.tsx");
const P = await import("../src/content/published.ts");
const { symbolMessage } = await import("../src/chrome/Settings.tsx");
const { default: BasketBar, SettingsSheetBody, windowLabel, assumptionsLabel } = await import("../src/chrome/BasketBar.tsx");
const { default: SummaryChip, summaryText } = await import("../src/chrome/SummaryChip.tsx");
const { format, DASH } = await import("../src/format.ts");
const { parseTickers } = await import("../src/lib/clean.ts");
const { portfolioPerformance, portfolioReturns } = await import("../src/lib/portfolio.ts");
const { sharpeSE } = await import("../src/lib/stats.ts");
const { MESSAGES } = await import("../src/state/analyze.ts");
const { PRESETS, PUBLISHED_PRESETS, RF_FALLBACK } = await import("../src/state/defaults.ts");
const { PHONE_QUERY } = await import("../src/styles/tokens.ts");
const { CHAPTER_IDS, CHAPTER_LABELS, CHAPTER_TABS, TAB_IDS, TAB_LABELS, chapterOf } = await import("../src/types.ts");
const { exampleAnalysis, examplePayload, fixtureAnalysis, settingsFor } = await import("./_analysis.mjs");
// The tabs App routes to, loaded up front: a check about a tab itself should not wait on a chunk.
// The lazy path App ships is checked on its own below.
const TABS = Object.fromEntries(await Promise.all(TAB_IDS.map(async (id) => [id, (await TAB_LOADERS[id]()).default])));

const ORACLE = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8").split(/\r?\n/);

// ---- helpers -------------------------------------------------------------------------------------
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (iso) => `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

function quietly(fn) {
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.error = error;
    console.warn = warn;
  }
}
function setValue(el, value) {
  const select = el instanceof HTMLSelectElement;
  const proto = select ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  act(() => {
    el.dispatchEvent(new window.Event(select ? "change" : "input", { bubbles: true }));
  });
}
const click = (el) => act(() => el.click());
// The what-if fold fetches its panel's code when the reader reaches for it (src/chrome/WhatIfFold.tsx):
// opened here as a reader opens it, by its line, then waited on until the panel is in. Returns the fold.
async function openWhatIf(root) {
  const fold = root.querySelector("details.whatif-fold");
  if (!fold) return null;
  click(fold.querySelector("summary"));
  for (let i = 0; i < 400 && !(fold.open && fold.querySelector("section.whatif")); i++) {
    await act(() => new Promise((res) => setTimeout(res, 5)));
  }
  return fold;
}
// The Overview's answer as a reader sees it: the glossary terms' definitions, shut, left out.
function readLede(root) {
  const el = root.querySelector(".ov-lede")?.cloneNode(true);
  el?.querySelectorAll(".term-text").forEach((d) => d.remove());
  return el ? text(el) : "";
}
// Opens the Overview hindsight card's "Show the numbers" fold, as a reader does; returns the card.
function openNumbers(root) {
  const card = root.querySelector("#overview-hindsight");
  const b = [...(card?.querySelectorAll(".card-fold-button") ?? [])].find((x) => text(x) === "Show the numbers");
  if (b && b.getAttribute("aria-expanded") !== "true") click(b);
  return card;
}
const key = (el, k, mods = {}) => act(() => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, ...mods })));
const clickables = (root) => [...root.querySelectorAll("button, [role=tab], [role=radio], [role=option]")];
const byLabel = (root, label) =>
  clickables(root).find((b) => text(b) === label) ?? clickables(root).find((b) => text(b).startsWith(label));
const field = (root, name) => root.querySelector(`[name="${name}"]`);

const EX = exampleAnalysis();
const LIVE = { rate: 0.0412, date: "2026-09-25", source: "FRED DGS3MO" };
const EX_SETTINGS = settingsFor(examplePayload(), { rf: EX.rf });

function stand(over = {}) {
  const calls = { settings: [], level: [], chapter: [], view: [] };
  const wb = {
    settings: EX_SETTINGS,
    setSettings: (p) => calls.settings.push(p),
    level: "plain",
    setLevel: (l) => calls.level.push(l),
    analysis: { status: "ready", value: EX },
    fetching: false,
    failure: null,
    rf: { status: "ready", value: LIVE },
    weights: {},
    setWeights() {},
    // Performance, so the stand-in tabs the checks below read (returns, risk) are on the page.
    chapter: "performance",
    entry: null,
    setChapter: (c, v) => {
      calls.chapter.push(c);
      calls.view.push(v ?? "basket");
    },
    view: "basket",
    rfHistory: { basis: "example", series: null, loading: false },
    ...over,
  };
  return { wb, calls };
}
// The workbench with a live chapter and level, as useWorkbench would hold them.
function Harness({ wb, tabs }) {
  const [chapter, setChapter] = useState(wb.chapter);
  const [view, setView] = useState(wb.view);
  const [level, setLevel] = useState(wb.level);
  const live = {
    ...wb,
    chapter,
    view,
    level,
    // As useWorkbench: every way into a chapter opens the walk-forward test's first segment unless one is named.
    setChapter: (c, v) => {
      wb.setChapter(c, v);
      setChapter(c);
      setView(v ?? "basket");
    },
    setLevel: (l) => {
      wb.setLevel(l);
      setLevel(l);
    },
  };
  return h(AppView, { wb: live, tabs });
}
// The Optimization tab also draws the Your mix panel, the part an older ?tab=custom link lands on (MIX_ANCHOR,
// held to App's sectionId("custom") by t-build-mix), so its stand-in carries that anchor as the real tab does.
const STAND_TABS = Object.fromEntries(TAB_IDS.map((id) => [id, () => {
  const body = h("p", { "data-tab": id }, `tab body ${id}`);
  return id === "optimization" ? h(Fragment, null, body, h("div", { id: MIX_ANCHOR, tabIndex: -1, "data-part": "custom" })) : body;
}]));
const page = (over, tabs = STAND_TABS) => render(h(Harness, { wb: stand(over).wb, tabs }));

// ---- (a) the masthead and the basket bar's summary --------------------------------------------------
{
  // Requested dates a month either side of the data, so the bar cannot pass by printing the span.
  const a = { ...EX, requested: { start: "2018-12-15", end: "2026-10-03" } };
  const r = page({ analysis: { status: "ready", value: a }, settings: { ...EX_SETTINGS, start: "2018-12-15", end: "2026-10-03" } });
  const head = r.container.querySelector("header.masthead");
  check(text(head).includes("Portfolio Analytics"), "masthead: the app's title (1177)");
  const guide = head?.querySelector(".masthead-links a");
  check(!!guide && text(guide) === "Guide", "masthead: the guide's link sits in the masthead's row", guide?.outerHTML ?? "none");
  const bar = r.container.querySelector(".bar");
  const barText = text(bar ?? {});
  // ledger: the app's title chip (1182) printed the REQUESTED dates; the bar's dates button does, from the settings.
  check(barText.includes("Dec 2018 – Oct 2026") && windowLabel({ ...EX_SETTINGS, start: "2019-01-01", end: null }) === "Jan 2019 – today",
    "bar: the dates button prints the REQUESTED window, and an open end as today (1182)", barText);
  check(a.tickers.every((t) => bar.querySelector(`.bar-chip [aria-label="Remove ${t}"]`)) && barText.includes(a.benchLabel),
    "bar: every ticker is a chip with its remove button, and the benchmark is named", barText);
  check(barText.includes(`Prices to ${format(a.asOf, "date")}`), "bar: prices to the last price date", barText);
  check(/\bexample\b/.test(barText) && !/updating/.test(barText), "bar: says 'example' while the baked example shows, nothing about updating while idle", barText);
  check(!/Prices|assets ·/.test(text(head)), "masthead: carries no chip and no prices line now that the bar does", text(head));
  r.unmount();

  const busy = page({ fetching: true });
  check(/\bupdating\b/.test(text(busy.container.querySelector(".bar"))), "bar: says 'updating' while prices are fetched");
  busy.unmount();

  const liveA = fixtureAnalysis("cross");
  const lv = page({ analysis: { status: "ready", value: liveA } });
  const lb = text(lv.container.querySelector(".bar"));
  check(!/\bexample\b/.test(lb) && lb.includes(`Prices to ${format(liveA.asOf, "date")}`), "bar: a live analysis is not labelled example", lb);
  lv.unmount();
}

// ---- (b) ledger:boundary -------------------------------------------------------------------------
{
  // The app's side: st.stop() inside a tab's `with` block ends the script, so every later tab is
  // never built. Find each tab block in portfolio_app.py and the ones that can stop.
  const starts = [];
  ORACLE.forEach((l, i) => {
    const m = /^with tab(\d):/.exec(l);
    if (m) starts.push({ tab: Number(m[1]), line: i + 1 });
  });
  const stops = starts.filter((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].line : ORACLE.length;
    return ORACLE.slice(s.line, end - 1).some((l) => /\bst\.stop\(\)/.test(l));
  });
  check(starts.length === 6 && stops.some((s) => s.tab === 4) && stops.some((s) => s.tab === 5),
    "ledger:boundary: the app's tabs 4 and 5 each hold an st.stop() that leaves every later tab unbuilt (1483, 1727)",
    stops.map((s) => s.tab).join(","));

  // The port's side: a tab that throws leaves one named line, the chrome, and the other tabs.
  const Throws = () => {
    throw new Error("tab exploded");
  };
  let r = null;
  try {
    r = quietly(() => expectUncaught(() => page({}, { ...STAND_TABS, returns: Throws })));
  } catch (err) {
    check(false, "ledger:boundary: the port shows one line naming the failed tab", `the whole page threw: ${err.message}`);
  }
  if (r) {
  // The boundary's fallback line, whatever its role: every alert or status line in the main column.
  const lines = () => [...r.container.querySelectorAll("main [role=alert], main [role=status], main .boundary")].filter((e) => text(e));
  check(lines().length === 1 && text(lines()[0]).includes(TAB_LABELS.returns),
    "ledger:boundary: the port shows one line naming the failed tab", lines().map(text).join(" | "));
  check(!!r.container.querySelector(".masthead") && !!r.container.querySelector(".app-tabs [role=tablist]"), "ledger:boundary: the masthead and the chapter row survive a failed tab");
  check(!!r.container.querySelector('[data-tab="risk"]'), "ledger:boundary: the port's next tab in the same chapter renders under the failed one");
  const next = byLabel(r.container.querySelector(".app-tabs"), CHAPTER_LABELS.diversification);
  if (next) quietly(() => click(next));
  check(!!r.container.querySelector('[data-tab="correlation"]') && lines().length === 0,
    "ledger:boundary: the port's next chapter renders after the failed one");
  r.unmount();
  }
}

// ---- the chapter row and its panel: tab / tabpanel ids tie each to the other -----------------------
// Five chapters; a chapter's panel holds its tabs, in CHAPTER_TABS' order, each in its own part (section-<tab>).
{
  const r = page({});
  const row = r.container.querySelector(".app-tabs [role=tablist]");
  const pills = row ? [...row.querySelectorAll("[role=tab]")] : [];
  check(row?.getAttribute("aria-label") === "Chapters" && pills.length === CHAPTER_IDS.length &&
    pills.every((t, i) => t.id === `chapter-tab-${CHAPTER_IDS[i]}` && t.getAttribute("aria-controls") === `chapter-panel-${CHAPTER_IDS[i]}` && text(t) === CHAPTER_LABELS[CHAPTER_IDS[i]]),
    "chapters: five pills in reading order, each with an id and aria-controls naming its panel", pills.map((t) => `${t.id}>${t.getAttribute("aria-controls")}`).join(" "));
  // The one panel on the page is the selected pill's, labelled by that pill, holding exactly its chapter's tabs.
  const panelOk = (id) => {
    const panels = [...r.container.querySelectorAll("[role=tabpanel]")];
    const on = pills.find((t) => t.getAttribute("aria-selected") === "true");
    const label = panels[0] ? r.container.querySelector(`#${panels[0].getAttribute("aria-labelledby")}`) : null;
    const held = panels[0] ? [...panels[0].querySelectorAll("[data-tab]")].map((e) => e.getAttribute("data-tab")) : [];
    const parts = panels[0] ? [...panels[0].querySelectorAll("[data-section]")].map((e) => e.id) : [];
    return panels.length === 1 && on?.getAttribute("aria-controls") === panels[0].id && panels[0].id === `chapter-panel-${id}` &&
      label === on && text(label) === CHAPTER_LABELS[id] && JSON.stringify(held) === JSON.stringify(CHAPTER_TABS[id]) &&
      JSON.stringify(parts) === JSON.stringify(CHAPTER_TABS[id].map((t) => `section-${t}`));
  };
  check(panelOk("performance"), "chapters: the active chapter is the role=tabpanel, labelled by the selected pill, holding its two tabs in order");
  for (const id of ["diversification", "build", "holdup"]) {
    click(byLabel(row, CHAPTER_LABELS[id]));
    check(panelOk(id), `chapters: switching to ${id} moves the panel's id and label to its pill, and shows exactly its tabs`);
  }
  // The Overview: no tab; it opens on the page's question.
  click(byLabel(row, CHAPTER_LABELS.overview));
  const ovPanel = r.container.querySelector("[role=tabpanel]");
  check(panelOk("overview") && !!ovPanel?.querySelector("[data-overview] h1"), "chapters: the Overview holds no tab and opens on the question");
  r.unmount();
}

// ---- a card that failed draws again on the next analysis, on every tab ------------------------------
// App resets each tab's own Boundary on a new analysis, but the tab stays mounted when only the rate or the
// prices change, so a CARD Boundary with no resetKey kept its "could not be shown" line until the reader
// left the tab. Each real tab, inside a Boundary as App mounts it, gets an analysis whose daily returns
// throw, then a good one: something must fail the first time and nothing may stay failed the second.
{
  const poisoned = new Proxy(EX, { get: (t, k) => { if (k === "returns") throw new Error("poisoned returns"); return Reflect.get(t, k); } });
  const props = (analysis) => ({ analysis, settings: EX_SETTINGS, level: "plain", weights: {}, setWeights() {}, requestSettings() {} });
  const mount = (id, analysis) => h(Boundary, { name: TAB_LABELS[id], resetKey: analysis }, h(TABS[id], props(analysis)));
  for (const id of TAB_IDS) {
    let failed = [];
    let after = ["never rendered"];
    try {
      // Every More row and fold opened, as a reader would: a closed row draws no card that could fail.
      const r = quietly(() => expectUncaught(() => openAll(render(mount(id, poisoned)))));
      failed = [...r.container.querySelectorAll(".boundary")].map(text);
      quietly(() => r.rerender(mount(id, { ...EX })));
      after = [...r.container.querySelectorAll(".boundary")].map(text);
      r.unmount();
    } catch (err) {
      after = [`threw: ${err.message}`];
    }
    check(failed.length > 0 && after.length === 0, `boundary: every ${id} card that failed draws again on the next analysis`,
      `failed: ${failed.join(" | ")} / after: ${after.join(" | ")}`);
  }
}

// ---- every tab opens on its finding: the same element and class on all six, above any section -----
// The REAL tabs here, on the baked example, not the stand-ins the rest of this suite uses, each read in its own
// part of its chapter.
{
  const r = page({ chapter: "overview" }, TABS);
  const row = r.container.querySelector(".app-tabs [role=tablist]");
  const seen = [];
  for (const id of TAB_IDS) {
    click(byLabel(row, CHAPTER_LABELS[chapterOf(id)]));
    const panel = r.container.querySelector(`[role=tabpanel] #section-${id}`);
    const first = panel?.querySelector("h1, h2, h3, h4, h5, h6");
    const finding = first ? text(first) : "";
    seen.push(`${id}: ${first?.tagName}.${first?.className} "${finding.slice(0, 40)}"`);
    // The walk-forward tab is the one exception, by name: it opens on its section heading and the switch
    // between its two segments, and each segment states its own finding under them.
    // Risk is the second half of Performance, which states the chapter's one finding above it: it opens on its
    // More list, and the Drawdowns row carries what was its finding.
    if (id === "risk") {
      check(first?.tagName === "H3" && first.classList.contains("more-head") && !!panel.querySelector("#perf-risk-drawdowns .more-finding"),
        "tabs: the risk part opens on its More list's heading, under Performance's finding", seen.at(-1));
      continue;
    }
    if (id === "walkforward") {
      check(first?.tagName === "H2" && first.classList.contains("slug-text") && finding === "Walk-forward test",
        "tabs: the walkforward tab's first heading is its section heading, Walk-forward test, above its two segments", seen.at(-1));
      continue;
    }
    check(first?.tagName === "H2" && first.classList.contains("tab-finding") && /[.?]$/.test(finding) && !/NaN|undefined/.test(finding),
      `tabs: the ${id} tab's first heading is its finding, an h2.tab-finding that ends as a sentence`, seen.at(-1));
  }
  r.unmount();
}

// ---- (c) nothing ready: a named message in place of the chapters ---------------------------------------
{
  const e = page({ analysis: { status: "error", name: "prices", message: "The price service did not answer." } });
  const t = text(e.container);
  check(t.includes("prices") && t.includes("The price service did not answer.") && !!e.container.querySelector("main [role=alert]"),
    "failed analysis: its name and message show where the chapters go", t);
  check(!e.container.querySelector("[data-tab]") && !e.container.querySelector(".app-tabs"), "failed analysis: no tab switch and no tab");
  e.unmount();

  const failure = { ok: false, error: "too-few-downloaded", message: MESSAGES["too-few-downloaded"], events: [] };
  const f = page({ analysis: { status: "loading" }, failure });
  check(text(f.container.querySelector("main")).includes(MESSAGES["too-few-downloaded"]), "failed analysis: a first fetch that failed shows the app's message, not a spinner");
  f.unmount();

  const l = page({ analysis: { status: "loading" } });
  check(text(l.container.querySelector("main")).length > 0, "loading: the main column says so, never a blank");
  check(!l.container.querySelector("main h1"), "loading: a chapter other than the Overview shows no question");
  l.unmount();

  // On the Overview the question is asked while the prices load, above the loading line.
  const q = page({ analysis: { status: "loading" }, chapter: "overview" });
  const h1 = q.container.querySelector("main h1");
  const wait = q.container.querySelector("main [role=status]");
  check(text(h1 ?? {}) === QUESTION && !!wait && !!(h1.compareDocumentPosition(wait) & window.Node.DOCUMENT_POSITION_FOLLOWING),
    "loading: the Overview asks its question above the loading line", text(q.container.querySelector("main") ?? {}));
  q.unmount();

  const kept = page({ failure });
  const kt = text(kept.container.querySelector("main"));
  check(kt.includes(MESSAGES["too-few-downloaded"]) && kt.includes("previous settings") && !!kept.container.querySelector('[data-tab="returns"]'),
    "failed update: the message shows beside the analysis still on screen, tabs kept", kt);
  kept.unmount();
  const quiet = page({});
  check(!quiet.container.querySelector(".status-alert, .status-wait"), "ready and up to date: the status line renders nothing");
  quiet.unmount();
}

// ---- (d) the hindsight card's numbers: one sentence, four Sharpe plates --------------------------------
{
  const t = EX.tangency;
  const plates = snapshotPlates(EX);
  // The Optimization tab's summary table on the same analysis: every plate is that table's own figure.
  const table = OPT.summaryTable(EX, OPT.customWeights(EX, {}));
  const rowSharpe = (name) => (table.status === "ready" ? table.value.rows.find((r) => r.portfolio === name)?.sharpe : undefined);
  const want = [
    ["Equal-Weight Sharpe", rowSharpe("Equal-Weight"), "num3", "ew_sharpe"],
    ["Tangency Sharpe (in-sample)", t.sharpe, "num3", "best_sharpe"],
    ["GMV Sharpe (in-sample)", rowSharpe("GMV"), "num3", "gmv_sharpe"],
    [`${EX.benchLabel} Sharpe`, rowSharpe(EX.benchLabel), "num3", "bench_sharpe"],
  ];
  check(want.every(([, v]) => Number.isFinite(v)) && t.sharpe === rowSharpe("Tangency") && rowSharpe(EX.benchLabel) === EX.benchStats.sharpe &&
    JSON.stringify(plates.map((p) => [p.label, p.value, p.format, p.tip])) === JSON.stringify(want),
    "numbers: the four plates are the Sharpe ratios of equal weight, tangency, GMV and the benchmark, each the Optimization tab's own figure, in num3",
    JSON.stringify([plates, want]));
  // The same to the last bit on two more baskets. On the example a second way of reaching equal weight's
  // Sharpe (its daily return series through annualizedStats) happens to agree with the table bit for bit;
  // on the sector fixture it does not, so a plate computed that way goes red here.
  const strict = ["sectors", "megacap"].map((name) => {
    const A = fixtureAnalysis(name);
    const tb = OPT.summaryTable(A, OPT.customWeights(A, {}));
    const row = (n) => (tb.status === "ready" ? tb.value.rows.find((r) => r.portfolio === n)?.sharpe : undefined);
    const got = snapshotPlates(A).map((p) => p.value);
    const exp = [row("Equal-Weight"), row("Tangency"), row("GMV"), row(A.benchLabel)];
    return { name, ok: exp.every(Number.isFinite) && got.every((v, i) => v === exp[i]), got, exp };
  });
  check(strict.every((x) => x.ok), "numbers: on the sector and mega-cap fixtures too, every plate is the Optimization tab's figure to the last bit", JSON.stringify(strict.filter((x) => !x.ok)));
  // The two fitted portfolios say in-sample; equal weight and the benchmark, which nothing was fitted to, do not.
  check(plates.map((p) => /\(in-sample\)$/.test(p.label)).join() === "false,true,true,false" && !/fit|optimi|in-sample/i.test(plates[0].label),
    "numbers: in-sample on the tangency and GMV plates only; the equal-weight label says nothing of fitting", plates.map((p) => p.label).join(" | "));
  const r = page({ chapter: "overview" });
  const card = openNumbers(r.container);
  const shown = text(card ?? {});
  check(want.every(([label, v, f]) => shown.includes(label) && shown.includes(format(v, f))), "numbers: every plate renders its label and figure in the hindsight card's numbers", shown);
  const sentence = finding(EX);
  const ewS = format(rowSharpe("Equal-Weight"), "num3");
  check(shown.includes(sentence) && sentence.includes(format(t.sharpe, "num3")) && sentence.endsWith(`; equal weight earned ${ewS}.`) &&
    sentence.includes(monthYear(EX.prices.dates[0])) && sentence.includes(monthYear(EX.asOf)) && !sentence.includes(EX.benchLabel),
    "numbers: the sentence states the tangency's Sharpe against equal weight's over the price span, the benchmark left to its plate", sentence);
  // The assets by name, in the page's order, up to six; above six, by count.
  const named = `${EX.tickers.slice(0, -1).join(", ")} and ${EX.tickers.at(-1)}`;
  check(EX.tickers.length === 5 && sentence.startsWith(`On ${named}, with hindsight, `),
    "numbers: the sentence names itself, the basket's tickers in order with hindsight, before any figure", sentence);
  const six = ["SPY", "AGG", "GLD", "VNQ", "EFA", "TLT"];
  const seven = [...six, "DBC"];
  const back = [...EX.tickers].reverse();
  check(assetsOf(six) === "SPY, AGG, GLD, VNQ, EFA and TLT" && assetsOf(seven) === "these 7 assets" && assetsOf(["SPY", "AGG"]) === "SPY and AGG" &&
    finding({ ...EX, tickers: seven }).startsWith("On these 7 assets, with hindsight, ") &&
    finding({ ...EX, tickers: back }).startsWith(`On ${back.slice(0, -1).join(", ")} and ${back.at(-1)}, with hindsight, `),
    "numbers: up to six tickers are named in the order the page holds them, seven or more are counted", `${assetsOf(six)} | ${assetsOf(seven)}`);
  // On a published basket the live tangency figure is recomputed in-sample, never the published one, and
  // the sentence says so right after it; on any other basket it says the same, so the mark never comes and goes.
  const through = `(in-sample, recomputed on prices through ${format(EX.asOf, "date")})`;
  const onSet = (a, set) => finding({ ...a, tickers: [...set.tickers].reverse() });
  const high = exampleAnalysis({ rf: 0.4 });
  const marked = P.PUBLISHED_SETS.flatMap((set) => [onSet(EX, set), onSet(high, set)]);
  check(EX.tangency?.beatsRf === true && high.tangency?.beatsRf === false &&
    marked.every((s, i) => s.includes(`${format((i % 2 ? high : EX).tangency.sharpe, "num3")}${i % 2 ? " " : " of annual excess return per unit of volatility "}${through}`)),
    "numbers: on a published basket the tangency Sharpe is marked in-sample and recomputed, with the last price day", marked.join(" | "));
  // Ten tickers that are neither the default basket nor any preset, published or not.
  const tenOther = ["AAPL", "MSFT", "JPM", "XOM", "KO", "PG", "V", "UNH", "HD", "CAT"];
  const presetKeys = [...PRESETS.map((p) => p.tickers), ...P.PUBLISHED_SETS.map((x) => x.tickers.join(", "))].map((t) => parseTickers(t).sort().join(","));
  const other = [finding({ ...EX, tickers: tenOther }), finding({ ...high, tickers: tenOther })];
  check(!presetKeys.includes([...tenOther].sort().join(",")) &&
    other.every((s, i) => s.includes(`${format((i ? high : EX).tangency.sharpe, "num3")}${i ? " " : " of annual excess return per unit of volatility "}${through}`)),
    "numbers: on a ten-ticker basket that is no preset the tangency Sharpe carries the same in-sample, recomputed mark", other.join(" | "));
  // Every branch measures against equal weight: the rate nothing beats, and the failed solve.
  const highEw = OPT.portRow(high, high.ew);
  const failedA = exampleAnalysis({ allowShort: true, rf: 0.4 });
  const failedEw = OPT.portRow(failedA, failedA.ew);
  const hs = finding(high);
  const fs = finding(failedA);
  check(hs.startsWith(`On ${named}, held long only, with hindsight, no mix earned more than`) &&
    hs.endsWith(`against ${format(highEw.sharpe, "num3")} for equal weight.`) && !hs.includes(high.benchLabel) &&
    fs.includes(`failed for ${named} with short positions allowed`) &&
    fs.endsWith(`equal weight returned ${format(failedEw.mu, "pct2")} a year at ${format(failedEw.sigma, "pct2")} volatility.`) && !fs.includes(failedA.benchLabel),
    "numbers: with no mix above the rate, and with a failed solve, the sentence names the tickers and measures against equal weight", `${hs} | ${fs}`);
  check(fs.startsWith(`The tangency optimisation failed for ${named} `), "numbers: the failed solve's sentence says tangency alone, the word on its plate", fs);
  r.unmount();
}

// ---- (d1) the app's Snapshot against the port's plates -----------------------------------------
{
  // The app's side (1205-1208): its four st.metric calls, read out of portfolio_app.py.
  const calls = ORACLE.map((l) => /^snap_cols\[(\d)\]\.metric\((f?"[^"]*")/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]);
  check(JSON.stringify(calls) === JSON.stringify([["0", '"Best Sharpe (Tangency)"'], ["1", '"Tangency Return"'], ["2", 'f"{bench_label_saved} Return"'], ["3", 'f"{bench_label_saved} Volatility"']]),
    "ledger:snapshot-plates the app's Snapshot is the tangency's Sharpe and return and the benchmark's return and volatility", JSON.stringify(calls));
  // The port's side: four Sharpe ratios; the tangency's return and the benchmark's return and volatility are in
  // the Overview growth chart's numbers and in the Optimization tab's summary table, as percentages.
  const labels = snapshotPlates(EX).map((p) => p.label);
  const rows = OPT.summaryTable(EX, OPT.customWeights(EX, {}));
  const row = (name) => (rows.status === "ready" ? rows.value.rows.find((x) => x.portfolio === name) : undefined);
  const pct = rows.status === "ready" ? rows.value.columns.filter((c) => c.format === "pct2").map((c) => c.key) : [];
  const mixes = mixRows(EX, EX_SETTINGS.amount);
  check(labels.length === 4 && labels.every((l) => / Sharpe( \(in-sample\))?$/.test(l)) &&
    row("Tangency")?.mu === EX.tangency.mu && row(EX.benchLabel)?.mu === EX.benchStats.mu && row(EX.benchLabel)?.sigma === EX.benchStats.sigma &&
    pct.includes("mu") && pct.includes("sigma") &&
    mixes[0].mu === row("Tangency")?.mu && mixes.at(-1).mu === EX.benchStats.mu && mixes.at(-1).sigma === EX.benchStats.sigma,
    "ledger:snapshot-plates the port's plates are four Sharpe ratios; the tangency return and the benchmark's return and volatility are in the growth chart's numbers and the Optimization tab's summary table",
    `${labels.join(" | ")} / ${JSON.stringify([row("Tangency"), row(EX.benchLabel)])}`);
}

// ---- (d2) the published result: quoted, dated, linked once, in the hindsight card ----------------------
{
  // The published figures written out a second time, so a slip in either copy goes red. They are the
  // site's, character for character (the negative carries U+2212, as the site prints it).
  const nine = P.PUBLISHED_SETS.map((x) => [x.name, x.tickers.join(" "), x.ew, x.gmv, x.tangency]);
  check(JSON.stringify(nine) === JSON.stringify([
    ["Five mega-caps", "AAPL MSFT GOOGL AMZN JPM", "0.864", "0.710", "0.659"],
    ["Seven sector ETFs", "XLK XLF XLV XLE XLI XLP XLY", "0.915", "0.450", "0.661"],
    ["Cross-asset", "VTI AGG GLD VNQ EFA", "0.704", "−0.247", "0.883"],
  ]) && P.MEGA_CAP_IN_SAMPLE === "1.107" && P.MEGA_CAP_IN_SAMPLE_END === "2026-09-04" && P.MEGA_CAP_IN_SAMPLE_RF === 0.02 && P.PUBLISHED_WHEN === "Sep 2026" &&
    P.PUBLISHED_URL === "https://masonjbennett.com/projects#portfolio-method" && P.PUBLISHED_HOLDS === 6 &&
    P.CROSS_AGG_INTO_2022 === "95.1%" && JSON.stringify(P.MEGA_CAP_APPLE) === JSON.stringify(["41.7%", "3.8%", "6.4%", "21.0%", "44.8%"]),
    "published: the constants are the nine published Sharpe ratios, 1.107 and its window end and rate, the six holds, the AGG and Apple weights, the date and the method note's address",
    JSON.stringify([nine, P.CROSS_AGG_INTO_2022, P.MEGA_CAP_APPLE]));
  check(P.CARD_SENTENCE.includes(`${P.MEGA_CAP_IN_SAMPLE} in-sample Sharpe became ${P.PUBLISHED_SETS[0].tangency} out of sample`) &&
    P.CARD_SENTENCE.includes("over six rolling one-year holding periods"),
    "published: the site's sentence carries 1.107, 0.659 and the six one-year holds", P.CARD_SENTENCE);

  const WEB = new URL("../", import.meta.url);
  const srcFiles = (dir) => readdirSync(new URL(dir, WEB), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? srcFiles(`${dir}${e.name}/`) : /\.tsx?$/.test(e.name) && e.name !== "published.ts" ? [readFileSync(new URL(dir + e.name, WEB), "utf8")] : []);
  const readers = srcFiles("src/").join("\n");
  const unread = Object.keys(P).filter((k) => !new RegExp(`\\b${k}\\b`).test(readers));
  check(unread.length === 0, "published: every figure quoted in published.ts is read somewhere on the page, so none is a spare copy", unread.join(" "));

  // The quote in the hindsight card's numbers, on each published set and on two baskets that are none: the
  // site's sentence word for word, only published figures beside it (the basket's set, or the mega-caps),
  // dated, and the method note linked once.
  const mega = P.PUBLISHED_SETS[0];
  const allowed = new Set([...P.PUBLISHED_SETS.flatMap((x) => [x.ew, x.gmv, x.tangency]), P.MEGA_CAP_IN_SAMPLE, P.PUBLISHED_WHEN.split(" ")[1],
    P.MEGA_CAP_IN_SAMPLE_END.slice(0, 4), format(P.MEGA_CAP_IN_SAMPLE_RF, "pct1")]);
  const baskets = [...P.PUBLISHED_SETS.map((x) => [x.name, [...x.tickers].reverse()]), ["ten others", ["SPY", "QQQ", "IWM", "EFA", "EEM", "AGG", "TLT", "GLD", "VNQ", "DBC"]], ["four", EX.tickers.slice(0, 4)]];
  const faults = [];
  for (const [name, tickers] of baskets) {
    const q = publishedSetOf(tickers) ?? mega;
    const needed = [q.ew, q.gmv, q.tangency, ...(q === mega ? [P.MEGA_CAP_IN_SAMPLE] : [])];
    const r = render(h(Overview, { analysis: { ...EX, tickers }, amount: 10000, level: "plain", setTickers() {} }));
    openNumbers(r.container);
    const strip = r.container.querySelector("#overview-hindsight .ov-published");
    const st = text(strip ?? {});
    const figures = st.match(/[−-]?\d+(?:\.\d+)?%?/g) ?? [];
    const links = [...(strip?.querySelectorAll("a") ?? [])];
    if (!strip) faults.push(`${name}: no quote`);
    else {
      if (text(strip.querySelector("blockquote") ?? {}) !== P.CARD_SENTENCE) faults.push(`${name}: the site's sentence is not quoted word for word`);
      const stray = figures.filter((x) => !allowed.has(x));
      if (stray.length) faults.push(`${name}: figures not among the published constants: ${stray.join(" ")}`);
      const gone = needed.filter((x) => !figures.includes(x));
      if (gone.length) faults.push(`${name}: missing ${gone.join(" ")}`);
      if (!st.includes(`published ${P.PUBLISHED_WHEN}`)) faults.push(`${name}: not dated "published ${P.PUBLISHED_WHEN}"`);
      if (links.length !== 1 || links[0].getAttribute("href") !== P.PUBLISHED_URL || links[0].hasAttribute("target"))
        faults.push(`${name}: links ${links.map((a) => a.getAttribute("href")).join(" ")}`);
    }
    r.unmount();
  }
  check(faults.length === 0,
    "published: in the hindsight card's numbers the site's sentence is quoted word for word, only published figures beside it (the basket's set, or the mega-caps), dated, the method note linked once",
    faults.join("; "));
}

// ---- (d2a) the figures line quotes the basket's own published set, when it is one ------------------
{
  const mega = P.PUBLISHED_SETS[0];
  // Exactly one of the three sets, as a set: any order, any case; nothing more, nothing less.
  const same = P.PUBLISHED_SETS.every((x) => publishedSetOf([...x.tickers].reverse().map((t) => t.toLowerCase())) === x);
  const near = P.PUBLISHED_SETS.flatMap((x) => [publishedSetOf(x.tickers.slice(1)), publishedSetOf([...x.tickers, "SPY"])]);
  const presets = PRESETS.map((p) => [p.tickers, publishedSetOf(parseTickers(p.tickers))]);
  const exact = (tickers) => P.PUBLISHED_SETS.some((x) => [...x.tickers].sort().join() === parseTickers(tickers).sort().join());
  check(same && near.every((x) => x === null) && publishedSetOf([]) === null && publishedSetOf(null) === null &&
    presets.some(([, x]) => x === null) && presets.every(([t, x]) => (x !== null) === exact(t)),
    "figures line: a basket is a published set only with exactly its tickers, in any order or case; a preset that overlaps one is not it",
    presets.map(([t, x]) => `${t} -> ${x?.name ?? "none"}`).join(" | "));
  // The matcher's own guards, for a caller whose tickers have not been through parseTickers: a symbol padded
  // with spaces still counts, and a set with one symbol repeated is not that set.
  const padded = P.PUBLISHED_SETS.map((x) => publishedSetOf(x.tickers.map((t, i) => (i % 2 ? ` ${t.toLowerCase()}` : `${t} `))) === x);
  const doubled = P.PUBLISHED_SETS.map((x) => publishedSetOf([...x.tickers, x.tickers[0]]) === null);
  check([...padded, ...doubled].every(Boolean), "figures line: a padded symbol still matches its set, and a repeated one matches none", JSON.stringify({ padded, doubled }));
  check(P.PUBLISHED_SETS.map(nameInSentence).join(" | ") === "five mega-caps | seven sector ETFs | cross-asset",
    "figures line: the set's name mid-sentence starts lower-case, its other letters as published", P.PUBLISHED_SETS.map(nameInSentence).join(" | "));

  // The two additions, written out a second time: on the mega-caps 1.107 says the window end and rate it was
  // scored on; on the other two sets a clause says the site's sentence's 1.107 and 0.659 are the mega-caps'.
  const terms = `, to ${monthYear(P.MEGA_CAP_IN_SAMPLE_END)} at ${format(P.MEGA_CAP_IN_SAMPLE_RF, "pct1")}`;
  const whose = `The sentence's ${P.MEGA_CAP_IN_SAMPLE} and ${mega.tangency} are the ${nameInSentence(mega)}'.`;
  check(terms === ", to Sep 2026 at 2.0%" && whose === "The sentence's 1.107 and 0.659 are the five mega-caps'." && whoseFigures() === whose &&
    P.CARD_SENTENCE.includes(` ${P.MEGA_CAP_IN_SAMPLE} `) && P.CARD_SENTENCE.includes(` ${mega.tangency} `),
    "figures line: 1.107's terms and the clause on whose figures the sentence quotes read from the constants, and the sentence carries both figures",
    `${terms} | ${whoseFigures()}`);

  // On each set: the line says the basket is that set, then quotes its three figures verbatim, in order, and how
  // they stood; then on the mega-caps nothing more, and on the other two the clause.
  const lines = P.PUBLISHED_SETS.map((x) => [x, figuresLine(publishedSetOf(x.tickers))]);
  const fault = lines.filter(([x, line]) => {
    const three = `equal weight ${x.ew} · GMV ${x.gmv} · tangency ${x.tangency}`;
    const tail = x === mega ? `${three} (${P.MEGA_CAP_IN_SAMPLE} in-sample${terms}); ` : `${three}; `;
    const end = x === mega ? "" : ` ${whose}`;
    return line !== `This basket is the published ${nameInSentence(x)} set. Sharpe out of sample: ${tail}${standing(x)}.${end}`;
  });
  check(fault.length === 0,
    "figures line: on a published set it says the basket is that set and quotes its three out-of-sample figures as published; 1.107 with its terms beside the mega-caps, and elsewhere only in the clause naming them",
    lines.map(([, l]) => l).join(" | "));
  const today = `${mega.name} (${mega.tickers.join(", ")}), Sharpe out of sample: equal weight ${mega.ew} · GMV ${mega.gmv} · tangency ${mega.tangency} (${P.MEGA_CAP_IN_SAMPLE} in-sample).`;
  check(figuresLine(null) === today && figuresLine(publishedSetOf(EX.tickers.slice(0, 4))) === today,
    "figures line: on any other basket it quotes the five mega-caps by name", figuresLine(null));
  // On the page: the line under the quote is the basket's own, marked with the set it names.
  const r = page({ chapter: "overview" });
  openNumbers(r.container);
  const el = r.container.querySelector(".ov-published-figures");
  check(text(el ?? {}) === figuresLine(publishedSetOf(EX.tickers)) && el?.getAttribute("data-set") === "Cross-asset",
    "figures line: the page prints the example basket's own line, marked with its set", text(el ?? {}));
  r.unmount();

  // The words on how the two fitted portfolios stood are read off the published strings, the minus sign included.
  const fake = (ew, gmv, tangency) => standing({ name: "x", tickers: [], ew, gmv, tangency });
  check(fake("0.500", "0.600", "0.700") === "GMV and tangency above equal weight" && fake("0.500", "−0.600", "0.400") === "equal weight above GMV and tangency" &&
    fake("0.500", "0.500", "0.600") === "tangency above equal weight, GMV level with it" && fake("−0.100", "−0.200", "0.100") === "tangency above equal weight, GMV below it" &&
    fake("0.300", "0.400", "0.200") === "tangency below equal weight, GMV above it",
    "figures line: the comparison words follow the figures, a negative written with U+2212 read as negative",
    [fake("0.500", "0.600", "0.700"), fake("−0.100", "−0.200", "0.100")].join(" | "));
  const num = (s) => Number(s.replace("−", "-"));
  const said = P.PUBLISHED_SETS.map((x) => {
    const w = standing(x);
    const both = /^equal weight above GMV and tangency$/.test(w) ? ["below", "below"] : /^GMV and tangency above equal weight$/.test(w) ? ["above", "above"] :
      (/^tangency (above|below|level with) equal weight, GMV (above|below|level with) it$/.exec(w) ?? []).slice(1).reverse();
    const rel = (v) => (num(v) > num(x.ew) ? "above" : num(v) < num(x.ew) ? "below" : "level with");
    return [w, both.join() === [rel(x.gmv), rel(x.tangency)].join()];
  });
  check(said.every(([, ok]) => ok), "figures line: on each published set the words agree with its own figures", said.map(([w]) => w).join(" | "));
  const banned = /\b(best|optimal\w*|winners?|race|outperform\w*|beat\w*|won)\b/i;
  check(![...lines.map(([, l]) => l), ...said.map(([w]) => w)].some((l) => banned.test(l)),
    "figures line: no word of contest in it", lines.map(([, l]) => l).join(" | "));
}

// ---- (d2c) the Overview: the question, the answer, the cards, the facts, the baskets, the byline --------
{
  const mega = P.PUBLISHED_SETS[0];
  const cross = P.PUBLISHED_SETS[2];
  const usd = (x) => format(x, "usd0");
  const ends = endsOf(EX, 10000);
  // Each mix's end is its daily returns compounded over the window from the amount.
  const path = (w) => portfolioReturns(EX.returns, w).reduce((c, x) => c * (1 + x), 10000);
  const near = (x, y) => Math.abs(x - y) < 1e-6;
  check(near(ends.ew, path(EX.ew)) && near(ends.tangency, path(EX.tangency.w)) && near(ends.gmv, path(EX.gmv.w)),
    "overview: what $10,000 became in each mix is its daily returns compounded over the window", JSON.stringify(ends));
  // The answer on the example (the cross-asset set): the live dollars with hindsight, then the set's two
  // published figures and the mega-caps' for contrast, each printed exactly as published.
  const L = lede(EX, 10000);
  check(L.set === cross && !L.run &&
    L.hindsight === `With hindsight, yes: the best-tradeoff mix turned $10,000 into ${usd(ends.tangency)}, against ${usd(ends.ew)} for an equal split.` &&
    L.without === `Without hindsight, in Mason's published test, it won on this basket (Sharpe ${cross.tangency} against ${cross.ew}) but lost on five mega-caps (${mega.tangency} against ${mega.ew}), because it is fitted to the past.`,
    "overview: on the cross-asset set the answer gives the live dollars, then the set's published figures and the mega-caps' as published", ledeText(L));
  // On the other two sets the verbs follow the published figures, and the contrast is the other similar-assets set.
  const onSets = P.PUBLISHED_SETS.map((x) => lede({ ...EX, tickers: [...x.tickers] }, 10000));
  const sec = P.PUBLISHED_SETS[1];
  check(onSets[0].without === `Without hindsight, in Mason's published test, it lost on this basket (Sharpe ${mega.tangency} against ${mega.ew}) and on seven sector ETFs (${sec.tangency} against ${sec.ew}), because it is fitted to the past.` &&
    onSets[1].without === `Without hindsight, in Mason's published test, it lost on this basket (Sharpe ${sec.tangency} against ${sec.ew}) and on five mega-caps (${mega.tangency} against ${mega.ew}), because it is fitted to the past.`,
    "overview: on the mega-caps and the sector ETFs the answer says it lost on both similar-assets sets", onSets.map((x) => x.without).join(" | "));
  // On any other basket no published figure at all, and the page offers the same test on it.
  const ten = ["SPY", "QQQ", "IWM", "EFA", "EEM", "AGG", "TLT", "GLD", "VNQ", "DBC"];
  const O = lede({ ...EX, tickers: ten }, 10000);
  check(O.set === null && O.run && !/\d/.test(O.without) && O.hindsight === L.hindsight,
    "overview: on a basket that is no published set the answer quotes no published figure and offers the test on this basket", ledeText(O));
  // The rate nothing beats, and the failed solve.
  const high = exampleAnalysis({ rf: 0.4 });
  const failedA = exampleAnalysis({ allowShort: true, rf: 0.4 });
  const Lh = lede(high, 10000);
  const Lf = lede(failedA, 10000);
  check(Lh.hindsight.startsWith(`With hindsight, no: no mix of these beat the ${format(0.4, "pct2")} risk-free rate`) &&
    Lf.hindsight.startsWith("The best-tradeoff mix could not be solved for this basket") && / the best-tradeoff mix (won|lost|tied) on this basket/.test(Lf.without),
    "overview: with no mix above the rate the answer says no, and with a failed solve it names the mix it could not solve", `${Lh.hindsight} | ${Lf.hindsight} | ${Lf.without}`);
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  const all = [L, ...onSets, O, Lh, Lf].map(ledeText);
  check(all.every((s) => words(s) <= 70), "overview: the answer is at most 70 words on every basket and branch", all.map(words).join(" "));

  // The hindsight card's bars: the live figures with hindsight, the published strings without.
  const H = hindsight(EX);
  const bars = H.groups.flatMap((g) => g.bars);
  const ewS = snapshotPlates(EX)[0].value;
  const gmvS = snapshotPlates(EX)[2].value;
  check(H.title === "Hindsight flatters the optimizer" && H.groups.map((g) => g.label).join() === "Best-tradeoff mix,Equal split,Lowest-risk mix" &&
    bars.filter((b) => !b.hindsight).map((b) => b.text).join() === [cross.tangency, cross.ew, cross.gmv].join() &&
    bars.filter((b) => b.hindsight).map((b) => b.value).join() === [EX.tangency.sharpe, ewS, gmvS].join(),
    "overview: on a published set each mix's bar with hindsight is the live Sharpe, and without it the set's published figure", JSON.stringify(H.groups));
  const Ho = hindsight({ ...EX, tickers: ten });
  check(Ho.set === null && Ho.groups[0].bars.every((b) => b.hindsight) && Ho.groups[1].label === `${mega.name}, published` &&
    Ho.groups[1].bars.map((b) => b.text).join() === [P.MEGA_CAP_IN_SAMPLE, mega.tangency, mega.ew].join() && Ho.sub.includes("this basket has not been published"),
    "overview: on any other basket its own bars are all with hindsight, and the mega-caps follow under their own name as the reference", JSON.stringify(Ho.groups));
  // The three facts: the first live, the other two published.
  const F = whyFacts(EX);
  const top = EX.tangency.w.indexOf(Math.max(...EX.tangency.w));
  check(F.length === 3 && F[0].big === `${format(EX.tangency.w[top], "pct1")} ${EX.tickers[top]}` && F[1].big === "3.8% to 44.8%" && F[2].big === "6 one-year tests" &&
    whyFacts(failedA).length === 2,
    "overview: the three facts are the live mix's largest holding, the published Apple range and the published holds; no live fact without a mix", JSON.stringify(F));

  // On the page: one h1, the question; the answer under it; the three baskets; the byline.
  const s = stand({ chapter: "overview" });
  const r = render(h(Harness, { wb: s.wb, tabs: STAND_TABS }));
  const main = r.container.querySelector("main");
  const h1s = [...r.container.querySelectorAll("h1")];
  check(h1s.length === 1 && text(h1s[0]) === QUESTION && readLede(main) === ledeText(lede(EX, s.wb.settings.amount)),
    "overview page: the question is the page's one h1, and the answer under it reads as the model writes it",
    `${h1s.map(text).join(" | ")} / ${readLede(main)}`);
  check(main.querySelectorAll(".ov-lede .term").length === 2 && !!main.querySelector("#overview-wealth") && !!main.querySelector("#overview-hindsight"),
    "overview page: the answer marks its two glossary terms, and the two cards follow it");
  const tries = [...main.querySelectorAll(".ov-try-button")];
  check(tries.map(text).join() === P.PUBLISHED_SETS.map((x) => x.name).join() && tries.filter((b) => b.getAttribute("aria-pressed") === "true").map(text).join() === "Cross-asset",
    "overview page: the three published baskets to try, the one on screen pressed", tries.map((b) => `${text(b)}:${b.getAttribute("aria-pressed")}`).join(" "));
  if (tries[0]) click(tries[0]);
  check(JSON.stringify(s.calls.settings.at(-1)) === JSON.stringify({ tickers: [...mega.tickers] }), "overview page: a basket's button loads its tickers", JSON.stringify(s.calls.settings.at(-1)));
  const built = main.querySelector(".ov-built");
  check(text(built?.querySelector("span") ?? {}) === `Built by ${A.AUTHOR} · ${A.CREDENTIAL}` &&
    [...(built?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href")).join() === [A.SOURCE_URL, P.PUBLISHED_URL, "?guide"].join(),
    "overview page: the byline in the resume's words, then the source, the method note and the guide", text(built ?? {}));
  r.unmount();
  // On another basket "Run the same test on this basket" opens Does it hold up? on Your basket.
  const so = stand({ chapter: "overview", analysis: { status: "ready", value: { ...EX, tickers: ten } } });
  const ro = render(h(Harness, { wb: so.wb, tabs: STAND_TABS }));
  const run = ro.container.querySelector(".ov-run");
  if (run) click(run);
  check(!!run && so.calls.chapter.at(-1) === "holdup" && so.calls.view.at(-1) === "basket",
    "overview page: on another basket, the run button opens Does it hold up? on Your basket", `${so.calls.chapter.at(-1)} ${so.calls.view.at(-1)}`);
  ro.unmount();
  // A published set's answer offers no run button: it is that set's own test, already quoted.
  const pr = page({ chapter: "overview" });
  check(!pr.container.querySelector(".ov-run"), "overview page: on a published set there is no run button");
  pr.unmount();
}

// ---- (d2b) the walk-forward tab: its two segments, and the two ways in that open the published one ------
{
  const { DEFAULT_START } = await import("../src/state/defaults.ts");
  const WF = await import("../src/tabs/WalkForward.tsx");
  const r = page({}, TABS);
  const row = r.container.querySelector(".app-tabs [role=tablist]");
  const panel = () => r.container.querySelector("[role=tabpanel]");
  const segment = () => panel()?.querySelector("[data-segment]")?.getAttribute("data-segment") ?? null;
  const segRow = () => panel()?.querySelector('[role=tablist][aria-label="Walk-forward"]');
  // The control sits in the Overview hindsight card's numbers: back on the Overview, the fold opened.
  const source = () => {
    if (!r.container.querySelector("#overview-hindsight")) click(byLabel(row, CHAPTER_LABELS.overview));
    openNumbers(r.container);
    return r.container.querySelector(".ov-published-source");
  };
  // Where a switch lands the reader. jsdom lays nothing out, so scrolling is read off the call: the elements
  // scrollIntoView was called on, since the last reset, and where the focus is.
  const landed = [];
  const proto = globalThis.HTMLElement.prototype;
  const hadScroll = Object.getOwnPropertyDescriptor(proto, "scrollIntoView");
  proto.scrollIntoView = function scrollIntoView() {
    landed.push(this);
  };
  const landedOn = (seg) => landed.length === 1 && landed[0].classList.contains("wf") && document.activeElement?.id === `walkforward-tab-${seg}`;
  const where = () => `${landed.map((e) => e.className).join(",") || "no scroll"}; focus on ${document.activeElement?.id || document.activeElement?.tagName}`;

  // The quote's source line: its first words open Does it hold up? on the published test, and its one link is
  // still the method note.
  const open = source()?.querySelector("button.text-button");
  const links = [...(source()?.querySelectorAll("a") ?? [])];
  check(!!open && text(open) === "Walk-forward test" && text(source()).startsWith("Walk-forward test, published ") &&
    open.getAttribute("title") === OPEN_PUBLISHED_TITLE && links.length === 1 && links[0].getAttribute("href") === P.PUBLISHED_URL,
    "walk-forward: the quote's source line turns its first words into the control, and keeps its one link", text(source() ?? {}));
  landed.length = 0;

  click(byLabel(row, CHAPTER_LABELS.holdup));
  check(segment() === "basket" && text(segRow()?.querySelector("[aria-selected=true]") ?? {}) === "Your basket",
    "walk-forward: the tab opens on Your basket", `${segment()}`);
  click(byLabel(segRow(), "As published"));
  check(segment() === "published" && text(segRow()?.querySelector("[aria-selected=true]") ?? {}) === "As published",
    "walk-forward: the switch shows As published", `${segment()}`);
  check(landed.length === 0, "walk-forward: the chapter row and the segment row switch where the reader already is, and scroll nothing", where());
  click(byLabel(row, CHAPTER_LABELS.performance));
  click(byLabel(row, CHAPTER_LABELS.holdup));
  check(segment() === "basket", "walk-forward: leaving its chapter and coming back by its pill opens Your basket again", `${segment()}`);
  click(byLabel(row, CHAPTER_LABELS.overview));
  const ctl = source().querySelector("button.text-button");
  landed.length = 0;
  click(ctl);
  check(segment() === "published" && row.querySelector("[aria-selected=true]")?.id === "chapter-tab-holdup",
    "walk-forward: the hindsight card's control switches to the tab on As published, without a reload", `${segment()}`);
  check(landedOn("published"), "walk-forward: the hindsight card's control lands the reader on the tab: scrolled into view, the As published segment focused", where());
  landed.length = 0;
  click(byLabel(row, CHAPTER_LABELS.performance));
  click(byLabel(row, CHAPTER_LABELS.holdup));
  check(landed.length === 0, "walk-forward: a landing is taken once; the chapter mounted again by its pill does not land again", where());
  click(byLabel(row, CHAPTER_LABELS.build));
  const note = panel()?.querySelector('[data-note="in-sample"] button.text-button');
  // The note itself must not link out to the method note; As published, which it opens, carries that link.
  const linksOut = !!panel()?.querySelector(`[data-note="in-sample"] a[href="${P.PUBLISHED_URL}"]`);
  landed.length = 0;
  if (note) click(note);
  check(!!note && segment() === "published" && row.querySelector("[aria-selected=true]")?.id === "chapter-tab-holdup" &&
    !linksOut,
    "walk-forward: the Optimization tab's in-sample note switches to the tab on As published", `${segment()}`);
  check(landedOn("published"), "walk-forward: the in-sample note lands the reader on the tab: scrolled into view, the As published segment focused", where());
  check(!!note && !!open && !!note.getAttribute("title") && note.getAttribute("title") === open.getAttribute("title"),
    "walk-forward: the in-sample note's control says where it goes, as the hindsight card's does", note?.getAttribute("title") ?? "(no title)");
  r.unmount();

  // "Rerun this set on fresh prices": the set's tickers on the published run's own terms, held to the test's
  // record (test/fixtures/walkforward.json): from the default start, an end the day after the last bar (the
  // price request's end is exclusive), the record's rate typed into the rail, shorting off.
  const record = JSON.parse(readFileSync(new URL("./fixtures/walkforward.json", import.meta.url), "utf8"));
  const next = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const asked = Object.values(record.sets).map((set) => [set, WF.rerunSettings(set.tickers)]);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(asked.length === 3 && asked.every(([set, x]) => same(x, { tickers: set.tickers, start: DEFAULT_START, end: next(set.last_bar), rf: record.rf, allowShort: false }) &&
    DEFAULT_START <= set.first_bar && set.last_bar === WF.PUBLISHED_LAST_BAR) && WF.PUBLISHED_RF === record.rf,
    "walk-forward: a rerun asks for the set's tickers from the default start through the day after its last bar, at the record's rate, long-only",
    JSON.stringify(asked.map(([, x]) => x)));

  // On the page: a set's button hands those settings to the rail, then shows Your basket and lands the reader on it.
  const s = stand({ chapter: "overview" });
  const rr = render(h(Harness, { wb: s.wb, tabs: TABS }));
  openNumbers(rr.container);
  click(rr.container.querySelector(".ov-published-source button.text-button"));
  landed.length = 0;
  const buttons = [...rr.container.querySelectorAll(".wfp-rerun-button")];
  const last = buttons.at(-1);
  const set = last?.closest("[data-set]")?.getAttribute("data-set");
  const asks = s.calls.settings.length;
  if (last) click(last);
  const seg = rr.container.querySelector("[role=tabpanel] [data-segment]")?.getAttribute("data-segment") ?? null;
  check(buttons.length === 3 && !!record.sets[set] && s.calls.settings.length === asks + 1 && same(s.calls.settings.at(-1), WF.rerunSettings(record.sets[set].tickers)) &&
    seg === "basket" && s.calls.view.at(-1) === "basket" && landedOn("basket"),
    "walk-forward: a set's rerun button asks the rail for that set on the published terms, then shows Your basket and lands the reader on it",
    `${set} ${JSON.stringify(s.calls.settings.at(-1))} ${seg}; ${where()}`);
  rr.unmount();
  if (hadScroll) Object.defineProperty(proto, "scrollIntoView", hadScroll);
  else delete proto.scrollIntoView;
}

// ---- (d3) plain words: no "best" or "optimal" as a label on the Overview, masthead, footer or what-if ----
// "Best-tradeoff" is one name, the plain name of the tangency portfolio, and never "best" on its own.
{
  const bad = /\b(best|optimal)\b(?!-tradeoff)/i;
  // The finding's three sentences: a tangency, a tangency that does not beat the rate, a failed solve.
  const noBeat = exampleAnalysis({ rf: 0.4 });
  const failed = exampleAnalysis({ allowShort: true, rf: 0.4 });
  const said = [EX, noBeat, failed].flatMap((a) => [finding(a), ledeText(lede(a, 10000)), hindsight(a).title, hindsight(a).sub, ...whyFacts(a).map((f) => f.text)]);
  check(EX.tangency?.beatsRf === true && noBeat.tangency?.beatsRf === false && failed.tangency === null,
    "plain words: the three analyses reach the three branches", `${EX.tangency?.beatsRf} ${noBeat.tangency?.beatsRf} ${failed.tangency}`);
  const labels = [EX, noBeat, failed].flatMap((a) => snapshotPlates(a).map((p) => p.label));
  // Rendered text of the Overview (both folds open), the what-if panel (open), the masthead and the footer,
  // the tooltips' own text included (ledger:plain-tip-words), and every accessible name on them.
  const names = [];
  const ov = render(h(Overview, { analysis: EX, amount: 10000, level: "plain", setTickers() {} }));
  openNumbers(ov.container);
  ov.container.querySelectorAll('.card-fold-button[aria-expanded="false"]').forEach((b) => click(b));
  const wf = render(h(WhatIfFold, { a: EX }));
  const fold = await openWhatIf(wf.container);
  check(!!fold?.open && wf.container.querySelectorAll("section.whatif").length === 1,
    "plain words: the what-if is read with its panel open", fold ? fold.outerHTML.slice(0, 160) : "no fold");
  const shown = [ov, wf, render(h(Masthead, { analysis: { status: "ready", value: EX }, fetching: false })), render(h(Footer))].map((r) => {
    r.container.querySelectorAll("[aria-label]").forEach((e) => names.push(e.getAttribute("aria-label")));
    const t = text(r.container);
    r.unmount();
    return t;
  });
  const hits = [...said, ...labels, ...shown].filter((x) => bad.test(x)).map((x) => x.match(bad)[0] + ": " + x.slice(0, 80));
  check(hits.length === 0, "plain words: no \"best\" or \"optimal\" in an Overview sentence, a plate label, the what-if, the masthead or the footer", hits.join(" | "));
  const loose = /\b(best|optimal)(?!-tradeoff)|optimally/i;
  const named = names.filter((x) => loose.test(x));
  const tipped = shown.filter((x) => /optimally/i.test(x));
  check(names.some((x) => /^About /.test(x)) && named.length === 0 && tipped.length === 0,
    "ledger:plain-tip-words the Overview's tips and accessible names call nothing best or optimal", [...named, ...tipped.map((x) => x.slice(0, 80))].join(" | "));
}

// ---- (d4) the tangency Sharpe plate carries one standard error, the engine's -----------------------
{
  const se = sharpeSE(portfolioReturns(EX.returns, EX.tangency.w), EX.rf);
  const plates = snapshotPlates(EX);
  const tan = plates.findIndex((p) => p.tip === "best_sharpe");
  check(Number.isFinite(se) && tan === 1 && plates[tan].label === "Tangency Sharpe (in-sample)" && plates[tan].se === se &&
    plates.every((p, i) => i === tan || p.se === undefined),
    "numbers: the tangency Sharpe plate's standard error is sharpeSE on the tangency portfolio's daily returns, and no other plate has one", `${plates[tan]?.se} ${se}`);
  const r = render(h(Overview, { analysis: EX, amount: 10000, level: "plain", setTickers() {} }));
  openNumbers(r.container);
  const shown = r.container.querySelectorAll(".ov-plates .plate")[tan];
  check(!!shown && text(shown.querySelector(".plate-se") ?? {}) === `± ${format(se, "num3")} SE` &&
    text(shown.querySelector(".plate-value") ?? {}) === format(EX.tangency.sharpe, "num3") && r.container.querySelectorAll(".ov-plates .plate-se").length === 1,
    "numbers: the plate prints the figure alone and plus or minus one standard error beside it", shown ? shown.innerHTML.slice(0, 200) : "no plate");
  r.unmount();
  const failed = exampleAnalysis({ allowShort: true, rf: 0.4 });
  const rf = render(h(Overview, { analysis: failed, amount: 10000, level: "plain", setTickers() {} }));
  openNumbers(rf.container);
  check(snapshotPlates(failed)[tan].se === null && rf.container.querySelectorAll(".ov-plates .plate").length === 4 && !rf.container.querySelector(".plate-se"),
    "numbers: no tangency, no standard error beside the dash");
  rf.unmount();
}

// ---- (e) ledger:failed-tangency ------------------------------------------------------------------
{
  // The app's side (1196-1202): when optimize_tangency fails, the EW weights and EW figures go
  // under the "Tangency" labels. Read the branch, then reproduce it with the engine.
  const src = ORACLE.join("\n");
  const branch = /if tan_res_snap\.success:[\s\S]{0,200}?else:\s*\n\s*tan_w_snap = ew_w_snap\s*\n\s*tan_mu_snap, tan_sig_snap, tan_sh_snap = ew_mu_snap, ew_sig_snap, ew_sh_snap/.test(src);
  // A real input with no tangency: shorting on and a 40% risk-free rate nothing beats.
  const a = exampleAnalysis({ allowShort: true, rf: 0.4 });
  const ew = portfolioPerformance(a.ew, a.m, a.S, a.rf);
  check(branch && a.tangency === null && Number.isFinite(ew.sharpe) && Number.isFinite(ew.mu),
    "ledger:failed-tangency: the app would print equal-weight figures under the Tangency labels (1200-1202)",
    `branch ${branch}, tangency ${a.tangency}, ew sharpe ${ew.sharpe}`);

  // The port's side: the plates are empty and say so, and the sentence says the solve failed.
  // Equal weight has a plate of its own now, under its own name; the tangency's holds the dash.
  const plates = snapshotPlates(a);
  const tan = plates.filter((p) => /^Tangency/.test(p.label));
  check(tan.length === 1 && tan[0].value === null, "ledger:failed-tangency: the port's Tangency plate holds no figure");
  const r = page({ analysis: { status: "ready", value: a }, chapter: "overview" });
  const shownFailed = text(openNumbers(r.container) ?? {});
  check(/optimisation failed/.test(shownFailed) && shownFailed.includes(DASH), "ledger:failed-tangency: the port's numbers say the optimisation failed", shownFailed);
  const cards = [...r.container.querySelectorAll(".ov-plates .plate")].map((p) => [text(p.querySelector(".plate-label") ?? {}), text(p)]);
  const tanCard = cards.find(([l]) => /^Tangency/i.test(l));
  const withEw = cards.filter(([, t]) => t.includes(format(ew.sharpe, "num3"))).map(([l]) => l);
  const sentence = text(r.container.querySelector(".ov-finding") ?? {});
  check(!!tanCard && tanCard[1].includes(DASH) && !tanCard[1].includes(format(ew.sharpe, "num3")) && withEw.length === 1 && /^Equal-Weight Sharpe/i.test(withEw[0]) &&
    sentence.includes(`equal weight returned ${format(ew.mu, "pct2")} a year`),
    "ledger:failed-tangency: the port shows no equal-weight stand-in: equal weight's figures appear only under its own name", JSON.stringify([cards, sentence]));
  r.unmount();
}

// ---- (f) the settings' fields, every group inline as the phone's sheet holds them -----------------------
function rail(over = {}) {
  const { wb, calls } = stand(over);
  const r = render(h(SettingsSheetBody, { settings: wb.settings, setSettings: wb.setSettings, level: wb.level, setLevel: wb.setLevel, rf: wb.rf }));
  return { r, calls, root: r.container };
}
{
  const { r, calls, root } = rail();
  const levels = root.querySelector('[aria-label="Explanation level"]');
  check(!!levels && ["Plain", "Finance", "Formula"].every((l) => byLabel(levels, l)), "rail: the level is a named three-way control", levels ? text(levels) : "none");
  check([...root.querySelectorAll(".set-group")].at(-1) === levels?.closest(".set-group"), "rail: the level group comes last, until it is retired");
  if (levels) click(byLabel(levels, "Finance"));
  check(calls.level.join() === "finance", "rail: choosing Finance sets the level", calls.level.join());

  // Tickers: presets apply at once; a typed list commits only when the app's checks pass.
  click(byLabel(root, PRESETS[1].name));
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ tickers: parseTickers(PRESETS[1].tickers) }) && field(root, "tickers").value === PRESETS[1].tickers,
    "rail: a preset puts its tickers in the box and applies them", JSON.stringify(calls.settings.at(-1)));
  const before = calls.settings.length;
  setValue(field(root, "tickers"), "AAPL, MSFT");
  key(field(root, "tickers"), "Enter");
  check(calls.settings.length === before && text(root).includes(MESSAGES["too-few"]), "rail: two tickers are refused with the app's message (1011)");
  setValue(field(root, "tickers"), "A,B,C,D,E,F,G,H,I,J,K");
  key(field(root, "tickers"), "Enter");
  check(calls.settings.length === before && text(root).includes(MESSAGES["too-many"]), "rail: eleven tickers are refused with the app's message (1014)");
  setValue(field(root, "tickers"), "vti, agg, gld");
  key(field(root, "tickers"), "Enter");
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ tickers: ["VTI", "AGG", "GLD"] }) && !text(root).includes(MESSAGES["too-many"]),
    "rail: a valid list commits, parsed, and the message clears", JSON.stringify(calls.settings.at(-1)));
  // Yahoo's alphabet: a share class, a coin and a currency pair commit (the app passes them to
  // yfinance, 1007); a symbol the price endpoint would refuse is named and nothing is fetched.
  setValue(field(root, "tickers"), "brk-b, BTC-USD, EURUSD=X");
  key(field(root, "tickers"), "Enter");
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ tickers: ["BRK-B", "BTC-USD", "EURUSD=X"] }),
    "rail: BRK-B, BTC-USD and EURUSD=X commit", JSON.stringify(calls.settings.at(-1)));
  const sym = calls.settings.length;
  setValue(field(root, "tickers"), "VTI, AGG, GL/D");
  key(field(root, "tickers"), "Enter");
  check(calls.settings.length === sym && text(root).includes(symbolMessage("GL/D")) && field(root, "tickers").getAttribute("aria-invalid") === "true",
    "rail: a symbol outside Yahoo's alphabet is refused, named, and not fetched", text(root.querySelector("[role=alert]") ?? root).slice(0, 160));
  setValue(field(root, "tickers"), "VTI, AGG, GLD");
  key(field(root, "tickers"), "Enter");

  // Dates. ledger:start-date-floor: the app's picker floors at 2009-01-01; the port's sets none.
  const call = ORACLE.find((l) => /st\.date_input\(\s*"Start"/.test(l)) ?? "";
  const m = /value=date\((\d{4}),\s*(\d+),\s*(\d+)\)/.exec(call);
  const floor = m && !/min_value/.test(call) ? `${Number(m[1]) - 10}-${pad(m[2])}-${pad(m[3])}` : null;
  check(floor === "2009-01-01", "ledger:start-date-floor: the app's Start picker passes no min_value, so Streamlit floors it at value minus ten years (702)", call.trim());
  const start = field(root, "start");
  check(!!start && !start.hasAttribute("min"), "ledger:start-date-floor: the port's start input sets no floor", start?.outerHTML);
  let n = calls.settings.length;
  setValue(start, "1995-01-03");
  check(calls.settings.length === n + 1 && calls.settings.at(-1).start === "1995-01-03", "ledger:start-date-floor: the port applies a start before 2009", JSON.stringify(calls.settings.at(-1)));
  n = calls.settings.length;
  setValue(start, "0002-01-01");
  check(calls.settings.length === n && /four-digit year/.test(text(root)), "rail: a half-typed year is not a price request");
  setValue(start, "2099-01-01");
  check(calls.settings.length === n && text(root).includes(MESSAGES.reversed), "rail: a start after the end is refused with the message");
  const d = new Date(now.getTime() - 100 * 86400000);
  setValue(start, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  check(calls.settings.length === n && text(root).includes(MESSAGES["short-range"]), "rail: a range under two years is refused with the app's message (1017)");

  // Everything else applies at once.
  setValue(field(root, "benchmark"), "^NDX");
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ benchmark: "^NDX" }), "rail: the benchmark applies");
  click(field(root, "allowShort"));
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ allowShort: true }), "rail: the shorting switch applies");
  // ledger:short-bounds-copy, the rail half. The app's toggle help (750-751) calls the short frontier
  // "unconstrained", while its own optimiser bounds each weight to [-1, 1] (780-782).
  const help = ORACLE.slice(746, 751).join(" ");
  const bounds = ORACLE.slice(777, 783).join(" ");
  check(/"Allow short positions"/.test(ORACLE[747]) && /unconstrained frontier/.test(ORACLE[750]) && /\[−1,\s*1\]/.test(bounds),
    "ledger:short-bounds-copy: the app's shorting help says 'unconstrained' (750-751) while its bounds are [−1, 1] (780-782)", help.trim());
  const shortGroup = field(root, "allowShort").closest(".set-group");
  const shortHelp = shortGroup ? text(shortGroup) : "";
  check(/each asset's weight is bounded to \[−1, 1\]/.test(shortHelp) && !/unconstrained/i.test(text(root)),
    "ledger:short-bounds-copy: the rail's shorting help states [−1, 1] per asset and never says unconstrained", shortHelp);
  n = calls.settings.length;
  // The starting amount: the same setting the growth charts' field writes, kept to this browser.
  setValue(field(root, "amount"), "25000");
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ amount: 25000 }), "rail: the starting amount applies", JSON.stringify(calls.settings.at(-1)));
  n = calls.settings.length;
  setValue(field(root, "amount"), "5");
  check(calls.settings.length === n && field(root, "amount").getAttribute("aria-invalid") === "true", "rail: an amount under the floor is refused and not applied");

  // A rate set here, with the way back to live.
  check(text(root).includes(LIVE.date) && field(root, "rf").value === String(Number((EX.rf * 100).toFixed(4))), "rail: a set rate shows beside the live one and its date", field(root, "rf").value);
  const back = byLabel(root, "Use the rate over the window");
  check(!!back, "rail: a set rate offers 'Use the rate over the window'");
  if (back) click(back);
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ rf: null }), "rail: 'Use the rate over the window' goes back to the live rate", JSON.stringify(calls.settings.at(-1)));
  r.unmount();
}
{
  const { r, calls, root } = rail({ settings: { ...EX_SETTINGS, rf: null, end: null } });
  const t = text(root);
  check(field(root, "end").value === TODAY && byLabel(root, "End today instead") === undefined, "rail: an end of null shows today", field(root, "end").value);
  check(t.includes(LIVE.date) && t.includes(LIVE.source) && field(root, "rf").value === "4.12" && !byLabel(root, "Use the rate over the window"),
    "rail: with no rate set, the live rate shows with its date and source", t.slice(0, 0) + field(root, "rf").value);
  setValue(field(root, "rf"), "5");
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ rf: 0.05 }), "rail: typing a rate overrides the live one", JSON.stringify(calls.settings.at(-1)));
  r.unmount();

  const down = rail({ settings: { ...EX_SETTINGS, rf: null }, rf: { status: "error", name: "rf", message: "down" } });
  check(field(down.root, "rf").value === String(RF_FALLBACK * 100) && /placeholder/.test(text(down.root)), "rail: an unreachable live rate says it uses the placeholder (711-713)");
  down.r.unmount();

  const { wb: bw } = stand({ fetching: true });
  const busy = render(h(BasketBar, { settings: bw.settings, setSettings: bw.setSettings, level: bw.level, setLevel: bw.setLevel, rf: bw.rf, fetching: true, analysis: { status: "loading" } }));
  check(/Fetching prices/.test(text(busy.container)), "bar: says when prices are being fetched");
  busy.unmount();
}

// ---- (f2) the basket bar: chips, panels, the drawer ----------------------------------------------------
function bar(over = {}) {
  const { wb, calls } = stand(over);
  const r = render(h(BasketBar, { settings: wb.settings, setSettings: wb.setSettings, level: wb.level, setLevel: wb.setLevel, rf: wb.rf, fetching: false, analysis: wb.analysis }));
  const panelOf = (btn) => document.getElementById(btn.getAttribute("aria-controls"));
  return { r, calls, root: r.container, panelOf };
}
{
  const { r, calls, root, panelOf } = bar({ settings: { ...EX_SETTINGS, tickers: ["VTI", "AGG", "GLD", "VNQ"] } });
  const add = byLabel(root, "+ Add");
  const tickersPanel = panelOf(add);
  check(!!add && add.getAttribute("aria-expanded") === "false" && tickersPanel?.hidden, "bar: the panels start closed");
  click(root.querySelector('[aria-label="Remove AGG"]'));
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ tickers: ["VTI", "GLD", "VNQ"] }), "bar: a chip's cross takes that ticker out, through the same checks",
    JSON.stringify(calls.settings.at(-1)));
  r.unmount();

  // A basket of three: removing one is refused, and the message opens the tickers' panel so it is in sight.
  const three = bar({ settings: { ...EX_SETTINGS, tickers: ["VTI", "AGG", "GLD"] } });
  const n3 = three.calls.settings.length;
  click(three.root.querySelector('[aria-label="Remove GLD"]'));
  const add3 = byLabel(three.root, "+ Add");
  check(three.calls.settings.length === n3 && add3.getAttribute("aria-expanded") === "true" && !three.panelOf(add3).hidden &&
    text(three.panelOf(add3)).includes(MESSAGES["too-few"]), "bar: a refused removal keeps the basket and opens the tickers' panel on the app's message (1011)");
  three.r.unmount();

  // + Add: the whole list, the cursor after it; Escape closes and hands focus back.
  const b = bar({ settings: { ...EX_SETTINGS, tickers: ["VTI", "AGG", "GLD"] } });
  const addB = byLabel(b.root, "+ Add");
  click(addB);
  const box = field(b.root, "tickers");
  check(addB.getAttribute("aria-expanded") === "true" && !b.panelOf(addB).hidden && box.value === "VTI, AGG, GLD, " && document.activeElement === box,
    "bar: + Add opens the list with room for the next ticker, and the cursor in it", box.value);
  setValue(box, "VTI, AGG, GLD, EFA");
  key(box, "Enter");
  check(JSON.stringify(b.calls.settings.at(-1)) === JSON.stringify({ tickers: ["VTI", "AGG", "GLD", "EFA"] }), "bar: a ticker typed after the list is added");
  key(box, "Escape");
  check(addB.getAttribute("aria-expanded") === "false" && b.panelOf(addB).hidden && document.activeElement === addB, "bar: Escape closes the panel and focus goes back to its button");

  // Baskets: the published sets first; a pick applies and closes.
  const baskets = byLabel(b.root, "Baskets");
  click(baskets);
  check(!b.panelOf(baskets).hidden && b.panelOf(addB).hidden, "bar: one panel at a time");
  click(byLabel(b.panelOf(baskets), PUBLISHED_PRESETS[0].name));
  check(JSON.stringify(b.calls.settings.at(-1)) === JSON.stringify({ tickers: parseTickers(PUBLISHED_PRESETS[0].tickers) }) && b.panelOf(baskets).hidden,
    "bar: a basket applies and its menu closes", JSON.stringify(b.calls.settings.at(-1)));

  // Assumptions: a drawer of the rate, the benchmark, shorting, the amount and the level; its button says what is set.
  const assume = b.root.querySelector(".bar-assumptions");
  const drawer = b.panelOf(assume);
  check(!!assume && drawer.hidden && !drawer.querySelector("[name=rf]"), "bar: the drawer starts closed, its fields not drawn");
  check(text(assume) === `Assumptions${assumptionsLabel(EX_SETTINGS, stand({}).wb.rf)}` && /^S&P 500 · rf \d+\.\d\d% · long only$/.test(assumptionsLabel(EX_SETTINGS, stand({}).wb.rf)),
    "bar: the Assumptions button carries the benchmark, the rate and the shorting setting", text(assume));
  click(assume);
  check(!drawer.hidden && ["rf", "benchmark", "allowShort", "amount"].every((nm) => !!field(drawer, nm)) && !!drawer.querySelector('[aria-label="Explanation level"]'),
    "bar: the drawer holds the rate, the benchmark, shorting, the amount and the level");
  click(assume);
  check(drawer.hidden, "bar: the same button closes it");
  b.r.unmount();
  // The bar, and the phone's chip row, stay at the top of the screen as the page scrolls.
  const rule = (file, sel) => {
    const css = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return new RegExp(`(^|\n)${sel.replace(".", "\.")} \{([^}]*)\}`).exec(css)?.[2] ?? "";
  };
  const held = (body) => /position:\s*sticky/.test(body) && /top:\s*0/.test(body);
  check(held(rule("chrome/BasketBar.css", ".bar")) && held(rule("App.css", ".app-chip")), "bar: the bar and the phone's chip row are held at the top as the page scrolls");
}

// ---- (g) the phone: a summary chip that opens the rail as a sheet ----------------------------------
{
  const s = { ...EX_SETTINGS, tickers: ["A", "B", "C", "D", "E"], start: "2019-01-01", end: null, rf: null };
  check(summaryText(s, { status: "ready", value: LIVE }) === `5 tickers · 2019 to today · rf ${format(0.0412, "pct1")}`, "chip: counts tickers, years and the live rate", summaryText(s, { status: "ready", value: LIVE }));
  check(summaryText({ ...s, end: "2024-06-30", rf: 0.05 }, { status: "ready", value: LIVE }) === `5 tickers · 2019 to 2024 · rf ${format(0.05, "pct1")}`, "chip: a set end year and a set rate win");
  check(summaryText(s, { status: "error", name: "rf", message: "x" }).endsWith(`rf ${format(RF_FALLBACK, "pct1")}`), "chip: an unreachable live rate shows the placeholder");
  let toggled = 0;
  const c = render(h(SummaryChip, { settings: s, rf: { status: "loading" }, open: false, onToggle: () => toggled++ }));
  click(c.container.querySelector("button"));
  check(toggled === 1 && c.container.querySelector("button").getAttribute("aria-expanded") === "false", "chip: a click asks to open the sheet");
  c.unmount();

  setMedia((q) => q === PHONE_QUERY);
  const r = page({});
  const chip = r.container.querySelector("button.chip");
  check(!!chip && !r.container.querySelector('[aria-label="Explanation level"]') && !r.container.querySelector(".bar"), "phone: the chip stands in for the basket bar");
  if (chip) click(chip);
  const sheet = document.querySelector("[role=dialog]");
  check(!!sheet && !!sheet.querySelector('[aria-label="Explanation level"]') && !!sheet.querySelector('[name="tickers"]'), "phone: the chip opens a sheet holding every setting");
  key(document.body, "Escape");
  check(!document.querySelector("[role=dialog]"), "phone: Escape closes the sheet");
  r.unmount();
  // The Overview on a phone: the question and the answer, the hindsight card's numbers shut at rest.
  const po = page({ chapter: "overview" });
  check(text(po.container.querySelector("main h1") ?? {}) === QUESTION && !!po.container.querySelector(".ov-lede") &&
    po.container.querySelector("#overview-hindsight .card-fold-button")?.getAttribute("aria-expanded") === "false",
    "phone: the Overview leads with the question and the answer, the numbers folded shut");
  po.unmount();
  // The what-if panel: it closes Build a portfolio, folded shut, below the chapter's tabs, and is not fetched
  // until the reader reaches for it (section (g2)). Opened by its line, it holds the one panel.
  const pb = page({ chapter: "build" });
  const wFold = pb.container.querySelector("[role=tabpanel] details.whatif-fold");
  const lastTab = [...pb.container.querySelectorAll("[role=tabpanel] [data-section]")].at(-1);
  check(!!wFold && !wFold.open && !wFold.querySelector("section.whatif") && !!lastTab && !!(lastTab.compareDocumentPosition(wFold) & window.Node.DOCUMENT_POSITION_FOLLOWING) &&
    text(wFold.querySelector("summary") ?? {}) === "What if one expected return were different?",
    "phone: the what-if panel folds behind a closed disclosure at the end of Build a portfolio", wFold ? wFold.outerHTML.slice(0, 160) : "no fold");
  await openWhatIf(pb.container);
  check(!!wFold?.open && !!wFold.querySelector("section.whatif input[type=range]") && pb.container.querySelectorAll("section.whatif").length === 1,
    "phone: opened by its line, the fold holds the what-if panel, once", wFold ? wFold.outerHTML.slice(0, 160) : "no fold");
  const elsewhere = ["overview", "performance", "diversification", "holdup"].filter((c) => {
    const x = page({ chapter: c });
    const has = !!x.container.querySelector("details.whatif-fold");
    x.unmount();
    return has;
  });
  check(elsewhere.length === 0, "the what-if fold is in Build a portfolio only", elsewhere.join(" "));
  pb.unmount();
  setMedia(() => false);
  const desk = page({});
  check(!desk.container.querySelector("button.chip") && !!desk.container.querySelector(".bar [name=tickers]") && !desk.container.querySelector("aside"),
    "desktop: the basket bar holds the settings, no chip and no side column");
  desk.unmount();
  const db = page({ chapter: "build" });
  const dFold = db.container.querySelector("[role=tabpanel] details.whatif-fold");
  check(!!dFold && !dFold.open && !dFold.querySelector("section.whatif") && text(dFold.querySelector("summary") ?? {}) === "What if one expected return were different?",
    "desktop: the what-if panel folds behind the same closed disclosure in Build a portfolio", dFold ? dFold.outerHTML.slice(0, 160) : "no fold");
  await openWhatIf(db.container);
  check(!!dFold?.open && !!dFold.querySelector("section.whatif input[type=range]") && db.container.querySelectorAll("section.whatif").length === 1,
    "desktop: opened by its line, the fold holds the what-if panel, once", dFold ? dFold.outerHTML.slice(0, 160) : "no fold");
  db.unmount();
}

// ---- (g2) the what-if fold fetches its panel when the reader reaches for it ------------------------
// The panel and the solvers it runs are a chunk of their own (t-split.mjs reads that off the real build).
// Each promise is checked with the fetch held in this suite's hands: nothing is fetched before the reader
// reaches for the line; a click that lands first is held, the fold shut and marked busy, and the fold then
// opens on the finished panel in one commit, never open on an empty box; pressing the line fetches ahead
// of the click, which then opens the fold at once; a chunk that never arrives says so inside the fold.
{
  const real = whatIfSeams.whatIf;
  const wait = () => act(() => new Promise((res) => setTimeout(res, 5)));
  const until = async (cond, tries = 400) => {
    for (let i = 0; i < tries && !cond(); i++) await wait();
    return cond();
  };
  const panel = () => render(h(WhatIfFold, { a: EX }));
  const foldOf = (r) => r.container.querySelector("details.whatif-fold");
  let asked = 0;
  try {
    // Held in flight. Every state the fold is seen in, after each change to it, is kept.
    let release;
    const gate = new Promise((res) => (release = res));
    whatIfSeams.whatIf = () => {
      asked++;
      return gate.then(real);
    };
    const r = panel();
    const fold = foldOf(r);
    const seen = [];
    const watch = new window.MutationObserver(() => seen.push({ open: fold.open, panel: !!fold.querySelector("section.whatif") }));
    watch.observe(fold, { attributes: true, childList: true, subtree: true });
    check(asked === 0 && !fold.querySelector("section.whatif"), "what-if fold: nothing is fetched before the reader reaches for the line", `asked ${asked}`);
    click(fold.querySelector("summary"));
    await wait();
    check(asked === 1 && !fold.open && fold.getAttribute("aria-busy") === "true" && !fold.querySelector("section.whatif"),
      "what-if fold: a click before the panel's code is in is held, the fold shut and marked busy",
      `asked ${asked} open ${fold.open} busy ${fold.getAttribute("aria-busy")}`);
    await act(async () => {
      release();
      await gate;
    });
    await until(() => fold.open && !!fold.querySelector("section.whatif"));
    await wait();
    watch.disconnect();
    check(fold.open && !!fold.querySelector("section.whatif input[type=range]") && !fold.hasAttribute("aria-busy") &&
      seen.some((s) => s.open) && seen.every((s) => !s.open || s.panel),
      "what-if fold: it opens on the finished panel in one step, and is never seen open without it", JSON.stringify(seen));
    click(fold.querySelector("summary"));
    check(!fold.open && !!fold.querySelector("section.whatif"), "what-if fold: shut again, the panel stays mounted behind its line");
    r.unmount();

    // Pressed: the code is asked for on the press, ahead of the click, which then opens the fold at once.
    asked = 0;
    whatIfSeams.whatIf = () => {
      asked++;
      return real();
    };
    const p = panel();
    const pf = foldOf(p);
    act(() => pf.querySelector("summary").dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true })));
    await until(() => !!pf.querySelector("section.whatif"));
    check(asked >= 1 && !pf.open && !!pf.querySelector("section.whatif"),
      "what-if fold: pressing the line fetches the panel ahead of the click, the fold still shut", `asked ${asked} open ${pf.open}`);
    click(pf.querySelector("summary"));
    check(pf.open && !pf.hasAttribute("aria-busy") && p.container.querySelectorAll("section.whatif").length === 1,
      "what-if fold: the click after it opens the fold at once, on the panel");
    p.unmount();

    // A chunk that never arrives (a deploy that no longer serves it, a dropped connection).
    whatIfSeams.whatIf = () => Promise.reject(new Error("chunk 404"));
    const f = panel();
    const ff = foldOf(f);
    click(ff.querySelector("summary"));
    await until(() => ff.open);
    check(ff.open && text(ff.querySelector("[role=alert]") ?? {}) === "The what-if could not be loaded. Reload the page to try again." &&
      !ff.querySelector("section.whatif") && !ff.hasAttribute("aria-busy"),
      "what-if fold: a chunk that never arrives says so inside the fold, never an empty box", ff.outerHTML.slice(0, 200));
    f.unmount();
  } finally {
    whatIfSeams.whatIf = real;
  }
}

// ---- (h) the command palette -----------------------------------------------------------------------
{
  const { wb, calls } = stand();
  const r = render(h(Harness, { wb, tabs: STAND_TABS }));
  const dialog = () => r.container.querySelector('[aria-label="Command palette"]');
  check(!dialog(), "palette: closed until asked for");
  key(document.body, "k", { ctrlKey: true });
  check(!!dialog() && clickables(dialog()).length === 16 && clickables(dialog()).some((b) => text(b).endsWith(TAB_LABELS.walkforward)) &&
    CHAPTER_IDS.every((c) => clickables(dialog()).some((b) => text(b).startsWith("Chapter") && text(b).includes(CHAPTER_LABELS[c]))) &&
    text(clickables(dialog()).at(-1)).endsWith("How to read this page"),
    "palette: Ctrl+K opens the three levels, the five chapters, the seven tabs' parts (Walk-forward among them) and the guide, last",
    dialog() ? clickables(dialog()).map(text).join(" | ") : "closed");
  const input = dialog()?.querySelector("input");
  if (input) {
    setValue(input, "formula");
    check(clickables(dialog()).length === 1 && text(clickables(dialog())[0]).endsWith("Formula"), "palette: typing filters", clickables(dialog()).map(text).join());
    key(input, "Enter");
  }
  check(calls.level.at(-1) === "formula" && !dialog(), "palette: Enter sets the level and closes", calls.level.join());
  key(document.body, "K", { metaKey: true });
  const again = dialog()?.querySelector("input");
  if (again) {
    setValue(again, "risk");
    key(again, "Enter");
  }
  check(calls.chapter.at(-1) === "performance" && !!r.container.querySelector('[data-tab="risk"]') && document.activeElement?.id === "section-risk",
    "palette: Cmd+K then a tab's name opens its chapter and lands on its part", `${calls.chapter.join()} focus ${document.activeElement?.id}`);
  key(document.body, "k", { ctrlKey: true });
  const third = dialog()?.querySelector("input");
  if (third) {
    setValue(third, "diversification");
    key(third, "Enter");
  }
  check(calls.chapter.at(-1) === "diversification" && !!r.container.querySelector('[data-tab="correlation"]'),
    "palette: a chapter's name, the first match, opens that chapter", calls.chapter.join());
  key(document.body, "k", { ctrlKey: true });
  key(dialog()?.querySelector("input") ?? document.body, "Escape");
  check(!dialog(), "palette: Escape closes");
  r.unmount();
}

// ---- (h2) an older link's tab: landed on once, inside its chapter ----------------------------------------
// ?tab=custom opens Build a portfolio (url.ts) and names Custom as the arrival's part (Workbench.entry): the Your mix
// panel, which the Optimization tab draws. The page brings that part into view and focuses it. A tab already at the
// top of its chapter needs no landing.
{
  const r = page({ chapter: "build", entry: "custom" });
  check(document.activeElement?.id === "section-custom", "legacy: an older link's tab is landed on inside its chapter, the part focused", document.activeElement?.id);
  r.unmount();
  const top = page({ chapter: "build", entry: "optimization" });
  check(document.activeElement?.id !== "section-optimization", "legacy: a tab at the top of its chapter is not landed on", document.activeElement?.id);
  top.unmount();
}

// ---- (i) each tab is its own chunk -----------------------------------------------------------------
// App reaches its tabs through React.lazy (TABS over TAB_LOADERS), so the tabs and Recharts leave the
// first chunk (t-split.mjs reads that off the real build). Three promises hold the page up while a
// chunk is in flight, each checked with a chunk this suite holds open: the first chapter shows a named
// loading line in its place, never a blank panel or a thrown page; a switch keeps the chapter on screen,
// marked busy, until the next one's code is in; a chunk that never arrives names its tab and leaves
// the chapter's other tab, the masthead and the chapter row standing.
{
  const wait = () => act(() => new Promise((res) => setTimeout(res, 5)));
  const until = async (cond, tries = 400) => {
    for (let i = 0; i < tries && !cond(); i++) await wait();
    return cond();
  };
  const held = () => {
    let res, rej;
    const p = new Promise((a, b) => ((res = a), (rej = b)));
    return { p, res, rej };
  };
  const panel = (r) => r.container.querySelector("[role=tabpanel]");
  const fallback = (r) => [...r.container.querySelectorAll(".app-main [role=status]")].find((n) => /^Loading /.test(text(n)));

  // The first chapter: one of its tabs' chunks is still on the way.
  const first = held();
  const second = held();
  const lazies = {
    ...STAND_TABS,
    returns: lazy(() => first.p),
    correlation: lazy(() => second.p),
    optimization: lazy(() => Promise.reject(new Error("chunk 404"))),
  };
  const r = quietly(() => render(h(Harness, { wb: stand().wb, tabs: lazies })));
  check(text(fallback(r) ?? {}) === `Loading ${CHAPTER_LABELS.performance}` && !panel(r)?.querySelector("[data-tab]"),
    "lazy: while a chapter's chunks load, its place holds one line naming it", text(r.container.querySelector(".app-main") ?? {}).slice(0, 120));
  check(!!r.container.querySelector(".app-tabs [role=tablist]") && !!r.container.querySelector(".masthead"),
    "lazy: the masthead and the chapter row are up before any tab's chunk");
  await act(async () => {
    first.res({ default: STAND_TABS.returns });
    await first.p;
  });
  await until(() => !!r.container.querySelector('[data-tab="returns"]'));
  check(!!panel(r)?.querySelector('[data-tab="returns"]') && !!panel(r)?.querySelector('[data-tab="risk"]') && !fallback(r),
    "lazy: the chapter's tabs replace the line together when the last chunk lands");

  // A switch to a chapter whose chunk is not in yet: the old chapter stays, marked busy; no loading line.
  const row = r.container.querySelector(".app-tabs [role=tablist]");
  quietly(() => click(byLabel(row, CHAPTER_LABELS.diversification)));
  await wait();
  check(!!panel(r)?.querySelector('[data-tab="returns"]') && panel(r)?.getAttribute("aria-busy") === "true" && !fallback(r),
    "lazy: during a switch the chapter on screen stays, marked aria-busy, and the panel never blanks to a loading line",
    `busy=${panel(r)?.getAttribute("aria-busy")} fallback=${!!fallback(r)} body=${text(panel(r) ?? {}).slice(0, 40)}`);
  await act(async () => {
    second.res({ default: STAND_TABS.correlation });
    await second.p;
  });
  await until(() => !!r.container.querySelector('[data-tab="correlation"]'));
  check(!!panel(r)?.querySelector('[data-tab="correlation"]') && !panel(r)?.hasAttribute("aria-busy"),
    "lazy: the next chapter takes its place when its chunk lands, no longer busy");

  // A chunk that never arrives (a deploy that no longer serves it, a dropped connection).
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    await expectUncaught(async () => {
      click(byLabel(row, CHAPTER_LABELS.build));
      await until(() => !!r.container.querySelector(".boundary"));
    });
  } finally {
    Object.assign(console, { error, warn });
  }
  check(text(r.container.querySelector(".boundary") ?? {}) === `${TAB_LABELS.optimization} could not be shown.` &&
    /What if one/.test(text(panel(r) ?? {})) && !!r.container.querySelector(".app-tabs [role=tablist]") && !!r.container.querySelector("header"),
    "lazy: a chunk that fails to load names its tab, and the chapter's what-if, the chapter row and masthead stay", text(r.container.querySelector(".app-main") ?? {}).slice(0, 120));
  r.unmount();

  // The shipped map: every tab is a lazy component, and App's own default reaches the real finding.
  check(TAB_IDS.length === 6 && TAB_IDS.every((id) => AppTabs[id]?.$$typeof === Symbol.for("react.lazy")) && !("custom" in AppTabs) && !("custom" in TAB_LOADERS),
    "lazy: App ships each of the six tabs as React.lazy, and no Custom tab");
  const shipped = quietly(() => render(h(Harness, { wb: stand().wb })));
  const found = await until(() => !!panel(shipped)?.querySelector("h2.tab-finding"));
  check(found, "lazy: App's default tabs load and draw the Returns finding", text(shipped.container.querySelector(".app-main") ?? {}).slice(0, 120));
  shipped.unmount();
}

done("t-app");
