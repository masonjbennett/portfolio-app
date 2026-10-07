// The front-page band: one sentence stating the finding, then four stat plates in the place of the
// app's Snapshot (portfolio_app.py 1192-1208). While no analysis is ready it says why, in the same place,
// so the page is never blank.
//
// The plates are the four Sharpe ratios the page's claim is about, not the app's four (its tangency
// Sharpe and return and the benchmark's return and volatility, which the Optimization tab's summary
// table still prints): equal weight, the tangency (in-sample, with its standard error), the minimum-
// variance mix (in-sample) and the benchmark, each the engine's own figure for this window at this rate,
// from the functions that table reads. The sentence measures the tangency against equal weight, the one
// yardstick that needs no fitting and no judgement about what kind of basket this is.
//
// Above all of it, in every state, sits the published walk-forward result (src/content/published.ts):
// the figures under it are fitted to the window on screen, and that result is what the same
// constructions earned on years they had not seen. It is quoted, needs no prices, and links one place.
// The words "Walk-forward test" on its source line open the Walk-forward tab on the published test,
// replayed in this page; they were already on the line, so the strip is exactly as tall as before.
// When the basket is one of the three published sets, exactly, its figures line quotes that set's
// result and says the basket is that set; on any other basket it quotes the five mega-caps, as it always did.
//
// The app's Snapshot shows the EQUAL-WEIGHT figures under the "Tangency" labels when the tangency
// solve fails (1200-1202). Here a failed tangency is null (src/state/analyze.ts), its two plates
// print a dash, and the sentence says the optimisation failed.
//
// Below the plates sits the what-if panel (./WhatIf.tsx): one expected return moved by hand and the
// weights solved again on these prices. It folds behind a closed disclosure at every width, so the first
// row of plates and the tab bar stay on the first screen, and its code is fetched only when the reader
// reaches for it (WhatIfFold, below).
//
// The tangency Sharpe plate carries plus or minus one standard error of that Sharpe (the engine's
// sharpeSE, on the tangency portfolio's own daily returns). It treats the weights as fixed, and they were
// picked on the same prices, so the true uncertainty is wider still; the plate's tooltip says so.
//
// While a shorting or rate change is still being worked into the analysis, `settling` marks the figures
// as the previous settings' (aria-busy, dimmed), as the tab below them is.
import { useContext, useState } from "react";
import type { MouseEvent } from "react";
import Plate from "../components/Plate.tsx";
import { CARD_SENTENCE, MEGA_CAP_IN_SAMPLE, PUBLISHED_SETS, PUBLISHED_URL, PUBLISHED_WHEN, type PublishedSet } from "../content/published.ts";
import type { ScoreTipKey } from "../content/tooltips.ts";
import { format, MINUS } from "../format.ts";
import { portfolioReturns, summaryRow } from "../lib/portfolio.ts";
import { sharpeSE } from "../lib/stats.ts";
import { TabContext } from "../state/useWorkbench.ts";
import type { Analysis, BandProps, FormatId, TipKey } from "../types.ts";
import { usePhone } from "./usePhone.ts";
import { monthYear } from "./when.ts";
import type WhatIf from "./WhatIf.tsx";
import "./Band.css";

export interface SnapshotPlate {
  label: string;
  value: number | null;
  format: FormatId;
  tip: TipKey | ScoreTipKey;
  /** One standard error of the figure, printed beside it; only the tangency Sharpe carries one. */
  se?: number | null;
}

// A ratio of zero volatility is NaN; a plate prints it as unavailable, not as "NaN".
function fin(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

// A portfolio's figures on this window at this rate: summaryRow, with the arguments the Optimization tab's
// portRow passes it, so a plate and that tab's tables can never print two figures for one portfolio.
function rowOf(a: Analysis, w: Analysis["ew"]) {
  return summaryRow(a.returns, w, a.m, a.S, a.rf);
}

/** Equal weight's Sharpe ratio on this window, as the Optimization tab's tables print it; null when not a number. */
export function ewSharpe(a: Analysis): number | null {
  return fin(rowOf(a, a.ew).sharpe);
}

// Four Sharpe ratios, each in num3 as the app prints a Sharpe ({:.3f}): equal weight, which nothing was
// fitted to choose; the tangency and the minimum-variance mix, whose weights were chosen on these prices, so
// their labels say in-sample; and the benchmark, on its own daily returns. A failed solve prints the dash.
// The tangency plate keeps the app's tooltip and its standard error; the other three carry the port's own.
export function snapshotPlates(a: Analysis): SnapshotPlate[] {
  const t = a.tangency;
  const g = a.gmv;
  return [
    { label: "Equal-Weight Sharpe", value: ewSharpe(a), format: "num3", tip: "ew_sharpe" },
    {
      label: "Tangency Sharpe (in-sample)",
      value: t ? fin(t.sharpe) : null,
      format: "num3",
      tip: "best_sharpe",
      se: t ? fin(sharpeSE(portfolioReturns(a.returns, t.w), a.rf)) : null,
    },
    { label: "GMV Sharpe (in-sample)", value: g ? fin(rowOf(a, g.w).sharpe) : null, format: "num3", tip: "gmv_sharpe" },
    { label: `${a.benchLabel} Sharpe`, value: fin(a.benchStats.sharpe), format: "num3", tip: "bench_sharpe" },
  ];
}

/** The tickers by name, in the page's order, when there are at most this many; above it, "these N assets". */
export const NAMED_MAX = 6;

// "VTI, AGG, GLD, VNQ and EFA" for a short basket, "these 10 assets" for a long one, so the sentence names
// what it describes when the names fit in it (on a phone the ticker box is inside the closed sheet).
export function assetsOf(tickers: readonly string[]): string {
  const n = tickers.length;
  if (n > NAMED_MAX) return `these ${n} assets`;
  return n > 1 ? `${tickers.slice(0, -1).join(", ")} and ${tickers[n - 1]}` : tickers.join("");
}

// The finding, in one sentence, over the span the prices actually cover (the chip above shows the
// requested one). The tangency weights are picked knowing the whole period's returns, so the
// sentence says "with hindsight" rather than implying a strategy anyone could have held. It opens
// by naming what it describes, these assets (by ticker when there are few) with hindsight, so it cannot be
// read as the published result above it. The figure is also marked as in-sample and recomputed here, on the
// prices loaded, on every basket: on a published one because it is not the published in-sample figure and
// must not be read as one, and on any other because the same sentence should not carry the mark on some
// baskets and not others. What the tangency is measured against is equal weight on the same window, in every
// branch; the benchmark keeps its plate and its rows in the tables.
function recomputed(a: Analysis): string {
  return ` (in-sample, recomputed on prices through ${format(a.asOf, "date")})`;
}

export function finding(a: Analysis): string {
  const span = `From ${monthYear(a.prices.dates[0])} to ${monthYear(a.asOf)}`;
  const over = `from ${monthYear(a.prices.dates[0])} to ${monthYear(a.asOf)}`;
  const assets = assetsOf(a.tickers);
  const ew = rowOf(a, a.ew);
  const t = a.tangency;
  if (!t) {
    return (
      `The tangency (maximum-Sharpe) optimisation failed for ${assets}${a.allowShort ? " with short positions allowed" : ""}, ` +
      `so no tangency figures are shown. ${span}, equal weight returned ${format(fin(ew.mu), "pct2")} a year ` +
      `at ${format(fin(ew.sigma), "pct2")} volatility.`
    );
  }
  if (!t.beatsRf) {
    return (
      `On ${assets}${a.allowShort ? "" : ", held long only"}, with hindsight, no mix earned more than the ` +
      `${format(a.rf, "pct2")} risk-free rate ${over}; the highest Sharpe ratio reachable was ${format(fin(t.sharpe), "num3")}${recomputed(a)}, ` +
      `against ${format(fin(ew.sharpe), "num3")} for equal weight.`
    );
  }
  return (
    `On ${assets}, with hindsight, the highest-Sharpe mix ${over} earned ` +
    `${format(fin(t.sharpe), "num3")} of annual excess return per unit of volatility${recomputed(a)}; equal weight earned ` +
    `${format(fin(ew.sharpe), "num3")}.`
  );
}

/**
 * The published set these tickers are, or null: the same symbols as one of the three sets, in any order and
 * any case, none missing and none added. A preset that only overlaps a set (seven mega-caps, a longer list of
 * sector funds) is not that set, and neither is a set with one ticker dropped in cleaning.
 */
export function publishedSetOf(tickers: readonly string[] | null | undefined): PublishedSet | null {
  if (!tickers?.length) return null;
  const have = new Set(tickers.map((x) => x.trim().toUpperCase()));
  if (have.size !== tickers.length) return null;
  return PUBLISHED_SETS.find((s) => s.tickers.length === have.size && s.tickers.every((x) => have.has(x.toUpperCase()))) ?? null;
}

// A published figure as a number: the site writes the negative with the minus sign (U+2212).
const figureOf = (s: string) => Number(s.replace(MINUS, "-"));

/**
 * How the set's two fitted constructions stood against equal weight out of sample, in words read off the
 * published figures themselves, so the words cannot disagree with the numbers beside them.
 */
export function standing(set: PublishedSet): string {
  const ew = figureOf(set.ew);
  const rel = (s: string) => {
    const x = figureOf(s);
    return x > ew ? "above" : x < ew ? "below" : "level with";
  };
  const g = rel(set.gmv);
  const t = rel(set.tangency);
  if (g === t) return g === "below" ? "equal weight above GMV and tangency" : `GMV and tangency ${g} equal weight`;
  return `tangency ${t} equal weight, GMV ${g} it`;
}

// The figures line. On one of the published sets it says this basket is that set, then quotes the set's
// three out-of-sample ratios (the mega-caps' tangency with its in-sample 1.107 beside it, as always) and how
// they stood. On any other basket it is the line it always was: the five mega-caps, named and quoted.
function figuresLine(set: PublishedSet | null): string {
  const s = set ?? PUBLISHED_SETS[0];
  const inSample = s === PUBLISHED_SETS[0] ? ` (${MEGA_CAP_IN_SAMPLE} in-sample)` : "";
  const three = `equal weight ${s.ew} · GMV ${s.gmv} · tangency ${s.tangency}${inSample}`;
  if (!set) return `${s.name} (${s.tickers.join(", ")}), Sharpe out of sample: ${three}.`;
  return `This basket is the published ${s.name} set. Sharpe out of sample: ${three}, ${standing(s)}.`;
}

// The published result: the site's own sentence, one set's three out-of-sample Sharpe ratios, the date,
// and the one link. Every figure is a constant from src/content/published.ts, printed as written; t-app
// holds each one to it. On a phone the sentence folds behind a closed disclosure, so the figures, the date
// and the link stay on the first screen without pushing the plates below it.
//
// `tickers` are the ones the page is showing, or while nothing is shown yet the ones being loaded, so the
// line names the same set before and after the prices for those tickers arrive.
export function PublishedResult({ tickers = null }: { tickers?: readonly string[] | null }) {
  const set = publishedSetOf(tickers);
  const phone = usePhone();
  // Inside the page the line's first words open the published test in the Walk-forward tab; rendered on
  // its own, outside the page, they are plain text. Either way the line reads the same.
  const page = useContext(TabContext);
  const test = page ? (
    <button
      type="button"
      className="text-button band-published-open"
      title="Open the published test, replayed, in the Walk-forward tab"
      onClick={() => page.setTab("walkforward", "published", true)}
    >
      Walk-forward test
    </button>
  ) : (
    "Walk-forward test"
  );
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
      <p className="band-published-figures" data-set={set ? set.name : undefined}>
        {figuresLine(set)}
      </p>
      <figcaption className="band-published-source">
        {test}, published {PUBLISHED_WHEN} · <a href={PUBLISHED_URL}>Method note on masonjbennett.com</a>
      </figcaption>
    </figure>
  );
}

// The what-if panel, folded shut below the plates at every width. Printed open on a desktop it stood
// about 350 px tall, which put the tab bar below the first screen of a 1440 x 900 display; folded, the
// question stays in view as the way in and the tabs stay on the first screen.
//
// The panel's code, and the solvers it runs (src/lib/robust.ts and what that imports), are not in the
// page's first chunk. They are fetched when the reader points at, focuses or presses the line, and a
// click that lands before they arrive is held until they have, so the fold opens on the finished panel
// in one step, never on an empty box that fills a moment later. Once here, the panel stays mounted, shut
// or open, as it always was. The browser keeps the fetched module, so a fold mounted again later gets it
// back within a microtask of asking. A fetch that fails says so inside the fold.
type Panel = typeof WhatIf;

// What a test replaces: how the panel's code is fetched (a test holds it in flight, or makes it fail).
export const seams = { whatIf: () => import("./WhatIf.tsx") };

const fetchPanel = (): Promise<Panel> => seams.whatIf().then((m) => m.default);

function WhatIfFold({ a }: { a: Analysis }) {
  const [Loaded, setLoaded] = useState<Panel | null>(null);
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [failed, setFailed] = useState(false);
  const warm = () => {
    if (!Loaded) fetchPanel().then((P) => setLoaded(() => P), () => {});
  };
  const onClick = (e: MouseEvent<HTMLElement>) => {
    // With the panel here, or the failure line showing, the browser opens or shuts the fold itself.
    if (Loaded || open) return;
    e.preventDefault();
    setHeld(true);
    fetchPanel().then(
      (P) => {
        setLoaded(() => P);
        setFailed(false);
        setHeld(false);
        setOpen(true);
      },
      () => {
        setFailed(true);
        setHeld(false);
        setOpen(true);
      },
    );
  };
  return (
    <details className="band-whatif-fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} aria-busy={held || undefined}>
      <summary onPointerEnter={warm} onPointerDown={warm} onFocus={warm} onClick={onClick}>
        What if one expected return were different?
      </summary>
      {Loaded ? (
        <Loaded a={a} />
      ) : failed ? (
        <p className="band-whatif-failed" role="alert">
          The what-if could not be loaded. Reload the page to try again.
        </p>
      ) : null}
    </details>
  );
}

// `tickers`: the tickers being loaded (the settings'), which name the published set while no analysis is
// on screen; once one is, its own tickers do, so the line always describes the figures under it.
export default function Band({
  analysis,
  level,
  fetching,
  failure,
  settling = false,
  tickers = null,
}: BandProps & { settling?: boolean; tickers?: readonly string[] | null }) {
  if (analysis.status !== "ready") {
    // Nothing computed to show: say what happened instead, named, never a blank.
    if (failure) {
      return (
        <section className="band band-status" aria-label="Snapshot">
          <PublishedResult tickers={tickers} />
          <p className="band-alert" role="alert">
            The analysis could not be built. {failure.message}
          </p>
        </section>
      );
    }
    return (
      <section className="band band-status" aria-label="Snapshot">
        <PublishedResult tickers={tickers} />
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
    <section className={settling ? "band band--settling" : "band"} aria-label="Snapshot" aria-busy={fetching || settling}>
      <PublishedResult tickers={a.tickers} />
      {failure ? (
        <p className="band-alert" role="alert">
          Not updated: {failure.message} The figures below are still for the previous settings.
        </p>
      ) : null}
      <p className="band-finding">{finding(a)}</p>
      <div className="band-plates">
        {snapshotPlates(a).map((p) => (
          <Plate key={p.tip} label={p.label} value={p.value} format={p.format} tip={p.tip} level={level} allowShort={a.allowShort} se={p.se} />
        ))}
      </div>
      <WhatIfFold a={a} />
    </section>
  );
}
