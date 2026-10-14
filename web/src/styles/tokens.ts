// The paper-and-ink tokens as a typed object, for code that cannot read a CSS custom property:
// SVG presentation attributes, chart libraries, matchMedia. Every entry is `--<group>-<key>` in
// src/styles/tokens.css, with the identical string value; test/t-shell.mjs fails the run when the
// two files disagree in either direction.
export const tokens = {
  color: {
    paper: "#faf3ea",
    ink: "#262421",
    ink2: "#33302c",
    teal: "#0d6d56",
    navy: "#1f5a9e",
    plum: "#6d549e",
    claret: "#990f3d",
    bronze: "#b0741e",
    red: "#b2342b",
    hairline: "#ddcfb8",
    hairline2: "#e9ddc9",
    up: "#0d6d56",
    down: "#b2342b",
    // The funds' ink ramp, darkest first: assets are drawn in warm greys so that colour means a mix
    // (GMV teal, tangency bronze, equal weight plum, custom claret) and never a fund as well. Each
    // clears 3:1 on paper, what WCAG asks of a line a reader needs; fund4 and fund5 label in ink2.
    fund1: "#3d3832",
    fund2: "#5a534a",
    fund3: "#756d61",
    fund4: "#877e71",
    fund5: "#94897a",
    // A card: flat paper a shade lighter than the page, inside one hairline (the site's card).
    card: "#fffdf9",
    cardline: "#e3d5bf",
  },
  font: {
    serif: '"Instrument Serif", Georgia, "Times New Roman", serif',
    sans: '"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", ui-monospace, Consolas, monospace',
  },
  space: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "24px",
    6: "32px",
    7: "48px",
    8: "64px",
  },
  // The type scale. 6 is the page's one serif question, 5 a chapter's serif finding (and the question
  // on a phone), 3 body and a card's title, 2 secondary text, 1 the smallest.
  type: {
    1: "12px",
    2: "14px",
    3: "16px",
    4: "20px",
    5: "30px",
    6: "44px",
  },
  // The gap between sections, which replaces the hairline dividers; a phone's is tighter.
  gap: {
    section: "40px",
    phone: "28px",
  },
  radius: {
    card: "4px",
  },
  line: {
    hair: "1px",
    bar: "3px",
  },
  breakpoint: {
    phone: "760px",
  },
} as const;

export type Tokens = typeof tokens;

// The media query the 760px breakpoint means, for matchMedia.
export const PHONE_QUERY = `(max-width: ${tokens.breakpoint.phone})`;
