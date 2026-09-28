// The page: the masthead, the rail (a summary chip and a sheet on a phone), the front-page band,
// the tab switch and the active tab, each card inside its own Boundary.
//
// The app runs its six tabs as one script: st.stop() inside one (portfolio_app.py 1483, 1727)
// ends the run, and every tab after it renders nothing. Here each card fails alone and names
// itself; the band and the other tabs keep working.
import { useCallback, useState, type ComponentType } from "react";
import Band from "./chrome/Band.tsx";
import CommandPalette from "./chrome/CommandPalette.tsx";
import Footer from "./chrome/Footer.tsx";
import Masthead from "./chrome/Masthead.tsx";
import Rail from "./chrome/Rail.tsx";
import SummaryChip, { Sheet } from "./chrome/SummaryChip.tsx";
import { usePhone } from "./chrome/usePhone.ts";
import Boundary from "./components/Boundary.tsx";
import SegControl from "./components/SegControl.tsx";
import { useWorkbench } from "./state/useWorkbench.ts";
import Correlation from "./tabs/Correlation.tsx";
import Custom from "./tabs/Custom.tsx";
import Optimization from "./tabs/Optimization.tsx";
import Returns from "./tabs/Returns.tsx";
import Risk from "./tabs/Risk.tsx";
import Sensitivity from "./tabs/Sensitivity.tsx";
import { TAB_IDS, TAB_LABELS, type TabId, type TabProps, type Workbench } from "./types.ts";
import "./App.css";

export const TABS: Readonly<Record<TabId, ComponentType<TabProps>>> = {
  returns: Returns,
  risk: Risk,
  correlation: Correlation,
  optimization: Optimization,
  custom: Custom,
  sensitivity: Sensitivity,
};

const TAB_OPTIONS = TAB_IDS.map((id) => ({ value: id, label: TAB_LABELS[id] }));

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
  const ready = wb.analysis.status === "ready" ? wb.analysis.value : null;
  const Tab = tabs[wb.tab];

  return (
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
            <Band analysis={wb.analysis} level={wb.level} fetching={wb.fetching} failure={wb.failure} />
          </Boundary>
          {ready ? (
            <>
              <nav className="app-tabs" aria-label="Analysis tabs">
                <SegControl options={TAB_OPTIONS} value={wb.tab} onChange={wb.setTab} ariaLabel="Analysis" />
              </nav>
              <Boundary key={wb.tab} name={TAB_LABELS[wb.tab]} resetKey={ready}>
                <section className="app-tab" aria-label={TAB_LABELS[wb.tab]}>
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
            </>
          ) : null}
        </main>
      </div>
      <Footer />
      <CommandPalette level={wb.level} setLevel={wb.setLevel} tab={wb.tab} setTab={wb.setTab} />
    </div>
  );
}

export default function App() {
  return <AppView wb={useWorkbench()} />;
}
