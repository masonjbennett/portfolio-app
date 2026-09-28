// Chart colours and type, from the tokens: SVG attributes cannot read CSS custom properties, so every
// chart takes its colours from here and every colour here is a token (test/t-charts.mjs holds that).
//
// The app's palette (portfolio_app.py 21-50) mapped onto the brand, ONE colour per role. The app is
// not consistent about Equal-Weight (1538 draws it in the secondary blue, the frontiers and the
// wealth chart in #9B59B6); here it is plum everywhere.
import { tokens } from "../styles/tokens.ts";

const c = tokens.color;

// Assets by position in the ticker list, the app's CHART_COLORS[i % 10] (47-50) in its hue order:
// blue #2E86AB -> navy, orange #F18F01 -> bronze, red #E74C3C -> claret, green #2ECC71 -> teal,
// purple #9B59B6 -> plum. Five chromatic tokens, so the sixth asset takes the first colour again;
// charts label assets directly, so a repeat is never the only way to tell two apart. Red is kept
// for market down and ink for the benchmark, so neither is ever an asset.
export const SERIES: readonly string[] = [c.navy, c.bronze, c.claret, c.teal, c.plum];

// The colour of the i-th series, cycling; a negative index cycles backwards instead of failing.
export function seriesColor(i: number): string {
  return SERIES[((i % SERIES.length) + SERIES.length) % SERIES.length];
}

// Ticker -> colour by position, so an asset keeps its colour on every chart of one analysis.
export function assetColors(tickers: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  tickers.forEach((t, i) => (out[t] = seriesColor(i)));
  return out;
}

// The fixed series (spec'd once, used everywhere). App colours: GMV success #2ECC71, Tangency accent
// #F18F01, Equal-Weight #9B59B6, Custom #E91E63, benchmark primary #1B2A4A, frontier line secondary
// #2E86AB, CAL text_muted #6C7A96 dashed (frontier 1612-1644, wealth 1671, custom frontier from 1775).
export const ROLE = {
  gmv: c.teal,
  tangency: c.bronze,
  ew: c.plum,
  custom: c.claret,
  bench: c.ink,
  frontier: c.navy,
  cal: c.ink2,
} as const;

export type Role = keyof typeof ROLE;

// Dash patterns: the CAL (1612, 1775) and reference lines such as beta = 1 (1403) are dashed.
export const DASH = { cal: "5 4", reference: "2 3" } as const;

// Axis, grid and label styling shared by every chart.
export const chartTheme = {
  axis: { stroke: c.hairline, fill: c.ink2, fontFamily: tokens.font.mono, fontSize: 11 },
  grid: { stroke: c.hairline2 },
  label: { fill: c.ink, fontFamily: tokens.font.sans, fontSize: 12 },
  up: c.up,
  down: c.down,
  bench: ROLE.bench,
} as const;

// Spread onto <XAxis> / <YAxis>: hairline axis, JetBrains Mono ticks, no tick marks.
export const axisProps = {
  stroke: chartTheme.axis.stroke,
  tickLine: false,
  axisLine: { stroke: chartTheme.axis.stroke },
  tick: { fill: chartTheme.axis.fill, fontFamily: chartTheme.axis.fontFamily, fontSize: chartTheme.axis.fontSize },
} as const;

// Spread onto <CartesianGrid>: horizontal hairlines only.
export const gridProps = { stroke: chartTheme.grid.stroke, vertical: false } as const;

// Spread onto <Legend> where a direct label will not do (more series than room to label them).
export const legendProps = {
  iconType: "plainline",
  wrapperStyle: { fontFamily: tokens.font.sans, fontSize: 12, color: c.ink2 },
} as const;

// How a chart's hover picks what to show. The app's style_chart (983-995) sets "x unified" on EVERY
// chart, which overrides the "closest" both frontiers ask for (1653, 1816): hovering a frontier listed
// every series at that volatility. Here closest-point is the default and a chart opts into a shared x
// only where comparing series at one date is the point (the wealth and drawdown lines).
// Recharts 3.10 honours closest-point (an "item" tooltip) in ScatterChart and BarChart. LineChart,
// AreaChart and ComposedChart accept only the "axis" event, so a chart built on them is shared-x
// whatever this says; draw a frontier as a ScatterChart with a <Scatter line> for closest-point.
export type Hover = "closest" | "x";
export const HOVER_DEFAULT: Hover = "closest";

// Spread onto <Tooltip>: paper box, hairline border, numbers in JetBrains Mono, no animation.
export function tooltipProps(hover: Hover = HOVER_DEFAULT) {
  return {
    shared: hover === "x",
    cursor: hover === "x" ? { stroke: c.hairline, strokeWidth: 1 } : false,
    isAnimationActive: false,
    contentStyle: {
      background: c.paper,
      border: `1px solid ${c.hairline}`,
      borderRadius: 0,
      fontFamily: tokens.font.mono,
      fontSize: 12,
      color: c.ink,
      padding: "6px 10px",
    },
    labelStyle: { fontFamily: tokens.font.sans, color: c.ink2, marginBottom: 2 },
    itemStyle: { padding: 0 },
  } as const;
}
