// Input validation and price cleaning: the Streamlit app's Run block (portfolio_app.py 1007-1092),
// in its order, returning what happened as data rather than as st.warning text, because the
// app's wording ("click Run Analysis again") does not survive a page with no Run button.

export interface Frame {
  dates: string[]; // ISO yyyy-mm-dd, ascending
  columns: string[];
  values: number[][]; // column-major; NaN where a ticker had no bar that day
}

export const MIN_TICKERS = 3;
export const MAX_TICKERS = 10;
export const MIN_RANGE_DAYS = 730;
export const MIN_ROWS = 252;
export const MAX_MISSING = 0.05;

// Comma-separated input, trimmed, upper-cased, order-preserving de-duplication (1007).
export function parseTickers(input: string): string[] {
  const seen = new Set<string>();
  for (const t of input.split(",")) {
    const s = t.trim().toUpperCase();
    if (s) seen.add(s);
  }
  return [...seen];
}

export type RequestError = "too-few" | "too-many" | "reversed" | "short-range";

function days(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

// Checked before any download (1009-1021). The app tests the two-year minimum before end <= start,
// so its "End date must be after start date." could never show; here a reversed range says so.
export function validateRequest(tickers: string[], start: string, end: string): RequestError | null {
  if (tickers.length < MIN_TICKERS) return "too-few";
  if (tickers.length > MAX_TICKERS) return "too-many";
  if (days(start, end) <= 0) return "reversed";
  if (days(start, end) < MIN_RANGE_DAYS) return "short-range";
  return null;
}

export type CleanEvent =
  | { kind: "failed"; tickers: string[] }
  | { kind: "dropped"; tickers: string[] }
  | { kind: "truncated"; first: string; last: string; rows: number };

export type CleanError = "bench-failed" | "too-few-downloaded" | "short-overlap" | "too-few-valid";

export type Cleaned =
  | { ok: true; frame: Frame; tickers: string[]; benchmark: string; events: CleanEvent[] }
  | { ok: false; error: CleanError; events: CleanEvent[] };

export interface CleanOptions {
  // The app merges a benchmark that is also a portfolio ticker into one column and then drops it
  // from the portfolio, silently (864, 1080). The port keeps the ticker; `false` reproduces the app.
  keepBenchmarkTicker?: boolean;
}

// `raw` is the outer join of every series that downloaded (the benchmark's column included once);
// `failed` lists what did not.
export function cleanPrices(
  raw: Frame | null,
  failed: string[],
  tickers: string[],
  benchmark: string,
  opts: CleanOptions = {},
): Cleaned {
  const keep = opts.keepBenchmarkTicker ?? true;
  const events: CleanEvent[] = [];
  const tickerFailed = failed.filter((t) => t !== benchmark);
  if (tickerFailed.length) events.push({ kind: "failed", tickers: tickerFailed });
  if (failed.includes(benchmark)) return { ok: false, error: "bench-failed", events };

  const inPortfolio = (c: string) => c !== benchmark || (keep && tickers.includes(benchmark));
  // The app's `prices.shape[1] < 4` counts the benchmark column as the fourth (1050).
  if (!raw || raw.columns.filter(inPortfolio).length < MIN_TICKERS) {
    return { ok: false, error: "too-few-downloaded", events };
  }

  // Drop tickers with more than 5% missing over the UNION of dates; the benchmark is exempt (1054-1066).
  const n = raw.dates.length;
  const high = raw.columns.filter(
    (c, j) => c !== benchmark && raw.values[j].filter((v) => Number.isNaN(v)).length / n > MAX_MISSING,
  );
  if (high.length) events.push({ kind: "dropped", tickers: high });
  const cols = raw.columns.map((c, j) => ({ c, v: raw.values[j] })).filter(({ c }) => !high.includes(c));

  // Row-wise intersection (1068).
  const keepRow = raw.dates.map((_, i) => cols.every(({ v }) => !Number.isNaN(v[i])));
  const dates = raw.dates.filter((_, i) => keepRow[i]);
  const frame: Frame = {
    dates,
    columns: cols.map(({ c }) => c),
    values: cols.map(({ v }) => v.filter((_, i) => keepRow[i])),
  };
  if (dates.length < n && dates.length) {
    events.push({ kind: "truncated", first: dates[0], last: dates[dates.length - 1], rows: dates.length });
  }
  if (dates.length < MIN_ROWS) return { ok: false, error: "short-overlap", events };

  const valid = frame.columns.filter(inPortfolio);
  if (valid.length < MIN_TICKERS) return { ok: false, error: "too-few-valid", events };
  return { ok: true, frame, tickers: valid, benchmark, events };
}

// compute_returns (889-890): prices.pct_change().dropna(). On a cleaned frame there is no NaN, so
// this is p[t] / p[t-1] - 1 from the second row, the same two operations pandas performs.
export function computeReturns(frame: Frame): Frame {
  return {
    dates: frame.dates.slice(1),
    columns: frame.columns,
    values: frame.values.map((p) => p.slice(1).map((x, i) => x / p[i] - 1)),
  };
}

export function column(frame: Frame, name: string): number[] {
  const j = frame.columns.indexOf(name);
  if (j < 0) throw new Error(`no column ${name}`);
  return frame.values[j];
}
