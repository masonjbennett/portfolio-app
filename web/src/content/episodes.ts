// Named market falls, for comparing the portfolios over a fixed stretch of history and for naming the fall
// an asset's worst drawdown belongs to.
//
// The rule every date here follows: a fall runs from the S&P 500's highest close to its lowest close. Inside
// the span of closes named by `search`, the low is the close furthest below the highest close before it, and
// the high is that earlier close (the first one, if the index closed at the same level twice). Both are closes
// of the price index itself, so the dates are trading days. They were found by that computation on the index's
// daily closes, which are kept in test/fixtures/gspc-falls.json, and test/t-periods.mjs recomputes every date
// below from those closes: a date typed in from anywhere else goes red.
//
// These are history, not commentary: a fixed past stretch never goes out of date.

export type FallId = "gfc" | "2011" | "q4-2018" | "covid" | "2022";

export interface NamedFall {
  id: FallId;
  /** The name the page prints. */
  label: string;
  /** ISO date of the index's high close, where the fall starts. */
  from: string;
  /** ISO date of the index's low close, where it ends. */
  to: string;
  /** The span of closes the high and the low were searched in, ISO, as requested from the price source. */
  search: readonly [string, string];
  /** True for the falls the portfolios are compared over; false for those used only to name an asset's fall. */
  listed: boolean;
}

export const NAMED_FALLS: readonly NamedFall[] = [
  { id: "gfc", label: "GFC 2007–2009", from: "2007-10-09", to: "2009-03-09", search: ["2006-07-01", "2009-12-31"], listed: false },
  { id: "2011", label: "2011", from: "2011-04-29", to: "2011-10-03", search: ["2010-07-01", "2011-12-31"], listed: false },
  { id: "q4-2018", label: "Q4 2018", from: "2018-09-20", to: "2018-12-24", search: ["2017-07-01", "2018-12-31"], listed: true },
  { id: "covid", label: "Covid", from: "2020-02-19", to: "2020-03-23", search: ["2019-07-01", "2020-12-31"], listed: true },
  { id: "2022", label: "2022", from: "2022-01-03", to: "2022-10-12", search: ["2021-07-01", "2022-12-31"], listed: true },
];

/** The falls the portfolios are compared over, oldest first. */
export const LISTED_FALLS: readonly NamedFall[] = NAMED_FALLS.filter((f) => f.listed);
