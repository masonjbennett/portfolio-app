// The pairwise correlation heatmap (portfolio_app.py 1425-1436), drawn by hand in SVG: one square cell
// per pair in the ticker order, the figure printed in each cell in JetBrains Mono, and a diverging
// scale from the tokens (model.ts, tint).
//
// Hover reads the ONE cell under the pointer; a tap does the same on a phone. The app's heatmap asks
// for nothing, but style_chart (983-995), called after its layout (1435), sets hovermode "x unified"
// on it as on every chart. The readout line above the grid always holds text, so it never jumps.
//
// In a box too narrow for its cells (a phone), the grid shrinks its cells to fit the box, down to a
// floor (heatLayout, ./model.ts); a cell too small to print its figure legibly prints none, and a tap,
// a pointer or the arrow keys on the focused grid read it. Only a grid that does not fit even at the
// floor scrolls sideways, inside its own box, never the page.
import { useMemo, useState, type KeyboardEvent } from "react";
import { format } from "../../format.ts";
import { tokens } from "../../styles/tokens.ts";
import { useWidth } from "../returns/useWidth.ts";
import { FONT, heatLayout, MAX_SCALE, readout, stepCell, tint, type CorrView } from "./model.ts";

const c = tokens.color;
const mono = tokens.font.mono;

export default function Heatmap({ view }: { view: CorrView }) {
  const [at, setAt] = useState<readonly [number, number] | null>(null);
  const { tickers, matrix } = view;
  // The box's width once measured; 0 (unmeasured, or a surface with no layout) keeps the full-size cells.
  const [box, width] = useWidth<HTMLDivElement>(0);
  const widest = useMemo(() => Math.max(1, ...matrix.flatMap((row) => row.map((r) => format(r, "num2").length))), [matrix]);
  const L = heatLayout(tickers, width > 0 ? width : undefined, widest);
  const CELL = L.cell;
  const x = (j: number) => L.left + j * CELL;
  const y = (i: number) => L.top + i * CELL;
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "Escape") return setAt(null);
    const next = stepCell(at, e.key, tickers.length);
    if (!next) return;
    e.preventDefault();
    setAt(next);
  };

  return (
    <div className="corr-heat">
      <p className="corr-readout" aria-live="polite">
        {readout(view, at)}
      </p>
      <div className="corr-heat-scroll" ref={box}>
        <svg
          className="corr-heat-svg"
          viewBox={`0 0 ${L.width} ${L.height}`}
          style={{ minWidth: L.width, maxWidth: L.width * MAX_SCALE, aspectRatio: `${L.width} / ${L.height}` }}
          role="img"
          aria-label={`Correlation heatmap of ${tickers.join(", ")}. The figures are in the table below; with the keyboard, the arrow keys also step through the cells.`}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setAt((was) => was ?? [0, 0])}
          onMouseLeave={() => setAt(null)}
        >
          {tickers.map((t, j) =>
            L.turned ? (
              <text
                key={`col-${t}`}
                transform={`translate(${x(j) + CELL / 2} ${L.top - 6}) rotate(-45)`}
                fill={c.ink2}
                fontFamily={mono}
                fontSize={FONT - 1}
              >
                {t}
              </text>
            ) : (
              <text key={`col-${t}`} x={x(j) + CELL / 2} y={L.top - 8} textAnchor="middle" fill={c.ink2} fontFamily={mono} fontSize={FONT - 1}>
                {t}
              </text>
            ),
          )}
          {tickers.map((t, i) => (
            <text
              key={`row-${t}`}
              x={L.left - 8}
              y={y(i) + CELL / 2}
              textAnchor="end"
              dominantBaseline="central"
              fill={c.ink2}
              fontFamily={mono}
              fontSize={FONT - 1}
            >
              {t}
            </text>
          ))}
          {tickers.map((_, i) =>
            tickers.map((__, j) => {
              const r = matrix[i][j];
              return (
                <g
                  key={`${i}-${j}`}
                  className="corr-cell"
                  data-cell={`${i},${j}`}
                  onMouseEnter={() => setAt([i, j])}
                  onClick={() => setAt([i, j])}
                >
                  <rect x={x(j)} y={y(i)} width={CELL} height={CELL} fill={tint(r)} stroke={c.paper} strokeWidth={1} />
                  {L.figures ? (
                    <text
                      x={x(j) + CELL / 2}
                      y={y(i) + CELL / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={c.ink}
                      fontFamily={mono}
                      fontSize={L.font}
                      pointerEvents="none"
                    >
                      {format(r, "num2")}
                    </text>
                  ) : null}
                </g>
              );
            }),
          )}
          {at ? (
            <rect
              className="corr-cell-on"
              x={x(at[1]) + 1}
              y={y(at[0]) + 1}
              width={CELL - 2}
              height={CELL - 2}
              fill="none"
              stroke={c.ink}
              strokeWidth={2}
              pointerEvents="none"
            />
          ) : null}
        </svg>
      </div>
      <Scale />
    </div>
  );
}

// The scale's key: the same three stops as the cells, labelled -1, 0 and +1.
function Scale() {
  const W = 180;
  const H = 10;
  return (
    <div className="corr-scale">
      <span className="corr-scale-name">Correlation</span>
      <svg viewBox={`0 0 ${W} ${H + 16}`} width={W} height={H + 16} aria-hidden="true">
        <defs>
          <linearGradient id="corr-scale-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={tint(-1)} />
            <stop offset="0.5" stopColor={tint(0)} />
            <stop offset="1" stopColor={tint(1)} />
          </linearGradient>
        </defs>
        <rect x={0.5} y={0.5} width={W - 1} height={H} fill="url(#corr-scale-grad)" stroke={c.hairline} />
        {[
          [0, "start", -1],
          [W / 2, "middle", 0],
          [W, "end", 1],
        ].map(([px, anchor, v]) => (
          <text key={String(v)} x={px as number} y={H + 14} textAnchor={anchor as "start" | "middle" | "end"} fill={c.ink2} fontFamily={mono} fontSize={11}>
            {v === 1 ? "+1" : format(v as number, "int")}
          </text>
        ))}
      </svg>
    </div>
  );
}
