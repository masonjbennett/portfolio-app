// The walk-forward result as published on masonjbennett.com (the project card and its method note), quoted
// here and never recomputed. Every portfolio was fitted on all prior history, held unchanged for a year, then
// refitted and rolled forward: six one-year holds. The page's own figures are in-sample, fitted to the window
// on screen; these are what the same three constructions earned on years they had not seen.
//
// The figures are STRINGS, written exactly as the site prints them ("0.710" keeps its zero, the negative uses
// the minus sign U+2212), so a quote can be compared character for character. If the site's wording or
// figures change, change them here and test/t-app.mjs goes red until the two copies agree again.

/** Where the result is published: the site's method note, and the only place the strip links to. */
export const PUBLISHED_URL = "https://masonjbennett.com/projects#portfolio-method";

/** When it was published, as the strip dates it. */
export const PUBLISHED_WHEN = "Sep 2026";

/** The number of one-year holding periods in the test. */
export const HOLDS = 6;

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

/** The five mega-caps' maximum-Sharpe portfolio, scored on the years it was fitted to. */
export const MEGA_CAP_IN_SAMPLE = "1.107";

/** The cross-asset minimum-variance portfolio's weight in aggregate bonds going into 2022. */
export const GMV_BOND_SHARE = "95.3%";
