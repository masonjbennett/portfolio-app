// The Risk tab's three charts, drawn from the view-model in ./model.ts: the drawdown (1333-1348), the
// rolling volatility (1321-1328) and the CAPM betas (1396-1410). Each draws only a "ready" value
// inside a ChartFrame, so a chart is either whole or replaced by one named line.
//
// Points are labelled in the chart rather than in a legend: the drawdown's low, each volatility line
// at its end, each beta on its bar, and the market line at 1. Colours come from the tokens only.
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "../../format.ts";
import { axisProps, chartTheme, DASH, gridProps, seriesColor, tooltipProps } from "../../charts/theme.ts";
import { pointLabel } from "../../charts/labels.ts";
import { ReadableTip } from "../../charts/ReadableTip.tsx";
import { tokens } from "../../styles/tokens.ts";
import { endLabels, pctTick, seriesKey, yearOf, type BetaChart as BetaData, type DrawdownChart as DrawdownData, type VolChart as VolData } from "./model.ts";

const c = tokens.color;

// A tooltip value as a number, or null for anything else (Recharts hands over its ValueType).
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

// The plot's own height: the chart's minus the x axis and the top margin, for label spacing.
const AXIS_PX = 30;
const TOP_PX = 12;

export const DRAWDOWN_HEIGHT = 320;
export const VOL_HEIGHT = 360;
export const BETA_HEIGHT = 320;

// The drawdown of one asset, filled down to zero (fill="tozeroy", 1340-1343) in the market-down red,
// with its low marked and labelled. The first point is the first close: the amount invested.
export function DrawdownPlot({ data, name }: { data: DrawdownData; name: string }) {
  const low = data.low;
  return (
    <ResponsiveContainer width="100%" height={DRAWDOWN_HEIGHT}>
      <AreaChart data={data.rows} margin={{ top: TOP_PX, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" {...axisProps} ticks={data.ticks} tickFormatter={yearOf} interval="preserveStartEnd" minTickGap={16} />
        <YAxis {...axisProps} domain={[data.yMin, 0]} tickFormatter={pctTick} width={48} allowDataOverflow />
        <Tooltip
          {...tooltipProps("x")}
          content={ReadableTip}
          formatter={(v) => [format(num(v), "pct2"), `${name} drawdown`]}
        />
        <Area
          type="linear"
          dataKey="dd"
          name={`${name} drawdown`}
          stroke={chartTheme.down}
          strokeWidth={1.2}
          fill={chartTheme.down}
          fillOpacity={0.15}
          baseValue={0}
          dot={false}
          activeDot={{ r: 3, fill: chartTheme.down, stroke: c.paper }}
          isAnimationActive={false}
        />
        {low.value < 0 ? (
          <ReferenceDot
            x={low.date}
            y={low.value}
            r={3}
            fill={chartTheme.down}
            stroke={c.paper}
            label={pointLabel(`${format(low.value, "pct2")} on ${low.date}`, c.ink, low.late ? "left" : "right")}
          />
        ) : null}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// One line per asset (px.line of the rolling frame, 1325), each named at its end, and the highest
// point any of them reached marked with its value.
export function VolPlot({ data }: { data: VolData }) {
  const plotPx = VOL_HEIGHT - AXIS_PX - TOP_PX;
  const ends = endLabels(data.last, data.yMax, plotPx);
  const end = data.rows[data.rows.length - 1]?.date;
  const peak = data.peak;
  return (
    <ResponsiveContainer width="100%" height={VOL_HEIGHT}>
      <LineChart data={data.rows} margin={{ top: TOP_PX, right: 64, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="date" {...axisProps} ticks={data.ticks} tickFormatter={yearOf} interval="preserveStartEnd" minTickGap={16} />
        <YAxis {...axisProps} domain={[0, data.yMax]} tickFormatter={pctTick} width={48} allowDataOverflow />
        <Tooltip {...tooltipProps("x")} content={ReadableTip} formatter={(v, n) => [format(num(v), "pct2"), String(n)]} />
        {data.names.map((t, i) => (
          <Line
            key={t}
            type="linear"
            dataKey={seriesKey(i)}
            name={t}
            stroke={seriesColor(i)}
            strokeWidth={1.25}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
        {end
          ? data.names.map((t, i) => (
              <ReferenceDot key={`end-${t}`} x={end} y={ends[i]} r={0} ifOverflow="visible" label={pointLabel(t, seriesColor(i), "right")} />
            ))
          : null}
        <ReferenceDot
          x={peak.date}
          y={peak.value}
          r={3}
          fill={seriesColor(peak.index)}
          stroke={c.paper}
          label={pointLabel(format(peak.value, "pct1"), seriesColor(peak.index), peak.late ? "left" : "right")}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// The CAPM betas as bars (1396-1410), each labelled with its value. Above the market line at 1 in
// claret, at or below it in navy: the app's danger red and secondary blue, moved onto the brand
// (market-down red is kept for falling prices).
export const BETA_ABOVE = c.claret;
export const BETA_BELOW = c.navy;

export function BetaPlot({ data }: { data: BetaData }) {
  return (
    <ResponsiveContainer width="100%" height={BETA_HEIGHT}>
      <BarChart data={data.bars} margin={{ top: 20, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" {...axisProps} interval={0} />
        <YAxis {...axisProps} domain={[data.yMin, data.yMax]} tickFormatter={(v: number) => format(v, "num2")} width={44} allowDataOverflow />
        <Tooltip {...tooltipProps()} content={ReadableTip} formatter={(v) => [format(num(v), "num3"), "Beta"]} />
        <ReferenceLine
          y={1}
          stroke={c.ink2}
          strokeDasharray={DASH.reference}
          label={{ ...pointLabel("Market (β = 1)", c.ink2, "top"), position: "insideTopRight" }}
        />
        <Bar dataKey="beta" name="Beta" isAnimationActive={false} maxBarSize={56}>
          {data.bars.map((b) => (
            <Cell key={b.name} fill={b.above ? BETA_ABOVE : BETA_BELOW} />
          ))}
          <LabelList
            dataKey="beta"
            position="top"
            formatter={(v: unknown) => format(num(v), "num3")}
            fill={c.ink}
            fontFamily={tokens.font.mono}
            fontSize={11}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
