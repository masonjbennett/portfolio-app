// The risk-free endpoint's pure half: the app's fetch_rf_rate (portfolio_app.py 605-639). Same
// source, same series, same transformation: FRED's fredgraph.csv for DGS3MO alone (one series per
// request; a request mixing frequencies answers with a ZIP, 596-598), a 120-day window (615), a 10 s
// timeout (618), and the LAST row that parses.
import type { ApiError, RfRate } from "../types.ts";

export const FRED_DGS3MO = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS3MO&cosd=";
export const RF_WINDOW_DAYS = 120;
export const RF_TIMEOUT_MS = 10000;
export const RF_SOURCE = "FRED DGS3MO";

// `today` is an ISO date. The window start is today minus 120 days (615).
export function rfUrl(today: string): string {
  const cosd = new Date(Date.parse(today + "T00:00:00Z") - RF_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  return FRED_DGS3MO + cosd;
}

// A plain decimal. Python's float() also takes "nan", "inf" and "4_12"; FRED sends none of them, and
// the port refuses them rather than showing a rate of NaN.
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// 623-639: skip the first line whatever it says (the header is DATE,DGS3MO or observation_date,DGS3MO),
// skip a line with fewer than two fields, take the first field as the day and the LAST as the value,
// skip "" and "." (holidays and not-yet-published days), and keep the last row that parses. FRED
// gives percent; the rate is returned as a decimal (717 divides by 100). The day must also be an ISO
// date here, because RfRate promises one; the app prints whatever the first field held.
export function parseRfCsv(text: string): RfRate | null {
  let latest: RfRate | null = null;
  for (const line of text.split(/\r\n|\r|\n/).slice(1)) {
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const day = parts[0].trim();
    const raw = parts[parts.length - 1].trim();
    if (!raw || raw === "." || !NUMBER.test(raw) || !ISO.test(day)) continue;
    latest = { rate: Number(raw) / 100, date: day, source: RF_SOURCE };
  }
  return latest;
}

export interface RfOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type RfResult = { ok: true; rate: RfRate } | { ok: false; status: number; body: ApiError };

// Fails closed with a NAMED error where the app returns None (620-621, 639): "upstream" when FRED
// could not be read, "no-data" when it answered with no usable row.
export async function fetchRf(today: string, opts: RfOptions = {}): Promise<RfResult> {
  const f = opts.fetch ?? globalThis.fetch;
  let text: string;
  try {
    const res = await f(rfUrl(today), { signal: AbortSignal.timeout(opts.timeoutMs ?? RF_TIMEOUT_MS) });
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text(); // decodes UTF-8 with replacement, as decode("utf-8", "replace") does (619)
  } catch {
    return { ok: false, status: 502, body: { error: "upstream", message: "FRED did not answer for the 3-month Treasury rate." } };
  }
  const rate = parseRfCsv(text);
  if (!rate) {
    return { ok: false, status: 502, body: { error: "no-data", message: "FRED answered with no 3-month Treasury rate in the last 120 days." } };
  }
  return { ok: true, rate };
}

// The app caches a good lookup for six hours (605) and never keeps a failed one (710). The edge does
// the same for a good answer, then serves it stale for up to six more hours while one request
// refreshes it: DGS3MO publishes once a business day. A failure is held one minute, never stale.
export const RF_CACHE_OK = "public, s-maxage=21600, stale-while-revalidate=21600";
export const RF_CACHE_FAILED = "public, s-maxage=60";
