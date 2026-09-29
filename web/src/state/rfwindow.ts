// The risk-free rate that prevailed over the prices on screen: the mean of FRED's daily 3-month
// Treasury yield (DGS3MO) across the days the analysis covers, with the latest yield beside it.
//
// A Sharpe ratio over 2019 to today is the excess return earned across those years, so its hurdle is
// the yield a T-bill paid across them. The Streamlit app scores every window against the latest
// yield alone (fetch_rf_rate, portfolio_app.py 605-639), which measures seven years of returns
// against one day's rate. The page keeps that rate on show and one click away, but scores against
// the window's own by default.
//
// Both halves live here so they cannot disagree about the payload: the endpoint's (one FRED request
// for one series from the window's first day on, parsed by the same rules as the latest yield) and
// the page's (read the answer defensively, then take the mean over the analysis' own first and last
// price days).
import { FRED_DGS3MO, parseRfCsv, RF_SOURCE, RF_TIMEOUT_MS, type RfOptions } from "../data/fred.ts";
import type { ApiError, RfChoice, RfRate } from "../types.ts";

/** One observation: its ISO day and the annual yield as a decimal (FRED's 4.12 is 0.0412). */
export type RfPoint = [string, number];

/** The answer to /api/rf?start=: the latest yield, as /api/rf gives it, and every day from `start` on. */
export interface RfSeries extends RfRate {
  /** The first day asked for. The series covers any window that starts on or after it. */
  start: string;
  /** Daily observations, ascending, holidays and unpublished days left out. */
  series: RfPoint[];
}

/** The mean yield over the days an analysis covers. */
export interface RfWindow {
  /** Annual rate, decimal: the plain mean of the observations between `from` and `to`. */
  rate: number;
  /** The analysis' first price day. */
  from: string;
  /** The analysis' last price day. */
  to: string;
  /** How many daily observations were averaged. */
  days: number;
}

/**
 * What the numbers beside the rail are scored against, and why:
 * - "manual": the rate typed into the rail (or "Use today's rate", which types today's in);
 * - "example": the baked example's own rate, kept until live prices replace it;
 * - "window": the mean yield over the window (the default);
 * - "today": the latest yield, when the window's series could not be had;
 * - "fallback": the app's placeholder, when FRED could not be reached at all.
 */
export type RfBasis = "manual" | "example" | "window" | "today" | "fallback";

/** The choice for one analysis: the rate it is handed, the basis, and the window mean when known. */
export interface RfResolved {
  choice: RfChoice;
  basis: RfBasis;
  window: RfWindow | null;
}

/**
 * The live lookup as the rail reads it: the latest yield (`rate`, `date`, `source`, unchanged in
 * meaning) plus the window mean and the rate the numbers on screen are using.
 */
export interface RfView extends RfRate {
  window: RfWindow | null;
  basis: RfBasis;
  /** The rate the analysis on screen was scored against, decimal. */
  inUse: number;
}

export function isRfView(v: RfRate): v is RfView {
  const x = v as Partial<RfView>;
  return typeof x.basis === "string" && typeof x.inUse === "number" && "window" in x;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written yyyy-mm-dd: 2026-02-30 is refused, not rolled into March. */
export function isIsoDay(s: unknown): s is string {
  return typeof s === "string" && ISO.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
}

// ---- the endpoint's half -------------------------------------------------------------------------

/** One request, DGS3MO alone, from `start` with no end: the last row is the latest yield. */
export function rfSeriesUpstream(start: string): string {
  return FRED_DGS3MO + start;
}

/**
 * Every observation in a fredgraph.csv body, by exactly the rules the latest yield is read with
 * (parseRfCsv, src/data/fred.ts): each line after the first is handed to it on its own, so a row it
 * would skip is skipped here too.
 */
export function parseRfSeries(text: string): RfPoint[] {
  const out: RfPoint[] = [];
  for (const line of text.split(/\r\n|\r|\n/).slice(1)) {
    const r = parseRfCsv("\n" + line);
    if (r) out.push([r.date, r.rate]);
  }
  return out;
}

export type RfSeriesResult = { ok: true; value: RfSeries } | { ok: false; status: number; body: ApiError };

// Fails closed with a NAMED error, as the latest-yield lookup does: "upstream" when FRED could not be
// read, "no-data" when it answered with no usable row on or after `start`.
export async function fetchRfSeries(start: string, opts: RfOptions = {}): Promise<RfSeriesResult> {
  const f = opts.fetch ?? globalThis.fetch;
  let text: string;
  try {
    const res = await f(rfSeriesUpstream(start), { signal: AbortSignal.timeout(opts.timeoutMs ?? RF_TIMEOUT_MS) });
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  } catch {
    return { ok: false, status: 502, body: { error: "upstream", message: "FRED did not answer for the 3-month Treasury rate." } };
  }
  const series = parseRfSeries(text).filter(([d]) => d >= start);
  const latest = parseRfCsv(text);
  if (!series.length || !latest) {
    return { ok: false, status: 502, body: { error: "no-data", message: `FRED answered with no 3-month Treasury rate since ${start}.` } };
  }
  return { ok: true, value: { rate: latest.rate, date: latest.date, source: RF_SOURCE, start, series } };
}

// ---- the page's half -----------------------------------------------------------------------------

/** An answer read defensively: anything that is not this shape all the way down is no answer. */
export function readRfSeries(body: unknown, start: string): RfSeries | null {
  const b = body as Partial<RfSeries> | null;
  if (!b || typeof b.rate !== "number" || !Number.isFinite(b.rate) || !isIsoDay(b.date) || typeof b.source !== "string") return null;
  if (!Array.isArray(b.series)) return null;
  let prev = "";
  for (const p of b.series) {
    if (!Array.isArray(p) || p.length !== 2 || !isIsoDay(p[0]) || p[0] <= prev || typeof p[1] !== "number" || !Number.isFinite(p[1])) return null;
    prev = p[0];
  }
  return { rate: b.rate, date: b.date, source: b.source, start, series: b.series as RfPoint[] };
}

/**
 * The mean yield from `from` to `to`, both price days, inclusive. Null when the series was asked for
 * from a later day than `from` (it would average only part of the window) or holds no observation
 * inside it.
 */
export function windowRate(s: RfSeries, from: string, to: string): RfWindow | null {
  if (s.start > from) return null;
  let sum = 0;
  let days = 0;
  for (const [d, r] of s.series) {
    if (d < from) continue;
    if (d > to) break;
    sum += r;
    days += 1;
  }
  return days > 0 ? { rate: sum / days, from, to, days } : null;
}
