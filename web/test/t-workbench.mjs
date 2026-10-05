// The page hook (src/state/useWorkbench.ts), mounted in jsdom with fetch stubbed: the first screen
// is the baked example, prices are fetched only when what they are changes, a stale answer never
// lands, a failure keeps the last good result and names itself, and everything else recomputes in
// place. The rate is the mean 3-month Treasury yield over the prices' own window, today's beside it,
// and a cold load changes the numbers on screen once. Line numbers cite portfolio_app.py.
import { act, render } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { examplePayload, fixturePayload } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const W = await import("../src/state/useWorkbench.ts");
const { tangency } = await import("../src/lib/optimize.ts");
const { MESSAGES } = await import("../src/state/analyze.ts");
const { PREFS_KEY, SETTINGS_KEY } = await import("../src/state/storage.ts");
const { EXAMPLE_URL, FETCH_DELAY_MS, FIRST_SETTINGS, RF_HOLD_MS, RF_URL, URL_DELAY_MS, rfSeriesUrl, todayISO } = W;

const bits = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = (ms = 0) => act(async () => {
  await sleep(ms);
});
const later = () => settle(Math.max(FETCH_DELAY_MS, URL_DELAY_MS) + 60);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function deferred() {
  let resolve;
  const p = new Promise((r) => (resolve = r));
  return { p, resolve };
}

// fetch, stubbed: every call recorded; each URL answered by a route (or left pending).
let calls = [];
let routes = {};
globalThis.fetch = (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, signal: init.signal });
  const key = Object.keys(routes).find((k) => u.startsWith(k));
  return key ? routes[key](u, init) : new Promise(() => {});
};
const priceCalls = () => calls.filter((c) => c.url.startsWith("/api/prices"));

let wb = null;
// Every render's headline figure, so a test can count how many times the numbers on screen changed.
let seen = [];
function Probe() {
  wb = useWorkbenchSafe();
  const v = wb.analysis.status === "ready" ? wb.analysis.value : null;
  seen.push(v ? `${v.source} ${v.rf} ${v.tangency.sharpe}` : null);
  return null;
}
// The distinct figures in the order they appeared: each entry after the first is one change.
const changes = () => seen.filter((x, i) => x !== null && x !== seen[i - 1]);
function useWorkbenchSafe() {
  return W.useWorkbench();
}
function fresh(search = "") {
  localStorage.clear();
  history.replaceState(null, "", `/${search}`);
  calls = [];
  seen = [];
}
const rfCalls = () => calls.filter((c) => c.url.startsWith(RF_URL));

// The rate endpoint's answer: today's yield and a made-up daily series (every weekday from 2018 on,
// a rate that moves every day), so a mean over the wrong days is a different number.
const SERIES = [];
for (let t = Date.parse("2018-01-01T00:00:00Z"), i = 0; t <= Date.parse("2026-12-31T00:00:00Z"); t += 86400000) {
  const d = new Date(t);
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
  SERIES.push([d.toISOString().slice(0, 10), 0.005 + 0.04 * ((i++ % 89) / 89)]);
}
const rfAnswer = (start) => ({ rate: 0.041, date: "2026-09-25", source: "FRED DGS3MO", start, series: SERIES.filter(([d]) => d >= start) });
// The mean over the analysis' own first and last price day, worked out here without the page's code.
const meanOver = (a) => {
  const from = a.prices.dates[0];
  const to = a.prices.dates.at(-1);
  const xs = SERIES.filter(([d]) => d >= from && d <= to).map(([, r]) => r);
  return xs.reduce((x, y) => x + y, 0) / xs.length;
};
const ready = () => (wb.analysis.status === "ready" ? wb.analysis.value : null);

const EX = examplePayload();
const CROSS = fixturePayload("cross");
const MEGA = fixturePayload("megacap");
const SECT = fixturePayload("sectors");

// ---- first paint: the baked example ------------------------------------------------------------------
fresh();
const rfD = deferred();
const pxD = deferred();
routes = {
  [EXAMPLE_URL]: () => Promise.resolve(json(EX)),
  [RF_URL]: () => rfD.p,
  "/api/prices": () => pxD.p,
};
const view = render(h(Probe));
await settle();
let a = ready();
check(a && a.source === "example" && a.asOf === EX.dates.at(-1) && a.rf === EX.rf && a.rfSource === "example",
  "first paint: the baked example, computed through analyze(), labelled with its own price date and rate", a && `${a.source} ${a.asOf} ${a.rfSource}`);
check(bits(FIRST_SETTINGS.tickers, EX.tickers) && FIRST_SETTINGS.start === EX.start && FIRST_SETTINGS.benchmark === EX.benchmark,
  "first settings: the rail opens on the example's own tickers, start and benchmark", `${FIRST_SETTINGS.tickers} / ${EX.tickers}`);
check(bits(wb.settings.tickers, EX.tickers) && wb.settings.rf === null && wb.settings.end === null && wb.settings.amount === 10000,
  "first settings: with no link and nothing stored, the hook uses them (live rate, today, $10,000)");
check(calls.filter((c) => c.url === EXAMPLE_URL).length === 1 && rfCalls().length === 1 && rfCalls()[0].url === rfSeriesUrl(EX.start) &&
  rfCalls()[0].url === `/api/rf?start=${EX.start}`,
  "mount: the example is fetched once, and the rate once, at once, for the window's start", rfCalls().map((c) => c.url).join(" "));
check(wb.fetching === true && wb.failure === null, "mount: a live request for the same settings is under way while the example shows");
await later();
check(priceCalls().length === 1, "mount: one /api/prices request, after the delay", `${priceCalls().length}`);
const q = new URL(priceCalls()[0].url, "http://x").searchParams;
check(q.get("tickers") === EX.tickers.join(",") && q.get("start") === EX.start && q.get("end") === todayISO() && q.get("benchmark") === "^GSPC",
  "request: tickers, start, end (today when unset) and benchmark", priceCalls()[0].url);
const { pricesUrl: canonical } = await import("../src/data/prices.ts");
check(priceCalls()[0].url === canonical({ tickers: EX.tickers, benchmark: "^GSPC", start: EX.start, end: todayISO() }),
  "request: the endpoint's canonical url, key order included (one request, one cache entry)", priceCalls()[0].url);
check(ready()?.source === "example" && wb.fetching, "in flight: the example stays on screen and fetching says so");

const exampleFirst = a;
await act(async () => {
  rfD.resolve(json(rfAnswer(EX.start)));
  await sleep(0);
});
a = ready();
check(wb.rf.status === "ready" && a === exampleFirst && a.rf === EX.rf && a.rfSource === "example" && a.source === "example" &&
  wb.rf.value.basis === "example" && wb.rf.value.inUse === EX.rf && wb.rf.value.rate === 0.041,
  "live rate: the example keeps the rate it was baked at, and its numbers do not move, until live prices replace it",
  `${a.rf} ${a.rfSource} ${wb.rf.value?.basis}`);
await act(async () => {
  pxD.resolve(json(CROSS));
  await sleep(0);
});
a = ready();
check(a && a.source === "live" && a.pulledAt === CROSS.pulledAt && !wb.fetching && wb.failure === null,
  "live prices: a good answer replaces the example (source live), fetching off, no failure");
// ledger:rf-window, the page half. The app scores every window at the latest yield alone (the
// handler half, in t-api, reads fetch_rf_rate); the port scores at the mean over the window.
const want = meanOver(a);
check(a.rfSource === "live" && Math.abs(a.rf - want) < 1e-15 && a.rf !== 0.041 && wb.rf.value.basis === "window" &&
  wb.rf.value.inUse === a.rf && wb.rf.value.rate === 0.041 && wb.rf.value.window.from === a.prices.dates[0] &&
  wb.rf.value.window.to === a.prices.dates.at(-1),
  "ledger:rf-window: live prices are scored at the mean 3-month yield over their own first to last price day, with today's yield beside it",
  `${a.rf} vs ${want}; ${JSON.stringify(wb.rf.value.window)}`);
check(changes().length === 2 && changes()[0].startsWith("example") && changes()[1].startsWith("live"),
  "cold load: the numbers on screen change once, from the example to live prices", changes().join(" | "));

// ---- ledger:rf-live ----------------------------------------------------------------------------------------
// The app: the rate is frozen into session state only inside `if run_button:` (1087) and the
// derived state reads that frozen copy (1158), so an edited rate changes nothing until Run.
const app = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8").split("\n");
const runAt = app.findIndex((l) => /^if run_button:\s*$/.test(l));
const blockEnd = app.findIndex((l, i) => i > runAt && /^\S/.test(l) && !l.startsWith("#"));
const assigns = app.map((l, i) => (/^\s*st\.session_state\.rf\s*=/.test(l) ? i : -1)).filter((i) => i >= 0);
const readsFrozen = app.some((l) => /^rf = st\.session_state\.rf\s*$/.test(l));
const before = a;
const oldRf = before.rf;
const newRf = 0.06;
const stale = tangency(before.m, before.S, oldRf, false); // what the app keeps showing after the edit
const n0 = priceCalls().length;
await act(async () => {
  wb.setSettings({ rf: newRf });
  await sleep(0);
});
await later();
a = ready();
const fresh6 = tangency(a.m, a.S, newRf, false);
check(runAt > 0 && assigns.length === 1 && assigns[0] > runAt && assigns[0] < blockEnd && readsFrozen &&
  bits(stale.w, before.tangency.w) && !bits(stale.w, a.tangency.w),
  "ledger:rf-live: the app sets session_state.rf only inside `if run_button:` (1087) and derives from it (1158), so after an rf edit it still shows tangency at the old rate",
  `run ${runAt} assign ${assigns} end ${blockEnd}`);
check(a.rf === newRf && a.rfSource === "manual" && bits(a.tangency.w, fresh6.w) && a.tangency.sharpe === fresh6.sharpe && priceCalls().length === n0 && !wb.fetching,
  "ledger:rf-live: the port recomputes tangency at the edited rate at once, with ZERO new /api/prices calls",
  `${a.rf} ${a.tangency.sharpe} vs ${fresh6.sharpe}; calls ${n0} -> ${priceCalls().length}`);

// Shorting, amount, level, weights and tab: in place, no fetch.
await act(async () => {
  wb.setSettings({ allowShort: true, amount: 98765 });
  wb.setLevel("formula");
  wb.setWeights({ VTI: 0.5, AGG: -0.25 });
  wb.setTab("risk");
  await sleep(0);
});
await later();
a = ready();
check(a.allowShort && a.gmv.w.some((w) => w < 0) && priceCalls().length === n0, "shorting: the bounds change in place, with no price request");
check(!/98765|amount/.test(location.search) && location.search.includes("w=VTI:0.5,AGG:-0.25") && location.search.includes("tab=risk") && location.search.includes("short=1"),
  "url: the address bar carries the shorting, weights and tab, and never the amount", location.search);
const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
check(prefs.amount === 98765 && prefs.level === "formula" && !/98765/.test(localStorage.getItem(SETTINGS_KEY)),
  "storage: the amount and level are remembered in this browser, the amount only in the prefs", JSON.stringify(prefs));

// The scorecard's added columns: into the link, in the fixed order, never into storage; the analysis is not rebuilt.
await act(async () => {
  wb.setSettings({ cols: ["rp", "tan.1y"] });
  await sleep(0);
});
await later();
check(location.search.includes("cols=tan.1y,rp") && !/cols/.test(localStorage.getItem(SETTINGS_KEY) ?? "") && ready() === a && priceCalls().length === n0,
  "columns: added columns reach the link in the fixed order and not this browser's storage, with no fetch and the same analysis", location.search);

// The walk-forward tab's segment: "published" reaches the link only while it shows, and every other way into
// a tab opens the first segment. The rate history carries the series held and the basis of the figures on screen.
{
  const step = async (fn) => {
    await act(async () => {
      fn();
      await sleep(0);
    });
    await later();
  };
  await step(() => wb.setTab("walkforward", "published"));
  const shown = `${wb.tab}/${wb.view} ${location.search}`;
  const okShown = wb.view === "published" && /[?&]tab=walkforward&view=published(&|$)/.test(location.search);
  await step(() => wb.setTab("walkforward", "basket"));
  const first = `${wb.tab}/${wb.view} ${location.search}`;
  const okFirst = wb.view === "basket" && location.search.includes("tab=walkforward") && !/view=/.test(location.search);
  await step(() => wb.setTab("walkforward", "published"));
  await step(() => wb.setTab("risk"));
  const left = `${wb.tab}/${wb.view} ${location.search}`;
  const okLeft = wb.view === "basket" && location.search.includes("tab=risk") && !/view=/.test(location.search);
  check(okShown && okFirst && okLeft,
    "url: view=published is in the link only while the walk-forward tab shows that segment; leaving the tab opens the first next time",
    [shown, first, left].join(" | "));
  check(wb.rfHistory.series?.series.length > 0 && wb.rfHistory.basis === "manual" && ready()?.rfSource === "manual" && wb.rfHistory.loading === false,
    "rate history: the hook hands on the daily series it holds, and the basis of the figures on screen (a typed rate here)",
    `${wb.rfHistory.basis} ${wb.rfHistory.series?.series.length} ${wb.rfHistory.loading}`);
}

// ---- the window moves: the rate is asked for again from an earlier start, never a later one -----------------
{
  const n = rfCalls().length;
  routes[RF_URL] = (u) => Promise.resolve(json(rfAnswer(new URL(u, "http://x").searchParams.get("start"))));
  await act(async () => {
    wb.setSettings({ start: "2018-06-01" });
    await sleep(0);
  });
  check(rfCalls().length === n, "window: a new start is not asked for at once (it waits like prices do)");
  await later();
  check(rfCalls().length === n + 1 && rfCalls().at(-1).url === "/api/rf?start=2018-06-01",
    "window: after the pause, one rate request from the new, earlier start", rfCalls().slice(n).map((c) => c.url).join(" "));
  routes[RF_URL] = () => Promise.resolve(json({ error: "upstream", message: "FRED did not answer." }, 502));
  await act(async () => {
    wb.setSettings({ start: "2018-03-01" });
    await sleep(0);
  });
  await later();
  check(rfCalls().length === n + 2 && wb.rf.status === "ready" && wb.rf.value.rate === 0.041,
    "window: a failed lookup for a new start keeps today's yield from the last good answer", JSON.stringify(wb.rf).slice(0, 200));
  routes[RF_URL] = (u) => Promise.resolve(json(rfAnswer(new URL(u, "http://x").searchParams.get("start"))));
  const m = rfCalls().length;
  await act(async () => {
    wb.setSettings({ start: "2020-01-02" });
    await sleep(0);
  });
  await later();
  await act(async () => {
    wb.setSettings({ start: EX.start });
    await sleep(0);
  });
  await later();
  check(rfCalls().length === m, "window: a later start asks for nothing, since the series held covers it",
    rfCalls().slice(m).map((c) => c.url).join(" "));
}

// ---- the window moves later while its prices load: the numbers on screen stay as they are -------------------
{
  const kept = { rf: wb.settings.rf, allowShort: wb.settings.allowShort };
  await act(async () => {
    wb.setSettings({ rf: null, allowShort: false });
    await sleep(0);
  });
  await later();
  const before = ready();
  check(before?.source === "live" && wb.rf.value.basis === "window" && Math.abs(before.rf - meanOver(before)) < 1e-15,
    "setup: live prices on screen, scored at the rate over their window", `${before?.source} ${wb.rf.value?.basis}`);
  const savedPx = routes["/api/prices"];
  const px = deferred();
  routes["/api/prices"] = () => px.p;
  const n = rfCalls().length;
  const k = changes().length;
  await act(async () => {
    wb.setSettings({ start: "2021-01-04" });
    await sleep(0);
  });
  await later();
  const mid = ready();
  check(wb.fetching && rfCalls().length === n && wb.rf.value.basis === "window" && mid.rf === before.rf &&
    mid.tangency.sharpe === before.tangency.sharpe && changes().length === k,
    "window later: while its prices load, the prices on screen keep their own window's rate and the numbers do not change",
    `fetching ${wb.fetching} calls ${rfCalls().slice(n).map((c) => c.url)} basis ${wb.rf.value.basis} rf ${mid.rf} vs ${before.rf}`);
  await act(async () => {
    px.resolve(json({ error: "upstream", message: "Yahoo did not answer." }, 502));
    await sleep(0);
  });
  const after = ready();
  check(!wb.fetching && wb.failure !== null && wb.rf.value.basis === "window" && after.rf === before.rf && changes().length === k,
    "window later: if those prices never come, what is on screen stays at its window's rate, and the rail does not say the rate failed",
    `basis ${wb.rf.value.basis} rf ${after.rf}`);
  routes["/api/prices"] = savedPx;
  await act(async () => {
    wb.setSettings({ start: EX.start, ...kept });
    await sleep(0);
  });
  await later();
}

// ---- debounce and staleness ----------------------------------------------------------------------------------
const pending = {};
routes["/api/prices"] = (u) => {
  const d = deferred();
  pending[new URL(u, "http://x").searchParams.get("tickers")] = d;
  return d.p;
};
const n1 = priceCalls().length;
// Two separate edits, a third of the delay apart: a valid request each, so only the delay can merge them.
await act(async () => {
  wb.setSettings({ tickers: ["AAPL", "MSFT", "JPM"] });
});
await settle(FETCH_DELAY_MS / 3);
await act(async () => {
  wb.setSettings({ tickers: MEGA.tickers });
});
await later();
check(priceCalls().length === n1 + 1 && pending[MEGA.tickers.join(",")], "debounce: two edits inside the delay send one request, for the last",
  `${priceCalls().length - n1}`);
const reqA = priceCalls().at(-1);
await act(async () => {
  wb.setSettings({ tickers: SECT.tickers });
  await sleep(0);
});
await later();
check(reqA.signal?.aborted === true && priceCalls().length === n1 + 2, "stale: a newer request aborts the older one");
await act(async () => {
  pending[SECT.tickers.join(",")].resolve(json(SECT));
  await sleep(0);
});
await act(async () => {
  pending[MEGA.tickers.join(",")].resolve(json(MEGA)); // the earlier request answers last
  await sleep(0);
});
a = ready();
check(a && bits(a.tickers, SECT.tickers) && !wb.fetching && wb.failure === null,
  "stale: an earlier request resolving after a later one never replaces the newer result", a && a.tickers.join());

// ---- failures keep the last good result and name themselves --------------------------------------------------
const failWith = async (label, answer, tickers, want) => {
  routes["/api/prices"] = answer;
  const n = priceCalls().length;
  await act(async () => {
    wb.setSettings({ tickers });
    await sleep(0);
  });
  await later();
  const r = ready();
  check(priceCalls().length === n + 1 && r && bits(r.tickers, SECT.tickers) && !wb.fetching && wb.failure?.error === want.error &&
    wb.failure?.message === want.message,
  `failure: ${label} keeps the last good result on screen and names what failed`, `${wb.failure?.error}: ${wb.failure?.message}`);
};
await failWith("an endpoint error", () => Promise.resolve(json({ error: "upstream", message: "Yahoo did not answer." }, 502)),
  ["VTI", "AGG", "GLD"], { error: "fetch-failed", message: "Yahoo did not answer." });
await failWith("a 200 that is not prices", () => Promise.resolve(json({ hello: "world" })),
  ["VTI", "AGG", "EFA"], { error: "fetch-failed", message: MESSAGES["fetch-failed"] });
await failWith("a network error", () => Promise.reject(new TypeError("Failed to fetch")),
  ["VTI", "GLD", "EFA"], { error: "fetch-failed", message: MESSAGES["fetch-failed"] });
await failWith("prices whose benchmark failed", () => Promise.resolve(json({ ...CROSS, missing: ["^GSPC"] })),
  ["AGG", "GLD", "EFA"], { error: "bench-failed", message: MESSAGES["bench-failed"] });
const n2 = priceCalls().length;
await act(async () => {
  wb.setSettings({ tickers: ["VTI", "AGG"] });
  await sleep(0);
});
await later();
check(priceCalls().length === n2 && wb.failure?.error === "too-few" && !wb.fetching && bits(ready()?.tickers, SECT.tickers),
  "request check: two tickers are refused by name without a request, the last result stays");
routes["/api/prices"] = () => Promise.resolve(json(CROSS));
await act(async () => {
  wb.setSettings({ tickers: CROSS.tickers });
  await sleep(0);
});
await later();
check(wb.failure === null && bits(ready()?.tickers, CROSS.tickers), "recovery: the next good answer clears the failure");
view.unmount();

// ---- cold load, prices first: live prices wait for their window's rate -------------------------------------------
{
  fresh();
  const late = deferred();
  routes = {
    [EXAMPLE_URL]: () => Promise.resolve(json(EX)),
    [RF_URL]: () => late.p,
    "/api/prices": () => Promise.resolve(json(CROSS)),
  };
  const v = render(h(Probe));
  await settle();
  await later();
  const r = ready();
  check(r?.source === "example" && r.rf === EX.rf && wb.fetching === true,
    "cold load: live prices that land before the rate wait, with the example still on screen and fetching on",
    `${r?.source} ${r?.rf} fetching ${wb.fetching}`);
  await settle(RF_HOLD_MS + 150);
  const r2 = ready();
  check(r2 === r && wb.fetching === true,
    "cold load: with no rate known at all, the live prices keep waiting past RF_HOLD_MS rather than show at the placeholder",
    `${r2?.source} ${r2?.rf} fetching ${wb.fetching}`);
  await act(async () => {
    late.resolve(json(rfAnswer(EX.start)));
    await sleep(0);
  });
  const b = ready();
  check(b?.source === "live" && Math.abs(b.rf - meanOver(b)) < 1e-15 && !wb.fetching && changes().length === 2,
    "cold load: when the rate lands the live prices show, at the rate over their window, in one change", changes().join(" | "));
  v.unmount();
}

// ---- an earlier window on a slow FRED: today's yield after RF_HOLD_MS, the window's rate when it lands -----------
{
  fresh();
  const slow = deferred();
  // The same prices 52 weeks earlier (weekdays kept): a window that opens before the series already held.
  const DAY = 86400000;
  const EARLY = {
    ...CROSS,
    start: "2018-01-01",
    rows: CROSS.rows.map(([d, ...xs]) => [new Date(Date.parse(d + "T00:00:00Z") - 364 * DAY).toISOString().slice(0, 10), ...xs]),
  };
  routes = {
    [EXAMPLE_URL]: () => Promise.resolve(json(EX)),
    [RF_URL]: (u) => {
      const s = new URL(u, "http://x").searchParams.get("start");
      return s === EX.start ? Promise.resolve(json(rfAnswer(s))) : slow.p;
    },
    "/api/prices": (u) => Promise.resolve(json(new URL(u, "http://x").searchParams.get("start") === EX.start ? CROSS : EARLY)),
  };
  const v = render(h(Probe));
  await settle();
  await later();
  const before = ready();
  await act(async () => {
    wb.setSettings({ start: "2018-01-01" });
    await sleep(0);
  });
  await later();
  const held = ready();
  check(before?.source === "live" && held === before && wb.fetching && rfCalls().at(-1)?.url === rfSeriesUrl("2018-01-01"),
    "slow rate, today's known: the earlier window's prices first wait for their own rate, the last numbers still on screen",
    `${held?.prices.dates[0]} fetching ${wb.fetching} ${rfCalls().map((c) => c.url).join(" ")}`);
  await settle(RF_HOLD_MS + 150);
  const now = ready();
  check(now?.prices.dates[0] === EARLY.rows[0][0] && now.rf === 0.041 && wb.rf.value.basis === "today" && wb.rf.value.loading === true && !wb.fetching,
    "slow rate, today's known: after RF_HOLD_MS they show at today's yield, and the view says the window's rate is still loading",
    `${now?.prices.dates[0]} rf ${now?.rf} basis ${wb.rf.value?.basis} loading ${wb.rf.value?.loading} fetching ${wb.fetching}`);
  await act(async () => {
    slow.resolve(json(rfAnswer("2018-01-01")));
    await sleep(0);
  });
  const after = ready();
  check(after?.prices.dates[0] === EARLY.rows[0][0] && Math.abs(after.rf - meanOver(after)) < 1e-15 && wb.rf.value.basis === "window" &&
    wb.rf.value.loading === false,
    "slow rate, today's known: when the window's rate lands the numbers move to it",
    `rf ${after?.rf} vs ${after && meanOver(after)} basis ${wb.rf.value?.basis}`);
  v.unmount();
}

// ---- cold load, prices first, then a later start before the rate lands --------------------------------------------
{
  fresh();
  const late = deferred();
  const next = deferred();
  let asked = 0;
  routes = {
    [EXAMPLE_URL]: () => Promise.resolve(json(EX)),
    [RF_URL]: (u) => {
      const s = new URL(u, "http://x").searchParams.get("start");
      return s === EX.start ? late.p : Promise.resolve(json(rfAnswer(s)));
    },
    "/api/prices": () => (asked++ === 0 ? Promise.resolve(json(CROSS)) : next.p),
  };
  const v = render(h(Probe));
  await settle();
  await later();
  await act(async () => {
    wb.setSettings({ start: "2021-01-04" });
    await sleep(0);
  });
  await later();
  check(rfCalls().length === 1 && rfCalls()[0].url === rfSeriesUrl(EX.start) && !rfCalls()[0].signal.aborted,
    "window later, rate still out: the request that covers the prices already held is left to finish, and none is sent for the later start",
    rfCalls().map((c) => `${c.url} ${c.signal.aborted}`).join(" "));
  await act(async () => {
    late.resolve(json(rfAnswer(EX.start)));
    await sleep(0);
  });
  const b = ready();
  check(b?.source === "live" && Math.abs(b.rf - meanOver(b)) < 1e-15 && wb.rf.value.basis === "window" && changes().length === 2,
    "window later, rate still out: when it lands the live prices show at their own window's rate, in one change", changes().join(" | "));
  v.unmount();
}

// The walk-forward segment a link opens: published only beside the walk-forward tab.
for (const [search, want] of [["?tab=walkforward&view=published", "walkforward/published"], ["?view=published", "returns/basket"], ["?tab=risk&view=published", "risk/basket"]]) {
  fresh(search);
  routes = {};
  const v = render(h(Probe));
  await settle();
  check(`${wb.tab}/${wb.view}` === want, `url: ${search} opens ${want}`, `${wb.tab}/${wb.view}`);
  v.unmount();
}

// ---- where settings come from: the link, then this browser, then FIRST_SETTINGS -------------------------------
fresh("?tickers=XLK,XLF,XLV&tab=correlation&w=XLK:0.5&amount=777");
localStorage.setItem(SETTINGS_KEY, "?tickers=AAPL,MSFT,JPM&start=2020-01-02&bench=%5ENDX");
localStorage.setItem(PREFS_KEY, JSON.stringify({ level: "finance", amount: 4200 }));
routes = {};
const v2 = render(h(Probe));
await settle();
check(bits(wb.settings.tickers, ["XLK", "XLF", "XLV"]) && wb.settings.start === "2020-01-02" && wb.settings.benchmark === "^NDX" &&
  wb.settings.allowShort === FIRST_SETTINGS.allowShort && wb.tab === "correlation" && wb.weights.XLK === 0.5 && wb.level === "finance" && wb.settings.amount === 4200,
  "precedence: the link's fields, then the stored ones, then the first settings; amount and level from this browser, never the link",
  JSON.stringify({ ...wb.settings, tab: wb.tab, level: wb.level }));
check(wb.analysis.status === "loading", "no example yet: loading, not an empty result");
v2.unmount();

// Added columns come from the link only: a stored value is not read, and a link without cols= opens none.
fresh("?tab=optimization&cols=rp,bogus,tan.1y,rp");
localStorage.setItem(SETTINGS_KEY, "?tickers=AAPL,MSFT,JPM&cols=tan.bs");
const v5 = render(h(Probe));
await settle();
const linked = JSON.stringify(wb.settings.cols);
v5.unmount();
fresh("?tab=optimization");
localStorage.setItem(SETTINGS_KEY, "?tickers=AAPL,MSFT,JPM&cols=tan.bs");
const v6 = render(h(Probe));
await settle();
check(linked === '["tan.1y","rp"]' && JSON.stringify(wb.settings.cols) === "[]",
  "columns: the link's known ids open in the fixed order; a stored list is never read, so no link means the default table", `${linked} / ${JSON.stringify(wb.settings.cols)}`);
v6.unmount();

// A live answer that lands before the example is not overwritten by it.
fresh();
const exD = deferred();
routes = { [EXAMPLE_URL]: () => exD.p, "/api/prices": () => Promise.resolve(json(CROSS)) };
const v4 = render(h(Probe));
await settle();
await later();
await act(async () => {
  exD.resolve(json(EX));
  await sleep(0);
});
check(ready()?.source === "live" && ready()?.pulledAt === CROSS.pulledAt, "order: an example arriving after the live prices does not replace them");
v4.unmount();

// Nothing to show at all: named, never blank.
fresh();
routes = {
  [EXAMPLE_URL]: () => Promise.resolve(json({ error: "gone" }, 404)),
  [RF_URL]: () => Promise.resolve(json({ error: "upstream", message: "FRED did not answer." }, 502)),
  "/api/prices": () => Promise.resolve(json({ error: "not-implemented", message: "The price endpoint is not built yet." }, 501)),
};
const v3 = render(h(Probe));
await settle();
await later();
check(wb.analysis.status === "error" && wb.analysis.name === "prices" && wb.analysis.message === "The price endpoint is not built yet.",
  "no example and no live prices: the analysis is an error naming the prices", JSON.stringify(wb.analysis));
check(wb.rf.status === "error" && wb.rf.message === "FRED did not answer.", "rate: a failed lookup is an error with the endpoint's sentence");
v3.unmount();

done("t-workbench");
