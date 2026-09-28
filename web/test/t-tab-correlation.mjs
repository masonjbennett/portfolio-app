// The Correlation tab (portfolio_app.py 1421-1462): its view-model held to the oracle's own numbers on
// every fixture, and the whole tab rendered in jsdom: headline, heatmap, rolling chart, both tables
// with both downloads, the tooltip following the level, and closest-cell hover.
//
// Every assertion here was mutation-tested by hand: the code it guards broken, the check seen red.
import { render, text, act } from "./_dom.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { check, nearAll, json, done } from "./_assert.mjs";
import { fixtureAnalysis, tabProps } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const Correlation = (await import("../src/tabs/Correlation.tsx")).default;
const M = await import("../src/tabs/correlation/model.ts");
const { tokens } = await import("../src/styles/tokens.ts");
const { MINUS, format } = await import("../src/format.ts");
const TIPS = json(new URL("../src/content/tooltips.json", import.meta.url));

const SRC = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8").split(/\r?\n/);
const line = (n) => SRC[n - 1] ?? "";
const oracle = (set) => json(new URL(`./fixtures/oracle-${set}.json`, import.meta.url));
const at = (series, idx) => idx.map((i) => series[i]);
const col = tokens.color;

// Python's f"{x:.Nf}", printed with the page's minus sign and no sign on a value that rounds to zero.
function py(x, d) {
  const s = x.toFixed(d);
  if (!s.startsWith("-")) return s;
  return /[1-9]/.test(s) ? MINUS + s.slice(1) : s.slice(1);
}

// The most and least correlated pair of a matrix, re-derived here: first in row order wins a tie.
function extremes(tickers, C) {
  let hi = null;
  let lo = null;
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const r = C[i][j];
      if (!Number.isFinite(r)) continue;
      if (!hi || r > hi.r) hi = { a: tickers[i], b: tickers[j], r };
      if (!lo || r < lo.r) lo = { a: tickers[i], b: tickers[j], r };
    }
  }
  return { hi, lo };
}
const headOf = ({ hi, lo }) => `${hi.a} and ${hi.b} were the most correlated pair (${py(hi.r, 2)}), ${lo.a} and ${lo.b} the least (${py(lo.r, 2)}).`;

// ---- parity: every fixture, against the oracle's own dump -----------------------------------------

for (const set of ["cross", "megacap", "sectors", "dirty", "cross_vti"]) {
  const a = fixtureAnalysis(set);
  const o = oracle(set);
  const tk = o.clean.tickers;
  // cross_vti: the app drops VTI from the portfolio (it is also the benchmark); the port keeps it, so
  // the oracle's matrix is compared with the port's rows and columns for the oracle's tickers.
  const idx = tk.map((t) => a.tickers.indexOf(t));
  check(idx.every((i) => i >= 0), `${set}: every asset the oracle analysed is in the port's analysis`, `${tk} vs ${a.tickers}`);
  const v = M.corrView(a);
  nearAll(`${set}: the heatmap's matrix is DataFrame.corr() of the daily returns (1426)`, idx.flatMap((i) => idx.map((j) => v.matrix[i][j])), o.corr.flat(), 0, 1e-12);
  const rows = M.matrixRows(a.tickers, a.S);
  nearAll(`${set}: the covariance table's rows are cov_matrix's raw numbers (1164, 1462)`,
    idx.flatMap((i) => idx.map((j) => rows[i][`c:${a.tickers[j]}`])), o.cov.flat(), 1e-12, 1e-20);
  check(rows.every((r, i) => r.asset === a.tickers[i]) && Object.values(rows[0]).slice(1).every((x) => typeof x === "number"),
    `${set}: covariance rows carry the asset label and raw numbers, never strings`);
  for (const w of Object.keys(o.rolling)) {
    const e = o.rolling[w].corr01;
    const s = M.rollView(a, tk[0], tk[1], Number(w));
    check(s.status === "ready", `${set}: ${w}-day rolling correlation of ${tk[0]} and ${tk[1]} is drawn`);
    if (s.status === "ready") {
      nearAll(`${set}: ${w}-day rolling correlation = rolling(w).corr() (1451)`, at(s.value.series, e.i), e.v, 0, 1e-9);
      check(s.value.points.length === a.dates.length - Number(w) + 1 && s.value.points[0].date === a.dates[Number(w) - 1],
        `${set}: the ${w}-day line starts at the first full window`, `${s.value.points.length} points from ${s.value.points[0].date}`);
    }
  }
  if (set !== "cross_vti") {
    check(M.headline(v) === headOf(extremes(tk, o.corr)), `${set}: the headline names the oracle matrix's most and least correlated pair`, M.headline(v));
    const n = tk.length;
    const neg = extremes(tk, o.corr).lo.r < 0;
    check(!neg && M.heatTitle(v) === `All ${(n * (n - 1)) / 2} pairs were positively correlated`,
      `${set}: the heatmap's title counts the pairs above zero`, M.heatTitle(v));
  }
}

// ---- the copy, on cross --------------------------------------------------------------------------

const cross = fixtureAnalysis("cross");
const oc = oracle("cross");
const HEAD = "VTI and EFA were the most correlated pair (0.86), VTI and GLD the least (0.13).";
check(M.headline(M.corrView(cross)) === HEAD, "cross: the headline, literally", M.headline(M.corrView(cross)));
check(M.heatSubtitle(M.corrView(cross)) === `Pearson correlation of daily returns, ${cross.dates[0]} to ${cross.asOf} (1,943 daily returns).` && oc.returns.rows === 1943,
  "cross: the heatmap's subtitle names the period and the count of return rows", M.heatSubtitle(M.corrView(cross)));

// Sign-flipped GLD: four pairs go negative, the least correlated pair is negative and prints a minus.
function withColumn(a, k, f) {
  return { ...a, returns: a.returns.map((c, i) => (i === k ? c.map(f) : c)) };
}
{
  const flip = M.corrView(withColumn(cross, 2, (x) => -x));
  check(M.heatTitle(flip) === "4 of 10 pairs were negatively correlated", "negative pairs: the title counts them", M.heatTitle(flip));
  check(M.headline(flip) === `VTI and EFA were the most correlated pair (0.86), AGG and GLD the least (${MINUS}0.31).`,
    "negative pairs: the least correlated pair is the most negative, printed with a minus sign", M.headline(flip));
  check(M.heatTitle({ pairs: new Array(10), positive: 9, negative: 1 }) === "1 of 10 pairs was negatively correlated", "negative pairs: one pair is singular");
}

// ---- the window and the default pair: the app's own controls ---------------------------------------

check(/options=\[30, 60, 90, 120\], value=60/.test(line(1448)) && JSON.stringify(M.WINDOWS) === "[30,60,90,120]" && M.DEFAULT_WINDOW === 60,
  "rolling: the windows and the default are the app's select_slider (1448)", line(1448).trim());
check(/index=0/.test(line(1444)) && /index=min\(1, n_assets - 1\)/.test(line(1446)) &&
  JSON.stringify(M.defaultPair(["A", "B", "C"])) === '["A","B"]' && JSON.stringify(M.defaultPair(["A"])) === '["A","A"]',
  "rolling: the pair opens on the first and second assets, index=min(1, n-1) (1444, 1446)");
check(/Select two different stocks\./.test(line(1458)) && M.rollView(cross, "VTI", "VTI", 60).status === "empty" &&
  M.rollView(cross, "VTI", "VTI", 60).reason === "Select two different assets.",
  "rolling: the same asset twice is the app's st.info in the chart's place (1458)");
{
  const r = M.rollView(cross, "VTI", "AGG", 60).value;
  const def = r.series.filter(Number.isFinite);
  check(r.high.r === Math.max(...def) && r.low.r === Math.min(...def) && r.latest.r === def[def.length - 1] && r.latest.date === cross.asOf,
    "rolling: high, low and latest are the series' own", `${r.low.r} ${r.high.r} ${r.latest.r}`);
  check(r.marks.map((m) => m.text).join("|") === `high ${py(r.high.r, 2)}|low ${py(r.low.r, 2)}|latest ${py(r.latest.r, 2)}`,
    "rolling: the line carries its high, low and latest as labels", r.marks.map((m) => m.text).join("|"));
  const flat = M.rollView(withColumn(cross, 1, () => 0), "VTI", "AGG", 60);
  check(flat.status === "empty" && /not defined in any window/.test(flat.reason), "rolling: a constant asset gives a named empty state, never a line of NaN", flat.reason);
}

// ---- the colour scale: tokens only, ink legible on every cell -------------------------------------

const rgb = (s) => (s.startsWith("#") ? [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16)) : s.match(/\d+/g).map(Number));
const mix = (a, b, t) => `rgb(${rgb(a).map((p, k) => Math.round(p + (rgb(b)[k] - p) * t)).join(", ")})`;
const lum = (s) => {
  const [r, g, b] = rgb(s).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
check(M.tint(0) === mix(col.paper, col.paper, 0) && M.tint(-1) === mix(col.paper, col.navy, M.MAX_TINT) && M.tint(1) === mix(col.paper, col.claret, M.MAX_TINT) &&
  M.tint(NaN) === col.hairline2 && M.tint(-3) === M.tint(-1),
  "scale: paper at 0, towards navy below and claret above (the app's blue-white-red, 1429), hairline when undefined",
  `${M.tint(-1)} ${M.tint(0)} ${M.tint(1)}`);
{
  let worst = Infinity;
  let monotone = true;
  for (let k = -100; k <= 100; k++) {
    const r = k / 100;
    worst = Math.min(worst, contrast(col.ink, M.tint(r)));
    if (k > -100 && k <= 0 && lum(M.tint(r)) < lum(M.tint((k - 1) / 100))) monotone = false;
    if (k > 0 && lum(M.tint(r)) > lum(M.tint((k - 1) / 100))) monotone = false;
  }
  check(worst >= 4.5, "scale: ink figures reach 4.5:1 contrast on every cell from -1 to +1", worst.toFixed(2));
  check(monotone, "scale: a stronger correlation is never a lighter cell, either side of zero");
}
{
  const files = ["src/tabs/Correlation.tsx", ...readdirSync(new URL("../src/tabs/correlation/", import.meta.url)).map((f) => `src/tabs/correlation/${f}`)];
  const hex = files.filter((f) => /#[0-9a-f]{3,8}\b/i.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")));
  check(files.length >= 5 && hex.length === 0, "scale: no colour literal in the tab's files; every colour is a token", `${files.length} files; hex in ${hex.join(" ")}`);
}

// ---- the whole tab, rendered ---------------------------------------------------------------------

const errs = [];
const { error } = console;
const quiet = () => (console.error = (...a) => errs.push(a.map(String).join(" ")));
const loud = () => (console.error = error);

// jsdom lays nothing out, so every box measures 0 and a responsive chart falls back to 100px wide,
// narrower than its own margins. Give boxes a desktop column's width so the line is drawn.
{
  const P = window.HTMLElement.prototype;
  P.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 380, width: 720, height: 380, toJSON() {} });
  for (const k of ["clientWidth", "offsetWidth"]) Object.defineProperty(P, k, { configurable: true, get: () => 720 });
}

const t = render(h(Correlation, tabProps(cross)));
const page = () => text(t.container);
const n = cross.tickers.length;

check(text(t.container.querySelector("h2.corr-headline")) === HEAD, "tab: the headline states the finding, literally", text(t.container.querySelector("h2.corr-headline")));
check(!/NaN|undefined|Infinity|null/.test(page()), "tab: no NaN, undefined, Infinity or null on the page");

// Heatmap: one cell per pair, each printing the oracle's .2f, filled from the scale.
const cells = [...t.container.querySelectorAll("g.corr-cell")];
check(cells.length === n * n, "heatmap: n x n cells", `${cells.length}`);
check(cells.every((g) => {
  const [i, j] = g.getAttribute("data-cell").split(",").map(Number);
  return text(g) === py(oc.corr[i][j], 2) && g.querySelector("rect").getAttribute("fill") === M.tint(oc.corr[i][j]);
}), "heatmap: every cell prints the oracle's text_auto '.2f' (1428) and is filled from the scale");
const svg = t.container.querySelector("svg.corr-heat-svg");
const L = M.heatLayout(cross.tickers);
check(svg.getAttribute("viewBox") === `0 0 ${L.width} ${L.height}` && svg.style.minWidth === `${L.width}px` && L.width >= n * M.CELL && M.FONT >= 12,
  "heatmap: never drawn below its own units, so figures stay at 12px or more (the grid scrolls instead)", `${svg.getAttribute("viewBox")} min ${svg.style.minWidth}`);
{
  const css = readFileSync(new URL("../src/tabs/correlation/correlation.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".corr-heat-scroll {"), css.indexOf("}", css.indexOf(".corr-heat-scroll {")));
  check(/overflow-x:\s*auto/.test(rule), "heatmap: the grid scrolls sideways inside its own box", rule);
}

// The heatmap's hover. The app: style_chart runs AFTER the heatmap's layout (1435) and sets hovermode
// "x unified" (987) on it, as on every chart. The port: the readout is the one cell under the pointer.
// Not a ledger entry: the frontier's defect (it asks for "closest" and style_chart overrides it,
// 1653-1655) cannot occur on a heatmap that never asks for a hover mode.
check(/style_chart\(fig_corr, height=500\)/.test(line(1435)) && /hovermode="x unified"/.test(line(987)) &&
  !SRC.slice(1420, 1435).some((l) => /hovermode/.test(l)),
  "heatmap: the app's heatmap inherits style_chart's x-unified hover (987, 1435)");
const readoutText = () => text(t.container.querySelector(".corr-readout"));
const hover = (i, j) => act(() => {
  t.container.querySelector(`g.corr-cell[data-cell="${i},${j}"]`).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
});
const hint = readoutText();
hover(0, 4);
const first = readoutText();
hover(1, 2);
const second = readoutText();
const ring = t.container.querySelector("rect.corr-cell-on");
check(first === `VTI and EFA: ${py(oc.corr[0][4], 2)}` && second === `AGG and GLD: ${py(oc.corr[1][2], 2)}` && hint !== first,
  "heatmap: the port reads out exactly the cell under the pointer, and follows it", `${hint} / ${first} / ${second}`);
check(ring && Number(ring.getAttribute("x")) === L.left + 2 * M.CELL + 1 && Number(ring.getAttribute("y")) === L.top + 1 * M.CELL + 1,
  "heatmap: the ring outlines that one cell", ring ? `${ring.getAttribute("x")},${ring.getAttribute("y")}` : "no ring");
hover(3, 3);
check(readoutText() === "VNQ with itself: 1.00", "heatmap: the diagonal reads as the asset with itself", readoutText());

// ledger:downloads-everywhere. The app: no download_button anywhere in the tab (1421-1462); the
// covariance matrix is a styled frame in an expander (1461-1462) and the heatmap has no table.
check(!SRC.slice(1420, 1462).some((l) => /download_button|to_csv|df_to_excel/.test(l)) &&
  /st\.dataframe\(cov_matrix\.style\.format\("\{:\.6f\}"\)/.test(line(1462)) && /px\.imshow/.test(line(1427)),
  "ledger:downloads-everywhere the app offers no download for the heatmap or the covariance matrix (1421-1462)");
const tables = [...t.container.querySelectorAll(".tbl")];
const caption = (tb) => (tb.querySelector("caption")?.textContent ?? "").trim();
const buttons = (tb) => [...tb.querySelectorAll(".tbl-dl button")].map((b) => text(b));
check(tables.length === 2 && caption(tables[0]) === "Pairwise correlation of daily returns" && caption(tables[1]) === "Daily covariance matrix",
  "tab: two tables, the correlation under the heatmap and the covariance matrix", tables.map(caption).join(" | "));
check(tables.every((tb) => buttons(tb).includes("Download CSV") && buttons(tb).includes("Download Excel")),
  "ledger:downloads-everywhere both matrices carry CSV and Excel downloads", tables.map((tb) => buttons(tb).join("+")).join(" | "));

// The covariance matrix prints as the app prints it, {:.6f} (1462): num6, where num4 flattens it.
{
  const body = [...tables[1].querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => text(c)));
  const want = oc.clean.tickers.map((tk, i) => [tk, ...oc.cov[i].map((x) => py(x, 6))]);
  check(JSON.stringify(body) === JSON.stringify(want), "covariance: every cell is the oracle's {:.6f} (1462)", JSON.stringify(body[1]));
  const flattened = oc.cov.flat().filter((x) => format(x, "num4") === "0.0000" || format(x, "num4") === "0.0001").length;
  check(M.COV_FORMAT === "num6" && flattened >= 10, "covariance: num6, because num4 would print most daily covariances as 0.0000 or 0.0001", `${flattened} of 25`);
  const corr = [...tables[0].querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => text(c)));
  check(JSON.stringify(corr) === JSON.stringify(oc.clean.tickers.map((tk, i) => [tk, ...oc.corr[i].map((x) => py(x, 3))])),
    "correlation table: every cell is the oracle's matrix to three places", JSON.stringify(corr[0]));
}

// The tooltip follows the level.
{
  const tip = () => text(t.container.querySelector(".tip-text"));
  const plain = tip();
  t.rerender(h(Correlation, tabProps(cross, { level: "formula" })));
  const formula = tip();
  check(plain === TIPS.volatility.plain && formula === TIPS.volatility.formula && plain !== formula,
    "tab: the volatility tooltip beside the covariance matrix changes with the level", `${plain.slice(0, 30)} / ${formula.slice(0, 30)}`);
}

// Rolling: the default pair and window, the window switch, the same asset twice.
const frames = () => [...t.container.querySelectorAll("figure.chart-frame")];
const rollFrame = () => frames()[1];
const rollTitle = () => text(rollFrame().querySelector(".chart-title"));
{
  const v = M.rollView(cross, "VTI", "AGG", 60).value;
  check(frames().length === 2 && rollTitle() === M.rollTitle(v) && /^The 60-day correlation of VTI and AGG ranged from /.test(rollTitle()),
    "rolling: opens on VTI and AGG over 60 days, titled with its range", rollTitle());
  check(rollFrame().querySelector("path.recharts-curve") !== null && ["high ", "low ", "latest "].every((s) => text(rollFrame()).includes(s)),
    "rolling: the line is drawn, its high, low and latest labelled on it");
  const pill = [...rollFrame().parentElement.querySelectorAll('[role="radio"]')].find((b) => text(b) === "120 days");
  act(() => pill.click());
  check(rollTitle() === M.rollTitle(M.rollView(cross, "VTI", "AGG", 120).value), "rolling: the window switch redraws at 120 days", rollTitle());
  const selB = t.container.querySelectorAll(".corr-controls select")[1];
  act(() => {
    selB.value = "VTI";
    selB.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  check(/Select two different assets\./.test(text(rollFrame())) && rollFrame().querySelector("path.recharts-curve") === null,
    "rolling: the same asset twice shows the app's message and no line", text(rollFrame()));
  act(() => {
    selB.value = "GLD";
    selB.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  check(rollTitle() === M.rollTitle(M.rollView(cross, "VTI", "GLD", 120).value), "rolling: a new pair redraws", rollTitle());
}
t.unmount();

// Undefined correlations: an asset whose returns never vary prints dashes, never NaN.
{
  const flat = withColumn(cross, 2, () => 0);
  const r = render(h(Correlation, tabProps(flat)));
  const dashes = [...r.container.querySelectorAll("g.corr-cell")].filter((g) => text(g) === "\u2013").length;
  check(dashes === 2 * n - 1 && !/NaN|undefined|Infinity/.test(text(r.container)), "undefined: GLD's row and column print dashes, no NaN on the page", `${dashes} dashes`);
  check(/4 pairs have no defined correlation and show a dash\./.test(text(r.container)) &&
    text(r.container.querySelector("h2.corr-headline")) === "VTI and EFA were the most correlated pair (0.86), VTI and AGG the least (0.18).",
    "undefined: the subtitle counts them and the headline ranks the defined pairs", text(r.container.querySelector("h2.corr-headline")));
  r.unmount();
  const dead = { ...cross, returns: cross.returns.map((c) => c.map(() => 0)) };
  const d = render(h(Correlation, tabProps(dead)));
  check(d.container.querySelector("g.corr-cell") === null && /No pair has a defined correlation/.test(text(d.container)) &&
    /No pair of assets has a defined correlation/.test(text(d.container.querySelector("h2.corr-headline"))) && !/NaN|undefined|Infinity/.test(text(d.container)),
    "undefined: with no defined pair the heatmap is a named empty state and the headline says so");
  d.unmount();
}

// ledger:boundary. The app runs every tab in one script (tab 3 at 1421, tab 4 at 1467) with no guard
// in tab 3, so a throw there ends the run and tabs 4-6 are never drawn. Here each card has its own
// Boundary: a malformed covariance matrix costs that card and nothing else.
check(line(1421) === "with tab3:" && line(1467) === "with tab4:" && !SRC.slice(1420, 1466).some((l) => /^\s*try:/.test(l)),
  "ledger:boundary the app's tab 3 runs unguarded in the one script, ahead of tab 4 (1421, 1467)");
{
  quiet();
  let r;
  try {
    r = render(h(Correlation, tabProps({ ...cross, S: null })));
  } finally {
    loud();
  }
  const body = text(r.container);
  check(/Daily covariance matrix could not be shown\./.test(body) && r.container.querySelectorAll("g.corr-cell").length === n * n &&
    text(r.container.querySelector("h2.corr-headline")) === HEAD && r.container.querySelectorAll(".tbl").length === 1,
    "ledger:boundary a failed covariance card is named, and the headline, heatmap and correlation table stand", body.slice(-120));
  check(errs.some((e) => e.includes("[boundary] Daily covariance matrix")), "ledger:boundary the console names the card that failed");
  r.unmount();
}

done("t-tab-correlation");
