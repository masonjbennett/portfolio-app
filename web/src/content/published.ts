// The walk-forward result as published on masonjbennett.com (the project card and its method note), quoted
// here and never recomputed. Every portfolio was fitted on all prior history, held unchanged for a year, then
// refitted and rolled forward: six holds, of which the "year" is 252 trading days, so the refits drift a few
// days into January and the sixth hold is partial (165 bars, Jan 9 to Sep 4 2026; web/test/oracle/walkforward.py
// rebuilds the run). The page's own figures are in-sample, fitted to the window on screen; these are what the
// same three constructions earned on years they had not seen.
//
// The figures are STRINGS, written exactly as the site prints them ("0.710" keeps its zero, the negative uses
// the minus sign U+2212), so a quote can be compared character for character. Nothing here reads the site
// itself: when its card or method note changes, change this file and test/t-app.mjs's copy together, or
// t-app goes red on the one left behind.

/** Where the result is published: the site's method note, and the only place the strip links to. */
export const PUBLISHED_URL = "https://masonjbennett.com/projects#portfolio-method";

/** When it was published, as the strip dates it. */
export const PUBLISHED_WHEN = "Sep 2026";

/** The project card's sentence, word for word. */
export const CARD_SENTENCE =
  "I walk-forward tested the optimizer over six rolling one-year holding periods: equal-weighting beat both " +
  "optimized portfolios on similar assets — the max-Sharpe portfolio's 1.107 in-sample Sharpe became 0.659 " +
  "out of sample — and optimization only added value across genuinely different asset classes.";

export interface PublishedSet {
  /** The set's name as the method note prints it. */
  name: string;
  tickers: readonly string[];
  /** Out-of-sample Sharpe ratios over the six holds: equal weight, minimum variance, maximum Sharpe. */
  ew: string;
  gmv: string;
  tangency: string;
}

/** The nine published out-of-sample Sharpe ratios, three sets by three constructions. */
export const PUBLISHED_SETS: readonly PublishedSet[] = [
  { name: "Five mega-caps", tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "JPM"], ew: "0.864", gmv: "0.710", tangency: "0.659" },
  { name: "Seven sector ETFs", tickers: ["XLK", "XLF", "XLV", "XLE", "XLI", "XLP", "XLY"], ew: "0.915", gmv: "0.450", tangency: "0.661" },
  { name: "Cross-asset", tickers: ["VTI", "AGG", "GLD", "VNQ", "EFA"], ew: "0.704", gmv: "−0.247", tangency: "0.883" },
];

/**
 * The five mega-caps' maximum-Sharpe portfolio, scored on the years it was fitted to: the whole window,
 * 2019-01-02 to 2026-09-04, as the app's own page fits it. That window includes the years the walk-forward
 * held out, so label it as fitted on the whole window, not as any one fold's in-sample figure.
 */
export const MEGA_CAP_IN_SAMPLE = "1.107";

/**
 * The terms 1.107 was scored on: the whole window's last bar and the run's risk-free rate. Copies of the stored
 * record of the run (src/content/walkforward.ts, the Walk-forward tab's chunk, which the page's first chunk does
 * not load); test/t-walkforward-published.mjs holds each to it.
 */
export const MEGA_CAP_IN_SAMPLE_END = "2026-09-04";
export const MEGA_CAP_IN_SAMPLE_RF = 0.02;

/**
 * The method note's figure for the cross-asset minimum-variance portfolio going into 2022: its weight in AGG
 * through the hold that began in January 2022, as the note prints it. test/fixtures/walkforward.json carries
 * the same string beside the weight the run held, and CI holds the one to the other.
 */
export const CROSS_AGG_INTO_2022 = "95.1%";

/**
 * The method note's other measured figure: the five mega-caps' maximum-Sharpe weight in AAPL at the
 * Sensitivity tab's five lookbacks (one, two, three and five years, and the full sample, each ending on the
 * run's last bar), in that order, as the note prints them. The same five strings are in
 * test/fixtures/walkforward.json beside the weights they round.
 */
export const MEGA_CAP_APPLE: readonly string[] = ["41.7%", "3.8%", "6.4%", "21.0%", "44.8%"];
