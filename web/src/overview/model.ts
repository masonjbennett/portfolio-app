// The Overview's words and figures, computed from one analysis: the answer under the page's question, the
// hindsight card's bars, the three-fact strip, and the figures the old front-page band printed (its finding
// sentence, its four Sharpe plates and its published figures line), which now sit in the hindsight card's
// "Show the numbers" fold. Pure functions, so test/t-app.mjs holds every sentence without a page.
//
// Two kinds of figure meet here and are never mixed up. LIVE figures are this basket's, fitted and scored on
// the prices loaded (with hindsight, in-sample). PUBLISHED figures are the strings in src/content/published.ts,
// printed exactly as written and never recomputed; a published figure is quoted for a basket only when the
// basket IS that published set (publishedSetOf), and on any other basket only under the five mega-caps' name.
//
// The plain names lead and the finance names sit beside them where a card has room: the best-tradeoff mix is
// the tangency (maximum-Sharpe) portfolio, the lowest-risk mix the minimum-variance (GMV) one, the equal
// split equal weight (1/N). "Best-tradeoff" is one name, never "best" on its own: the published test is the
// page's evidence that the mix is not the best one to hold.
import { MEGA_CAP_APPLE, MEGA_CAP_IN_SAMPLE, MEGA_CAP_IN_SAMPLE_END, MEGA_CAP_IN_SAMPLE_RF, PUBLISHED_HOLDS, PUBLISHED_SETS, PUBLISHED_WHEN, type PublishedSet } from "../content/published.ts";
import type { ScoreTipKey } from "../content/tooltips.ts";
import { format, MINUS } from "../format.ts";
import { monthYear } from "../chrome/when.ts";
import type { Vec } from "../lib/num.ts";
import { portfolioReturns, summaryRow } from "../lib/portfolio.ts";
import { sharpeSE, wealth } from "../lib/stats.ts";
import type { Analysis, FormatId, TipKey } from "../types.ts";

/** The page's question: the Overview's one serif headline. */
export const QUESTION = "Can a smarter mix beat an equal split?";

/** The three mixes by their plain names, each with the finance name printed beside it where there is room. */
export const MIX = {
  tangency: { name: "Best-tradeoff mix", short: "Best-tradeoff", technical: "tangency, maximum Sharpe" },
  ew: { name: "Equal split", short: "Equal split", technical: "equal weight, 1/N" },
  gmv: { name: "Lowest-risk mix", short: "Lowest-risk", technical: "minimum variance, GMV" },
} as const;

export type MixKey = keyof typeof MIX;

// ---- the old band's figures, kept ------------------------------------------------------------------------

export interface SnapshotPlate {
  label: string;
  value: number | null;
  format: FormatId;
  tip: TipKey | ScoreTipKey;
  /** One standard error of the figure, printed beside it; only the tangency Sharpe carries one. */
  se?: number | null;
}

// A ratio of zero volatility is NaN; a plate prints it as unavailable, not as "NaN".
function fin(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

// A portfolio's figures on this window at this rate: summaryRow, with the arguments the Optimization tab's
// portRow passes it, so the Overview and that tab's tables can never print two figures for one portfolio.
function rowOf(a: Analysis, w: Vec) {
  return summaryRow(a.returns, w, a.m, a.S, a.rf);
}

/** Equal weight's Sharpe ratio on this window, as the Optimization tab's tables print it; null when not a number. */
export function ewSharpe(a: Analysis): number | null {
  return fin(rowOf(a, a.ew).sharpe);
}

/** The lowest-risk mix's Sharpe ratio on this window; null when it was not solved or is not a number. */
export function gmvSharpe(a: Analysis): number | null {
  return a.gmv ? fin(rowOf(a, a.gmv.w).sharpe) : null;
}

// Four Sharpe ratios, each in num3 as the app prints a Sharpe ({:.3f}): equal weight, which nothing was
// fitted to choose; the tangency and the minimum-variance mix, whose weights were chosen on these prices, so
// their labels say in-sample; and the benchmark, on its own daily returns. A failed solve prints the dash.
// The tangency plate keeps the app's tooltip and its standard error (the engine's sharpeSE on the tangency's
// own daily returns; it treats the weights as fixed, and they were picked on the same prices, so the true
// uncertainty is wider still, as the tooltip says); the other three carry the port's own.
export function snapshotPlates(a: Analysis): SnapshotPlate[] {
  const t = a.tangency;
  return [
    { label: "Equal-Weight Sharpe", value: ewSharpe(a), format: "num3", tip: "ew_sharpe" },
    {
      label: "Tangency Sharpe (in-sample)",
      value: t ? fin(t.sharpe) : null,
      format: "num3",
      tip: "best_sharpe",
      se: t ? fin(sharpeSE(portfolioReturns(a.returns, t.w), a.rf)) : null,
    },
    { label: "GMV Sharpe (in-sample)", value: gmvSharpe(a), format: "num3", tip: "gmv_sharpe" },
    { label: `${a.benchLabel} Sharpe`, value: fin(a.benchStats.sharpe), format: "num3", tip: "bench_sharpe" },
  ];
}

/** The tickers by name, in the page's order, when there are at most this many; above it, "these N assets". */
export const NAMED_MAX = 6;

// "VTI, AGG, GLD, VNQ and EFA" for a short basket, "these 10 assets" for a long one.
export function assetsOf(tickers: readonly string[]): string {
  const n = tickers.length;
  if (n > NAMED_MAX) return `these ${n} assets`;
  return n > 1 ? `${tickers.slice(0, -1).join(", ")} and ${tickers[n - 1]}` : tickers.join("");
}

// The finding in the finance names, over the span the prices actually cover: the tangency's Sharpe against
// equal weight's, marked in-sample and recomputed on the prices loaded on every basket (on a published one
// because it is not the published in-sample figure and must not be read as one, and on any other because the
// mark should not come and go). It opens the hindsight card's numbers, beside the four plates it summarises.
function recomputed(a: Analysis): string {
  return ` (in-sample, recomputed on prices through ${format(a.asOf, "date")})`;
}

export function finding(a: Analysis): string {
  const span = `From ${monthYear(a.prices.dates[0])} to ${monthYear(a.asOf)}`;
  const over = `from ${monthYear(a.prices.dates[0])} to ${monthYear(a.asOf)}`;
  const assets = assetsOf(a.tickers);
  const ew = rowOf(a, a.ew);
  const t = a.tangency;
  if (!t) {
    return (
      `The tangency optimisation failed for ${assets}${a.allowShort ? " with short positions allowed" : ""}, ` +
      `so no tangency figures are shown. ${span}, equal weight returned ${format(fin(ew.mu), "pct2")} a year ` +
      `at ${format(fin(ew.sigma), "pct2")} volatility.`
    );
  }
  if (!t.beatsRf) {
    return (
      `On ${assets}${a.allowShort ? "" : ", held long only"}, with hindsight, no mix earned more than the ` +
      `${format(a.rf, "pct2")} risk-free rate ${over}; the highest Sharpe ratio reachable was ${format(fin(t.sharpe), "num3")}${recomputed(a)}, ` +
      `against ${format(fin(ew.sharpe), "num3")} for equal weight.`
    );
  }
  return (
    `On ${assets}, with hindsight, the highest-Sharpe mix ${over} earned ` +
    `${format(fin(t.sharpe), "num3")} of annual excess return per unit of volatility${recomputed(a)}; equal weight earned ` +
    `${format(fin(ew.sharpe), "num3")}.`
  );
}

// ---- the published sets ------------------------------------------------------------------------------

/**
 * The published set these tickers are, or null: the same symbols as one of the three sets, in any order and
 * any case, none missing and none added. A preset that only overlaps a set (seven mega-caps, a longer list of
 * sector funds) is not that set, and neither is a set with one ticker dropped in cleaning.
 */
export function publishedSetOf(tickers: readonly string[] | null | undefined): PublishedSet | null {
  if (!tickers?.length) return null;
  const have = new Set(tickers.map((x) => x.trim().toUpperCase()));
  if (have.size !== tickers.length) return null;
  return PUBLISHED_SETS.find((s) => s.tickers.length === have.size && s.tickers.every((x) => have.has(x.toUpperCase()))) ?? null;
}

// A published figure as a number: the site writes the negative with the minus sign (U+2212).
export const figureOf = (s: string): number => Number(s.replace(MINUS, "-"));

/**
 * How the set's two fitted constructions stood against equal weight out of sample, in words read off the
 * published figures themselves, so the words cannot disagree with the numbers beside them.
 */
export function standing(set: PublishedSet): string {
  const ew = figureOf(set.ew);
  const rel = (s: string) => {
    const x = figureOf(s);
    return x > ew ? "above" : x < ew ? "below" : "level with";
  };
  const g = rel(set.gmv);
  const t = rel(set.tangency);
  if (g === t) return g === "below" ? "equal weight above GMV and tangency" : `GMV and tangency ${g} equal weight`;
  return `tangency ${t} equal weight, GMV ${g} it`;
}

// A set's name inside a sentence: its first letter lower-cased ("five mega-caps", "seven sector ETFs").
export function nameInSentence(set: PublishedSet): string {
  return set.name.charAt(0).toLowerCase() + set.name.slice(1);
}

// Whose figures the site's sentence quotes: its 1.107 and 0.659 are the five mega-caps'.
export function whoseFigures(): string {
  const mega = PUBLISHED_SETS[0];
  return `The sentence's ${MEGA_CAP_IN_SAMPLE} and ${mega.tangency} are the ${nameInSentence(mega)}'.`;
}

// The figures line, under the site's sentence in the hindsight card's numbers. On one of the published sets
// it says this basket is that set, then quotes the set's three out-of-sample ratios and how they stood, and on
// the other two sets says whose figures the sentence quotes. On any other basket it names and quotes the five
// mega-caps. 1.107 always carries its terms on the mega-caps, since the live figure beside it differs.
export function figuresLine(set: PublishedSet | null): string {
  const s = set ?? PUBLISHED_SETS[0];
  const mega = s === PUBLISHED_SETS[0];
  const terms = set ? `, to ${monthYear(MEGA_CAP_IN_SAMPLE_END)} at ${format(MEGA_CAP_IN_SAMPLE_RF, "pct1")}` : "";
  const inSample = mega ? ` (${MEGA_CAP_IN_SAMPLE} in-sample${terms})` : "";
  const three = `equal weight ${s.ew} · GMV ${s.gmv} · tangency ${s.tangency}${inSample}`;
  if (!set) return `${s.name} (${s.tickers.join(", ")}), Sharpe out of sample: ${three}.`;
  const line = `This basket is the published ${nameInSentence(s)} set. Sharpe out of sample: ${three}; ${standing(s)}.`;
  return mega ? line : `${line} ${whoseFigures()}`;
}

// ---- the answer ----------------------------------------------------------------------------------------

/** What the starting amount became in each mix and the benchmark, on the window on screen; null where unsolved. */
export interface Ends {
  ew: number;
  gmv: number | null;
  tangency: number | null;
  bench: number;
}

const endOf = (r: readonly number[], amount: number) => {
  const w = wealth(r as number[], amount);
  return w[w.length - 1];
};

export function endsOf(a: Analysis, amount: number): Ends {
  return {
    ew: endOf(portfolioReturns(a.returns, a.ew), amount),
    gmv: a.gmv ? endOf(portfolioReturns(a.returns, a.gmv.w), amount) : null,
    tangency: a.tangency ? endOf(portfolioReturns(a.returns, a.tangency.w), amount) : null,
    bench: endOf(a.bench, amount),
  };
}

/** One row of the growth chart's numbers: a mix (or the benchmark), what the amount became, and its figures. */
export interface MixRow {
  name: string;
  technical: string | null;
  end: number | null;
  mu: number | null;
  sigma: number | null;
  sharpe: number | null;
}

/**
 * The growth chart's numbers, in the chart's order of interest: the three mixes, then the benchmark. Each
 * portfolio's return, volatility and Sharpe are summaryRow's, the Optimization tab's own figures; the
 * benchmark's are its own statistics. An unsolved mix is left out, never replaced.
 */
export function mixRows(a: Analysis, amount: number): MixRow[] {
  const e = endsOf(a, amount);
  const row = (name: string, technical: string, w: Vec, end: number | null): MixRow => {
    const s = rowOf(a, w);
    return { name, technical, end: end === null ? null : fin(end), mu: fin(s.mu), sigma: fin(s.sigma), sharpe: fin(s.sharpe) };
  };
  const out: MixRow[] = [];
  if (a.tangency) out.push(row(MIX.tangency.name, MIX.tangency.technical, a.tangency.w, e.tangency));
  out.push(row(MIX.ew.name, MIX.ew.technical, a.ew, e.ew));
  if (a.gmv) out.push(row(MIX.gmv.name, MIX.gmv.technical, a.gmv.w, e.gmv));
  const b = a.benchStats;
  out.push({ name: a.benchLabel, technical: null, end: fin(e.bench), mu: fin(b.mu), sigma: fin(b.sigma), sharpe: fin(b.sharpe) });
  return out;
}

/**
 * The answer under the question, in two sentences. `hindsight` is this basket's, live: what the starting
 * amount became in the best-tradeoff mix against the equal split. `without` is Mason's published test: on a
 * published set, that set's own two published figures and one other set's for contrast; on any other basket,
 * the published finding in words with no figure, and `run` asks the page to offer the same test on this basket.
 * Each sentence starts with the glossary words it opens on ("With hindsight", "Without hindsight").
 */
export interface Lede {
  hindsight: string;
  without: string;
  /** The basket is not a published set: offer the live walk-forward on it. */
  run: boolean;
  set: PublishedSet | null;
}

const VERB = (x: number, y: number) => (x > y ? "won" : x < y ? "lost" : "tied");

export function lede(a: Analysis, amount: number): Lede {
  const e = endsOf(a, amount);
  const usd = (x: number) => format(fin(x), "usd0");
  const t = a.tangency;
  let hindsight: string;
  if (!t || e.tangency === null) {
    hindsight = `The best-tradeoff mix could not be solved for this basket; an equal split turned ${usd(amount)} into ${usd(e.ew)}.`;
  } else if (!t.beatsRf) {
    hindsight = `With hindsight, no: no mix of these beat the ${format(a.rf, "pct2")} risk-free rate, and an equal split turned ${usd(amount)} into ${usd(e.ew)}.`;
  } else {
    const how = e.tangency > e.ew ? "yes" : "only per unit of risk";
    hindsight = `With hindsight, ${how}: the best-tradeoff mix turned ${usd(amount)} into ${usd(e.tangency)}, against ${usd(e.ew)} for an equal split.`;
  }
  const set = publishedSetOf(a.tickers);
  if (!set) {
    return {
      hindsight,
      without:
        "Without hindsight, in Mason's published test, an equal split beat both optimized mixes on similar assets; " +
        "optimizing only added value across genuinely different asset classes.",
      run: true,
      set: null,
    };
  }
  // The contrast: the five mega-caps, whose figures the site's sentence quotes; on the mega-caps themselves,
  // the seven sector ETFs, the other basket of similar assets.
  const other = set === PUBLISHED_SETS[0] ? PUBLISHED_SETS[1] : PUBLISHED_SETS[0];
  const here = VERB(figureOf(set.tangency), figureOf(set.ew));
  const there = VERB(figureOf(other.tangency), figureOf(other.ew));
  const it = t ? "it" : "the best-tradeoff mix";
  const second = here === there ? `and on ${nameInSentence(other)}` : `but ${there} on ${nameInSentence(other)}`;
  const because = here === "lost" || there === "lost" ? ", because it is fitted to the past" : "";
  return {
    hindsight,
    without:
      `Without hindsight, in Mason's published test, ${it} ${here} on this basket (Sharpe ${set.tangency} against ${set.ew}) ` +
      `${second} (${other.tangency} against ${other.ew})${because}.`,
    run: false,
    set,
  };
}

/** The lede as one string: its two sentences. */
export const ledeText = (l: Lede): string => `${l.hindsight} ${l.without}`;

// ---- the hindsight card ----------------------------------------------------------------------------------

/** One bar: a Sharpe ratio, hollow when chosen with hindsight, solid when published without it. */
export interface Bar {
  mix: MixKey;
  hindsight: boolean;
  value: number;
  /** The figure as printed beside the bar: num3 for a live one, the published string for a published one. */
  text: string;
}

export interface BarGroup {
  label: string;
  /** What the group holds: one mix both ways, one basket's live mixes, or one basket both ways. */
  by: "mix" | "hindsight" | "basket";
  bars: Bar[];
}

export interface Hindsight {
  title: string;
  sub: string;
  groups: BarGroup[];
  set: PublishedSet | null;
}

const live = (mix: MixKey, v: number | null): Bar[] => (v === null ? [] : [{ mix, hindsight: true, value: v, text: format(v, "num3") }]);
const pub = (mix: MixKey, s: string): Bar => ({ mix, hindsight: false, value: figureOf(s), text: s });

/**
 * The hindsight card. On a published set: both bars are the test's own, each mix's whole-window fit (in-sample,
 * with hindsight) beside its published Sharpe on the holds, so this card and Does it hold up?'s chart print one
 * pair per mix; the live window's figures are the lede's and the first chart's. Until Oct 14 2026 the hollow bar
 * was the live window's Sharpe, which set 1.000 here against the chart's 1.105 for the same basket. On any other
 * basket nothing published exists for it, so its three live bars stand alone and the five mega-caps follow under
 * their own name, their published 1.107 with hindsight beside 0.659 without, and the equal split's 0.864: a
 * reference, labelled as one.
 */
export function hindsight(a: Analysis): Hindsight {
  const set = publishedSetOf(a.tickers);
  const tan = a.tangency ? fin(a.tangency.sharpe) : null;
  const ew = ewSharpe(a);
  const gmv = gmvSharpe(a);
  const key = "Hollow: chosen with hindsight on this window. Solid: Mason's published test";
  if (set) {
    const fitted = (mix: MixKey, s: string): Bar => ({ mix, hindsight: true, value: figureOf(s), text: s });
    const flatters = figureOf(set.inSample.tangency) > figureOf(set.tangency);
    return {
      title: flatters ? "Hindsight flatters the optimizer" : "Here the optimizer held up without hindsight",
      sub: `Sharpe ratio, higher is better. Mason's published test: hollow, fitted with hindsight on its whole window; solid, ${PUBLISHED_HOLDS} one-year holds it had not seen.`,
      groups: [
        { label: MIX.tangency.name, by: "mix", bars: [fitted("tangency", set.inSample.tangency), pub("tangency", set.tangency)] },
        { label: MIX.ew.name, by: "mix", bars: [fitted("ew", set.inSample.ew), pub("ew", set.ew)] },
        { label: MIX.gmv.name, by: "mix", bars: [fitted("gmv", set.inSample.gmv), pub("gmv", set.gmv)] },
      ],
      set,
    };
  }
  const mega = PUBLISHED_SETS[0];
  return {
    title: "Hindsight flatters the optimizer",
    sub: `Sharpe ratio, higher is better. ${key} on ${nameInSentence(mega)}: this basket has not been published.`,
    groups: [
      { label: "This basket, with hindsight", by: "hindsight", bars: [...live("tangency", tan), ...live("ew", ew), ...live("gmv", gmv)] },
      {
        label: `${mega.name}, published`,
        by: "basket",
        bars: [{ mix: "tangency", hindsight: true, value: figureOf(MEGA_CAP_IN_SAMPLE), text: MEGA_CAP_IN_SAMPLE }, pub("tangency", mega.tangency), pub("ew", mega.ew)],
      },
    ],
    set: null,
  };
}

// ---- the three facts -------------------------------------------------------------------------------------

export interface Fact {
  /** The figure, large. */
  big: string;
  /** One line saying what it is. */
  text: string;
}

// The largest weight in the best-tradeoff mix, with its ticker; null when it was not solved.
function topHolding(a: Analysis): { ticker: string; w: number } | null {
  if (!a.tangency) return null;
  let k = 0;
  a.tangency.w.forEach((w, i) => {
    if (w > a.tangency!.w[k]) k = i;
  });
  const w = a.tangency.w[k];
  return Number.isFinite(w) ? { ticker: a.tickers[k], w } : null;
}

/**
 * Why the answer comes out as it does, in three facts. The first is live (this basket's best-tradeoff mix,
 * its largest holding); the other two are published (the five mega-caps' Apple weight across the Sensitivity
 * tab's five lookbacks, lowest to highest, and the test's holds with its finding in words). A basket whose
 * best-tradeoff mix was not solved shows the two published facts only.
 */
export function whyFacts(a: Analysis): Fact[] {
  const out: Fact[] = [];
  const top = topHolding(a);
  if (top) {
    out.push({
      big: `${format(top.w, "pct1")} ${top.ticker}`,
      text: "of the best-tradeoff mix, chosen with hindsight: its weights follow whatever did well in these years.",
    });
  }
  const apple = [...MEGA_CAP_APPLE].sort((x, y) => figureOf(x.replace("%", "")) - figureOf(y.replace("%", "")));
  out.push({
    big: `${apple[0]} to ${apple[apple.length - 1]}`,
    // Dated: these are the method note's frozen figures, and the live lookback rows on the mega-caps differ.
    text: `Apple's best-tradeoff weight on five mega-caps in Mason's published test (${PUBLISHED_WHEN}), depending only on how many years it looked back over.`,
  });
  out.push({
    big: `${PUBLISHED_HOLDS} one-year tests`,
    text: "Without hindsight, the equal split beat both optimized mixes on similar assets.",
  });
  return out;
}

