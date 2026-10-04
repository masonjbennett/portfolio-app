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

// The book loads on the click: nothing imports it statically, and the scorecard imports it dynamically.
{
  const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const card = src("../src/components/Scorecard.tsx");
  check(/await import\("\.\.\/workbook\.ts"\)/.test(card) && !/^import[^\n]*workbook/m.test(card) && !/^import[^\n]*workbook/m.test(src("../src/tabs/Optimization.tsx")) && !/^import[^\n]*workbook/m.test(src("../src/App.tsx")),
    "loading: the workbook's code is imported on the click, never with the page");
  check(W.BOOK_FILENAME === "scorecard_model", "file: the book saves as scorecard_model.xlsx");
}

done("t-workbook");
