// The page: the masthead, the basket bar (a summary chip and a sheet on a phone), the status line, the
// chapter row and the active chapter, each card inside its own Boundary.
//
// Five chapters hold the six tabs (CHAPTER_TABS in src/types.ts): a chapter renders its tabs one under
// the other, each tab in its own Boundary. The app's Custom tab is the Your mix panel inside Build's
// Optimization tab; an older link to it lands there (PartId). The Overview is the page's first screen (src/overview): the
// question, the answer, two cards, and who built it; it replaced the front-page band that sat above the
// chapters, and the band's job of saying why nothing is shown went to the status line (./chrome/Status.tsx).
//
// The app runs its six tabs as one script: st.stop() inside one (portfolio_app.py 1483, 1727)
// ends the run, and every tab after it renders nothing. Here each card fails alone and names
// itself; the other cards keep working. The page adds a seventh the app does not have,
// the walk-forward test, after the app's six.
//
// Each tab is its own chunk, and so is Recharts, which only the tabs draw with: the first paint
// needs the masthead, the basket bar and the Overview's words, none of which chart anything, and a chapter fetches
// only its own tabs' chunks. Once the analysis has drawn, every tab is fetched while the page is idle, so
// a later switch finds its chapter in memory and a deploy mid-visit cannot strand a tab whose chunk the
// new deployment no longer serves.
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ComponentType } from "react";
import CommandPaletteView from "./chrome/CommandPalette.tsx";
import FooterView from "./chrome/Footer.tsx";
import MastheadView from "./chrome/Masthead.tsx";
import BasketBarView, { SettingsSheetBody } from "./chrome/BasketBar.tsx";
import SummaryChip, { Sheet } from "./chrome/SummaryChip.tsx";
import { usePhone } from "./chrome/usePhone.ts";
import Boundary from "./components/Boundary.tsx";
import { ChartNote } from "./components/ChartFrame.tsx";
import SegControl, { tabId, tabPanelId } from "./components/SegControl.tsx";
import { TabContext, useWorkbench } from "./state/useWorkbench.ts";
import {
  CHAPTER_IDS, CHAPTER_LABELS, CHAPTER_TABS, TAB_IDS, TAB_LABELS, chapterOf,
  type Analysis, type ChapterId, type PartId, type TabContextValue, type TabId, type TabProps, type WalkView, type Workbench,
} from "./types.ts";
import Status from "./chrome/Status.tsx";
import Overview, { Question } from "./overview/Overview.tsx";
import "./App.css";

type TabModule = { default: ComponentType<TabProps> };

// The chrome renders again only when its own props change: an edited amount or custom weight leaves
// the masthead and the basket bar alone, and a new explanation level reaches only what shows it.
const CommandPalette = memo(CommandPaletteView);
const Footer = memo(FooterView);
const Masthead = memo(MastheadView);
const BasketBar = memo(BasketBarView);

// Whether the figures on screen were built with other settings than the bar now shows. The shorting
// switch and a typed rate reach the analysis a render after the bar (src/state/useWorkbench.ts), so
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

const CHAPTER_OPTIONS = CHAPTER_IDS.map((id) => ({ value: id, label: CHAPTER_LABELS[id] }));
// The chapter row's ids: pill `chapter-tab-<id>`, the panel it shows `chapter-panel-<id>`.
const CHAPTER_PREFIX = "chapter";
// Each part of a chapter (a tab's, or Your mix inside the Optimization tab's), which the palette and an older
// ?tab= link land on.
export const sectionId = (part: PartId): string => `section-${part}`;

// A request to land the reader on one tab's part of a chapter; a new `n` is a new request.
interface Focus {
  tab: PartId;
  n: number;
}

// Brings the requested part into view and moves focus to it, once per request. It renders after the
// chapter's tabs inside their Suspense, so its effect runs only once every chunk above it has arrived and
// the part sits where it will stay.
function Land({ focus }: { focus: Focus | null }) {
  const taken = useRef(0);
  useEffect(() => {
    if (!focus || focus.n <= taken.current) return;
    taken.current = focus.n;
    const el = document.getElementById(sectionId(focus.tab));
    if (!el) return;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
  }, [focus]);
  return null;
}

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
  const { setChapter, view, rfHistory } = wb;
  // The walk-forward tab opens on its first segment unless the caller names the other (the published
  // control in the Overview's hindsight card, the in-sample note on the Optimization tab).
  //
  // A caller that sits away from the tab (those two, and the tab's own rerun buttons) also asks to land the
  // reader on it: `landing` counts those asks, and the tab takes each one once (takeLanding), scrolling
  // itself into view and focusing its segment. The tab row and the palette never ask.
  const [landing, setLanding] = useState(0);
  const landed = useRef(0);
  const switchTab = useCallback(
    (id: TabId, to?: WalkView, land = false) =>
      startSwitch(() => {
        setChapter(chapterOf(id), to);
        if (land) setLanding((n) => n + 1);
      }),
    [setChapter],
  );
  const { setSettings } = wb;
  const setTickers = useCallback((tickers: string[]) => setSettings({ tickers }), [setSettings]);
  const switchChapter = useCallback((id: ChapterId) => startSwitch(() => setChapter(id)), [setChapter]);
  // An older link's tab is landed on once, when it is not already the top of its chapter; the palette's
  // jumps land every time.
  const [focus, setFocus] = useState<Focus | null>(() =>
    wb.entry && CHAPTER_TABS[chapterOf(wb.entry)][0] !== wb.entry ? { tab: wb.entry, n: 1 } : null,
  );
  const jump = useCallback(
    (id: PartId) =>
      startSwitch(() => {
        setChapter(chapterOf(id));
        setFocus((f) => ({ tab: id, n: (f?.n ?? 0) + 1 }));
      }),
    [setChapter],
  );
  const takeLanding = useCallback((n: number) => {
    if (n <= landed.current) return false;
    landed.current = n;
    return true;
  }, []);
  const reach = useMemo<TabContextValue>(
    () => ({ view, setTab: switchTab, rfHistory, landing, takeLanding }),
    [view, switchTab, rfHistory, landing, takeLanding],
  );

  // The analysis object is the identity a card's boundary resets on: new prices, a new rate or
  // the shorting switch make a new one, and a card that failed on the old one tries again.
  //
  // Only the active tab is mounted, so an edit never renders a tab the reader cannot see. Each card
  // inside renders again only when its own inputs change (memo on the cards and on the charts'
  // drawing components): an explanation level reaches the tooltips, an amount the growth charts.
  const ready = wb.analysis.status === "ready" ? wb.analysis.value : null;
  // The settings have changed and the analysis behind the Overview and the tabs has not caught up yet: they keep
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
  const chapterTabs = CHAPTER_TABS[wb.chapter];
  const drawn = ready !== null;
  useEffect(() => (drawn && tabs === TABS ? whenIdle(prefetchTabs) : undefined), [drawn, tabs]);

  return (
    <TabContext.Provider value={reach}>
      <div className="app">
        <Boundary name="Masthead">
          <Masthead />
        </Boundary>
        {phone ? (
          <Boundary name="Settings">
            <div className="app-chip">
              <SummaryChip settings={wb.settings} rf={wb.rf} open={sheet} onToggle={toggleSheet} analysis={wb.analysis} fetching={wb.fetching} />
            </div>
            {sheet ? (
              <Sheet onClose={closeSheet}>
                <SettingsSheetBody settings={wb.settings} setSettings={wb.setSettings} level={wb.level} setLevel={wb.setLevel} rf={wb.rf} />
              </Sheet>
            ) : null}
          </Boundary>
        ) : (
          <Boundary name="Settings">
            <BasketBar
              settings={wb.settings}
              setSettings={wb.setSettings}
              level={wb.level}
              setLevel={wb.setLevel}
              rf={wb.rf}
              fetching={wb.fetching}
              analysis={wb.analysis}
            />
          </Boundary>
        )}
        <div className="app-body">
          <main className="app-main">
            {/* Until an analysis is on screen the Overview asks its question over the status line, so a first
                visit never opens on a bare loading message. */}
            {!ready && wb.chapter === "overview" ? <Question /> : null}
            <Boundary name="Status">
              <Status analysis={wb.analysis} failure={wb.failure} />
            </Boundary>
            {ready ? (
              <>
                <nav className="app-tabs app-chapters" aria-label="Chapters">
                  <SegControl options={CHAPTER_OPTIONS} value={wb.chapter} onChange={switchChapter} ariaLabel="Chapters" idPrefix={CHAPTER_PREFIX} />
                </nav>
                {/* Above the keyed panel, so it outlives a switch: the transition then keeps the old chapter up
                    while the new chunks load, and only the first chapter ever shows this line. */}
                <Suspense fallback={<ChartNote kind="loading" height={320}>Loading {CHAPTER_LABELS[wb.chapter]}</ChartNote>}>
                  <section
                    key={wb.chapter}
                    className="app-chapter"
                    role="tabpanel"
                    id={tabPanelId(CHAPTER_PREFIX, wb.chapter)}
                    aria-labelledby={tabId(CHAPTER_PREFIX, wb.chapter)}
                    aria-busy={switching || settling || undefined}
                  >
                    {chapterTabs.length === 0 ? (
                      <Boundary name={CHAPTER_LABELS.overview} resetKey={ready}>
                        <Overview analysis={ready} amount={wb.settings.amount} level={wb.level} setTickers={setTickers} settling={settling} />
                      </Boundary>
                    ) : (
                      chapterTabs.map((id) => {
                        const Tab = tabs[id];
                        return (
                          <Boundary key={id} name={TAB_LABELS[id]} resetKey={ready}>
                            <div className="app-tab" id={sectionId(id)} data-section={id} tabIndex={-1}>
                              <Tab
                                analysis={ready}
                                settings={wb.settings}
                                level={wb.level}
                                weights={wb.weights}
                                setWeights={wb.setWeights}
                                requestSettings={wb.setSettings}
                              />
                            </div>
                          </Boundary>
                        );
                      })
                    )}
                    <Land focus={focus} />
                  </section>
                </Suspense>
              </>
            ) : null}
          </main>
        </div>
        <Footer />
        <CommandPalette level={wb.level} setLevel={wb.setLevel} chapter={wb.chapter} setChapter={switchChapter} jump={jump} />
      </div>
    </TabContext.Provider>
  );
}

export default function App() {
  return <AppView wb={useWorkbench()} />;
}
