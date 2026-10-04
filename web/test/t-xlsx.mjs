// The workbook evaluator (test/_xlsx.mjs) against desktop Excel. test/fixtures/xlsx-oracle.xlsx was built by
// test/oracle/xlsx_oracle.ps1 through Excel itself, so every cached answer in it is Excel's own. The evaluator
// must reproduce each one, and every function it knows must have a case there: a function the oracle never
// exercised is a function whose answer nobody checked.
import { check, done } from "./_assert.mjs";
import { evaluator, formulaCells, fromSheets, functionsIn, KNOWN, numberText, readXlsx, shiftFormula, unzip } from "./_xlsx.mjs";

const ORACLE = new URL("./fixtures/xlsx-oracle.xlsx", import.meta.url);
const book = readXlsx(ORACLE);
const cases = formulaCells(book);
const e = evaluator(book);

// Numbers agree to 1e-12 relative (Excel's summation order is its own); everything else exactly.
const agree = (got, want) => {
  if (typeof want === "number") return typeof got === "number" && Math.abs(got - want) <= Math.max(1e-12 * Math.abs(want), 1e-16);
  return JSON.stringify(got) === JSON.stringify(want);
};

check(book.names.join("|") === "Cases|Data|Other Data" && cases.length >= 80 && book.formulaWithoutValue.length === 0,
  "oracle: the file reads, with its three sheets, every case, and a cached value for each", `${book.names.join("|")} ${cases.length} ${book.formulaWithoutValue.length}`);

// The fixture is published with the code, so it carries nothing about who saved it or where: Excel writes the
// author, the last author and the folder it saved into, and xlsx_oracle.ps1 empties all three after saving.
{
  const parts = unzip(ORACLE);
  const core = parts["docProps/core.xml"]?.toString("utf8") ?? "";
  const wb = parts["xl/workbook.xml"]?.toString("utf8") ?? "";
  const kept = [
    /<dc:creator>[^<]+<\/dc:creator>/.test(core) && "author",
    /<cp:lastModifiedBy>[^<]+<\/cp:lastModifiedBy>/.test(core) && "last author",
    /absPath/.test(wb) && "saved-in folder",
    /[A-Z]:\\Users\\/i.test(Object.values(parts).map((b) => b.toString("latin1")).join("")) && "a local path",
  ].filter(Boolean);
  check(core.length > 0 && wb.length > 0 && kept.length === 0, "oracle: the file names no author, no last author and no folder it was saved in", kept.join(", "));
}

const wrong = [];
for (const x of cases) {
  let got;
  try {
    got = e.value(x.sheet, x.addr);
  } catch (err) {
    got = `threw: ${err.message}`;
  }
  if (!agree(got, x.cell.v)) wrong.push(`${x.sheet}!${x.addr} =${x.cell.f}: Excel ${JSON.stringify(x.cell.v)}, evaluator ${JSON.stringify(got)}`);
}
check(wrong.length === 0, "evaluator: every oracle formula evaluates to the answer desktop Excel cached", wrong.slice(0, 4).join("; "));

// Each feature the book leans on has its own case, found by its formula, so a deleted case is noticed.
const caseOf = (f) => cases.find((x) => x.cell.f === f);
const want = (f, v) => {
  const x = caseOf(f);
  try {
    return x !== undefined && agree(e.value(x.sheet, x.addr), v) && agree(x.cell.v, v);
  } catch {
    return false;
  }
};
check(want("-2^2", 4) && want("2^3^2", 64) && want("-(2^2)", -4) && want("2*-3", -6),
  "precedence: unary minus binds tighter than ^, and ^ reads left to right, as Excel does");
check(want("1+2&\"x\"", "3x") && want("1+2<4", true) && want("1/3&\"\"", "0.333333333333333"),
  "precedence: & sits below + and above the comparisons, and a number joins text at 15 significant digits");
check(want("1/0", { error: "#DIV/0!" }) && want("SUMPRODUCT(Data!A1:A8,Data!A10:D10)", { error: "#VALUE!" }),
  "errors: a division by zero and SUMPRODUCT over ranges of different shapes are Excel's errors, not numbers");
check(caseOf("Data!$A$1+Data!A$2+Data!$A3") !== undefined && caseOf("'Other Data'!C1+1") !== undefined && caseOf("SUM('Other Data'!B1:B3)") !== undefined,
  "references: absolute, mixed, cross-sheet and quoted sheet names each have a case");
check(caseOf("AVERAGEIF(Data!D1:D4,\"<=\"&Data!D1)") !== undefined && want("Data!D1<=-0.0123456789012346", true) && want("0.1+0.2=0.3", true) && want("1+0.00000000000001=1", false),
  "comparisons: numbers that agree to 15 significant digits are equal, in a criterion, a comparison and SUMPRODUCT alike");
check(caseOf("_xlfn.PERCENTILE.INC(Data!A1:A8,0.05)") !== undefined && caseOf("SKEW(Data!A1:A8)") !== undefined && caseOf("KURT(Data!A1:A8)") !== undefined,
  "statistics: an interpolated percentile, and SKEW and KURT on a short skewed series, each have a case");

// KNOWN and the oracle cover each other: every known function is exercised, and the oracle uses nothing unknown.
const used = new Set(cases.flatMap((x) => functionsIn(x.cell.f)));
const untested = [...KNOWN].filter((f) => !used.has(f));
const unknown = [...used].filter((f) => !KNOWN.has(f));
check(untested.length === 0 && unknown.length === 0, "KNOWN: every function the evaluator knows has an oracle case, and the oracle calls no other",
  `untested ${untested.join(",")} unknown ${unknown.join(",")}`);

// What it does not know, it refuses by name; and a range where one value belongs outside SUMPRODUCT throws.
const tiny = fromSheets([{ name: "S", sheet: { A1: { t: "n", v: 1 }, A2: { t: "n", v: 2 }, B1: { t: "n", v: 1.5, f: "MEDIAN(A1:A2)" }, B2: { t: "n", v: 2, f: "A1:A2*2" }, B3: { t: "n", v: 1, f: "STDEV.S(A1:A2)" } } }]);
const throws = (addr, re) => {
  try {
    evaluator(tiny).value("S", addr);
    return false;
  } catch (err) {
    return re.test(err.message);
  }
};
check(throws("B1", /unknown function MEDIAN/), "KNOWN: a function outside it throws, naming the function");
check(throws("B2", /implicit intersection/), "arrays: a range used as one value outside SUMPRODUCT throws instead of reading one cell");
check(throws("B3", /unknown function STDEV\.S/), "prefix: STDEV.S without its _xlfn. prefix is refused, as Excel would show #NAME?");

// A shared formula's follower is its master moved; $-anchored parts stay put.
check(shiftFormula("Data!A1*$B$2+'Other Data'!C$3-SUM(D4:E5)", 2, 1) === "Data!B3*$B$2+'Other Data'!D$3-SUM(E6:F7)",
  "shared formulas: relative references move with the cell, anchored ones do not");
check(numberText(-0.012345678901234567) === "-0.0123456789012346" && numberText(1.5) === "1.5" && numberText(1e21) === "1E+21",
  "text: a number joins text as Excel's General writes it, 15 significant digits");

done("t-xlsx");
