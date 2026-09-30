// Dot strips under the weights: for each asset, the tangency weight re-solved on each of the seeded
// redraws of the expected returns (src/lib/robust.ts redraw()), one dot per draw, beside a tick at this
// window's own tangency weight and a single dot for GMV, which reads no expected returns and so lands on
// the same weight every time. The strips are static: no animation, and nothing moves until Redraw is
// pressed, which solves the next seed's draw set.
//
// What the strips claim, and no more: how far the weights would move if the true means were anywhere
// their own noise allows, with the covariance held at its in-sample estimate. They are a what-if on these
// prices. They say nothing about how any portfolio did afterwards, and no count of draws is scored here.
import { ROLE } from "../../charts/theme.ts";
import { format } from "../../format.ts";
import type { Vec } from "../../lib/num.ts";
import type { Redraws } from "../../lib/robust.ts";
import type { Analysis } from "../../types.ts";
import type { RedrawState } from "./scorecard.ts";

export interface StripRow {
  ticker: string;
  /** The tangency weight on each solved draw, in draw order. */
  tan: Vec;
  /** This window's own tangency weight, or null when the solve failed. */
  own: number | null;
  /** The distinct GMV weights across the draws (one value: GMV does not read the means). */
  gmv: Vec;
  p10: number;
  p90: number;
}

/** Distinct values, equal to twelve places counting as one. */
function distinct(xs: Vec): Vec {
  const out: number[] = [];
  for (const x of xs) if (!out.some((y) => Math.abs(x - y) <= 1e-12)) out.push(x);
  return out;
}

/** One row per asset from a draw set: the pure part of the strips, which the suite holds. */
export function stripRows(a: Analysis, r: Redraws): StripRow[] {
  return a.tickers.map((ticker, i) => ({
    ticker,
    tan: r.tan.weights[i],
    own: a.tangency ? a.tangency.w[i] : null,
    gmv: distinct(r.gmv.weights[i]),
    p10: r.tan.p10[i],
    p90: r.tan.p90[i],
  }));
}

/** The weight axis: 0% to 100% long-only, −100% to 100% with shorting (the solver's bounds). */
export function stripDomain(allowShort: boolean): [number, number] {
  return allowShort ? [-1, 1] : [0, 1];
}

const W = 400;
const H = 26;
const PAD = 5;

function Strip({ row, domain }: { row: StripRow; domain: [number, number] }) {
  const [lo, hi] = domain;
  const x = (v: number) => PAD + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (W - 2 * PAD);
  const ticks = lo < 0 ? [-1, -0.5, 0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg className="opt-strip-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${row.ticker}: tangency weight on each draw, 10th to 90th percentile ${format(row.p10, "pct1")} to ${format(row.p90, "pct1")}`}>
      {ticks.map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={2} y2={H - 2} className="opt-strip-grid" />
      ))}
      {row.tan.map((v, k) => (
        <circle key={k} cx={x(v)} cy={8} r={2.6} fill={ROLE.tangency} fillOpacity={0.28} />
      ))}
      {row.own !== null ? <line x1={x(row.own)} x2={x(row.own)} y1={2} y2={14} className="opt-strip-own" /> : null}
      {row.gmv.map((v, k) => (
        <circle key={`g${k}`} cx={x(v)} cy={20} r={3} fill={ROLE.gmv} />
      ))}
    </svg>
  );
}

export interface DotStripsProps {
  a: Analysis;
  redraws: RedrawState;
  /** Which draw set is on screen: 0 is the first, the one the downloads share. */
  set: number;
  seed: number;
  onRedraw: () => void;
}

export default function DotStrips({ a, redraws, set, seed, onRedraw }: DotStripsProps) {
  const domain = stripDomain(a.allowShort);
  const ready = redraws.status === "ready" ? redraws.value : null;
  const rows = ready ? stripRows(a, ready) : null;
  return (
    <div className="opt-strips" data-seed={ready ? ready.seed : undefined}>
      <h3 className="opt-strips-title">If the true means were anywhere their own noise allows</h3>
      <p className="opt-note">
        Each bronze dot is the tangency weight re-solved on one of {ready ? ready.count : "the"} sets of expected returns drawn around
        this window's estimates, each asset's spread set by its own volatility and the window's length, with the covariance held at its
        in-sample estimate. The black tick is this window's own tangency weight. GMV reads no expected returns, so every draw puts it on
        the one teal dot. A what-if on these prices, not a forecast.
      </p>
      <div className="opt-strips-bar">
        <button type="button" className="opt-redraw" onClick={onRedraw} disabled={redraws.status === "pending"}>
          Redraw
        </button>
        <span className="opt-strips-seed" role="status">
          {redraws.status === "pending"
            ? "Solving the draws."
            : redraws.status === "error"
              ? `The redraws failed. ${redraws.message}`
              : ready
                ? `Draw set ${set + 1}, seed ${seed}${ready.tan.solved < ready.count ? `; ${ready.tan.solved} of ${ready.count} draws solved` : ""}.`
                : "No draws: the covariance matrix has no Cholesky factor."}
        </span>
      </div>
      {ready && ready.belowRf > 0 ? (
        <p className="opt-note opt-strips-below">
          On {ready.belowRf} of {ready.count} draws no long-only mix earned more than the risk-free rate; on those draws the dot is
          the single asset that fell least short of it.
        </p>
      ) : null}
      {rows ? (
        <ul className="opt-strip-list">
          {rows.map((r) => (
            <li key={r.ticker} className="opt-strip" data-ticker={r.ticker}>
              <span className="opt-strip-name">{r.ticker}</span>
              <Strip row={r} domain={domain} />
              <span className="opt-strip-range">
                {Number.isFinite(r.p10) ? `${format(r.p10, "pct1")} to ${format(r.p90, "pct1")}` : "no draw solved"}
              </span>
            </li>
          ))}
          <li className="opt-strip opt-strip-axis" aria-hidden="true">
            <span className="opt-strip-name" />
            <span className="opt-strip-ends">
              <span>{format(domain[0], "pct1")}</span>
              <span>{format(domain[1], "pct1")}</span>
            </span>
            <span className="opt-strip-range">10th to 90th</span>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
