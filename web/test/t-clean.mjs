// The cleaning rules at their boundaries. The fixtures exercise each branch once; these pin the
// exact thresholds (portfolio_app.py 1007-1092), which a parity run alone would not notice moving.
import { check, done } from "./_assert.mjs";
import { parseTickers, validateRequest, cleanPrices, computeReturns } from "../src/lib/clean.ts";

check(JSON.stringify(parseTickers(" aapl, MSFT,,aapl , googl ")) === '["AAPL","MSFT","GOOGL"]',
  "tickers: trimmed, upper-cased, de-duplicated in order, blanks skipped");

const T = (n) => Array.from({ length: n }, (_, i) => `T${i}`);
check(validateRequest(T(2), "2020-01-01", "2023-01-01") === "too-few", "request: 2 tickers is too few");
check(validateRequest(T(3), "2020-01-01", "2023-01-01") === null, "request: 3 tickers is enough");
check(validateRequest(T(10), "2020-01-01", "2023-01-01") === null, "request: 10 tickers is allowed");
check(validateRequest(T(11), "2020-01-01", "2023-01-01") === "too-many", "request: 11 is too many");
check(validateRequest(T(3), "2021-01-01", "2022-12-31") === "short-range", "request: 729 days fails");
check(validateRequest(T(3), "2020-01-01", "2022-01-01") === null, "request: 731 days passes");
check(validateRequest(T(3), "2021-01-01", "2023-01-01") === null, "request: exactly 730 days passes");

// A frame of `rows` dates; `gaps` sets how many leading rows a column is missing.
function frame(rows, cols) {
  const dates = Array.from({ length: rows }, (_, i) => new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10));
  return {
    dates,
    columns: Object.keys(cols),
    values: Object.values(cols).map((gap) => dates.map((_, i) => (i < gap ? NaN : 100 + i + gap * 0.5))),
  };
}

// 400 rows: 5% missing is 20 rows, kept (strictly more than 5% is dropped); 21 rows is dropped.
let c = cleanPrices(frame(400, { A: 0, B: 20, C: 0, D: 0, X: 0 }), [], ["A", "B", "C", "D"], "X");
check(c.ok && c.tickers.includes("B"), "missing: exactly 5% is kept");
check(c.ok && c.events.some((e) => e.kind === "truncated" && e.rows === 380), "missing: and truncates the range to the overlap");
c = cleanPrices(frame(400, { A: 0, B: 21, C: 0, D: 0, X: 0 }), [], ["A", "B", "C", "D"], "X");
check(c.ok && !c.tickers.includes("B") && c.events[0].kind === "dropped", "missing: 5% plus one row is dropped");
check(c.ok && c.frame.dates.length === 400, "missing: a dropped ticker does not truncate");
c = cleanPrices(frame(400, { A: 0, B: 0, C: 0, X: 100 }), [], ["A", "B", "C"], "X");
check(c.ok && c.frame.columns.includes("X") && c.frame.dates.length === 300, "missing: the benchmark is exempt from the 5% rule");

// 252 overlapping rows is enough; 251 is not.
check(cleanPrices(frame(252, { A: 0, B: 0, C: 0, X: 0 }), [], ["A", "B", "C"], "X").ok, "overlap: 252 rows passes");
c = cleanPrices(frame(251, { A: 0, B: 0, C: 0, X: 0 }), [], ["A", "B", "C"], "X");
check(!c.ok && c.error === "short-overlap", "overlap: 251 rows fails");

c = cleanPrices(frame(300, { A: 0, B: 0, X: 0 }), ["C"], ["A", "B", "C"], "X");
check(!c.ok && c.error === "too-few-downloaded" && c.events[0].kind === "failed", "downloads: two tickers left is too few");
c = cleanPrices(frame(300, { A: 0, B: 0, C: 0 }), ["X"], ["A", "B", "C"], "X");
check(!c.ok && c.error === "bench-failed", "downloads: a failed benchmark stops the run");
c = cleanPrices(frame(400, { A: 0, B: 0, C: 30, X: 0 }), [], ["A", "B", "C"], "X");
check(!c.ok && c.error === "too-few-valid", "cleaning: fewer than 3 left after the 5% rule fails");

const r = computeReturns({ dates: ["a", "b", "c"], columns: ["A"], values: [[100, 110, 99]] });
check(r.dates.join() === "b,c" && r.values[0][0] === 110 / 100 - 1 && r.values[0][1] === 99 / 110 - 1,
  "returns: p[t] / p[t-1] - 1 from the second row");

done("t-clean");
