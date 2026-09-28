// The rail: every input of the app's sidebar (portfolio_app.py 645-759) in its order, with the
// explanation level on top and no Run button (761): a change applies at once. Fields that would
// fetch prices on every keystroke (tickers, dates) keep a draft and commit only a request the
// app's own checks (1009-1021, validateRequest) accept; a rejected one stays in the field with the
// app's message under it and nothing is fetched.
import { useEffect, useId, useState } from "react";
import SegControl from "../components/SegControl.tsx";
import { SYMBOL } from "../data/prices.ts";
import { parseTickers, validateRequest } from "../lib/clean.ts";
import { MESSAGES } from "../state/analyze.ts";
import { AMOUNT_STEP, BENCHMARKS, MIN_AMOUNT, PRESETS, RF_FALLBACK, RF_STEP } from "../state/defaults.ts";
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
  useEffect(() => {
    setTickerDraft(committedTickers);
    setTickerError(null);
  }, [committedTickers]);

  function commitTickers(input: string) {
    const tickers = parseTickers(input);
    const bad = validateRequest(tickers, settings.start, endValue);
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
  const live = rf.status === "ready" ? rf.value : null;
  const unreachable = rf.status === "error" || rf.status === "empty";
  const inUse = settings.rf ?? live?.rate ?? (unreachable ? RF_FALLBACK : null);
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

  let rfNote: string;
  if (settings.rf !== null) {
    rfNote = `Using ${pctText(settings.rf)}%, not the live rate.` + (live ? ` The live 3-month Treasury rate is ${pctText(live.rate)}% (${live.date}).` : "");
  } else if (live) {
    rfNote = `Live: 3-month Treasury, ${live.date} · source ${live.source}. Override it freely.`;
  } else if (unreachable) {
    rfNote = `Could not reach the live rate. Using the ${(RF_FALLBACK * 100).toFixed(1)}% placeholder; edit it if you know today's rate.`;
  } else {
    rfNote = "Looking up the live 3-month Treasury rate.";
  }

  // ---- starting amount (723-725) ----
  const [amountDraft, setAmountDraft] = useState(String(settings.amount));
  const [amountError, setAmountError] = useState<string | null>(null);
  useEffect(() => {
    setAmountDraft((d) => (Number(d) === settings.amount ? d : String(settings.amount)));
  }, [settings.amount]);

  function changeAmount(v: string) {
    setAmountDraft(v);
    const n = Number(v);
    if (v.trim() === "" || !Number.isFinite(n) || n < MIN_AMOUNT) {
      setAmountError(`The starting amount must be at least $${MIN_AMOUNT.toLocaleString("en-US")}.`);
      return;
    }
    setAmountError(null);
    if (n !== settings.amount) setSettings({ amount: n });
  }

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
        {/* The app's caption (657-663), with the port's names for the three levels. */}
        <p className="rail-note">
          How much the info marks beside each figure explain. Plain = plain English. Finance = finance terms. Formula =
          formulas.
        </p>
      </section>

      <section className="rail-group" aria-labelledby={`${id}-tickers-h`}>
        <h2 className="rail-heading" id={`${id}-tickers-h`}>
          Tickers
        </h2>
        <p className="rail-note">Quick presets:</p>
        <div className="rail-presets">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="rail-preset"
              onClick={() => {
                setTickerDraft(p.tickers);
                commitTickers(p.tickers);
              }}
            >
              <span className="rail-preset-name">{p.name}</span>
              <span className="rail-preset-desc">{p.desc}</span>
            </button>
          ))}
        </div>
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
            aria-describedby={`${id}-tickers-note`}
            onChange={(e) => setTickerDraft(e.target.value)}
            onBlur={(e) => commitTickers(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTickers(e.currentTarget.value);
            }}
          />
          <p className={tickerError ? "rail-error" : "rail-note"} id={`${id}-tickers-note`} role={tickerError ? "alert" : undefined}>
            {tickerError ?? "Example: AAPL, MSFT, GOOGL. Press Enter to apply."}
          </p>
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
          <p className="rail-note">{rfNote}</p>
          {settings.rf !== null ? (
            <button type="button" className="rail-link" onClick={() => setSettings({ rf: null })}>
              Use the live rate
            </button>
          ) : null}
        </div>
      </section>

      <section className="rail-group" aria-labelledby={`${id}-amount-h`}>
        <h2 className="rail-heading" id={`${id}-amount-h`}>
          Starting investment
        </h2>
        <div className="rail-field">
          <label htmlFor={`${id}-amount`}>Initial Amount ($)</label>
          <input
            id={`${id}-amount`}
            name="amount"
            type="number"
            inputMode="numeric"
            min={MIN_AMOUNT}
            step={AMOUNT_STEP}
            value={amountDraft}
            aria-invalid={amountError !== null}
            onChange={(e) => changeAmount(e.target.value)}
          />
          <p className={amountError ? "rail-error" : "rail-note"} role={amountError ? "alert" : undefined}>
            {amountError ?? "Starting dollar amount for the cumulative wealth charts. Kept in this browser, never in a shared link."}
          </p>
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
