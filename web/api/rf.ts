// GET /api/rf: the latest 3-month Treasury yield as an RfRate (src/types.ts), the app's
// fetch_rf_rate (portfolio_app.py 605-639). The work is in src/data/fred.ts.
//
// Answers:
// - 200 with { rate (decimal), date (the observation's ISO date), source: "FRED DGS3MO" }.
// - 502 with an ApiError, "upstream" (FRED unreachable, timed out or not 2xx) or "no-data" (no row
//   parsed). The app's caller turns a failed lookup into the 2.0% placeholder with the note "Could not
//   reach FRED — using the 2.0% placeholder. Edit it if you know today's rate." (707-713), and on
//   success notes the series and its date (716). The page does the same with RF_FALLBACK.
// - 400 bad-request for any query at all: the only canonical url is /api/rf.
import type { ApiError } from "../src/types.ts";
import { fetchRf, RF_CACHE_FAILED, RF_CACHE_OK } from "../src/data/fred.ts";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url, "http://localhost").searchParams;
  if ([...params.keys()].length) {
    const body: ApiError = { error: "bad-request", message: "This endpoint takes no parameters." };
    return Response.json(body, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const result = await fetchRf(new Date().toISOString().slice(0, 10));
  if (!result.ok) return Response.json(result.body, { status: result.status, headers: { "Cache-Control": RF_CACHE_FAILED } });
  return Response.json(result.rate, { headers: { "Cache-Control": RF_CACHE_OK } });
}
