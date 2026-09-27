// Loads a frozen price fixture and the oracle's numbers for it (see test/oracle/).
import { json } from "./_assert.mjs";
import { cleanPrices, computeReturns, column } from "../src/lib/clean.ts";

export const SETS = ["megacap", "sectors", "cross", "cross_vti", "dirty"];

export function load(name) {
  const px = json(new URL(`./fixtures/prices-${name}.json`, import.meta.url));
  const oracle = json(new URL(`./fixtures/oracle-${name}.json`, import.meta.url));
  const raw = {
    dates: px.rows.map((r) => r[0]),
    columns: px.columns,
    values: px.columns.map((_, j) => px.rows.map((r) => (r[j + 1] === null ? NaN : r[j + 1]))),
  };
  return { px, oracle, raw };
}

// The app's cleaning, reproduced (keepBenchmarkTicker: false), then its derived state (1156-1169).
export function derive(name, opts = { keepBenchmarkTicker: false }) {
  const { px, oracle, raw } = load(name);
  const cleaned = cleanPrices(raw, px.missing, px.tickers, px.benchmark, opts);
  if (!cleaned.ok) return { px, oracle, raw, cleaned };
  const returns = computeReturns(cleaned.frame);
  const cols = cleaned.tickers.map((t) => column(returns, t));
  const bench = column(returns, px.benchmark);
  return { px, oracle, raw, cleaned, returns, cols, bench };
}
