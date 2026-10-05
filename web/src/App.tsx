// The page: the masthead, the rail (a summary chip and a sheet on a phone), the front-page band,
// the tab switch and the active tab, each card inside its own Boundary.
//
// The app runs its six tabs as one script: st.stop() inside one (portfolio_app.py 1483, 1727)
// ends the run, and every tab after it renders nothing. Here each card fails alone and names
// itself; the band and the other tabs keep working. The page adds a seventh the app does not have,
// the walk-forward test, after the app's six.
//
// Each tab is its own chunk, and so is Recharts, which only the tabs draw with: the first paint
// needs the masthead, the rail and the band, none of which chart anything. Once a tab has drawn,
// the others are fetched while the page is idle, so a later switch finds its tab in memory and
// a deploy mid-visit cannot strand a tab whose chunk the new deployment no longer serves.
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState, useTransition, type ComponentType } from "react";
import BandView from "./chrome/Band.tsx";
import CommandPaletteView from "./chrome/CommandPalette.tsx";
import FooterView from "./chrome/Footer.tsx";
import MastheadView from "./chrome/Masthead.tsx";
import RailView from "./chrome/Rail.tsx";
import SummaryChip, { Sheet } from "./chrome/SummaryChip.tsx";
import { usePhone } from "./chrome/usePhone.ts";
import Boundary from "./components/Boundary.tsx";
import { ChartNote } from "./components/ChartFrame.tsx";
import SegControl, { tabId, tabPanelId } from "./components/SegControl.tsx";
import { TabContext, useWorkbench } from "./state/useWorkbench.ts";
import { TAB_IDS, TAB_LABELS, type Analysis, type TabContextValue, type TabId, type TabProps, type WalkView, type Workbench } from "./types.ts";
import "./App.css";

type TabModule = { default: ComponentType<TabProps> };

// The chrome renders again only when its own props change: an edited amount or custom weight leaves
// the masthead, the rail and the band alone, and a new explanation level reaches only what shows it.
const Band = memo(BandView);
const CommandPalette = memo(CommandPaletteView);
const Footer = memo(FooterView);
const Masthead = memo(MastheadView);
const Rail = memo(RailView);

// Whether the figures on screen were built with other settings than the rail now shows. The shorting
// switch and a typed rate reach the analysis a render after the rail (src/state/useWorkbench.ts), so
// for that moment the two disagree: the switch against the analysis' shorting, a typed rate against
// its rate, and a cleared field against an analysis still scored at the rate that was typed.
export function settlingOf(wb: Workbench, a: Analysis | null): boolean {
  if (!a) return false;
  if (a.allowShort !== wb.settings.allowShort) return true;
  const typed = wb.settings.rf;
  return typed !== null ? a.rf !== typed : a.rfSource === "manual";
}

// Where each tab's code lives. A dynamic import is the only reference App makes to a tab: a static
// one would pull that tab, and Recharts with it, back into the first chunk (test/t-split.mjs).
export const TAB_LOADERS: Readonly<Record<TabId, () => Promise<TabModule>>> = {
  returns: () => import("./tabs/Returns.tsx"),
  risk: () => import("./tabs/Risk.tsx"),
  correlation: () => import("./tabs/Correlation.tsx"),
  optimization: () => import("./tabs/Optimization.tsx"),
  custom: () => import("./tabs/Custom.tsx"),
  sensitivity: () => import("./tabs/Sensitivity.tsx"),
  walkforward: () => import("./tabs/WalkForward.tsx"),
};

// A chunk that fails to load throws into the tab's Boundary, which names the tab. React.lazy keeps
// that failure for the life of the page, so the tab stays failed until a reload.
export const TABS: Readonly<Record<TabId, ComponentType<TabProps>>> = {
  returns: lazy(TAB_LOADERS.returns),
  risk: lazy(TAB_LOADERS.risk),
  correlation: lazy(TAB_LOADERS.correlation),
  optimization: lazy(TAB_LOADERS.optimization),
  custom: lazy(TAB_LOADERS.custom),
  sensitivity: lazy(TAB_LOADERS.sensitivity),
  walkforward: lazy(TAB_LOADERS.walkforward),
};

// The other tabs' chunks, fetched once the page is idle. A failure is left for the tab's own
// Boundary to report if the reader ever opens it.
function prefetchTabs() {
  for (const id of TAB_IDS) TAB_LOADERS[id]().catch(() => {});
}

function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(fn, { timeout: 3000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(fn, 1500);
  return () => window.clearTimeout(handle);
}

// Runs fn at the start of the next frame, after the one being prepared has painted; returns the cancel.
// A surface with no frames (a test's DOM without them) waits about one frame's worth of time instead.
function nextFrame(fn: () => void): () => void {
  if (typeof window.requestAnimationFrame === "function") {
    const handle = window.requestAnimationFrame(fn);
    return () => window.cancelAnimationFrame(handle);
  }
  const handle = window.setTimeout(fn, 16);
  return () => window.clearTimeout(handle);
}

const TAB_OPTIONS = TAB_IDS.map((id) => ({ value: id, label: TAB_LABELS[id] }));
// The tab row's ids: pill `analysis-tab-<id>`, the panel it shows `analysis-panel-<id>`.
const TAB_PREFIX = "analysis";

export interface AppViewProps {
  /** The page's state (useWorkbench in the app; a stand-in in test/t-app.mjs). */
  wb: Workbench;
  /** The tab components; a suite swaps one for a tab that throws. */
  tabs?: Readonly<Record<TabId, ComponentType<TabProps>>>;
}

export function AppView({ wb, tabs = TABS }: AppViewProps) {
  const phone = usePhone();
  const [sheet, setSheet] = useState(false);
  const closeSheet = useCallback(() => setSheet(false), []);
  const toggleSheet = useCallback(() => setSheet((s) => !s), []);
  // A switch is a transition: the tab on screen stays (dimmed) until the next one's chunk is in,
  // instead of the panel blanking to a loading line. A prefetched tab arrives at once.
  const [switching, startSwitch] = useTransition();
  const { setTab, view, rfHistory } = wb;
  // The walk-forward tab opens on its first segment unless the caller names the other (the published
  // strip in the band, the in-sample note on the Optimization tab).
  const switchTab = useCallback((id: TabId, to?: WalkView) => startSwitch(() => setTab(id, to)), [setTab]);
  const reach = useMemo<TabContextValue>(() => ({ view, setTab: switchTab, rfHistory }), [view, switchTab, rfHistory]);

  const rail = (
    <Rail
      settings={wb.settings}
      setSettings={wb.setSettings}
      level={wb.level}
      setLevel={wb.setLevel}
      rf={wb.rf}
      fetching={wb.fetching}
      failure={wb.failure}
    />
  );
  // The analysis object is the identity a card's boundary resets on: new prices, a new rate or
  // the shorting switch make a new one, and a card that failed on the old one tries again.
  //
  // Only the active tab is mounted, so an edit never renders a tab the reader cannot see. Each card
  // inside renders again only when its own inputs change (memo on the cards and on the charts'
  // drawing components): an explanation level reaches the tooltips, an amount the growth charts.
  const ready = wb.analysis.status === "ready" ? wb.analysis.value : null;
  // The rail has changed and the analysis behind the band and the tab has not caught up yet: both keep
  // the previous figures, marked the same way as a tab switch (aria-busy and the dim), so no figure
  // from the old settings sits unmarked beside the new ones.
  //
  // The mark outlives the render that lands the rebuilt analysis by one frame. That render commits at
  // transition priority, so its passive effects run after it has painted, and the charts' own store
  // (Recharts keeps each chart's scales there) takes the new figures only in those effects: for one
  // painted frame a chart would draw the new points on the previous setting's axes. `held` keeps the
  // mark on through that frame and lets it go on the next. Only a settle ever sets it, so a cold load,
  // whose first analysis already matches the rail, never dims.
  const behind = settlingOf(wb, ready);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (behind) {
      setHeld(true);
      return undefined;
    }
    return nextFrame(() => setHeld(false));
  }, [behind, ready]);
  const settling = behind || held;
  const Tab = tabs[wb.tab];
  const drawn = ready !== null;
  useEffect(() => (drawn && tabs === TABS ? whenIdle(prefetchTabs) : undefined), [drawn, tabs]);

  return (
    <TabContext.Provider value={reach}>
      <div className="app">
        <Boundary name="Masthead" resetKey={ready}>
          <Masthead analysis={wb.analysis} fetching={wb.fetching} />
        </Boundary>
        <div className="app-body">
          {phone ? (
            <Boundary name="Settings">
              <div className="app-chip">
                <SummaryChip settings={wb.settings} rf={wb.rf} open={sheet} onToggle={toggleSheet} />
              </div>
              {sheet ? <Sheet onClose={closeSheet}>{rail}</Sheet> : null}
            </Boundary>
          ) : (
            <aside className="app-rail" aria-label="Settings">
              <Boundary name="Settings">{rail}</Boundary>
            </aside>
          )}
          <main className="app-main">
            <Boundary name="Snapshot" resetKey={ready}>
              <Band analysis={wb.analysis} level={wb.level} fetching={wb.fetching} failure={wb.failure} settling={settling} />
            </Boundary>
            {ready ? (
              <>
                <nav className="app-tabs" aria-label="Analysis tabs">
                  <SegControl options={TAB_OPTIONS} value={wb.tab} onChange={switchTab} ariaLabel="Analysis" idPrefix={TAB_PREFIX} />
                </nav>
                {/* Above the keyed Boundary, so it outlives a switch: the transition then keeps the old
                    tab up while the new chunk loads, and only the first tab ever shows this line. */}
                <Suspense fallback={<ChartNote kind="loading" height={320}>Loading {TAB_LABELS[wb.tab]}</ChartNote>}>
                  <Boundary key={wb.tab} name={TAB_LABELS[wb.tab]} resetKey={ready}>
                    <section
                      className="app-tab"
                      role="tabpanel"
                      id={tabPanelId(TAB_PREFIX, wb.tab)}
                      aria-labelledby={tabId(TAB_PREFIX, wb.tab)}
                      aria-busy={switching || settling || undefined}
                    >
                      <Tab
                        analysis={ready}
                        settings={wb.settings}
                        level={wb.level}
                        weights={wb.weights}
                        setWeights={wb.setWeights}
                        requestSettings={wb.setSettings}
                      />
                    </section>
                  </Boundary>
                </Suspense>
              </>
            ) : null}
          </main>
        </div>
        <Footer />
        <CommandPalette level={wb.level} setLevel={wb.setLevel} tab={wb.tab} setTab={switchTab} />
      </div>
    </TabContext.Provider>
  );
}

export default function App() {
  return <AppView wb={useWorkbench()} />;
}
