// One series' calendar months, years down and January to December across, drawn by hand in SVG as the
// correlation heatmap is: a square-ish cell per month the window holds, its return printed on it in
// JetBrains Mono, and a diverging fill from ./years.ts (monthTint), the loss colour through the paper to
// the gain colour, the same reach on both sides of zero. A month the window holds only part of (its first
// and its last) has a dashed outline, which the note under the grid explains.
//
// Pointing at a cell, or tapping it on a phone, names it in the readout line above the grid, which always
// holds text so the grid never jumps. The figures are also in the table below the grid, which is where a
// screen reader reads them and where the downloads come from.
//
// On a phone the grid keeps its figures at 12px and scrolls sideways inside its own box, as the ledgers
// do, rather than shrinking them or widening the page.
import { memo, useState } from "react";
import { format } from "../../format.ts";
import type { Month } from "../../lib/monthly.ts";
import { tokens } from "../../styles/tokens.ts";
import { MONTH_NAMES, monthReadout, monthTint, type MonthView } from "./years.ts";

const c = tokens.color;
const mono = tokens.font.mono;

/** Cell width and height, and the gutters for the year and month labels, in SVG units (pixels at the smallest size). */
export const MONTH_CELL = { w: 56, h: 30 };
const LEFT = 48;
const TOP = 22;
const FONT = 12;
/** The grid never draws wider than this many times its smallest size. */
const MAX_SCALE = 1.3;

export default memo(function MonthHeatmap({ view }: { view: MonthView }) {
  const [at, setAt] = useState<Month | null>(null);
  const { grid, reach, label } = view;
  const width = LEFT + 12 * MONTH_CELL.w;
  const height = TOP + grid.length * MONTH_CELL.h;
  const x = (k: number) => LEFT + k * MONTH_CELL.w;
  const y = (i: number) => TOP + i * MONTH_CELL.h;
  const years = grid.length ? `${grid[0].year} to ${grid[grid.length - 1].year}` : "";
  return (
    <div className="ret-months">
      <p className="ret-months-readout" aria-live="polite">
        {at ? monthReadout(at) : "Point at a month to read it."}
      </p>
      <div className="ret-months-scroll">
        <svg
          className="ret-months-svg"
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: width, maxWidth: width * MAX_SCALE, aspectRatio: `${width} / ${height}` }}
          role="img"
          aria-label={`Monthly returns of ${label}, ${years}. The figures are in the table below.`}
          onMouseLeave={() => setAt(null)}
        >
          {MONTH_NAMES.map((m, k) => (
            <text key={m} x={x(k) + MONTH_CELL.w / 2} y={TOP - 7} textAnchor="middle" fill={c.ink2} fontFamily={mono} fontSize={FONT - 1}>
              {m}
            </text>
          ))}
          {grid.map((row, i) => (
            <text
              key={`y${row.year}`}
              x={LEFT - 8}
              y={y(i) + MONTH_CELL.h / 2}
              textAnchor="end"
              dominantBaseline="central"
              fill={c.ink2}
              fontFamily={mono}
              fontSize={FONT - 1}
            >
              {row.year}
            </text>
          ))}
          {grid.map((row, i) =>
            row.months.map((m, k) =>
              m ? (
                <g
                  key={m.ym}
                  className="ret-month"
                  data-month={m.ym}
                  data-partial={m.partial || undefined}
                  onMouseEnter={() => setAt(m)}
                  onClick={() => setAt(m)}
                >
                  <rect
                    x={x(k) + 1}
                    y={y(i) + 1}
                    width={MONTH_CELL.w - 2}
                    height={MONTH_CELL.h - 2}
                    fill={monthTint(m.ret, reach)}
                    stroke={m.partial ? c.ink2 : "none"}
                    strokeWidth={m.partial ? 1 : 0}
                    strokeDasharray={m.partial ? "3 2" : undefined}
                  />
                  <text
                    x={x(k) + MONTH_CELL.w / 2}
                    y={y(i) + MONTH_CELL.h / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={c.ink}
                    fontFamily={mono}
                    fontSize={FONT}
                    pointerEvents="none"
                  >
                    {format(m.ret, "pct1")}
                  </text>
                </g>
              ) : null,
            ),
          )}
          {at
            ? (() => {
                const i = grid.findIndex((g) => g.year === Number(at.ym.slice(0, 4)));
                const k = Number(at.ym.slice(5, 7)) - 1;
                return i < 0 ? null : (
                  <rect
                    className="ret-month-on"
                    x={x(k) + 1}
                    y={y(i) + 1}
                    width={MONTH_CELL.w - 2}
                    height={MONTH_CELL.h - 2}
                    fill="none"
                    stroke={c.ink}
                    strokeWidth={2}
                    pointerEvents="none"
                  />
                );
              })()
            : null}
        </svg>
      </div>
      <MonthScale reach={reach} />
    </div>
  );
});

// The scale's key: the loss end, zero and the gain end, each end the largest month either way, so the
// two sides are drawn to the same reach.
function MonthScale({ reach }: { reach: number }) {
  const W = 180;
  const H = 10;
  return (
    <div className="ret-months-scale">
      <span className="ret-months-scale-name">Month's return</span>
      <svg viewBox={`0 0 ${W} ${H + 16}`} width={W} height={H + 16} aria-hidden="true" data-reach={reach}>
        <defs>
          <linearGradient id="ret-months-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={monthTint(-reach, reach)} />
            <stop offset="0.5" stopColor={monthTint(0, reach)} />
            <stop offset="1" stopColor={monthTint(reach, reach)} />
          </linearGradient>
        </defs>
        <rect x={0.5} y={0.5} width={W - 1} height={H} fill="url(#ret-months-grad)" stroke={c.hairline} />
        <text className="ret-months-scale-lo" x={0} y={H + 14} textAnchor="start" fill={c.ink2} fontFamily={mono} fontSize={11}>
          {format(-reach, "pct1")}
        </text>
        <text x={W / 2} y={H + 14} textAnchor="middle" fill={c.ink2} fontFamily={mono} fontSize={11}>
          0%
        </text>
        <text className="ret-months-scale-hi" x={W} y={H + 14} textAnchor="end" fill={c.ink2} fontFamily={mono} fontSize={11}>
          {format(reach, "pct1")}
        </text>
      </svg>
    </div>
  );
}

