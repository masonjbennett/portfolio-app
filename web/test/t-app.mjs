// The page's chrome: masthead, rail, phone chip and sheet, band, tab switch, command palette.
//
// Drives the shipping components in jsdom (test/_dom.mjs) with a stand-in workbench, so nothing
// here waits on the state hook, and with stand-in tabs where a check is about the page rather
// than a tab. Three divergence-ledger entries close here: boundary (the page half), failed-tangency
// (the band half) and start-date-floor (the page half). Each asserts the app's side, read out of
// portfolio_app.py or reproduced with the engine, and the port's side, rendered.
import { readFileSync, readdirSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { act, render, setMedia, text } from "./_dom.mjs";

const { createElement: h, useState, lazy } = await import("react");
const { AppView, TAB_LOADERS, TABS: AppTabs } = await import("../src/App.tsx");
const { default: Boundary } = await import("../src/components/Boundary.tsx");
const { default: Band, snapshotPlates, finding } = await import("../src/chrome/Band.tsx");
const { default: Masthead } = await import("../src/chrome/Masthead.tsx");
const { default: Footer } = await import("../src/chrome/Footer.tsx");
const P = await import("../src/content/published.ts");
const { default: Rail, symbolMessage } = await import("../src/chrome/Rail.tsx");
const { default: SummaryChip, summaryText } = await import("../src/chrome/SummaryChip.tsx");
const { titleChip } = await import("../src/chrome/Masthead.tsx");
const { format, DASH } = await import("../src/format.ts");
const { parseTickers } = await import("../src/lib/clean.ts");
const { portfolioPerformance, portfolioReturns } = await import("../src/lib/portfolio.ts");
const { sharpeSE } = await import("../src/lib/stats.ts");
const { MESSAGES } = await import("../src/state/analyze.ts");
const { PRESETS, RF_FALLBACK } = await import("../src/state/defaults.ts");
const { PHONE_QUERY } = await import("../src/styles/tokens.ts");
const { TAB_IDS, TAB_LABELS } = await import("../src/types.ts");
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
const key = (el, k, mods = {}) => act(() => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, ...mods })));
const clickables = (root) => [...root.querySelectorAll("button, [role=tab], [role=radio], [role=option]")];
const byLabel = (root, label) =>
  clickables(root).find((b) => text(b) === label) ?? clickables(root).find((b) => text(b).startsWith(label));
const field = (root, name) => root.querySelector(`[name="${name}"]`);

const EX = exampleAnalysis();
const LIVE = { rate: 0.0412, date: "2026-09-25", source: "FRED DGS3MO" };
const EX_SETTINGS = settingsFor(examplePayload(), { rf: EX.rf });

function stand(over = {}) {
  const calls = { settings: [], level: [], tab: [], view: [] };
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
    tab: "returns",
    setTab: (t, v) => {
      calls.tab.push(t);
      calls.view.push(v ?? "basket");
    },
    view: "basket",
    rfHistory: { basis: "example", series: null, loading: false },
    ...over,
  };
  return { wb, calls };
}
// The workbench with a live tab and level, as useWorkbench would hold them.
function Harness({ wb, tabs }) {
  const [tab, setTab] = useState(wb.tab);
  const [view, setView] = useState(wb.view);
  const [level, setLevel] = useState(wb.level);
  const live = {
    ...wb,
    tab,
    view,
    level,
    // As useWorkbench: every way into a tab opens the walk-forward tab's first segment unless one is named.
    setTab: (t, v) => {
      wb.setTab(t, v);
      setTab(t);
      setView(v ?? "basket");
    },
    setLevel: (l) => {
      wb.setLevel(l);
      setLevel(l);
    },
  };
  return h(AppView, { wb: live, tabs });
}
const STAND_TABS = Object.fromEntries(TAB_IDS.map((id) => [id, () => h("p", { "data-tab": id }, `tab body ${id}`)]));
const page = (over, tabs = STAND_TABS) => render(h(Harness, { wb: stand(over).wb, tabs }));

// ---- (a) the masthead ----------------------------------------------------------------------------
{
  // Requested dates a month either side of the data, so the chip cannot pass by printing the span.
  const a = { ...EX, requested: { start: "2018-12-15", end: "2026-10-03" } };
  const r = page({ analysis: { status: "ready", value: a } });
  const head = text(r.container.querySelector("header"));
  check(head.includes("Portfolio Analytics"), "masthead: the app's title (1177)");
  const chip = `${a.tickers.length} assets · ${a.benchLabel} · Dec 2018 – Oct 2026`;
  check(head.includes(chip) && titleChip(a) === chip, "masthead: the title chip prints the REQUESTED dates (1182)", head);
  check(head.includes(`Prices as of ${format(a.asOf, "date")}`), "masthead: prices as of the last price date", head);
  check(/\bexample\b/.test(head), "masthead: says 'example' while the baked example shows", head);
  check(!/updating/.test(head), "masthead: says nothing about updating while idle", head);
  r.unmount();

  const busy = page({ fetching: true });
  check(/\bupdating\b/.test(text(busy.container.querySelector("header"))), "masthead: says 'updating' while prices are fetched");
  busy.unmount();

  const liveA = fixtureAnalysis("cross");
  const lv = page({ analysis: { status: "ready", value: liveA } });
  const lh = text(lv.container.querySelector("header"));
  check(!/\bexample\b/.test(lh) && lh.includes(`Prices as of ${format(liveA.asOf, "date")}`), "masthead: a live analysis is not labelled example", lh);
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

  // The port's side: a tab that throws leaves one named line, the band, and the other tabs.
  const Throws = () => {
    throw new Error("tab exploded");
  };
  let r = null;
  try {
    r = quietly(() => page({}, { ...STAND_TABS, returns: Throws }));
  } catch (err) {
    check(false, "ledger:boundary: the port shows one line naming the failed tab", `the whole page threw: ${err.message}`);
  }
  if (r) {
  // The boundary's fallback line, whatever its role: every alert or status line in the main column.
  const lines = () => [...r.container.querySelectorAll("main [role=alert], main [role=status], main .boundary")].filter((e) => text(e));
  check(lines().length === 1 && text(lines()[0]).includes(TAB_LABELS.returns),
    "ledger:boundary: the port shows one line naming the failed tab", lines().map(text).join(" | "));
  check(text(r.container).includes("Tangency Sharpe (in-sample)"), "ledger:boundary: the port's band survives a failed tab");
  const risk = byLabel(r.container.querySelector(".app-tabs"), TAB_LABELS.risk);
  if (risk) quietly(() => click(risk));
  check(!!r.container.querySelector('[data-tab="risk"]') && lines().length === 0,
    "ledger:boundary: the port's next tab renders after the failed one");
  r.unmount();
  }
}

// ---- the tab row and its panel: tab / tabpanel ids tie each to the other ---------------------------
{
  const r = page({});
  const row = r.container.querySelector(".app-tabs [role=tablist]");
  const pills = row ? [...row.querySelectorAll("[role=tab]")] : [];
  check(pills.length === TAB_IDS.length && pills.every((t, i) => t.id === `analysis-tab-${TAB_IDS[i]}` && t.getAttribute("aria-controls") === `analysis-panel-${TAB_IDS[i]}`),
    "tabs: every tab pill has an id and aria-controls naming its panel", pills.map((t) => `${t.id}>${t.getAttribute("aria-controls")}`).join(" "));
  // The one panel on the page is the selected pill's, labelled by that pill.
  const panelOk = (id) => {
    const panels = [...r.container.querySelectorAll("[role=tabpanel]")];
    const on = pills.find((t) => t.getAttribute("aria-selected") === "true");
    const label = panels[0] ? r.container.querySelector(`#${panels[0].getAttribute("aria-labelledby")}`) : null;
    return panels.length === 1 && on?.getAttribute("aria-controls") === panels[0].id && panels[0].id === `analysis-panel-${id}` &&
      label === on && text(label) === TAB_LABELS[id] && !!panels[0].querySelector(`[data-tab="${id}"]`);
  };
  check(panelOk("returns"), "tabs: the active tab's content is its role=tabpanel, labelled by the selected pill");
  click(byLabel(row, TAB_LABELS.correlation));
  check(panelOk("correlation"), "tabs: switching tab moves the panel's id and label to the new pill");
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
      const r = quietly(() => render(mount(id, poisoned)));
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
// The REAL tabs here, on the baked example, not the stand-ins the rest of this suite uses.
{
  const r = page({}, TABS);
  const row = r.container.querySelector(".app-tabs [role=tablist]");
  const seen = [];
  for (const id of TAB_IDS) {
    click(byLabel(row, TAB_LABELS[id]));
    const panel = r.container.querySelector("[role=tabpanel]");
    const first = panel?.querySelector("h1, h2, h3, h4, h5, h6");
    const finding = first ? text(first) : "";
    seen.push(`${id}: ${first?.tagName}.${first?.className} "${finding.slice(0, 40)}"`);
    // The walk-forward tab is the one exception, by name: it opens on its section heading and the switch
    // between its two segments, and each segment states its own finding under them.
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

// ---- (c) nothing ready: a named message in place of the band and tabs -----------------------------
{
  const e = page({ analysis: { status: "error", name: "prices", message: "The price service did not answer." } });
  const t = text(e.container);
  check(t.includes("prices") && t.includes("The price service did not answer.") && !!e.container.querySelector("main [role=alert]"),
    "failed analysis: its name and message show where the band was", t);
  check(!e.container.querySelector("[data-tab]") && !e.container.querySelector(".app-tabs"), "failed analysis: no tab switch and no tab");
  e.unmount();

  const failure = { ok: false, error: "too-few-downloaded", message: MESSAGES["too-few-downloaded"], events: [] };
  const f = page({ analysis: { status: "loading" }, failure });
  check(text(f.container.querySelector("main")).includes(MESSAGES["too-few-downloaded"]), "failed analysis: a first fetch that failed shows the app's message, not a spinner");
  f.unmount();

  const l = page({ analysis: { status: "loading" } });
  check(text(l.container.querySelector("main")).length > 0, "loading: the main column says so, never a blank");
  l.unmount();

  const kept = page({ failure });
  const kt = text(kept.container.querySelector("main"));
  check(kt.includes(MESSAGES["too-few-downloaded"]) && kt.includes("previous settings") && !!kept.container.querySelector('[data-tab="returns"]'),
    "failed update: the message shows beside the analysis still on screen, tabs kept", kt);
  kept.unmount();
}

// ---- (d) the band: one sentence, the Snapshot's four plates --------------------------------------
{
  const t = EX.tangency;
  const plates = snapshotPlates(EX);
  const want = [
    ["Tangency Sharpe (in-sample)", t.sharpe, "num3", "best_sharpe"],
    ["Tangency Return", t.mu, "pct2", "tangency_return"],
    [`${EX.benchLabel} Return`, EX.benchStats.mu, "pct2", "bench_return"],
    [`${EX.benchLabel} Volatility`, EX.benchStats.sigma, "pct2", "bench_vol"],
  ];
  check(JSON.stringify(plates.map((p) => [p.label, p.value, p.format, p.tip])) === JSON.stringify(want),
    "band: the four plates are the Snapshot's figures, formats and tooltips (1205-1208), the first labelled in-sample", JSON.stringify(plates));
  const r = page({});
  const band = text(r.container.querySelector("main"));
  check(want.every(([label, v, f]) => band.includes(label) && band.includes(format(v, f))), "band: every plate renders its label and figure", band);
  const sentence = finding(EX);
  check(band.includes(sentence) && sentence.includes(format(t.sharpe, "num3")) && sentence.includes(format(EX.benchStats.sharpe, "num3")) &&
    sentence.includes(monthYear(EX.prices.dates[0])) && sentence.includes(monthYear(EX.asOf)) && sentence.includes(EX.benchLabel),
    "band: the sentence states the tangency's and the benchmark's Sharpe over the price span", sentence);
  check(sentence.startsWith(`On these ${EX.tickers.length} assets, with hindsight, `),
    "band: the sentence names itself, these assets with hindsight, before any figure", sentence);
  // On a published basket the live tangency figure is recomputed in-sample, never the published one, and
  // the sentence says so right after it; on any other basket it says the same, so the mark never comes and goes.
  const through = `(in-sample, recomputed on prices through ${format(EX.asOf, "date")})`;
  const onSet = (a, set) => finding({ ...a, tickers: [...set.tickers].reverse() });
  const high = exampleAnalysis({ rf: 0.4 });
  const marked = P.PUBLISHED_SETS.flatMap((set) => [onSet(EX, set), onSet(high, set)]);
  check(EX.tangency?.beatsRf === true && high.tangency?.beatsRf === false &&
    marked.every((s, i) => s.includes(`${format((i % 2 ? high : EX).tangency.sharpe, "num3")}${i % 2 ? " " : " of annual excess return per unit of volatility "}${through}`)),
    "band: on a published basket the tangency Sharpe is marked in-sample and recomputed, with the last price day", marked.join(" | "));
  // Ten tickers that are neither the default basket nor any preset, published or not.
  const tenOther = ["AAPL", "MSFT", "JPM", "XOM", "KO", "PG", "V", "UNH", "HD", "CAT"];
  const presetKeys = [...PRESETS.map((p) => p.tickers), ...P.PUBLISHED_SETS.map((x) => x.tickers.join(", "))].map((t) => parseTickers(t).sort().join(","));
  const other = [finding({ ...EX, tickers: tenOther }), finding({ ...high, tickers: tenOther })];
  check(!presetKeys.includes([...tenOther].sort().join(",")) &&
    other.every((s, i) => s.includes(`${format((i ? high : EX).tangency.sharpe, "num3")}${i ? " " : " of annual excess return per unit of volatility "}${through}`)),
    "band: on a ten-ticker basket that is no preset the tangency Sharpe carries the same in-sample, recomputed mark", other.join(" | "));
  r.unmount();
}

// ---- (d2) the published result: quoted, dated, linked once, there before any price ---------------
{
  // The published figures written out a second time, so a slip in either copy goes red. They are the
  // site's, character for character (the negative carries U+2212, as the site prints it).
  const nine = P.PUBLISHED_SETS.map((x) => [x.name, x.tickers.join(" "), x.ew, x.gmv, x.tangency]);
  check(JSON.stringify(nine) === JSON.stringify([
    ["Five mega-caps", "AAPL MSFT GOOGL AMZN JPM", "0.864", "0.710", "0.659"],
    ["Seven sector ETFs", "XLK XLF XLV XLE XLI XLP XLY", "0.915", "0.450", "0.661"],
    ["Cross-asset", "VTI AGG GLD VNQ EFA", "0.704", "\u22120.247", "0.883"],
  ]) && P.MEGA_CAP_IN_SAMPLE === "1.107" && P.PUBLISHED_WHEN === "Sep 2026" &&
    P.PUBLISHED_URL === "https://masonjbennett.com/projects#portfolio-method" &&
    P.CROSS_AGG_INTO_2022 === "95.1%" && JSON.stringify(P.MEGA_CAP_APPLE) === JSON.stringify(["41.7%", "3.8%", "6.4%", "21.0%", "44.8%"]),
    "published: the constants are the nine published Sharpe ratios, 1.107, the AGG and Apple weights, the date and the method note's address",
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

  // The strip in every state the band has: waiting, empty, failed, ready, and ready but not updated.
  const failure = { message: MESSAGES["too-few-downloaded"] };
  const states = [
    ["loading", { analysis: { status: "loading" }, fetching: true, failure: null }],
    ["empty", { analysis: { status: "empty", reason: "Enter at least two tickers." }, fetching: false, failure: null }],
    ["error", { analysis: { status: "error", name: "Optimisation", message: "it threw" }, fetching: false, failure: null }],
    ["failed build", { analysis: { status: "loading" }, fetching: false, failure }],
    ["ready", { analysis: { status: "ready", value: EX }, fetching: false, failure: null }],
    ["ready, not updated", { analysis: { status: "ready", value: EX }, fetching: false, failure }],
  ];
  const mega = P.PUBLISHED_SETS[0];
  const allowed = new Set([mega.ew, mega.gmv, mega.tangency, P.MEGA_CAP_IN_SAMPLE, P.PUBLISHED_WHEN.split(" ")[1]]);
  const needed = [P.MEGA_CAP_IN_SAMPLE, mega.tangency, mega.ew];
  const faults = [];
  for (const [name, props] of states) {
    const r = render(h(Band, { ...props, level: "plain" }));
    const band = r.container.querySelector("section.band");
    const strip = band?.querySelector(".band-published");
    const st = text(strip ?? {});
    const figures = st.match(/[\u2212-]?\d+(?:\.\d+)?%?/g) ?? [];
    const links = [...(strip?.querySelectorAll("a") ?? [])];
    if (!strip) faults.push(`${name}: no strip`);
    else {
      if (band.firstElementChild !== strip) faults.push(`${name}: the strip is not first in the band`);
      if (!st.includes(P.CARD_SENTENCE)) faults.push(`${name}: the site's sentence is not quoted word for word`);
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
    "published: in every band state the strip comes first, quotes the site's sentence, prints only the published figures, dates itself and links the method note once",
    faults.join("; "));

  // On the page, before any price has arrived.
  const r = page({ analysis: { status: "loading" }, fetching: true });
  const main = r.container.querySelector("main");
  const strip = main?.querySelector(".band-published");
  const wait = main?.querySelector(".band-wait");
  check(!!strip && !!wait && !!(strip.compareDocumentPosition(wait) & window.Node.DOCUMENT_POSITION_FOLLOWING) && text(strip).includes(P.CARD_SENTENCE),
    "published: the page shows the published result while prices are still loading, above the loading line", text(main ?? {}));
  r.unmount();
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
  const source = () => r.container.querySelector(".band-published-source");
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

  // The strip's source line: the words that were already on it open the tab on the published test, and the
  // line reads exactly as before, so it is no wider and no taller. Its one link is still the method note.
  const bare = render(h(Band, { analysis: { status: "ready", value: EX }, level: "plain", fetching: false, failure: null }));
  const before = text(bare.container.querySelector(".band-published-source") ?? {});
  bare.unmount();
  const open = source()?.querySelector("button.text-button");
  const links = [...(source()?.querySelectorAll("a") ?? [])];
  check(!!open && text(open) === "Walk-forward test" && text(source()) === before && before.startsWith("Walk-forward test, published ") &&
    source().children.length === 2 && links.length === 1 && links[0].getAttribute("href") === P.PUBLISHED_URL,
    "walk-forward: the strip's source line turns its own first words into the control, reads as before, and keeps its one link", `${text(source() ?? {})} / ${before}`);

  click(byLabel(row, TAB_LABELS.walkforward));
  check(segment() === "basket" && text(segRow()?.querySelector("[aria-selected=true]") ?? {}) === "Your basket",
    "walk-forward: the tab opens on Your basket", `${segment()}`);
  click(byLabel(segRow(), "As published"));
  check(segment() === "published" && text(segRow()?.querySelector("[aria-selected=true]") ?? {}) === "As published",
    "walk-forward: the switch shows As published", `${segment()}`);
  check(landed.length === 0, "walk-forward: the tab row and the segment row switch where the reader already is, and scroll nothing", where());
  click(byLabel(row, TAB_LABELS.returns));
  click(byLabel(row, TAB_LABELS.walkforward));
  check(segment() === "basket", "walk-forward: leaving the tab and coming back by its pill opens Your basket again", `${segment()}`);
  click(byLabel(row, TAB_LABELS.returns));
  click(source().querySelector("button.text-button"));
  check(segment() === "published" && row.querySelector("[aria-selected=true]")?.id === "analysis-tab-walkforward",
    "walk-forward: the strip's control switches to the tab on As published, without a reload", `${segment()}`);
  check(landedOn("published"), "walk-forward: the strip's control lands the reader on the tab: scrolled into view, the As published segment focused", where());
  landed.length = 0;
  click(byLabel(row, TAB_LABELS.returns));
  click(byLabel(row, TAB_LABELS.walkforward));
  check(landed.length === 0, "walk-forward: a landing is taken once; the tab mounted again by its pill does not land again", where());
  click(byLabel(row, TAB_LABELS.optimization));
  const note = panel()?.querySelector('[data-note="in-sample"] button.text-button');
  // The note itself must not link out to the method note; As published, which it opens, carries that link.
  const linksOut = !!panel()?.querySelector(`[data-note="in-sample"] a[href="${P.PUBLISHED_URL}"]`);
  landed.length = 0;
  if (note) click(note);
  check(!!note && segment() === "published" && row.querySelector("[aria-selected=true]")?.id === "analysis-tab-walkforward" &&
    !linksOut,
    "walk-forward: the Optimization tab's in-sample note switches to the tab on As published", `${segment()}`);
  check(landedOn("published"), "walk-forward: the in-sample note lands the reader on the tab: scrolled into view, the As published segment focused", where());
  check(!!note && !!open && !!note.getAttribute("title") && note.getAttribute("title") === open.getAttribute("title"),
    "walk-forward: the in-sample note's control says where it goes, as the strip's does", note?.getAttribute("title") ?? "(no title)");
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
  const s = stand();
  const rr = render(h(Harness, { wb: s.wb, tabs: TABS }));
  click(rr.container.querySelector(".band-published-source button.text-button"));
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

// ---- (d3) plain words: no "best" or "optimal" as a label in the band, masthead or footer ----------
{
  const bad = /\b(best|optimal)\b/i;
  // The band's three sentences: a tangency, a tangency that does not beat the rate, a failed solve.
  const noBeat = exampleAnalysis({ rf: 0.4 });
  const failed = exampleAnalysis({ allowShort: true, rf: 0.4 });
  const said = [EX, noBeat, failed].map((a) => finding(a));
  check(EX.tangency?.beatsRf === true && noBeat.tangency?.beatsRf === false && failed.tangency === null,
    "plain words: the three analyses reach the band's three sentences", `${EX.tangency?.beatsRf} ${noBeat.tangency?.beatsRf} ${failed.tangency}`);
  const labels = [EX, noBeat, failed].flatMap((a) => snapshotPlates(a).map((p) => p.label));
  // Rendered text of the band, masthead and footer, the tooltips' own text included (the app's words that
  // called the mix best are replaced, ledger:plain-tip-words), and every accessible name on them.
  const names = [];
  const shown = [
    render(h(Band, { analysis: { status: "ready", value: EX }, level: "plain", fetching: false, failure: null })),
    render(h(Masthead, { analysis: { status: "ready", value: EX }, fetching: false })),
    render(h(Footer)),
  ].map((r) => {
    r.container.querySelectorAll("[aria-label]").forEach((e) => names.push(e.getAttribute("aria-label")));
    const t = text(r.container);
    r.unmount();
    return t;
  });
  const hits = [...said, ...labels, ...shown].filter((x) => bad.test(x)).map((x) => x.match(bad)[0] + ": " + x.slice(0, 80));
  check(hits.length === 0, "plain words: no \"best\" or \"optimal\" in a band sentence, a plate label, the masthead or the footer", hits.join(" | "));
  const loose = /\b(best|optimal)|optimally/i;
  const named = names.filter((x) => loose.test(x));
  const tipped = shown.filter((x) => /optimally/i.test(x));
  check(names.some((x) => /^About /.test(x)) && named.length === 0 && tipped.length === 0,
    "ledger:plain-tip-words the band's tips and accessible names call nothing best or optimal", [...named, ...tipped.map((x) => x.slice(0, 80))].join(" | "));
}

// ---- (d4) the tangency Sharpe plate carries one standard error, the engine's -----------------------
{
  const se = sharpeSE(portfolioReturns(EX.returns, EX.tangency.w), EX.rf);
  const plates = snapshotPlates(EX);
  check(Number.isFinite(se) && plates[0].label === "Tangency Sharpe (in-sample)" && plates[0].se === se && plates.slice(1).every((p) => p.se === undefined),
    "band: the tangency Sharpe plate's standard error is sharpeSE on the tangency portfolio's daily returns, and no other plate has one", `${plates[0].se} ${se}`);
  const r = render(h(Band, { analysis: { status: "ready", value: EX }, level: "plain", fetching: false, failure: null }));
  const first = r.container.querySelector(".band-plates .plate");
  check(!!first && text(first.querySelector(".plate-se") ?? {}) === `± ${format(se, "num3")} SE` &&
    text(first.querySelector(".plate-value") ?? {}) === format(EX.tangency.sharpe, "num3") && r.container.querySelectorAll(".band-plates .plate-se").length === 1,
    "band: the plate prints the figure alone and plus or minus one standard error beside it", first ? first.innerHTML.slice(0, 200) : "no plate");
  r.unmount();
  const failed = exampleAnalysis({ allowShort: true, rf: 0.4 });
  const rf = render(h(Band, { analysis: { status: "ready", value: failed }, level: "plain", fetching: false, failure: null }));
  check(snapshotPlates(failed)[0].se === null && !rf.container.querySelector(".plate-se"), "band: no tangency, no standard error beside the dash");
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
  const plates = snapshotPlates(a);
  check(plates[0].value === null && plates[1].value === null, "ledger:failed-tangency: the port's Tangency plates hold no figure");
  const r = page({ analysis: { status: "ready", value: a } });
  const band = text(r.container.querySelector("main"));
  check(/optimisation failed/.test(band) && band.includes(DASH), "ledger:failed-tangency: the port's band says the optimisation failed", band);
  check(!band.includes(format(ew.sharpe, "num3")) && !band.includes(format(ew.mu, "pct2")), "ledger:failed-tangency: the port shows no equal-weight stand-in", band);
  r.unmount();
}

// ---- (f) the rail ----------------------------------------------------------------------------------
function rail(over = {}) {
  const { wb, calls } = stand(over);
  const r = render(h(Rail, { settings: wb.settings, setSettings: wb.setSettings, level: wb.level, setLevel: wb.setLevel, rf: wb.rf, fetching: wb.fetching, failure: wb.failure }));
  return { r, calls, root: r.container };
}
{
  const { r, calls, root } = rail();
  const levels = root.querySelector('[aria-label="Explanation level"]');
  check(!!levels && ["Plain", "Finance", "Formula"].every((l) => byLabel(levels, l)), "rail: the level is a named three-way control on top", levels ? text(levels) : "none");
  check(root.querySelector(".rail-group") === levels?.closest(".rail-group"), "rail: the level group comes first");
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
  const shortGroup = field(root, "allowShort").closest(".rail-group");
  const shortHelp = shortGroup ? text(shortGroup) : "";
  check(/each asset's weight is bounded to \[−1, 1\]/.test(shortHelp) && !/unconstrained/i.test(text(root)),
    "ledger:short-bounds-copy: the rail's shorting help states [−1, 1] per asset and never says unconstrained", shortHelp);
  n = calls.settings.length;
  // The starting amount is edited on the growth charts themselves, not here.
  check(field(root, "amount") == null && !/starting investment/i.test(text(root)), "rail: no starting-amount field; the growth charts carry it");

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

  const busy = rail({ fetching: true });
  check(/Fetching prices/.test(text(busy.root)), "rail: says when prices are being fetched");
  busy.r.unmount();
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
  check(!!chip && !r.container.querySelector('[aria-label="Explanation level"]'), "phone: the chip stands in for the rail");
  if (chip) click(chip);
  const sheet = document.querySelector("[role=dialog]");
  check(!!sheet && !!sheet.querySelector('[aria-label="Explanation level"]') && !!sheet.querySelector('[name="tickers"]'), "phone: the chip opens a sheet holding the rail");
  key(document.body, "Escape");
  check(!document.querySelector("[role=dialog]"), "phone: Escape closes the sheet");
  // The published strip: the sentence folds away, the figures and the one link do not.
  const pStrip = r.container.querySelector(".band-published");
  const fold = pStrip?.querySelector("details.band-published-more");
  const pFigures = pStrip?.querySelector(".band-published-figures");
  const pLink = pStrip?.querySelector("a");
  check(!!fold && !fold.open && text(fold.querySelector("summary")) === "The published sentence" &&
    text(fold.querySelector("blockquote") ?? {}) === P.CARD_SENTENCE && !!pFigures && !fold.contains(pFigures) && !!pLink && !fold.contains(pLink),
    "phone: the published sentence folds behind a closed disclosure; the figures and the link stay on the first screen",
    pStrip ? pStrip.innerHTML.slice(0, 200) : "no strip");
  // The what-if panel: below the plates and folded shut, so the first row of plates stays on the first screen.
  const wPlates = r.container.querySelector(".band-plates");
  const wFold = r.container.querySelector(".band details.band-whatif-fold");
  check(!!wPlates && !!wFold && !wFold.open && !!wFold.querySelector("section.whatif input[type=range]") && !wFold.contains(wPlates) &&
    !!(wPlates.compareDocumentPosition(wFold) & window.Node.DOCUMENT_POSITION_FOLLOWING) &&
    text(wFold.querySelector("summary") ?? {}) === "What if one expected return were different?" &&
    r.container.querySelectorAll("section.whatif").length === 1,
    "phone: the what-if panel folds behind a closed disclosure below the plates", wFold ? wFold.outerHTML.slice(0, 160) : "no fold");
  r.unmount();
  setMedia(() => false);
  const desk = page({});
  check(!desk.container.querySelector("button.chip") && !!desk.container.querySelector("aside [name=tickers]"), "desktop: the rail stands in the left column, no chip");
  check(!desk.container.querySelector(".band-published details") && text(desk.container.querySelector(".band-published blockquote") ?? {}) === P.CARD_SENTENCE,
    "desktop: the published sentence is printed open");
  // Folded on a desktop too: printed open it pushed the tab bar below a 900 px first screen.
  const dPlates = desk.container.querySelector(".band-plates");
  const dFold = desk.container.querySelector(".band details.band-whatif-fold");
  check(!!dPlates && !!dFold && !dFold.open && !!dFold.querySelector("section.whatif input[type=range]") && !dFold.contains(dPlates) &&
    !!(dPlates.compareDocumentPosition(dFold) & window.Node.DOCUMENT_POSITION_FOLLOWING) &&
    text(dFold.querySelector("summary") ?? {}) === "What if one expected return were different?" &&
    desk.container.querySelectorAll("section.whatif").length === 1,
    "desktop: the what-if panel folds behind the same closed disclosure below the plates", dFold ? dFold.outerHTML.slice(0, 160) : "no fold");
  desk.unmount();
}

// ---- (h) the command palette -----------------------------------------------------------------------
{
  const { wb, calls } = stand();
  const r = render(h(Harness, { wb, tabs: STAND_TABS }));
  const dialog = () => r.container.querySelector('[aria-label="Command palette"]');
  check(!dialog(), "palette: closed until asked for");
  key(document.body, "k", { ctrlKey: true });
  check(!!dialog() && clickables(dialog()).length === 10 && clickables(dialog()).some((b) => text(b).endsWith(TAB_LABELS.walkforward)),
    "palette: Ctrl+K opens the three levels and seven tabs, Walk-forward among them", dialog() ? clickables(dialog()).map(text).join(" | ") : "closed");
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
  check(calls.tab.at(-1) === "risk" && !!r.container.querySelector('[data-tab="risk"]'), "palette: Cmd+K then a tab's name goes to it", calls.tab.join());
  key(document.body, "k", { ctrlKey: true });
  key(dialog()?.querySelector("input") ?? document.body, "Escape");
  check(!dialog(), "palette: Escape closes");
  r.unmount();
}

// ---- (i) each tab is its own chunk -----------------------------------------------------------------
// App reaches its tabs through React.lazy (TABS over TAB_LOADERS), so the tabs and Recharts leave the
// first chunk (t-split.mjs reads that off the real build). Three promises hold the page up while a
// chunk is in flight, each checked with a chunk this suite holds open: the first tab shows a named
// loading line in its place, never a blank panel or a thrown page; a switch keeps the tab on screen,
// marked busy, until the next one's code is in; a chunk that never arrives names its tab and leaves
// the band and the tab row standing.
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

  // The first tab: its chunk is still on the way.
  const first = held();
  const second = held();
  const lazies = {
    ...STAND_TABS,
    returns: lazy(() => first.p),
    risk: lazy(() => second.p),
    correlation: lazy(() => Promise.reject(new Error("chunk 404"))),
  };
  const r = quietly(() => render(h(Harness, { wb: stand().wb, tabs: lazies })));
  check(text(fallback(r) ?? {}) === `Loading ${TAB_LABELS.returns}` && !panel(r),
    "lazy: while the first tab's chunk loads, its place holds one line naming it", text(r.container.querySelector(".app-main") ?? {}).slice(0, 120));
  check(!!r.container.querySelector(".app-tabs [role=tablist]") && !!r.container.querySelector(".band, [class*=band]"),
    "lazy: the band and the tab row are up before any tab's chunk");
  await act(async () => {
    first.res({ default: STAND_TABS.returns });
    await first.p;
  });
  await until(() => !!r.container.querySelector('[data-tab="returns"]'));
  check(!!panel(r)?.querySelector('[data-tab="returns"]') && !fallback(r), "lazy: the first tab replaces the line when its chunk lands");

  // A switch to a tab whose chunk is not in yet: the old tab stays, marked busy; no loading line.
  const row = r.container.querySelector(".app-tabs [role=tablist]");
  quietly(() => click(byLabel(row, TAB_LABELS.risk)));
  await wait();
  check(!!panel(r)?.querySelector('[data-tab="returns"]') && panel(r)?.getAttribute("aria-busy") === "true" && !fallback(r),
    "lazy: during a switch the tab on screen stays, marked aria-busy, and the panel never blanks to a loading line",
    `busy=${panel(r)?.getAttribute("aria-busy")} fallback=${!!fallback(r)} body=${text(panel(r) ?? {}).slice(0, 40)}`);
  await act(async () => {
    second.res({ default: STAND_TABS.risk });
    await second.p;
  });
  await until(() => !!r.container.querySelector('[data-tab="risk"]'));
  check(!!panel(r)?.querySelector('[data-tab="risk"]') && !panel(r)?.hasAttribute("aria-busy"),
    "lazy: the next tab takes its place when its chunk lands, no longer busy");

  // A chunk that never arrives (a deploy that no longer serves it, a dropped connection).
  quietly(() => click(byLabel(row, TAB_LABELS.correlation)));
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    await until(() => !!r.container.querySelector(".boundary"));
  } finally {
    Object.assign(console, { error, warn });
  }
  check(text(r.container.querySelector(".boundary") ?? {}) === `${TAB_LABELS.correlation} could not be shown.` &&
    !!r.container.querySelector(".app-tabs [role=tablist]") && !!r.container.querySelector("header"),
    "lazy: a chunk that fails to load names its tab, and the tab row and masthead stay", text(r.container.querySelector(".app-main") ?? {}).slice(0, 120));
  r.unmount();

  // The shipped map: every tab is a lazy component, and App's own default reaches the real finding.
  check(TAB_IDS.every((id) => AppTabs[id]?.$$typeof === Symbol.for("react.lazy")), "lazy: App ships each of the seven tabs as React.lazy");
  const shipped = quietly(() => render(h(Harness, { wb: stand().wb })));
  const found = await until(() => !!panel(shipped)?.querySelector("h2.tab-finding"));
  check(found, "lazy: App's default tabs load and draw the Returns finding", text(shipped.container.querySelector(".app-main") ?? {}).slice(0, 120));
  shipped.unmount();
}

done("t-app");
