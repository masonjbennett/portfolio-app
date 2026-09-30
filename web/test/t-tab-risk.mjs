// The Risk Analysis tab (src/tabs/Risk.tsx, src/tabs/risk/), portfolio_app.py 1317-1416.
//
// (a) The view-model's numbers against the oracle dump, cross and megacap: rolling volatility at the
//     dumped windows, Sharpe and Sortino, CAPM, and the drawdowns (the app's own path reproduced, the
//     port's held to it wherever the two definitions agree).
// (b) The view-model's logic on hand-made paths: the high, the low, the recovery, the headline.
// (c) Ledger entries, both sides each: drawdown-and-wealth-start (the chart's first point), beta-rounding,
//     numeric-downloads and downloads-everywhere (the tab halves), boundary (the tab half), rf-live.
// (d) The whole tab rendered in jsdom: the headline, three charts drawn, three tables with both
//     downloads, no NaN, and the level, window and asset controls doing what they say.
import { render, text, act } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, near, nearAll, json, done } from "./_assert.mjs";
import { fixtureAnalysis, tabProps, ORACLE_RF } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const M = await import("../src/tabs/risk/model.ts");
const Risk = (await import("../src/tabs/Risk.tsx")).default;
const { BETA_ABOVE, BETA_BELOW } = await import("../src/tabs/risk/charts.tsx");
const { format } = await import("../src/format.ts");
const { csvText, cellFor } = await import("../src/download.ts");
const { tipText } = await import("../src/content/tooltips.ts");
const { drawdowns, annualizedStats } = await import("../src/lib/stats.ts");
const { monthYear } = await import("../src/chrome/when.ts");
const { tokens } = await import("../src/styles/tokens.ts");

const ORACLE = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8").split(/\r?\n/);
// The oracle's lines first..last (1-based, inclusive), joined.
const lines = (first, last) => ORACLE.slice(first - 1, last).join("\n");
const oracle = (set) => json(new URL(`./fixtures/oracle-${set}.json`, import.meta.url));
const at = (xs, idx) => idx.map((i) => xs[i]);
const REL = 1e-12; // deterministic statistics, as t-parity.mjs
const quiet = (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};

// ---- (a) parity with the oracle dump ------------------------------------------------------------------
for (const set of ["cross", "megacap"]) {
  const o = oracle(set);
  const a = fixtureAnalysis(set);
  const tag = (s) => `${set}: ${s}`;
  check(JSON.stringify(a.tickers) === JSON.stringify(o.clean.tickers) && a.rf === o.rf, tag("the analysis is the oracle's input"));

  // Rolling volatility (1324) at every window the dump carries; null in the dump is pandas' NaN.
  for (const w of Object.keys(o.rolling)) {
    const vs = M.volSeries(a, Number(w));
    a.tickers.forEach((t, j) => {
      const e = o.rolling[w].vol[t];
      nearAll(tag(`${t} ${w}-day rolling volatility`), at(vs[j], e.i), e.v, 1e-9);
    });
    const vc = M.volChart(a, Number(w));
    check(vc.status === "ready" && vc.value.rows.length === a.dates.length - Number(w) + 1 && vc.value.rows[0].date === a.dates[Number(w) - 1],
      tag(`${w}-day chart starts at the first full window, not at a NaN`));
    const pk = vc.value.peak;
    const pos = vc.value.rows.findIndex((row) => row.date === pk.date);
    check(pk.value === Math.max(...vs.flat().filter(Number.isFinite)) && pk.late === pos > vc.value.rows.length / 2,
      tag(`${w}-day peak is the highest value, its label on the roomier side`), `${pk.date} ${pk.late}`);
  }

  // Sharpe and Sortino (1355-1358): tickers, then the benchmark row under its display name.
  const rr = M.riskRows(a);
  check(rr.length === a.tickers.length + 1 && rr.at(-1).asset === o.benchLabel, tag("risk table: tickers then the benchmark"), rr.map((r) => r.asset).join());
  a.tickers.forEach((t, j) => {
    near(tag(`${t} Sharpe`), rr[j].sharpe, o.perColumn[t].sharpe, REL);
    near(tag(`${t} Sortino`), rr[j].sortino, o.perColumn[t].sortino, REL);
  });
  near(tag("benchmark Sharpe"), rr.at(-1).sharpe, o.bench.sharpe, REL);
  near(tag("benchmark Sortino"), rr.at(-1).sortino, o.bench.sortino, REL);

  // CAPM (1377-1392), at t-parity's tiers; tickers only.
  const cr = M.capmRows(a);
  check(cr.length === a.tickers.length, tag("CAPM: tickers only, no benchmark row"));
  cr.forEach((c) => {
    near(tag(`${c.name} beta`), c.beta, o.capm[c.name].beta, 1e-11);
    near(tag(`${c.name} alpha`), c.alphaAnn, o.capm[c.name].alphaAnn, 1e-9, 1e-13);
    near(tag(`${c.name} R2`), c.r2, o.capm[c.name].r2, 1e-11);
  });

  // Drawdowns. The app's path (911-914, no start) reproduced against the dump; the port's path has
  // one more point, the start, and agrees with the app's wherever the high it falls from is a close
  // at or above the start. It can only be as deep or deeper.
  const dd = M.tickerDrawdowns(a);
  a.tickers.forEach((t, j) => {
    const e = o.perColumn[t];
    nearAll(tag(`${t} the app's drawdown path, reproduced`), at(drawdowns(a.returns[j], false), e.drawdown.i), e.drawdown.v, 0, 1e-12);
    const d = dd[j];
    check(d.values.length === a.dates.length + 1 && d.dates[0] === a.prices.dates[0] && d.values[0] === 0,
      tag(`${t} the port's path starts at the first close, at 0`));
    check(d.max <= e.mdd + 1e-15, tag(`${t} the port's maximum drawdown is no shallower than the app's`), `${d.max} vs ${e.mdd}`);
    if (d.peak > 0) near(tag(`${t} maximum drawdown (the fall is from a close, so the two agree)`), d.max, e.mdd, REL);
    check(d.values[d.trough] === d.max && d.values[d.peak] === 0 && d.peak <= d.trough && Math.min(...d.values) === d.max,
      tag(`${t} the low is the minimum and the high before it is a 0`));
  });

  // The headline names the asset with the app's deepest maximum drawdown, at the app's figure.
  const worst = a.tickers.reduce((b, t) => (o.perColumn[t].mdd < o.perColumn[b].mdd ? t : b), a.tickers[0]);
  const wd = dd[a.tickers.indexOf(worst)];
  const hl = M.headline(a);
  check(wd.peak > 0 && hl.startsWith(`${worst} fell furthest: ${format(-o.perColumn[worst].mdd, "pct1")} from its high in `),
    tag("headline names the deepest drawdown at the oracle's figure"), hl);
  check(hl.includes(`to its low in ${monthYear(wd.dates[wd.trough])}`), tag("headline says when the low was"), hl);
  const back = wd.recovered === null ? `had not regained that level by ${monthYear(a.asOf)}` : `was back at that level by ${monthYear(wd.dates[wd.recovered])}`;
  check(hl.endsWith(`${back}.`), tag("headline says whether it came back"), hl);
}

// ---- (b) the view-model's logic on hand-made paths --------------------------------------------------------
// A stand-in analysis: only the fields the drawdown functions read.
function fake(returns, tickers = returns.map((_, i) => `T${i}`)) {
  const n = returns[0].length;
  const days = Array.from({ length: n + 1 }, (_, i) => `2020-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`);
  return { tickers, returns, prices: { dates: days }, dates: days.slice(1), asOf: days[n], bench: returns[0], benchLabel: "Bench" };
}
{
  // cum 1, 1.1, 0.88, 0.924, 1.1088, 1.0977: high 1.1 on day 1, low on day 2, back on day 4.
  const f = fake([[0.1, -0.2, 0.05, 0.2, -0.01]]);
  const d = M.drawdownOf(f, "T0", f.returns[0]);
  check(d.trough === 2 && d.peak === 1 && d.recovered === 4, "model: high, low and recovery of a fall and a new high",
    `${d.peak} ${d.trough} ${d.recovered}`);
  near("model: the low is 20% below the high", d.max, -0.2, 1e-15);
  const rows = M.drawdownRows(f);
  check(rows[0].peak === f.prices.dates[1] && rows[0].low === f.prices.dates[2] && rows[0].back === f.prices.dates[4] && rows.at(-1).asset === "Bench",
    "model: the drawdown table dates the high, the low and the recovery, benchmark last", JSON.stringify(rows[0]));
  // A loss on day one: the app's path cannot see it; the port's falls from the amount invested.
  const g = fake([[-0.1, 0.05, 0.06]]);
  const e = M.drawdownOf(g, "T0", g.returns[0]);
  check(drawdowns(g.returns[0], false)[0] === 0 && Math.min(...drawdowns(g.returns[0], false)) > -0.1,
    "ledger:drawdown-and-wealth-start the app's path (911-914) misses a first-day loss");
  check(e.peak === 0 && e.trough === 1 && e.recovered === 3 && Math.abs(e.max + 0.1) < 1e-15,
    "ledger:drawdown-and-wealth-start the port's path falls 10% from the start on day one", `${e.peak} ${e.trough} ${e.recovered} ${e.max}`);
  check(M.headline(g).startsWith("T0 fell furthest: 10.0% from where it started, in ") && M.headline(g).includes("and was back at that level by"),
    "model: a fall from the start is said as such", M.headline(g));
  // Never back: the headline says so, and the table's cell is empty.
  const k = fake([[0.02, -0.3, 0.01], [0.01, 0.01, -0.01]]);
  check(M.headline(k).startsWith("T0 fell furthest: 30.0% from its high in ") && M.headline(k).endsWith(`had not regained that level by ${monthYear(k.asOf)}.`),
    "model: a fall with no recovery is said as such", M.headline(k));
  check(M.drawdownRows(k)[0].back === null && M.drawdownRows(k)[1].back === null && M.drawdownRows(k)[1].mdd < 0, "model: no recovery prints as a dash");
  // Nothing ever fell.
  const up = fake([[0.01, 0.02], [0.03, 0.01], [0.0, 0.01]]);
  check(M.headline(up) === "None of these 3 assets ever closed below its first close or an earlier high.", "model: a headline for no drawdown", M.headline(up));
  check(M.drawdownRows(up).every((r) => r.mdd === 0 && r.peak === null && r.low === null), "model: a path that never fell has no dates");
  // A non-number fails the chart closed and named.
  const bad = M.drawdownChart({ name: "X", dates: ["a", "b"], values: [0, NaN], max: NaN, trough: 0, peak: 0, recovered: null });
  check(bad.status === "error" && bad.name.includes("X"), "model: a NaN drawdown is an error state, not a half-drawn chart", JSON.stringify(bad));
  const nanVol = M.volChart({ ...fake([[0.1, NaN, 0.1, 0.2]]), tickers: ["T0"] }, 2);
  check(nanVol.status === "error", "model: a NaN volatility is an error state", nanVol.status);
  // A peak late in the range puts its label on the left, one early on the right.
  const calmThenWild = Array.from({ length: 40 }, (_, i) => (i < 30 ? 0.001 : 0.05) * (i % 2 ? 1 : -1));
  const lateVol = M.volChart(fake([calmThenWild]), 5);
  const earlyVol = M.volChart(fake([[...calmThenWild].reverse()]), 5);
  check(lateVol.status === "ready" && lateVol.value.peak.late && earlyVol.status === "ready" && !earlyVol.value.peak.late,
    "model: the volatility peak's label side follows where the peak is");
  const short = M.volChart(fake([[0.1, 0.2]]), 30);
  check(short.status === "empty" && short.reason.includes("30"), "model: too few days for the window is an empty state");
  // The beta chart's title, every branch, and axis bounds without binary noise.
  const bt = (betas) => M.betaChart(betas.map((beta, i) => ({ name: `B${i}`, beta, alphaAnn: 0, r2: 1 }))).value;
  check(M.betaTitle(bt([1.2, 0.5, 0.8]), "S&P 500") === "1 of 3 assets has a beta above 1 against the S&P 500; B0's 1.20 is the highest",
    "model: beta title, one above 1", M.betaTitle(bt([1.2, 0.5, 0.8]), "S&P 500"));
  check(M.betaTitle(bt([1.2, 1.5, 0.3]), "X").startsWith("2 of 3 assets have a beta above 1 against the X; B1's 1.50"), "model: beta title, some above 1");
  check(M.betaTitle(bt([0.2, 0.5]), "X").startsWith("No asset has a beta above 1") && M.betaTitle(bt([1.2, 1.5]), "X").startsWith("Every asset has"),
    "model: beta title, none and every");
  check(bt([1.27]).yMax === 1.6 && bt([-0.3, 0.5]).yMin === -0.6 && bt([0.5]).yMin === 0, "model: beta axis bounds", `${bt([1.27]).yMax} ${bt([-0.3, 0.5]).yMin}`);
  // Axes.
  check(JSON.stringify(M.yearTicks(["2019-01-02", "2019-06-01", "2020-01-02", "2020-01-03", "2021-01-04"])) === '["2019-01-02","2020-01-02","2021-01-04"]',
    "model: one x tick per calendar year, at its first date");
  check(M.pctTick(-0.4) === "\u221240%" && M.pctTick(0.25) === "25%" && M.pctTick(NaN) === "", "model: percentage ticks");
  const ends = M.endLabels([0.2, 0.2001, 0.5], 1, 100, 14);
  check(ends[1] - ends[0] >= 0.14 - 1e-12 && Math.abs(ends[2] - 0.5) < 1e-12, "model: end labels are spread apart, in data units", ends.join());
}

// ---- (c) ledger entries ---------------------------------------------------------------------------------
const a = fixtureAnalysis("cross");
const o = oracle("cross");

// drawdown-and-wealth-start, on real data: VTI fell on the first day of the cross set.
{
  const j = a.tickers.indexOf("VTI");
  const r1 = a.returns[j][0];
  const e = o.perColumn.VTI.drawdown;
  check(r1 < 0 && e.i[0] === 0 && e.v[0] === 0, "ledger:drawdown-and-wealth-start the app plots no drawdown on VTI's first day, a loss", `${r1} ${e.v[0]}`);
  const st = M.drawdownChart(M.tickerDrawdowns(a)[j]);
  const rows = st.status === "ready" ? st.value.rows : [];
  check(rows[0]?.date === a.prices.dates[0] && rows[0]?.dd === 0 && rows[1]?.date === a.dates[0],
    "ledger:drawdown-and-wealth-start the chart's first point is the start, the first close, at 0", JSON.stringify(rows.slice(0, 2)));
  near("ledger:drawdown-and-wealth-start the chart's second point is the first day's loss", rows[1]?.dd, r1, 1e-15);
}

// beta-rounding: the app draws and colours the 3-decimal string (1388, 1396, 1398).
{
  check(/"Beta": f"\{slope:\.3f\}"/.test(lines(1386, 1390)) && /float\(capm_rows\[t\]\["Beta"\]\)/.test(lines(1395, 1397)) && /if v > 1 else/.test(lines(1397, 1399)),
    "ledger:beta-rounding the app's bars are float() of the 3-decimal string, coloured on that");
  check(!(Number((1.0004).toFixed(3)) > 1), "ledger:beta-rounding the app would draw a beta of 1.0004 as not above the market");
  const b = M.betaChart([{ name: "X", beta: 1.0004, alphaAnn: 0, r2: 1 }, { name: "Y", beta: 0.9996, alphaAnn: 0, r2: 1 }]);
  check(b.status === "ready" && b.value.bars[0].above && b.value.bars[0].beta === 1.0004 && !b.value.bars[1].above,
    "ledger:beta-rounding the port draws 1.0004 as above 1 and 0.9996 as below, at their own heights");
  const real = M.betaChart(M.capmRows(a));
  const cr = M.capmRows(a);
  check(real.status === "ready" && real.value.bars.every((x, i) => x.beta === cr[i].beta) && real.value.bars.some((x) => x.beta !== Number(x.beta.toFixed(3))),
    "ledger:beta-rounding the port's bars carry the unrounded betas");
  check(real.status === "ready" && real.value.bars.every((x) => x.above === (x.beta > 1)), "ledger:beta-rounding the colour follows the beta itself");
  check(BETA_ABOVE === tokens.color.claret && BETA_BELOW === tokens.color.navy, "beta colours are tokens (claret above 1, navy below), as the subtitle says");
}

// numeric-downloads, the tab half: the app's risk table is f-strings (1357), so its CSV and Excel hold text.
{
  check(/f"\{sharpe:\.3f\}"/.test(lines(1357, 1357)) && /f"\{sh_b:\.3f\}"/.test(lines(1358, 1358)),
    "ledger:numeric-downloads the app's risk table cells are 3-decimal strings (1357-1358)");
  const rows = M.riskRows(a);
  const csv = csvText(M.RISK_COLUMNS, rows).split("\n");
  check(csv[0] === "Asset,Sharpe Ratio,Sortino Ratio" && csv[1] === `VTI,${rows[0].sharpe},${rows[0].sortino}` && String(rows[0].sharpe).length > 6,
    "ledger:numeric-downloads the port's risk CSV holds the full numbers", csv[1]);
  const cell = cellFor(rows[0].sharpe, M.RISK_COLUMNS[1]);
  check(cell?.t === "n" && cell.v === rows[0].sharpe && cell.z === "0.000", "ledger:numeric-downloads the port's Excel cell is a number with a 0.000 format", JSON.stringify(cell));
  const cap = M.capmTableRows(M.capmRows(a));
  const alpha = cellFor(cap[0].alpha, M.CAPM_COLUMNS[2]);
  check(alpha?.t === "n" && alpha.z === "0.00%" && alpha.v === cap[0].alpha, "ledger:numeric-downloads the CAPM alpha downloads as a number formatted 0.00%", JSON.stringify(alpha));
  const ddRows = M.drawdownRows(a);
  const low = cellFor(ddRows[0].low, M.DRAWDOWN_COLUMNS[3]);
  check(typeof ddRows[0].mdd === "number" && low?.t === "n" && low.z === "yyyy-mm-dd", "ledger:numeric-downloads the drawdown table holds numbers and real dates", JSON.stringify(low));
}

// ---- (d) the tab, rendered --------------------------------------------------------------------------
// jsdom lays nothing out, so every box measures 0 x 0 and Recharts would draw no chart. Give boxes a
// size, as a browser would.
const rect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 360, width: 720, height: 360, toJSON() {} };
};
const click = (el) => act(() => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
const pill = (root, label) => [...root.querySelectorAll("button[role=radio]")].find((b) => text(b) === label);
const sectionOf = (r, id) => r.container.querySelector(`section[aria-labelledby="${id}"]`);

{
  const props = tabProps(a);
  const r = quiet(() => render(h(Risk, props)));
  const all = text(r.container);
  check(!/NaN|undefined|Infinity|\bnan\b/.test(all), "tab: no NaN, undefined or Infinity anywhere on it");
  const head = r.container.querySelector(".risk-headline");
  check(head && text(head) === M.headline(a) && text(head).startsWith("VNQ fell furthest: 42.4%"), "tab: the headline is on it, literal", head ? text(head) : "none");
  check(r.container.querySelectorAll(".recharts-surface").length === 3, "tab: all three charts are drawn",
    `${r.container.querySelectorAll(".recharts-surface").length}`);

  // Every table, and each carries both downloads (downloads-everywhere, the tab half).
  const tables = [...r.container.querySelectorAll(".tbl")];
  const captions = tables.map((t) => text(t.querySelector("caption .tbl-title")));
  const spans = tables.map((t) => text(t.querySelector(".tbl-span")));
  check(JSON.stringify(spans) === JSON.stringify([
    `Daily closes, ${props.analysis.prices.dates[0]} to ${props.analysis.asOf}`,
    `Daily closes, ${props.analysis.prices.dates[0]} to ${props.analysis.asOf}`,
    `Daily closes, ${props.analysis.prices.dates[0]} to ${props.analysis.asOf}`,
    `Daily returns, ${props.analysis.dates[0]} to ${props.analysis.asOf}`,
    `Daily returns, ${props.analysis.dates[0]} to ${props.analysis.asOf}`,
  ]), "spans: the drawdowns state their closes and the ratios their daily returns, each with its window", spans.join(" | "));
  check(JSON.stringify(captions) === JSON.stringify(["Deepest falls, Equal-Weight", "Named falls in this window", "Worst drawdown by asset", "Risk-adjusted metrics", "CAPM beta and alpha"]),
    "tab: its five tables, the portfolios' falls first", captions.join(" | "));
  check(tables.length === 5 && tables.every((t) => {
    const b = [...t.querySelectorAll("button")].map(text);
    return b.includes("Download CSV") && b.includes("Download Excel");
  }), "ledger:downloads-everywhere every table on the tab has a CSV and an Excel download");
  check(!/download_button/.test(lines(1370, 1416)) && (lines(1360, 1367).match(/download_button/g) ?? []).length === 2,
    "ledger:downloads-everywhere the app gives the risk table two downloads (1364-1366) and the CAPM table none (1372-1416)");
  const capmTable = tables[4];
  check(capmTable && [...capmTable.querySelectorAll("button")].map(text).includes("Download Excel"), "ledger:downloads-everywhere the port's CAPM table has both");
  check(r.container.querySelectorAll("table").length === 5, "tab: no table outside the Table component");

  // The printed cells: the risk table's first row, at the app's own format, from the oracle's figures.
  const firstRow = [...tables[3].querySelectorAll("tbody tr")][0];
  const cells = firstRow ? [...firstRow.children].map(text) : [];
  check(JSON.stringify(cells) === JSON.stringify(["VTI", format(o.perColumn.VTI.sharpe, "num3"), format(o.perColumn.VTI.sortino, "num3")]),
    "tab: VTI's Sharpe and Sortino print at the app's 3 decimals", cells.join(" "));
  const capmCells = [...capmTable.querySelectorAll("tbody tr")][0];
  const cc = capmCells ? [...capmCells.children].map(text) : [];
  check(JSON.stringify(cc) === JSON.stringify(["VTI", format(o.capm.VTI.beta, "num3"), format(o.capm.VTI.alphaAnn, "pct2"), format(o.capm.VTI.r2, "num3")]),
    "tab: VTI's CAPM row prints the oracle's figures", cc.join(" "));

  // In-chart labels: the drawdown's low, every beta on its bar, every volatility line's name.
  const dd = sectionOf(r, "risk-drawdown");
  const wd = M.worstDrawdown(M.tickerDrawdowns(a));
  check(text(dd.querySelector(".recharts-surface")).includes(`${format(wd.max, "pct2")} on ${wd.dates[wd.trough]}`), "tab: the drawdown's low is labelled in the chart");
  const betaSvg = text(sectionOf(r, "risk-capm").querySelector(".recharts-surface"));
  check(M.capmRows(a).every((c) => betaSvg.includes(format(c.beta, "num3"))) && betaSvg.includes("Market (\u03b2 = 1)"), "tab: each beta and the market line are labelled on the bars", betaSvg);
  const fills = [...sectionOf(r, "risk-capm").querySelectorAll(".recharts-bar-rectangle path, .recharts-bar-rectangle rect")].map((e) => e.getAttribute("fill"));
  const want = M.capmRows(a).map((c) => (c.beta > 1 ? tokens.color.claret : tokens.color.navy));
  check(JSON.stringify(fills) === JSON.stringify(want), "tab: each bar is claret above 1 and navy below, by its own beta", fills.join(" "));
  const volSvg = text(sectionOf(r, "risk-volatility").querySelector(".recharts-surface"));
  check(a.tickers.every((t) => volSvg.includes(t)), "tab: each volatility line is named at its end", volSvg);
  const v60p = M.volChart(a, 60).value.peak;
  const peakText = [...sectionOf(r, "risk-volatility").querySelectorAll(".recharts-surface text")].find((t) => text(t) === format(v60p.value, "pct1"));
  check(!v60p.late && peakText?.getAttribute("text-anchor") === "start", "tab: an early volatility peak is labelled to its right", peakText?.outerHTML ?? "no label");
  check(r.container.querySelectorAll(".recharts-legend-wrapper").length === 0, "tab: no legend, the labels are in the charts");

  // The level switch changes the tooltip text.
  const tipOf = () => r.container.querySelector("button[aria-label='About maximum drawdown']")?.parentElement.querySelector("[role=tooltip]");
  const plain = tipOf() ? text(tipOf()) : "";
  quiet(() => r.rerender(h(Risk, { ...props, level: "formula" })));
  const formula = tipOf() ? text(tipOf()) : "";
  check(plain === tipText("max_dd", "plain") && formula === tipText("max_dd", "formula") && plain !== formula, "tab: the level switch changes the tooltip text", `${plain} / ${formula}`);
  const betaTip = r.container.querySelector("button[aria-label='About beta']")?.parentElement.querySelector("[role=tooltip]");
  check(betaTip && text(betaTip) === tipText("beta", "formula"), "tab: the beta tip follows the level too");

  // The hero opens on the asset the headline names; another asset's pill switches chart and plate.
  const heroTitle = () => text(dd.querySelector(".chart-title"));
  const plate = () => text(dd.querySelector(".plate-value"));
  check(heroTitle() === M.drawdownTitle(wd) && plate() === format(wd.max, "pct2"), "tab: the hero chart shows the headline's asset", heroTitle());
  const other = M.tickerDrawdowns(a).find((d) => d.name !== wd.name);
  quiet(() => click(pill(dd, other.name)));
  check(heroTitle() === M.drawdownTitle(other) && plate() === format(other.max, "pct2"), "tab: picking another asset redraws the hero and its plate", `${heroTitle()} ${plate()}`);

  // The window switch.
  const vol = sectionOf(r, "risk-volatility");
  const volTitle = () => text(vol.querySelector(".chart-title"));
  const v60 = M.volChart(a, 60);
  check(volTitle() === M.volTitle(v60.value) && volTitle().includes("60-day"), "tab: the volatility chart opens on the app's 60-day window", volTitle());
  quiet(() => click(pill(vol, "120 days")));
  const v120 = M.volChart(a, 120);
  check(volTitle() === M.volTitle(v120.value) && volTitle().includes("120-day"), "tab: the 120-day pill redraws it over 120 days", volTitle());

  // rf-live, the tab half: the app freezes rf at Run (1087) and every tab reads the frozen copy (1158);
  // this tab reads the rate the analysis carries, and the analysis is rebuilt when the rate changes.
  check(/st\.session_state\.rf = rf_annual/.test(lines(1087, 1087)) && /rf = st\.session_state\.rf/.test(lines(1158, 1158)),
    "ledger:rf-live the app's tabs read the rate saved at Run (1087, 1158)");
  const b = fixtureAnalysis("cross", { rf: 0.05 });
  quiet(() => r.rerender(h(Risk, { ...props, analysis: b })));
  const row = [...r.container.querySelectorAll(".tbl")[3].querySelectorAll("tbody tr")][0];
  const sharpe5 = annualizedStats(b.returns[0], 0.05).sharpe;
  check(row && text(row.children[1]) === format(sharpe5, "num3") && format(sharpe5, "num3") !== format(o.perColumn.VTI.sharpe, "num3") && text(r.container).includes("5.00% risk-free rate"),
    "ledger:rf-live the tab's Sharpe follows a new rate at once", row ? text(row) : "no row");
  r.unmount();
  void ORACLE_RF;
}

// boundary, the tab half: a section that throws leaves one line naming it; the rest of the tab stays.
{
  check(!/^\s*try:/m.test(lines(1317, 1416)), "ledger:boundary the app's risk tab has no guard: a throw in it ends the script run");
  const broken = Object.create(a);
  Object.defineProperty(broken, "benchStats", { get() { throw new Error("no benchmark stats"); } });
  let r = null;
  try {
    r = quiet(() => render(h(Risk, tabProps(broken))));
  } catch (err) {
    check(false, "ledger:boundary a failing section stays inside its own boundary", err.message);
  }
  if (r) {
    const fallback = [...r.container.querySelectorAll(".boundary")].map(text);
    check(JSON.stringify(fallback) === JSON.stringify(["Risk-adjusted metrics could not be shown."]), "ledger:boundary the failed section is one line naming it", fallback.join(" | "));
    check(!!r.container.querySelector(".risk-headline") && r.container.querySelectorAll(".recharts-surface").length === 3 && r.container.querySelectorAll(".tbl").length === 4,
      "ledger:boundary the headline, the three charts and the other four tables still render");
    r.unmount();
  }
}

HTMLElement.prototype.getBoundingClientRect = rect;
done("t-tab-risk");
