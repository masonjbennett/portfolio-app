// "As published": the published walk-forward test replayed from the weights it held, its figures quoted
// from src/content/published.ts. Nothing here fetches prices or solves anything.
//
// PROPS CONTRACT (src/tabs/WalkForward.tsx builds them):
//   level: Level                                  the explanation level for tooltips
//   rerun: (tickers: readonly string[]) => void   "Rerun this set on fresh prices": sets the rail to these
//          tickers, the published run's start, an end that makes its last bar the last one loaded, its rate
//          typed into the rail and shorting off, then shows "Your basket". Call it with a set's tickers.
//
// Two sources, never mixed within a figure:
//   - the published strings (the nine, 1.107, the AGG weight and the five Apple weights) are printed exactly as
//     published.ts holds them;
//   - everything else (each hold's dates, its count of daily returns, its Sharpe ratio, the weights held, the
//     rate, the exact solve's figures) is read from src/content/walkforward.ts, the stored record of the same
//     run, and printed through format(). test/t-walkforward-published.mjs replays that record's weights on the
//     run's frozen prices and holds the two sources to each other. The Apple lookbacks are the exception: the
//     suite holds them to the record's own refit (test/oracle/walkforward.py's check refits them), not to a
//     replay.
// The solver note is worked out here, not written: it names whichever of the nine the exact solve prints
// differently, so a regenerated record cannot leave it saying the wrong thing.
import Slug from "../../components/Slug.tsx";
import Table from "../../components/Table.tsx";
import {
  CROSS_AGG_INTO_2022,
  MEGA_CAP_APPLE,
  MEGA_CAP_IN_SAMPLE,
  PUBLISHED_SETS,
  PUBLISHED_URL,
  PUBLISHED_WHEN,
  type PublishedSet,
} from "../../content/published.ts";
import { WALK_AGG, WALK_APPLE, WALK_RF, WALK_RUNS, type ByConstruction, type PublishedRun } from "../../content/walkforward.ts";
import { format } from "../../format.ts";
import type { Column, Level, TableRow } from "../../types.ts";
import { FITTED, tableSpan, windowsSpan } from "../caption.ts";
import { PAIR_HEADING, RERUN_START } from "./terms.ts";
import "./Published.css";

export interface PublishedProps {
  level: Level;
  rerun: (tickers: readonly string[]) => void;
}

type Key = keyof ByConstruction<unknown>;
const KEYS: readonly Key[] = ["ew", "gmv", "tan"];
// The names Your basket gives the same three constructions.
const LABEL: Readonly<Record<Key, string>> = { ew: "Equal weight", gmv: "Minimum variance (GMV)", tan: "Maximum Sharpe (Tangency)" };
// Where each construction's published string sits in published.ts.
const FIELD: Readonly<Record<Key, "ew" | "gmv" | "tangency">> = { ew: "ew", gmv: "gmv", tan: "tangency" };
// The two constructions whose weights a solver chose; equal weight is fixed in advance.
const FITTED_KEYS: readonly Key[] = ["gmv", "tan"];

// The fitted head's variant for weights chosen afresh before every hold, and the head of a hold's own figure.
const FITTED_EACH = "weights chosen on the fit window before each hold";
const HELD = "Sharpe ratio of the held days";

// The published figures of a run, paired by the run's tickers in order.
function publishedFor(run: PublishedRun): PublishedSet | null {
  return PUBLISHED_SETS.find((p) => p.tickers.join(" ") === run.tickers.join(" ")) ?? null;
}

const PAIRS = WALK_RUNS.flatMap((run) => {
  const pub = publishedFor(run);
  return pub ? [{ run, pub }] : [];
});

const day = (iso: string) => format(iso, "date");

/** Which of the nine an exact solve on the same prices prints differently, what it prints, and the published string. */
export function solverDiffers(): { set: string; label: string; exact: string; published: string }[] {
  return PAIRS.flatMap(({ run, pub }) =>
    KEYS.flatMap((k) => {
      const exact = format(run.tight.sharpe[k], "num3");
      return exact === pub[FIELD[k]] ? [] : [{ set: pub.name, label: LABEL[k], exact, published: pub[FIELD[k]] }];
    }),
  );
}

function SolverNote() {
  const differs = solverDiffers();
  const total = PAIRS.length * KEYS.length;
  if (differs.length === 0)
    return (
      <p className="wfp-foot" data-note="solver">
        Solver note: solved exactly on the same prices, all {format(total, "int")} figures print as published.
      </p>
    );
  return (
    <p className="wfp-foot" data-note="solver">
      Solver note: the published run's weights are where the app's solver stopped at its default tolerance, a little short of
      the exact solution. Solved exactly on the same prices, {format(differs.length, "int")} of the {format(total, "int")}{" "}
      figures print differently:{" "}
      {differs.map((d, i) => (
        <span key={`${d.set} ${d.label}`} data-differs={`${d.set}|${d.label}`}>
          {i > 0 ? "; " : ""}
          {d.set}, {d.label.charAt(0).toLowerCase() + d.label.slice(1)}, <span className="num">{d.exact}</span> where the note
          prints <span className="num">{d.published}</span>
        </span>
      ))}
      . That is how much a third decimal can rest on where a solver stops.
    </p>
  );
}

function NineTable() {
  const folds = WALK_RUNS[0].folds;
  const columns: Column[] = [
    { key: "set", label: "Set", format: "text", first: true },
    { key: "tickers", label: "Tickers", format: "text" },
    ...KEYS.map((k): Column => ({ key: k, label: LABEL[k], format: "num3" })),
  ];
  // The published strings, as published.ts holds them: a string in a figure column prints as given.
  const rows: TableRow[] = PAIRS.map(({ pub }) => ({
    set: pub.name,
    tickers: pub.tickers.join(" "),
    ew: pub.ew,
    gmv: pub.gmv,
    tan: pub.tangency,
  }));
  return (
    <Table
      title="Out-of-sample Sharpe ratios, as published"
      columns={columns}
      rows={rows}
      filename="walk_forward_published"
      span={tableSpan(folds[0].holdFirst, folds[folds.length - 1].holdLast)}
      subs={Object.fromEntries(FITTED_KEYS.map((k) => [LABEL[k], FITTED_EACH]))}
    />
  );
}

function Decay() {
  // 1.107 belongs to the mega-caps' run alone: found by its key, never by position.
  const mega = PAIRS.find((p) => p.run.key === "megacap5");
  if (!mega) return null;
  const { run, pub } = mega;
  const folds = run.folds;
  return (
    <>
      <p className="wfp-text">
        The pair the published sentence quotes: the {pub.name.toLowerCase()}' maximum-Sharpe portfolio, scored on the window it
        was fitted to and on the days it had not seen.
      </p>
      <dl className="wfp-decay" aria-label={`${pub.name}, maximum Sharpe: in-sample against out-of-sample`}>
        <div className="wfp-decay-item">
          <dt>In-sample</dt>
          <dd>
            <span className="wfp-decay-figure num">{MEGA_CAP_IN_SAMPLE}</span>
            <span className="wfp-decay-what">
              fitted and scored on the run's whole window, daily returns {day(folds[0].fitFirst)} to {day(run.lastBar)}, the
              held-out years included
            </span>
          </dd>
        </div>
        <div className="wfp-decay-item">
          <dt>Out-of-sample</dt>
          <dd>
            <span className="wfp-decay-figure num">{pub.tangency}</span>
            <span className="wfp-decay-what">
              the {format(folds.length, "int")} holds' days joined, {day(folds[0].holdFirst)} to{" "}
              {day(folds[folds.length - 1].holdLast)}, each on weights chosen before it began
            </span>
          </dd>
        </div>
      </dl>
    </>
  );
}

function Convention() {
  const folds = WALK_RUNS[0].folds;
  const first = folds[0];
  const last = folds[folds.length - 1];
  const partial = last.rows < first.rows;
  return (
    <>
      <p className="wfp-text">
        The first fit used the window's first {format(first.fitRows, "int")} daily returns, {day(first.fitFirst)} to{" "}
        {day(first.fitLast)}. Then came holds of {format(first.rows, "int")} trading days counted forward, each preceded by a
        refit on every return before it: {format(folds.length, "int")} holds in all
        {partial ? (
          <>
            , the last of them partial, {format(last.rows, "int")} days from {day(last.holdFirst)} to {day(last.holdLast)}
          </>
        ) : null}
        . Weights were held constant through each hold and rebalanced daily. The held days of every hold were joined into one
        series and scored once, as one Sharpe ratio, at the {format(WALK_RF, "pct1")} risk-free rate the app used then, the
        same rate the maximum-Sharpe fits used.
      </p>
      <p className="wfp-text">These are the weights the app's own solver fitted at the time.</p>
    </>
  );
}

function FoldTable({ run, name }: { run: PublishedRun; name: string }) {
  const columns: Column[] = [
    { key: "hold", label: "Hold", format: "text", first: true },
    { key: "fitRows", label: "Fit days", format: "int" },
    { key: "holdFirst", label: "Held from", format: "date" },
    { key: "holdLast", label: "Held to", format: "date" },
    { key: "rows", label: "Held days", format: "int" },
    ...KEYS.map((k): Column => ({ key: k, label: LABEL[k], format: "num3" })),
  ];
  const rows: TableRow[] = run.folds.map((f, i) => ({
    hold: `Hold ${i + 1}`,
    fitRows: f.fitRows,
    holdFirst: f.holdFirst,
    holdLast: f.holdLast,
    rows: f.rows,
    ...Object.fromEntries(KEYS.map((k) => [k, run.ship.foldSharpe[k][i] ?? null])),
  }));
  return (
    <Table
      title={`${name}: each hold`}
      columns={columns}
      rows={rows}
      filename={`walk_forward_published_${run.key}_holds`}
      span={tableSpan(run.folds[0].fitFirst, run.folds[run.folds.length - 1].holdLast)}
      subs={Object.fromEntries(KEYS.map((k) => [LABEL[k], HELD]))}
    />
  );
}

function WeightsTable({ run, name, k }: { run: PublishedRun; name: string; k: Key }) {
  const columns: Column[] = [
    { key: "hold", label: "Hold", format: "text", first: true },
    { key: "fitLast", label: "Fitted through", format: "date" },
    ...run.tickers.map((t): Column => ({ key: `w:${t}`, label: t, format: "pct1" })),
  ];
  const aggAt = run.key === "cross" && k === "gmv" ? run.tickers.indexOf(WALK_AGG.ticker) : -1;
  const rows: TableRow[] = run.folds.map((f, i) => ({
    hold: `Hold ${i + 1}`,
    fitLast: f.fitLast,
    ...Object.fromEntries(
      run.tickers.map((t, j) => {
        const w = run.ship.weights[k][i]?.[j] ?? null;
        // The one weight the published note prints is quoted, as the note prints it.
        return [`w:${t}`, i === WALK_AGG.fold && j === aggAt ? CROSS_AGG_INTO_2022 : w];
      }),
    ),
  }));
  const word = k === "gmv" ? "minimum-variance" : "maximum-Sharpe";
  return (
    <Table
      title={`${name}: ${word} weights`}
      columns={columns}
      rows={rows}
      filename={`walk_forward_published_${run.key}_${k}_weights`}
      span={tableSpan(run.folds[0].fitFirst, run.folds[run.folds.length - 1].fitLast)}
      subs={{ "Fitted through": FITTED_EACH }}
    />
  );
}

function AppleTable({ lastBar }: { lastBar: string }) {
  const columns: Column[] = [
    { key: "lookback", label: "Lookback", format: "text", first: true },
    { key: "rows", label: "Daily returns", format: "int" },
    { key: "weight", label: "Weight in AAPL", format: "pct1" },
  ];
  // The lookbacks and their lengths from the record; the weights quoted as the note prints them.
  const rows: TableRow[] = WALK_APPLE.map((w, i) => ({ lookback: w.label, rows: w.rows, weight: MEGA_CAP_APPLE[i] ?? null }));
  return (
    <Table
      title="Maximum-Sharpe weight in AAPL by lookback, as published"
      columns={columns}
      rows={rows}
      filename="walk_forward_published_aapl_lookbacks"
      span={windowsSpan(lastBar)}
      subs={{ "Weight in AAPL": FITTED }}
    />
  );
}

function SetSection({ run, pub, rerun }: { run: PublishedRun; pub: PublishedSet; rerun: (tickers: readonly string[]) => void }) {
  const headId = `wfp-set-${run.key}`;
  const into = run.folds[WALK_AGG.fold];
  return (
    <section className="wfp-set" aria-labelledby={headId} data-set={run.key}>
      <Slug id={headId}>{pub.name}</Slug>
      <div className="wfp-rerun">
        <p className="wfp-text">
          <span className="num">{run.tickers.join(" ")}</span>, prices {day(run.firstBar)} to {day(run.lastBar)}.
        </p>
        <button type="button" className="wfp-rerun-button" onClick={() => rerun(run.tickers)} aria-describedby={headId}>
          Rerun this set on fresh prices
        </button>
      </div>
      <FoldTable run={run} name={pub.name} />
      {FITTED_KEYS.map((k) => (
        <div key={k}>
          <WeightsTable run={run} name={pub.name} k={k} />
          {k === "gmv" && run.key === "cross" && into ? (
            <p className="wfp-text" data-note="agg">
              The {WALK_AGG.ticker} weight in hold {format(WALK_AGG.fold + 1, "int")} of the minimum-variance table above, held
              from {day(into.holdFirst)}, is the figure the published note gives for the minimum-variance portfolio going into{" "}
              {into.holdFirst.slice(0, 4)}.
            </p>
          ) : null}
        </div>
      ))}
      {run.key === "megacap5" ? (
        <>
          <p className="wfp-text">
            The published note's other measured figure: how far the maximum-Sharpe weight in AAPL moves with the lookback alone,
            at the Sensitivity tab's {format(WALK_APPLE.length, "int")} lookbacks, each ending {day(run.lastBar)}, at the same{" "}
            {format(WALK_RF, "pct1")} rate. Fitted again by the app's own solver on the run's frozen prices (the stored record of
            that refit), each weight rounds to the published figure.
          </p>
          <AppleTable lastBar={run.lastBar} />
        </>
      ) : null}
    </section>
  );
}

export default function Published({ rerun }: PublishedProps) {
  return (
    <div className="wfp" data-segment="published">
      <p className="wfp-lede">
        The walk-forward test published in {PUBLISHED_WHEN}, replayed from the weights it held. Its figures are quoted as the
        published note prints them; every other number here is read from a stored record of the same run (its schedule, the
        weights held in each hold and each hold's result), which this page's tests replay on the run's own frozen prices
        (the Apple lookbacks are held to the stored record of their refit).
        Nothing is fetched and nothing is solved again. <a href={PUBLISHED_URL}>Method note on masonjbennett.com</a>
      </p>

      <Slug>The published figures</Slug>
      <NineTable />
      <SolverNote />

      <Slug>{PAIR_HEADING}</Slug>
      <Decay />

      <Slug>How the test was run</Slug>
      <Convention />
      <p className="wfp-text">
        Each set's button below loads its tickers in the rail with prices from {day(RERUN_START)} through{" "}
        {day(WALK_RUNS[0].lastBar)}, a typed{" "}
        {format(WALK_RF, "pct1")} risk-free rate and shorting off, then opens Your basket. That segment solves every fit
        exactly, on prices as the source serves them today, so its figures can differ from these in the third decimal: see the
        solver note above.
      </p>

      {PAIRS.map(({ run, pub }) => (
        <SetSection key={run.key} run={run} pub={pub} rerun={rerun} />
      ))}
    </div>
  );
}
