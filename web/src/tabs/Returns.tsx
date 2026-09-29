// The Returns & Statistics tab (portfolio_app.py 1225-1312): the finding in one sentence, the growth
// of the starting amount in every line, where each line ended, the Summary Statistics table, and one
// asset's return distribution as a histogram with its normal fit or a Q-Q plot.
//
// Every figure comes from src/tabs/returns/model.ts, which test/t-tab-returns.mjs holds to the app's
// own numbers. Each card computes its own figures inside its own Boundary, so a card that fails is
// replaced by one line naming it and the rest of the tab still renders. The starting amount is read
// live from the settings, as the app reads it on every rerun (1258).
import { useMemo, useState } from "react";
import Boundary from "../components/Boundary.tsx";
import ChartFrame from "../components/ChartFrame.tsx";
import SegControl from "../components/SegControl.tsx";
import Slug from "../components/Slug.tsx";
import Table from "../components/Table.tsx";
import Tip from "../components/Tip.tsx";
import AmountField from "../charts/AmountField.tsx";
import { format } from "../format.ts";
import type { Analysis, Level, TabProps } from "../types.ts";
import { tableSpan } from "./caption.ts";
import { HistChart, QQChart } from "./returns/DistCharts.tsx";
import GrowthChart from "./returns/GrowthChart.tsx";
import {
  dek, growth, GROWTH_COLUMNS, GROWTH_FILE, growthRows, growthState, growthTitle, headline, histogram, histTitle,
  linesOf, qqState, qqTitle, SUMMARY_COLUMNS, SUMMARY_FILE, summaryRows, BINS,
} from "./returns/model.ts";
import { useWidth } from "./returns/useWidth.ts";
import "./returns/Returns.css";

const GROWTH_H = 420;
const DIST_H = 360;

function Lead({ a, amount }: { a: Analysis; amount: number }) {
  const g = useMemo(() => growth(a, amount), [a, amount]);
  return (
    <header className="ret-lead">
      <p className="ret-kicker">Growth, summary statistics and the shape of daily returns</p>
      <h2 className="tab-finding ret-finding">{headline(g)}</h2>
      <p className="ret-dek">{dek(a)}</p>
    </header>
  );
}

// C1 and the table of where each line ended. The app's multiselect (1259) is a row of toggles here,
// each carrying its line's colour, which on a phone is also the chart's key. The starting amount is
// edited in the chart's own head, where it acts.
function GrowthCard({ a, amount, onAmount }: { a: Analysis; amount: number; onAmount: (n: number) => void }) {
  const g = useMemo(() => growth(a, amount), [a, amount]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const shown = g.lines.filter((l) => !hidden.includes(l.name)).map((l) => l.key);
  const state = growthState(g, shown);
  const d = g.dates;
  const title = growthTitle(amount);
  const toggle = (name: string) => setHidden((h) => (h.includes(name) ? h.filter((x) => x !== name) : [...h, name]));
  return (
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
        <ChartFrame
          title={`Cumulative ${title.toLowerCase()}`}
          subtitle={`Invested on ${format(d[0], "date")} in each line separately and held to ${format(d[d.length - 1], "date")}. The dashed line is the ${format(amount, "usd0")} invested.`}
          state={state}
          height={GROWTH_H}
          control={<AmountField amount={amount} onAmount={onAmount} />}
        >
          {(lines) => <GrowthChart growth={g} lines={lines} width={width} height={GROWTH_H} />}
        </ChartFrame>
      </div>
      <Table
        title={title}
        columns={GROWTH_COLUMNS}
        rows={growthRows(g)}
        filename={GROWTH_FILE}
        span={tableSpan(d[0], d[d.length - 1], "daily", "closes")}
      />
    </>
  );
}

// T1 (1229-1253). The two annualised columns carry the app's tooltips at the chosen level.
function SummaryCard({ a, level, allowShort }: { a: Analysis; level: Level; allowShort: boolean }) {
  const rows = useMemo(() => summaryRows(a), [a]);
  return (
    <>
      <Slug>Summary Statistics</Slug>
      <p className="ret-key">
        <span className="ret-term">
          Ann. Return
          <Tip tip="return" level={level} allowShort={allowShort} />
        </span>{" "}
        is the mean daily return times 252;{" "}
        <span className="ret-term">
          Ann. Volatility
          <Tip tip="volatility" level={level} allowShort={allowShort} />
        </span>{" "}
        is the daily standard deviation times the square root of 252. Excess kurtosis is 0 for a normal
        distribution; above 0, extreme days are more common than a normal curve allows.
      </p>
      <Table title="Summary Statistics" columns={SUMMARY_COLUMNS} rows={rows} filename={SUMMARY_FILE} span={tableSpan(a.dates[0], a.asOf)} />
    </>
  );
}

type View = "hist" | "qq";
const VIEWS = [
  { value: "hist", label: "Histogram + Normal Fit" },
  { value: "qq", label: "Q-Q Plot" },
] as const;

// C2 / C3 (1271-1312): one ticker at a time; the app does not offer the benchmark here (1275).
function DistributionCard({ a }: { a: Analysis }) {
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
  return (
    <>
      <Slug>Return Distribution</Slug>
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
          <ChartFrame
            title={histTitle(line.name, line.returns)}
            subtitle={`${format(line.returns.length, "int")} daily returns, ${span}, in ${BINS} equal bins. The curve is a normal distribution with the same mean and standard deviation.`}
            state={hist}
            height={DIST_H}
          >
            {(h) => <HistChart h={h} color={line.color} width={width} height={DIST_H} label={`${line.name} daily return histogram`} />}
          </ChartFrame>
        ) : (
          <ChartFrame
            title={qqTitle(line.name, qq)}
            subtitle={`Each dot is one of ${format(line.returns.length, "int")} daily returns, ${span}, sorted and set against the quantile a normal distribution gives its rank. Dots on the line match a normal distribution.`}
            state={qq}
            height={DIST_H}
          >
            {(q) => <QQChart q={q} color={line.color} width={width} height={DIST_H} label={`${line.name} Q-Q plot`} />}
          </ChartFrame>
        )}
      </div>
    </>
  );
}

export default function Returns({ analysis, settings, level, requestSettings }: TabProps) {
  const amount = settings.amount;
  return (
    <div className="ret">
      <Boundary name="Returns headline" resetKey={analysis}>
        <Lead a={analysis} amount={amount} />
      </Boundary>
      <Boundary name="Cumulative growth" resetKey={analysis}>
        <GrowthCard a={analysis} amount={amount} onAmount={(n) => requestSettings({ amount: n })} />
      </Boundary>
      <Boundary name="Summary Statistics" resetKey={analysis}>
        <SummaryCard a={analysis} level={level} allowShort={settings.allowShort} />
      </Boundary>
      <Boundary name="Return Distribution" resetKey={analysis}>
        <DistributionCard a={analysis} />
      </Boundary>
    </div>
  );
}
