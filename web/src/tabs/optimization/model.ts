// The Portfolio Optimization tab's arithmetic (portfolio_app.py 1467-1703), pure: everything the tab
// prints is computed here from an Analysis, so the suite reaches every figure without a DOM. The
// components only lay out what these functions return; the two shared charts (src/charts/Frontier.tsx,
// src/charts/Wealth.tsx) take their data from frontierData and wealthData.
//
// Where the port departs from the app, on purpose:
// - The GMV and tangency weights are exact solves (src/lib/optimize.ts), not SLSQP at its default
//   ftol (932, 943), so a weight no longer carries solver noise in its third significant figure.
// - A failed solve is SAID, in the tiles, the weights and the summary. The app stops the whole script
//   at a failed tab-4 solve (1481-1483, 1492-1494), which also blanks tabs 5 and 6, and its snapshot
//   band shows equal-weight figures under the Tangency labels (1200-1202).
// - Every table holds numbers, so both downloads carry numbers: the app's summary is f-strings
//   (1686-1694), so its CSV and Excel hold text.
// - The risk contribution has a table beside its chart, weights and PRC side by side, with both
//   downloads: the app builds that frame (1563-1566), charts only the PRC columns and offers no download,
//   although its caption (1557-1560) asks the reader to compare weight with PRC.
// - Max DD is measured from the amount invested (the port's drawdowns include the start); the app's
//   path starts at 1 + r1 (904-908), so a loss on the first day is not a drawdown there.
// - Custom weights that cannot be normalised honestly (all zero, a net exposure near zero with
//   shorting, a weight pushed outside the bounds) are refused and named; the app divides by any
//   non-zero total (1582-1586).
import { format, MINUS } from "../../format.ts";
import {
  ADDED_IDS,
  bayesStein,
  CAP,
  CAP_MIN_ASSETS,
  ownWindow,
  solveAdded,
  unavailable,
  YEAR_ROWS,
  type AddedId,
  type AddedSolution,
  type Moments,
  type Unavailable,
} from "../../lib/constructions.ts";
import type { Vec } from "../../lib/num.ts";
import { normalizeCustom, portfolioReturns, riskContribution, summaryRow, windowMoments, windows, type Custom, type Row } from "../../lib/portfolio.ts";
import { maxDrawdown, returnShare, sharpeSE, TRADING_DAYS, wealth } from "../../lib/stats.ts";
import type { Role } from "../../charts/theme.ts";
import type { Analysis, Column, CustomWeights, FormatId, LoadState, TableRow, TipKey } from "../../types.ts";
import { FITTED } from "../caption.ts";

// ---- the three portfolios (1470-1502) --------------------------------------------------------------

/** The portfolios the tab solves, in the app's tile order (1505, 1517, 1524). */
export type PortId = "ew" | "gmv" | "tangency";
export const PORT_IDS: readonly PortId[] = ["ew", "gmv", "tangency"];

/** Short names, as the app's charts and tables use them (1535, 1683). */
export const PORT_LABEL: Readonly<Record<PortId, string>> = { ew: "Equal-Weight", gmv: "GMV", tangency: "Tangency" };

/** The tile headings (1505, 1517, 1524). */
export const TILE_TITLE: Readonly<Record<PortId, string>> = {
  ew: "Equal-Weight Portfolio (1/N)",
  gmv: "Global Min Variance",
  tangency: "Max Sharpe (Tangency)",
};

/** What the page says where a solve failed. The Frontier's caption says the same of its tangency point. */
export const FAILED: Readonly<Record<"gmv" | "tangency", string>> = {
  gmv: "GMV failed: the minimum-variance solve returned no portfolio, so there are no GMV figures.",
  tangency: "Tangency failed: the maximum-Sharpe solve returned no portfolio, so there are no Tangency figures.",
};

/** A failed portfolio's label in a table: the row or column says it failed, never a stand-in figure. */
export const failedLabel = (id: PortId) => `${PORT_LABEL[id]} (failed)`;

/** The weights of one portfolio, or null when its solve failed. */
export function weightsOf(a: Analysis, id: PortId): Vec | null {
  if (id === "ew") return a.ew;
  if (id === "gmv") return a.gmv ? a.gmv.w : null;
  return a.tangency ? a.tangency.w : null;
}

/** One portfolio's five figures (1474-1499): portfolio_performance, then Sortino and Max DD of R @ w. */
export function portRow(a: Analysis, w: Vec, includeStart = true): Row {
  return summaryRow(a.returns, w, a.m, a.S, a.rf, includeStart);
}

/**
 * One standard error of a portfolio's Sharpe ratio, on its own daily returns at the analysis' rate: the
 * figure the band's plate and the scorecard print beside it. Null when it is not a finite number.
 */
export function finiteSE(a: Analysis, w: Vec): number | null {
  const se = sharpeSE(portfolioReturns(a.returns, w), a.rf);
  return Number.isFinite(se) ? se : null;
}

// ---- the added constructions ------------------------------------------------------------------------
// Four more ways to build a portfolio from the same prices, which the reader can add to the scorecard and
// the weights table one at a time. Each is solved by the engine (src/lib/constructions.ts) on its own
// window's moments, once per analysis, and every one is in-sample: its weights are chosen on the prices
// its figures are then computed on, exactly as the tangency column's are.

/** Each added construction's head: the words on its button, the column and the downloads. */
export const ADDED_LABEL: Readonly<Record<AddedId, string>> = {
  "tan.1y": "Tangency, last year",
  "tan.bs": "Tangency, shrunk means",
  "tan.cap": `Tangency, at most ${Math.round(CAP * 100)}% each`,
  rp: "Risk parity",
};

/** The sub-line under the last-year construction's head: its weights saw only the window's last year. */
export const LAST_YEAR = "weights chosen on the last year of this window";

/**
 * The sub-line under an added head. The capped tangency and risk parity hold no short position whatever
 * the switch says, so while shorting is on their sub-line says so.
 */
export function addedSub(id: AddedId, allowShort: boolean): string {
  const base = id === "tan.1y" ? LAST_YEAR : FITTED;
  return allowShort && (id === "tan.cap" || id === "rp") ? `${base}, long only` : base;
}

/**
 * An added construction that found no weights keeps its column, labelled, as a failed GMV does. The label
 * says "no weights", not "failed": for the tangencies the usual cause is the window itself (nothing they may
 * hold earns more than the rate), not the solver, and addedMissing() says which.
 */
export const addedMissingLabel = (id: AddedId) => `${ADDED_LABEL[id]} (no weights)`;

/** One added construction on one analysis: why the basket cannot have it, its own window, its solution. */
export interface AddedFit {
  id: AddedId;
  /** Why this basket and window cannot have it (its button is disabled), or null. */
  reason: Unavailable | null;
  /** The moments it is solved on: the last year's for the last-year tangency, the whole window's otherwise. */
  own: Moments | null;
  /** Its weights and figures, or null: not on offer, or the solve found none. */
  sol: AddedSolution | null;
}

// An analysis never changes once built (a new rate or switch builds a new one), so a construction is
// solved once per analysis, however often its column is toggled or the scorecard recomputed.
const FITS = new WeakMap<Analysis, Map<AddedId, AddedFit>>();
const LOOKBACKS = new WeakMap<Analysis, Map<AddedId, (Vec | null)[]>>();

function cached<T>(store: WeakMap<Analysis, Map<AddedId, T>>, a: Analysis, id: AddedId, make: () => T): T {
  let per = store.get(a);
  if (!per) {
    per = new Map();
    store.set(a, per);
  }
  if (!per.has(id)) per.set(id, make());
  return per.get(id) as T;
}

/** Construction `id` on analysis `a`, solved the engine's way on its own window. */
export function addedFit(a: Analysis, id: AddedId): AddedFit {
  return cached(FITS, a, id, () => {
    const reason = unavailable(id, a.dates.length, a.tickers.length);
    const own = reason ? null : ownWindow(id, a.returns);
    const sol = own ? solveAdded(id, own.m, own.S, own.T, a.rf, a.allowShort) : null;
    return { id, reason, own, sol };
  });
}

/** The constructions solved so far on analysis `a`. A construction is solved only once its column is added. */
export function addedSolvedOn(a: Analysis): AddedId[] {
  return [...(FITS.get(a)?.keys() ?? [])];
}

// The most excess return a mix of weights in [lo, hi] summing to 1 can reach: every weight at lo, then what
// is left of the 1 handed out from the highest excess return down, at most hi - lo to each. A maximum-Sharpe
// mix inside those bounds exists exactly when this is above zero.
function reach(excess: Vec, lo: number, hi: number): number {
  let left = 1 - lo * excess.length;
  let out = lo * excess.reduce((s, x) => s + x, 0);
  for (const x of [...excess].sort((p, q) => q - p)) {
    const add = Math.min(hi - lo, Math.max(left, 0));
    out += add * x;
    left -= add;
  }
  return out;
}

/**
 * Why an added construction on offer found no weights, as a clause with no capital and no full stop, so the
 * page and the formula book can each set it in a sentence of their own. When the bounds it may hold leave no
 * mix above the risk-free rate, the clause says so with the rate; otherwise it says only that the solve found
 * none, which is all the engine reports.
 */
export function addedMissing(a: Analysis, id: AddedId): string {
  const rate = `the ${format(a.rf, "pct2")} risk-free rate`;
  const own = addedFit(a, id).own;
  const where = id === "tan.1y" ? `the window's last ${YEAR_ROWS} daily returns` : "this window";
  const generic = `the solve found no weights on ${where}`;
  if (!own) return generic;
  const daily = a.rf / TRADING_DAYS;
  if (id === "tan.cap") {
    return reach(own.m.map((x) => x - daily), 0, CAP) > 0
      ? generic
      : `no long-only mix holding at most ${Math.round(CAP * 100)}% of each asset earns more than ${rate} on this window`;
  }
  if (id === "rp") return generic;
  // The two tangencies the shorting switch reaches. Long-only they always find a mix (the least negative
  // one), so only a failed solve leaves them empty; with shorting on, the box can leave none above the rate.
  let means = own.m;
  if (id === "tan.bs") {
    const shrink = bayesStein(own.m, own.S, own.T);
    if (!shrink) return `the shrinkage cannot be estimated: the covariance matrix of ${where} has no Cholesky factor`;
    means = shrink.means;
  }
  if (!a.allowShort) return generic;
  const on = id === "tan.bs" ? "the shrunk means" : where;
  return reach(means.map((x) => x - daily), -1, 1) > 0
    ? generic
    : `no mix with every weight between ${MINUS}100% and 100% earns more than ${rate} on ${on}`;
}

/** The page's sentence for an added column with no weights: its head, then addedMissing(). */
export function addedMissingWords(a: Analysis, id: AddedId): string {
  return `${ADDED_LABEL[id]} has no weights: ${addedMissing(a, id)}.`;
}

/**
 * Construction `id` re-solved on each lookback window the Sensitivity tab uses (windows(), each ending on
 * the last day), for the scorecard's lookback row; null where a window's solve found nothing. The
 * last-year tangency IS one of those windows, so it has none ([]), and neither does a window too short to
 * split.
 */
export function addedLookbacks(a: Analysis, id: AddedId): (Vec | null)[] {
  return cached(LOOKBACKS, a, id, () => {
    if (id === "tan.1y" || addedFit(a, id).reason) return [];
    const ws = windows(a.dates.length);
    if (ws.length < 2) return [];
    return ws.map(({ lb }) => {
      const { m, S } = windowMoments(a.returns, lb);
      return solveAdded(id, m, S, lb, a.rf, a.allowShort)?.w ?? null;
    });
  });
}

/** The added constructions the page shows: those chosen that this basket and window can have, in the fixed order. */
export function shownAdded(a: Analysis, chosen: readonly AddedId[]): AddedId[] {
  return ADDED_IDS.filter((id) => chosen.includes(id) && unavailable(id, a.dates.length, a.tickers.length) === null);
}

/** Why a construction cannot be added on this basket and window, in plain words. */
export function unavailableWords(id: AddedId, reason: Unavailable, a: Analysis): string {
  const T = a.dates.length.toLocaleString("en-US");
  const n = a.tickers.length;
  const label = ADDED_LABEL[id];
  switch (reason) {
    case "window-is-one-year":
      return `${label} needs more than a year of prices: this window has ${T} daily returns, and a year is ${YEAR_ROWS}.`;
    case "year-too-thin":
      return `${label} is off: the last year's ${YEAR_ROWS} daily returns are too few to estimate ${n} assets' covariance.`;
    case "too-few-rows":
      return `${label} needs more than ${n + 2} daily returns for ${n} assets; this window has ${T}.`;
    case "too-few-assets":
      return n === CAP_MIN_ASSETS - 1
        ? `${label} needs at least ${CAP_MIN_ASSETS} assets: with ${n}, the cap leaves equal weight as the only mix.`
        : `${label} needs at least ${CAP_MIN_ASSETS} assets: with ${n}, no mix keeps every weight at ${Math.round(CAP * 100)}% or less.`;
  }
}

/** The line under the column buttons: why each construction this basket cannot have is off, or null. */
export function unavailableNote(a: Analysis): string | null {
  const parts = ADDED_IDS.map((id) => {
    const why = unavailable(id, a.dates.length, a.tickers.length);
    return why ? unavailableWords(id, why, a) : null;
  }).filter((x): x is string => x !== null);
  return parts.length ? parts.join(" ") : null;
}

/** The heads in a table that name a solved added construction, each with its sub-line. */
export function addedSubs(a: Analysis, shown: readonly AddedId[]): Record<string, string> {
  return Object.fromEntries(shown.filter((id) => addedFit(a, id).sol).map((id) => [ADDED_LABEL[id], addedSub(id, a.allowShort)]));
}

// ---- the tiles (1504-1530) --------------------------------------------------------------------------

/** One tile's figure: the app's st.metric label, format and tooltip (1507-1511). */
export interface Metric {
  key: "mu" | "sigma" | "sharpe" | "sortino" | "mdd";
  label: string;
  format: FormatId;
  tip: TipKey;
}

export const METRICS: readonly Metric[] = [
  { key: "mu", label: "Return", format: "pct2", tip: "return" },
  { key: "sigma", label: "Volatility", format: "pct2", tip: "volatility" },
  { key: "sharpe", label: "Sharpe", format: "num3", tip: "sharpe" },
  { key: "sortino", label: "Sortino", format: "num3", tip: "sortino" },
  { key: "mdd", label: "Max DD", format: "pct2", tip: "max_dd" },
];

export interface Tile {
  id: PortId;
  title: string;
  /** The figures, or null when the solve failed (the plates then print a dash and "not available"). */
  row: Row | null;
  /** The failure sentence, or null. */
  failed: string | null;
  /** The Sharpe ratio's standard error on this portfolio's own daily returns (finiteSE), or null. */
  se: number | null;
}

export function tiles(a: Analysis): Tile[] {
  return PORT_IDS.map((id) => {
    const w = weightsOf(a, id);
    return {
      id,
      title: TILE_TITLE[id],
      row: w ? portRow(a, w) : null,
      failed: w ? null : FAILED[id as "gmv" | "tangency"],
      se: w ? finiteSE(a, w) : null,
    };
  });
}

// ---- the custom portfolio (1579-1588) ---------------------------------------------------------------

/** The raw custom weights in ticker order, 1/n where none was set (1581), normalised by the shared rule. */
export function customWeights(a: Analysis, weights: CustomWeights): Custom {
  const n = a.tickers.length;
  const raw = a.tickers.map((t) => {
    const v = weights[t];
    return typeof v === "number" && Number.isFinite(v) ? v : 1 / n;
  });
  return normalizeCustom(raw, a.allowShort);
}

/** Why the custom weights are not plotted or scored, in words. */
export const CUSTOM_REFUSAL: Readonly<Record<"zero" | "net-short" | "leverage", string>> = {
  zero: "Custom is not shown: every custom weight is zero. Set at least one on the Custom Portfolio tab.",
  "net-short":
    "Custom is not shown: its weights add up to less than 5% net long, and dividing by a total that small would multiply every weight many times over. Adjust them on the Custom Portfolio tab.",
  leverage:
    "Custom is not shown: normalised to sum to 100%, its weights would put an asset outside the -100% to 100% range the optimiser uses. Adjust them on the Custom Portfolio tab.",
};

/** True when the custom weights are still equal weights, the app's default before tab 5 is touched (1581). */
export function customIsEqual(a: Analysis, c: Custom): boolean {
  return c.ok && c.w.every((x, i) => Math.abs(x - a.ew[i]) < 1e-12);
}

/** The sentence under the summary about the Custom row, or null when there is nothing to say. */
export function customNote(a: Analysis, c: Custom): string | null {
  if (!c.ok) return CUSTOM_REFUSAL[c.reason];
  const parts: string[] = [];
  if (customIsEqual(a, c)) {
    parts.push("Custom holds the weights set on the Custom Portfolio tab. They are still equal weights, so its row repeats Equal-Weight's and its point sits on Equal-Weight's.");
  } else {
    parts.push("Custom holds the weights set on the Custom Portfolio tab, scaled to sum to 100%.");
  }
  if (c.clamped) parts.push("Some were outside the current bounds and were clamped to them first.");
  return parts.join(" ");
}

// ---- tables ------------------------------------------------------------------------------------------

export interface TableData {
  columns: Column[];
  rows: TableRow[];
}

/**
 * The heads in a table that name a solved GMV or Tangency portfolio: its column labels, and its label
 * column's cells. They carry "weights chosen on this window" (../caption.ts). Equal-Weight, Custom, the
 * benchmark and a failed solve do not: nothing was chosen for them.
 */
export function fittedHeads(t: TableData): string[] {
  const first = (t.columns.find((c) => c.first) ?? t.columns[0])?.key;
  const heads = [...t.columns.map((c) => c.label), ...t.rows.map((r) => (first === undefined ? null : r[first]))];
  const named = (h: unknown): h is string =>
    typeof h === "string" && !h.includes("(failed)") && [PORT_LABEL.gmv, PORT_LABEL.tangency].some((p) => h === p || h.startsWith(`${p} `));
  return [...new Set(heads.filter(named))];
}

const finiteRow = (r: TableRow) => Object.values(r).every((v) => typeof v !== "number" || Number.isFinite(v));

// A table's state: every number finite, or the table is refused by name. A dash in a table means
// "no figure" (a failed solve), and a NaN from arithmetic must never pass for one.
function tableState(t: TableData, name: string): LoadState<TableData> {
  const bad = t.rows.find((r) => !finiteRow(r));
  if (bad) return { status: "error", name, message: `A figure in the ${String(bad[t.columns[0].key])} row is not a finite number.` };
  return { status: "ready", value: t };
}

/**
 * The weights table (1535): a row per ticker in the entered order, columns GMV, Tangency, Equal-Weight
 * in the app's order, then each added construction the page shows, in the fixed order. A failed
 * portfolio keeps its column, labelled failed, with no figures; an added one with no weights is labelled so.
 */
export function weightTable(a: Analysis, added: readonly AddedId[] = []): LoadState<TableData> {
  const order: PortId[] = ["gmv", "tangency", "ew"];
  const ws = order.map((id) => weightsOf(a, id));
  const extra = ADDED_IDS.filter((id) => added.includes(id)).map((id) => ({ id, w: addedFit(a, id).sol?.w ?? null }));
  const columns: Column[] = [
    { key: "asset", label: "Asset", format: "text", first: true },
    ...order.map((id, k): Column => ({ key: id, label: ws[k] ? PORT_LABEL[id] : failedLabel(id), format: "pct2" })),
    ...extra.map(({ id, w }): Column => ({ key: id, label: w ? ADDED_LABEL[id] : addedMissingLabel(id), format: "pct2" })),
  ];
  const rows = a.tickers.map((t, i) => {
    const row: TableRow = { asset: t };
    order.forEach((id, k) => (row[id] = ws[k] ? (ws[k] as Vec)[i] : null));
    for (const { id, w } of extra) row[id] = w ? w[i] : null;
    return row;
  });
  return tableState({ columns, rows }, "the weights table");
}

// ---- money, return and risk shares -------------------------------------------------------------------

/** The portfolios the share table and chart cover: the three the tab solves or fixes, and the typed mix. */
export type SharePort = "ew" | "gmv" | "tangency" | "custom";
export const SHARE_PORTS: readonly SharePort[] = ["ew", "gmv", "tangency", "custom"];
export const SHARE_LABEL: Readonly<Record<SharePort, string>> = { ...PORT_LABEL, custom: "Custom" };
// The table's column keys per portfolio; gmv and tan keep the keys the table always had.
const SHARE_KEY: Readonly<Record<SharePort, string>> = { ew: "ew", gmv: "gmv", tangency: "tan", custom: "cu" };

/** One portfolio's three shares per asset: of the money (its weight), of the return, of the risk (PRC). */
export interface Shares {
  w: Vec;
  /** w_i m_i / w'm (the engine's returnShare), or null when w'm is zero and no share is defined. */
  ret: Vec | null;
  risk: Vec;
}

/** The weights behind a share column: a failed solve and a refused mix have none. */
export function shareWeights(a: Analysis, c: Custom | null, id: SharePort): Vec | null {
  if (id === "custom") return c && c.ok ? c.w : null;
  return weightsOf(a, id);
}

export function sharesOf(a: Analysis, w: Vec): Shares {
  const rs = returnShare(w, a.m);
  return { w, ret: rs.degenerate ? null : rs.share, risk: riskContribution(w, a.S) };
}

const shareHead = (id: SharePort, w: Vec | null) => (w ? SHARE_LABEL[id] : id === "custom" ? "Custom (not shown)" : failedLabel(id));

/**
 * The risk contribution table: the frame the app builds (1563-1566), each portfolio's Weight and PRC,
 * which it never shows, and beside them each portfolio's share of the return. risk_contribution
 * (974-979): w_i (S w)_i / w'S w. Return share: w_i m_i / w'm, which falls below 0% for an asset that
 * took from the portfolio's return and passes 100% when the others took from it; it is printed as it is.
 * When the portfolio's own mean return is negative the shares are of a loss and both readings flip
 * (shareNote says which). Equal weight, GMV and Tangency always; Custom when the tab passes its mix.
 */
export function prcTable(a: Analysis, c: Custom | null = null): LoadState<TableData> {
  const ports = SHARE_PORTS.filter((id) => id !== "custom" || c !== null);
  const columns: Column[] = [{ key: "asset", label: "Asset", format: "text", first: true }];
  const per = ports.map((id) => {
    const w = shareWeights(a, c, id);
    const head = shareHead(id, w);
    const k = SHARE_KEY[id];
    columns.push(
      { key: `${k}W`, label: `${head} Weight`, format: "pct2" },
      { key: `${k}Ret`, label: `${head} Return share`, format: "pct2" },
      { key: `${k}Prc`, label: `${head} PRC`, format: "pct2" },
    );
    return { k, sh: w ? sharesOf(a, w) : null };
  });
  const rows = a.tickers.map((ticker, i): TableRow => {
    const row: TableRow = { asset: ticker };
    for (const { k, sh } of per) {
      row[`${k}W`] = sh ? sh.w[i] : null;
      row[`${k}Ret`] = sh && sh.ret ? sh.ret[i] : null;
      row[`${k}Prc`] = sh ? sh.risk[i] : null;
    }
    return row;
  });
  return tableState({ columns, rows }, "the risk contribution table");
}

/**
 * The line under the share table: every return share outside 0% to 100%, named with its portfolio, and
 * what such a share means; and any portfolio whose mean return is zero, for which no share is defined.
 * A share is a holding's part of its portfolio's mean return, so when that mean is a loss the reasons
 * turn round: below 0% is a holding that earned while the portfolio lost, above 100% one that lost more
 * than the whole portfolio. Those are listed apart, with their own reasons.
 * Null when every share is inside the range.
 */
export function shareNote(a: Analysis, c: Custom | null): string | null {
  const out: string[] = [];
  const lost: string[] = [];
  const none: string[] = [];
  for (const id of SHARE_PORTS) {
    const w = shareWeights(a, c, id);
    if (!w) continue;
    const ret = sharesOf(a, w).ret;
    if (!ret) {
      none.push(SHARE_LABEL[id]);
      continue;
    }
    const total = w.reduce((acc, x, i) => acc + x * a.m[i], 0);
    const into = total < 0 ? lost : out;
    a.tickers.forEach((t, i) => {
      if (ret[i] < 0 || ret[i] > 1) into.push(`${t} in ${SHARE_LABEL[id]} (${pct1(ret[i])})`);
    });
  }
  const parts: string[] = [];
  if (out.length) {
    parts.push(
      `Return shares outside 0% to 100% on this window: ${listing(out)}. Below 0% means the holding took from the portfolio's ` +
        `return (a negative mean return held long, or a positive one held short); above 100% means the other holdings together took from it.`,
    );
  }
  if (lost.length) {
    parts.push(
      `Return shares outside 0% to 100% in a portfolio that lost on average over this window, so the shares are of that loss: ` +
        `${listing(lost)}. There below 0% means the holding earned while its portfolio lost, and above 100% means the holding ` +
        `lost more than its whole portfolio did.`,
    );
  }
  if (none.length) parts.push(`${listing(none)} averaged a zero return over this window, so no return share is defined for ${none.length === 1 ? "it" : "them"}.`);
  return parts.length ? parts.join(" ") : null;
}

export const SUMMARY_COLUMNS: Column[] = [
  { key: "portfolio", label: "Portfolio", format: "text", first: true },
  { key: "mu", label: "Ann. Return", format: "pct2" },
  { key: "sigma", label: "Ann. Volatility", format: "pct2" },
  { key: "sharpe", label: "Sharpe", format: "num3" },
  { key: "sortino", label: "Sortino", format: "num3" },
  { key: "mdd", label: "Max DD", format: "pct2" },
];

const EMPTY = { mu: null, sigma: null, sharpe: null, sortino: null, mdd: null };

/**
 * The summary comparison (1678-1695): Equal-Weight, GMV, Tangency, Custom, then the benchmark under its
 * display name, as numbers. A failed solve or a refused Custom keeps its row, labelled, with no figures.
 */
export function summaryTable(a: Analysis, c: Custom): LoadState<TableData> {
  const rows: TableRow[] = PORT_IDS.map((id) => {
    const w = weightsOf(a, id);
    if (!w) return { portfolio: failedLabel(id), ...EMPTY };
    const r = portRow(a, w);
    return { portfolio: PORT_LABEL[id], mu: r.mu, sigma: r.sigma, sharpe: r.sharpe, sortino: r.sortino, mdd: r.mdd };
  });
  if (c.ok) {
    const r = portRow(a, c.w);
    rows.push({ portfolio: "Custom", mu: r.mu, sigma: r.sigma, sharpe: r.sharpe, sortino: r.sortino, mdd: r.mdd });
  } else {
    rows.push({ portfolio: "Custom (not shown)", ...EMPTY });
  }
  const b = a.benchStats;
  rows.push({ portfolio: a.benchLabel, mu: b.mu, sigma: b.sigma, sharpe: b.sharpe, sortino: b.sortino, mdd: maxDrawdown(a.bench) });
  return tableState({ columns: SUMMARY_COLUMNS, rows }, "the summary comparison");
}

// ---- the two bar charts (1534-1572) ----------------------------------------------------------------

/** One group of bars: a ticker, and one value per series (null draws no bar). */
export interface Group {
  name: string;
  values: (number | null)[];
}

/** One series of bars: its name, written on the chart, and its role colour (src/charts/theme.ts ROLE). */
export interface BarSeries {
  label: string;
  role: Role;
}

export interface Bars {
  groups: Group[];
  series: BarSeries[];
}

function barsState(bars: Bars, name: string, none: string): LoadState<Bars> {
  if (!bars.series.length) return { status: "empty", reason: none };
  for (const g of bars.groups) {
    if (g.values.some((v) => v === null || !Number.isFinite(v))) {
      return { status: "error", name, message: `${g.name}'s value is not a finite number.` };
    }
  }
  return { status: "ready", value: bars };
}

/** The weights chart (1534-1541): a group per ticker, bars GMV, Tangency, Equal-Weight; a failed solve has no bars. */
export function weightBars(a: Analysis): LoadState<Bars> {
  const order: PortId[] = ["gmv", "tangency", "ew"];
  const live = order.filter((id) => weightsOf(a, id));
  const series = live.map((id): BarSeries => ({ label: PORT_LABEL[id], role: id }));
  const groups = a.tickers.map((t, i) => ({ name: t, values: live.map((id) => (weightsOf(a, id) as Vec)[i]) }));
  return barsState({ groups, series }, "the weights chart", "No portfolio to draw.");
}

/**
 * The share chart for one portfolio: per asset, its weight, its return share and its risk share, three
 * bars side by side. Empty, and saying why, when that portfolio failed or the mix was refused.
 */
export function shareBars(a: Analysis, c: Custom | null, id: SharePort): LoadState<Bars> {
  const w = shareWeights(a, c, id);
  if (!w) return { status: "empty", reason: id === "custom" ? "Custom is not shown: its weights were refused." : FAILED[id as "gmv" | "tangency"] };
  const sh = sharesOf(a, w);
  const ret = sh.ret;
  const series: BarSeries[] = [{ label: "Weight", role: "cal" }];
  if (ret) series.push({ label: "Return share", role: "frontier" });
  series.push({ label: "Risk share", role: id });
  const groups = a.tickers.map((t, i) => ({ name: t, values: ret ? [sh.w[i], ret[i], sh.risk[i]] : [sh.w[i], sh.risk[i]] }));
  return barsState({ groups, series }, "the share chart", "No portfolio to draw.");
}

/** The share chart's title: the asset carrying most of the picked portfolio's risk, against its weight and return share. */
export function shareTitle(a: Analysis, c: Custom | null, id: SharePort): string {
  const w = shareWeights(a, c, id);
  if (!w) return `${SHARE_LABEL[id]}: money, return and risk shares`;
  const sh = sharesOf(a, w);
  const top = largest(sh.risk, a.tickers);
  const k = a.tickers.indexOf(top.ticker);
  const ret = sh.ret ? `, ${pct1(sh.ret[k])} of its return` : "";
  return `${top.ticker} is ${pct1(sh.w[k])} of ${SHARE_LABEL[id]}'s money${ret} and ${pct1(top.w)} of its risk`;
}

/** The risk contribution chart (1561-1572): GMV PRC and Tangency PRC per ticker. */
export function prcBars(a: Analysis): LoadState<Bars> {
  const live = (["gmv", "tangency"] as const).filter((id) => weightsOf(a, id));
  const prc = live.map((id) => riskContribution(weightsOf(a, id) as Vec, a.S));
  const series = live.map((id): BarSeries => ({ label: `${PORT_LABEL[id]} PRC`, role: id }));
  const groups = a.tickers.map((t, i) => ({ name: t, values: prc.map((p) => p[i]) }));
  return barsState({ groups, series }, "the risk contribution chart", "Neither optimisation solved, so there is no risk contribution to show.");
}

/**
 * Where the series names go and how tall the axis runs: the names are written up one bar each, in the
 * group with the most room above its bars (`host`), and the axis top is raised until `labelPx` of text
 * fits above that group's tallest bar in a plot `plotPx` tall.
 */
export function barLayout(groups: Group[], labelPx: number, plotPx: number): { host: number; lo: number; hi: number } {
  const fin = (vs: (number | null)[]) => vs.filter((v): v is number => v !== null && Number.isFinite(v));
  const all = groups.flatMap((g) => fin(g.values));
  const lo = Math.min(0, ...all);
  const top = Math.max(0, ...all);
  let host = 0;
  let hostTop = Infinity;
  groups.forEach((g, i) => {
    const t = Math.max(0, ...fin(g.values));
    if (t < hostTop) {
      hostTop = t;
      host = i;
    }
  });
  if (!Number.isFinite(hostTop)) hostTop = 0;
  // The label needs (hi - hostTop) / (hi - lo) >= f of the plot:  hi >= (hostTop - f lo) / (1 - f).
  const f = Math.min(0.6, labelPx / plotPx);
  let hi = Math.max(top, (hostTop - f * lo) / (1 - f));
  if (!(hi > lo)) hi = lo + 1;
  return { host, lo, hi };
}

// ---- the sentences ------------------------------------------------------------------------------------

const pct1 = (x: number) => format(x, "pct1");
const pct2 = (x: number) => format(x, "pct2");
// Every Sharpe ratio on the page prints to three places, the app's own `:.3f` (test/t-sharpe.mjs).
const num3 = (x: number) => format(x, "num3");
// A weight under 0.05% prints as 0.0%: the sentences do not count it as a holding.
const HELD = 5e-4;

function listing(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/**
 * "holds 54.2% GLD and 45.8% VTI" when those are all it holds; otherwise "puts its largest weights on
 * VTI (100.0%) and GLD (98.4%)", with a count of the short positions.
 */
export function mixPhrase(w: Vec, tickers: readonly string[]): string {
  const idx = w.map((_, i) => i);
  const longs = idx.filter((i) => w[i] > HELD).sort((x, y) => w[y] - w[x]);
  const shorts = idx.filter((i) => w[i] < -HELD);
  const top = longs.slice(0, 2);
  let s =
    longs.length <= 2 && !shorts.length
      ? `holds ${listing(top.map((i) => `${pct1(w[i])} ${tickers[i]}`))}`
      : `puts its largest ${top.length === 1 ? "weight" : "weights"} on ${listing(top.map((i) => `${tickers[i]} (${pct1(w[i])})`))}`;
  if (shorts.length) s += `, with ${shorts.length} short ${shorts.length === 1 ? "position" : "positions"}`;
  return s;
}

/**
 * The tab's headline: what the maximum-Sharpe solve found, against equal weights. The weights were
 * chosen with the very prices the Sharpe ratio is then computed on, so the sentence says "with
 * hindsight" and "in-sample", and points at the tab that shows how much the answer moves with the window.
 */
export function headline(a: Analysis): string {
  const ew = portRow(a, a.ew);
  const t = a.tangency;
  if (!t) {
    return a.gmv
      ? `The maximum-Sharpe solve failed, so there is no tangency portfolio; the minimum-variance portfolio's volatility is ${pct2(a.gmv.sigma)}.`
      : `Both optimisations failed, so only equal weights are shown, at a Sharpe ratio of ${num3(ew.sharpe)}.`;
  }
  if (!t.beatsRf) {
    // Only the mixes inside the current bounds were searched, so the sentence names them (as the Band does).
    const which = a.allowShort ? `mix of these assets with weights inside [${MINUS}1, 1]` : "long-only mix of these assets";
    return `No ${which} earned more than the ${pct2(a.rf)} risk-free rate, even with hindsight: the highest in-sample Sharpe ratio is ${num3(t.sharpe)}.`;
  }
  return (
    `With hindsight, the maximum-Sharpe portfolio ${mixPhrase(t.w, a.tickers)}, for an in-sample Sharpe of ${num3(t.sharpe)} ` +
    `against ${num3(ew.sharpe)} for equal weights; ${SENSITIVITY_POINTER}.`
  );
}

/** The frontier's title: where the two optimised portfolios sit on it. */
export function frontierTitle(a: Analysis): string {
  const parts: string[] = [];
  if (a.tangency) parts.push(`Tangency has the highest Sharpe ratio on the frontier, at ${pct2(a.tangency.sigma)} volatility`);
  if (a.gmv) parts.push(`${a.tangency ? "GMV" : "GMV has"} the lowest volatility, ${pct2(a.gmv.sigma)}`);
  return parts.length ? parts.join("; ") : "Efficient Frontier";
}

function largest(w: Vec, tickers: readonly string[]): { ticker: string; w: number } {
  let k = 0;
  w.forEach((x, i) => {
    if (x > w[k]) k = i;
  });
  return { ticker: tickers[k], w: w[k] };
}

/** The weights chart's title: each optimised portfolio's largest weight. */
export function weightsTitle(a: Analysis): string {
  const parts: string[] = [];
  if (a.gmv) {
    const g = largest(a.gmv.w, a.tickers);
    parts.push(`GMV's largest weight is ${g.ticker}, ${pct1(g.w)}`);
  }
  if (a.tangency) {
    const t = largest(a.tangency.w, a.tickers);
    parts.push(a.gmv ? `Tangency's is ${t.ticker}, ${pct1(t.w)}` : `Tangency's largest weight is ${t.ticker}, ${pct1(t.w)}`);
  }
  return parts.length ? parts.join("; ") : `Equal weights: ${pct1(a.ew[0])} in each asset`;
}

/** The risk contribution chart's title: the asset carrying most of each portfolio's variance. */
export function prcTitle(a: Analysis): string {
  const parts: string[] = [];
  if (a.gmv) {
    const g = largest(riskContribution(a.gmv.w, a.S), a.tickers);
    parts.push(`${g.ticker} carries ${pct1(g.w)} of GMV's risk`);
  }
  if (a.tangency) {
    const t = largest(riskContribution(a.tangency.w, a.S), a.tickers);
    parts.push(`${t.ticker} carries ${pct1(t.w)} of Tangency's`);
  }
  return parts.length ? parts.join("; ") : "Risk Contribution (PRC)";
}

/** Where each line of the wealth chart ends, in wealthData's order: Equal-Weight, GMV, Tangency, Custom, the benchmark. */
export function wealthEnds(a: Analysis, custom: Vec | null, amount: number): { label: string; end: number; bench: boolean }[] {
  const out: { label: string; end: number; bench: boolean }[] = [];
  const add = (label: string, r: Vec, bench = false) => out.push({ label, end: wealth(r, amount).at(-1) as number, bench });
  add("Equal-Weight", portfolioReturns(a.returns, a.ew));
  if (a.gmv) add("GMV", portfolioReturns(a.returns, a.gmv.w));
  if (a.tangency) add("Tangency", portfolioReturns(a.returns, a.tangency.w));
  if (custom) add("Custom", portfolioReturns(a.returns, custom));
  add(a.benchLabel, a.bench, true);
  return out;
}

/** Where the headline sends the reader to see how much the in-sample answer depends on the window. */
export const SENSITIVITY_POINTER = "the Sensitivity tab shows how much that depends on the window";

/** The lines whose weights an optimiser chose with this chart's own prices. */
const HINDSIGHT: ReadonlySet<string> = new Set([PORT_LABEL.gmv, PORT_LABEL.tangency]);

/**
 * The wealth chart's title: which line ended highest, and where the benchmark ended. A GMV or Tangency
 * line that ends highest does so with weights chosen from the same prices, and the title says so.
 */
export function wealthTitle(a: Analysis, custom: Vec | null, amount: number): string {
  const fallback = "Portfolio Comparison: Cumulative Wealth";
  if (!(Number.isFinite(amount) && amount > 0)) return fallback;
  const ends = wealthEnds(a, custom, amount);
  if (!ends.every((e) => Number.isFinite(e.end))) return fallback;
  let best = ends[0];
  for (const e of ends) if (e.end > best.end) best = e;
  const bench = ends[ends.length - 1];
  const hindsight = !best.bench && HINDSIGHT.has(best.label) ? " with hindsight weights" : "";
  const lead = `${best.bench ? `The ${best.label}` : best.label} ended highest, at ${format(best.end, "usd0")} from ${format(amount, "usd0")}${hindsight}`;
  return best.bench ? lead : `${lead}; the ${bench.label} ended at ${format(bench.end, "usd0")}`;
}
