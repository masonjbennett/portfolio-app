// The efficient frontier: the lowest volatility reachable at each return, with the assets, the
// benchmark and the marked portfolios (Equal-Weight, GMV, Tangency, Custom) placed on it and NAMED ON
// THE CHART. Shared by the Optimization tab (portfolio_app.py 1592-1656) and the Custom tab
// (1753-1819), which differ only in what they pass.
//
// Where it departs from the app, on purpose:
// - Hover names the ONE point under the pointer. Both frontiers ask for hovermode "closest" (1653,
//   1816), and style_chart (983-995), applied after, overrides it with "x unified", so a hover listed
//   every series at that volatility. Recharts 3.10 gives a ScatterChart only the closest-point ("item")
//   tooltip, which is why this is a ScatterChart with a <Scatter line> and not a ComposedChart.
// - No legend. Every point carries its name beside it, moved apart where two names would collide
//   (Custom sits exactly on Equal-Weight until the weights are changed, 1631-1634).
// - With shorting on, the caption states the bounds: each weight in [-1, 1] (780-782). The toggle's
//   help calls that frontier "unconstrained" (750); it is not.
// - A failed tangency solve draws no tangency point and no capital allocation line, and the caption
//   says so. (The app always had a tangency to plot: an equal-weight stand-in when SLSQP failed.)
// - The capital allocation line runs as the app's does, from (0, rf) to 1.15 times the frontier's
//   highest volatility (1607-1609), but the plot is scaled to the points and the line is clipped at
//   its edge; the app's autorange stretched the whole plot to hold the line's far end.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Symbols,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisDomain,
  useYAxisScale,
} from "recharts";
import { usePhone } from "../chrome/usePhone.ts";
import ChartFrame from "../components/ChartFrame.tsx";
import { format, MINUS } from "../format.ts";
import type { Vec } from "../lib/num.ts";
import type { FrontierPoint } from "../lib/optimize.ts";
import { portfolioPerformance } from "../lib/portfolio.ts";
import { annualizedStats } from "../lib/stats.ts";
import { tokens } from "../styles/tokens.ts";
import type { Analysis, LoadState } from "../types.ts";
import { labelFill } from "./contrast.ts";
import { spreadLabels } from "./labels.ts";
import { axisProps, chartTheme, DASH, gridProps, ROLE, tooltipProps, type Hover } from "./theme.ts";

const c = tokens.color;

// ---- props ---------------------------------------------------------------------------------------

/** The four portfolios a frontier can mark. */
export type MarkRole = "ew" | "gmv" | "tangency" | "custom";

/** One asset: its annualized mean return and volatility (1636-1637). */
export interface FrontierAsset {
  ticker: string;
  mu: number;
  sigma: number;
}

/** A marked portfolio. One the caller leaves out of `marks` is not drawn (a failed GMV, say). */
export interface FrontierMark {
  /** The name drawn beside the point, e.g. "GMV". */
  label: string;
  /** Which portfolio: sets the colour and the marker. */
  role: MarkRole;
  /** Annualized return. */
  mu: number;
  /** Annualized volatility. */
  sigma: number;
}

/** The capital allocation line: from the risk-free rate through the tangency portfolio (1607-1609). */
export interface FrontierCal {
  /** The annual risk-free rate the line starts from, at zero volatility. */
  rf: number;
  /** The tangency portfolio's annualized return and volatility. */
  tangency: { mu: number; sigma: number };
}

/** The benchmark's point, drawn with its name as the app does (1641-1645). */
export interface FrontierBench {
  label: string;
  mu: number;
  sigma: number;
}

/** Everything one frontier draws. */
export interface FrontierData {
  /** The engine's frontier; infeasible points are dropped by the chart and the rest joined in order. */
  points: readonly FrontierPoint[];
  /** The assets, in ticker order (their colours follow that order). */
  assets: readonly FrontierAsset[];
  /** The marked portfolios, drawn in this order (a later one sits on top). */
  marks: readonly FrontierMark[];
  /** null when the tangency solve failed: then no tangency point and no line are drawn, and the caption says why. */
  cal: FrontierCal | null;
  /** The benchmark's point, or null to leave it off. */
  bench: FrontierBench | null;
}

export interface FrontierProps {
  /** One sentence stating the finding. */
  title: string;
  /** The frontier's data state; only "ready" draws. */
  state: LoadState<FrontierData>;
  /** The shorting toggle the frontier was solved under: the caption states the bounds when it is on. */
  allowShort: boolean;
  /** The annual risk-free rate, for the caption. */
  rf: number;
  /** Height in px; 480 on a desktop and 380 on a phone when left out. */
  height?: number;
}

// ---- pure helpers --------------------------------------------------------------------------------

/** The frontier's hover: the closest point, never a shared x (the app's was "x unified" by accident). */
export const FRONTIER_HOVER: Hover = "closest";

/** The tooltip props every frontier spreads onto its <Tooltip>. */
export const frontierTooltip = tooltipProps(FRONTIER_HOVER);

/** The line from the risk-free rate through the tangency portfolio, as the app draws it (1607-1609). */
export interface CalSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The tangency portfolio's Sharpe ratio; 0 when its volatility is not positive, as in the app. */
  slope: number;
}

export function calSegment(cal: FrontierCal, frontierMaxSigma: number): CalSegment {
  const slope = cal.tangency.sigma > 0 ? (cal.tangency.mu - cal.rf) / cal.tangency.sigma : 0;
  const x1 = frontierMaxSigma * 1.15;
  return { x0: 0, y0: cal.rf, x1, y1: cal.rf + slope * x1, slope };
}

/** The caption under the frontier's title: what is drawn, and the bounds only when shorting is on. */
export function frontierCaption(allowShort: boolean, rf: number, cal: FrontierCal | null | undefined): string {
  const parts = ["Annualized return against annualized volatility; the solid line is the lowest volatility reachable at each return."];
  if (cal === null) {
    parts.push("Tangency failed: the maximum-Sharpe solve returned no portfolio, so no tangency point and no capital allocation line are drawn.");
  } else if (cal) {
    parts.push(`The dashed line is the capital allocation line, from the ${format(rf, "pct2")} risk-free rate through the tangency portfolio.`);
  }
  if (allowShort) parts.push(`Shorting is on: each asset's weight is bounded to [${MINUS}1, 1].`);
  return parts.join(" ");
}

/**
 * The frontier data for one analysis: its frontier (or `points`, the Custom tab's own), each asset at
 * mean x 252 and sample std x sqrt(252) (1636-1637), the marks through portfolio_performance
 * (1760-1762) in the app's drawing order GMV, Tangency, Equal-Weight, Custom (1614-1634), the line
 * when there is a tangency, and the benchmark. `custom` is the normalised custom weights, or null.
 */
export function frontierData(a: Analysis, custom: Vec | null = null, points: readonly FrontierPoint[] = a.frontier): FrontierData {
  const perf = (w: Vec) => portfolioPerformance(w, a.m, a.S, a.rf);
  const marks: FrontierMark[] = [];
  if (a.gmv) marks.push({ label: "GMV", role: "gmv", mu: a.gmv.mu, sigma: a.gmv.sigma });
  if (a.tangency) marks.push({ label: "Tangency", role: "tangency", mu: a.tangency.mu, sigma: a.tangency.sigma });
  const ew = perf(a.ew);
  marks.push({ label: "Equal-Weight", role: "ew", mu: ew.mu, sigma: ew.sigma });
  if (custom) {
    const p = perf(custom);
    marks.push({ label: "Custom", role: "custom", mu: p.mu, sigma: p.sigma });
  }
  return {
    points,
    assets: a.tickers.map((ticker, i) => {
      const s = annualizedStats(a.returns[i], a.rf);
      return { ticker, mu: s.mu, sigma: s.sigma };
    }),
    marks,
    cal: a.tangency ? { rf: a.rf, tangency: { mu: a.tangency.mu, sigma: a.tangency.sigma } } : null,
    bench: { label: a.benchLabel, mu: a.benchStats.mu, sigma: a.benchStats.sigma },
  };
}

// ---- sizing and direct labels (shared with the wealth chart) ------------------------------------

/** Space Grotesk at 12px averages about 7px a character; labels are placed on this estimate. */
export const CHAR_PX = 7;
const LABEL_FONT = { fontFamily: tokens.font.sans, fontSize: 12 } as const;
const LABEL_GAP = 14; // px between two labels' centres: a 12px line and a hair of air
const LABEL_OFFSET = 9; // px from a point to its label

/**
 * The width a chart has to draw in, measured from its own box. Recharts' `responsive` never draws
 * until the box reports a size, which jsdom never does (test/_dom.mjs), so this starts at
 * `fallback` and takes the real width as soon as the box has one.
 */
export function useBoxWidth(fallback: number): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const take = (w: number) => {
      if (w > 0) setWidth(Math.round(w));
    };
    take(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => take(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A label where it is drawn: `x`, `y` the text's anchor, `px`, `py` the point it names. */
export interface PlacedLabel {
  key: string;
  text: string;
  color: string;
  x: number;
  y: number;
  px: number;
  py: number;
  anchor: "start" | "end";
  width: number;
}

/**
 * Puts each name beside its point, to the right unless that would run off the plot, then moves names
 * apart vertically so no two overlap. Names whose horizontal extents overlap form one group, and each
 * group is spread with spreadLabels (least movement, order kept) and kept inside the plot.
 */
export function placeLabels(items: readonly { key: string; text: string; color: string; px: number; py: number }[], plot: Box): PlacedLabel[] {
  const right = plot.x + plot.width;
  const boxes = items.map((it) => {
    const width = it.text.length * CHAR_PX;
    const toRight = it.px + LABEL_OFFSET + width <= right;
    const x = toRight ? it.px + LABEL_OFFSET : it.px - LABEL_OFFSET;
    return { ...it, width, x, anchor: (toRight ? "start" : "end") as "start" | "end", lo: toRight ? x : x - width, hi: toRight ? x + width : x };
  });
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].lo - boxes[b].lo || a - b);
  const groups: number[][] = [];
  let reach = -Infinity;
  for (const i of order) {
    if (groups.length && boxes[i].lo < reach + 4) groups[groups.length - 1].push(i);
    else groups.push([i]);
    reach = groups[groups.length - 1].length === 1 ? boxes[i].hi : Math.max(reach, boxes[i].hi);
  }
  const top = plot.y + LABEL_GAP / 2;
  const bottom = plot.y + plot.height - LABEL_GAP / 2;
  const ys = new Array<number>(boxes.length);
  for (const g of groups) {
    const got = spreadLabels(g.map((i) => boxes[i].py), LABEL_GAP);
    const lo = Math.min(...got);
    const hi = Math.max(...got);
    const shift = lo < top ? top - lo : hi > bottom ? Math.max(bottom - hi, top - lo) : 0;
    g.forEach((i, k) => (ys[i] = got[k] + shift));
  }
  return boxes.map((b, i) => ({ key: b.key, text: b.text, color: b.color, x: b.x, y: ys[i], px: b.px, py: b.py, anchor: b.anchor, width: b.width }));
}

/** One placed name, with a hairline back to its point when it had to move; bronze names are set in ink2 (./contrast.ts). */
export function LabelText({ l }: { l: PlacedLabel }) {
  const moved = Math.abs(l.y - l.py) > LABEL_GAP / 2;
  return (
    <g className="direct-label" data-label={l.text}>
      {moved ? (
        <line x1={l.px} y1={l.py} x2={l.anchor === "start" ? l.x - 2 : l.x + 2} y2={l.y} stroke={c.hairline} strokeWidth={1} />
      ) : null}
      <text x={l.x} y={l.y} textAnchor={l.anchor} dominantBaseline="central" fill={labelFill(l.color)} {...LABEL_FONT}>
        {l.text}
      </text>
    </g>
  );
}

// ---- the chart -------------------------------------------------------------------------------------

interface Datum {
  sigma: number;
  mu: number;
  name: string;
}

interface Plot {
  line: Datum[];
  assets: FrontierAsset[];
  marks: FrontierMark[];
  bench: FrontierBench | null;
  cal: CalSegment | null;
}

const finite = (x: number) => Number.isFinite(x);

// The ready value, checked: infeasible frontier points dropped (the app drops its failed targets,
// 958-970), a tangency mark dropped when there is no line, and anything that is not a finite number
// refused by name, so NaN never reaches an axis or a label.
function checked(state: LoadState<FrontierData>): LoadState<Plot> {
  if (state.status !== "ready") return state;
  const d = state.value;
  const line = d.points.filter((p) => p.feasible && finite(p.sigma) && finite(p.target)).map((p) => ({ sigma: p.sigma, mu: p.target, name: "Efficient frontier" }));
  if (!line.length) return { status: "empty", reason: "No point on the frontier could be solved, so there is no frontier to draw." };
  const named: [string, number, number][] = [
    ...d.assets.map((a): [string, number, number] => [a.ticker, a.mu, a.sigma]),
    ...d.marks.map((m): [string, number, number] => [m.label, m.mu, m.sigma]),
    ...(d.bench ? [[d.bench.label, d.bench.mu, d.bench.sigma] as [string, number, number]] : []),
    ...(d.cal ? [["capital allocation line", d.cal.tangency.mu, d.cal.tangency.sigma] as [string, number, number], ["risk-free rate", d.cal.rf, 0] as [string, number, number]] : []),
  ];
  const bad = named.find(([, mu, sigma]) => !finite(mu) || !finite(sigma));
  if (bad) return { status: "error", name: `the ${bad[0]} point`, message: "Its return or volatility is not a finite number." };
  const sigMax = Math.max(...line.map((p) => p.sigma));
  return {
    status: "ready",
    value: {
      line,
      assets: [...d.assets],
      marks: d.marks.filter((m) => d.cal || m.role !== "tangency"),
      bench: d.bench,
      cal: d.cal ? calSegment(d.cal, sigMax) : null,
    },
  };
}

// Markers after the app's (1614-1645): GMV diamond, Tangency star, Equal-Weight square, Custom a
// triangle (Recharts has no hexagon), the benchmark a cross, assets small and translucent. Sizes are
// areas in px squared; the paper outline stands in for the app's white one.
type SymbolKind = "circle" | "cross" | "diamond" | "square" | "star" | "triangle";
const MARKER: Record<MarkRole, { type: SymbolKind; size: number }> = {
  gmv: { type: "diamond", size: 170 },
  tangency: { type: "star", size: 240 },
  ew: { type: "square", size: 110 },
  custom: { type: "triangle", size: 150 },
};

function marker(type: SymbolKind, size: number, color: string, opacity = 1) {
  return (p: { cx?: number; cy?: number }): ReactNode => (
    <Symbols cx={p.cx} cy={p.cy} type={type} size={size} fill={color} fillOpacity={opacity} stroke={c.paper} strokeWidth={1.5} />
  );
}

// The frontier line's points take hover without being seen.
function hitTarget(p: { cx?: number; cy?: number }): ReactNode {
  return <circle cx={p.cx} cy={p.cy} r={5} fill={c.paper} fillOpacity={0} />;
}

const pctTick = (v: number) => format(v, "pct1");

// Round-number ticks covering [lo, hi], about `count` steps of 1, 2, 2.5 or 5 times a power of ten.
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const raw = (hi - lo) / count || Math.abs(hi) / count || 0.01;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw * (1 - 1e-12)) ?? 10 * mag;
  const first = Math.floor(lo / step);
  const last = Math.ceil(hi / step);
  const out: number[] = [];
  // Each tick is an integer times the step, so no rounding error accumulates along the axis.
  for (let k = first; k <= last; k++) out.push(Number((k * step).toPrecision(12)));
  return out;
}

function PointTip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const p = active ? (payload?.[0]?.payload as Datum | undefined) : undefined;
  if (!p) return null;
  return (
    <div className="chart-tip" style={frontierTooltip.contentStyle}>
      <div className="chart-tip-name" style={frontierTooltip.labelStyle}>{p.name}</div>
      <div>Volatility {format(p.sigma, "pct2")}</div>
      <div>Return {format(p.mu, "pct2")}</div>
    </div>
  );
}

interface LabelItem {
  key: string;
  text: string;
  color: string;
  sigma: number;
  mu: number;
}

// Runs inside the chart, where the axes' scales are known, so names are placed in pixels.
function FrontierLabels({ items, cal }: { items: LabelItem[]; cal: CalSegment | null }) {
  const xs = useXAxisScale();
  const ys = useYAxisScale();
  const yDomain = useYAxisDomain();
  const plot = usePlotArea();
  if (!xs || !ys || !plot) return null;
  const all = [...items];
  if (cal) {
    // Name the line where it leaves the plot: its far end, or the top edge if it is clipped there.
    const top = Array.isArray(yDomain) && typeof yDomain[1] === "number" ? yDomain[1] : cal.y1;
    const x = cal.y1 > top && cal.slope > 0 ? (top - cal.y0) / cal.slope : cal.x1;
    all.push({ key: "cal", text: "Capital allocation line", color: ROLE.cal, sigma: x, mu: cal.y0 + cal.slope * x });
  }
  const at = all
    .map((it) => ({ ...it, px: xs(it.sigma) ?? NaN, py: ys(it.mu) ?? NaN }))
    .filter((it) => finite(it.px) && finite(it.py));
  return (
    <g className="frontier-labels">
      {placeLabels(at, plot).map((l) => (
        <LabelText key={l.key} l={l} />
      ))}
    </g>
  );
}

const MARGIN = { top: 12, right: 16, bottom: 30, left: 4 };
const FALLBACK_WIDTH = 720;

// Every asset is one neutral point, named beside it. The app colours assets by palette position (1639,
// 1802), so its fifth and ninth wear Equal-Weight's and Custom's colours; with five chromatic tokens every
// asset here would share a colour with a portfolio mark or the frontier line. The chromatic tokens are kept
// for those; the benchmark (an ink cross) and the CAL (a dashed ink2 line) share the neutral family, not the shape.
const ASSET = tokens.color.ink2;

function FrontierPlot({ plot, height }: { plot: Plot; height: number }) {
  const [ref, width] = useBoxWidth(FALLBACK_WIDTH);
  const { line, assets, marks, bench, cal } = plot;

  // Scaled to the points and the line's start at rf; the line is clipped where it leaves the plot.
  const sig = [...line.map((p) => p.sigma), ...assets.map((a) => a.sigma), ...marks.map((m) => m.sigma), ...(bench ? [bench.sigma] : [])];
  const mu = [...line.map((p) => p.mu), ...assets.map((a) => a.mu), ...marks.map((m) => m.mu), ...(bench ? [bench.mu] : []), ...(cal ? [cal.y0] : [])];
  const xTicks = niceTicks(0, Math.max(...sig, cal ? cal.x1 : 0));
  const yLo = Math.min(...mu);
  const yHi = Math.max(...mu);
  const pad = (yHi - yLo) * 0.04;
  const yTicks = niceTicks(yLo - pad, yHi + pad);

  const labels: LabelItem[] = [
    ...assets.map((a) => ({ key: `asset-${a.ticker}`, text: a.ticker, color: ASSET, sigma: a.sigma, mu: a.mu })),
    ...(bench ? [{ key: "bench", text: bench.label, color: ROLE.bench, sigma: bench.sigma, mu: bench.mu }] : []),
    ...marks.map((m) => ({ key: `mark-${m.role}`, text: m.label, color: ROLE[m.role], sigma: m.sigma, mu: m.mu })),
    { key: "frontier", text: "Efficient frontier", color: ROLE.frontier, sigma: line[line.length - 1].sigma, mu: line[line.length - 1].mu },
  ];
  const axisTitle = { fill: chartTheme.axis.fill, fontFamily: tokens.font.sans, fontSize: 12 };

  return (
    <div ref={ref} className="frontier-chart" style={{ width: "100%", height }}>
      <ScatterChart width={width} height={height} margin={MARGIN}>
        <CartesianGrid {...gridProps} />
        <XAxis
          type="number"
          dataKey="sigma"
          name="Volatility"
          domain={[xTicks[0], xTicks[xTicks.length - 1]]}
          ticks={xTicks}
          tickFormatter={pctTick}
          {...axisProps}
          label={{ value: "Annualized volatility", position: "insideBottom", offset: -18, ...axisTitle }}
        />
        <YAxis
          type="number"
          dataKey="mu"
          name="Return"
          domain={[yTicks[0], yTicks[yTicks.length - 1]]}
          ticks={yTicks}
          tickFormatter={pctTick}
          width={60}
          {...axisProps}
          label={{ value: "Annualized return", angle: -90, position: "insideLeft", offset: 12, ...axisTitle }}
        />
        <Tooltip {...frontierTooltip} content={PointTip} />
        {cal ? (
          <ReferenceLine
            className="frontier-cal"
            segment={[{ x: cal.x0, y: cal.y0 }, { x: cal.x1, y: cal.y1 }]}
            stroke={ROLE.cal}
            strokeDasharray={DASH.cal}
            strokeWidth={1.5}
            ifOverflow="hidden"
          />
        ) : null}
        <Scatter
          className="frontier-line"
          name="Efficient frontier"
          data={line}
          line={{ stroke: ROLE.frontier, strokeWidth: 3 }}
          lineJointType="linear"
          shape={hitTarget}
          isAnimationActive={false}
        />
        {assets.map((a) => (
          <Scatter
            key={a.ticker}
            className="frontier-asset"
            name={a.ticker}
            data={[{ sigma: a.sigma, mu: a.mu, name: a.ticker }]}
            shape={marker("circle", 56, ASSET, 0.8)}
            isAnimationActive={false}
          />
        ))}
        {bench ? (
          <Scatter
            className="frontier-bench"
            name={bench.label}
            data={[{ sigma: bench.sigma, mu: bench.mu, name: bench.label }]}
            shape={marker("cross", 110, ROLE.bench)}
            isAnimationActive={false}
          />
        ) : null}
        {marks.map((m) => (
          <Scatter
            key={m.role}
            className={`frontier-mark frontier-mark--${m.role}`}
            name={m.label}
            data={[{ sigma: m.sigma, mu: m.mu, name: m.label }]}
            shape={marker(MARKER[m.role].type, MARKER[m.role].size, ROLE[m.role])}
            isAnimationActive={false}
          />
        ))}
        <FrontierLabels items={labels} cal={cal} />
      </ScatterChart>
    </div>
  );
}

export default function Frontier({ title, state, allowShort, rf, height }: FrontierProps) {
  const phone = usePhone();
  const h = height ?? (phone ? 380 : 480);
  const plot = useMemo(() => checked(state), [state]);
  const cal = state.status === "ready" ? state.value.cal : undefined;
  return (
    <ChartFrame title={title} subtitle={frontierCaption(allowShort, rf, cal)} state={plot} height={h}>
      {(value) => <FrontierPlot plot={value} height={h} />}
    </ChartFrame>
  );
}
