// The page's chrome: masthead, rail, phone chip and sheet, band, tab switch, command palette.
//
// Drives the shipping components in jsdom (test/_dom.mjs) with a stand-in workbench, so nothing
// here waits on the state hook, and with stand-in tabs where a check is about the page rather
// than a tab. Three divergence-ledger entries close here: boundary (the page half), failed-tangency
// (the band half) and start-date-floor (the page half). Each asserts the app's side, read out of
// portfolio_app.py or reproduced with the engine, and the port's side, rendered.
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { act, render, setMedia, text } from "./_dom.mjs";

const { createElement: h, useState } = await import("react");
const { AppView, TABS } = await import("../src/App.tsx");
const { default: Boundary } = await import("../src/components/Boundary.tsx");
const { snapshotPlates, finding } = await import("../src/chrome/Band.tsx");
const { default: Rail, symbolMessage } = await import("../src/chrome/Rail.tsx");
const { default: SummaryChip, summaryText } = await import("../src/chrome/SummaryChip.tsx");
const { titleChip } = await import("../src/chrome/Masthead.tsx");
const { format, DASH } = await import("../src/format.ts");
const { parseTickers } = await import("../src/lib/clean.ts");
const { portfolioPerformance } = await import("../src/lib/portfolio.ts");
const { MESSAGES } = await import("../src/state/analyze.ts");
const { PRESETS, RF_FALLBACK } = await import("../src/state/defaults.ts");
const { PHONE_QUERY } = await import("../src/styles/tokens.ts");
const { TAB_IDS, TAB_LABELS } = await import("../src/types.ts");
const { exampleAnalysis, examplePayload, fixtureAnalysis, settingsFor } = await import("./_analysis.mjs");

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
  const calls = { settings: [], level: [], tab: [] };
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
    setTab: (t) => calls.tab.push(t),
    ...over,
  };
  return { wb, calls };
}
// The workbench with a live tab and level, as useWorkbench would hold them.
function Harness({ wb, tabs }) {
  const [tab, setTab] = useState(wb.tab);
  const [level, setLevel] = useState(wb.level);
  const live = {
    ...wb,
    tab,
    level,
    setTab: (t) => {
      wb.setTab(t);
      setTab(t);
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
  check(text(r.container).includes("Best Sharpe (Tangency)"), "ledger:boundary: the port's band survives a failed tab");
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
    ["Best Sharpe (Tangency)", t.sharpe, "num3", "best_sharpe"],
    ["Tangency Return", t.mu, "pct2", "tangency_return"],
    [`${EX.benchLabel} Return`, EX.benchStats.mu, "pct2", "bench_return"],
    [`${EX.benchLabel} Volatility`, EX.benchStats.sigma, "pct2", "bench_vol"],
  ];
  check(JSON.stringify(plates.map((p) => [p.label, p.value, p.format, p.tip])) === JSON.stringify(want),
    "band: the four plates are the Snapshot's labels, figures, formats and tooltips (1205-1208)", JSON.stringify(plates));
  const r = page({});
  const band = text(r.container.querySelector("main"));
  check(want.every(([label, v, f]) => band.includes(label) && band.includes(format(v, f))), "band: every plate renders its label and figure", band);
  const sentence = finding(EX);
  check(band.includes(sentence) && sentence.includes(format(t.sharpe, "num2")) && sentence.includes(format(EX.benchStats.sharpe, "num2")) &&
    sentence.includes(monthYear(EX.prices.dates[0])) && sentence.includes(monthYear(EX.asOf)) && sentence.includes(EX.benchLabel),
    "band: the sentence states the tangency's and the benchmark's Sharpe over the price span", sentence);
  r.unmount();
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
  setValue(field(root, "amount"), "50");
  check(calls.settings.length === n && /at least \$100/.test(text(root)), "rail: an amount under the app's $100 minimum is refused (724)");
  setValue(field(root, "amount"), "25000");
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ amount: 25000 }), "rail: a valid amount applies");

  // A rate set here, with the way back to live.
  check(text(root).includes(LIVE.date) && field(root, "rf").value === String(Number((EX.rf * 100).toFixed(4))), "rail: a set rate shows beside the live one and its date", field(root, "rf").value);
  click(byLabel(root, "Use the live rate"));
  check(JSON.stringify(calls.settings.at(-1)) === JSON.stringify({ rf: null }), "rail: 'Use the live rate' goes back to live", JSON.stringify(calls.settings.at(-1)));
  r.unmount();
}
{
  const { r, calls, root } = rail({ settings: { ...EX_SETTINGS, rf: null, end: null } });
  const t = text(root);
  check(field(root, "end").value === TODAY && byLabel(root, "End today instead") === undefined, "rail: an end of null shows today", field(root, "end").value);
  check(t.includes(LIVE.date) && t.includes(LIVE.source) && field(root, "rf").value === "4.12" && !byLabel(root, "Use the live rate"),
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
  r.unmount();
  setMedia(() => false);
  const desk = page({});
  check(!desk.container.querySelector("button.chip") && !!desk.container.querySelector("aside [name=tickers]"), "desktop: the rail stands in the left column, no chip");
  desk.unmount();
}

// ---- (h) the command palette -----------------------------------------------------------------------
{
  const { wb, calls } = stand();
  const r = render(h(Harness, { wb, tabs: STAND_TABS }));
  const dialog = () => r.container.querySelector('[aria-label="Command palette"]');
  check(!dialog(), "palette: closed until asked for");
  key(document.body, "k", { ctrlKey: true });
  check(!!dialog() && clickables(dialog()).length === 9, "palette: Ctrl+K opens the three levels and six tabs", dialog() ? String(clickables(dialog()).length) : "closed");
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

done("t-app");
