// The Portfolio Optimization tab (portfolio_app.py 1467-1703), in the approved order: a headline that
// states what the maximum-Sharpe solve found, the efficient frontier that shows it, the three
// portfolios' figures, their weights and risk contributions, the growth of the starting amount, and
// the summary comparison. The arithmetic lives in ./optimization/model.ts; this file lays it out.
//
// Each section sits inside its own Boundary, so a section that fails leaves one line naming it and the
// rest of the tab keeps rendering. In the app a failed solve calls st.stop() (1481-1483, 1492-1494),
// which ends the script run: this tab, and tabs 5 and 6 after it, stop there.
import { useMemo } from "react";
import Frontier, { frontierData } from "../charts/Frontier.tsx";
import Wealth, { wealthData } from "../charts/Wealth.tsx";
import { usePhone } from "../chrome/usePhone.ts";
import Boundary from "../components/Boundary.tsx";
import ChartFrame from "../components/ChartFrame.tsx";
import Plate from "../components/Plate.tsx";
import Slug from "../components/Slug.tsx";
import Table from "../components/Table.tsx";
import { format, MINUS } from "../format.ts";
import type { Vec } from "../lib/num.ts";
import type { Custom } from "../lib/portfolio.ts";
import type { Analysis, Level, LoadState, TabProps } from "../types.ts";
import Bars from "./optimization/Bars.tsx";
import {
  customWeights,
  customNote,
  FAILED,
  frontierTitle,
  headline,
  METRICS,
  prcBars,
  prcTable,
  prcTitle,
  summaryTable,
  tiles,
  weightBars,
  weightsTitle,
  weightTable,
  wealthTitle,
  type TableData,
} from "./optimization/model.ts";
import "./optimization/Optimization.css";

interface SectionProps {
  a: Analysis;
  level: Level;
}

// A table, or its own named error line in the table's place.
function TableState({ state, title, filename }: { state: LoadState<TableData>; title: string; filename: string }) {
  if (state.status === "ready") return <Table title={title} columns={state.value.columns} rows={state.value.rows} filename={filename} />;
  const says =
    state.status === "error"
      ? `${title}: not shown. ${state.name} failed. ${state.message}`
      : state.status === "empty"
        ? `${title}: ${state.reason}`
        : `${title}: loading.`;
  return (
    <p className={`opt-note${state.status === "error" ? " opt-note--error" : ""}`} role={state.status === "error" ? "alert" : "status"}>
      {says}
    </p>
  );
}

// The failure sentences a section owes the reader, one per failed solve.
function Failures({ a }: { a: Analysis }) {
  const lines = [a.gmv ? null : FAILED.gmv, a.tangency ? null : FAILED.tangency].filter((s): s is string => s !== null);
  if (!lines.length) return null;
  return (
    <>
      {lines.map((s) => (
        <p key={s} className="opt-note opt-note--failed" role="status">
          {s}
        </p>
      ))}
    </>
  );
}

const shortNote = `Shorting is on: each weight is bounded to [${MINUS}100%, 100%], and the weights sum to 100%.`;

function Headline({ a }: { a: Analysis }) {
  return <h2 className="tab-finding opt-headline">{headline(a)}</h2>;
}

// The efficient frontier (1592-1656), the tab's hero chart.
function FrontierSection({ a, custom }: { a: Analysis; custom: Vec | null }) {
  const state = useMemo(() => ({ status: "ready" as const, value: frontierData(a, custom) }), [a, custom]);
  return (
    <section className="opt-section" aria-labelledby="opt-frontier">
      <Slug id="opt-frontier">Efficient Frontier</Slug>
      <Frontier title={frontierTitle(a)} state={state} allowShort={a.allowShort} rf={a.rf} />
      <p className="opt-note">
        The frontier is the set of portfolios with the highest return for each level of volatility, over the prices on this page.
        {a.tangency ? " Any point on the dashed line can be reached by mixing the tangency portfolio with the risk-free asset." : ""}
      </p>
    </section>
  );
}

// The three portfolios' figures (1504-1530): a row of five plates each, so a figure lines up with the
// same figure of the other two.
function Tiles({ a, level }: SectionProps) {
  const list = useMemo(() => tiles(a), [a]);
  return (
    <section className="opt-section" aria-labelledby="opt-tiles">
      <Slug id="opt-tiles">Three portfolios</Slug>
      {list.map((t) => (
        <div key={t.id} className="opt-tile" data-port={t.id}>
          <h3 className="opt-tile-title">{t.title}</h3>
          {t.failed ? (
            <p className="opt-note opt-note--failed" role="status">
              {t.failed}
            </p>
          ) : null}
          <div className="opt-plates">
            {METRICS.map((m) => (
              <Plate key={m.key} label={m.label} value={t.row ? t.row[m.key] : null} format={m.format} tip={m.tip} level={level} allowShort={a.allowShort} />
            ))}
          </div>
        </div>
      ))}
      <p className="opt-note">
        Annual figures at the {format(a.rf, "pct2")} risk-free rate this analysis used. Each portfolio holds its weights fixed,
        rebalanced daily. Max DD is measured from the amount invested.
      </p>
    </section>
  );
}

// The weights (1534-1551): the bars, then the same numbers as a table with both downloads.
function Weights({ a, height }: { a: Analysis; height: number }) {
  const bars = useMemo(() => weightBars(a), [a]);
  const table = useMemo(() => weightTable(a), [a]);
  return (
    <section className="opt-section" aria-labelledby="opt-weights">
      <Slug id="opt-weights">Portfolio Weights</Slug>
      <ChartFrame
        title={weightsTitle(a)}
        subtitle="Each asset's weight in the minimum-variance (GMV), maximum-Sharpe (Tangency) and equal-weight portfolios."
        state={bars}
        height={height}
      >
        {(v) => <Bars data={v} height={height} />}
      </ChartFrame>
      <Failures a={a} />
      <TableState state={table} title="Portfolio weights" filename="portfolio_weights" />
      {a.allowShort ? <p className="opt-note">{shortNote}</p> : null}
    </section>
  );
}

// Risk contribution (1555-1572): each asset's share of the portfolio's variance, beside its weight.
function RiskContribution({ a, height }: { a: Analysis; height: number }) {
  const bars = useMemo(() => prcBars(a), [a]);
  const table = useMemo(() => prcTable(a), [a]);
  return (
    <section className="opt-section" aria-labelledby="opt-prc">
      <Slug id="opt-prc">Risk Contribution (PRC)</Slug>
      <p className="opt-note">
        An asset's percentage risk contribution (PRC) is its share of the portfolio's variance: its weight times its covariance
        with the portfolio, over the portfolio's variance. The shares sum to 100%. An asset whose PRC is well above its weight is
        a disproportionate source of volatility; the table sets the two side by side.
      </p>
      <ChartFrame title={prcTitle(a)} subtitle="Each asset's share of the GMV and Tangency portfolios' variance." state={bars} height={height}>
        {(v) => <Bars data={v} height={height} />}
      </ChartFrame>
      <TableState state={table} title="Weight and risk contribution" filename="risk_contribution" />
    </section>
  );
}

// The growth of the starting amount (1660-1674): the shared Wealth chart.
function Growth({ a, custom, amount }: { a: Analysis; custom: Vec | null; amount: number }) {
  const state = useMemo(() => ({ status: "ready" as const, value: wealthData(a, custom) }), [a, custom]);
  return (
    <section className="opt-section" aria-labelledby="opt-wealth">
      <Slug id="opt-wealth">Portfolio Comparison: Cumulative Wealth</Slug>
      <Wealth title={wealthTitle(a, custom, amount)} state={state} amount={amount} />
    </section>
  );
}

// The summary comparison (1678-1703).
function Summary({ a, c }: { a: Analysis; c: Custom }) {
  const table = useMemo(() => summaryTable(a, c), [a, c]);
  const note = customNote(a, c);
  return (
    <section className="opt-section" aria-labelledby="opt-summary">
      <Slug id="opt-summary">Summary Comparison</Slug>
      <TableState state={table} title="Summary comparison" filename="portfolio_comparison" />
      <Failures a={a} />
      {note ? <p className="opt-note">{note}</p> : null}
      <p className="opt-note">
        Annual figures at the {format(a.rf, "pct2")} risk-free rate. The {a.benchLabel} row is the benchmark's own daily returns.
      </p>
    </section>
  );
}

export default function Optimization({ analysis: a, settings, level, weights }: TabProps) {
  const phone = usePhone();
  const barHeight = phone ? 320 : 400;
  // c changes with the analysis or the custom weights, so the cards that draw the custom book re-arm on either.
  const c = useMemo(() => customWeights(a, weights), [a, weights]);
  const custom = c.ok ? c.w : null;
  return (
    <div className="opt" data-tab="optimization">
      <Boundary name="The headline" resetKey={a}>
        <Headline a={a} />
      </Boundary>
      <Boundary name="Efficient frontier" resetKey={c}>
        <FrontierSection a={a} custom={custom} />
      </Boundary>
      <Boundary name="The three portfolios" resetKey={a}>
        <Tiles a={a} level={level} />
      </Boundary>
      <Boundary name="Portfolio weights" resetKey={a}>
        <Weights a={a} height={barHeight} />
      </Boundary>
      <Boundary name="Risk contribution" resetKey={a}>
        <RiskContribution a={a} height={barHeight} />
      </Boundary>
      <Boundary name="Cumulative wealth" resetKey={c}>
        <Growth a={a} custom={custom} amount={settings.amount} />
      </Boundary>
      <Boundary name="Summary comparison" resetKey={c}>
        <Summary a={a} c={c} />
      </Boundary>
    </div>
  );
}
