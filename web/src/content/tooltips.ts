// The app's tiered tooltips (TOOLTIPS, 525-581; tip(), 584-587) by key and level. The text is never
// retyped: tooltips.json is GENERATED from portfolio_app.py by test/oracle/dump_tooltips.py, and
// test/t-tooltips.mjs fails the run when the committed file and a fresh dump disagree.
//
// One deliberate difference, kept as a checked table rather than an edit to the json: the app's
// tip() ignores the shorting toggle (586 reads only the level), so with shorting on its Advanced
// texts still promise long-only weights (554 "wᵢ≥0", 559 "long-only constraints") while the solver
// runs with [-1, 1] bounds (781). Here the text follows the toggle.
//
// A second, kept the same way: at the default level the app calls the tangency mix "the best possible"
// score reached by mixing "optimally" (554) and "the best risk-adjusted portfolio mix" (558). The
// plates those tips sit on say in-sample, and the tips should too: the mix scored highest on the very
// prices its weights were picked from, which describes the past and promises nothing.
//
// A third: the band's tangency Sharpe plate prints a standard error beside the figure, which the app's
// plate never had, so that tip gains one closing line (NOTES, below) saying what the ± measures and
// what it leaves out. The app's text before it is unchanged.
import type { Level, TipKey } from "../types.ts";
import TIPS from "./tooltips.json" with { type: "json" };

type Texts = Record<Level, string>;

// The app's text, exactly as dumped. Keyed loosely so an unknown key reads as missing, as in 586.
export const ORACLE_TIPS: Readonly<Record<string, Texts>> = TIPS;

export interface ShortOverride {
  // The app's text this override was checked against; t-tooltips fails when the app's changes.
  was: string;
  // What the port shows instead while shorting is on.
  short: string;
}

// Every text that is false with shorting on, and its replacement. With shorting off the app's text
// is right and is shown unchanged. The bounds are optimize.ts's: [-1, 1] per asset, summing to 1.
export const SHORT_OVERRIDES: Readonly<Partial<Record<TipKey, Partial<Record<Level, ShortOverride>>>>> = {
  best_sharpe: {
    formula: {
      was: "Sharpe of the tangency portfolio: max_w (w′μ − Rf) / √(w′Σw), s.t. Σwᵢ=1, wᵢ≥0. Slope of the CAL.",
      short: "Sharpe of the tangency portfolio: max_w (w′μ − Rf) / √(w′Σw), s.t. Σwᵢ=1, with each weight bounded to [-1, 1] per asset (shorting on). Slope of the CAL.",
    },
  },
  tangency_return: {
    formula: {
      was: "μ_tan = w_tan′ μ × 252, where w_tan = argmax Sharpe subject to full-investment and long-only constraints.",
      short: "μ_tan = w_tan′ μ × 252, where w_tan = argmax Sharpe subject to full investment, with each weight bounded to [-1, 1] per asset (shorting on).",
    },
  },
};

export interface WordOverride {
  // The app's text this override was checked against; t-tooltips fails when the app's changes.
  was: string;
  // What the port shows instead, whatever the shorting toggle says.
  now: string;
}

// Every app text that calls a mix best or optimal, and its replacement.
export const WORD_OVERRIDES: Readonly<Partial<Record<TipKey, Partial<Record<Level, WordOverride>>>>> = {
  best_sharpe: {
    plain: {
      was: "The best possible risk-vs-reward score achievable by mixing these stocks optimally.",
      now: "The highest risk-vs-reward score any mix of these assets reached over this window, with the weights picked from the same prices it is scored on: an in-sample figure, not a forecast.",
    },
  },
  tangency_return: {
    plain: {
      was: "The expected yearly return of the best risk-adjusted portfolio mix.",
      now: "The average yearly return of the mix with the highest risk-vs-reward score over this window, its weights picked from the same prices: in-sample, not a forecast.",
    },
  },
};

// Lines added after a tip's text, whatever the shorting toggle says. The ± on the tangency Sharpe plate is
// sharpeSE in lib/stats.ts, and it treats the weights as if they had been fixed before the window began.
// They were not: they were solved on the same prices, so each level says the true spread is wider.
export const NOTES: Readonly<Partial<Record<TipKey, Partial<Record<Level, string>>>>> = {
  best_sharpe: {
    plain:
      "The ± beside it is one standard error, how far the figure could miss by chance alone if the weights had been set before the window began. They were set on these same prices, so the true uncertainty is larger.",
    finance:
      "The ± is one standard error of the annualised Sharpe ratio (Lo 2002, with Mertens' correction for skew and fat tails), which treats the weights as fixed; they were fitted on this window, so it understates the uncertainty.",
    formula:
      "± SE(SR) = √((1 + SR²/2 − γ₁·SR + (γ₂/4)·SR²) / T) × √252, SR the daily Sharpe of the tangency portfolio's daily returns, γ₁ sample skew, γ₂ excess kurtosis, T days (Lo 2002; Mertens 2002); the weights are treated as fixed.",
  },
};

// A short human name per key, for the info mark's accessible label ("About Sharpe ratio").
export const TIP_NAMES: Readonly<Record<TipKey, string>> = {
  return: "annual return",
  volatility: "volatility",
  sharpe: "Sharpe ratio",
  sortino: "Sortino ratio",
  max_dd: "maximum drawdown",
  best_sharpe: "tangency Sharpe (in-sample)",
  tangency_return: "tangency return",
  bench_return: "benchmark return",
  bench_vol: "benchmark volatility",
  beta: "beta",
  alpha: "alpha",
};

// ---- the scorecard's own texts ---------------------------------------------------------------------
//
// The scorecard prints figures the app never had, so their texts are the port's, written here beside the
// app's and never added to tooltips.json (that file is a dump of the app and must stay one). The keys are
// their own type, so TipKey stays exactly the app's list. Same three levels, same voice: plain words,
// then the finance term, then the formula.

export type ScoreTipKey =
  | "annual_return"
  | "cumulative"
  | "month_range"
  | "positive_months"
  | "downside"
  | "longest_dd"
  | "sharpe_se"
  | "calmar"
  | "correlation"
  | "r_squared"
  | "tracking_error"
  | "information_ratio"
  | "capture"
  | "var"
  | "es"
  | "frag_lookback"
  | "frag_cut"
  | "frag_draws"
  | "frag_params";

export const SCORE_TIPS: Readonly<Record<ScoreTipKey, Texts>> = {
  annual_return: {
    plain: "The steady yearly growth rate that turns the starting amount into the ending amount over this window.",
    finance: "Compound annual growth rate (CAGR) of the daily-rebalanced portfolio. It is not the mean daily return × 252 that the plates and Sharpe use: against that, compounding takes off about half the annual variance and adds about half the square of the annual log growth rate, so it can land on either side.",
    formula: "(∏(1 + rₜ))^(252/T) − 1, over the T daily returns in the window.",
  },
  cumulative: {
    plain: "How much the starting amount grew or shrank in total over the whole window.",
    finance: "Total return over the window, with the weights held fixed and rebalanced daily.",
    formula: "∏(1 + rₜ) − 1, over every daily return in the window.",
  },
  month_range: {
    plain: "The single best and worst calendar month over the window.",
    finance: "Highest and lowest calendar-month return, compounding the daily returns inside each month. Only complete months count.",
    formula: "max and min over complete months m of ∏(1 + rₜ) − 1 for t in m; the window's first and last months are left out.",
  },
  positive_months: {
    plain: "The share of months that ended with a gain.",
    finance: "Hit rate on calendar-month returns, complete months only.",
    formula: "#{m : Rₘ > 0} / #{complete months}, with Rₘ = ∏(1 + rₜ) − 1 over the days t in month m.",
  },
  downside: {
    plain: "How much the returns swing, counting only the days that fell short of the risk-free rate.",
    finance: "Annualised downside deviation below the daily risk-free rate: the denominator of the Sortino ratio.",
    formula: "√(252 × mean over all t of min(rₜ − Rf/252, 0)²).",
  },
  longest_dd: {
    plain: "The longest stretch spent below an earlier high before climbing back to it, or to the last day if it never did.",
    finance: "Longest drawdown duration, from the peak to the first close at or above it, in trading days and in calendar days.",
    formula: "max over drawdown spells of (recovery day − peak day); a spell still open on the last day runs to that day.",
  },
  sharpe_se: {
    plain: "The risk-vs-reward score, with a ± showing how far it could be off just from the luck of this window.",
    finance: "Annualised Sharpe ratio ± one standard error. Each ± is for that figure alone: portfolios scored on the same prices move together, so whether two of them differ needs a test of the difference, not a comparison of their ± bands.",
    formula: "SE = √252 × √((1 + ½SR² − γ₁SR + ¼γ₂SR²) / T), SR the daily Sharpe, γ₁ sample skew, γ₂ excess kurtosis (Lo 2002, Mertens 2002).",
  },
  calmar: {
    plain: "Yearly growth divided by the worst fall: how much return each unit of the deepest loss paid for.",
    finance: "Calmar ratio over the whole window: compound annual return over the absolute maximum drawdown.",
    formula: "CAGR / |MDD|, with MDD measured from the amount invested.",
  },
  correlation: {
    plain: "How closely the portfolio's daily moves follow the benchmark's, from −1 (opposite) to +1 (in step).",
    finance: "Pearson correlation of daily returns with the benchmark.",
    formula: "ρ = cov(r, b) / (σᵣ σ_b), over the window's daily returns.",
  },
  r_squared: {
    plain: "How much of the portfolio's daily movement the benchmark explains, from 0% to 100%.",
    finance: "R² of the single-index regression on the benchmark: the share of variance that is market-driven.",
    formula: "R² = ρ², the squared correlation of daily returns.",
  },
  tracking_error: {
    plain: "How far the portfolio's path wanders from the benchmark's, as a yearly percentage.",
    finance: "Annualised standard deviation of daily active returns against the benchmark.",
    formula: "TE = std(rₜ − bₜ) × √252, sample standard deviation (ddof 1).",
  },
  information_ratio: {
    plain: "The extra return over the benchmark, per unit of wandering away from it.",
    finance: "Annualised mean active return over tracking error.",
    formula: "IR = 252 × mean(rₜ − bₜ) / TE.",
  },
  capture: {
    plain: "In months the benchmark rose (up) or fell (down), how much of its move the portfolio made, on average.",
    finance: "Up and down capture ratios on calendar-month returns, complete months only. Down capture under 100% means it fell less.",
    formula: "mean(Rₘ) / mean(Bₘ), over complete months with Bₘ > 0 (up) or Bₘ < 0 (down).",
  },
  var: {
    plain: "On the worst 5% of days in this window, the portfolio lost at least this much.",
    finance: "Historical one-day Value at Risk at 95%: the 5th percentile of daily returns, as a positive loss.",
    formula: "VaR₉₅ = −q₀.₀₅(rₜ), linear interpolation between order statistics.",
  },
  es: {
    plain: "The average loss on those worst 5% of days.",
    finance: "Historical one-day expected shortfall (CVaR) at 95%: the mean of the returns at or below the VaR return.",
    formula: "ES₉₅ = −mean(rₜ | rₜ ≤ −VaR₉₅).",
  },
  frag_lookback: {
    plain: "Solve the portfolio again on the last 1, 2, 3 and 5 years and on the full window: the most any one asset's weight moves between those answers.",
    finance: "Largest max-minus-min weight of a single asset across the lookback windows. Fixed weights move by zero. In-sample.",
    formula: "maxᵢ (maxₖ wᵢ⁽ᵏ⁾ − minₖ wᵢ⁽ᵏ⁾), over the windows k that solved.",
  },
  frag_cut: {
    plain: "Lower the largest holding's expected return by one standard error, a change well inside its own noise, and solve again: how much of its weight it loses.",
    finance: "Weight drop of the largest holding when its mean is set one standard error lower and the portfolio is re-solved. A what-if on these prices, in-sample.",
    formula: "wⱼ − wⱼ′, where w′ is re-solved with μⱼ lowered by σⱼ / √(T/252), the standard error of its annual mean.",
  },
  frag_draws: {
    plain: "Draw expected returns anywhere their own noise allows, many times, and solve on each: the range the largest holding's weight covers, 10th to 90th percentile.",
    finance: "p90 − p10 of the largest holding's weight across seeded redraws of the means from N(μ̂, Σ/T), the covariance held at its estimate. In-sample.",
    formula: "q₉₀ − q₁₀ of wⱼ over draws μ⁽ᵈ⁾ = μ̂ + L z⁽ᵈ⁾ / √T, with L L′ = Σ and z standard normal.",
  },
  frag_params: {
    plain: "How many numbers had to be estimated from the price history to choose these weights. Equal weight and a typed mix need none.",
    finance: "Minimum variance reads the covariance matrix; maximum Sharpe reads it and the expected returns. Compare with the days of data they rest on.",
    formula: "GMV: n(n + 1)/2; tangency: n + n(n + 1)/2; fixed weights: 0.",
  },
};

// A short name per scorecard key, for the info mark's accessible label.
export const SCORE_TIP_NAMES: Readonly<Record<ScoreTipKey, string>> = {
  annual_return: "compound annual return",
  cumulative: "cumulative return",
  month_range: "best and worst month",
  positive_months: "positive months",
  downside: "downside deviation",
  longest_dd: "longest drawdown",
  sharpe_se: "Sharpe ratio and its standard error",
  calmar: "Calmar ratio",
  correlation: "correlation",
  r_squared: "R squared",
  tracking_error: "tracking error",
  information_ratio: "information ratio",
  capture: "up and down capture",
  var: "value at risk",
  es: "expected shortfall",
  frag_lookback: "weight range across lookbacks",
  frag_cut: "weight lost to a one standard error cut",
  frag_draws: "weight range across redraws",
  frag_params: "parameters estimated",
};

/** True for a scorecard key. */
export const isScoreTip = (key: string): key is ScoreTipKey => Object.hasOwn(SCORE_TIPS, key);

/** The accessible name for any key, the app's or the scorecard's. */
export function tipName(key: TipKey | ScoreTipKey): string {
  return isScoreTip(key) ? SCORE_TIP_NAMES[key] : TIP_NAMES[key];
}

// The tooltip text for a key at a level; "" when there is none (586: no text, no info mark).
// allowShort defaults to the app's default, off (742-752). A scorecard key reads its own texts, which
// say nothing about the bounds and so do not follow the toggle.
export function tipText(key: TipKey | ScoreTipKey, level: Level, allowShort = false): string {
  if (isScoreTip(key)) return SCORE_TIPS[key][level];
  const base = WORD_OVERRIDES[key]?.[level]?.now ?? ORACLE_TIPS[key]?.[level] ?? "";
  const text = allowShort ? (SHORT_OVERRIDES[key]?.[level]?.short ?? base) : base;
  const note = NOTES[key]?.[level];
  return text && note ? `${text} ${note}` : text;
}
