// The Overview's growth chart: what the starting amount became in the three mixes and the benchmark, each
// line named at its end by its plain name. The shared Wealth chart's drawing (src/charts/Wealth.tsx), in
// its own chunk so Recharts stays out of the page's first one (src/overview/Overview.tsx loads it).
import { useMemo } from "react";
import { ChartNote } from "../components/ChartFrame.tsx";
import { wealthData, wealthPlot, WealthLines, type WealthData } from "../charts/Wealth.tsx";
import type { Analysis, LoadState } from "../types.ts";
import { MIX } from "./model.ts";

// The lines in the order the eye should meet them, under their plain names; the benchmark keeps its own.
const NAME = { tangency: MIX.tangency.short, ew: MIX.ew.short, gmv: MIX.gmv.short } as const;
const ORDER = { tangency: 0, ew: 1, gmv: 2, custom: 3, bench: 4 } as const;

export function overviewWealth(a: Analysis): WealthData {
  const d = wealthData(a);
  const series = d.series
    .map((s) => (s.role === "tangency" || s.role === "ew" || s.role === "gmv" ? { ...s, label: NAME[s.role] } : s))
    .sort((x, y) => ORDER[x.role] - ORDER[y.role]);
  return { ...d, series };
}

export default function OverviewWealth({ a, amount, height }: { a: Analysis; amount: number; height: number }) {
  const plot = useMemo(() => wealthPlot({ status: "ready", value: overviewWealth(a) } as LoadState<WealthData>, amount), [a, amount]);
  if (plot.status === "ready") return <WealthLines plot={plot.value} height={height} />;
  if (plot.status === "error") {
    return (
      <ChartNote kind="error" height={height}>
        Chart not drawn: {plot.name} failed. {plot.message}
      </ChartNote>
    );
  }
  return (
    <ChartNote kind={plot.status} height={height}>
      {plot.status === "empty" ? plot.reason : "Loading"}
    </ChartNote>
  );
}
