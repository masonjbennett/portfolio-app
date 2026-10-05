// The share link: settings (never the dollar amount, but the scorecard's added columns), custom weights
// and the tab (with the walk-forward tab's segment, only when it is the published one), as a query
// string. The app has no share link at all; its sidebar starts over on every visit (645-805).
//
// Encoding picks each field BY NAME, never by spreading the object it is given, so an amount
// passed in by mistake has no way into the string. Decoding trusts nothing: a link is typed,
// truncated, pasted into chat apps and edited by hand, so every field is parsed on its own, and a
// field that does not parse is left out (the caller falls back to storage, then the defaults).
// Nothing here throws.
import { SYMBOL } from "../data/prices.ts";
import { MAX_TICKERS, parseTickers } from "../lib/clean.ts";
import { ADDED_IDS, type AddedId } from "../lib/added.ts";
import { BENCHMARKS } from "./defaults.ts";
import { TAB_IDS } from "../types.ts";
import type { CustomWeights, ShareSettings, ShareState, TabId, WalkView } from "../types.ts";

// Query keys. Short, because people read and paste the link.
const K = { tickers: "tickers", start: "start", end: "end", rf: "rf", bench: "bench", short: "short", cols: "cols", w: "w", tab: "tab", view: "view" };

// The app does not validate ticker characters (1007); a URL is hostile input, so a symbol is held
// to the pattern the price endpoint accepts (Yahoo's alphabet: BRK-B, ^GSPC, EURUSD=X), and a link
// can never carry a ticker the endpoint would refuse.
// Longer than any honest value (ten tickers, ten weights, all four added columns); a longer one is not
// parsed at all. It bounds each value, not the link: view=published adds a key of its own, not length to one.
export const MAX_PARAM = 400;
// The rate field has no bounds in the app (717). A link gets a sane one: -100% to 100%.
const MAX_RF = 1;
// The widest slider bounds the app offers, shorting on (1716-1719).
const MAX_WEIGHT = 1;

// Commas and colons are legal in a query and keep the link readable.
const enc = (v: string) => encodeURIComponent(v).replace(/%2C/gi, ",").replace(/%3A/gi, ":");

// A query string beginning with "?", or "" when there is nothing to carry. `end` and `rf` are
// written only when set: null means "today" and "the live rate", which a link must not freeze.
export function encodeShare(state: ShareState): string {
  const s = state.settings;
  const parts: string[] = [];
  const put = (k: string, v: string) => parts.push(`${k}=${enc(v)}`);
  if (s.tickers?.length) put(K.tickers, s.tickers.join(","));
  if (s.start) put(K.start, s.start);
  if (s.end) put(K.end, s.end);
  if (typeof s.rf === "number" && Number.isFinite(s.rf)) put(K.rf, String(s.rf));
  if (s.benchmark) put(K.bench, s.benchmark);
  if (typeof s.allowShort === "boolean") put(K.short, s.allowShort ? "1" : "0");
  // Only the added constructions, each once, in the fixed order whatever order they were clicked in.
  const cols = Array.isArray(s.cols) ? ADDED_IDS.filter((id) => s.cols?.includes(id)) : [];
  if (cols.length) put(K.cols, cols.join(","));
  const w = state.weights ? Object.entries(state.weights).filter(([t, v]) => SYMBOL.test(t) && Number.isFinite(v)) : [];
  if (w.length) put(K.w, w.map(([t, v]) => `${t}:${v}`).join(","));
  if (state.tab) put(K.tab, state.tab);
  // The walk-forward tab's second segment is the one view a link carries, and only beside that tab: the
  // first segment is what the tab opens on anyway, and no other tab has segments.
  if (state.tab === "walkforward" && state.view === "published") put(K.view, "published");
  return parts.length ? `?${parts.join("&")}` : "";
}

function isoDay(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(v + "T00:00:00Z");
  // The round trip refuses a day that does not exist (2026-02-31 would parse as March 3).
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

// A plain decimal, never "Infinity", "0x10" or "" (all of which Number() accepts), within ±bound.
function num(v: string, bound: number): number | null {
  if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(v)) return null;
  const x = Number(v);
  return Number.isFinite(x) && Math.abs(x) <= bound ? x : null;
}

// Parsed as the rail parses them (1007). Up to twice the ten-ticker limit is kept, so a link with
// eleven still opens and the page names the problem ("no more than 10") instead of dropping them.
function tickers(v: string): string[] | null {
  const t = parseTickers(v);
  return t.length && t.length <= MAX_TICKERS * 2 && t.every((s) => SYMBOL.test(s)) ? t : null;
}

// "VTI:0.3,AGG:-0.1". One bad pair, or a ticker named twice, and the whole map is left out: a
// partly read set of weights would be a portfolio nobody chose.
function weights(v: string): CustomWeights | null {
  const out: CustomWeights = {};
  const pairs = v.split(",");
  if (pairs.length > MAX_TICKERS * 2) return null;
  for (const pair of pairs) {
    const at = pair.lastIndexOf(":");
    const t = pair.slice(0, Math.max(at, 0)).trim().toUpperCase();
    const x = at > 0 ? num(pair.slice(at + 1).trim(), MAX_WEIGHT) : null;
    if (!SYMBOL.test(t) || x === null || Object.hasOwn(out, t)) return null;
    out[t] = x;
  }
  return out;
}

// "tan.1y,rp". Known ids are kept once each, in the fixed order; anything else is dropped, so a mangled
// list still opens the columns it names correctly. None known is the same as none at all.
function columns(v: string): AddedId[] | null {
  const named = v.split(",").map((x) => x.trim());
  const kept = ADDED_IDS.filter((id) => named.includes(id));
  return kept.length ? kept : null;
}

// Reads a query string (location.search, with or without its "?"). Anything malformed is left
// out, never guessed.
export function decodeShare(search: string): ShareState {
  const settings: Partial<ShareSettings> = {};
  let w: CustomWeights | null = null;
  let tab: TabId | null = null;
  let view: WalkView | null = null;
  try {
    const q = new URLSearchParams(typeof search === "string" ? search : "");
    const get = (k: string) => {
      const v = q.get(k);
      return v !== null && v.length > 0 && v.length <= MAX_PARAM ? v : null;
    };
    const tk = get(K.tickers);
    const t = tk === null ? null : tickers(tk);
    if (t) settings.tickers = t;
    const st = get(K.start);
    const start = st === null ? null : isoDay(st);
    if (start) settings.start = start;
    const en = get(K.end);
    const end = en === null ? null : isoDay(en);
    if (end) settings.end = end;
    const r = get(K.rf);
    const rf = r === null ? null : num(r, MAX_RF);
    if (rf !== null) settings.rf = rf;
    // Only a benchmark the rail offers (728-735): a link cannot make the page fetch any symbol as one.
    const b = get(K.bench);
    if (b !== null && BENCHMARKS.some((x) => x.symbol === b)) settings.benchmark = b;
    const sh = get(K.short);
    if (sh === "1" || sh === "0") settings.allowShort = sh === "1";
    const cv = get(K.cols);
    const cols = cv === null ? null : columns(cv);
    if (cols) settings.cols = cols;
    const wv = get(K.w);
    w = wv === null ? null : weights(wv);
    const tb = get(K.tab);
    tab = tb !== null && (TAB_IDS as readonly string[]).includes(tb) ? (tb as TabId) : null;
    // "published" beside the walk-forward tab, exactly; any other value, or the key on any other tab, is ignored.
    view = tab === "walkforward" && get(K.view) === "published" ? "published" : null;
  } catch {
    // URLSearchParams does not throw on a malformed escape today; if a runtime ever does, the link
    // is simply not read.
  }
  return { settings, weights: w, tab, view };
}
