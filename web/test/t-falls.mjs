// The Risk tab's first section, the portfolios in a fall (src/tabs/risk/falls.ts, src/tabs/Risk.tsx), and
// the Related event column on the asset drawdown table (src/tabs/risk/model.ts).
//
// Every printed cell is held to the engine run here on that column's own daily returns, rebuilt in this
// file from the weights (portfolioReturns over weightsOf, or the typed mix), never read back from the page's
// own helpers: the deepest falls against drawdownEpisodes, the named falls against windowReturn over the
// falls covers() admits, and the related event against an overlap computed here from the dates alone.
// On the baked example and on the mega-cap fixture, then on windows cut to leave falls out.
import { render, text, act } from "./_dom.mjs";
import { check, done } from "./_assert.mjs";
import { exampleAnalysis, fixtureAnalysis, fixturePayload, settingsFor, tabProps, ORACLE_RF } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const Risk = (await import("../src/tabs/Risk.tsx")).default;
const F = await import("../src/tabs/risk/falls.ts");
const RM = await import("../src/tabs/risk/model.ts");
const { drawdownEpisodes, windowReturn, covers } = await import("../src/lib/episodes.ts");
const { NAMED_FALLS, LISTED_FALLS } = await import("../src/content/episodes.ts");
const { portfolioReturns } = await import("../src/lib/portfolio.ts");
const { customWeights, weightsOf, PORT_LABEL } = await import("../src/tabs/optimization/model.ts");
const { FITTED } = await import("../src/tabs/caption.ts");
const { format } = await import("../src/format.ts");
const { analyze } = await import("../src/state/analyze.ts");

const quiet = (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};
HTMLElement.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 360, width: 720, height: 360, toJSON() {} };
};
const click = (el) => act(() => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
const section = (r, id) => r.container.querySelector(`section[aria-labelledby="${id}"]`);
const pills = (root) => [...root.querySelectorAll("button[role=radio]")];
// The text a table's Download CSV button saves, caught where the browser would be handed the file.
async function savedCsv(tbl) {
  const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL, click: window.HTMLAnchorElement.prototype.click };
  let blob = null;
  URL.createObjectURL = (b) => {
    blob = b;
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  try {
    const btn = [...(tbl?.querySelectorAll(".tbl-dl button") ?? [])].find((b) => text(b) === "Download CSV");
    if (btn) act(() => btn.click());
    return blob ? await blob.text() : "";
  } finally {
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
    window.HTMLAnchorElement.prototype.click = saved.click;
  }
}
const rowsOf = (tbl) => [...tbl.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map(text));
const headsOf = (tbl) => [...tbl.querySelectorAll("thead th")].map((th) => text(th.firstChild ?? th));
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// A window cut out of a price fixture, run through the shipping analyze().
function cut(name, from, to = "9999-12-31") {
  const p = fixturePayload(name);
  const q = { ...p, start: from, rows: p.rows.filter((row) => row[0] >= from && row[0] <= to) };
  const a = analyze(q, settingsFor(q), { rate: ORACLE_RF, source: "manual" });
  if (!a.ok) throw new Error(`analyze refused the cut ${name} ${from}: ${a.message}`);
  return a;
}

// Each column's daily returns, rebuilt here from the weights: the scorecard's order, the benchmark last.
function columns(a, typed) {
  const c = customWeights(a, typed);
  const port = (w) => (w ? portfolioReturns(a.returns, w) : null);
  return [
    { id: "ew", label: PORT_LABEL.ew, r: port(weightsOf(a, "ew")) },
    { id: "gmv", label: PORT_LABEL.gmv, r: port(weightsOf(a, "gmv")) },
    { id: "tangency", label: PORT_LABEL.tangency, r: port(weightsOf(a, "tangency")) },
    { id: "custom", label: "Custom", r: c.ok ? port(c.w) : null },
    { id: "bench", label: a.benchLabel, r: a.bench },
  ];
}

// The engine's deepest falls, printed as the page prints them.
function expectEpisodes(a, r) {
  return drawdownEpisodes(r, a.dates, a.prices.dates[0], 5).map((e) => [
    format(e.start, "date"),
    format(e.trough, "date"),
    e.recovery === null ? "not yet" : format(e.recovery, "date"),
    format(e.depth, "pct2"),
    format(e.down.trading, "int"),
    format(e.recover ? e.recover.trading : null, "int"),
    format(e.down.calendar, "int"),
    format(e.recover ? e.recover.calendar : null, "int"),
  ]);
}

// A fall's name sits beside dates printed yyyy-mm-dd, so no name may read as a year and month.
{
  const ym = NAMED_FALLS.filter((e) => /\d{4}-\d{2}(?!\d)/.test(e.label)).map((e) => e.label);
  check(ym.length === 0, "names: no named fall's label reads as a year and month", ym.join(", "));
}

// The event an asset's worst fall overlaps, from the dates alone: more than one shared date, the most
// shared calendar days winning, a tie to the event that began first.
function overlapLabel(a, r) {
  const worst = drawdownEpisodes(r, a.dates, a.prices.dates[0], 1)[0];
  if (!worst) return "";
  let match = null;
  let most = -1;
  for (const e of NAMED_FALLS) {
    const lo = worst.start > e.from ? worst.start : e.from;
    const hi = worst.trough < e.to ? worst.trough : e.to;
    if (!(lo < hi)) continue;
    const days = (Date.parse(hi) - Date.parse(lo)) / 86_400_000;
    if (days > most || (days === most && e.from < match.from)) [match, most] = [e, days];
  }
  return match ? match.label : "";
}

function typedMix(a) {
  // A mix that is not equal weight: tenths, heaviest first.
  return Object.fromEntries(a.tickers.map((t, i) => [t, (a.tickers.length - i) / 10]));
}

for (const [set, a] of [["example", exampleAnalysis()], ["megacap", fixtureAnalysis("megacap")]]) {
  const tag = (s) => `${set}: ${s}`;
  const typed = typedMix(a);
  const cols = columns(a, typed);
  const r = quiet(() => render(h(Risk, tabProps(a, { weights: typed }))));
  const sec = section(r, "risk-falls");

  // Order: the new section is the tab's first, under the headline, which is unchanged.
  const order = [...r.container.querySelectorAll("section[aria-labelledby]")].map((s) => s.getAttribute("aria-labelledby"));
  check(same(order, ["risk-falls", "risk-drawdown", "risk-volatility", "risk-metrics", "risk-capm"]) && !!r.container.querySelector("h2#risk-falls"),
    tag("order: the portfolios in a fall is the tab's first section, anchored risk-falls"), order.join());
  check(text(r.container.querySelector(".risk-headline")) === RM.headline(a), tag("order: the headline above it is the asset headline, as it was"));
  check(!/NaN|undefined|Infinity|\bnan\b/.test(text(r.container)), tag("tab: no NaN, undefined or Infinity with the section on it"));

  // The pill: the scorecard's five heads, in its order.
  const labels = pills(sec).map(text);
  check(same(labels, cols.map((c) => c.label)), tag("pill: Equal-Weight, GMV, Tangency, Custom and the benchmark, the scorecard's order"), labels.join(" | "));

  // (a) Every column's deepest falls, printed cell by cell against the engine.
  let sawNotYet = false;
  for (const col of cols) {
    quiet(() => click(pills(sec).find((b) => text(b) === col.label)));
    const tbl = sec.querySelector(".tbl");
    // The page prints the first six cells of each row; the calendar-day counts are the downloads' alone.
    const want = expectEpisodes(a, col.r).map((row) => row.slice(0, 6));
    const got = tbl ? rowsOf(tbl) : [];
    sawNotYet ||= got.some((row) => row[2] === "not yet");
    check(want.length > 0 && want.length <= 5 && same(got, want), tag(`falls: ${col.label}'s rows are the engine's deepest falls, every cell`),
      `${JSON.stringify(got[0])} vs ${JSON.stringify(want[0])}`);
    check(text(tbl?.querySelector(".tbl-title")) === `Deepest falls, ${col.label}`, tag(`falls: the table is titled for ${col.label}`));
    const fitted = sec.querySelector(".risk-fitted");
    const wantFitted = col.id === "gmv" || col.id === "tangency";
    check(wantFitted ? fitted !== null && text(fitted) === FITTED : fitted === null, tag(`falls: ${col.label} ${wantFitted ? "carries" : "does not carry"} "${FITTED}" beside the pill`));
  }
  // The recovery column says "not yet" exactly where the engine has no recovery.
  const open = cols.some((c) => drawdownEpisodes(c.r, a.dates, a.prices.dates[0], 5).some((e) => e.recovery === null));
  check(open === sawNotYet, tag("falls: the page prints \"not yet\" exactly when a fall has no recovery by the last close"), `open ${open}, printed ${sawNotYet}`);

  // The calendar-day columns are left off the page and kept in the download, with the engine's counts.
  {
    const tbl = sec.querySelector(".tbl");
    const heads = headsOf(tbl);
    check(same(heads, ["High", "Low", "Back at the high", "Depth", "Trading days down", "Trading days to recover"]),
      tag("falls: the page prints six heads, in trading days, and no calendar-day column"), heads.join(" | "));
    const csv = (await savedCsv(tbl)).trim().split(/\r?\n/).map((l) => l.split(","));
    const last = cols[cols.length - 1];
    const eng = drawdownEpisodes(last.r, a.dates, a.prices.dates[0], 5);
    const cal = csv.slice(1).map((row) => [row[6], row[7]]);
    const wantCal = eng.map((e) => [String(e.down.calendar), e.recover ? String(e.recover.calendar) : ""]);
    check(same(csv[0].slice(6), ["Calendar days down", "Calendar days to recover"]) && csv[0].length === 8 && same(cal, wantCal),
      tag("falls: the download adds both calendar-day columns after the six, holding the engine's counts"), `${csv[0].join(" | ")}; ${JSON.stringify(cal[0])} vs ${JSON.stringify(wantCal[0])}`);
  }

  // (b) The named falls the window holds, one row each, every column's compounded return over it.
  const tbls = [...sec.querySelectorAll(".tbl")];
  const named = tbls.find((t) => text(t.querySelector(".tbl-title")) === "Named falls in this window");
  const inside = LISTED_FALLS.filter((f) => covers(a.dates, a.prices.dates[0], f.from, f.to));
  const wantNamed = inside.map((f) => [
    f.label,
    format(f.from, "date"),
    format(f.to, "date"),
    ...cols.map((c) => format(c.r ? windowReturn(c.r, a.dates, a.prices.dates[0], f.from, f.to) : null, "pct2")),
  ]);
  check(inside.length > 0 && named && same(rowsOf(named), wantNamed), tag("named: one row per fall the window covers, each column's windowReturn"),
    named ? JSON.stringify(rowsOf(named)) : "no table");
  const namedHeads = named ? [...named.querySelectorAll("thead th")] : [];
  const subOf = (label) => {
    const sub = namedHeads.find((th) => th.firstChild && text(th.firstChild) === label)?.querySelector(".tbl-sub");
    return sub ? text(sub) : "";
  };
  check(subOf("GMV") === FITTED && subOf("Tangency") === FITTED && subOf("Equal-Weight") === "", tag("named: GMV and Tangency carry the fitted line, Equal-Weight does not"));
  check(/chosen on this window, which includes every\s+fall listed, so their figures are in-sample, hindsight/.test(text(sec.querySelector("[data-note=hindsight]"))),
    tag("named: the note says GMV's and Tangency's weights saw these falls, so their figures are in-sample, hindsight"));

  // (c) Related event, from overlap, and the asset table's High and Low are the engine's deepest fall.
  const ddTable = [...r.container.querySelectorAll(".tbl")].find((t) => text(t.querySelector(".tbl-title")) === "Worst drawdown by asset");
  const ddHeads = headsOf(ddTable);
  const ev = ddHeads.indexOf("Related event");
  const ddRows = rowsOf(ddTable);
  const series = [...a.returns, a.bench];
  const wantEv = series.map((s) => overlapLabel(a, s));
  check(ev === ddHeads.length - 1 && same(ddRows.map((row) => row[ev]), wantEv), tag("related: each asset's event is the named fall its worst fall overlaps"),
    `${ddRows.map((row) => row[ev]).join(" | ")} vs ${wantEv.join(" | ")}`);
  check(wantEv.some((x) => x !== ""), tag("related: at least one asset's worst fall overlaps a named fall here"), wantEv.join(" | "));
  const engineAgrees = series.every((s, i) => {
    const e = drawdownEpisodes(s, a.dates, a.prices.dates[0], 1)[0];
    return e && ddRows[i][2] === format(e.start, "date") && ddRows[i][3] === format(e.trough, "date");
  });
  check(engineAgrees, tag("related: the table's High and Low are the engine's deepest fall, so the event is matched to the fall printed"));
  r.unmount();
}

// A window cut to leave 2020 out lists no Covid row; one after every listed fall lists none and says so in one line,
// and an asset whose worst fall overlaps no named fall shows an empty Related event cell, never a word or a dash.
{
  const after = cut("cross", "2021-01-01");
  const r = quiet(() => render(h(Risk, tabProps(after))));
  const sec = section(r, "risk-falls");
  const named = [...sec.querySelectorAll(".tbl")].find((t) => text(t.querySelector(".tbl-title")) === "Named falls in this window");
  const labels = named ? rowsOf(named).map((row) => row[0]) : [];
  const want = LISTED_FALLS.filter((f) => covers(after.dates, after.prices.dates[0], f.from, f.to)).map((f) => f.label);
  check(!labels.includes("Covid") && same(labels, want) && want.length > 0, "cut: a window from 2021 lists no Covid row, and lists what it covers", labels.join(" | "));
  r.unmount();

  const late = cut("cross", "2023-01-01");
  const r2 = quiet(() => render(h(Risk, tabProps(late))));
  const sec2 = section(r2, "risk-falls");
  const titles = [...sec2.querySelectorAll(".tbl")].map((t) => text(t.querySelector(".tbl-title")));
  const lineEl = sec2.querySelector("[data-note=no-named-falls]");
  const line = lineEl ? text(lineEl) : "";
  check(!titles.includes("Named falls in this window") && line === F.noNamedFalls(late) && LISTED_FALLS.every((f) => line.includes(f.label)),
    "cut: a window after every listed fall has no named-falls table, one plain line naming them instead", line);
  const dd = [...r2.container.querySelectorAll(".tbl")].find((t) => text(t.querySelector(".tbl-title")) === "Worst drawdown by asset");
  const ev = headsOf(dd).indexOf("Related event");
  const cells = [...dd.querySelectorAll("tbody tr")].map((tr) => tr.children[ev]);
  const wantEmpty = [...late.returns, late.bench].map((s) => overlapLabel(late, s));
  check(wantEmpty.every((x) => x === "") && cells.length === wantEmpty.length && cells.every((td) => td.textContent === ""),
    "related: an asset whose worst fall overlaps nothing shows an empty cell, not a word or a dash", cells.map((td) => JSON.stringify(td.textContent)).join(" "));
  r2.unmount();
}

// Fewer falls than five print fewer rows; a series that never fell prints one line and no table.
{
  const a = exampleAnalysis();
  const n = a.dates.length;
  const twoDips = Array.from({ length: n }, (_, t) => (t === 100 || t === 400 ? -0.05 : 0.001));
  const rising = Array.from({ length: n }, () => 0.001);
  for (const [bench, want, what] of [[twoDips, 2, "two falls print two rows"], [rising, 0, "no fall prints one line and no table"]]) {
    const b = Object.create(a);
    Object.defineProperty(b, "bench", { value: bench });
    const r = quiet(() => render(h(Risk, tabProps(b))));
    const sec = section(r, "risk-falls");
    quiet(() => click(pills(sec).find((x) => text(x) === a.benchLabel)));
    const tbl = sec.querySelector(".tbl");
    const got = tbl && text(tbl.querySelector(".tbl-title")).startsWith("Deepest falls") ? rowsOf(tbl).length : 0;
    const engine = drawdownEpisodes(bench, a.dates, a.prices.dates[0], 5).length;
    const line = sec.querySelector("[data-note=no-falls]");
    check(got === want && engine === want && (want === 0 ? text(line) === F.noEpisodes(b, { id: "bench", label: a.benchLabel, sub: null, r: bench }) : line === null),
      `falls: ${what}`, `${got} rows, engine ${engine}, line ${line ? text(line) : "none"}`);
    r.unmount();
  }
}

done("t-falls");
