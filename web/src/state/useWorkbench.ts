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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseTickers, validateRequest } from "../lib/clean.ts";
import { isExample } from "../data/payload.ts";
import { analyze, isPricePayload, MESSAGES } from "./analyze.ts";
import { DEFAULT_SETTINGS, DEFAULT_TAB, PRESETS, RF_FALLBACK } from "./defaults.ts";
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

// The rate an analysis uses, resolved before analyze() runs: a typed rate wins; then the live
// one; the example, before the live rate is in, keeps the rate it was baked at; a live payload with
// no live rate uses the app's fallback, as the app does when FRED cannot be reached (709-712).
export function resolveRf(manual: number | null, rf: LoadState<RfRate>, payload: PricePayload | null): RfChoice {
  if (manual !== null) return { rate: manual, source: "manual" };
  if (rf.status === "ready") return { rate: rf.value.rate, source: "live" };
  if (payload && isExample(payload)) return { rate: payload.rf, source: "example" };
  return { rate: RF_FALLBACK, source: "fallback" };
}

function readRf(body: unknown): RfRate | null {
  const b = body as Partial<RfRate> | null;
  return b && typeof b.rate === "number" && Number.isFinite(b.rate) && typeof b.date === "string" && typeof b.source === "string"
    ? { rate: b.rate, date: b.date, source: b.source }
    : null;
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
  const [rf, setRf] = useState<LoadState<RfRate>>({ status: "loading" });

  const setSettings = useCallback((patch: Partial<Settings>) => {
    const next = patch.tickers ? { ...patch, tickers: parseTickers(patch.tickers.join(",")) } : patch;
    setSettingsState((s) => ({ ...s, ...next }));
  }, []);

  // Once: the example and the live rate.
  useEffect(() => {
    const ctrl = new AbortController();
    void getJson(EXAMPLE_URL, ctrl.signal).then(({ ok, body }) => {
      if (ctrl.signal.aborted) return;
      const ex = ok && isPricePayload(body) ? body : null;
      const a = ex && safeAnalyze(ex, DEFAULT_SETTINGS, resolveRf(null, { status: "loading" }, ex));
      if (ex && a && a.ok) setPayload((prev) => prev ?? ex); // a live answer that landed first wins
      else setExampleFailed(true);
    });
    void getJson(RF_URL, ctrl.signal).then(({ ok, body }) => {
      if (ctrl.signal.aborted) return;
      const r = ok ? readRf(body) : null;
      setRf(r ? { status: "ready", value: r } : {
        status: "error",
        name: "risk-free rate",
        message: apiMessage(body) ?? "The live 3-month Treasury rate could not be loaded.",
      });
    });
    return () => ctrl.abort();
  }, []);

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
  const rfChoice = resolveRf(settings.rf, rf, payload);
  const computed = useMemo(
    () => (payload ? safeAnalyze(payload, settings, rfChoice) : null),
    // analyze() reads only allowShort from the settings.
    [payload, settings.allowShort, rfChoice.rate, rfChoice.source],
  );
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

  return { settings, setSettings, level, setLevel, analysis, fetching, failure, rf, weights, setWeights, tab, setTab };
}
