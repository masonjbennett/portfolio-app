// Drawdown episodes, returns over fixed stretches, the named fall an asset's worst drawdown belongs to
// (src/lib/episodes.ts), calendar years and the month grid (src/lib/monthly.ts), and the dates of the named
// falls themselves (src/content/episodes.ts).
//
//   1. every named fall's high and low recomputed from the S&P 500 closes kept in test/fixtures/gspc-falls.json
//   2. every function against the numpy / pandas oracle, on every frozen basket: each ticker, the benchmark,
//      and the equal-weight, GMV and tangency portfolios, built from the oracle's own weights
//   3. the branches no basket reaches, by hand
//
// Tolerances: 1e-12 relative with a 1e-15 floor for returns and depths. Dates, day counts, flags and the
// order of episodes are compared exactly.
import { check, near, close, done, json } from "./_assert.mjs";
import { SETS, derive } from "./_fixtures.mjs";
import { portfolioReturns } from "../src/lib/portfolio.ts";
import { maxDrawdown } from "../src/lib/stats.ts";
import { monthlyReturns, calendarYears, monthGrid } from "../src/lib/monthly.ts";
import { drawdownEpisodes, windowReturn, covers, coveredStretches, relatedEvent } from "../src/lib/episodes.ts";
import { NAMED_FALLS, LISTED_FALLS } from "../src/content/episodes.ts";

const REL = 1e-12;
const FLOOR = 1e-15;
const js = (x) => JSON.stringify(x);

// Returns and dates out of a list of [date, close]: the first close is the start (the amount invested).
function fromCloses(rows) {
  return {
    start: rows[0][0],
    dates: rows.slice(1).map((x) => x[0]),
    r: rows.slice(1).map((x, i) => x[1] / rows[i][1] - 1),
  };
}

function sameEpisode(label, got, want) {
  const spans = (s) => (s === null ? null : [s.trading, s.calendar]);
  check(
    got.start === want.start && got.trough === want.trough && got.recovery === want.recovery &&
      js(spans(got.down)) === js(want.down) && js(spans(got.recover)) === js(want.recover),
    label, `port ${js({ ...got, down: spans(got.down), recover: spans(got.recover) })} oracle ${js(want)}`,
  );
  near(`${label}: depth`, got.depth, want.depth, REL, FLOOR);
}

// ---- 1. The named falls, from the index's own closes -------------------------------------------------
const gspc = json(new URL("./fixtures/gspc-falls.json", import.meta.url));
check(js(NAMED_FALLS.map((f) => f.id)) === js(gspc.falls.map((f) => f.id)),
  "named falls: the same falls, in the same order, as the closes kept for them");
for (const f of NAMED_FALLS) {
  const fx = gspc.falls.find((x) => x.id === f.id);
  if (!fx) continue;
  const L = `named fall ${f.id}`;
  check(js(f.search) === js(fx.search), `${L}: searched over the span the closes were requested for`,
    `${js(f.search)} vs ${js(fx.search)}`);
  const rows = fx.rows;
  check(rows.every((x, i) => typeof x[1] === "number" && x[1] > 0 && (i === 0 || x[0] > rows[i - 1][0])),
    `${L}: the closes are positive and in date order`);
  check(rows[0][0] >= f.search[0] && rows[rows.length - 1][0] <= f.search[1], `${L}: the closes sit inside the search span`);
  const { start, dates, r } = fromCloses(rows);
  const [deepest] = drawdownEpisodes(r, dates, start, 1);
  check(deepest.start === f.from, `${L}: starts on the index's high close`, `computed ${deepest.start}, content ${f.from}`);
  check(deepest.trough === f.to, `${L}: ends on the index's low close`, `computed ${deepest.trough}, content ${f.to}`);
  // The high must not be the first close kept, nor the low the last: a search span that cut the fall short
  // would otherwise pass off its own edge as the high or the low.
  check(f.from > rows[0][0] && f.to < rows[rows.length - 1][0], `${L}: the search span holds closes on both sides of the fall`);
  // The high is the highest close before the low, and the low the lowest close after the high.
  const hi = rows.findIndex((x) => x[0] === f.from);
  const lo = rows.findIndex((x) => x[0] === f.to);
  check(hi >= 0 && lo > hi && rows.slice(0, lo).every((x) => x[1] <= rows[hi][1]) &&
    rows.slice(hi, lo + 1).every((x) => x[1] >= rows[lo][1]), `${L}: the high tops every close before the low, and the low is the bottom after the high`);
  // The stretch's return is the index's own move from the high to the low.
  near(`${L}: the return over the fall is the low over the high`, windowReturn(r, dates, start, f.from, f.to),
    rows[lo][1] / rows[hi][1] - 1, REL, FLOOR);
}
check(NAMED_FALLS.every((f, i) => f.from < f.to && (i === 0 || NAMED_FALLS[i - 1].to < f.from)),
  "named falls: each ends after it starts, oldest first, and none overlaps the next");
check(js(LISTED_FALLS) === js(NAMED_FALLS.filter((f) => f.listed)) && LISTED_FALLS.length > 0 && LISTED_FALLS.length < NAMED_FALLS.length,
  "named falls: the listed ones are exactly those flagged, and some are labels only");

// ---- 2. Every basket against the oracle ----------------------------------------------------------------
let series = 0;
for (const name of SETS) {
  const d = derive(name);
  const o = d.oracle;
  if (!d.cleaned.ok) {
    check(!o.periods, `${name}: no periods when the prices do not clean`);
    continue;
  }
  const op = o.periods;
  const dates = d.returns.dates;
  const start = d.cleaned.frame.dates[0];
  const n = d.cols.length;

  check(js(op.falls.map((f) => [f.id, f.from, f.to])) === js(NAMED_FALLS.map((f) => [f.id, f.from, f.to])),
    `${name}: the oracle, reading the same closes on its own, dates every named fall as the content does`);
  check(js(op.stretches.slice(0, NAMED_FALLS.length)) === js(NAMED_FALLS.map((f) => [f.from, f.to])),
    `${name}: the oracle's first stretches are the named falls`);

  const all = {};
  d.cleaned.tickers.forEach((t, i) => (all[t] = d.cols[i]));
  all[d.px.benchmark] = d.bench;
  for (const mode of ["long", "short"]) {
    const sol = o.modes[mode].shipping;
    const ws = { gmv: sol.gmv.x, tan: sol.tan.x };
    if (mode === "long") Object.assign(ws, { ew: new Array(n).fill(1 / n) });
    for (const [k, w] of Object.entries(ws)) all[`${mode}.${k}`] = portfolioReturns(d.cols, w);
  }
  check(js(Object.keys(all).sort()) === js(Object.keys(op.series).sort()), `${name}: the same series as the oracle`);

  for (const [k, r] of Object.entries(all)) {
    const x = op.series[k];
    if (!x) continue;
    series += 1;
    const L = `${name} ${k}`;

    // Episodes.
    const eps = drawdownEpisodes(r, dates, start);
    check(eps.length === x.episodes.length, `${L}: as many episodes as the oracle`, `${eps.length} vs ${x.episodes.length}`);
    eps.forEach((e, i) => x.episodes[i] && sameEpisode(`${L} episode ${i + 1}`, e, x.episodes[i]));
    if (eps.length) {
      check(eps[0].depth === maxDrawdown(r), `${L}: the deepest episode is the maximum drawdown, to the last digit`,
        `${eps[0].depth} vs ${maxDrawdown(r)}`);
    }
    const byTime = [...eps].sort((a, b) => (a.start < b.start ? -1 : 1));
    check(byTime.every((e, i) => i === 0 || (byTime[i - 1].recovery !== null && byTime[i - 1].recovery <= e.start)),
      `${L}: no two episodes overlap`);

    // Stretches.
    op.stretches.forEach(([from, to], i) => {
      const got = windowReturn(r, dates, start, from, to);
      const want = x.stretches[i];
      if (want === null) check(got === null, `${L}: ${from} to ${to} is not reported`, `got ${got}`);
      else near(`${L}: return from ${from} to ${to}`, got, want, REL, FLOOR);
    });
    check(js(coveredStretches(NAMED_FALLS, dates, start).map((f) => f.id)) ===
      js(NAMED_FALLS.filter((_, i) => x.stretches[i] !== null).map((f) => f.id)),
      `${L}: the falls the window covers are the ones the oracle reports`);

    // The named fall the worst episode belongs to.
    const rel = relatedEvent(eps[0] ?? null, NAMED_FALLS);
    check((rel ? rel.id : null) === x.related, `${L}: related event`, `port ${rel ? rel.id : null} oracle ${x.related}`);

    // Calendar years.
    const ys = calendarYears(r, dates);
    check(ys.length === x.years.length, `${L}: as many calendar years as the oracle`);
    ys.forEach((y, i) => {
      const [year, ret, first, last, days, partial] = x.years[i] ?? [];
      check(y.year === year && y.first === first && y.last === last && y.days === days && y.partial === partial,
        `${L} year ${year}: dates, days and the partial flag`, `port ${js({ ...y, ret: undefined })} oracle ${js(x.years[i])}`);
      near(`${L} year ${year}: compounded return`, y.ret, ret, REL, FLOOR);
    });

    // The month grid.
    const grid = monthGrid(monthlyReturns(r, dates));
    check(js(grid.map((g) => g.year)) === js(x.grid.map((g) => g[0])), `${L}: the grid has the oracle's years`);
    grid.forEach((g, i) => {
      const want = x.grid[i]?.[1] ?? [];
      check(g.months.length === 12, `${L} grid ${g.year}: twelve months`);
      check(js(g.months.map((m) => (m ? [m.days, m.partial] : null))) === js(want.map((c) => (c ? [c[1], c[2]] : null))),
        `${L} grid ${g.year}: the same months present, with the same days and partial flags`);
      g.months.forEach((m, j) => {
        if (m && want[j]) check(close(m.ret, want[j][0], REL, FLOOR), `${L} grid ${g.year}-${j + 1}: return`, `${m.ret} vs ${want[j][0]}`);
      });
    });
  }
}
check(series >= 50, "the oracle comparison covered every series", `${series} series`);

// ---- 3. Branches by hand ---------------------------------------------------------------------------------
{
  // A series that never falls: a flat day is at the high, not below it.
  check(drawdownEpisodes([0.01, 0, 0.02], ["2024-01-08", "2024-01-09", "2024-01-10"], "2024-01-05").length === 0,
    "episodes: a series that never falls has none");
  check(drawdownEpisodes([], [], "2024-01-05").length === 0, "episodes: no returns, no episodes");

  // A fall on the first day, measured from the amount invested, and trading days kept apart from calendar days.
  const [e] = drawdownEpisodes([-0.05, 0.01, 0.1], ["2024-01-08", "2024-01-09", "2024-01-10"], "2024-01-05");
  check(e && e.start === "2024-01-05" && e.trough === "2024-01-08" && e.recovery === "2024-01-10",
    "episodes: a fall on the first day starts at the amount invested", js(e));
  check(e?.down.trading === 1 && e.down.calendar === 3 && e.recover?.trading === 2 && e.recover.calendar === 2,
    "episodes: days down and to recover, in trading and in calendar days", js(e));
  near("episodes: a first-day fall's depth is that day's loss", e?.depth, -0.05, REL);

  // A fall never recovered.
  const [open] = drawdownEpisodes([0.1, -0.2, 0.05], ["2024-01-08", "2024-01-09", "2024-01-10"], "2024-01-05");
  check(open && open.start === "2024-01-08" && open.trough === "2024-01-09" && open.recovery === null && open.recover === null,
    "episodes: a fall still open on the last day has no recovery", js(open));

  // Back exactly at the high is a recovery: at or above, not only above.
  const [even] = drawdownEpisodes([-0.5, 1, 0.01], ["2024-01-08", "2024-01-09", "2024-01-10"], "2024-01-05");
  check(even && even.recovery === "2024-01-09" && even.recover.trading === 1, "episodes: a close exactly at the high recovers", js(even));

  // Two falls of equal depth: the earlier first. The second begins on the close where the first recovered.
  const twin = drawdownEpisodes([-0.5, 1, -0.5, 1], ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11"], "2024-01-05");
  check(twin.length === 2 && twin[0].depth === twin[1].depth, "episodes: two falls of equal depth", js(twin));
  check(twin.length === 2 && twin[0].start === "2024-01-05" && twin[1].start === "2024-01-09" && twin[0].recovery === twin[1].start,
    "episodes: equal depths ordered earlier first, the second opening on the first one's recovery", js(twin));
  check(drawdownEpisodes([-0.5, 1, -0.5, 1], ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11"], "2024-01-05", 1)[0].start === "2024-01-05",
    "episodes: asked for one of two equal falls, the earlier comes back");

  // Deepest first, and k.
  const pair = drawdownEpisodes([-0.1, 0.2, -0.3, 0.5], ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11"], "2024-01-05");
  check(pair.length === 2 && pair[0].start === "2024-01-09" && pair[1].start === "2024-01-05", "episodes: deepest first", js(pair));
  check(drawdownEpisodes([-0.1, 0.2, -0.3, 0.5], ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11"], "2024-01-05", 0).length === 0,
    "episodes: none when asked for none");
  // The trough is the lowest close between the high and the recovery, not the first close under water.
  const [deep] = drawdownEpisodes([-0.1, -0.2, 0.1, 0.5], ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11"], "2024-01-05");
  check(deep && deep.trough === "2024-01-09" && deep.down.trading === 2, "episodes: the trough is the lowest close", js(deep));
  let threw = false;
  try {
    drawdownEpisodes([0.1], [], "2024-01-05");
  } catch {
    threw = true;
  }
  check(threw, "episodes: returns and dates of different lengths are refused");
}

{
  // Stretches on a week of closes: Fri 5 Jan is the first price, then Mon 8 to Fri 12, then Mon 15.
  const dates = ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12", "2024-01-15"];
  const r = [0.01, -0.02, 0.03, -0.04, 0.05, 0.06];
  const start = "2024-01-05";
  const g = (a, b) => r.slice(a, b).reduce((p, x) => p * (1 + x), 1) - 1;
  near("stretch: from the first price to the last close compounds every return", windowReturn(r, dates, start, start, "2024-01-15"), g(0, 6), REL);
  near("stretch: from the close on the first day, not the close after it", windowReturn(r, dates, start, "2024-01-09", "2024-01-11"), g(2, 4), REL);
  near("stretch: a weekend end takes the Friday close", windowReturn(r, dates, start, "2024-01-09", "2024-01-14"), g(2, 5), REL);
  near("stretch: a weekend start takes the Friday close", windowReturn(r, dates, start, "2024-01-06", "2024-01-10"), g(0, 3), REL);
  check(windowReturn(r, dates, start, "2024-01-10", "2024-01-10") === 0, "stretch: from a close to itself is no return");
  check(windowReturn(r, dates, start, "2024-01-04", "2024-01-10") === null, "stretch: one that starts before the first price is not reported");
  check(windowReturn(r, dates, start, "2024-01-09", "2024-01-16") === null, "stretch: one that ends after the last close is not reported");
  check(covers(dates, start, start, "2024-01-15") && !covers(dates, start, "2024-01-04", "2024-01-15") && !covers(dates, start, start, "2024-01-16"),
    "stretch: covered only when a close sits on or before its start and on or after its end");
  check(covers([], start, start, start) && !covers([], start, start, "2024-01-06"), "stretch: with no returns, only the first price's own date is covered");
  let threw = false;
  try {
    windowReturn(r, dates, start, "2024-01-11", "2024-01-09");
  } catch {
    threw = true;
  }
  check(threw, "stretch: a stretch that ends before it starts is refused");
  const stretches = [{ id: "a", from: "2024-01-04", to: "2024-01-09" }, { id: "b", from: "2024-01-08", to: "2024-01-12" },
    { id: "c", from: "2024-01-12", to: "2024-01-16" }];
  check(js(coveredStretches(stretches, dates, start).map((s) => s.id)) === js(["b"]), "stretch: only the covered stretches are listed");
}

{
  // A window that begins inside a fall: the S&P 500's closes for one listed fall, loaded from the close after its high.
  const f = LISTED_FALLS[LISTED_FALLS.length - 1];
  const rows = gspc.falls.find((x) => x.id === f.id).rows;
  const hi = rows.findIndex((x) => x[0] === f.from);
  const lo = rows.findIndex((x) => x[0] === f.to);
  check(hi >= 0 && lo > hi, "inside a fall: the fall's high and low are among the closes kept");
  const { start, dates, r } = fromCloses(rows.slice(hi + 1));
  check(windowReturn(r, dates, start, f.from, f.to) === null, "inside a fall: the fall is not reported when the window starts after its high");
  check(coveredStretches(NAMED_FALLS, dates, start).every((x) => x.id !== f.id), "inside a fall: the fall is not listed");
  const [first] = drawdownEpisodes(r, dates, start, 1);
  check(first && first.start === start && first.trough === f.to, "inside a fall: the deepest episode is measured from the amount invested, to the index's low", js(first));
  const whole = fromCloses(rows);
  check(coveredStretches(NAMED_FALLS, whole.dates, whole.start).some((x) => x.id === f.id), "inside a fall: the full span of closes does list it");
}

{
  // The related event, on made-up events given newest first so the tie rule cannot lean on their order.
  const ev = [{ id: "b", from: "2024-02-01", to: "2024-03-01" }, { id: "a", from: "2024-01-10", to: "2024-01-20" }];
  const rel = (s, t) => relatedEvent({ start: s, trough: t }, ev)?.id ?? null;
  check(rel("2024-01-12", "2024-01-15") === "a", "related: a fall inside an event");
  check(rel("2024-01-01", "2024-04-01") === "b", "related: a fall spanning both goes to the one it shares more days with");
  check(rel("2024-01-15", "2024-02-06") === "a", "related: an equal overlap goes to the earlier event");
  check(rel("2024-01-20", "2024-02-10") === "b", "related: one shared date with an event is not an overlap, so the other wins");
  check(rel("2024-01-05", "2024-01-10") === null, "related: a fall that bottoms on the day an event starts is not related");
  check(rel("2024-01-20", "2024-01-25") === null, "related: a fall that starts on the day an event bottoms is not related");
  check(rel("2024-03-02", "2024-03-09") === null, "related: a fall after every event is not related");
  check(relatedEvent(null, ev) === null, "related: no fall, no event");
  check(relatedEvent({ start: "2024-01-12", trough: "2024-01-15" }, []) === null, "related: no events, no event");
}

{
  // Calendar years: one with a single trading day, and the partial flags on the first and last only.
  const ys = calendarYears([0.1, -0.1, 0.05], ["2021-12-30", "2021-12-31", "2022-01-03"]);
  check(ys.length === 2 && ys[1].year === 2022 && ys[1].days === 1 && ys[1].first === "2022-01-03" && ys[1].last === "2022-01-03",
    "years: a year with one trading day", js(ys));
  near("years: a year's days are compounded, not added", ys[0].ret, 1.1 * 0.9 - 1, REL);
  near("years: a one-day year's return is that day's", ys[1].ret, 0.05, REL);
  const three = calendarYears([0.01, 0.02, 0.03, 0.04], ["2021-12-31", "2022-06-01", "2022-12-30", "2023-01-03"]);
  check(js(three.map((y) => [y.year, y.days, y.partial])) === js([[2021, 1, true], [2022, 2, false], [2023, 1, true]]),
    "years: the first and last flagged partial, a year in between whole", js(three));
  const one = calendarYears([0.01, 0.02], ["2022-03-01", "2022-03-02"]);
  check(one.length === 1 && one[0].partial, "years: a window inside one year is one partial year");
  check(calendarYears([], []).length === 0, "years: no returns, no years");
  let threw = false;
  try {
    calendarYears([0.1], []);
  } catch {
    threw = true;
  }
  check(threw, "years: returns and dates of different lengths are refused");
}

{
  // The month grid: a month with no data, a year with none, and the columns January to December.
  const months = monthlyReturns([0.01, 0.02, 0.03], ["2023-01-05", "2023-03-06", "2023-12-01"]);
  const [row] = monthGrid(months);
  check(row && row.year === 2023 && row.months.length === 12, "grid: one row of twelve for one year");
  check(row && row.months[0]?.ym === "2023-01" && row.months[2]?.ym === "2023-03" && row.months[11]?.ym === "2023-12",
    "grid: January in the first column, December in the last", js(row?.months.map((m) => m?.ym ?? null)));
  check(row && row.months[1] === null && row.months.filter((m) => m === null).length === 9, "grid: a month with no data is null");
  check(row?.months[0]?.partial === true && row.months[2]?.partial === false && row.months[11]?.partial === true, "grid: the first and last month keep their partial flag");
  const gap = monthGrid(monthlyReturns([0.01, 0.02], ["2021-11-01", "2023-02-01"]));
  check(js(gap.map((g) => g.year)) === js([2021, 2022, 2023]) && gap[1].months.every((m) => m === null),
    "grid: a year the window skips still has a row, all null", js(gap.map((g) => g.year)));
  check(monthGrid([]).length === 0, "grid: no months, no rows");
}

done("t-periods");
