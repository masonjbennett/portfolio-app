// The words and figures of Does it hold up?'s "Range of outcomes" row, read from the bootstrap in src/lib/simulate.ts.
// The row's finding and its card read the same fan (fanOf keeps one per analysis and horizon), so the row never
// promises a figure its card does not carry, and opening the row costs nothing the finding has not already paid.
//
// Wording rules (handoff-montecarlo.md): never "forecast", "predict" or "expected"; the band is the 10th to the 90th
// percentile, so it holds EIGHT paths in ten (the brief's draft said nine, which is the 5th to the 95th).
import { DEFAULT_HORIZON, horizonFor, horizonsFor, outcomes, START, type Fan, type Horizon, type OutcomeKey } from "../../lib/simulate.ts";
import { format } from "../../format.ts";
import { MIX } from "../../overview/model.ts";
import { benchDisplay } from "../../state/defaults.ts";
import type { Kept, KeptCheck, Placement } from "../../lib/kept.ts";
import type { Analysis } from "../../types.ts";

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five"];
const years = (h: number) => `${NUMBER_WORDS[h] ?? h} ${h === 1 ? "year" : "years"}`;
const usd = (x: number) => format(x, "usd0");

// One fan per analysis and horizon: an analysis is replaced, never changed, so it is the cache key.
const fans = new WeakMap<Analysis, Map<number, Fan | null>>();

/** The fan an analysis shows at `h`, computed once. Null when the window is shorter than `h`. */
export function fanOf(a: Analysis, h: number): Fan | null {
  let byH = fans.get(a);
  if (!byH) fans.set(a, (byH = new Map()));
  if (!byH.has(h)) byH.set(h, outcomes(a, h));
  return byH.get(h) ?? null;
}

/** The horizons the row offers on this window, and the one it opens on. */
export function rowHorizons(a: Analysis): { offered: Horizon[]; first: Horizon | null } {
  return { offered: horizonsFor(a.bench.length), first: horizonFor(a.bench.length, DEFAULT_HORIZON) };
}

/** The window's years as the row names them: "2019-2026's" or, inside one year, "2026's". */
export function spanOf(a: Analysis): string {
  const y0 = a.dates[0].slice(0, 4);
  const y1 = a.asOf.slice(0, 4);
  return y0 === y1 ? `${y0}'s` : `${y0}-${y1}'s`;
}

/** A line's band at the horizon: its 10th and 90th percentile endings. */
export function endBand(fan: Fan, key: OutcomeKey): { lo: number; mid: number; hi: number } | null {
  const l = fan.lines.find((x) => x.key === key);
  if (!l) return null;
  const last = l.p50.length - 1;
  return { lo: l.p10[last], mid: l.p50[last], hi: l.p90[last] };
}

/** The row's finding (twenty words or fewer), on the horizon the row opens on. */
export function outcomesFinding(a: Analysis): string {
  const h = rowHorizons(a).first;
  const fan = h ? fanOf(a, h) : null;
  const b = fan ? endBand(fan, "ew") : null;
  if (!h || !b) return "Not simulated: the window holds less than a year of returns.";
  return `If ${spanOf(a)} months reshuffle over ${years(h)}, ${usd(START)} split equally ends between ${usd(b.lo)} and ${usd(b.hi)} eight times in ten.`;
}

/** The chart's title at the horizon chosen (fourteen words or fewer). */
export function outcomesTitle(fan: Fan): string {
  return `After ${years(fan.horizon)}, eight paths in ten end inside each band`;
}

/** The chart's sub-line (twenty-five words or fewer): each mix's band at the horizon, and what was reshuffled. */
export function outcomesSub(a: Analysis, fan: Fan): string {
  const parts = (["ew", "gmv"] as const)
    .map((k) => [k, endBand(fan, k)] as const)
    .filter((x): x is readonly ["ew" | "gmv", NonNullable<ReturnType<typeof endBand>>] => !!x[1])
    .map(([k, b]) => `${MIX[k].name.toLowerCase()} ${usd(b.lo)} to ${usd(b.hi)}`);
  const line = `${parts.join("; ")}; ${usd(START)} at the start, ${spanOf(a)} months reshuffled.`;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** A line's display name: the two mixes by the page's own names, the benchmark by its label. */
export function lineName(a: Analysis, key: OutcomeKey): string {
  return key === "bench" ? a.benchLabel : MIX[key].name;
}

/** The chart's rows: one per month, each line's band as a [10th, 90th] pair and its median. */
export function chartRows(fan: Fan): Record<string, number | [number, number]>[] {
  return fan.months.map((m, i) => {
    const row: Record<string, number | [number, number]> = { month: m };
    for (const l of fan.lines) {
      row[`${l.key}Band`] = [l.p10[i], l.p90[i]];
      row[`${l.key}Mid`] = l.p50[i];
    }
    return row;
  });
}

/** "Show the numbers": each year-end checkpoint, each line's 10th, 50th and 90th percentile ending. */
export function numberRows(a: Analysis, fan: Fan): Record<string, number | string>[] {
  const rows: Record<string, number | string>[] = [];
  for (let y = 1; y <= fan.horizon; y++) {
    const i = y * 12;
    for (const l of fan.lines) rows.push({ year: y, line: lineName(a, l.key as OutcomeKey), p10: l.p10[i], p50: l.p50[i], p90: l.p90[i] });
  }
  return rows;
}


// ---- a kept fan (src/lib/kept.ts), opened from its link -------------------------------------------------------------

const ordinal = (n: number) => {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
};

/** How a line is named in a kept fan's sentences. */
export function keptLineWords(key: OutcomeKey, benchmark: string): string {
  if (key === "ew") return "split equally";
  if (key === "gmv") return `in the ${MIX.gmv.name.toLowerCase()}`;
  return `in the ${benchDisplay(benchmark)}`;
}

/** Where a real value sits among the kept percentiles, in words. */
export function placeWords(p: Placement): string {
  if (p.at === "below") return "below the 10th percentile";
  if (p.at === "above") return "above the 90th percentile";
  return `about the ${ordinal(p.pct)} percentile`;
}

/** The kept card's title (fourteen words or fewer). */
export function keptTitle(k: Kept): string {
  return `The fan kept on ${k.asOf}, with the real prices since`;
}

/** The kept card's sub-line (twenty-five words or fewer): where the first line landed, or why nothing is compared. */
export function keptSub(k: Kept, check: KeptCheck | null): string {
  if (!check) return `Fetching the real prices since ${k.asOf}.`;
  if (check.status === "early") return `Nothing to compare yet: a month of real prices has not passed since ${k.asOf}.`;
  if (check.status === "failed") return check.message;
  const l = check.lines[0];
  if (!l) return "None of the kept lines could be priced since the day it was kept.";
  const when = check.complete ? `At the end of ${years(k.horizon)}, on ${check.date}` : `On ${check.date}`;
  return `${when}, ${usd(START)} ${keptLineWords(l.key, k.benchmark)} stood at ${usd(l.value)}: ${placeWords(l.place)} of what was simulated.`;
}

/** The cross-check's line when a recompute from today's copy of the same prices moved the fan; null when it did not. */
export function keptGapNote(gap: number | null): string | null {
  if (gap === null || gap < 0.005) return null;
  return `Recomputed from today's copy of the same prices, the fan moves by up to ${format(gap, "pct1")}: Yahoo revises adjusted closes. The fan drawn is the one kept.`;
}

/** The kept card's numbers: each line's real value at the check, its kept band there, and where it sits. */
export function keptRows(k: Kept, check: KeptCheck): Record<string, number | string>[] {
  if (check.status !== "ready") return [];
  return check.lines.map((l) => ({
    line: l.key === "bench" ? benchDisplay(k.benchmark) : MIX[l.key].name,
    value: l.value,
    p10: l.band[0],
    p50: l.band[2],
    p90: l.band[4],
    place: placeWords(l.place),
  }));
}
