// The basket bar: what the page is analysing, in one row that stays at the top of the screen. The tickers
// as chips (each with its remove button), "+ Add" for typing more, a Baskets menu of the ready-made sets,
// the dates, the Assumptions drawer (the rate, the benchmark, shorting, the amount) and, at the right, the
// day the prices run to.
//
// The panels hold the same fields as the phone's sheet (./Settings.tsx), so a ticker typed in either goes
// through the same checks. One panel is open at a time; Escape, a click outside the bar, or the panel's own
// button close it, and Escape hands focus back to that button. A refused list opens the tickers' panel, so
// its message is never out of sight: removing a chip from a basket of three says why it stayed.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ASSUMPTIONS } from "../content/inputs.ts";
import { format } from "../format.ts";
import { benchDisplay } from "../state/defaults.ts";
import type { Analysis, Level, LoadState, RfRate, Settings } from "../types.ts";
import { AmountGroup, BenchField, DateFields, LevelField, PresetList, RfField, ShortField, TickerField, rateInUse, useTickers } from "./Settings.tsx";
import { monthYear } from "./when.ts";
import "./BasketBar.css";

export interface BasketBarProps {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  level: Level;
  setLevel: (l: Level) => void;
  rf: LoadState<RfRate>;
  /** A price request is in flight. */
  fetching: boolean;
  /** The analysis on screen: the day its prices run to, and whether it is the saved example. */
  analysis: LoadState<Analysis>;
}

type Panel = "tickers" | "baskets" | "dates";

/** "Jan 2019 – today", the window as the bar's dates button prints it. */
export function windowLabel(settings: Settings): string {
  return `${monthYear(settings.start)} – ${settings.end === null ? "today" : monthYear(settings.end)}`;
}

/** "S&P 500 · rf 2.85% · long only", what the Assumptions button says is set. */
export function assumptionsLabel(settings: Settings, rf: LoadState<RfRate>): string {
  const rate = rateInUse(settings, rf);
  return `${benchDisplay(settings.benchmark)} · rf ${rate === null ? "loading" : format(rate, "pct2")} · ${settings.allowShort ? "shorting on" : "long only"}`;
}

/** The line at the bar's right: the prices' last day, whether it is the example, whether new prices are coming. */
export function PricesLine({ analysis, fetching, className }: { analysis: LoadState<Analysis>; fetching: boolean; className: string }) {
  const a = analysis.status === "ready" ? analysis.value : null;
  return (
    <p className={className} aria-live="polite">
      {a ? <span>Prices to {format(a.asOf, "date")}</span> : fetching ? <span>Fetching prices</span> : null}
      {a && a.source === "example" ? <span className="prices-tag prices-tag-example">{"· "}example</span> : null}
      {a && fetching ? <span className="prices-tag prices-tag-updating">{"· "}updating</span> : null}
    </p>
  );
}

function PanelButton({ id, open, onToggle, className, children }: { id: string; open: boolean; onToggle: () => void; className: string; children: ReactNode }) {
  return (
    <button type="button" className={className} aria-expanded={open} aria-controls={id} data-panel-button={id} onClick={onToggle}>
      {children}
    </button>
  );
}

export default function BasketBar({ settings, setSettings, level, setLevel, rf, fetching, analysis }: BasketBarProps) {
  const uid = useId();
  const ids = { tickers: `${uid}-tickers`, baskets: `${uid}-baskets`, dates: `${uid}-dates`, drawer: `${uid}-drawer` };
  const t = useTickers(settings, setSettings);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [drawer, setDrawer] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // A refused list opens the tickers' panel, so its message is in sight.
  useEffect(() => {
    if (t.error !== null) setPanel("tickers");
  }, [t.error]);

  // Opening "+ Add" leaves the cursor after the list, ready for the next ticker.
  useEffect(() => {
    if (panel !== "tickers") return;
    const box = t.box.current;
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [panel, t.box]);

  // A click outside the bar closes an open panel.
  useEffect(() => {
    if (panel === null) return;
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setPanel(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [panel]);

  function toggle(p: Panel) {
    if (panel === p) {
      setPanel(null);
      return;
    }
    if (p === "tickers" && t.draft === settings.tickers.join(", ")) t.setDraft(`${t.draft}, `);
    setPanel(p);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || panel === null) return;
    e.stopPropagation();
    const was = panel;
    setPanel(null);
    root.current?.querySelector<HTMLButtonElement>(`[data-panel-button="${ids[was]}"]`)?.focus();
  }

  const remove = (ticker: string) => t.apply(settings.tickers.filter((x) => x !== ticker).join(", "));

  return (
    <div className="bar" ref={root} onKeyDown={onKeyDown}>
      <div className="bar-row">
        <ul className="bar-chips" aria-label="Tickers in the basket">
          {settings.tickers.map((ticker) => (
            <li className="bar-chip" key={ticker}>
              <span className="num">{ticker}</span>
              <button type="button" className="bar-chip-x" aria-label={`Remove ${ticker}`} onClick={() => remove(ticker)}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <span className="bar-anchor">
          <PanelButton id={ids.tickers} open={panel === "tickers"} onToggle={() => toggle("tickers")} className="bar-add">
            + Add
          </PanelButton>
          <div className="bar-panel set" id={ids.tickers} hidden={panel !== "tickers"}>
            <TickerField t={t} />
          </div>
        </span>
        <span className="bar-sep" aria-hidden="true" />
        <span className="bar-anchor">
          <PanelButton id={ids.baskets} open={panel === "baskets"} onToggle={() => toggle("baskets")} className="bar-button">
            Baskets <span aria-hidden="true">▾</span>
          </PanelButton>
          <div className="bar-panel bar-panel--wide set" id={ids.baskets} hidden={panel !== "baskets"}>
            <PresetList
              onPick={(p) => {
                setPanel(null);
                t.apply(p.tickers);
              }}
            />
          </div>
        </span>
        <span className="bar-anchor">
          <PanelButton id={ids.dates} open={panel === "dates"} onToggle={() => toggle("dates")} className="bar-button">
            <span className="num">{windowLabel(settings)}</span>
          </PanelButton>
          <div className="bar-panel set" id={ids.dates} hidden={panel !== "dates"}>
            <DateFields settings={settings} setSettings={setSettings} />
          </div>
        </span>
        <button
          type="button"
          className="bar-button bar-assumptions"
          aria-expanded={drawer}
          aria-controls={ids.drawer}
          onClick={() => {
            setPanel(null);
            setDrawer(!drawer);
          }}
        >
          {ASSUMPTIONS}
          <span className="bar-assumptions-sum">{assumptionsLabel(settings, rf)}</span>
        </button>
        <PricesLine analysis={analysis} fetching={fetching} className="bar-prices" />
      </div>
      <div className="bar-drawer set" id={ids.drawer} hidden={!drawer}>
        {drawer ? (
          <>
            <RfField settings={settings} setSettings={setSettings} rf={rf} />
            <BenchField settings={settings} setSettings={setSettings} />
            <ShortField settings={settings} setSettings={setSettings} />
            <AmountGroup settings={settings} setSettings={setSettings} />
            <LevelField level={level} setLevel={setLevel} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Every group inline, bar then drawer: the phone's sheet. */
export function SettingsSheetBody({ settings, setSettings, level, setLevel, rf }: Omit<BasketBarProps, "fetching" | "analysis">) {
  const t = useTickers(settings, setSettings);
  return (
    <div className="set set-stack">
      <TickerField t={t} />
      <PresetList onPick={(p) => t.apply(p.tickers)} />
      <DateFields settings={settings} setSettings={setSettings} />
      <RfField settings={settings} setSettings={setSettings} rf={rf} />
      <BenchField settings={settings} setSettings={setSettings} />
      <ShortField settings={settings} setSettings={setSettings} />
      <AmountGroup settings={settings} setSettings={setSettings} />
      <LevelField level={level} setLevel={setLevel} />
    </div>
  );
}
