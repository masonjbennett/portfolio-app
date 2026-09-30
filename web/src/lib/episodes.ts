// Drawdown episodes, the return over a fixed stretch of dates, and the named fall an asset's worst drawdown
// overlaps.
//
// Conventions shared with drawdowns() and longestDrawdown() in stats.ts: wealth starts at 1 on `start`, the
// date of the first price (the close the day before the first return), so a loss on the first day is a
// drawdown from the amount invested. `dates` carries one ascending ISO date (yyyy-mm-dd) per return, and
// `start` comes before the first of them. Spans come back in trading days (closes apart) and in calendar days.
import type { Vec } from "./num.ts";
import { wealth } from "./stats.ts";

export interface Span {
  /** Trading days: how many closes apart the two ends are. */
  trading: number;
  /** The same span in calendar days. */
  calendar: number;
}

export interface Episode {
  /** ISO date of the high the fall began from: the last close that set a running high, or `start`. */
  start: string;
  /** ISO date of the lowest close before the recovery (the earliest, if that low repeats). */
  trough: string;
  /** ISO date of the first close back at or above the high; null when it has not got back yet. */
  recovery: string | null;
  /** The trough against the high, a negative decimal (-0.25 = a 25% fall). */
  depth: number;
  /** From the high to the trough. */
  down: Span;
  /** From the trough to the recovery; null when not recovered. */
  recover: Span | null;
}

const DAY_MS = 86_400_000;
const calendarDays = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

function spanOf(when: readonly string[], a: number, b: number): Span {
  return { trading: b - a, calendar: calendarDays(when[a], when[b]) };
}

function sameLength(r: Vec, dates: readonly string[], what: string): void {
  if (r.length !== dates.length) throw new Error(`${what}: ${r.length} returns but ${dates.length} dates`);
}

// The deepest k falls of wealth below a running high, deepest first (default five).
//
// An episode opens at the last close that set a high, stays open while wealth closes below that high, and
// ends on the first close at or above it; one still below on the last day is open, with no recovery. The
// trough is the lowest close in between. Episodes never overlap: the next one can open no earlier than the
// close on which the one before recovered (that close can be both a recovery and the next high). Equal
// depths go to the earlier episode first.
export function drawdownEpisodes(r: Vec, dates: readonly string[], start: string, k = 5): Episode[] {
  sameLength(r, dates, "drawdownEpisodes");
  const path = wealth(r, 1, true);
  const when = [start, ...dates];
  const all: Episode[] = [];
  const episode = (hi: number, lastUnder: number, rec: number | null): Episode => {
    let lo = hi + 1;
    for (let i = hi + 2; i <= lastUnder; i++) if (path[i] < path[lo]) lo = i;
    return {
      start: when[hi],
      trough: when[lo],
      recovery: rec === null ? null : when[rec],
      depth: (path[lo] - path[hi]) / path[hi],
      down: spanOf(when, hi, lo),
      recover: rec === null ? null : spanOf(when, lo, rec),
    };
  };
  let hi = 0; // the amount invested is the first high
  for (let j = 1; j < path.length; j++) {
    if (path[j] >= path[hi]) {
      if (j - hi > 1) all.push(episode(hi, j - 1, j));
      hi = j;
    }
  }
  if (hi < path.length - 1) all.push(episode(hi, path.length - 1, null));
  all.sort((a, b) => a.depth - b.depth || (a.start < b.start ? -1 : 1));
  return all.slice(0, Math.max(0, k));
}

// The index of the last close on or before `day`; -1 when every close is later.
function lastOnOrBefore(when: readonly string[], day: string): number {
  let at = -1;
  for (let i = 0; i < when.length && when[i] <= day; i++) at = i;
  return at;
}

// True when the loaded closes reach both ends of a stretch: a close on or before `from` (the first price
// counts) and a close on or after `to`. A stretch that is not covered is not reported at all, rather than
// reported over the part of it the window happens to hold.
export function covers(dates: readonly string[], start: string, from: string, to: string): boolean {
  const last = dates.length ? dates[dates.length - 1] : start;
  return start <= from && last >= to;
}

// The compounded return from the close on `from` to the close on `to`, each taken as the last close on or
// before that date when it is not a trading day: the returns dated after the first close, up to and
// including the second, compounded. Null when covers() is false. A portfolio's return here is what its
// weights earned on these prices over that stretch: history, not a forecast.
export function windowReturn(r: Vec, dates: readonly string[], start: string, from: string, to: string): number | null {
  sameLength(r, dates, "windowReturn");
  if (from > to) throw new Error(`windowReturn: ${from} is after ${to}`);
  if (!covers(dates, start, from, to)) return null;
  const when = [start, ...dates];
  const a = lastOnOrBefore(when, from);
  const b = lastOnOrBefore(when, to);
  let growth = 1;
  for (let t = a; t < b; t++) growth *= 1 + r[t]; // r[t] runs from close t to close t + 1
  return growth - 1;
}

// The stretches the loaded closes cover, in the order given.
export function coveredStretches<F extends { from: string; to: string }>(
  stretches: readonly F[],
  dates: readonly string[],
  start: string,
): F[] {
  return stretches.filter((s) => covers(dates, start, s.from, s.to));
}

// The named event an asset's worst fall (its high to its trough) overlaps, or null.
//
// Overlap means the two spans share more than a single date: a fall that bottomed on the day an event began,
// or began on the day an event bottomed, is not counted. When the fall overlaps several events, the one it
// shares the most calendar days with is returned, a tie going to the event that began first.
export function relatedEvent<E extends { from: string; to: string }>(
  fall: { start: string; trough: string } | null,
  events: readonly E[],
): E | null {
  if (!fall) return null;
  let best: E | null = null;
  let most = 0;
  for (const e of events) {
    const lo = fall.start > e.from ? fall.start : e.from;
    const hi = fall.trough < e.to ? fall.trough : e.to;
    if (!(lo < hi)) continue;
    const shared = calendarDays(lo, hi);
    if (best === null || shared > most || (shared === most && e.from < best.from)) {
      best = e;
      most = shared;
    }
  }
  return best;
}
