// C1, the growth of the starting amount in each line (1257-1266), drawn with Recharts at the column's
// real width. Each line is named at its end, in its own colour, instead of in a legend; labels that
// would collide are moved apart (spreadLabels). On a narrow screen there is no room at the right
// for names, and the swatched toggles above the chart name the lines instead.
import { CartesianGrid, Line as Curve, LineChart, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { useMemo } from "react";
import { axisProps, DASH, gridProps, tooltipProps } from "../../charts/theme.ts";
import { pointLabel, spreadLabels } from "../../charts/labels.ts";
import { ReadableTip } from "../../charts/ReadableTip.tsx";
import { format } from "../../format.ts";
import { tokens } from "../../styles/tokens.ts";
import { extent, niceTicks, tickText, yearTicks, type Growth, type GrowthLine } from "./model.ts";

const X_AXIS_H = 24;
const MARGIN = { top: 12, bottom: 4, left: 4 } as const;
const LABEL_GAP = 15; // px between two end labels' baselines
const WIDE = 560; // below this the names go in the toggles, not at the line ends

export interface GrowthChartProps {
  growth: Growth;
  lines: GrowthLine[];
  width: number;
  height: number;
}

// The end labels' vertical positions, in data units: each line's last value, spread so no two sit
// closer than LABEL_GAP pixels on a plot `plotH` pixels tall spanning [lo, hi], then kept inside
// the plot: a crowd of lines ending near the bottom (seven stocks beside one that grew 60-fold)
// would otherwise be spread down onto the date axis.
export function endLabelValues(ends: readonly number[], lo: number, hi: number, plotH: number): number[] {
  const px = spreadLabels(ends.map((v) => ((hi - v) / (hi - lo)) * plotH), LABEL_GAP);
  const down = px.map((_, i) => i).sort((i, j) => px[j] - px[i]);
  let limit = plotH;
  for (const i of down) {
    px[i] = Math.min(px[i], limit);
    limit = px[i] - LABEL_GAP;
  }
  let floor = 0;
  for (const i of [...down].reverse()) {
    px[i] = Math.max(px[i], floor);
    floor = px[i] + LABEL_GAP;
  }
  return px.map((y) => hi - (y / plotH) * (hi - lo));
}

export default function GrowthChart({ growth: g, lines, width, height }: GrowthChartProps) {
  const data = useMemo(
    () =>
      g.dates.map((date, i) => {
        const row: Record<string, string | number> = { date };
        for (const l of g.lines) row[l.key] = l.values[i];
        return row;
      }),
    [g],
  );

  const wide = width >= WIDE;
  const longest = Math.max(...lines.map((l) => l.name.length));
  const right = wide ? Math.min(160, 16 + Math.ceil(longest * 7.4)) : 12;
  const margin = { ...MARGIN, right };

  const [lo, hi] = extent([g.amount, ...lines.flatMap((l) => extent(l.values))]);
  const ticks = niceTicks(lo, hi, 5);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const plotH = height - margin.top - margin.bottom - X_AXIS_H;
  const labels = wide ? endLabelValues(lines.map((l) => l.end), y0, y1, plotH) : [];
  const last = g.dates[g.dates.length - 1];

  return (
    <LineChart width={width} height={height} data={data} margin={margin}>
      <CartesianGrid {...gridProps} />
      <XAxis
        {...axisProps}
        dataKey="date"
        height={X_AXIS_H}
        ticks={yearTicks(g.dates, wide ? 8 : 4)}
        tickFormatter={(d: string) => String(d).slice(0, 4)}
        interval={0}
      />
      <YAxis
        {...axisProps}
        width={64}
        domain={[y0, y1]}
        ticks={ticks}
        tickFormatter={(v: number) => tickText(v, "usd")}
        allowDataOverflow
      />
      {/* The amount invested, dashed. Not labelled: every line starts on it, so a label at either end
          sits on the lines; the subtitle names it. */}
      <ReferenceLine y={g.amount} stroke={tokens.color.ink2} strokeDasharray={DASH.reference} className="ret-start" />
      <Tooltip
        {...tooltipProps("x")}
        content={ReadableTip}
        formatter={(v) => format(Number(v), "usd0")}
        labelFormatter={(d) => format(String(d), "date")}
      />
      {lines.map((l) => (
        <Curve
          key={l.key}
          type="linear"
          dataKey={l.key}
          name={l.name}
          stroke={l.color}
          strokeWidth={l.bench ? 2 : 1.5}
          dot={false}
          activeDot={{ r: 3 }}
          isAnimationActive={false}
        />
      ))}
      {labels.map((y, i) => (
        <ReferenceDot
          key={lines[i].key}
          x={last}
          y={y}
          r={0}
          ifOverflow="visible"
          label={{ ...pointLabel(lines[i].name, lines[i].color, "right"), className: "ret-endlabel" }}
        />
      ))}
    </LineChart>
  );
}
