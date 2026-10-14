// The Returns & Statistics tab (portfolio_app.py 1225-1312): its view-model held to the app's own
// numbers, then the whole tab rendered in jsdom.
//
// (a) Parity, cross and megacap: every Summary Statistics figure against the oracle dump at the tiers
//     t-parity.mjs uses (1e-12 relative for the annualised figures, 1e-10 for the moments, min and max
//     exact); every growth line against the app's cumulative path (1e-10); the Q-Q quantiles and line.
// (b) The headline is literal: rebuilt from the DUMP's own last growth values, it must equal the page's.
// (c) The ledger entries this tab closes, each asserting the app's side and the port's:
//     ledger:excess-kurtosis, ledger:numeric-downloads (tab half), ledger:downloads-everywhere (tab half).
// (d) The rendered tab: headline, both tables with both downloads, no NaN / undefined / Infinity, the
//     level switch changes the tooltip text, the toggles, the distribution controls, and every card's
//     empty and error state failing closed and named.
import { render, text, act, openAll } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, near, nearAll, json, done } from "./_assert.mjs";
import { fixtureAnalysis, tabProps, ORACLE_RF } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const M = await import("../src/tabs/returns/model.ts");
const Returns = (await import("../src/tabs/Returns.tsx")).default;
const { DASH, ROLE } = await import("../src/charts/theme.ts");
const { endLabelValues } = await import("../src/tabs/returns/GrowthChart.tsx");
const { csvText, worksheet } = await import("../src/download.ts");
const { format } = await import("../src/format.ts");
const { tipText } = await import("../src/content/tooltips.ts");
const { excessKurtosis, normPdf } = await import("../src/lib/stats.ts");
const { mean, std } = await import("../src/lib/num.ts");

const ORACLE = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8").split(/\r?\n/);
const oracleLine = (n) => ORACLE[n - 1] ?? "";
const oracleRange = (a, b) => ORACLE.slice(a - 1, b).join("\n");
const dump = (set) => json(new URL(`./fixtures/oracle-${set}.json`, import.meta.url));
const at = (series, idx) => idx.map((i) => series[i]);
const REL = 1e-12;

// ---- (a) parity ----------------------------------------------------------------------------------
for (const set of ["cross", "megacap"]) {
  const tag = (s) => `${set}: ${s}`;
  const a = fixtureAnalysis(set);
  const o = dump(set);
  check(a.rf === o.rf && o.rf === ORACLE_RF, tag("the analysis runs at the oracle's rate"));
  const cols = [...o.clean.tickers, o.benchmark];

  // T1, Summary Statistics (1229-1244): tickers in order, then the benchmark under its label.
  const rows = M.summaryRows(a);
  check(JSON.stringify(rows.map((r) => r.asset)) === JSON.stringify([...o.clean.tickers, o.benchLabel]),
    tag("summary rows: the tickers in order, then the benchmark's label (1239)"), rows.map((r) => r.asset).join());
  rows.forEach((r, j) => {
    const e = o.perColumn[cols[j]];
    near(tag(`${r.asset} Ann. Return`), r.annReturn, e.mu, REL);
    near(tag(`${r.asset} Ann. Volatility`), r.annVol, e.sigma, REL);
    near(tag(`${r.asset} Skewness`), r.skew, e.skew, 1e-10);
    near(tag(`${r.asset} Excess kurtosis`), r.exKurt, e.kurt, 1e-10);
    check(r.minDaily === e.min && r.maxDaily === e.max, tag(`${r.asset} Min / Max Daily exact`), `${r.minDaily} ${r.maxDaily}`);
    check(Object.entries(r).every(([k, v]) => (k === "asset" ? typeof v === "string" : typeof v === "number")),
      tag(`${r.asset} row holds raw numbers, never strings`), JSON.stringify(r));
  });

  // C1, the growth lines (1261): the app's path is w0 * cumprod(1 + r), which starts at w0 * (1 + r1).
  // The port prepends the amount itself, so the app's point k is the port's point k + 1.
  const g = M.growth(a, o.w0);
  check(g.dates.length === a.prices.dates.length && g.dates.length === o.clean.rows && g.lines.every((l) => l.values.length === g.dates.length),
    tag("growth: one value per price date, the first return date's close included"));
  g.lines.forEach((l, j) => {
    const e = o.perColumn[cols[j]].cumulative;
    nearAll(tag(`${l.name} growth path vs the app's`), at(l.values, e.i.map((i) => i + 1)), e.v, 1e-10);
    check(l.values[0] === o.w0, tag(`${l.name} growth starts at the amount invested`), String(l.values[0]));
    near(tag(`${l.name}: the app's first point is the amount times (1 + r1) (1261)`), e.v[0], o.w0 * (1 + l.returns[0]), 1e-15);
  });
  check(g.lines.every((l, j) => o.perColumn[cols[j]].cumulative.i.at(-1) === o.returns.rows - 1),
    tag("the dump's growth samples include the last day"));

  // C3, the Q-Q plot of the first ticker (1296-1306).
  const q = M.qqState(a.returns[0]);
  check(q.status === "ready" && o.probplot.ticker === o.clean.tickers[0], tag("Q-Q: ready, on the dump's ticker"));
  if (q.status === "ready") {
    nearAll(tag("Q-Q theoretical quantiles"), at(q.value.osm, o.probplot.osm.i), o.probplot.osm.v, 1e-13, 1e-15);
    check(at(q.value.osr, o.probplot.osr.i).every((v, k) => v === o.probplot.osr.v[k]), tag("Q-Q sample quantiles exact"));
    near(tag("Q-Q slope"), q.value.slope, o.probplot.slope, 1e-11);
    near(tag("Q-Q intercept"), q.value.intercept, o.probplot.intercept, 1e-9, 1e-15);
    const [[x0, y0], [x1, y1]] = q.value.line;
    const n = q.value.osm.length;
    check(x0 === q.value.osm[0] && x1 === q.value.osm[n - 1] && x0 < x1, tag("Q-Q line spans the lowest to the highest theoretical quantile (1302)"));
    near(tag("Q-Q line ends lie on the fitted line"), y0 + y1, o.probplot.slope * (x0 + x1) + 2 * o.probplot.intercept, 1e-9, 1e-15);
  }

  // ---- (b) the headline, literal, rebuilt from the dump ----
  const ends = cols.map((c) => o.perColumn[c].cumulative.v.at(-1));
  const name = (j) => (j === cols.length - 1 ? `the ${o.benchLabel}` : cols[j]);
  const best = ends.indexOf(Math.max(...ends));
  const worst = ends.indexOf(Math.min(...ends));
  const usd = (x) => `$${Math.round(x).toLocaleString("en-US")}`;
  const want = `$10,000 grew most in ${name(best)}, to ${usd(ends[best])}, and least in ${name(worst)}, to ${usd(ends[worst])}.`;
  check(o.w0 === 10000 && M.headline(g) === want, tag("headline: the app's highest and lowest ending values, said literally"), `${M.headline(g)} | ${want}`);
}
{
  // The sentence follows the numbers when lines lose money, and names no winner over a missing figure.
  const line = (name, end, bench = false) => ({ name, end, total: end / 1000 - 1, bench });
  const g = (ls) => ({ dates: [], amount: 1000, lines: ls });
  check(M.headline(g([line("A", 1500), line("B", 900), line("S&P 500", 1100, true)])) === "$1,000 grew most in A, to $1,500, and fell most in B, to $900.",
    "headline: a line that lost money is said to have fell", M.headline(g([line("A", 1500), line("B", 900)])));
  check(M.headline(g([line("A", 950), line("B", 700), line("S&P 500", 800, true)])) === "$1,000 fell least in A, to $950, and most in B, to $700.",
    "headline: when every line lost money it says so");
  check(M.headline(g([line("A", 950), line("B", 1200), line("S&P 500", 3000, true)])) === "$1,000 grew most in the S&P 500, to $3,000, and fell most in A, to $950.",
    "headline: the benchmark is 'the S&P 500' in a sentence");
  check(M.headline(g([line("A", NaN), line("B", 1200), line("C", 800)])) === "No growth figure for A: its returns are not all numbers.",
    "headline: a missing figure is named, and no winner is claimed over it");
}

// ---- the view-model's other arithmetic ------------------------------------------------------------
{
  const a = fixtureAnalysis("cross");
  const r = a.returns[2];
  const hs = M.histogram(r);
  check(hs.status === "ready", "histogram: ready on real returns");
  if (hs.status === "ready") {
    const H = hs.value;
    const [lo, hi] = M.extent(r);
    check(H.counts.length === M.BINS && H.counts.reduce((s, x) => s + x, 0) === r.length && H.lo === lo && H.hi === hi,
      "histogram: 80 bins from the lowest day to the highest hold every day once", `${H.counts.length} ${H.counts.reduce((s, x) => s + x, 0)}`);
    near("histogram: the bars' area is 1, a probability density (histnorm, 1280)", H.density.reduce((s, d) => s + d * H.width, 0), 1, 1e-12);
    check(H.counts[M.BINS - 1] >= 1 && H.counts[0] >= 1, "histogram: the highest day lands in the last bin, the lowest in the first");
    near("histogram: the fit uses the mean and the ddof-1 standard deviation (1285)", H.sd, std(r), 1e-15);
    check(H.fitX.length === 200 && H.fitX[0] === lo && H.fitX[199] === hi, "histogram: the fit is drawn at 200 points from min to max (1284)");
    nearAll("histogram: the fit is the normal density", H.fitY, H.fitX.map((x) => normPdf(x, mean(r), std(r))), 1e-14);
  }
  check(M.histogram([0.01, 0.01, 0.01]).status === "empty" && M.qqState([0.01, 0.01, 0.01]).status === "empty",
    "distribution: identical returns draw nothing and say why");
  const bad = M.histogram([0.01, NaN, 0.02]);
  check(bad.status === "error" && M.qqState([0.01, NaN, 0.02]).status === "error" && M.qqState([0.01]).status === "empty",
    "distribution: a non-number fails closed, named; too few returns is empty");

  const g = M.growth(a, 10000);
  const keys = g.lines.map((l) => l.key);
  check(M.growthState(g, keys).status === "ready" && M.growthState(g, []).status === "empty" && M.growthState({ ...g, amount: 0 }, keys).status === "empty",
    "growth: every line ready; none selected or no amount draws nothing");
  const holed = { ...g, lines: g.lines.map((l, i) => (i === 1 ? { ...l, values: l.values.map((v, k) => (k === 9 ? NaN : v)) } : l)) };
  const hs2 = M.growthState(holed, keys);
  check(hs2.status === "error" && hs2.name === "the AGG growth line", "growth: a hole in one line fails the chart closed, naming the line", JSON.stringify(hs2).slice(0, 120));
  const rows = M.growthRows(g);
  check(rows.every((row, i) => row.end === g.lines[i].end && row.total === g.lines[i].total && typeof row.end === "number"),
    "growth table: raw ending values and total returns");

  check(JSON.stringify(M.niceTicks(0.3, 9.7, 5)) === JSON.stringify([0, 2, 4, 6, 8, 10]) && JSON.stringify(M.niceTicks(-0.113, 0.101, 5)) === JSON.stringify([-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15]),
    "axes: ticks on whole 1-2-2.5-5 steps covering the data", `${M.niceTicks(0.3, 9.7, 5)} | ${M.niceTicks(-0.113, 0.101, 5)}`);
  check(M.tickText(-0.05, "pct") === "−5%" && M.tickText(0.025, "pct") === "2.5%" && M.tickText(0, "num") === "0" && M.tickText(-2, "num") === "−2",
    "axes: tick text uses the fewest decimals and a true minus");
  const yt = M.yearTicks(a.prices.dates);
  check(yt[0] === "2019-01-02" && yt.every((d, i) => i === 0 || d.slice(0, 4) > yt[i - 1].slice(0, 4)) && yt.length <= 8,
    "axes: year ticks sit on each year's first trading day", yt.join(" "));
  const low = endLabelValues([1, 2, 3, 4, 5, 150], 0, 200, 300);
  const px = low.map((v) => ((200 - v) / 200) * 300);
  const sorted = [...px].sort((x, y) => x - y);
  check(px.every((y) => y >= -1e-9 && y <= 300 + 1e-9) && sorted.every((y, i) => i === 0 || y - sorted[i - 1] >= 15 - 1e-9),
    "growth: labels crowded at the bottom stay inside the plot, still 15px apart", px.map((y) => y.toFixed(1)).join());
  const lab = endLabelValues([100, 100.5, 50], 0, 200, 300);
  check(Math.abs((lab[0] - lab[1]) / 200 * 300) >= 15 - 1e-9 && lab[2] === 50, "growth: end labels that would touch are moved at least 15px apart, the rest stay",
    lab.join());
}

// ---- (c) ledger ---------------------------------------------------------------------------------------
const cross = fixtureAnalysis("cross");
const oCross = dump("cross");
{
  // ledger:excess-kurtosis. The app: the column is called "Kurtosis" (1236, 1241) and holds pandas'
  // Series.kurtosis(), which is EXCESS kurtosis: VTI's 13.89 is the engine's excess figure, 3 below
  // the plain fourth-moment ratio. The port: the same number, labelled for what it is.
  check(oracleLine(1236).includes('"Kurtosis": f"{r.kurtosis():.3f}"') && oracleLine(1241).includes('"Kurtosis": f"{bench_returns.kurtosis():.3f}"'),
    "ledger:excess-kurtosis the app labels its column plain \"Kurtosis\" (1236, 1241)");
  const r = cross.returns[0];
  const k = excessKurtosis(r);
  near("ledger:excess-kurtosis the app's VTI figure is the engine's EXCESS kurtosis", oCross.perColumn.VTI.kurt, k, 1e-10);
  const n = r.length;
  const m = mean(r);
  const plain = (r.reduce((s, x) => s + (x - m) ** 4, 0) / n) / (r.reduce((s, x) => s + (x - m) ** 2, 0) / n) ** 2;
  check(Math.abs(plain - 3 - k) < 0.05 && Math.abs(plain - k) > 2.9, "ledger:excess-kurtosis that figure is about 3 below the plain kurtosis (a normal curve scores 0)",
    `plain ${plain} excess ${k}`);
  const labels = M.SUMMARY_COLUMNS.map((c) => c.label);
  check(labels.includes("Excess kurtosis") && !labels.includes("Kurtosis"), "ledger:excess-kurtosis the port's column says \"Excess kurtosis\"", labels.join());
  check(M.summaryRows(cross)[0].exKurt === k, "ledger:excess-kurtosis the port's cell is the engine's excessKurtosis, unchanged");
}
{
  // ledger:numeric-downloads, this tab's half. The app: stats_df is built of f-strings (1235-1236) and
  // is what to_csv and df_to_excel write (1250, 1252), so its VTI return cell is the text "17.55%".
  check(oracleLine(1235).includes('"Ann. Return": f"{mu:.2%}"') && oracleLine(1250).includes("stats_df.to_csv()") &&
    oracleLine(1252).includes("df_to_excel(stats_df)"),
    "ledger:numeric-downloads the app writes its f-string summary frame to both downloads (1235, 1250, 1252)");
  const appCell = `${(oCross.perColumn.VTI.mu * 100).toFixed(2)}%`;
  check(appCell === "17.55%" && Number.isNaN(Number(appCell)), "ledger:numeric-downloads the app's VTI return cell is text a spreadsheet cannot add", appCell);
  // The port: the CSV carries the raw number and the Excel cell is numeric, formatted to show 17.55%.
  const rows = M.summaryRows(cross);
  const csv = csvText(M.SUMMARY_COLUMNS, rows).split("\n");
  const vti = csv[1].split(",");
  check(csv[0] === "Asset,Ann. Return,Ann. Volatility,Skewness,Excess kurtosis,Min Daily,Max Daily", "ledger:numeric-downloads the port's CSV header", csv[0]);
  check(vti[0] === "VTI" && vti.slice(1).every((f) => /^-?\d+(\.\d+)?(e-?\d+)?$/.test(f)), "ledger:numeric-downloads every port CSV figure is a plain number", csv[1]);
  near("ledger:numeric-downloads the port's CSV return is the full-precision number", Number(vti[1]), oCross.perColumn.VTI.mu, REL);
  const ws = worksheet(M.SUMMARY_COLUMNS, rows);
  check(ws.B2?.t === "n" && ws.B2.v === rows[0].annReturn && ws.B2.z === "0.00%" && ws.E2?.t === "n" && ws.E2.z === "0.000",
    "ledger:numeric-downloads the port's Excel cells are numbers carrying the app's formats", JSON.stringify([ws.B2, ws.E2]));
  const gcsv = csvText(M.GROWTH_COLUMNS, M.growthRows(M.growth(cross, 10000))).split("\n")[1].split(",");
  check(gcsv[0] === "VTI" && !Number.isNaN(Number(gcsv[1])) && !Number.isNaN(Number(gcsv[2])), "ledger:numeric-downloads the growth table's CSV is numbers too", gcsv.join());
}
{
  // ledger:downloads-everywhere, this tab's half. The app: Summary Statistics has both downloads
  // (1250, 1252) and the growth chart has none (1257-1266). The port: every table on the tab has both,
  // the growth figures included (their buttons are asserted on the rendered tab below).
  check(oracleLine(1250).includes('"summary_statistics.csv"') && oracleLine(1252).includes('"summary_statistics.xlsx"'),
    "ledger:downloads-everywhere the app offers Summary Statistics as CSV and Excel (1250-1252)");
  check(/Cumulative Growth/.test(oracleRange(1257, 1266)) && !/download_button/.test(oracleRange(1255, 1268)),
    "ledger:downloads-everywhere the app offers no download of the growth figures (1257-1266)");
  check(M.SUMMARY_FILE === "summary_statistics" && M.GROWTH_FILE === "cumulative_growth",
    "ledger:downloads-everywhere the port keeps the app's file name and names the new one");
}

// ---- (d) the rendered tab -----------------------------------------------------------------------------
const clean = (s) => !/NaN|undefined|Infinity/.test(s);
{
  const props = tabProps(cross);
  const r = openAll(render(h(Returns, props)));
  const $ = (sel) => r.container.querySelector(sel);
  const $$ = (sel) => [...r.container.querySelectorAll(sel)];
  const want = M.headline(M.growth(cross, props.settings.amount));
  check($(".ret-finding") && text($(".ret-finding")) === want && want.startsWith("$10,000 grew most in VTI, to $33,297"),
    "tab: the headline states the finding, literally", $(".ret-finding") ? text($(".ret-finding")) : "none");
  check(text($(".ret-dek")) === "Daily closes from 2019-01-02 to 2026-09-25, 1,944 trading days: 5 assets and the S&P 500.",
    "tab: the line under it gives the span actually used", text($(".ret-dek")));
  check(clean(text(r.container)) && clean(r.container.innerHTML), "tab: no NaN, undefined or Infinity anywhere on the tab, attributes included");

  // Tables: two, each through Table with both downloads; no raw table outside them.
  const tbls = $$(".tbl");
  const caps = tbls.map((t) => text(t.querySelector("caption .tbl-title")));
  check(tbls.length === 4 && caps.includes("Summary Statistics") && caps.includes("Growth of $10,000") && caps.includes("Calendar years") && caps.includes("Monthly returns, Equal-Weight"),
    "tab: the growth, calendar-year, monthly and Summary Statistics tables", caps.join(" | "));
  check(tbls.every((t) => ["Download CSV", "Download Excel"].every((b) => [...t.querySelectorAll("button")].some((x) => text(x) === b))),
    "ledger:downloads-everywhere every table on the tab carries CSV and Excel downloads");
  check($$("table").length === $$(".tbl table").length, "tab: every table goes through Table");
  const sum = tbls.find((t) => text(t.querySelector("caption .tbl-title")) === "Summary Statistics");
  const heads = [...sum.querySelectorAll("thead th")].map(text);
  check(heads.includes("Excess kurtosis") && !heads.includes("Kurtosis"), "ledger:excess-kurtosis the rendered header says \"Excess kurtosis\"", heads.join());
  const vtiRow = [...sum.querySelectorAll("tbody tr")][0];
  const kIdx = heads.indexOf("Excess kurtosis");
  check(text(vtiRow.children[kIdx]) === format(oCross.perColumn.VTI.kurt, "num3") && text(vtiRow.children[kIdx]) === "13.888",
    "ledger:excess-kurtosis the rendered VTI cell prints the app's figure", text(vtiRow.children[kIdx]));
  check(text(vtiRow.children[1]) === "17.55%" && [...sum.querySelectorAll("tbody tr")].length === 6, "tab: summary cells print in the app's formats, six rows");
  check(/Excess kurtosis is 0 for a normal distribution/.test(text($(".ret-key"))), "ledger:excess-kurtosis the key says what excess kurtosis measures");

  // The growth chart: six curves, each named at its end in its colour.
  const curves = () => $$(".recharts-line-curve");
  const endLabels = () => $$(".ret-endlabel").map(text);
  check(curves().length === 6 && ["VTI", "AGG", "GLD", "VNQ", "EFA", "S&P 500"].every((n) => endLabels().includes(n)),
    "tab: the growth chart draws six lines, each named in the chart", endLabels().join());
  check(!$(".recharts-legend-wrapper"), "tab: no legend where the labels do the work");
  const start = $(".ret-start line");
  const growthHow = text($('#perf-growth [data-fold="how"]'));
  check(start?.getAttribute("y") === "10000" && start.getAttribute("stroke-dasharray") === "2 3" &&
    growthHow.includes("The dotted line is the $10,000 invested; the S&P 500 is the dashed one."),
    "tab: the starting amount is a dotted line on the chart, named under the card's How it is calculated", growthHow);
  const benchCurve = $$(".recharts-line-curve").find((p) => p.getAttribute("stroke-dasharray") === DASH.bench);
  check($$(".recharts-line-curve").filter((p) => p.getAttribute("stroke-dasharray") === DASH.bench).length === 1 && benchCurve?.getAttribute("stroke") === ROLE.bench,
    "tab: the benchmark is the one dashed line, in its own ink");

  // The two info marks' texts, all three at once, under the Summary Statistics' How it is calculated.
  const tips = () => $$('.how-tip[data-tip="return"] dd, .how-tip[data-tip="volatility"] dd').map((d) => text(d).replace(/^[^:]+: /, ""));
  const all = ["return", "volatility"].flatMap((k) => ["plain", "finance", "formula"].map((l) => tipText(k, l)));
  check(all[0] !== all[2] && JSON.stringify(tips()) === JSON.stringify(all), "tab: the Summary Statistics' terms carry all three texts, as the marks had them", tips().join(" | "));

  // Toggles: hide AGG, then everything.
  const toggle = (name) => $$(".ret-toggle").find((b) => text(b) === name);
  act(() => toggle("AGG").click());
  check(toggle("AGG").getAttribute("aria-pressed") === "false" && curves().length === 5 && !endLabels().includes("AGG"),
    "tab: a toggle takes its line and its label off the chart", endLabels().join());
  for (const b of $$(".ret-toggle")) if (b.getAttribute("aria-pressed") === "true") act(() => b.click());
  const growthNote = $$(".chart-note").map(text);
  check(curves().length === 0 && growthNote.includes("No line selected. Choose at least one above.") && $$(".tbl").length === 4,
    "tab: with no line chosen the chart says so and the tables stay", growthNote.join(" | "));
  act(() => toggle("GLD").click());
  check(curves().length === 1 && endLabels().join() === "GLD", "tab: one line back, one label");

  // The distribution: the histogram by default, the Q-Q plot on request, any ticker, never the benchmark.
  const distTitle = () => text($$(".chart-title").at(-1));
  const H = M.histogram(cross.returns[0]).value;
  check(distTitle() === M.histTitle("VTI", cross.returns[0]) && distTitle() === "VTI has fatter tails than a normal curve: excess kurtosis 13.89",
    "tab: the histogram's title states the finding", distTitle());
  const svg = () => $$(".ret-svg").at(-1);
  check(svg().querySelectorAll("rect").length === H.counts.filter((c) => c > 0).length && /Normal fit/.test(text(svg())),
    "tab: one bar per occupied bin, and the fit named in the chart");
  const opts = [...$("select").options].map((o) => o.value);
  check(JSON.stringify(opts) === JSON.stringify(cross.tickers), "tab: the asset list is the tickers, without the benchmark (1275)", opts.join());
  const qqPill = $$("[role=radio]").find((b) => text(b) === "Q-Q Plot");
  act(() => qqPill.click());
  const q = M.qqState(cross.returns[0]);
  check(distTitle() === M.qqTitle("VTI", q) && distTitle() === "VTI's worst day was −11.38%; the normal line puts its lowest day at −3.86%",
    "tab: the Q-Q plot's title states the finding", distTitle());
  check(svg().querySelectorAll("circle").length === cross.returns[0].length && /Normal line/.test(text(svg())) && /Worst day −11\.38%/.test(text(svg())),
    "tab: one dot per day, the line and the worst day named in the chart");
  const sel = $("select");
  act(() => {
    sel.value = "GLD";
    sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  check(distTitle() === M.qqTitle("GLD", M.qqState(cross.returns[2])), "tab: choosing another asset redraws for it", distTitle());
  check(clean(r.container.innerHTML), "tab: still no NaN after every control has moved");
  r.unmount();
}
{
  // Fail closed and named: one ticker with a hole in its returns. Its growth line, its summary row and
  // its distribution say so; every other card still renders; no NaN reaches the page.
  const holed = { ...cross, returns: cross.returns.map((c, i) => (i === 0 ? c.map((v, k) => (k === 40 ? NaN : v)) : c)) };
  const r = openAll(render(h(Returns, tabProps(holed))));
  const all = text(r.container);
  check(/Chart not drawn: the VTI growth line failed/.test(all), "tab: a broken growth line fails the chart closed, naming it");
  check(/Chart not drawn: the return series failed/.test(all), "tab: the distribution of that ticker fails closed, named");
  check(/No growth figure for VTI/.test(all), "tab: the headline names the missing figure and claims no winner");
  // The months grid of a series with a hole fails closed and named, so its table goes with it: three tables stay.
  check(r.container.querySelectorAll(".tbl").length === 3 && clean(all) && clean(r.container.innerHTML), "tab: the tables stay, with no NaN on the page");
  check(/Chart not drawn: Equal-Weight's months failed/.test(all), "tab: a hole in an asset fails the months grid of a portfolio holding it, named");
  const summaryVti = [...[...r.container.querySelectorAll(".tbl")].find((t) => /Summary/.test(text(t.querySelector("caption")))).querySelectorAll("tbody tr")][0];
  check([...summaryVti.querySelectorAll("td")].every((td) => text(td) === "–"), "tab: VTI's summary figures print the dash, not part-figures",
    [...summaryVti.querySelectorAll("td")].map(text).join());
  r.unmount();
}
{
  // A starting amount the rail would refuse still draws nothing rather than a line at zero.
  const r = openAll(render(h(Returns, tabProps(cross, { settings: { ...tabProps(cross).settings, amount: 0 } }))));
  check(/Enter a starting amount above \$0/.test(text(r.container)) && /returned the most/.test(text(r.container.querySelector(".ret-finding"))),
    "tab: with no usable amount the chart says so and the headline speaks in returns", text(r.container.querySelector(".ret-finding")));
  check(clean(r.container.innerHTML), "tab: no NaN with no usable amount");
  r.unmount();
}

const typeInto = (input, v) => act(() => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, v);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
});

// ---- the kicker, the tables' spans, and the starting amount on the growth chart ------------------------
{
  const calls = [];
  const r = openAll(render(h(Returns, tabProps(cross, { requestSettings: (p) => calls.push(p) }))));
  check(!r.container.querySelector(".ret-kicker") && !/Return computation|exploratory analysis/i.test(text(r.container)),
    "kicker: the chapter row names the view, so the tab carries no kicker, and never the assignment's heading");
  const spans = [...r.container.querySelectorAll(".tbl")].map((t) => [text(t.querySelector(".tbl-title")), text(t.querySelector(".tbl-span"))]);
  check(JSON.stringify(spans) === JSON.stringify([
    ["Growth of $10,000", `Daily closes, ${cross.prices.dates[0]} to ${cross.asOf}`],
    ["Calendar years", `Daily closes, ${cross.prices.dates[0]} to ${cross.asOf}`],
    ["Monthly returns, Equal-Weight", `Monthly returns, ${cross.prices.dates[0]} to ${cross.asOf}`],
    ["Summary Statistics", `Daily returns, ${cross.dates[0]} to ${cross.asOf}`],
  ]), "spans: the growth, calendar-year and month tables start at the window's first close, the statistics at its first return", JSON.stringify(spans));
  const monthSub = text(r.container.querySelector("#perf-months .ret-months-sub"));
  check(monthSub.startsWith(`Each month's trading days compounded, ${cross.prices.dates[0]} to `),
    "spans: the months grid dates its window from the first close, as the calendar years do", monthSub);
  const frame = r.container.querySelector(".ret-chart .chart-frame");
  const input = frame?.querySelector(".chart-head .amount-field input");
  check(!!input && input.value === "10000" && text(frame.querySelector(".amount-field label")) === "Growth of $",
    "amount: the growth chart carries its own Growth of $ field, at the $10,000 default");
  typeInto(input, "25000");
  typeInto(input, "");
  check(JSON.stringify(calls) === JSON.stringify([{ amount: 25000 }]) && /at least \$100/.test(text(frame.querySelector(".amount-field [role=alert]") ?? frame)),
    "amount: a valid amount on the growth chart becomes the setting, an empty one is refused and says why", JSON.stringify(calls));
  r.rerender(h(Returns, tabProps(cross, { settings: { ...tabProps(cross).settings, amount: 40000 } })));
  check(input.value === "40000" && text(r.container.querySelector(".ret-chart .chart-title")).includes("$40,000"),
    "amount: an amount set elsewhere shows in the chart's field and its title", input.value);
  r.unmount();
}

// ---- calendar years and the months grid ----------------------------------------------------------------
// Every printed cell against the engine (calendarYears, monthlyReturns) run here on the column's own daily
// returns, rebuilt from its weights; the partial years' labels against the dates; the grid's cells, colours
// and scale against the returns alone. On the baked example and the mega-cap fixture, with a typed mix.
{
  const { exampleAnalysis } = await import("./_analysis.mjs");
  const { calendarYears, monthlyReturns } = await import("../src/lib/monthly.ts");
  const { portfolioReturns } = await import("../src/lib/portfolio.ts");
  const { customWeights, weightsOf, PORT_LABEL } = await import("../src/tabs/optimization/model.ts");
  const { FITTED } = await import("../src/tabs/caption.ts");
  const { MONTH_TINT } = await import("../src/tabs/returns/years.ts");
  const { monthYear } = await import("../src/chrome/when.ts");
  const { tokens } = await import("../src/styles/tokens.ts");
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const rowsOf = (tbl) => [...tbl.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map(text));
  const tableTitled = (root, t) => [...root.querySelectorAll(".tbl")].find((x) => text(x.querySelector(".tbl-title")) === t);
  const radio = (root, label) => [...root.querySelectorAll("button[role=radio]")].find((b) => text(b) === label);
  const press = (el) => act(() => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  const rgb = (x) => (/rgb\((\d+), (\d+), (\d+)\)/.exec(x) ?? []).slice(1).map(Number);
  const hex = (x) => [1, 3, 5].map((k) => parseInt(x.slice(k, k + 2), 16));
  const PAPER = hex(tokens.color.paper);
  const UP = hex(tokens.color.up);
  const DOWN = hex(tokens.color.down);
  const subOf = (tbl, label) => {
    const sub = [...tbl.querySelectorAll("thead th")].find((th) => text(th.firstChild) === label)?.querySelector(".tbl-sub");
    return sub ? text(sub) : "";
  };
  const columnsOf = (a, typed) => {
    const c = customWeights(a, typed);
    const port = (w) => (w ? portfolioReturns(a.returns, w) : null);
    return [
      { label: PORT_LABEL.ew, r: port(weightsOf(a, "ew")) },
      { label: PORT_LABEL.gmv, r: port(weightsOf(a, "gmv")) },
      { label: PORT_LABEL.tangency, r: port(weightsOf(a, "tangency")) },
      { label: "Custom", r: c.ok ? port(c.w) : null },
      { label: a.benchLabel, r: a.bench },
    ];
  };

  for (const [set, a] of [["example", exampleAnalysis()], ["megacap", fixtureAnalysis("megacap")]]) {
    const tag = (x) => `${set}: ${x}`;
    const typed = Object.fromEntries(a.tickers.map((t, i) => [t, (a.tickers.length - i) / 10]));
    const cols = columnsOf(a, typed);
    const r = openAll(render(h(Returns, tabProps(a, { weights: typed }))));
    const sec = r.container.querySelector("#perf-years")?.parentElement ?? null;

    // Where it sits: the first More row after the growth card, Month by month next, before the Summary Statistics.
    const heads = [...r.container.querySelectorAll(".more-title")].map(text);
    const growthCard = r.container.querySelector("#perf-growth");
    check(!!sec && same(heads, ["Calendar years", "Month by month", "Summary Statistics", "Return Distribution"])
      && (growthCard.compareDocumentPosition(sec) & 4) !== 0, tag("years: the Calendar years row is the first under the growth card, anchored perf-years"), heads.join(" | "));
    if (!sec) {
      r.unmount();
      continue;
    }

    // The table: years down, the five columns across, every cell the engine's year on that column's returns.
    const tbl = tableTitled(sec, "Calendar years");
    const thead = [...tbl.querySelectorAll("thead th")].map((th) => text(th.firstChild));
    check(same(thead, ["Year", ...cols.map((c) => c.label)]), tag("years: Year, then Equal-Weight, GMV, Tangency, Custom and the benchmark"), thead.join(" | "));
    const spine = calendarYears(a.bench, a.dates);
    const per = cols.map((c) => calendarYears(c.r, a.dates));
    const got = rowsOf(tbl);
    const want = spine.map((y, i) => [got[i]?.[0], ...per.map((ys) => format(ys[i].ret, "pct1"))]);
    check(spine.length > 1 && same(got, want), tag("years: every cell is the engine's compounded year on that column's daily returns"), JSON.stringify(got[1]));
    check(tbl.querySelector(".tbl-title").classList.contains("tbl-title-clip"), tag("years: the title repeats the heading right above it, so it is clipped from the screen"));
    check(subOf(tbl, "GMV") === FITTED && subOf(tbl, "Tangency") === FITTED && subOf(tbl, "Equal-Weight") === "", tag("years: GMV and Tangency carry the fitted line"));
    check(/fixed and is rebalanced to them daily/.test(text(sec.querySelector(".ret-note"))), tag("years: the note says fixed weights, rebalanced daily"));
    check(/GMV's and Tangency's\s+weights were chosen on this window, so their years are in-sample/.test(text(sec.querySelector(".ret-note"))),
      tag("years: the note says GMV's and Tangency's weights were chosen on this window, so their years are in-sample"));

    // The partial years' labels, from the dates: the first from the first close, the last to the last close.
    const labels = got.map((row) => row[0]);
    const y0 = Number(a.dates[0].slice(0, 4));
    const yN = Number(a.asOf.slice(0, 4));
    check(labels[0] === `${y0}, from ${a.prices.dates[0]}` && labels.at(-1) === `${yN}, to ${a.asOf}`
      && labels.slice(1, -1).every((l, i) => l === String(y0 + 1 + i)), tag("years: the partial first and last years say their dates, the rest are bare years"), labels.join(" | "));

    // The months grid, for each of the five: one cell per month with data, its figure, its colour's side.
    for (const col of cols) {
      press(radio(sec, col.label));
      const months = monthlyReturns(col.r, a.dates);
      const cells = [...sec.querySelectorAll("g.ret-month")];
      const reach = Math.max(...months.map((m) => Math.abs(m.ret)));
      check(cells.length === months.length && same(cells.map((g) => g.getAttribute("data-month")), months.map((m) => m.ym)),
        tag(`months: ${col.label} has one cell per month with data, in order`), `${cells.length} vs ${months.length}`);
      check(cells.every((g, i) => text(g.querySelector("text")) === format(months[i].ret, "pct1")), tag(`months: ${col.label}'s cells print the engine's month`));
      const wrongSide = cells.filter((g, i) => {
        const [R, G] = rgb(g.querySelector("rect").getAttribute("fill"));
        const lean = PAPER[0] - R - (PAPER[1] - G); // positive towards the gain colour, negative towards the loss colour
        return lean !== 0 ? Math.sign(lean) !== Math.sign(months[i].ret) : Math.abs(months[i].ret) / reach > 0.02;
      });
      check(wrongSide.length === 0, tag(`months: ${col.label}'s colours sit on the side of zero their returns do`), wrongSide.map((g) => g.getAttribute("data-month")).join());
      const offScale = cells.filter((g, i) => {
        const c = rgb(g.querySelector("rect").getAttribute("fill"));
        const t = months[i].ret < 0 ? (PAPER[1] - c[1]) / (PAPER[1] - DOWN[1]) : (PAPER[0] - c[0]) / (PAPER[0] - UP[0]);
        return Math.abs(t - (MONTH_TINT * Math.abs(months[i].ret)) / reach) > 0.004;
      });
      check(offScale.length === 0, tag(`months: ${col.label}'s shading is proportional to the month over one reach, the same both ways`), offScale.map((g) => g.getAttribute("data-month")).join());
      const flagged = cells.map((g) => g.getAttribute("data-partial") === "true");
      check(same(flagged, months.map((m) => m.partial)) && flagged[0] && flagged.at(-1) && !!sec.querySelector(".ret-months-note"),
        tag(`months: ${col.label}'s first and last months are marked, and the note explains the mark`));
      const lo = text(sec.querySelector(".ret-months-scale-lo"));
      const hi = text(sec.querySelector(".ret-months-scale-hi"));
      check(lo === format(-reach, "pct1") && hi === format(reach, "pct1"), tag(`months: ${col.label}'s scale runs from minus to plus the largest month either way`), `${lo} ${hi}`);
      const mt = tableTitled(sec, `Monthly returns, ${col.label}`);
      const mrows = mt ? rowsOf(mt) : [];
      const byYm = new Map(months.map((m) => [m.ym, m]));
      const wantRows = mrows.map((row) => [row[0], ...Array.from({ length: 12 }, (_, k) => format(byYm.get(`${row[0]}-${String(k + 1).padStart(2, "0")}`)?.ret ?? null, "pct1"))]);
      check(mrows.length === yN - y0 + 1 && same(mrows, wantRows), tag(`months: ${col.label}'s table holds the same months, a dash where the window has none`));
      check(col.label !== "GMV" || (sec.querySelector(".ret-fitted") !== null && text(sec.querySelector(".ret-fitted")) === FITTED), tag("months: GMV's pick carries the fitted line"));
    }
    const first = sec.querySelector("g.ret-month");
    press(first);
    const m0 = monthlyReturns(cols.at(-1).r, a.dates)[0];
    check(text(sec.querySelector(".ret-months-readout")) === `${monthYear(`${m0.ym}-01`)}: ${format(m0.ret, "pct1")}, part of the month`,
      tag("months: a tapped cell is named in the readout, its part-month said"), text(sec.querySelector(".ret-months-readout")));
    check(clean(r.container.innerHTML), tag("years: no NaN anywhere with the section on the tab"));
    r.unmount();
  }

  // A window inside one calendar year (the rail asks for two years, so only a cut series gets here) is one
  // partial year, labelled with both of its ends, read from the dates.
  {
    const { yearLabel } = await import("../src/tabs/returns/years.ts");
    const a = exampleAnalysis();
    const k = a.dates.findIndex((d) => d >= "2021-02-01");
    const n = a.dates.findIndex((d) => d >= "2021-12-01");
    const ys = calendarYears(a.bench.slice(k, n), a.dates.slice(k, n));
    const label = yearLabel(ys[0], true, true, a.dates[k - 1]);
    check(ys.length === 1 && ys[0].partial && label === `2021, ${a.dates[k - 1]} to ${a.dates[n - 1]}`, "years: a window inside one year is one partial year, from its first close to its last", label);
  }

  // At a phone's width the grid scrolls inside its own box: the box scrolls, the drawing keeps its size.
  {
    const css = readFileSync(new URL("../src/tabs/returns/Returns.css", import.meta.url), "utf8");
    check(/\.ret-months-scroll \{[^}]*overflow-x: auto;[^}]*max-width: 100%;/.test(css) && /\.ret-months-pick > \.seg \{[^}]*min-width: 0;/.test(css),
      "months: the grid scrolls inside its own box and the pill row may shrink, so the page never scrolls sideways");
  }
}

// ---- the Performance chapter's shape: closed rows draw nothing, findings are their cards' figures ---------
{
  const P = await import("../src/tabs/performance.ts");
  const { forgetMore } = await import("../src/components/MoreList.tsx");
  const { portfolioSeries, yearRows } = await import("../src/tabs/returns/years.ts");
  const { customWeights } = await import("../src/tabs/optimization/model.ts");
  forgetMore();
  const r = render(h(Returns, tabProps(cross)));
  const bodies = [...r.container.querySelectorAll(".more-body")];
  check(bodies.length === 4 && bodies.every((b) => b.hidden && b.childElementCount === 0) && r.container.querySelectorAll(".tbl").length === 0,
    "rows: at rest every row is closed and has drawn nothing, its table included", `${bodies.length} rows`);
  const series = portfolioSeries(cross, customWeights(cross, {}));
  const findings = [...r.container.querySelectorAll(".more-finding")].map(text);
  const want = [P.yearsFinding(cross, series), P.monthsFinding(cross, series), P.summaryFinding(cross), P.distFinding(cross)];
  check(JSON.stringify(findings) === JSON.stringify(want), "rows: each row's finding is its model's, in the rows' order", findings.join(" | "));
  // The summary finding names the highest and lowest volatility in the table, rebuilt here.
  const rows = M.summaryRows(cross).filter((x) => typeof x.annVol === "number");
  const hi = rows.reduce((a, b) => (b.annVol > a.annVol ? b : a));
  const lo = rows.reduce((a, b) => (b.annVol < a.annVol ? b : a));
  check(findings[2] === `${hi.asset} swung most, ${format(hi.annVol, "pct1")} a year; ${lo.asset} least, ${format(lo.annVol, "pct1")}.`,
    "rows: the summary row names the table's most and least volatile, at its figures", findings[2]);
  // The years finding reads whole years only: the window's partial first and last years are left out.
  const whole = yearRows(cross, series).filter((y) => !String(y.year).includes(",")).map((y) => String(y.year));
  const named = [...findings[0].matchAll(/ in (\d{4})\b/g)].map((m) => m[1]);
  check(named.length === 2 && named.every((y) => whole.includes(y)) && /^Best whole year: .+\(.+\), /.test(findings[0]),
    "rows: the years row names two whole years, the plain name first and the scorecard's beside it", findings[0]);
  // A series whose partial first year is by far its best (five +20% days on its first closes) still has a whole year
  // named as its best.
  const first = String(cross.dates[0].slice(0, 4));
  const boosted = cross.bench.map((v, i) => (i < 5 ? 0.2 : v));
  const only = [{ id: "bench", label: cross.benchLabel, sub: null, r: boosted }];
  const top = /^Best whole year: [^,]+, \S+ in ([^.]+)\./.exec(P.yearsFinding(cross, only))?.[1];
  check(top !== undefined && top !== first && whole.includes(top), "rows: a partial year is never the years row's best, however large", P.yearsFinding(cross, only));
  // A finding that throws costs only its line.
  const err = console.error;
  console.error = () => {};
  const fell = P.said("Test", () => { throw new Error("planted"); });
  console.error = err;
  check(fell === "This finding could not be stated.", "rows: a finding that throws says so in its row and throws no further", fell);
  // A chart inside a card: the card's title says it, so the frame's subtitle is not drawn and its title is for a screen reader.
  openAll(r);
  const heads = [...r.container.querySelectorAll(".card .chart-head")];
  check(heads.length > 0 && heads.every((x) => x.classList.contains("chart-head--bare") && !x.querySelector(".chart-sub")),
    "cards: every chart inside a card is bare, with no subtitle under the card's own title", `${heads.length} charts`);
  r.unmount();

  // The mixes view: the three mixes under their plain names and the benchmark, dashed; Your mix joins only once it
  // is not the equal split; the numbers fold lists the same lines.
  const growthCard = (root) => root.querySelector("#perf-growth");
  const ends = (root) => [...growthCard(root).querySelectorAll(".wealth-line")].map((l) => l.getAttribute("class"));
  const names = (root) => [...growthCard(root).querySelectorAll("tbody tr")].map((tr) => text(tr.children[0]));
  for (const [weights, mine] of [[{}, false], [{ VTI: 0.7, AGG: 0.3 }, true]]) {
    const m = openAll(render(h(Returns, tabProps(cross, { weights }))));
    const pill = [...growthCard(m.container).querySelectorAll("[role=radio]")].find((b) => text(b) === "The mixes");
    act(() => pill.click());
    openAll(m);
    const want = ["Best-tradeoff", "Equal split", "Lowest-risk", ...(mine ? ["Your mix"] : []), cross.benchLabel];
    const dashed = [...growthCard(m.container).querySelectorAll(".recharts-line-curve")].filter((p) => p.getAttribute("stroke-dasharray") === DASH.bench);
    check(JSON.stringify(names(m.container)) === JSON.stringify(want) && ends(m.container).length === want.length && dashed.length === 1 &&
      !growthCard(m.container).querySelector(".ret-toggle"),
      `mixes: the mixes view draws ${mine ? "Your mix with" : "only"} the three mixes and the benchmark, the benchmark dashed`, names(m.container).join(" | "));
    m.unmount();
  }
}

done("t-tab-returns");
