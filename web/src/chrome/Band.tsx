// The front-page band: one sentence stating the finding, then the app's Snapshot, four stat
// plates (portfolio_app.py 1192-1208). While no analysis is ready it says why, in the same place,
// so the page is never blank.
//
// Above all of it, in every state, sits the published walk-forward result (src/content/published.ts):
// the figures under it are fitted to the window on screen, and that result is what the same
// constructions earned on years they had not seen. It is quoted, needs no prices, and links one place.
//
// The app's Snapshot shows the EQUAL-WEIGHT figures under the "Tangency" labels when the tangency
// solve fails (1200-1202). Here a failed tangency is null (src/state/analyze.ts), its two plates
// print a dash, and the sentence says the optimisation failed.
import Plate from "../components/Plate.tsx";
import { CARD_SENTENCE, MEGA_CAP_IN_SAMPLE, PUBLISHED_SETS, PUBLISHED_URL, PUBLISHED_WHEN } from "../content/published.ts";
import { format } from "../format.ts";
import { publishedPresetOf } from "../state/defaults.ts";
import type { Analysis, BandProps, FormatId, TipKey } from "../types.ts";
import { usePhone } from "./usePhone.ts";
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
// The app labels the first "Best Sharpe (Tangency)"; here it says what the figure is, the tangency
// portfolio's Sharpe scored on the same window its weights were fitted to.
export function snapshotPlates(a: Analysis): SnapshotPlate[] {
  const t = a.tangency;
  return [
    { label: "Tangency Sharpe (in-sample)", value: t ? fin(t.sharpe) : null, format: "num3", tip: "best_sharpe" },
    { label: "Tangency Return", value: t ? fin(t.mu) : null, format: "pct2", tip: "tangency_return" },
    { label: `${a.benchLabel} Return`, value: fin(a.benchStats.mu), format: "pct2", tip: "bench_return" },
    { label: `${a.benchLabel} Volatility`, value: fin(a.benchStats.sigma), format: "pct2", tip: "bench_vol" },
  ];
}

// The finding, in one sentence, over the span the prices actually cover (the chip above shows the
// requested one). The tangency weights are picked knowing the whole period's returns, so the
// sentence says "with hindsight" rather than implying a strategy anyone could have held. It opens
// by naming what it describes, these assets with hindsight, so it cannot be read as the published
// result above it. On one of the published baskets the figure is also marked as recomputed here, on the
// prices loaded, because it is not the published in-sample figure and must not be read as one.
function recomputed(a: Analysis): string {
  return publishedPresetOf(a.tickers) ? ` (in-sample, recomputed on prices through ${format(a.asOf, "date")})` : "";
}

export function finding(a: Analysis): string {
  const span = `From ${monthYear(a.prices.dates[0])} to ${monthYear(a.asOf)}`;
  const over = `from ${monthYear(a.prices.dates[0])} to ${monthYear(a.asOf)}`;
  const n = a.tickers.length;
  const bench = `the ${a.benchLabel}`;
  const b = a.benchStats;
  const t = a.tangency;
  if (!t) {
    return (
      `The tangency (maximum-Sharpe) optimisation failed for these ${n} assets${a.allowShort ? " with short positions allowed" : ""}, ` +
      `so no tangency figures are shown. ${span}, ${bench} returned ${format(fin(b.mu), "pct2")} a year ` +
      `at ${format(fin(b.sigma), "pct2")} volatility.`
    );
  }
  if (!t.beatsRf) {
    return (
      `On these ${n} assets${a.allowShort ? "" : ", held long only"}, with hindsight, no mix earned more than the ` +
      `${format(a.rf, "pct2")} risk-free rate ${over}; the highest Sharpe ratio reachable was ${format(fin(t.sharpe), "num3")}${recomputed(a)}, ` +
      `against ${format(fin(b.sharpe), "num3")} for ${bench}.`
    );
  }
  return (
    `On these ${n} assets, with hindsight, the highest-Sharpe mix ${over} earned ` +
    `${format(fin(t.sharpe), "num3")} of annual excess return per unit of volatility${recomputed(a)}; ${bench} earned ` +
    `${format(fin(b.sharpe), "num3")}.`
  );
}

// The published result: the site's own sentence, the five mega-caps' three out-of-sample Sharpe ratios
// beside the tangency's in-sample one, the date, and the one link. Every figure is a constant from
// src/content/published.ts, printed as written; t-app holds each one to it. On a phone the sentence
// folds behind a closed disclosure, so the figures, the date and the link stay on the first screen
// without pushing the plates below it.
export function PublishedResult() {
  const mega = PUBLISHED_SETS[0];
  const phone = usePhone();
  const quote = (
    <blockquote className="band-published-quote" cite={PUBLISHED_URL}>
      <p>{CARD_SENTENCE}</p>
    </blockquote>
  );
  return (
    <figure className="band-published" aria-label="Published result">
      <p className="band-published-kicker">Published result</p>
      {phone ? (
        <details className="band-published-more">
          <summary>The published sentence</summary>
          {quote}
        </details>
      ) : (
        quote
      )}
      <p className="band-published-figures">
        {mega.name} ({mega.tickers.join(", ")}), Sharpe out of sample: equal weight {mega.ew} · GMV {mega.gmv} · tangency{" "}
        {mega.tangency} ({MEGA_CAP_IN_SAMPLE} in-sample).
      </p>
      <figcaption className="band-published-source">
        Walk-forward test, published {PUBLISHED_WHEN} · <a href={PUBLISHED_URL}>Method note on masonjbennett.com</a>
      </figcaption>
    </figure>
  );
}

export default function Band({ analysis, level, fetching, failure }: BandProps) {
  if (analysis.status !== "ready") {
    // Nothing computed to show: say what happened instead, named, never a blank.
    if (failure) {
      return (
        <section className="band band-status" aria-label="Snapshot">
          <PublishedResult />
          <p className="band-alert" role="alert">
            The analysis could not be built. {failure.message}
          </p>
        </section>
      );
    }
    return (
      <section className="band band-status" aria-label="Snapshot">
        <PublishedResult />
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
      <PublishedResult />
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
