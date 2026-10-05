// The ids of the four constructions the scorecard can add (./constructions.ts says what each one is),
// and the three numbers that define them without solving anything: the last-year window, the cap, and
// the fewest assets the cap is offered on.
//
// They sit in a module of their own, importing only the length of a trading year, so code that only
// needs to name a construction or quote its numbers (the share link reading a column list, the
// tooltips quoting the cap) can do so without importing the solvers. ./constructions.ts re-exports all
// six, so an import from there keeps working.
import { TRADING_DAYS } from "./stats.ts";

export type AddedId = "tan.1y" | "tan.bs" | "tan.cap" | "rp";

/** The added constructions, in the order the scorecard offers them. */
export const ADDED_IDS: readonly AddedId[] = ["tan.1y", "tan.bs", "tan.cap", "rp"];

export function isAddedId(x: string): x is AddedId {
  return (ADDED_IDS as readonly string[]).includes(x);
}

/** The last-year window: 252 daily return rows, ending on the window's last day. */
export const YEAR_ROWS = TRADING_DAYS;

/** The capped construction's largest weight, a decimal (0.25 is 25%). */
export const CAP = 0.25;

/** Below five assets a 25% cap forces equal weight (four) or leaves no mix at all (fewer). */
export const CAP_MIN_ASSETS = 5;
