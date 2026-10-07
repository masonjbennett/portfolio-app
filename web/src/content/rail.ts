// The rail's section headings, by id, in the rail's order. The rail prints them and the guide (src/content/guide.ts)
// names them, so a renamed heading is renamed in both; test/t-guide.mjs holds the guide's entries to this list, and
// this list to the headings the rail renders, both ways.

export type RailId = "level" | "tickers" | "dates" | "rf" | "bench" | "short";

/** The rail's sections in the order it shows them. */
export const RAIL_IDS: readonly RailId[] = ["level", "tickers", "dates", "rf", "bench", "short"];

/** Each section's heading, as the rail prints it. */
export const RAIL_HEADINGS: Readonly<Record<RailId, string>> = {
  level: "Explanation level",
  tickers: "Tickers",
  dates: "Date range",
  rf: "Risk-free rate",
  bench: "Benchmark",
  short: "Short selling",
};
