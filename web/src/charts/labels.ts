// Direct labels: name a point or a line's end on the chart instead of sending the eye to a legend.
import { tokens } from "../styles/tokens.ts";
import { labelFill } from "./contrast.ts";

export type LabelSide = "right" | "left" | "top" | "bottom";

// Space Grotesk 400 at 12px (the self-hosted face): each printable ASCII character's advance in tenths
// of a pixel, rounded up, measured in Chromium on Sep 28 2026. Summed, it runs 0-4% over the drawn
// width, since kerning only ever tightens. The old estimate, 7px a character, ran 19% short on "GMV"
// and 30% long on "Capital allocation line".
const ADVANCE_12 = [
  31, 31, 51, 76, 74, 93, 73, 31, 46, 46, 63, 75, 31, 55, 31, 45, 77, 51, 73, 73, 75, 72, 74, 68, 75, 74, 31, 31, 75, 75, 75, 70,
  124, 76, 80, 78, 80, 68, 65, 80, 79, 30, 72, 74, 66, 104, 80, 81, 73, 81, 76, 74, 71, 80, 75, 105, 77, 74, 70, 41, 45, 41, 75, 75,
  34, 69, 78, 72, 78, 72, 54, 78, 74, 30, 30, 65, 30, 104, 74, 75, 78, 78, 46, 64, 56, 74, 65, 97, 72, 74, 63, 52, 29, 52, 75,
];
/** A character outside printable ASCII counts as one of the face's widest capitals. */
const ADVANCE_OTHER = 81;

/** The width of `text` set in Space Grotesk at `fontSize` px, from the measured advances above. */
export function textWidth(text: string, fontSize = 12): number {
  let tenths = 0;
  for (const ch of text) {
    const i = ch.codePointAt(0)! - 32;
    tenths += i >= 0 && i < ADVANCE_12.length ? ADVANCE_12[i] : ADVANCE_OTHER;
  }
  return (tenths / 10) * (fontSize / 12);
}

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
