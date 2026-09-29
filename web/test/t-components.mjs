// The shared components that are not tables: the error boundary, the pill row, and the formats every
// printed number goes through. Boundaries only work in a CLIENT render (server rendering never runs
// one), so this suite renders through test/_dom.mjs's jsdom window.
import { render, text, act } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";

const { createElement: h } = await import("react");
const Boundary = (await import("../src/components/Boundary.tsx")).default;
const SegModule = await import("../src/components/SegControl.tsx");
const SegControl = SegModule.default;
const { revealLeft } = SegModule;
const F = await import("../src/format.ts");
const { format, DASH, MINUS, EXCEL_FORMATS, FORMATS, excelSerial } = F;

const ORACLE = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8").split(/\r?\n/);
const oracleLine = (n) => ORACLE[n - 1] ?? "";
const css = (file) => readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
// The declarations of one rule, e.g. block(css, ".seg") -> "position: relative; ...".
function block(sheet, selector) {
  const at = sheet.indexOf(`${selector} {`);
  return at < 0 ? "" : sheet.slice(at, sheet.indexOf("}", at));
}

// Runs fn with console.error and console.warn captured instead of printed; returns what was logged.
function quiet(fn) {
  const { error, warn } = console;
  const logged = [];
  console.error = (...a) => logged.push(a.map(String).join(" "));
  console.warn = (...a) => logged.push(a.map(String).join(" "));
  try {
    fn();
  } finally {
    console.error = error;
    console.warn = warn;
  }
  return logged;
}

// ---- Boundary ---------------------------------------------------------------------------------

// ledger:boundary. The app: a failed optimisation calls st.stop() (1483, 1727), which ends the script
// run, so nothing after it on the page is drawn, later tabs included.
check(/st\.error\("GMV optimization did not converge/.test(oracleLine(1482)) && oracleLine(1483).trim() === "st.stop()",
  "ledger:boundary the app stops the whole run when GMV fails (portfolio_app.py 1482-1483)", oracleLine(1483));
check(/All weights are zero/.test(oracleLine(1726)) && oracleLine(1727).trim() === "st.stop()",
  "ledger:boundary the app stops the whole run on all-zero custom weights (portfolio_app.py 1726-1727)", oracleLine(1727));

// The port: only the failing card is replaced.
const secret = new Error("SECRET-7731 upstream said no");
const Boom = () => {
  throw secret;
};
{
  let r = null;
  const logged = quiet(() => {
    try {
      r = render(h("div", null,
        h("section", { id: "a" }, h(Boundary, { name: "Frontier chart" }, h(Boom))),
        h("section", { id: "b" }, h(Boundary, { name: "Weights table" }, h("p", null, "GMV 41.2% AAPL")))));
    } catch (err) {
      check(false, "ledger:boundary a throw inside a card stays inside it", err.message);
    }
  });
  const a = r?.container.querySelector("#a") ?? null;
  const b = r?.container.querySelector("#b") ?? null;
  check(a !== null && text(a) === "Frontier chart could not be shown.",
    "ledger:boundary the failing card is replaced by exactly one line naming it", a ? text(a) : "no render");
  check(b !== null && text(b) === "GMV 41.2% AAPL", "ledger:boundary a sibling card keeps rendering", b ? text(b) : "no render");
  const html = r?.container.innerHTML ?? "SECRET";
  check(!html.includes("SECRET-7731") && !/at Boom|Error:|\.tsx/.test(html),
    "boundary: neither the message nor the stack reaches the page", html);
  check(logged.some((l) => l.includes("[boundary] Frontier chart")), "boundary: the console names the card", logged[0] ?? "nothing logged");
  r?.unmount();
}

// `throw null` is legal JavaScript and must be caught like any other throw.
{
  let r = null;
  quiet(() => {
    try {
      r = render(h(Boundary, { name: "Null card" }, h(() => {
        throw null;
      })));
    } catch (err) {
      check(false, "boundary: a falsy throw is caught too", String(err));
    }
  });
  check(r !== null && text(r.container) === "Null card could not be shown.", "boundary: a falsy throw is caught too", r ? text(r.container) : "");
  r?.unmount();
}

// A new resetKey re-arms the boundary; the same key keeps the fallback.
{
  let broken = true;
  const Flaky = () => {
    if (broken) throw new Error("not yet");
    return h("p", null, "Chart drawn");
  };
  let r = null;
  quiet(() => {
    try {
      r = render(h(Boundary, { name: "Rolling chart", resetKey: 1 }, h(Flaky)));
      broken = false;
      r.rerender(h(Boundary, { name: "Rolling chart", resetKey: 1 }, h(Flaky)));
    } catch (err) {
      check(false, "boundary: the same resetKey keeps the fallback", err.message);
    }
  });
  check(r !== null && text(r.container) === "Rolling chart could not be shown.", "boundary: the same resetKey keeps the fallback", r ? text(r.container) : "");
  quiet(() => r?.rerender(h(Boundary, { name: "Rolling chart", resetKey: 2 }, h(Flaky))));
  check(r !== null && text(r.container) === "Chart drawn", "boundary: a new resetKey re-arms it and the card renders", r ? text(r.container) : "");
  r?.unmount();
}

// ---- SegControl -------------------------------------------------------------------------------

const OPTS = ["Returns", "Risk", "Correlation", "Optimization", "Custom", "Sensitivity"].map((l) => ({ value: l.toLowerCase(), label: l }));
{
  let value = "returns";
  const picks = [];
  const el = () => h(SegControl, { options: OPTS, value, onChange: (v) => picks.push(v), ariaLabel: "Analysis tabs" });
  const r = render(el());
  // No idPrefix: a choice that controls no panel, so a radio group, never a tablist with no panels.
  const list = r.container.querySelector("[role=radiogroup]");
  const tabs = [...r.container.querySelectorAll("[role=radio]")];
  check(list?.getAttribute("aria-label") === "Analysis tabs" && tabs.length === 6 && !r.container.querySelector("[role=tablist], [role=tab]"),
    "segcontrol: with no idPrefix, a named radio group of six, and no tab roles", `${tabs.length}`);
  check(tabs.map((t) => t.getAttribute("aria-checked")).join() === "true,false,false,false,false,false" && tabs.every((t) => !t.hasAttribute("aria-selected")),
    "segcontrol: aria-checked marks only the chosen option", tabs.map((t) => t.getAttribute("aria-checked")).join());
  check(tabs.map((t) => t.tabIndex).join() === "0,-1,-1,-1,-1,-1", "segcontrol: one tab stop, on the chosen tab", tabs.map((t) => t.tabIndex).join());

  const key = (k) => act(() => {
    document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
  tabs[0].focus();
  key("ArrowRight");
  check(picks.at(-1) === "risk" && document.activeElement === tabs[1], "segcontrol: ArrowRight selects and focuses the next tab", `${picks.at(-1)}`);
  value = "risk";
  r.rerender(el());
  check(tabs[1].getAttribute("aria-checked") === "true" && tabs[1].tabIndex === 0, "segcontrol: the selection follows the value prop");
  tabs[0].focus();
  key("ArrowLeft");
  check(picks.at(-1) === "sensitivity" && document.activeElement === tabs[5], "segcontrol: ArrowLeft from the first wraps to the last", `${picks.at(-1)}`);
  key("Home");
  check(picks.at(-1) === "returns" && document.activeElement === tabs[0], "segcontrol: Home goes to the first", `${picks.at(-1)}`);
  key("End");
  check(picks.at(-1) === "sensitivity" && document.activeElement === tabs[5], "segcontrol: End goes to the last", `${picks.at(-1)}`);
  const before = picks.length;
  key("a");
  check(picks.length === before, "segcontrol: other keys do nothing");
  check(tabs.every((t) => !t.id && !t.hasAttribute("aria-controls")), "segcontrol: with no idPrefix the pills carry no ids");
  r.unmount();

  // With an idPrefix, every pill has an id and names the panel it controls.
  const p = render(h(SegControl, { options: OPTS, value: "risk", onChange: () => {}, ariaLabel: "Analysis tabs", idPrefix: "x" }));
  const pills = [...p.container.querySelectorAll("[role=tab]")];
  check(p.container.querySelector("[role=tablist]")?.getAttribute("aria-label") === "Analysis tabs" && pills.length === 6 &&
    pills.map((t) => t.getAttribute("aria-selected")).join() === "false,true,false,false,false,false" && pills.every((t) => !t.hasAttribute("aria-checked")),
    "segcontrol: an idPrefix makes it a tablist, aria-selected on the chosen tab", pills.map((t) => t.getAttribute("aria-selected")).join());
  check(pills.map((t) => t.id).join() === OPTS.map((o) => `x-tab-${o.value}`).join() &&
    pills.map((t) => t.getAttribute("aria-controls")).join() === OPTS.map((o) => `x-panel-${o.value}`).join(),
    "segcontrol: an idPrefix gives each pill an id and aria-controls naming its panel", pills.map((t) => `${t.id}>${t.getAttribute("aria-controls")}`).join(" "));
  check(SegModule.tabId("x", "risk") === "x-tab-risk" && SegModule.tabPanelId("x", "risk") === "x-panel-risk",
    "segcontrol: tabId and tabPanelId are the ids the pills carry");
  p.unmount();
}

// The row never wraps: it scrolls sideways inside itself, and the pills never shrink to fit.
{
  const sheet = css("SegControl.css");
  const row = block(sheet, ".seg");
  check(/flex-wrap:\s*nowrap/.test(row) && /white-space:\s*nowrap/.test(row), "segcontrol: the row never wraps", row);
  check(/overflow-x:\s*auto/.test(row) && /max-width:\s*100%/.test(row), "segcontrol: a row wider than its container scrolls inside itself", row);
  check(/flex:\s*0 0 auto/.test(block(sheet, ".seg-pill")), "segcontrol: pills keep their width instead of shrinking", block(sheet, ".seg-pill"));
}

// A plate's figure fits its plate: the plate is the size container and the figure scales with it,
// capped at 28px, so five plates across a column never break "−24.12%" over two lines.
{
  const sheet = css("Plate.css");
  check(/container-type:\s*inline-size/.test(block(sheet, ".plate")), "plate: the plate is the size container of its figure", block(sheet, ".plate"));
  check(/font-size:\s*clamp\(16px,\s*20cqi,\s*28px\)/.test(block(sheet, ".plate-value")), "plate: the figure scales with the plate's width, 16px to 28px", block(sheet, ".plate-value"));
  // A label that wraps (the band's "Tangency Sharpe (in-sample)" does at desktop width) must not push its
  // figure below the figures of the plates beside it: the plate is a column and the figure takes the slack.
  check(/display:\s*flex/.test(block(sheet, ".plate")) && /flex-direction:\s*column/.test(block(sheet, ".plate")) &&
    /margin-top:\s*auto/.test(block(sheet, ".plate-value")),
    "plate: a label on two lines leaves the figure level with its neighbours'", block(sheet, ".plate") + block(sheet, ".plate-value"));
}

// The chosen pill is scrolled into view, by scrolling the row and never the page. jsdom has no
// layout, so each pill is given one: 100px apart, 90px wide, in a 200px row.
check(revealLeft(400, 90, 0, 200) === 314 && revealLeft(0, 90, 314, 200) === 0 && revealLeft(100, 90, 50, 200) === 50,
  "segcontrol: revealLeft scrolls just far enough, and not at all when the pill is in view");
{
  const P = window.HTMLElement.prototype;
  const saved = ["offsetLeft", "offsetWidth", "clientWidth", "scrollLeft"].map((k) => [k, Object.getOwnPropertyDescriptor(P, k)]);
  const at = (el) => OPTS.findIndex((o) => o.label === el.textContent);
  Object.defineProperty(P, "offsetLeft", { configurable: true, get() { return at(this) * 100; } });
  Object.defineProperty(P, "offsetWidth", { configurable: true, get() { return 90; } });
  Object.defineProperty(P, "clientWidth", { configurable: true, get() { return 200; } });
  Object.defineProperty(P, "scrollLeft", { configurable: true, get() { return this._sl ?? 0; }, set(v) { this._sl = v; } });
  try {
    const el = (value) => h(SegControl, { options: OPTS, value, onChange: () => {}, ariaLabel: "Tabs" });
    const r = render(el("custom"));
    const list = r.container.querySelector(".seg");
    check(list.scrollLeft === 314, "segcontrol: the chosen pill is scrolled into view on load", `${list.scrollLeft}`);
    r.rerender(el("returns"));
    check(list.scrollLeft === 0, "segcontrol: choosing a pill off the left edge scrolls back to it", `${list.scrollLeft}`);
    r.unmount();
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(P, k, d);
      else delete P[k];
    }
  }
}

// ---- format -----------------------------------------------------------------------------------

const cases = [
  [0.1234, "pct2", "12.34%"],
  [-0.0567, "pct2", `${MINUS}5.67%`],
  [0.1234, "pct1", "12.3%"],
  [1.23456, "num2", "1.23"],
  [-1.23456, "num3", `${MINUS}1.235`],
  [0.123456, "num4", "0.1235"],
  [1234567.4, "int", "1,234,567"],
  [10000, "usd0", "$10,000"],
  [-2500, "usd0", `${MINUS}$2,500`],
  [1234.5, "usd2", "$1,234.50"],
  [999.999, "usd2", "$1,000.00"],
  ["2026-09-25", "date", "2026-09-25"],
  ["2026-09-25T20:00:00Z", "date", "2026-09-25"],
  ["AAPL", "text", "AAPL"],
  ["^GSPC", "pct2", "^GSPC"],
];
for (const [v, id, want] of cases) check(format(v, id) === want, `format: ${JSON.stringify(v)} as ${id} prints ${want}`, format(v, id));

// A value that rounds to zero carries no sign. Python prints "-0.00%" for these.
check(format(-0.00001, "pct2") === "0.00%" && format(-0, "num3") === "0.000" && format(-0.4, "usd0") === "$0",
  "format: a value that rounds to zero prints without a minus", [format(-0.00001, "pct2"), format(-0, "num3"), format(-0.4, "usd0")].join(" "));
// The minus is U+2212 in every format, never a hyphen.
check(Object.keys(FORMATS).filter((id) => id !== "date").every((id) => format(-12.5, id).startsWith(MINUS) && !format(-12.5, id).includes("-")),
  "format: every numeric format signs with U+2212", Object.keys(FORMATS).map((id) => format(-12.5, id)).join(" "));

// Missing and undefined values print as the en dash, in every format.
check(DASH === "\u2013", "format: the dash is an en dash", JSON.stringify(DASH));
for (const id of [...Object.keys(FORMATS), "text"]) {
  const out = [null, NaN, Infinity, -Infinity].map((v) => format(v, id));
  check(out.every((s) => s === DASH), `format: null, NaN and the infinities print the dash as ${id}`, out.join(" "));
}

// One table: every format's Excel code is the one EXCEL_FORMATS exports.
check(Object.keys(FORMATS).every((id) => EXCEL_FORMATS[id] === FORMATS[id].excel) && Object.keys(EXCEL_FORMATS).length === Object.keys(FORMATS).length,
  "format: EXCEL_FORMATS is read from the same table as the display functions");
check(EXCEL_FORMATS.pct2 === "0.00%" && EXCEL_FORMATS.num3 === "0.000" && EXCEL_FORMATS.usd0 === '"$"#,##0' && EXCEL_FORMATS.date === "yyyy-mm-dd",
  "format: the Excel codes show what the page shows", JSON.stringify(EXCEL_FORMATS));

// Excel day numbers: 2024-01-01 is day 45292 in Excel's 1900 system; an impossible day is refused.
check(excelSerial("2024-01-01") === 45292 && excelSerial("1900-03-01") === 61, "format: excelSerial matches Excel's day numbers",
  `${excelSerial("2024-01-01")} ${excelSerial("1900-03-01")}`);
check(excelSerial("2026-02-31") === null && excelSerial("AAPL") === null, "format: excelSerial refuses what is not a day");

done("t-components");
