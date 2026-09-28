// The portfolio charts the Optimization and Custom tabs share: the efficient frontier
// (src/charts/Frontier.tsx) and cumulative wealth (src/charts/Wealth.tsx), rendered in jsdom from a
// real Analysis, long-only, with shorting, and with a failed tangency.
//
// (a) frontierData against the oracle's own numbers; the capital allocation line as the app draws it.
// (b) the frontier drawn: every asset, mark, the benchmark and both lines NAMED ON THE CHART, no
//     legend, no two names overlapping, only token colours, no NaN.
// (c) ledger:frontier-hover (chart half): the app's frontiers hover x-unified, the port's the closest point.
// (d) ledger:short-bounds-copy (frontier half): the caption states [-1, 1] with shorting on, nothing about
//     bounds off; the app's toggle help calls that frontier "unconstrained".
// (e) a failed tangency draws no tangency point and no line, and says so; (f) every other state fails closed.
// (g) wealth: starts at the amount invested (ledger:drawdown-and-wealth-start, chart half), matches the
//     app's path a day in, every line named at its end; ledger:daily-rebalanced-label.
// (h) every name drawn reads on paper at WCAG AA (4.5:1): bronze names are set in ink2 (src/charts/contrast.ts).
import { render, text, act } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, near, nearAll, done } from "./_assert.mjs";
import { fixtureAnalysis, ORACLE_RF } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const oracle = (set) => JSON.parse(readFileSync(new URL(`./fixtures/oracle-${set}.json`, import.meta.url), "utf8"));
const app = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8");
const F = await import("../src/charts/Frontier.tsx");
const W = await import("../src/charts/Wealth.tsx");
const Frontier = F.default;
const Wealth = W.default;
const { tokens } = await import("../src/styles/tokens.ts");
const { ROLE, DASH, SERIES, assetColors } = await import("../src/charts/theme.ts");
const { contrastRatio, labelFill, TEXT_AA } = await import("../src/charts/contrast.ts");
const { format, MINUS } = await import("../src/format.ts");
const { portfolioReturns } = await import("../src/lib/portfolio.ts");
const REL = 1e-12; // test/t-parity.mjs's T0 tier: arithmetic fed the same inputs
const TOKEN_COLORS = new Set(Object.values(tokens.color));
const quiet = (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};

const long = fixtureAnalysis("cross");
const short = fixtureAnalysis("cross", { allowShort: true });
// No portfolio inside [-1, 1] earns a 500% risk-free rate, so the shorting tangency solve has no answer.
const failed = fixtureAnalysis("cross", { allowShort: true, rf: 5 });
const o = oracle("cross");
check(long.rf === ORACLE_RF && o.rf === ORACLE_RF && long.tickers.join() === o.clean.tickers.join(),
  "setup: the analysis is the oracle's cross-asset set at the oracle's rate");
check(long.tangency && short.tangency && failed.tangency === null, "setup: tangency solved long-only and shorting, and failed at a 500% rate");

const ready = (value) => ({ status: "ready", value });
const drawFrontier = (a, data = F.frontierData(a, a.ew), extra = {}) =>
  render(h(Frontier, { title: "Frontier", state: ready(data), allowShort: a.allowShort, rf: a.rf, ...extra }));
const labels = (root) => [...root.querySelectorAll(".direct-label text")].map((t) => ({
  text: t.textContent,
  x: +t.getAttribute("x"),
  y: +t.getAttribute("y"),
  anchor: t.getAttribute("text-anchor"),
  fill: t.getAttribute("fill"),
}));
// Two names collide when their boxes (the placement estimate, 12px tall) overlap.
function collisions(ls) {
  const box = (l) => {
    const w = l.text.length * F.CHAR_PX;
    return { lo: l.anchor === "end" ? l.x - w : l.x, hi: l.anchor === "end" ? l.x : l.x + w, top: l.y - 6, bot: l.y + 6 };
  };
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    for (let j = i + 1; j < ls.length; j++) {
      const a = box(ls[i]);
      const b = box(ls[j]);
      if (a.lo < b.hi && b.lo < a.hi && a.top < b.bot && b.top < a.bot) out.push(`${ls[i].text}/${ls[j].text}`);
    }
  }
  return out;
}
// Every fill and stroke the chart draws: a token, or none.
function strangers(root) {
  const out = new Set();
  for (const el of root.querySelectorAll("*")) {
    for (const k of ["fill", "stroke"]) {
      const v = el.getAttribute(k);
      if (v && v !== "none" && !TOKEN_COLORS.has(v)) out.add(`${el.tagName}.${k}=${v}`);
    }
    const style = el.getAttribute("style") ?? "";
    for (const m of style.match(/#[0-9a-f]{3,8}\b/gi) ?? []) if (!TOKEN_COLORS.has(m.toLowerCase())) out.add(`${el.tagName} style ${m}`);
  }
  return [...out];
}
const noNaN = (root) => !/NaN|Infinity/.test(root.innerHTML);
const readable = (ls) => ls.length > 0 && ls.every((l) => contrastRatio(l.fill, tokens.color.paper) >= TEXT_AA);
const subtitle = (root) => text(root.querySelector("figcaption p") ?? root);

// ---- (a) the data --------------------------------------------------------------------------------
{
  const d = F.frontierData(long, long.ew);
  let assetsOk = d.assets.length === long.tickers.length;
  d.assets.forEach((x, i) => {
    const e = o.perColumn[long.tickers[i]];
    near(`frontierData: ${x.ticker} return is mean x 252 (1636)`, x.mu, e.mu, REL);
    near(`frontierData: ${x.ticker} volatility is the sample std x sqrt(252) (1637)`, x.sigma, e.sigma, REL);
    if (x.ticker !== long.tickers[i]) assetsOk = false;
  });
  check(assetsOk, "frontierData: one asset per ticker, in ticker order");
  check(d.marks.map((m) => m.role).join() === "gmv,tangency,ew,custom" && d.marks.map((m) => m.label).join() === "GMV,Tangency,Equal-Weight,Custom",
    "frontierData: marks in the app's drawing order, Custom last so it sits on Equal-Weight (1614-1634)", d.marks.map((m) => m.label).join());
  const ew = d.marks.find((m) => m.role === "ew");
  near("frontierData: the Equal-Weight point is the app's (return)", ew.mu, o.modes.long.perf.ew.mu, REL);
  near("frontierData: the Equal-Weight point is the app's (volatility)", ew.sigma, o.modes.long.perf.ew.sigma, REL);
  const cust = d.marks.find((m) => m.role === "custom");
  check(cust.mu === ew.mu && cust.sigma === ew.sigma, "frontierData: Custom at equal weights sits exactly on Equal-Weight");
  near("frontierData: the benchmark point is the app's (return)", d.bench.mu, o.bench.mu, REL);
  near("frontierData: the benchmark point is the app's (volatility)", d.bench.sigma, o.bench.sigma, REL);
  check(d.bench.label === o.benchLabel, "frontierData: the benchmark is named as the app names it", d.bench.label);
  check(d.cal && d.cal.rf === long.rf && d.cal.tangency.mu === long.tangency.mu && d.cal.tangency.sigma === long.tangency.sigma,
    "frontierData: the line runs from the analysis's rate through its tangency");
  check(d.points === long.frontier, "frontierData: the analysis's own frontier unless the tab passes one");
  check(F.frontierData(long).marks.every((m) => m.role !== "custom"), "frontierData: no custom weights, no Custom point");
  check(F.frontierData(failed, failed.ew).cal === null && F.frontierData(failed, failed.ew).marks.every((m) => m.role !== "tangency"),
    "frontierData: a failed tangency gives no line and no Tangency point");

  // The line as the app draws it (1607-1609): from (0, rf), slope the tangency's Sharpe ratio, to 1.15x.
  const maxSig = Math.max(...long.frontier.filter((p) => p.feasible).map((p) => p.sigma));
  const seg = F.calSegment(d.cal, maxSig);
  check(seg.x0 === 0 && seg.y0 === long.rf, "cal: starts at zero volatility at the risk-free rate");
  near("cal: its slope is the tangency's Sharpe ratio", seg.slope, long.tangency.sharpe, REL);
  near("cal: it runs to 1.15 times the frontier's highest volatility", seg.x1, 1.15 * maxSig, REL);
  near("cal: and ends on the line", seg.y1, long.rf + long.tangency.sharpe * 1.15 * maxSig, REL);
  check(F.calSegment({ rf: 0.04, tangency: { mu: 0.1, sigma: 0 } }, 0.2).slope === 0, "cal: a zero-volatility tangency gives a flat line, as the app's guard does");
}

// ---- (b) the frontier drawn, long-only and with shorting ----------------------------------------
for (const [name, a] of [["long-only", long], ["shorting", short]]) {
  const d = F.frontierData(a, a.ew);
  const r = drawFrontier(a, d);
  const root = r.container;
  const ls = labels(root);
  const want = [...a.tickers, a.benchLabel, "GMV", "Tangency", "Equal-Weight", "Custom", "Efficient frontier", "Capital allocation line"];
  check(root.querySelector("svg.recharts-surface") && ls.length === want.length && want.every((w) => ls.filter((l) => l.text === w).length === 1),
    `frontier ${name}: every asset, the benchmark, each marked portfolio and both lines are named on the chart, once`, ls.map((l) => l.text).join(","));
  check(!root.querySelector(".recharts-legend-wrapper"), `frontier ${name}: no legend`);
  check(collisions(ls).length === 0, `frontier ${name}: no two names overlap (Custom sits exactly on Equal-Weight)`, collisions(ls).join(" "));
  const colors = assetColors(a.tickers);
  const fillOf = (t) => ls.find((l) => l.text === t)?.fill;
  // The assets are one neutral point each, named beside it: colour belongs to the roles. The app colours
  // assets by palette position (1639, 1802), so its fifth and ninth wear Equal-Weight's and Custom's colours.
  const appLines = app.split("\n");
  const palette = [...appLines.slice(46, 50).join(" ").matchAll(/"(#[0-9A-F]{6})"/g)].map((m) => m[1]);
  const byPosition = /CHART_COLORS\[i % len\(CHART_COLORS\)\]/;
  const appFrontier = appLines.slice(1591, 1656).join("\n");
  check(palette.length === 10 && palette[4] === "#9B59B6" && palette[8] === "#E91E63" &&
    byPosition.test(appLines[1638]) && byPosition.test(appLines[1801]) &&
    appFrontier.includes('"#9B59B6"') && appFrontier.includes('"#E91E63"'),
    `frontier ${name}: the app's fifth and ninth assets take Equal-Weight's and Custom's colours (47-50, 1639, 1802)`, palette.join(","));
  const assetFills = [...root.querySelectorAll(".frontier-asset [fill]")].map((e) => e.getAttribute("fill")).filter((f) => f !== "none");
  // The benchmark (an ink cross) and the CAL (a dashed ink2 line) share the neutral family, not the shape.
  const portfolioFills = new Set([ROLE.gmv, ROLE.tangency, ROLE.ew, ROLE.custom, ROLE.frontier]);
  check(assetFills.length >= a.tickers.length && assetFills.every((f) => f === tokens.color.ink2 && !portfolioFills.has(f)),
    `frontier ${name}: the port draws every asset in ink2, a colour no portfolio mark or the frontier uses`, assetFills.join(","));
  check(a.tickers.every((t) => fillOf(t) === tokens.color.ink2) && fillOf("GMV") === ROLE.gmv && fillOf("Tangency") === labelFill(ROLE.tangency) &&
    fillOf("Equal-Weight") === ROLE.ew && fillOf("Custom") === ROLE.custom && fillOf(a.benchLabel) === ROLE.bench &&
    fillOf("Efficient frontier") === ROLE.frontier && fillOf("Capital allocation line") === ROLE.cal,
    `frontier ${name}: each name is in its point's colour, where that colour reads as text`);
  check(colors[a.tickers[1]] === tokens.color.bronze && fillOf(a.tickers[1]) === tokens.color.ink2 && fillOf("Tangency") === tokens.color.ink2 && readable(ls),
    `frontier ${name}: every name reads on paper at 4.5:1; the bronze ones (${a.tickers[1]}, Tangency) are set in ink2`, JSON.stringify(ls.map((l) => [l.text, l.fill])));
  const markFill = (role) => root.querySelector(`.frontier-mark--${role} .recharts-symbols`)?.getAttribute("fill");
  check(["gmv", "tangency", "ew", "custom"].every((role) => markFill(role) === ROLE[role]), `frontier ${name}: each marker in its role's colour`,
    ["gmv", "tangency", "ew", "custom"].map(markFill).join(" "));
  const feasible = d.points.filter((p) => p.feasible).length;
  check(root.querySelectorAll(".frontier-line .recharts-scatter-symbol").length === feasible && root.querySelector(".frontier-line path.recharts-curve"),
    `frontier ${name}: the line joins all ${feasible} solved points`);
  const cal = root.querySelectorAll(".frontier-cal line");
  const yAxisX = root.querySelector(".recharts-yAxis .recharts-cartesian-axis-line")?.getAttribute("x1");
  check(cal.length === 1 && cal[0].getAttribute("stroke-dasharray") === DASH.cal && cal[0].getAttribute("stroke") === ROLE.cal && cal[0].getAttribute("x1") === yAxisX,
    `frontier ${name}: the capital allocation line is drawn dashed from zero volatility`);
  check(strangers(root).length === 0, `frontier ${name}: every colour drawn is a token`, strangers(root).join(" "));
  check(noNaN(root), `frontier ${name}: no NaN or Infinity anywhere in the chart`);
  r.unmount();
}

// ---- (c) ledger:frontier-hover ---------------------------------------------------------------------
{
  // The app: each frontier asks for "closest", then style_chart (983-995), called after, sets "x unified".
  const styleChart = app.slice(app.indexOf("def style_chart("), app.indexOf("return fig", app.indexOf("def style_chart(")));
  const effective = (fig) => {
    const layout = app.indexOf(`${fig}.update_layout(`);
    const closest = app.indexOf('hovermode="closest"', layout);
    const styled = app.indexOf(`style_chart(${fig}`, layout);
    if (layout < 0 || closest < 0 || styled < 0) return "not found";
    const block = app.slice(layout, app.indexOf(")", closest));
    return block.includes('hovermode="closest"') && styled > closest && styleChart.includes('hovermode="x unified"') ? "x unified" : "closest";
  };
  check(effective("fig_ef") === "x unified" && effective("fig_ef2") === "x unified",
    "ledger:frontier-hover: the app's two frontiers (1655, 1818) hover x-unified, style_chart overriding their \"closest\"",
    `${effective("fig_ef")} / ${effective("fig_ef2")}`);
  check(F.FRONTIER_HOVER === "closest" && F.frontierTooltip.shared === false && F.frontierTooltip.cursor === false,
    "ledger:frontier-hover: the port's frontier tooltip is closest-point: no shared x, no cursor line");

  const r = drawFrontier(long);
  const tip = () => text(r.container.querySelector(".recharts-tooltip-wrapper"));
  const hover = (el) => act(() => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  hover(r.container.querySelector(".frontier-mark--gmv .recharts-scatter-symbol"));
  const gmvTip = tip();
  check(gmvTip === `GMVVolatility ${format(long.gmv.sigma, "pct2")}Return ${format(long.gmv.mu, "pct2")}`,
    "ledger:frontier-hover: hovering the GMV point names GMV alone, with its volatility and return", gmvTip);
  // The GMV sits on the frontier's first point: an x-unified hover there would list both, and more.
  hover(r.container.querySelector(".frontier-line .recharts-scatter-symbol"));
  const first = long.frontier.find((p) => p.feasible);
  const lineTip = tip();
  check(lineTip === `Efficient frontierVolatility ${format(first.sigma, "pct2")}Return ${format(first.target, "pct2")}`,
    "ledger:frontier-hover: hovering the frontier's first point names that point alone, not GMV beside it", lineTip);
  r.unmount();
}

// ---- (d) ledger:short-bounds-copy ------------------------------------------------------------------
{
  const toggle = app.slice(app.indexOf('"Allow short positions"'), app.indexOf("st.markdown(", app.indexOf('"Allow short positions"')));
  check(/The unconstrained frontier is always at least as efficient as long-only/.test(toggle),
    "ledger:short-bounds-copy: the app's shorting help calls that frontier \"unconstrained\" (750)");
  const rs = drawFrontier(short);
  const rl = drawFrontier(long);
  const s = subtitle(rs.container);
  const l = subtitle(rl.container);
  check(s.includes(`Shorting is on: each asset's weight is bounded to [${MINUS}1, 1].`) && !/unconstrained/i.test(s),
    "ledger:short-bounds-copy: with shorting on, the port's caption bounds each weight to [-1, 1] and never says unconstrained", s);
  check(!/bound|\[|unconstrained|short/i.test(l), "ledger:short-bounds-copy: long-only, the caption says nothing about bounds", l);
  check(l.includes(`from the ${format(long.rf, "pct2")} risk-free rate through the tangency portfolio`), "frontier: the caption names the rate the line starts from", l);
  rs.unmount();
  rl.unmount();
}

// ---- (e) a failed tangency -----------------------------------------------------------------------
{
  const r = drawFrontier(failed);
  const ls = labels(r.container).map((l) => l.text);
  check(!r.container.querySelector(".frontier-mark--tangency") && !r.container.querySelector(".frontier-cal") && !r.container.querySelector(".recharts-reference-line"),
    "failed tangency: no tangency point and no capital allocation line are drawn");
  check(!ls.includes("Tangency") && !ls.includes("Capital allocation line") && ls.includes("GMV") && ls.includes("Efficient frontier"),
    "failed tangency: neither is named; the rest still are", ls.join(","));
  check(subtitle(r.container).includes("Tangency failed: the maximum-Sharpe solve returned no portfolio, so no tangency point and no capital allocation line are drawn."),
    "failed tangency: the caption says tangency failed", subtitle(r.container));
  check(noNaN(r.container), "failed tangency: no NaN in the chart");
  r.unmount();
  // A caller that still passes a Tangency mark with no line gets no tangency point either.
  const d = F.frontierData(long, long.ew);
  const r2 = drawFrontier(long, { ...d, cal: null });
  check(!r2.container.querySelector(".frontier-mark--tangency") && !labels(r2.container).some((l) => l.text === "Tangency"),
    "failed tangency: a Tangency mark passed without a line is not drawn");
  r2.unmount();
}

// ---- (f) states --------------------------------------------------------------------------------------
{
  const d = F.frontierData(long, long.ew);
  const at = (state) => render(h(Frontier, { title: "Frontier", state, allowShort: false, rf: long.rf }));
  let r = at({ status: "loading" });
  check(!r.container.querySelector("svg") && text(r.container.querySelector(".chart-note")) === "Loading", "frontier: loading draws nothing and says so");
  r.unmount();
  r = at(ready({ ...d, points: d.points.map((p) => ({ ...p, feasible: false, sigma: NaN, w: null })) }));
  check(!r.container.querySelector("svg") && text(r.container).includes("No point on the frontier could be solved"),
    "frontier: with no solved point there is no chart, and the note says why");
  r.unmount();
  const holes = d.points.map((p, i) => (i % 3 === 1 ? { ...p, feasible: false, sigma: NaN, w: null } : p));
  r = at(ready({ ...d, points: holes }));
  const kept = holes.filter((p) => p.feasible).length;
  check(r.container.querySelectorAll(".frontier-line .recharts-scatter-symbol").length === kept && noNaN(r.container),
    "frontier: unsolved points are dropped and the rest joined, as the app does (958-970)", `${kept} kept`);
  r.unmount();
  quiet(() => {
    r = at(ready({ ...d, marks: d.marks.map((m) => (m.role === "gmv" ? { ...m, sigma: NaN } : m)) }));
  });
  const alert = r.container.querySelector("[role=alert]");
  check(!r.container.querySelector("svg") && alert && text(alert).includes("the GMV point") && noNaN(r.container),
    "frontier: a point that is not a number refuses the chart by name, never plots NaN", r.container.textContent);
  r.unmount();
  r = at({ status: "error", name: "prices", message: "Yahoo did not answer." });
  check(!r.container.querySelector("svg") && text(r.container.querySelector("[role=alert]")).includes("prices"), "frontier: an error state is named");
  r.unmount();
}

// ---- (g) wealth ----------------------------------------------------------------------------------------
const W0 = o.w0;
{
  const data = W.wealthData(long, long.ew);
  check(data.series.map((s) => s.label).join() === `Equal-Weight,GMV,Tangency,Custom,${long.benchLabel}` &&
    data.series.map((s) => s.role).join() === "ew,gmv,tangency,custom,bench",
    "wealth: the app's lines in the app's order (1661-1665)", data.series.map((s) => s.label).join());
  check(data.start === long.prices.dates[0] && data.dates === long.dates, "wealth: invested on the first price date; the return dates follow");
  check(W.wealthData(failed, null).series.map((s) => s.role).join() === "ew,gmv,bench", "wealth: a failed tangency and no custom weights leave those lines off");

  const plot = W.wealthPlot(ready(data), W0);
  check(plot.status === "ready" && plot.value.rows.length === long.dates.length + 1, "wealth: one row per return date plus the start");
  const rows = plot.value.rows;
  const ewKey = plot.value.lines.find((l) => l.role === "ew").key;
  const benchKey = plot.value.lines.find((l) => l.role === "bench").key;
  // The app plots (1 + r).cumprod() * W0 (1667): its first point is W0 * (1 + r1), a day in.
  const appFirst = W0 * (1 + portfolioReturns(long.returns, long.ew)[0]);
  near("ledger:drawdown-and-wealth-start: the app's first plotted point is W0 x (1 + r1), reproduced", o.modes.long.wealth.ew.v[0], appFirst, 1e-12);
  check(rows[0].date === long.prices.dates[0] && rows[0][ewKey] === W0 && rows[0][benchKey] === W0 && rows[1].date === long.dates[0],
    "ledger:drawdown-and-wealth-start: the port's line starts at the amount invested, on the day it is invested");
  // After the start, the port's path is the app's to the last day (the app's index i is the port's row i + 1).
  const oi = o.modes.long.wealth.ew.i;
  nearAll("wealth: the Equal-Weight line is the app's growth path (1667)", oi.map((i) => rows[i + 1][ewKey]), o.modes.long.wealth.ew.v, 1e-10);
  nearAll("wealth: the benchmark line is the app's", o.bench.wealth.i.map((i) => rows[i + 1][benchKey]), o.bench.wealth.v, 1e-10);

  for (const [name, a] of [["long-only", long], ["shorting", short]]) {
    const r = render(h(Wealth, { title: "Growth", state: ready(W.wealthData(a, a.ew)), amount: W0 }));
    const root = r.container;
    const ls = labels(root);
    const names = ["Equal-Weight", "GMV", "Tangency", "Custom", a.benchLabel];
    check(root.querySelectorAll(".recharts-line-curve").length === 5 && !root.querySelector(".recharts-legend-wrapper"),
      `wealth ${name}: five lines, no legend`);
    check(ls.length === 5 && names.every((n, k) => ls[k].text.startsWith(`${n} $`) && ls[k].fill === labelFill(ROLE[["ew", "gmv", "tangency", "custom", "bench"][k]])),
      `wealth ${name}: each line named at its end in its own colour, with its final value`, ls.map((l) => l.text).join(" | "));
    check(ls[2].fill === tokens.color.ink2 && readable(ls) && [...root.querySelectorAll(".recharts-line-curve")].some((p) => p.getAttribute("stroke") === ROLE.tangency),
      `wealth ${name}: every end name reads on paper at 4.5:1; Tangency's is ink2 while its line stays bronze`, JSON.stringify(ls.map((l) => [l.text, l.fill])));
    const fin = W.wealthPlot(ready(W.wealthData(a, a.ew)), W0).value.lines;
    check(fin.every((l, k) => ls[k].text === `${l.label} ${format(l.end, "usd0")}`), `wealth ${name}: the value named is the line's last`);
    check(collisions(ls).length === 0, `wealth ${name}: no two end names overlap (Custom ends exactly on Equal-Weight)`, collisions(ls).join(" "));
    check(strangers(root).length === 0, `wealth ${name}: every colour drawn is a token`, strangers(root).join(" "));
    check(noNaN(root), `wealth ${name}: no NaN or Infinity anywhere in the chart`);
    r.unmount();
  }
  check(W.WEALTH_HOVER === "x" && W.wealthTooltip.shared === true, "wealth: hover compares every line at one date");
}

// ---- (h) names that read on paper -------------------------------------------------------------------------
{
  const paper = tokens.color.paper;
  near("contrast: black on white is 21:1, the WCAG scale's top", contrastRatio("#000000", "#ffffff"), 21, 1e-12);
  near("contrast: a colour against itself is 1:1", contrastRatio(paper, paper), 1, 1e-12);
  check(Math.abs(contrastRatio(tokens.color.bronze, paper) - 3.56) < 0.005 && Math.abs(contrastRatio(tokens.color.ink2, paper) - 11.92) < 0.005 &&
    contrastRatio(paper, tokens.color.bronze) === contrastRatio(tokens.color.bronze, paper),
    "contrast: bronze on paper is 3.56:1 and ink2 11.92:1, either way round", `${contrastRatio(tokens.color.bronze, paper)} ${contrastRatio(tokens.color.ink2, paper)}`);
  check(TEXT_AA === 4.5 && SERIES.every((s) => (s === tokens.color.bronze ? labelFill(s) === tokens.color.ink2 : labelFill(s) === s)) &&
    Object.values(ROLE).every((s) => contrastRatio(labelFill(s), paper) >= TEXT_AA),
    "contrast: every series and role colour names its own label, except bronze, which is set in ink2", SERIES.map(labelFill).join(" "));
  // The wealth chart's hover box: each line's value in the line's colour, the same rule.
  const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  const r = render(h(W.DateTip, { active: true, label: long.dates[0], payload: [
    { name: "GMV", value: 10100, color: ROLE.gmv },
    { name: "Tangency", value: 10200, color: ROLE.tangency },
  ] }));
  const rows = [...r.container.querySelectorAll(".chart-tip > div")].filter((d) => !d.classList.contains("chart-tip-name"));
  const col = (d) => d.style.color;
  check(rows.length === 2 && [rgb(ROLE.gmv), ROLE.gmv].includes(col(rows[0])) && [rgb(tokens.color.ink2), tokens.color.ink2].includes(col(rows[1])),
    "contrast: the wealth hover box writes GMV in its teal and Tangency in ink2", rows.map(col).join(" | "));
  r.unmount();
}

// ---- ledger:daily-rebalanced-label -------------------------------------------------------------------
{
  const block = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
  const tab4 = block("# Portfolio comparison cumulative", 'key="comp_tab4"');
  const tab5 = block("# Cumulative wealth with custom", 'key="cc_tab5"');
  check(tab4.length > 200 && tab5.length > 200 && /stock_returns @ gmv_w\b/.test(tab4) && /\(1 \+ port_rets\)\.cumprod\(\)/.test(tab4) &&
    /\(1 \+ port_rets_cust\)\.cumprod\(\)/.test(tab5),
    "ledger:daily-rebalanced-label: the app plots fixed weights applied every day, R @ w (1661-1667, 1825-1831)");
  check(!/rebalanc/i.test(app), "ledger:daily-rebalanced-label: and nowhere says they are rebalanced daily");
  const r = render(h(Wealth, { title: "Growth", state: ready(W.wealthData(long, long.ew)), amount: W0 }));
  const cap = subtitle(r.container);
  check(cap === `Growth of $10,000 from ${long.prices.dates[0]} to ${long.dates[long.dates.length - 1]}. Each portfolio is rebalanced daily to the target weights.`,
    "ledger:daily-rebalanced-label: the port's caption says each portfolio is rebalanced daily to the target weights", cap);
  r.unmount();
}

// ---- wealth states ---------------------------------------------------------------------------------------
{
  const data = W.wealthData(long, long.ew);
  const at = (state, amount = W0) => render(h(Wealth, { title: "Growth", state, amount }));
  let r;
  quiet(() => (r = at(ready(data), NaN)));
  check(!r.container.querySelector("svg") && text(r.container.querySelector("[role=alert]")).includes("the starting amount") && noNaN(r.container),
    "wealth: an amount that is not a positive number refuses the chart by name");
  r.unmount();
  const cut = { ...data, series: data.series.map((s) => (s.role === "gmv" ? { ...s, returns: s.returns.slice(1) } : s)) };
  r = at(ready(cut));
  check(!r.container.querySelector("svg") && text(r.container.querySelector("[role=alert]")).includes("the GMV line"), "wealth: a line that does not match the dates is refused by name");
  r.unmount();
  const hole = { ...data, series: data.series.map((s) => (s.role === "bench" ? { ...s, returns: s.returns.map((x, i) => (i === 9 ? NaN : x)) } : s)) };
  r = at(ready(hole));
  check(!r.container.querySelector("svg") && text(r.container.querySelector("[role=alert]")).includes(`the ${long.benchLabel} line`) && noNaN(r.container),
    "wealth: a NaN return refuses the chart by name, never a broken line");
  r.unmount();
  r = at({ status: "loading" });
  check(!r.container.querySelector("svg") && text(r.container.querySelector(".chart-note")) === "Loading", "wealth: loading draws nothing and says so");
  r.unmount();
  r = at(ready({ ...data, series: [] }));
  check(!r.container.querySelector("svg") && text(r.container).includes("There is no portfolio to plot."), "wealth: nothing to plot says so");
  r.unmount();
}

done("t-charts-portfolio");
