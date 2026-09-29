// Tables and their downloads: the Table component, the CSV and Excel cells behind its two buttons,
// and a sweep that keeps every tab and chrome file from rendering a raw <table> that would carry
// neither download.
import { render, text, act } from "./_dom.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { check, done } from "./_assert.mjs";

const { createElement: h } = await import("react");
const Table = (await import("../src/components/Table.tsx")).default;
const D = await import("../src/download.ts");
const { csvText, cellFor, worksheet, colName, sheetName, SHEETJS_URL } = D;
const { DASH } = await import("../src/format.ts");

const WEB = fileURLToPath(new URL("..", import.meta.url));
const ORACLE_SRC = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8");
const ORACLE = ORACLE_SRC.split(/\r?\n/);
const oracleLine = (n) => ORACLE[n - 1] ?? "";
const oracle = JSON.parse(readFileSync(new URL("./fixtures/oracle-cross.json", import.meta.url), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Python's f"{x:.2%}": x * 100 in double precision, fixed 2 dp, a hyphen for the sign.
const pyPct2 = (x) => `${(x * 100).toFixed(2)}%`;

const COLS = [
  { key: "name", label: "Portfolio", format: "text", first: true },
  { key: "ret", label: "Ann. Return", format: "pct2" },
  { key: "sharpe", label: "Sharpe", format: "num3" },
  { key: "asof", label: "As of", format: "date" },
];
const ROWS = [
  { name: "GMV", ret: 0.1234, sharpe: 0.87654, asof: "2026-09-25" },
  { name: "Tangency, long-only", ret: -0.0567, sharpe: null, asof: "2026-09-25" },
  { name: "S&P 500", ret: 1e-7, sharpe: NaN, asof: null },
];

// ---- ledger:numeric-downloads ------------------------------------------------------------------

// The app: the comparison table is built from f-strings (1687) and that frame is what to_csv and
// df_to_excel write (1700, 1702), so each download cell is the TEXT "12.34%".
check(oracleLine(1687).includes('"Ann. Return": f"{mu_p:.2%}"') && oracleLine(1700).includes("comp_df.to_csv()") &&
  oracleLine(1702).includes("df_to_excel(comp_df)"),
  "ledger:numeric-downloads the app writes its f-string comparison frame to both downloads (portfolio_app.py 1687, 1700, 1702)");
const mu = oracle.bench.mu;
const appCell = { t: "s", v: pyPct2(mu) };
check(typeof appCell.v === "string" && /^-?\d+\.\d{2}%$/.test(appCell.v) && pyPct2(0.1234) === "12.34%",
  "ledger:numeric-downloads the app's cell for the benchmark's return is the string it printed", `${appCell.v}`);
// The port: the same number is a numeric cell that DISPLAYS as a percentage.
const pct = COLS[1];
check(same(cellFor(0.1234, pct), { t: "n", v: 0.1234, z: "0.00%" }), "ledger:numeric-downloads the port's Excel cell is { t: n, v: 0.1234, z: 0.00% }",
  JSON.stringify(cellFor(0.1234, pct)));
check(same(cellFor(mu, pct), { t: "n", v: mu, z: "0.00%" }) && !same(cellFor(mu, pct), appCell),
  "ledger:numeric-downloads the benchmark's return is the number itself, not the app's text", JSON.stringify(cellFor(mu, pct)));
const csv = csvText(COLS, ROWS);
check(csv.split("\n")[1] === "GMV,0.1234,0.87654,2026-09-25" && !csv.includes("%") && !csv.includes("12.34"),
  "ledger:numeric-downloads the CSV holds 0.1234, not 12.34%", csv.split("\n")[1]);

// ---- CSV --------------------------------------------------------------------------------------

check(csv === 'Portfolio,Ann. Return,Sharpe,As of\nGMV,0.1234,0.87654,2026-09-25\n"Tangency, long-only",-0.0567,,2026-09-25\nS&P 500,1e-7,,\n',
  "csv: header labels, raw numbers at full precision, empty for missing, quoted only when needed, \\n line ends", JSON.stringify(csv));
check(csvText([{ key: "a", label: 'Say "hi"', format: "text" }], [{ a: "line\nbreak" }]) === '"Say ""hi"""\n"line\nbreak"\n',
  "csv: quotes and line breaks are escaped", JSON.stringify(csvText([{ key: "a", label: 'Say "hi"', format: "text" }], [{ a: "line\nbreak" }])));

// ---- Excel cells ------------------------------------------------------------------------------

check(colName(0) === "A" && colName(25) === "Z" && colName(26) === "AA" && colName(701) === "ZZ" && colName(702) === "AAA",
  "xlsx: column letters", [0, 25, 26, 701, 702].map(colName).join(" "));
const ws = worksheet(COLS, ROWS);
check(ws["!ref"] === "A1:D4", "xlsx: the used range covers the header and every row", ws["!ref"]);
check(same(["A1", "B1", "C1", "D1"].map((a) => ws[a]), COLS.map((c) => ({ t: "s", v: c.label }))), "xlsx: row 1 is the labels");
check(same(ws.A3, { t: "s", v: "Tangency, long-only" }) && same(ws.B3, { t: "n", v: -0.0567, z: "0.00%" }) && same(ws.C2, { t: "n", v: 0.87654, z: "0.000" }),
  "xlsx: labels are text, numbers are numbers with their column's format", JSON.stringify([ws.A3, ws.B3, ws.C2]));
check(same(ws.D2, { t: "n", v: 46290, z: "yyyy-mm-dd" }), "xlsx: an ISO day is Excel's day number, formatted yyyy-mm-dd", JSON.stringify(ws.D2));
check(!("C3" in ws) && !("C4" in ws) && !("D4" in ws), "xlsx: null and NaN are blank cells, never text", JSON.stringify([ws.C3, ws.C4, ws.D4]));
check(same(cellFor(5, COLS[0]), { t: "s", v: "5" }) && same(cellFor("n/a", pct), { t: "s", v: "n/a" }),
  "xlsx: a number in a label column stays text; text in a number column is not coerced");
check(sheetName("Returns: summary [daily] / annual and more words") === "Returns summary daily annual an" && sheetName("??") === "Sheet1",
  "xlsx: sheet names drop the characters Excel refuses and keep 31", sheetName("Returns: summary [daily] / annual and more words"));
check(SHEETJS_URL === "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs", "xlsx: SheetJS comes from its own CDN, pinned", SHEETJS_URL);
{
  const src = readFileSync(new URL("../src/download.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  check(!/from\s+["']xlsx["']/.test(src) && !("xlsx" in { ...pkg.dependencies, ...pkg.devDependencies }) && /await import\(|import\(\/\*/.test(src),
    "xlsx: never the npm package; loaded with a dynamic import at click time");
}

// ---- the Table component ----------------------------------------------------------------------

const r = render(h(Table, { title: "Portfolio comparison", columns: COLS, rows: ROWS, filename: "portfolio-comparison" }));
check(text(r.container.querySelector("caption")) === "Portfolio comparison", "table: the title is the caption");
const heads = [...r.container.querySelectorAll("thead th")];
check(heads.map((th) => text(th)).join("|") === "Portfolio|Ann. Return|Sharpe|As of" && heads.every((th) => th.getAttribute("scope") === "col"),
  "table: column headers, scoped");
const first = [...r.container.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => text(c)));
check(same(first, [["GMV", "12.34%", "0.877", "2026-09-25"], ["Tangency, long-only", "\u22125.67%", DASH, "2026-09-25"], ["S&P 500", "0.00%", DASH, DASH]]),
  "table: raw numbers are formatted at render; missing values print the dash", JSON.stringify(first));
const bodyRow = r.container.querySelector("tbody tr");
check(bodyRow.children[0].tagName === "TH" && bodyRow.children[0].getAttribute("scope") === "row" && bodyRow.children[0].classList.contains("first"),
  "table: the label column is a row header, marked as the frozen column");
check([...bodyRow.children].slice(1).every((c) => c.tagName === "TD" && c.classList.contains("num")) && !bodyRow.children[0].classList.contains("num"),
  "table: figures get the right-aligned tabular class, labels do not");
const scroller = r.container.querySelector(".tbl-scroll");
check(scroller?.contains(r.container.querySelector("table")) && scroller.getAttribute("role") === "region" && scroller.getAttribute("aria-label") === "Portfolio comparison",
  "table: the table sits in its own named scroll box");

// On a phone the label column freezes and the rest scrolls inside the table's box.
{
  const sheet = readFileSync(new URL("../src/components/Table.css", import.meta.url), "utf8");
  const rule = (sel) => {
    const at = sheet.indexOf(`${sel} {`);
    return at < 0 ? "" : sheet.slice(at, sheet.indexOf("}", at));
  };
  check(/position:\s*sticky/.test(rule(".tbl .first")) && /left:\s*0/.test(rule(".tbl .first")) && /background:/.test(rule(".tbl .first")),
    "table: the label column is sticky at the left edge with an opaque ground", rule(".tbl .first"));
  check(/overflow-x:\s*auto/.test(rule(".tbl-scroll")), "table: the figures scroll sideways inside the table's own box", rule(".tbl-scroll"));
  check(/text-align:\s*right/.test(rule(".tbl .num")) && /tabular-nums/.test(rule(".tbl .num")), "table: figures are right-aligned tabular numerals", rule(".tbl .num"));
  check(!/display:\s*(block|grid|flex)/.test(rule(".tbl th,\n.tbl td")) && !/\btr\s*\{[^}]*display:\s*(block|grid|flex)/.test(sheet),
    "table: rows are never collapsed into cards");
}

// ---- ledger:downloads-everywhere ---------------------------------------------------------------

// The app: CAPM (1393) and the covariance matrix (1462) have no download, and the sensitivity tab
// offers CSV only (1930, 1932).
{
  const offered = [...ORACLE_SRC.matchAll(/st\.download_button\([^,]+,\s*([^,]+?)(?:\.to_csv\(\)|\))/g)].map((m) => m[1]);
  const excelAfter1900 = ORACLE.slice(1900).some((l) => l.includes("df_to_excel("));
  check(/st\.dataframe\(capm_df/.test(oracleLine(1393)) && /st\.dataframe\(cov_matrix/.test(oracleLine(1462)) &&
    !offered.some((s) => /capm|cov_matrix/.test(s)) && !excelAfter1900 && /gmv_sens\.to_csv\(\)/.test(oracleLine(1930)),
    "ledger:downloads-everywhere the app offers none for CAPM or covariance and CSV only on sensitivity", offered.join(" "));
}
// The port (a): a Table always renders both controls, with rows or without, whatever else is passed.
function controls(props) {
  const t = render(h(Table, props));
  const labels = [...t.container.querySelectorAll("button")].map((b) => text(b));
  t.unmount();
  return labels;
}
const both = (labels) => labels.includes("Download CSV") && labels.includes("Download Excel");
check(both(controls({ title: "Summary", columns: COLS, rows: ROWS, filename: "summary" })),
  "ledger:downloads-everywhere a Table renders CSV and Excel downloads");
check(both(controls({ title: "Empty", columns: COLS, rows: [], filename: "empty" })),
  "ledger:downloads-everywhere an empty Table still renders both downloads");
check(both(controls({ title: "CAPM", columns: COLS, rows: ROWS, filename: "capm", downloads: false, showDownloads: false, csv: false, excel: false, hideDownloads: true })),
  "ledger:downloads-everywhere no prop turns the downloads off");

// The port (b): no tab or chrome file renders a raw <table>, which would carry neither download.
// Files are globbed at run time, so a tab written later is swept too. JSX is compiled first, so a
// comment or a string that mentions <table> is not a hit and a real element always is.
function rawTable(source, file = "x.tsx") {
  const js = transformSync(source, { loader: "tsx", jsx: "automatic", format: "esm", sourcefile: file }).code;
  return /\b(?:jsxs?|jsxDEV|createElement)\(\s*["']table["']/.test(js);
}
function tsxUnder(dir) {
  const abs = WEB + dir;
  return readdirSync(abs, { recursive: true }).map(String).filter((f) => f.endsWith(".tsx")).map((f) => `${dir}/${f.replace(/\\/g, "/")}`);
}
check(rawTable("export default () => <table><tbody><tr><td>1</td></tr></tbody></table>;") &&
  rawTable('import { createElement } from "react"; export default () => createElement("table", null);'),
  "ledger:downloads-everywhere the sweep fires on a raw table, in JSX or createElement");
check(!rawTable('import Table from "../components/Table.tsx";\n// never a raw <table> here\nconst s = "<table>";\nexport default () => <Table title={s} columns={[]} rows={[]} filename="f" />;'),
  "ledger:downloads-everywhere the sweep ignores the Table component, comments and strings");
{
  const files = [...tsxUnder("src/tabs"), ...tsxUnder("src/chrome")];
  const need = ["src/tabs/Returns.tsx", "src/tabs/Sensitivity.tsx", "src/chrome/Rail.tsx", "src/chrome/Band.tsx"];
  check(files.length >= 9 && need.every((f) => files.includes(f)), "ledger:downloads-everywhere the sweep sees every tab and chrome file", files.join(" "));
  const hits = files.filter((f) => rawTable(readFileSync(WEB + f, "utf8"), f));
  check(hits.length === 0, "ledger:downloads-everywhere no tab or chrome file renders a raw <table>", hits.join(" "));
}

// ---- the buttons ------------------------------------------------------------------------------

{
  const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL, click: window.HTMLAnchorElement.prototype.click };
  let blob = null;
  const names = [];
  URL.createObjectURL = (b) => {
    blob = b;
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    names.push(this.download);
  };
  const errors = [];
  const { error } = console;
  console.error = (...a) => errors.push(a.map(String).join(" "));
  try {
    const t = render(h(Table, { title: "Portfolio comparison", columns: COLS, rows: ROWS, filename: "portfolio-comparison" }));
    const [csvBtn, xlsBtn] = [...t.container.querySelectorAll(".tbl-dl button")];
    act(() => csvBtn.click());
    const saved = blob ? await blob.text() : "";
    check(names[0] === "portfolio-comparison.csv" && saved === csvText(COLS, ROWS) && /^text\/csv/.test(blob?.type ?? ""),
      "table: Download CSV saves <filename>.csv holding csvText", `${names[0]} ${blob?.type}`);
    // Node cannot load an https: module, which stands in for the CDN being unreachable.
    await act(async () => {
      xlsBtn.click();
      await new Promise((res) => setTimeout(res, 50));
    });
    const note = t.container.querySelector(".tbl-note");
    check(note !== null && /Excel file could not be built/.test(text(note)) && names.length === 1 && !xlsBtn.disabled,
      "table: when SheetJS cannot load, the table says so, saves nothing and re-enables the button", note ? text(note) : "no note");
    check(errors.some((e) => e.includes("[table] Portfolio comparison")), "table: the console names the table whose Excel failed", errors[0] ?? "");
    t.unmount();
  } finally {
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
    window.HTMLAnchorElement.prototype.click = saved.click;
    console.error = error;
  }
}

// ---- spans and head sub-lines ---------------------------------------------------------------------

{
  const { withSubs } = await import("../src/components/Table.tsx");
  const subs = { GMV: "weights chosen on this window", Sharpe: "in-sample" };
  const t = render(h(Table, { title: "Portfolio comparison", columns: COLS, rows: ROWS, filename: "c", span: "Daily returns, 2019-01-03 to 2026-09-25", subs }));
  const cap = t.container.querySelector("caption");
  check(text(cap.querySelector(".tbl-title")) === "Portfolio comparison" && text(cap.querySelector(".tbl-span")) === "Daily returns, 2019-01-03 to 2026-09-25",
    "spans: the caption prints the title, then the dates and frequency under it", text(cap));
  const subOf = (th) => (th.querySelector(".tbl-sub") ? text(th.querySelector(".tbl-sub")) : null);
  const col = [...t.container.querySelectorAll("thead th")].map(subOf);
  const row = [...t.container.querySelectorAll("tbody th")].map(subOf);
  check(JSON.stringify(col) === JSON.stringify([null, null, "in-sample", null]) && JSON.stringify(row) === JSON.stringify(["weights chosen on this window", null, null]),
    "subs: a head whose text is a key carries its sub-line, a column head or a row head, and no other head does", `${col} / ${row}`);
  const flat = withSubs(COLS, ROWS, subs);
  check(csvText(flat.columns, flat.rows).split("\n").slice(0, 2).join("|") === "Portfolio,Ann. Return,Sharpe (in-sample),As of|GMV (weights chosen on this window),0.1234,0.87654,2026-09-25" &&
    same(withSubs(COLS, ROWS, undefined), { columns: COLS, rows: ROWS }) && ROWS[0].name === "GMV",
    "subs: the downloads carry each sub-line in brackets after its head, and the rows passed in are not changed");
  const bare = render(h(Table, { title: "Typed", columns: COLS, rows: ROWS, filename: "t", span: null }));
  check(!bare.container.querySelector(".tbl-span") && text(bare.container.querySelector("caption")) === "Typed", "spans: a table given no span claims no dates");
  t.unmount();
  bare.unmount();
}

// Every table on every tab states its window and its return frequency, except the two that echo weights
// as typed, which come from no dates at all.
{
  const { fixtureAnalysis, tabProps } = await import("./_analysis.mjs");
  const TYPED = ["Normalized Weights", "Custom weights being evaluated"];
  const SPAN = /^(Daily|Monthly) (returns|closes), \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d$|^(Daily|Monthly) returns, each window ending \d{4}-\d\d-\d\d$/;
  const { error, warn } = console;
  console.error = console.warn = () => {};
  const found = [];
  try {
    for (const name of ["Returns", "Risk", "Correlation", "Optimization", "Custom", "Sensitivity"]) {
      const Tab = (await import(`../src/tabs/${name}.tsx`)).default;
      const tr = render(h(Tab, tabProps(fixtureAnalysis("cross"))));
      const box = tr.container.querySelector(".sens-check input");
      if (box) act(() => box.click());
      for (const tb of tr.container.querySelectorAll(".tbl")) {
        found.push({ tab: name, title: text(tb.querySelector(".tbl-title")), span: tb.querySelector(".tbl-span") ? text(tb.querySelector(".tbl-span")) : null });
      }
      tr.unmount();
    }
  } finally {
    console.error = error;
    console.warn = warn;
  }
  const bad = found.filter((f) => (TYPED.includes(f.title) ? f.span !== null : !SPAN.test(f.span ?? "")));
  check(found.length >= 17 && TYPED.every((t) => found.some((f) => f.title === t)) && bad.length === 0,
    "spans: every table on the six tabs states its window and return frequency; only the typed weights claim none",
    `${found.length} tables; ${bad.map((f) => `${f.tab}/${f.title}=${f.span}`).join(" | ")}`);
}

r.unmount();
done("t-tables");
