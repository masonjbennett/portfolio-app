// A price payload, in either layout, to the engine's Frame (src/lib/clean.ts), which cleanPrices
// takes. The live endpoint and the test fixtures are row-major; the baked first-screen example is
// column-major. Both carry null where a ticker had no bar that day, and the Frame carries NaN.
import type { Frame } from "../lib/clean.ts";
import type { PriceColumns, PricePayload } from "../types.ts";

// The baked example is the only column-major payload.
export function isExample(p: PricePayload): p is PriceColumns {
  return "prices" in p;
}

export function toFrame(p: PricePayload): Frame {
  if (isExample(p)) {
    return { dates: p.dates, columns: p.columns, values: p.prices.map((c) => c.map((v) => v ?? NaN)) };
  }
  return {
    dates: p.rows.map((r) => String(r[0])),
    columns: p.columns,
    values: p.columns.map((_, j) =>
      p.rows.map((r) => {
        const v = r[j + 1];
        return typeof v === "number" ? v : NaN;
      }),
    ),
  };
}
