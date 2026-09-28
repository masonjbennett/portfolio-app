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
