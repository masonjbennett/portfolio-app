// The scorecard as a workbook of formulas, so each figure can be traced back to the closes it came from.
// Pure: it builds the cells, and src/download.ts writes them. It loads only when someone asks for the file
// (a dynamic import from the scorecard's download row), never with the page.
//
// Six sheets:
// - Notes: what the book is, the basket, the window, the rate, the conventions, and what is left out.
// - Prices: the cleaned closes the page used, benchmark included, as values.
// - Returns: each day's simple return as a formula on Prices (the close over the previous close, minus one).
// - Weights: one column per portfolio. Equal weight is =1/n; the solved portfolios and the typed mix are the
//   page's weights entered as values, so changing the rate moves every figure but never re-solves a weight.
//   Below them, the rate and the amount invested (the two inputs), and the same weights laid across a row,
//   because SUMPRODUCT pairs a row with a row.
// - Daily: per portfolio its daily return (fixed weights, rebalanced every day, as portfolioReturns does),
//   then the running quantities the figures read, each one formula per row on the row above.
// - Scorecard: the page's heads across, the benchmark last, and one row per figure.
//
// Every formula cell is saved with a value, and that value is the page's own number: for a scorecard
// figure it is the figure the page prints (the ScoreModel handed in), for every other cell it is the same
// arithmetic the formula performs, in the same order. A viewer that never recalculates (a phone's preview,
// a mail attachment) therefore shows the page's figures, and Excel, once it recalculates, agrees with them.
// test/t-workbook.mjs holds both, and holds desktop Excel's own recalculation to them.
//
// Rules the formulas keep:
// - Only functions Excel 2007 reads natively, plus the _xlfn.-prefixed ones Excel itself stores that way.
// - No array evaluation outside SUMPRODUCT: a formula read from a file is a legacy formula, and Excel
//   applies implicit intersection to a range where it expects one value, so PRODUCT(1+range) would quietly
//   read one cell. Running quantities (wealth, its high) are one formula per row on the row above.
// - Expected shortfall counts its days with SUMPRODUCT over the comparison itself, with no criterion built
//   as text. Excel calls two numbers equal when they agree to 15 significant digits, here as everywhere,
//   so a day whose return IS the 5th percentile is counted, as the page counts it.
import { colName, type BookSheet, type Cell, type FormulaCell, type Worksheet } from "./download.ts";
import { RF_SOURCE } from "./data/fred.ts";
import { EXCEL_FORMATS, excelSerial, format } from "./format.ts";
import type { Vec } from "./lib/num.ts";
import { portfolioReturns } from "./lib/portfolio.ts";
import { TRADING_DAYS } from "./lib/stats.ts";
import { DEFAULT_AMOUNT } from "./state/defaults.ts";
import type { Analysis, RfSource } from "./types.ts";
import { FITTED } from "./tabs/caption.ts";
import { isAddedId, YEAR_ROWS } from "./lib/constructions.ts";
import { ADDED_LABEL, addedMissing, addedSub, CUSTOM_REFUSAL } from "./tabs/optimization/model.ts";
import { SCORE_GROUPS, SCORE_METRICS, type ScoreColumn, type ScoreMetric, type ScoreModel } from "./tabs/optimization/scorecard.ts";

/** The saved file's name, without its extension. */
export const BOOK_FILENAME = "scorecard_model";

/** The sheets, in the book's order. */
export const SHEETS = { notes: "Notes", prices: "Prices", returns: "Returns", weights: "Weights", daily: "Daily", score: "Scorecard" } as const;

/** The scorecard rows the book computes, in the page's order; "sharpeSE" is the Sharpe row's standard error. */
export const BOOK_ROWS = [
  "annual", "mean", "cumulative", "vol", "downside", "mdd", "sharpe", "sharpeSE", "sortino", "calmar",
  "beta", "alpha", "corr", "r2", "te", "ir", "var", "es",
] as const;
export type BookRow = (typeof BOOK_ROWS)[number];

/** The page's rows left to the values download, and why, as Notes says it. */
export const LEFT_OUT_IDS = ["best", "worst", "positive", "up", "down", "longest", "longestCal", "lookback", "cut", "draws", "params"] as const;

/** The label of the standard error row, as the values download names it. */
export const SE_LABEL = "Sharpe standard error";

/** What the page prints where a figure is not defined, and the book writes in its place. */
export const NOT_DEFINED = "n/a";

// Number formats the book adds to the page's own (src/format.ts).
const DAILY_PCT = "0.0000%";
const CLOSE = "#,##0.00##";
const MONEY = EXCEL_FORMATS.usd2;

export interface BookInput {
  analysis: Analysis;
  /** The scorecard the page shows: its heads, its figures, and each column's weights. */
  model: ScoreModel;
  /** The amount invested, the starting value of every wealth column (the figures do not depend on it). */
  amount?: number;
  /** Why the typed mix was refused, when it was: its sentence (CUSTOM_REFUSAL) goes under the empty column. */
  refused?: keyof typeof CUSTOM_REFUSAL | null;
}

// ---- cells ------------------------------------------------------------------------------------------

class Sheet {
  readonly cells: Record<string, Cell | FormulaCell> = {};
  private rows = 0;
  private cols = 0;
  private readonly widths: number[] = [];
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }

  private put(c: number, r: number, cell: Cell | FormulaCell, width: number): void {
    this.cells[`${colName(c)}${r}`] = cell;
    this.rows = Math.max(this.rows, r);
    this.cols = Math.max(this.cols, c + 1);
    this.widths[c] = Math.max(this.widths[c] ?? 10, Math.min(width, 60));
  }
  text(c: number, r: number, s: string): void {
    if (s !== "") this.put(c, r, { t: "s", v: s }, s.length + 2);
  }
  num(c: number, r: number, v: number, z?: string): void {
    if (!Number.isFinite(v)) throw new Error(`${this.name}!${colName(c)}${r}: no finite value to write`);
    this.put(c, r, z ? { t: "n", v, z } : { t: "n", v }, 12);
  }
  formula(c: number, r: number, f: string, v: number, z?: string): void {
    if (!Number.isFinite(v)) throw new Error(`${this.name}!${colName(c)}${r}: the formula ${f} has no finite value to save`);
    this.put(c, r, z ? { t: "n", v, f, z } : { t: "n", v, f }, 14);
  }
  date(c: number, r: number, iso: string): void {
    const serial = excelSerial(iso);
    if (serial === null) throw new Error(`${this.name}!${colName(c)}${r}: ${iso} is not a date`);
    this.num(c, r, serial, EXCEL_FORMATS.date);
  }
  width(c: number, w: number): void {
    this.widths[c] = w;
  }
  done(): BookSheet {
    const ws: Worksheet = {
      "!ref": `A1:${colName(Math.max(this.cols, 1) - 1)}${Math.max(this.rows, 1)}`,
      "!cols": Array.from({ length: Math.max(this.cols, 1) }, (_, c) => ({ wch: this.widths[c] ?? 10 })),
    };
    Object.assign(ws, this.cells);
    return { name: this.name, sheet: ws };
  }
}

// A reference to another sheet's cell or range. None of the book's sheet names needs quoting.
const on = (sheet: string, ref: string) => `${sheet}!${ref}`;
const abs = (c: number, r: number) => `$${colName(c)}$${r}`;
const at = (c: number, r: number) => `${colName(c)}${r}`;

// ---- the layout -------------------------------------------------------------------------------------

// Rows of the price-aligned sheets: row 1 heads, row 2 the first close (no return yet), row 2 + t the
// close of day t, whose return is the t-th entry of analysis.returns. Prices, Returns and Daily share it.
const FIRST = 2;

// Daily's columns per portfolio, in order.
const DAILY_PARTS = ["return", "wealth", "running high", "drawdown", "active return"] as const;
const PART = { ret: 0, wealth: 1, high: 2, dd: 3, active: 4 } as const;

/** Where each input and each portfolio lives, worked out once and read by every sheet. */
interface Layout {
  a: Analysis;
  model: ScoreModel;
  amount: number;
  n: number;
  /** The last row of the price-aligned sheets. */
  last: number;
  /** Returns: the column of ticker i is 1 + i; the benchmark's follows them. */
  benchCol: number;
  /** Weights: the portfolio columns (every scorecard column but the benchmark), their sheet column. */
  ports: { col: ScoreColumn; k: number; wcol: number }[];
  sumRow: number;
  rfRow: number;
  amountRow: number;
  /** Weights: the laid-across row of each ok portfolio, by scorecard column index. */
  acrossRow: Map<number, number>;
  acrossHead: number;
  /** Daily: the first column of each ok column's group (the benchmark's included), by scorecard column index. */
  group: Map<number, number>;
}

function layout(a: Analysis, model: ScoreModel, amount: number): Layout {
  const n = a.tickers.length;
  const ports = model.columns.map((col, k) => ({ col, k })).filter((x) => x.col.id !== "bench").map((x, j) => ({ ...x, wcol: 1 + j }));
  const sumRow = 3 + n;
  const rfRow = sumRow + 2;
  const amountRow = rfRow + 1;
  const acrossHead = amountRow + 2;
  const acrossRow = new Map<number, number>();
  let r = acrossHead + 1;
  for (const p of ports) if (p.col.weights) acrossRow.set(p.k, r++);
  const group = new Map<number, number>();
  let c = 1;
  model.columns.forEach((col, k) => {
    if (col.id === "bench" || col.weights) {
      group.set(k, c);
      c += DAILY_PARTS.length;
    }
  });
  return { a, model, amount, n, last: FIRST + a.dates.length, benchCol: 1 + n, ports, sumRow, rfRow, amountRow, acrossRow, acrossHead, group };
}

const rfRef = (L: Layout) => on(SHEETS.weights, abs(1, L.rfRow));
const amountRef = (L: Layout) => on(SHEETS.weights, abs(1, L.amountRow));

// ---- the sheets ---------------------------------------------------------------------------------------

function pricesSheet(L: Layout): BookSheet {
  const s = new Sheet(SHEETS.prices);
  const p = L.a.prices;
  s.text(0, 1, "Date");
  p.columns.forEach((name, j) => s.text(1 + j, 1, name === L.a.benchmark ? `${name} (benchmark)` : name));
  p.dates.forEach((d, i) => {
    s.date(0, FIRST + i, d);
    p.values.forEach((col, j) => s.num(1 + j, FIRST + i, col[i], CLOSE));
  });
  return s.done();
}

// The Prices column of a symbol.
function priceCol(L: Layout, symbol: string): number {
  const j = L.a.prices.columns.indexOf(symbol);
  if (j < 0) throw new Error(`Prices has no column ${symbol}`);
  return 1 + j;
}

function returnsSheet(L: Layout): BookSheet {
  const s = new Sheet(SHEETS.returns);
  const { a } = L;
  const series: { head: string; pc: number; r: Vec }[] = [
    ...a.tickers.map((t, i) => ({ head: t, pc: priceCol(L, t), r: a.returns[i] })),
    { head: `${a.benchLabel} (benchmark)`, pc: priceCol(L, a.benchmark), r: a.bench },
  ];
  s.text(0, 1, "Date");
  series.forEach((x, j) => s.text(1 + j, 1, x.head));
  s.date(0, FIRST, a.prices.dates[0]);
  a.dates.forEach((d, t) => {
    const row = FIRST + 1 + t;
    s.date(0, row, d);
    series.forEach((x, j) => s.formula(1 + j, row, `${on(SHEETS.prices, at(x.pc, row))}/${on(SHEETS.prices, at(x.pc, row - 1))}-1`, x.r[t], DAILY_PCT));
  });
  return s.done();
}

/** Why a portfolio column has no weights, in words. */
function missingReason(col: ScoreColumn, a: Analysis, reason: string | null): string {
  if (col.id === "custom") return reason ?? "Custom is not shown on the page.";
  // An added column's reason is the page's own sentence (model.ts), so the book and the page cannot differ.
  // The capped tangency and risk parity never short, so the switch is no part of why they found nothing.
  if (isAddedId(col.id)) {
    const why = addedMissing(a, col.id);
    return `${why.charAt(0).toUpperCase()}${why.slice(1)}, so the page shows none.`;
  }
  return `The solve found no weights on this window${a.allowShort ? "" : " without shorting"}, so the page shows none.`;
}

/** The sub-line under a head: the page's own, or why the column is empty. */
function subLine(col: ScoreColumn, a: Analysis, reason: string | null): string {
  if (col.id === "bench") return "the benchmark";
  if (!col.ok) return missingReason(col, a, reason);
  if (col.id === "ew") return "1/n each, as formulas";
  if (col.id === "custom") return col.sub ? `typed on the Custom tab, as values: ${col.sub}` : "typed on the Custom tab, as values";
  return `${col.sub ?? FITTED}, as values`;
}

const RATE_FROM: Readonly<Record<RfSource, string>> = {
  manual: "typed on the page",
  live: `FRED's 3-month Treasury bill yield (${RF_SOURCE}): its mean over the window, or the latest reading where the series does not cover the window`,
  example: "the rate the example basket was computed at",
  fallback: "the page's stand-in rate, used because FRED could not be reached",
};

function weightsSheet(L: Layout, reason: string | null): BookSheet {
  const s = new Sheet(SHEETS.weights);
  const { a, n } = L;
  s.text(0, 1, "Asset");
  s.text(0, 2, "How the weights were set");
  for (const p of L.ports) {
    s.text(p.wcol, 1, p.col.label);
    s.text(p.wcol, 2, subLine(p.col, a, reason));
    const w = p.col.weights;
    a.tickers.forEach((t, i) => {
      s.text(0, 3 + i, t);
      if (!w) return;
      if (p.col.id === "ew") s.formula(p.wcol, 3 + i, `1/${n}`, 1 / n, EXCEL_FORMATS.pct2);
      else s.num(p.wcol, 3 + i, w[i], EXCEL_FORMATS.pct2);
    });
    if (w) {
      let total = 0;
      for (const x of w) total += x;
      s.formula(p.wcol, L.sumRow, `SUM(${at(p.wcol, 3)}:${at(p.wcol, 2 + n)})`, total, EXCEL_FORMATS.pct2);
    }
  }
  s.text(0, L.sumRow, "Sum");
  s.text(0, L.rfRow, "Risk-free rate, annual, decimal (input)");
  s.num(1, L.rfRow, a.rf, EXCEL_FORMATS.pct2);
  s.text(2, L.rfRow, `Source: ${RATE_FROM[a.rfSource]}. Change it and every figure moves; the weights do not.`);
  s.text(0, L.amountRow, "Amount invested (input)");
  s.num(1, L.amountRow, L.amount, MONEY);
  s.text(2, L.amountRow, "The starting value of every wealth column on Daily. No figure on Scorecard depends on it.");
  s.text(0, L.acrossHead, "The same weights laid across, for SUMPRODUCT on Daily");
  a.tickers.forEach((t, i) => s.text(1 + i, L.acrossHead, t));
  for (const p of L.ports) {
    const row = L.acrossRow.get(p.k);
    const w = p.col.weights;
    if (row === undefined || !w) continue;
    s.text(0, row, p.col.label);
    a.tickers.forEach((_, i) => s.formula(1 + i, row, at(p.wcol, 3 + i), p.col.id === "ew" ? 1 / n : w[i], EXCEL_FORMATS.pct2));
  }
  s.width(0, 44);
  return s.done();
}

/** One column's daily figures, computed as Daily's formulas compute them, in the same order. */
interface DailyValues {
  ret: Vec;
  wealth: Vec; // index 0 is the amount invested, on the first close
  high: Vec;
  dd: Vec;
  active: Vec;
}

function dailyValues(L: Layout, r: Vec): DailyValues {
  const { a } = L;
  const wealth = [L.amount];
  const high = [L.amount];
  const dd = [(L.amount - L.amount) / L.amount];
  for (let t = 0; t < r.length; t++) {
    const w = wealth[t] * (1 + r[t]);
    const h = Math.max(high[t], w);
    wealth.push(w);
    high.push(h);
    dd.push((w - h) / h);
  }
  return { ret: r, wealth, high, dd, active: r.map((x, t) => x - a.bench[t]) };
}

function dailySheet(L: Layout): { sheet: BookSheet; values: Map<number, DailyValues> } {
  const s = new Sheet(SHEETS.daily);
  const { a, n } = L;
  const values = new Map<number, DailyValues>();
  const benchK = L.model.columns.findIndex((c) => c.id === "bench");
  const benchRet = L.group.get(benchK);
  if (benchRet === undefined) throw new Error("the scorecard has no benchmark column");
  s.text(0, 1, "Date");
  s.date(0, FIRST, a.prices.dates[0]);
  a.dates.forEach((d, t) => s.date(0, FIRST + 1 + t, d));
  for (const [k, g] of L.group) {
    const col = L.model.columns[k];
    const isBench = col.id === "bench";
    const r = isBench ? a.bench : portfolioReturns(a.returns, col.weights as Vec);
    const v = dailyValues(L, r);
    values.set(k, v);
    DAILY_PARTS.forEach((part, j) => s.text(g + j, 1, `${col.label}: ${part}`));
    const [cR, cW, cH, cD, cA] = DAILY_PARTS.map((_, j) => g + j);
    // The first close: the amount invested, its own high, no drawdown, and no return yet.
    s.formula(cW, FIRST, amountRef(L), v.wealth[0], MONEY);
    s.formula(cH, FIRST, at(cW, FIRST), v.high[0], MONEY);
    s.formula(cD, FIRST, `(${at(cW, FIRST)}-${at(cH, FIRST)})/${at(cH, FIRST)}`, v.dd[0], EXCEL_FORMATS.pct2);
    const across = L.acrossRow.get(k);
    for (let t = 0; t < r.length; t++) {
      const row = FIRST + 1 + t;
      const f = isBench
        ? on(SHEETS.returns, at(L.benchCol, row))
        : `SUMPRODUCT(${on(SHEETS.weights, `${abs(1, across as number)}:${abs(n, across as number)}`)},${on(SHEETS.returns, `${at(1, row)}:${at(n, row)}`)})`;
      s.formula(cR, row, f, v.ret[t], DAILY_PCT);
      s.formula(cW, row, `${at(cW, row - 1)}*(1+${at(cR, row)})`, v.wealth[t + 1], MONEY);
      s.formula(cH, row, `MAX(${at(cH, row - 1)},${at(cW, row)})`, v.high[t + 1], MONEY);
      s.formula(cD, row, `(${at(cW, row)}-${at(cH, row)})/${at(cH, row)}`, v.dd[t + 1], EXCEL_FORMATS.pct2);
      s.formula(cA, row, `${at(cR, row)}-${at(benchRet, row)}`, v.active[t], DAILY_PCT);
    }
  }
  s.width(0, 12);
  return { sheet: s.done(), values };
}

// The scorecard's rows: the page's metric (or the Sharpe's standard error), and its formula for one column.
interface RowSpec {
  id: BookRow;
  metric: ScoreMetric;
  label: string;
  /** The formula, given the column's daily ranges and the addresses of the rows above in its own column. */
  f: (x: FormulaRefs) => string;
}

interface FormulaRefs {
  R: string; // its daily returns
  B: string; // the benchmark's
  A: string; // its active returns
  D: string; // its drawdowns, the first close included
  W: string; // its last wealth
  rf: string;
  amount: string;
  cell: (id: BookRow) => string; // the same column's cell on another row
}

const metricOf = (id: string): ScoreMetric => {
  const m = SCORE_METRICS.find((x) => x.id === id);
  if (!m) throw new Error(`the scorecard has no row ${id}`);
  return m;
};

const Y = TRADING_DAYS;
const ROWS: readonly RowSpec[] = (
  [
    ["annual", "annual", (x) => `(${x.W}/${x.amount})^(${Y}/COUNT(${x.R}))-1`],
    ["mean", "mean", (x) => `AVERAGE(${x.R})*${Y}`],
    ["cumulative", "cumulative", (x) => `${x.W}/${x.amount}-1`],
    ["vol", "vol", (x) => `_xlfn.STDEV.S(${x.R})*SQRT(${Y})`],
    ["downside", "downside", (x) => `SQRT(SUMPRODUCT((${x.R}<${x.rf}/${Y})*(${x.R}-${x.rf}/${Y})^2)/COUNT(${x.R}))*SQRT(${Y})`],
    ["mdd", "mdd", (x) => `MIN(${x.D})`],
    ["sharpe", "sharpe", (x) => `(${x.cell("mean")}-${x.rf})/${x.cell("vol")}`],
    [
      "sharpeSE",
      "sharpe",
      (x) => {
        const sr = `(${x.cell("sharpe")}/SQRT(${Y}))`;
        return `SQRT((1+${sr}^2/2-SKEW(${x.R})*${sr}+KURT(${x.R})/4*${sr}^2)/COUNT(${x.R}))*SQRT(${Y})`;
      },
    ],
    ["sortino", "sortino", (x) => `(${x.cell("mean")}-${x.rf})/${x.cell("downside")}`],
    ["calmar", "calmar", (x) => `${x.cell("annual")}/ABS(${x.cell("mdd")})`],
    ["beta", "beta", (x) => `SLOPE(${x.R},${x.B})`],
    ["alpha", "alpha", (x) => `((AVERAGE(${x.R})-${x.rf}/${Y})-${x.cell("beta")}*(AVERAGE(${x.B})-${x.rf}/${Y}))*${Y}`],
    ["corr", "corr", (x) => `CORREL(${x.R},${x.B})`],
    ["r2", "r2", (x) => `${x.cell("corr")}^2`],
    ["te", "te", (x) => `_xlfn.STDEV.S(${x.A})*SQRT(${Y})`],
    ["ir", "ir", (x) => `AVERAGE(${x.A})*${Y}/${x.cell("te")}`],
    ["var", "var", (x) => `-_xlfn.PERCENTILE.INC(${x.R},0.05)`],
    ["es", "es", (x) => `-SUMPRODUCT(--(${x.R}<=-${x.cell("var")}),${x.R})/SUMPRODUCT(--(${x.R}<=-${x.cell("var")}))`],
  ] as [BookRow, string, RowSpec["f"]][]
).map(([id, metric, f]) => {
  const m = metricOf(metric);
  return { id, metric: m, label: id === "sharpeSE" ? SE_LABEL : m.label, f };
});

// The Scorecard sheet's first figure row; row 1 holds the heads and row 2 their sub-lines.
const SCORE_TOP = 3;
const SCORE_COL0 = 3; // A group, B figure, C unit, then one column per scorecard column

/** The page's figure for a row and a scorecard column (the standard error for the SE row). */
function pageFigure(model: ScoreModel, row: RowSpec, k: number): number | null {
  const line = model.lines.find((l) => l.metric.id === row.metric.id);
  if (!line) throw new Error(`the scorecard model has no row ${row.metric.id}`);
  const cell = line.cells[k];
  const v = row.id === "sharpeSE" ? (cell.se ?? null) : cell.value;
  return v !== null && Number.isFinite(v) ? v : null;
}

function scoreSheet(L: Layout, reason: string | null): BookSheet {
  const s = new Sheet(SHEETS.score);
  const { a, model } = L;
  const groupLabel = (id: string) => SCORE_GROUPS.find((g) => g.id === id)?.label ?? id;
  s.text(0, 1, "Group");
  s.text(1, 1, "Figure");
  s.text(2, 1, "Unit");
  const rowOf = new Map(ROWS.map((r, i) => [r.id, SCORE_TOP + i] as const));
  ROWS.forEach((r, i) => {
    s.text(0, SCORE_TOP + i, groupLabel(r.metric.group));
    s.text(1, SCORE_TOP + i, r.label);
    s.text(2, SCORE_TOP + i, r.metric.unit);
  });
  const benchK = model.columns.findIndex((c) => c.id === "bench");
  const daily = (k: number, part: number) => (L.group.get(k) as number) + part;
  const range = (k: number, part: number, from = FIRST + 1) => on(SHEETS.daily, `${abs(daily(k, part), from)}:${abs(daily(k, part), L.last)}`);
  model.columns.forEach((col, k) => {
    const c = SCORE_COL0 + k;
    s.text(c, 1, col.label);
    s.text(c, 2, subLine(col, a, reason));
    if (!L.group.has(k)) return;
    const refs: FormulaRefs = {
      R: range(k, PART.ret),
      B: range(benchK, PART.ret),
      A: range(k, PART.active),
      D: range(k, PART.dd, FIRST),
      W: on(SHEETS.daily, abs(daily(k, PART.wealth), L.last)),
      rf: rfRef(L),
      amount: amountRef(L),
      cell: (id) => at(c, rowOf.get(id) as number),
    };
    ROWS.forEach((r, i) => {
      const v = pageFigure(model, r, k);
      if (v === null) s.text(c, SCORE_TOP + i, NOT_DEFINED);
      else s.formula(c, SCORE_TOP + i, r.f(refs), v, EXCEL_FORMATS[r.metric.format]);
    });
  });
  s.width(0, 22);
  s.width(1, 34);
  s.width(2, 24);
  return s.done();
}

/** The Notes sheet's lines, label and text. Exported so a suite can read what the book says about itself. */
export function bookNotes(a: Analysis, model: ScoreModel, reason: string | null): [string, string][] {
  const left = LEFT_OUT_IDS.map((id) => metricOf(id).label);
  const failed = model.columns.filter((c) => c.id !== "bench" && !c.ok);
  const solved = model.columns.filter((c) => (c.id === "gmv" || c.id === "tangency") && c.ok).map((c) => c.label);
  // The columns added on the page are solved too, each named with its own sub-line. Their labels carry
  // commas, so the list is set off with semicolons.
  const added = model.columns.flatMap((c) => (isAddedId(c.id) && c.ok ? [`${ADDED_LABEL[c.id]} (${addedSub(c.id, a.allowShort)})`] : []));
  const lastYear = model.columns.some((c) => c.id === "tan.1y" && c.ok);
  // The capped tangency and risk parity never short, so with the switch on the Shorting line names them.
  const longOnly = model.columns.filter((c) => c.id === "tan.cap" || c.id === "rp").map((c) => ADDED_LABEL[c.id as "tan.cap" | "rp"]);
  const shorting = a.allowShort
    ? `On: the solved weights may run from -100% to 100%.${longOnly.length ? ` ${longOnly.join(" and ")} ${longOnly.length > 1 ? "are" : "is"} long-only whatever this switch says.` : ""}`
    : "Off: the solved weights run from 0% to 100%.";
  const lines: [string, string][] = [
    ["What this is", "The scorecard on the Optimization tab, rebuilt as formulas over the daily closes so every figure can be traced back to the prices. Each formula cell is saved with the value the page computed, at full precision, so the book shows the page's figures even before Excel recalculates."],
    ["Basket", a.tickers.join(", ")],
    ["Benchmark", `${a.benchLabel} (${a.benchmark})`],
    ["Window", model.span],
    [
      "Prices",
      `Daily closes adjusted for splits and dividends, from Yahoo Finance, ${format(a.prices.dates[0], "date")} to ${format(a.asOf, "date")} (${a.prices.dates.length.toLocaleString("en-US")} closes, ${a.dates.length.toLocaleString("en-US")} daily returns), pulled ${a.pulledAt.slice(0, 10)}. The Prices sheet holds them as the page cleaned them.`,
    ],
    ["Risk-free rate", `${format(a.rf, "pct2")} a year, ${RATE_FROM[a.rfSource]}. It is the input on the Weights sheet.`],
    ["Shorting", shorting],
    [
      "Weights",
      `Equal-Weight is =1/n. ${solved.length ? `${solved.join(" and ")} ${solved.length > 1 ? "are" : "is"} the page's solution on this window (${FITTED}), entered as values: ` : "Solved weights would be the page's solution on this window, entered as values: "}the book does not re-optimise.${added.length ? ` The columns added on the page are solved by it too and entered as values: ${added.join("; ")}.` : ""} Change the risk-free rate and every figure moves; the weights do not. Custom is the mix typed on the Custom tab, also as values.`,
    ],
    [
      "In-sample",
      `Every figure is in-sample: computed on the same window the solved weights were chosen on.${lastYear ? ` ${ADDED_LABEL["tan.1y"]} is chosen on the window's last ${YEAR_ROWS} daily returns and held over all of it, so its figures also read the days before its weights were chosen.` : ""} None of it is a forecast.`,
    ],
    ["Conventions", model.conventions],
    [
      "How each row is computed",
      `${TRADING_DAYS} trading days a year. Returns are simple daily returns, and a portfolio's daily return is its weights times that day's returns, so the weights are held fixed and rebalanced every day. Volatility, tracking error and the Sharpe use sample standard deviations (n - 1). Downside deviation averages the squared shortfall below the daily risk-free rate over every day, zeros included. Beta and alpha regress the daily excess return on the benchmark's; subtracting the same daily rate from both does not move the slope, so the Beta cell reads the raw returns, and the Alpha cell subtracts the rate itself. VaR is the 5th percentile of daily returns, interpolated as PERCENTILE.INC does; expected shortfall is the mean of the days at or below it. The Sharpe's standard error uses SKEW and KURT, the sample skew and excess kurtosis.`,
    ],
    [
      "Left out",
      `Only in the values download (Download Excel, Download CSV): ${left.join("; ")}. The month rows and the capture ratios group days into calendar months, and the longest drawdowns count spells of days; both need logic a worksheet shows badly. The fragility rows re-run the optimiser, which a worksheet does not.`,
    ],
    ["n/a", "Where the page prints a dash, the book writes n/a: the figure is not defined on this window (the benchmark has no tracking error against itself, so it has no information ratio)."],
    ["Sheets", "Prices: the closes. Returns: each day's return, from Prices. Weights: the weights and the two inputs. Daily: each portfolio's daily return, wealth, running high, drawdown and active return. Scorecard: the figures."],
  ];
  if (failed.length) lines.push(["Not shown", failed.map((c) => `${c.label}: ${missingReason(c, a, reason)}`).join(" ")]);
  return lines;
}

function notesSheet(lines: [string, string][]): BookSheet {
  const s = new Sheet(SHEETS.notes);
  lines.forEach(([label, text], i) => {
    s.text(0, 1 + i, label);
    s.text(1, 1 + i, text);
  });
  s.width(0, 26);
  s.width(1, 120);
  return s.done();
}

/**
 * The book for the scorecard on screen, sheet by sheet. Throws, naming the cell, if any formula would be saved
 * without a finite value.
 */
export function scoreBook(input: BookInput): BookSheet[] {
  const { analysis: a, model } = input;
  const reason = input.refused ? CUSTOM_REFUSAL[input.refused] : null;
  const L = layout(a, model, input.amount ?? DEFAULT_AMOUNT);
  if (model.columns.some((c) => c.id !== "bench" && c.weights && c.weights.length !== L.n)) throw new Error("a column's weights do not match the basket");
  const daily = dailySheet(L);
  return [
    notesSheet(bookNotes(a, model, reason)),
    pricesSheet(L),
    returnsSheet(L),
    weightsSheet(L, reason),
    daily.sheet,
    scoreSheet(L, reason),
  ];
}
