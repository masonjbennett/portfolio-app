// When the page renders what: an edit reaches the cards whose inputs it changes and no others, and the
// shorting switch answers before the analysis behind the tab is rebuilt.
//
// Two witnesses watch every commit. React's own <Profiler> around the page says a commit happened and
// how long it took; a commit hook of the kind React DevTools installs (on globalThis before react-dom is
// first evaluated) says which components rendered in it, by the rule DevTools uses: a fiber with no
// alternate was mounted, a component fiber carrying the PerformedWork flag rendered, and a subtree is
// entered only where its child list was rebuilt. The two must agree on the number of commits, and the
// hook must see the charts being drawn on the first mount, so neither can pass by seeing nothing.
//
// "A chart drew" means a component rendered somewhere below a ChartFrame's Plot, the part that calls the
// chart's drawing function; the chart is named by the ChartFrame's own title, as the page shows it.

// ---- the commit hook, before anything loads react-dom -------------------------------------------------
const hook = { renderers: 0, recording: false, commits: [] };
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]); // function, class, forwardRef, memo, simple memo
const PERFORMED_WORK = 1;
// esbuild renames `const X = memo(function X() {})`'s inner function to X2; the page's own name is X.
const nameOf = (fiber) => {
  const t = fiber.type;
  const raw = typeof t === "function" ? t.displayName || t.name : t && (t.displayName || t.type?.name || t.render?.name);
  return String(raw || "?").replace(/\d+$/, "");
};
function walk(fiber, ctx, out) {
  const prev = fiber.alternate;
  const rendered = COMPONENT_TAGS.has(fiber.tag) && (prev === null || (fiber.flags & PERFORMED_WORK) === PERFORMED_WORK);
  const name = COMPONENT_TAGS.has(fiber.tag) ? nameOf(fiber) : null;
  if (rendered) {
    out.components.push(name);
    if (ctx.inPlot && ctx.chart !== null) out.charts.add(ctx.chart);
  }
  let next = ctx;
  if (name === "ChartFrame") next = { chart: String(fiber.memoizedProps?.title ?? "?"), inPlot: false };
  else if (name === "Plot" && ctx.chart !== null) next = { ...ctx, inPlot: true };
  if (prev === null || fiber.child !== prev.child) {
    for (let c = fiber.child; c; c = c.sibling) walk(c, next, out);
  }
}
globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  renderers: new Map(),
  supportsFiber: true,
  inject(internals) {
    hook.renderers += 1;
    this.renderers.set(hook.renderers, internals);
    return hook.renderers;
  },
  checkDCE() {},
  onScheduleFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  onCommitFiberRoot(_id, root) {
    if (!hook.recording) return;
    const out = { components: [], charts: new Set() };
    for (let c = root.current.child; c; c = c.sibling) walk(c, { chart: null, inPlot: false }, out);
    hook.commits.push(out);
  },
};

const { check, done } = await import("./_assert.mjs");
const { act, render, text } = await import("./_dom.mjs");
const { createElement: h, Profiler, useCallback, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: App, AppView, TAB_LOADERS, settlingOf } = await import("../src/App.tsx");
const { TAB_IDS } = await import("../src/types.ts");
const { exampleAnalysis, examplePayload, settingsFor } = await import("./_analysis.mjs");
const TABS = Object.fromEntries(await Promise.all(TAB_IDS.map(async (id) => [id, (await TAB_LOADERS[id]()).default])));

check(hook.renderers === 1, "hook: react-dom handed its internals to the commit hook, so the hook sees every commit", `renderers ${hook.renderers}`);

// ---- recording ----------------------------------------------------------------------------------------
let profiled = 0;
const onRender = () => {
  if (hook.recording) profiled += 1;
};
// Runs fn (inside act unless it brings its own) and returns what rendered: every component name, and
// the charts that drew.
function record(fn, wrap = true) {
  hook.commits = [];
  profiled = 0;
  hook.recording = true;
  try {
    if (wrap) act(fn);
    else fn();
  } finally {
    hook.recording = false;
  }
  const components = new Set(hook.commits.flatMap((c) => c.components));
  const charts = new Set(hook.commits.flatMap((c) => [...c.charts]));
  return { commits: hook.commits.length, profiled, components, charts };
}
const list = (s) => [...s].sort().join(" | ") || "(none)";
const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function setValue(el, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
}
// The charts on the tab, in page order: the title a reader sees, the drawing itself (the chart body's
// markup, which is what a reader sees of the plot), and which of the two shared charts it is.
const chartsOn = (root) =>
  [...root.querySelectorAll(".app-tab figure.chart-frame")].map((f) => ({
    title: text(f.querySelector(".chart-title")),
    body: f.querySelector(".chart-body")?.innerHTML ?? "",
    kind: f.querySelector(".frontier-chart") ? "frontier" : f.querySelector(".wealth-chart") ? "wealth" : "other",
  }));
// After an edit: the charts that rendered again (by position), and the charts whose drawing changed. A
// chart that changed must have rendered; the claim tested is the other way round, that a chart which
// rendered again had something new to draw.
function outcome(before, after, rec) {
  const at = (pred) => new Set(after.flatMap((c, i) => (pred(c, i) ? [i] : [])));
  return { drew: at((c) => rec.charts.has(c.title)), changed: at((c, i) => c.body !== before[i]?.body), after };
}
const names = (o, set) => [...set].map((i) => `${o.after[i].kind} "${o.after[i].title.slice(0, 40)}"`).join(" | ") || "(none)";
const kinds = (o, set) => new Set([...set].map((i) => o.after[i].kind));

// ---- the page with a stand-in workbench: the analysis stays put, the reader's inputs are live ------------
const EX = exampleAnalysis();
const READY = { status: "ready", value: EX };
const RF = { status: "ready", value: { rate: EX.rf, date: EX.asOf, source: "FRED DGS3MO" } };
let drive = null;
function Harness({ tab }) {
  const [settings, setSettingsState] = useState(() => settingsFor(examplePayload(), { rf: EX.rf }));
  const setSettings = useCallback((p) => setSettingsState((s) => ({ ...s, ...p })), []);
  const [level, setLevel] = useState("plain");
  const [weights, setWeights] = useState({});
  const [current, setTab] = useState(tab);
  drive = { setWeights };
  const wb = {
    settings, setSettings, level, setLevel, analysis: READY, fetching: false, failure: null, rf: RF, weights, setWeights, tab: current, setTab,
  };
  return h(Profiler, { id: "page", onRender }, h(AppView, { wb, tabs: TABS }));
}

function mount(tab) {
  let page = null;
  const first = record(() => {
    page = render(h(Harness, { tab }));
  }, false);
  return { root: page.container, unmount: page.unmount, first };
}
function pickLevel(root) {
  const pills = [...root.querySelectorAll('[aria-label="Explanation level"] [role=radio]')];
  const off = pills.find((p) => p.getAttribute("aria-checked") === "false");
  return { off, label: text(off) };
}

// ---- Custom tab -------------------------------------------------------------------------------------------
{
  const { root, first, unmount } = mount("custom");
  let now = chartsOn(root);
  const all = new Set(now.map((c) => c.title));
  check(first.charts.size >= 2 && same(first.charts, all), "hook: on the first mount it sees every chart on the Custom tab drawn", list(first.charts));
  check(first.commits > 0 && first.commits === first.profiled, "hook: it sees exactly the commits React's Profiler reports", `${first.commits} vs ${first.profiled}`);
  check(same(new Set(now.map((c) => c.kind)), new Set(["frontier", "wealth"])), "Custom: the tab draws a frontier and a wealth chart", now.map((c) => c.kind).join(" "));

  const { off, label } = pickLevel(root);
  let before = now;
  const lv = record(() => off.click());
  let o = outcome(before, (now = chartsOn(root)), lv);
  check(pickLevel(root).label !== label && lv.components.has("Tip"), "Custom, explanation level: the switch took, and the tooltips rendered again", `${label} -> ${pickLevel(root).label}`);
  check(lv.commits === lv.profiled, "Custom, explanation level: the hook and the Profiler count the same commits", `${lv.commits} vs ${lv.profiled}`);
  check(!kinds(o, o.drew).has("frontier"), "Custom, explanation level: the frontier does not render again", names(o, o.drew));
  check(o.drew.size === 0, "Custom, explanation level: no chart renders again (none of them shows the level)", names(o, o.drew));

  before = now;
  const am = record(() => setValue(root.querySelector(".cust input[name=amount]"), "25000"));
  o = outcome(before, (now = chartsOn(root)), am);
  check(/25,000/.test(text(root.querySelector(".cust"))), "Custom, amount: the new amount reached the page");
  check(same(kinds(o, o.drew), new Set(["wealth"])) && o.drew.size === 1, "Custom, amount: the wealth chart renders again and no other chart does", names(o, o.drew));
  check(!am.components.has("FrontierPlot") && !am.components.has("FrontierLabels"), "Custom, amount: nothing inside the frontier renders");
  check(am.commits === am.profiled, "Custom, amount: the hook and the Profiler count the same commits", `${am.commits} vs ${am.profiled}`);

  before = now;
  const wt = record(() => setValue(root.querySelector(".cust .cust-field"), "0.5"));
  o = outcome(before, (now = chartsOn(root)), wt);
  check(o.changed.size === now.length, "Custom, weight: every chart on the Custom tab shows the custom mix, and each drawing changed", names(o, o.changed));
  check(same(o.drew, o.changed), "Custom, weight: exactly the charts that show the custom mix render again", `drew ${names(o, o.drew)}; changed ${names(o, o.changed)}`);
  unmount();
}

// ---- Optimization tab: charts with and without the custom mix side by side ---------------------------------
{
  const { root, first, unmount } = mount("optimization");
  let now = chartsOn(root);
  const all = new Set(now.map((c) => c.title));
  check(first.charts.size >= 3 && same(first.charts, all), "hook: on the first mount it sees every chart on the Optimization tab drawn", list(first.charts));

  let before = now;
  const lv = record(() => pickLevel(root).off.click());
  let o = outcome(before, (now = chartsOn(root)), lv);
  check(lv.components.has("Tip") && !kinds(o, o.drew).has("frontier"), "Optimization, explanation level: the frontier does not render again", names(o, o.drew));
  check(o.drew.size === 0, "Optimization, explanation level: no chart renders again", names(o, o.drew));

  before = now;
  const am = record(() => setValue(root.querySelector(".app-tab input[name=amount]"), "30000"));
  o = outcome(before, (now = chartsOn(root)), am);
  check(same(kinds(o, o.drew), new Set(["wealth"])) && o.drew.size === 1, "Optimization, amount: the wealth chart renders again and no other chart does", names(o, o.drew));

  before = now;
  const tickers = EX.tickers;
  const wt = record(() => drive.setWeights({ [tickers[0]]: 0.6, [tickers[1]]: 0.1 }));
  o = outcome(before, (now = chartsOn(root)), wt);
  check(o.changed.size > 0 && o.changed.size < now.length, "Optimization, weight: some charts show the custom mix and change, some do not", names(o, o.changed));
  check(kinds(o, o.changed).has("frontier") && kinds(o, o.changed).has("wealth"), "Optimization, weight: the frontier and the wealth chart are among those that show it");
  check(same(o.drew, o.changed), "Optimization, weight: exactly the charts that show the custom mix render again", `drew ${names(o, o.drew)}; changed ${names(o, o.changed)}`);

  // Adding a scorecard column re-renders the scorecard and the weights table, and draws no chart but the
  // frontier, which is handed the construction to mark. The wealth chart and the bar charts stay put.
  before = now;
  const col = record(() => root.querySelector('.addcol-btn[data-col="rp"]').click());
  o = outcome(before, (now = chartsOn(root)), col);
  check(root.querySelector('.sc th[data-col="rp"]') !== null && col.components.has("Scorecard") && col.components.has("Table") && col.components.has("AddColumns"),
    "Optimization, add a column: the column is on, and the scorecard and the weights table render again", list(col.components));
  check([...kinds(o, o.drew)].every((k) => k === "frontier") && !col.components.has("Growth") && !col.components.has("WeightChart"),
    "Optimization, add a column: neither the wealth chart nor any bar chart renders again", names(o, o.drew));
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
  now = chartsOn(root);
  before = now;
  const lv2 = record(() => pickLevel(root).off.click());
  o = outcome(before, (now = chartsOn(root)), lv2);
  check(lv2.components.has("Tip") && o.drew.size === 0, "Optimization, explanation level with a column added: no chart renders again, the frontier included", names(o, o.drew));
  unmount();
}

// ---- every tab: an explanation level redraws no chart; an amount redraws only what it changes -------------
for (const tab of TAB_IDS) {
  const { root, first, unmount } = mount(tab);
  let now = chartsOn(root);
  // The walk-forward tab may open on no chart at all (its first segment can say it cannot run); every chart it
  // does draw is held like the others'. Every other tab opens on at least one.
  check((now.length > 0 || tab === "walkforward") && first.charts.size === new Set(now.map((c) => c.title)).size,
    `${tab}: the hook sees each of the tab's charts drawn on the first mount`, list(first.charts));
  let before = now;
  const lv = record(() => pickLevel(root).off.click());
  let o = outcome(before, (now = chartsOn(root)), lv);
  check(lv.components.has("Tip") && o.drew.size === 0, `${tab}, explanation level: the tooltips render again and no chart does`, names(o, o.drew));
  const amount = root.querySelector(".app-tab input[name=amount]");
  if (amount) {
    before = now;
    const am = record(() => setValue(amount, "40000"));
    o = outcome(before, (now = chartsOn(root)), am);
    check(o.changed.size > 0 && same(o.drew, o.changed), `${tab}, amount: the charts drawn from the amount render again, and only they`, `drew ${names(o, o.drew)}; changed ${names(o, o.changed)}`);
  }
  unmount();
}

// ---- Walk-forward tab: a repaint never solves the test again; an option does, once ---------------------------
// Your basket solves after paint, a slice of work per macrotask (src/tabs/walkforward/liveSolve.ts), and keeps
// each run per analysis and options. The counter is the segment's own count of finished solves.
{
  const { SOLVES } = await import("../src/tabs/walkforward/live.ts");
  const settle = () => act(async () => {
    for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
  const { root, unmount } = mount("walkforward");
  await settle();
  const landed = !!root.querySelector('[data-segment="basket"] .tbl');
  let n = SOLVES.count;
  const lv = record(() => pickLevel(root).off.click());
  await settle();
  check(landed && lv.components.has("Tip") && SOLVES.count === n,
    "walkforward, explanation level: the tooltips render again and the walk-forward test is not solved again", `landed ${landed}, solves ${SOLVES.count - n}`);
  check(!lv.components.has("Holds") && !lv.components.has("Table"), "walkforward, explanation level: no table renders again", list(lv.components));
  n = SOLVES.count;
  const hold = [...root.querySelectorAll('[role=radiogroup][aria-label="Hold for"] [role=radio]')].find((b) => b.getAttribute("aria-checked") === "false");
  record(() => hold.click());
  await settle();
  check(SOLVES.count === n + 1 && !!root.querySelector('[data-segment="basket"] .tbl'), "walkforward, an option: the walk-forward test is solved again, once, and lands", `solves ${SOLVES.count - n}`);
  unmount();
}

// ---- when the page counts its figures as the previous settings' -------------------------------------------
{
  const wbFor = (over) => ({ settings: { ...settingsFor(examplePayload()), rf: null, allowShort: false, ...over } });
  const live = { ...EX, rf: 0.04, rfSource: "live", allowShort: false };
  const typed = { ...EX, rf: 0.05, rfSource: "manual", allowShort: false };
  check(settlingOf(wbFor({}), live) === false, "settling: the rail and the analysis agree, nothing is marked");
  check(settlingOf(wbFor({}), null) === false, "settling: no analysis on screen, nothing to mark");
  check(settlingOf(wbFor({ allowShort: true }), live) === true, "settling: the switch is on and the figures were built with it off");
  check(settlingOf(wbFor({ rf: 0.05 }), live) === true, "settling: a rate is typed and the figures use another");
  check(settlingOf(wbFor({ rf: 0.05 }), typed) === false, "settling: the typed rate has reached the figures");
  check(settlingOf(wbFor({ rf: null }), typed) === true, "settling: the field is cleared and the figures still use the rate that was typed");
}

// ---- the real workbench: the switch answers first, the analysis follows -----------------------------------
// No act here: act would run the deferred render before returning, and the point is what the reader sees
// between the two. The example comes from the shipping file; the price and rate requests fail at once.
{
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const example = examplePayload();
  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.startsWith("/example-cross.json") ? example : { message: "not served in this suite" };
    return { ok: u.startsWith("/example-cross.json"), json: async () => body };
  };
  localStorage.clear();
  history.replaceState(null, "", "/?tab=custom");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(h(App));
  const until = async (ok, ms = 8000) => {
    const t0 = Date.now();
    while (!ok()) {
      if (Date.now() - t0 > ms) return false;
      await new Promise((r) => setTimeout(r, 10));
    }
    return true;
  };
  const shortSwitch = () => host.querySelector('[role=switch][name="allowShort"]');
  const panel = () => host.querySelector('.app-tab[role="tabpanel"]');
  const shortingNote = () => /shorting is on/.test(text(host.querySelector(".cust") ?? host));
  const bandBusy = () => host.querySelector("section.band")?.getAttribute("aria-busy") === "true";
  // Drawn, and the price request answered (it fails here), so nothing but the switch can mark the page busy.
  const drawn = await until(() => shortSwitch() && host.querySelector(".cust .cust-row") && panel() && !bandBusy());
  check(drawn, "switch: the page draws the Custom tab from the example, with no request out");
  if (drawn) {
    check(!shortSwitch().checked && !shortingNote(), "switch: it opens with shorting off, and the tab says so");
    check(panel().getAttribute("aria-busy") === null, "switch: before the click nothing is marked busy");
    // Every DOM state the commits leave behind, read as each commit's mutations are delivered: after the
    // commit itself and before its passive effects, which is when a chart's own store has not yet taken
    // the new figures. The first state that shows the rebuilt analysis must still carry the mark.
    const seen = [];
    const watch = new window.MutationObserver(() => {
      seen.push({ rebuilt: shortingNote(), busy: panel()?.getAttribute("aria-busy") ?? null, band: !!host.querySelector("section.band.band--settling") });
    });
    watch.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
    shortSwitch().click();
    await Promise.resolve();
    const flipped = shortSwitch().checked;
    const busy = panel().getAttribute("aria-busy");
    const band = host.querySelector("section.band");
    const stale = !shortingNote();
    check(flipped, "switch: its checked state updates at once");
    check(stale, "switch: at that moment the tab still shows the analysis without shorting (it has not been rebuilt yet)");
    check(busy === "true", "switch: meanwhile the tab says so, aria-busy on the panel (the dim)", `aria-busy ${busy}`);
    check(band?.getAttribute("aria-busy") === "true" && band.classList.contains("band--settling"), "switch: and so does the band above it", band?.className);
    const landed = await until(() => shortingNote() && panel().getAttribute("aria-busy") === null);
    check(landed, "switch: the rebuilt analysis lands, and the tab is no longer marked busy");
    check(!host.querySelector("section.band")?.classList.contains("band--settling"), "switch: the band's mark clears with it");
    watch.disconnect();
    const firstRebuilt = seen.find((s) => s.rebuilt);
    check(!!firstRebuilt && firstRebuilt.busy === "true" && firstRebuilt.band,
      "switch: the commit that lands the rebuilt analysis still carries the mark, which clears only on a later frame",
      JSON.stringify(firstRebuilt));
  }
  root.unmount();
  host.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

done("t-render");
