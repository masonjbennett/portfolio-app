// The scorecard's workbook of formulas (src/workbook.ts), held three ways, none of which trusts the code that
// wrote its cached values:
// 1. every formula cell's cached value is what test/_xlsx.mjs computes from the formula itself;
// 2. every Scorecard figure is ALSO the page's own figure for that row and column (scorecard() in
//    src/tabs/optimization/scorecard.ts), matched by the row's label and the column's head as printed;
// 3. desktop Excel, recalculating the book from scratch, got the cached values too: test/oracle/excel_recalc.ps1
//    recorded what it got in test/fixtures/workbook-excel.json, together with a hash of every formula, so a
//    change to the book's formulas goes red here until the script is run again.
// On each set the script covers: the cross-asset example and the mega-cap fixture long-only, and the
// cross-asset example with shorting on.
import { readFileSync } from "node:fs";
import { check, done, json } from "./_assert.mjs";
import { evaluator, formulaCells, fromSheets, functionsIn, KNOWN, splitAddress } from "./_xlsx.mjs";
import { buildSet, close, FIXTURE, formulaHash, SETS } from "./oracle/excel_recalc.mjs";

const W = await import("../src/workbook.ts");
const SC = await import("../src/tabs/optimization/scorecard.ts");
const { CUSTOM_REFUSAL, failedLabel } = await import("../src/tabs/optimization/model.ts");
const { portfolioReturns } = await import("../src/lib/portfolio.ts");
const { scorecardRow } = await import("../src/lib/stats.ts");
const { FITTED } = await import("../src/tabs/caption.ts");
const { customWeights } = await import("../src/tabs/optimization/model.ts");
const { exampleAnalysis, fixtureAnalysis } = await import("./_analysis.mjs");
const { ADDED_IDS, CAP, isAddedId, YEAR_ROWS } = await import("../src/lib/constructions.ts");
const { ADDED_LABEL, addedMissingLabel } = await import("../src/tabs/optimization/model.ts");
const { format } = await import("../src/format.ts");

const excel = json(FIXTURE);
const page = (model, metricId, k, se) => {
  const line = model.lines.find((l) => l.metric.id === metricId);
  const c = line.cells[k];
  return se ? c.se : c.value;
};
const finite = (x) => typeof x === "number" && Number.isFinite(x);

// The 18 rows and the rows left to the values download partition the page's rows.
const bookIds = W.BOOK_ROWS.filter((id) => id !== "sharpeSE");
const all = SC.SCORE_METRICS.map((m) => m.id);
check(W.BOOK_ROWS.length === 18 && [...bookIds, ...W.LEFT_OUT_IDS].sort().join() === [...all].sort().join() && new Set([...bookIds, ...W.LEFT_OUT_IDS]).size === all.length,
  "rows: the book's 18 rows and the rows only in the values download cover every scorecard row once", `${bookIds.length}+${W.LEFT_OUT_IDS.length} of ${all.length}`);

for (const set of SETS) {
  const tag = (s) => `${s} (${set.id})`;
  const { a, c, model, sheets } = buildSet(set, excel.added);
  const book = fromSheets(sheets);
  const cells = formulaCells(book);
  const ev = evaluator(book);
  check(book.names.join("|") === "Notes|Prices|Returns|Weights|Daily|Scorecard", tag("sheets: Notes, Prices, Returns, Weights, Daily, Scorecard, in that order"), book.names.join("|"));

  // Every formula cell: numeric, with a finite cached value, calling only known functions (the _xlfn. ones prefixed).
  const malformed = cells.filter((x) => x.cell.t !== "n" || !finite(x.cell.v) || x.cell.f.startsWith("="));
  const strange = [...new Set(cells.flatMap((x) => functionsIn(x.cell.f)))].filter((f) => !KNOWN.has(f));
  check(cells.length > 1000 && malformed.length === 0, tag("cached values: every formula cell is a number cell carrying a finite value"), malformed.slice(0, 3).map((x) => x.addr).join());
  check(strange.length === 0, tag("functions: every formula calls only functions the evaluator knows, newer ones with their _xlfn. prefix"), strange.join());

  // 1. The cached value is what the formula computes.
  const off = [];
  let threw = null;
  for (const x of cells) {
    let v;
    try {
      v = ev.value(x.sheet, x.addr);
    } catch (err) {
      threw = err.message;
      break;
    }
    if (!close(v, x.cell.v)) off.push(`${x.sheet}!${x.addr} =${x.cell.f}: cached ${x.cell.v}, evaluates to ${JSON.stringify(v)}`);
  }
  check(threw === null, tag("formulas: every one evaluates, with no range where one value belongs outside SUMPRODUCT"), threw ?? "");
  check(off.length === 0, tag("cached values: every formula cell's saved value is what its own formula computes"), off.slice(0, 3).join("; "));

  // The price-aligned sheets: Returns holds the page's returns, Daily the page's portfolio returns.
  const S = book.sheets;
  const retOk = a.tickers.every((_, i) => a.returns[i].every((x, t) => S.Returns[`${String.fromCharCode(66 + i)}${3 + t}`]?.v === x)) &&
    a.bench.every((x, t) => S.Returns[`${String.fromCharCode(66 + a.tickers.length)}${3 + t}`]?.v === x);
  check(retOk && /^Prices!B3\/Prices!B2-1$/.test(S.Returns.B3.f), tag("returns: each day's cached return is the page's own, as =close/previous close-1"), S.Returns.B3.f);

  // 2. Each Scorecard figure is the page's, found by the label and head the sheet prints.
  const sc = S.Scorecard;
  const heads = model.columns.map((col, k) => ({ col, k, letter: String.fromCharCode(68 + k) }));
  const headsOk = heads.every((h) => sc[`${h.letter}1`]?.v === h.col.label) && sc[`${String.fromCharCode(68 + model.columns.length - 1)}1`].v === a.benchLabel;
  check(headsOk, tag("scorecard sheet: the page's heads across, in the page's order, the benchmark last"), heads.map((h) => sc[`${h.letter}1`]?.v).join("|"));
  const labels = W.BOOK_ROWS.map((_, i) => sc[`B${3 + i}`]?.v);
  check(labels.join("|") === W.BOOK_ROWS.map((id) => (id === "sharpeSE" ? W.SE_LABEL : SC.SCORE_METRICS.find((m) => m.id === ({ sharpeSE: "sharpe" })[id] || m.id === id).label)).join("|"),
    tag("scorecard sheet: the 18 rows carry the page's own labels, the standard error under the Sharpe"), labels.join("|"));
  const mismatched = [];
  let figures = 0;
  for (const h of heads) {
    labels.forEach((label, i) => {
      const se = label === W.SE_LABEL;
      const metric = SC.SCORE_METRICS.find((m) => m.label === (se ? "Sharpe" : label));
      const want = h.col.ok ? page(model, metric.id, h.k, se) : null;
      const cell = sc[`${h.letter}${3 + i}`];
      if (!h.col.ok) {
        if (cell !== undefined) mismatched.push(`${h.col.id}/${label}: an empty column holds ${JSON.stringify(cell)}`);
        return;
      }
      if (!finite(want)) {
        if (!(cell?.t === "s" && cell.v === W.NOT_DEFINED && cell.f === undefined)) mismatched.push(`${h.col.id}/${label}: the page prints a dash, the book ${JSON.stringify(cell)}`);
        return;
      }
      figures += 1;
      const evaluated = cell?.f !== undefined ? ev.value("Scorecard", `${h.letter}${3 + i}`) : undefined;
      if (!(cell?.f !== undefined && close(cell.v, want) && close(evaluated, want))) mismatched.push(`${h.col.id}/${label}: page ${want}, cached ${cell?.v}, formula ${evaluated}`);
    });
  }
  check(figures > 60 && mismatched.length === 0, tag("scorecard sheet: every figure, cached and evaluated, equals the page's figure for its row and column"), `${figures} figures; ${mismatched.slice(0, 3).join("; ")}`);

  // The rate is the input: at another rate the book's Sharpe and Sortino move to the page's at that rate, and the weights stay.
  const rfAddr = Object.entries(S.Weights).find(([, x]) => x.t === "n" && x.v === a.rf && x.f === undefined)?.[0];
  const rf2 = a.rf + 0.0125;
  const moved = structuredClone(book);
  moved.sheets.Weights[rfAddr].v = rf2;
  const ev2 = evaluator(moved);
  const k0 = model.columns.findIndex((col) => col.ok && col.id !== "bench");
  const L0 = String.fromCharCode(68 + k0);
  const row2 = scorecardRow(portfolioReturns(a.returns, model.columns[k0].weights), a.bench, a.dates, a.prices.dates[0], rf2);
  const rowAt = (id) => 3 + W.BOOK_ROWS.indexOf(id);
  const weightsStay = cells.filter((x) => x.sheet === "Weights").every((x) => close(ev2.value("Weights", x.addr), x.cell.v));
  check(rfAddr !== undefined && close(ev2.value("Scorecard", `${L0}${rowAt("sharpe")}`), row2.sharpe) && close(ev2.value("Scorecard", `${L0}${rowAt("sortino")}`), row2.sortino) &&
    close(ev2.value("Scorecard", `${L0}${rowAt("alpha")}`), row2.alphaAnn) && close(ev2.value("Scorecard", `${L0}${rowAt("sharpeSE")}`), row2.sharpeSE) && weightsStay,
    tag("inputs: change the risk-free cell and the figures move to the page's at that rate; the weights do not"), `${rfAddr}`);

  // Weights: Equal-Weight as =1/n, the solved portfolios and the typed mix as the page's values, each summed by a formula.
  const n = a.tickers.length;
  const wcols = model.columns.filter((col) => col.id !== "bench");
  const wOk = wcols.every((col, j) => {
    const L = String.fromCharCode(66 + j);
    if (!col.weights) return a.tickers.every((_, i) => S.Weights[`${L}${3 + i}`] === undefined) && S.Weights[`${L}1`].v === col.label;
    return a.tickers.every((_, i) => {
      const x = S.Weights[`${L}${3 + i}`];
      return col.id === "ew" ? x.f === `1/${n}` && x.v === 1 / n : x.f === undefined && x.v === col.weights[i];
    }) && /^SUM\(/.test(S.Weights[`${L}${3 + n}`].f);
  });
  check(wOk, tag("weights: Equal-Weight is =1/n, the solved and typed weights are the page's values, each column summed by a formula"));
  const subs = wcols.map((col, j) => S.Weights[`${String.fromCharCode(66 + j)}2`]?.v ?? "");
  check(subs.filter((s, j) => wcols[j].ok && (wcols[j].id === "gmv" || wcols[j].id === "tangency")).every((s) => s.startsWith(FITTED)),
    tag("weights: each solved column says its weights were chosen on this window"), subs.join("|"));

  // Daily: running quantities are one formula per row on the row above, never a growing range.
  const daily = cells.filter((x) => x.sheet === "Daily");
  const growing = daily.filter((x) => /([A-Z]+)\$?(\d+):\$?\1\$?(\d+)/.test(x.cell.f) && !/^SUMPRODUCT\(Weights!/.test(x.cell.f));
  const rowOn = daily.find((x) => /wealth/.test(S.Daily[`${x.addr.replace(/\d+$/, "")}1`]?.v ?? "") && splitAddress(x.addr).r === 10);
  check(growing.length === 0 && rowOn !== undefined && /^[A-Z]+9\*\(1\+[A-Z]+10\)$/.test(rowOn.cell.f), tag("daily: wealth compounds on the row above, and no running figure reads a growing range"), rowOn?.cell.f ?? growing[0]?.cell.f);

  // Notes: in-sample, what was left out, the rate's source, the conventions, and no ranking words.
  const notes = Object.values(S.Notes).map((x) => x.v).join("\n");
  const inSample = Object.entries(S.Notes).find(([addr, x]) => addr.startsWith("A") && x.v === "In-sample")?.[0];
  const leftLabels = W.LEFT_OUT_IDS.map((id) => SC.SCORE_METRICS.find((m) => m.id === id).label);
  check(inSample !== undefined && /^Every figure is in-sample/.test(S.Notes[inSample.replace("A", "B")]?.v ?? "") && notes.includes(model.conventions) && leftLabels.every((l) => notes.includes(l)) && notes.includes(a.tickers.join(", ")) && /does not re-optimise/.test(notes),
    tag("notes: the basket, the conventions, in-sample, that the book does not re-optimise, and every row it leaves out"));
  const sheetText = Object.values(book.sheets).flatMap((s) => Object.values(s)).filter((x) => x.t === "s").map((x) => x.v).join("\n");
  check(!/\b(best|optimal|winner|wins|beats?|outperform\w*|race|contender)\b/i.test(sheetText.replace(/Best month/g, "")),
    tag("words: no ranking or contest word anywhere in the book"), (sheetText.match(/\b(best|optimal|winner|wins|beats?|outperform\w*|race|contender)\b/i) ?? [""])[0]);

  // A refused typed mix keeps its head and says why, with every cell empty.
  if (!c.ok) {
    const k = model.columns.findIndex((col) => col.id === "custom");
    const L = String.fromCharCode(68 + k);
    check(sc[`${L}1`].v === "Custom (not shown)" && sc[`${L}2`].v === CUSTOM_REFUSAL[c.reason] && W.BOOK_ROWS.every((_, i) => sc[`${L}${3 + i}`] === undefined),
      tag("refused: the typed mix keeps its column, headed with the page's reason and no figures"), sc[`${L}2`]?.v);
  }

  // 3. Desktop Excel, recalculating the same book, got the cached values; and the formulas are the ones it recalculated.
  const fx = excel.sets[set.id];
  check(fx !== undefined && fx.columns.join() === model.columns.map((x) => x.id).join() && fx.writtenWithoutValue === 0 && fx.excelFormulas === fx.formulas && fx.formulas === cells.length,
    tag("excel: the fixture covers this book's columns and every formula, each written with a value"), fx ? `${fx.columns.join()} ${fx.formulas} vs ${cells.length}` : "no fixture set");
  check(fx !== undefined && fx.hash === formulaHash(sheets), tag("excel: the book's formulas are the ones Excel recalculated (re-run test/oracle/excel_recalc.ps1 after changing them)"));
  const worst = fx ? Math.max(...Object.values(fx.sheets).map((s) => s.maxRel)) : Infinity;
  const stored = fx ? Object.entries(fx.values) : [];
  const drift = stored.filter(([key, v]) => {
    const [sheet, addr] = key.split("!");
    return !close(v, book.sheets[sheet][addr]?.v);
  });
  check(worst <= excel.rel && stored.length > 200 && drift.length === 0,
    tag("excel: its full recalculation equals every cached value, and the values kept in the fixture still match"), `worst ${worst}, ${drift.length} of ${stored.length} drifted ${drift[0]?.[0] ?? ""}`);
}

// A failed solve keeps its head, empty, with no Daily columns; nothing is drawn for it.
{
  const a = exampleAnalysis();
  const broken = { ...a, gmv: null };
  const model = SC.scorecard(broken, customWeights(broken, {}), { status: "ready", value: null });
  const sheets = W.scoreBook({ analysis: broken, model });
  const book = fromSheets(sheets);
  const evb = evaluator(book);
  const k = model.columns.findIndex((col) => col.id === "gmv");
  const L = String.fromCharCode(68 + k);
  const sc = book.sheets.Scorecard;
  const dailyHeads = Object.entries(book.sheets.Daily).filter(([addr]) => /^[A-Z]+1$/.test(addr)).map(([, x]) => x.v);
  check(sc[`${L}1`].v === failedLabel("gmv") && W.BOOK_ROWS.every((_, i) => sc[`${L}${3 + i}`] === undefined) && !dailyHeads.some((h) => h.startsWith("GMV")) &&
    model.columns[k].weights === null && formulaCells(book).every((x) => close(evb.value(x.sheet, x.addr), x.cell.v)),
    "failed: a failed solve keeps its head with empty cells and no daily columns, and the rest of the book still holds");
}

// Where the 5th percentile falls exactly on a day's return ((T - 1) x 0.05 a whole number), that day is in the
// shortfall, as the page counts it. On most windows the percentile falls between two days and "<" and "<="
// would agree, so this window is cut to make the difference visible.
{
  const a = exampleAnalysis();
  let T = a.dates.length;
  while (!Number.isInteger((T - 1) * 0.05)) T -= 1;
  const cut = (v, n) => v.slice(0, n);
  const short = {
    ...a,
    asOf: a.dates[T - 1],
    dates: cut(a.dates, T),
    returns: a.returns.map((r) => cut(r, T)),
    bench: cut(a.bench, T),
    prices: { ...a.prices, dates: cut(a.prices.dates, T + 1), values: a.prices.values.map((v) => cut(v, T + 1)) },
  };
  const model = SC.scorecard(short, customWeights(short, {}), { status: "ready", value: null });
  const evs = evaluator(fromSheets(W.scoreBook({ analysis: short, model })));
  const esRow = 3 + W.BOOK_ROWS.indexOf("es");
  const sorted = [...short.bench].sort((x, y) => x - y);
  const onADay = sorted[(T - 1) * 0.05] === -page(model, "var", model.columns.length - 1, false);
  const off = model.columns.map((col, k) => ({ col, k })).filter(({ k }) => !close(evs.value("Scorecard", `${String.fromCharCode(68 + k)}${esRow}`), page(model, "es", k, false)));
  check(onADay && off.length === 0, "tail: where the 5th percentile is a day's own return, the shortfall counts that day, as the page does",
    `${T} days, on a day ${onADay}, off ${off.map((x) => x.col.id).join()}`);
}

// The constructions a reader can add to the scorecard: each one shown is in the book, its weights entered as the
// page's values under its own head and sub-line, and every figure of its column, cached and evaluated, is the
// page's. Held on the example and the mega-cap fixture, and on the example with shorting on.
for (const [name, make] of [["example", () => exampleAnalysis()], ["megacap", () => fixtureAnalysis("megacap")], ["example, shorting on", () => exampleAnalysis({ allowShort: true })]]) {
  const tag = (s) => `${s} (${name})`;
  const a = make();
  const c = customWeights(a, {});
  const model = SC.scorecard(a, c, { status: "ready", value: null }, ADDED_IDS);
  const book = fromSheets(W.scoreBook({ analysis: a, model, refused: c.ok ? null : c.reason }));
  const ev = evaluator(book);
  const S = book.sheets;
  const added = model.columns.map((col, k) => ({ col, k, L: String.fromCharCode(68 + k) })).filter((x) => isAddedId(x.col.id));
  const labels = W.BOOK_ROWS.map((_, i) => S.Scorecard[`B${3 + i}`]?.v);
  const bad = [];
  let figures = 0;
  for (const { col, k, L } of added) {
    if (S.Scorecard[`${L}1`]?.v !== col.label) bad.push(`${col.id}: head ${S.Scorecard[`${L}1`]?.v}`);
    labels.forEach((label, i) => {
      const se = label === W.SE_LABEL;
      const metric = SC.SCORE_METRICS.find((m) => m.label === (se ? "Sharpe" : label));
      const want = page(model, metric.id, k, se);
      const cell = S.Scorecard[`${L}${3 + i}`];
      if (!finite(want)) {
        if (cell?.v !== W.NOT_DEFINED) bad.push(`${col.id}/${label}: the page prints a dash, the book ${JSON.stringify(cell)}`);
        return;
      }
      figures += 1;
      const got = cell?.f !== undefined ? ev.value("Scorecard", `${L}${3 + i}`) : undefined;
      if (!(close(cell.v, want) && close(got, want))) bad.push(`${col.id}/${label}: page ${want}, cached ${cell?.v}, formula ${got}`);
    });
  }
  check(added.length === ADDED_IDS.length && added.every((x) => x.col.ok) && figures >= added.length * 15 && bad.length === 0,
    tag("added columns: each is in the book under the page's head, and every figure, cached and evaluated, is the page's"), `${figures} figures; ${bad.slice(0, 3).join("; ")}`);
  const wcols = model.columns.filter((col) => col.id !== "bench").map((col, j) => ({ col, L: String.fromCharCode(66 + j) })).filter((x) => isAddedId(x.col.id));
  const wbad = wcols.filter(({ col, L }) => !(S.Weights[`${L}1`]?.v === col.label && S.Weights[`${L}2`]?.v === `${col.sub}, as values` &&
    a.tickers.every((_, i) => S.Weights[`${L}${3 + i}`]?.f === undefined && S.Weights[`${L}${3 + i}`]?.v === col.weights[i])));
  check(wcols.length === ADDED_IDS.length && wbad.length === 0, tag("added columns: their weights are the page's, entered as values, under the page's head and sub-line"), wbad.map((x) => x.col.id).join());
  const cells = formulaCells(book);
  const drift = cells.filter((x) => !close(ev.value(x.sheet, x.addr), x.cell.v));
  const words = Object.values(S).flatMap((s) => Object.values(s)).filter((x) => x.t === "s").map((x) => x.v).join("\n").replace(/Best month/g, "");
  check(drift.length === 0 && !/\b(best|optimal|winner|wins|beats?|outperform\w*|race|contender)\b/i.test(words),
    tag("added columns: every formula cell of the wider book still evaluates to its cached value, and no ranking word appears"), drift.slice(0, 2).map((x) => `${x.sheet}!${x.addr}`).join());
  // What the Notes say about them: each named with its own sub-line among the weights entered as values, the
  // last-year column's shorter window said where the book says what is in-sample, and a capped tangency or
  // risk parity that found nothing given its own reason, which is never the shorting switch.
  const notes = Object.fromEntries(W.bookNotes(a, model, null));
  const named = added.map(({ col }) => `${col.label} (${col.sub})`);
  check(named.every((s) => notes.Weights.includes(s)) && /does not re-optimise/.test(notes.Weights) &&
    notes["In-sample"].startsWith("Every figure is in-sample") && notes["In-sample"].includes(`last ${YEAR_ROWS} daily returns`),
    tag("added columns: the Notes name each one with its sub-line as entered values, and the last-year column's window"), `${notes.Weights} | ${notes["In-sample"]}`);
  // The capped tangency really finds none at a rate no mix reaches; risk parity's solve does not fail on these
  // prices, so its column is emptied by hand to read the words for a failed solve. Each reason is the page's own.
  const hiRate = name === "megacap" ? fixtureAnalysis("megacap", { rf: 1 }) : exampleAnalysis({ rf: 1, allowShort: a.allowShort });
  const hiModel = SC.scorecard(hiRate, customWeights(hiRate, {}), { status: "ready", value: null }, ADDED_IDS);
  const gone = { ...hiModel, columns: hiModel.columns.map((col) => (col.id === "rp" ? { ...col, label: addedMissingLabel("rp"), ok: false, weights: null } : col)) };
  const why = Object.fromEntries(W.bookNotes(hiRate, gone, null))["Not shown"] ?? "";
  const capWhy = `${addedMissingLabel("tan.cap")}: No long-only mix holding at most ${Math.round(CAP * 100)}% of each asset earns more than the ${format(hiRate.rf, "pct2")} risk-free rate on this window, so the page shows none.`;
  const rpWhy = `${addedMissingLabel("rp")}: The solve found no weights on this window, so the page shows none.`;
  const pageCap = hiModel.addedMissing.find((s) => s.startsWith(ADDED_LABEL["tan.cap"])) ?? "";
  check(why.includes(capWhy) && why.includes(rpWhy) && pageCap.endsWith(`${capWhy.slice(`${addedMissingLabel("tan.cap")}: N`.length, -", so the page shows none.".length)}.`),
    tag("added columns: a capped tangency or risk parity with no weights says why, in the page's words, and never blames the shorting switch"), `${why} | ${pageCap}`);
  // The Shorting line names the two constructions the switch does not reach, while it is on.
  const longOnly = `${ADDED_LABEL["tan.cap"]} and ${ADDED_LABEL.rp} are long-only whatever this switch says.`;
  check(a.allowShort ? notes.Shorting.endsWith(longOnly) : !notes.Shorting.includes("long-only"),
    tag("added columns: with shorting on, the Shorting note says the capped tangency and risk parity stay long-only"), notes.Shorting);
  // The note on how each row is computed says the Beta cell reads the raw returns, and it does: SLOPE over two plain ranges.
  const betaRow = W.BOOK_ROWS.indexOf("beta");
  const betaF = S.Scorecard[`D${3 + betaRow}`]?.f ?? "";
  check(betaRow >= 0 && /^(_xlfn\.)?SLOPE\([^()+*/-]+,[^()+*/-]+\)$/.test(betaF) && notes["How each row is computed"].includes("the Beta cell reads the raw returns"),
    tag("notes: the Beta cell is SLOPE over the raw returns, and the note says so"), betaF);
}

// The book loads on the click: nothing the page loads imports it statically. The scorecard imports the job that
// builds it (src/bookjob.ts) on the click; the job starts the worker, whose own chunk carries the book, and imports
// the book on the page's thread only when it has to build it there. A type-only import is erased and loads nothing.
{
  const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const card = src("../src/components/Scorecard.tsx");
  const job = src("../src/bookjob.ts");
  const loadsBook = (s) => /^import(?! type)[^\n]*(workbook|bookjob|bookworker)/m.test(s);
  check(/await import\("\.\.\/bookjob\.ts"\)/.test(card) && /import\("\.\/workbook\.ts"\)/.test(job) && /new Worker\(new URL\("\.\/bookworker\.ts", import\.meta\.url\)/.test(job) &&
    ![card, job, src("../src/bookmsg.ts"), src("../src/tabs/Optimization.tsx"), src("../src/App.tsx")].some(loadsBook),
    "loading: the workbook's code is imported on the click, never with the page");
  check(W.BOOK_FILENAME === "scorecard_model", "file: the book saves as scorecard_model.xlsx");
}

done("t-workbook");
