// The scorecard (src/tabs/optimization/scorecard.ts, src/components/Scorecard.tsx), the money, return and
// risk shares (src/tabs/optimization/model.ts), and the redraw dot strips (src/tabs/optimization/DotStrips.tsx,
// redraws.ts).
//
// The engine's own suites (t-metrics against numpy, t-robust against the shipping solvers) hold the
// arithmetic. This suite holds the page to the engine: every cell the scorecard prints is the engine's
// function called directly on that column's daily returns, bit for bit, on the baked example and on the
// mega-cap fixture, long-only and with shorting. Then the layout: the column order, the benchmark behind a
// heavier rule, the short and full views, the caption's window and conventions, equal weight's zero
// fragility rows printed as zero, a negative return share printed as it is and named, and the dot strips
// drawn from the fixed seed the first time, the same on every run, then the next seed on Redraw.
import { act, render, text } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { exampleAnalysis, fixtureAnalysis, tabProps } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const SC = await import("../src/tabs/optimization/scorecard.ts");
const M = await import("../src/tabs/optimization/model.ts");
const { seedOf, solveRedraws } = await import("../src/tabs/optimization/redraws.ts");
const { stripRows } = await import("../src/tabs/optimization/DotStrips.tsx");
const Scorecard = (await import("../src/components/Scorecard.tsx")).default;
const Optimization = (await import("../src/tabs/Optimization.tsx")).default;
const Custom = (await import("../src/tabs/Custom.tsx")).default;
const { scorecardRow, returnShare } = await import("../src/lib/stats.ts");
const { fragility, REDRAWS } = await import("../src/lib/robust.ts");
const { DEFAULT_SEED } = await import("../src/lib/rng.ts");
const { portfolioReturns, riskContribution } = await import("../src/lib/portfolio.ts");
const { fitWindows } = await import("../src/tabs/sensitivity/model.ts");
const { format, DASH, MINUS } = await import("../src/format.ts");
const { worksheet, csvText } = await import("../src/download.ts");
const { tipText, isScoreTip } = await import("../src/content/tooltips.ts");
const { FITTED } = await import("../src/tabs/caption.ts");

const quiet = (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};
// Lets the post-paint redraw effect run: its setTimeout, then React's update.
const settle = async () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));
const same = (x, y) => Object.is(x, y) || (x === null && y === null);
const LEVELS = ["plain", "finance", "formula"];

const baskets = [];
for (const [name, make] of [
  ["example", (o) => exampleAnalysis(o)],
  ["megacap", (o) => fixtureAnalysis("megacap", o)],
]) {
  for (const allowShort of [false, true]) baskets.push({ label: `${name}${allowShort ? " short" : ""}`, a: make({ allowShort }) });
}

// ---- (a) every cell is the engine's function ----------------------------------------------------------
for (const { label, a } of baskets) {
  const tag = (s) => `${label}: ${s}`;
  const raw = Object.fromEntries(a.tickers.map((t, i) => [t, i + 1]));
  const c = M.customWeights(a, raw);
  const rd = solveRedraws(a, DEFAULT_SEED);
  check(rd.status === "ready" && rd.value && rd.value.seed === DEFAULT_SEED, tag("the redraws solve on the fixed seed"));
  const m = SC.scorecard(a, c, rd);

  // Column order, labels and the fitted sub-line.
  check(m.columns.map((x) => x.id).join() === "ew,gmv,tangency,custom,bench", tag("scorecard: column order is EW, GMV, Tangency, Custom, then the benchmark"), m.columns.map((x) => x.id).join());
  check(m.columns[4].label === a.benchLabel && m.columns.map((x) => x.sub).join("|") === `|${FITTED}|${FITTED}||`,
    tag("scorecard: the benchmark under its display name; only GMV and Tangency say weights chosen on this window"));

  // The expected figures, from the engine directly.
  const start = a.prices.dates[0];
  const fits = fitWindows(a).value;
  const wOf = { ew: a.ew, gmv: a.gmv?.w, tangency: a.tangency?.w, custom: c.ok ? c.w : null };
  const kind = { ew: "ew", gmv: "gmv", tangency: "tan", custom: "custom" };
  const expected = m.columns.map(({ id }) => {
    if (id === "bench") return { row: scorecardRow(a.bench, a.bench, a.dates, start, a.rf), frag: null };
    const w = wOf[id];
    if (!w) return { row: null, frag: null };
    const lookbacks = id === "gmv" ? fits.map((f) => f.gmv?.w ?? null) : id === "tangency" ? fits.map((f) => f.tan?.w ?? null) : [];
    return {
      row: scorecardRow(portfolioReturns(a.returns, w), a.bench, a.dates, start, a.rf),
      frag: fragility(kind[id], { m: a.m, S: a.S, rf: a.rf, allowShort: a.allowShort, T: a.dates.length, lookbacks, redraws: rd.value }),
    };
  });
  const bad = [];
  for (const line of m.lines) {
    line.cells.forEach((cell, k) => {
      const want = line.metric.value(expected[k]);
      if (!same(cell.value, want)) bad.push(`${line.metric.id}/${m.columns[k].id}: ${cell.value} vs ${want}`);
      if (line.metric.se && !same(cell.se, expected[k].row ? expected[k].row.sharpeSE : null)) bad.push(`${line.metric.id} SE/${m.columns[k].id}`);
    });
  }
  check(bad.length === 0, tag("scorecard: every cell equals the engine's scorecardRow or fragility on that column, bit for bit"), bad.slice(0, 4).join("; "));
  // The value extractors read the fields they are named for (a swapped pair would pass the loop above).
  const ewRow = expected[0].row;
  const cell = (id, k = 0) => m.lines.find((l) => l.metric.id === id).cells[k].value;
  check(cell("annual") === ewRow.annualReturn && cell("mean") === ewRow.mu && cell("cumulative") === ewRow.cumulative && cell("best") === ewRow.bestMonth &&
    cell("worst") === ewRow.worstMonth && cell("vol") === ewRow.volatility && cell("downside") === ewRow.downside && cell("mdd") === ewRow.maxDrawdown &&
    cell("longest") === ewRow.longest.trading && cell("longestCal") === ewRow.longest.calendar && cell("sharpe") === ewRow.sharpe &&
    cell("sortino") === ewRow.sortino && cell("calmar") === ewRow.calmar && cell("beta") === ewRow.beta && cell("alpha") === ewRow.alphaAnn &&
    cell("corr") === ewRow.correlation && cell("r2") === ewRow.r2 && cell("te") === ewRow.trackingError && cell("ir") === ewRow.informationRatio &&
    cell("up") === ewRow.upCapture && cell("down") === ewRow.downCapture && cell("var") === ewRow.var95 && cell("es") === ewRow.es95 && cell("positive") === ewRow.positiveMonths,
    tag("scorecard: each row reads the field it is named for"));
  // The Sharpe cell prints its standard error beside it.
  const sh = m.lines.find((l) => l.metric.id === "sharpe");
  check(SC.cellText(sh.cells[0], "num3") === `${format(ewRow.sharpe, "num3")} ± ${format(ewRow.sharpeSE, "num3")}` && Number.isFinite(ewRow.sharpeSE) && ewRow.sharpeSE > 0,
    tag("sharpe-se: every Sharpe prints plus or minus one standard error from the engine"), SC.cellText(sh.cells[0], "num3"));

  // Equal weight and a typed mix: rows 1-3 are zero and printed, params 0; the benchmark has no fragility.
  const frag = (id) => m.lines.find((l) => l.metric.id === id).cells;
  check(["lookback", "cut", "draws"].every((id) => frag(id)[0].value === 0 && frag(id)[3].value === 0) && frag("params")[0].value === 0 && frag("params")[3].value === 0,
    tag("fragility: equal weight and the custom mix read zero on every fragility row"));
  check(["lookback", "cut", "draws", "params"].every((id) => frag(id)[4].value === null), tag("fragility: the benchmark column has no fragility rows"));
  check(frag("params")[1].value === (a.tickers.length * (a.tickers.length + 1)) / 2 && frag("params")[2].value === a.tickers.length + (a.tickers.length * (a.tickers.length + 1)) / 2,
    tag("fragility: parameters estimated, GMV n(n+1)/2 and tangency n more"));
  check(frag("lookback")[2].value > 0 && frag("draws")[2].value > 0, tag("fragility: the tangency column's rows are live, not zero"));

  // Return share: the engine's returnShare per portfolio, and the three shares side by side.
  const pt = M.prcTable(a, c).value;
  const rs = returnShare(a.ew, a.m).share;
  check(pt.rows.every((r, i) => r.ewRet === rs[i] && r.ewW === a.ew[i] && r.ewPrc === riskContribution(a.ew, a.S)[i]) &&
    pt.rows.every((r, i) => r.cuRet === returnShare(c.w, a.m).share[i]),
    tag("return-share: the table's return share is the engine's, beside weight and PRC, for equal weight and the custom mix"));
  check(pt.columns.length === 13 && pt.columns.slice(1, 4).map((x) => x.label).join("|") === "Equal-Weight Weight|Equal-Weight Return share|Equal-Weight PRC",
    tag("return-share: four portfolios, three shares each"), pt.columns.map((x) => x.label).join("|"));
}

// ---- (b) a negative return share, printed as it is and named ------------------------------------------
{
  // On the real example with shorting on, the tangency's short positions carry negative return shares.
  const s = exampleAnalysis({ allowShort: true });
  const sn = M.shareNote(s, M.customWeights(s, {})) ?? "";
  const trs = returnShare(s.tangency.w, s.m).share;
  const tneg = trs.findIndex((x) => x < 0);
  check(tneg >= 0 && sn.includes(`${s.tickers[tneg]} in Tangency (${format(trs[tneg], "pct1")})`),
    "return-share: on the example with shorting on, a short position's negative share is named as it is", sn);
  // And a basket where one asset's mean return is negative: equal weight's share of it goes below zero.
  const e = exampleAnalysis();
  const a = { ...e, m: e.m.map((x, i) => (i === 1 ? -3 * Math.abs(x) : x)) };
  const c = M.customWeights(a, {});
  const rs = returnShare(a.ew, a.m).share;
  const neg = rs.findIndex((x) => x < 0);
  check(neg === 1, "return-share: an asset with a negative mean return has a negative share under equal weight", rs.join(","));
  const note = M.shareNote(a, c) ?? "";
  check(note.includes(`${a.tickers[neg]} in Equal-Weight (${format(rs[neg], "pct1")})`) && format(rs[neg], "pct1").startsWith(MINUS) && /took from the portfolio's return/.test(note),
    "return-share: a negative share is printed with its sign, named with its portfolio and explained, never clipped", note);
  const bars = M.shareBars(a, c, "ew").value;
  check(bars.series.map((s) => s.label).join() === "Weight,Return share,Risk share" && bars.groups[neg].values[1] === rs[neg],
    "return-share: the chart draws the negative share as it is");
  const zero = { ...a, m: a.m.map(() => 0) };
  check(M.prcTable(zero, c).value.rows.every((r) => r.ewRet === null) && /no return share is defined/.test(M.shareNote(zero, c) ?? ""),
    "return-share: a portfolio with a zero mean return has no share and says so");
}

// ---- (c) the component: order, heavier rule, views, caption, tips ---------------------------------------
{
  const a = exampleAnalysis();
  const c = M.customWeights(a, {});
  const rd = solveRedraws(a, DEFAULT_SEED);
  const m = SC.scorecard(a, c, rd);
  const r = quiet(() => render(h(Scorecard, { model: m, redraws: rd, level: "plain", allowShort: false, filename: "scorecard" })));
  const heads = [...r.container.querySelectorAll("thead th")];
  check(heads.map((th) => th.dataset.col ?? "label").join() === "label,ew,gmv,tangency,custom,bench", "scorecard: the rendered columns in order, the benchmark last");
  const benchCells = [...r.container.querySelectorAll(".sc-bench")];
  check(benchCells.length > 0 && benchCells.every((el) => el.matches("th:last-child, td:last-child")) && r.container.querySelectorAll("tbody tr:not(.sc-group) td:last-child:not(.sc-bench)").length === 0,
    "scorecard: every benchmark cell, and only those, carries the heavier rule");
  const css = readFileSync(new URL("../src/components/Scorecard.css", import.meta.url), "utf8");
  check(/\.sc \.sc-bench \{[^}]*border-left: var\(--line-bar\) solid/.test(css), "scorecard: the heavier rule is the bar-weight line, not a hairline");
  // jsdom lays nothing out, so the phone rule is read from the sheet: under the 760px query the frozen label
  // column wraps inside a bounded width, and the conventions line is held to the screen.
  {
    const phone = css.slice(css.indexOf("@media (max-width: 760px)"));
    check(css.includes("@media (max-width: 760px)") && /\.sc tbody tr:not\(\.sc-group\) th\.first \{[^}]*white-space: normal;[^}]*max-width: [\d.]+em;/.test(phone)
      && /\.sc \.sc-conv \{[^}]*max-width: calc\(100vw/.test(phone),
      "scorecard: on a phone the frozen label column wraps inside a bounded width, so the figures beside it stay in view");
  }

  const shown = () => [...r.container.querySelectorAll("tbody tr[data-metric]")];
  const nShort = SC.SCORE_METRICS.filter((x) => x.short).length;
  check(shown().length === nShort && nShort >= 10 && nShort <= 14 && shown().every((tr) => tr.classList.contains("sc-short")),
    "views: the short view shows about a dozen rows, every one bold", `${shown().length}`);
  check([...r.container.querySelectorAll("tbody[data-group]")].map((g) => g.dataset.group).join() === "return,risk,adjusted,relative,tail,fragility",
    "views: the row groups in order: Return, Risk, Risk-adjusted, Against the benchmark, Tail, Fragility");
  const toggle = r.container.querySelector(".sc-toggle");
  check(text(toggle) === "Show every row" && toggle.getAttribute("aria-pressed") === "false", "views: the full view is one click away");
  act(() => toggle.click());
  check(shown().length === SC.SCORE_METRICS.length && shown().filter((tr) => tr.classList.contains("sc-short")).length === nShort && text(toggle) === "Show the short view",
    "views: one click shows every row, the short view's rows still bold");
  const ids = shown().map((tr) => tr.dataset.metric);
  check(["annual", "cumulative", "best", "worst", "positive", "vol", "downside", "mdd", "longest", "sharpe", "sortino", "calmar", "beta", "alpha", "corr", "r2", "te", "ir", "up", "down", "var", "es", "lookback", "cut", "draws", "params"].every((id) => ids.includes(id)),
    "views: the full view holds every row the scorecard lists", ids.join());

  // Caption: the window, the frequency and the conventions.
  const cap = [...r.container.querySelectorAll("caption .tbl-span")].map(text);
  check(cap[0] === `Daily returns, ${a.dates[0]} to ${a.asOf}`, "caption: the date window and the daily frequency", cap[0]);
  check(/complete calendar months/.test(cap[1]) && /capture ratios/i.test(cap[1]) && /daily active returns × √252/.test(cap[1]) && /historical, one day, at 95%/.test(cap[1]) && /in-sample/.test(cap[1]),
    "caption: the conventions (monthly capture, tracking error on daily active returns × √252, historical 95% VaR, in-sample)", cap[1]);

  // Zero fragility for equal weight is printed as zero.
  const rowOf = (id) => [...r.container.querySelector(`tr[data-metric="${id}"]`).children].map(text);
  check(rowOf("lookback")[1] === format(0, "pct1") && rowOf("cut")[1] === format(0, "pct1") && rowOf("draws")[1] === format(0, "pct1") && rowOf("params")[1] === "0" && rowOf("lookback")[5] === DASH,
    "fragility: equal weight's zero is printed, not hidden; the benchmark's is a dash", rowOf("lookback").join(" "));
  check(rowOf("sharpe")[1].includes(" ± "), "sharpe-se: the rendered Sharpe cell carries its ± standard error", rowOf("sharpe")[1]);

  // Every row has its explanation at all three levels.
  check(SC.SCORE_METRICS.every((x) => LEVELS.every((l) => tipText(x.tip, l).length > 20)), "tips: every scorecard row has a text at all three levels");
  const defs = [...r.container.querySelectorAll(".sc-defs dd")].map(text);
  check(defs.length === SC.SCORE_METRICS.length && defs[0] === tipText("annual_return", "plain"), "tips: the row texts are on the page at the chosen level");
  // Every row printed, the scorecard's own figures included, carries one info mark named for its row.
  {
    const { tipName } = await import("../src/content/tooltips.ts");
    const rows = [...r.container.querySelectorAll("tbody tr[data-metric]")];
    const off = rows.filter((tr) => {
      const metric = SC.SCORE_METRICS.find((x) => x.id === tr.dataset.metric);
      const marks = [...tr.querySelectorAll("th .tip-mark")];
      return !metric || marks.length !== 1 || marks[0].getAttribute("aria-label") !== `About ${tipName(metric.tip)}`;
    });
    check(rows.length > 0 && off.length === 0 && rows.some((tr) => isScoreTip(SC.SCORE_METRICS.find((x) => x.id === tr.dataset.metric).tip)),
      "tips: every scorecard row carries its own info mark, named for the row", off.map((tr) => tr.dataset.metric).join(" "));
  }
  quiet(() => r.rerender(h(Scorecard, { model: m, redraws: rd, level: "formula", allowShort: false, filename: "scorecard" })));
  check(text(r.container.querySelector(".sc-defs dd")) === tipText("annual_return", "formula"), "tips: the level switch changes the row texts");
  check([...r.container.querySelectorAll(".tbl-dl button")].map(text).join() === "Download CSV,Download Excel", "downloads: the scorecard has both downloads");
  r.unmount();

  // The downloads: every row, raw numbers, the SE its own row, each row in its own Excel format.
  const sheet = SC.scoreSheet(m);
  check(sheet.rows.length === SC.SCORE_METRICS.length + 1 && sheet.rows.some((x) => x.metric === "Sharpe standard error" && x.ew === m.lines.find((l) => l.metric.id === "sharpe").cells[0].se),
    "downloads: every row is in the file, whichever view is on screen, and the Sharpe standard error is its own row");
  const ws = worksheet(sheet.columns, sheet.rows, sheet.rowFormats);
  const at = (metric, col) => ws[`${String.fromCharCode(65 + sheet.columns.findIndex((x) => x.key === col))}${sheet.rows.findIndex((x) => x.metric === metric) + 2}`];
  check(at("Annual return, compound", "ew")?.z === "0.00%" && at("Longest drawdown, trading days", "ew")?.z === "#,##0" && at("Sharpe", "ew")?.z === "0.000" &&
    at("Annual return, compound", "ew")?.v === m.lines[0].cells[0].value,
    "downloads: each row's numbers carry that row's own format in Excel, and stay raw numbers");
  check(csvText(sheet.columns, sheet.rows).split("\n")[0] === `Group,Figure,Unit,Equal-Weight,GMV,Tangency,Custom,${a.benchLabel}`, "downloads: the CSV heads the plain portfolio names");
}

// ---- (d) the dot strips: the fixed seed first, the same every time, then the next seed ------------------
{
  const a = exampleAnalysis();
  const one = solveRedraws(a, seedOf(0));
  const two = solveRedraws(a, seedOf(0));
  const next = solveRedraws(a, seedOf(1));
  check(seedOf(0) === DEFAULT_SEED && one.value.seed === DEFAULT_SEED && one.value.count === REDRAWS, "strips: the first draw set is the fixed seed, the one the downloads share");
  const rows1 = stripRows(a, one.value);
  const rows2 = stripRows(a, two.value);
  check(JSON.stringify(rows1) === JSON.stringify(rows2), "strips: the fixed seed draws the same strips on every run");
  check(JSON.stringify(stripRows(a, next.value)) !== JSON.stringify(rows1), "strips: the next seed draws others");
  check(rows1.every((x) => x.gmv.length === 1 && x.gmv[0] === a.gmv.w[a.tickers.indexOf(x.ticker)]) && rows1.every((x) => x.tan.length === one.value.tan.solved),
    "strips: GMV's strip is a single dot, its window weight; tangency has one dot per solved draw");

  // The tab: nothing solved during render, the strips after paint, Redraw moves to the next seed.
  const r = quiet(() => render(h(Optimization, tabProps(a))));
  const strips = () => r.container.querySelector(".opt-strips");
  check(strips() && !strips().dataset.seed && /Solving the draws/.test(text(strips())), "strips: the first render does not solve the draws; it says they are pending");
  await settle();
  check(strips().dataset.seed === String(DEFAULT_SEED) && strips().querySelectorAll(".opt-strip[data-ticker]").length === a.tickers.length,
    "strips: after paint, one strip per asset from the fixed seed");
  const firstDots = strips().querySelector(".opt-strip-svg").innerHTML;
  act(() => r.container.querySelector(".sc-toggle").click());
  const drawRow = [...r.container.querySelector('tr[data-metric="draws"]').children].map(text);
  const tanDraw = SC.scorecard(a, M.customWeights(a, {}), one).lines.find((l) => l.metric.id === "draws").cells[2].value;
  check(drawRow[3] === format(tanDraw, "pct1") && drawRow[3] !== DASH, "strips: the scorecard's redraw row fills in from the same draws", drawRow.join(" "));
  act(() => r.container.querySelector(".opt-redraw").click());
  await settle();
  check(strips().dataset.seed === String(seedOf(1)) && strips().querySelector(".opt-strip-svg").innerHTML !== firstDots && /Draw set 2, seed/.test(text(strips())),
    "strips: Redraw moves to the next seed and redraws");
  const words = text(strips());
  check(/if the true means were anywhere their own noise allows/i.test(words) && /not a forecast/.test(words) && !/out-of-sample|\bbeat|\bwins?\b|outperform|% of draws/i.test(words),
    "strips: worded as a what-if on these prices, never a verdict", words);
  check(!r.container.querySelector(".opt-strips animate, .opt-strips animateTransform") && !/transition|animation/.test(readFileSync(new URL("../src/tabs/optimization/Optimization.css", import.meta.url), "utf8")),
    "strips: static, no animation");
  r.unmount();
}

// ---- (e) the Custom tab reuses the component, its mix in bold ---------------------------------------------
{
  const a = fixtureAnalysis("megacap");
  const props = tabProps(a, { weights: Object.fromEntries(a.tickers.map((t, i) => [t, i + 1])) });
  const r = quiet(() => render(h(Custom, props)));
  await settle();
  const sc = r.container.querySelector('section[aria-labelledby="cust-scorecard"] .tbl.sc');
  const focus = sc?.querySelector("thead .sc-focus");
  check(sc && focus && focus.dataset.col === "custom" && [...sc.querySelectorAll("thead th")].length === 6, "custom: the Custom tab shows the same scorecard, the Custom column set in bold");
  const v = M.customWeights(a, props.weights);
  const want = scorecardRow(portfolioReturns(a.returns, v.w), a.bench, a.dates, a.prices.dates[0], a.rf);
  const annual = [...sc.querySelector('tr[data-metric="annual"]').children].map(text);
  check(annual[4] === format(want.annualReturn, "pct2"), "custom: its column is the engine's figure for the typed mix", annual.join(" "));
  r.unmount();
}

check(!Object.keys((await import("../src/content/tooltips.json", { with: { type: "json" } })).default).some((k) => isScoreTip(k)),
  "tips: no scorecard key is in the app's dumped tooltips");

done("t-scorecard");
