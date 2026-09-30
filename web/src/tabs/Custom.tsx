// The Custom Portfolio tab (portfolio_app.py 1708-1837): a weight per asset, divided by the weights'
// total, scored, placed on the efficient frontier and grown beside the other portfolios. Layout: the
// finding in one sentence, the weights that produce it, the five figures, the frontier, the wealth
// paths, then the normalised weights table.
//
// Every figure and sentence comes from ./custom/model.ts, which lists what differs from the app and
// why. On this page it shows as: a refused book is named in numbers instead of plotted sign-flipped or
// blown up (1732), a stored weight outside the bounds is shown clamped, the charts keep drawing the
// other portfolios when the weights are refused (the app's st.stop() at 1727 ended the page), and the
// weights table downloads as CSV and Excel.
//
// Each section sits inside its own Boundary, keyed on the weights, so a section that throws leaves one
// line naming it, the rest keeps rendering, and a change of weights tries it again.
//
// The scorecard is the Optimization tab's own component, the Custom column set in bold: the typed mix
// beside every other portfolio and the benchmark, on every figure. Its redraw row is solved after the
// tab has painted, on the first draw set's seed, the same one the Optimization tab opens on.
import { useId, useMemo, useState } from "react";
import Boundary from "../components/Boundary.tsx";
import Plate from "../components/Plate.tsx";
import Scorecard from "../components/Scorecard.tsx";
import Slug from "../components/Slug.tsx";
import Table from "../components/Table.tsx";
import Frontier, { frontierData, type FrontierData } from "../charts/Frontier.tsx";
import Wealth, { wealthData, type WealthData } from "../charts/Wealth.tsx";
import { format, MINUS } from "../format.ts";
import type { Analysis, CustomWeights, Level, LoadState, TabProps } from "../types.ts";
import {
  bounds,
  clampLine,
  clampWeight,
  customFrontier,
  customMetrics,
  customView,
  customWeights,
  frontierTitle,
  hasEntries,
  headline,
  parseWeight,
  PLATES,
  platesNote,
  resetWeights,
  shownWeight,
  totalLine,
  WEIGHT_COLUMNS,
  WEIGHT_STEP,
  weightTable,
  wealthTitle,
  type CustomView,
} from "./custom/model.ts";
import "./custom/Custom.css";
import { finiteSE } from "./optimization/model.ts";
import { seedOf, useRedraws } from "./optimization/redraws.ts";
import { scorecard, type RedrawState } from "./optimization/scorecard.ts";

const TABLE_TITLE = "Normalized Weights";

function Headline({ a, v }: { a: Analysis; v: CustomView }) {
  return <h2 className="tab-finding cust-headline">{headline(a, v)}</h2>;
}

// One asset's weight: a slider for dragging on the app's 0.01 grid (1720) and a field for typing any
// decimal. Both store the value held to the current bounds; the field keeps what is being typed until
// it loses focus, so "-" or "0." on the way to a number is not thrown away.
function WeightRow({ ticker, value, allowShort, onSet }: { ticker: string; value: number; allowShort: boolean; onSet: (x: number) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const { lo, hi } = bounds(allowShort);
  return (
    <div className="cust-row">
      <label className="cust-ticker" htmlFor={id}>
        {ticker}
      </label>
      <input
        className="cust-range"
        type="range"
        min={lo}
        max={hi}
        step={WEIGHT_STEP}
        value={clampWeight(value, allowShort)}
        aria-label={`${ticker} weight slider`}
        onChange={(e) => {
          const x = parseWeight(e.target.value);
          if (x !== null) onSet(clampWeight(x, allowShort));
        }}
      />
      <input
        id={id}
        className="cust-field num"
        type="number"
        inputMode="decimal"
        min={lo}
        max={hi}
        step={WEIGHT_STEP}
        value={draft ?? shownWeight(value)}
        onChange={(e) => {
          setDraft(e.target.value);
          const x = parseWeight(e.target.value);
          if (x !== null) onSet(clampWeight(x, allowShort));
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

function Builder({ a, v, weights, setWeights }: { a: Analysis; v: CustomView; weights: CustomWeights; setWeights: (w: CustomWeights) => void }) {
  const { lo } = bounds(a.allowShort);
  const clamp = clampLine(v, a.allowShort);
  return (
    <section className="cust-section" aria-labelledby="cust-weights">
      <Slug id="cust-weights">Weights</Slug>
      <p className="cust-note">
        Set a weight for each asset, from {lo < 0 ? `${MINUS}1` : "0"} to 1{a.allowShort ? " (shorting is on)" : ""}. The weights are
        divided by their total so they add up to 1, a fully invested portfolio, and every figure below follows them. An asset left
        alone holds 1/{a.tickers.length}, an equal share.
      </p>
      <div className="cust-editor" role="group" aria-label="Custom weights">
        {a.tickers.map((t, i) => (
          <WeightRow key={t} ticker={t} value={v.raw[i]} allowShort={a.allowShort} onSet={(x) => setWeights({ ...weights, [t]: x })} />
        ))}
      </div>
      <div className="cust-total">
        <p className="cust-note num-line">{totalLine(v)}</p>
        {hasEntries(a.tickers, weights) ? (
          <button type="button" className="cust-reset" onClick={() => setWeights(resetWeights(a.tickers, weights))}>
            Reset to equal weights
          </button>
        ) : null}
      </div>
      {clamp ? (
        <p className="cust-note cust-note--flag" role="status">
          {clamp}
        </p>
      ) : null}
      {v.refusal ? (
        <p className="cust-note cust-note--error" role="alert">
          {v.refusal.detail}
        </p>
      ) : null}
    </section>
  );
}

function Metrics({ a, v, level }: { a: Analysis; v: CustomView; level: Level }) {
  const w = customWeights(v);
  const p = useMemo(() => (w ? customMetrics(a, w) : null), [a, w]);
  // The Sharpe plate carries its standard error, as the Optimization tiles and the scorecard do.
  const se = useMemo(() => (w ? finiteSE(a, w) : null), [a, w]);
  return (
    <section className="cust-section" aria-label="Custom portfolio figures">
      <div className="cust-plates">
        {PLATES.map((d) => (
          <Plate
            key={d.key}
            label={d.label}
            value={p ? p[d.key] : null}
            format={d.format}
            tip={d.tip}
            level={level}
            allowShort={a.allowShort}
            se={d.key === "sharpe" ? se : null}
          />
        ))}
      </div>
      <p className="cust-note">{p ? platesNote(a) : "No figures: the weights above were refused."}</p>
    </section>
  );
}

function FrontierCard({ a, v }: { a: Analysis; v: CustomView }) {
  const w = customWeights(v);
  const points = useMemo(() => customFrontier(a), [a]);
  const state = useMemo<LoadState<FrontierData>>(() => ({ status: "ready", value: frontierData(a, w, points) }), [a, w, points]);
  const title = useMemo(() => frontierTitle(a, v), [a, v]);
  return (
    <section className="cust-section" aria-labelledby="cust-frontier">
      <Slug id="cust-frontier">Custom Portfolio on Efficient Frontier</Slug>
      <Frontier title={title} state={state} allowShort={a.allowShort} rf={a.rf} />
    </section>
  );
}

function WealthCard({ a, v, amount, onAmount }: { a: Analysis; v: CustomView; amount: number; onAmount: (n: number) => void }) {
  const w = customWeights(v);
  const data = useMemo(() => wealthData(a, w), [a, w]);
  const state = useMemo<LoadState<WealthData>>(() => ({ status: "ready", value: data }), [data]);
  const title = wealthTitle(data, amount, w !== null);
  return (
    <section className="cust-section" aria-labelledby="cust-wealth">
      <Slug id="cust-wealth">Cumulative Wealth: All Portfolios</Slug>
      <Wealth title={title} state={state} amount={amount} onAmount={onAmount} />
    </section>
  );
}

// The scorecard for the typed mix, beside the other portfolios and the benchmark.
function ScorecardCard({ a, v, redraws, level }: { a: Analysis; v: CustomView; redraws: RedrawState; level: Level }) {
  const model = useMemo(() => scorecard(a, v.custom, redraws), [a, v, redraws]);
  return (
    <section className="cust-section" aria-labelledby="cust-scorecard">
      <Slug id="cust-scorecard">Scorecard</Slug>
      <Scorecard model={model} redraws={redraws} level={level} allowShort={a.allowShort} filename="custom_scorecard" focus="custom" />
    </section>
  );
}

// Entered is the weight as typed; a weight outside the bounds counts at the nearest bound, so when one
// was held there the note says so rather than claim every row is its entry over the total.
function WeightsTable({ v }: { v: CustomView }) {
  const state = weightTable(v);
  const clamped = v.clamps.length > 0;
  return (
    <section className="cust-section" aria-labelledby="cust-table">
      <Slug id="cust-table">{TABLE_TITLE}</Slug>
      {state.status === "ready" ? (
        <>
          {/* No span: these are the weights as typed, which come from no dates. */}
          <Table title={TABLE_TITLE} columns={WEIGHT_COLUMNS} rows={state.value} filename="custom_normalized_weights" span={null} />
          <p className="cust-note">
            {clamped
              ? `Entered is the weight as set above. A weight outside the bounds counts at the nearest bound, and the normalized weight is that divided by the weight total, ${format(v.custom.total, "num2")}.`
              : `Entered is the weight as set above; the normalized weight is it divided by the weight total, ${format(v.custom.total, "num2")}.`}
          </p>
        </>
      ) : (
        <p className="cust-note" role="status">
          {state.status === "empty" ? state.reason : `${TABLE_TITLE}: not shown.`}
        </p>
      )}
    </section>
  );
}

export default function Custom({ analysis: a, settings, level, weights, setWeights, requestSettings }: TabProps) {
  const v = useMemo(() => customView(a, weights), [a, weights]);
  const redraws = useRedraws(a, seedOf(0));
  const scoreKey = useMemo(() => [v, redraws], [v, redraws]);
  return (
    <div className="cust" data-tab="custom">
      <Boundary name="The headline" resetKey={v}>
        <Headline a={a} v={v} />
      </Boundary>
      <Slug>Custom Portfolio Builder</Slug>
      <Boundary name="Custom weights" resetKey={v}>
        <Builder a={a} v={v} weights={weights} setWeights={setWeights} />
      </Boundary>
      <Boundary name="Custom portfolio figures" resetKey={v}>
        <Metrics a={a} v={v} level={level} />
      </Boundary>
      <Boundary name="Custom portfolio on the efficient frontier" resetKey={v}>
        <FrontierCard a={a} v={v} />
      </Boundary>
      <Boundary name="Cumulative wealth" resetKey={v}>
        <WealthCard a={a} v={v} amount={settings.amount} onAmount={(n) => requestSettings({ amount: n })} />
      </Boundary>
      <Boundary name="Scorecard" resetKey={scoreKey}>
        <ScorecardCard a={a} v={v} redraws={redraws} level={level} />
      </Boundary>
      <Boundary name="Normalized weights" resetKey={v}>
        <WeightsTable v={v} />
      </Boundary>
    </div>
  );
}
