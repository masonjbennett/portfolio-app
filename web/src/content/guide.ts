// The guide's words: "How to read this page", for a reader new to all of this. The in-app page (src/guide/GuidePage.tsx)
// is the source, and the PDF (public/guide.pdf, scripts/guide-pdf.mjs) is exported from it, never written apart.
//
// It is written from the page's own names and held to them. Every chapter, tab, settings group and tab section is keyed by the
// page's id or heading, and test/t-guide.mjs fails when the guide names one the page no longer renders, AND when the
// page renders one the guide has no entry for, so it cannot go stale by omission either. A name the page prints, quoted
// inside the prose, is written [[like this]]: the page shows it in bold, and the suite finds every one of them on the
// part of the page the entry describes.
//
// No figure is typed here. A published figure is imported from ./published.ts, a count or a limit from the constant the
// engine uses, and a figure that moves with the prices is described, never quoted. The suite reads this file's own
// text and fails on a digit outside a [[quoted name]] (a name the page prints is checked against the page instead).
//
// The voice is the page's: short sentences, one idea each, every term defined where it first appears or in the glossary.
// A mix goes by the plain name the Overview prints (MIX), with its finance name beside it where the page uses that one
// too; the guide talks of chapters and rows, the way the page is read, and says each fact in one place. It stays a
// companion: nothing on the page may need it.
import { monthYear } from "../chrome/when.ts";
import { format } from "../format.ts";
import { MAX_TICKERS, MIN_TICKERS } from "../lib/clean.ts";
import { TRADING_DAYS } from "../lib/stats.ts";
import { BENCHMARKS } from "../state/defaults.ts";
import { CHAPTER_IDS, CHAPTER_LABELS, TAB_IDS, type ChapterId, type TabId } from "../types.ts";
import { MEGA_CAP_IN_SAMPLE, MEGA_CAP_IN_SAMPLE_END, MEGA_CAP_IN_SAMPLE_RF, PUBLISHED_SETS } from "./published.ts";
import { ASSUMPTIONS, INPUT_HEADINGS, INPUT_IDS, type InputId } from "./inputs.ts";
import { MIX, QUESTION } from "../overview/model.ts";

/** The guide's title (src/guide/route.ts, which the page's first chunk carries for its links). */
export { GUIDE_TITLE } from "../guide/route.ts";

/** The line under the title. */
export const GUIDE_DEK = "A companion to the page: what each part shows, in plain words, for a reader new to investing.";

/** Where the PDF is served from (public/guide.pdf). */
export const GUIDE_PDF = "/guide.pdf";

/** One block of the guide: a heading (a name the page prints, or the guide's own) and its paragraphs. */
export interface GuidePart {
  /** The heading. For a tab section, the section's heading exactly as the tab prints it; several when one entry covers several. */
  heading: string | readonly string[];
  body: readonly string[];
}

/** A chapter's entry: the question it answers and what it holds. Its tabs' entries follow it, in CHAPTER_TABS' order. */
export interface GuideChapter {
  question: string;
  opens: readonly string[];
}

/** A tab's entry, one part of its chapter: the question it answers, what it opens on, then one part per section heading it prints. */
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

const [mega, , cross] = PUBLISHED_SETS;
const benchList = BENCHMARKS.map((b) => b.label);
const listed = (xs: readonly string[]) => `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
// The three mixes by the Overview's plain names, inside a sentence.
const best = MIX.tangency.name.toLowerCase();
const even = MIX.ew.name.toLowerCase();
const calm = MIX.gmv.name.toLowerCase();

// ---- start here -----------------------------------------------------------------------------------------------

export const GUIDE_START: readonly string[] = [
  "The page takes a handful of investments you choose and looks at how their prices moved. Then it works out how " +
    "different ways of splitting money between them would have done.",
  "You do not need this guide to use it. Every chart says what it shows, and every figure explains itself one tap away. " +
    "Read on when you want the why, or a word you have not met.",
  `Names in bold, like [[${INPUT_HEADINGS.tickers}]] or [[${CHAPTER_LABELS.performance}]], are written as the page prints ` +
    "them, so you can find them on the screen. The glossary at the end explains the rest.",
  "Every figure describes the past: the prices between two dates you pick. Nothing is a forecast or a recommendation. " +
    "Nothing you do is saved anywhere but in your own browser.",
];

// ---- the one idea -----------------------------------------------------------------------------------------------

export const GUIDE_IDEA: GuidePart = {
  heading: "Fitted, then tested",
  body: [
    "The page asks one question: how should the money have been split? A split is a portfolio, or a mix: a set of weights " +
      "saying what share of the money goes in each investment.",
    "Mixes are scored with the Sharpe ratio. It is the return earned above a safe rate, for each unit of risk taken. Risk " +
      "here means how much the value swung up and down, which the page calls volatility. A higher Sharpe ratio is better.",
    `Three mixes recur. The ${even} (equal weight) puts the same share in everything; nobody looked at the prices to choose ` +
      `it. The ${calm} (GMV, global minimum variance) is the one that swung least. The ${best} (tangency) has the highest ` +
      "Sharpe ratio.",
    `The last two are fitted: chosen by looking at the prices, then scored on those same prices. That is in-sample, like ` +
      "setting an exam after reading the answers. It shows the best split with hindsight, not what anyone could have earned.",
    "The fair test is out-of-sample. Choose the weights on earlier prices, then hold them, unchanged, over later days they " +
      `have not seen. The [[${CHAPTER_LABELS.holdup}]] chapter runs that test, and the Overview quotes it as published.`,
    `The gap can be large. Take the [[${mega.name}]] set, shares in some of the largest US companies. Fitted to its prices up ` +
      `to ${monthYear(MEGA_CAP_IN_SAMPLE_END)}, at a ${format(MEGA_CAP_IN_SAMPLE_RF, "pct1")} safe rate, the ${best} scored ` +
      `${MEGA_CAP_IN_SAMPLE}. Held over years it had not seen, it earned ${mega.tangency}, below the ${mega.ew} of the ${even}. ` +
      `On the [[${cross.name}]] set, funds holding stocks, bonds, gold and property, it went the other way: ${cross.tangency} ` +
      `out of sample, against ${cross.ew}.`,
    "So read an in-sample figure as a description of the past. The published out-of-sample result is the fairer test, and " +
      "it came out both ways. It is not a promise about the years ahead.",
  ],
};

// ---- the first screen -------------------------------------------------------------------------------------------

export const GUIDE_FIRST_SCREEN: readonly GuidePart[] = [
  {
    heading: "The masthead",
    body: [
      "At the top: the title, who made it and a link to this guide. Just below sits the bar holding your basket and the " +
        "settings, described in the next section.",
      `On a first visit the page opens on a saved example, the ${cross.name.toLowerCase()} set, so it is never blank.`,
    ],
  },
  {
    heading: "The question and the answer",
    body: [
      `The page opens on ${CHAPTER_LABELS.overview}, with one question in large type: [[${QUESTION}]] Two sentences answer it.`,
      `The first is about your tickers, with hindsight: what the starting amount became in the ${best}, chosen on these very ` +
        `prices, against the ${even}.`,
      "The second is Mason's published test, without hindsight. If your tickers are exactly one of the three published " +
        "sets, it quotes that set's figures. On any other basket it says what the test found and offers to run it on yours.",
      "A word with a dotted underline, such as [[With hindsight]], opens a short definition when you tap it.",
    ],
  },
  {
    heading: "The two cards",
    body: [
      `The first card draws what the starting amount became in the three mixes and the benchmark, each line named at its end.`,
      "The second, [[Hindsight flatters the optimizer]] on the example, sets each mix's Sharpe ratio in Mason's published " +
        "test fitted with hindsight on the test's whole window (a hollow bar) beside its figure on years it had not seen (a " +
        "solid bar), the same pairs Does it hold up? draws. On a basket that was never published, your bars stand alone, " +
        "with hindsight on this window, and the five mega-caps follow as the reference, under their own name.",
      "Every card has two folds. [[Show the numbers]] opens the figures behind the picture; [[How it is calculated]] opens " +
        "the method.",
      "The second card's numbers open on the highest Sharpe ratio your tickers reached, then four more: [[Equal-Weight " +
        "Sharpe]]; [[Tangency Sharpe (in-sample)]], with a plus-or-minus standard error, a rough sense of how far luck alone " +
        `could move it; [[GMV Sharpe (in-sample)]]; and the benchmark's, such as [[${BENCHMARKS[0].display} Sharpe]]. The small ` +
        "i beside each explains it. Under them is the published sentence as masonjbennett.com prints it. [[Walk-forward " +
        "test]] replays that test, and the last link opens the method note.",
    ],
  },
  {
    heading: "Why, and what to try next",
    body: [
      `Three short facts say why the answer comes out as it does: how much of the ${best} sits in one holding, how far one ` +
        "published weight swung with the years it looked back over, and what the published one-year tests found.",
      "[[Try another basket:]] loads a published set in one tap, or type your own tickers in the bar. The last line says " +
        "who built the page and links its source code, the method note and this guide.",
    ],
  },
];

// ---- the settings -----------------------------------------------------------------------------------------------

export const GUIDE_INPUT_INTRO: readonly string[] = [
  "The settings sit in the basket bar across the top, which stays in view as you scroll: the tickers, the ready-made " +
    `baskets and the dates, then [[${ASSUMPTIONS}]], which opens the rest in a strip under the bar.`,
  "Most changes apply at once, with no button to press. New tickers apply when you press Enter. Only a new basket, new " +
    "dates or a new benchmark fetch prices.",
  "At the bar's right end, [[Prices to]] says which day's closing prices the figures run to. While the saved example " +
    "shows, the word [[example]] sits beside the date until fresh prices arrive.",
];

export const GUIDE_INPUT: Readonly<Record<InputId, readonly string[]>> = {
  tickers: [
    "A ticker is the short code a market uses for an investment: AAPL for Apple, VTI for a fund holding the whole US stock " +
      "market. Each ticker is a chip on the bar, and its cross takes it out.",
    `[[+ Add]] opens a box with the whole list. Type between ${MIN_TICKERS} and ${MAX_TICKERS} codes, separated by commas, ` +
      "and press Enter. The codes are Yahoo Finance's, so funds and indexes work too.",
  ],
  baskets: [
    `[[${INPUT_HEADINGS.baskets}]] fills the list with a ready-made basket. The first three, marked [[Published]], are the sets ` +
      "whose out-of-sample result is published. Here they are recomputed in-sample on the prices loaded, so their figures " +
      "are not the published ones. [[More baskets]] opens the rest.",
  ],
  dates: [
    "The dates on the bar open [[Start]] and [[End]]: the window, the stretch of prices every figure comes from. The end is " +
      "today unless you pick a day; [[End today instead]] puts it back. A new window fetches prices again.",
  ],
  rf: [
    "The risk-free rate is what a safe investment paid over the same time: short-term US Treasury bills. A Sharpe ratio " +
      "counts only the return above it. By default it is the average yield over your window, from FRED, the Federal Reserve " +
      "Bank of St. Louis's public data.",
    "[[Use today's rate instead]] swaps in the latest yield. Typing a rate fixes it there; [[Use the rate over the " +
      "window]] goes back. The note under the field always says which rate is in use.",
  ],
  bench: [
    "The benchmark is what everything is measured against: a broad market index, or a fund that tracks one. The choices " +
      `are ${listed(benchList)}.`,
  ],
  short: [
    "Off, every weight is zero or more: money only goes into an asset. With [[Allow short positions]] on, a weight may go " +
      "below zero. That is a short position: you borrow an asset and sell it, betting its price will fall.",
    "The money from that sale goes into the other assets, so their weights alone can add to more than the whole. All the " +
      "weights together still make the whole. The note under the switch gives the limits. Switching solves the mixes again " +
      "on the prices already loaded.",
  ],
  amount: [
    "The sum every growth chart starts from. It changes the dollar figures only, never a return or a ratio. The growth " +
      "charts carry the same field, and a change in either place moves both. It is kept in this browser and never travels " +
      "in a shared link.",
  ],
};

/** The settings on a phone, where they fold into a sheet. The page prints it straight after the settings' first words. */
export const GUIDE_INPUT_PHONE =
  "On a phone the bar folds into one row at the top that says what is set. Tap [[Settings]] on it to open every setting " +
  "in a sheet.";

// ---- the chapters, and the tabs inside them ----------------------------------------------------------------------

export const GUIDE_CHAPTERS_INTRO: readonly string[] = [
  `The row of five chapters above the question holds the analysis, in reading order: [[${CHAPTER_LABELS.overview}]], ` +
    `[[${CHAPTER_LABELS.performance}]], [[${CHAPTER_LABELS.diversification}]], [[${CHAPTER_LABELS.build}]] and ` +
    `[[${CHAPTER_LABELS.holdup}]]. Everything in them comes from the window and the tickers in the settings.`,
  "Each chapter after the first opens on one sentence in large type that says what it found, then the chart behind it. " +
    "Below that, every further analysis is a row: a title and its finding on one line. A row opens in place to its chart " +
    "or table, and stays open until you reload.",
  `Beside the three mixes there is your own, which the page calls [[Custom]] and you set in [[${CHAPTER_LABELS.build}]]. ` +
    "Where a table has a column per mix, the columns use the finance names: Equal-Weight, GMV, Tangency, Custom.",
];

export const GUIDE_CHAPTERS: Readonly<Record<ChapterId, GuideChapter>> = {
  overview: {
    question: "Where should I start?",
    opens: ["The chapter the page opens on: the question, the answer, two cards and the baskets to try, described above."],
  },
  performance: {
    question: "How did each investment and each mix grow, and how far did they fall?",
    opens: [
      "It opens on where a starting amount ended highest and lowest, and one chart of what it became. The rows on the " +
        "returns come first; the rows on the falls follow, under How deep the falls went.",
    ],
  },
  diversification: {
    question: "Which of the investments moved together?",
    opens: ["One part: how closely each pair moved."],
  },
  build: {
    question: "Which mix would have been best, and how does your own compare?",
    opens: ["It leads with the frontier and your own mix beside it. The tables of the fitted mixes follow as rows."],
  },
  holdup: {
    question: "Would the best mix have done as well without hindsight?",
    opens: [
      "It leads with the published walk-forward test, the project card's sentence under its chart. The rows run the same " +
        "test on your basket, show each published hold, and show how much the fitted weights move with the years they are " +
        "fitted on.",
    ],
  },
};

export const GUIDE_TABS: Readonly<Record<TabId, GuideTab>> = {
  returns: {
    question: "How did each investment grow, and how bumpy was the ride?",
    opens: [
      "The chart shows where a starting amount ended. [[Each asset]] draws one line per investment and the benchmark; " +
        `[[The mixes]] draws the three mixes, your own once you have set one in ${CHAPTER_LABELS.build}, and the benchmark.`,
      "The buttons above the asset lines switch them on and off. The box after [[Growth of $]] is the starting amount, the " +
        "same one as in the settings. [[Show the numbers]] gives each line's end figures, and [[How it is calculated]] says how.",
    ],
    sections: [
      {
        heading: "Calendar years",
        body: ["Each calendar year's return for the four mixes and the benchmark."],
      },
      {
        heading: "Month by month",
        body: [
          "[[Months of]] picks a mix for a grid of every month, shaded from loss to gain. The same months are a table under " +
            "[[Show the numbers]].",
        ],
      },
      {
        heading: "Summary Statistics",
        body: [
          "One row per asset, and a last row for the benchmark. It gives the average yearly return and the volatility, both " +
            "as yearly percentages. Volatility is not a gain or a loss: the higher it is, the further the value tended to " +
            "stray from its average, either way.",
          "Then the worst and best single days, and two measures of shape. Skewness says whether the biggest moves leaned " +
            "toward gains or toward losses. Excess kurtosis above zero means extreme days came more often than a bell curve " +
            "would predict.",
        ],
      },
      {
        heading: "Return Distribution",
        body: [
          "Pick an [[Asset]] to see its daily returns two ways. [[Histogram + Normal Fit]] counts how often each size of move " +
            "happened, beside the bell curve of a normal distribution. The far ends are the tails: the rare big days up and " +
            "down. The title says whether they were fatter than the curve's, which means big days came more often than it allows.",
          "[[Q-Q Plot]] lines the daily returns up from worst to best, each against where the bell curve would put it; the " +
            "page calls those places quantiles. Returns that matched the curve would sit on the straight line. Dots that bend " +
            "away at the ends are days more extreme than the curve allows.",
        ],
      },
    ],
  },
  risk: {
    question: "How far did things fall, and how long did the falls last?",
    opens: [
      `${CHAPTER_LABELS.performance}'s second list of rows. The Drawdowns row names the asset that fell furthest from a ` +
        "high, and when; its chart opens on that asset.",
    ],
    sections: [
      {
        heading: "The portfolios in a fall",
        body: [
          "Pick a mix to list its [[Deepest falls]] in your window: from which high, to which low, how deep, and how long " +
            "it took to get back. [[Named falls in this window]] sets every mix against the same well-known market falls, " +
            "over the same days.",
        ],
      },
      {
        heading: "Drawdowns",
        body: [
          "A drawdown is how far an investment stands below its highest price so far. The chart follows one asset, picked " +
            "above it, day by day. [[Worst drawdown by asset]] lists each asset's deepest, with its dates.",
        ],
      },
      {
        heading: "Rolling volatility",
        body: [
          "Volatility over a moving window of recent trading days, so calm and stormy stretches show as low and high lines. " +
            "The buttons above it set the window's length.",
        ],
      },
      {
        heading: "Risk-adjusted metrics",
        body: [
          "Each asset's Sharpe ratio and Sortino ratio, and the benchmark's. The Sortino ratio is the same idea counting only " +
            "the swings below the safe rate, since few investors mind the swings up.",
        ],
      },
      {
        heading: "CAPM beta and alpha",
        body: [
          "CAPM, the capital asset pricing model, is the textbook idea that part of an asset's return simply follows the " +
            "market. Beta says how much an asset tended to move when the benchmark moved: above one, more; below one, less. " +
            "Alpha is the yearly return left over that the benchmark's moves do not explain.",
          "Both describe this window, not a skill that will carry on. The dashed line at one is the benchmark's own beta.",
        ],
      },
    ],
  },
  correlation: {
    question: "Do these investments rise and fall together?",
    opens: [
      "Correlation runs from minus one (always moving opposite) through zero (unrelated) to plus one (always together). " +
        "Investments that do not move together are what makes spreading money between them worth anything.",
      "The chapter opens on the most and the least correlated pair, and a shaded grid of every pair; the figures are under " +
        "[[Show the numbers]]. Three rows follow.",
    ],
    sections: [
      {
        heading: "Rolling pairwise correlation",
        body: ["Pick two assets and a window length to see how their correlation changed over time, not one figure for the whole window."],
      },
      {
        heading: "Equal weights against each on its own",
        body: [
          `What the ${even} did in your window: how much it swung in a year, against how much the assets swung on average, ` +
            "one by one. The gap is what diversification took away.",
        ],
      },
      {
        heading: "Daily covariance matrix",
        body: [
          "The raw material the optimizer works from: a grid with a row and a column per asset, saying how each pair's daily " +
            "returns moved together. Where an asset meets itself, the figure is how much it swings on its own.",
          "The figures are tiny and hard to read by eye. Correlation divides each by how much the two assets swing, which " +
            "makes it easier to read but drops the size of the swings. The optimizer needs the covariances for exactly that.",
        ],
      },
    ],
  },
  optimization: {
    question: "Which mixes of these assets did best, with hindsight, and where does your own sit?",
    opens: [
      `It opens on the ${best}'s weights and its in-sample Sharpe ratio, against the ${even}'s. Everything fitted here is ` +
        "chosen on the same prices it is scored on.",
      "Then the efficient frontier. Volatility runs across and return up, so a point further left swung less and a point " +
        `higher earned more. Each point on the curve is the least volatile mix for its return; the ${calm} sits at the far ` +
        `left. A straight line from the risk-free rate just touches the curve at the ${best}, which is why its finance name ` +
        "is tangency.",
      "The single assets, the even split and your own mix, [[Custom]], are marked too. The line under the chart's title says " +
        "how far your mix sits from the curve.",
      "Beside it is [[Your mix (Custom)]]: a slider and a box per asset, each starting equal. The page divides every setting " +
        "by their total, so the shares always make the whole; raising one lowers every other. The point on the frontier and " +
        "the five figures under the sliders follow as you move, and [[Reset to equal weights]] appears once you have.",
      "[[Show the numbers]] gives your shares after that division, the ones every figure of your mix uses. Your weights " +
        `travel in the page's link. Your mix is a column of the scorecard below and a line on ${CHAPTER_LABELS.performance}'s ` +
        "growth chart.",
    ],
    sections: [
      {
        heading: "Scorecard",
        body: [
          "Every mix in one table, a column each: [[Equal-Weight]], [[GMV]], [[Tangency]], your mix as [[Custom]], and the " +
            "benchmark last. Its rows give return, risk, the falls, how the mix moved with the benchmark, and how fragile its " +
            "weights are. The main ones are return, volatility, the Sharpe and Sortino ratios and the maximum drawdown, its " +
            "deepest fall.",
          "The two fitted columns say [[weights chosen on this window]]; under How it is calculated, [[The walk-forward " +
            "test]] opens what such weights earned on later years. The buttons above add other ways of building a mix, such " +
            "as [[Risk parity]]. [[Show every row]] shows the rows left out at first, and [[What each row means]] explains each.",
          "Beside the usual downloads, [[Download Excel, with formulas]] gives a workbook that rebuilds most of the scorecard " +
            "as spreadsheet formulas from the closing prices. The fitted weights go in as plain numbers, and a few rows are " +
            "left out; the workbook's first sheet names them.",
        ],
      },
      {
        heading: "What each mix holds",
        body: [
          "How much of the money each mix puts in each asset, as bars. Under [[Show the numbers]] the same weights are a table, " +
            "with your mix and any column added to the scorecard beside them.",
        ],
      },
      {
        heading: "If the averages were a little off",
        body: [
          "The means are the assets' average returns. Their noise is how far those averages, worked out from a limited stretch " +
            "of prices, could be off by chance. The page redraws the averages many times within that noise and solves the mix " +
            "again each time, a dot per draw, to show how far its weights could swing. [[Redraw]] draws a fresh set.",
        ],
      },
      {
        heading: "Risk contribution",
        body: [
          "Pick a mix to compare each asset's share of its money with its share of the return and of the risk. A small weight " +
            "in a volatile asset can carry a large share of the risk. The table under [[Show the numbers]] sets every mix's " +
            "shares side by side.",
        ],
      },
      {
        heading: "What if one expected return were different?",
        body: [
          "This row opens [[What-if on these prices]]. Pick an asset, then slide its expected return, the average yearly " +
            "return the optimizer assumes it earns, [[up to two standard errors either side of its average]]. At each step " +
            `the ${best} is solved again, and the sentence prints its new weight in that asset. The ${calm} never moves, ` +
            "because it does not use expected returns at all.",
          "Why do fitted weights swing so much? The optimizer must estimate, from the prices, each asset's average return, " +
            "how much it swings and how each pair moves together. The lines under the slider count those estimates, and say " +
            "how many years of prices it would take to pin one average down. That is usually far more than the window holds, " +
            "so each estimate is rough, and a small change in one can move the weights a lot.",
        ],
      },
    ],
  },
  sensitivity: {
    question: "How much do the chosen weights depend on which years they were chosen from?",
    opens: [
      `Its rows, under [[If the fitting window changed]], fit the ${calm} and the ${best} again on several windows. All of ` +
        "them end on the last day; they run from the most recent year back to the whole window.",
    ],
    sections: [
      {
        heading: "Weights across windows",
        body: [
          "The row's line says how far one asset's weight moves between windows. Open it for a bar per window for each " +
            "asset's weight. The switch above the chart moves between [[GMV]] and [[Tangency]], and [[Show the numbers]] " +
            "holds the weights as tables. Weights that jump between windows depend heavily on which years were used.",
        ],
      },
      {
        heading: "Portfolio metrics across windows (in-sample)",
        body: ["Each window's mix, scored on that same window's prices."],
      },
      {
        heading: "Your mix across windows (Custom)",
        body: ["Your own mix, held fixed, scored on each window too, beside the two fitted mixes chosen there."],
      },
    ],
  },
  walkforward: {
    question: "What did a fitted mix earn on days it had not seen?",
    opens: [
      "This is the out-of-sample test. Weights are chosen on earlier prices and held unchanged for a stretch called a hold. " +
        "Then they are chosen again on everything up to that point and held again, to the end. Only the returns earned " +
        "during the holds count.",
    ],
    sections: [
      {
        heading: "In-sample against out-of-sample",
        body: [
          "For each mix, the Sharpe ratio on the prices it was chosen from, beside the one it earned afterwards. The distance " +
            "between them is what hindsight was worth. The chapter leads with the published test's three sets this way, the " +
            "project card's sentence and the method note under the chart.",
          "[[Show the numbers]] holds the published figures in one table, and [[How it is calculated]] the rules of the " +
            "published run.",
        ],
      },
      {
        heading: "Your basket: the same test, run now",
        body: [
          "The test on the tickers in your settings, solved when the row opens. [[Fit on]] sets what each choice of weights " +
            "may look at, [[All prior history]] or only the most recent stretch. [[Hold for]] sets how long each hold lasts.",
          "Both count in returns. There is one daily return per trading day, so a count of returns is a count of trading " +
            "days. [[Add the four other constructions]] adds the scorecard's other ways of building a mix.",
        ],
      },
      {
        heading: "Hold by hold",
        body: [
          "In your basket's row: each hold's dates and the Sharpe ratio each mix earned in it. Under them, [[Weights of]] " +
            "picks a fitted mix to show the weights it held in each hold.",
        ],
      },
      {
        heading: ["Hold by hold, as published", ...PUBLISHED_SETS.map((s) => s.name)],
        body: [
          "One part per published set: each hold, and the weights the two fitted mixes held. [[Rerun this set on fresh " +
            "prices]] puts that set into your settings, on the published run's dates and rate with short selling off, and " +
            "opens your basket's row to run the test again on prices fetched now.",
        ],
      },
      {
        heading: "Range of outcomes: these years reshuffled",
        body: [
          "Your window's own months in a new order. Its daily returns are cut into runs of about a month, every asset and " +
            "the benchmark on the same days, and strung together again at random, many times over. The line is the " +
            "median path; the band holds eight paths in ten. [[Years ahead]] sets how far out, never further than the " +
            "window is long.",
          "It is a spread under that one assumption, not a forecast. The best-tradeoff mix is left out: its weights come " +
            "from the same months' average returns, so reshuffling them would replay the hindsight the test measures.",
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
        "press Escape to close it. It explains three ways: in plain words, in finance terms and as the formula.",
      "Under a part's opening sentence, [[The formula]] opens the formula behind that sentence's figure, with the page's own " +
        "numbers in it.",
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
        "short selling, your custom weights and the chapter. Send it and the other person opens the same analysis, on the " +
        "latest prices unless you set an end date. The starting amount stays behind.",
    ],
  },
  {
    heading: "The keyboard",
    body: [
      "Press Ctrl and K together (Command and K on a Mac) for a small box that opens a chapter, a part of one or this guide " +
        "as you type its name.",
    ],
  },
];

// ---- the glossary -----------------------------------------------------------------------------------------------
//
// The guide's own terms. The figures the page explains with an i mark are listed after these, in the marks' own
// Plain words (src/content/tooltips.ts and the Walk-forward tab's), so the glossary cannot disagree with them.

export const GUIDE_TERMS: readonly GuideTerm[] = [
  { term: "Annualised", text: `Turned into a yearly figure. The page counts a year as ${TRADING_DAYS} trading days.`, find: "annual" },
  { term: "Basket", text: "The set of tickers in the settings: the investments every figure is about." },
  { term: "Benchmark", text: "What everything is measured against: a broad market index, or a fund that tracks one. No weights are chosen for it; it is there to compare with." },
  {
    term: "Capital allocation line",
    text: `On the efficient frontier chart, the straight line from the risk-free rate through the ${best}: every split between the safe rate and that mix.`,
  },
  { term: "Construction", text: `A rule for building a mix from the prices: the ${even}, the ${calm}, the ${best}, and the others the scorecard can add.` },
  {
    term: "Correlation",
    text: "How closely two sets of daily returns move together, from minus one (always opposite) to plus one (always together).",
  },
  {
    term: "Covariance",
    text: "How two sets of daily returns move together, including how big their swings were. The optimizer works from these, one for every pair.",
  },
  { term: "Drawdown", text: "How far an investment or a mix stands below its highest value so far." },
  {
    term: "Efficient frontier",
    text: "The curve of the least volatile mix for each level of return. A mix below it could have had less risk for the same return.",
  },
  {
    term: "Equal weight",
    text: `The ${even}: the same share of the money in every asset, kept even each day. Nobody looked at the prices to choose it, which makes it the fair yardstick.`,
    find: "Equal-Weight",
  },
  {
    term: "Estimation window",
    text: `The stretch of prices the weights are chosen from; the page also calls it a lookback. ${CHAPTER_LABELS.holdup} changes it to show how much it matters.`,
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
    text: `Global minimum variance: the ${calm}, whose value swung least over the window. Choosing it uses how the returns swing and move together, never their averages.`,
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
  { term: "Rebalanced", text: "Bought and sold back to the target weights. Every mix on the page is rebalanced daily." },
  {
    term: "Return",
    text: "How much an investment gained or lost, as a share of what was put in. A daily return is one day's change.",
  },
  {
    term: "Risk contribution",
    text: "An asset's share of a mix's risk, which can be far from its share of the money.",
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
    text: `The ${best}: the mix with the highest Sharpe ratio over the window, chosen with hindsight. Also called the maximum-Sharpe portfolio.`,
  },
  { term: "Ticker", text: "The short code a market uses for an investment, such as AAPL for Apple." },
  { term: "Trading day", text: "A day the market was open. Weekends and market holidays have no prices." },
  { term: "Volatility", text: "How much returns swing about their average, as a yearly figure. The page's usual measure of risk." },
  {
    term: "Walk-forward test",
    text: "Choosing weights on earlier prices, holding them over later ones, and repeating to the end: an out-of-sample test.",
    find: "Walk-forward",
  },
  { term: "Weight", text: "The share of a mix's money in one asset. A mix's weights add up to the whole." },
];

/** The words before the info marks' half of the glossary. */
export const GUIDE_MARKS_INTRO: readonly string[] = [
  "The page explains these figures in the small i mark beside each one, or under How it is calculated. Here is each in " +
    "plain words; the page also gives it in finance terms and as the formula.",
];

// ---- how the figures are computed -------------------------------------------------------------------------------

export const GUIDE_METHOD =
  "Every formula and data source is listed under [[Methodology]] at the foot of the page, and of this guide. The code is " +
  "public, linked beside it.";

// The structure the suite holds to the page, exported for it: the chapter and tab ids in the guide's order, the settings
// groups in the guide's order.
export const GUIDE_CHAPTER_IDS: readonly ChapterId[] = CHAPTER_IDS.filter((id) => Object.hasOwn(GUIDE_CHAPTERS, id));
export const GUIDE_TAB_IDS: readonly TabId[] = TAB_IDS.filter((id) => Object.hasOwn(GUIDE_TABS, id));
export const GUIDE_INPUT_IDS: readonly InputId[] = INPUT_IDS.filter((id) => Object.hasOwn(GUIDE_INPUT, id));
