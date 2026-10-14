// The Your mix panel beside Build's frontier: the app's Custom Portfolio tab (portfolio_app.py 1708-1837) as one
// card. A slider and a typed field per asset, the weights' total, the mix's five figures, all live; the
// normalised weights under "Show the numbers"; the method and what each figure means under "How it is
// calculated". Its dot on the frontier and its column in the scorecard are drawn by the Optimization tab, from
// the same weights.
//
// Every figure and sentence comes from ./model.ts, which lists what differs from the app and why. On this page it
// shows as: a refused book is named in numbers instead of plotted sign-flipped or blown up (1732), a stored weight
// outside the bounds is shown clamped, the rest of the chapter keeps drawing the other portfolios when the weights
// are refused (the app's st.stop() at 1727 ended the page), and the weights table downloads as CSV and Excel.
//
// The editor, the figures and the table each sit in their own Boundary, so a figure that throws leaves the
// sliders working and a change of weights tries it again.
import { memo, useId, useMemo, useState } from "react";
import Boundary from "../../components/Boundary.tsx";
import Card from "../../components/Card.tsx";
import FormulaLine from "../../components/FormulaLine.tsx";
import HowTips from "../../components/HowTips.tsx";
import Plate from "../../components/Plate.tsx";
import Table from "../../components/Table.tsx";
import { format, MINUS } from "../../format.ts";
import type { Analysis, CustomWeights } from "../../types.ts";
import { customFormula } from "../formula.ts";
import { finiteSE } from "../optimization/model.ts";
import {
  bounds,
  clampLine,
  clampWeight,
  customMetrics,
  customWeights,
  hasEntries,
  parseWeight,
  PLATES,
  platesNote,
  resetWeights,
  shownWeight,
  totalLine,
  verdict,
  WEIGHT_COLUMNS,
  WEIGHT_STEP,
  weightTable,
  type CustomView,
} from "./model.ts";
import "./Custom.css";

/** The panel's title: the plain name, the scorecard's and the frontier's beside it. */
export const MIX_TITLE = "Your mix (Custom)";

/**
 * The panel's anchor: the part an older ?tab=custom link and the palette's "Your mix" land on. It is App's
 * sectionId("custom"), written out here because a tab never imports App (test/t-build.mjs holds the two equal).
 */
export const MIX_ANCHOR = "section-custom";

const TABLE_TITLE = "Normalized Weights";

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

// The weights: what to do with them in one line, a row per asset, the total and the reset, and why a weight
// was held to a bound or the mix refused.
const Editor = memo(function Editor({ a, v, weights, setWeights }: { a: Analysis; v: CustomView; weights: CustomWeights; setWeights: (w: CustomWeights) => void }) {
  const { lo } = bounds(a.allowShort);
  const clamp = clampLine(v, a.allowShort);
  return (
    <>
      <p className="cust-note cust-lead">
        Drag or type a weight for each asset, from {lo < 0 ? `${MINUS}1` : "0"} to 1{a.allowShort ? " (shorting is on)" : ""}; every
        figure follows.
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
    </>
  );
});

// The five figures (1739-1749), and their span and rate under them.
const Figures = memo(function Figures({ a, v }: { a: Analysis; v: CustomView }) {
  const w = customWeights(v);
  const p = useMemo(() => (w ? customMetrics(a, w) : null), [a, w]);
  // The Sharpe plate carries its standard error, as the scorecard does.
  const se = useMemo(() => (w ? finiteSE(a, w) : null), [a, w]);
  return (
    <div className="cust-figures" aria-label="Custom portfolio figures" role="group">
      <div className="cust-plates">
        {PLATES.map((d) => (
          <Plate key={d.key} label={d.label} value={p ? p[d.key] : null} format={d.format} allowShort={a.allowShort} se={d.key === "sharpe" ? se : null} />
        ))}
      </div>
      <p className="cust-note">{p ? platesNote(a) : "No figures: the weights entered were refused."}</p>
    </div>
  );
});

// Entered is the weight as typed; a weight outside the bounds counts at the nearest bound, so when one
// was held there the note says so rather than claim every row is its entry over the total.
const WeightsTable = memo(function WeightsTable({ v }: { v: CustomView }) {
  const state = weightTable(v);
  const clamped = v.clamps.length > 0;
  if (state.status !== "ready") {
    return (
      <p className="cust-note" role="status">
        {state.status === "empty" ? state.reason : `${TABLE_TITLE}: not shown.`}
      </p>
    );
  }
  return (
    <>
      {/* No span: these are the weights as typed, which come from no dates. */}
      <Table title={TABLE_TITLE} columns={WEIGHT_COLUMNS} rows={state.value} filename="custom_normalized_weights" span={null} />
      <p className="cust-note cust-table-note">
        {clamped
          ? `Entered is the weight as set above. A weight outside the bounds counts at the nearest bound, and the normalized weight is that divided by the weight total, ${format(v.custom.total, "num2")}.`
          : `Entered is the weight as set above; the normalized weight is it divided by the weight total, ${format(v.custom.total, "num2")}.`}
      </p>
    </>
  );
});

export default memo(function YourMix({
  a,
  v,
  weights,
  setWeights,
}: {
  a: Analysis;
  v: CustomView;
  weights: CustomWeights;
  setWeights: (w: CustomWeights) => void;
}) {
  const numbers = (
    <Boundary name="Normalized weights" resetKey={v}>
      <WeightsTable v={v} />
    </Boundary>
  );
  const how = (
    <>
      <p className="cust-note">
        The weights are divided by their total so they add up to 1, a fully invested portfolio. An asset left alone holds
        1/{a.tickers.length}, an equal share, so raising one weight lowers the share of every other. The mix is held at these
        weights every day of the window and scored like every other portfolio here.
      </p>
      <HowTips keys={PLATES.map((d) => d.tip)} allowShort={a.allowShort} />
    </>
  );
  // The Sharpe ratio worked out, in a fold under the verdict that compares it.
  const note = (
    <FormulaLine
      build={() => {
        const w = customWeights(v);
        return customFormula(v.custom.ok, w ? customMetrics(a, w) : null, a.rf, a.tangency ? a.tangency.sharpe : null);
      }}
    />
  );
  return (
    <div className="build-mix" id={MIX_ANCHOR} tabIndex={-1}>
      <Card title={MIX_TITLE} sub={verdict(a, v)} note={note} numbers={numbers} how={how}>
        <Boundary name="Custom weights" resetKey={v}>
          <Editor a={a} v={v} weights={weights} setWeights={setWeights} />
        </Boundary>
        <Boundary name="Custom portfolio figures" resetKey={v}>
          <Figures a={a} v={v} />
        </Boundary>
      </Card>
    </div>
  );
});
