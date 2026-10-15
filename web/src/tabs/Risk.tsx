// The risk half of the Performance chapter (portfolio_app.py 1317-1416), one More list under the returns':
// the portfolios in a fall (one portfolio's deepest falls, and every portfolio over the named market falls
// the window holds), the drawdown chart, which opens on the asset that fell furthest (the old tab's
// headline, now the row's finding), then the rolling volatility, a bad day (value at risk and expected
// shortfall per asset), the risk-adjusted metrics and the CAPM estimates. The arithmetic lives in ./risk/model.ts and ./risk/falls.ts; this file lays it out.
//
// Each card sits inside its own Boundary, so a card that fails leaves one line naming it and the rest of
// the chapter keeps rendering. The app has one script run for the whole page, and a throw anywhere in it
// ends everything after. A card's paragraphs and its info marks' texts (HowTips) are under its "How it is
// calculated" fold; a table under a chart is under "Show the numbers".
import { memo, useMemo, useState } from "react";
import Boundary from "../components/Boundary.tsx";
import Card from "../components/Card.tsx";
import ChartFrame from "../components/ChartFrame.tsx";
import FormulaLine from "../components/FormulaLine.tsx";
import HowTips from "../components/HowTips.tsx";
import MoreList, { type MoreRow } from "../components/MoreList.tsx";
import SegControl from "../components/SegControl.tsx";
import Table from "../components/Table.tsx";
import { format } from "../format.ts";
import { tableSpan } from "./caption.ts";
import type { Analysis, CustomWeights, TabProps } from "../types.ts";
import { riskFormula } from "./formula.ts";
import { customWeights } from "./optimization/model.ts";
import type { ScoreColId } from "./optimization/scorecard.ts";
import {
  capmFinding, drawdownsFinding, fallsFinding, metricsFinding, RISK_HEADING, RISK_LIST, RISK_ROWS, said, tailFinding, volatilityFinding,
} from "./performance.ts";
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
  capmMethod,
  capmRows,
  capmTableRows,
  DEFAULT_WINDOW,
  DRAWDOWN_COLUMNS,
  drawdownChart,
  drawdownRows,
  drawdownTitle,
  RISK_COLUMNS,
  riskRows,
  TAIL_COLUMNS,
  tailRows,
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
  allowShort: boolean;
}

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
  const how = (
    <>
      <p className="risk-note">
        Each portfolio holds its weights fixed and is rebalanced to them daily; the {a.benchLabel} is held as it is. A fall runs
        from a close that set a new high to the lowest close before the series got back to that high. What a portfolio did in a
        past fall is what these weights earned on these prices: history, not a forecast.
      </p>
      {episodes.length ? (
        <p className="risk-note">
          Deepest first, at most five that do not overlap. Back at the high reads {"“"}not yet{"”"} for a fall the series
          had not climbed back from by {a.asOf}. Days are trading days, counted in closes; the downloads add calendar days.
        </p>
      ) : null}
      {falls.length ? (
        <p className="risk-note" data-note="hindsight">
          Each figure compounds the series from the S&amp;P 500{"’"}s high close to its low close; a fall the window holds only
          part of is not listed. GMV{"’"}s and Tangency{"’"}s weights were chosen on this window, which includes every
          fall listed, so their figures are in-sample, hindsight: the optimiser had already seen these days.
        </p>
      ) : null}
    </>
  );
  return (
    <Card label={RISK_ROWS.falls} how={how}>
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
      {falls.length ? (
        <Table title={NAMED_TITLE} columns={namedColumns(series)} rows={named} filename={NAMED_FILE} span={span} subs={seriesSubs(series)} />
      ) : (
        <p className="risk-note" data-note="no-named-falls">
          {noNamedFalls(a)}
        </p>
      )}
    </Card>
  );
});

// The drawdown of one asset (1333-1348). The app opens on the first ticker (selectbox, 1334); this
// opens on the asset that fell furthest, the one the row's finding names.
const Drawdowns = memo(function Drawdowns({ a, allowShort }: SectionProps) {
  const [pick, setPick] = useState<string | null>(null);
  const all = tickerDrawdowns(a);
  const shown = (pick !== null ? all.find((d) => d.name === pick) : undefined) ?? worstDrawdown(all) ?? all[0];
  const state = useMemo(() => drawdownChart(shown), [shown]);
  const rows = useMemo(() => drawdownRows(a), [a]);
  const options = useMemo(() => a.tickers.map((t) => ({ value: t, label: t })), [a]);
  const title = drawdownTitle(shown);
  const numbers = (
    <Table
      title="Worst drawdown by asset"
      columns={DRAWDOWN_COLUMNS}
      rows={rows}
      filename="drawdowns"
      span={tableSpan(a.prices.dates[0], a.asOf, "daily", "closes")}
    />
  );
  const how = (
    <>
      <p className="risk-sub">
        How far {shown.name} stood below its highest close so far, each day from {a.prices.dates[0]} to {a.asOf}. Measured from
        the first close, so a loss on the first day counts.
      </p>
      <p className="risk-note">
        High is the close the fall started from, Low the bottom of it. A dash under Back at the high means the asset had not
        closed at that level again by {a.asOf}. Related event names the market fall that asset{"’"}s worst fall overlaps, by
        the S&amp;P 500{"’"}s high and low closes; it is empty when it overlaps none.
      </p>
      <HowTips keys={["max_dd"]} allowShort={allowShort} />
    </>
  );
  return (
    <Card title={title} numbers={numbers} how={how}>
      <div className="risk-controls">
        <span className="risk-control-label">Asset</span>
        <SegControl options={options} value={shown.name} onChange={setPick} ariaLabel="Asset for the drawdown chart" />
      </div>
      <ChartFrame title={title} state={state} height={DRAWDOWN_HEIGHT} bare>
        {(v) => <DrawdownPlot data={v} name={shown.name} />}
      </ChartFrame>
    </Card>
  );
});

// Rolling annualised volatility (1321-1328), over the app's four windows.
const Volatility = memo(function Volatility({ a, allowShort }: SectionProps) {
  const [w, setW] = useState<VolWindow>(DEFAULT_WINDOW);
  const state = useMemo(() => volChart(a, w), [a, w]);
  const options = VOL_WINDOWS.map((x) => ({ value: String(x), label: `${x} days` }));
  const title = state.status === "ready" ? volTitle(state.value) : `${w}-Day Rolling Annualized Volatility`;
  const how = (
    <>
      <p className="risk-sub">
        Standard deviation of each asset's daily returns over the last {w} trading days, times the square root of 252. A line
        starts once it has {w} days. The benchmark is not drawn.
      </p>
      <HowTips keys={["volatility"]} allowShort={allowShort} />
    </>
  );
  return (
    <Card title={title} how={how}>
      <div className="risk-controls">
        <span className="risk-control-label">Window</span>
        <SegControl
          options={options}
          value={String(w)}
          onChange={(v) => setW((VOL_WINDOWS.find((x) => String(x) === v) ?? DEFAULT_WINDOW) as VolWindow)}
          ariaLabel="Rolling window, in trading days"
        />
      </div>
      <ChartFrame title={title} state={state} height={VOL_HEIGHT} bare>
        {(v) => <VolPlot data={v} />}
      </ChartFrame>
    </Card>
  );
});

// One-day value at risk and expected shortfall at 95% for each asset and the benchmark, by the scorecard's own
// definition (historicalTail), so an asset's figure here and a mix's there are the same measurement.
const Tail = memo(function Tail({ a }: SectionProps) {
  const rows = useMemo(() => tailRows(a), [a]);
  const how = (
    <>
      <p className="risk-note">
        Historical, one day, 95%: value at risk is the loss on the day 1 in 20 from the bottom of this window{"’"}s daily
        returns; expected shortfall is the average loss on the days at or past it. Both are positive losses, measured the way the
        Build scorecard measures the portfolios.
      </p>
    </>
  );
  return (
    <Card label={RISK_ROWS.tail} how={how}>
      <Table title="Value at risk and expected shortfall" columns={TAIL_COLUMNS} rows={rows} filename="value_at_risk" span={tableSpan(a.dates[0], a.asOf)} headed />
    </Card>
  );
});

// Sharpe and Sortino for each asset and the benchmark (1353-1367).
const Metrics = memo(function Metrics({ a, allowShort }: SectionProps) {
  const rows = useMemo(() => riskRows(a), [a]);
  const how = (
    <>
      <p className="risk-note">
        Annual figures at the {format(a.rf, "pct2")} risk-free rate this analysis used. Sortino divides by the shortfall below the
        daily risk-free rate, averaged over every day.
      </p>
      <HowTips keys={["sharpe", "sortino"]} allowShort={allowShort} />
    </>
  );
  return (
    <Card label={RISK_ROWS.metrics} how={how}>
      <Table title="Risk-adjusted metrics" columns={RISK_COLUMNS} rows={rows} filename="risk_metrics" span={tableSpan(a.dates[0], a.asOf)} headed />
    </Card>
  );
});

// CAPM beta and alpha (1372-1416): the betas as bars, the table under "Show the numbers".
const Capm = memo(function Capm({ a, allowShort }: SectionProps) {
  const list = useMemo(() => capmRows(a), [a]);
  const state = useMemo(() => betaChart(list), [list]);
  const rows = useMemo(() => capmTableRows(list), [list]);
  const title = state.status === "ready" ? betaTitle(state.value, a.benchLabel) : "CAPM Beta by Stock";
  const how = (
    <>
      <p className="risk-note">{capmMethod(list, a.benchLabel)}</p>
      <p className="risk-sub">Claret bars sit above the dashed market line at 1: those assets moved more than the benchmark. Navy bars moved less.</p>
      <HowTips keys={["beta", "alpha"]} allowShort={allowShort} />
    </>
  );
  return (
    <Card
      title={title}
      numbers={<Table title="CAPM beta and alpha" columns={CAPM_COLUMNS} rows={rows} filename="capm_beta_alpha" span={tableSpan(a.dates[0], a.asOf)} />}
      how={how}
    >
      <ChartFrame title={title} state={state} height={BETA_HEIGHT} bare>
        {(v) => <BetaPlot data={v} />}
      </ChartFrame>
    </Card>
  );
});

export default function Risk({ analysis: a, weights }: TabProps) {
  // The shorting the analysis was built with (the bar's switch can be a render ahead of it).
  const p = { a, allowShort: a.allowShort };
  const rows: MoreRow[] = [
    {
      key: "falls",
      title: RISK_ROWS.falls,
      finding: said(RISK_ROWS.falls, () => fallsFinding(a)),
      children: (
        <Boundary name="The portfolios in a fall" resetKey={a}>
          <Falls a={a} weights={weights} />
        </Boundary>
      ),
    },
    {
      key: "drawdowns",
      title: RISK_ROWS.drawdowns,
      finding: said(RISK_ROWS.drawdowns, () => drawdownsFinding(a)),
      // The formula behind the finding's figure, under the row, in its own fold.
      note: (
        <Boundary name="The drawdowns formula" resetKey={a}>
          <FormulaLine build={() => riskFormula(worstDrawdown(tickerDrawdowns(a)))} />
        </Boundary>
      ),
      children: (
        <Boundary name="Drawdowns" resetKey={a}>
          <Drawdowns {...p} />
        </Boundary>
      ),
    },
    {
      key: "volatility",
      title: RISK_ROWS.volatility,
      finding: said(RISK_ROWS.volatility, () => volatilityFinding(a)),
      children: (
        <Boundary name="Rolling volatility" resetKey={a}>
          <Volatility {...p} />
        </Boundary>
      ),
    },
    {
      key: "tail",
      title: RISK_ROWS.tail,
      finding: said(RISK_ROWS.tail, () => tailFinding(a)),
      children: (
        <Boundary name="Value at risk" resetKey={a}>
          <Tail {...p} />
        </Boundary>
      ),
    },
    {
      key: "metrics",
      title: RISK_ROWS.metrics,
      finding: said(RISK_ROWS.metrics, () => metricsFinding(a)),
      children: (
        <Boundary name="Risk-adjusted metrics" resetKey={a}>
          <Metrics {...p} />
        </Boundary>
      ),
    },
    {
      key: "capm",
      title: RISK_ROWS.capm,
      finding: said(RISK_ROWS.capm, () => capmFinding(a)),
      children: (
        <Boundary name="CAPM beta and alpha" resetKey={a}>
          <Capm {...p} />
        </Boundary>
      ),
    },
  ];
  return (
    <div className="risk" data-tab="risk">
      <MoreList id={RISK_LIST} rows={rows} heading={RISK_HEADING} />
    </div>
  );
}
