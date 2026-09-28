// The front-page band: one sentence stating the finding, then the app's Snapshot, four stat
// plates (portfolio_app.py 1192-1208). While no analysis is ready it says why, in the same place,
// so the page is never blank.
//
// The app's Snapshot shows the EQUAL-WEIGHT figures under the "Tangency" labels when the tangency
// solve fails (1200-1202). Here a failed tangency is null (src/state/analyze.ts), its two plates
// print a dash, and the sentence says the optimisation failed.
import Plate from "../components/Plate.tsx";
import { format } from "../format.ts";
import type { Analysis, BandProps, FormatId, TipKey } from "../types.ts";
import { monthYear } from "./when.ts";
import "./Band.css";

export interface SnapshotPlate {
  label: string;
  value: number | null;
  format: FormatId;
  tip: TipKey;
}

// A ratio of zero volatility is NaN; a plate prints it as unavailable, not as "NaN".
function fin(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

// The four st.metric calls (1205-1208) in order, with their formats ({:.3f}, {:.2%}) and tooltips.
export function snapshotPlates(a: Analysis): SnapshotPlate[] {
  const t = a.tangency;
  return [
    { label: "Best Sharpe (Tangency)", value: t ? fin(t.sharpe) : null, format: "num3", tip: "best_sharpe" },
    { label: "Tangency Return", value: t ? fin(t.mu) : null, format: "pct2", tip: "tangency_return" },
    { label: `${a.benchLabel} Return`, value: fin(a.benchStats.mu), format: "pct2", tip: "bench_return" },
    { label: `${a.benchLabel} Volatility`, value: fin(a.benchStats.sigma), format: "pct2", tip: "bench_vol" },
  ];
}

// The finding, in one sentence, over the span the prices actually cover (the chip above shows the
// requested one). The tangency weights are picked knowing the whole period's returns, so the
// sentence says "with hindsight" rather than implying a strategy anyone could have held.
export function finding(a: Analysis): string {
  const span = `From ${monthYear(a.prices.dates[0])} to ${monthYear(a.asOf)}`;
  const n = a.tickers.length;
  const bench = `the ${a.benchLabel}`;
  const b = a.benchStats;
  const t = a.tangency;
  if (!t) {
    return (
      `The tangency (best-Sharpe) optimisation failed for these ${n} assets${a.allowShort ? " with short positions allowed" : ""}, ` +
      `so no tangency figures are shown. ${span}, ${bench} returned ${format(fin(b.mu), "pct2")} a year ` +
      `at ${format(fin(b.sigma), "pct2")} volatility.`
    );
  }
  if (!t.beatsRf) {
    return (
      `${span}, no mix of these ${n} assets${a.allowShort ? "" : ", held long only,"} earned more than the ` +
      `${format(a.rf, "pct2")} risk-free rate; the best Sharpe ratio reachable was ${format(fin(t.sharpe), "num2")}, ` +
      `against ${format(fin(b.sharpe), "num2")} for ${bench}.`
    );
  }
  return (
    `${span}, the highest-Sharpe mix of these ${n} assets, picked with hindsight, earned ` +
    `${format(fin(t.sharpe), "num2")} of annual excess return per unit of volatility; ${bench} earned ` +
    `${format(fin(b.sharpe), "num2")}.`
  );
}

export default function Band({ analysis, level, fetching, failure }: BandProps) {
  if (analysis.status !== "ready") {
    // Nothing computed to show: say what happened instead, named, never a blank.
    if (failure) {
      return (
        <section className="band band-status" aria-label="Snapshot">
          <p className="band-alert" role="alert">
            The analysis could not be built. {failure.message}
          </p>
        </section>
      );
    }
    return (
      <section className="band band-status" aria-label="Snapshot">
        {analysis.status === "error" ? (
          <p className="band-alert" role="alert">
            {analysis.name} failed: {analysis.message}
          </p>
        ) : (
          <p className="band-wait" role="status">
            {analysis.status === "empty" ? analysis.reason : "Loading prices."}
          </p>
        )}
      </section>
    );
  }
  const a = analysis.value;
  return (
    <section className="band" aria-label="Snapshot" aria-busy={fetching}>
      {failure ? (
        <p className="band-alert" role="alert">
          Not updated: {failure.message} The figures below are still for the previous settings.
        </p>
      ) : null}
      <p className="band-finding">{finding(a)}</p>
      <div className="band-plates">
        {snapshotPlates(a).map((p) => (
          <Plate key={p.tip} label={p.label} value={p.value} format={p.format} tip={p.tip} level={level} allowShort={a.allowShort} />
        ))}
      </div>
    </section>
  );
}
