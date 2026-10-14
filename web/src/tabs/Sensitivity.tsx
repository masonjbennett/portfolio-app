// The Sensitivity tab (portfolio_app.py 1842-2021): the GMV and tangency portfolios re-estimated on
// trailing windows of 1, 2, 3 and 5 years and the full sample, to show how far the weights move when
// only the lookback changes. It is Does it hold up?'s second half, a More list under the walk-forward test:
// the weights row (its finding the old headline, the chart, the two weight tables under Show the numbers), the
// in-sample metrics row, and the custom row, which stands for the app's opt-in checkbox (1950-1954): nothing of
// it is scored until the row opens.
//
// Every figure comes from ./sensitivity/model.ts. What differs from the app, and why, is listed
// there; on this page it shows as: the metrics are labelled in-sample (the app's heading and caption
// at 1904-1905 do not say so), a failed solve prints a dash and is named instead of vanishing, every
// table downloads as CSV and Excel (the app offers CSV for the two weight tables only, 1930-1932),
// and the too-short message states the one-year rule the code applies.
import { memo, useMemo, useState } from "react";
import Boundary from "../components/Boundary.tsx";
import Card from "../components/Card.tsx";
import ChartFrame from "../components/ChartFrame.tsx";
import FormulaLine from "../components/FormulaLine.tsx";
import HowTips from "../components/HowTips.tsx";
import MoreList, { type MoreRow } from "../components/MoreList.tsx";
import SegControl from "../components/SegControl.tsx";
import Table from "../components/Table.tsx";
import { ROLE } from "../charts/theme.ts";
import { format, MINUS } from "../format.ts";
import type { Column, LoadState, TableRow, TabProps } from "../types.ts";
import { windowsSpan } from "./caption.ts";
import { sensitivityFormula } from "./formula.ts";
import { customFinding, metricsFinding, SENS_HEADING, SENS_LIST, SENS_ROWS } from "./holdup.ts";
import { said } from "./performance.ts";
import GroupedBars, { type Series } from "./sensitivity/GroupedBars.tsx";
import {
  belowRf,
  CUSTOM_REFUSAL,
  customRows,
  customWeights,
  customWeightTable,
  failedWindows,
  fitWindows,
  headline,
  METRIC_COLUMNS,
  metricRows,
  PORT_NAME,
  sharpeChartTitle,
  sharpeGroups,
  swing,
  tableState,
  weightChartTitle,
  weightColumns,
  weightGroups,
  weightRows,
  windowSubs,
  type Port,
  type WindowFit,
} from "./sensitivity/model.ts";
import "./sensitivity/Sensitivity.css";

const PORT_OPTIONS: readonly { value: Port; label: string }[] = [
  { value: "gmv", label: "GMV" },
  { value: "tan", label: "Tangency" },
];

// A table, or its own named empty or error line in the table's place. The caption's span says the
// windows all end on the same day; `subs` puts that day under each window's column head.
function TableState({ state, title, columns, filename, span, subs }: {
  state: LoadState<TableRow[]>;
  title: string;
  columns: Column[];
  filename: string;
  span: string;
  subs?: Readonly<Record<string, string>>;
}) {
  if (state.status === "ready") return <Table title={title} columns={columns} rows={state.value} filename={filename} span={span} subs={subs} />;
  const says =
    state.status === "error"
      ? `${title}: not shown. ${state.name} failed. ${state.message}`
      : state.status === "empty"
        ? `${title}: ${state.reason}`
        : `${title}: loading.`;
  return (
    <p className={`sens-note${state.status === "error" ? " sens-note--error" : ""}`} role={state.status === "error" ? "alert" : "status"}>
      {says}
    </p>
  );
}

function listing(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

// "Each window is the most recent 1, 2, 3 or 5 years of daily returns ..., or the full sample, ..."
export function windowsSentence(fits: WindowFit[], asOf: string): string {
  const years = fits.filter((f) => f.label !== "Full Sample").map((f) => f.lb / 252);
  const list = years.length <= 1 ? years.join("") : `${years.slice(0, -1).join(", ")} or ${years[years.length - 1]}`;
  const unit = years.length === 1 && years[0] === 1 ? "year" : "years";
  return (
    `Each window is the most recent ${list} ${unit} of daily returns (252 trading days to a year), or the full sample, ` +
    `all ending ${asOf}.`
  );
}

function windowNote(labels: string[]): string {
  return `${listing(labels)} window${labels.length === 1 ? "" : "s"}`;
}

// The windows whose tangency did not beat the rate. Only the mixes inside the current bounds were
// searched, so the sentence names them, as the Band does: long-only, or each weight inside [-1, 1].
// With shorting on a window like that fails its solve instead (sensitivity/model.ts), so today only
// the long-only wording reaches the page; the other keeps the sentence true if that ever changes.
export function belowNote(labels: string[], rf: number, allowShort: boolean): string {
  const which = allowShort ? `mix with weights inside [${MINUS}1, 1]` : "long-only mix";
  return (
    `In the ${windowNote(labels)} no ${which} beat the ${format(rf, "pct2")} risk-free rate, so the tangency row there is ` +
    "the mix with the least negative Sharpe ratio."
  );
}

export default function Sensitivity({ analysis: a, level, weights }: TabProps) {
  // A throw in fitWindows fails the whole part, and App's own Boundary re-arms on the next analysis. The
  // rows below re-arm on the next fit (a new analysis), the custom row on new weights as well.
  const fitted = useMemo(() => fitWindows(a), [a]);
  const customKey = useMemo(() => [fitted, weights], [fitted, weights]);
  // Tangency first: the weights row's finding leads with tangency's swing, so the first picture is the one it describes.
  const [port, setPort] = useState<Port>("tan");

  if (fitted.status !== "ready") {
    return (
      <section className="sens" aria-label="Sensitivity">
        <h3 className="more-head">{SENS_HEADING}</h3>
        <ChartFrame title="Weights across estimation windows" state={fitted}>
          {() => null}
        </ChartFrame>
      </section>
    );
  }

  const fits = fitted.value;
  const rows: MoreRow[] = [
    {
      key: "weights",
      title: SENS_ROWS.weights,
      // The finding is the old headline whole: which weight the choice of window moves most, for each portfolio.
      finding: said(SENS_ROWS.weights, () => headline(fits, a.tickers)),
      note: (
        <Boundary name="The sensitivity formula" resetKey={fitted}>
          <FormulaLine
            level={level}
            build={() => sensitivityFormula(fits.length, swing(fits, "tan", a.tickers), swing(fits, "gmv", a.tickers), a.rf, a.allowShort)}
          />
        </Boundary>
      ),
      children: (
        <Boundary name="Weight comparison chart" resetKey={fitted}>
          <WeightCard fits={fits} port={port} setPort={setPort} tickers={a.tickers} rf={a.rf} asOf={a.asOf} />
        </Boundary>
      ),
    },
    {
      key: "metrics",
      title: SENS_ROWS.metrics,
      finding: said(SENS_ROWS.metrics, () => metricsFinding(fits, a.rf)),
      children: (
        <Boundary name="Portfolio metrics across windows" resetKey={fitted}>
          <Metrics fits={fits} rf={a.rf} allowShort={a.allowShort} />
        </Boundary>
      ),
    },
    {
      key: "custom",
      title: SENS_ROWS.custom,
      finding: said(SENS_ROWS.custom, () => customFinding(fits, a.tickers, weights, a.rf, a.allowShort)),
      children: (
        <Boundary name="Custom portfolio sensitivity" resetKey={customKey}>
          <CustomSection fits={fits} tickers={a.tickers} weights={weights} rf={a.rf} allowShort={a.allowShort} />
        </Boundary>
      ),
    },
  ];
  return (
    <section className="sens" aria-label="Sensitivity">
      <MoreList id={SENS_LIST} rows={rows} heading={SENS_HEADING} />
    </section>
  );
}

const WeightCard = memo(function WeightCard({ fits, port, setPort, tickers, rf, asOf }: {
  fits: WindowFit[];
  port: Port;
  setPort: (p: Port) => void;
  tickers: string[];
  rf: number;
  asOf: string;
}) {
  const groups = weightGroups(fits, port, tickers);
  const n = fits.length;
  // One hue per portfolio, the windows from light (shortest) to full (longest).
  const series: Series[] = fits.map((f, i) => ({
    name: f.label,
    label: f.short,
    color: port === "gmv" ? ROLE.gmv : ROLE.tangency,
    opacity: n === 1 ? 1 : 0.3 + (0.7 * i) / (n - 1),
  }));
  const state: LoadState<typeof groups> = failedWindows(fits, port).length === n
    ? { status: "error", name: `The ${PORT_NAME[port]} optimisation`, message: "It failed in every window, so there are no weights to draw." }
    : { status: "ready", value: groups };
  const numbers = (
    <>
      <p className="sens-caption">Rows sorted by ticker. A dash marks a window whose optimisation found no solution.</p>
      {(["gmv", "tan"] as const).map((p) => (
        <TableState
          key={p}
          state={tableState(fits, p, weightRows(fits, p, tickers))}
          title={`${PORT_NAME[p]} Weights Across Windows`}
          columns={weightColumns(fits)}
          filename={p === "gmv" ? "gmv_sensitivity" : "tangency_sensitivity"}
          span={windowsSpan(fits[0].to)}
          subs={windowSubs(fits)}
        />
      ))}
    </>
  );
  const how = (
    <p className="sens-caption">
      Mean-variance optimization is sensitive to its inputs: small changes in the lookback period used to estimate returns and
      covariances can produce very different portfolio weights. {windowsSentence(fits, asOf)} Every window is scored at the same risk-free rate, {format(rf, "pct2")}, the one this page
      uses throughout (by default the mean over the whole date range), not the rate that prevailed during each shorter window.
    </p>
  );
  return (
    <Card label={SENS_ROWS.weights} numbers={numbers} how={how}>
      <div className="sens-hero">
        <div className="sens-switch">
          <SegControl options={PORT_OPTIONS} value={port} onChange={setPort} ariaLabel="Portfolio" />
        </div>
        <ChartFrame
          title={weightChartTitle(fits, port, tickers)}
          subtitle={`Weight in each asset, one bar per window (${fits.map((f) => f.short).join(", ")}); darker bars are longer windows.`}
          state={state}
          height={400}
        >
          {(g) => <GroupedBars groups={g} series={series} valueFormat="pct2" axis="pct" height={400} />}
        </ChartFrame>
      </div>
    </Card>
  );
});

const Metrics = memo(function Metrics({ fits, rf, allowShort }: { fits: WindowFit[]; rf: number; allowShort: boolean }) {
  const below = belowRf(fits);
  const how = (
    <>
      <p className="sens-caption">
        Annualized return, volatility, and Sharpe ratio for each optimized portfolio under different estimation windows. In-sample:
        each portfolio is optimised on a window's returns and then scored on those same returns, so these figures describe the fit,
        not what the weights went on to earn.
      </p>
      <HowTips keys={["return", "volatility", "sharpe"]} allowShort={allowShort} />
    </>
  );
  return (
    <Card label={SENS_ROWS.metrics} how={how}>
      <div className="sens-pair">
        {(["gmv", "tan"] as const).map((p) => (
          <TableState
            key={p}
            state={tableState(fits, p, metricRows(fits, p, rf))}
            title={`${PORT_NAME[p]} Portfolio (in-sample)`}
            columns={METRIC_COLUMNS}
            filename={p === "gmv" ? "gmv_window_metrics" : "tangency_window_metrics"}
            span={windowsSpan(fits[0].to)}
          />
        ))}
      </div>
      {(["gmv", "tan"] as const).map((p) => {
        const failed = failedWindows(fits, p);
        if (!failed.length || failed.length === fits.length) return null;
        return (
          <p key={p} className="sens-note" role="status">
            The {PORT_NAME[p]} optimisation found no solution for the {windowNote(failed)}; those rows print dashes and those bars are
            missing.
          </p>
        );
      })}
      {below.length ? (
        <p className="sens-note" role="status">
          {belowNote(below, rf, allowShort)}
        </p>
      ) : null}
    </Card>
  );
});

const CustomSection = memo(function CustomSection({ fits, tickers, weights, rf, allowShort }: {
  fits: WindowFit[];
  tickers: string[];
  weights: TabProps["weights"];
  rf: number;
  allowShort: boolean;
}) {
  const c = customWeights(tickers, weights, allowShort);
  if (!c.ok) {
    return (
      <p className="sens-note sens-note--error" role="alert">
        Custom portfolio not evaluated. {CUSTOM_REFUSAL[c.reason]}
      </p>
    );
  }
  const table = customWeightTable(tickers, c.w);
  const groups = sharpeGroups(fits, c.w, rf);
  const series: Series[] = [
    { name: "GMV", label: "GMV", color: ROLE.gmv },
    { name: "Tangency", label: "Tangency", color: ROLE.tangency },
    { name: "Custom", label: "Custom", color: ROLE.custom },
  ];
  const how = (
    <p className="sens-caption">
      Your custom weights are held fixed and scored on each window's mean returns and covariance: unlike GMV and Tangency, the
      weights do not change, only the estimates do. Each window's tangency portfolio is, by construction, the highest Sharpe ratio
      any mix within the bounds reached on that window, so a fixed mix can at best tie it. The GMV and Tangency figures for the
      same windows are in the metrics row above.
    </p>
  );
  return (
    <Card label={SENS_ROWS.custom} how={how}>
      <div className="sens-custom">
      {c.clamped ? (
        <p className="sens-note" role="status">
          Some custom weights were outside the current bounds and were clamped to them before normalising.
        </p>
      ) : null}
      {/* No span: these are the weights as typed, which come from no dates. */}
      <Table title="Custom weights being evaluated" columns={table.columns} rows={table.rows} filename="custom_weights_evaluated" span={null} />
      <TableState
        state={{ status: "ready", value: customRows(fits, c.w, rf) }}
        title="Custom Portfolio (in-sample)"
        columns={METRIC_COLUMNS}
        filename="custom_window_metrics"
        span={windowsSpan(fits[0].to)}
      />
      <ChartFrame
        title={sharpeChartTitle(groups)}
        subtitle="Sharpe Ratio Comparison Across Estimation Windows: GMV, Tangency and Custom, each scored in-sample."
        state={{ status: "ready", value: groups }}
        height={380}
      >
        {(g) => <GroupedBars groups={g} series={series} valueFormat="num3" axis="num" height={380} />}
      </ChartFrame>
      </div>
    </Card>
  );
});
