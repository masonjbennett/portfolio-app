// The settings' group headings, by id, in the order a reader meets them: the basket bar's (what is analysed),
// then the Assumptions drawer's (how it is scored). The page prints them and the guide (src/content/guide.ts)
// names them, so a renamed heading is renamed in both; test/t-guide.mjs holds the guide's entries to this list,
// and this list to the headings the page renders, both ways.

export type InputId = "tickers" | "baskets" | "dates" | "rf" | "bench" | "short" | "amount";

/** The basket bar's groups, in its order. */
export const BAR_IDS: readonly InputId[] = ["tickers", "baskets", "dates"];

/** The Assumptions drawer's groups, in its order. */
export const DRAWER_IDS: readonly InputId[] = ["rf", "bench", "short", "amount"];

/** Every group, bar then drawer: the order the phone's sheet shows them in. */
export const INPUT_IDS: readonly InputId[] = [...BAR_IDS, ...DRAWER_IDS];

/** Each group's heading, as the page prints it. */
export const INPUT_HEADINGS: Readonly<Record<InputId, string>> = {
  tickers: "Tickers",
  baskets: "Baskets",
  dates: "Date range",
  rf: "Risk-free rate",
  bench: "Benchmark",
  short: "Short selling",
  amount: "Starting amount",
};

/** The drawer's name, on the button that opens it and in the guide. */
export const ASSUMPTIONS = "Assumptions";
