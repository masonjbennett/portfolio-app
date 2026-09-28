// Every number the page prints goes through format(). Tables and plates hold raw numbers and format
// them at render time; the CSV writes the raw number untouched, and the Excel export writes the raw
// number with the matching number format from the same table below, so a column reads the same on
// the page and in the spreadsheet.
//
// The app formats inside f-strings before a table is built (portfolio_app.py 1235-1242, 1687-1692),
// which is why its downloads carry text such as "12.34%" instead of numbers. The mapping here is the
// app's own: `:.2%` is pct2, `:.3f` (Sharpe, Sortino, skew, beta) is num3, `:.4f` (the weights copy
// at 1545) is num4, `${x:,.0f}` (the growth chart titles, 1258 and 1670) is usd0.
//
// Where the printed text departs from Python's, on purpose:
// - Negative numbers carry a true minus sign (U+2212), never a hyphen, so a signed column lines up in
//   JetBrains Mono's tabular figures. Downloads keep the plain "-" of the raw number.
// - A value that rounds to zero prints without a sign. Python prints "-0.00%" for -0.0 and for any
//   tiny negative (x > -0.00005), which reads as a loss that is not there.
// - NaN, null and the infinities print as a dash, never "nan%" or "Infinity".
// - Rounding: Python's `%` type multiplies by 100 in double precision and then rounds half-to-even on
//   the exact binary value; toFixed rounds exact binary ties up. A tie needs x*100 to land exactly on a
//   representable half at the last shown digit, which market returns do not do in practice.
import type { CellFormat, FormatId } from "./types.ts";

// What a missing or undefined value prints as: an en dash.
export const DASH = "\u2013";

// The typographic minus sign used on the page.
export const MINUS = "\u2212";

// Inserts thousands separators into the integer part of a toFixed string ("1234567.5" -> "1,234,567.5").
function group(fixed: string): string {
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

// Signs a magnitude that has already been printed. `digits` is the printed magnitude, so a value that
// rounded to zero ("0.00") never gets a minus.
function signed(x: number, digits: string, prefix = "", suffix = ""): string {
  const zero = !/[1-9]/.test(digits);
  return `${x < 0 && !zero ? MINUS : ""}${prefix}${digits}${suffix}`;
}

// An ISO day (YYYY-MM-DD, optionally with a time after it) printed as the day alone. Anything else
// prints as given: a formatter never throws, because a throw in render costs the whole card.
function isoDay(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(v);
  return m ? m[1] : v;
}

// Day number in Excel's 1900 date system (day 1 = 1900-01-01, with Excel's phantom 1900-02-29, so
// every date after February 1900 counts from 1899-12-30). null for anything that is not an ISO day.
export function excelSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // 2026-02-31 is not a day; Date.UTC would quietly roll it into March.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / 86_400_000 + 25_569;
}

interface Spec {
  /** Prints a finite number. */
  show: (x: number) => string;
  /** The Excel number-format code for the same column. */
  excel: string;
}

// The one table: how each FormatId prints on the page, and the Excel code its column carries.
export const FORMATS: Readonly<Record<FormatId, Spec>> = {
  pct2: { show: (x) => signed(x, Math.abs(x * 100).toFixed(2), "", "%"), excel: "0.00%" },
  pct1: { show: (x) => signed(x, Math.abs(x * 100).toFixed(1), "", "%"), excel: "0.0%" },
  num2: { show: (x) => signed(x, Math.abs(x).toFixed(2)), excel: "0.00" },
  num3: { show: (x) => signed(x, Math.abs(x).toFixed(3)), excel: "0.000" },
  num4: { show: (x) => signed(x, Math.abs(x).toFixed(4)), excel: "0.0000" },
  num6: { show: (x) => signed(x, Math.abs(x).toFixed(6)), excel: "0.000000" },
  int: { show: (x) => signed(x, group(Math.abs(x).toFixed(0))), excel: "#,##0" },
  usd0: { show: (x) => signed(x, group(Math.abs(x).toFixed(0)), "$"), excel: '"$"#,##0' },
  usd2: { show: (x) => signed(x, group(Math.abs(x).toFixed(2)), "$"), excel: '"$"#,##0.00' },
  // A date column holds ISO strings; a number here is an Excel serial and is printed as a number.
  date: { show: (x) => String(x), excel: "yyyy-mm-dd" },
};

// Excel number formats, one per FormatId, applied to raw numbers in the .xlsx export.
export const EXCEL_FORMATS: Readonly<Record<FormatId, string>> = Object.fromEntries(
  Object.entries(FORMATS).map(([id, spec]) => [id, spec.excel]),
) as Record<FormatId, string>;

// True for a label column ("text"): left-aligned and never given a number format.
export function isText(id: CellFormat): id is "text" {
  return id === "text";
}

// The text a cell shows. null, NaN and the infinities print as DASH; a string in a numeric column is
// printed as given (ISO dates are cut to the day), since a formatter must never throw inside render.
export function format(value: number | string | null, id: CellFormat): string {
  if (value === null || value === undefined) return DASH;
  if (typeof value === "string") return id === "date" ? isoDay(value) : value;
  if (id === "text") return Number.isFinite(value) ? String(value) : DASH;
  if (!Number.isFinite(value)) return DASH;
  return FORMATS[id].show(value);
}
