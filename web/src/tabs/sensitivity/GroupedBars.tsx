// A grouped bar chart with its series named ON the chart: each series' name is written up the side
// of its bar in one group (the one with the most room above it, labelLayout in ./model.ts), in the
// series' own colour (ink2 for bronze, too light to read as text: src/charts/contrast.ts), instead of a
// legend the eye has to travel to. The app draws both tab-6 charts as plotly grouped bars with a
// legend (1940-1943, 2014-2019).
//
// Hover names the one bar under the pointer (closest point, src/charts/theme.ts).
//
// A name that cannot be set clear of the other names and bars (namesDrawn in ./model.ts) is left off,
// and one line under the chart says how many; the hover box reads the bar, on a tap as on a pointer,
// and from the keyboard each name left off is a stop that draws it while it has focus (NameOff).
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, usePlotArea, XAxis, YAxis } from "recharts";
import { CULL_STYLE, cullNote } from "../../charts/labels.ts";
import { labelFill } from "../../charts/contrast.ts";
import { ReadableTip } from "../../charts/ReadableTip.tsx";
import { axisProps, gridProps, tooltipProps } from "../../charts/theme.ts";
import { tokens } from "../../styles/tokens.ts";
import { format } from "../../format.ts";
import type { FormatId } from "../../types.ts";
import { BAR_SPACING, labelLayout, namesDrawn, niceTicks, tickText, type Group } from "./model.ts";

export interface Series {
  /** The name in the hover box. */
  name: string;
  /** The name written on the bar. */
  label: string;
  /** A token colour. */
  color: string;
  /** 0-1; one hue at rising opacity reads as an ordered series (the windows, shortest to longest). */
  opacity?: number;
}

export interface GroupedBarsProps {
  groups: Group[];
  series: Series[];
  /** How a value prints in the hover box. */
  valueFormat: FormatId;
  /** The y axis: percents (weights) or plain numbers (Sharpe ratios). */
  axis: "pct" | "num";
  height: number;
}

const MARGIN = { top: 12, right: 8, bottom: 4, left: 4 };
const X_AXIS_PX = 30;
const FONT_PX = 11;
// Rotated text runs up the bar: its length in pixels is roughly 0.62 em per character at 11px.
const labelPx = (series: Series[]) => Math.max(...series.map((s) => s.label.length)) * FONT_PX * 0.62 + 10;

// What a LabelList hands its content: the bar's box, directly or as viewBox (recharts 3 does both).
interface LabelBox {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  value?: unknown;
  viewBox?: unknown;
}
type Box = { x?: unknown; y?: unknown; width?: unknown; height?: unknown };

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** The line under the chart when names are left off, from the count. */
export const namesCull = (n: number) => cullNote(n, ["bar name", "bar names"], ["hover or tap a bar to read its name", "hover or tap a bar to read its name"]);

// A name left off, for the keyboard: a stop in the tab order that names its bar to a screen reader and,
// while it has focus, draws the name where it would have run, over whatever is there, as a hover box
// would. Its state is its own, so focusing it redraws nothing else.
function NameOff({ label, color, cx, top }: { label: string; color: string; cx: number; top: number }) {
  const [on, setOn] = useState(false);
  return (
    <g className="gbars-name-off" tabIndex={0} role="img" aria-label={label} onFocus={() => setOn(true)} onBlur={() => setOn(false)}>
      {on ? (
        <text
          x={cx}
          y={top}
          transform={`rotate(-90 ${cx} ${top})`}
          dominantBaseline="central"
          textAnchor="start"
          fill={labelFill(color)}
          fontFamily={tokens.font.sans}
          fontSize={FONT_PX}
          pointerEvents="none"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

// Works out, inside the chart where the plot's box is known, which names are drawn, and hands it up.
function NameSpots({ groups, host, labels, lo, hi, onDrawn }: {
  groups: Group[];
  host: number;
  labels: readonly string[];
  lo: number;
  hi: number;
  onDrawn: (drawn: readonly boolean[]) => void;
}) {
  const plot = usePlotArea();
  const key = plot ? [plot.x, plot.y, plot.width, plot.height].join(",") : "";
  // The plot's box by what it measures (`key`), not by identity.
  const drawn = useMemo(() => (plot ? namesDrawn(groups, host, labels, plot, lo, hi, FONT_PX) : null), [groups, host, labels, lo, hi, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (drawn) onDrawn(drawn);
  }, [drawn, onDrawn]);
  return null;
}

export default function GroupedBars({ groups, series, valueFormat, axis, height }: GroupedBarsProps) {
  const plotPx = height - MARGIN.top - MARGIN.bottom - X_AXIS_PX;
  const { host, lo, hi } = labelLayout(groups, labelPx(series), plotPx);
  const { ticks, decimals } = niceTicks(lo, hi, axis === "pct" ? 100 : 1);
  const labels = useMemo(() => series.map((s) => s.label), [series]);
  // Until the plot's box is known every name is drawn.
  const [drawn, setDrawn] = useState<readonly boolean[] | null>(null);
  const onDrawn = useCallback((next: readonly boolean[]) => setDrawn((was) => (was && was.join() === next.join() ? was : next)), []);
  const live = drawn && drawn.length === series.length ? drawn : null;
  const off = live ? live.filter((d) => !d).length : 0;
  const data = groups.map((g) => {
    const row: Record<string, string | number | null> = { name: g.name };
    g.values.forEach((v, i) => (row[`s${i}`] = v));
    return row;
  });

  // Recharts draws no bar, and so no label, for a value under a pixel (a weight of 0, or the 1e-17 an
  // exact solve leaves). In the label group only, such a bar is drawn 1px tall on the zero line, to
  // carry its series' name; everywhere else every value is drawn as it is.
  const hostFloor = (_v: number | null | undefined, i: number) => (i === host ? 1 : 0);
  // The label group by NAME: a LabelList's index counts only the bars drawn, not the data rows.
  const hostName = groups[host]?.name;

  const nameOn = (s: Series, k: number) =>
    function SeriesName(props: LabelBox) {
      // valueAccessor below hands the name only to the label group's bar, "" to every other.
      if (props.value !== s.label) return null;
      const vb = (props.viewBox ?? {}) as Box;
      const x = num(vb.x ?? props.x);
      const y = num(vb.y ?? props.y);
      const w = num(vb.width ?? props.width);
      const h = num(vb.height ?? props.height);
      if (![x, y, w, h].every(Number.isFinite)) return null;
      // The top edge of the bar whichever way it points; the text starts 4px above it.
      const top = Math.min(y, y + h) - 4;
      const cx = x + w / 2;
      if (live && !live[k]) return <NameOff label={s.label} color={s.color} cx={cx} top={top} />;
      return (
        <text
          x={cx}
          y={top}
          transform={`rotate(-90 ${cx} ${top})`}
          dominantBaseline="central"
          textAnchor="start"
          fill={labelFill(s.color)}
          fontFamily={tokens.font.sans}
          fontSize={FONT_PX}
          className="gbars-name"
        >
          {s.label}
        </text>
      );
    };

  return (
    <>
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 640, height }}>
      <BarChart data={data} margin={MARGIN} barCategoryGap={`${BAR_SPACING.categoryGap * 100}%`} barGap={BAR_SPACING.barGap}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" {...axisProps} height={X_AXIS_PX} interval={0} />
        <YAxis
          {...axisProps}
          domain={[ticks[0], ticks[ticks.length - 1]]}
          ticks={ticks}
          interval={0}
          tickFormatter={(v: number) => tickText(v, axis, decimals)}
          width={52}
        />
        <ReferenceLine y={0} stroke={tokens.color.ink2} strokeWidth={1} />
        <Tooltip {...tooltipProps()} content={ReadableTip} formatter={(v) => format(typeof v === "number" ? v : null, valueFormat)} />
        {series.map((s, i) => (
          <Bar
            key={s.name}
            dataKey={`s${i}`}
            name={s.name}
            fill={s.color}
            fillOpacity={s.opacity ?? 1}
            // A faded fill alone falls under 3:1 on paper (1.4:1 for bronze at 30%); the edge is drawn at
            // the token's full colour so every bar meets it, and the fill ramp still orders the windows.
            stroke={s.color}
            strokeWidth={1}
            isAnimationActive={false}
            minPointSize={hostFloor}
          >
            <LabelList valueAccessor={(e) => (e.payload?.name === hostName ? s.label : "")} content={nameOn(s, i)} />
          </Bar>
        ))}
        <NameSpots groups={groups} host={host} labels={labels} lo={ticks[0]} hi={ticks[ticks.length - 1]} onDrawn={onDrawn} />
      </BarChart>
    </ResponsiveContainer>
    {off ? (
      <p className="chart-cull" style={CULL_STYLE}>
        {namesCull(off)}
      </p>
    ) : null}
    </>
  );
}
