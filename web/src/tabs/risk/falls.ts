// The portfolios in a fall, as numbers: one series' deepest falls, and every series' return over the
// named market falls the loaded prices cover. Pure, like ./model.ts, so test/t-falls.mjs reaches every
// cell without a DOM.
//
// Every figure is the engine's (src/lib/episodes.ts: drawdownEpisodes, windowReturn, coveredStretches)
// on a series' daily returns; nothing here segments a path or compounds a return itself. The series are
// the scorecard's columns (../returns/years.ts, portfolioSeries): fixed weights rebalanced daily, and the
// benchmark as it is.
//
// A portfolio's return over a past fall is what these weights earned on these prices over those dates:
// history, not a forecast. GMV's and Tangency's weights were chosen on the whole window, which includes
// every fall this lists, so their figures are hindsight, and the page says so beside them.
import { coveredStretches, drawdownEpisodes, windowReturn, type Episode } from "../../lib/episodes.ts";
import { LISTED_FALLS, type NamedFall } from "../../content/episodes.ts";
import { format } from "../../format.ts";
import type { Analysis, Column, TableRow } from "../../types.ts";
import type { Series } from "../returns/years.ts";

// ---- one series' deepest falls -------------------------------------------------------------------------

/** How many falls the table lists at most. */
export const FALLS_SHOWN = 5;

/** What the recovery column says of a fall the series has not climbed back from by the last close. */
export const NOT_YET = "not yet";

// The page shows the first six columns; the two calendar-day columns are marked pageHidden, so they ride
// in the downloads only and a spreadsheet can count in calendar days while the page counts closes.
export const EPISODE_COLUMNS: Column[] = [
  { key: "high", label: "High", format: "date", first: true },
  { key: "low", label: "Low", format: "date" },
  { key: "back", label: "Back at the high", format: "date" },
  { key: "depth", label: "Depth", format: "pct2" },
  { key: "down", label: "Trading days down", format: "int" },
  { key: "recover", label: "Trading days to recover", format: "int" },
  { key: "downCal", label: "Calendar days down", format: "int", pageHidden: true },
  { key: "recoverCal", label: "Calendar days to recover", format: "int", pageHidden: true },
];

/** The engine's deepest falls of one series of daily returns, deepest first, from the first close. */
export function seriesEpisodes(a: Analysis, r: readonly number[]): Episode[] {
  return drawdownEpisodes(r as number[], a.dates, a.prices.dates[0], FALLS_SHOWN);
}

export function episodeRows(list: readonly Episode[]): TableRow[] {
  return list.map((e) => ({
    high: e.start,
    low: e.trough,
    back: e.recovery ?? NOT_YET,
    depth: Number.isFinite(e.depth) ? e.depth : null,
    down: e.down.trading,
    recover: e.recover ? e.recover.trading : null,
    downCal: e.down.calendar,
    recoverCal: e.recover ? e.recover.calendar : null,
  }));
}

export const episodeTitle = (s: Series) => `Deepest falls, ${s.label}`;
export const episodeFile = (s: Series) => `deepest_falls_${s.id}`;

/** The one line printed instead of the table when there is nothing to list. */
export function noEpisodes(a: Analysis, s: Series): string {
  if (!s.r) return `${s.label} has no returns on this window, so there are no falls to list.`;
  return `${s.label} never closed below the amount invested or an earlier high between ${format(a.prices.dates[0], "date")} and ${format(a.asOf, "date")}, so there are no falls to list.`;
}

// ---- the named falls -----------------------------------------------------------------------------------

/** The named falls the loaded closes reach both ends of, oldest first; a fall only partly inside is left out. */
export function fallsInWindow(a: Analysis): NamedFall[] {
  return coveredStretches(LISTED_FALLS, a.dates, a.prices.dates[0]);
}

export const NAMED_TITLE = "Named falls in this window";
export const NAMED_FILE = "named_falls";

export function namedColumns(list: readonly Series[]): Column[] {
  return [
    { key: "fall", label: "Fall", format: "text", first: true },
    { key: "from", label: "S&P 500 high", format: "date" },
    { key: "to", label: "S&P 500 low", format: "date" },
    ...list.map((s): Column => ({ key: s.id, label: s.label, format: "pct2" })),
  ];
}

/** One row per fall: its dates, then each series' compounded return from the high's close to the low's. */
export function namedRows(a: Analysis, falls: readonly NamedFall[], list: readonly Series[]): TableRow[] {
  const start = a.prices.dates[0];
  return falls.map((f) => {
    const row: TableRow = { fall: f.label, from: f.from, to: f.to };
    for (const s of list) {
      const v = s.r ? windowReturn(s.r, a.dates, start, f.from, f.to) : null;
      row[s.id] = v !== null && Number.isFinite(v) ? v : null;
    }
    return row;
  });
}

/** The one line printed when no named fall lies inside the window. */
export function noNamedFalls(a: Analysis): string {
  const names = LISTED_FALLS.map((f) => f.label);
  const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `None of the named falls (${list}) lies wholly inside this window, from ${format(a.prices.dates[0], "date")} to ${format(a.asOf, "date")}, so none is listed.`;
}
