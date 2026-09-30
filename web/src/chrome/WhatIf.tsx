// The what-if panel under the band's plates. One asset's expected return is moved by hand, inside the
// range its own noise allows, and the maximum-Sharpe weights are solved again on the moved means. The
// sentence prints the new tangency weight; the minimum-variance weight beside it is solved the same way
// and never changes, because that portfolio does not use the means at all. It is a what-if on the prices
// loaded, labelled so, and never a forecast or a result out of sample.
//
// The range works in standard errors of the chosen asset's mean (-2 to +2), so its two ends are exactly
// the engine's clamp and its middle is exactly the window's own average. The teal stretch of the track is
// one standard error either side. Every figure comes from src/lib/robust.ts and src/lib/stats.ts; nothing
// here re-derives a solve, an error or a count.
//
// Under the sentence, two lines say how much the optimizer is estimating and from how little: the count
// of means and covariances against the days of returns, how well each mean is known, and how many years
// of daily prices it would take to pin the chosen asset's mean to a couple of points.
import { useId, useMemo, useState } from "react";
import type { ChangeEvent, SyntheticEvent } from "react";
import { FITTED } from "../content/words.ts";
import { DASH, format } from "../format.ts";
import { largestHolding, nudgeTangency, returnBand } from "../lib/robust.ts";
import type { Nudge, ReturnBand } from "../lib/robust.ts";
import { estimationLoad, loadVerdict, TN_WARN, TRADING_DAYS } from "../lib/stats.ts";
import type { EstimationLoad } from "../lib/stats.ts";
import type { Analysis } from "../types.ts";
import "./WhatIf.css";

/** Up to this many assets the weights are solved again on every step of the range; past it, on release. */
export const LIVE_UP_TO = 10;
/** How far the range reaches, in standard errors either side of the window's average. */
export const SE_REACH = 2;
/** The range's step, in standard errors. */
export const SE_STEP = 0.01;

/** What the panel needs from an analysis: the window's moments and returns, the rate, the bounds, the solves. */
export type WhatIfInput = Pick<Analysis, "tickers" | "m" | "S" | "rf" | "allowShort" | "returns" | "tangency" | "gmv">;

/** The asset the panel opens on: the tangency portfolio's largest holding, or the first when there is none. */
export function defaultAsset(a: WhatIfInput): number {
  const i = a.tangency ? largestHolding(a.tangency.w) : -1;
  return i >= 0 ? i : 0;
}

/** Days of returns in the window: the T every standard error here is counted over. */
export function windowDays(a: WhatIfInput): number {
  return a.returns[0]?.length ?? 0;
}

/** The annual expected return at `z` standard errors from the window's average. */
export function muAt(band: ReturnBand, z: number): number {
  return band.estimate + z * band.se;
}

/** The engine's re-solve at `z` standard errors, for one asset. */
export function solveAt(a: WhatIfInput, asset: number, z: number): Nudge | null {
  const band = returnBand(a.m, a.S, windowDays(a), asset);
  return nudgeTangency(a.m, a.S, a.rf, a.allowShort, windowDays(a), asset, muAt(band, z));
}

const pct = (x: number | null | undefined): string => format(x ?? null, "pct1");

// Percentage points, one decimal, for a decimal figure (0.07 prints "7.0").
function points(x: number): string {
  return Number.isFinite(x) ? (x * 100).toFixed(1) : DASH;
}

function oneDecimal(x: number): string {
  return Number.isFinite(x) ? x.toFixed(1) : DASH;
}

/** The sentence's first half: the window's own average for the asset and its one-standard-error band. */
export function bandSentence(ticker: string, band: ReturnBand): string {
  return (
    `${ticker}'s average return over this window was ${pct(band.estimate)} a year; one standard error either side ` +
    `runs from ${pct(band.lo1)} to ${pct(band.hi1)}.`
  );
}

/** The parts of the sentence that follow the range: what each mix would hold at the moved return. */
export interface WhatIfWords {
  /** Up to the tangency weight. */
  lead: string;
  /** The tangency weight, or null when there is no tangency mix to state one for. */
  tan: string | null;
  /** After the tangency weight. */
  tail: string;
  /** The minimum-variance weight, or null when its solve failed. */
  gmv: string | null;
  /** After the minimum-variance weight. */
  close: string;
}

export function whatIfWords(ticker: string, rf: number, allowShort: boolean, n: Nudge): WhatIfWords {
  const t = n.tangency;
  const g = n.gmv ? pct(n.gmv.w[n.asset]) : null;
  const rate = format(rf, "pct2");
  let lead = `If its expected return were ${pct(n.mu)}, `;
  let tan: string | null = null;
  let tail = "";
  if (!t) {
    lead +=
      `no mix within the ${allowShort ? "shorting" : "long-only"} limits would earn more than the ${rate} risk-free rate, ` +
      "so there would be no highest-Sharpe mix to hold.";
  } else {
    lead += t.beatsRf
      ? "the highest-Sharpe mix would hold "
      : `no mix would earn more than the ${rate} risk-free rate, and the highest-Sharpe mix, still below it, would hold `;
    tan = pct(t.w[n.asset]);
    tail = ` ${ticker}.`;
  }
  return g === null
    ? { lead, tan, tail: `${tail} The lowest-variance solve failed on this window.`, gmv: null, close: "" }
    : { lead, tan, tail: `${tail} The lowest-variance mix holds `, gmv: g, close: ` ${ticker}, whatever you pick.` };
}

/** The two lines under the sentence: what the optimizer estimates, and how long the chosen mean takes to pin. */
export function loadLines(ticker: string, asset: number, load: EstimationLoad): string[] {
  const ses = load.assets.map((x) => x.se).filter(Number.isFinite);
  const lo = ses.length ? Math.min(...ses) : NaN;
  const hi = ses.length ? Math.max(...ses) : NaN;
  const known = points(lo) === points(hi) ? `±${points(lo)}` : `±${points(lo)} to ±${points(hi)}`;
  const mine = load.assets[asset];
  const lines = [
    `With ${load.n} assets and ${format(load.days, "int")} days of returns, the optimizer estimates ${load.means} expected ` +
      `returns and ${format(load.covariances, "int")} variances and covariances; each expected return is known to about ` +
      `${known} points a year (one standard error).`,
    `To pin ${ticker}'s expected return to ±${(load.h * 100).toFixed(0)} points a year would take about ` +
      `${format(mine ? Math.round(mine.yearsNeeded) : null, "int")} years of daily prices; this window has ${oneDecimal(load.years)}.`,
  ];
  // Asked of the SHORTEST window the page offers: the one-year window, or the whole window when it is
  // shorter than a year. A long window can be well fed while its one-year window is not.
  const shortest = Math.min(load.days, TRADING_DAYS);
  if (loadVerdict(shortest, load.n) !== "ok") {
    lines.push(
      shortest < load.days
        ? `The one-year window gives ${oneDecimal(shortest / load.n)} days of returns per asset, under the ${TN_WARN} below which its weights rest on thin data.`
        : `That is ${oneDecimal(load.daysPerAsset)} days of returns per asset, under the ${TN_WARN} below which these weights rest on thin data.`,
    );
  }
  return lines;
}

export default function WhatIf({ a }: { a: WhatIfInput }) {
  const id = useId();
  const [seen, setSeen] = useState(a);
  const [asset, setAsset] = useState(() => defaultAsset(a));
  // `draft` is where the thumb is; `z` is what was solved. They differ only mid-drag past LIVE_UP_TO assets.
  const [draft, setDraft] = useState(0);
  const [z, setZ] = useState(0);
  if (seen !== a) {
    // New prices or settings: start again on the new window's largest holding, at its own average.
    setSeen(a);
    setAsset(defaultAsset(a));
    setDraft(0);
    setZ(0);
  }
  const live = a.tickers.length <= LIVE_UP_TO;
  const load = useMemo(() => estimationLoad(a.returns), [a.returns]);
  const pick = asset < a.tickers.length ? asset : 0;
  const band = useMemo(() => returnBand(a.m, a.S, windowDays(a), pick), [a, pick]);
  const nudge = useMemo(() => (a.tangency ? solveAt(a, pick, z) : null), [a, pick, z]);
  const ticker = a.tickers[pick] ?? "";

  const kicker = <p className="whatif-kicker">What-if on these prices</p>;
  const note = (
    <p className="whatif-note">
      Not the published study: move one expected return and both mixes are solved again, in-sample, {FITTED}.
    </p>
  );

  if (!a.tangency) {
    return (
      <section className="whatif" aria-label="What-if on these prices">
        {kicker}
        <p className="whatif-sentence">
          These settings have no highest-Sharpe mix to move, so there is no what-if to run on them.
        </p>
      </section>
    );
  }

  const onPick = (e: ChangeEvent<HTMLSelectElement>) => {
    setAsset(Number(e.target.value));
    setDraft(0);
    setZ(0);
  };
  const onMove = (e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setDraft(v);
    if (live) setZ(v);
  };
  const onRelease = (e: SyntheticEvent<HTMLInputElement>) => {
    if (!live) setZ(Number(e.currentTarget.value));
  };
  const words = nudge ? whatIfWords(ticker, a.rf, a.allowShort, nudge) : null;
  const waiting = !live && draft !== z;

  return (
    <section className="whatif" aria-label="What-if on these prices">
      <div className="whatif-head">
        {kicker}
        <label className="whatif-pick">
          <span>Asset</span>
          <select value={String(pick)} onChange={onPick}>
            {a.tickers.map((t, i) => (
              <option key={t} value={String(i)}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {note}
      {/* Not a live region: the range steps in hundredths of a standard error, and a live paragraph
          would be read out again on every step. The range's own value text carries the result. */}
      <p className="whatif-sentence">
        <span className="whatif-band">{bandSentence(ticker, band)}</span>{" "}
        {words ? (
          <>
            {words.lead}
            {words.tan !== null ? <span className="whatif-tan num">{words.tan}</span> : null}
            {words.tail}
            {words.gmv !== null ? <span className="whatif-gmv num">{words.gmv}</span> : null}
            {words.close}
          </>
        ) : (
          "The what-if could not be solved for this asset."
        )}
      </p>
      <div className="whatif-control">
        <label className="whatif-label" htmlFor={id}>
          {ticker}'s expected return, up to two standard errors either side of its average
        </label>
        <input
          id={id}
          className="whatif-range"
          type="range"
          min={-SE_REACH}
          max={SE_REACH}
          step={SE_STEP}
          value={draft}
          aria-valuetext={`${pct(muAt(band, draft))} a year${!waiting && words?.tan != null ? `; tangency holds ${words.tan} ${ticker}` : ""}`}
          onChange={onMove}
          onPointerUp={onRelease}
          onMouseUp={onRelease}
          onTouchEnd={onRelease}
          onKeyUp={onRelease}
          onBlur={onRelease}
        />
        <div className="whatif-scale num" aria-hidden="true">
          <span>{pct(band.lo2)}</span>
          <span>{pct(band.estimate)} average</span>
          <span>{pct(band.hi2)}</span>
        </div>
        {waiting ? (
          <p className="whatif-wait" role="status">
            Let go to solve at {pct(muAt(band, draft))}.
          </p>
        ) : null}
      </div>
      <div className="whatif-load">
        {loadLines(ticker, pick, load).map((line) => (
          <p key={line.slice(0, 24)}>{line}</p>
        ))}
      </div>
    </section>
  );
}
