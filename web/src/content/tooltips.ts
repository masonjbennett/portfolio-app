// The app's tiered tooltips (TOOLTIPS, 525-581; tip(), 584-587) by key and level. The text is never
// retyped: tooltips.json is GENERATED from portfolio_app.py by test/oracle/dump_tooltips.py, and
// test/t-tooltips.mjs fails the run when the committed file and a fresh dump disagree.
//
// One deliberate difference, kept as a reviewed table rather than an edit to the json: the app's
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
  // The app's text this override was reviewed against; t-tooltips fails when the app's changes.
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
  // The app's text this override was reviewed against; t-tooltips fails when the app's changes.
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

// The tooltip text for a key at a level; "" when there is none (586: no text, no info mark).
// allowShort defaults to the app's default, off (742-752).
export function tipText(key: TipKey, level: Level, allowShort = false): string {
  const base = WORD_OVERRIDES[key]?.[level]?.now ?? ORACLE_TIPS[key]?.[level] ?? "";
  const text = allowShort ? (SHORT_OVERRIDES[key]?.[level]?.short ?? base) : base;
  const note = NOTES[key]?.[level];
  return text && note ? `${text} ${note}` : text;
}
