// GET /api/prices?tickers=A,B,C&benchmark=^GSPC&start=YYYY-MM-DD&end=YYYY-MM-DD
// Daily adjusted closes for the tickers and the benchmark, from Yahoo's v8 chart endpoint, one
// request per symbol in parallel (download_data, portfolio_app.py 861-886). The work is in
// src/data/prices.ts; this is the HTTP wrapper.
//
// Answers:
// - 200 with a PriceRows payload (src/types.ts). Symbols with no usable series are listed in
//   `missing`, never dropped silently; the page's cleaning decides what that means (1026-1048).
// - 400 bad-request for any query that is not the canonical shape, before any upstream request.
//   Build the url with pricesUrl() in src/data/prices.ts.
// - When EVERY symbol failed: 503 rate-limited (Yahoo said too many), 502 upstream (no answer or an
//   error), or 404 no-data (Yahoo answered, with too little for every symbol). The body is an
//   ApiError whose message is a plain sentence the page can show.
import type { ApiError } from "../src/types.ts";
import { CACHE_FAILED, fetchPrices, parsePricesQuery, pricesCache } from "../src/data/prices.ts";

export async function GET(request: Request): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10);
  const parsed = parsePricesQuery(new URL(request.url, "http://localhost").searchParams, today);
  if (!parsed.ok) {
    const body: ApiError = { error: "bad-request", message: parsed.message };
    return Response.json(body, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const result = await fetchPrices(parsed.query);
  if (!result.ok) return Response.json(result.body, { status: result.status, headers: { "Cache-Control": CACHE_FAILED } });
  return Response.json(result.payload, {
    headers: { "Cache-Control": pricesCache(result.healthy, parsed.query.end, today) },
  });
}
