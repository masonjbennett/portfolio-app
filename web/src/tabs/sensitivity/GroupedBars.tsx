// A grouped bar chart with its series named ON the chart: each series' name is written up the side
// of its bar in one group (the one with the most room above it, labelLayout in ./model.ts), in the
// series' own colour (ink2 for bronze, too light to read as text: src/charts/contrast.ts), instead of a
// legend the eye has to travel to. The app draws both tab-6 charts as plotly grouped bars with a
// legend (1940-1943, 2014-2019).
//
// Hover names the one bar under the pointer (closest point, src/charts/theme.ts).
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { labelFill } from "../../charts/contrast.ts";
import { ReadableTip } from "../../charts/ReadableTip.tsx";
import { axisProps, gridProps, tooltipProps } from "../../charts/theme.ts";
import { tokens } from "../../styles/tokens.ts";
import { format } from "../../format.ts";
import type { FormatId } from "../../types.ts";
import { labelLayout, niceTicks, tickText, type Group } from "./model.ts";

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

export default function GroupedBars({ groups, series, valueFormat, axis, height }: GroupedBarsProps) {
  const plotPx = height - MARGIN.top - MARGIN.bottom - X_AXIS_PX;
  const { host, lo, hi } = labelLayout(groups, labelPx(series), plotPx);
  const { ticks, decimals } = niceTicks(lo, hi, axis === "pct" ? 100 : 1);
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

  const nameOn = (s: Series) =>
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
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 640, height }}>
      <BarChart data={data} margin={MARGIN} barCategoryGap="16%" barGap={1}>
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
            <LabelList valueAccessor={(e) => (e.payload?.name === hostName ? s.label : "")} content={nameOn(s)} />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
