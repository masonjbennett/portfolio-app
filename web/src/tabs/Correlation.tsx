// The Diversification chapter (portfolio_app.py 1421-1462): the finding names the most and least correlated
// pair; the lead card is the pairwise heatmap (1425-1436), its figures as a table under "Show the numbers";
// a More list holds the rolling correlation of two chosen assets (1441-1458), what equal weights did to
// volatility, and the daily covariance matrix (1461-1462). A row draws nothing until it is first opened.
//
// The app offers no download on this tab: the heatmap has no table behind it and the covariance matrix
// sits in an expander as a styled frame. Here both matrices are Tables, each with CSV and Excel, holding
// the raw numbers.
//
// Each card sits in its own Boundary, so one that fails leaves the others standing. Every figure is
// computed inside the card that shows it (Boundary: a throw in the parent's own render is not caught).
import { memo } from "react";
import Boundary from "../components/Boundary.tsx";
import Card from "../components/Card.tsx";
import ChartFrame from "../components/ChartFrame.tsx";
import FormulaLine from "../components/FormulaLine.tsx";
import HowTips from "../components/HowTips.tsx";
import MoreList, { type MoreRow } from "../components/MoreList.tsx";
import Table from "../components/Table.tsx";
import Term from "../components/Term.tsx";
import type { Analysis, TabProps } from "../types.ts";
import { tableSpan } from "./caption.ts";
import Heatmap from "./correlation/Heatmap.tsx";
import Rolling from "./correlation/Rolling.tsx";
import { covarianceFinding, DIV_HEADING, DIV_LIST, DIV_ROWS, rollingFinding, spreadFinding } from "./diversification.ts";
import { correlationFormula } from "./formula.ts";
import { said } from "./performance.ts";
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
  spread,
  spreadSentence,
} from "./correlation/model.ts";
import "./correlation/correlation.css";

export default function Correlation({ analysis }: TabProps) {
  const rows: MoreRow[] = [
    {
      key: "rolling",
      title: DIV_ROWS.rolling,
      finding: said(DIV_ROWS.rolling, () => rollingFinding(analysis)),
      children: (
        <Boundary name="Rolling correlation" resetKey={analysis}>
          <Rolling analysis={analysis} />
        </Boundary>
      ),
    },
    {
      key: "spread",
      title: DIV_ROWS.spread,
      finding: said(DIV_ROWS.spread, () => spreadFinding(analysis)),
      children: (
        <Boundary name="Equal-weight volatility note" resetKey={analysis}>
          <SpreadCard analysis={analysis} />
        </Boundary>
      ),
    },
    {
      key: "covariance",
      title: DIV_ROWS.covariance,
      finding: said(DIV_ROWS.covariance, () => covarianceFinding(analysis)),
      children: (
        <Boundary name="Daily covariance matrix" resetKey={analysis}>
          <CovCard analysis={analysis} />
        </Boundary>
      ),
    },
  ];
  return (
    <section className="corr-tab" aria-labelledby="corr-headline">
      <Boundary name="Correlation headline" resetKey={analysis}>
        <Headline analysis={analysis} />
      </Boundary>
      <Boundary name="Correlation heatmap" resetKey={analysis}>
        <HeatCard analysis={analysis} />
      </Boundary>
      <MoreList id={DIV_LIST} rows={rows} heading={DIV_HEADING} />
    </section>
  );
}

const Headline = memo(function Headline({ analysis }: { analysis: Analysis }) {
  const v = corrView(analysis);
  return (
    <header className="corr-head">
      <h2 className="tab-finding corr-headline" id="corr-headline">
        {headline(v)}
      </h2>
      <FormulaLine build={() => correlationFormula(v)} />
    </header>
  );
});

// The heatmap's sub-line, with "correlation" a glossary term where the sentence names it.
function HeatSub({ text }: { text: string }) {
  const at = text.indexOf("correlation");
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Term k="corr">correlation</Term>
      {text.slice(at + "correlation".length)}
    </>
  );
}

const HeatCard = memo(function HeatCard({ analysis }: { analysis: Analysis }) {
  const v = corrView(analysis);
  const title = heatTitle(v);
  const numbers = (
    <Table
      title="Pairwise correlation of daily returns"
      columns={matrixColumns(v.tickers, CORR_FORMAT)}
      rows={matrixRows(v.tickers, v.matrix)}
      filename="pairwise-correlation"
      span={tableSpan(analysis.dates[0], analysis.asOf)}
    />
  );
  const how = (
    <p className="corr-note">
      Each cell is the Pearson correlation of the two assets{"’"} daily returns over the whole window: 1 when they always moved
      together, 0 when they were unrelated, −1 when they always moved opposite. Claret cells are positive, navy negative, and a
      stronger figure is a deeper shade. The table under Show the numbers gives each figure to three places.
    </p>
  );
  return (
    <Card id="div-heatmap" title={title} sub={<HeatSub text={heatSubtitle(v)} />} numbers={numbers} how={how}>
      <ChartFrame title={title} state={heatState(v)} height={320} bare>
        {(ready) => <Heatmap view={ready} />}
      </ChartFrame>
    </Card>
  );
});

// What equal weights did to volatility over this window: the one sentence, in full. Nothing at all when there
// is nothing true to say (fewer than two assets, a missing matrix, an undefined figure).
const SpreadCard = memo(function SpreadCard({ analysis }: { analysis: Analysis }) {
  const sentence = spreadSentence(spread(analysis, corrView(analysis)));
  if (!sentence) return null;
  const how = (
    <p className="corr-note">
      The equal-weight figure is the volatility of the portfolio that holds each asset in the same share, rebalanced daily,
      worked out from the covariance matrix. The average on their own weights each asset{"’"}s own volatility the same way. The
      gap between the two is what holding assets that do not move in lockstep took away. Both are measured on this window, so
      they describe the past, not a forecast.
    </p>
  );
  return (
    <Card label={DIV_ROWS.spread} how={how}>
      <p className="corr-note corr-spread">{sentence}</p>
    </Card>
  );
});

const CovCard = memo(function CovCard({ analysis }: { analysis: Analysis }) {
  const { tickers, S } = analysis;
  const how = (
    <>
      <p className="corr-note">
        Daily, not annualised: the sample covariance (n − 1) of each pair{"’"}s daily returns, the matrix the optimiser uses. The
        diagonal is each asset{"’"}s daily variance; its square root times √252 is the annual volatility.
      </p>
      <HowTips keys={["volatility"]} allowShort={analysis.allowShort} />
    </>
  );
  return (
    <Card label={DIV_ROWS.covariance} how={how}>
      <Table
        title="Daily covariance matrix"
        columns={matrixColumns(tickers, COV_FORMAT)}
        rows={matrixRows(tickers, S)}
        filename="daily-covariance"
        span={tableSpan(analysis.dates[0], analysis.asOf)}
        headed
      />
    </Card>
  );
});
