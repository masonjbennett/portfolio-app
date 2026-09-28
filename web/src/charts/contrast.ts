// The colour a direct label's TEXT is drawn in. A chart names each point, bar and line in the series'
// own colour instead of a legend, so that name is the only thing identifying it, and it is set at
// 11-12px: WCAG AA asks 4.5:1 of text that size. Against paper, navy, teal, plum, claret and red all
// clear 5.5:1; bronze (the Tangency role and the second asset) measures 3.6:1. So a label whose series
// colour would not read on paper is set in ink2 (11.9:1), and the series keeps its colour on the
// marker, bar, line and leader, which are not text.
import { tokens } from "../styles/tokens.ts";

/** WCAG AA's minimum contrast for text under 18px (14px bold). */
export const TEXT_AA = 4.5;

// WCAG 2 relative luminance of a #rrggbb colour: each sRGB channel linearised, then weighted.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two #rrggbb colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The fill for label text naming a series drawn in `color`: that colour where it reads on paper, ink2 where it does not. */
export function labelFill(color: string): string {
  return contrastRatio(color, tokens.color.paper) >= TEXT_AA ? color : tokens.color.ink2;
}
