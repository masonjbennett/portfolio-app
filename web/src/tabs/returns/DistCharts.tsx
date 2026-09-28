// C2 and C3, the distribution of one asset's daily returns (1271-1312), drawn as plain SVG at the
// column's real width: 80 bars and a curve, or ~2,000 dots and a line, are simpler to draw by hand
// than to bend a chart library around. Colours and type come from the tokens, like every chart.
import type { ReactNode } from "react";
import { format } from "../../format.ts";
import { normPdf } from "../../lib/stats.ts";
import { tokens } from "../../styles/tokens.ts";
import { niceTicks, tickText, type Hist, type QQView } from "./model.ts";

const c = tokens.color;
const M = { top: 16, right: 20, bottom: 46, left: 60 } as const;

type Scale = (v: number) => number;
const scale = (d0: number, d1: number, r0: number, r1: number): Scale => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

interface AxesProps {
  width: number;
  height: number;
  xTicks: number[];
  yTicks: number[];
  sx: Scale;
  sy: Scale;
  xKind: "pct" | "num";
  yKind: "pct" | "num";
  xTitle: string;
  yTitle: string;
}

// Horizontal hairlines at the y ticks, tick numbers in JetBrains Mono, axis titles in Space Grotesk.
function Axes({ width, height, xTicks, yTicks, sx, sy, xKind, yKind, xTitle, yTitle }: AxesProps) {
  const bottom = height - M.bottom;
  const tick = { fill: c.ink2, fontFamily: tokens.font.mono, fontSize: 11 };
  const title = { fill: c.ink2, fontFamily: tokens.font.sans, fontSize: 12 };
  return (
    <g>
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke={c.hairline2} />
          <text x={M.left - 8} y={sy(t)} dy="0.35em" textAnchor="end" {...tick}>
            {tickText(t, yKind)}
          </text>
        </g>
      ))}
      <line x1={M.left} x2={width - M.right} y1={bottom} y2={bottom} stroke={c.hairline} />
      {xTicks.map((t) => (
        <text key={`x${t}`} x={sx(t)} y={bottom + 16} textAnchor="middle" {...tick}>
          {tickText(t, xKind)}
        </text>
      ))}
      <text x={(M.left + width - M.right) / 2} y={height - 6} textAnchor="middle" {...title}>
        {xTitle}
      </text>
      <text transform={`translate(14 ${(M.top + bottom) / 2}) rotate(-90)`} textAnchor="middle" {...title}>
        {yTitle}
      </text>
    </g>
  );
}

function Svg({ width, height, label, children }: { width: number; height: number; label: string; children: ReactNode }) {
  return (
    <svg className="ret-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {children}
    </svg>
  );
}

const labelFont = { fontFamily: tokens.font.sans, fontSize: 12 } as const;

// C2: density bars (histnorm "probability density", 1280) and the normal fit (1284-1287). The app
// draws the bars in its secondary blue at 0.75 opacity with a 0.02 bar gap and the fit in red; here
// the bars take the asset's own colour and the fit is ink, since red means a falling market.
export function HistChart({ h, color, width, height, label }: { h: Hist; color: string; width: number; height: number; label: string }) {
  const top = Math.max(...h.density, ...h.fitY);
  const xTicks = niceTicks(h.lo, h.hi, width < 480 ? 4 : 6);
  const yTicks = niceTicks(0, top, 4);
  const sx = scale(xTicks[0], xTicks[xTicks.length - 1], M.left, width - M.right);
  const sy = scale(0, yTicks[yTicks.length - 1], height - M.bottom, M.top);
  const binPx = sx(h.lo + h.width) - sx(h.lo);
  const gap = binPx * 0.02;
  const fit = h.fitX.map((x, i) => `${i ? "L" : "M"}${sx(x).toFixed(2)},${sy(h.fitY[i]).toFixed(2)}`).join("");
  // The fit is named on its right shoulder, 1.5 standard deviations out, where fat-tailed returns
  // leave the curve above the bars; at the peak the name would sit on the bars.
  const tag = Math.min(h.hi, h.mean + 1.5 * h.sd);
  return (
    <Svg width={width} height={height} label={label}>
      <Axes width={width} height={height} xTicks={xTicks} yTicks={yTicks} sx={sx} sy={sy} xKind="pct" yKind="num"
        xTitle="Daily Return" yTitle="Density" />
      <g fill={color} fillOpacity={0.75}>
        {h.counts.map((n, i) =>
          n ? (
            <rect key={i} x={sx(h.lo + i * h.width) + gap / 2} width={Math.max(0.5, binPx - gap)} y={sy(h.density[i])}
              height={sy(0) - sy(h.density[i])}>
              <title>{`${format(h.lo + i * h.width, "pct2")} to ${format(h.lo + (i + 1) * h.width, "pct2")}: ${format(n, "int")} ${n === 1 ? "day" : "days"}`}</title>
            </rect>
          ) : null,
        )}
      </g>
      <path d={fit} fill="none" stroke={c.ink} strokeWidth={2} />
      <text x={sx(tag) + 8} y={sy(normPdf(tag, h.mean, h.sd)) - 6} fill={c.ink} {...labelFont} className="ret-inlabel">
        Normal fit
      </text>
    </Svg>
  );
}

// C3: the sorted returns against the normal quantiles, and probplot's least-squares line across
// them (1296-1306). Dots in the asset's colour at 0.6 opacity, the line in ink; the worst day and
// the line are named on the chart.
export function QQChart({ q, color, width, height, label }: { q: QQView; color: string; width: number; height: number; label: string }) {
  const n = q.osm.length;
  const xTicks = niceTicks(q.osm[0], q.osm[n - 1], width < 480 ? 4 : 6);
  const yTicks = niceTicks(Math.min(q.osr[0], q.line[0][1]), Math.max(q.osr[n - 1], q.line[1][1]), 5);
  const sx = scale(xTicks[0], xTicks[xTicks.length - 1], M.left, width - M.right);
  const sy = scale(yTicks[0], yTicks[yTicks.length - 1], height - M.bottom, M.top);
  const [[x0, y0], [x1, y1]] = q.line;
  return (
    <Svg width={width} height={height} label={label}>
      <Axes width={width} height={height} xTicks={xTicks} yTicks={yTicks} sx={sx} sy={sy} xKind="num" yKind="pct"
        xTitle="Theoretical Quantiles" yTitle="Sample Quantiles" />
      <g fill={color} fillOpacity={0.6}>
        {q.osm.map((x, i) => (
          <circle key={i} cx={sx(x)} cy={sy(q.osr[i])} r={2} />
        ))}
      </g>
      <line x1={sx(x0)} y1={sy(y0)} x2={sx(x1)} y2={sy(y1)} stroke={c.ink} strokeWidth={2} />
      {/* Below the line's upper end: a fat right tail puts dots above it, never below. */}
      <text x={sx(x1) - 4} y={sy(y1) + 18} textAnchor="end" fill={c.ink} {...labelFont} className="ret-inlabel">
        Normal line
      </text>
      <text x={sx(q.osm[0]) + 8} y={sy(q.osr[0])} dy="0.35em" fill={c.ink} {...labelFont} className="ret-inlabel">
        {`Worst day ${format(q.osr[0], "pct2")}`}
      </text>
    </Svg>
  );
}
