// Bakes the page's first screen: the cross-asset basket (VTI, AGG, GLD, VNQ, EFA against the
// S&P 500) exactly as frozen for the parity suite, so the page opens on the same data every
// check in test/ runs against. Run it with `npm run bake`; test/t-shell.mjs fails when the
// committed public/example-cross.json differs from a fresh bake by a single byte.
//
// Only INPUTS go in: prices as downloaded, the request that fetched them, the benchmark's label
// and the risk-free rate the oracle was run with. No oracle output, so the page computes every
// number it shows. Prices are copied, never rounded: JSON.parse then JSON.stringify returns each
// double's shortest round-trip form, which is the form the fixture was written in.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SOURCE = new URL("../test/fixtures/prices-cross.json", import.meta.url);
// Read for two INPUT fields only (rf, benchLabel), which test/oracle/dump_oracle.py fixes as
// constants (RF, BENCH_LABEL); every computed field in that file is left behind.
export const RUN = new URL("../test/fixtures/oracle-cross.json", import.meta.url);
export const OUT = new URL("../public/example-cross.json", import.meta.url);
export const PUBLIC_PATH = "/example-cross.json";

// prices is column-major like the engine's Frame.values (src/lib/clean.ts), one array per entry of
// `columns`, with null where the download had no bar (JSON has no NaN; the page maps null to NaN).
export function bake(px, run) {
  return {
    set: px.set,
    tickers: px.tickers,
    benchmark: px.benchmark,
    benchLabel: run.benchLabel,
    rf: run.rf,
    start: px.start,
    end: px.end,
    pulledAt: px.pulledAt,
    missing: px.missing,
    columns: px.columns,
    dates: px.rows.map((r) => r[0]),
    prices: px.columns.map((_, j) => px.rows.map((r) => r[j + 1])),
  };
}

export function bakeText(px = read(SOURCE), run = read(RUN)) {
  return JSON.stringify(bake(px, run)) + "\n";
}

function read(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const text = bakeText();
  writeFileSync(OUT, text);
  console.log(`wrote ${fileURLToPath(OUT)} (${Buffer.byteLength(text)} bytes)`);
}
