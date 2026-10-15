// Does it hold up?'s "Range of outcomes" row: how wide the endings of a few years can be if the future reshuffles the
// window's own months. A fan (each line's median path and its 10th-90th percentile band, month by month), a 1 / 3 / 5
// year choice capped at the window's length, and the card's two folds. The bootstrap is src/lib/simulate.ts; the
// words and the cache are ./outcomes.ts. The row draws nothing until it opens, and the fan for the horizon it opens on
// is the one its finding already computed.
import { memo, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Area, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "../../components/Card.tsx";
import ChartFrame from "../../components/ChartFrame.tsx";
import SegControl from "../../components/SegControl.tsx";
import Table from "../../components/Table.tsx";
import { axisProps, DASH, gridProps, legendProps, ROLE, tooltipProps } from "../../charts/theme.ts";
import { ReadableTip } from "../../charts/ReadableTip.tsx";
import { format } from "../../format.ts";
import { encodeKept, keptOf, type Kept } from "../../lib/kept.ts";
import { DEFAULT_SEED } from "../../lib/rng.ts";
import { BLOCK_DAYS, PATHS, START, type Fan, type Horizon, type OutcomeKey } from "../../lib/simulate.ts";
import { MIX } from "../../overview/model.ts";
import type { Analysis, Column, LoadState } from "../../types.ts";
import { tableSpan } from "../caption.ts";
import { WF_ROWS } from "../holdup.ts";
import KeptFan from "./Kept.tsx";
import { chartRows, fanOf, lineName, numberRows, outcomesSub, outcomesTitle, rowHorizons, spanOf } from "./outcomes.ts";

const HEIGHT = 340;
const COLOR: Record<OutcomeKey, string> = { ew: ROLE.ew, gmv: ROLE.gmv, bench: ROLE.bench };
const usd = (x: number) => format(x, "usd0");
const yearTick = (m: number) => (m === 0 ? "Start" : m % 12 === 0 ? `Year ${m / 12}` : "");

const COLUMNS: Column[] = [
  { key: "year", label: "Year", format: "int", first: true },
  { key: "line", label: "Line", format: "text" },
  { key: "p10", label: "10th percentile", format: "usd0" },
  { key: "p50", label: "Median", format: "usd0" },
  { key: "p90", label: "90th percentile", format: "usd0" },
];

// The tooltip's value: a band reads as its two ends, a median as itself.
const tipValue = (v: unknown, name: unknown): [string, string] => {
  const label = typeof name === "string" ? name : "";
  if (Array.isArray(v)) return [`${usd(Number(v[0]))} to ${usd(Number(v[1]))}`, label];
  return [usd(Number(v)), label];
};

const FanPlot = memo(function FanPlot({ a, fan }: { a: Analysis; fan: Fan }) {
  const rows = useMemo(() => chartRows(fan), [fan]);
  const ticks = fan.months.filter((m) => m % 12 === 0);
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <ComposedChart data={rows} margin={{ top: 12, right: 32, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="month" type="number" domain={[0, fan.months[fan.months.length - 1]]} ticks={ticks} tickFormatter={yearTick} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v: number) => usd(v)} width={64} domain={["auto", "auto"]} />
        <Tooltip {...tooltipProps("x")} content={ReadableTip} formatter={tipValue} labelFormatter={(m) => `Month ${m}`} />
        <Legend {...legendProps} />
        {fan.lines
          .filter((l) => l.key !== "bench")
          .map((l) => (
            <Area
              key={`${l.key}-band`}
              type="linear"
              dataKey={`${l.key}Band`}
              name={`${lineName(a, l.key as OutcomeKey)}, 10th to 90th`}
              stroke="none"
              fill={COLOR[l.key as OutcomeKey]}
              fillOpacity={0.14}
              legendType="none"
              isAnimationActive={false}
            />
          ))}
        {fan.lines.map((l) => (
          <Line
            key={`${l.key}-mid`}
            type="linear"
            dataKey={`${l.key}Mid`}
            name={`${lineName(a, l.key as OutcomeKey)}, median`}
            stroke={COLOR[l.key as OutcomeKey]}
            strokeWidth={l.key === "bench" ? 1.2 : 1.8}
            strokeDasharray={l.key === "bench" ? DASH.bench : undefined}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
});

export default function Outcomes({ analysis: a, kept = null }: { analysis: Analysis; kept?: Kept | null }) {
  const { offered, first } = rowHorizons(a);
  const [pick, setPick] = useState<Horizon | null>(first);
  const h = pick && offered.includes(pick) ? pick : first;
  const fan = useMemo(() => (h ? fanOf(a, h) : null), [a, h]);
  const state: LoadState<Fan> = fan
    ? { status: "ready", value: fan }
    : { status: "empty", reason: "The window holds less than a year of returns, so there is nothing to reshuffle into a year." };
  const options = offered.map((y) => ({ value: String(y), label: y === 1 ? "1 year" : `${y} years` }));
  const span = spanOf(a).replace(/'s$/, "");
  // The link that keeps this fan: the share link for this window plus the fan's own figures (src/lib/kept.ts).
  const keep = fan ? encodeKept(keptOf(a, fan, DEFAULT_SEED)) : null;
  const numbers = fan ? (
    <Table
      title="Range of Outcomes"
      columns={COLUMNS}
      rows={numberRows(a, fan)}
      filename="range_of_outcomes"
      span={tableSpan(a.dates[0], a.asOf)}
    />
  ) : null;
  const how = (
    <>
      <p className="wfo-how">
        The window&rsquo;s daily returns, {span}, are cut into runs of {BLOCK_DAYS} trading days, about a month. A path
        strings runs drawn at random, with repeats, until it is as long as the horizon. Every asset and the benchmark
        take the same days, so how they moved together, and the shape of a crash, survive inside each run. Nothing is
        drawn from a normal or any other assumed distribution. Each mix is rebalanced daily to fixed weights and starts
        at {usd(START)}.
      </p>
      <p className="wfo-how">
        {format(PATHS, "int")} paths per horizon. The band runs from the 10th to the 90th percentile of the paths at each
        month, so eight paths in ten end inside it; the line is the median. The draws are seeded, so the same basket gives
        the same fan every time.
      </p>
      <p className="wfo-how">
        The mixes are the {MIX.ew.name.toLowerCase()} and the {MIX.gmv.name.toLowerCase()}, whose weights do not use the
        window&rsquo;s average returns. The {MIX.tangency.name.toLowerCase()} is left out: its weights are chosen from
        those average returns, so reshuffling the same months would replay the hindsight the walk-forward test above
        measures, and flatter it.
      </p>
      <p className="wfo-how">
        This is a spread under one assumption, that the coming years look like these years&rsquo; months in a new order,
        and not a forecast. It cannot hold a month the window did not have, and it offers no horizon longer than the
        window.
      </p>
      <p className="wfo-how">
        &ldquo;Keep this fan to check later&rdquo; is a link holding only the tickers, the window and the fan&rsquo;s
        figures. Opened later, it draws this fan again, as it was, with the real prices since {a.asOf} over it.
      </p>
    </>
  );
  const card = (
    <Card label={WF_ROWS.outcomes} numbers={numbers} how={how}>
      {options.length > 1 ? (
        <div className="wfo-switch">
          <span className="wfl-row-label">Years ahead</span>
          <SegControl options={options} value={String(h)} onChange={(v: string) => setPick(Number(v) as Horizon)} ariaLabel="Years ahead" />
        </div>
      ) : null}
      <ChartFrame
        title={fan ? outcomesTitle(fan) : "Not simulated"}
        subtitle={fan ? outcomesSub(a, fan) : undefined}
        state={state}
        height={HEIGHT}
      >
        {(f) => <FanPlot a={a} fan={f} />}
      </ChartFrame>
      {keep ? (
        <p className="wfo-keep">
          <a href={keep}>Keep this fan to check later</a>
        </p>
      ) : null}
    </Card>
  );
  if (!kept) return card;
  return (
    <>
      <KeptFan kept={kept} analysis={a} />
      {card}
    </>
  );
}
