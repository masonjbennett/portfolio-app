// The chart kit (src/charts/) and the frames around figures (ChartFrame, Plate, Slug).
//
// (a) Every colour a chart can draw is a token; assets keep a stable colour by position; the fixed
//     series (GMV, Tangency, Equal-Weight, Custom, benchmark, frontier) each have their own.
// (b) Hover defaults to the closest point (ledger:frontier-hover, the kit's half).
// (c) spreadLabels moves colliding direct labels apart, least-squares, keeping their order.
// (d) ChartFrame draws only from "ready", names an error, and never shows a half-drawn chart.
// (e) Plate never prints NaN; (f) the components' CSS uses only token custom properties.
import { render, text, act } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, close, done } from "./_assert.mjs";

const { createElement: h } = await import("react");
const web = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, web), "utf8");
const app = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8");
const { tokens } = await import("../src/styles/tokens.ts");
const theme = await import("../src/charts/theme.ts");
const { spreadLabels, pointLabel } = await import("../src/charts/labels.ts");
const ChartFrame = (await import("../src/components/ChartFrame.tsx")).default;
const Plate = (await import("../src/components/Plate.tsx")).default;
const Slug = (await import("../src/components/Slug.tsx")).default;
const { DASH, format } = await import("../src/format.ts");
const quiet = (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};
const c = tokens.color;
const TOKEN_COLORS = new Set(Object.values(c));

// ---- (a) colours -----------------------------------------------------------------------------------
// Every string that looks like a colour, anywhere inside the kit's exports.
function colours(value, path, out) {
  if (typeof value === "string") {
    if (/^#|^rgb|^hsl/i.test(value)) out.push([path, value]);
  } else if (typeof value === "function") {
    if (value.length === 0) colours(value(), `${path}()`, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) colours(v, `${path}.${k}`, out);
  }
  return out;
}
const found = colours({ ...theme, tooltipX: theme.tooltipProps("x"), label: pointLabel("GMV", theme.ROLE.gmv) }, "theme", []);
const strangers = found.filter(([, v]) => !TOKEN_COLORS.has(v));
check(found.length >= 20 && strangers.length === 0, "charts: every colour the kit hands a chart is a token",
  `${found.length} colours; not tokens: ${strangers.map(([p, v]) => `${p}=${v}`).join(" ")}`);
// A border written as "1px solid #hex" is not a colour string on its own; check inside those too.
const borders = JSON.stringify(theme.tooltipProps()).match(/#[0-9a-f]{3,8}/gi) ?? [];
check(borders.length > 0 && borders.every((v) => TOKEN_COLORS.has(v)), "charts: colours inside the tooltip's CSS strings are tokens", borders.join(" "));

const { SERIES, seriesColor, assetColors, ROLE } = theme;
check(SERIES.length === 5 && new Set(SERIES).size === SERIES.length, "charts: five distinct asset colours", SERIES.join(" "));
check(JSON.stringify(SERIES) === JSON.stringify([c.navy, c.bronze, c.claret, c.teal, c.plum]),
  "charts: assets follow the app's CHART_COLORS hue order (blue, orange, red, green, purple -> navy, bronze, claret, teal, plum)", SERIES.join(" "));
check(!SERIES.includes(c.red) && !SERIES.includes(c.ink) && !SERIES.includes(c.ink2) && !SERIES.includes(c.paper) && !SERIES.includes(c.hairline),
  "charts: no asset is drawn in market-down red, the benchmark's ink, or the paper and hairlines");
let cycles = true;
for (let i = -12; i < 24; i++) if (seriesColor(i) !== SERIES[((i % 5) + 5) % 5] || seriesColor(i) !== seriesColor(i + 5)) cycles = false;
check(cycles, "charts: seriesColor(i) is SERIES[i mod 5], negative indices included");
const tick = ["AAPL", "MSFT", "GOOGL", "AMZN", "JPM", "GLD", "TLT"];
const a1 = assetColors(tick);
const a2 = assetColors([...tick]);
check(tick.every((t, i) => a1[t] === seriesColor(i) && a1[t] === a2[t]) && Object.keys(a1).length === tick.length,
  "charts: assetColors gives each ticker its position's colour, the same on every call", JSON.stringify(a1));
const roles = ["gmv", "tangency", "ew", "custom", "bench", "frontier"];
check(new Set(roles.map((r) => ROLE[r])).size === roles.length, "charts: GMV, Tangency, Equal-Weight, Custom, benchmark and frontier each have their own colour",
  JSON.stringify(ROLE));
check(ROLE.gmv === c.teal && ROLE.tangency === c.bronze && ROLE.ew === c.plum && ROLE.custom === c.claret && ROLE.bench === c.ink && ROLE.frontier === c.navy,
  "charts: the roles map the app's (GMV green -> teal, Tangency orange -> bronze, EW purple -> plum, Custom pink -> claret, benchmark primary -> ink, frontier blue -> navy)");
check(!SERIES.includes(ROLE.bench), "charts: the benchmark's colour is never an asset's");
check(theme.chartTheme.up === c.teal && theme.chartTheme.down === c.red, "charts: market up is teal, market down is red");
check(theme.axisProps.tick.fontFamily === tokens.font.mono && theme.chartTheme.label.fontFamily === tokens.font.sans && theme.axisProps.tickLine === false,
  "charts: ticks in JetBrains Mono, labels in Space Grotesk, no tick marks");
check(theme.gridProps.vertical === false && theme.gridProps.stroke === c.hairline2, "charts: the grid is horizontal hairlines only");

// ---- (b) hover -------------------------------------------------------------------------------------
const styleChart = app.slice(app.indexOf("def style_chart("), app.indexOf("return fig", app.indexOf("def style_chart(")));
check(styleChart.includes('hovermode="x unified"') && (app.match(/hovermode="closest"/g) ?? []).length === 2,
  "ledger:frontier-hover: the app's style_chart forces x-unified on every chart over the frontiers' two \"closest\"");
check(theme.HOVER_DEFAULT === "closest" && theme.tooltipProps().shared === false && theme.tooltipProps().cursor === false,
  "ledger:frontier-hover: the kit's tooltip defaults to the closest point, no shared x and no cursor line");
check(theme.tooltipProps("x").shared === true && theme.tooltipProps("x").cursor.stroke === c.hairline,
  "charts: a chart opts into a shared x explicitly");

// ---- (c) direct labels -----------------------------------------------------------------------------
const eq = (a, b) => a.length === b.length && a.every((x, i) => close(x, b[i], 1e-12, 1e-12));
check(eq(spreadLabels([0, 20, 50], 10), [0, 20, 50]), "labels: labels already apart stay where they are");
check(eq(spreadLabels([0, 0], 10), [-5, 5]), "labels: two labels on one spot split evenly about it", String(spreadLabels([0, 0], 10)));
check(eq(spreadLabels([3, 3, 3], 4), [-1, 3, 7]), "labels: three on one spot are packed at the gap, centred", String(spreadLabels([3, 3, 3], 4)));
check(eq(spreadLabels([5, 0, 6], 4), [11 / 3, -1 / 3, 23 / 3]), "labels: runs merge while they overlap, and each label returns to its own index",
  String(spreadLabels([5, 0, 6], 4)));
{
  let ok = true;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = 0; t < 200 && ok; t++) {
    const want = Array.from({ length: 2 + (t % 9) }, () => Math.round(rnd() * 60));
    const got = spreadLabels(want, 8);
    const order = want.map((_, i) => i).sort((a, b) => want[a] - want[b] || a - b);
    for (let k = 1; k < order.length; k++) if (got[order[k]] - got[order[k - 1]] < 8 - 1e-9) ok = false;
    const shift = got.reduce((s, g, i) => s + g - want[i], 0);
    if (Math.abs(shift) > 1e-9) ok = false;
  }
  check(ok, "labels: on 200 random sets, order is kept, every gap is at least the gap, and the mean does not move");
}
const lab = pointLabel("Tangency", ROLE.tangency);
check(lab.value === "Tangency" && lab.fill === ROLE.tangency && lab.position === "right" && lab.fontFamily === tokens.font.sans,
  "labels: pointLabel names the point in the series' colour, beside it", JSON.stringify(lab));

// ---- (d) ChartFrame --------------------------------------------------------------------------------
let drew = [];
const draw = (v) => {
  drew.push(v);
  return h("svg", { "data-drawn": String(v) });
};
const frame = (state, extra = {}) => render(h(ChartFrame, { title: "Gold fell least", subtitle: "Daily, 2019-2026", state, children: draw, ...extra }));
{
  drew = [];
  const r = frame({ status: "loading" });
  const note = r.container.querySelector(".chart-note");
  check(drew.length === 0 && !r.container.querySelector("svg") && note?.getAttribute("role") === "status" && text(note) === "Loading"
    && r.container.querySelector("figure")?.getAttribute("aria-busy") === "true" && note.style.minHeight === "320px",
    "chartframe: loading says so, holds the chart's height, and draws nothing", r.container.innerHTML);
  const at = (sel) => (r.container.querySelector(sel) ? text(r.container.querySelector(sel)) : null);
  check(at("figcaption h3") === "Gold fell least" && at("figcaption p") === "Daily, 2019-2026",
    "chartframe: the title states the finding as a heading, the subtitle under it", r.container.querySelector("figcaption")?.innerHTML);
  r.unmount();
}
{
  drew = [];
  const r = frame({ status: "empty", reason: "No return rows after cleaning." }, { height: 240 });
  const note = r.container.querySelector(".chart-note");
  check(drew.length === 0 && !r.container.querySelector("svg") && text(note) === "No return rows after cleaning." && note.style.minHeight === "240px",
    "chartframe: empty states its reason and draws nothing", r.container.innerHTML);
  r.unmount();
}
{
  drew = [];
  const r = frame({ status: "error", name: "prices", message: "Yahoo did not answer." });
  const alert = r.container.querySelector("[role=alert]");
  check(drew.length === 0 && !r.container.querySelector("svg") && text(alert).includes("prices") && text(alert).includes("Yahoo did not answer."),
    "chartframe: an error is named, with its message, and nothing is drawn", r.container.innerHTML);
  r.unmount();
}
{
  drew = [];
  const r = frame({ status: "ready", value: 7 });
  check(drew.length === 1 && drew[0] === 7 && r.container.querySelector("svg[data-drawn='7']") && !r.container.querySelector(".chart-note"),
    "chartframe: ready draws the chart from its value and shows no note", r.container.innerHTML);
  r.unmount();
}
quiet(() => {
  const Boom = () => {
    throw new Error("frontier has no points");
  };
  const half = (v) => h("svg", { "data-drawn": String(v) }, h("g", { className: "axis" }), v === 1 ? h(Boom) : null);
  let r = null;
  try {
    r = render(h("div", null, h(ChartFrame, { title: "Frontier", state: { status: "ready", value: 1 }, children: half }), h("p", null, "next card")));
  } catch (err) {
    check(false, "chartframe: a throw while drawing stays in the frame", err.message);
  }
  const alert = r?.container.querySelector("[role=alert]");
  check(r !== null && !r.container.querySelector("svg") && text(alert).includes("frontier has no points") && text(r.container).includes("next card"),
    "chartframe: a throw while drawing shows the named error and no part of the chart", r ? r.container.innerHTML : "");
  r?.rerender(h("div", null, h(ChartFrame, { title: "Frontier", state: { status: "ready", value: 2 }, children: half }), h("p", null, "next card")));
  check(r?.container.querySelector("svg[data-drawn='2']") && !r.container.querySelector("[role=alert]"),
    "chartframe: a new value draws again after a failed one", r ? r.container.innerHTML : "");
  r?.unmount();
  // The draw function itself throwing (not a component inside what it returns) must be caught too:
  // calling it in ChartFrame's own render would put the throw above the frame's boundary.
  const early = (v) => {
    if (v === 3) throw new Error("no rows to plot");
    return h("svg", { "data-drawn": String(v) });
  };
  let e = null;
  try {
    e = render(h("div", null, h(ChartFrame, { title: "Wealth", state: { status: "ready", value: 3 }, children: early }), h("p", null, "next card")));
  } catch (err) {
    check(false, "chartframe: a throw from the draw function itself is caught in the frame", err.message);
  }
  check(e !== null && !e.container.querySelector("svg") && text(e.container.querySelector("[role=alert]") ?? e.container).includes("no rows to plot")
    && text(e.container).includes("next card"),
    "chartframe: a throw from the draw function itself is caught in the frame", e ? e.container.innerHTML : "");
  e?.unmount();
});

// ---- (e) Plate -------------------------------------------------------------------------------------
for (const value of [null, NaN, Infinity, -Infinity]) {
  const r = render(h(Plate, { label: "Best Sharpe (Tangency)", value, format: "num3", level: "plain" }));
  const t = text(r.container);
  check(t.includes(DASH) && t.includes("not available") && !/NaN|Infinity/.test(t),
    `plate: ${value} prints the dash and "not available", never NaN`, t);
  r.unmount();
}
{
  const r = render(h(Plate, { label: "Tangency Return", value: 0.1234, format: "pct2", tip: "tangency_return", level: "formula", allowShort: true }));
  const t = text(r.container.querySelector(".plate-value"));
  check(t === format(0.1234, "pct2") && !text(r.container).includes("not available"), "plate: a number prints through format()", t);
  const tip = r.container.querySelector("[role=tooltip]");
  check(r.container.querySelector("button[aria-label='About tangency return']") && text(tip).includes("[-1, 1]"),
    "plate: its tip sits beside the label and follows the shorting toggle", tip ? text(tip) : "no tip");
  r.unmount();
  const bare = render(h(Plate, { label: "Days", value: 5, format: "int", level: "plain" }));
  check(!bare.container.querySelector("button"), "plate: no tip, no mark");
  bare.unmount();
}

// ---- (f) Slug and the components' CSS --------------------------------------------------------------
{
  const r = render(h(Slug, { id: "frontier" }, "The efficient frontier"));
  const h2 = r.container.querySelector(".slug > h2#frontier");
  check(h2 && text(h2) === "The efficient frontier", "slug: an h2 with its anchor id inside the slug", r.container.innerHTML);
  r.unmount();
}
const slugCss = read("src/components/Slug.css");
check(/\.slug\s*\{[^}]*border-top:[^;]*var\(--color-hairline\)/.test(slugCss) && /\.slug::before\s*\{[^}]*background:\s*var\(--color-teal\)/.test(slugCss)
  && /height:\s*var\(--line-bar\)/.test(slugCss) && /font-family:\s*var\(--font-serif\)/.test(slugCss),
  "slug: a teal bar on a hairline over an Instrument Serif heading");
const defined = new Set([...read("src/styles/tokens.css").matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
for (const f of ["Tip", "ChartFrame", "Plate", "Slug"]) {
  const css = read(`src/components/${f}.css`);
  const literal = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) ?? [];
  const unknown = [...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]).filter((v) => !defined.has(v));
  check(literal.length === 0 && unknown.length === 0, `css: ${f}.css takes every colour from a token and names only defined ones`,
    `literals ${literal.join(" ")} unknown ${unknown.join(" ")}`);
}
for (const f of ["src/charts/theme.ts", "src/charts/labels.ts", "src/components/ChartFrame.tsx", "src/components/Plate.tsx", "src/components/Slug.tsx", "src/components/Tip.tsx", "src/content/tooltips.ts"]) {
  check(!/\p{Extended_Pictographic}/u.test(read(f)), `brand: no emoji in ${f}`);
}

done("t-charts");
