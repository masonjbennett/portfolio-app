// The range of outcomes in src/lib/simulate.ts: the block bootstrap behind Does it hold up?'s "Range of outcomes" row.
//
// What it pins (handoff-montecarlo.md, Session A):
//   (a) a path's rows are blocks of BLOCK_DAYS contiguous rows inside the window, cut short only at the end;
//   (b) the blocks are JOINT: every line on a path reads the same rows, so two lines on the same returns end the same,
//       path by path, and a mix, its own asset and the benchmark stay on the same days;
//   (c) the horizon is capped at the window's length: never a year further out than the data;
//   (d) a fixed seed gives identical percentiles twice, and another seed gives others;
//   (e) on a constant-return series the fan collapses to a line, at the compounded value;
//   (f) on the frozen example the median ending sits near the bootstrap's own mean growth (the mean daily log return
//       of the rows as the blocks weight them, compounded over the horizon);
//   (g) no hindsight weights reach the fan: on a basket whose in-window tangency differs from both simulated mixes,
//       no simulated line carries it, and the fan is the one the equal split and the lowest-risk mix give;
//   (h) the row's words: the finding is twenty words or fewer, the chart's title fourteen and its sub-line twenty-five
//       (redesign 5b), the band is called eight in ten (the 10th to the 90th), and nothing calls it a forecast,
//       a prediction or an expected value.
// Each assertion was mutation-tested: the defect it names reintroduced in simulate.ts, and this suite required to fail.
import { check, done, near } from "./_assert.mjs";
import { exampleAnalysis, fixtureAnalysis } from "./_analysis.mjs";

const S = await import("../src/lib/simulate.ts");
const { mulberry32, DEFAULT_SEED } = await import("../src/lib/rng.ts");
const { portfolioReturns } = await import("../src/lib/portfolio.ts");
const { TRADING_DAYS } = await import("../src/lib/stats.ts");

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bands = (fan) => fan.lines.map((l) => [l.p10, l.p50, l.p90]);
// A return series with no pattern a block could copy by accident: seeded, about 1% a day.
const noise = (n, seed) => {
  const u = mulberry32(seed);
  return Array.from({ length: n }, () => (u() - 0.5) * 0.02);
};

// (a) contiguous blocks inside the window
{
  const rows = 600;
  const days = 3 * TRADING_DAYS - 5; // not a whole number of blocks, so the last one is cut short
  const idx = S.blockRows(rows, days, mulberry32(7));
  let inside = true;
  let contiguous = true;
  for (let d = 0; d < days; d++) {
    if (idx[d] < 0 || idx[d] >= rows) inside = false;
    if (d % S.BLOCK_DAYS !== 0 && idx[d] !== idx[d - 1] + 1) contiguous = false;
  }
  check(idx.length === days, "blocks: a path has exactly the horizon's rows");
  check(inside, "blocks: every row lies inside the window");
  check(contiguous, "blocks: inside a block the rows run on one by one, 21 at a time");
  const starts = new Set();
  for (let d = 0; d < days; d += S.BLOCK_DAYS) starts.add(idx[d]);
  check(starts.size > (days / S.BLOCK_DAYS) * 0.8, "blocks: the block starts are drawn afresh, not one block repeated", `${starts.size} starts`);
  // the last start can reach the window's end: a block ending on the last row is possible
  let reach = 0;
  const u = mulberry32(11);
  for (let i = 0; i < 5000; i++) reach = Math.max(reach, ...S.blockRows(rows, S.BLOCK_DAYS, u));
  check(reach === rows - 1, "blocks: a block can end on the window's last row, and none runs past it", `max ${reach}`);
}

// (b) joint: the same rows for every line
{
  const x = noise(800, 3);
  const y = noise(800, 5);
  const fan = S.simulate([{ key: "a", r: x }, { key: "b", r: x.slice() }, { key: "c", r: y }], 1, { paths: 300 });
  const [a, b, c] = fan.lines.map((l) => l.endings);
  check(a.every((v, p) => v === b[p]), "joint: two lines on the same returns end the same on every path");
  check(!a.every((v, p) => v === c[p]), "joint: a line on other returns ends elsewhere (the check above can fail)");
  // through the page's own lines: a mix of two copies of one asset, the lowest-risk mix all in it, and a benchmark that
  // IS that asset all read the same rows, so all three end the same on every path
  const lines = S.outcomes({ returns: [x, x.slice()], bench: x.slice(), ew: [0.5, 0.5], gmv: { w: [1, 0] } }, 1, { paths: 300 }).lines;
  const e = lines.map((l) => l.endings);
  check(lines.map((l) => l.key).join() === "ew,gmv,bench", "joint: the page's lines are the equal split, the lowest-risk mix and the benchmark");
  check(e[0].every((v, p) => Math.abs(v - e[1][p]) < 1e-9 && Math.abs(v - e[2][p]) < 1e-9),
    "joint: every asset and the benchmark come from the same days on a path");
}

// (c) the horizon cap
{
  check(same(S.horizonsFor(3 * TRADING_DAYS), [1, 3]), "cap: a three-year window offers 1 and 3 years, never 5");
  check(same(S.horizonsFor(3 * TRADING_DAYS - 1), [1]), "cap: one row short of three years offers only 1");
  check(same(S.horizonsFor(TRADING_DAYS - 1), []), "cap: under a year offers nothing");
  check(S.horizonFor(2 * TRADING_DAYS) === 1 && S.horizonFor(10 * TRADING_DAYS) === S.DEFAULT_HORIZON && S.horizonFor(100) === null,
    "cap: the default 3 years falls back to the longest the window allows, and to none under a year");
  const short = { returns: [noise(400, 1)], bench: noise(400, 2), ew: [1], gmv: null };
  check(S.outcomes(short, 3) === null && S.outcomes(short, 1) !== null, "cap: no fan further out than the data");
  let threw = false;
  try {
    S.simulate([{ key: "a", r: noise(400, 1) }], 3);
  } catch {
    threw = true;
  }
  check(threw, "cap: simulate itself refuses a horizon longer than its rows");
  const a = exampleAnalysis();
  check(S.horizonsFor(a.bench.length).every((h) => h * TRADING_DAYS <= a.bench.length), "cap: the example's horizons all fit its window");
}

// (d) a fixed seed
{
  const a = exampleAnalysis();
  const h = S.horizonFor(a.bench.length);
  const one = S.outcomes(a, h);
  const two = S.outcomes(a, h);
  const other = S.outcomes(a, h, { seed: DEFAULT_SEED + 1 });
  check(same(bands(one), bands(two)), "seed: the same seed gives identical percentiles twice");
  check(!same(bands(one), bands(other)), "seed: another seed gives other percentiles");
  check(one.paths === S.PATHS && one.months.length === 12 * h + 1, "seed: 2,000 paths, read once a month from the start");
  check(one.lines.every((l) => l.p50[0] === S.START && l.p10[0] === S.START), "seed: every path starts at $10,000");
}

// (e) constant returns collapse the fan
{
  const r = new Array(800).fill(0.0004);
  const fan = S.simulate([{ key: "c", r }], 3, { paths: 200 });
  const l = fan.lines[0];
  const flat = l.p10.every((v, i) => Math.abs(v - l.p90[i]) < 1e-9 && Math.abs(v - l.p50[i]) < 1e-9);
  check(flat, "constant: the 10th, 50th and 90th percentiles are one line");
  near("constant: the line is $10,000 compounded at the constant rate", l.p50[l.p50.length - 1], S.START * 1.0004 ** (3 * TRADING_DAYS), 1e-9);
  near("constant: a checkpoint a month in", l.p50[1], S.START * 1.0004 ** S.CHECK_DAYS, 1e-9);
}

// (f) the median sits near the bootstrap's own mean growth
{
  const a = exampleAnalysis();
  for (const h of S.horizonsFor(a.bench.length)) {
    const fan = S.outcomes(a, h);
    for (const line of fan.lines) {
      const r = line.key === "bench" ? a.bench : portfolioReturns(a.returns, line.key === "ew" ? a.ew : a.gmv.w);
      // The bootstrap's own mean: each row weighted by how many block starts cover it (the moving blocks draw the
      // window's first and last 20 rows less often than the rest), not the window's plain mean.
      const T = r.length;
      const L = S.BLOCK_DAYS;
      let wsum = 0;
      let lsum = 0;
      for (let t = 0; t < T; t++) {
        const cover = Math.min(t, T - L) - Math.max(0, t - L + 1) + 1;
        wsum += cover;
        lsum += cover * Math.log1p(r[t]);
      }
      const logMean = lsum / wsum;
      const growth = S.START * Math.exp(fan.days * logMean);
      const got = line.p50[line.p50.length - 1];
      // Tolerance: the spread of a path's log ending is about sd * sqrt(days); the sample median of 2,000 paths sits
      // about 0.03 of that spread from the median it estimates (1.25 / sqrt(2000)); 0.1 allows for the blocks' autocorrelation.
      const sd = Math.sqrt(r.reduce((s, x) => s + (Math.log1p(x) - logMean) ** 2, 0) / r.length) * Math.sqrt(fan.days);
      check(Math.abs(Math.log(got / growth)) < 0.1 * sd,
        `median: ${line.key} over ${h} year(s) ends near the window's mean growth`, `median ${got.toFixed(0)} growth ${growth.toFixed(0)} sd ${sd.toFixed(3)}`);
      const sorted = line.endings.slice().sort();
      check(Math.abs(sorted[Math.floor(S.PATHS / 2)] - got) / got < 0.01, `median: ${line.key}'s last checkpoint is its paths' ending`);
    }
  }
}

// (g) no hindsight weights reach the fan
{
  // A basket where the tangency, fitted on the same window the bootstrap resamples, is unlike both simulated mixes.
  const a = fixtureAnalysis("cross");
  const tan = a.tangency?.w;
  const far = (w) => w.reduce((s, x, i) => s + Math.abs(x - tan[i]), 0) > 0.2;
  check(!!tan && far(a.ew) && far(a.gmv.w), "hindsight: the case is one where the in-window tangency differs from both mixes");
  const lines = S.outcomeLines(a);
  check(!lines.some((l) => l.w && !far(l.w)), "hindsight: no simulated line carries the in-window tangency's weights");
  check(same(lines.map((l) => l.key), ["ew", "gmv", "bench"]), "hindsight: the simulated mixes are the equal split and the lowest-risk mix only");
  check(same(lines[1].w, a.gmv.w) && same(lines[0].w, a.ew), "hindsight: their weights are the analysis' own equal and minimum-variance weights");
  const fan = S.outcomes(a, 1, { paths: 400 });
  const tanFan = S.simulate([{ key: "tan", r: portfolioReturns(a.returns, tan) }], 1, { paths: 400 });
  check(fan.lines.every((l) => !same(l.p50, tanFan.lines[0].p50)), "hindsight: no line of the fan is the tangency's fan");
}

// (h) the row's words
{
  const O = await import("../src/tabs/walkforward/outcomes.ts");
  const { readFileSync } = await import("node:fs");
  const words = (x) => x.trim().split(/\s+/).length;
  for (const a of [exampleAnalysis(), fixtureAnalysis("cross")]) {
    const finding = O.outcomesFinding(a);
    check(words(finding) <= 20 && /eight times in ten/.test(finding) && finding.includes("$10,000"),
      "words: the row's finding is twenty words or fewer and calls the band eight in ten", `${words(finding)}: ${finding}`);
    const b = O.endBand(O.fanOf(a, O.rowHorizons(a).first), "ew");
    check(finding.includes(`$${Math.round(b.lo).toLocaleString("en-US")}`) && finding.includes(`$${Math.round(b.hi).toLocaleString("en-US")}`),
      "words: the finding's figures are the equal split's 10th and 90th percentile endings");
    for (const h of S.horizonsFor(a.bench.length)) {
      const fan = O.fanOf(a, h);
      check(words(O.outcomesTitle(fan)) <= 14 && words(O.outcomesSub(a, fan)) <= 25,
        `words: the chart's title and sub-line fit the card's budget at ${h} year(s)`, `${O.outcomesTitle(fan)} | ${O.outcomesSub(a, fan)}`);
    }
  }
  const short = { ...exampleAnalysis() };
  short.bench = short.bench.slice(0, 200);
  check(/^Not simulated/.test(O.outcomesFinding(short)), "words: under a year the row says it simulated nothing");
  const src = ["src/tabs/walkforward/outcomes.ts", "src/tabs/walkforward/Outcomes.tsx"].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
  // The code, not its comments: the comments name the words the page must not use.
  const page = src.map((t) => t.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n")).join("\n");
  check(!/predict|expected|forecast/i.test(page.replace(/not a forecast/g, "")),
    "words: nothing on the row says forecast, predict or expected (\"not a forecast\" aside)");
  check(!/nine times in ten|nine paths in ten/.test(page), "words: the 10th-90th band is never called nine in ten");
}

done("t-simulate");
