// The drop from in-sample to out-of-sample, one dumbbell per row on one shared Sharpe axis: a hollow dot at
// the figure fitted and scored on the whole window, a filled dot at the figure the held-out days paid, a line
// between them, and both values printed beside the row. Hollow against filled tells the two apart without
// colour; every row is drawn the same way, in ink, so none is singled out. Static: no animation.
import { format } from "../../format.ts";
import type { LiveRow } from "./live.ts";

const W = 400;
const H = 22;
const PAD = 8;

/** The shared axis: every printed figure and zero, widened a little so a dot never sits on the edge. */
export function bellDomain(rows: readonly LiveRow[]): [number, number] {
  const xs = rows.flatMap((r) => [r.inSample, r.oos]).filter((x): x is number => x !== null && Number.isFinite(x));
  const lo = Math.min(0, ...xs);
  const hi = Math.max(0, ...xs);
  const pad = (hi - lo || 1) * 0.06;
  return [lo - pad, hi + pad];
}

/** Gridline marks every quarter or half point, whichever keeps them to about six. */
export function bellTicks([lo, hi]: [number, number]): number[] {
  const step = hi - lo > 3 ? 1 : hi - lo > 1.5 ? 0.5 : 0.25;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

function Bell({ row, domain, ticks }: { row: LiveRow; domain: [number, number]; ticks: number[] }) {
  const [lo, hi] = domain;
  const x = (v: number) => PAD + ((v - lo) / (hi - lo)) * (W - 2 * PAD);
  const a = row.inSample;
  const b = row.oos;
  const says = `${row.label}: in-sample ${format(a, "num3")}, out-of-sample ${format(b, "num3")}`;
  return (
    <svg className="wfl-bell-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={says}>
      {ticks.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={2} y2={H - 2} className={t === 0 ? "wfl-bell-zero" : "wfl-bell-grid"} />
      ))}
      {a !== null && b !== null ? <line x1={x(a)} x2={x(b)} y1={H / 2} y2={H / 2} className="wfl-bell-bar" /> : null}
      {a !== null ? <circle cx={x(a)} cy={H / 2} r={5} className="wfl-bell-in" /> : null}
      {b !== null ? <circle cx={x(b)} cy={H / 2} r={5} className="wfl-bell-out" /> : null}
    </svg>
  );
}

export default function Dumbbell({ rows }: { rows: readonly LiveRow[] }) {
  const domain = bellDomain(rows);
  const ticks = bellTicks(domain);
  return (
    <div className="wfl-bells">
      <div className="wfl-bells-key" aria-hidden="true">
        <span>
          <svg viewBox="0 0 12 12" className="wfl-key-dot">
            <circle cx={6} cy={6} r={4.5} className="wfl-bell-in" />
          </svg>
          in-sample, the whole window
        </span>
        <span>
          <svg viewBox="0 0 12 12" className="wfl-key-dot">
            <circle cx={6} cy={6} r={4.5} className="wfl-bell-out" />
          </svg>
          out-of-sample, the held-out days
        </span>
      </div>
      <ul className="wfl-bell-list">
        {rows.map((r) => (
          <li key={r.key} className="wfl-bell" data-row={r.key}>
            <span className="wfl-bell-name">{r.label}</span>
            <Bell row={r} domain={domain} ticks={ticks} />
            <span className="wfl-bell-values">
              {format(r.inSample, "num3")} to {format(r.oos, "num3")}
            </span>
          </li>
        ))}
      </ul>
      <div className="wfl-bell-axis" aria-hidden="true">
        <span className="wfl-bell-axis-name">Sharpe ratio</span>
        <span className="wfl-bell-ends">
          <span>{format(domain[0], "num2")}</span>
          <span>{format(domain[1], "num2")}</span>
        </span>
      </div>
    </div>
  );
}
