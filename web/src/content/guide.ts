// The guide's words: "How to read this page", for a reader new to all of this. The in-app page (src/guide/GuidePage.tsx)
// is the source, and the PDF (public/guide.pdf, scripts/guide-pdf.mjs) is exported from it, never written apart.
//
// It is written from the page's own names and held to them. Every tab, rail section and tab section is keyed by the
// page's id or heading, and test/t-guide.mjs fails when the guide names one the page no longer renders, AND when the
// page renders one the guide has no entry for, so it cannot go stale by omission either. A name the page prints, quoted
// inside the prose, is written [[like this]]: the page shows it in bold, and the suite finds every one of them on the
// part of the page the entry describes.
//
// No figure is typed here. A published figure is imported from ./published.ts, a count or a limit from the constant the
// engine uses, and a figure that moves with the prices is described, never quoted. The suite reads this file's own
// text and fails on a digit outside a [[quoted name]] (a name the page prints is checked against the page instead).
//
// The voice is the Plain level's: short sentences, every term defined where it first appears or in the glossary.
import { monthYear } from "../chrome/when.ts";
import { format } from "../format.ts";
import { MAX_TICKERS, MIN_TICKERS } from "../lib/clean.ts";
import { TRADING_DAYS } from "../lib/stats.ts";
import { BENCHMARKS } from "../state/defaults.ts";
import { LEVELS, TAB_IDS, TAB_LABELS, type TabId } from "../types.ts";
import { MEGA_CAP_IN_SAMPLE, MEGA_CAP_IN_SAMPLE_END, MEGA_CAP_IN_SAMPLE_RF, PUBLISHED_SETS } from "./published.ts";
import { RAIL_HEADINGS, RAIL_IDS, type RailId } from "./rail.ts";

/** The guide's title (src/guide/route.ts, which the page's first chunk carries for its links). */
export { GUIDE_TITLE } from "../guide/route.ts";

/** The line under the title. */
export const GUIDE_DEK = "Every part of the page in plain words, for a reader new to investing and to the ideas behind it.";

/** Where the PDF is served from (public/guide.pdf). */
export const GUIDE_PDF = "/guide.pdf";

/** One block of the guide: a heading (a name the page prints, or the guide's own) and its paragraphs. */
export interface GuidePart {
  /** The heading. For a tab section, the section's heading exactly as the tab prints it; several when one entry covers several. */
  heading: string | readonly string[];
  body: readonly string[];
}

/** A tab's entry: the question it answers, what it opens on, then one part per section heading it prints. */
export interface GuideTab {
  question: string;
  opens: readonly string[];
  sections: readonly GuidePart[];
}

/** A term of the guide's own glossary. `find` is the word the page must still use for the entry to stay (default: the term). */
export interface GuideTerm {
  term: string;
  text: string;
  find?: string;
}

const [plain, finance, formula] = LEVELS.map((l) => l.label);
const [mega, , cross] = PUBLISHED_SETS;
const benchList = BENCHMARKS.map((b) => b.label);
const listed = (xs: readonly string[]) => `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// ---- start here -----------------------------------------------------------------------------------------------

export const GUIDE_START: readonly string[] = [
  "This page takes a handful of investments you choose, looks at how their prices moved, and works out how different ways of " +
    "splitting money between them would have done. This guide says what each part of the page shows, in plain words, for a " +
    "reader who has not met these ideas before.",
  `Names in bold, like [[${RAIL_HEADINGS.tickers}]] or [[${TAB_LABELS.risk}]], are written exactly as the page prints them, ` +
    "so you can find them on the screen. Words in the glossary at the end are explained there.",
  "Every figure describes the past: the prices between two dates you pick. Nothing on the page is a forecast or a " +
    "recommendation, and nothing you do on it is saved anywhere but in your own browser.",
];

// ---- the one idea -----------------------------------------------------------------------------------------------

export const GUIDE_IDEA: GuidePart = {
  heading: "Fitted, then tested",
  body: [
    "Most of the page asks one question: how should the money have been split between these investments? The answer is " +
      "a portfolio, a set of weights saying what share of the money goes in each one, and the page scores portfolios with " +
      "the Sharpe ratio: the return they earned above a safe rate, for each unit of risk they took. Here risk means how much " +
      "a portfolio's value swung up and down, which the page calls volatility, so the least volatile mix is the one that " +
      "swung least. A higher Sharpe ratio is better.",
    "Most figures on the page are in-sample. The weights are chosen by looking at a stretch of prices and then scored on " +
      "that same stretch, which is like setting an exam after reading the answers. An in-sample figure shows what the best " +
      "split would have been with hindsight, not what anyone could have earned.",
    "An out-of-sample figure is the fair test: choose the weights on earlier prices, then hold them, unchanged, over later " +
      `days they have not seen. The [[${TAB_LABELS.walkforward}]] tab runs that test, and the line at the top of the page ` +
      "quotes the result as it was published.",
    `The gap can be large. Take the [[${mega.name}]] set, shares in some of the largest US companies. Fitted to all of ` +
      "its prices up to " +
      `${monthYear(MEGA_CAP_IN_SAMPLE_END)}, at a ${format(MEGA_CAP_IN_SAMPLE_RF, "pct1")} safe rate, the portfolio with the ` +
      `highest Sharpe ratio scored ${MEGA_CAP_IN_SAMPLE}. Held over years it had not seen, it earned ${mega.tangency}, below ` +
      `the ${mega.ew} that an even split of the money earned. On the [[${cross.name}]] set, funds that hold stocks, bonds, ` +
      `gold and property, it went the other way: ${cross.tangency} out of sample, against ${cross.ew} for the even split.`,
    "So read an in-sample figure as a description of the past. The published out-of-sample result is the fairer test of " +
      "what choosing weights from past prices was worth over those years. It came out both ways, and it is not a promise " +
      "about the years ahead.",
  ],
};

// ---- the first screen -------------------------------------------------------------------------------------------

export const GUIDE_FIRST_SCREEN: readonly GuidePart[] = [
  {
    heading: "The masthead",
    body: [
      "At the top: the title, one line on what the page does, and who made it. To the right, a chip names the basket (how " +
        "many assets, the benchmark and the dates asked for), and [[Prices as of]] says which day's closing prices the figures " +
        "run to.",
      `On a first visit the page opens on a saved example, so it is never blank: the ${cross.name.toLowerCase()} set ` +
        "described above. While it shows, the word [[example]] sits beside the date; fresh prices replace it when they arrive.",
    ],
  },
  {
    heading: "The published result",
    body: [
      "[[Published result]] quotes the out-of-sample test as it was published on masonjbennett.com: the sentence from the " +
        "project, then three out-of-sample Sharpe ratios, for an even split, for the least volatile mix and for the highest-" +
        "Sharpe mix. When your tickers are exactly one of the three published sets, the line names that set; on any other " +
        "basket it quotes the five mega-caps. These figures are fixed: they never move with your settings.",
      "[[Walk-forward test]] opens the same test, replayed, in its tab, and the last link opens the published method note. On " +
        "a phone the sentence folds behind [[The published sentence]]; tap it to read it.",
    ],
  },
  {
    heading: "The finding and the four plates",
    body: [
      "Under it, one sentence says what your tickers did over the window: the highest Sharpe ratio any mix of them reached, " +
        "with hindsight, against an even split. It says in-sample, because it is.",
      `Four plates follow, each a Sharpe ratio over the same window. [[Equal-Weight Sharpe]] is the even split, chosen ` +
        "without looking at the prices, which makes it the yardstick. [[Tangency Sharpe (in-sample)]] is the mix with the " +
        "highest Sharpe ratio, chosen on these prices, with plus or minus one standard error beside it: a rough sense of how " +
        "far the figure could be off by luck alone. Because the mix was chosen on these same prices, it could be off by more. " +
        "[[GMV Sharpe (in-sample)]] " +
        "is the mix that swung least, also chosen on these prices. The last is the benchmark's own, named after it, such as " +
        `[[${BENCHMARKS[0].display} Sharpe]].`,
      "The small i beside each plate explains it; the text follows the explanation level in the settings.",
    ],
  },
  {
    heading: "The what-if panel",
    body: [
      "[[What if one expected return were different?]] opens a panel, [[What-if on these prices]]. Pick an asset, then slide " +
        "its expected return, the average yearly return the optimizer assumes it earns, [[up to two standard errors either side " +
        "of its average]]. At each step the highest-Sharpe mix is solved again and the sentence prints its new weight in that " +
        "asset. The least volatile mix never moves, because it does not use expected returns at all.",
      "Why do fitted weights swing so much? The optimizer has to estimate, from the prices, each asset's average return, how " +
        "much it swings and how each pair moves together. The lines under the slider count those estimates, and say how many " +
        "years of prices it would take to pin one average return down. That is usually far more than the window holds, so each " +
        "estimate is rough, and a small change in one can move the weights a lot.",
    ],
  },
];

// ---- the settings -----------------------------------------------------------------------------------------------

export const GUIDE_RAIL_INTRO: readonly string[] = [
  "The settings run down the left of the page. Most changes apply at once, with no button to press; new tickers apply " +
    "when you press Enter. Only a new basket, new dates or a new benchmark fetch prices.",
];

export const GUIDE_RAIL: Readonly<Record<RailId, readonly string[]>> = {
  level: [
    `How much the small i marks beside the figures explain. [[${plain}]], the default, uses everyday words; [[${finance}]] ` +
      `uses the terms a finance course would; [[${formula}]] gives the formula, and also adds a line under each tab's opening ` +
      "sentence with the formula behind its figure. The level changes the explanations, never a figure. This guide uses the " +
      `${plain} wording.`,
  ],
  tickers: [
    "A ticker is the short code a market uses for an investment: AAPL for Apple, VTI for a fund that holds the whole US stock " +
      `market. Type between ${MIN_TICKERS} and ${MAX_TICKERS} of them, separated by commas, and press Enter. The codes are ` +
      "Yahoo Finance's, so funds and indexes work too.",
    "The buttons above the box fill it with a ready-made basket. The first three, marked [[Published]], are the sets whose " +
      "out-of-sample result is published; here they are recomputed in-sample on the prices loaded, so their figures are not " +
      "the published ones. [[More baskets]] opens the rest.",
  ],
  dates: [
    "[[Start]] and [[End]] set the window: the stretch of prices every figure is computed from. The end is today unless you " +
      "pick a day; then [[End today instead]] puts it back. A new window fetches prices again.",
  ],
  rf: [
    "The risk-free rate is what a safe investment paid over the same time; the page uses short-term US Treasury bills. A " +
      "Sharpe ratio counts only the return above it. By default it is the average yield over your window, from FRED, the " +
      "Federal Reserve Bank of St. Louis's public data.",
    "[[Use today's rate instead]] swaps in the latest yield. Typing a rate fixes it at that, and [[Use the rate over the " +
      "window]] goes back. The note under the field always says which rate is in use.",
  ],
  bench: [
    "The benchmark is what everything is measured against: a broad market index, or a fund that tracks one. The choices are " +
      `${listed(benchList)}.`,
  ],
  short: [
    "Off, every weight is zero or more: money only goes into an asset. With [[Allow short positions]] on, a weight may go " +
      "below zero. That is a short position: you borrow an asset and sell it, betting its price will fall. The money from " +
      "the sale goes into the other assets, so their weights alone can come to more than the whole; all the weights together " +
      "still make the whole. The note under the switch gives the limits. Switching solves the mixes again on the prices " +
      "already loaded.",
  ],
};

/** The settings on a phone, where they fold into a sheet. The page prints it straight after the settings' first words. */
export const GUIDE_RAIL_PHONE =
  "On a phone the settings sit behind the [[Settings]] bar at the top of the page; tap it to open them, and its summary " +
  "says what is set.";

// ---- the tabs ---------------------------------------------------------------------------------------------------

export const GUIDE_TABS_INTRO: readonly string[] = [
  "The row of tabs under the plates holds the analysis. Most tabs open on one sentence, in large type, that states what " +
    "their figures show, then the charts and tables behind it. Every one of them is computed from the window and the tickers in " +
    "the settings.",
  "Four portfolios recur across the tabs: equal weight (the even split), GMV (the least volatile mix), tangency (the highest-" +
    "Sharpe mix) and your own, which the page calls [[Custom]] and you set on the " +
    `[[${TAB_LABELS.custom}]] tab. GMV and tangency are chosen on the window's prices, so their figures are in-sample.`,
];

export const GUIDE_TABS: Readonly<Record<TabId, GuideTab>> = {
  returns: {
    question: "How did each investment grow, and how bumpy was the ride?",
    opens: [
      "It opens on where a starting amount ended in each asset and in the benchmark, drawn as one line each. The buttons " +
        "above the chart switch lines on and off, and the box after [[Growth of $]] changes the starting amount; it is " +
        "remembered in this browser and never put in a link. The table under the chart gives each line's end figures.",
    ],
    sections: [
      {
        heading: "Calendar years",
        body: [
          "Each calendar year's return for the four portfolios and the benchmark. Below the table, [[Months of]] picks one of " +
            "them for a grid of every month, shaded from loss to gain, with the same months as a table under it.",
        ],
      },
      {
        heading: "Summary Statistics",
        body: [
          "One row per asset, and a last row for the benchmark: its average yearly return; its volatility, how much it swung, " +
            "as a yearly percentage (not a gain or a loss: the higher it is, the further the value tended to stray from its " +
            "average, up or down); its worst and best single days; and two measures of shape. Skewness says whether the biggest " +
            "moves leaned toward gains or toward losses; excess kurtosis above zero means extreme days came more often than a " +
            "bell curve would predict.",
        ],
      },
      {
        heading: "Return Distribution",
        body: [
          "Pick an [[Asset]] to see its daily returns two ways. [[Histogram + Normal Fit]] counts how often each size of daily " +
            "move happened, beside the bell curve a normal distribution would draw. The far ends of the chart are its tails, " +
            "the rare big days up and down; the chart's title says whether they were fatter or thinner than the curve's, and " +
            "fatter means big days came more often than the curve allows.",
          "[[Q-Q Plot]] lines the daily returns up from worst to best and sets each one against where it would fall if returns " +
            "followed the bell curve; the page calls those places quantiles. If the returns matched the curve, every dot would " +
            "sit on the straight line. Dots that bend away from it at the ends are days more extreme than the curve allows.",
        ],
      },
    ],
  },
  risk: {
    question: "How far did things fall, and how long did the falls last?",
    opens: ["It opens on the asset that fell furthest from a high, and when it got back to that level, if it did."],
    sections: [
      {
        heading: "The portfolios in a fall",
        body: [
          "Pick a portfolio to list its [[Deepest falls]] in your window: from which high, to which low, how deep, and how " +
            "long it took to get back. [[Named falls in this window]] sets every portfolio against the same well-known " +
            "market falls, so they are compared over the same days.",
        ],
      },
      {
        heading: "Drawdowns",
        body: [
          "A drawdown is how far an investment stands below its highest price so far. The chart follows one asset, picked " +
            "above it, day by day; [[Worst drawdown by asset]] lists each asset's deepest, with its dates.",
        ],
      },
      {
        heading: "Rolling volatility",
        body: [
          "Volatility measured over a moving window of recent trading days, so calm and stormy stretches show as low and high " +
            "lines. The buttons above it set the window's length.",
        ],
      },
      {
        heading: "Risk-adjusted metrics",
        body: [
          "Each asset's Sharpe ratio and its Sortino ratio, and the benchmark's. The Sortino ratio is the same idea counting " +
            "only the swings below the safe rate, since few investors mind the swings up.",
        ],
      },
      {
        heading: "CAPM beta and alpha",
        body: [
          "CAPM, the capital asset pricing model, is the textbook idea that part of an asset's return simply follows the " +
            "market. Beta says how much an asset tended to move when the benchmark moved: above one, more than the benchmark; " +
            "below one, less. Alpha is the yearly return left over that the benchmark's moves do not explain. Both describe this " +
            "window, not a skill that will carry on. The chart draws a dashed line at one, the benchmark's own beta.",
        ],
      },
    ],
  },
  correlation: {
    question: "Do these investments rise and fall together?",
    opens: [
      "Correlation runs from minus one (always moving opposite) through zero (unrelated) to plus one (always moving " +
        "together). Investments that do not move together are what makes spreading money between them worth anything. The " +
        "tab opens on the most and the least correlated pair, a shaded grid of every pair, and the same figures in a table.",
    ],
    sections: [
      {
        heading: "Rolling pairwise correlation",
        body: [
          "Pick two assets and a window length to see how their correlation changed over time, rather than one figure for the " +
            "whole window.",
        ],
      },
      {
        heading: "Daily covariance matrix",
        body: [
          "The raw material the optimizer works from: a grid with a row and a column for each asset, saying how each pair's " +
            "daily returns moved together. Where an asset meets itself, the figure is how much it swings on its own. The " +
            "figures are tiny and hard to read by eye. Correlation divides each one by how much the two assets swing, which " +
            "makes it run from minus one to plus one and easier to read, but it no longer says how big the swings were; the " +
            "optimizer needs the covariances for exactly that.",
        ],
      },
    ],
  },
  optimization: {
    question: "Which mixes of these assets did best, with hindsight?",
    opens: [
      "It opens on the highest-Sharpe mix's weights and its in-sample Sharpe ratio, against the even split's. Everything " +
        "fitted on this tab is chosen on the same prices it is scored on.",
    ],
    sections: [
      {
        heading: "Efficient Frontier",
        body: [
          "The chart puts volatility across and return up, so a point further left swung less and a point higher earned more. " +
            "Each point on the curve is the least volatile mix that reaches a given return. GMV sits at its far left, the least " +
            "volatile of all. A straight line from the risk-free rate just touches the curve at tangency, the highest-Sharpe " +
            "mix, which is where the name comes from. The single assets and the even split are marked too.",
        ],
      },
      {
        heading: "Three portfolios",
        body: [
          "Side by side: [[Equal-Weight Portfolio (1/N)]] (the name's ending means the money divided evenly by the number of " +
            "assets), [[Global Min Variance]] and [[Max Sharpe (Tangency)]]. Each shows its return, volatility, Sharpe and " +
            "Sortino ratios, and [[Max DD]], short for maximum drawdown: its deepest fall. The two fitted ones say [[weights " +
            "chosen on this window]]; [[The walk-forward test]] opens what such weights earned on later years.",
        ],
      },
      {
        heading: "Portfolio Weights",
        body: [
          "How much of the money each mix puts in each asset, as a chart and a table. Under them is [[If the true means were " +
            "anywhere their own noise allows]]. The means are the assets' average returns; their noise is how far those " +
            "averages, worked out from a limited stretch of prices, could be off by chance. The page redraws the averages many " +
            "times within that noise and solves the mix again each time, to show how far its weights could swing. [[Redraw]] " +
            "draws a fresh set.",
        ],
      },
      {
        heading: "Scorecard",
        body: [
          "Every portfolio in one table: return, risk, falls, how the portfolio moved with the benchmark, and how fragile its " +
            "weights are. The buttons above it add other ways of building a mix, such as [[Risk parity]]. [[Show every row]] " +
            "shows the rows left out at first, and [[What each row means]] explains each one.",
          "Besides the usual downloads, [[Download Excel, with formulas]] gives a workbook that rebuilds most of the scorecard " +
            "as spreadsheet formulas, working from the closing prices. The fitted weights go in as plain numbers, and a few rows " +
            "are left out; the workbook's first sheet names them.",
        ],
      },
      {
        heading: "Risk Contribution (PRC)",
        body: [
          "Pick a portfolio to compare each asset's share of its money with its share of the return and its share of the risk. " +
            "A small weight in a volatile asset can carry a large share of the risk.",
        ],
      },
      {
        heading: "Portfolio Comparison: Cumulative Wealth",
        body: ["The starting amount grown in each portfolio and in the benchmark over the window."],
      },
      {
        heading: "Summary Comparison",
        body: ["The portfolios' main figures together in one table."],
      },
    ],
  },
  custom: {
    question: "What about a mix you choose yourself?",
    opens: [
      "It opens on your mix's yearly return, volatility and Sharpe ratio, against the highest-Sharpe mix's. Your weights " +
        "travel in the page's link, and appear as [[Custom]] on the other tabs.",
    ],
    sections: [
      {
        heading: "Custom Portfolio Builder",
        body: ["The weights, your mix's figures, and where the mix sits beside the efficient frontier, together."],
      },
      {
        heading: "Weights",
        body: [
          "A slider and a box for each asset, each starting at an equal setting. The page divides every setting by their " +
            "total, so the shares always add up to the whole. That means raising one asset lowers the share of every other, " +
            "even the ones you leave alone. [[Reset to equal weights]] appears once you change one.",
        ],
      },
      {
        heading: "Custom Portfolio on Efficient Frontier",
        body: ["Your mix on the frontier chart, and how much less volatility the frontier reaches at the same return."],
      },
      {
        heading: "Cumulative Wealth: All Portfolios",
        body: ["The starting amount grown in your mix, beside the other portfolios and the benchmark."],
      },
      {
        heading: "Scorecard",
        body: [`The same scorecard as the [[${TAB_LABELS.optimization}]] tab, with your mix in it.`],
      },
      {
        heading: "Normalized Weights",
        body: ["Your settings after they are divided by their total: the shares every figure on the tab uses."],
      },
    ],
  },
  sensitivity: {
    question: "How much do the chosen weights depend on which years they were chosen from?",
    opens: [
      "It chooses the GMV and tangency weights again on several windows that all end on the last day, from the most recent " +
        "year back to the whole window, and opens on how far one asset's weight moves between them.",
    ],
    sections: [
      {
        heading: "Estimation Window Sensitivity",
        body: [
          "One bar per window for each asset's weight; the switch above the chart moves between [[GMV]] and [[Tangency]]. " +
            "Weights that jump from window to window depend heavily on which years were used.",
        ],
      },
      {
        heading: "Portfolio Metrics Across Windows (in-sample)",
        body: ["Each window's mix, scored on that same window's prices."],
      },
      {
        heading: "Weights Across Windows",
        body: ["The weights behind the chart, as tables."],
      },
      {
        heading: "Custom Portfolio Sensitivity",
        body: [
          "Tick [[Include Custom Portfolio in sensitivity analysis]] to score your own mix, held fixed, on each window too.",
        ],
      },
    ],
  },
  walkforward: {
    question: "What did a fitted mix earn on days it had not seen?",
    opens: [
      "This is the out-of-sample test. Weights are chosen on earlier prices, held unchanged for a stretch called a hold, then " +
        "chosen again on everything up to that point and held again, and so on to the end. Only the returns earned during " +
        "the holds count.",
    ],
    sections: [
      {
        heading: "Walk-forward test",
        body: [
          "The switch under the heading has two views. [[Your basket]] runs the test on the tickers in your settings. " +
            "[[As published]] replays the published test.",
          "In your basket's view, [[Fit on]] sets what each choice of weights may look at, [[All prior history]] or only the " +
            "most recent stretch, and [[Hold for]] sets how long each hold lasts. Both count in returns: there is one daily " +
            "return for each trading day, so a count of returns is a count of trading days. [[Add the four other " +
            "constructions]] adds the scorecard's other ways of building a mix.",
        ],
      },
      {
        heading: "In-sample against out-of-sample",
        body: [
          "For each mix, the Sharpe ratio on the prices it was chosen from beside the one it earned afterwards. The distance " +
            "between them is what hindsight was worth.",
        ],
      },
      {
        heading: "Hold by hold",
        body: [
          "Each hold's dates and the Sharpe ratio each mix earned in it. Under them, [[Weights of]] picks a fitted mix to show " +
            "the weights it held in each hold.",
        ],
      },
      {
        heading: "The published figures",
        body: ["The published out-of-sample Sharpe ratios, every set by every mix, in one table."],
      },
      {
        heading: "How the test was run",
        body: ["The rules of the published run: what each choice of weights saw, how long each hold lasted, and the rate used."],
      },
      {
        heading: PUBLISHED_SETS.map((s) => s.name),
        body: [
          "One section per published set: each hold, and the weights the two fitted mixes held. " +
            "[[Rerun this set on fresh prices]] puts that set into your settings, on the published run's dates and rate with " +
            "short selling off, and runs the test again on prices fetched now, in your basket's view.",
        ],
      },
    ],
  },
};

// ---- things that work everywhere --------------------------------------------------------------------------------

export const GUIDE_EVERYWHERE: readonly GuidePart[] = [
  {
    heading: "The i marks",
    body: [
      "A small i beside a figure or a column explains it. Point at it, move to it with the Tab key, or tap it; tap again or " +
        "press Escape to close it. Its words follow the explanation level.",
    ],
  },
  {
    heading: "Downloads",
    body: ["Every table has [[Download CSV]] and [[Download Excel]] under it, for the table as you see it."],
  },
  {
    heading: "The link in the address bar",
    body: [
      "Once you change something, the address bar holds a link to exactly this view: the tickers, dates, rate, benchmark, " +
        "short selling, your custom weights and the tab. Send it and the other person opens the same analysis, on the latest " +
        "prices unless you set an end date. The starting amount is never in it.",
    ],
  },
  {
    heading: "The keyboard",
    body: [
      "Press Ctrl and K together (Command and K on a Mac) to open a small box that sets the explanation level or goes to a " +
        "tab, or to this guide, as you type its name.",
    ],
  },
];

// ---- the glossary -----------------------------------------------------------------------------------------------
//
// The guide's own terms. The figures the page explains with an i mark are listed after these, in the marks' own
// Plain words (src/content/tooltips.ts and the Walk-forward tab's), so the glossary cannot disagree with them.

export const GUIDE_TERMS: readonly GuideTerm[] = [
  { term: "Annualised", text: `Turned into a yearly figure. The page counts a year as ${TRADING_DAYS} trading days.`, find: "annual" },
  { term: "Basket", text: "The set of tickers in the settings, the investments every figure is about." },
  { term: "Benchmark", text: "What everything is measured against: a broad market index, or a fund that tracks one. No weights are chosen for it; it is there to compare with." },
  {
    term: "Capital allocation line",
    text: "On the efficient frontier chart, the straight line from the risk-free rate through tangency: every split between the safe rate and the tangency mix.",
  },
  { term: "Construction", text: "A rule for building a mix from the prices: equal weight, GMV and tangency, and the others the scorecard can add." },
  {
    term: "Correlation",
    text: "How closely two sets of daily returns move together, from minus one (always opposite) to plus one (always together).",
  },
  {
    term: "Covariance",
    text: "How two sets of daily returns move together, including how big their swings were. The optimizer works from these, one for every pair.",
  },
  { term: "Drawdown", text: "How far an investment or a portfolio stands below its highest value so far." },
  {
    term: "Efficient frontier",
    text: "The curve of the least volatile mix for each level of return. A mix below it could have had less risk for the same return.",
  },
  {
    term: "Equal weight",
    text: "The same share of the money in every asset, kept even each day. Nobody looked at the prices to choose it, which makes it the fair yardstick.",
    find: "Equal-Weight",
  },
  {
    term: "Estimation window",
    text: "The stretch of prices the weights are chosen from; the page also calls it a lookback. The Sensitivity tab changes it to show how much it matters.",
  },
  {
    term: "ETF",
    text: "An exchange-traded fund: one ticker that holds many investments and is bought and sold like a share. A sector ETF holds the companies of one industry.",
  },
  {
    term: "Excess kurtosis",
    text: "A measure of how often extreme days happen. Zero for a bell curve; above zero, big moves came more often than a bell curve allows.",
  },
  {
    term: "Expected return",
    text: "The average yearly return the optimizer assumes an asset earns. Here it is the asset's average over the window, which is only an estimate.",
  },
  {
    term: "GMV",
    text: "Global minimum variance: the mix whose value swung least over the window. Choosing it uses how the returns swing and move together, never their averages.",
  },
  {
    term: "Hindsight",
    text: "Knowing how things turned out. Weights chosen on the same prices they are scored on are chosen with hindsight.",
  },
  {
    term: "Hold",
    text: "In the walk-forward test, a stretch of days over which a mix is held unchanged, before its weights are chosen again.",
  },
  {
    term: "In-sample",
    text: "Scored on the same prices the weights were chosen from. It describes the past; it is not what anyone could have earned.",
  },
  {
    term: "Index",
    text: `A list of companies whose prices are followed together as one number, such as the ${BENCHMARKS[0].display}. A benchmark is an index, or a fund that tracks one.`,
  },
  { term: "Mega-cap", text: "One of the very largest companies, measured by the total value of its shares." },
  { term: "Normal distribution", text: "The bell curve. The page draws one beside the real returns to show where they differ from it." },
  {
    term: "Optimizer",
    text: "The calculation that chooses weights to meet a goal, such as the least volatility or the highest Sharpe ratio.",
    find: "optimi",
  },
  {
    term: "Out-of-sample",
    text: "Scored on days the weights had not seen when they were chosen. The fair test of a fitted mix.",
  },
  { term: "Portfolio", text: "A set of weights across the assets: a way of splitting the money. The page also calls one a mix." },
  { term: "Rebalanced", text: "Bought and sold back to the target weights. Every portfolio on the page is rebalanced daily." },
  {
    term: "Return",
    text: "How much an investment gained or lost, as a share of what was put in. A daily return is one day's change.",
  },
  {
    term: "Risk contribution",
    text: "An asset's share of a portfolio's risk, which can be far from its share of the money.",
  },
  {
    term: "Risk-free rate",
    text: "What a safe investment paid over the same time: short-term US Treasury bills. A Sharpe ratio counts only the return above it.",
  },
  {
    term: "Rolling window",
    text: "A fixed number of recent trading days that moves forward one day at a time, so a figure can be followed through time.",
    find: "rolling",
  },
  {
    term: "Short position",
    text: "A negative weight: an asset sold after borrowing it, which gains when its price falls. Off unless switched on in the settings.",
  },
  { term: "Skewness", text: "Whether the biggest moves leaned toward gains (above zero) or toward losses (below zero)." },
  {
    term: "Standard error",
    text: "How far a figure estimated from a limited stretch of data could be off by chance alone. The page prints it as plus or minus.",
  },
  {
    term: "Tangency",
    text: "The mix with the highest Sharpe ratio over the window, chosen with hindsight. Also called the maximum-Sharpe portfolio.",
  },
  { term: "Ticker", text: "The short code a market uses for an investment, such as AAPL for Apple." },
  { term: "Trading day", text: "A day the market was open. Weekends and market holidays have no prices." },
  { term: "Volatility", text: "How much returns swing about their average, as a yearly figure. The page's usual measure of risk." },
  {
    term: "Walk-forward test",
    text: "Choosing weights on earlier prices, holding them over later ones, and repeating to the end: an out-of-sample test.",
    find: "Walk-forward",
  },
  { term: "Weight", text: "The share of a portfolio's money in one asset. A portfolio's weights add up to the whole." },
];

/** The words before the info marks' half of the glossary. */
export const GUIDE_MARKS_INTRO: readonly string[] = [
  "The page explains these figures in the small i mark beside each one. Here are those explanations in their " +
    `${plain} words; the page also has each in ${finance} and ${formula} words.`,
];

// ---- how the figures are computed -------------------------------------------------------------------------------

export const GUIDE_METHOD =
  "Every formula and data source is listed under [[Methodology]] at the foot of the page, and of this guide. The code is " +
  "public, linked beside it.";

// The structure the suite holds to the page, exported for it: the tab ids in the guide's order, the rail ids in the guide's order.
export const GUIDE_TAB_IDS: readonly TabId[] = TAB_IDS.filter((id) => Object.hasOwn(GUIDE_TABS, id));
export const GUIDE_RAIL_IDS: readonly RailId[] = RAIL_IDS.filter((id) => Object.hasOwn(GUIDE_RAIL, id));
