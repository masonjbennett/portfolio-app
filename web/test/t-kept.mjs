// A kept fan in src/lib/kept.ts: the Range of outcomes row's fan written into a link and checked later against the
// real prices (handoff-montecarlo.md, Session B).
//
// What it pins:
//   (a) a link round-trips: the kept fan read back is the one written, every value is within MAX_PARAM, and the
//       share keys still open the same basket and window on the walk-forward chapter;
//   (b) a tampered, malformed or oversized link fails closed: no kept fan, and the ordinary share link still reads;
//       a figure that breaks the rules is refused even when its checksum is right;
//   (c) the stored fan is what is redrawn: bandAt at a kept month is the kept figure, between months it interpolates;
//   (d) the percentile of a real value: placeIn, and checkOf on real paths built from known prices;
//   (e) with fetch stubbed: under 29 calendar days nothing is fetched and the answer is "early"; under a month of
//       trading days it is "early" too; a mid-horizon check places the value at the elapsed day, not the horizon's;
//       a failed answer says so; the url asked is one the endpoint accepts;
//   (f) the cross-check's gap, and the card's words (budget, no forecast / predict / expected, no right or wrong).
// Each assertion was mutation-tested: the defect it names reintroduced in kept.ts, and this suite required to fail.
import { check, done, near } from "./_assert.mjs";
import { exampleAnalysis, fixtureAnalysis } from "./_analysis.mjs";

const K = await import("../src/lib/kept.ts");
const S = await import("../src/lib/simulate.ts");
const O = await import("../src/tabs/walkforward/outcomes.ts");
const { decodeShare, MAX_PARAM } = await import("../src/state/url.ts");
const { parsePricesQuery, addDays } = await import("../src/data/prices.ts");
const { DEFAULT_SEED } = await import("../src/lib/rng.ts");

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const values = (q) => [...new URLSearchParams(q).values()];
const setKey = (q, key, v) => {
  const p = new URLSearchParams(q);
  p.set(key, v);
  return `?${p}`;
};

const a = fixtureAnalysis("cross");
const fan = O.fanOf(a, 3);
const kept = K.keptOf(a, fan, DEFAULT_SEED);
const link = K.encodeKept(kept);

// (a) round trip
{
  check(typeof link === "string" && link.startsWith("?"), "round trip: a fan from the fixture can be kept");
  check(values(link).every((v) => v.length <= MAX_PARAM), "round trip: every value is within MAX_PARAM",
    String(Math.max(...values(link).map((v) => v.length))));
  check(same(K.decodeKept(link), kept), "round trip: the kept fan read back is the one written");
  check(kept.lines.map((l) => l.key).join() === "ew,gmv,bench" && kept.months.join() === "1,2,3,6,9,12,18,24,30,36",
    "round trip: three lines, kept at the months the horizon allows");
  check(kept.lines[0].q[kept.months.length - 1][2] === Math.round(fan.lines[0].p50[36]),
    "round trip: the kept median at the horizon is the fan's, to the dollar");
  const share = decodeShare(link);
  check(same(share.settings.tickers, a.tickers) && share.settings.start === a.requested.start &&
    share.settings.end === addDays(a.asOf, 1) && share.settings.benchmark === a.benchmark && share.chapter === "holdup",
    "round trip: the share keys open the same basket and window on Does it hold up?");
  // A URL that went through a chat app's re-serialisation (commas and carets escaped) still reads.
  const reser = `?${new URLSearchParams(link)}`;
  check(reser !== link && same(K.decodeKept(reser), kept), "round trip: a re-serialised link still reads");
  const five = K.keptOf(exampleAnalysis(), O.fanOf(exampleAnalysis(), S.horizonFor(exampleAnalysis().bench.length, 5)), DEFAULT_SEED);
  const l5 = K.encodeKept(five);
  check(l5 !== null && values(l5).every((v) => v.length <= MAX_PARAM) && same(K.decodeKept(l5), five),
    "round trip: the longest horizon the example allows also fits and reads back", `${five.horizon} years`);
}

// (b) tampered, malformed, oversized
{
  const ordinary = (q) => K.decodeKept(q) === null && same(decodeShare(q).settings.tickers, a.tickers);
  const pe = new URLSearchParams(link).get("pe");
  const bumped = pe.replace(/^([0-9a-z]+)/, (m) => (parseInt(m, 36) + 1).toString(36));
  check(ordinary(setKey(link, "pe", bumped)), "tamper: one figure edited by a dollar fails closed to the ordinary page");
  check(ordinary(setKey(link, "pk", "0")), "tamper: a wrong checksum fails closed");
  const noPk = new URLSearchParams(link);
  noPk.delete("pk");
  check(ordinary(`?${noPk}`), "tamper: no checksum fails closed");
  check(ordinary(setKey(link, "ph", "1")), "tamper: another horizon fails closed");
  check(K.decodeKept(setKey(link, "tickers", [...a.tickers].reverse().join(","))) === null, "tamper: the tickers reordered fail closed");
  check(ordinary(setKey(link, "pe", `${pe},${pe}`.repeat(3))), "tamper: an oversized value fails closed");
  check(ordinary(`${link}&pe=${pe}`), "tamper: a key given twice fails closed");
  check(ordinary(setKey(link, "pv", "2")), "tamper: an unknown format fails closed");
  check(K.decodeKept(setKey(link, "ch", "build")) === null, "tamper: a kept fan outside its chapter fails closed");
  check(K.decodeKept("") === null && K.decodeKept("?pv=1") === null && K.decodeKept(null) === null, "malformed: an empty or bare link is not a kept fan");
  // Past the checksum: links the encoder will write, but whose figures no fan makes.
  const bad = (label, edit) => {
    const k = structuredClone(kept);
    edit(k);
    const q = K.encodeKept(k);
    check(q === null || K.decodeKept(q) === null, `rules: ${label} is refused even with its checksum right`);
  };
  bad("percentiles out of order", (k) => k.lines[0].q[2].reverse());
  bad("a zero figure", (k) => (k.lines[1].q[0][0] = 0));
  bad("weights that do not sum to one", (k) => (k.weights.gmv = k.weights.gmv.map((w) => w / 2)));
  bad("the wrong months for the horizon", (k) => (k.months = k.months.map((m) => m + 1)));
  bad("a lowest-risk line without its weights", (k) => (k.weights.gmv = null));
  bad("a missing checkpoint", (k) => k.lines[2].q.pop());
  bad("an as-of day before the window starts", (k) => (k.asOf = "2000-01-03"));
}

// (c) the stored fan is what is redrawn
{
  const l = kept.lines[0];
  check(same(K.bandAt(l, kept.months, 6), l.q[3]), "redraw: at a kept month the band is the kept figures");
  check(K.bandAt(l, kept.months, 0).every((x) => x === S.START), "redraw: at month 0 every percentile is the start");
  const mid = K.bandAt(l, kept.months, 7.5);
  check(mid.every((x, k) => x >= Math.min(l.q[3][k], l.q[4][k]) && x <= Math.max(l.q[3][k], l.q[4][k])),
    "redraw: between kept months the band lies between theirs");
  near("redraw: halfway between months, log-linear", mid[2], Math.sqrt(l.q[3][2] * l.q[4][2]), 1e-12);
}

// (d) the percentile of a real value
{
  const band = [9000, 9500, 10000, 11000, 12000];
  check(same(K.placeIn(band, 8999), { at: "below" }) && same(K.placeIn(band, 12001), { at: "above" }),
    "percentile: outside the band is below the 10th or above the 90th");
  check(same(K.placeIn(band, 10000), { at: "inside", pct: 50 }) && same(K.placeIn(band, 9000), { at: "inside", pct: 10 }),
    "percentile: on a kept figure it is that figure's percentile");
  const wide = [9000, 9500, 10000, 15000, 20000];
  const p = K.placeIn(wide, 10000 * 1.5 ** 0.4);
  check(p.at === "inside" && p.pct === 60, "percentile: between two kept figures it is read in log terms (linear would say 59)", JSON.stringify(p));
}

// A synthetic kept fan and prices: two tickers and the benchmark, each growing a fixed rate a day from the as-of day.
const asOf = "2026-01-02";
const days = (n) => {
  const out = [];
  let t = Date.parse(asOf + "T00:00:00Z");
  while (out.length < n) {
    const d = new Date(t);
    if (d.getUTCDay() % 6 !== 0) out.push(d.toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
};
const flat = (x) => [x, x, x, x, x];
const synth = {
  tickers: ["AAA", "BBB"], benchmark: "^GSPC", start: "2020-01-02", asOf, allowShort: false, horizon: 1, seed: DEFAULT_SEED,
  months: K.keptMonths(1), weights: { ew: [0.5, 0.5], gmv: [0.8, 0.2] },
  lines: ["ew", "gmv", "bench"].map((key) => ({
    key, q: K.keptMonths(1).map((m) => [9500, 9800, 10000 * 1.001 ** (21 * m), 10400, 10800].map((x, i) => (i === 2 ? Math.round(x) : Math.round(x * (1 + m / 100))))),
  })),
};
synth.lines.forEach((l) => l.q.forEach((c) => c.sort((x, y) => x - y)));
const prices = (n, ga, gb, gs, lead = 5) => {
  const ds = days(n + 1);
  const before = ["2025-12-26", "2025-12-29", "2025-12-30", "2025-12-31"].slice(-lead);
  return {
    columns: ["AAA", "BBB", "^GSPC"],
    rows: [
      ...before.map((d) => [d, 100, 50, 4000]),
      ...ds.map((d, i) => [d, 100 * ga ** i, 50 * gb ** i, 4000 * gs ** i]),
    ],
  };
};

{
  const path = K.realised(synth, ...Object.values(prices(126, 1.001, 1.0, 1.0005)));
  check(path.dates[0] === asOf && path.dates.length === 127, "realised: the path starts at the as-of day's close");
  near("realised: the equal split grows as its daily-rebalanced mix", path.lines[0].wealth[126], 10000 * (1 + 0.5 * 0.001) ** 126, 1e-12);
  near("realised: the lowest-risk mix uses the kept weights", path.lines[1].wealth[126], 10000 * (1 + 0.8 * 0.001) ** 126, 1e-12);
  near("realised: the benchmark is its own column", path.lines[2].wealth[126], 10000 * 1.0005 ** 126, 1e-12);
  const c = K.checkOf(synth, path);
  check(c.status === "ready" && c.pos === 6 && !c.complete, "check: six months in, the check is at month 6, not the horizon");
  const want = K.placeIn(K.bandAt(synth.lines[0], synth.months, 6), path.lines[0].wealth[126]);
  check(same(c.lines[0].place, want) && same(c.lines[0].band, synth.lines[0].q[3]), "check: the value is placed against the band at the elapsed month");
  const missing = prices(126, 1.001, 1, 1);
  missing.columns = ["AAA", "^GSPC"];
  missing.rows = missing.rows.map((r) => [r[0], r[1], r[3]]);
  const onlyBench = K.realised(synth, missing.columns, missing.rows);
  check(onlyBench && same(onlyBench.lines.map((l) => l.key), ["bench"]), "realised: a ticker that did not price leaves the mixes out, never half of them");
  const long = K.realised(synth, ...Object.values(prices(400, 1.0, 1.0, 1.0)));
  check(long.dates.length === 253 && K.checkOf(synth, long).complete, "realised: the path is cut at the horizon and the check is then complete");
}

// (e) fetch stubbed
{
  const huge = structuredClone(synth);
  huge.horizon = 5;
  huge.months = K.keptMonths(5);
  huge.lines.forEach((l) => (l.q = huge.months.map(() => [1e9 - 4, 1e9 - 3, 1e9 - 2, 1e9 - 1, 1e9])));
  check(K.encodeKept(huge) === null, "oversized: a fan whose figures would pass MAX_PARAM is not offered as a link at all");
  let calls = 0;
  let asked = null;
  const stub = (answer, status = 200) => async (url) => {
    calls++;
    asked = url;
    return { ok: status === 200, status, json: async () => answer };
  };
  const early = await K.checkKept(synth, addDays(asOf, 20), stub(prices(126, 1, 1, 1)));
  check(early.status === "early" && calls === 0, "fetch: under 29 calendar days nothing is fetched and nothing is compared");
  const short = await K.checkKept(synth, addDays(asOf, 30), stub(prices(15, 1, 1, 1)));
  check(short.status === "early" && calls === 1, "fetch: under a month of trading days nothing is compared");
  const q = new URL(asked, "http://x").searchParams;
  const parsed = parsePricesQuery(q, addDays(asOf, 30));
  check(parsed.ok && parsed.query.start < asOf && parsed.query.end === addDays(asOf, 31), "fetch: the url asked is one /api/prices accepts, starting before the as-of day");
  const midday = addDays(asOf, 200);
  const mid = await K.checkKept(synth, midday, stub(prices(126, 1.002, 1.0, 1.0)));
  check(mid.status === "ready" && mid.pos === 6 && mid.lines.length === 3, "fetch: a mid-horizon check is ready, at month 6");
  const sub = O.keptSub(synth, mid);
  check(sub.startsWith(`On ${mid.date}, $10,000 split equally stood at $`) && /percentile of what was simulated\.$/.test(sub),
    "fetch: the sub-line says where the equal split landed", sub);
  const failed = await K.checkKept(synth, midday, stub({ error: "upstream", message: "Yahoo Finance did not answer for any of these symbols." }, 502));
  check(failed.status === "failed" && /Yahoo Finance did not answer/.test(O.keptSub(synth, failed)), "fetch: a failed answer is named, not drawn");
  const refused = await K.checkKept(synth, midday, stub(prices(126, 1.002, 1.0, 1.0), 502));
  check(refused.status === "failed", "fetch: an error status is a failure even when its body looks like prices");
  const junk = await K.checkKept(synth, midday, stub({ columns: "x" }));
  check(junk.status === "failed", "fetch: an answer of the wrong shape is a failure");
  const thrown = await K.checkKept(synth, midday, async () => { throw new Error("offline"); });
  check(thrown.status === "failed", "fetch: a network error is a failure, never a rejection");
  check(/^Nothing to compare yet/.test(O.keptSub(synth, early)), "words: the early branch says there is nothing to compare yet");
}

// (f) cross-check and words
{
  check(K.keptGap(kept, kept) === 0, "cross-check: a fan against itself has no gap");
  const moved = structuredClone(kept);
  moved.lines[0].q[5][4] = Math.round(moved.lines[0].q[5][4] * 1.02);
  near("cross-check: the gap is the largest relative move", K.keptGap(kept, moved), 0.02, 0.05);
  check(O.keptGapNote(0.001) === null && /moves by up to 2\.0%/.test(O.keptGapNote(0.02)), "cross-check: only a move past half a percent is said");
  const words = (x) => x.trim().split(/\s+/).length;
  check(words(O.keptTitle(kept)) <= 14, "words: the kept card's title fits its budget", O.keptTitle(kept));
  const { readFileSync } = await import("node:fs");
  const src = ["src/lib/kept.ts", "src/tabs/walkforward/Kept.tsx", "src/tabs/walkforward/outcomes.ts"]
    .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8"))
    .map((t) => t.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n")).join("\n");
  check(!/predict|expected|forecast/i.test(src.replace(/not a forecast/g, "")), "words: nothing in the kept fan says forecast, predict or expected");
  // A chart margin's `right:` aside.
  check(!/\b(right|wrong|correct|accurate)\b/i.test(src.replace(/\bright: \d+/g, "")),"words: nothing judges the kept fan right or wrong");
}

done("t-kept");
