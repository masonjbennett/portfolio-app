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

// ---- leaving off what cannot be placed ----------------------------------------------------------
//
// A chart places its names with its own packer (spreadLabels below, the frontier's placeLabels, the
// grouped bars' label group). Where the packer still cannot find a name a clear spot, the name is left
// off rather than drawn over something, and the chart says so in one line under it (cullNote). What a
// name marked stays readable: the chart's hover box, on a tap as on a pointer, and from the keyboard.

/** A box in px: across from `lo` to `hi`, down the page from `top` to `bot`. */
export interface Rect {
  lo: number;
  hi: number;
  top: number;
  bot: number;
}

/** Whether two boxes share any area (boxes that only touch do not). */
export const meets = (a: Rect, b: Rect) => a.lo < b.hi && b.lo < a.hi && a.top < b.bot && b.top < a.bot;

/** Whether `a` lies wholly inside `b`. */
const within = (a: Rect, b: Rect) => a.lo >= b.lo && a.hi <= b.hi && a.top >= b.top && a.bot <= b.bot;

/**
 * Which spot each label is drawn at, or -1 for a label left off. `spots[i]` is label i's candidate
 * boxes, its packer's choice first. A label marked by `keep` is always drawn, at its first spot, and is
 * taken before the rest; every other label is taken in order and drawn at its first spot that meets no
 * label drawn before it and no mark (a bar, a marker, a reference line's name) and, given `bounds`,
 * stays inside them. A label is left off only when every one of its spots fails. `marks` may be a
 * function of the label, for a label that may sit on its own mark (a value inside its own bar).
 */
export function cullLabels(
  spots: readonly (readonly Rect[])[],
  marks: readonly Rect[] | ((i: number) => readonly Rect[]) = [],
  bounds?: Rect,
  keep: (i: number) => boolean = () => false,
): number[] {
  const at = spots.map(() => -1);
  const drawn: Rect[] = [];
  const marksOf = typeof marks === "function" ? marks : () => marks;
  spots.forEach((s, i) => {
    if (keep(i) && s.length) {
      at[i] = 0;
      drawn.push(s[0]);
    }
  });
  spots.forEach((s, i) => {
    if (keep(i)) return;
    const own = marksOf(i);
    const k = s.findIndex((r) => (!bounds || within(r, bounds)) && !own.some((m) => meets(m, r)) && !drawn.some((d) => meets(d, r)));
    if (k >= 0) {
      at[i] = k;
      drawn.push(s[k]);
    }
  });
  return at;
}

/**
 * For a packer that places every name and flags the ones it could not set clear (`clear === false`):
 * which names to leave off. `place(off)` places every name but those in `off`, their marks still in
 * the way. While a name that `may` be left off is placed blocked, the last such name is left off and
 * the rest placed again; then each name left off is tried back, in order, and kept when it and every
 * other name it may leave off still place clear, and no name it may not leave off is newly blocked.
 */
export function cullBlocked<L extends { key: string; clear?: boolean }>(
  place: (off: ReadonlySet<string>) => L[],
  may: (key: string) => boolean,
): { labels: L[]; off: string[] } {
  const off = new Set<string>();
  const blocked = (ls: readonly L[]) => ls.filter((l) => l.clear === false && may(l.key));
  const stuck = (ls: readonly L[]) => ls.filter((l) => l.clear === false && !may(l.key)).length;
  let labels = place(off);
  for (let b = blocked(labels); b.length; b = blocked(labels)) {
    off.add(b[b.length - 1].key);
    labels = place(off);
  }
  for (const key of [...off]) {
    const without = new Set(off);
    without.delete(key);
    const trial = place(without);
    if (!blocked(trial).length && stuck(trial) <= stuck(labels)) {
      off.delete(key);
      labels = trial;
    }
  }
  return { labels, off: [...off] };
}

const COUNT = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/**
 * The one line under a chart that left names off, or null when it left none: how many, and how to read
 * them. `what` names what was left off and `how` says how to read it, each as [one, many]: ["value",
 * "values"], ["hover or tap its bar to read it", "hover or tap a bar to read one"].
 */
export function cullNote(count: number, what: readonly [string, string], how: readonly [string, string]): string | null {
  if (!(count > 0)) return null;
  const n = Number.isInteger(count) && count < COUNT.length ? COUNT[count] : String(count);
  return count === 1
    ? `${n} ${what[0]} that would overlap is left off; ${how[0]}.`
    : `${n} ${what[1]} that would overlap are left off; ${how[1]}.`;
}

/** The note's face: the sans at 12px in ink2, as the frontier's key line under its chart. */
export const CULL_STYLE = {
  margin: `${tokens.space[2]} 0 0`,
  color: tokens.color.ink2,
  fontFamily: tokens.font.sans,
  fontSize: 12,
  lineHeight: "20px",
} as const;

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
