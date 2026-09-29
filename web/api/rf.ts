// GET /api/rf: the latest 3-month Treasury yield as an RfRate (src/types.ts), the app's
// fetch_rf_rate (portfolio_app.py 605-639). The work is in src/data/fred.ts.
//
// Answers:
// - 200 with { rate (decimal), date (the observation's ISO date), source: "FRED DGS3MO" }.
// - 502 with an ApiError, "upstream" (FRED unreachable, timed out or not 2xx) or "no-data" (no row
//   parsed). The app's caller turns a failed lookup into the 2.0% placeholder with the note "Could not
//   reach FRED — using the 2.0% placeholder. Edit it if you know today's rate." (707-713), and on
//   success notes the series and its date (716). The page does the same with RF_FALLBACK.
// - 400 bad-request for any other query. The two canonical urls are /api/rf and /api/rf?start=.
//
// GET /api/rf?start=YYYY-MM-DD: the same latest yield, plus every daily DGS3MO observation from that
// day on (an RfSeries, src/state/rfwindow.ts), so the page can score a window against the rate that
// prevailed across it. Still ONE request for ONE series, so FRED never answers with a ZIP. The start
// must be a real calendar day, not after today, and the only parameter; anything else is refused
// before FRED is asked. Cached like the latest yield: the series moves once a business day too.
import type { ApiError } from "../src/types.ts";
import { fetchRf, RF_CACHE_FAILED, RF_CACHE_OK } from "../src/data/fred.ts";
import { fetchRfSeries, isIsoDay } from "../src/state/rfwindow.ts";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url, "http://localhost").searchParams;
  const keys = [...params.keys()];
  const today = new Date().toISOString().slice(0, 10);
  if (keys.length) {
    const start = params.get("start");
    if (keys.length !== 1 || keys[0] !== "start" || !isIsoDay(start) || start > today) {
      const body: ApiError = { error: "bad-request", message: "This endpoint takes no parameters, or start=YYYY-MM-DD alone." };
      return Response.json(body, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const series = await fetchRfSeries(start);
    if (!series.ok) return Response.json(series.body, { status: series.status, headers: { "Cache-Control": RF_CACHE_FAILED } });
    return Response.json(series.value, { headers: { "Cache-Control": RF_CACHE_OK } });
  }
  const result = await fetchRf(today);
  if (!result.ok) return Response.json(result.body, { status: result.status, headers: { "Cache-Control": RF_CACHE_FAILED } });
  return Response.json(result.rate, { headers: { "Cache-Control": RF_CACHE_OK } });
}
