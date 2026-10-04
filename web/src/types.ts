// The contract the page is built against: the state the page holds, what is computed once from
// the prices, and the props every shared component takes. The engine's own types are imported,
// never redefined. Line numbers cite portfolio_app.py.
import type { ReactNode } from "react";
import type { CleanError, CleanEvent, Frame, RequestError } from "./lib/clean.ts";
import type { AddedId } from "./lib/constructions.ts";
import type { Mat, Vec } from "./lib/num.ts";
import type { FrontierPoint, Solution, Tangency } from "./lib/optimize.ts";
import type { AnnualStats } from "./lib/stats.ts";
import type { ScoreTipKey } from "./content/tooltips.ts";

// ---- explanation level -----------------------------------------------------------------------

/** How much each tooltip explains: the app's Beginner / Intermediate / Advanced radio (650-656). */
export type Level = "plain" | "finance" | "formula";

/** The three levels in the app's order, each with its page label and the app's own name (650-653). */
export const LEVELS: readonly { id: Level; label: string; oracle: "Beginner" | "Intermediate" | "Advanced" }[] = [
  { id: "plain", label: "Plain", oracle: "Beginner" },
  { id: "finance", label: "Finance", oracle: "Intermediate" },
  { id: "formula", label: "Formula", oracle: "Advanced" },
];

// ---- settings ----------------------------------------------------------------------------------

/**
 * What the visitor chose in the rail. Every field except `amount` travels in the share URL (the
 * custom weights travel beside them, see ShareState); `amount` NEVER does, it lives in
 * localStorage with the level (see Prefs). There is no Run button: a change recomputes at once,
 * and only `tickers`, `start`, `end` and `benchmark` fetch prices.
 */
export interface Settings {
  /** Portfolio symbols, parsed: trimmed, upper-case, de-duplicated, in the visitor's order (1007). URL. */
  tickers: string[];
  /** First requested day, ISO yyyy-mm-dd (default 2019-01-01, 702). URL. */
  start: string;
  /** Last requested day, ISO yyyy-mm-dd; null means today, resolved when prices are fetched (704). URL when set. */
  end: string | null;
  /** Annual risk-free rate as a decimal (0.0389 is 3.89%); null uses the live 3-month Treasury (706-717). URL when set. */
  rf: number | null;
  /** Benchmark symbol, one of BENCHMARKS in src/state/defaults.ts (728-735). URL. */
  benchmark: string;
  /** Weights may go negative: bounds [-1, 1] instead of [0, 1] (747-752, 780-782). URL. */
  allowShort: boolean;
  /** Starting dollar amount for the wealth charts (724-725). localStorage only, NEVER the URL. */
  amount: number;
  /**
   * The constructions added to the Optimization tab's scorecard, by the engine's ids, in the fixed order
   * (src/lib/constructions.ts ADDED_IDS); empty shows the default table. URL only, never localStorage:
   * the custom weights are not remembered in this browser either, so the two travel together, in a link.
   */
  cols: AddedId[];
}

/** The settings a share link may carry: all of them but the dollar amount. */
export type ShareSettings = Omit<Settings, "amount">;

/** What a share URL holds, decoded. Absent fields are absent, never defaulted here. */
export interface ShareState {
  /** Only the settings the URL actually named. */
  settings: Partial<ShareSettings>;
  /** Raw custom weights by ticker, or null when the URL carries none. Weights, never amounts. */
  weights: CustomWeights | null;
  /** The tab the link opens on, or null for the default. */
  tab: TabId | null;
}

/** What this browser remembers in localStorage: never shared, never in a URL. */
export interface Prefs {
  /** The explanation level last chosen. */
  level: Level;
  /** The starting dollar amount last entered. */
  amount: number;
}

// ---- tabs ----------------------------------------------------------------------------------------

/** The six tabs, in the app's order (1213-1220). */
export type TabId = "returns" | "risk" | "correlation" | "optimization" | "custom" | "sensitivity";

/** Tab labels, the app's text with its two-space padding trimmed (1213-1220). */
export const TAB_LABELS: Readonly<Record<TabId, string>> = {
  returns: "Returns & Statistics",
  risk: "Risk Analysis",
  correlation: "Correlation",
  optimization: "Portfolio Optimization",
  custom: "Custom Portfolio",
  sensitivity: "Sensitivity",
};

/** The tab ids in display order. */
export const TAB_IDS: readonly TabId[] = ["returns", "risk", "correlation", "optimization", "custom", "sensitivity"];

/**
 * Raw custom weights by ticker, exactly as typed in the Custom tab (tab 5, divided by their total at 1732); the
 * Optimization tab reads them too (1581). A ticker with no entry means 1/n, the app's default
 * before tab 5 has run. Normalise with normalizeCustom from src/lib/portfolio.ts, never by hand.
 */
export type CustomWeights = Record<string, number>;

// ---- data from the endpoints ---------------------------------------------------------------------

/** The fields every price payload carries, whichever layout it uses. */
export interface PriceCore {
  /** The symbols requested, in order. */
  tickers: string[];
  /** The benchmark symbol requested. */
  benchmark: string;
  /** First requested day, ISO. */
  start: string;
  /** Last requested day, ISO. */
  end: string;
  /** When the prices were pulled, ISO timestamp. */
  pulledAt: string;
  /** Symbols that returned no data at all (the app's `failed`, 1026-1047). */
  missing: string[];
  /** Column names: the tickers that downloaded, then the benchmark. */
  columns: string[];
}

/** The live /api/prices answer and the test fixtures: row-major, `[date, ...price or null]` per day. */
export interface PriceRows extends PriceCore {
  /** One row per day, ascending: ISO date, then one close per column, null where there was no bar. */
  rows: (string | number | null)[][];
}

/** The baked first-screen example (public/example-cross.json): column-major. */
export interface PriceColumns extends PriceCore {
  /** Which example this is ("cross"). */
  set: string;
  /** Display name of the benchmark, " (Recommended)" removed (744). */
  benchLabel: string;
  /** The annual risk-free rate the example was computed at, decimal. */
  rf: number;
  /** Trading days, ISO, ascending. */
  dates: string[];
  /** One array per column, aligned with `dates`; null where there was no bar. */
  prices: (number | null)[][];
}

/** A price payload in either layout; toFrame in src/data/payload.ts reads both. */
export type PricePayload = PriceRows | PriceColumns;

/** The live risk-free rate: the latest 3-month Treasury yield (fetch_rf_rate, 606). */
export interface RfRate {
  /** Annual rate as a decimal (FRED's 4.12 arrives as 0.0412). */
  rate: number;
  /** The observation date the rate belongs to, ISO. */
  date: string;
  /** Where it came from, literally, e.g. "FRED DGS3MO". */
  source: string;
}

/** Named failures an /api endpoint answers with, beside a non-2xx status. */
export type ApiErrorId = "not-implemented" | "bad-request" | "upstream" | "rate-limited" | "no-data";

/** An endpoint's failure body: a stable id to branch on and a literal sentence to show. */
export interface ApiError {
  /** Stable id. */
  error: ApiErrorId;
  /** One plain sentence saying what failed. */
  message: string;
}

/** The /api/rf answer: the rate, or a named error. */
export type RfPayload = RfRate | ApiError;

// ---- the analysis ----------------------------------------------------------------------------------

/** Where the rate an analysis used came from. "live" is FRED's, either the mean over the price window (the
 *  default) or the latest yield; which one travels in RfView.basis (src/state/rfwindow.ts). */
export type RfSource = "manual" | "live" | "example" | "fallback";

/** The rate handed to analyze(): resolved before the call, so analyze never fetches. */
export interface RfChoice {
  /** Annual rate, decimal. */
  rate: number;
  /** Where it came from. */
  source: RfSource;
}

/**
 * Everything computed ONCE from (payload, settings, rate) that the band or more than one tab
 * needs. Tabs compute their own tab-specific figures from these. All return figures are DAILY
 * unless the field says annual, matching the engine.
 */
export interface Analysis {
  /** Discriminates Analysis from AnalysisError. */
  ok: true;
  /** "example" for the baked first screen, "live" for a fetched payload. */
  source: "example" | "live";
  /** The last price date in the cleaned frame, ISO: the date the page labels its data with. */
  asOf: string;
  /** When the prices were pulled, ISO timestamp. */
  pulledAt: string;
  /** The requested date range (the title chip uses these, not the data span, 1172-1187). */
  requested: { start: string; end: string };
  /** Portfolio symbols after cleaning, in the visitor's order (1080). */
  tickers: string[];
  /** The benchmark symbol. */
  benchmark: string;
  /** The benchmark's display name, " (Recommended)" removed (744). */
  benchLabel: string;
  /** The cleaned closes, benchmark column included (1068). */
  prices: Frame;
  /** Dates of the return rows: the cleaned price dates minus the first (889-890). */
  dates: string[];
  /** Daily simple returns, one array per ticker, aligned with `tickers` and `dates` (1161-1162). */
  returns: Vec[];
  /** Benchmark daily simple returns, aligned with `dates` (1163). */
  bench: Vec;
  /** Mean daily return per ticker (1165). */
  m: Vec;
  /** Daily covariance of the tickers, ddof 1, benchmark excluded (1164). */
  S: Mat;
  /** The annual risk-free rate every figure used (frozen per analysis, 1087). */
  rf: number;
  /** Where that rate came from. */
  rfSource: RfSource;
  /** The bounds the solves used: true is [-1, 1], false is [0, 1]. */
  allowShort: boolean;
  /** Equal weights, 1/n each (1192). */
  ew: Vec;
  /** Global minimum variance portfolio (926-933); null means the solve FAILED. */
  gmv: Solution | null;
  /** Maximum Sharpe portfolio (936-944); null means it FAILED. Never an equal-weight stand-in (1200-1202). */
  tangency: Tangency | null;
  /** The efficient frontier, GMV return to the highest reachable return, FRONTIER_POINTS points. */
  frontier: FrontierPoint[];
  /** annualized_stats of the benchmark at `rf` (1169): mu, sigma, sharpe, sortino, all annual. */
  benchStats: AnnualStats;
  /** What cleaning did on the way: failed downloads, dropped tickers, a truncated range (1026-1075). */
  events: CleanEvent[];
}

/** Why an analysis could not be built: a request check, a cleaning stop, or the fetch itself. */
export type AnalysisErrorId = RequestError | CleanError | "fetch-failed";

/** A named failure with the literal sentence the page shows. */
export interface AnalysisError {
  /** Discriminates AnalysisError from Analysis. */
  ok: false;
  /** Stable id. */
  error: AnalysisErrorId;
  /** One plain sentence saying what failed and what to change. */
  message: string;
  /** Cleaning events recorded before the stop (the dropped tickers that caused it, say). */
  events: CleanEvent[];
}

// ---- load states -----------------------------------------------------------------------------------

/**
 * The state of anything that can be missing: every chart, table and the analysis itself. It fails
 * closed and named: an error says which thing failed, never a blank or a stand-in figure.
 */
export type LoadState<T> =
  | { status: "loading" }
  | { status: "empty"; reason: string }
  | { status: "error"; name: string; message: string }
  | { status: "ready"; value: T };

// ---- the page hook -------------------------------------------------------------------------------

/** What useWorkbench() returns: the page's whole state and its setters. */
export interface Workbench {
  /** The current settings. */
  settings: Settings;
  /** Merge a change into the settings; a price-affecting field starts a fetch. */
  setSettings: (patch: Partial<Settings>) => void;
  /** The explanation level. */
  level: Level;
  /** Change the level (remembered in localStorage). */
  setLevel: (level: Level) => void;
  /** The analysis on screen. */
  analysis: LoadState<Analysis>;
  /** A price request is in flight; `analysis` still holds the previous result meanwhile. */
  fetching: boolean;
  /** The last attempt that failed, shown beside the analysis still on screen; null when the last one worked. */
  failure: AnalysisError | null;
  /** The live risk-free rate lookup. Its ready value is an RfView (src/state/rfwindow.ts): the latest yield,
   *  the mean over the price window, and which of them is in use. */
  rf: LoadState<RfRate>;
  /** Raw custom weights by ticker. */
  weights: CustomWeights;
  /** Replace the custom weights wholesale. */
  setWeights: (next: CustomWeights) => void;
  /** The active tab. */
  tab: TabId;
  /** Switch tabs. */
  setTab: (tab: TabId) => void;
}

/** What every tab component receives. Tabs render only with a ready analysis. */
export interface TabProps {
  /** The computed analysis. */
  analysis: Analysis;
  /** The current settings (amount and allowShort are read live, 1196, 1258). */
  settings: Settings;
  /** The explanation level for tooltips. */
  level: Level;
  /** Raw custom weights by ticker. */
  weights: CustomWeights;
  /** Replace the custom weights wholesale. */
  setWeights: (next: CustomWeights) => void;
  /** Ask for a settings change (a tab's "switch shorting on" link, say). */
  requestSettings: (patch: Partial<Settings>) => void;
}

// ---- chrome ----------------------------------------------------------------------------------------

/** The desktop rail: level, tickers and presets, dates, rf, amount, benchmark, shorting. */
export type RailProps = Pick<Workbench, "settings" | "setSettings" | "level" | "setLevel" | "rf" | "fetching" | "failure">;

/** The phone summary chip ("5 tickers · 2019–today · rf 4.1%") that opens the rail as a sheet. */
export interface SummaryChipProps {
  /** The current settings. */
  settings: Settings;
  /** The live rate lookup, for "rf" when settings.rf is null. */
  rf: LoadState<RfRate>;
  /** The sheet is open. */
  open: boolean;
  /** Open or close the sheet. */
  onToggle: () => void;
}

/** The front-page band: one sentence stating the finding and four stat plates (1192-1208). */
export interface BandProps {
  /** The analysis on screen. */
  analysis: LoadState<Analysis>;
  /** The explanation level for the plates' tooltips. */
  level: Level;
  /** A fetch is in flight. */
  fetching: boolean;
  /** The last failed attempt, if any. */
  failure: AnalysisError | null;
}

// ---- shared components -------------------------------------------------------------------------------

/** An error boundary around one card: fails closed, naming the card. */
export interface BoundaryProps {
  /** The card's name, shown and logged when it fails. */
  name: string;
  /** A change in this value clears a caught error and retries the render. */
  resetKey?: unknown;
  /** The card. */
  children: ReactNode;
}

/** A segmented pill row: the tab switch and every two-to-six-way choice. */
export interface SegControlProps<T extends string> {
  /** The choices in order. */
  options: readonly { value: T; label: string }[];
  /** The selected value. */
  value: T;
  /** Called with the newly selected value. */
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  ariaLabel: string;
  /**
   * When the row switches panels (the six tabs): each pill gets id `${idPrefix}-tab-${value}` and
   * aria-controls `${idPrefix}-panel-${value}`, and the page gives the panel it shows that id,
   * role="tabpanel" and aria-labelledby the pill. Left out, the row controls no panel, so it is a radio
   * group (role radiogroup, each pill role radio with aria-checked) and the pills carry no ids.
   */
  idPrefix?: string;
}

/** A section header: a teal bar on a hairline. */
export interface SlugProps {
  /** The header text. */
  children: ReactNode;
  /** Anchor id, if the section is linkable. */
  id?: string;
}

/**
 * Number and date formats, applied at render time and mapped to Excel number formats on export:
 * pct2 12.34%, pct1 12.3%, num2 1.23, num3 1.234, num4 1.2345, num6 0.000123 (daily covariances,
 * printed {:.6f} at 1462, which num4 would flatten to 0.0001), int 1,234, usd0 $1,234,
 * usd2 $1,234.56, date an ISO day shown as the page's date style.
 */
export type FormatId = "pct2" | "pct1" | "num2" | "num3" | "num4" | "num6" | "int" | "usd0" | "usd2" | "date";

/** A cell's format: a FormatId, or "text" for a label printed as is (a ticker, a portfolio name). */
export type CellFormat = FormatId | "text";

/** One table column. */
export interface Column {
  /** The row field this column reads. */
  key: string;
  /** Header text. */
  label: string;
  /** How the cell is printed; also the Excel number format on export. */
  format: CellFormat;
  /** The label column: left-aligned, and frozen when the table scrolls sideways on a phone. */
  first?: boolean;
  /** Left off the page but kept in the CSV and Excel downloads, e.g. a count in a second unit a spreadsheet may want. */
  pageHidden?: boolean;
}

/** One table row: raw NUMBERS (or ISO dates, or labels in "text" columns), never preformatted strings. null prints as a dash. */
export type TableRow = Record<string, number | string | null>;

/** A dense table with its own CSV and Excel downloads. */
export interface TableProps {
  /** Table title, also the sheet name. */
  title: string;
  /** Columns in order. */
  columns: Column[];
  /** Rows in order. */
  rows: TableRow[];
  /** Download file name without extension, e.g. "summary-comparison". */
  filename: string;
}

/** A chart's frame: a title that states the finding, and its own loading, empty and error states. */
export interface ChartFrameProps<T> {
  /** One sentence stating what the chart shows, e.g. "Gold fell least in the 2022 drawdown". */
  title: string;
  /** The chart's data state; only "ready" renders the chart. */
  state: LoadState<T>;
  /** Renders the chart from the ready value. */
  children: (value: T) => ReactNode;
  /** One line under the title: what is plotted, over which period. */
  subtitle?: string;
  /** The space the chart takes, in px, held by every state so the page does not jump. */
  height?: number;
}

/** Keys of the app's tiered tooltips (TOOLTIPS, 525-587). */
export type TipKey =
  | "return"
  | "volatility"
  | "sharpe"
  | "sortino"
  | "max_dd"
  | "best_sharpe"
  | "tangency_return"
  | "bench_return"
  | "bench_vol"
  | "beta"
  | "alpha";

/** An info mark that shows one tooltip at the chosen level. */
export interface TipProps {
  /** Which tooltip: one of the app's, or one of the scorecard's own. */
  tip: TipKey | ScoreTipKey;
  /** Which of its three texts. */
  level: Level;
  /** The shorting toggle: two formula-level texts follow it (content/tooltips.ts). Default off. */
  allowShort?: boolean;
}

/** A stat plate: a label over one large number (the Snapshot's st.metric, 1203-1208). */
export interface PlateProps {
  /** The label, e.g. "Tangency Sharpe (in-sample)". */
  label: string;
  /** The number; null prints as a dash and says it is unavailable, never a stand-in figure. */
  value: number | null;
  /** How the number is printed. */
  format: FormatId;
  /** The tooltip beside the label, if any. */
  tip?: TipKey;
  /** The explanation level for that tooltip. */
  level: Level;
  /** The shorting toggle, passed to the tooltip, whose text follows it. Default off. */
  allowShort?: boolean;
  /** One standard error of the figure, in the figure's own format; null or non-finite prints nothing. */
  se?: number | null;
}
