// The share link (src/state/url.ts): settings, custom weights and the tab round-trip; the dollar
// amount never enters the string; and a hostile or mangled link decodes field by field, dropping
// what does not parse, never throwing.
import { check, done } from "./_assert.mjs";
import { decodeShare, encodeShare, MAX_PARAM } from "../src/state/url.ts";
import { DEFAULT_SETTINGS } from "../src/state/defaults.ts";
import { ADDED_IDS } from "../src/lib/constructions.ts";

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const has = (o, k) => Object.hasOwn(o, k);
const full = { tickers: ["VTI", "AGG", "GLD", "BRK-B"], start: "2019-01-01", end: "2026-09-26", rf: 0.0389, benchmark: "^NDX", allowShort: true };
const weights = { VTI: 0.3, AGG: -0.1, GLD: 1 / 3, "BRK-B": 1 };

// ---- round trips -----------------------------------------------------------------------------------
const s1 = encodeShare({ settings: full, weights, tab: "risk" });
const d1 = decodeShare(s1);
check(eq(d1.settings, full) && eq(d1.weights, weights) && d1.tab === "risk", "round trip: every setting, the weights (1/3 exactly) and the tab", s1);
check(s1.startsWith("?") && s1.includes("tickers=VTI,AGG,GLD,BRK-B") && s1.includes("w=VTI:0.3,AGG:-0.1"),
  "encode: a readable query, commas and colons left literal", s1);
check(eq(decodeShare(s1.slice(1)), d1), "decode: the leading ? is optional");
const off = { ...full, allowShort: false };
check(decodeShare(encodeShare({ settings: off, weights: null, tab: null })).settings.allowShort === false, "round trip: shorting off is carried as off, not left out");

// null end is today and null rf the live rate: a link must not freeze either.
const s2 = encodeShare({ settings: { ...full, end: null, rf: null }, weights: null, tab: null });
const d2 = decodeShare(s2);
check(!/[?&](end|rf)=/.test(s2) && !has(d2.settings, "end") && !has(d2.settings, "rf"), "encode: end and rf are written only when set", s2);
check(d2.weights === null && d2.tab === null && !/[?&](w|tab)=/.test(s2), "encode: no weights and no tab write nothing");
check(encodeShare({ settings: {}, weights: null, tab: null }) === "" && eq(decodeShare(""), { settings: {}, weights: null, tab: null, view: null }) && encodeShare({ settings: DEFAULT_SETTINGS, weights: null, tab: null }).indexOf("cols") === -1,
  "empty: nothing to carry is the empty string, and it decodes to nothing");

// ---- the walk-forward tab's segment ---------------------------------------------------------------------------
// view=published, and only beside tab=walkforward: the first segment is what the tab opens on, so it writes nothing.
const wf = encodeShare({ settings: full, weights: null, tab: "walkforward", view: "published" });
check(wf.endsWith("&tab=walkforward&view=published") && decodeShare(wf).tab === "walkforward" && decodeShare(wf).view === "published",
  "view: the published segment round-trips beside the walk-forward tab", wf);
const quiet = [
  encodeShare({ settings: full, weights: null, tab: "walkforward", view: "basket" }),
  encodeShare({ settings: full, weights: null, tab: "walkforward" }),
  encodeShare({ settings: full, weights: null, tab: "risk", view: "published" }),
  encodeShare({ settings: full, weights: null, tab: null, view: "published" }),
];
check(quiet.every((q) => !/[?&]view=/.test(q)), "view: the first segment, or any other tab, writes no view", quiet.join(" | "));
const views = [
  ["?tab=walkforward&view=published", "published"],
  ["?view=published", null],
  ["?tab=risk&view=published", null],
  ["?tab=walkforward&view=basket", null],
  ["?tab=walkforward&view=PUBLISHED", null],
  ["?tab=walkforward&view=published%20", null],
  ["?tab=walkforward&view=", null],
  ["?tab=walkforward&view=__proto__", null],
];
for (const [q, want] of views) check(decodeShare(q).view === want, `view: ${q} opens ${want ?? "the first segment"}`, String(decodeShare(q).view));

// ---- the scorecard's added columns ---------------------------------------------------------------------------
// Carried as cols=, the engine's ids only, each once, in the fixed order; anything else in the list is dropped.
const s5 = encodeShare({ settings: { ...full, cols: ["rp", "tan.1y"] }, weights: null, tab: "optimization" });
check(s5.includes("cols=tan.1y,rp") && JSON.stringify(decodeShare(s5).settings.cols) === '["tan.1y","rp"]',
  "cols: the added columns round-trip, written in the fixed order whatever order they were added in", s5);
check(!/cols=/.test(encodeShare({ settings: { ...full, cols: [] }, weights: null, tab: null })) && !has(decodeShare(s2).settings, "cols") && !has(d1.settings, "cols"),
  "cols: none added writes nothing, and a link without cols= opens the default table");
const colsCases = [
  ["?cols=rp,rp,tan.1y,rp", '["tan.1y","rp"]'],
  ["?cols=tan.cap,bogus,tan.2y,RP,rp", '["tan.cap","rp"]'],
  ["?cols=%20rp%20,tan.bs", '["tan.bs","rp"]'],
  ["?cols=tan.bs&cols=rp", '["tan.bs"]'],
];
for (const [q, want] of colsCases) check(JSON.stringify(decodeShare(q).settings.cols) === want, `cols: ${q} keeps the known ids once each, in order`, JSON.stringify(decodeShare(q).settings.cols));
for (const q of ["?cols=", "?cols=bogus", "?cols=__proto__,constructor", "?cols=,,,", "?cols=ew,gmv,tangency,custom,bench", `?cols=${"rp,".repeat(150)}rp`]) {
  check(!has(decodeShare(q).settings, "cols"), `cols: ${q.slice(0, 40)} adds no column`, JSON.stringify(decodeShare(q).settings));
}
// The longest honest link: ten tickers, ten weights at full precision, every field, all four columns. Each value
// fits under the length guard, and one character past the guard is not read at all.
const ten = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "JPM", "XLRE"];
const longW = Object.fromEntries(ten.map((t, i) => [t, -(i + 1) / 10.000000000000002 / 3]));
const longest = encodeShare({ settings: { tickers: ten, start: "2019-01-01", end: "2026-09-26", rf: -0.012345678901234567, benchmark: "^GSPC", allowShort: true, cols: [...ADDED_IDS] }, weights: longW, tab: "optimization" });
const back = decodeShare(longest);
const values = new URLSearchParams(longest).values();
check(back.settings.tickers?.length === 10 && Object.keys(back.weights ?? {}).length === 10 && JSON.stringify(back.settings.cols) === JSON.stringify(ADDED_IDS) &&
  [...values].every((v) => v.length <= MAX_PARAM),
  "guard: the longest honest link, all four columns included, decodes whole, every value under the length guard", `${longest.length} chars`);
// The same link on the walk-forward tab's published segment: the longest honest link there is. The guard bounds
// each value, so the extra key leaves every value as long as it was, and the link still decodes whole.
const longestWf = encodeShare({ settings: { tickers: ten, start: "2019-01-01", end: "2026-09-26", rf: -0.012345678901234567, benchmark: "^GSPC", allowShort: true, cols: [...ADDED_IDS] }, weights: longW, tab: "walkforward", view: "published" });
const backWf = decodeShare(longestWf);
check(longestWf.length > longest.length && backWf.settings.tickers?.length === 10 && Object.keys(backWf.weights ?? {}).length === 10 &&
  JSON.stringify(backWf.settings.cols) === JSON.stringify(ADDED_IDS) && backWf.tab === "walkforward" && backWf.view === "published" &&
  [...new URLSearchParams(longestWf).values()].every((v) => v.length <= MAX_PARAM) &&
  Math.max(...[...new URLSearchParams(longestWf).values()].map((v) => v.length)) < MAX_PARAM,
  "guard: the longest honest link, on the published segment, decodes whole, every value under the length guard",
  `${longestWf.length} chars, longest value ${Math.max(...[...new URLSearchParams(longestWf).values()].map((v) => v.length))} of ${MAX_PARAM}`);
const over = `?cols=${"tan.1y,".repeat(Math.ceil(MAX_PARAM / 7))}rp`;
check(over.length - 6 > MAX_PARAM && !has(decodeShare(over).settings, "cols"), "guard: a cols value past the length guard is not read at all", `${over.length - 6} chars`);

// ---- the amount never travels ----------------------------------------------------------------------------
const s3 = encodeShare({ settings: { ...full, amount: 123457 }, weights: { VTI: 0.5 }, tab: "custom" });
const s4 = encodeShare({ settings: DEFAULT_SETTINGS, weights: null, tab: null });
check(!/amount|123457/i.test(s3) && !/amount|10000/.test(s4), "amount: never in an encoded URL, even when one is passed in", `${s3} | ${s4}`);
check(!has(decodeShare("?amount=5000&tickers=VTI,AGG,GLD").settings, "amount"), "amount: a link that names one is not read");

// ---- hostile and mangled links ---------------------------------------------------------------------------
const absent = [
  ["tickers", "?tickers="],
  ["tickers", "?tickers=VTI,AGG,<script>"],
  ["tickers", "?tickers=VTI,AGG,GLD%20OR%201=1"],
  ["tickers", `?tickers=${Array.from({ length: 21 }, (_, i) => `T${i}`).join(",")}`],
  ["tickers", `?tickers=${"A,".repeat(300)}`],
  ["tickers", "?tickers=%E0%A4%A"],
  // Held to the price endpoint's own pattern: nothing a link carries is a symbol it would refuse.
  ["tickers", "?tickers=VTI,AGG,A%5EB"],
  ["tickers", "?tickers=VTI,AGG,..%2FX"],
  ["tickers", "?tickers=VTI,AGG,-B"],
  ["start", "?start=2026-02-31"],
  ["start", "?start=2019-1-1"],
  ["start", "?start=yesterday"],
  ["end", "?end=2026-13-01"],
  ["rf", "?rf=abc"],
  ["rf", "?rf=Infinity"],
  ["rf", "?rf=1e308"],
  ["rf", "?rf=0x10"],
  ["rf", "?rf=0x0"],
  ["rf", "?rf=%200.05"],
  ["rf", "?rf="],
  ["rf", "?rf=2"],
  ["benchmark", "?bench=EVIL"],
  ["benchmark", "?bench=AAPL"],
  ["allowShort", "?short=maybe"],
  ["allowShort", "?short=true"],
];
for (const [field, q] of absent) {
  let d = null;
  try {
    d = decodeShare(q);
  } catch (err) {
    check(false, `hostile: ${q} throws`, err.message);
    continue;
  }
  check(!has(d.settings, field), `hostile: ${q.slice(0, 40)} leaves ${field} out`, JSON.stringify(d.settings));
}
for (const q of ["?w=VTI:abc", "?w=VTI", "?w=:0.5", "?w=VTI:0.5,VTI:0.2", "?w=__proto__:1", "?w=VTI:5", "?w=VTI:NaN", "?w=VTI:0.5,", "?w=VTI:1e999", "?w=VTI:0x0"]) {
  const d = decodeShare(q);
  check(d.weights === null, `hostile: ${q} leaves every weight out`, JSON.stringify(d.weights));
}
check(({}).VTI === undefined && Object.getPrototypeOf(decodeShare("?w=CONSTRUCTOR:0.5").weights) === Object.prototype,
  "hostile: no weight reaches a prototype");
for (const q of ["?tab=admin", "?tab=__proto__", "?tab=constructor", "?tab=RISK"]) {
  check(decodeShare(q).tab === null, `hostile: ${q} opens the default tab`);
}
let odd = 0;
for (const v of [null, undefined, 42, {}, "%", "?&&&=&", "?tickers=VTI&tickers=<x>"]) {
  try {
    decodeShare(v);
  } catch {
    odd += 1;
  }
}
check(odd === 0, "hostile: non-strings and malformed escapes do not throw");

// One bad field spoils only itself.
const mixed = decodeShare("?tickers=VTI,AGG,GLD&rf=abc&start=2019-02-30&bench=%5EGSPC&short=1&w=VTI:0.5&tab=risk");
check(eq(mixed.settings, { tickers: ["VTI", "AGG", "GLD"], benchmark: "^GSPC", allowShort: true }) && eq(mixed.weights, { VTI: 0.5 }) && mixed.tab === "risk",
  "mixed: the good fields survive the bad ones", JSON.stringify(mixed));
// Honest edge values are kept: eleven tickers (so the page can say "no more than 10"), a negative rate, lower-case input.
const edge = decodeShare("?tickers=a,b,c,d,e,f,g,h,i,j,k&rf=-0.005&w=vti:-1");
check(edge.settings.tickers?.length === 11 && edge.settings.tickers[0] === "A" && edge.settings.rf === -0.005 && edge.weights?.VTI === -1,
  "edge: eleven tickers, a negative rate and a -1 weight are read as typed, upper-cased", JSON.stringify(edge));

done("t-url");
