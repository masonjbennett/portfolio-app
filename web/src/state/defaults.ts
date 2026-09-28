// The Streamlit sidebar's defaults, presets and benchmark list (645-805) as data. test/t-contract.mjs
// reads every literal here back out of portfolio_app.py at test time, so a value retyped wrong, or
// one the app changes, fails the run.
//
// These are the app's values. The page's FIRST screen is the baked example instead (its own
// tickers, dates and rate), and while it is on screen the rail must show the example's inputs,
// not these, or the rail and the numbers beside it would disagree.
import { parseTickers } from "../lib/clean.ts";
import type { Level, Settings, TabId } from "../types.ts";

export interface Preset {
  name: string; // the button label
  tickers: string; // the text the button puts in the ticker box, verbatim
  desc: string; // the caption under the button
}

// PRESETS (60-85), in the app's order. The comment above them (53-59) is a standing rule: every
// preset must survive the >5%-missing drop at the default 2019-01-01 start.
export const PRESETS: readonly Preset[] = [
  { name: "Cross-asset", tickers: "VTI, AGG, GLD, VNQ, EFA", desc: "Stocks, bonds, gold, property" },
  { name: "Mag 7", tickers: "AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA", desc: "Top 7 mega caps" },
  { name: "Sectors", tickers: "XLK, XLF, XLV, XLE, XLI, XLP, XLY, XLU, XLRE", desc: "9 sector ETFs" },
  { name: "Dividend", tickers: "JNJ, KO, PG, PEP, MMM, ABT, WMT", desc: "Long dividend records" },
  { name: "Growth", tickers: "NVDA, AMD, SHOP, TTD, MDB, NOW, PANW", desc: "High-growth tech" },
  { name: "Blue Chip", tickers: "AAPL, MSFT, JPM, JNJ, V, UNH, PG", desc: "Stable large caps" },
];

export interface Benchmark {
  label: string; // the select option, verbatim (728-735)
  symbol: string; // what is downloaded
  display: string; // the name charts and tables use: the label minus " (Recommended)" (744)
}

// bench_options (728-735), in the app's order; the first is the default (index=0, 739).
export const BENCHMARKS: readonly Benchmark[] = [
  { label: "S&P 500 (Recommended)", symbol: "^GSPC", display: "S&P 500" },
  { label: "Nasdaq 100", symbol: "^NDX", display: "Nasdaq 100" },
  { label: "Dow Jones", symbol: "^DJI", display: "Dow Jones" },
  { label: "Russell 2000", symbol: "^RUT", display: "Russell 2000" },
  { label: "MSCI World (URTH)", symbol: "URTH", display: "MSCI World (URTH)" },
  { label: "Total Market (VTI)", symbol: "VTI", display: "Total Market (VTI)" },
];

// The display name for a benchmark symbol; an unknown symbol is shown as itself.
export function benchDisplay(symbol: string): string {
  return BENCHMARKS.find((b) => b.symbol === symbol)?.display ?? symbol;
}

export const DEFAULT_TICKERS = "AAPL, MSFT, GOOGL, AMZN, JPM"; // the ticker box before any preset (691)
export const DEFAULT_START = "2019-01-01"; // date(2019, 1, 1) (702); the end defaults to today (704)
export const RF_FALLBACK = 0.02; // RF_FALLBACK = 2.0, in percent (601): used when FRED cannot be reached (711)
export const RF_STEP = 0.0025; // the rate field's step, 0.25 percentage points (717)
export const DEFAULT_AMOUNT = 10000; // value=10000 (724)
export const MIN_AMOUNT = 100; // min_value=100 (724)
export const AMOUNT_STEP = 1000; // step=1000 (724)
export const DEFAULT_BENCHMARK = BENCHMARKS[0].symbol; // index=0 (739)
export const DEFAULT_ALLOW_SHORT = false; // the shorting toggle's value=False (749)
export const DEFAULT_LEVEL: Level = "plain"; // session_state.knowledge = "Beginner" (17-18)
export const FRONTIER_POINTS = 80; // efficient_frontier's n_points=80 (948), the Optimization tab's call (1600)
export const DEFAULT_TAB: TabId = "returns"; // st.tabs opens on the first (1213)

// The app's sidebar as it stands before anything is touched. rf null is the live rate (706-717).
export const DEFAULT_SETTINGS: Settings = {
  tickers: parseTickers(DEFAULT_TICKERS),
  start: DEFAULT_START,
  end: null,
  rf: null,
  benchmark: DEFAULT_BENCHMARK,
  allowShort: DEFAULT_ALLOW_SHORT,
  amount: DEFAULT_AMOUNT,
};
