// The Walk-forward tab's own info marks. They live here, beside the tab, rather than with the page's other
// tooltips (src/content/tooltips.ts), because that module is in the page's first chunk and these texts are
// read only once the tab is open. Tip takes them whole (its `own` prop), at the same three levels and in the
// same voice: plain words, then the finance term, then the formula.
//
// They say what the test measures and how to read a gap; none says how one construction compares with
// another, and none quotes a length, which the page prints beside them.
import type { OwnTip } from "../../types.ts";

export type WalkTipKey = "oos" | "se" | "fit" | "hold" | "added";

export const WALK_TIPS: Readonly<Record<WalkTipKey, OwnTip>> = {
  oos: {
    name: "out-of-sample Sharpe ratio",
    texts: {
      plain: "The risk-vs-reward score earned on days the weights had not seen: each hold is scored with weights chosen before it began. The days of every hold are joined into one run and scored once.",
      finance: "Out-of-sample Sharpe ratio: weights fitted on the fit window before each hold, held unchanged and rebalanced daily through that hold. The held days of all holds are joined and annualised once, at the rate the line above names.",
      formula: "SR = 252 × mean(rₜ − Rfₜ/252) / (√252 × std(rₜ − Rfₜ/252)) over the joined held days, rₜ = wₖ′Rₜ with wₖ fitted before hold k, and Rfₜ each day's rate or one flat rate.",
    },
  },
  se: {
    name: "standard error of the out-of-sample Sharpe ratio",
    texts: {
      plain: "How far the out-of-sample score could be off from the luck of these particular days alone. Two scores closer together than about one of these are well inside the noise; it is a scale for reading a gap, not a test of one.",
      finance: "One standard error of the annualised Sharpe ratio on the joined held days (Lo 2002, with Mertens' allowance for skew and fat tails). Portfolios held over the same days move together, so it is a scale for reading a gap, not a test of one.",
      formula: "SE = √252 × √((1 + ½SR² − γ₁SR + ¼γ₂SR²) / T), with SR the daily Sharpe ratio of the joined held days, γ₁ their skew, γ₂ their excess kurtosis and T their count.",
    },
  },
  fit: {
    name: "fit window",
    texts: {
      plain: "All prior history refits on all the days before each hold, so the fit keeps growing. The other choice refits on only the most recent days, as many as the first fit had, so old years drop out.",
      finance: "Expanding window: each refit estimates the means and covariance on every return row before its hold. Rolling window: on a fixed number of the most recent rows, the length of the first fit.",
      formula: "Expanding: fit on rows [0, h). Rolling: fit on rows [h − F, h). Here h is the hold's first row and F the first fit's length.",
    },
  },
  hold: {
    name: "hold length",
    texts: {
      plain: "How many trading days each set of weights is kept before the next refit. Shorter holds mean more refits, each on more recent prices.",
      finance: "The holding period between refits in trading days, counted forward from the end of the first fit. The last hold is whatever remains of the window, so it can be shorter.",
      formula: "Hold k covers rows [F + kH, min(F + (k + 1)H, T)). Here F is the first fit's length, H the hold length and T the window's return rows.",
    },
  },
  added: {
    name: "the four other constructions",
    texts: {
      plain: "Adds the four other ways of choosing weights that the scorecard offers, each chosen again before every hold. One the basket or a fit cannot have is named, with the reason.",
      finance: "The last-year tangency, the tangency on shrunk means, the capped tangency and risk parity, each re-solved on the fit window before every hold (the last-year one on that window's last year). Each is then held and scored like the three above it.",
      formula: "For each added construction c and hold k, w_c,k is solved on the fit rows before hold k. The joined held days are scored as for the others.",
    },
  },
};
