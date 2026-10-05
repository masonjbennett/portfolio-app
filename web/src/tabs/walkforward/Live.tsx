// "Your basket": the walk-forward test run on the basket in the rail, on the exact engine.
//
// PROPS CONTRACT (src/tabs/WalkForward.tsx builds them):
//   analysis: Analysis   the analysis on screen: returns, dates, prices, rf, allowShort, as every tab gets it
//   settings: Settings   the rail's settings (rf is the rate set in the rail, a decimal, or null)
//   level:    Level      the explanation level for tooltips
//   rates:    WalkRates  the rate input (src/types.ts):
//               points  FRED's daily 3-month bill yields (DGS3MO), [ISO day, annual decimal], ascending, when the
//                       series held starts on or before the analysis' first price day and has an observation
//                       inside the window, and no rate is set in the rail (days after its last observation
//                       carry that one forward): each refit's tangency takes the last observation on or before its fit's last bar,
//                       and each held day is scored on its return minus that day's rate / 252, the series
//                       carried forward over days FRED did not publish;
//               null    run flat at analysis.rf, and `flat` says why: "typed" (a rate is set in the rail),
//                       "loading" (the series is on its way), "unavailable" (it could not be had) or
//                       "uncovered" (the series held starts after the window's first day, or has nothing inside it);
//               basis   what the analysis on screen is scored against (src/state/rfwindow.ts RfBasis).
//
// What it lays out, top to bottom: the line saying what the run was computed on against what the published
// note used; the two options and the switch for the four added constructions; then, once the run is solved
// (./liveSolve.ts, after paint), the in-sample and out-of-sample figures side by side with the drop drawn as
// dumbbells, what a gap between them can carry, and hold by hold, each hold's figures and the weights it held.
// A window too short for one fit and one hold says so and shows nothing else. The arithmetic and every
// sentence with a number in it live in ./live.ts.
import { memo, useMemo, useState } from "react";
import Boundary from "../../components/Boundary.tsx";
import SegControl from "../../components/SegControl.tsx";
import Slug from "../../components/Slug.tsx";
import Table from "../../components/Table.tsx";
import Tip from "../../components/Tip.tsx";
import { DEFAULT_WALK, type Construction, type FitMode, type HoldRows, type Walk, type WalkOptions } from "../../lib/walkforward.ts";
import type { Analysis, Level, Settings, WalkRates } from "../../types.ts";
import Dumbbell from "./Dumbbell.tsx";
import {
  belowRateNote,
  CITE_AUTHORS,
  CITE_TITLE,
  cannotRun,
  conventionLine,
  decayLine,
  FIT_OPTIONS,
  foldTable,
  HOLD_OPTIONS,
  labelLine,
  liveRows,
  OOS_HEAD,
  publishedTermsNote,
  ratePlan,
  rowsTable,
  SE_HEAD,
  seSentence,
  shortHoldNote,
  weightChoices,
  weightsTable,
  YARDSTICK,
  type LiveTable,
} from "./live.ts";
import { useLiveWalk } from "./liveSolve.ts";
import { WALK_TIPS } from "./tips.ts";
import { PAIR_HEADING, PUBLISHED_LAST_BAR, PUBLISHED_RF, RERUN_START } from "./terms.ts";
import "./Live.css";

export interface LiveProps {
  analysis: Analysis;
  settings: Settings;
  level: Level;
  rates: WalkRates;
}

const Bells = memo(Dumbbell);

/** The words on the switch that adds the four other constructions. */
export const ADDED_SWITCH = "Add the four other constructions";

// The published run's terms, which the label line compares the page's own run with.
const published = () => ({ lastBar: PUBLISHED_LAST_BAR, rf: PUBLISHED_RF });

// Memo'd, with every table memo'd on the run, so an explanation level reaches the tooltips and no table.
const LiveTableView = memo(function LiveTableView({ t }: { t: LiveTable }) {
  return <Table title={t.title} columns={t.columns} rows={t.rows} filename={t.filename} span={t.span} subs={t.subs} />;
});

// The figures side by side: what the whole window promised and what the held-out days paid, then what a gap
// between two of them can carry. `terms` is the line for a run on the published run's own terms, or null.
const Figures = memo(function Figures({ a, w, level, terms }: { a: Analysis; w: Walk; level: Level; terms: string | null }) {
  const rows = useMemo(() => liveRows(a, w), [a, w]);
  const table = useMemo(() => rowsTable(a, w, rows), [a, w, rows]);
  const decay = decayLine(rows);
  const se = seSentence(w, rows);
  const missing = rows.flatMap((r) => (r.missing ? [r.missing] : []));
  return (
    <section className="wfl-section" aria-labelledby="wfl-figures">
      <Slug id="wfl-figures">{PAIR_HEADING}</Slug>
      {decay ? <p className="wfl-finding">{decay}</p> : null}
      <Bells rows={rows} />
      <p className="wfl-key">
        <span className="wfl-key-name">About the columns below:</span>
        <span>
          {OOS_HEAD} <Tip own={WALK_TIPS.oos} level={level} />
        </span>
        <span>
          {SE_HEAD} <Tip own={WALK_TIPS.se} level={level} />
        </span>
      </p>
      <LiveTableView t={table} />
      {missing.map((m) => (
        <p key={m} className="wfl-note wfl-note--missing" role="status">
          {m}
        </p>
      ))}
      {terms ? <p className="wfl-note wfl-note--terms">{terms}</p> : null}
      {se ? <p className="wfl-note">{se}</p> : null}
      <p className="wfl-note">{YARDSTICK}</p>
      <p className="wfl-note">{conventionLine(w)}</p>
      <p className="wfl-note wfl-cite">
        This repeats on your basket the out-of-sample test published by {CITE_AUTHORS}, <cite>{CITE_TITLE}</cite>
      </p>
    </section>
  );
});

// Hold by hold: each hold's dates, rate and held figures, then the weights one fitted construction held.
const Holds = memo(function Holds({ a, w }: { a: Analysis; w: Walk }) {
  const rows = useMemo(() => liveRows(a, w), [a, w]);
  const table = useMemo(() => foldTable(a, w, rows), [a, w, rows]);
  const choices = useMemo(() => weightChoices(w), [w]);
  const [pick, setPick] = useState<string>("tan");
  const shown = choices.some((c) => c.value === pick) ? pick : (choices[0]?.value ?? "tan");
  const weights = useMemo(() => weightsTable(a, w, shown as Construction), [a, w, shown]);
  const short = shortHoldNote(w);
  const below = belowRateNote(a, w, shown as Construction);
  return (
    <section className="wfl-section" aria-labelledby="wfl-holds">
      <Slug id="wfl-holds">Hold by hold</Slug>
      <LiveTableView t={table} />
      {short ? <p className="wfl-note">{short}</p> : null}
      <div className="wfl-row">
        <span className="wfl-row-label">Weights of</span>
        <SegControl options={choices} value={shown} onChange={setPick} ariaLabel="Weights of" />
      </div>
      {weights ? <LiveTableView t={weights} /> : null}
      {below ? <p className="wfl-note wfl-note--below">{below}</p> : null}
    </section>
  );
});

export default function Live({ analysis: a, level, rates }: LiveProps) {
  const [opts, setOpts] = useState<WalkOptions>(DEFAULT_WALK);
  const [added, setAdded] = useState(false);
  const plan = useMemo(() => ratePlan(a, rates), [a, rates]);
  const state = useLiveWalk(a, plan, opts, added);
  const label = useMemo(() => labelLine(a, plan, published()), [a, plan]);
  const assets = a.returns.length;
  const done = state.status === "ready" && state.value.ok ? state.value : null;
  const terms = useMemo(() => (done ? publishedTermsNote(a, plan, done, opts, published(), RERUN_START) : null), [a, plan, done, opts]);

  if (state.status === "ready" && !state.value.ok) {
    return (
      <div className="wfl" data-segment="basket">
        <p className="wfl-cannot" role="status">
          {cannotRun(state.value)}
        </p>
      </div>
    );
  }
  const w = state.status === "ready" && state.value.ok ? state.value : null;
  return (
    <div className="wfl" data-segment="basket">
      <div className="wfl-label">
        {label.map((s) => (
          <p key={s}>{s}</p>
        ))}
      </div>
      <div className="wfl-options">
        <div className="wfl-row">
          <span className="wfl-row-label">
            Fit on <Tip own={WALK_TIPS.fit} level={level} />
          </span>
          <SegControl options={FIT_OPTIONS} value={opts.fit} onChange={(fit: FitMode) => setOpts((o) => ({ ...o, fit }))} ariaLabel="Fit on" />
        </div>
        <div className="wfl-row">
          <span className="wfl-row-label">
            Hold for <Tip own={WALK_TIPS.hold} level={level} />
          </span>
          <SegControl
            options={HOLD_OPTIONS}
            value={String(opts.hold)}
            onChange={(v: string) => setOpts((o) => ({ ...o, hold: Number(v) as HoldRows }))}
            ariaLabel="Hold for"
          />
        </div>
        <div className="wfl-row">
          <button type="button" className="wfl-toggle" aria-pressed={added} onClick={() => setAdded((x) => !x)}>
            {ADDED_SWITCH}
          </button>
          <Tip own={WALK_TIPS.added} level={level} />
        </div>
      </div>
      <div className="wfl-results" aria-busy={w ? undefined : true}>
        {w ? (
          <>
            <Boundary name={PAIR_HEADING} resetKey={w}>
              <Figures a={a} w={w} level={level} terms={terms} />
            </Boundary>
            <Boundary name="Hold by hold" resetKey={w}>
              <Holds a={a} w={w} />
            </Boundary>
          </>
        ) : (
          <p className="wfl-note" role="status">
            Solving the test: every construction refitted before each hold, on {assets} assets.
          </p>
        )}
      </div>
    </div>
  );
}
