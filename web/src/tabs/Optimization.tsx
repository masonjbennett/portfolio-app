// Build a portfolio: the Portfolio Optimization tab (portfolio_app.py 1467-1703) with the app's Custom Portfolio
// tab (1708-1837) folded into it. A headline that states what the maximum-Sharpe solve found; then the lead, the
// efficient frontier with all four mixes on it and, beside it, the Your mix panel (./custom/YourMix.tsx), whose
// sliders move the mix's point on the frontier; then a More list (./build.ts): the scorecard, what each mix holds,
// the redraw dot strips, the money, return and risk shares, and the what-if (../chrome/WhatIfRow.tsx).
// The three portfolios' plates and the summary comparison are not drawn: every figure they printed is a row of the
// scorecard, and the Your mix panel carries the reader's own five.
// The arithmetic lives in ./optimization/model.ts, ./optimization/scorecard.ts and ./custom/model.ts; this file
// lays it out.
//
// The growth of the starting amount is not drawn here: Performance's growth card carries every line it drew (its
// mixes view, with the mix's own line), and every ending value in its table.
//
// The redraws (200 re-solves of both optimised portfolios) are solved after the tab has painted, never
// during a render: the strips and the scorecard's draw row say so until they land.
//
// The scorecard's "Add a column" row sets more constructions beside the default columns (in the
// scorecard and the weights table, and handed to the frontier). Which ones are on lives in the settings,
// so the share link carries them; each is solved once per analysis, its redraws after paint on the page's
// own seed, and a construction the basket cannot have is ignored for that basket.
//
// Each section sits inside its own Boundary, so a section that fails leaves one line naming it and the
// rest of the tab keeps rendering. In the app a failed solve calls st.stop() (1481-1483, 1492-1494),
// which ends the script run: this tab, and tabs 5 and 6 after it, stop there.
import { memo, useCallback, useMemo, useState } from "react";
import Frontier, { frontierCaption, frontierData } from "../charts/Frontier.tsx";
import { usePhone } from "../chrome/usePhone.ts";
import AddColumns from "../components/AddColumns.tsx";
import Boundary from "../components/Boundary.tsx";
import Card from "../components/Card.tsx";
import ChartFrame from "../components/ChartFrame.tsx";
import FormulaLine from "../components/FormulaLine.tsx";
import MoreList, { type MoreRow } from "../components/MoreList.tsx";
import Scorecard from "../components/Scorecard.tsx";
import SegControl from "../components/SegControl.tsx";
import Table from "../components/Table.tsx";
import WhatIfRow, { loadWhatIf } from "../chrome/WhatIfRow.tsx";
import { format, MINUS } from "../format.ts";
import { ADDED_IDS, unavailable, type AddedId } from "../lib/constructions.ts";
import type { Vec } from "../lib/num.ts";
import type { Custom } from "../lib/portfolio.ts";
import type { Analysis, Level, LoadState, TabProps } from "../types.ts";
import { BUILD_HEADING, BUILD_LIST, BUILD_ROWS, holdingsFinding, prcFinding, redrawsFinding, scorecardFinding, WHATIF_FINDING } from "./build.ts";
import { fittedSubs, tableSpan } from "./caption.ts";
import { customView, frontierTitle as mixFrontierLine, type CustomView } from "./custom/model.ts";
import YourMix from "./custom/YourMix.tsx";
import FittedNote from "./FittedNote.tsx";
import { optimizationFormula } from "./formula.ts";
import { said } from "./performance.ts";
import Bars from "./optimization/Bars.tsx";
import DotStrips, { StripsHow } from "./optimization/DotStrips.tsx";
import { seedOf, useAddedStrips, useRedraws } from "./optimization/redraws.ts";
import { scorecard, type AddedDraws, type RedrawState } from "./optimization/scorecard.ts";
import {
  ADDED_LABEL,
  addedFit,
  addedSubs,
  customWeights,
  customNote,
  FAILED,
  fittedHeads,
  frontierTitle,
  headline,
  portRow,
  prcTable,
  SHARE_LABEL,
  SHARE_PORTS,
  shareBars,
  shareNote,
  shareTitle,
  shareWeights,
  type SharePort,
  shownAdded,
  unavailableNote,
  weightBars,
  weightsTitle,
  weightTable,
  type TableData,
} from "./optimization/model.ts";
import "./optimization/Optimization.css";

// A table, or its own named error line in the table's place. Its GMV and Tangency heads say the weights
// were chosen on this window, and an added construction's head says what its own window was; its caption
// says which window, and that the returns are daily.
function TableState({
  state,
  title,
  filename,
  span,
  headed,
  subs,
}: {
  state: LoadState<TableData>;
  title: string;
  filename: string;
  span: string;
  headed?: boolean;
  subs?: Record<string, string>;
}) {
  if (state.status === "ready") {
    const t = state.value;
    return <Table title={title} columns={t.columns} rows={t.rows} filename={filename} span={span} subs={{ ...fittedSubs(fittedHeads(t)), ...subs }} headed={headed} />;
  }
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

// Every table on the tab is computed from the whole window's daily returns.
const spanOf = (a: Analysis) => tableSpan(a.dates[0], a.asOf);

const shortNote = `Shorting is on: each weight is bounded to [${MINUS}100%, 100%], and the weights sum to 100%.`;

const Headline = memo(function Headline({ a, level }: { a: Analysis; level: Level }) {
  return (
    <>
      <h2 className="tab-finding opt-headline">{headline(a)}</h2>
      <FormulaLine level={level} build={() => optimizationFormula(a.tangency, a.gmv, portRow(a, a.ew), a.rf, a.allowShort)} />
    </>
  );
});

/** An added construction as the frontier takes it: its id, its head, its weights. */
interface AddedMark {
  id: string;
  label: string;
  w: Vec;
}

// The efficient frontier (1592-1656), Build's lead card: GMV, Tangency, Equal-Weight and the reader's mix
// (Custom) on it, with the added constructions. `added` holds the solved added constructions, the same array
// while nothing changes, for the frontier to mark. Its sub-line is how far the reader's mix sits from the
// frontier (the app's tab-5 title, 1753-1819), so a slider beside it moves the point and the sentence together.
const FrontierCard = memo(function FrontierCard({ a, v, custom, added }: { a: Analysis; v: CustomView; custom: Vec | null; added: readonly AddedMark[] }) {
  const state = useMemo(() => ({ status: "ready" as const, value: frontierData(a, custom, a.frontier, added) }), [a, custom, added]);
  const title = frontierTitle(a);
  const how = (
    <>
      <p className="opt-note">{frontierCaption(a.allowShort, a.rf, state.value.cal)}</p>
      <p className="opt-note">
        The frontier is the set of portfolios with the highest return for each level of volatility, over the prices on this page.
        {a.tangency ? " Any point on the dashed line can be reached by mixing the tangency portfolio with the risk-free asset." : ""}
      </p>
    </>
  );
  return (
    <Card id="build-frontier" title={title} sub={mixFrontierLine(a, v)} how={how}>
      <Frontier title={title} state={state} allowShort={a.allowShort} rf={a.rf} bare />
    </Card>
  );
});

// The weights (1534-1551), "What each mix holds": the bars of the three portfolios the chapter always solves,
// then under "Show the numbers" the same numbers as a table with both downloads, with the reader's mix and a
// column per added construction. An added column does not reach the chart, so adding one leaves it undrawn.
const Holdings = memo(function Holdings({ a, c, height, added }: { a: Analysis; c: Custom; height: number; added: readonly AddedId[] }) {
  const bars = useMemo(() => weightBars(a), [a]);
  const table = useMemo(() => weightTable(a, added, c), [a, added, c]);
  const subs = useMemo(() => addedSubs(a, added), [a, added]);
  const title = weightsTitle(a);
  const numbers = (
    <>
      <TableState state={table} title="Portfolio weights" filename="portfolio_weights" span={spanOf(a)} subs={subs} />
      {a.allowShort ? <p className="opt-note">{shortNote}</p> : null}
    </>
  );
  const how = (
    <p className="opt-note">
      Each asset{"’"}s weight in the minimum-variance (GMV), maximum-Sharpe (Tangency) and equal-weight portfolios. The table under
      Show the numbers adds your mix (Custom), scaled to sum to 100%, and any column added to the scorecard.
    </p>
  );
  return (
    <Card label={BUILD_ROWS.holdings} numbers={numbers} how={how}>
      <Failures a={a} />
      <ChartFrame title={title} state={bars} height={height} bare>
        {(v) => <Bars data={v} height={height} />}
      </ChartFrame>
    </Card>
  );
});

// The scorecard: every portfolio across, the benchmark last. Above it, the row of constructions the reader can
// add, each a column between Custom and the benchmark. It is handed what the workbook of formulas needs (the
// analysis, the amount invested, why a typed mix was refused), so its download row offers that book beside the
// values. It carries every figure the three portfolios' plates and the summary comparison printed (their return,
// volatility, Sharpe with its standard error, Sortino and maximum drawdown are its rows; test/t-scorecard.mjs holds
// them figure by figure), so their notes are under its "How it is calculated".
const ScorecardCard = memo(function ScorecardCard({
  a,
  c,
  redraws,
  level,
  amount,
  chosen,
  shown,
  draws,
  onToggle,
}: {
  a: Analysis;
  c: Custom;
  redraws: RedrawState;
  level: Level;
  amount: number;
  chosen: readonly AddedId[];
  shown: readonly AddedId[];
  draws: AddedDraws;
  onToggle: (id: AddedId) => void;
}) {
  const model = useMemo(() => scorecard(a, c, redraws, shown, draws), [a, c, redraws, shown, draws]);
  const book = useMemo(() => ({ analysis: a, amount, refused: c.ok ? null : c.reason }), [a, amount, c]);
  // Whether a button is offered reads the basket's size only; a construction is solved once its column is added.
  const options = useMemo(
    () =>
      ADDED_IDS.map((id) => ({ id, label: ADDED_LABEL[id], on: chosen.includes(id), offered: unavailable(id, a.dates.length, a.tickers.length) === null })),
    [a, chosen],
  );
  const note = useMemo(() => unavailableNote(a), [a]);
  const mixNote = customNote(a, c);
  const how = (
    <>
      <p className="opt-note">
        Annual figures at the {format(a.rf, "pct2")} risk-free rate this analysis used. Each portfolio holds its weights fixed,
        rebalanced daily. Max drawdown is measured from the amount invested. The {a.benchLabel} column is the benchmark{"’"}s own daily
        returns.
      </p>
      {mixNote ? <p className="opt-note">{mixNote}</p> : null}
      <FittedNote className="opt-note" />
    </>
  );
  return (
    <Card label={BUILD_ROWS.scorecard} how={how}>
      <AddColumns options={options} onToggle={onToggle} note={note} />
      <Failures a={a} />
      <Scorecard model={model} redraws={redraws} level={level} allowShort={a.allowShort} filename="scorecard" book={book} />
    </Card>
  );
});

// Risk contribution (1555-1572), widened: each asset's share of the money, of the return and of the
// risk, for the portfolio the pill picks, then every portfolio's shares side by side in the table.
const SHARE_OPTIONS = SHARE_PORTS.map((id) => ({ value: id, label: SHARE_LABEL[id] }));

const RiskContribution = memo(function RiskContribution({ a, c, height }: { a: Analysis; c: Custom; height: number }) {
  const [pick, setPick] = useState<SharePort>("tangency");
  // A pick whose portfolio is missing (a failed solve, a refused mix) shows the first one that is there.
  const shown = shareWeights(a, c, pick) ? pick : (SHARE_PORTS.find((id) => shareWeights(a, c, id)) ?? pick);
  // The custom weights reach the bars only while Custom is the portfolio shown, so an edited mix leaves
  // another portfolio's bars as they were, undrawn.
  const barsCustom = shown === "custom" ? c : null;
  const bars = useMemo(() => shareBars(a, barsCustom, shown), [a, barsCustom, shown]);
  const table = useMemo(() => prcTable(a, c), [a, c]);
  const note = useMemo(() => shareNote(a, c), [a, c]);
  const numbers = (
    <>
      <TableState state={table} title="Weight, return and risk contribution" filename="risk_contribution" span={spanOf(a)} />
      {note ? (
        <p className="opt-note" data-note="share-range">
          {note}
        </p>
      ) : null}
    </>
  );
  const how = (
    <p className="opt-note">
      An asset{"’"}s percentage risk contribution (PRC) is its share of the portfolio{"’"}s variance: its weight times its covariance
      with the portfolio, over the portfolio{"’"}s variance. The shares sum to 100%. An asset whose PRC is well above its weight is a
      disproportionate source of volatility. Its return share is its weight times its mean return, over the portfolio{"’"}s mean
      return; those sum to 100% too, and can fall below 0% or pass 100%. The table under Show the numbers sets weight, return and
      risk side by side for every portfolio.
    </p>
  );
  return (
    <Card label={BUILD_ROWS.prc} numbers={numbers} how={how}>
      <div className="opt-share-pills">
        <SegControl options={SHARE_OPTIONS} value={shown} onChange={setPick} ariaLabel="Portfolio" />
      </div>
      <ChartFrame
        title={shareTitle(a, c, shown)}
        subtitle={`Each asset's share of ${SHARE_LABEL[shown]}'s money (its weight), of its return and of its risk, over this window.`}
        state={bars}
        height={height}
      >
        {(v) => <Bars data={v} height={height} />}
      </ChartFrame>
    </Card>
  );
});

// No construction added: one array, so the memos below hold while nothing is added.
const NO_COLS: readonly AddedId[] = [];
const NO_MARKS: readonly AddedMark[] = [];

export default function Optimization({ analysis: a, settings, level, weights, setWeights, requestSettings }: TabProps) {
  const phone = usePhone();
  const barHeight = phone ? 320 : 400;
  // c changes with the analysis or the custom weights, so the cards that draw the custom book re-arm on either.
  const c = useMemo(() => customWeights(a, weights), [a, weights]);
  const v = useMemo(() => customView(a, weights), [a, weights]);
  const custom = c.ok ? c.w : null;
  // The draw set on screen, per analysis: a new analysis starts again at the first set, the downloads' seed.
  const [draws, setDraws] = useState<{ a: Analysis; k: number }>({ a, k: 0 });
  const k = draws.a === a ? draws.k : 0;
  const seed = seedOf(k);
  const redraws = useRedraws(a, seed);
  // The constructions the reader added (the settings carry them, so the link does), and those of them
  // this basket can have, which are the ones shown.
  const chosen = settings.cols ?? NO_COLS;
  const shown = useMemo(() => {
    const s = shownAdded(a, chosen);
    return s.length ? s : NO_COLS;
  }, [a, chosen]);
  const addedDraws = useAddedStrips(a, shown, seed);
  const onToggle = useCallback(
    (id: AddedId) => requestSettings({ cols: ADDED_IDS.filter((x) => (x === id ? !chosen.includes(x) : chosen.includes(x))) }),
    [chosen, requestSettings],
  );
  // What the frontier marks: each shown construction that found weights.
  const marks = useMemo(() => {
    const out = shown.flatMap((id): AddedMark[] => {
      const w = addedFit(a, id).sol?.w;
      return w ? [{ id, label: ADDED_LABEL[id], w }] : [];
    });
    return out.length ? out : NO_MARKS;
  }, [a, shown]);
  const weightsKey = useMemo(() => [a, c, shown], [a, c, shown]);
  const scoreKey = useMemo(() => [c, redraws, shown, addedDraws], [c, redraws, shown, addedDraws]);
  // Each card is memo'd, so one whose own inputs did not change is skipped when the chapter renders again: an
  // explanation level reaches the tooltips, an amount the scorecard's workbook. A row draws nothing until it
  // first opens (MoreList); the findings beside the rows are computed from the same models the cards draw.
  const rows: MoreRow[] = [
    {
      key: "scorecard",
      title: BUILD_ROWS.scorecard,
      finding: said(BUILD_ROWS.scorecard, () => scorecardFinding(a, c)),
      children: (
        <Boundary name="Scorecard" resetKey={scoreKey}>
          <ScorecardCard
            a={a}
            c={c}
            redraws={redraws}
            level={level}
            amount={settings.amount}
            chosen={chosen}
            shown={shown}
            draws={addedDraws}
            onToggle={onToggle}
          />
        </Boundary>
      ),
    },
    {
      key: "holdings",
      title: BUILD_ROWS.holdings,
      finding: said(BUILD_ROWS.holdings, () => holdingsFinding(a)),
      children: (
        <Boundary name="Portfolio weights" resetKey={weightsKey}>
          <Holdings a={a} c={c} height={barHeight} added={shown} />
        </Boundary>
      ),
    },
    {
      key: "redraws",
      title: BUILD_ROWS.redraws,
      finding: said(BUILD_ROWS.redraws, () => redrawsFinding(a, redraws)),
      children: (
        <Boundary name="Redraw dot strips" resetKey={redraws}>
          <Card label={BUILD_ROWS.redraws} how={<StripsHow redraws={redraws} />}>
            <DotStrips a={a} redraws={redraws} set={k} seed={seed} onRedraw={() => setDraws({ a, k: k + 1 })} />
          </Card>
        </Boundary>
      ),
    },
    {
      key: "prc",
      title: BUILD_ROWS.prc,
      finding: said(BUILD_ROWS.prc, () => prcFinding(a)),
      children: (
        <Boundary name="Risk contribution" resetKey={c}>
          <RiskContribution a={a} c={c} height={barHeight} />
        </Boundary>
      ),
    },
    {
      key: "whatif",
      title: BUILD_ROWS.whatif,
      finding: WHATIF_FINDING,
      before: loadWhatIf,
      children: (
        <Boundary name="What-if" resetKey={a}>
          <WhatIfRow a={a} />
        </Boundary>
      ),
    },
  ];
  return (
    <div className="opt" data-tab="optimization">
      <Boundary name="The headline" resetKey={a}>
        <Headline a={a} level={level} />
      </Boundary>
      {/* The lead: the frontier, then the panel that moves the mix on it. On a desktop wide enough for both they sit
          side by side (./optimization/Optimization.css); narrower, the panel follows the chart. */}
      <div className="build-lead">
        <Boundary name="Efficient frontier" resetKey={v}>
          <FrontierCard a={a} v={v} custom={custom} added={marks} />
        </Boundary>
        <Boundary name="Your mix" resetKey={v}>
          <YourMix a={a} v={v} weights={weights} setWeights={setWeights} level={level} />
        </Boundary>
      </div>
      <MoreList id={BUILD_LIST} rows={rows} heading={BUILD_HEADING} />
    </div>
  );
}
