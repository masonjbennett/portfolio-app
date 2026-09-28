// The share link (src/state/url.ts): settings, custom weights and the tab round-trip; the dollar
// amount never enters the string; and a hostile or mangled link decodes field by field, dropping
// what does not parse, never throwing.
import { check, done } from "./_assert.mjs";
import { decodeShare, encodeShare } from "../src/state/url.ts";
import { DEFAULT_SETTINGS } from "../src/state/defaults.ts";

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
check(encodeShare({ settings: {}, weights: null, tab: null }) === "" && eq(decodeShare(""), { settings: {}, weights: null, tab: null }),
  "empty: nothing to carry is the empty string, and it decodes to nothing");

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
