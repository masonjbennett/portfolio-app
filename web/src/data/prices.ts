// The price endpoint's pure half: the one query shape /api/prices answers, the Yahoo v8 chart
// request for each symbol, the parse, and the outer join into the row-major payload (PriceRows,
// src/types.ts). api/prices.ts is only the HTTP wrapper around it. fetchPrices takes its fetch as an
// option (and otherwise reads globalThis.fetch at call time), so node tests reach every branch
// without a network.
//
// The oracle is download_data (portfolio_app.py 861-886) over _fetch_prices (815-858): the benchmark
// is fetched with the tickers, a symbol that returns nothing usable is REPORTED in `missing` rather
// than dropped, and the survivors are outer-joined on date.
import { MAX_TICKERS } from "../lib/clean.ts";
import { BENCHMARKS } from "../state/defaults.ts";
import type { ApiError, PriceRows } from "../types.ts";

// A series shorter than this counts as missing, not as a stub (812, applied at 856).
export const MIN_TRADING_DAYS = 30;

// ---- the canonical query ---------------------------------------------------------------------------
// The edge cache keys on the full url, so every spelling of a request is a separate upstream spend.
// The handler answers ONLY this shape and refuses anything else before any request leaves. Values
// are compared after URLSearchParams has decoded them, never as the raw query string: the platform
// re-serialises a query before the function sees it ("a,b" arrives as "a%2Cb").

export interface PricesQuery {
  tickers: string[]; // in the order asked, which is the column order of the answer
  benchmark: string;
  start: string; // ISO, inclusive
  end: string; // ISO, exclusive, as yfinance treats it
}

const KEYS = ["tickers", "benchmark", "start", "end"] as const;

// Yahoo's symbol alphabet: an optional leading caret (an index, ^GSPC), then a letter or digit, then
// letters, digits, ".", "-" and "=", at most 15 characters in all. That takes what the app hands to
// yfinance from its ticker box (1007): a share class (BRK-B), a foreign listing (VOD.L, 0700.HK), a
// currency pair (EURUSD=X), a future (GC=F) or a coin (BTC-USD). It refuses what no symbol carries:
// lower case (the rail upper-cases), a slash, a space, a caret past the first place, a leading "." or
// "-", and anything longer. chartUrl() percent-encodes the symbol as well, so this is the canonical
// spelling, not the only guard on the path.
export const SYMBOL = /^(?=.{1,15}$)\^?[A-Z0-9][A-Z0-9.=-]*$/;

// The benchmark is the app's selectbox (728-735), so only its six symbols are accepted.
export const BENCHMARK_SYMBOLS: readonly string[] = BENCHMARKS.map((b) => b.symbol);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

// A real calendar day: the pattern, then a round trip through Date, which is what refuses 2026-02-31.
export function isIsoDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}

export type QueryResult = { ok: true; query: PricesQuery } | { ok: false; message: string };

// `today` is the UTC date. An end more than a day past it asks for bars that do not exist yet and
// would only mint new cache keys; one day of slack lets a reader east of UTC send their own today.
// There is deliberately NO floor on start: the app's date input stops at 2009-01-01 (Streamlit's
// default of value minus ten years on 702), and the port asks Yahoo for whatever start it is given.
export function parsePricesQuery(params: URLSearchParams, today: string): QueryResult {
  for (const k of params.keys()) {
    if (!(KEYS as readonly string[]).includes(k)) return { ok: false, message: `Unknown parameter: ${k}.` };
  }
  const got: Record<string, string> = {};
  for (const k of KEYS) {
    const all = params.getAll(k);
    if (all.length !== 1 || all[0] === "") return { ok: false, message: `Give ${k} exactly once.` };
    got[k] = all[0];
  }
  const tickers = got.tickers.split(",");
  const bad = tickers.find((t) => !SYMBOL.test(t));
  if (bad !== undefined) return { ok: false, message: `Not a symbol this endpoint accepts: "${bad}".` };
  if (new Set(tickers).size !== tickers.length) return { ok: false, message: "A ticker is listed twice." };
  if (tickers.length > MAX_TICKERS) return { ok: false, message: `At most ${MAX_TICKERS} tickers.` };
  if (!BENCHMARK_SYMBOLS.includes(got.benchmark)) {
    return { ok: false, message: `Benchmark must be one of ${BENCHMARK_SYMBOLS.join(", ")}.` };
  }
  if (!isIsoDate(got.start) || !isIsoDate(got.end)) return { ok: false, message: "Dates must be YYYY-MM-DD." };
  if (got.start >= got.end) return { ok: false, message: "start must be before end." };
  if (got.end > addDays(today, 1)) return { ok: false, message: "end is in the future." };
  return { ok: true, query: { tickers, benchmark: got.benchmark, start: got.start, end: got.end } };
}

// The url the page should request: the canonical spelling, built the way the handler parses it.
export function pricesUrl(q: PricesQuery): string {
  const params = new URLSearchParams({ tickers: q.tickers.join(","), benchmark: q.benchmark, start: q.start, end: q.end });
  return `/api/prices?${params}`;
}

// ---- one symbol from Yahoo -------------------------------------------------------------------------

// yfinance localises start and end to the exchange's midnight and treats end as exclusive. Daily bars
// are stamped at the session open (09:30 New York is 13:30 or 14:30 UTC), so UTC midnight bounds pick
// the same bars for a US listing: the start day's bar is in, the end day's bar is out.
export function chartUrl(symbol: string, start: string, end: string): string {
  const p1 = Date.parse(start + "T00:00:00Z") / 1000;
  const p2 = Date.parse(end + "T00:00:00Z") / 1000;
  return (
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits`
  );
}

export interface Series {
  dates: string[]; // ISO, ascending, one per trading day
  values: number[]; // adjusted closes
}

interface ChartBody {
  chart?: {
    result?: {
      meta?: { gmtoffset?: unknown };
      timestamp?: unknown;
      indicators?: { adjclose?: { adjclose?: unknown }[] };
    }[];
  };
}

// auto_adjust=True (832) makes yfinance's Close the split- AND dividend-adjusted close, which in the
// v8 chart is indicators.adjclose, NOT indicators.quote.close (split-adjusted only). A body with no
// adjclose array is a failure: falling back to close would mix adjusted and unadjusted columns.
// Each stamp is dated in the exchange's own zone (gmtoffset), the date yfinance's index carries once
// download_data drops the zone (884-885). A missing or non-finite close is dropped, as close[t].dropna()
// does (855); a date that appears twice keeps its last value.
export function parseChart(body: unknown): Series | null {
  const result = (body as ChartBody | null)?.chart?.result?.[0];
  const ts = result?.timestamp;
  const adj = result?.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(ts) || !Array.isArray(adj) || ts.length !== adj.length) return null;
  const off = typeof result?.meta?.gmtoffset === "number" ? result.meta.gmtoffset : 0;
  const byDate = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const v = adj[i];
    if (typeof t !== "number" || typeof v !== "number" || !Number.isFinite(v)) continue;
    byDate.set(new Date((t + off) * 1000).toISOString().slice(0, 10), v);
  }
  const dates = [...byDate.keys()].sort();
  return { dates, values: dates.map((d) => byDate.get(d) as number) };
}

// Why one symbol failed. rate-limited and upstream are transient and retried once; the rest are
// Yahoo's answer and would come back the same.
export type Failure = "rate-limited" | "upstream" | "not-found" | "no-data" | "short";
type Outcome = { ok: true; series: Series } | { ok: false; why: Failure };

const USER_AGENT = "Mozilla/5.0 (compatible; portfolio-app/1.0)";

async function fetchOne(f: typeof fetch, url: string, timeoutMs: number): Promise<Outcome> {
  let body: unknown;
  try {
    const res = await f(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 429) return { ok: false, why: "rate-limited" };
    if (res.status === 404) return { ok: false, why: "not-found" };
    if (!res.ok) return { ok: false, why: "upstream" };
    body = await res.json();
  } catch {
    return { ok: false, why: "upstream" }; // a network error, a timeout, or a body that is not JSON
  }
  const series = parseChart(body);
  if (!series || !series.dates.length) return { ok: false, why: "no-data" };
  if (series.dates.length < MIN_TRADING_DAYS) return { ok: false, why: "short" };
  return { ok: true, series };
}

// ---- all symbols, joined ---------------------------------------------------------------------------

// The union of every series' dates, ascending, with null where a column had no bar that day: the
// outer join pd.DataFrame(data) makes of a dict of Series (882).
export function joinSeries(series: Series[]): (string | number | null)[][] {
  const dates = [...new Set(series.flatMap((s) => s.dates))].sort();
  const index = series.map((s) => new Map(s.dates.map((d, i) => [d, s.values[i]])));
  return dates.map((d) => [d, ...index.map((m) => m.get(d) ?? null)]);
}

// Each attempt gets 8 s; a transient failure is retried once after 1 s, so the worst case is about
// 17 s, inside the 30 s vercel.json gives the function. The app retries twice, after 1 s and 3 s
// (872-877), inside one Streamlit run with no deadline.
export const ATTEMPT_MS = 8000;
export const RETRY_DELAY_MS = 1000;

export interface FetchOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}

export type PricesResult =
  | { ok: true; payload: PriceRows; healthy: boolean }
  | { ok: false; status: number; body: ApiError };

export async function fetchPrices(q: PricesQuery, opts: FetchOptions = {}): Promise<PricesResult> {
  const f = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? ATTEMPT_MS;
  // Order-preserving dedupe with the benchmark last; a benchmark that is also a ticker is fetched
  // once and keeps its ticker position (864).
  const all = [...new Set([...q.tickers, q.benchmark])];
  const got = new Map<string, Outcome>();
  const run = (symbols: string[]) =>
    Promise.all(symbols.map(async (s) => got.set(s, await fetchOne(f, chartUrl(s, q.start, q.end), timeoutMs))));
  const transient = (s: string) => {
    const o = got.get(s);
    return !!o && !o.ok && (o.why === "rate-limited" || o.why === "upstream");
  };

  await run(all);
  const retry = all.filter(transient);
  if (retry.length) {
    await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? RETRY_DELAY_MS));
    await run(retry);
  }

  // Columns keep the request's order. The app's retry appends recovered symbols after the first
  // batch's (876); the order carries no meaning there, so the port does not reproduce it.
  const columns = all.filter((s) => got.get(s)?.ok);
  const missing = all.filter((s) => !got.get(s)?.ok);
  const why = missing.map((s) => {
    const o = got.get(s);
    return o && !o.ok ? o.why : "upstream";
  });

  if (!columns.length) {
    // download_data returns (None, missing) here (879-880). The port says WHICH failure it was, so
    // the page never tells a reader to check a spelling when Yahoo simply did not answer (the
    // complaint in _fetch_prices' docstring, 816-823).
    if (why.includes("rate-limited")) {
      return { ok: false, status: 503, body: { error: "rate-limited", message: "Yahoo Finance refused the requests as too many. Try again in a minute." } };
    }
    if (why.includes("upstream")) {
      return { ok: false, status: 502, body: { error: "upstream", message: "Yahoo Finance did not answer for any of these symbols." } };
    }
    return {
      ok: false,
      status: 404,
      body: { error: "no-data", message: `Yahoo Finance has fewer than ${MIN_TRADING_DAYS} daily prices for every one of these symbols in this range.` },
    };
  }

  const series = columns.map((s) => {
    const o = got.get(s);
    return o && o.ok ? o.series : { dates: [], values: [] };
  });
  const rows = joinSeries(series);
  const payload: PriceRows = {
    tickers: q.tickers,
    benchmark: q.benchmark,
    start: q.start,
    end: q.end,
    pulledAt: new Date().toISOString(),
    missing,
    columns,
    rows,
  };
  return { ok: true, payload, healthy: missing.length === 0 && rows.length > 0 };
}

// ---- Cache-Control, decided on the way out ---------------------------------------------------------

// Any missing symbol or empty answer: one minute, and never served stale, so a recovered upstream
// reaches the next reader instead of a remembered failure (the app clears its cache on any failure,
// 1031).
export const CACHE_FAILED = "public, s-maxage=60";
// A range that reaches today: an hour, the app's own download_data TTL (861). Stale for another hour
// while one request refreshes it.
export const CACHE_RECENT = "public, s-maxage=3600, stale-while-revalidate=3600";
// A range wholly in the past changes only when a new dividend or split re-scales adjclose: a day.
export const CACHE_PAST = "public, s-maxage=86400, stale-while-revalidate=86400";

export function pricesCache(healthy: boolean, end: string, today: string): string {
  if (!healthy) return CACHE_FAILED;
  return end >= today ? CACHE_RECENT : CACHE_PAST;
}
