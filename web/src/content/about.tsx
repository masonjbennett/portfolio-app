// Who made the page, where its code lives, and how every figure on it is computed.
//
// The byline is the resume's wording: the resume says "Master of Science in Finance" and "M.S. Finance",
// and masonjbennett.com says "M.S. Finance · University of Arkansas". The app printed "M.S. in Finance"
// until Sep 28 2026 and now matches (portfolio_app.py 802, 1108, 1177; t-about holds both).
//
// The methodology is the port's, not the app's "About / Methodology" (763-797), which describes the
// app's SLSQP solver. Every number in it is read from the constant the engine uses, so a change to the
// engine changes the sentence with it.
import type { ReactNode } from "react";
import { MAX_MISSING, MIN_RANGE_DAYS, MIN_ROWS, MIN_TICKERS } from "../lib/clean.ts";
import { TRADING_DAYS } from "../lib/stats.ts";
import { FRONTIER_POINTS, RF_FALLBACK } from "../state/defaults.ts";

export const AUTHOR = "Mason Bennett";
export const CREDENTIAL = "M.S. Finance · University of Arkansas";
export const SITE_URL = "https://masonjbennett.com";
export const SOURCE_URL = "https://github.com/masonjbennett/portfolio-app";

// The masthead's dek: what the page does, in plain words. The app's dek (1097-1153) is the title its
// assignment gave it, "Mean-Variance Optimization & Risk Analysis", which names a method, not a use.
export const DEK =
  "How the tickers you pick have moved, alone and together, and what equal-weight, minimum-variance and " +
  "maximum-Sharpe mixes of them would have earned.";

// Where the tool came from, in one line and no more: the course is not named and nothing is listed.
export const ORIGIN = "Began as a graduate course project and was improved afterwards.";

// The rolling windows, in trading days, and the one each chart opens on. Written out rather than imported
// from the tabs, whose code loads on demand (test/t-split.mjs); test/t-about.mjs holds these to the Risk
// tab's VOL_WINDOWS / DEFAULT_WINDOW and the Correlation tab's WINDOWS / DEFAULT_WINDOW.
export const ROLL_WINDOWS = [30, 60, 90, 120] as const;
export const ROLL_DEFAULT = 60;
// A custom mix with shorting is refused at this net exposure or below (normalizeCustom, src/lib/portfolio.ts).
export const NET_FLOOR = 0.05;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const list = (xs: readonly number[]) => `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

export interface Method {
  term: string;
  text: ReactNode;
}

export const METHODS: readonly Method[] = [
  {
    term: "Prices",
    text: "Daily adjusted closes from Yahoo Finance (adjusted for splits and dividends), for each ticker and the benchmark.",
  },
  {
    term: "Cleaning",
    text:
      `A ticker missing more than ${pct(MAX_MISSING)} of the trading days in the range is dropped (the benchmark never is); ` +
      `the rest are kept only on days when every series has a price. The range must span at least ${MIN_RANGE_DAYS / 365} years, ` +
      `and at least ${MIN_TICKERS} tickers and ${MIN_ROWS} days of prices must remain.`,
  },
  { term: "Returns", text: "Daily simple returns: each day's price over the day before, minus one." },
  {
    term: "Annualisation",
    text: `Mean daily return × ${TRADING_DAYS}; standard deviation × √${TRADING_DAYS}.`,
  },
  {
    term: "Risk-free rate",
    text:
      `The mean 3-month Treasury yield from FRED (series DGS3MO) over the days the prices cover, with the latest yield shown beside it in the settings; or the rate typed there; the example shown before live prices arrive keeps the rate it was saved with; ` +
      `${pct(RF_FALLBACK)} when FRED cannot be reached.`,
  },
  {
    term: "Sharpe ratio",
    text: "(Annual return − risk-free rate) ÷ annual volatility.",
  },
  {
    term: "Sortino ratio",
    text:
      `(Annual return − risk-free rate) ÷ downside deviation: the root-mean-square shortfall of daily returns below the ` +
      `daily risk-free rate, taken over every day (days above it count as zero), × √${TRADING_DAYS}.`,
  },
  {
    term: "Skewness and kurtosis",
    text: "The bias-corrected sample statistics; kurtosis is excess kurtosis, so a normal distribution scores 0.",
  },
  {
    term: "Maximum drawdown",
    text: "The largest fall from a running peak in the value of $1 invested on the first day.",
  },
  {
    term: "Portfolios over time",
    text: "Fixed weights applied to every day's returns: each portfolio is rebalanced daily to its target weights.",
  },
  {
    term: "Portfolio volatility",
    text: <>√(w<sup>T</sup>Σw), from the covariance matrix of daily returns, annualised.</>,
  },
  {
    term: "Optimisation",
    text:
      "The minimum-variance (GMV) and maximum-Sharpe (tangency) portfolios are solved exactly, as quadratic programmes " +
      "(the Goldfarb–Idnani method, via quadprog). Weights sum to 100%; each lies in [0%, 100%], or in [−100%, 100%] with " +
      "short positions allowed. When no portfolio earns more than the risk-free rate, the page says so.",
  },
  {
    term: "Efficient frontier",
    text:
      `The lowest volatility reachable at ${FRONTIER_POINTS} target returns, from the GMV portfolio's return up to the ` +
      "highest return the bounds allow, each an exact quadratic programme. The capital allocation line runs from the " +
      "risk-free rate through the tangency portfolio.",
  },
  {
    term: "Risk contribution",
    text: <>Each asset's share of portfolio variance, w<sub>i</sub>(Σw)<sub>i</sub> ÷ w<sup>T</sup>Σw; the shares sum to 100%.</>,
  },
  {
    term: "CAPM beta and alpha",
    text:
      "An ordinary least-squares regression of the asset's daily excess return on the benchmark's; beta is the slope, " +
      `alpha the intercept × ${TRADING_DAYS}.`,
  },
  {
    term: "Rolling figures",
    text: `Volatility and correlation over trailing windows of ${list(ROLL_WINDOWS)} trading days (${ROLL_DEFAULT} to start).`,
  },
  {
    term: "Estimation windows",
    text:
      `Trailing 1, 2, 3 and 5 years (${TRADING_DAYS} trading days a year) and the full sample, each optimised and scored ` +
      "on its own returns: in-sample, a description of the fit rather than of what the weights went on to earn.",
  },
  {
    term: "Custom weights",
    text:
      "Each weight is held to the bounds, then divided by their total. With short positions allowed, a net exposure of " +
      `${pct(NET_FLOOR)} or less, or a weight that normalising pushes past ±100%, is refused with a message.`,
  },
  { term: "Origin", text: ORIGIN },
];
