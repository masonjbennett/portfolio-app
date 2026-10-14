// The settings' fields: every input of the app's sidebar (portfolio_app.py 645-759), one group each, for the
// basket bar's panels, the Assumptions drawer and the phone's sheet to place. No Run button (761): a change
// applies at once. Fields that would fetch prices on every keystroke (tickers, dates) keep a draft and commit
// only a request the app's own checks (1009-1021, validateRequest) accept; a rejected one stays in the field
// with the app's message under it and nothing is fetched.
//
// The tickers' draft lives in a hook (useTickers) rather than in the field, because three things commit
// through it: the field, a preset, and a chip's remove button on the bar. All three go through the same
// checks and leave their message in the same place.
//
// Two departures from the sidebar's content. The presets open on the three published sets, marked, with the
// app's own under "More baskets". The starting amount is here and on the growth charts, one setting.
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import AmountField from "../components/AmountField.tsx";
import SegControl from "../components/SegControl.tsx";
import { INPUT_HEADINGS, type InputId } from "../content/inputs.ts";
import { SYMBOL } from "../data/prices.ts";
import { format } from "../format.ts";
import { MAX_TICKERS, parseTickers, validateRequest } from "../lib/clean.ts";
import { TN_WARN, TRADING_DAYS } from "../lib/stats.ts";
import { MESSAGES } from "../state/analyze.ts";
import { BENCHMARKS, MORE_PRESETS, PUBLISHED_PRESETS, RF_FALLBACK, RF_STEP, type Preset } from "../state/defaults.ts";
import { isRfView } from "../state/rfwindow.ts";
import { LEVELS, type Level, type LoadState, type RfRate, type Settings } from "../types.ts";
import { todayISO } from "./when.ts";
import "./Settings.css";

const LEVEL_OPTIONS: { value: Level; label: string }[] = LEVELS.map((l) => ({ value: l.id, label: l.label }));

type SetSettings = (patch: Partial<Settings>) => void;

// Typing a year into a date field passes through 0002, 0020 and 0201, each a valid date and each
// a price request. A date is committed once its year has four digits. This is not a floor on the
// data: the start field sets none (the app's picker stopped at 2009-01-01, its default of the value
// minus ten years, 702).
function complete(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number(iso.slice(0, 4)) >= 1000;
}

// Why a typed symbol is refused, in the reader's terms.
export function symbolMessage(symbol: string): string {
  return `"${symbol}" is not a Yahoo Finance symbol. Symbols use letters, digits, ".", "-" and "=", with an optional leading "^" (BRK-B, EURUSD=X, ^GSPC).`;
}

// Why a list of `n` tickers stops at the cap, in the terms of the what-if panel's estimation lines: the
// shortest window the page estimates on is one year of trading days, and below TN_WARN days of returns
// per asset its weights rest on thin data (loadVerdict's "warn", src/lib/stats.ts). Every figure is read
// from those constants and the count, so the sentence follows them if they move; the constants are
// parameters, defaulted to the shipping ones, so a check can move them without touching the engine.
// Null within the cap, and null when the cap itself would leave that window thin or `n` would not: the
// window would then not be the reason.
export function capReason(n: number, cap = MAX_TICKERS, days = TRADING_DAYS, thin = TN_WARN): string | null {
  if (n <= cap || days / n >= thin || days / cap < thin) return null;
  const perAsset = (k: number) => (days / k).toFixed(1);
  return (
    `The shortest window the page estimates on, one year, has ${days} days of returns: ${perAsset(cap)} days per asset ` +
    `at ${cap} tickers but ${perAsset(n)} at ${n}, below the ${thin} under which the optimizer's weights rest on thin data.`
  );
}

// The first MAX_TICKERS distinct tickers of a typed list, in the order typed.
export function firstTickers(input: string): string[] {
  return parseTickers(input).slice(0, MAX_TICKERS);
}

// A decimal rate as the percent the field shows: 0.0389 -> "3.89".
function pctText(rate: number): string {
  return String(Number((rate * 100).toFixed(4)));
}

// The rate the page is using: the typed one, else the one the workbench scored the numbers on screen
// against (by default the mean over the window), else today's, else the placeholder the page falls
// back to when the live lookup fails (711). null while the lookup is still out.
export function rateInUse(settings: Settings, rf: LoadState<RfRate>): number | null {
  if (settings.rf !== null) return settings.rf;
  if (rf.status === "ready") return isRfView(rf.value) ? rf.value.inUse : rf.value.rate;
  return rf.status === "loading" ? null : RF_FALLBACK;
}

// One group: its heading (INPUT_HEADINGS, which the guide files its entries under) and its fields.
export function Group({ input, children }: { input: InputId; children: ReactNode }) {
  const id = useId();
  return (
    <section className="set-group" data-input={input} aria-labelledby={`${id}-h`}>
      <h2 className="set-heading" id={`${id}-h`}>
        {INPUT_HEADINGS[input]}
      </h2>
      {children}
    </section>
  );
}

// ---- tickers (670-697) ------------------------------------------------------------------------------------------

export interface Tickers {
  draft: string;
  setDraft: (v: string) => void;
  error: string | null;
  /** The cap's reason, when the last refused list had too many. */
  reason: string | null;
  /** The last refused list was over the cap: the way out shows. */
  overCap: boolean;
  /** Check a typed list and apply it, or leave the message. */
  commit: (input: string) => void;
  /** Keep the first MAX_TICKERS of the draft, through the same checks. */
  keepFirst: () => void;
  /** Put a list in the box and apply it, as typing it would. */
  apply: (list: string) => void;
  box: RefObject<HTMLInputElement>;
}

export function useTickers(settings: Settings, setSettings: SetSettings): Tickers {
  const endValue = settings.end ?? todayISO();
  const committed = settings.tickers.join(", ");
  const [draft, setDraft] = useState(committed);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  // How many distinct tickers the last refused list had, when it was refused for having too many: the
  // reason and the way out show under the app's message only then.
  const [overCap, setOverCap] = useState<number | null>(null);
  useEffect(() => {
    setDraft(committed);
    setError(null);
    setOverCap(null);
  }, [committed]);

  function commit(input: string) {
    const tickers = parseTickers(input);
    const bad = validateRequest(tickers, settings.start, endValue);
    setOverCap(bad === "too-many" ? tickers.length : null);
    if (bad === "too-few" || bad === "too-many") {
      setError(MESSAGES[bad]);
      return;
    }
    // The app hands any string to yfinance (1007). The price endpoint takes Yahoo's alphabet only
    // (SYMBOL), so a symbol outside it is named here instead of coming back as a failed request.
    const odd = tickers.find((t) => !SYMBOL.test(t));
    if (odd !== undefined) {
      setError(symbolMessage(odd));
      return;
    }
    setError(null);
    if (tickers.join(",") !== settings.tickers.join(",")) setSettings({ tickers });
  }

  function apply(list: string) {
    setDraft(list);
    commit(list);
  }

  // The way out of a list that is too long: the box keeps its first MAX_TICKERS distinct tickers and is
  // applied exactly as if they had been typed, through the same checks. The button goes with the message,
  // so the keyboard is handed back to the box rather than dropped on the page.
  function keepFirst() {
    apply(firstTickers(draft).join(", "));
    box.current?.focus();
  }

  return { draft, setDraft, error, reason: overCap === null ? null : capReason(overCap), overCap: overCap !== null, commit, keepFirst, apply, box };
}

export function TickerField({ t }: { t: Tickers }) {
  const id = useId();
  return (
    <Group input="tickers">
      <div className="set-field">
        <label htmlFor={`${id}-tickers`}>Enter 3–10 tickers (comma-separated)</label>
        <input
          id={`${id}-tickers`}
          name="tickers"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          ref={t.box}
          value={t.draft}
          aria-invalid={t.error !== null}
          aria-describedby={`${id}-tickers-note`}
          onChange={(e) => t.setDraft(e.target.value)}
          onBlur={(e) => t.commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") t.commit(e.currentTarget.value);
          }}
        />
        {/* The reason sits inside the message, so the alert that reads the message reads it too, and the
            field's description is the one element. */}
        <p className={t.error ? "set-error" : "set-note"} id={`${id}-tickers-note`} role={t.error ? "alert" : undefined}>
          {t.error ?? "Example: AAPL, MSFT, GOOGL. Press Enter to apply."}
          {t.reason ? <span className="set-why"> {t.reason}</span> : null}
        </p>
        {t.overCap ? (
          <button type="button" className="set-link set-link--target" onClick={t.keepFirst}>
            Keep the first {MAX_TICKERS}
          </button>
        ) : null}
      </div>
    </Group>
  );
}

// The ready-made baskets: the three published sets, marked, then the app's own under "More baskets".
export function PresetList({ onPick }: { onPick: (p: Preset) => void }) {
  const presetButton = (p: Preset, published: boolean) => (
    <button key={p.name} type="button" className={published ? "set-preset set-preset-published" : "set-preset"} onClick={() => onPick(p)}>
      <span className="set-preset-name">{p.name}</span>
      <span className="set-preset-desc">{p.desc}</span>
    </button>
  );
  return (
    <Group input="baskets">
      <p className="set-note">The published sets:</p>
      <div className="set-presets">{PUBLISHED_PRESETS.map((p) => presetButton(p, true))}</div>
      <p className="set-note">
        The three baskets whose walk-forward result is published. Here they are recomputed in-sample on the prices loaded, so
        their figures are not the published ones.
      </p>
      <details className="set-more">
        <summary>More baskets</summary>
        <div className="set-presets">{MORE_PRESETS.map((p) => presetButton(p, false))}</div>
      </details>
    </Group>
  );
}

// ---- dates (699-704) --------------------------------------------------------------------------------------------

export function DateFields({ settings, setSettings }: { settings: Settings; setSettings: SetSettings }) {
  const id = useId();
  const today = todayISO();
  const endValue = settings.end ?? today;
  const [startDraft, setStartDraft] = useState(settings.start);
  const [endDraft, setEndDraft] = useState(endValue);
  const [dateError, setDateError] = useState<string | null>(null);
  useEffect(() => setStartDraft(settings.start), [settings.start]);
  useEffect(() => setEndDraft(endValue), [endValue]);

  function commitDates(start: string, end: string) {
    if (!complete(start) || !complete(end)) {
      setDateError("Enter a full date, with a four-digit year.");
      return;
    }
    const bad = validateRequest(settings.tickers, start, end);
    if (bad === "reversed" || bad === "short-range") {
      setDateError(MESSAGES[bad]);
      return;
    }
    setDateError(null);
    const patch: Partial<Settings> = {};
    if (start !== settings.start) patch.start = start;
    const nextEnd = end === today ? null : end; // today's date is "today", and moves with it
    if (nextEnd !== settings.end) patch.end = nextEnd;
    if (Object.keys(patch).length > 0) setSettings(patch);
  }

  return (
    <Group input="dates">
      <div className="set-dates">
        <div className="set-field">
          <label htmlFor={`${id}-start`}>Start</label>
          <input
            id={`${id}-start`}
            name="start"
            type="date"
            max={today}
            value={startDraft}
            onChange={(e) => {
              setStartDraft(e.target.value);
              commitDates(e.target.value, endDraft);
            }}
          />
        </div>
        <div className="set-field">
          <label htmlFor={`${id}-end`}>
            End{settings.end === null ? <span className="set-aside"> today</span> : null}
          </label>
          <input
            id={`${id}-end`}
            name="end"
            type="date"
            max={today}
            value={endDraft}
            onChange={(e) => {
              setEndDraft(e.target.value);
              commitDates(startDraft, e.target.value);
            }}
          />
        </div>
      </div>
      {dateError ? (
        <p className="set-error" role="alert">
          {dateError}
        </p>
      ) : null}
      {settings.end !== null ? (
        <button type="button" className="set-link" onClick={() => setSettings({ end: null })}>
          End today instead
        </button>
      ) : null}
    </Group>
  );
}

// ---- risk-free rate (706-721) -----------------------------------------------------------------------------------

export function RfField({ settings, setSettings, rf }: { settings: Settings; setSettings: SetSettings; rf: LoadState<RfRate> }) {
  const id = useId();
  // `live` is the latest yield. With the workbench's view (src/state/rfwindow.ts) it also carries the
  // mean yield over the window and the rate the numbers on screen use; a bare RfRate is read as
  // today's yield in use, the app's own rule.
  const live = rf.status === "ready" ? rf.value : null;
  const view = live && isRfView(live) ? live : null;
  const unreachable = rf.status === "error" || rf.status === "empty";
  const inUse = settings.rf ?? view?.inUse ?? live?.rate ?? (unreachable ? RF_FALLBACK : null);
  const [rfDraft, setRfDraft] = useState(inUse === null ? "" : pctText(inUse));
  useEffect(() => {
    // Keep what the visitor typed ("4.10") while it means the rate in use; replace it otherwise.
    setRfDraft((d) =>
      inUse === null ? "" : d.trim() !== "" && Math.abs(Number(d) / 100 - inUse) < 1e-12 ? d : pctText(inUse),
    );
  }, [inUse]);

  function changeRf(v: string) {
    setRfDraft(v);
    const n = Number(v);
    if (v.trim() !== "" && Number.isFinite(n)) setSettings({ rf: n / 100 });
  }

  // Both rates side by side, whichever one is in use: "rf over window x% · today y%".
  const rfBoth = view?.window ? `rf over window ${format(view.window.rate, "pct2")} · today ${format(view.rate, "pct2")}` : null;
  let rfNote: string;
  if (settings.rf !== null) {
    rfNote = live && settings.rf === live.rate
      ? `Using today's 3-month Treasury rate (${live.date}) for the whole window.`
      // A fixed rate: typed, or today's yield written in by the button below on an earlier day, so the
      // note says what it does, not where it came from.
      : `Using a fixed ${pctText(settings.rf)}%: it stays until changed here and does not follow FRED.` + (live && !rfBoth ? ` The live 3-month Treasury rate is ${pctText(live.rate)}% (${live.date}).` : "");
  } else if (view?.basis === "window" && view.window) {
    rfNote = `The mean 3-month Treasury yield from ${view.window.from} to ${view.window.to}, the rate that prevailed over these prices ` +
      `(${view.window.days.toLocaleString("en-US")} daily readings, source ${view.source}; today's is from ${view.date}). Override it freely.`;
  } else if (view?.basis === "example") {
    rfNote = `The example on screen keeps the ${pctText(view.inUse)}% it was saved with. Live prices are scored at the rate over their own window.`;
  } else if (view?.basis === "today") {
    rfNote = view.loading
      ? `Using today's 3-month Treasury rate (${view.date}) until the rate over this window loads. Override it freely.`
      : `Using today's 3-month Treasury rate (${view.date}): the rate over this window could not be loaded. Override it freely.`;
  } else if (live) {
    rfNote = `Live: 3-month Treasury, ${live.date} · source ${live.source}. Override it freely.`;
  } else if (unreachable) {
    rfNote = `Could not reach the live rate. Using the ${(RF_FALLBACK * 100).toFixed(1)}% placeholder; edit it if you know today's rate.`;
  } else {
    rfNote = "Looking up the live 3-month Treasury rate.";
  }

  return (
    <Group input="rf">
      <div className="set-field">
        <label htmlFor={`${id}-rf`}>Annualized Rf (%)</label>
        <input
          id={`${id}-rf`}
          name="rf"
          type="number"
          inputMode="decimal"
          step={RF_STEP * 100}
          value={rfDraft}
          onChange={(e) => changeRf(e.target.value)}
        />
        {rfBoth ? <p className="set-rates">{rfBoth}</p> : null}
        <p className="set-note">{rfNote}</p>
        {settings.rf !== null ? (
          <button type="button" className="set-link" onClick={() => setSettings({ rf: null })}>
            Use the rate over the window
          </button>
        ) : live && (view?.basis === "window" || view?.basis === "example") ? (
          <button type="button" className="set-link" onClick={() => setSettings({ rf: live.rate })}>
            Use today's rate instead
          </button>
        ) : null}
      </div>
    </Group>
  );
}

// ---- benchmark (727-744): a symbol from a share link that is not in the list still shows ------------------------

export function BenchField({ settings, setSettings }: { settings: Settings; setSettings: SetSettings }) {
  const id = useId();
  const benchmarks = BENCHMARKS.some((b) => b.symbol === settings.benchmark)
    ? BENCHMARKS
    : [...BENCHMARKS, { label: settings.benchmark, symbol: settings.benchmark, display: settings.benchmark }];
  return (
    <Group input="bench">
      <div className="set-field">
        <label htmlFor={`${id}-bench`}>Benchmark Index</label>
        <select id={`${id}-bench`} name="benchmark" value={settings.benchmark} onChange={(e) => setSettings({ benchmark: e.target.value })}>
          {benchmarks.map((b) => (
            <option key={b.symbol} value={b.symbol}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
    </Group>
  );
}

// ---- shorting (746-753) -----------------------------------------------------------------------------------------

export function ShortField({ settings, setSettings }: { settings: Settings; setSettings: SetSettings }) {
  return (
    <Group input="short">
      <label className="set-switch">
        <input
          type="checkbox"
          role="switch"
          name="allowShort"
          checked={settings.allowShort}
          onChange={(e) => setSettings({ allowShort: e.target.checked })}
        />
        <span>Allow short positions</span>
      </label>
      {/* ledger:short-bounds-copy. The app's help (750-751) calls the short frontier "unconstrained";
          its optimiser bounds every weight to [-1, 1] (780-782), and so does the port's. */}
      <p className="set-note">
        Weights may go negative: each asset's weight is bounded to [−1, 1] (−100% to 100%) instead of [0, 1].
        Switching recomputes the optimisations from the prices already loaded.
      </p>
    </Group>
  );
}

// ---- starting amount (724-725): the same setting the growth charts' field writes --------------------------------

export function AmountGroup({ settings, setSettings }: { settings: Settings; setSettings: SetSettings }) {
  return (
    <Group input="amount">
      <AmountField amount={settings.amount} onAmount={(amount) => setSettings({ amount })} />
    </Group>
  );
}

// ---- explanation level (657-663), until layered text replaces it -------------------------------------------------

export function LevelField({ level, setLevel }: { level: Level; setLevel: (l: Level) => void }) {
  return (
    <Group input="level">
      <SegControl options={LEVEL_OPTIONS} value={level} onChange={setLevel} ariaLabel="Explanation level" />
      {/* The app's caption (657-663), with the port's names for the three levels. The port's Formula level
          also adds a visible line under each tab's finding, so at that level the caption says so. */}
      <p className="set-note">
        How much the info marks beside each figure explain. Plain = plain English. Finance = finance terms. Formula =
        formulas.
        {level === "formula" ? " Formula also adds a line under each tab's finding: the formula behind its figure, with the numbers that finding shows." : null}
      </p>
    </Group>
  );
}
