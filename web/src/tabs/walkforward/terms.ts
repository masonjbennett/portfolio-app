// The published run's terms, for the two segments and the rerun button: its last price day and its rate. A
// leaf module, read from the stored record of the run (src/content/walkforward.ts), so that ./Live.tsx can
// read them without importing ../WalkForward.tsx, which imports it.
import { WALK_RF, WALK_RUNS } from "../../content/walkforward.ts";
import { DEFAULT_START } from "../../state/defaults.ts";

// The run the published test used: prices from the app's default start through its last bar, at the rate
// the app used then, long-only. test/t-app.mjs holds the last bar and the rate to the published test's own
// record (test/fixtures/walkforward.json), set by set.
export const PUBLISHED_LAST_BAR: string = WALK_RUNS[0].lastBar;
export const PUBLISHED_RF: number = WALK_RF;
// The first day a rerun asks prices from: the app's default start, which the published run used.
export const RERUN_START: string = DEFAULT_START;

// The heading over the in-sample and out-of-sample figures, the same in both segments.
export const PAIR_HEADING = "In-sample against out-of-sample";

// The day after an ISO day. The price request's end is exclusive, as yfinance treats it
// (src/data/prices.ts), so asking for the day after a bar makes that bar the last one loaded.
export function dayAfter(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
