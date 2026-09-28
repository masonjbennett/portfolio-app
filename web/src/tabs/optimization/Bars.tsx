// The tab's two grouped bar charts, weights (1534-1541) and risk contribution (1561-1572), with each
// series NAMED ON THE CHART: its name runs up one of its bars, in the group with the most room above
// it (barLayout in ./model.ts), in the series' own colour (ink2 for bronze, which is too light to read
// as text: src/charts/contrast.ts). The app draws both as plotly grouped bars with a legend. Hover
// names the one bar under the pointer (closest point, src/charts/theme.ts).
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { niceTicks } from "../../charts/Frontier.tsx";
import { labelFill } from "../../charts/contrast.ts";
import { ReadableTip } from "../../charts/ReadableTip.tsx";
import { axisProps, gridProps, ROLE, tooltipProps } from "../../charts/theme.ts";
import { format, MINUS } from "../../format.ts";
import { tokens } from "../../styles/tokens.ts";
import { barLayout, type Bars as BarsData, type BarSeries } from "./model.ts";

const MARGIN = { top: 12, right: 8, bottom: 4, left: 4 };
const X_AXIS_PX = 30;
const FONT_PX = 11;
// Rotated text runs up the bar: roughly 0.62 em per character at 11px, and 10px of air.
const labelPx = (series: readonly BarSeries[]) => Math.max(...series.map((s) => s.label.length)) * FONT_PX * 0.62 + 10;

/** An axis tick: a percent with a true minus, whole where every tick is whole. */
export function pctTick(v: number, decimals: number): string {
  const s = Math.abs(v * 100).toFixed(decimals);
  return `${v < 0 && /[1-9]/.test(s) ? MINUS : ""}${s}%`;
}

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

export default function Bars({ data, height }: { data: BarsData; height: number }) {
  const { groups, series } = data;
  const plotPx = height - MARGIN.top - MARGIN.bottom - X_AXIS_PX;
  const { host, lo, hi } = barLayout(groups, labelPx(series), plotPx);
  const ticks = niceTicks(lo, hi, 5);
  const decimals = ticks.every((t) => Math.abs(t * 100 - Math.round(t * 100)) < 1e-9) ? 0 : 1;
  const rows = groups.map((g) => {
    const row: Record<string, string | number | null> = { name: g.name };
    g.values.forEach((v, i) => (row[`s${i}`] = v));
    return row;
  });
  // Recharts draws no bar, and so no label, for a value under a pixel (a weight of 0). In the label
  // group only, such a bar is drawn 1px tall on the zero line to carry its series' name.
  const hostFloor = (_v: number | null | undefined, i: number) => (i === host ? 1 : 0);
  const hostName = groups[host]?.name;

  const nameOn = (s: BarSeries, color: string) =>
    function SeriesName(props: LabelBox) {
      if (props.value !== s.label) return null;
      const vb = (props.viewBox ?? {}) as Box;
      const x = num(vb.x ?? props.x);
      const y = num(vb.y ?? props.y);
      const w = num(vb.width ?? props.width);
      const h = num(vb.height ?? props.height);
      if (![x, y, w, h].every(Number.isFinite)) return null;
      const top = Math.min(y, y + h) - 4;
      const cx = x + w / 2;
      return (
        <text
          x={cx}
          y={top}
          transform={`rotate(-90 ${cx} ${top})`}
          dominantBaseline="central"
          textAnchor="start"
          fill={labelFill(color)}
          fontFamily={tokens.font.sans}
          fontSize={FONT_PX}
          className="opt-bar-name"
        >
          {s.label}
        </text>
      );
    };

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 640, height }}>
      <BarChart data={rows} margin={MARGIN} barCategoryGap="16%" barGap={1}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" {...axisProps} height={X_AXIS_PX} interval={0} />
        <YAxis
          {...axisProps}
          domain={[ticks[0], ticks[ticks.length - 1]]}
          ticks={ticks}
          interval={0}
          tickFormatter={(v: number) => pctTick(v, decimals)}
          width={52}
        />
        <ReferenceLine y={0} stroke={tokens.color.ink2} strokeWidth={1} />
        <Tooltip {...tooltipProps()} content={ReadableTip} formatter={(v) => format(typeof v === "number" ? v : null, "pct2")} />
        {series.map((s, i) => (
          <Bar key={s.label} dataKey={`s${i}`} name={s.label} fill={ROLE[s.role]} isAnimationActive={false} minPointSize={hostFloor}>
            <LabelList valueAccessor={(e) => (e.payload?.name === hostName ? s.label : "")} content={nameOn(s, ROLE[s.role])} />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
