// Does it hold up?'s first half: the walk-forward test, the one analysis the app does not have: weights chosen on
// earlier prices and held over later ones, which is what the in-sample figures in the other chapters never show.
// The chapter states its finding (counted from the published strings, ./holdup.ts), then leads with the published
// test's card (./walkforward/Published.tsx): the chart of the nine pairs, the project card's sentence word for word as
// its caption. A More list holds the rest:
//   "Your basket"   the test run on the basket in the bar (./walkforward/Live.tsx), solved only once the row opens;
//   "Hold by hold"  each published set's holds, the weights they held and its rerun button.
//
// Some ways in ask the page to LAND the reader here, because the control that was clicked has just left the screen:
// the Overview's published control and the in-sample note in Build land on the lead (the finding takes the focus);
// the Overview's "Run the same test" and a set's rerun button open Your basket and land on that row (its button
// takes the focus). Which one is the page's walk-forward view (src/state/useWorkbench.ts), which a link carrying
// view=published also sets. A switch made by the chapter row does not land.
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import Boundary from "../components/Boundary.tsx";
import MoreList, { openMore, type MoreRow } from "../components/MoreList.tsx";
import { DEFAULT_START } from "../state/defaults.ts";
import { windowRate } from "../state/rfwindow.ts";
import { TabContext } from "../state/useWorkbench.ts";
import type { Analysis, RfHistory, Settings, TabProps, WalkRates } from "../types.ts";
import { basketFinding, holdsFinding, holdupFinding, holdupSub, WF_HEADING, WF_LIST, WF_ROWS } from "./holdup.ts";
import { said } from "./performance.ts";
import Live from "./walkforward/Live.tsx";
import Published, { Holds } from "./walkforward/Published.tsx";
import { dayAfter, PUBLISHED_LAST_BAR, PUBLISHED_RF } from "./walkforward/terms.ts";
import "./walkforward/WalkForward.css";

// The finding's id: the lead's landing focuses it.
export const FINDING_ID = "wf-finding";

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
  const go = page?.setTab;
  const history = page?.rfHistory ?? null;
  const rates = useMemo(() => walkRates(history, analysis), [history, analysis]);
  const rerun = useCallback(
    (tickers: readonly string[]) => {
      requestSettings(rerunSettings(tickers));
      if (go) go("walkforward", "basket", true);
      else openMore(WF_LIST, "basket");
    },
    [requestSettings, go],
  );

  // Each landing the page asks for is taken once, by whichever render of this tab sees it first (the tab may
  // mount only after its chunk arrives); a remount for any other reason finds it taken and leaves the scroll be.
  const root = useRef<HTMLDivElement>(null);
  const landing = page?.landing ?? 0;
  const take = page?.takeLanding;
  const view = page?.view ?? "basket";
  useEffect(() => {
    if (!landing || !take?.(landing)) return;
    if (view === "basket") openMore(WF_LIST, "basket");
    // Looked up inside this part, never by document id: only its own row and finding are landed on.
    const own = root.current;
    const el = view === "basket" ? own?.querySelector<HTMLElement>(`#${WF_LIST}-basket`) : own;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
    const target = view === "basket" ? el?.querySelector<HTMLElement>(".more-button") : own?.querySelector<HTMLElement>(`#${FINDING_ID}`);
    target?.focus({ preventScroll: true });
    // Only a new landing runs this; the view it reads is the one the same switch set.
  }, [landing, take]);

  const rows: MoreRow[] = [
    {
      key: "basket",
      title: WF_ROWS.basket,
      finding: basketFinding(),
      children: (
        <Boundary name="Your basket" resetKey={analysis}>
          <Live analysis={analysis} settings={settings} level={level} rates={rates} />
        </Boundary>
      ),
    },
    {
      key: "holds",
      title: WF_ROWS.holds,
      finding: said(WF_ROWS.holds, holdsFinding),
      children: (
        <Boundary name="Hold by hold" resetKey={analysis}>
          <Holds rerun={rerun} />
        </Boundary>
      ),
    },
  ];

  return (
    <div className="wf" ref={root}>
      <header className="wf-lead">
        <h2 className="tab-finding wf-finding" id={FINDING_ID} tabIndex={-1}>
          {said("The walk-forward finding", holdupFinding)}
        </h2>
        <p className="wf-dek">{said("The walk-forward sub-line", holdupSub)}</p>
      </header>
      <Boundary name="As published" resetKey={analysis}>
        <Published level={level} />
      </Boundary>
      <MoreList id={WF_LIST} rows={rows} heading={WF_HEADING} />
    </div>
  );
}
