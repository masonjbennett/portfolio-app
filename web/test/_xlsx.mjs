// An .xlsx reader on node:zlib alone, and an evaluator for the formulas the scorecard workbook writes
// (src/workbook.ts). A helper, not a suite: the leading underscore keeps it out of test/run.mjs.
//
// Two jobs, both so a check never trusts the code that wrote a cached value:
// - readXlsx() opens a file the way Excel saved it (shared strings, shared formulas, booleans, errors), so
//   t-xlsx can hold the evaluator to the answers desktop Excel cached in test/fixtures/xlsx-oracle.xlsx.
// - evaluateBook() works out every formula from the cells it refers to, on a book read from a file or on the
//   sheets src/workbook.ts builds, so t-workbook can hold each cached value to its own formula.
//
// It evaluates a SUBSET of Excel and refuses the rest by name. KNOWN lists every function it evaluates, and a
// function enters KNOWN only with a case in the oracle workbook: anything else throws "unknown function",
// rather than returning something that merely looks plausible. A range used where one value is expected
// outside SUMPRODUCT throws too, because a formula read from a file gets implicit intersection there and
// would quietly read one cell.
//
// Precedence, lowest first: comparisons (= <> < > <= >=), & (joins text), + and -, * and /, ^ (left to
// right: 2^3^2 is 64), then unary minus, which binds tighter than ^ (so =-2^2 is 4).
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export const KNOWN = new Set([
  "SUM", "AVERAGE", "COUNT", "MIN", "MAX", "SQRT", "ABS", "SUMPRODUCT",
  "_XLFN.STDEV.S", "_XLFN.PERCENTILE.INC", "SKEW", "KURT", "SLOPE", "INTERCEPT", "CORREL", "AVERAGEIF",
]);

// ---- the zip and the XML ------------------------------------------------------------------------------

// Every entry of a zip, by name. It walks the central directory, so an entry whose sizes sit in a data
// descriptor after its body (zeros in the local header) still reads.
export function unzip(src) {
  const b = Buffer.isBuffer(src) ? src : src instanceof ArrayBuffer || ArrayBuffer.isView(src) ? Buffer.from(src.buffer ?? src, src.byteOffset ?? 0, src.byteLength) : readFileSync(src);
  let end = b.length - 22;
  while (end >= 0 && b.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip file");
  const count = b.readUInt16LE(end + 10);
  let p = b.readUInt32LE(end + 16);
  const out = {};
  for (let k = 0; k < count; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("the zip's central directory is damaged");
    const method = b.readUInt16LE(p + 10);
    const size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nameLen);
    const body = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(body, body + size);
    if (method !== 0 && method !== 8) throw new Error(`${name}: compression method ${method} is not read here`);
    out[name] = method === 0 ? raw : inflateRawSync(raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const xmlText = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");

// Column letters and numbers, 0-based: A is 0, Z is 25, AA is 26.
export const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const colLetters = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export function splitAddress(addr) {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(addr);
  if (!m) throw new Error(`not a cell address: ${addr}`);
  return { c: colIndex(m[1]), r: Number(m[2]) };
}

/**
 * A workbook read from a file: { names: [sheet names in order], sheets: { name: { A1: cell } } }, a cell being
 * { f: formula without "=" or undefined, v: cached value (number, string, boolean, { error }) or null, t }.
 * Also `formulaWithoutValue`: every formula cell the file saved with no <v>, by "Sheet!A1".
 */
export function readXlsx(src) {
  const z = unzip(src);
  const text = (name) => {
    if (!z[name]) throw new Error(`${name} is not in the file`);
    return z[name].toString("utf8");
  };
  const shared = z["xl/sharedStrings.xml"]
    ? [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join(""))
    : [];
  const rels = Object.fromEntries([...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => {
    const id = /\bId="([^"]+)"/.exec(m[1])[1];
    const target = /\bTarget="([^"]+)"/.exec(m[1])[1];
    return [id, target.startsWith("/") ? target.slice(1) : `xl/${target}`];
  }));
  const names = [];
  const sheets = {};
  const formulaWithoutValue = [];
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = xmlText(/\bname="([^"]*)"/.exec(m[1])[1]);
    const rid = /\br:id="([^"]+)"/.exec(m[1])[1];
    names.push(name);
    const cells = {};
    const masters = {};
    for (const c of text(rels[rid]).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)[1];
      const t = (/\bt="([^"]+)"/.exec(attrs) ?? [])[1] ?? "n";
      let f;
      const fm = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
      if (fm) {
        const fattrs = fm[1];
        const body = fm[2] ? xmlText(fm[2]) : "";
        const si = (/\bsi="(\d+)"/.exec(fattrs) ?? [])[1];
        if (/\bt="array"/.test(fattrs)) throw new Error(`${name}!${ref} is an array formula, which this evaluator does not read`);
        if (si !== undefined && /\bt="shared"/.test(fattrs)) {
          if (body) masters[si] = { ref, f: body };
          const master = masters[si];
          if (!master) throw new Error(`${name}!${ref}: shared formula ${si} comes before its master`);
          const from = splitAddress(master.ref);
          const to = splitAddress(ref);
          f = shiftFormula(master.f, to.r - from.r, to.c - from.c);
        } else f = body;
      }
      const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
      const raw = vm ? xmlText(vm[1]) : null;
      let v = null;
      if (t === "s") v = shared[Number(raw)];
      else if (t === "inlineStr") v = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xmlText(x[1])).join("");
      else if (t === "str") v = raw ?? (/<v\s*\/>/.test(inner) ? "" : null);
      else if (t === "b") v = raw === null ? null : raw === "1";
      else if (t === "e") v = raw === null ? null : { error: raw };
      else v = raw === null || raw === "" ? null : Number(raw);
      if (f !== undefined && !vm && !/<v\s*\/>/.test(inner)) formulaWithoutValue.push(`${name}!${ref}`);
      if (f === undefined && v === null) continue;
      cells[ref] = { f, v, t };
    }
    sheets[name] = cells;
  }
  return { names, sheets, formulaWithoutValue };
}

// ---- the tokenizer and the parser --------------------------------------------------------------------

const CELL = String.raw`\$?[A-Z]{1,3}\$?\d+`;
const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!`;
const REF = new RegExp(`^(?:${SHEET})?(${CELL})(?::(${CELL}))?(?![A-Za-z0-9_(.])`);
const FUNC = /^([A-Za-z_][A-Za-z0-9_.]*)\(/;
const NUM = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const OPS = ["<=", ">=", "<>", "+", "-", "*", "/", "^", "&", "=", "<", ">", "(", ")", ","];

export function tokenize(src) {
  const out = [];
  let s = src.startsWith("=") ? src.slice(1) : src;
  while (s.length) {
    const ws = /^\s+/.exec(s);
    if (ws) {
      s = s.slice(ws[0].length);
      continue;
    }
    let m;
    if (s[0] === '"') {
      let i = 1;
      let v = "";
      for (;;) {
        if (i >= s.length) throw new Error(`unterminated text in ${src}`);
        if (s[i] === '"') {
          if (s[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          break;
        }
        v += s[i++];
      }
      out.push({ k: "str", v });
      s = s.slice(i + 1);
    } else if ((m = REF.exec(s))) {
      const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2];
      out.push({ k: "ref", sheet, a: m[3], b: m[4], quoted: m[1] !== undefined });
      s = s.slice(m[0].length);
    } else if ((m = FUNC.exec(s))) {
      out.push({ k: "fn", v: m[1].toUpperCase() });
      s = s.slice(m[0].length);
    } else if ((m = /^(TRUE|FALSE)(?![A-Za-z0-9_(.])/i.exec(s))) {
      out.push({ k: "bool", v: m[1].toUpperCase() === "TRUE" });
      s = s.slice(m[0].length);
    } else if ((m = NUM.exec(s))) {
      out.push({ k: "num", v: Number(m[0]) });
      s = s.slice(m[0].length);
    } else {
      const op = OPS.find((o) => s.startsWith(o));
      if (!op) throw new Error(`cannot read "${s.slice(0, 20)}" in ${src}`);
      out.push({ k: "op", v: op });
      s = s.slice(op.length);
    }
  }
  return out;
}

// A formula moved by (dRow, dCol), as Excel derives a shared formula's followers from its master: relative
// parts of a reference move, $-anchored parts stay.
export function shiftFormula(f, dRow, dCol) {
  const move = (addr) => {
    const m = /^(\$?)([A-Z]{1,3})(\$?)(\d+)$/.exec(addr);
    return `${m[1]}${m[1] ? m[2] : colLetters(colIndex(m[2]) + dCol)}${m[3]}${m[3] ? m[4] : Number(m[4]) + dRow}`;
  };
  return tokenize(f).map((t) => {
    if (t.k === "ref") {
      const sheet = t.sheet === undefined ? "" : t.quoted ? `'${t.sheet.replace(/'/g, "''")}'!` : `${t.sheet}!`;
      return `${sheet}${move(t.a)}${t.b ? `:${move(t.b)}` : ""}`;
    }
    if (t.k === "str") return `"${t.v.replace(/"/g, '""')}"`;
    if (t.k === "fn") return `${t.v}(`;
    if (t.k === "bool") return t.v ? "TRUE" : "FALSE";
    if (t.k === "num") return String(t.v);
    return t.v;
  }).join("");
}

const BINARY = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

export function parse(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const expect = (v) => {
    const t = take();
    if (!t || t.k !== "op" || t.v !== v) throw new Error(`expected "${v}" in ${src}`);
  };
  function unary() {
    const t = peek();
    if (t && t.k === "op" && (t.v === "-" || t.v === "+")) {
      take();
      const x = unary();
      return t.v === "-" ? { k: "neg", x } : { k: "pos", x };
    }
    return primary();
  }
  function primary() {
    const t = take();
    if (!t) throw new Error(`unexpected end of ${src}`);
    if (t.k === "num" || t.k === "str" || t.k === "bool") return { k: "lit", v: t.v };
    if (t.k === "ref") return t;
    if (t.k === "fn") {
      const args = [];
      if (!(peek() && peek().k === "op" && peek().v === ")")) {
        for (;;) {
          args.push(expr(0));
          const n = take();
          if (n && n.k === "op" && n.v === ",") continue;
          if (n && n.k === "op" && n.v === ")") break;
          throw new Error(`expected "," or ")" in ${src}`);
        }
      } else take();
      return { k: "call", name: t.v, args };
    }
    if (t.k === "op" && t.v === "(") {
      const x = expr(0);
      expect(")");
      return x;
    }
    throw new Error(`unexpected "${t.v}" in ${src}`);
  }
  function expr(min) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.k !== "op" || !(t.v in BINARY) || BINARY[t.v] < min) break;
      take();
      // Every binary operator is left-associative, ^ included.
      const right = expr(BINARY[t.v] + 1);
      left = { k: "bin", op: t.v, a: left, b: right };
    }
    return left;
  }
  const tree = expr(0);
  if (i !== toks.length) throw new Error(`unread input after position ${i} in ${src}`);
  return tree;
}

// ---- values -------------------------------------------------------------------------------------------

const isErr = (x) => x !== null && typeof x === "object" && "error" in x;
const ERR = (e) => ({ error: e });
const isRange = (x) => x !== null && typeof x === "object" && x.k === "range";
const isArray = Array.isArray;

// Excel's General text for a number: at most 15 significant digits.
export function numberText(x) {
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const s = String(Number(x.toPrecision(15)));
  return s.replace(/e([+-])(\d)$/, "E$10$2").replace(/e/, "E");
}

function toNum(x) {
  if (isErr(x)) return x;
  if (x === null || x === "") return 0;
  if (typeof x === "number") return x;
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "string") {
    const n = Number(x);
    return x.trim() !== "" && Number.isFinite(n) ? n : ERR("#VALUE!");
  }
  return ERR("#VALUE!");
}
function toText(x) {
  if (x === null) return "";
  if (typeof x === "number") return numberText(x);
  if (typeof x === "boolean") return x ? "TRUE" : "FALSE";
  return x;
}
const rank = (x) => (typeof x === "number" ? 0 : typeof x === "string" ? 1 : 2);
function compare(a, b) {
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === "string") {
    const x = a.toUpperCase();
    const y = b.toUpperCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  // Excel calls two numbers equal when they agree to 15 significant digits (=0.1+0.2=0.3 is TRUE), in a
  // plain comparison, inside SUMPRODUCT and in a criterion alike; the oracle pins all three.
  const x = to15(Number(a));
  const y = to15(Number(b));
  return x < y ? -1 : x > y ? 1 : 0;
}
const to15 = (x) => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(15)) : x);
function binary(op, a, b) {
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  if (op === "&") return toText(a) + toText(b);
  if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
    const c = compare(a, b);
    return { "=": c === 0, "<>": c !== 0, "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0 }[op];
  }
  const x = toNum(a);
  const y = toNum(b);
  if (isErr(x)) return x;
  if (isErr(y)) return y;
  switch (op) {
    case "+": return x + y;
    case "-": return x - y;
    case "*": return x * y;
    case "/": return y === 0 ? ERR("#DIV/0!") : x / y;
    case "^": {
      const p = x ** y;
      return Number.isFinite(p) ? p : ERR("#NUM!");
    }
  }
  throw new Error(`operator ${op}`);
}

// ---- the evaluator ------------------------------------------------------------------------------------

/**
 * An evaluator over a book { names, sheets } (readXlsx's shape, or src/workbook.ts's sheets through fromSheets).
 * value(sheet, "A1") is the cell's value, its formula worked out from the cells it reads (memoised);
 * formula(sheet, f) evaluates a formula as if typed on that sheet.
 */
export function evaluator(book) {
  const memo = new Map();
  const busy = new Set();
  const cellsOf = (sheet) => {
    const cells = book.sheets[sheet];
    if (!cells) throw new Error(`no sheet named ${sheet}`);
    return cells;
  };
  function value(sheet, addr) {
    const key = `${sheet}!${addr}`;
    if (memo.has(key)) return memo.get(key);
    const cell = cellsOf(sheet)[addr];
    if (!cell) return null;
    if (cell.f === undefined) return cell.v ?? null;
    if (busy.has(key)) throw new Error(`circular reference at ${key}`);
    busy.add(key);
    let v;
    try {
      v = formula(sheet, cell.f);
    } catch (err) {
      throw new Error(`${key} =${cell.f}: ${err.message}`);
    } finally {
      busy.delete(key);
    }
    if (isRange(v) || isArray(v)) throw new Error(`${key} =${cell.f}: a range where one value belongs`);
    memo.set(key, v);
    return v;
  }
  // A range as rows of values.
  function grid(rg) {
    const out = [];
    for (let r = rg.r1; r <= rg.r2; r++) {
      const row = [];
      for (let c = rg.c1; c <= rg.c2; c++) row.push(value(rg.sheet, `${colLetters(c)}${r}`));
      out.push(row);
    }
    return out;
  }
  // The numbers a range holds (text, booleans and blanks skipped), or a scalar argument's number.
  function numbers(args, ctx) {
    const out = [];
    for (const node of args) {
      const v = ev(node, ctx);
      if (isRange(v)) {
        for (const row of grid(v)) for (const x of row) {
          if (isErr(x)) return x;
          if (typeof x === "number") out.push(x);
        }
      } else {
        const n = toNum(v);
        if (isErr(n)) return n;
        out.push(n);
      }
    }
    return out;
  }
  // Paired numbers from two ranges, a pair kept only where both are numbers.
  function pairs(a, b, ctx) {
    const ga = asGrid(ev(a, ctx)).flat();
    const gb = asGrid(ev(b, ctx)).flat();
    if (ga.length !== gb.length) return ERR("#N/A");
    const xs = [];
    const ys = [];
    for (let i = 0; i < ga.length; i++) {
      if (isErr(ga[i])) return ga[i];
      if (isErr(gb[i])) return gb[i];
      if (typeof ga[i] === "number" && typeof gb[i] === "number") {
        xs.push(ga[i]);
        ys.push(gb[i]);
      }
    }
    return { xs, ys };
  }
  const asGrid = (v) => (isRange(v) ? grid(v) : isArray(v) ? v : [[v]]);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

  const FUNCS = {
    SUM: (args, ctx) => {
      const xs = numbers(args, ctx);
      return isErr(xs) ? xs : xs.reduce((s, x) => s + x, 0);
    },
    AVERAGE: (args, ctx) => {
      const xs = numbers(args, ctx);
      if (isErr(xs)) return xs;
      return xs.length ? mean(xs) : ERR("#DIV/0!");
    },
    COUNT: (args, ctx) => {
      let n = 0;
      for (const node of args) {
        const v = ev(node, ctx);
        if (isRange(v)) for (const row of grid(v)) for (const x of row) n += typeof x === "number" ? 1 : 0;
        else n += typeof v === "number" ? 1 : 0;
      }
      return n;
    },
    MIN: (args, ctx) => {
      const xs = numbers(args, ctx);
      return isErr(xs) ? xs : xs.length ? Math.min(...xs) : 0;
    },
    MAX: (args, ctx) => {
      const xs = numbers(args, ctx);
      return isErr(xs) ? xs : xs.length ? Math.max(...xs) : 0;
    },
    SQRT: ([x], ctx) => {
      const n = toNum(scalar(ev(x, ctx)));
      if (isErr(n)) return n;
      return n < 0 ? ERR("#NUM!") : Math.sqrt(n);
    },
    ABS: ([x], ctx) => {
      const n = toNum(scalar(ev(x, ctx)));
      return isErr(n) ? n : Math.abs(n);
    },
    // Every argument is evaluated as an array; booleans and text inside an array count as zero.
    SUMPRODUCT: (args, ctx) => {
      const arrays = args.map((node) => asGrid(ev(node, { ...ctx, array: true })));
      const rows = arrays[0].length;
      const cols = arrays[0][0].length;
      if (arrays.some((g) => g.length !== rows || g[0].length !== cols)) return ERR("#VALUE!");
      let s = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let p = 1;
          for (const g of arrays) {
            const x = g[r][c];
            if (isErr(x)) return x;
            p *= typeof x === "number" ? x : 0;
          }
          s += p;
        }
      }
      return s;
    },
    "_XLFN.STDEV.S": (args, ctx) => {
      const xs = numbers(args, ctx);
      if (isErr(xs)) return xs;
      if (xs.length < 2) return ERR("#DIV/0!");
      const m = mean(xs);
      return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
    },
    "_XLFN.PERCENTILE.INC": ([range, k], ctx) => {
      const xs = numbers([range], ctx);
      if (isErr(xs)) return xs;
      const p = toNum(scalar(ev(k, ctx)));
      if (isErr(p)) return p;
      if (!xs.length || p < 0 || p > 1) return ERR("#NUM!");
      const s = [...xs].sort((a, b) => a - b);
      const h = (s.length - 1) * p;
      const lo = Math.floor(h);
      return lo + 1 >= s.length ? s[lo] : s[lo] + (h - lo) * (s[lo + 1] - s[lo]);
    },
    // The adjusted sample skew: n / ((n-1)(n-2)) times the sum of cubed standardised deviations.
    SKEW: (args, ctx) => {
      const xs = numbers(args, ctx);
      if (isErr(xs)) return xs;
      const n = xs.length;
      if (n < 3) return ERR("#DIV/0!");
      const m = mean(xs);
      const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
      if (sd === 0) return ERR("#DIV/0!");
      return (n / ((n - 1) * (n - 2))) * xs.reduce((s, x) => s + ((x - m) / sd) ** 3, 0);
    },
    // Sample excess kurtosis, bias-corrected.
    KURT: (args, ctx) => {
      const xs = numbers(args, ctx);
      if (isErr(xs)) return xs;
      const n = xs.length;
      if (n < 4) return ERR("#DIV/0!");
      const m = mean(xs);
      const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
      if (sd === 0) return ERR("#DIV/0!");
      const s4 = xs.reduce((s, x) => s + ((x - m) / sd) ** 4, 0);
      return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s4 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
    },
    SLOPE: ([y, x], ctx) => fit(pairs(x, y, ctx), "slope"),
    INTERCEPT: ([y, x], ctx) => fit(pairs(x, y, ctx), "intercept"),
    CORREL: ([a, b], ctx) => fit(pairs(a, b, ctx), "r"),
    // AVERAGEIF(range, criterion): the criterion is a number or text such as "<=0.5", read as Excel reads
    // it, so a number joined to text arrives rounded to 15 significant digits.
    AVERAGEIF: ([range, crit, avg], ctx) => {
      const rg = ev(range, ctx);
      if (!isRange(rg)) return ERR("#VALUE!");
      const c = scalar(ev(crit, ctx));
      const test = criterion(c);
      const src = grid(rg).flat();
      const vals = avg ? grid(ev(avg, ctx)).flat() : src;
      let s = 0;
      let n = 0;
      src.forEach((x, i) => {
        if (test(x) && typeof vals[i] === "number") {
          s += vals[i];
          n += 1;
        }
      });
      return n ? s / n : ERR("#DIV/0!");
    },
  };
  function fit(p, what) {
    if (isErr(p)) return p;
    const { xs, ys } = p;
    if (xs.length < (what === "r" ? 2 : 1)) return ERR("#DIV/0!");
    const mx = mean(xs);
    const my = mean(ys);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    if (what === "r") return sxx === 0 || syy === 0 ? ERR("#DIV/0!") : sxy / Math.sqrt(sxx * syy);
    if (sxx === 0) return ERR("#DIV/0!");
    const slope = sxy / sxx;
    return what === "slope" ? slope : my - slope * mx;
  }
  function criterion(c) {
    if (typeof c === "number") return (x) => typeof x === "number" && x === c;
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(toText(c));
    const op = m[1] ?? "=";
    const n = Number(m[2]);
    if (m[2].trim() !== "" && Number.isFinite(n)) return (x) => typeof x === "number" && binary(op, x, n) === true;
    return (x) => typeof x === "string" && binary(op, x, m[2]) === true;
  }
  // One value where one belongs: a range here is the implicit intersection a file formula would get.
  function scalar(v) {
    if (isRange(v) || isArray(v)) throw new Error("a range where one value belongs (implicit intersection)");
    return v;
  }
  function elementwise(fn, a, b) {
    const ga = asGrid(a);
    const gb = asGrid(b);
    const rows = Math.max(ga.length, gb.length);
    const cols = Math.max(ga[0].length, gb[0].length);
    const pick = (g, r, c) => g[g.length === 1 ? 0 : r]?.[g[0].length === 1 ? 0 : c];
    const out = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const x = pick(ga, r, c);
        const y = pick(gb, r, c);
        row.push(x === undefined || y === undefined ? ERR("#N/A") : fn(x, y));
      }
      out.push(row);
    }
    return out;
  }
  function ev(node, ctx) {
    switch (node.k) {
      case "lit":
        return node.v;
      case "ref": {
        const sheet = node.sheet ?? ctx.sheet;
        const a = splitAddress(node.a);
        if (!node.b) return value(sheet, `${colLetters(a.c)}${a.r}`);
        const b = splitAddress(node.b);
        return { k: "range", sheet, c1: Math.min(a.c, b.c), r1: Math.min(a.r, b.r), c2: Math.max(a.c, b.c), r2: Math.max(a.r, b.r) };
      }
      case "neg":
      case "pos": {
        const v = ev(node.x, ctx);
        const one = (x) => (node.k === "pos" ? x : (() => { const n = toNum(x); return isErr(n) ? n : -n; })());
        if (isRange(v) || isArray(v)) {
          if (!ctx.array) scalar(v);
          return asGrid(v).map((row) => row.map(one));
        }
        return one(v);
      }
      case "bin": {
        const a = ev(node.a, ctx);
        const b = ev(node.b, ctx);
        if (isRange(a) || isArray(a) || isRange(b) || isArray(b)) {
          if (!ctx.array) scalar(isRange(a) || isArray(a) ? a : b);
          return elementwise((x, y) => binary(node.op, x, y), a, b);
        }
        return binary(node.op, a, b);
      }
      case "call": {
        const fn = FUNCS[node.name];
        if (!KNOWN.has(node.name) || !fn) throw new Error(`unknown function ${node.name}`);
        return fn(node.args, ctx);
      }
    }
    throw new Error(`node ${node.k}`);
  }
  function formula(sheet, f) {
    return ev(parse(f), { sheet, array: false });
  }
  return { value, formula };
}

/** A book in readXlsx's shape from SheetJS-style sheets ([{ name, sheet }], as src/workbook.ts returns them). */
export function fromSheets(list) {
  const sheets = {};
  for (const { name, sheet } of list) {
    const cells = {};
    for (const [addr, cell] of Object.entries(sheet)) {
      if (addr.startsWith("!")) continue;
      cells[addr] = { f: cell.f, v: cell.v, t: cell.t };
    }
    sheets[name] = cells;
  }
  return { names: list.map((s) => s.name), sheets };
}

/** Every formula cell of a book, sheet by sheet in order and row by row, so each is evaluated after what it reads. */
export function formulaCells(book) {
  const out = [];
  for (const name of book.names) {
    const cells = Object.entries(book.sheets[name]).filter(([, c]) => c.f !== undefined).map(([addr, c]) => ({ sheet: name, addr, ...splitAddress(addr), cell: c }));
    cells.sort((x, y) => x.r - y.r || x.c - y.c);
    out.push(...cells);
  }
  return out;
}

/** Every formula's evaluated value next to the value the book cached for it. */
export function evaluateBook(book) {
  const e = evaluator(book);
  return formulaCells(book).map((x) => ({ sheet: x.sheet, addr: x.addr, f: x.cell.f, cached: x.cell.v, value: e.value(x.sheet, x.addr) }));
}

/** The function names a formula calls, upper-cased as the evaluator reads them. */
export function functionsIn(f) {
  return tokenize(f).filter((t) => t.k === "fn").map((t) => t.v);
}
