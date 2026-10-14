// The glossary: the terms a sentence on the page may mark with a dotted underline (components/Term),
// each opening to a plain definition. One shared list, so a term reads the same wherever it appears.
// The plain name leads; `technical` is the name a finance reader looks for, printed beside it.
//
// This is new text with no counterpart in the Python app, so it is not held to portfolio_app.py the way
// content/tooltips.ts is. A definition carries no figure: a number belongs to the analysis, which
// changes with the basket, and a definition does not.

export interface GlossaryEntry {
  /** The name the page uses. */
  name: string;
  /** The finance name, when it differs. */
  technical?: string;
  /** One or two plain sentences. */
  text: string;
}

export const GLOSSARY = {
  sharpe: {
    name: "Sharpe ratio",
    text: "Return earned above a safe Treasury bill, per unit of risk (volatility). Higher is better.",
  },
  hindsight: {
    name: "With hindsight",
    technical: "in-sample",
    text: "The mix is chosen using the same years it is scored on, so it already knows what happened. Real investing never gets that.",
  },
  without: {
    name: "Without hindsight",
    technical: "out of sample",
    text: "The mix is chosen on earlier years only, then held through a year it has not seen.",
  },
  vol: {
    name: "Volatility",
    text: "How much the value swings from day to day, scaled to a year. Higher means a bumpier ride.",
  },
  frontier: {
    name: "Efficient frontier",
    text: "For each level of return, the least risky mix of these funds. Mixes below the curve take more risk than they need to.",
  },
  corr: {
    name: "Correlation",
    text: "How closely two funds move together, from −1 (opposite) to 1 (in lockstep). Lower means more diversification.",
  },
  dd: {
    name: "Drawdown",
    text: "How far the value sits below its previous high. The worst one is the deepest fall an investor would have sat through.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type TermKey = keyof typeof GLOSSARY;
