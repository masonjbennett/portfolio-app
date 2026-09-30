// Where the Custom tab puts its weights and its frontier. On a desktop wide enough for both they sit
// side by side, the sliders on the left and the frontier on the right, so a slider moves the custom
// mix's dot where the reader can see it. Anything narrower, a phone included, keeps the stacked order.
//
// The arrangement itself is CSS (Custom.css, under a min-width media query); this module holds the one
// number that query uses, so script code can ask the same question, and the frontier's height while it
// sits beside the weights. A media query cannot read a constant, so the stylesheet writes the number
// out and test/t-custom-layout.mjs holds the two equal.
import { useSyncExternalStore } from "react";

/**
 * Viewport width, in px, from which the weights and the frontier sit side by side. At this width the
 * main column (the page's 1280px cap, less the rail and gutters) is wide enough for a slider row in one
 * column and a readable frontier in the other.
 */
export const SIDE_BY_SIDE_MIN_PX = 1200;

/** The media query SIDE_BY_SIDE_MIN_PX means, for matchMedia. */
export const SIDE_BY_SIDE_QUERY = `(min-width: ${SIDE_BY_SIDE_MIN_PX}px)`;

/**
 * The frontier's plot height, in px, beside the weights. Shorter than the chart's stacked default so
 * that, with the tab scrolled to the weights, the first slider row and the whole plot are both on a
 * 1280 x 800 screen, the smaller of the two common laptop sizes, with room for a caption that wraps
 * to more lines in the narrower column.
 */
export const SIDE_FRONTIER_HEIGHT = 420;

function query(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(SIDE_BY_SIDE_QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const mq = query();
  mq?.addEventListener?.("change", onChange);
  return () => mq?.removeEventListener?.("change", onChange);
}

/** Whether the weights and the frontier sit side by side, live. Server rendering answers no: stacked. */
export function useSideBySide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  );
}
