// The page hook (src/state/useWorkbench.ts), mounted in jsdom with fetch stubbed: the first screen
// is the baked example, prices are fetched only when what they are changes, a stale answer never
// lands, a failure keeps the last good result and names itself, and everything else recomputes in
// place. Line numbers cite portfolio_app.py.
import { act, render } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { examplePayload, fixturePayload } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const W = await import("../src/state/useWorkbench.ts");
const { tangency } = await import("../src/lib/optimize.ts");
const { MESSAGES } = await import("../src/state/analyze.ts");
const { PREFS_KEY, SETTINGS_KEY } = await import("../src/state/storage.ts");
const { EXAMPLE_URL, FETCH_DELAY_MS, FIRST_SETTINGS, RF_URL, URL_DELAY_MS, todayISO } = W;

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
function Probe() {
  wb = useWorkbenchSafe();
  return null;
}
function useWorkbenchSafe() {
  return W.useWorkbench();
}
function fresh(search = "") {
  localStorage.clear();
  history.replaceState(null, "", `/${search}`);
  calls = [];
}
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
check(calls.filter((c) => c.url === EXAMPLE_URL).length === 1 && calls.filter((c) => c.url === RF_URL).length === 1,
  "mount: the example and the live rate are each fetched once");
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

await act(async () => {
  rfD.resolve(json({ rate: 0.041, date: "2026-09-25", source: "FRED DGS3MO" }));
  await sleep(0);
});
a = ready();
check(wb.rf.status === "ready" && a.rf === 0.041 && a.rfSource === "live" && a.source === "example",
  "live rate: it replaces the example's rate at once, labelled live");
await act(async () => {
  pxD.resolve(json(CROSS));
  await sleep(0);
});
a = ready();
check(a && a.source === "live" && a.pulledAt === CROSS.pulledAt && !wb.fetching && wb.failure === null,
  "live prices: a good answer replaces the example (source live), fetching off, no failure");

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
