// The Sensitivity tab (portfolio_app.py 1842-2021): the GMV and tangency portfolios re-estimated on
// trailing windows of 1, 2, 3 and 5 years and the full sample, to show how far the weights move when
// only the lookback changes. Layout: the finding in one sentence, the weight chart, then the tables.
//
// Every figure comes from ./sensitivity/model.ts. What differs from the app, and why, is listed
// there; on this page it shows as: the metrics are labelled in-sample (the app's heading and caption
// at 1904-1905 do not say so), a failed solve prints a dash and is named instead of vanishing, every
// table downloads as CSV and Excel (the app offers CSV for the two weight tables only, 1930-1932),
// and the too-short message states the one-year rule the code applies.
import { useMemo, useState } from "react";
import Boundary from "../components/Boundary.tsx";
import ChartFrame from "../components/ChartFrame.tsx";
import SegControl from "../components/SegControl.tsx";
import Slug from "../components/Slug.tsx";
import Table from "../components/Table.tsx";
import Tip from "../components/Tip.tsx";
import { ROLE } from "../charts/theme.ts";
import { format, MINUS } from "../format.ts";
import type { Column, LoadState, TableRow, TabProps } from "../types.ts";
import { windowsSpan } from "./caption.ts";
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
  // A throw in fitWindows fails the whole tab, and App's own Boundary re-arms on the next analysis. The
  // cards below re-arm on the next fit (a new analysis), the custom card on new weights as well.
  const fitted = useMemo(() => fitWindows(a), [a]);
  const customKey = useMemo(() => [fitted, weights], [fitted, weights]);
  // Tangency first: the headline leads with tangency's swing, so the first picture is the one it describes.
  const [port, setPort] = useState<Port>("tan");
  const [withCustom, setWithCustom] = useState(false);

  if (fitted.status !== "ready") {
    return (
      <section className="sens" aria-label="Sensitivity">
        <h2 className="tab-finding sens-finding">No estimation window could be compared.</h2>
        <Slug>Estimation Window Sensitivity</Slug>
        <ChartFrame title="Weights across estimation windows" state={fitted}>
          {() => null}
        </ChartFrame>
      </section>
    );
  }

  const fits = fitted.value;
  return (
    <section className="sens" aria-label="Sensitivity">
      <Boundary name="The headline" resetKey={fitted}>
        <Finding fits={fits} tickers={a.tickers} />
      </Boundary>
      <Slug>Estimation Window Sensitivity</Slug>
      <p className="sens-caption">
        Mean-variance optimization is sensitive to its inputs: small changes in the lookback period used to estimate returns and
        covariances can produce very different portfolio weights. {windowsSentence(fits, a.asOf)} Every window is scored at the same risk-free rate, {format(a.rf, "pct2")}, the one this page
        uses throughout (by default the mean over the whole date range), not the rate that prevailed during each shorter window.
      </p>

      <Boundary name="Weight comparison chart" resetKey={fitted}>
        <WeightChart fits={fits} port={port} setPort={setPort} tickers={a.tickers} />
      </Boundary>

      <Boundary name="Portfolio metrics across windows" resetKey={fitted}>
        <Metrics fits={fits} rf={a.rf} level={level} allowShort={a.allowShort} />
      </Boundary>

      <Boundary name="Weights across windows" resetKey={fitted}>
        <Slug>Weights Across Windows</Slug>
        <p className="sens-caption">Rows sorted by ticker. A dash marks a window whose optimisation found no solution.</p>
        {(["gmv", "tan"] as const).map((p) => (
          <TableState
            key={p}
            state={tableState(fits, p, weightRows(fits, p, a.tickers))}
            title={`${PORT_NAME[p]} Weights Across Windows`}
            columns={weightColumns(fits)}
            filename={p === "gmv" ? "gmv_sensitivity" : "tangency_sensitivity"}
            span={windowsSpan(fits[0].to)}
            subs={windowSubs(fits)}
          />
        ))}
      </Boundary>

      <Boundary name="Custom portfolio sensitivity" resetKey={customKey}>
        <Slug>Custom Portfolio Sensitivity</Slug>
        <label className="sens-check">
          <input type="checkbox" checked={withCustom} onChange={(e) => setWithCustom(e.target.checked)} />
          <span>Include Custom Portfolio in sensitivity analysis</span>
        </label>
        <p className="sens-caption">Compare your custom portfolio weights against GMV and Tangency across different estimation windows.</p>
        {withCustom ? <CustomSection fits={fits} tickers={a.tickers} weights={weights} rf={a.rf} allowShort={a.allowShort} /> : null}
      </Boundary>
    </section>
  );
}

function Finding({ fits, tickers }: { fits: WindowFit[]; tickers: string[] }) {
  return <h2 className="tab-finding sens-finding">{headline(fits, tickers)}</h2>;
}

function WeightChart({ fits, port, setPort, tickers }: { fits: WindowFit[]; port: Port; setPort: (p: Port) => void; tickers: string[] }) {
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
  return (
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
  );
}

function Metrics({ fits, rf, level, allowShort }: { fits: WindowFit[]; rf: number; level: TabProps["level"]; allowShort: boolean }) {
  const below = belowRf(fits);
  return (
    <>
      <Slug>Portfolio Metrics Across Windows (in-sample)</Slug>
      <p className="sens-caption">
        Annualized return, volatility, and Sharpe ratio for each optimized portfolio under different estimation windows. In-sample:
        each portfolio is optimised on a window's returns and then scored on those same returns, so these figures describe the fit,
        not what the weights went on to earn.
      </p>
      <p className="sens-tips">
        <span>
          Ann. Return <Tip tip="return" level={level} allowShort={allowShort} />
        </span>
        <span>
          Ann. Volatility <Tip tip="volatility" level={level} allowShort={allowShort} />
        </span>
        <span>
          Sharpe <Tip tip="sharpe" level={level} allowShort={allowShort} />
        </span>
      </p>
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
    </>
  );
}

function CustomSection({ fits, tickers, weights, rf, allowShort }: {
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
  return (
    <div className="sens-custom">
      <p className="sens-caption">
        Your custom weights are held fixed and scored on each window's mean returns and covariance: unlike GMV and Tangency, the
        weights do not change, only the estimates do. Each window's tangency portfolio is, by construction, the highest Sharpe ratio
        any mix within the bounds reached on that window, so a fixed mix can at best tie it.
      </p>
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
      <p className="sens-caption">The GMV and Tangency figures for the same windows are in the in-sample tables above.</p>
      <ChartFrame
        title={sharpeChartTitle(groups)}
        subtitle="Sharpe Ratio Comparison Across Estimation Windows: GMV, Tangency and Custom, each scored in-sample."
        state={{ status: "ready", value: groups }}
        height={380}
      >
        {(g) => <GroupedBars groups={g} series={series} valueFormat="num3" axis="num" height={380} />}
      </ChartFrame>
    </div>
  );
}
