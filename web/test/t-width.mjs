// The page's width on a wide screen (src/App.css). The page is 1,280 px wide on every screen up to
// 1,640 px, so nothing on it moves there, then widens with the screen to 1,680 px at 1,920 and stops.
// The rule is read out of the stylesheet and EVALUATED at each screen width (a small evaluator for the
// calc/clamp/min/max arithmetic below), so a rule that reads plausibly but computes something else fails.
// Prose does not widen with the page: past 1,640 px a paragraph that would run with the wider column
// stops at a reading measure (--prose-measure), and up to 1,640 px the measure is none.
import { readdirSync, readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const APP_CSS = strip(read("src/App.css"));

// The declarations of the first rule whose selector list is exactly `sel` (whitespace aside).
function block(css, sel) {
  const want = sel.replace(/\s+/g, " ").trim();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].replace(/\s+/g, " ").trim() === want) return m[2];
  return null;
}
function decl(body, prop) {
  if (body === null) return null;
  const m = new RegExp(`(?:^|;|\\s)${prop.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);?`).exec(body);
  return m ? m[1].trim() : null;
}

// ---- a CSS length evaluator: px, vw and bare numbers; + - * / and calc, clamp, min, max ---------
function evaluate(expr, vw) {
  const toks = [];
  const re = /\s*(?:(\d*\.?\d+)(px|vw)?|([a-z-]+)\(|([-+*/(),]))/gy;
  let m;
  let at = 0;
  while (at < expr.length) {
    re.lastIndex = at;
    m = re.exec(expr);
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(expr.slice(at))) break;
      throw new Error(`cannot read "${expr.slice(at)}"`);
    }
    at = re.lastIndex;
    if (m[1] !== undefined) toks.push({ n: Number(m[1]) * (m[2] === "vw" ? vw / 100 : 1) });
    else if (m[3] !== undefined) toks.push({ fn: m[3] });
    else toks.push({ op: m[4] });
  }
  let i = 0;
  const peek = () => toks[i];
  const take = (op) => {
    if (toks[i]?.op !== op) throw new Error(`expected "${op}" at token ${i}`);
    i += 1;
  };
  function args() {
    const out = [sum()];
    while (peek()?.op === ",") {
      i += 1;
      out.push(sum());
    }
    take(")");
    return out;
  }
  function factor() {
    const t = toks[i++];
    if (!t) throw new Error("ran out of tokens");
    if (t.n !== undefined) return t.n;
    if (t.op === "-") return -factor();
    if (t.op === "(") {
      const v = sum();
      take(")");
      return v;
    }
    if (t.fn === "calc") return args()[0];
    if (t.fn === "min") return Math.min(...args());
    if (t.fn === "max") return Math.max(...args());
    if (t.fn === "clamp") {
      const [lo, v, hi] = args();
      return Math.max(lo, Math.min(v, hi));
    }
    throw new Error(`unexpected ${JSON.stringify(t)}`);
  }
  function product() {
    let v = factor();
    while (peek()?.op === "*" || peek()?.op === "/") {
      const op = toks[i++].op;
      const r = factor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (peek()?.op === "+" || peek()?.op === "-") {
      const op = toks[i++].op;
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const v = sum();
  if (i !== toks.length) throw new Error(`left over: ${JSON.stringify(toks.slice(i))}`);
  return v;
}

// The evaluator itself, on cases worked by hand, so a broken evaluator cannot pass the rule.
check(evaluate("1280px", 2000) === 1280 && evaluate("calc(10px + 50vw)", 1000) === 510 &&
  evaluate("clamp(100px, 50vw, 300px)", 100) === 100 && evaluate("clamp(100px, 50vw, 300px)", 400) === 200 &&
  evaluate("clamp(100px, 50vw, 300px)", 1000) === 300 && evaluate("min(2px, 3px) * 2 - 1px", 0) === 3 &&
  evaluate("calc((100vw - 40px) * 10 / 5)", 100) === 120,
  "evaluator: px, vw, the four functions and operator precedence");

// ---- the page's width --------------------------------------------------------------------------
const app = block(APP_CSS, ".app");
const rule = decl(app, "max-width");
check(rule !== null, "width: .app has a max-width", app ?? "no .app rule");
const width = (vw) => evaluate(rule ?? "0px", vw);
const near = (a, b) => Math.abs(a - b) < 1e-9;

check(near(width(1366), 1280), "width: 1,280 px at a 1,366 px screen (the screen-share, unchanged)", `${width(1366)}`);
check(near(width(1640), 1280), "width: 1,280 px at a 1,640 px screen, the widest at which the page keeps its width", `${width(1640)}`);
check(near(width(1920), 1680), "width: 1,680 px at a 1,920 px screen", `${width(1920)}`);
check(near(width(2560), 1680), "width: 1,680 px at a 2,560 px screen, and no wider", `${width(2560)}`);

let off = null;
for (let v = 320; v <= 1640 && off === null; v += 1) if (!near(width(v), 1280)) off = v;
check(off === null, "width: 1,280 px at every screen from 320 to 1,640 px, so nothing below 1,640 moves", `${off}: ${off && width(off)}`);

let step = null;
for (let v = 1640; v < 2560 && step === null; v += 1) {
  const d = width(v + 1) - width(v);
  if (d < 0 || d > 10 / 7 + 1e-9) step = v;
}
check(step === null, "width: from 1,640 it grows by at most 10 px for every 7, with no jump, and never shrinks", `${step}`);

// ---- the reading measure -----------------------------------------------------------------------
const base = decl(app, "--prose-measure");
const wide = /@media\s*\(\s*min-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)\s*\{\s*\.app\s*\{([^}]*)\}\s*\}/.exec(APP_CSS);
const knee = (() => {
  for (let v = 320; v <= 2560; v += 1) if (width(v) > 1280 + 1e-9) return v;
  return null;
})();
check(base === "100%" && !!wide && Number(wide[1]) === knee && /^\d+(\.\d+)?ch$/.test(decl(wide[2], "--prose-measure") ?? ""),
  "measure: the whole box (no cap) up to 1,640 px; a reading measure in ch from the first screen width at which the page widens",
  `base ${base}, from ${wide?.[1]}px (page widens from ${knee}px), ${wide && decl(wide[2], "--prose-measure")}`);

// Each paragraph that would otherwise widen with the page opts in. The list is the prose measured at a
// 1,920 px screen running with the column; a new one is added here when it is given the measure.
const OPT_IN = [
  ["src/components/ChartFrame.css", ".chart-title"],
  ["src/components/ChartFrame.css", ".chart-sub"],
  ["src/chrome/Masthead.css", ".masthead-dek"],
  ["src/tabs/sensitivity/Sensitivity.css", ".sens-caption"],
  ["src/tabs/walkforward/Published.css", ".wfp-lede, .wfp-text, .wfp-foot"],
  ["src/chrome/Footer.css", ".footer p"],
  ["src/chrome/Footer.css", ".footer-method dl"],
  ["src/chrome/Band.css", ".band-finding"],
  ["src/chrome/Band.css", ".band-published"],
];
for (const [file, sel] of OPT_IN) {
  const v = decl(block(strip(read(file)), sel), "max-width");
  check(v !== null && /var\(--prose-measure, 100%\)/.test(v), `measure: ${sel} (${file}) stops at the reading measure on a wide screen`, `${v}`);
}

// Every use carries the 100% fallback: where the property is not defined, a bare var() would make the
// whole max-width invalid, and a paragraph's own measure inside min() would be lost with it.
const uses = [];
(function walk(dir) {
  for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${dir}/${e.name}`);
    else if (e.name.endsWith(".css")) for (const m of strip(read(`${dir}/${e.name}`)).matchAll(/var\(--prose-measure[^)]*\)/g)) uses.push([`${dir}/${e.name}`, m[0]]);
  }
})("src");
const bare = uses.filter(([, u]) => u !== "var(--prose-measure, 100%)");
check(uses.length >= OPT_IN.length && bare.length === 0, "measure: every use falls back to 100% where the property is not set",
  bare.map(([f, u]) => `${f}: ${u}`).join("; ") || `${uses.length} uses`);

done("t-width");
