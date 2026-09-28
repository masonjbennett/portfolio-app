// Direct labels: name a point or a line's end on the chart instead of sending the eye to a legend.
import { tokens } from "../styles/tokens.ts";
import { labelFill } from "./contrast.ts";

export type LabelSide = "right" | "left" | "top" | "bottom";

// Label props for a Recharts <ReferenceDot label={...}> or <ReferenceLine label={...}>: the name in
// Space Grotesk, in the series' own colour where that reads on paper (labelFill: bronze is set in ink2),
// beside the point. Put it on a <ReferenceDot r={0}> at a
// line's last point to label the line's end.
export function pointLabel(text: string, color: string, side: LabelSide = "right") {
  return {
    value: text,
    position: side,
    offset: 8,
    fill: labelFill(color),
    fontFamily: tokens.font.sans,
    fontSize: 12,
  } as const;
}

// Moves labels apart so no two sit closer than `gap`, disturbing them as little as possible (least
// squares) and never changing their order. Positions are in any one unit: pixels, or data units with
// the gap converted. Each run of labels that would collide is packed at `gap` and centred on where
// its labels want to be; runs merge while they still overlap (pool-adjacent-violators).
export function spreadLabels(want: readonly number[], gap: number): number[] {
  const order = want.map((_, i) => i).sort((a, b) => want[a] - want[b] || a - b);
  // A run of n labels whose first sits at `top`; sum = Σ (want_j − j·gap), so top = sum / n.
  const runs: { top: number; n: number; sum: number }[] = [];
  for (const i of order) {
    let run = { top: want[i], n: 1, sum: want[i] };
    while (runs.length) {
      const prev = runs[runs.length - 1];
      if (prev.top + prev.n * gap <= run.top) break;
      const sum = prev.sum + run.sum - run.n * prev.n * gap;
      const n = prev.n + run.n;
      run = { top: sum / n, n, sum };
      runs.pop();
    }
    runs.push(run);
  }
  const out = new Array<number>(want.length);
  let k = 0;
  for (const run of runs) for (let j = 0; j < run.n; j++) out[order[k++]] = run.top + j * gap;
  return out;
}
