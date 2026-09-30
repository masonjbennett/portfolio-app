// Cumulative wealth: what the starting amount became in each portfolio and in the benchmark, with each
// line NAMED AT ITS END instead of in a legend. Shared by the Optimization tab (portfolio_app.py
// 1660-1674) and the Custom tab (1823-1837), which differ only in the custom weights they pass.
//
// Where it departs from the app, on purpose:
// - The first point is the amount invested, on the first price date. The app plots
//   (1 + r).cumprod() * W0 (1667, 1831), whose first point is already W0 * (1 + r1), a day in.
// - The caption says what is plotted: fixed weights, rebalanced daily to the target weights (R @ w,
//   1661-1665). The app plotted exactly that and said nothing about it.
// - Hover compares every line at one date (a shared x, the one chart family where that is the point).
import { memo, useMemo, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis, usePlotArea, useYAxisScale } from "recharts";
import { usePhone } from "../chrome/usePhone.ts";
import ChartFrame from "../components/ChartFrame.tsx";
import AmountField from "./AmountField.tsx";
import { format } from "../format.ts";
import type { Vec } from "../lib/num.ts";
import { portfolioReturns } from "../lib/portfolio.ts";
import { wealth } from "../lib/stats.ts";
import { tokens } from "../styles/tokens.ts";
import type { Analysis, LoadState } from "../types.ts";
import { labelFill } from "./contrast.ts";
import { CHAR_PX, LabelText, useBoxWidth, type PlacedLabel } from "./Frontier.tsx";
import { spreadLabels } from "./labels.ts";
import { axisProps, gridProps, ROLE, tooltipProps, type Hover } from "./theme.ts";

const c = tokens.color;

// ---- props ---------------------------------------------------------------------------------------

/** Which line: sets its colour. */
export type WealthRole = "ew" | "gmv" | "tangency" | "custom" | "bench";

/** One line: a portfolio's (or the benchmark's) DAILY simple returns, aligned with WealthData.dates. */
export interface WealthSeries {
  /** The name drawn at the line's end, e.g. "GMV" or "S&P 500". */
  label: string;
  role: WealthRole;
  returns: readonly number[];
}

export interface WealthData {
  /** The day the amount is invested: the first price date, one before the first return. */
  start: string;
  /** The return dates, ISO (Analysis.dates). */
  dates: readonly string[];
  /** The lines, drawn in this order. */
  series: readonly WealthSeries[];
}

export interface WealthProps {
  /** One sentence stating the finding. */
  title: string;
  /** The lines' data state; only "ready" draws. */
  state: LoadState<WealthData>;
  /** The starting dollar amount (Settings.amount). */
  amount: number;
  /** Height in px; 400 on a desktop and 320 on a phone when left out. */
  height?: number;
  /** Set the starting amount from the chart's own field; without it the chart shows no field. */
  onAmount?: (next: number) => void;
}

// ---- pure helpers --------------------------------------------------------------------------------

/** The wealth chart's hover: every line at the hovered date. */
export const WEALTH_HOVER: Hover = "x";

/** The tooltip props the wealth chart spreads onto its <Tooltip>. */
export const wealthTooltip = tooltipProps(WEALTH_HOVER);

/**
 * The lines for one analysis in the app's order (1661-1665): Equal-Weight, GMV, Tangency, Custom,
 * then the benchmark. A portfolio whose solve failed is left out, never replaced. `custom` is the
 * normalised custom weights, or null to leave that line off.
 */
export function wealthData(a: Analysis, custom: Vec | null = null): WealthData {
  const series: WealthSeries[] = [{ label: "Equal-Weight", role: "ew", returns: portfolioReturns(a.returns, a.ew) }];
  if (a.gmv) series.push({ label: "GMV", role: "gmv", returns: portfolioReturns(a.returns, a.gmv.w) });
  if (a.tangency) series.push({ label: "Tangency", role: "tangency", returns: portfolioReturns(a.returns, a.tangency.w) });
  if (custom) series.push({ label: "Custom", role: "custom", returns: portfolioReturns(a.returns, custom) });
  series.push({ label: a.benchLabel, role: "bench", returns: a.bench });
  return { start: a.prices.dates[0], dates: a.dates, series };
}

/**
 * The caption under the wealth chart's title. `fitted` names the lines whose weights an optimiser chose
 * from the same prices the chart then runs them over (GMV and Tangency): their growth is hypothetical,
 * and the caption says so in those words. Equal weights, a custom mix and the benchmark chose nothing.
 */
export function wealthCaption(amount: number, start?: string, end?: string, fitted: readonly string[] = []): string {
  const span = start && end ? ` from ${format(start, "date")} to ${format(end, "date")}` : "";
  const base = `Growth of ${format(amount, "usd0")}${span}. Each portfolio is rebalanced daily to the target weights.`;
  if (!fitted.length) return base;
  const names = fitted.length === 1 ? `${fitted[0]} is` : `${fitted.slice(0, -1).join(", ")} and ${fitted[fitted.length - 1]} are`;
  return `${base} ${names} hypothetical: weights chosen with the whole period's prices.`;
}

/** The lines whose weights were chosen with the chart's own prices, in series order. */
export function fittedLines(series: readonly WealthSeries[]): string[] {
  return series.filter((s) => s.role === "gmv" || s.role === "tangency").map((s) => s.label);
}

/** One chart row: the date, then each line's value under `s0`, `s1`, ... in series order. */
export type WealthRow = { date: string } & Record<string, number | string>;

/** What the chart draws: the rows, and each line's key, name, role and last value. */
export interface WealthPlot {
  rows: WealthRow[];
  lines: { key: string; label: string; role: WealthRole; end: number }[];
}

/**
 * The ready value, checked: every line as long as the dates and finite throughout, and a positive
 * amount, or the chart is refused by name. Each line starts at `amount` on `start` (wealth() prepends
 * it). Keys are positional (s0, s1, ...) because Recharts reads a dotted dataKey as a path, and a
 * benchmark name may carry a dot.
 */
export function wealthPlot(state: LoadState<WealthData>, amount: number): LoadState<WealthPlot> {
  if (state.status !== "ready") return state;
  const { start, dates, series } = state.value;
  if (!(Number.isFinite(amount) && amount > 0)) return { status: "error", name: "the starting amount", message: "It is not a positive number." };
  if (!series.length) return { status: "empty", reason: "There is no portfolio to plot." };
  if (!dates.length) return { status: "empty", reason: "There are no return dates to plot." };
  const paths: number[][] = [];
  for (const s of series) {
    if (s.returns.length !== dates.length) return { status: "error", name: `the ${s.label} line`, message: "Its daily returns do not line up with the dates." };
    const w = wealth(s.returns as number[], amount);
    if (!w.every(Number.isFinite)) return { status: "error", name: `the ${s.label} line`, message: "Its daily returns are not all finite numbers." };
    paths.push(w);
  }
  const all = [start, ...dates];
  const rows = all.map((date, t) => {
    const row: WealthRow = { date };
    paths.forEach((p, k) => (row[`s${k}`] = p[t]));
    return row;
  });
  const lines = series.map((s, k) => ({ key: `s${k}`, label: s.label, role: s.role, end: paths[k][paths[k].length - 1] }));
  return { status: "ready", value: { rows, lines } };
}

// January's first trading day of each year, at most eight of them, as the date ticks.
function yearTicks(dates: readonly string[]): string[] {
  const firsts: string[] = [];
  for (let i = 1; i < dates.length; i++) if (dates[i].slice(0, 4) !== dates[i - 1].slice(0, 4)) firsts.push(dates[i]);
  const step = Math.ceil(firsts.length / 8) || 1;
  return firsts.filter((_, i) => i % step === 0);
}

const usdTick = (v: number) => format(v, "usd0");
const yearOf = (d: string) => d.slice(0, 4);

/** The hover box: the date, then each line's value in its colour (ink2 for bronze, ./contrast.ts). */
export function DateTip({ active, payload, label }: { active?: boolean; payload?: ReadonlyArray<{ name?: unknown; value?: unknown; color?: string }>; label?: unknown }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip" style={wealthTooltip.contentStyle}>
      <div className="chart-tip-name" style={wealthTooltip.labelStyle}>{format(String(label), "date")}</div>
      {payload.map((p) => (
        <div key={String(p.name)} style={{ color: p.color ? labelFill(p.color) : undefined }}>
          {String(p.name)} {typeof p.value === "number" ? format(p.value, "usd0") : format(null, "usd0")}
        </div>
      ))}
    </div>
  );
}

// Each line's name at its last value, just right of the plot, moved apart where they would collide.
function EndLabels({ lines, withValue }: { lines: WealthPlot["lines"]; withValue: boolean }) {
  const ys = useYAxisScale();
  const plot = usePlotArea();
  if (!ys || !plot) return null;
  const at = lines.map((l) => ys(l.end) ?? NaN);
  if (!at.every(Number.isFinite)) return null;
  const spread = spreadLabels(at, 15);
  const x = plot.x + plot.width + 8;
  const placed: PlacedLabel[] = lines.map((l, k) => {
    const text = withValue ? `${l.label} ${format(l.end, "usd0")}` : l.label;
    return { key: l.key, text, color: ROLE[l.role], x, y: spread[k], px: plot.x + plot.width, py: at[k], anchor: "start", width: text.length * CHAR_PX };
  });
  return (
    <g className="wealth-labels">
      {placed.map((l) => (
        <LabelText key={l.key} l={l} />
      ))}
    </g>
  );
}

const FALLBACK_WIDTH = 720;

// Drawn again only when the plot (the lines, which carry the amount), the height or its own measured
// width changes (memo): an explanation level, or a card around it rendering again, does not redraw it.
const WealthLines = memo(function WealthLines({ plot, height }: { plot: WealthPlot; height: number }): ReactNode {
  const [ref, width] = useBoxWidth(FALLBACK_WIDTH);
  // The value rides beside the name when there is room for it; the tooltip always has it.
  const withValue = width >= 560;
  const longest = Math.max(...plot.lines.map((l) => (withValue ? `${l.label} ${format(l.end, "usd0")}` : l.label).length));
  const right = 14 + longest * CHAR_PX;
  const ticks = yearTicks(plot.rows.map((r) => r.date));
  return (
    <div ref={ref} className="wealth-chart" style={{ width: "100%", height }}>
      <LineChart width={width} height={height} data={plot.rows} margin={{ top: 12, right, bottom: 8, left: 4 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" ticks={ticks} interval={0} tickFormatter={yearOf} {...axisProps} />
        <YAxis domain={["auto", "auto"]} tickFormatter={usdTick} width={72} {...axisProps} />
        <Tooltip {...wealthTooltip} content={DateTip} />
        {plot.lines.map((l) => (
          <Line
            key={l.key}
            className={`wealth-line wealth-line--${l.role}`}
            type="linear"
            dataKey={l.key}
            name={l.label}
            stroke={ROLE[l.role]}
            strokeWidth={l.role === "bench" ? 1.5 : 2}
            dot={false}
            activeDot={{ r: 3, stroke: c.paper, strokeWidth: 1 }}
            isAnimationActive={false}
          />
        ))}
        <EndLabels lines={plot.lines} withValue={withValue} />
      </LineChart>
    </div>
  );
});

export default function Wealth({ title, state, amount, height, onAmount }: WealthProps) {
  const phone = usePhone();
  const h = height ?? (phone ? 320 : 400);
  const plot = useMemo(() => wealthPlot(state, amount), [state, amount]);
  const span = state.status === "ready" && state.value.dates.length ? state.value : null;
  const fitted = state.status === "ready" ? fittedLines(state.value.series) : [];
  return (
    <ChartFrame
      title={title}
      subtitle={wealthCaption(amount, span?.start, span ? span.dates[span.dates.length - 1] : undefined, fitted)}
      state={plot}
      height={h}
      control={onAmount ? <AmountField amount={amount} onAmount={onAmount} /> : undefined}
    >
      {(value) => <WealthLines plot={value} height={h} />}
    </ChartFrame>
  );
}
