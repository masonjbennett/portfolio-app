// The first screen (redesign plan 5a), in a real browser, in `npm test` and so in CI: on a wide screen and a phone,
// the Overview's question, its answer lede and its lead chart must sit where a first-time reader sees them without
// scrolling, for every lede the Overview can show. The cases, the targets and the measuring are
// scripts/first-screen.mjs's own (imported, never copied), so this suite and the pre-push / post-deploy script
// cannot disagree about what "met" means.
//
// Why it is a suite (Oct 14 2026): batch 9's global 44 px touch-target rule pushed the phone's lead chart below the
// screen, passed all 45 suites, and was found on production at M3. The script that catches it ran only by hand.
//
// Nothing leaves the machine. The page runs on Vite's dev server, whose bridge calls the SHIPPING api/prices.ts and
// api/rf.ts in this process, and globalThis.fetch is stubbed here: Yahoo's chart answers are built from the frozen
// price fixtures (the five mega-caps and the cross-asset set, both with the S&P 500), FRED's DGS3MO csv is the
// fixture's, and any other outside url fails the suite. So the ledes carry fixture figures, not today's: this checks
// the LAYOUT; the script against production remains the check of the live page.
//
// It needs Edge or Chrome (GitHub's ubuntu runner has Chrome at /usr/bin/google-chrome). With neither it FAILS,
// never skips: a suite that quietly stopped measuring would look exactly like one that passes.
import { readFileSync } from "node:fs";
import { check, done, json } from "./_assert.mjs";
import { CASES, SCREENS, checkFirstScreen, devServer, findBrowser } from "../scripts/first-screen.mjs";

const fixture = (name) => json(new URL(`./fixtures/prices-${name}.json`, import.meta.url));
const SETS = [fixture("megacap5"), fixture("cross")];
const DGS3MO = readFileSync(new URL("./fixtures/dgs3mo.csv", import.meta.url), "utf8");

// One symbol's dates and adjusted closes, from whichever fixture carries it (the S&P 500 is in both, identically).
function seriesOf(sym) {
  for (const px of SETS) {
    const j = px.columns.indexOf(sym);
    if (j < 0) continue;
    const rows = px.rows.filter((r) => r[j + 1] !== null);
    return [rows.map((r) => r[0]), rows.map((r) => r[j + 1])];
  }
  return null;
}

// Yahoo's chart body for one symbol, bars stamped at the 09:30 New York open, as api/prices.ts reads it.
const chart = ([dates, adj]) => ({
  chart: {
    result: [{ meta: { gmtoffset: -14400 }, timestamp: dates.map((d) => Date.parse(`${d}T13:30:00Z`) / 1000), indicators: { quote: [{ close: adj }], adjclose: [{ adjclose: adj }] } }],
    error: null,
  },
});

const real = globalThis.fetch;
const outside = [];
let yahoo = 0;
let fred = 0;
// FRED down, as it was for production on Oct 15 2026: the request stalls until api/rf.ts's own timeout, then 502.
let fredDown = false;
let stalled = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const host = new URL(url).hostname;
  if (host === "127.0.0.1" || host === "localhost" || host === "[::1]") return real(input, init);
  if (/finance\.yahoo\.com$/.test(host)) {
    yahoo += 1;
    const sym = decodeURIComponent(url.match(/chart\/([^?]+)/)?.[1] ?? "");
    const s = seriesOf(sym);
    return s ? new Response(JSON.stringify(chart(s)), { status: 200, headers: { "content-type": "application/json" } }) : new Response("{}", { status: 404 });
  }
  if (host === "fred.stlouisfed.org") {
    fred += 1;
    if (fredDown) {
      stalled += 1;
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    }
    return new Response(DGS3MO, { status: 200, headers: { "content-type": "text/csv" } });
  }
  outside.push(url);
  return new Response("not served in a suite", { status: 599 });
};

const browser = findBrowser();
check(!!browser, "first screen: a browser to measure in (Edge or Chrome; set GUIDE_BROWSER)", "none of the usual paths exists");
if (browser) {
  const server = await devServer();
  let rows = [];
  let downRows = [];
  try {
    rows = await checkFirstScreen(server.origin);
    // A typed basket with the rate source down still loads: after RF_HOLD_MS it shows at the stated placeholder,
    // with its own lede. Until Oct 15 2026 it sat behind the example until the 502, and the check measured the example.
    fredDown = true;
    downRows = await checkFirstScreen(server.origin, { cases: CASES.filter((c) => c.lede === "run") });
  } finally {
    await server.close();
  }
  check(rows.length === SCREENS.length * CASES.length, "first screen: every case at every screen was measured", `${rows.length} rows`);
  for (const { screen, c, m, misses } of rows) {
    const nums = m ? `question ${m.question}, lede ${m.lede}, chart ${m.chart}` : "not measured";
    check(misses.length === 0, `first screen: ${screen.name}, ${c.name} (targets ${screen.question} / ${screen.lede} / ${screen.chart})`,
      `${nums}; ${misses.join("; ")}${m && misses.length ? `; above the question: ${m.above}` : ""}`);
  }
  check(downRows.length === SCREENS.length && stalled >= SCREENS.length, "first screen, rate down: the typed basket was measured at every screen, each page's rate request stalled",
    `${downRows.length} rows, ${stalled} stalled`);
  for (const { screen, c, m, misses } of downRows) {
    check(misses.length === 0, `first screen, rate down: ${screen.name}, ${c.name}`, `${m ? m.text.slice(0, 80) : "not measured"}; ${misses.join("; ")}`);
  }
  // The stub was what answered: the page asked for prices and the rate, and nothing else left the machine.
  check(yahoo > 0 && fred > 0 && outside.length === 0, "first screen: prices and the rate came from the fixtures, and no other outside url was asked for",
    `yahoo ${yahoo}, fred ${fred}, outside ${outside.join(" ")}`);
}

done("t-first-screen", { drain: true });
