// The Risk Analysis tab (portfolio_app.py 1317-1416), in the approved order: a headline that states
// the finding (which asset fell furthest, and when), the portfolios in a fall (one portfolio's deepest
// falls, and every portfolio over the named market falls the window holds), the drawdown chart that
// shows the headline's asset, then the rolling volatility, the risk-adjusted metrics and the CAPM
// estimates. The arithmetic lives in ./risk/model.ts and ./risk/falls.ts; this file lays it out.
//
// Each section sits inside its own Boundary, so a section that fails leaves one line naming it and the
// rest of the tab keeps rendering. The app has one script run for the whole page, and a throw anywhere
// in it ends everything after.
import { memo, useMemo, useState } from "react";
import Boundary from "../components/Boundary.tsx";
import ChartFrame from "../components/ChartFrame.tsx";
import Plate from "../components/Plate.tsx";
import SegControl from "../components/SegControl.tsx";
import Slug from "../components/Slug.tsx";
import Table from "../components/Table.tsx";
import Tip from "../components/Tip.tsx";
import { format } from "../format.ts";
import { tableSpan } from "./caption.ts";
import type { Analysis, CustomWeights, Level, TabProps } from "../types.ts";
import { customWeights } from "./optimization/model.ts";
import type { ScoreColId } from "./optimization/scorecard.ts";
import { portfolioSeries, seriesOptions, seriesSubs } from "./returns/years.ts";
import {
  EPISODE_COLUMNS,
  episodeFile,
  episodeRows,
  episodeTitle,
  fallsInWindow,
  NAMED_FILE,
  NAMED_TITLE,
  namedColumns,
  namedRows,
  noEpisodes,
  noNamedFalls,
  seriesEpisodes,
} from "./risk/falls.ts";
import {
  betaChart,
  betaTitle,
  CAPM_COLUMNS,
  capmRows,
  capmTableRows,
  DEFAULT_WINDOW,
  DRAWDOWN_COLUMNS,
  drawdownChart,
  drawdownRows,
  drawdownTitle,
  headline,
  RISK_COLUMNS,
  riskRows,
  tickerDrawdowns,
  VOL_WINDOWS,
  volChart,
  volTitle,
  worstDrawdown,
  type VolWindow,
} from "./risk/model.ts";
import { BETA_HEIGHT, BetaPlot, DRAWDOWN_HEIGHT, DrawdownPlot, VOL_HEIGHT, VolPlot } from "./risk/charts.tsx";
import "./risk/Risk.css";

interface SectionProps {
  a: Analysis;
  level: Level;
  allowShort: boolean;
}

const Headline = memo(function Headline({ a }: { a: Analysis }) {
  return <h2 className="tab-finding risk-headline">{headline(a)}</h2>;
});

// The portfolios in a fall: a pill picks one of the scorecard's columns and the table lists its deepest
// falls; below, every column's return over each named market fall the window holds.
const Falls = memo(function Falls({ a, weights }: { a: Analysis; weights: CustomWeights }) {
  const c = useMemo(() => customWeights(a, weights), [a, weights]);
  const series = useMemo(() => portfolioSeries(a, c), [a, c]);
  const [pick, setPick] = useState<ScoreColId>("ew");
  const shown = series.find((s) => s.id === pick) ?? series[0];
  const episodes = useMemo(() => (shown.r ? episodeRows(seriesEpisodes(a, shown.r)) : []), [a, shown.r]);
  const falls = useMemo(() => fallsInWindow(a), [a]);
  const named = useMemo(() => namedRows(a, falls, series), [a, falls, series]);
  const span = tableSpan(a.prices.dates[0], a.asOf, "daily", "closes");
  return (
    <section className="risk-section" aria-labelledby="risk-falls">
      <Slug id="risk-falls">The portfolios in a fall</Slug>
      <p className="risk-note">
        Each portfolio holds its weights fixed and is rebalanced to them daily; the {a.benchLabel} is held as it is. A fall runs
        from a close that set a new high to the lowest close before the series got back to that high. What a portfolio did in a
        past fall is what these weights earned on these prices: history, not a forecast.
      </p>
      <div className="risk-controls">
        <span className="risk-control-label">Portfolio</span>
        <SegControl options={seriesOptions(series)} value={shown.id} onChange={setPick} ariaLabel="Portfolio for the deepest falls" />
        {shown.sub ? <span className="risk-fitted">{shown.sub}</span> : null}
      </div>
      {episodes.length ? (
        <Table title={episodeTitle(shown)} columns={EPISODE_COLUMNS} rows={episodes} filename={episodeFile(shown)} span={span} />
      ) : (
        <p className="risk-note" data-note="no-falls">
          {noEpisodes(a, shown)}
        </p>
      )}
      {episodes.length ? (
        <p className="risk-note">
          Deepest first, at most five that do not overlap. Back at the high reads {"“"}not yet{"”"} for a fall the series
          had not climbed back from by {a.asOf}. Days are trading days, counted in closes; the downloads add calendar days.
        </p>
      ) : null}
      {falls.length ? (
        <>
          <Table title={NAMED_TITLE} columns={namedColumns(series)} rows={named} filename={NAMED_FILE} span={span} subs={seriesSubs(series)} />
          <p className="risk-note" data-note="hindsight">
            Each figure compounds the series from the S&amp;P 500{"’"}s high close to its low close; a fall the window holds only
            part of is not listed. GMV{"’"}s and Tangency{"’"}s weights were chosen on this window, which includes every
            fall listed, so their figures are hindsight: the optimiser had already seen these days.
          </p>
        </>
      ) : (
        <p className="risk-note" data-note="no-named-falls">
          {noNamedFalls(a)}
        </p>
      )}
    </section>
  );
});

// The drawdown of one asset (1333-1348). The app opens on the first ticker (selectbox, 1334); this
// opens on the asset the headline names, so the chart under the sentence shows what it says.
const Drawdowns = memo(function Drawdowns({ a, level, allowShort }: SectionProps) {
  const [pick, setPick] = useState<string | null>(null);
  const all = tickerDrawdowns(a);
  const shown = (pick !== null ? all.find((d) => d.name === pick) : undefined) ?? worstDrawdown(all) ?? all[0];
  const state = useMemo(() => drawdownChart(shown), [shown]);
  const rows = useMemo(() => drawdownRows(a), [a]);
  const options = useMemo(() => a.tickers.map((t) => ({ value: t, label: t })), [a]);
  return (
    <section className="risk-section" aria-labelledby="risk-drawdown">
      <Slug id="risk-drawdown">Drawdowns</Slug>
      <div className="risk-controls">
        <span className="risk-control-label">Asset</span>
        <SegControl options={options} value={shown.name} onChange={setPick} ariaLabel="Asset for the drawdown chart" />
      </div>
      <div className="risk-plates">
        <Plate label="Maximum Drawdown" value={shown.max} format="pct2" tip="max_dd" level={level} allowShort={allowShort} />
      </div>
      <ChartFrame
        title={drawdownTitle(shown)}
        subtitle={`How far ${shown.name} stood below its highest close so far, each day from ${a.prices.dates[0]} to ${a.asOf}. Measured from the first close, so a loss on the first day counts.`}
        state={state}
        height={DRAWDOWN_HEIGHT}
      >
        {(v) => <DrawdownPlot data={v} name={shown.name} />}
      </ChartFrame>
      <Table
        title="Worst drawdown by asset"
        columns={DRAWDOWN_COLUMNS}
        rows={rows}
        filename="drawdowns"
        span={tableSpan(a.prices.dates[0], a.asOf, "daily", "closes")}
      />
      <p className="risk-note">
        High is the close the fall started from, Low the bottom of it. A dash under Back at the high means the asset had not
        closed at that level again by {a.asOf}. Related event names the market fall that asset{"’"}s worst fall overlaps, by
        the S&amp;P 500{"’"}s high and low closes; it is empty when it overlaps none.
      </p>
    </section>
  );
});

// Rolling annualised volatility (1321-1328), over the app's four windows.
const Volatility = memo(function Volatility({ a, level, allowShort }: SectionProps) {
  const [w, setW] = useState<VolWindow>(DEFAULT_WINDOW);
  const state = useMemo(() => volChart(a, w), [a, w]);
  const options = VOL_WINDOWS.map((x) => ({ value: String(x), label: `${x} days` }));
  return (
    <section className="risk-section" aria-labelledby="risk-volatility">
      <Slug id="risk-volatility">Rolling volatility</Slug>
      <div className="risk-controls">
        <span className="risk-control-label">Window</span>
        <SegControl
          options={options}
          value={String(w)}
          onChange={(v) => setW((VOL_WINDOWS.find((x) => String(x) === v) ?? DEFAULT_WINDOW) as VolWindow)}
          ariaLabel="Rolling window, in trading days"
        />
        <span className="risk-terms">
          Volatility <Tip tip="volatility" level={level} allowShort={allowShort} />
        </span>
      </div>
      <ChartFrame
        title={state.status === "ready" ? volTitle(state.value) : `${w}-Day Rolling Annualized Volatility`}
        subtitle={`Standard deviation of each asset's daily returns over the last ${w} trading days, times the square root of 252. A line starts once it has ${w} days. The benchmark is not drawn.`}
        state={state}
        height={VOL_HEIGHT}
      >
        {(v) => <VolPlot data={v} />}
      </ChartFrame>
    </section>
  );
});

// Sharpe and Sortino for each asset and the benchmark (1353-1367).
const Metrics = memo(function Metrics({ a, level, allowShort }: SectionProps) {
  const rows = useMemo(() => riskRows(a), [a]);
  return (
    <section className="risk-section" aria-labelledby="risk-metrics">
      <Slug id="risk-metrics">Risk-adjusted metrics</Slug>
      <p className="risk-terms">
        Sharpe ratio <Tip tip="sharpe" level={level} allowShort={allowShort} />
        <span aria-hidden="true"> · </span>
        Sortino ratio <Tip tip="sortino" level={level} allowShort={allowShort} />
      </p>
      <Table title="Risk-adjusted metrics" columns={RISK_COLUMNS} rows={rows} filename="risk_metrics" span={tableSpan(a.dates[0], a.asOf)} headed />
      <p className="risk-note">
        Annual figures at the {format(a.rf, "pct2")} risk-free rate this analysis used. Sortino divides by the shortfall below the
        daily risk-free rate, averaged over every day.
      </p>
    </section>
  );
});

// CAPM beta and alpha (1372-1416): the betas as bars, then the table.
const Capm = memo(function Capm({ a, level, allowShort }: SectionProps) {
  const list = useMemo(() => capmRows(a), [a]);
  const state = useMemo(() => betaChart(list), [list]);
  const rows = useMemo(() => capmTableRows(list), [list]);
  return (
    <section className="risk-section" aria-labelledby="risk-capm">
      <Slug id="risk-capm">CAPM beta and alpha</Slug>
      <p className="risk-note">
        Each asset's daily return above the risk-free rate is regressed on the {a.benchLabel}'s. Beta is the slope: how far the
        asset moved, on average, for each 1% the benchmark moved. Alpha is the intercept, times 252. R² is the share of the
        asset's daily variation the benchmark accounts for.
      </p>
      <p className="risk-terms">
        Beta <Tip tip="beta" level={level} allowShort={allowShort} />
        <span aria-hidden="true"> · </span>
        Alpha <Tip tip="alpha" level={level} allowShort={allowShort} />
      </p>
      <ChartFrame
        title={state.status === "ready" ? betaTitle(state.value, a.benchLabel) : "CAPM Beta by Stock"}
        subtitle="Claret bars sit above the dashed market line at 1: those assets moved more than the benchmark. Navy bars moved less."
        state={state}
        height={BETA_HEIGHT}
      >
        {(v) => <BetaPlot data={v} />}
      </ChartFrame>
      <Table title="CAPM beta and alpha" columns={CAPM_COLUMNS} rows={rows} filename="capm_beta_alpha" span={tableSpan(a.dates[0], a.asOf)} />
    </section>
  );
});

export default function Risk({ analysis: a, level, weights }: TabProps) {
  // The shorting the analysis was built with (the rail's switch can be a render ahead of it).
  const p = { a, level, allowShort: a.allowShort };
  return (
    <div className="risk" data-tab="risk">
      <Boundary name="The headline" resetKey={a}>
        <Headline a={a} />
      </Boundary>
      <Boundary name="The portfolios in a fall" resetKey={a}>
        <Falls a={a} weights={weights} />
      </Boundary>
      <Boundary name="Drawdowns" resetKey={a}>
        <Drawdowns {...p} />
      </Boundary>
      <Boundary name="Rolling volatility" resetKey={a}>
        <Volatility {...p} />
      </Boundary>
      <Boundary name="Risk-adjusted metrics" resetKey={a}>
        <Metrics {...p} />
      </Boundary>
      <Boundary name="CAPM beta and alpha" resetKey={a}>
        <Capm {...p} />
      </Boundary>
    </div>
  );
}
