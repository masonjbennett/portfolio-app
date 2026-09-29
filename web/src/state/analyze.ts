// The prices to everything the band and the tabs share, computed once per (payload, settings,
// rate). The app runs the request checks and the cleaning once, at Run (1007-1092), then derives
// the same state on every rerun (1156-1169); here both happen in one pure call.
//
// The payload is the record of what was requested (tickers, dates, benchmark); settings supply only
// what is read live, the bounds. The rate is resolved by the caller, so this never fetches. Every
// refusal is a named AnalysisError, never a throw: a payload of the wrong SHAPE (a cached or
// proxied answer that is not prices) is refused as "fetch-failed" before the engine sees it.
import { cleanPrices, column, computeReturns, validateRequest } from "../lib/clean.ts";
import { covMatrix, mean } from "../lib/num.ts";
import { frontier, gmv, tangency } from "../lib/optimize.ts";
import { annualizedStats } from "../lib/stats.ts";
import { isExample, toFrame } from "../data/payload.ts";
import { benchDisplay, FRONTIER_POINTS } from "./defaults.ts";
import type { Analysis, AnalysisError, AnalysisErrorId, PricePayload, RfChoice, Settings } from "../types.ts";

// The app's wording (1011-1082), minus its instructions to click a Run button this page does not
// have. "reversed" could never show in the app (it tested the two-year minimum first).
export const MESSAGES: Readonly<Record<AnalysisErrorId, string>> = {
  "too-few": "Please enter at least 3 unique tickers.",
  "too-many": "Please enter no more than 10 tickers.",
  reversed: "End date must be after start date.",
  "short-range": "Date range must be at least 2 years.",
  "bench-failed": "Could not download the benchmark's prices. Select a different benchmark, or try again in a few seconds.",
  "too-few-downloaded":
    "Not enough valid data. Ensure at least 3 tickers return data. Check that your ticker symbols are correct and that the stocks were publicly traded during the selected date range.",
  "short-overlap":
    "Insufficient overlapping data after alignment. This happens when stocks have very different trading histories. Try a broader date range, use a more recent start date, or choose tickers that were all publicly traded during the same period.",
  "too-few-valid":
    "Fewer than 3 valid tickers remain after data cleaning. Too many tickers were removed due to missing data or failed downloads. Try a shorter date range, add more tickers, or replace tickers that may not have been publicly traded during the selected period.",
  "fetch-failed": "The price request failed. Try again in a few seconds.",
};

function fail(error: AnalysisErrorId, events: AnalysisError["events"] = []): AnalysisError {
  return { ok: false, error, message: MESSAGES[error], events };
}

const isStr = (x: unknown): x is string => typeof x === "string";
const isStrs = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
// A close is a positive finite number, or null for no bar. A zero or negative close would turn
// into an infinite or sign-flipped return, so it is not a price.
const isClose = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v > 0);

// Either layout (src/types.ts), checked all the way down: every row or column the length the
// header promises. Anything else is not a price payload, whatever it claims.
export function isPricePayload(p: unknown): p is PricePayload {
  if (!p || typeof p !== "object") return false;
  const q = p as Record<string, unknown>;
  if (!isStrs(q.tickers) || !isStr(q.benchmark) || !isStr(q.start) || !isStr(q.end) || !isStr(q.pulledAt)) return false;
  if (!isStrs(q.missing) || !isStrs(q.columns)) return false;
  const k = q.columns.length;
  if ("prices" in q) {
    const { dates, prices } = q;
    if (!isStrs(dates) || !isStr(q.benchLabel) || typeof q.rf !== "number" || !Number.isFinite(q.rf)) return false;
    return Array.isArray(prices) && prices.length === k &&
      prices.every((c) => Array.isArray(c) && c.length === dates.length && c.every(isClose));
  }
  return Array.isArray(q.rows) &&
    q.rows.every((r) => Array.isArray(r) && r.length === k + 1 && isStr(r[0]) && r.slice(1).every(isClose));
}

// The first and last price days analyze() will use: the same cleaning, stopped before the engine,
// so the rate over the window can be taken across exactly the days the numbers cover. Null when the
// payload would be refused anyway.
export function priceSpan(payload: PricePayload): { from: string; to: string } | null {
  if (!isPricePayload(payload) || validateRequest(payload.tickers, payload.start, payload.end)) return null;
  const cleaned = cleanPrices(toFrame(payload), payload.missing, payload.tickers, payload.benchmark, {
    keepBenchmarkTicker: true,
  });
  if (!cleaned.ok) return null;
  const d = cleaned.frame.dates;
  return d.length ? { from: d[0], to: d[d.length - 1] } : null;
}

export function analyze(payload: PricePayload, settings: Settings, rf: RfChoice): Analysis | AnalysisError {
  if (!isPricePayload(payload)) return fail("fetch-failed");
  const bad = validateRequest(payload.tickers, payload.start, payload.end);
  if (bad) return fail(bad);
  // keepBenchmarkTicker: a benchmark that is also a ticker stays in the portfolio. The app merges the
  // two into one column and drops the ticker, silently (864, 1080).
  const cleaned = cleanPrices(toFrame(payload), payload.missing, payload.tickers, payload.benchmark, {
    keepBenchmarkTicker: true,
  });
  if (!cleaned.ok) return fail(cleaned.error, cleaned.events);

  const returns = computeReturns(cleaned.frame);
  const cols = cleaned.tickers.map((t) => column(returns, t));
  const bench = column(returns, cleaned.benchmark);
  const m = cols.map((c) => mean(c));
  const S = covMatrix(cols);
  const n = cols.length;
  const dates = cleaned.frame.dates;
  return {
    ok: true,
    source: isExample(payload) ? "example" : "live",
    asOf: dates[dates.length - 1],
    pulledAt: payload.pulledAt,
    requested: { start: payload.start, end: payload.end },
    tickers: cleaned.tickers,
    benchmark: cleaned.benchmark,
    benchLabel: isExample(payload) ? payload.benchLabel : benchDisplay(cleaned.benchmark),
    prices: cleaned.frame,
    dates: returns.dates,
    returns: cols,
    bench,
    m,
    S,
    rf: rf.rate,
    rfSource: rf.source,
    allowShort: settings.allowShort,
    ew: new Array<number>(n).fill(1 / n),
    gmv: gmv(m, S, settings.allowShort),
    tangency: tangency(m, S, rf.rate, settings.allowShort),
    frontier: frontier(m, S, settings.allowShort, FRONTIER_POINTS),
    benchStats: annualizedStats(bench, rf.rate),
    events: cleaned.events,
  };
}
