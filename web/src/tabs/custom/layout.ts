// The one number the Build lead's arrangement uses. On a desktop wide enough for both, the frontier card and
// the Your mix panel sit side by side, so a slider moves the mix's point where the reader can see it; anything
// narrower, a phone included, stacks the panel under the chart.
//
// The arrangement itself is CSS (../optimization/Optimization.css, under a min-width media query). A media query
// cannot read a constant, so the stylesheet writes the number out and test/t-build-layout.mjs holds the two equal.

/**
 * Viewport width, in px, from which the frontier and the panel sit side by side: the main column is then wide
 * enough for a readable frontier in three fifths and a slider row and three figures a row in the other two.
 */
export const SIDE_BY_SIDE_MIN_PX = 1200;

/** The media query SIDE_BY_SIDE_MIN_PX means, for matchMedia. */
export const SIDE_BY_SIDE_QUERY = `(min-width: ${SIDE_BY_SIDE_MIN_PX}px)`;
