// Calendar years and calendar months for the four portfolios and the benchmark, as numbers: the
// Calendar years table, the months grid drawn by MonthHeatmap.tsx, and that grid's table. Pure, like
// ./model.ts, so test/t-tab-returns.mjs reaches every figure without a DOM.
//
// Every figure is the engine's: calendarYears() and monthGrid(monthlyReturns()) in src/lib/monthly.ts,
// over a portfolio's daily returns from portfolioReturns() (fixed weights, rebalanced daily). Nothing
// here compounds a return itself. The columns are the scorecard's, in its order and with its labels,
// so a failed solve or a refused custom mix keeps its column and prints dashes.
import type { Vec } from "../../lib/num.ts";
import { calendarYears, monthGrid, monthlyReturns, type GridRow, type Month } from "../../lib/monthly.ts";
import { portfolioReturns, type Custom } from "../../lib/portfolio.ts";
import { format } from "../../format.ts";
import { monthYear } from "../../chrome/when.ts";
import { tokens } from "../../styles/tokens.ts";
import type { Analysis, Column, LoadState, TableRow } from "../../types.ts";
import { scoreColumns, type ScoreColId } from "../optimization/scorecard.ts";
import { weightsOf } from "../optimization/model.ts";

// ---- the five series -----------------------------------------------------------------------------------

export interface Series {
  id: ScoreColId;
  /** The head the scorecard prints: "GMV", "GMV (failed)", "Custom (not shown)", the benchmark's name. */
  label: string;
  /** The line under the head: "weights chosen on this window" for a solved GMV or Tangency, else null. */
  sub: string | null;
  /** Daily returns aligned with analysis.dates; null when the column has no weights. */
  r: Vec | null;
}

/**
 * Equal-Weight, GMV, Tangency, Custom and the benchmark, in the scorecard's order. Each portfolio's
 * returns are its fixed weights applied to every day's asset returns (rebalanced daily); the benchmark's
 * are its own.
 */
export function portfolioSeries(a: Analysis, c: Custom): Series[] {
  return scoreColumns(a, c).map((col): Series => {
    let r: Vec | null = null;
    if (col.id === "bench") r = a.bench;
    else if (col.id === "custom") r = c.ok ? portfolioReturns(a.returns, c.w) : null;
    else r = fixedReturns(a, col.id);
    return { id: col.id, label: col.label, sub: col.sub, r };
  });
}

// Equal-Weight's, GMV's and Tangency's returns depend on the analysis alone, so they are computed once per
// analysis and the same arrays come back while the custom mix is edited: a card keyed on them stays put.
const FIXED = new WeakMap<Analysis, Map<"ew" | "gmv" | "tangency", Vec | null>>();

function fixedReturns(a: Analysis, id: "ew" | "gmv" | "tangency"): Vec | null {
  let m = FIXED.get(a);
  if (!m) FIXED.set(a, (m = new Map()));
  if (!m.has(id)) {
    const w = weightsOf(a, id);
    m.set(id, w ? portfolioReturns(a.returns, w) : null);
  }
  return m.get(id) ?? null;
}

/** A Table `subs` map: each head that carries a line under it. */
export function seriesSubs(list: readonly Series[]): Record<string, string> {
  return Object.fromEntries(list.filter((s) => s.sub !== null).map((s) => [s.label, s.sub as string]));
}

/** The pill row's options: the heads, keyed by column id. */
export function seriesOptions(list: readonly Series[]): { value: ScoreColId; label: string }[] {
  return list.map((s) => ({ value: s.id, label: s.label }));
}

// ---- calendar years ------------------------------------------------------------------------------------

export const YEARS_TITLE = "Calendar years";
export const YEARS_FILE = "calendar_years";

export function yearColumns(list: readonly Series[]): Column[] {
  return [{ key: "year", label: "Year", format: "text", first: true }, ...list.map((s): Column => ({ key: s.id, label: s.label, format: "pct1" }))];
}

/**
 * A year's label. A whole year is its number. The window's first and last years are flagged partial by
 * the engine (the dates cannot show whether the window holds all of them), so they say what they cover:
 * the first from the close its return is measured from (the first price, `start`), the last to its last
 * close. A window inside one year says both.
 */
export function yearLabel(y: { year: number; last: string; partial: boolean }, first: boolean, last: boolean, start: string): string {
  if (!y.partial) return String(y.year);
  if (first && last) return `${y.year}, ${format(start, "date")} to ${format(y.last, "date")}`;
  if (first) return `${y.year}, from ${format(start, "date")}`;
  return `${y.year}, to ${format(y.last, "date")}`;
}

/** Years down, one column per series; every cell the engine's compounded return for that year. */
export function yearRows(a: Analysis, list: readonly Series[]): TableRow[] {
  // The years come from the dates alone, so any series gives the same list; the benchmark always has one.
  const spine = calendarYears(a.bench, a.dates);
  const per = list.map((s) => (s.r ? calendarYears(s.r, a.dates) : null));
  const start = a.prices.dates[0];
  return spine.map((y, i) => {
    const row: TableRow = { year: yearLabel(y, i === 0, i === spine.length - 1, start) };
    list.forEach((s, j) => {
      const v = per[j]?.[i]?.ret;
      row[s.id] = v !== undefined && Number.isFinite(v) ? v : null;
    });
    return row;
  });
}

// ---- the months grid -----------------------------------------------------------------------------------

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export interface MonthView {
  label: string;
  grid: GridRow[];
  /** The largest month either way, the scale's end on both sides: the scale is symmetric about zero. */
  reach: number;
  /** The lowest and highest complete months, or null when no month in the window is complete. */
  low: Month | null;
  high: Month | null;
}

export function monthView(a: Analysis, s: Series): LoadState<MonthView> {
  if (!s.r) return { status: "empty", reason: `${s.label} has no returns on this window, so there are no months to show.` };
  const months = monthlyReturns(s.r, a.dates);
  if (!months.length) return { status: "empty", reason: "There are no daily returns in this window." };
  const bad = months.find((m) => !Number.isFinite(m.ret));
  if (bad) return { status: "error", name: `${s.label}'s months`, message: `The return for ${bad.ym} is not a number.` };
  let reach = 0;
  for (const m of months) reach = Math.max(reach, Math.abs(m.ret));
  let low: Month | null = null;
  let high: Month | null = null;
  for (const m of months) {
    if (m.partial) continue;
    if (!low || m.ret < low.ret) low = m;
    if (!high || m.ret > high.ret) high = m;
  }
  return { status: "ready", value: { label: s.label, grid: monthGrid(months), reach, low, high } };
}

const monthOf = (ym: string) => monthYear(`${ym}-01`);

/** The chart's title: the range of the complete months, lowest to highest. */
export function monthTitle(v: MonthView): string {
  if (!v.low || !v.high) return `${v.label}: no complete calendar month in this window`;
  return `${v.label}'s months ran from ${format(v.low.ret, "pct1")} in ${monthOf(v.low.ym)} to ${format(v.high.ret, "pct1")} in ${monthOf(v.high.ym)}`;
}

/** What one cell says when it is pointed at: the month, its return, and whether the window holds all of it. */
export function monthReadout(m: Month): string {
  return `${monthOf(m.ym)}: ${format(m.ret, "pct1")}${m.partial ? ", part of the month" : ""}`;
}

export function monthColumns(): Column[] {
  return [{ key: "year", label: "Year", format: "text", first: true }, ...MONTH_NAMES.map((m): Column => ({ key: m, label: m, format: "pct1" }))];
}

/** The grid as table rows: a month the window does not reach is empty (a dash on the page, blank in a download). */
export function monthRows(grid: readonly GridRow[]): TableRow[] {
  return grid.map((g) => {
    const row: TableRow = { year: String(g.year) };
    MONTH_NAMES.forEach((name, k) => (row[name] = g.months[k] ? (g.months[k] as Month).ret : null));
    return row;
  });
}

// The fill for a month: the paper at zero, towards the gain colour above it and the loss colour below,
// in proportion to the month against `reach`, the same distance on both sides. The tint stops short of
// the full colour so the ink figure printed on the cell stays legible.
export const MONTH_TINT = 0.55;

type RGB = [number, number, number];
const hex = (h: string): RGB => [0, 2, 4].map((k) => parseInt(h.replace("#", "").slice(k, k + 2), 16)) as RGB;
const PAPER = hex(tokens.color.paper);
const UP = hex(tokens.color.up);
const DOWN = hex(tokens.color.down);

export function monthTint(v: number, reach: number): string {
  if (!Number.isFinite(v)) return tokens.color.hairline2;
  const t = reach > 0 ? MONTH_TINT * Math.min(1, Math.abs(v) / reach) : 0;
  const to = v < 0 ? DOWN : UP;
  const c = PAPER.map((p, k) => Math.round(p + (to[k] - p) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
