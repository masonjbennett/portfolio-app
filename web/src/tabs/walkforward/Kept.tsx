// A kept fan, opened from its link (src/lib/kept.ts): the ORIGINAL fan redrawn from the figures the link carries, the
// real prices since its as-of day drawn over it, and where each line landed as a percentile of what was simulated at
// that day. It never judges: one fan landing inside or outside its band proves little, and the "How it is calculated"
// fold says so once.
import { memo, useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "../../components/Card.tsx";
import ChartFrame from "../../components/ChartFrame.tsx";
import Table from "../../components/Table.tsx";
import { axisProps, DASH, gridProps, legendProps, ROLE, tooltipProps } from "../../charts/theme.ts";
import { ReadableTip } from "../../charts/ReadableTip.tsx";
import { format } from "../../format.ts";
import { checkKept, keptGap, keptOf, type Kept, type KeptCheck } from "../../lib/kept.ts";
import { CHECK_DAYS, outcomes, START, type OutcomeKey } from "../../lib/simulate.ts";
import { DEFAULT_SEED } from "../../lib/rng.ts";
import { MIX } from "../../overview/model.ts";
import { benchDisplay } from "../../state/defaults.ts";
import type { Analysis, Column, LoadState } from "../../types.ts";
import { tableSpan } from "../caption.ts";
import { fanOf, keptGapNote, keptRows, keptSub, keptTitle } from "./outcomes.ts";

const HEIGHT = 300;
const COLOR: Record<OutcomeKey, string> = { ew: ROLE.ew, gmv: ROLE.gmv, bench: ROLE.bench };
const usd = (x: number) => format(x, "usd0");
const yearTick = (m: number) => (m === 0 ? "Start" : m % 12 === 0 ? `Year ${m / 12}` : "");

const COLUMNS: Column[] = [
  { key: "line", label: "Line", format: "text", first: true },
  { key: "value", label: "Real value", format: "usd0" },
  { key: "p10", label: "10th percentile", format: "usd0" },
  { key: "p50", label: "Median", format: "usd0" },
  { key: "p90", label: "90th percentile", format: "usd0" },
  { key: "place", label: "Where it sits", format: "text" },
];

const tipValue = (v: unknown, name: unknown): [string, string] => {
  const label = typeof name === "string" ? name : "";
  if (Array.isArray(v)) return [`${usd(Number(v[0]))} to ${usd(Number(v[1]))}`, label];
  return [usd(Number(v)), label];
};

function nameOf(k: Kept, key: OutcomeKey): string {
  return key === "bench" ? benchDisplay(k.benchmark) : MIX[key].name;
}

// The chart's rows: the kept months with each line's band and median, and every fifth real day with each real path.
function rowsOf(k: Kept, check: KeptCheck | null) {
  const rows: Record<string, number | [number, number]>[] = [];
  const kept = [0, ...k.months];
  kept.forEach((m, i) => {
    const row: Record<string, number | [number, number]> = { month: m };
    for (const l of k.lines) {
      const q = i === 0 ? [START, START, START, START, START] : l.q[i - 1];
      row[`${l.key}Band`] = [q[0], q[4]];
      row[`${l.key}Mid`] = q[2];
    }
    rows.push(row);
  });
  if (check?.status === "ready") {
    const days = check.path.dates.length;
    for (let d = 0; d < days; d++) {
      if (d % 5 !== 0 && d !== days - 1) continue;
      const row: Record<string, number> = { month: d / CHECK_DAYS };
      for (const p of check.path.lines) row[`${p.key}Real`] = p.wealth[d];
      rows.push(row);
    }
  }
  return rows.sort((a, b) => (a.month as number) - (b.month as number));
}

const KeptPlot = memo(function KeptPlot({ k, check }: { k: Kept; check: KeptCheck | null }) {
  const rows = useMemo(() => rowsOf(k, check), [k, check]);
  const end = k.horizon * 12;
  const ticks = Array.from({ length: k.horizon + 1 }, (_, y) => y * 12);
  const real = check?.status === "ready" ? check.path.lines : [];
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <ComposedChart data={rows} margin={{ top: 12, right: 32, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="month" type="number" domain={[0, end]} ticks={ticks} tickFormatter={yearTick} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v: number) => usd(v)} width={64} domain={["auto", "auto"]} />
        <Tooltip {...tooltipProps("x")} content={ReadableTip} formatter={tipValue} labelFormatter={(m) => `Month ${Math.round(Number(m))}`} />
        <Legend {...legendProps} />
        {k.lines
          .filter((l) => l.key !== "bench")
          .map((l) => (
            <Area
              key={`${l.key}-band`}
              type="linear"
              dataKey={`${l.key}Band`}
              name={`${nameOf(k, l.key)}, kept 10th to 90th`}
              stroke="none"
              fill={COLOR[l.key]}
              fillOpacity={0.14}
              legendType="none"
              connectNulls
              isAnimationActive={false}
            />
          ))}
        {k.lines.map((l) => (
          <Line
            key={`${l.key}-mid`}
            type="linear"
            dataKey={`${l.key}Mid`}
            name={`${nameOf(k, l.key)}, kept median`}
            stroke={COLOR[l.key]}
            strokeWidth={1.1}
            strokeDasharray={DASH.reference}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
        {real.map((p) => (
          <Line
            key={`${p.key}-real`}
            type="linear"
            dataKey={`${p.key}Real`}
            name={`${nameOf(k, p.key)}, real`}
            stroke={COLOR[p.key]}
            strokeWidth={p.key === "bench" ? 1.4 : 2.2}
            strokeDasharray={p.key === "bench" ? DASH.bench : undefined}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
});

// The analysis on screen is the kept window itself (same basket, benchmark, bounds, first day and as-of day): only
// then is a recompute a cross-check.
function sameWindow(a: Analysis, k: Kept): boolean {
  return (
    a.asOf === k.asOf &&
    a.requested.start === k.start &&
    a.benchmark === k.benchmark &&
    a.allowShort === k.allowShort &&
    a.tickers.length === k.tickers.length &&
    a.tickers.every((t, i) => t === k.tickers[i])
  );
}

export default function KeptFan({ kept: k, analysis: a }: { kept: Kept; analysis: Analysis }) {
  const [check, setCheck] = useState<KeptCheck | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const today = new Date().toISOString().slice(0, 10);
    void checkKept(k, today, globalThis.fetch, ctrl.signal).then((c) => {
      if (!ctrl.signal.aborted) setCheck(c);
    });
    return () => ctrl.abort();
  }, [k]);
  const gap = useMemo(() => {
    if (!sameWindow(a, k)) return null;
    const fan = k.seed === DEFAULT_SEED ? fanOf(a, k.horizon) : outcomes(a, k.horizon, { seed: k.seed });
    return fan ? keptGap(k, keptOf(a, fan, k.seed)) : null;
  }, [a, k]);
  const state: LoadState<Kept> = { status: "ready", value: k };
  const rows = check ? keptRows(k, check) : [];
  const numbers =
    rows.length && check?.status === "ready" ? (
      <Table title="Kept Fan Check" columns={COLUMNS} rows={rows} filename="kept_fan_check" span={tableSpan(k.asOf, check.date, "daily", "closes")} />
    ) : null;
  const how = (
    <>
      <p className="wfo-how">
        Kept for {k.tickers.join(", ")} against the {benchDisplay(k.benchmark)}, from the window {k.start} to {k.asOf},{" "}
        {k.horizon === 1 ? "one year" : `${k.horizon} years`} ahead. The fan is drawn from the figures the link carries, not
        recomputed, so it is the one seen on {k.asOf}. The real line is {usd(START)} invested at that day&rsquo;s close in
        the same weights, rebalanced daily, as simulated.
      </p>
      <p className="wfo-how">
        The real value is placed against the fan at the day it reached, between the months the link keeps, not at the
        horizon&rsquo;s end. Its percentile is read between the kept 10th, 25th, 50th, 75th and 90th, so it is
        approximate.
      </p>
      <p className="wfo-how">
        One fan landing inside its band proves little. The band holds eight paths in ten, so real prices should land
        outside it about one time in five.
      </p>
    </>
  );
  return (
    <Card title={keptTitle(k)} sub={keptSub(k, check)} note={keptGapNote(gap)} numbers={numbers} how={how}>
      <ChartFrame title={keptTitle(k)} state={state} height={HEIGHT} bare>
        {(v) => <KeptPlot k={v} check={check} />}
      </ChartFrame>
    </Card>
  );
}
