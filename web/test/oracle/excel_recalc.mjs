// The node half of test/oracle/excel_recalc.ps1, and the book sets test/t-workbook.mjs builds.
//
//   build   --sheetjs <xlsx.mjs> --out <dir> [--columns a,b]
//     Writes one .xlsx per set into <dir> through src/download.ts's writeBook and the SheetJS build the page
//     loads, and refuses any file whose XML has a formula with no cached value.
//   compare --dir <dir> --excel <version> --sheetjs-url <url> [--columns a,b]
//     Reads <dir>/<set>.excel.json (every formula cell as desktop Excel recalculated it), holds each value to
//     the cached value the book was saved with, and writes test/fixtures/workbook-excel.json: the formulas'
//     hash, every cell's largest difference per sheet, and Excel's values for the Scorecard and Weights
//     sheets and for sampled rows of Returns and Daily, which t-workbook holds again on every run.
//
// Run under the suites' loader: node --import ./test/_tsx.mjs test/oracle/excel_recalc.mjs <mode> ...
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exampleAnalysis, fixtureAnalysis } from "../_analysis.mjs";
import { formulaCells, fromSheets, readXlsx, splitAddress, unzip } from "../_xlsx.mjs";

const { scorecard } = await import("../../src/tabs/optimization/scorecard.ts");
const { customWeights } = await import("../../src/tabs/optimization/model.ts");
const { scoreBook } = await import("../../src/workbook.ts");
const { writeBook } = await import("../../src/download.ts");

export const FIXTURE = fileURLToPath(new URL("../fixtures/workbook-excel.json", import.meta.url));

// How close two values must be: relative, with a floor for figures that are zero by construction (the
// benchmark's alpha and tracking error against itself).
export const REL = 1e-9;
export const FLOOR = 1e-14;
export const close = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= Math.max(REL * Math.max(Math.abs(a), Math.abs(b)), FLOOR);

// The sets: the cross-asset example and the mega-cap fixture long-only, and the cross-asset example with
// shorting on. Each carries a different typed mix: an uneven one, the untouched default (equal weights),
// and a refused one (every weight zero), so the book's three kinds of Custom column are all built.
export const SETS = [
  { id: "cross", what: "cross-asset example, long-only, an uneven typed mix", analysis: () => exampleAnalysis(), mix: (a) => Object.fromEntries(a.tickers.map((t, i) => [t, (i + 1) / 10])), amount: 10_000 },
  { id: "megacap", what: "mega-cap fixture, long-only, the default mix", analysis: () => fixtureAnalysis("megacap"), mix: () => ({}), amount: 2_500 },
  { id: "cross-short", what: "cross-asset example, shorting on, a refused mix", analysis: () => exampleAnalysis({ allowShort: true }), mix: (a) => Object.fromEntries(a.tickers.map((t) => [t, 0])), amount: 10_000 },
];

const READY = { status: "ready", value: null };

/**
 * The scorecard model for a set, with the added columns named. scorecard() builds every one the basket can
 * have; a named column it could not build is an error, so the fixture never claims a column the book did not
 * carry.
 */
export function modelFor(a, c, added = []) {
  const model = scorecard(a, c, READY, added);
  for (const id of added) if (!model.columns.some((x) => x.id === id)) throw new Error(`the scorecard has no column "${id}": hand it to scorecard() in modelFor first`);
  return model;
}

/** A set's analysis, typed mix, model and book sheets. */
export function buildSet(set, added = []) {
  const a = set.analysis();
  const c = customWeights(a, set.mix(a));
  const model = modelFor(a, c, added);
  const sheets = scoreBook({ analysis: a, model, amount: set.amount, refused: c.ok ? null : c.reason });
  return { a, c, model, sheets };
}

/** A hash of every formula in the book, by sheet and address, so a changed formula is noticed. */
export function formulaHash(sheets) {
  const h = createHash("sha256");
  for (const x of formulaCells(fromSheets(sheets))) h.update(`${x.sheet}!${x.addr}=${x.cell.f}\n`);
  return h.digest("hex");
}

// Rows of Returns and Daily whose values are kept in the fixture: the first close, the first return, every
// 50th row, and the last.
export const sampled = (row, last) => row <= 3 || row % 50 === 0 || row === last;

function args() {
  const out = { _: [] };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (v[i].startsWith("--")) out[v[i].slice(2)] = v[++i];
    else out._.push(v[i]);
  }
  out.columns = out.columns ? out.columns.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return out;
}

async function build(o) {
  const XLSX = await import(pathToFileURL(o.sheetjs).href);
  for (const set of SETS) {
    const { sheets } = buildSet(set, o.columns);
    const bytes = Buffer.from(writeBook(XLSX, sheets));
    const file = join(o.out, `${set.id}.xlsx`);
    writeFileSync(file, bytes);
    // Straight from the XML: every <f> is followed by a <v> inside the same cell.
    let formulas = 0;
    const missing = [];
    for (const [name, xml] of Object.entries(unzip(bytes))) {
      if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
      for (const m of xml.toString("utf8").matchAll(/<c r="([A-Z]+\d+)"[^>]*>(<f>[\s\S]*?<\/f>)([\s\S]*?)<\/c>/g)) {
        formulas += 1;
        if (!/^<v>[^<]+<\/v>$/.test(m[3])) missing.push(`${name} ${m[1]}`);
      }
    }
    if (missing.length) throw new Error(`${file}: ${missing.length} formulas saved with no value, first ${missing[0]}`);
    console.log(`built ${file}: ${formulas} formulas, each with a value, ${(bytes.length / 1024).toFixed(0)} KB`);
  }
}

function compare(o) {
  const out = {
    about: "Desktop Excel's recalculation of the scorecard workbook, written by test/oracle/excel_recalc.ps1. Do not edit by hand.",
    excel: o.excel,
    sheetjs: o["sheetjs-url"],
    added: o.columns,
    rel: REL,
    floor: FLOOR,
    sets: {},
  };
  let bad = 0;
  for (const set of SETS) {
    const { sheets, model } = buildSet(set, o.columns);
    const book = fromSheets(sheets);
    const lastRow = Object.fromEntries(book.names.map((n) => [n, Math.max(...Object.keys(book.sheets[n]).map((k) => splitAddress(k).r))]));
    const excel = JSON.parse(readFileSync(join(o.dir, `${set.id}.excel.json`), "utf8"));
    const written = readXlsx(join(o.dir, `${set.id}.xlsx`));
    const per = {};
    const values = {};
    for (const x of formulaCells(book)) {
      const got = excel[x.sheet]?.[x.addr];
      const s = (per[x.sheet] ??= { cells: 0, maxRel: 0 });
      s.cells += 1;
      if (!close(got, x.cell.v)) {
        bad += 1;
        if (bad <= 10) console.log(`  DIFFERS ${set.id} ${x.sheet}!${x.addr} =${x.cell.f}: Excel ${JSON.stringify(got)}, saved ${x.cell.v}`);
        s.maxRel = Infinity;
      } else {
        const d = Math.abs(got - x.cell.v) / Math.max(Math.abs(x.cell.v), Math.abs(got), FLOOR);
        if (d > s.maxRel) s.maxRel = d;
      }
      if (x.sheet === "Scorecard" || x.sheet === "Weights" || sampled(x.r, lastRow[x.sheet])) values[`${x.sheet}!${x.addr}`] = got;
    }
    const excelCount = Object.values(excel).reduce((n, s) => n + Object.keys(s).length, 0);
    out.sets[set.id] = {
      what: set.what,
      columns: model.columns.map((c) => c.id),
      formulas: Object.values(per).reduce((n, s) => n + s.cells, 0),
      excelFormulas: excelCount,
      writtenWithoutValue: written.formulaWithoutValue.length,
      hash: formulaHash(sheets),
      sheets: per,
      values,
    };
    console.log(`${set.id}: ${out.sets[set.id].formulas} formulas, Excel read back ${excelCount}, ${JSON.stringify(Object.fromEntries(Object.entries(per).map(([k, s]) => [k, s.maxRel])))}`);
  }
  if (bad) throw new Error(`${bad} formula cells differ from Excel's recalculation; the fixture was not written`);
  writeFileSync(FIXTURE, JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${FIXTURE}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const o = args();
  const mode = o._[0];
  if (mode === "build") await build(o);
  else if (mode === "compare") compare(o);
  else {
    console.error("usage: excel_recalc.mjs build|compare ...");
    process.exit(2);
  }
}
