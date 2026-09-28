// The Correlation tab (portfolio_app.py 1421-1462): a headline that states the most and least
// correlated pair, the pairwise heatmap (1425-1436) with its figures as a table, the rolling
// correlation of two chosen assets (1441-1458), and the daily covariance matrix (1461-1462).
//
// The app offers no download on this tab: the heatmap has no table behind it and the covariance matrix
// sits in an expander as a styled frame. Here both matrices are Tables, each with CSV and Excel, holding
// the raw numbers. The covariance matrix is shown open rather than in an expander; it is the tab's
// only table of inputs to the optimiser, and a closed expander hides a table on a phone.
//
// Each card sits in its own Boundary, so one that fails leaves the others standing. Every figure is
// computed inside the card that shows it (Boundary: a throw in the parent's own render is not caught).
import Boundary from "../components/Boundary.tsx";
import ChartFrame from "../components/ChartFrame.tsx";
import Slug from "../components/Slug.tsx";
import Table from "../components/Table.tsx";
import Tip from "../components/Tip.tsx";
import type { Analysis, Level, TabProps } from "../types.ts";
import Heatmap from "./correlation/Heatmap.tsx";
import Rolling from "./correlation/Rolling.tsx";
import {
  CORR_FORMAT,
  corrView,
  COV_FORMAT,
  headline,
  heatState,
  heatSubtitle,
  heatTitle,
  matrixColumns,
  matrixRows,
} from "./correlation/model.ts";
import "./correlation/correlation.css";

export default function Correlation({ analysis, level, settings }: TabProps) {
  return (
    <section className="corr-tab" aria-labelledby="corr-headline">
      <Boundary name="Correlation headline" resetKey={analysis}>
        <Headline analysis={analysis} />
      </Boundary>
      <Boundary name="Correlation heatmap" resetKey={analysis}>
        <HeatCard analysis={analysis} />
      </Boundary>
      <Slug id="rolling-correlation">Rolling pairwise correlation</Slug>
      <Boundary name="Rolling correlation" resetKey={analysis}>
        <Rolling analysis={analysis} />
      </Boundary>
      <Slug id="daily-covariance">Daily covariance matrix</Slug>
      <Boundary name="Daily covariance matrix" resetKey={analysis}>
        <CovCard analysis={analysis} level={level} allowShort={settings.allowShort} />
      </Boundary>
    </section>
  );
}

function Headline({ analysis }: { analysis: Analysis }) {
  return (
    <header className="corr-head">
      <p className="corr-kicker">Correlation &amp; Covariance Analysis</p>
      <h2 className="tab-finding corr-headline" id="corr-headline">
        {headline(corrView(analysis))}
      </h2>
    </header>
  );
}

function HeatCard({ analysis }: { analysis: Analysis }) {
  const v = corrView(analysis);
  return (
    <>
      <ChartFrame title={heatTitle(v)} subtitle={heatSubtitle(v)} state={heatState(v)} height={320}>
        {(ready) => <Heatmap view={ready} />}
      </ChartFrame>
      <Table
        title="Pairwise correlation of daily returns"
        columns={matrixColumns(v.tickers, CORR_FORMAT)}
        rows={matrixRows(v.tickers, v.matrix)}
        filename="pairwise-correlation"
      />
    </>
  );
}

function CovCard({ analysis, level, allowShort }: { analysis: Analysis; level: Level; allowShort: boolean }) {
  const { tickers, S } = analysis;
  return (
    <>
      <p className="corr-note">
        Daily, not annualised: the sample covariance (n − 1) of each pair's daily returns, the matrix the optimiser
        uses. The diagonal is each asset's daily variance; its square root times √252 is the annual volatility.
        <Tip tip="volatility" level={level} allowShort={allowShort} />
      </p>
      <Table title="Daily covariance matrix" columns={matrixColumns(tickers, COV_FORMAT)} rows={matrixRows(tickers, S)} filename="daily-covariance" />
    </>
  );
}
