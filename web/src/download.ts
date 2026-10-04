// Table downloads. Both files carry the table's raw NUMBERS, never the text the page prints.
//
// The app builds its tables out of f-strings (portfolio_app.py 1235-1242, 1687-1692) and hands those
// frames to to_csv and df_to_excel (516-521, 1702), so its downloads hold text: a CSV cell reads
// "12.34%" and an Excel cell is the STRING "12.34%", which a spreadsheet cannot sum or chart. Here:
// - CSV: a header row of the column labels, then one line per row. Numbers at full precision with no
//   "%" or "$" (0.1234, not 12.34%), ISO dates, empty for a missing value, "\n" line ends, UTF-8.
// - Excel: one sheet; every number is a numeric cell (t "n") carrying its column's Excel number format
//   in z, so it DISPLAYS as 12.34% and still holds 0.1234. Dates are Excel day numbers formatted
//   yyyy-mm-dd.
//
// SheetJS is loaded from its own CDN only when someone clicks Excel, never bundled: the npm "xlsx"
// package stopped at 0.18.5 and carries unfixed advisories. Building the sheet is the pure function
// worksheet(), so node tests the cells without the CDN.
import { EXCEL_FORMATS, excelSerial, isText } from "./format.ts";
import type { CellFormat, Column, TableRow } from "./types.ts";

// The SheetJS build loaded at click time.
export const SHEETJS_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

// One spreadsheet cell in SheetJS's shape: s = text, n = number (z = its number format).
export type Cell = { t: "s"; v: string } | { t: "n"; v: number; z?: string };

// A formula cell: f is the formula without its leading "=", v the value it is saved with. Excel shows that
// value until it recalculates, and so does every viewer that never calculates (a phone's preview, a mail
// attachment), so v must be the formula's own answer. A function newer than Excel 2007 is written with its
// _xlfn. prefix (_xlfn.STDEV.S), as Excel itself stores it; without the prefix Excel shows #NAME?.
export interface FormulaCell {
  t: "n";
  v: number;
  f: string;
  z?: string;
}

// A SheetJS worksheet: cells keyed by A1 address, plus the used range and column widths.
export interface Worksheet {
  [address: string]: Cell | FormulaCell | string | { wch: number }[];
  "!ref": string;
  "!cols": { wch: number }[];
}

// ---- CSV ---------------------------------------------------------------------------------------

// Quotes a field only when it needs it (a comma, a quote, or a line break), as pandas' to_csv does.
function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// A raw value as CSV text: numbers by their shortest round-trip form, missing values empty.
function csvValue(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return csvField(v);
}

// The CSV text: a header row of labels, then one line per row, raw numbers unformatted.
export function csvText(columns: Column[], rows: TableRow[]): string {
  const lines = [columns.map((c) => csvField(c.label)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvValue(row[c.key])).join(","));
  return lines.join("\n") + "\n";
}

// ---- Excel ------------------------------------------------------------------------------------

// Column letters: 0 -> A, 25 -> Z, 26 -> AA.
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// A sheet name Excel accepts: at most 31 characters, none of : \ / ? * [ ].
export function sheetName(title: string): string {
  const clean = title.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).trim();
  return clean || "Sheet1";
}

// One body cell, or null for a blank. A number in a numeric column is a number cell with the
// column's format; an ISO day in a date column becomes Excel's day number; labels stay text.
export function cellFor(value: number | string | null | undefined, column: Column): Cell | null {
  if (value === null || value === undefined) return null;
  const fmt = column.format;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return isText(fmt) ? { t: "s", v: String(value) } : { t: "n", v: value, z: EXCEL_FORMATS[fmt] };
  }
  if (fmt === "date") {
    const serial = excelSerial(value);
    if (serial !== null) return { t: "n", v: serial, z: EXCEL_FORMATS.date };
  }
  return { t: "s", v: value };
}

// The worksheet for a table: labels in row 1, one row per table row, blanks left out. A table whose rows
// each measure something different (a scorecard: a percent on one row, a day count on the next) passes
// `rowFormats`, one per row: that row's numbers carry its format instead of their column's. Label
// columns stay text either way.
export function worksheet(columns: Column[], rows: TableRow[], rowFormats?: readonly CellFormat[]): Worksheet {
  const ws: Worksheet = {
    "!ref": `A1:${colName(Math.max(columns.length, 1) - 1)}${rows.length + 1}`,
    "!cols": columns.map((c) => ({ wch: Math.max(10, c.label.length + 2) })),
  };
  columns.forEach((c, j) => {
    ws[`${colName(j)}1`] = { t: "s", v: c.label };
    rows.forEach((row, i) => {
      const own = rowFormats?.[i];
      const cell = cellFor(row[c.key], own && !isText(c.format) ? { ...c, format: own } : c);
      if (cell) ws[`${colName(j)}${i + 2}`] = cell;
    });
  });
  return ws;
}

// ---- saving -----------------------------------------------------------------------------------

// Hands the browser a file to save.
function save(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Saves `<filename>.csv`.
export function downloadCsv(filename: string, columns: Column[], rows: TableRow[]): void {
  save(`${filename}.csv`, new Blob([csvText(columns, rows)], { type: "text/csv;charset=utf-8" }));
}

// The slice of SheetJS this file calls.
interface SheetJS {
  utils: {
    book_new(): unknown;
    book_append_sheet(book: unknown, sheet: Worksheet, name: string): void;
  };
  write(book: unknown, opts: { bookType: "xlsx"; type: "array"; compression?: boolean }): ArrayBuffer;
}

// One load per page; a failed load is forgotten so the next click tries again.
let sheetjs: Promise<SheetJS> | null = null;
function loadSheetJS(): Promise<SheetJS> {
  // A string variable, so neither TypeScript nor Vite tries to resolve the URL at build time.
  const url: string = SHEETJS_URL;
  sheetjs ??= (import(/* @vite-ignore */ url) as Promise<SheetJS>).catch((err: unknown) => {
    sheetjs = null;
    throw err;
  });
  return sheetjs;
}

// One sheet of a book of several, in the order the book lists them.
export interface BookSheet {
  name: string;
  sheet: Worksheet;
}

// The slice of SheetJS writeBook calls: the same two utilities and write() the page's own load returns.
export type BookWriter = Pick<SheetJS, "utils" | "write">;

// The .xlsx bytes of a book of several sheets, written by the SheetJS build handed in. Pure apart from that
// build, so the script that has desktop Excel recalculate the book writes it through this same function.
// Compressed: a book of formulas over every trading day is mostly repeated XML, and deflating it halves the
// file at no cost in time.
export function writeBook(XLSX: BookWriter, sheets: readonly BookSheet[]): ArrayBuffer {
  const book = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(book, s.sheet, sheetName(s.name));
  return XLSX.write(book, { bookType: "xlsx", type: "array", compression: true });
}

// Saves `<filename>.xlsx` holding every sheet in `sheets`. Rejects when SheetJS cannot be loaded.
export async function downloadBook(filename: string, sheets: readonly BookSheet[]): Promise<void> {
  const XLSX = await loadSheetJS();
  save(`${filename}.xlsx`, new Blob([writeBook(XLSX, sheets)], { type: XLSX_TYPE }));
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Saves `<filename>.xlsx` with one sheet named `sheet`. Rejects when SheetJS cannot be loaded.
export async function downloadXlsx(filename: string, sheet: string, columns: Column[], rows: TableRow[], rowFormats?: readonly CellFormat[]): Promise<void> {
  const XLSX = await loadSheetJS();
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, worksheet(columns, rows, rowFormats), sheetName(sheet));
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" });
  save(`${filename}.xlsx`, new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
