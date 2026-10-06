// The Risk tab's three charts, drawn from the view-model in ./model.ts: the drawdown (1333-1348), the
// rolling volatility (1321-1328) and the CAPM betas (1396-1410). Each draws only a "ready" value
// inside a ChartFrame, so a chart is either whole or replaced by one named line.
//
// Points are labelled in the chart rather than in a legend: the drawdown's low, each volatility line
// at its end, each beta on its bar, and the market line at 1. Colours come from the tokens only.
//
// A name or value that cannot be set clear of the others is left off (volEndsDrawn, betaValueSpots in
// ./model.ts) and one line under the chart says how many; the hover box reads it, on a tap as on a
// pointer, and the arrow keys move the hover box along a focused chart.
import { memo, useCallback, useLayoutEffect, useMemo, useState } from "react";
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
  usePlotArea,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "../../format.ts";
import { axisProps, chartTheme, DASH, gridProps, seriesColor, tooltipProps } from "../../charts/theme.ts";
import { CULL_STYLE, cullNote, pointLabel } from "../../charts/labels.ts";
import { ReadableTip } from "../../charts/ReadableTip.tsx";
import { tokens } from "../../styles/tokens.ts";
import {
  betaValueSpots,
  endLabels,
  MARKET_NAME,
  pctTick,
  seriesKey,
  volEndsDrawn,
  yearOf,
  type BetaChart as BetaData,
  type BetaValueSpot,
  type DrawdownChart as DrawdownData,
  type VolChart as VolData,
} from "./model.ts";

const c = tokens.color;

// A tooltip value as a number, or null for anything else (Recharts hands over its ValueType).
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

// The plot's own height: the chart's minus the x axis and the top margin, for label spacing.
const AXIS_PX = 30;
const TOP_PX = 12;

/** The one line under a chart that left names or values off, or nothing. */
export function CullLine({ text }: { text: string | null }) {
  return text ? (
    <p className="chart-cull" style={CULL_STYLE}>
      {text}
    </p>
  ) : null;
}

/** The wording of that line for the volatility chart and the beta chart, from the count left off. A line's
 *  name is also left off for running out of the plot, so the volatility chart says "would not fit". */
export const volCull = (n: number) =>
  cullNote(n, ["line name", "line names"], ["hover or tap the chart to read every line by name", "hover or tap the chart to read every line by name"], [
    "would not fit",
    "would not fit",
  ]);
export const betaCull = (n: number) => cullNote(n, ["value", "values"], ["hover or tap its bar to read it", "hover or tap a bar to read its value"]);

/** The beta chart's hover box: each value named by its asset, so a value left off reads whole from it. */
export const betaTip = (v: unknown, _n: unknown, item?: { payload?: unknown }): [string, string] => {
  const name = (item?.payload as { name?: unknown } | undefined)?.name;
  return [format(num(v), "num3"), typeof name === "string" && name ? `${name} beta` : "Beta"];
};

// Each plot below is memo'd: it draws again when its data changes, not when the card around it renders
// for an explanation level.
export const DRAWDOWN_HEIGHT = 320;
export const VOL_HEIGHT = 360;
export const BETA_HEIGHT = 320;

// The drawdown of one asset, filled down to zero (fill="tozeroy", 1340-1343) in the market-down red,
// with its low marked and labelled. The first point is the first close: the amount invested.
export const DrawdownPlot = memo(function DrawdownPlot({ data, name }: { data: DrawdownData; name: string }) {
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
});

// One line per asset (px.line of the rolling frame, 1325), each named at its end, and the highest
// point any of them reached marked with its value.
export const VolPlot = memo(function VolPlot({ data }: { data: VolData }) {
  const plotPx = VOL_HEIGHT - AXIS_PX - TOP_PX;
  const ends = endLabels(data.last, data.yMax, plotPx);
  // The plot's box across does not matter here: every end name sits at the same x, right of the plot.
  const drawn = volEndsDrawn(ends, data.yMax, { x: 0, y: TOP_PX, width: 1, height: plotPx }, VOL_HEIGHT);
  const off = drawn.filter((d) => !d).length;
  const end = data.rows[data.rows.length - 1]?.date;
  const peak = data.peak;
  return (
    <>
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
          ? data.names.map((t, i) =>
              drawn[i] ? (
                <ReferenceDot key={`end-${t}`} x={end} y={ends[i]} r={0} ifOverflow="visible" label={pointLabel(t, seriesColor(i), "right")} />
              ) : null,
            )
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
    <CullLine text={volCull(off)} />
    </>
  );
});

// The CAPM betas as bars (1396-1410), each labelled with its value. Above the market line at 1 in
// claret, at or below it in navy: the app's danger red and secondary blue, moved onto the brand
// (market-down red is kept for falling prices).
export const BETA_ABOVE = c.claret;
export const BETA_BELOW = c.navy;

// Works out, inside the chart where the plot's box is known, where each bar's value goes, and hands it up.
function BetaSpots({ data, onSpots }: { data: BetaData; onSpots: (spots: readonly BetaValueSpot[]) => void }) {
  const plot = usePlotArea();
  const key = plot ? [plot.x, plot.y, plot.width, plot.height].join(",") : "";
  // The plot's box by what it measures (`key`), not by identity.
  const spots = useMemo(() => (plot ? betaValueSpots(data, plot) : null), [data, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (spots) onSpots(spots);
  }, [spots, onSpots]);
  return null;
}

// A bar's value where BetaSpots put it: past the bar's end in ink (where LabelList's "top" sets it: 5px
// over the end of a bar that points up, its baseline there; 5px under one that points down, its top
// there), inside the end in paper, or nowhere. The end is the bar box's y whichever way the bar points.
function betaValue(spots: readonly BetaValueSpot[] | null) {
  return function BetaValue(props: { viewBox?: unknown; value?: unknown; index?: number }) {
    const vb = (props.viewBox ?? {}) as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    // A value left off is null in `spots`; one with no entry (the plot not measured yet) is set past its bar.
    const i = props.index ?? -1;
    const spot = spots && i >= 0 && i < spots.length ? spots[i] : "past";
    const [x, y, w, h] = [vb.x, vb.y, vb.width, vb.height].map(Number);
    if (!spot || ![x, y, w, h].every(Number.isFinite)) return null;
    // Under the end: past a bar that points down, or inside one that points up.
    const under = spot === "past" ? h < 0 : h >= 0;
    return (
      <text
        className={spot === "inside" ? "beta-value beta-value--inside" : "beta-value"}
        x={x + w / 2}
        y={under ? y + 5 : y - 5}
        dy={under ? "0.71em" : "0em"}
        textAnchor="middle"
        fill={spot === "inside" ? c.paper : c.ink}
        fontFamily={tokens.font.mono}
        fontSize={11}
      >
        {format(num(props.value), "num3")}
      </text>
    );
  };
}

const sameSpots = (a: readonly BetaValueSpot[], b: readonly BetaValueSpot[]) => a.length === b.length && a.every((s, i) => s === b[i]);

export const BetaPlot = memo(function BetaPlot({ data }: { data: BetaData }) {
  // Until the plot's box is known every value is set past its bar, as LabelList sets it.
  const [spots, setSpots] = useState<readonly BetaValueSpot[] | null>(null);
  const onSpots = useCallback((next: readonly BetaValueSpot[]) => setSpots((was) => (was && sameSpots(was, next) ? was : next)), []);
  const live = spots && spots.length === data.bars.length ? spots : null;
  const off = live ? live.filter((s) => s === null).length : 0;
  const Value = useMemo(() => betaValue(live), [live]);
  return (
    <>
    <ResponsiveContainer width="100%" height={BETA_HEIGHT}>
      <BarChart data={data.bars} margin={{ top: 20, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" {...axisProps} interval={0} />
        <YAxis {...axisProps} domain={[data.yMin, data.yMax]} tickFormatter={(v: number) => format(v, "num2")} width={44} allowDataOverflow />
        <Tooltip {...tooltipProps()} content={ReadableTip} formatter={betaTip} />
        <ReferenceLine
          y={1}
          stroke={c.ink2}
          strokeDasharray={DASH.reference}
          label={{ ...pointLabel(MARKET_NAME, c.ink2, "top"), position: "insideTopRight" }}
        />
        <Bar dataKey="beta" name="Beta" isAnimationActive={false} maxBarSize={56}>
          {data.bars.map((b) => (
            <Cell key={b.name} fill={b.above ? BETA_ABOVE : BETA_BELOW} />
          ))}
          <LabelList dataKey="beta" position="top" content={Value} />
        </Bar>
        <BetaSpots data={data} onSpots={onSpots} />
      </BarChart>
    </ResponsiveContainer>
    <CullLine text={betaCull(off)} />
    </>
  );
});
