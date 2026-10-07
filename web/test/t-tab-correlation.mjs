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
  // The sentence under the heatmap, held to the oracle's numpy and pandas: the equal-weight portfolio's
  // volatility, the average of the assets' own (pandas std times √252), the mean off-diagonal correlation.
  if (JSON.stringify(tk) === JSON.stringify(a.tickers)) {
    const s = M.spread(a, v);
    const own = tk.map((x) => o.perColumn[x].sigma);
    const offDiag = o.corr.flatMap((row, i) => row.filter((_, j) => j !== i));
    nearAll(`${set}: the volatility sentence's figures are the oracle's equal-weight volatility, its assets' mean volatility and mean off-diagonal correlation`,
      [s.together, s.apart, s.meanCorr], [o.modes.long.perf.ew.sigma, own.reduce((x, y) => x + y, 0) / tk.length, offDiag.reduce((x, y) => x + y, 0) / offDiag.length], 0, 1e-12);
    check(s.n === tk.length && s.together < s.apart, `${set}: equal weights held together are less volatile than the assets' average on their own`, `${s.together} ${s.apart}`);
  }
}

// ---- the volatility sentence: when it says nothing --------------------------------------------------
{
  const a = fixtureAnalysis("cross");
  const v = M.corrView(a);
  const one = { ...a, tickers: a.tickers.slice(0, 1), returns: a.returns.slice(0, 1), m: a.m.slice(0, 1), S: [[a.S[0][0]]], ew: [1] };
  const holes = { ...a, S: a.S.map((row, i) => row.map((x, j) => (i === 2 && j === 2 ? NaN : x))) };
  const dead = { ...a, returns: a.returns.map((c, i) => (i === 1 ? c.map(() => 0) : c)) };
  const said = [
    ["one asset", M.spread(one, M.corrView(one))],
    ["no covariance matrix", M.spread({ ...a, S: null }, v)],
    ["a covariance row short", M.spread({ ...a, S: a.S.map((row, i) => (i === 3 ? row.slice(1) : row)) }, v)],
    ["no correlation matrix", M.spread(a, { ...v, matrix: null })],
    ["a non-finite variance", M.spread(holes, v)],
    ["an undefined pair", M.spread(dead, M.corrView(dead))],
  ].filter(([, s]) => s !== null);
  check(said.length === 0 && M.spreadSentence(null) === null, "volatility sentence: nothing with one asset, a missing or misshapen matrix, or a figure that is not finite", said.map(([w, s]) => `${w}: ${JSON.stringify(s)}`).join("; "));
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

// The volatility sentence, literally, from the oracle's own figures; ONE sentence, directly under the
// heatmap's frame and above its table, the same at every level, and saying it is about this window.
{
  const ownMean = oc.clean.tickers.reduce((x, k) => x + oc.perColumn[k].sigma, 0) / n;
  const off = oc.corr.flatMap((row, i) => row.filter((_, j) => j !== i));
  const want = `Held in equal weights over this window, the five assets had a volatility of ${(oc.modes.long.perf.ew.sigma * 100).toFixed(1)}% a year ` +
    `together, against an average of ${(ownMean * 100).toFixed(1)}% each on their own, and the average correlation between any two of them was ${py(off.reduce((x, y) => x + y, 0) / off.length, 2)}.`;
  const notes = () => [...t.container.querySelectorAll(".corr-spread")];
  const at = {};
  for (const level of ["plain", "finance", "formula"]) {
    t.rerender(h(Correlation, tabProps(cross, { level })));
    at[level] = notes().map((p) => text(p));
  }
  t.rerender(h(Correlation, tabProps(cross)));
  check(Object.values(at).every((xs) => xs.length === 1 && xs[0] === want), "volatility sentence: one sentence, literally, at Plain, Finance and Formula", JSON.stringify(at) + `\n   want ${want}`);
  const p = notes()[0];
  const frame = t.container.querySelector("svg.corr-heat-svg")?.closest(".chart-frame, figure, section, div");
  const before = p && p.previousElementSibling;
  const after = p && p.nextElementSibling;
  check(!!before && before.contains(t.container.querySelector("svg.corr-heat-svg")) && !!after && after.querySelector("table") && !after.contains(t.container.querySelector("svg.corr-heat-svg")),
    "volatility sentence: directly under the heatmap's frame and above the correlation table", `${before?.className} / ${after?.className} / ${frame?.className}`);
  check((want.match(/\. |\.$/g) ?? []).length === 1 && /over this window/.test(want), "volatility sentence: a single sentence that says it is about this window");
}

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
  "heatmap: before its box is measured, the grid keeps its full-size cells and 12px figures", `${svg.getAttribute("viewBox")} min ${svg.style.minWidth}`);
{
  const css = readFileSync(new URL("../src/tabs/correlation/correlation.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".corr-heat-scroll {"), css.indexOf("}", css.indexOf(".corr-heat-scroll {")));
  check(/overflow-x:\s*auto/.test(rule), "heatmap: a grid that cannot fit even at the floor scrolls sideways inside its own box", rule);
}

// The grid fits its box: the cell shrinks from CELL to fit, never below CELL_MIN, and prints no figure
// under FIGURE_FONT_MIN (a tap, a pointer or the arrow keys read it). A phone's box at 375 is 343px;
// 358px is the widest a phone column gets, so both are held.
{
  const names = (k) => ["SPY", "QQQ", "IWM", "EFA", "EEM", "AGG", "TLT", "GLD", "VNQ", "DBC"].slice(0, k);
  const fits = [];
  for (const box of [343, 358]) for (const k of [5, 7, 10]) {
    const H = M.heatLayout(names(k), box);
    if (!(H.width <= box && H.cell >= M.CELL_MIN && H.cell <= M.CELL)) fits.push(`${k} in ${box}: ${H.width}px at ${H.cell}`);
  }
  check(fits.length === 0, "heatmap fit: at a phone's box, five, seven and ten tickers fit with no overflow", fits.join("; "));
  const desk = M.heatLayout(names(10), 928);
  const free = M.heatLayout(names(10));
  check(desk.cell === M.CELL && desk.font === M.FONT && desk.figures && JSON.stringify(desk) === JSON.stringify(free),
    "heatmap fit: on a desktop's box ten tickers keep the 48px cell and 12px figures, the layout unchanged", JSON.stringify(desk));
  // The font floor, both ways, in the narrowest box whose cell is each size: five-character figures ("-0.24")
  // reach 10px in a 34px cell ((34 - 4) / 3) and four-character ones ("0.86") in a 28px cell ((28 - 4) / 2.4).
  const left = free.left;
  const boxFor = (cell) => {
    let box = left;
    while (box < left + 10 * M.CELL && M.heatLayout(names(10), box).cell < cell) box++;
    return box;
  };
  const edge = [[5, 34], [5, 33], [4, 28], [4, 27]].map(([chars, cell]) => M.heatLayout(names(10), boxFor(cell), chars));
  const [at5, under5, at4, under4] = edge;
  check(at5.cell === 34 && at5.figures && at5.font === 10 && under5.cell === 33 && !under5.figures &&
    at4.cell === 28 && at4.figures && at4.font === 10 && under4.cell === 27 && !under4.figures,
    "heatmap fit: figures print at 10px and drop under it, five characters at a 34px cell and not 33, four at 28 and not 27",
    edge.map((H) => `${H.cell} ${H.figures} ${H.font}`).join(" / "));
  // A figure is never wider than its cell less 2px a side (JetBrains Mono's advance is 0.6 em).
  const wide = [];
  const small = [];
  for (let box = left + 10 * M.CELL_MIN; box <= left + 10 * M.CELL + 40; box += 7) for (const chars of [4, 5]) {
    const H = M.heatLayout(names(10), box, chars);
    if (H.figures && !(chars * 0.6 * H.font <= H.cell - 4 + 1e-9 && H.font <= M.FONT)) wide.push(`${box}: ${H.font}px in ${H.cell}`);
    if (H.figures && H.font < 10) small.push(`${box}, ${chars} characters: ${H.font}px in ${H.cell}`);
  }
  check(wide.length === 0, "heatmap fit: a printed figure shrinks with its cell and stays inside it, never above 12px", wide.join("; "));
  check(small.length === 0, "heatmap fit: every printed figure is at least 10px, at every width", small.join("; "));
  check(M.CELL_MIN === 26 && M.FIGURE_FONT_MIN === 10 && M.CELL === 48,
    "heatmap fit: the decided numbers, a 48px cell, a 26px floor and no figure under 10px", `${M.CELL} ${M.CELL_MIN} ${M.FIGURE_FONT_MIN}`);
  // Four-letter tickers turn their column labels once the cell shrinks; the last one, turned up and right
  // from its column's centre, must end inside the grid's width. Its reach is worked out here from the glyph
  // box (0.6 em an advance, the em box's 0.3 em descent below the baseline), rotated 45 degrees.
  const four = ["SCHD", "VTEB", "VNQI", "BNDX", "IEMG", "VTWO", "VGIT", "IAU", "USMV", "QUAL"];
  const clipped = [];
  for (const box of [343, 358]) {
    const H = M.heatLayout(four, box);
    const px = M.FONT - 1;
    const right = H.left + (four.length - 0.5) * H.cell + Math.SQRT1_2 * (4 * 0.6 * px + 0.3 * px);
    if (!H.turned || right > H.width || H.width > box) clipped.push(`${box}: turned ${H.turned}, label to ${right.toFixed(1)}, grid ${H.width}`);
  }
  check(clipped.length === 0, "heatmap fit: turned four-letter labels end inside the grid, and the grid inside a phone's box", clipped.join("; "));
  const tiny = M.heatLayout(names(10), 120);
  check(tiny.cell === M.CELL_MIN && tiny.width > 120 && !tiny.figures,
    "heatmap fit: the cell never goes below the 26px floor; a grid that still does not fit is wider than its box (and scrolls in it)", `${tiny.cell} ${tiny.width}`);
  check(JSON.stringify(M.stepCell(null, "ArrowRight", 3)) === "[0,0]" && JSON.stringify(M.stepCell([0, 0], "ArrowRight", 3)) === "[0,1]" &&
    JSON.stringify(M.stepCell([2, 2], "ArrowDown", 3)) === "[2,2]" && JSON.stringify(M.stepCell([1, 0], "ArrowUp", 3)) === "[0,0]" && M.stepCell([1, 1], "a", 3) === null,
    "heatmap fit: the arrow keys step the reading one cell at a time and stop at the grid's edge");

  // Drawn in a box too narrow for figures: no cell prints one, a tap reads a cell, and the keys walk it.
  const real = window.HTMLElement.prototype.getBoundingClientRect;
  const drawIn = (width) => {
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      return this.classList?.contains("corr-heat-scroll") ? { x: 0, y: 0, top: 0, left: 0, width, height: 0, right: width, bottom: 0 } : real.call(this);
    };
    try {
      return render(h(Correlation, tabProps(cross)));
    } finally {
      window.HTMLElement.prototype.getBoundingClientRect = real;
    }
  };
  // At CELL_MIN the labels turn, so the box also holds the last label's reach past the grid. The cross
  // basket's figures are four characters (no correlation is negative), under 10px in a 26px cell.
  const narrow = M.heatLayout(cross.tickers).left + n * M.CELL_MIN + Math.ceil(M.turnReach(3) - M.CELL_MIN / 2) + 1;
  const s = drawIn(narrow);
  const grid = s.container.querySelector("svg.corr-heat-svg");
  const read = () => text(s.container.querySelector(".corr-readout"));
  const nb = M.heatLayout(cross.tickers, narrow, 4);
  check(grid.getAttribute("viewBox") === `0 0 ${nb.width} ${nb.height}` && nb.width <= narrow && nb.cell === M.CELL_MIN && nb.turned && !nb.figures &&
    grid.querySelectorAll("g.corr-cell text").length === 0 && s.container.querySelectorAll("g.corr-cell").length === n * n,
    "heatmap fit: drawn in a narrow box, the grid takes the fitted layout and its cells print no figure", `${grid.getAttribute("viewBox")} in ${narrow}`);
  act(() => {
    s.container.querySelector('g.corr-cell[data-cell="1,2"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const tapped = read();
  act(() => grid.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  const stepped = read();
  const label = grid.getAttribute("aria-label") ?? "";
  check(label.indexOf("table below") >= 0 && label.indexOf("table below") < label.indexOf("arrow keys"),
    "heatmap fit: the grid's label sends a screen reader to the table first, then names the arrow keys", label);
  check(tapped === `AGG and GLD: ${py(oc.corr[1][2], 2)}` && stepped === `${cross.tickers[1]} and ${cross.tickers[3]}: ${py(oc.corr[1][3], 2)}` &&
    grid.getAttribute("tabindex") === "0",
    "heatmap fit: with no figure printed, a tap reads the cell and the arrow keys move the reading on a focusable grid", `${tapped} / ${stepped}`);
  s.unmount();
  // Whether a cell prints at all now turns on the widest figure, which the grid reads off the matrix: a
  // 28px cell is too small for five characters at 10px but holds the cross basket's four.
  const at28 = M.heatLayout(cross.tickers).left + n * 28;
  const w = drawIn(at28);
  const figs = [...w.container.querySelectorAll("g.corr-cell text")];
  check(M.heatLayout(cross.tickers, at28).cell === 28 && figs.length === n * n && figs.every((f) => f.getAttribute("font-size") === "10"),
    "heatmap fit: the grid sizes figures by the matrix's widest, so a 28px cell prints four-character figures at 10px", `${figs.length} at ${figs[0]?.getAttribute("font-size")}`);
  w.unmount();
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
const caption = (tb) => (tb.querySelector("caption .tbl-title")?.textContent ?? "").trim();
const buttons = (tb) => [...tb.querySelectorAll(".tbl-dl button")].map((b) => text(b));
check(tables.length === 2 && caption(tables[0]) === "Pairwise correlation of daily returns" && caption(tables[1]) === "Daily covariance matrix",
  "tab: two tables, the correlation under the heatmap and the covariance matrix", tables.map(caption).join(" | "));
{
  const an = t.container.querySelector(".corr-kicker") ? text(t.container.querySelector(".corr-kicker")) : "none";
  check(an === "How the assets move together" && !/Correlation & Covariance Analysis/.test(text(t.container)),
    "kicker: names the view in plain words, not the assignment's heading", an);
  const spans = tables.map((tb) => text(tb.querySelector(".tbl-span")));
  check(spans.length === 2 && spans.every((s) => /^Daily returns, \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d$/.test(s)) && spans[0] === spans[1],
    "spans: both matrices state their window and that the returns are daily", spans.join(" | "));
}
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
  check(!d.container.querySelector(".corr-spread"), "volatility sentence: absent when no pair has a defined correlation");
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
  check(!r.container.querySelector(".corr-spread") && !/volatility note could not be shown/.test(body) && !errs.some((e) => e.includes("[boundary] Equal-weight volatility note")),
    "volatility sentence: with no covariance matrix it is simply absent, never a failed card", body.slice(0, 200));
  r.unmount();
}

done("t-tab-correlation");
