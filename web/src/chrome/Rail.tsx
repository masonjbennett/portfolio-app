// The rail: every input of the app's sidebar (portfolio_app.py 645-759) in its order, with the
// explanation level on top and no Run button (761): a change applies at once. Fields that would
// fetch prices on every keystroke (tickers, dates) keep a draft and commit only a request the
// app's own checks (1009-1021, validateRequest) accept; a rejected one stays in the field with the
// app's message under it and nothing is fetched.
//
// Two departures from the sidebar's order and content. The presets open on the three published sets,
// marked, with the app's own under "More baskets". The starting amount is not here: it is edited on
// the growth chart, the one place it changes anything (the workbench still holds it, and it still
// never enters a shared link).
import { useEffect, useId, useState } from "react";
import SegControl from "../components/SegControl.tsx";
import { SYMBOL } from "../data/prices.ts";
import { format } from "../format.ts";
import { MAX_TICKERS, parseTickers, validateRequest } from "../lib/clean.ts";
import { loadVerdict, TN_WARN, TRADING_DAYS } from "../lib/stats.ts";
import { MESSAGES } from "../state/analyze.ts";
import { BENCHMARKS, MORE_PRESETS, PUBLISHED_PRESETS, RF_FALLBACK, RF_STEP, type Preset } from "../state/defaults.ts";
import { isRfView } from "../state/rfwindow.ts";
import { LEVELS, type Level, type RailProps, type Settings } from "../types.ts";
import { todayISO } from "./when.ts";
import "./Rail.css";

const LEVEL_OPTIONS: { value: Level; label: string }[] = LEVELS.map((l) => ({ value: l.id, label: l.label }));

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

// Why a list of `n` tickers stops at MAX_TICKERS, in the terms of the what-if panel's estimation lines:
// the shortest window the page estimates on is one year of trading days, and below TN_WARN days of
// returns per asset its weights rest on thin data. Every figure is read from those constants and the
// count, so the sentence follows them if they move. Null within the cap, and null when the cap itself
// would leave that window thin or one more ticker would not: the window would then not be the reason.
export function capReason(n: number): string | null {
  if (n <= MAX_TICKERS || loadVerdict(TRADING_DAYS, n) === "ok" || loadVerdict(TRADING_DAYS, MAX_TICKERS) !== "ok") return null;
  const perAsset = (k: number) => (TRADING_DAYS / k).toFixed(1);
  return (
    `The shortest window the page estimates on, one year, has ${TRADING_DAYS} days of returns: ${perAsset(MAX_TICKERS)} per asset ` +
    `at ${MAX_TICKERS} tickers, but ${perAsset(n)} at ${n}, under the ${TN_WARN} below which the optimizer's weights rest on thin data.`
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

export default function Rail({ settings, setSettings, level, setLevel, rf, fetching }: RailProps) {
  const id = useId();
  const today = todayISO();
  const endValue = settings.end ?? today;

  // ---- tickers (670-697) ----
  const committedTickers = settings.tickers.join(", ");
  const [tickerDraft, setTickerDraft] = useState(committedTickers);
  const [tickerError, setTickerError] = useState<string | null>(null);
  // How many distinct tickers the last refused list had, when it was refused for having too many: the
  // reason and the way out show under the app's message only then.
  const [overCap, setOverCap] = useState<number | null>(null);
  useEffect(() => {
    setTickerDraft(committedTickers);
    setTickerError(null);
    setOverCap(null);
  }, [committedTickers]);

  function commitTickers(input: string) {
    const tickers = parseTickers(input);
    const bad = validateRequest(tickers, settings.start, endValue);
    setOverCap(bad === "too-many" ? tickers.length : null);
    if (bad === "too-few" || bad === "too-many") {
      setTickerError(MESSAGES[bad]);
      return;
    }
    // The app hands any string to yfinance (1007). The price endpoint takes Yahoo's alphabet only
    // (SYMBOL), so a symbol outside it is named here instead of coming back as a failed request.
    const odd = tickers.find((t) => !SYMBOL.test(t));
    if (odd !== undefined) {
      setTickerError(symbolMessage(odd));
      return;
    }
    setTickerError(null);
    if (tickers.join(",") !== settings.tickers.join(",")) setSettings({ tickers });
  }

  // The way out of a list that is too long: the box keeps its first MAX_TICKERS distinct tickers and is
  // applied exactly as if they had been typed, through the same checks.
  function keepFirst() {
    const kept = firstTickers(tickerDraft).join(", ");
    setTickerDraft(kept);
    commitTickers(kept);
  }
  const reason = overCap === null ? null : capReason(overCap);

  // ---- dates (699-704) ----
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

  // ---- risk-free rate (706-721) ----
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

  function applyPreset(p: Preset) {
    setTickerDraft(p.tickers);
    commitTickers(p.tickers);
  }
  const presetButton = (p: Preset, published: boolean) => (
    <button key={p.name} type="button" className={published ? "rail-preset rail-preset-published" : "rail-preset"} onClick={() => applyPreset(p)}>
      <span className="rail-preset-name">{p.name}</span>
      <span className="rail-preset-desc">{p.desc}</span>
    </button>
  );

  // ---- benchmark (727-744): a symbol from a share link that is not in the list still shows ----
  const benchmarks = BENCHMARKS.some((b) => b.symbol === settings.benchmark)
    ? BENCHMARKS
    : [...BENCHMARKS, { label: settings.benchmark, symbol: settings.benchmark, display: settings.benchmark }];

  return (
    <div className="rail">
      <p className="rail-status" role="status" aria-live="polite">
        {fetching ? "Fetching prices" : ""}
      </p>

      <section className="rail-group" aria-labelledby={`${id}-level`}>
        <h2 className="rail-heading" id={`${id}-level`}>
          Explanation level
        </h2>
        <SegControl options={LEVEL_OPTIONS} value={level} onChange={setLevel} ariaLabel="Explanation level" />
        {/* The app's caption (657-663), with the port's names for the three levels. The port's Formula level
            also adds a visible line under each tab's finding, so the caption says so. */}
        <p className="rail-note">
          How much the info marks beside each figure explain. Plain = plain English. Finance = finance terms. Formula =
          formulas, and one more line under each tab's finding: the formula behind its figure, with this basket's numbers
          in it.
        </p>
      </section>

      <section className="rail-group" aria-labelledby={`${id}-tickers-h`}>
        <h2 className="rail-heading" id={`${id}-tickers-h`}>
          Tickers
        </h2>
        <p className="rail-note">The published sets:</p>
        <div className="rail-presets">{PUBLISHED_PRESETS.map((p) => presetButton(p, true))}</div>
        <p className="rail-note">
          The three baskets whose walk-forward result is published. Here they are recomputed in-sample on the prices loaded, so
          their figures are not the published ones.
        </p>
        <details className="rail-more">
          <summary>More baskets</summary>
          <div className="rail-presets">{MORE_PRESETS.map((p) => presetButton(p, false))}</div>
        </details>
        <div className="rail-field">
          <label htmlFor={`${id}-tickers`}>Enter 3–10 tickers (comma-separated)</label>
          <input
            id={`${id}-tickers`}
            name="tickers"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={tickerDraft}
            aria-invalid={tickerError !== null}
            aria-describedby={reason ? `${id}-tickers-note ${id}-tickers-why` : `${id}-tickers-note`}
            onChange={(e) => setTickerDraft(e.target.value)}
            onBlur={(e) => commitTickers(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTickers(e.currentTarget.value);
            }}
          />
          <p className={tickerError ? "rail-error" : "rail-note"} id={`${id}-tickers-note`} role={tickerError ? "alert" : undefined}>
            {tickerError ?? "Example: AAPL, MSFT, GOOGL. Press Enter to apply."}
          </p>
          {reason ? (
            <p className="rail-note" id={`${id}-tickers-why`}>
              {reason}
            </p>
          ) : null}
          {overCap !== null ? (
            <button type="button" className="rail-link" onClick={keepFirst}>
              Keep the first {MAX_TICKERS}
            </button>
          ) : null}
        </div>
      </section>

      <section className="rail-group" aria-labelledby={`${id}-dates-h`}>
        <h2 className="rail-heading" id={`${id}-dates-h`}>
          Date range
        </h2>
        <div className="rail-dates">
          <div className="rail-field">
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
          <div className="rail-field">
            <label htmlFor={`${id}-end`}>
              End{settings.end === null ? <span className="rail-aside"> today</span> : null}
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
          <p className="rail-error" role="alert">
            {dateError}
          </p>
        ) : null}
        {settings.end !== null ? (
          <button type="button" className="rail-link" onClick={() => setSettings({ end: null })}>
            End today instead
          </button>
        ) : null}
      </section>

      <section className="rail-group" aria-labelledby={`${id}-rf-h`}>
        <h2 className="rail-heading" id={`${id}-rf-h`}>
          Risk-free rate
        </h2>
        <div className="rail-field">
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
          {rfBoth ? <p className="rail-rates">{rfBoth}</p> : null}
          <p className="rail-note">{rfNote}</p>
          {settings.rf !== null ? (
            <button type="button" className="rail-link" onClick={() => setSettings({ rf: null })}>
              Use the rate over the window
            </button>
          ) : live && (view?.basis === "window" || view?.basis === "example") ? (
            <button type="button" className="rail-link" onClick={() => setSettings({ rf: live.rate })}>
              Use today's rate instead
            </button>
          ) : null}
        </div>
      </section>

      <section className="rail-group" aria-labelledby={`${id}-bench-h`}>
        <h2 className="rail-heading" id={`${id}-bench-h`}>
          Benchmark
        </h2>
        <div className="rail-field">
          <label htmlFor={`${id}-bench`}>Benchmark Index</label>
          <select id={`${id}-bench`} name="benchmark" value={settings.benchmark} onChange={(e) => setSettings({ benchmark: e.target.value })}>
            {benchmarks.map((b) => (
              <option key={b.symbol} value={b.symbol}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="rail-group" aria-labelledby={`${id}-short-h`}>
        <h2 className="rail-heading" id={`${id}-short-h`}>
          Short selling
        </h2>
        <label className="rail-switch">
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
        <p className="rail-note">
          Weights may go negative: each asset's weight is bounded to [−1, 1] (−100% to 100%) instead of [0, 1].
          Switching recomputes the optimisations from the prices already loaded.
        </p>
      </section>
    </div>
  );
}
