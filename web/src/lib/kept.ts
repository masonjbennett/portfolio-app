// A kept fan: the "Range of outcomes" row's fan written into a link, so a reader can open it months later and see
// where the real prices landed against it (handoff-montecarlo.md, Session B).
//
// The link is the ordinary share link (src/state/url.ts) for the basket and the window, frozen at the day the fan
// starts, plus a few `p` keys that carry the fan itself:
//   pv  the format, "1"
//   ph  the horizon in years; ps the seed (base 36); pd the as-of day the fan starts from
//   pm  the checkpoints kept, in months ("1.2.3.6.9.12"): fewer than the page draws, so the link stays short
//   pw  the lowest-risk mix's weights in ten-thousandths, in the tickers' order (absent when its solve failed);
//       the equal split's are 1/n and need no key
//   pe, pg, pb  each line's $10,000 at the 10th, 25th, 50th, 75th and 90th percentiles at every kept month, in whole
//       dollars, base 36: "7mo.7r4.80i.85k.8a2,..." (equal split, lowest-risk mix, benchmark)
//   pk  a checksum of everything above and of the share keys, so a hand-edited figure fails closed
// Only tickers, dates and numbers go in. Nothing personal: never the amount, never a name.
//
// Opened later, the ORIGINAL fan is redrawn from those numbers, never recomputed: Yahoo revises adjusted closes after
// dividends and splits, so a recompute would move. A recompute is only a cross-check (Kept.tsx says when it differs).
//
// Decoding trusts nothing, like decodeShare: any key that does not parse, any figure out of order, a value over
// MAX_PARAM or a checksum that does not match, and the whole kept fan is left out; the page opens as ordinary.
// Nothing here throws. Pure functions, no React: the card is src/tabs/walkforward/Kept.tsx.
import { addDays, isIsoDate, pricesUrl } from "../data/prices.ts";
import { decodeShare, encodeShare, MAX_PARAM } from "../state/url.ts";
import { MAX_TICKERS } from "./clean.ts";
import { portfolioReturns } from "./portfolio.ts";
import { HORIZONS, KEPT_PCTS, START, CHECK_DAYS, type Fan, type OutcomeKey } from "./simulate.ts";
import { TRADING_DAYS } from "./stats.ts";
import type { Vec } from "./num.ts";

/** The format this module writes and reads. */
export const KEPT_VERSION = "1";
/** The months a link keeps, up to the horizon: closer together early, where a check is likeliest to be made. */
export const KEPT_MONTHS = [1, 2, 3, 6, 9, 12, 18, 24, 30, 36, 48, 60] as const;
/** The lines a link keeps, by key, and the query key each is written under. */
const LINE_KEY: Record<OutcomeKey, string> = { ew: "pe", gmv: "pg", bench: "pb" };
const LINES: OutcomeKey[] = ["ew", "gmv", "bench"];
/** Weights are written in ten-thousandths. */
const W_SCALE = 10_000;
/** A kept dollar figure above this is not a figure the fan could have made: refused. */
const MAX_VALUE = 1e9;
/** Calendar days of prices before the as-of day asked for with a check, so the endpoint's 30-day floor never bites. */
const LEAD_DAYS = 70;

export interface KeptLine {
  key: OutcomeKey;
  /** Per kept month, $START at the KEPT_PCTS percentiles, ascending. */
  q: number[][];
}

export interface Kept {
  tickers: string[];
  benchmark: string;
  /** The window's first requested day, and the day the fan starts from (its last price). */
  start: string;
  asOf: string;
  allowShort: boolean;
  horizon: number;
  seed: number;
  months: number[];
  /** The two mixes' weights, aligned with `tickers`; gmv null where its solve failed. */
  weights: { ew: Vec; gmv: Vec | null };
  lines: KeptLine[];
}

/** What a kept fan is made from: the analysis it was drawn on (only these fields are read). */
export interface KeptSource {
  tickers: string[];
  benchmark: string;
  requested: { start: string };
  asOf: string;
  allowShort: boolean;
  ew: Vec;
  gmv: { w: Vec } | null;
}

/** The kept months for a horizon of `h` years. */
export function keptMonths(h: number): number[] {
  return KEPT_MONTHS.filter((m) => m <= h * 12);
}

/** The fan an analysis shows, as a link would keep it. */
export function keptOf(a: KeptSource, fan: Fan, seed: number): Kept {
  const months = keptMonths(fan.horizon);
  const lines = fan.lines.map((l) => ({
    key: l.key as OutcomeKey,
    q: months.map((m) => [l.p10[m], l.p25[m], l.p50[m], l.p75[m], l.p90[m]].map((x) => Math.round(x))),
  }));
  return {
    tickers: a.tickers.slice(),
    benchmark: a.benchmark,
    start: a.requested.start,
    asOf: a.asOf,
    allowShort: a.allowShort,
    horizon: fan.horizon,
    seed,
    months,
    weights: { ew: a.ew.slice(), gmv: a.gmv ? a.gmv.w.map((w) => Math.round(w * W_SCALE) / W_SCALE) : null },
    lines,
  };
}

// FNV-1a, 32 bits, base 36: not security, only a guard against a figure edited by hand or cut short.
function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// The link without its checksum: the share keys first (encodeShare's own spelling), then the kept keys in a fixed
// order. Null when a value would pass MAX_PARAM, which no honest fan does (ten checkpoints of five figures is ~250).
function body(k: Kept): string | null {
  const share = encodeShare({
    settings: { tickers: k.tickers, start: k.start, end: addDays(k.asOf, 1), benchmark: k.benchmark, allowShort: k.allowShort },
    weights: null,
    chapter: "holdup",
  });
  const parts: [string, string][] = [
    ["pv", KEPT_VERSION],
    ["ph", String(k.horizon)],
    ["ps", (k.seed >>> 0).toString(36)],
    ["pd", k.asOf],
    ["pm", k.months.join(".")],
  ];
  if (k.weights.gmv) parts.push(["pw", k.weights.gmv.map((w) => String(Math.round(w * W_SCALE))).join(",")]);
  for (const key of LINES) {
    const l = k.lines.find((x) => x.key === key);
    if (l) parts.push([LINE_KEY[key], l.q.map((c) => c.map((x) => Math.round(x).toString(36)).join(".")).join(",")]);
  }
  if (parts.some(([, v]) => v.length > MAX_PARAM)) return null;
  return `${share}&${parts.map(([key, v]) => `${key}=${v}`).join("&")}`;
}

/** The query string ("?...") that keeps this fan, or null when it cannot be kept in a link. */
export function encodeKept(k: Kept): string | null {
  const b = body(k);
  return b === null ? null : `${b}&pk=${checksum(b)}`;
}

// A whole number in base 36, and nothing else ("1e3", "-", " 1" are refused).
function int36(v: string): number | null {
  if (!/^[0-9a-z]{1,7}$/.test(v)) return null;
  const x = parseInt(v, 36);
  return Number.isSafeInteger(x) ? x : null;
}

/** The kept fan a query string carries, or null: anything malformed, out of order or edited and none is read. */
export function decodeKept(search: string): Kept | null {
  try {
    const q = new URLSearchParams(typeof search === "string" ? search : "");
    const get = (key: string) => {
      const all = q.getAll(key);
      return all.length === 1 && all[0].length > 0 && all[0].length <= MAX_PARAM ? all[0] : null;
    };
    if (get("pv") !== KEPT_VERSION) return null;
    const share = decodeShare(search);
    const s = share.settings;
    const benchmark = s.benchmark;
    const tickers = s.tickers;
    if (!tickers || !benchmark || !s.start || !s.end || typeof s.allowShort !== "boolean" || share.chapter !== "holdup") return null;
    if (new Set(tickers).size !== tickers.length || tickers.length > MAX_TICKERS) return null;
    const asOf = get("pd");
    if (asOf === null || !isIsoDate(asOf) || s.start >= asOf || s.end !== addDays(asOf, 1)) return null;
    const horizon = Number(get("ph"));
    if (!(HORIZONS as readonly number[]).includes(horizon)) return null;
    const seed = int36(get("ps") ?? "");
    if (seed === null || seed > 0xffffffff) return null;
    const months = (get("pm") ?? "").split(".").map(Number);
    const want = keptMonths(horizon);
    if (months.length !== want.length || months.some((m, i) => m !== want[i])) return null;

    const n = tickers.length;
    let gmv: Vec | null = null;
    const pw = get("pw");
    if (pw !== null) {
      const ws = pw.split(",");
      if (ws.length !== n || ws.some((w) => !/^-?\d{1,5}$/.test(w))) return null;
      gmv = ws.map((w) => Number(w) / W_SCALE);
      if (gmv.some((w) => Math.abs(w) > 1) || Math.abs(gmv.reduce((x, y) => x + y, 0) - 1) > 0.002) return null;
    }

    const lines: KeptLine[] = [];
    for (const key of LINES) {
      const v = get(LINE_KEY[key]);
      if (v === null) {
        // The two lines every fan has; the lowest-risk mix's only beside its weights, and never without them.
        if (key !== "gmv" || gmv !== null) return null;
        continue;
      }
      if (key === "gmv" && gmv === null) return null;
      const cps = v.split(",");
      if (cps.length !== months.length) return null;
      const qs: number[][] = [];
      for (const cp of cps) {
        const xs = cp.split(".").map(int36);
        if (xs.length !== KEPT_PCTS.length || xs.some((x) => x === null || x < 1 || x > MAX_VALUE)) return null;
        const ys = xs as number[];
        if (ys.some((x, i) => i > 0 && x < ys[i - 1])) return null;
        qs.push(ys);
      }
      lines.push({ key, q: qs });
    }

    const kept: Kept = {
      tickers, benchmark, start: s.start, asOf, allowShort: s.allowShort, horizon, seed, months,
      weights: { ew: tickers.map(() => 1 / n), gmv }, lines,
    };
    // Re-encoded from what was read, the checksum must agree: an edited figure, an extra or a dropped key all fail.
    const b = body(kept);
    if (b === null || get("pk") !== checksum(b)) return null;
    return kept;
  } catch {
    return null;
  }
}

/** A line's five kept percentiles at `pos` months (fractional), between the kept months, in log terms. */
export function bandAt(line: KeptLine, months: number[], pos: number): number[] {
  const at = [0, ...months];
  const qs = [KEPT_PCTS.map(() => START), ...line.q];
  const p = Math.max(0, Math.min(pos, at[at.length - 1]));
  let i = 1;
  while (i < at.length - 1 && at[i] < p) i++;
  const t = (p - at[i - 1]) / (at[i] - at[i - 1]);
  // On a kept month the kept figures themselves, never a round trip through log and exp.
  if (t <= 0) return qs[i - 1].slice();
  if (t >= 1) return qs[i].slice();
  return qs[i].map((hi, k) => Math.exp(Math.log(qs[i - 1][k]) + (Math.log(hi) - Math.log(qs[i - 1][k])) * t));
}

/** Where `x` sits among five percentile values: below the first, above the last, or the percentile between. */
export type Placement = { at: "below" } | { at: "above" } | { at: "inside"; pct: number };

export function placeIn(band: number[], x: number): Placement {
  if (x < band[0]) return { at: "below" };
  if (x > band[band.length - 1]) return { at: "above" };
  for (let k = 1; k < band.length; k++) {
    if (x <= band[k]) {
      const lo = Math.log(band[k - 1]);
      const span = Math.log(band[k]) - lo;
      const t = span > 0 ? (Math.log(x) - lo) / span : 0.5;
      return { at: "inside", pct: Math.round(KEPT_PCTS[k - 1] + (KEPT_PCTS[k] - KEPT_PCTS[k - 1]) * t) };
    }
  }
  return { at: "above" };
}

/** The real path of each kept line since the as-of day: $START, rebalanced daily to the kept weights, as simulated. */
export interface Realised {
  dates: string[];
  lines: { key: OutcomeKey; wealth: number[] }[];
}

/**
 * The real paths from a /api/prices answer, starting from the last full row on or before the as-of day and cut at the
 * horizon. A line whose symbols did not all price is left out. Null when no line can be priced.
 */
export function realised(k: Kept, columns: string[], rows: (string | number | null)[][]): Realised | null {
  const col = (sym: string) => columns.indexOf(sym);
  const tix = k.tickers.map(col);
  const bi = col(k.benchmark);
  const mixes = tix.every((i) => i >= 0);
  const need = [...(mixes ? tix : []), ...(bi >= 0 ? [bi] : [])];
  if (!need.length) return null;
  const ok = (r: (string | number | null)[]) => need.every((i) => typeof r[i + 1] === "number" && (r[i + 1] as number) > 0);
  const full = rows.filter((r) => typeof r[0] === "string" && ok(r));
  let b = -1;
  for (let i = 0; i < full.length && (full[i][0] as string) <= k.asOf; i++) b = i;
  if (b < 0) return null;
  const used = full.slice(b, b + k.horizon * TRADING_DAYS + 1);
  const price = (r: (string | number | null)[], i: number) => r[i + 1] as number;
  const ret = (i: number) => used.slice(1).map((r, d) => price(r, i) / price(used[d], i) - 1);
  const grow = (rs: Vec) => rs.reduce((w, r) => (w.push(w[w.length - 1] * (1 + r)), w), [START]);
  const lines: Realised["lines"] = [];
  if (mixes) {
    const returns = tix.map(ret);
    lines.push({ key: "ew", wealth: grow(portfolioReturns(returns, k.weights.ew)) });
    if (k.weights.gmv) lines.push({ key: "gmv", wealth: grow(portfolioReturns(returns, k.weights.gmv)) });
  }
  if (bi >= 0) lines.push({ key: "bench", wealth: grow(ret(bi)) });
  return { dates: used.map((r) => r[0] as string), lines };
}

/** A check of a kept fan against the real prices. */
export type KeptCheck =
  | { status: "early"; asOf: string }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      /** The last real day used, and how far into the fan it is, in months (21 trading days each). */
      date: string;
      pos: number;
      /** True when the real days reach the horizon: the check is then at the horizon's end. */
      complete: boolean;
      path: Realised;
      lines: { key: OutcomeKey; value: number; band: number[]; place: Placement }[];
    };

/** Every kept line placed against its band at the last real day. Under a month of real days, "early". */
export function checkOf(k: Kept, path: Realised): KeptCheck {
  const days = path.dates.length - 1;
  if (days < CHECK_DAYS) return { status: "early", asOf: k.asOf };
  const pos = days / CHECK_DAYS;
  const lines = path.lines.flatMap((p) => {
    const kl = k.lines.find((l) => l.key === p.key);
    if (!kl) return [];
    const value = p.wealth[days];
    const band = bandAt(kl, k.months, pos);
    return [{ key: p.key, value, band, place: placeIn(band, value) }];
  });
  return { status: "ready", date: path.dates[days], pos, complete: days >= k.horizon * TRADING_DAYS, path, lines };
}

/** The /api/prices url a check asks for: from a little before the as-of day to tomorrow (UTC), the endpoint's limit. */
export function checkUrl(k: Kept, today: string): string {
  return pricesUrl({ tickers: k.tickers, benchmark: k.benchmark, start: addDays(k.asOf, -LEAD_DAYS), end: addDays(today, 1) });
}

/**
 * Fetches the real prices since the as-of day and checks the kept fan against them. Under 29 calendar days nothing
 * is fetched: a month of trading days cannot have passed. Never rejects.
 */
export async function checkKept(k: Kept, today: string, f: typeof fetch = globalThis.fetch, signal?: AbortSignal): Promise<KeptCheck> {
  if (Date.parse(today) - Date.parse(k.asOf) < 29 * 86400000) return { status: "early", asOf: k.asOf };
  let body: unknown = null;
  let ok = false;
  try {
    const res = await f(checkUrl(k, today), { signal });
    ok = res.ok;
    body = await res.json();
  } catch {
    body = null;
  }
  const p = body as { columns?: unknown; rows?: unknown; message?: unknown } | null;
  if (!ok || !p || !Array.isArray(p.columns) || !Array.isArray(p.rows) || !p.rows.every(Array.isArray)) {
    const m = typeof p?.message === "string" && p.message.length <= 300 ? p.message : "The prices since could not be fetched.";
    return { status: "failed", message: m };
  }
  const path = realised(k, p.columns as string[], p.rows as (string | number | null)[][]);
  if (!path) return { status: "failed", message: "None of the kept lines could be priced since the day it was kept." };
  return checkOf(k, path);
}

/** The largest relative gap between two kept fans' figures (the cross-check), or null when they do not line up. */
export function keptGap(a: Kept, b: Kept): number | null {
  if (a.months.join() !== b.months.join() || a.lines.length !== b.lines.length) return null;
  let gap = 0;
  for (const la of a.lines) {
    const lb = b.lines.find((l) => l.key === la.key);
    if (!lb) return null;
    la.q.forEach((c, i) => c.forEach((x, j) => (gap = Math.max(gap, Math.abs(x / lb.q[i][j] - 1)))));
  }
  return gap;
}
