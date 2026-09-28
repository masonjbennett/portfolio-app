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
import { render, text, act } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, near, nearAll, json, done } from "./_assert.mjs";
import { fixtureAnalysis, tabProps, ORACLE_RF } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const M = await import("../src/tabs/returns/model.ts");
const Returns = (await import("../src/tabs/Returns.tsx")).default;
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
  const r = render(h(Returns, props));
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
  const caps = tbls.map((t) => text(t.querySelector("caption")));
  check(tbls.length === 2 && caps.includes("Summary Statistics") && caps.includes("Growth of $10,000"), "tab: the Summary Statistics and growth tables", caps.join(" | "));
  check(tbls.every((t) => ["Download CSV", "Download Excel"].every((b) => [...t.querySelectorAll("button")].some((x) => text(x) === b))),
    "ledger:downloads-everywhere every table on the tab carries CSV and Excel downloads");
  check($$("table").length === $$(".tbl table").length, "tab: every table goes through Table");
  const sum = tbls.find((t) => text(t.querySelector("caption")) === "Summary Statistics");
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
  check(start?.getAttribute("y") === "10000" && start.getAttribute("stroke-dasharray") === "2 3" &&
    text($(".chart-sub")).endsWith("The dashed line is the $10,000 invested."),
    "tab: the starting amount is a dashed line on the chart, named under its title", text($(".chart-sub")));

  // The level switch changes the tooltip text; the tips follow the shorting toggle too.
  const tips = () => $$(".ret-key .tip-text").map(text);
  const plain = [tipText("return", "plain"), tipText("volatility", "plain")];
  const formula = [tipText("return", "formula"), tipText("volatility", "formula")];
  check(plain[0] !== formula[0] && JSON.stringify(tips()) === JSON.stringify(plain), "tab: the tooltips show the Plain text", tips().join(" | "));
  r.rerender(h(Returns, { ...props, level: "formula" }));
  check(JSON.stringify(tips()) === JSON.stringify(formula), "tab: switching the level to Formula changes the tooltip text", tips().join(" | "));

  // Toggles: hide AGG, then everything.
  const toggle = (name) => $$(".ret-toggle").find((b) => text(b) === name);
  act(() => toggle("AGG").click());
  check(toggle("AGG").getAttribute("aria-pressed") === "false" && curves().length === 5 && !endLabels().includes("AGG"),
    "tab: a toggle takes its line and its label off the chart", endLabels().join());
  for (const b of $$(".ret-toggle")) if (b.getAttribute("aria-pressed") === "true") act(() => b.click());
  const growthNote = $$(".chart-note").map(text);
  check(curves().length === 0 && growthNote.includes("No line selected. Choose at least one above.") && $$(".tbl").length === 2,
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
  const r = render(h(Returns, tabProps(holed)));
  const all = text(r.container);
  check(/Chart not drawn: the VTI growth line failed/.test(all), "tab: a broken growth line fails the chart closed, naming it");
  check(/Chart not drawn: the return series failed/.test(all), "tab: the distribution of that ticker fails closed, named");
  check(/No growth figure for VTI/.test(all), "tab: the headline names the missing figure and claims no winner");
  check(r.container.querySelectorAll(".tbl").length === 2 && clean(all) && clean(r.container.innerHTML), "tab: the tables stay, with no NaN on the page");
  const summaryVti = [...[...r.container.querySelectorAll(".tbl")].find((t) => /Summary/.test(text(t.querySelector("caption")))).querySelectorAll("tbody tr")][0];
  check([...summaryVti.querySelectorAll("td")].every((td) => text(td) === "–"), "tab: VTI's summary figures print the dash, not part-figures",
    [...summaryVti.querySelectorAll("td")].map(text).join());
  r.unmount();
}
{
  // A starting amount the rail would refuse still draws nothing rather than a line at zero.
  const r = render(h(Returns, tabProps(cross, { settings: { ...tabProps(cross).settings, amount: 0 } })));
  check(/Enter a starting amount above \$0/.test(text(r.container)) && /returned the most/.test(text(r.container.querySelector(".ret-finding"))),
    "tab: with no usable amount the chart says so and the headline speaks in returns", text(r.container.querySelector(".ret-finding")));
  check(clean(r.container.innerHTML), "tab: no NaN with no usable amount");
  r.unmount();
}

done("t-tab-returns");
