// The Walk-forward tab, the one tab the app does not have: weights chosen on earlier prices and held over
// later ones, which is what the in-sample figures on the other tabs never show. Two segments sit under the
// heading:
//   "Your basket"   the test run on the basket in the rail (./walkforward/Live.tsx), what the tab opens on;
//   "As published"  the published test replayed from the weights it held (./walkforward/Published.tsx).
//
// The segment is the page's, not this tab's (src/state/useWorkbench.ts): the published strip in the band and
// the in-sample note on the Optimization tab open this tab on "As published", and a link carrying
// view=published does too. Rendered on its own, outside the page, the tab keeps the segment itself.
//
// Those ways in, and a set's rerun button, ask the page to LAND the reader here: the tab is scrolled to the
// top of the view and the segment's own tab takes the focus, because the control that was clicked has just
// left the page (or sits far from where the segment opens) and would otherwise leave the reader looking at
// nothing new, with the focus on the document. A switch made here, by the segment row or the tab row, does not.
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Boundary from "../components/Boundary.tsx";
import SegControl, { tabId, tabPanelId } from "../components/SegControl.tsx";
import Slug from "../components/Slug.tsx";
import { DEFAULT_START } from "../state/defaults.ts";
import { windowRate } from "../state/rfwindow.ts";
import { TabContext } from "../state/useWorkbench.ts";
import type { Analysis, RfHistory, Settings, TabProps, WalkRates, WalkView } from "../types.ts";
import Live from "./walkforward/Live.tsx";
import Published from "./walkforward/Published.tsx";
import { dayAfter, PUBLISHED_LAST_BAR, PUBLISHED_RF } from "./walkforward/terms.ts";
import "./walkforward/WalkForward.css";

export const SEGMENTS: readonly { value: WalkView; label: string }[] = [
  { value: "basket", label: "Your basket" },
  { value: "published", label: "As published" },
];

// The segment ids: pill `walkforward-tab-<segment>`, the panel it shows `walkforward-panel-<segment>`.
const PREFIX = "walkforward";

// The run the published test used, its last bar and its rate, and the day after a bar: read from the stored
// record of the run in a leaf module (./walkforward/terms.ts) and re-exported here.
export { dayAfter, PUBLISHED_LAST_BAR, PUBLISHED_RF };

/** The rail's settings for "Rerun this set on fresh prices": the set's tickers on the published run's terms. */
export function rerunSettings(tickers: readonly string[]): Partial<Settings> {
  return { tickers: [...tickers], start: DEFAULT_START, end: dayAfter(PUBLISHED_LAST_BAR), rf: PUBLISHED_RF, allowShort: false };
}

/**
 * The rate input for the test on the reader's basket (src/types.ts WalkRates). The daily series is used
 * when it starts on or before the analysis' first price day and has an observation inside the window, the
 * rule the rail's window rate is held to (windowRate, src/state/rfwindow.ts), and no rate is set in the
 * rail; days after its last observation carry that one forward. Otherwise the test runs flat at the
 * analysis' own rate and `flat` names why.
 */
export function walkRates(h: RfHistory | null, a: Analysis): WalkRates {
  const basis = h?.basis ?? (a.rfSource === "manual" ? "manual" : "fallback");
  if (a.rfSource === "manual") return { basis, points: null, flat: "typed" };
  if (!h?.series) return { basis, points: null, flat: h?.loading ? "loading" : "unavailable" };
  if (!windowRate(h.series, a.prices.dates[0], a.asOf)) return { basis, points: null, flat: h.loading ? "loading" : "uncovered" };
  return { basis, points: h.series.series, flat: null };
}

export default function WalkForward({ analysis, settings, level, requestSettings }: TabProps) {
  const page = useContext(TabContext);
  const [own, setOwn] = useState<WalkView>("basket");
  const view = page ? page.view : own;
  const go = page?.setTab;
  const show = useCallback((v: WalkView, land = false) => (go ? go("walkforward", v, land) : setOwn(v)), [go]);
  const pick = useCallback((v: WalkView) => show(v), [show]);
  const history = page?.rfHistory ?? null;
  const rates = useMemo(() => walkRates(history, analysis), [history, analysis]);
  const rerun = useCallback(
    (tickers: readonly string[]) => {
      requestSettings(rerunSettings(tickers));
      show("basket", true);
    },
    [requestSettings, show],
  );
  const label = SEGMENTS.find((s) => s.value === view)?.label ?? "";

  // Each landing the page asks for is taken once, by whichever render of this tab sees it first (the tab may
  // mount only after its chunk arrives); a remount for any other reason finds it taken and leaves the scroll be.
  const root = useRef<HTMLDivElement>(null);
  const landing = page?.landing ?? 0;
  const take = page?.takeLanding;
  useEffect(() => {
    if (!landing || !take?.(landing)) return;
    const el = root.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
    document.getElementById(tabId(PREFIX, view))?.focus({ preventScroll: true });
    // Only a new landing runs this; the segment it reads is the one the same switch set.
  }, [landing, take]);

  return (
    <div className="wf" ref={root}>
      <Slug>Walk-forward test</Slug>
      <p className="wf-dek">
        Weights chosen on earlier prices and then held, unchanged, over the days after them: what a fitted portfolio earned on
        days it had not seen.
      </p>
      <SegControl options={SEGMENTS} value={view} onChange={pick} ariaLabel="Walk-forward" idPrefix={PREFIX} />
      <section className="wf-panel" role="tabpanel" id={tabPanelId(PREFIX, view)} aria-labelledby={tabId(PREFIX, view)}>
        <Boundary key={view} name={label} resetKey={analysis}>
          {view === "published" ? (
            <Published level={level} rerun={rerun} />
          ) : (
            <Live analysis={analysis} settings={settings} level={level} rates={rates} />
          )}
        </Boundary>
      </section>
    </div>
  );
}
