// The returns half of the Performance chapter (portfolio_app.py 1225-1312): the chapter's finding in one
// sentence, the growth of the starting amount as the chapter's lead card (each asset, or the mixes and the
// reader's own), then a More list: the portfolios' calendar years, one portfolio's months as a grid, the
// Summary Statistics table, and one asset's return distribution as a histogram with its normal fit or a
// Q-Q plot. A row draws nothing until it is first opened; its finding beside the title is the card's
// figure in one line (./performance.ts).
//
// Every figure comes from src/tabs/returns/model.ts, which test/t-tab-returns.mjs holds to the app's
// own numbers. Each card computes its own figures inside its own Boundary, so a card that fails is
// replaced by one line naming it and the rest of the chapter still renders. The starting amount is read
// live from the settings, as the app reads it on every rerun (1258).
//
// Paragraphs live in each card's "How it is calculated" fold, with the info marks' three texts (HowTips),
// and tables under a chart in its "Show the numbers" fold; a card that is only a table shows the table.
import { memo, useCallback, useMemo, useState } from "react";
import Boundary from "../components/Boundary.tsx";
import Card from "../components/Card.tsx";
import ChartFrame from "../components/ChartFrame.tsx";
import FormulaLine from "../components/FormulaLine.tsx";
import HowTips from "../components/HowTips.tsx";
import MoreList, { type MoreRow } from "../components/MoreList.tsx";
import SegControl from "../components/SegControl.tsx";
import Table from "../components/Table.tsx";
import AmountField from "../components/AmountField.tsx";
import { fittedLines, wealthCaption, wealthPlot, WealthLines, type WealthData } from "../charts/Wealth.tsx";
import { monthYear } from "../chrome/when.ts";
import { overviewWealth } from "../overview/OverviewWealth.tsx";
import { format } from "../format.ts";
import type { Analysis, Column, CustomWeights, LoadState, TabProps } from "../types.ts";
import { tableSpan } from "./caption.ts";
import { returnsFormula } from "./formula.ts";
import { customWeights } from "./optimization/model.ts";
import type { ScoreColId } from "./optimization/scorecard.ts";
import {
  distFinding, monthsFinding, PERF_HEADING, PERF_LIST, PERF_ROWS, said, summaryFinding, yearsFinding,
} from "./performance.ts";
import { HistChart, QQChart } from "./returns/DistCharts.tsx";
import GrowthChart from "./returns/GrowthChart.tsx";
import MonthHeatmap from "./returns/MonthHeatmap.tsx";
import {
  monthColumns, monthRows, monthTitle, monthView, portfolioSeries, seriesOptions, seriesSubs, yearColumns, yearRows,
  YEARS_FILE, YEARS_TITLE, type Series,
} from "./returns/years.ts";
import {
  amountOk, dek, growth, GROWTH_COLUMNS, GROWTH_FILE, growthRows, growthState, growthTitle, headline, histogram, histTitle,
  linesOf, qqState, qqTitle, SUMMARY_COLUMNS, SUMMARY_FILE, summaryRows, BINS,
} from "./returns/model.ts";
import { useWidth } from "./returns/useWidth.ts";
import "./returns/Returns.css";

const GROWTH_H = 420;
const DIST_H = 360;

const Lead = memo(function Lead({ a, amount }: { a: Analysis; amount: number }) {
  const g = useMemo(() => growth(a, amount), [a, amount]);
  return (
    <header className="ret-lead">
      <h2 className="tab-finding ret-finding">{headline(g)}</h2>
      <FormulaLine build={() => returnsFormula(g, amountOk(g.amount))} />
      <p className="ret-dek">{dek(a)}</p>
    </header>
  );
});

// ---- the lead: what the starting amount became ------------------------------------------------------

type GrowthView = "assets" | "mixes";
export const GROWTH_VIEWS = [
  { value: "assets", label: "Each asset" },
  { value: "mixes", label: "The mixes" },
] as const;

const MIX_COLUMNS: Column[] = [
  { key: "asset", label: "Mix", format: "text", first: true },
  { key: "end", label: "Ending value", format: "usd0" },
  { key: "total", label: "Total return", format: "pct2" },
];

// The mixes' lines and the reader's own: Best-tradeoff, Equal split, Lowest-risk, Your mix (when it is not
// the equal split) and the benchmark, under the names the Overview gives them.
function mixData(a: Analysis, weights: CustomWeights): LoadState<WealthData> {
  const c = customWeights(a, weights);
  return { status: "ready", value: overviewWealth(a, c.ok ? c.w : null) };
}

// C1 and the table of where each line ended, or the mixes' lines. The app's multiselect (1259) is a row of
// toggles here, each carrying its line's colour, which on a phone is also the chart's key. The starting
// amount is edited in the chart's own head, where it acts.
const GrowthCard = memo(function GrowthCard({
  a, amount, onAmount, weights,
}: { a: Analysis; amount: number; onAmount: (n: number) => void; weights: CustomWeights }) {
  const g = useMemo(() => growth(a, amount), [a, amount]);
  const [view, setView] = useState<GrowthView>("assets");
  const [hidden, setHidden] = useState<string[]>([]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const mixes = useMemo(() => mixData(a, weights), [a, weights]);
  const mixPlot = useMemo(() => wealthPlot(mixes, amount), [mixes, amount]);
  const shown = g.lines.filter((l) => !hidden.includes(l.name)).map((l) => l.key);
  const state = growthState(g, shown);
  const d = g.dates;
  const title = growthTitle(amount);
  const amt = amountOk(amount) ? format(amount, "usd0") : "the starting amount";
  const span = `${monthYear(d[0])} to ${monthYear(d[d.length - 1])}`;
  const toggle = (name: string) => setHidden((h) => (h.includes(name) ? h.filter((x) => x !== name) : [...h, name]));
  const field = <AmountField amount={amount} onAmount={onAmount} />;
  const mixSeries = mixes.status === "ready" ? mixes.value.series : [];
  const mixRows = mixPlot.status === "ready"
    ? mixPlot.value.lines.map((l) => ({ asset: l.label, end: l.end, total: l.end / amount - 1 }))
    : [];
  const numbers =
    view === "assets" ? (
      <Table title={title} columns={GROWTH_COLUMNS} rows={growthRows(g)} filename={GROWTH_FILE} span={tableSpan(d[0], d[d.length - 1], "daily", "closes")} />
    ) : (
      <Table title="What each mix became" columns={MIX_COLUMNS} rows={mixRows} filename="mix_growth" span={tableSpan(d[0], d[d.length - 1], "daily", "closes")} />
    );
  const how =
    view === "assets" ? (
        <p>
          Invested on {format(d[0], "date")} in each line separately and held to {format(d[d.length - 1], "date")}. The dotted
          line is the {amt} invested; the {a.benchLabel} is the dashed one. The starting amount is remembered in this browser and never put in a link.
        </p>
      ) : (
        <p>
          {wealthCaption(amount, d[0], d[d.length - 1], fittedLines(mixSeries))} Your mix is the one set in Build a portfolio;
          while it is still the equal split its line is left off, since it would lie on the equal split{"’"}s.
        </p>
      );
  return (
    <Card
      id="perf-growth"
      title={`What ${amt} became`}
      sub={view === "assets" ? `${span}, held in each asset alone and in the ${a.benchLabel}.` : `${span}. Two of the mixes were chosen with hindsight.`}
      numbers={numbers}
      how={how}
    >
      <div className="ret-controls ret-growth-view">
        <SegControl options={GROWTH_VIEWS} value={view} onChange={setView} ariaLabel="What the growth chart shows" />
      </div>
      {view === "assets" ? (
        <>
          <div className="ret-toggles" role="group" aria-label="Lines on the growth chart">
            {g.lines.map((l) => {
              const on = shown.includes(l.key);
              return (
                <button key={l.key} type="button" className="ret-toggle" aria-pressed={on} onClick={() => toggle(l.name)}>
                  <span className="ret-swatch" style={{ background: on ? l.color : "transparent", borderColor: l.color }} aria-hidden="true" />
                  {l.name}
                </button>
              );
            })}
          </div>
          <div ref={ref} className="ret-chart">
            <ChartFrame title={`Cumulative ${title.toLowerCase()}`} state={state} height={GROWTH_H} control={field} bare>
              {(lines) => <GrowthChart growth={g} lines={lines} width={width} height={GROWTH_H} />}
            </ChartFrame>
          </div>
        </>
      ) : (
        <div className="ret-chart">
          <ChartFrame title={`What each mix became from ${amt}`} state={mixPlot} height={GROWTH_H} control={field} bare>
            {(plot) => <WealthLines plot={plot} height={GROWTH_H} />}
          </ChartFrame>
        </div>
      )}
    </Card>
  );
});

// ---- the More rows ------------------------------------------------------------------------------------

// The portfolios' calendar years. Every figure is the engine's (src/lib/monthly.ts) on the portfolio's daily
// returns; see ./returns/years.ts.
const YearsCard = memo(function YearsCard({ a, series }: { a: Analysis; series: Series[] }) {
  const years = useMemo(() => yearRows(a, series), [a, series]);
  const how = (
    <p className="ret-note">
      Each year compounds the daily returns from the year's first close in the window (or the last close of the year
      before) to its last. Every portfolio holds its weights fixed and is rebalanced to them daily; GMV's and Tangency's
      weights were chosen on this window, so their years are in-sample. The first and last years are the window's, so
      they say which dates they cover.
    </p>
  );
  return (
    <Card label={YEARS_TITLE} how={how}>
      <Table
        title={YEARS_TITLE}
        columns={yearColumns(series)}
        rows={years}
        filename={YEARS_FILE}
        span={tableSpan(a.prices.dates[0], a.asOf, "daily", "closes")}
        subs={seriesSubs(series)}
        headed
      />
    </Card>
  );
});

// One portfolio's months as a grid, with the grid's own table.
const MonthsCard = memo(function MonthsCard({ a, series }: { a: Analysis; series: Series[] }) {
  const [pick, setPick] = useState<ScoreColId>("ew");
  const shown = series.find((s) => s.id === pick) ?? series[0];
  // Keyed on the one series drawn (whose returns portfolioSeries keeps per analysis), so an edited custom
  // mix leaves another portfolio's grid undrawn.
  const { r: shownR, label: shownLabel, id: shownId } = shown;
  const months = useMemo(() => monthView(a, { id: shownId, label: shownLabel, sub: null, r: shownR }), [a, shownId, shownLabel, shownR]);
  const d = a.dates;
  const title = months.status === "ready" ? monthTitle(months.value) : `${shown.label}'s calendar months`;
  const numbers =
    months.status === "ready" ? (
      <Table
        title={`Monthly returns, ${shown.label}`}
        columns={monthColumns()}
        rows={monthRows(months.value.grid)}
        filename={`monthly_returns_${shown.id}`}
        span={tableSpan(a.prices.dates[0], a.asOf, "monthly")}
      />
    ) : undefined;
  const how = (
    <>
      <p className="ret-months-sub">
        Each month's trading days compounded, {format(a.prices.dates[0], "date")} to {format(d[d.length - 1], "date")}. The
        shading runs from the loss colour through the paper to the gain colour, the same distance each way from zero; the
        title's range counts whole months only.
      </p>
      <p className="ret-note ret-months-note">
        A dashed outline marks the window's first and last months, which it may hold only part of: their figures run from the
        first close in the window, or to the last.
      </p>
    </>
  );
  return (
    <Card title={title} numbers={numbers} how={how}>
      <div className="ret-controls ret-months-pick">
        <span className="ret-pick-label">Months of</span>
        <SegControl options={seriesOptions(series)} value={shown.id} onChange={setPick} ariaLabel="Portfolio for the months grid" />
        {shown.sub ? <span className="ret-fitted">{shown.sub}</span> : null}
      </div>
      <div className="ret-chart">
        <ChartFrame title={title} state={months} height={240} bare>
          {(v) => <MonthHeatmap view={v} />}
        </ChartFrame>
      </div>
    </Card>
  );
});

// T1 (1229-1253). The two annualised columns' info-mark texts are under its "How it is calculated".
const SummaryCard = memo(function SummaryCard({ a, allowShort }: { a: Analysis; allowShort: boolean }) {
  const rows = useMemo(() => summaryRows(a), [a]);
  const how = (
    <>
      <p className="ret-key">
        Ann. Return is the mean daily return times 252; Ann. Volatility is the daily standard deviation times the square root
        of 252. Excess kurtosis is 0 for a normal distribution; above 0, extreme days are more common than a normal curve
        allows.
      </p>
      <HowTips keys={["return", "volatility"]} allowShort={allowShort} />
    </>
  );
  return (
    <Card label="Summary Statistics" how={how}>
      <Table title="Summary Statistics" columns={SUMMARY_COLUMNS} rows={rows} filename={SUMMARY_FILE} span={tableSpan(a.dates[0], a.asOf)} headed />
    </Card>
  );
});

type View = "hist" | "qq";
const VIEWS = [
  { value: "hist", label: "Histogram + Normal Fit" },
  { value: "qq", label: "Q-Q Plot" },
] as const;

// C2 / C3 (1271-1312): one ticker at a time; the app does not offer the benchmark here (1275).
const DistributionCard = memo(function DistributionCard({ a }: { a: Analysis }) {
  const [pick, setPick] = useState(a.tickers[0]);
  const [view, setView] = useState<View>("hist");
  const [ref, width] = useWidth<HTMLDivElement>();
  const lines = useMemo(() => linesOf(a), [a]);
  const i = Math.max(0, a.tickers.indexOf(pick));
  const line = lines[i];
  const hist = useMemo(() => histogram(line.returns), [line]);
  const qq = useMemo(() => qqState(line.returns), [line]);
  const d = a.dates;
  const span = `${format(d[0], "date")} to ${format(d[d.length - 1], "date")}`;
  const title = view === "hist" ? histTitle(line.name, line.returns) : qqTitle(line.name, qq);
  const how =
    view === "hist" ? (
      <p>
        {format(line.returns.length, "int")} daily returns, {span}, in {BINS} equal bins. The curve is a normal distribution with
        the same mean and standard deviation.
      </p>
    ) : (
      <p>
        Each dot is one of {format(line.returns.length, "int")} daily returns, {span}, sorted and set against the quantile a
        normal distribution gives its rank. Dots on the line match a normal distribution.
      </p>
    );
  return (
    <Card title={title} how={how}>
      <div className="ret-controls">
        <label className="ret-pick">
          <span>Asset</span>
          <select value={line.symbol} onChange={(e) => setPick(e.target.value)}>
            {a.tickers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <SegControl options={VIEWS} value={view} onChange={setView} ariaLabel="Distribution view" />
      </div>
      <div ref={ref} className="ret-chart">
        {view === "hist" ? (
          <ChartFrame title={title} state={hist} height={DIST_H} bare>
            {(h) => <HistChart h={h} color={line.color} width={width} height={DIST_H} label={`${line.name} daily return histogram`} />}
          </ChartFrame>
        ) : (
          <ChartFrame title={title} state={qq} height={DIST_H} bare>
            {(q) => <QQChart q={q} color={line.color} width={width} height={DIST_H} label={`${line.name} Q-Q plot`} />}
          </ChartFrame>
        )}
      </div>
    </Card>
  );
});

const More = memo(function More({ a, weights }: { a: Analysis; weights: CustomWeights }) {
  const c = useMemo(() => customWeights(a, weights), [a, weights]);
  const series = useMemo(() => portfolioSeries(a, c), [a, c]);
  const rows: MoreRow[] = [
    {
      key: "years",
      title: PERF_ROWS.years,
      finding: said(PERF_ROWS.years, () => yearsFinding(a, series)),
      children: (
        <Boundary name="Calendar years" resetKey={a}>
          <YearsCard a={a} series={series} />
        </Boundary>
      ),
    },
    {
      key: "months",
      title: PERF_ROWS.months,
      finding: said(PERF_ROWS.months, () => monthsFinding(a, series)),
      children: (
        <Boundary name="Month by month" resetKey={a}>
          <MonthsCard a={a} series={series} />
        </Boundary>
      ),
    },
    {
      key: "summary",
      title: PERF_ROWS.summary,
      finding: said(PERF_ROWS.summary, () => summaryFinding(a)),
      children: (
        <Boundary name="Summary Statistics" resetKey={a}>
          <SummaryCard a={a} allowShort={a.allowShort} />
        </Boundary>
      ),
    },
    {
      key: "dist",
      title: PERF_ROWS.dist,
      finding: said(PERF_ROWS.dist, () => distFinding(a)),
      children: (
        <Boundary name="Return Distribution" resetKey={a}>
          <DistributionCard a={a} />
        </Boundary>
      ),
    },
  ];
  return <MoreList id={PERF_LIST} rows={rows} heading={PERF_HEADING} />;
});

export default function Returns({ analysis, settings, weights, requestSettings }: TabProps) {
  const amount = settings.amount;
  // Held steady so the memo'd cards skip a render their inputs do not call for.
  const onAmount = useCallback((n: number) => requestSettings({ amount: n }), [requestSettings]);
  return (
    <div className="ret">
      <Boundary name="Returns headline" resetKey={analysis}>
        <Lead a={analysis} amount={amount} />
      </Boundary>
      <Boundary name="Cumulative growth" resetKey={analysis}>
        <GrowthCard a={analysis} amount={amount} onAmount={onAmount} weights={weights} />
      </Boundary>
      <Boundary name="More on the returns" resetKey={analysis}>
        <More a={analysis} weights={weights} />
      </Boundary>
    </div>
  );
}
