// The page's state in one hook: settings, level, the analysis, the live rate, custom weights and
// the active tab.
//
// The app computes nothing until Run is pressed, and then freezes the rate with the prices
// (1087, read back at 1158), so an edited rate does nothing until the next Run. Here there is no
// Run button. The only thing that fetches is a change to what the prices ARE (tickers, dates,
// benchmark): it waits FETCH_DELAY_MS for typing to settle, and a newer request aborts the older,
// whose answer is then dropped even if it arrives. Everything else (the rate, shorting, the
// amount, the level, the custom weights) recomputes from the prices already held.
//
// The first screen is never empty: the baked example (public/example-cross.json, preloaded by
// index.html) is computed through the same analyze() and labelled "example" with its own price
// date, and a live answer replaces it when one lands. While a request is out, the result on screen
// stays and `fetching` says so; a failed request keeps it too and `failure` names what failed.
//
// The rate: by default the mean 3-month Treasury yield over the days the prices cover
// (src/state/rfwindow.ts), fetched again when the start date moves earlier than the series held. The example keeps the rate it
// was baked at until live prices replace it, and live prices wait for the rate over their own window
// when it is on its way, so a cold load changes the numbers on screen once, not two or three times.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { parseTickers, validateRequest } from "../lib/clean.ts";
import { isExample } from "../data/payload.ts";
import { analyze, isPricePayload, MESSAGES, priceSpan } from "./analyze.ts";
import { DEFAULT_SETTINGS, DEFAULT_TAB, PRESETS, RF_FALLBACK } from "./defaults.ts";
import { isIsoDay, readRfSeries, windowRate, type RfResolved, type RfSeries, type RfView } from "./rfwindow.ts";
import { loadPrefs, loadSettings, savePrefs, saveSettings } from "./storage.ts";
import { decodeShare, encodeShare } from "./url.ts";
import type {
  Analysis, AnalysisError, CustomWeights, Level, LoadState, PricePayload, RfChoice, RfRate, Settings,
  ShareSettings, TabId, Workbench,
} from "../types.ts";

export const EXAMPLE_URL = "/example-cross.json";
export const PRICES_URL = "/api/prices";
export const RF_URL = "/api/rf";
// How long a price-affecting edit must sit still before it is fetched: long enough to type a
// ticker, short enough to feel immediate.
export const FETCH_DELAY_MS = 300;
// How long the page waits for the rate before giving up on it. The endpoint gives FRED 10 s.
export const RF_WAIT_MS = 12000;
// How long live prices wait for their window's rate when today's yield is already known from an
// earlier answer: after that they show at today's yield, the rail says the window's rate is still
// loading, and they move to it when it lands. With no rate known at all, as on a cold load, they wait
// for the answer instead (RF_WAIT_MS), because the only rate to show them at would be the placeholder.
export const RF_HOLD_MS = 3000;
// The address bar is rewritten at most this often (browsers throttle history.replaceState).
export const URL_DELAY_MS = 250;

// The settings the page opens with when neither the link nor this browser names any: the app's
// sidebar (defaults.ts) with the tickers of the example on the first screen, the Cross-asset preset
// (60-85), so the rail and the numbers beside it describe the same portfolio while the example
// shows. test/t-workbench.mjs holds the baked example to these.
export const FIRST_SETTINGS: Settings = { ...DEFAULT_SETTINGS, tickers: parseTickers(PRESETS[0].tickers) };

// What the price endpoint is asked for. `end` null is today, in the visitor's own calendar.
export interface PriceRequest {
  tickers: string[];
  start: string;
  end: string;
  benchmark: string;
}

export function todayISO(now = new Date()): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function priceRequest(s: Settings, today = todayISO()): PriceRequest {
  return { tickers: s.tickers, start: s.start, end: s.end ?? today, benchmark: s.benchmark };
}

// The endpoint's canonical spelling, key order included (src/data/prices.ts builds the same url),
// so one request is one cache entry. t-workbench holds the two to each other.
export function pricesUrl(r: PriceRequest): string {
  const q = new URLSearchParams({ tickers: r.tickers.join(","), benchmark: r.benchmark, start: r.start, end: r.end });
  return `${PRICES_URL}?${q}`;
}

// The rate lookup for prices that start on `start`: the latest yield and every day since.
export function rfSeriesUrl(start: string): string {
  return `${RF_URL}?${new URLSearchParams({ start })}`;
}

// The rate an analysis uses, resolved before analyze() runs:
// 1. a typed rate wins;
// 2. the example keeps the rate it was baked at for as long as it is on screen, even once the live
//    rate is in, so the example's numbers never change before live prices replace them;
// 3. the mean yield over the prices' own first and last day, when the series held covers them;
// 4. the latest yield, when it does not (its request failed, or the prices start before it);
// 5. the app's fallback when FRED could not be reached at all (709-712).
// The window mean is worked out whichever rule wins, so the rail can show it beside today's.
export function chooseRf(
  manual: number | null,
  rf: LoadState<RfSeries>,
  payload: PricePayload | null,
  span: { from: string; to: string } | null,
): RfResolved {
  const live = rf.status === "ready" ? rf.value : null;
  const window = live && span ? windowRate(live, span.from, span.to) : null;
  if (manual !== null) return { choice: { rate: manual, source: "manual" }, basis: "manual", window };
  if (payload && isExample(payload)) return { choice: { rate: payload.rf, source: "example" }, basis: "example", window };
  if (window) return { choice: { rate: window.rate, source: "live" }, basis: "window", window };
  if (live) return { choice: { rate: live.rate, source: "live" }, basis: "today", window: null };
  return { choice: { rate: RF_FALLBACK, source: "fallback" }, basis: "fallback", window: null };
}

// Our own endpoints answer a failure with an ApiError; its sentence names what failed.
function apiMessage(body: unknown): string | null {
  const m = (body as { message?: unknown } | null)?.message;
  return typeof m === "string" && m.length > 0 && m.length <= 300 ? m : null;
}

function fetchFailed(body: unknown): AnalysisError {
  return { ok: false, error: "fetch-failed", message: apiMessage(body) ?? MESSAGES["fetch-failed"], events: [] };
}

// Never rejects: a network error, an abort or a body that is not JSON all come back as data.
async function getJson(url: string, signal: AbortSignal): Promise<{ ok: boolean; body: unknown }> {
  try {
    const res = await fetch(url, { signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: null };
  }
}

// analyze() refuses by value, but the engine underneath is still arithmetic on data from outside;
// a throw from it is a failed request, not a blank page.
function safeAnalyze(p: PricePayload, s: Settings, rf: RfChoice): Analysis | AnalysisError {
  try {
    return analyze(p, s, rf);
  } catch {
    return { ok: false, error: "fetch-failed", message: MESSAGES["fetch-failed"], events: [] };
  }
}

const shareOf = ({ amount: _amount, ...s }: Settings): ShareSettings => s;

function currentSearch(): string {
  try {
    return globalThis.location?.search ?? "";
  } catch {
    return "";
  }
}

// The link first, then this browser, then FIRST_SETTINGS, field by field.
function initialState() {
  const share = decodeShare(currentSearch());
  const prefs = loadPrefs();
  const settings: Settings = { ...FIRST_SETTINGS, ...loadSettings(), ...share.settings, amount: prefs.amount };
  return { settings, level: prefs.level, weights: share.weights ?? {}, tab: share.tab ?? DEFAULT_TAB };
}

function shareSearch(settings: Settings, weights: CustomWeights, tab: TabId): string {
  return encodeShare({
    settings: shareOf(settings),
    weights: Object.keys(weights).length ? weights : null,
    tab: tab === DEFAULT_TAB ? null : tab,
  });
}

export function useWorkbench(): Workbench {
  const [init] = useState(initialState);
  const [settings, setSettingsState] = useState<Settings>(init.settings);
  const [level, setLevel] = useState<Level>(init.level);
  const [weights, setWeights] = useState<CustomWeights>(init.weights);
  const [tab, setTab] = useState<TabId>(init.tab);
  // The prices on screen: only a payload analyze() accepted ever lands here.
  const [payload, setPayload] = useState<PricePayload | null>(null);
  const [exampleFailed, setExampleFailed] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [failure, setFailure] = useState<AnalysisError | null>(null);
  const [rf, setRf] = useState<LoadState<RfSeries>>({ status: "loading" });
  // A rate request is out for the current start date.
  const [rfPending, setRfPending] = useState(true);
  const rfAnswered = useRef(false);

  const setSettings = useCallback((patch: Partial<Settings>) => {
    const next = patch.tickers ? { ...patch, tickers: parseTickers(patch.tickers.join(",")) } : patch;
    setSettingsState((s) => ({ ...s, ...next }));
  }, []);

  // Once: the example.
  useEffect(() => {
    const ctrl = new AbortController();
    void getJson(EXAMPLE_URL, ctrl.signal).then(({ ok, body }) => {
      if (ctrl.signal.aborted) return;
      const ex = ok && isPricePayload(body) ? body : null;
      const a = ex && safeAnalyze(ex, DEFAULT_SETTINGS, chooseRf(null, { status: "loading" }, ex, null).choice);
      if (ex && a && a.ok) setPayload((prev) => prev ?? ex); // a live answer that landed first wins
      else setExampleFailed(true);
    });
    return () => ctrl.abort();
  }, []);

  // The rate: at once on the first load, then again whenever the start date moves earlier than the
  // series held (after the same pause as prices). A failed lookup keeps the last good answer, so
  // today's yield is not lost to a window that could not be fetched; the page then scores against
  // today's yield and says so.
  //
  // The series is asked for from the earlier of the start date and the start the live prices on screen
  // were fetched with. Those prices stay on screen while newer ones load, and for good if they never
  // come, so a series from a later day, which could not score them, would put them at today's yield.
  // For the same reason a later start asks for nothing: a series from an earlier day covers every
  // later window, and the request already out, if one is, is left to finish.
  const heldFrom = payload && !isExample(payload) && isIsoDay(payload.start) ? payload.start : null;
  const rfStart = heldFrom !== null && isIsoDay(settings.start) && heldFrom < settings.start ? heldFrom : settings.start;
  const rfHeld = useRef(rf);
  rfHeld.current = rf;
  useEffect(() => {
    if (!isIsoDay(rfStart)) {
      setRfPending(false);
      return;
    }
    const held = rfHeld.current;
    if (held.status === "ready" && held.value.start <= rfStart) {
      setRfPending(false);
      return;
    }
    let stale = false;
    const ctrl = new AbortController();
    setRfPending(true);
    const run = () => {
      const give = setTimeout(() => ctrl.abort(), RF_WAIT_MS);
      void getJson(rfSeriesUrl(rfStart), ctrl.signal).then(({ ok, body }) => {
        clearTimeout(give);
        if (stale) return;
        rfAnswered.current = true;
        setRfPending(false);
        const r = ok ? readRfSeries(body, rfStart) : null;
        setRf((prev) =>
          r ? { status: "ready", value: r } : prev.status === "ready" ? prev : {
            status: "error",
            name: "risk-free rate",
            message: apiMessage(body) ?? "The live 3-month Treasury rate could not be loaded.",
          },
        );
      });
    };
    const timer = rfAnswered.current ? setTimeout(run, FETCH_DELAY_MS) : null;
    if (timer === null) run();
    return () => {
      stale = true;
      if (timer !== null) clearTimeout(timer);
      ctrl.abort();
    };
  }, [rfStart]);

  // Prices: only when what they are changes.
  const priceKey = JSON.stringify(priceRequest(settings));
  useEffect(() => {
    const req = JSON.parse(priceKey) as PriceRequest;
    const bad = validateRequest(req.tickers, req.start, req.end);
    if (bad) {
      setFetching(false);
      setFailure({ ok: false, error: bad, message: MESSAGES[bad], events: [] });
      return;
    }
    const ctrl = new AbortController();
    setFetching(true);
    const timer = setTimeout(() => {
      void getJson(pricesUrl(req), ctrl.signal).then(({ ok, body }) => {
        // A newer request aborted this one: its answer, however late, is not the page's.
        if (ctrl.signal.aborted) return;
        setFetching(false);
        if (!ok || !isPricePayload(body)) {
          setFailure(fetchFailed(body));
          return;
        }
        // Cleaning depends only on the payload, so any bounds and rate tell whether it is usable.
        const a = safeAnalyze(body, DEFAULT_SETTINGS, { rate: RF_FALLBACK, source: "fallback" });
        if (!a.ok) {
          setFailure(a);
          return;
        }
        setPayload(body);
        setFailure(null);
      });
    }, FETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [priceKey]);

  // Everything else recomputes in place, from the prices already held.
  const span = useMemo(() => (payload ? priceSpan(payload) : null), [payload]);
  const pick = chooseRf(settings.rf, rf, payload, span);
  // Live prices whose window rate is still on its way are held back while something else is on
  // screen: shown now at another rate, they would change a second time when it lands. The wait ends
  // when the lookup answers, fails or times out (RF_WAIT_MS); after a failure today's yield, or the
  // fallback, is used. When today's yield is already held, the wait is capped at RF_HOLD_MS, counted
  // from when these prices arrived, and a slow FRED costs one extra change instead of a stalled page.
  const shown = useRef<{ computed: Analysis | AnalysisError; pick: RfResolved } | null>(null);
  const wantHold =
    settings.rf === null && payload !== null && !isExample(payload) && rfPending && pick.basis !== "window" && shown.current !== null;
  // The prices whose wait ran out. Kept by identity, so newer prices start a wait of their own.
  const [spentFor, setSpentFor] = useState<PricePayload | null>(null);
  useEffect(() => {
    if (!wantHold) return;
    const t = setTimeout(() => setSpentFor(payload), RF_HOLD_MS);
    return () => clearTimeout(t);
  }, [wantHold, payload]);
  const hold = wantHold && !(spentFor === payload && pick.basis === "today");
  // The two rail inputs that rebuild the analysis, the shorting switch and a typed rate, reach it one
  // render behind the rail. The render that flips the switch (or shows the typed rate) is cheap and
  // paints at once; the rebuilt analysis, and every card drawn from it, follows in a render React may
  // interrupt and restart if the reader moves again. Until it lands, the analysis on screen disagrees
  // with the rail, and the page marks its figures as waiting (src/App.tsx). Only the reader's own
  // inputs wait: new prices and a rate that lands from FRED still reach the analysis together, in one
  // render, so a cold load changes the numbers on screen once.
  const shortFor = useDeferredValue(settings.allowShort);
  const manualFor = useDeferredValue(settings.rf);
  const behind = shortFor !== settings.allowShort || manualFor !== settings.rf;
  const pickFor = behind ? chooseRf(manualFor, rf, payload, span) : pick;
  const fresh = useMemo(
    () => (payload && !hold ? safeAnalyze(payload, { ...settings, allowShort: shortFor }, pickFor.choice) : null),
    // analyze() reads only allowShort from the settings.
    [payload, shortFor, pickFor.choice.rate, pickFor.choice.source, hold],
  );
  // What is on screen, kept for the next hold. Written during render, but only ever with what this
  // same render returns, so rendering twice writes the same thing twice.
  if (!hold) shown.current = fresh ? { computed: fresh, pick: pickFor } : null;
  const computed = hold ? (shown.current?.computed ?? null) : fresh;
  // The rail's "scored against" names the rate of the figures on screen, so it follows them, not the field.
  const inUse = hold ? (shown.current?.pick ?? pick) : pickFor;
  const analysis = useMemo<LoadState<Analysis>>(() => {
    if (computed?.ok) return { status: "ready", value: computed };
    if (computed) return { status: "error", name: "analysis", message: computed.message };
    if (exampleFailed && !fetching) {
      return { status: "error", name: "prices", message: failure?.message ?? "The example prices could not be loaded." };
    }
    return { status: "loading" };
  }, [computed, exampleFailed, fetching, failure]);

  // Remembered in this browser: the level and amount, and the last settings (never the amount).
  useEffect(() => savePrefs({ level, amount: settings.amount }), [level, settings.amount]);
  const shareKey = JSON.stringify(shareOf(settings));
  useEffect(() => saveSettings(JSON.parse(shareKey) as ShareSettings), [shareKey]);

  // The address bar carries the share link once the visitor changes something (never the amount).
  const search = shareSearch(settings, weights, tab);
  const written = useRef(shareSearch(init.settings, init.weights, init.tab));
  useEffect(() => {
    if (search === written.current) return;
    written.current = search;
    const t = setTimeout(() => {
      try {
        history.replaceState(history.state, "", `${location.pathname}${search}${location.hash}`);
      } catch {
        // a sandboxed frame or a throttled history: the page works without the link
      }
    }, URL_DELAY_MS);
    return () => clearTimeout(t);
  }, [search]);

  // The rail's view of the rate: the latest yield, plus the window mean and what the numbers on
  // screen are scored against. RfView extends RfRate, so it travels in the same slot.
  const win = inUse.window;
  const rfView = useMemo<LoadState<RfRate>>(() => {
    if (rf.status !== "ready") return rf;
    const { rate, date, source } = rf.value;
    const view: RfView = { rate, date, source, window: win, basis: inUse.basis, inUse: inUse.choice.rate, loading: rfPending };
    return { status: "ready", value: view };
    // The window by value, not by identity: it is rebuilt on every render.
  }, [rf, win?.rate, win?.from, win?.to, win?.days, inUse.basis, inUse.choice.rate, rfPending]);

  return {
    settings, setSettings, level, setLevel, analysis, fetching: fetching || hold, failure, rf: rfView, weights, setWeights, tab, setTab,
  };
}
