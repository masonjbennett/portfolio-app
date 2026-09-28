// A real Analysis for component suites, through the shipping analyze(): the baked first-screen
// example (column-major, source "example") or a price fixture (row-major, source "live"). Both are
// the oracle's inputs, at the rate the oracle ran with. Throws when analyze() refuses the payload.
import { json } from "./_assert.mjs";
import { analyze } from "../src/state/analyze.ts";
import { DEFAULT_SETTINGS } from "../src/state/defaults.ts";

// The oracle's rate: dump_oracle.py's RF constant (test/t-shell.mjs holds the example to it).
export const ORACLE_RF = 0.0389;

export function examplePayload() {
  return json(new URL("../public/example-cross.json", import.meta.url));
}

export function fixturePayload(name = "cross") {
  return json(new URL(`./fixtures/prices-${name}.json`, import.meta.url));
}

// Settings that agree with what a payload requested.
export function settingsFor(p, over = {}) {
  return { ...DEFAULT_SETTINGS, tickers: p.tickers, start: p.start, end: p.end, benchmark: p.benchmark, ...over };
}

function run(p, source, { allowShort = false, rf = ORACLE_RF } = {}) {
  const a = analyze(p, settingsFor(p, { allowShort }), { rate: rf, source });
  if (!a.ok) throw new Error(`analyze refused the payload: ${a.error}: ${a.message}`);
  return a;
}

export function exampleAnalysis(opts) {
  return run(examplePayload(), "example", opts);
}

export function fixtureAnalysis(name = "cross", opts) {
  return run(fixturePayload(name), "manual", opts);
}

// Everything a tab receives, with no-op setters unless a suite passes its own.
export function tabProps(analysis, over = {}) {
  const requested = {
    tickers: analysis.tickers,
    start: analysis.requested.start,
    end: analysis.requested.end,
    benchmark: analysis.benchmark,
  };
  return {
    analysis,
    settings: settingsFor(requested, { allowShort: analysis.allowShort }),
    level: "plain",
    weights: {},
    setWeights() {},
    requestSettings() {},
    ...over,
  };
}
