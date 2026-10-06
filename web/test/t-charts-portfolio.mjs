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
//     app's path a day in, every line named at its end; ledger:daily-rebalanced-label. Two lines that end
//     together (Custom at equal weights on Equal-Weight) keep the app's order whichever way rounding tips
//     them, ends apart are never drawn as one, and the caption says Custom covers Equal-Weight exactly then.
// (h) every name drawn reads on paper at WCAG AA (4.5:1): bronze names are set in ink2 (src/charts/contrast.ts).
import { render, text, act } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, near, nearAll, done } from "./_assert.mjs";
import { exampleAnalysis, fixtureAnalysis, ORACLE_RF } from "./_analysis.mjs";

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
const { spreadLabels, textWidth } = await import("../src/charts/labels.ts");
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
// Two names collide when their boxes (the face's measured advances, 12px tall) overlap.
function collisions(ls) {
  const box = (l) => {
    const w = textWidth(l.text);
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

// ---- (g) wealth: ends that tie, and ends that do not ------------------------------------------------------
{
  // A near-tie, as rounding makes one in a browser: Custom's weights a hair off Equal-Weight's (inside the
  // 1e-12 that still counts as equal weights) end it a hair above Equal-Weight, then a hair below. Either
  // way the names keep the app's order, Equal-Weight above Custom.
  const nudged = [1, -1].map((s) => long.ew.map((x, i) => x + (i === 0 ? s : i === 1 ? -s : 0) * 1e-13));
  const gaps = nudged.map((w) => {
    const ls = W.wealthPlot(ready(W.wealthData(long, w)), W0).value.lines;
    return ls.find((l) => l.role === "custom").end - ls.find((l) => l.role === "ew").end;
  });
  check(gaps[0] * gaps[1] < 0 && gaps.every((g) => Math.abs(g) < 1e-6) && nudged.every((w) => W.wealthData(long, w).customIsEqual),
    "wealth near-tie setup: still equal weights, and Custom ends within a millionth of a dollar of Equal-Weight, above it once and below it once", gaps.join());
  nudged.forEach((w, k) => {
    const r = render(h(Wealth, { title: "Growth", state: ready(W.wealthData(long, w)), amount: W0 }));
    const ls = labels(r.container);
    const y = (n) => ls.find((l) => l.text.startsWith(`${n} $`))?.y;
    check(y("Equal-Weight") < y("Custom"), `wealth near-tie: Equal-Weight's name is above Custom's though Custom ends a hair ${gaps[k] > 0 ? "above" : "below"} it`,
      ls.map((l) => `${l.text} @ ${l.y}`).join(" | "));
    r.unmount();
  });

  // Ends more than half a pixel apart are never drawn as one: GMV, Tangency and the benchmark end a few pixels
  // apart here, and every name sits where spreadLabels puts its own line's drawn end.
  const n = long.dates.length;
  const grow = (x) => new Array(n).fill(Math.pow(x, 1 / n) - 1);
  const series = [["Equal-Weight", "ew", 2], ["GMV", "gmv", 1.5], ["Tangency", "tangency", 1.52], ["Custom", "custom", 1.9], ["S&P 500", "bench", 1.54]]
    .map(([label, role, x]) => ({ label, role, returns: grow(x) }));
  const r = render(h(Wealth, { title: "Growth", state: ready({ start: long.prices.dates[0], dates: long.dates, series, customIsEqual: false }), amount: W0 }));
  const ends = [...r.container.querySelectorAll(".recharts-line-curve")].map((p) => Number(p.getAttribute("d").match(/,(-?[\d.]+(?:e[-+]?\d+)?)\s*$/)?.[1]));
  const apart = [[1, 2], [2, 4], [1, 4]].map(([i, j]) => Math.abs(ends[i] - ends[j]));
  check(ends.length === 5 && ends.every(Number.isFinite) && apart.every((d) => d > 0.5) && apart.some((d) => d < 20),
    "wealth close ends setup: GMV, Tangency and the benchmark end more than half a pixel apart, and some within 20px", apart.join());
  const want = spreadLabels(ends, 15);
  const ls = labels(r.container);
  check(ls.length === 5 && ls.every((l, k) => Math.abs(l.y - want[k]) < 1e-9),
    "wealth: ends more than half a pixel apart are never drawn as one; each name sits where its own end puts it",
    ls.map((l, k) => `${l.text} @ ${l.y} (want ${want[k]})`).join(" | "));
  r.unmount();
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
  check(cap === `Growth of $10,000 from ${long.prices.dates[0]} to ${long.dates[long.dates.length - 1]}. Each portfolio is rebalanced daily to the target weights. ` +
    "GMV and Tangency are hypothetical: weights chosen with the whole period's prices. Custom is still equal weights, so its line covers Equal-Weight's.",
    "ledger:daily-rebalanced-label: the port's caption says each portfolio is rebalanced daily to the target weights", cap);
  // hypothetical: only the lines an optimiser fitted to these prices are called hypothetical.
  check(W.wealthCaption(W0, "2020-01-02", "2020-12-31") === "Growth of $10,000 from 2020-01-02 to 2020-12-31. Each portfolio is rebalanced daily to the target weights." &&
    W.wealthCaption(W0, "2020-01-02", "2020-12-31", ["Tangency"]).endsWith(" Tangency is hypothetical: weights chosen with the whole period's prices.") &&
    JSON.stringify(W.fittedLines(W.wealthData(long, long.ew).series)) === JSON.stringify(["GMV", "Tangency"]) &&
    JSON.stringify(W.fittedLines(W.wealthData({ ...long, gmv: null, tangency: null }, long.ew).series)) === "[]",
    "hypothetical: the caption calls GMV and Tangency hypothetical, and never Equal-Weight, Custom or the benchmark");
  r.unmount();
  // covers: while Custom's weights are Equal-Weight's its line is drawn over Equal-Weight's, and the caption's
  // last sentence says so; a typed mix, or no custom line, says nothing of it.
  const typed = [0.4, 0.15, 0.15, 0.15, 0.15];
  check(W.CUSTOM_COVERS === "Custom is still equal weights, so its line covers Equal-Weight's." &&
    W.wealthData(long, long.ew).customIsEqual === true && W.wealthData(long, typed).customIsEqual === false && W.wealthData(long, null).customIsEqual === false &&
    W.wealthCaption(W0, "2020-01-02", "2020-12-31", ["GMV", "Tangency"], true).endsWith(` whole period's prices. ${W.CUSTOM_COVERS}`) &&
    W.wealthCaption(W0, "2020-01-02", "2020-12-31", [], true).endsWith(` to the target weights. ${W.CUSTOM_COVERS}`) &&
    !W.wealthCaption(W0, "2020-01-02", "2020-12-31", ["GMV", "Tangency"]).includes("covers"),
    "covers: Custom at equal weights is marked, a typed mix and no custom line are not, and the sentence comes last");
  const rt = render(h(Wealth, { title: "Growth", state: ready(W.wealthData(long, typed)), amount: W0 }));
  check(!subtitle(rt.container).includes("covers") && subtitle(rt.container).endsWith(" whole period's prices."),
    "covers: a typed mix's chart does not say Custom covers Equal-Weight", subtitle(rt.container));
  rt.unmount();
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

// ---- (i) no name sits on a marker, at a phone's width or a desk's --------------------------------------
// Names were kept off each other and nothing else: at 375px the Tangency name ran into the benchmark's
// cross, and it began inside its own star's right point. Every frontier here is drawn at three widths
// (a 375px phone's chart box, a tablet's, jsdom's desktop fallback) on all five fixture sets, long-only
// and shorting, with Custom on Equal-Weight. Each marker's box is read off the path Recharts DREW
// (its d3 symbol and its translate), not off the placement's own model of it, and each name's box off
// the text drawn, at the face's measured advances (textWidth) and 12px tall. And a name must still say
// whose it is: moved clear of the crowd, "S&P 500" had landed under GLD's dot and "GLD" under the
// benchmark's cross, their hairlines crossing. A name level with its point (no hairline) sits nearer its
// own marker than any other, and no two hairlines cross. (Level or not, "nearest" alone cannot hold in a
// tight cluster: at 343px GLD sits between the Tangency star, the S&P 500 cross and VTI.)
{
  const { PHONE_QUERY } = await import("../src/styles/tokens.ts");
  const { setMedia } = await import("./_dom.mjs");
  // The box a d3 symbol path covers, around its centre: M/L/h/v/Z as d3 writes them, and a circle's arcs.
  function pathBox(d) {
    const box = { lo: Infinity, hi: -Infinity, top: Infinity, bot: -Infinity };
    const add = (x, y) => {
      box.lo = Math.min(box.lo, x);
      box.hi = Math.max(box.hi, x);
      box.top = Math.min(box.top, y);
      box.bot = Math.max(box.bot, y);
    };
    let x = 0;
    let y = 0;
    for (const [, cmd, args] of d.matchAll(/([MLHVAZmlhvaz])([^MLHVAZmlhvaz]*)/g)) {
      const n = (args.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
      if (cmd === "M" || cmd === "L") for (let k = 0; k + 1 < n.length; k += 2) add((x = n[k]), (y = n[k + 1]));
      else if (cmd === "h") add((x += n[0]), y);
      else if (cmd === "v") add(x, (y += n[0]));
      else if (cmd === "H") add((x = n[0]), y);
      else if (cmd === "V") add(x, (y = n[0]));
      else if (cmd === "A") {
        // d3's circle: two half arcs of radius n[0] about the origin.
        add(-n[0], -n[0]);
        add(n[0], n[0]);
        x = n[5];
        y = n[6];
      } else if (cmd !== "Z" && cmd !== "z") throw new Error(`pathBox: no rule for ${cmd}`);
    }
    return box;
  }
  const drawnMarkers = (root) =>
    [...root.querySelectorAll(".frontier-asset .recharts-symbols, .frontier-bench .recharts-symbols, .frontier-mark .recharts-symbols")].map((p) => {
      const [, cx, cy] = /translate\(\s*([-\d.e]+)[ ,]\s*([-\d.e]+)\s*\)/.exec(p.getAttribute("transform") ?? "") ?? [];
      const b = pathBox(p.getAttribute("d") ?? "");
      const half = Number(p.getAttribute("stroke-width") ?? 0) / 2;
      const name = p.closest("[class*=frontier-]")?.getAttribute("class")?.match(/frontier-(asset|bench|mark--\w+)/)?.[1];
      return { name, cx: +cx, cy: +cy, lo: +cx + b.lo - half, hi: +cx + b.hi + half, top: +cy + b.top - half, bot: +cy + b.bot + half };
    });
  const nameBox = (l) => {
    const w = textWidth(l.text);
    return { lo: l.anchor === "end" ? l.x - w : l.x, hi: l.anchor === "end" ? l.x : l.x + w, top: l.y - 6, bot: l.y + 6 };
  };
  const meets = (a, b) => a.lo < b.hi && b.lo < a.hi && a.top < b.bot && b.top < a.bot;

  const realRect = window.HTMLElement.prototype.getBoundingClientRect;
  const drawAt = (width, a, data) => {
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      const r = realRect.call(this);
      return this.classList?.contains("frontier-chart") ? { ...r.toJSON?.(), x: 0, y: 0, top: 0, left: 0, width, height: 0, right: width, bottom: 0 } : r;
    };
    setMedia((q) => q === PHONE_QUERY && width < 600);
    try {
      return drawFrontier(a, data);
    } finally {
      window.HTMLElement.prototype.getBoundingClientRect = realRect;
      setMedia(() => false);
    }
  };

  let cases = 0;
  const culledSeen = [];
  const bad = [];
  const strangers = [];
  let sawPhone = false;
  for (const set of ["cross", "megacap", "sectors", "cross_vti", "dirty"]) {
    for (const allowShort of [false, true]) {
      const a = fixtureAnalysis(set, { allowShort });
      for (const width of [343, 560, 720]) {
        const r = drawAt(width, a, F.frontierData(a, a.ew));
        const root = r.container;
        const svg = root.querySelector("svg.recharts-surface");
        sawPhone ||= width === 343 && svg?.getAttribute("width") === "343";
        const ms = drawnMarkers(root);
        const ls = labels(root);
        const want = a.tickers.length + 1 + 4; // assets, the benchmark, GMV / Tangency / Equal-Weight / Custom
        if (ms.length < want || ls.length < want) bad.push(`${set} ${allowShort ? "short" : "long"} @${width}: ${ms.length} markers, ${ls.length} names drawn`);
        for (const l of ls) {
          const nb = nameBox(l);
          for (const m of ms) if (meets(nb, m)) bad.push(`${set} ${allowShort ? "short" : "long"} @${width}: "${l.text}" on the ${m.name} marker`);
          if (nb.lo < 0 || nb.hi > width) bad.push(`${set} ${allowShort ? "short" : "long"} @${width}: "${l.text}" runs off the chart`);
        }
        for (const c of collisions(ls)) bad.push(`${set} ${allowShort ? "short" : "long"} @${width}: names ${c} overlap`);
        // Whose marker each name is: assets in the order drawn, then the benchmark and the four marks.
        const assetsDrawn = ms.filter((m) => m.name === "asset");
        const owner = new Map([
          ...a.tickers.map((t, k) => [t, assetsDrawn[k]]),
          [a.benchLabel, ms.find((m) => m.name === "bench")],
          ...[["GMV", "gmv"], ["Tangency", "tangency"], ["Equal-Weight", "ew"], ["Custom", "custom"]].map(([t, role]) => [t, ms.find((m) => m.name === `mark--${role}`)]),
        ]);
        const hairlines = [...root.querySelectorAll(".direct-label")].flatMap((g) => {
          const ln = g.querySelector("line");
          return ln ? [{ text: g.getAttribute("data-label"), a: { x: +ln.getAttribute("x1"), y: +ln.getAttribute("y1") }, b: { x: +ln.getAttribute("x2"), y: +ln.getAttribute("y2") } }] : [];
        });
        const side = (p, q, o) => Math.sign((q.x - p.x) * (o.y - p.y) - (q.y - p.y) * (o.x - p.x));
        const cross = (u, v) => side(u.a, u.b, v.a) * side(u.a, u.b, v.b) < 0 && side(v.a, v.b, u.a) * side(v.a, v.b, u.b) < 0;
        hairlines.forEach((u, k) => hairlines.slice(k + 1).forEach((v) => {
          if (cross(u, v)) strangers.push(`${set} ${allowShort ? "short" : "long"} @${width}: the hairlines of "${u.text}" and "${v.text}" cross`);
        }));
        const level = new Set(ls.map((l) => l.text).filter((t) => !hairlines.some((h) => h.text === t)));
        for (const l of ls) {
          const own = owner.get(l.text);
          if (!own || !level.has(l.text)) continue;
          const nb = nameBox(l);
          const dist = (m) => Math.hypot(Math.max(nb.lo - m.cx, 0, m.cx - nb.hi), Math.max(nb.top - m.cy, 0, m.cy - nb.bot));
          const nearer = ms.filter((m) => Math.hypot(m.cx - own.cx, m.cy - own.cy) > 0.5 && dist(m) < dist(own));
          if (nearer.length) strangers.push(`${set} ${allowShort ? "short" : "long"} @${width}: "${l.text}" is nearer the ${nearer.map((m) => m.name).join(", ")} marker than its own`);
        }
        if (root.querySelector(".chart-cull, .culled-name")) culledSeen.push(`${set} ${allowShort ? "short" : "long"} @${width}`);
        cases += 1;
        r.unmount();
      }
    }
  }
  check(sawPhone, "frontier markers: the phone case really drew at 343px, so the checks below saw a phone's crowding");
  // One known gap, pinned so it can neither spread nor go quietly: the densest layout here (nine sectors
  // and shorting at 343px put thirteen markers in about 45 by 100px) keeps ONE hairline crossing. Which
  // pair it is moves with any change to placeLabels' costs (XLU/XLRE, then XLV/XLI); untangling it needs
  // three names moved at once, which the pair repair does not try. Every other layout has none, and this
  // one exactly one: if it clears, drop the pin.
  const PINNED = "sectors short @343";
  const elsewhere = strangers.filter((x) => !x.startsWith(`${PINNED}:`));
  const pinned = strangers.filter((x) => x.startsWith(`${PINNED}:`));
  check(cases === 30 && elsewhere.length === 0 && pinned.length === 1 && /hairlines of .* cross$/.test(pinned[0]),
    `frontier markers: a name level with its point is nearer its own marker than any other, and no two hairlines cross (one crossing pinned in ${PINNED})`,
    strangers.slice(0, 6).join("; ") + (strangers.length > 6 ? `; and ${strangers.length - 6} more` : ""));
  check(cases === 30 && bad.length === 0, `frontier markers: on ${cases} frontiers (5 sets, long and short, 343/560/720px) no name overlaps any marker, another name, or the chart's edge`,
    bad.slice(0, 6).join("; ") + (bad.length > 6 ? `; and ${bad.length - 6} more` : ""));

  // The name widths the placement and the checks above use, against what Chromium measured for these
  // strings in the self-hosted Space Grotesk at 12px (canvas measureText, Sep 28 2026): never short,
  // and at most 4% over. The old estimate, 7px a character, was 19% short on "GMV".
  const MEASURED = { Tangency: 57.0, GMV: 25.7, "S&P 500": 47.5, "Capital allocation line": 124.2, "Efficient frontier": 95.9, "Equal-Weight": 77.7, GOOGL: 38.4, "BRK-B": 35.7, "EURUSD=X": 60.7, "^GSPC": 37.6 };
  const wide = Object.entries(MEASURED).filter(([t, w]) => !(textWidth(t) >= w && textWidth(t) <= w * 1.04 + 0.5)).map(([t, w]) => `${t} ${textWidth(t).toFixed(1)} vs ${w}`);
  check(wide.length === 0, "frontier markers: textWidth matches the face as Chromium draws it, never short, at most 4% over", wide.join("; "));

  // The placement's model of each marker agrees with what Recharts draws, to a tenth of a pixel.
  const r = drawAt(720, long, F.frontierData(long, long.ew));
  const ms = drawnMarkers(r.container);
  const model = { asset: F.symbolExtent("circle", 56), bench: F.symbolExtent("cross", 110), "mark--gmv": F.symbolExtent("diamond", 170),
    "mark--tangency": F.symbolExtent("star", 240), "mark--ew": F.symbolExtent("square", 110), "mark--custom": F.symbolExtent("triangle", 150) };
  const off = [];
  for (const m of ms) {
    const e = model[m.name];
    const w = m.hi - m.lo;
    const hgt = m.bot - m.top;
    if (!e || Math.abs(w - (e.left + e.right)) > 0.1 || Math.abs(hgt - (e.up + e.down)) > 0.1) off.push(`${m.name} drawn ${w.toFixed(2)}x${hgt.toFixed(2)}, modelled ${(e.left + e.right).toFixed(2)}x${(e.up + e.down).toFixed(2)}`);
  }
  check(ms.length >= 6 && off.length === 0, "frontier markers: symbolExtent matches the drawn size of every marker kind", off.join("; "));

  // Leaving off an asset's name the packer cannot place (cullBlocked, the last step). On the thirty
  // frontiers above and on the default example at a phone's and a desktop's width, nothing is left off.
  const ex = exampleAnalysis();
  for (const width of [343, 560, 720, 1240]) {
    const rr = drawAt(width, ex, F.frontierData(ex, ex.ew));
    if (rr.container.querySelector(".chart-cull, .culled-name")) culledSeen.push(`example @${width}`);
    rr.unmount();
  }
  check(cases === 30 && culledSeen.length === 0, "frontier cull: no name is left off on the thirty frontiers or on the default example at any width", culledSeen.join("; "));
  // Ten assets crowded on one spot beside a portfolio's marker: the portfolio's name always draws, every
  // drawn name is clear, and a name left off could not come back without blocking one.
  {
    const { cullBlocked } = await import("../src/charts/labels.ts");
    const plotBox = { x: 0, y: 0, width: 90, height: 48 };
    const items = [
      { key: "mark--gmv", text: "GMV", color: "#262421", px: 45, py: 24, own: F.symbolExtent("diamond", 170) },
      ...Array.from({ length: 10 }, (_, i) => ({ key: `asset-T${i}`, text: `T${i}`, color: "#33302c", px: 39 + (i % 4) * 3, py: 18 + Math.floor(i / 4) * 4, own: F.symbolExtent("circle", 56) })),
    ];
    const markers = items.map((it) => ({ x: it.px, y: it.py, extent: it.own }));
    const place = (off) => F.placeLabels(items.filter((it) => !off.has(it.key)), plotBox, markers);
    const { labels, off } = cullBlocked(place, F.isAsset);
    const back = off.filter((k) => place(new Set(off.filter((o) => o !== k))).some((l) => l.clear === false && F.isAsset(l.key)) === false);
    check(off.length > 0 && labels.some((l) => l.key === "mark--gmv") && labels.every((l) => l.clear !== false || !F.isAsset(l.key)) && back.length === 0 && off.every(F.isAsset),
      "frontier cull: at ten crowded assets the portfolio's name always draws, no drawn asset name is blocked, and only asset names are left off",
      `off ${off.join(",")}; could come back ${back.join(",")}`);
    check(F.isAsset("asset-SPY") && !F.isAsset("mark--gmv") && !F.isAsset("bench") && !F.isAsset("frontier") && !F.isAsset("cal") && !F.isAsset("added-tan.1y"),
      "frontier cull: only an asset's name may be left off, never a portfolio's, the benchmark's, an added construction's or a line's");
    check(F.frontierCull(0) === null && F.frontierCull(2) === "Two asset names that would overlap are left off; hover or tap a point to read it.",
      "frontier cull: the line under the chart, from the count", String(F.frontierCull(2)));
  }
  // Drawn too narrow for the nine sectors: the names left off are counted in the line under the chart,
  // each is a keyboard stop, and focusing one draws its name.
  {
    const sec = fixtureAnalysis("sectors", { allowShort: true });
    const rr = drawAt(150, sec, F.frontierData(sec, sec.ew));
    const stops = [...rr.container.querySelectorAll("g.culled-name")];
    const line = rr.container.querySelector(".chart-cull");
    const drawnNames = [...rr.container.querySelectorAll(".frontier-labels .direct-label")].map((g) => g.getAttribute("data-label"));
    // A stop is spoken as its asset and its point's two figures: "XLRE: volatility 21.99%, return 9.87%".
    const tickerOf = (g) => (g.getAttribute("aria-label") ?? "").split(":")[0];
    check(stops.length > 0 && line && line.textContent === F.frontierCull(stops.length) && stops.every((g) => sec.tickers.includes(tickerOf(g)) && !drawnNames.includes(tickerOf(g))),
      "frontier cull: drawn at 150px, the asset names left off are counted in one line under the chart and none is also drawn", `${stops.length} | ${line ? line.textContent : "no line"}`);
    const points = F.frontierData(sec, sec.ew).assets;
    const spokenOk = stops.every((g) => {
      const p = points.find((x) => x.ticker === tickerOf(g));
      return !!p && g.getAttribute("aria-label") === `${p.ticker}: volatility ${format(p.sigma, "pct2")}, return ${format(p.mu, "pct2")}`;
    });
    check(spokenOk, "frontier cull: each stop names its asset and its point's volatility and return", stops.map((g) => g.getAttribute("aria-label")).join(" / "));
    const name = stops[0] ? tickerOf(stops[0]) : null;
    const before = stops[0]?.querySelector("text");
    if (stops[0]) act(() => stops[0].dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    const during = rr.container.querySelector("g.culled-name text");
    check(stops.every((g) => g.getAttribute("tabindex") === "0") && !before && during && during.textContent === name,
      "frontier cull: a name left off is a keyboard stop that draws the name while it has focus", `${name} ${during ? during.textContent : "none"}`);
    rr.unmount();
  }
  r.unmount();
}

// ---- the starting amount's own field ------------------------------------------------------------------
{
  const { amountProblem } = await import("../src/charts/AmountField.tsx");
  check(amountProblem("10000") === null && amountProblem("100") === null && /at least \$100/.test(amountProblem("99.5") ?? "") &&
    amountProblem("") !== null && amountProblem("abc") !== null,
    "amount: the chart's field takes $100 and up, and refuses an empty, non-numeric or smaller amount");
  // Under 16px iOS zooms the page when a field takes focus; the field's phone rule holds it there.
  const css = readFileSync(new URL("../src/charts/AmountField.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const phone = css.slice(css.indexOf("@media (max-width: 760px)"));
  check(phone.length > 0 && /\.amount-field input\s*\{[^}]*font-size:\s*16px/.test(phone),
    "amount: under the 760px query the field is 16px, so focusing it does not zoom the page");
  const W1 = render(h(W.default, { title: "Growth", state: { status: "ready", value: W.wealthData(long, long.ew) }, amount: 10000 }));
  check(!W1.container.querySelector(".amount-field"), "amount: a wealth chart given no setter shows no field");
  W1.unmount();
}

done("t-charts-portfolio");
