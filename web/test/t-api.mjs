// Both endpoints, with globalThis.fetch stubbed so nothing leaves the machine. /api/prices is fed
// Yahoo chart bodies built from the frozen fixtures, so its answer can be held to the fixture the
// app itself downloaded: same columns, same missing, same outer join, and toFrame of it the same
// Frame the engine suites build. /api/rf is fed FRED csv text.
import { check, done } from "./_assert.mjs";
import { load } from "./_fixtures.mjs";
import { GET as pricesGET } from "../api/prices.ts";
import { GET as rfGET } from "../api/rf.ts";
import {
  CACHE_FAILED, CACHE_PAST, CACHE_RECENT, fetchPrices, joinSeries, parseChart, parsePricesQuery, pricesUrl,
} from "../src/data/prices.ts";
import { RF_CACHE_FAILED, RF_CACHE_OK, fetchRf, parseRfCsv } from "../src/data/fred.ts";
import { toFrame } from "../src/data/payload.ts";

const DAY = 86400000;
const TODAY = new Date().toISOString().slice(0, 10);
const plus = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- stubs ------------------------------------------------------------------------------------------

// Yahoo's body for one symbol: bars stamped at the 09:30 New York open, adjclose the given values,
// and quote.close deliberately different, so reading the wrong array shows.
function chart(dates, adj, { gmtoffset = -14400, stamp = "T13:30:00Z", withAdj = true } = {}) {
  const indicators = { quote: [{ close: adj.map((v) => (v === null ? null : v * 2)) }] };
  if (withAdj) indicators.adjclose = [{ adjclose: adj }];
  return { chart: { result: [{ meta: { gmtoffset }, timestamp: dates.map((d) => Date.parse(d + stamp) / 1000), indicators }], error: null } };
}
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const status = (n) => new Response("{}", { status: n });
const days = (n, from = "2024-01-01") => Array.from({ length: n }, (_, i) => plus(from, i));
const bars = (n) => chart(days(n), days(n).map((_, i) => 100 + i));

function columnOf(px, sym) {
  const j = px.columns.indexOf(sym);
  const rows = px.rows.filter((r) => r[j + 1] !== null);
  return [rows.map((r) => r[0]), rows.map((r) => r[j + 1])];
}

let calls = [];
const symOf = (url) => decodeURIComponent(url.match(/chart\/([^?]+)/)?.[1] ?? "");
function stub(answer) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return answer(symOf(String(url)), String(url), init);
  };
}
// Every symbol the fixture has, answered from the fixture; anything else is Yahoo's 404.
const fromFixture = (px) => (sym) => (px.columns.includes(sym) ? ok(chart(...columnOf(px, sym))) : status(404));
// A request that never answers unless its abort signal fires; after 1.5 s it answers with data, so
// a fetch sent without a timeout shows up as a symbol that was NOT missing.
const hang = (init) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(ok(bars(40))), 1500);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(init.signal.reason);
    });
  });

const req = (params) => new Request(`http://localhost/api/prices?${params}`);
const query = (px, over = {}) =>
  new URLSearchParams({ tickers: px.tickers.join(","), benchmark: px.benchmark, start: px.start, end: px.end, ...over });

// A body that is not a payload (a mutant, a 400) fails the check instead of crashing the suite.
const frameOk = (body, raw) => Array.isArray(body?.rows) && sameFrame(toFrame(body), raw);

function sameFrame(a, b) {
  return (
    same(a.dates, b.dates) &&
    same(a.columns, b.columns) &&
    a.values.length === b.values.length &&
    a.values.every((c, j) => c.length === b.values[j].length && c.every((v, i) => Object.is(v, b.values[j][i])))
  );
}

// ---- (a) the happy path: the cross fixture, rebuilt from per-symbol answers ------------------------
{
  const { px, raw } = load("cross");
  stub(fromFixture(px));
  const res = await pricesGET(req(String(query(px)).replaceAll("%2C", ",")));
  const body = await res.json();
  check(res.status === 200, "prices: a canonical query answers 200", String(res.status));
  check(
    same(Object.keys(body).sort(), ["benchmark", "columns", "end", "missing", "pulledAt", "rows", "start", "tickers"]),
    "prices: the body carries exactly the PriceRows fields", Object.keys(body).join(","));
  check(calls.length === 6, "prices: one upstream request per symbol, the benchmark included", String(calls.length));
  check(same(body.columns, px.columns) && same(body.missing, []), "prices: columns are the tickers in order, then the benchmark", String(body.columns));
  check(same(body.rows, px.rows), "prices: the outer join of the per-symbol series reproduces the app's download row for row");
  check(frameOk(body, raw), "prices: toFrame of the answer equals the fixture conversion in _fixtures.mjs");
  const gspc = calls.find((c) => symOf(c.url) === "^GSPC");
  check(
    gspc?.url === `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=1546300800&period2=${Date.parse(px.end + "T00:00:00Z") / 1000}&interval=1d&events=div%2Csplits`,
    "prices: the upstream url is the v8 chart, start at UTC midnight, end exclusive, daily, with events", gspc?.url);
  check(typeof gspc?.init?.headers?.["User-Agent"] === "string", "prices: a User-Agent is sent");
  check(res.headers.get("Cache-Control") === CACHE_PAST, "prices: a healthy range wholly in the past is cached a day", res.headers.get("Cache-Control"));
  check(body.rows[0][1] === px.rows[0][1], "prices: the adjusted close (adjclose) is read, not quote.close", `${body.rows[0][1]}`);
}

// ---- (b) the dirty fixture: one bad symbol reported, the rest joined with their gaps --------------
{
  const { px, raw } = load("dirty");
  stub(fromFixture(px));
  const res = await pricesGET(req(query(px)));
  const body = await res.json();
  check(res.status === 200 && same(body.missing, ["ZZZQX"]), "prices: a symbol Yahoo does not know is reported in missing", JSON.stringify(body.missing));
  check(same(body.rows, px.rows) && same(body.columns, px.columns), "prices: late listings join with nulls exactly as the app's download has them");
  check(frameOk(body, raw), "prices: toFrame of the dirty answer equals the fixture conversion");
  check(calls.length === 8, "prices: a 404 is Yahoo's answer and is not retried", String(calls.length));
  check(res.headers.get("Cache-Control") === CACHE_FAILED, "prices: an answer with a missing symbol is cached one minute, never stale", res.headers.get("Cache-Control"));
}

// ---- (c) a benchmark that is also a ticker is fetched once and keeps its ticker position ----------
{
  const { px } = load("cross_vti");
  stub(fromFixture(px));
  const body = await (await pricesGET(req(query(px)))).json();
  check(calls.length === 5 && same(body.columns, px.columns), "prices: benchmark VTI inside the tickers is requested once (864)", `${calls.length} ${body.columns}`);
}

// ---- (d) parsing one symbol ----------------------------------------------------------------------
{
  const noAdj = parseChart(chart(days(40), days(40).map(() => 1), { withAdj: false }));
  check(noAdj === null, "prices: a body without adjclose fails rather than falling back to quote.close");
  const syd = parseChart(chart(["2026-01-04"], [5], { gmtoffset: 36000, stamp: "T23:00:00Z" }));
  check(same(syd?.dates, ["2026-01-05"]), "prices: a stamp is dated in the exchange's zone (gmtoffset)", JSON.stringify(syd?.dates));
  const gaps = parseChart({ chart: { result: [{ meta: {}, timestamp: [1, 2, 3].map((d) => Date.parse(`2026-01-0${d}T14:30:00Z`) / 1000), indicators: { adjclose: [{ adjclose: [1, NaN, 3] }] } }] } });
  check(same(gaps?.dates, ["2026-01-01", "2026-01-03"]), "prices: a non-finite close is dropped, as dropna() does", JSON.stringify(gaps?.dates));
  const twice = parseChart(chart(["2026-01-02", "2026-01-02"], [1, 2]));
  check(twice?.values.length === 1 && twice.values[0] === 2, "prices: a date that appears twice keeps its last value", JSON.stringify(twice?.values));
  const rows = joinSeries([{ dates: ["2026-01-03", "2026-01-04"], values: [3, 4] }, { dates: ["2026-01-01", "2026-01-02", "2026-01-03"], values: [7, 8, 9] }]);
  check(same(rows, [["2026-01-01", null, 7], ["2026-01-02", null, 8], ["2026-01-03", 3, 9], ["2026-01-04", 4, null]]),
    "prices: the join is the union of dates, ascending, null where a column has no bar", JSON.stringify(rows));
}

// ---- (e) the 30-day floor, the retry, the timeout: fetchPrices with its own fetch ----------------
{
  const q = { tickers: ["AAA", "BBB"], benchmark: "^GSPC", start: "2024-01-01", end: "2024-03-01" };
  const n = { AAA: 29, BBB: 30, "^GSPC": 40 };
  const short = await fetchPrices(q, { fetch: async (u) => ok(bars(n[symOf(String(u))])), retryDelayMs: 0 });
  check(short.ok && same(short.payload.missing, ["AAA"]) && same(short.payload.columns, ["BBB", "^GSPC"]),
    "prices: 29 bars count as missing and 30 are kept (MIN_TRADING_DAYS, 812/856)", JSON.stringify(short.ok && short.payload.missing));

  const seen = {};
  const flaky = await fetchPrices(q, {
    retryDelayMs: 0,
    fetch: async (u) => {
      const s = symOf(String(u));
      seen[s] = (seen[s] ?? 0) + 1;
      if (seen[s] === 1 && s === "AAA") return status(503);
      if (seen[s] === 1 && s === "BBB") return status(429);
      return ok(bars(40));
    },
  });
  check(flaky.ok && same(flaky.payload.missing, []) && seen.AAA === 2 && seen.BBB === 2 && seen["^GSPC"] === 1,
    "prices: a 503 or a 429 is retried once and the recovered symbols are kept", JSON.stringify(seen));

  const t0 = Date.now();
  const slow = await fetchPrices(q, { timeoutMs: 30, retryDelayMs: 0, fetch: async (u, init) => (symOf(String(u)) === "AAA" ? hang(init) : ok(bars(40))) });
  check(slow.ok && same(slow.payload.missing, ["AAA"]) && Date.now() - t0 < 1000, "prices: a request past its timeout is abandoned and reported missing",
    `${JSON.stringify(slow.ok && slow.payload.missing)} ${Date.now() - t0} ms`);
}

// ---- (f) every symbol failed: a named error, never a 200 --------------------------------------------
{
  const base = new URLSearchParams({ tickers: "AAA,BBB", benchmark: "^GSPC", start: "2024-01-01", end: "2024-06-01" });
  for (const [answer, code, id, label] of [
    [() => status(429), 503, "rate-limited", "every symbol refused as too many"],
    [() => status(500), 502, "upstream", "every symbol an upstream error"],
    [() => status(404), 404, "no-data", "every symbol unknown to Yahoo"],
  ]) {
    stub(answer);
    const res = await pricesGET(req(base));
    const body = await res.json();
    check(res.status === code && body.error === id && typeof body.message === "string",
      `prices: ${label} answers ${code} ${id}`, `${res.status} ${JSON.stringify(body)}`);
    check(res.headers.get("Cache-Control") === CACHE_FAILED, `prices: ${label} is cached one minute, never stale`, res.headers.get("Cache-Control"));
  }
}

// ---- (g) the canonical query: anything else is 400 before any upstream request ----------------------
{
  const { px } = load("cross");
  const eleven = "AAPL,MSFT,GOOGL,AMZN,NVDA,META,TSLA,JPM,KO,PG,PEP";
  const twice = query(px);
  twice.append("tickers", "VTI");
  const bad = [
    ["an unknown parameter", query(px, { x: "1" })],
    ["a missing end", new URLSearchParams({ tickers: "VTI,AGG,GLD", benchmark: "^GSPC", start: "2019-01-01" })],
    ["tickers given twice", twice],
    ["an empty tickers value", query(px, { tickers: "" })],
    ["a lower-case ticker", query(px, { tickers: "vti,AGG,GLD" })],
    ["a share-class symbol", query(px, { tickers: "BRK-B,AGG,GLD" })],
    ["a six-letter symbol", query(px, { tickers: "ABCDEF,AGG,GLD" })],
    ["an empty list entry", query(px, { tickers: "VTI,,GLD" })],
    ["a repeated ticker", query(px, { tickers: "VTI,AGG,VTI" })],
    ["eleven tickers", query(px, { tickers: eleven })],
    ["a benchmark outside the app's six", query(px, { benchmark: "AAPL" })],
    ["a date not in YYYY-MM-DD", query(px, { start: "2019-1-1" })],
    ["a date that does not exist", query(px, { start: "2026-02-31" })],
    ["start equal to end", query(px, { start: "2024-05-01", end: "2024-05-01" })],
    ["start after end", query(px, { start: "2024-05-02", end: "2024-05-01" })],
    ["an end two days ahead", query(px, { end: plus(TODAY, 2) })],
  ];
  for (const [label, params] of bad) {
    stub(() => ok(bars(40)));
    const res = await pricesGET(req(params));
    const body = await res.json();
    check(res.status === 400 && body.error === "bad-request" && calls.length === 0,
      `prices: ${label} answers 400 with zero upstream calls`, `${res.status} ${calls.length} calls`);
    check(res.headers.get("Cache-Control") === "no-store", `prices: the 400 for ${label} is not cached`, res.headers.get("Cache-Control"));
  }

  const good = [
    ["ten tickers", query(px, { tickers: eleven.split(",").slice(0, 10).join(",") })],
    ["an end one day ahead (a reader east of UTC)", query(px, { end: plus(TODAY, 1) })],
    ["the page's url with the comma and caret percent-encoded", "tickers=VTI%2CAGG%2CGLD%2CVNQ%2CEFA&benchmark=%5EGSPC&start=2019-01-01&end=2026-09-26"],
  ];
  for (const [label, params] of good) {
    stub(() => ok(bars(40)));
    const res = await pricesGET(req(params));
    check(res.status === 200, `prices: ${label} is canonical and answers 200`, String(res.status));
  }
  const q = { tickers: ["VTI", "AGG"], benchmark: "^GSPC", start: "2019-01-01", end: "2026-09-26" };
  const round = parsePricesQuery(new URL(pricesUrl(q), "http://localhost").searchParams, TODAY);
  check(round.ok && same(round.query, q), "prices: pricesUrl builds the url the handler parses back to the same query", pricesUrl(q));
}

// ---- (h) Cache-Control on a healthy answer that reaches today --------------------------------------
{
  stub(() => ok(bars(40)));
  const res = await pricesGET(req(new URLSearchParams({ tickers: "AAA,BBB", benchmark: "^GSPC", start: "2024-01-01", end: TODAY })));
  check(res.headers.get("Cache-Control") === CACHE_RECENT, "prices: a healthy range ending today is cached an hour, the app's TTL (861)", res.headers.get("Cache-Control"));
  check(/s-maxage=3600\b/.test(CACHE_RECENT) && /stale-while-revalidate/.test(CACHE_RECENT) && /s-maxage=86400\b/.test(CACHE_PAST) && !/stale/.test(CACHE_FAILED) && /s-maxage=60\b/.test(CACHE_FAILED),
    "prices: an hour or a day with stale-while-revalidate when healthy, sixty seconds and no stale on failure");
}

// ---- (i) ledger:start-date-floor, the handler half ---------------------------------------------------
{
  stub(() => ok(bars(40)));
  const res = await pricesGET(req(new URLSearchParams({ tickers: "AAA,BBB", benchmark: "^GSPC", start: "1990-01-01", end: "2024-01-01" })));
  const body = await res.json();
  check(res.status === 200 && body.start === "1990-01-01" && calls.length === 3 && calls.every((c) => c.url.includes("period1=631152000&")),
    "ledger:start-date-floor: a 1990-01-01 start reaches Yahoo untouched (the app's input floors at 2009-01-01)", calls[0]?.url);
}

// ---- (j) /api/rf ----------------------------------------------------------------------------------
{
  const csv = "observation_date,DGS3MO\n2026-09-21,3.91\n2026-09-22,3.89\n2026-09-23,.\n2026-09-24,\n";
  const r = parseRfCsv(csv);
  check(r?.date === "2026-09-22" && r.rate === 3.89 / 100 && r.source === "FRED DGS3MO",
    "rf: the LAST parseable row, skipping '.' and blanks, percent to decimal (636, 717)", JSON.stringify(r));
  check(parseRfCsv("DATE,DGS3MO\r\n2026-09-21,3.91\r\n")?.rate === 0.0391, "rf: the older DATE header and CRLF line ends parse");
  check(parseRfCsv("DATE,DGS3MO\r2026-09-21,3.91\r")?.rate === 0.0391, "rf: bare CR line ends split the way splitlines() does");
  check(parseRfCsv("2026-09-21,3.91\n") === null, "rf: the first line is skipped whatever it holds (628)");
  check(parseRfCsv("DATE,DGS3MO\n2026-09-21,3.91\n2026-09-22,4.1abc\n")?.rate === 0.0391, "rf: a value float() would refuse is skipped, not half-read");
  check(parseRfCsv("DATE,DGS3MO\n2026-09-21,3.91\nfootnote,4.00\n")?.date === "2026-09-21",
    "rf: a row whose first field is not an ISO date is skipped, so RfRate.date is always one");

  stub(() => new Response(csv, { status: 200 }));
  const res = await rfGET(new Request("http://localhost/api/rf"));
  const body = await res.json();
  const cosd = plus(TODAY, -120);
  check(res.status === 200 && same(body, { rate: 3.89 / 100, date: "2026-09-22", source: "FRED DGS3MO" }), "rf: the handler answers the RfRate", JSON.stringify(body));
  check(calls.length === 1 && calls[0].url === `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS3MO&cosd=${cosd}`,
    "rf: one request, DGS3MO alone, a 120-day window (602, 615)", calls[0]?.url);
  check(res.headers.get("Cache-Control") === RF_CACHE_OK && /s-maxage=21600\b/.test(RF_CACHE_OK), "rf: a good rate is cached six hours, the app's TTL (605)", res.headers.get("Cache-Control"));

  for (const [label, answer, id] of [
    ["FRED unreachable", () => { throw new TypeError("fetch failed"); }, "upstream"],
    ["FRED answering 500", () => status(500), "upstream"],
    ["no parseable row", () => new Response("DATE,DGS3MO\n2026-09-23,.\n", { status: 200 }), "no-data"],
  ]) {
    stub(answer);
    const res = await rfGET(new Request("http://localhost/api/rf"));
    const body = await res.json();
    check(res.status === 502 && body.error === id && typeof body.message === "string", `rf: ${label} fails closed as ${id}`, `${res.status} ${JSON.stringify(body)}`);
    check(res.headers.get("Cache-Control") === RF_CACHE_FAILED && !/stale/.test(RF_CACHE_FAILED), `rf: ${label} is cached one minute, never stale`, res.headers.get("Cache-Control"));
  }

  stub(() => new Response(csv, { status: 200 }));
  const q = await rfGET(new Request("http://localhost/api/rf?x=1"));
  check(q.status === 400 && calls.length === 0 && q.headers.get("Cache-Control") === "no-store", "rf: any parameter answers 400 with zero upstream calls", `${q.status} ${calls.length}`);

  const slow = await fetchRf(TODAY, { timeoutMs: 30, fetch: async (_u, init) => hang(init) });
  check(!slow.ok && slow.body.error === "upstream", "rf: a request past its timeout fails closed as upstream (618)");
}

done("t-api");
