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
  const text = WORD_OVERRIDES[key]?.[level]?.now ?? ORACLE_TIPS[key]?.[level] ?? "";
  if (!allowShort) return text;
  return SHORT_OVERRIDES[key]?.[level]?.short ?? text;
}
