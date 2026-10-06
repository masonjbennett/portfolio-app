// The formula line (src/tabs/formula.ts, src/components/FormulaLine.tsx): at the Formula explanation level
// each tab prints one line under its finding, the formula behind the finding's figure with the tab's own
// numbers in it. Run with `node --import ./test/_tsx.mjs test/t-formula.mjs`.
//
// (a) Every tab and segment, rendered at the three levels, on the first-screen example and the mega-cap
//     prices (the Optimization, Custom and Sensitivity tabs also with shorting on and at a rate no asset
//     beats): the finding's text is the same at every level; the line is drawn at Formula only, once.
// (b) The line's numbers: every numeral in it, but the formula's own constants, is a figure the tab prints
//     outside the line, to the precision it is printed at; and the finding's own figures are in the line,
//     so the two cannot disagree.
//     And each figure in its place: every figure the line names is held to what it names (the ticker beside an
//     amount, the pair beside a correlation, the window count, the whole-window figure against the held-out
//     one, each ratio's operands against the portfolio they belong to), worked out here from the analysis
//     or read off the finding; and every ratio is redone from its printed operands, "=" only where they
//     give the printed result and "≈" only where their rounding moves it.
// (c) A finding with no figure draws no line: every builder's no-figure branch, and a refused custom mix
//     rendered.
// (d) The face: the data face at the body's size, in the second ink, wrapping inside a measure; and the
//     line's spoken form, every symbol in words and every figure as printed, the symbols hidden from a
//     screen reader.
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { act, render, text } from "./_dom.mjs";
import { exampleAnalysis, fixtureAnalysis, settingsFor, tabProps } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const F = await import("../src/tabs/formula.ts");
const { TRADING_DAYS } = await import("../src/lib/stats.ts");
const { format, MINUS } = await import("../src/format.ts");
const { growth } = await import("../src/tabs/returns/model.ts");
const { portRow } = await import("../src/tabs/optimization/model.ts");
const { fitWindows, swing } = await import("../src/tabs/sensitivity/model.ts");
const { default: Boundary } = await import("../src/components/Boundary.tsx");
const TABS = {
  returns: (await import("../src/tabs/Returns.tsx")).default,
  risk: (await import("../src/tabs/Risk.tsx")).default,
  correlation: (await import("../src/tabs/Correlation.tsx")).default,
  optimization: (await import("../src/tabs/Optimization.tsx")).default,
  custom: (await import("../src/tabs/Custom.tsx")).default,
  sensitivity: (await import("../src/tabs/Sensitivity.tsx")).default,
};
const { default: Live } = await import("../src/tabs/walkforward/Live.tsx");
const { default: Published } = await import("../src/tabs/walkforward/Published.tsx");

const LEVELS = ["plain", "finance", "formula"];
const NONE = { basis: "fallback", points: null, flat: "unavailable" };

const quietly = async (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};
// The walk-forward run is solved after paint, a slice per macrotask; the other tabs' deferred work likewise.
const flush = () => act(async () => {
  for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 0));
});

// Numerals as the page prints them: "10,000", "25.31", "0.864", "2,014". A sign is not part of a numeral.
const NUMERAL = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const numerals = (s) => s.match(NUMERAL) ?? [];
// The formula's own constants: the trading days a year (and its square root's argument), the 1 in
// (1 + r), a sum of weights and a bound, the 0 of a long-only bound, the first window's index.
const CONSTANTS = new Set([String(TRADING_DAYS), "1", "0"]);

// What a reader sees printed on the tab, the line itself and the hover-only tooltip bodies left out.
function printed(root) {
  const c = root.cloneNode(true);
  for (const el of c.querySelectorAll(".formula-line, .tip-text, [role=tooltip]")) el.remove();
  return text(c);
}

// The figures of a finding that its formula computes: by default every decimal in it; the Returns finding's
// amounts and returns; the Optimization finding's Sharpe ratios (its weights are the solve's answer, not
// the formula's).
const FIGURES = {
  default: (s) => numerals(s).filter((n) => n.includes(".")),
  returns: (s) => (s.match(/\$\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?%/g) ?? []).map((x) => x.replace(/[$%]/g, "")),
  optimization: (s) => numerals(s).filter((n) => /^\d+\.\d{3}$/.test(n)),
};

const seen = { renders: 0, lines: 0, numerals: 0 };

function tabElement(name, a, level, extra = {}) {
  const el =
    name === "live"
      ? h(Live, { analysis: a, settings: settingsFor({ tickers: a.tickers, start: a.requested.start, end: a.requested.end, benchmark: a.benchmark }, { allowShort: a.allowShort }), level, rates: NONE })
      : name === "published"
        ? h(Published, { level, rerun() {} })
        : h(TABS[name], tabProps(a, { level, ...extra }));
  return h(Boundary, { name, resetKey: a }, el);
}

async function mountTab(name, a, level, extra = {}) {
  const r = await quietly(() => render(tabElement(name, a, level, extra)));
  await quietly(flush);
  seen.renders += 1;
  return r;
}

// The finding each tab's line sits under.
const FINDING = { live: ".wfl-finding", published: ".wfp-decay" };
const findingOf = (root, name) => root.querySelector(FINDING[name] ?? "h2.tab-finding");

/**
 * Renders one tab, then moves it through the three levels as the rail's control does (a rerender with the new
 * level), and holds its line to the checks in (a) and (b). Returns the line.
 */
async function holdTab(tag, name, a, extra = {}) {
  const at = {};
  const r = await mountTab(name, a, LEVELS[0], extra);
  for (const level of LEVELS) {
    if (level !== LEVELS[0]) {
      await quietly(() => act(() => r.rerender(tabElement(name, a, level, extra))));
      await quietly(flush);
    }
    const f = findingOf(r.container, name);
    const lines = [...r.container.querySelectorAll(".formula-line")];
    const symbols = lines.map((l) => l.querySelector(".formula-line-symbols"));
    at[level] = {
      finding: f ? text(f) : null,
      lines: symbols.map((x) => (x ? text(x) : "")),
      words: lines.map((l) => l.querySelector(".formula-line-words")),
      hidden: symbols.every((x) => x?.getAttribute("aria-hidden") === "true"),
      printed: printed(r.container),
      next: lines[0]?.previousElementSibling ?? null,
      f,
      root: r.container.cloneNode(true),
    };
  }
  r.unmount();
  const { plain, finance, formula } = at;
  check(!!plain.finding, `${tag}: the finding renders`);
  check(plain.finding === finance.finding && plain.finding === formula.finding, `${tag}: the finding's text is the same at every level`,
    `${plain.finding?.slice(0, 60)} | ${formula.finding?.slice(0, 60)}`);
  check(plain.lines.length === 0 && finance.lines.length === 0, `${tag}: no formula line at Plain or Finance`, `${plain.lines.length}, ${finance.lines.length}`);
  check(formula.lines.length === 1, `${tag}: one formula line at Formula`, String(formula.lines.length));
  const line = formula.lines[0] ?? "";
  // Directly under the finding: the line's previous sibling is the finding itself.
  check(formula.next === formula.f || (formula.next && formula.next.contains(formula.f)), `${tag}: the line sits directly under the finding`);
  seen.lines += 1;

  // (b) Every numeral but the constants is printed on the tab, at the precision it is printed at.
  const shown = new Set(numerals(formula.printed));
  const own = numerals(line).filter((n) => !CONSTANTS.has(n));
  seen.numerals += own.length;
  const stray = own.filter((n) => !shown.has(n));
  check(own.length > 0 && stray.length === 0, `${tag}: every number in the line is a figure the tab prints`, `not printed: ${stray.join(", ")} | ${line}`);
  // ... and the finding's own figures are all in the line.
  const figs = (FIGURES[name] ?? FIGURES.default)(formula.finding ?? "");
  const inLine = new Set(numerals(line));
  const lost = figs.filter((n) => !inLine.has(n));
  check(figs.length > 0 && lost.length === 0, `${tag}: the finding's figures are the line's`, `missing: ${lost.join(", ")} | ${formula.finding} | ${line}`);

  // (b) Each figure in its place, and each ratio redone from what it prints.
  const wrong = placed(name, a, line, formula.finding ?? "", formula.root);
  check(wrong !== null && wrong.length === 0, `${tag}: each figure in the line sits beside what it is the figure of`, `${(wrong ?? ["no place read"]).join(" | ")} | ${line}`);
  const bad = redone(line, name === "live" ? null : a.rf);
  check(bad.length === 0, `${tag}: each ratio, redone from its printed operands, gives its printed result ("=") or misses it only by their rounding ("≈")`, `${bad.join(" | ")} | ${line}`);

  // (d) The spoken form: every symbol in words, the same figures in the same order, the symbols unread.
  const words = formula.words[0] ? text(formula.words[0]) : "";
  check(formula.hidden && words.length > 0 && !SYMBOL_CHARS.test(words) && numerals(words).join() === numerals(line).join(),
    `${tag}: the line has a spoken form, every symbol in words and every figure as printed, and its symbols are hidden from a screen reader`,
    `${formula.hidden} | ${words}`);
  return line;
}

// Every symbol a line may print, none of which a screen reader should meet.
const SYMBOL_CHARS = /[ᵀΣμ√∏ρσ×≈…₀ᵢⱼₖ_\[\]=\/−]/;

// A printed figure as a number; a figure as the tab prints it, its sign included.
const val = (s) => Number(s.replace(MINUS, "-").replace(/[%,$]/g, ""));
const FIG = String.raw`(${MINUS}?\$?[\d,]*\.?\d+%?)`;
const RATIO = new RegExp(String.raw`\(${FIG} ${MINUS} ${FIG}\) / ${FIG} ([=≈]) ${FIG}`, "g");
const ratios = (line) => [...line.matchAll(RATIO)].map((m) => ({ mu: m[1], rf: m[2], sigma: m[3], op: m[4], sharpe: m[5] }));

/** Every ratio in a line, redone from its printed operands; what fails, in words. `rf` the rate each must print, or null. */
function redone(line, rf) {
  const out = [];
  for (const r of ratios(line)) {
    const [mu, rate, sigma, sharpe] = [val(r.mu), val(r.rf), val(r.sigma), val(r.sharpe)];
    const redo = (mu - rate) / sigma;
    const same = format(redo, "num3") === r.sharpe;
    // How far the operands' rounding (half a hundredth of a percent each) can move the ratio, and the result's own.
    const slack = 0.005 * (2 / Math.abs(sigma) + Math.abs(mu - rate) / sigma ** 2) + 0.0005 + 1e-9;
    if (r.op === "=" && !same) out.push(`"=" but ${r.mu} ${MINUS} ${r.rf} over ${r.sigma} is ${redo.toFixed(4)}, not ${r.sharpe}`);
    if (r.op === "≈" && same) out.push(`"≈" where the operands give ${r.sharpe} exactly`);
    if (r.op === "≈" && Math.abs(redo - sharpe) > slack) out.push(`${r.sharpe} is further from ${redo.toFixed(4)} than the operands' rounding reaches`);
    if (rf !== null && r.rf !== format(rf, "pct2")) out.push(`rate ${r.rf}, not the analysis' ${format(rf, "pct2")}`);
  }
  return out;
}

// The daily returns' correlation and the deepest fall, worked out here from the analysis' returns.
function pearson(x, y) {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
function deepest(r) {
  let w = 1;
  let high = 1;
  let low = 0;
  for (const v of r) {
    w *= 1 + v;
    high = Math.max(high, w);
    low = Math.min(low, w / high - 1);
  }
  return low;
}

/**
 * Each figure a line prints, held to what it is printed beside. Returns what is out of place (empty when
 * nothing is), or null when the line's shape could not be read at all, so a reworded line is seen.
 */
function placed(name, a, line, finding, root) {
  const out = [];
  const want = (got, exp, what) => got === exp || out.push(`${what}: ${got}, want ${exp}`);
  if (name === "returns") {
    const m = /^W = W₀ × ∏\(1 \+ r\), r each daily return: (\$[\d,]+) × ∏\(1 \+ r\) = (\$[\d,]+) for (.+), (\$[\d,]+) for (.+)$/.exec(line);
    if (!m) return null;
    const g = growth(a, val(m[1]));
    const top = g.lines.reduce((b, l) => (l.end > b.end ? l : b));
    const bottom = g.lines.reduce((b, l) => (l.end < b.end ? l : b));
    want(m[1], format(g.amount, "usd0"), "the starting amount");
    want(m[3], top.name, "the highest end's name");
    want(m[2], format(top.end, "usd0"), `${m[3]}'s end`);
    want(m[5], bottom.name, "the lowest end's name");
    want(m[4], format(bottom.end, "usd0"), `${m[5]}'s end`);
  } else if (name === "risk") {
    const m = new RegExp(String.raw`its lowest for (.+): ${FIG}$`).exec(line);
    if (!m) return null;
    const worst = a.tickers.map((t, i) => [t, deepest(a.returns[i])]).reduce((b, x) => (x[1] < b[1] ? x : b));
    want(m[1], worst[0], "the deepest fall's asset");
    want(m[2], format(worst[1], "pct1"), `${m[1]}'s lowest drawdown`);
  } else if (name === "correlation") {
    const pairs = [...line.matchAll(new RegExp(String.raw`ρ\(([^,]+), ([^)]+)\) = ${FIG}`, "g"))];
    if (!pairs.length) return null;
    const all = [];
    a.tickers.forEach((x, i) => a.tickers.forEach((y, j) => j > i && all.push({ x, y, r: pearson(a.returns[i], a.returns[j]) })));
    const hi = all.reduce((b, p) => (p.r > b.r ? p : b));
    const lo = all.reduce((b, p) => (p.r < b.r ? p : b));
    for (const [k, p] of pairs.entries()) {
      const i = a.tickers.indexOf(p[1]);
      const j = a.tickers.indexOf(p[2]);
      want(p[3], i >= 0 && j >= 0 ? format(pearson(a.returns[i], a.returns[j]), "num2") : "no such pair", `ρ(${p[1]}, ${p[2]})`);
      const role = k === 0 ? hi : lo;
      want(`${p[1]},${p[2]}`, `${role.x},${role.y}`, k === 0 ? "the most correlated pair" : "the least correlated pair");
    }
  } else if (name === "optimization") {
    const rs = ratios(line);
    if (!rs.length) return null;
    const ew = portRow(a, a.ew);
    const as = (r, p, what) => {
      want(r.mu, format(p.mu, "pct2"), `${what}'s return`);
      want(r.sigma, format(p.sigma, "pct2"), `${what}'s volatility`);
      want(r.sharpe, format(p.sharpe, "num3"), `${what}'s Sharpe ratio`);
    };
    if (/maximum Sharpe over/.test(line)) {
      as(rs[0], a.tangency, "maximum Sharpe");
      as(rs[1], ew, "equal weights");
    } else if (/at its highest in-sample over/.test(line)) as(rs[0], a.tangency, "the highest ratio");
    else if (/at equal weights/.test(line)) as(rs[0], ew, "equal weights");
    else return null;
  } else if (name === "custom") {
    if (!ratios(line).length) return null;
    const m = new RegExp(String.raw`at the tangency weights, in-sample: ${FIG}$`).exec(line);
    if (a.tangency) want(m?.[1] ?? "none", format(a.tangency.sharpe, "num3"), "the tangency's Sharpe ratio");
  } else if (name === "sensitivity") {
    const fits = fitWindows(a).value;
    const k = /k = 1, …, (\d+),/.exec(line);
    if (!k) return null;
    want(k[1], String(fits.length), "the number of windows");
    for (const [port, head] of [["tan", "tangency w = "], ["gmv", "GMV w = "]]) {
      const s = swing(fits, port, a.tickers);
      const m = new RegExp(String.raw`${head}[^:]*: w\(([^)]+)\) (?:from ${FIG} to ${FIG}|= ${FIG} in every window)`).exec(line);
      if (!s || !m) {
        if (!s !== !m) out.push(s ? `no ${port} range` : `a ${port} range where that optimisation failed`);
        continue;
      }
      want(m[1], s.ticker, `the ${port} weight that moves most`);
      want(m[2] ?? m[4], format(s.lo, "pct1"), `${s.ticker}'s lowest ${port} weight`);
      want(m[3] ?? m[4], format(s.hi, "pct1"), `${s.ticker}'s highest ${port} weight`);
    }
    const rate = new RegExp(String.raw`at r_f = ${FIG}`).exec(line);
    if (rate) want(rate[1], format(a.rf, "pct2"), "the rate");
  } else if (name === "live" || name === "published") {
    const m = new RegExp(String.raw`: ${FIG} in-sample, over the whole window, and ${FIG} over the held-out days joined$`).exec(line);
    if (!m) return null;
    let whole = null;
    let held = null;
    if (name === "live") {
      const f = new RegExp(String.raw`scored ${FIG} on the whole window.* and ${FIG} on days its weights had not seen`).exec(finding);
      [whole, held] = f ? [f[1], f[2]] : ["unread", "unread"];
    } else {
      for (const item of root.querySelectorAll(".wfp-decay-item")) {
        const term = item.querySelector("dt")?.textContent.trim();
        const fig = item.querySelector(".wfp-decay-figure")?.textContent.trim();
        if (term === "In-sample") whole = fig;
        if (term === "Out-of-sample") held = fig;
      }
    }
    want(m[1], whole, "the whole-window (in-sample) figure");
    want(m[2], held, "the held-out days' figure");
  }
  return out;
}

// ---- (a) and (b): every tab, every level -----------------------------------------------------------------
const EX = exampleAnalysis();
const MEGA = fixtureAnalysis("megacap");
const SHORT = exampleAnalysis({ allowShort: true });
const HIGH = exampleAnalysis({ rf: 0.5 });
const lines = {};
for (const [set, a] of [["example", EX], ["mega-cap", MEGA]]) {
  for (const name of [...Object.keys(TABS), "live"]) lines[`${name} ${set}`] = await holdTab(`${name}, ${set}`, name, a);
}
lines.published = await holdTab("published", "published", EX);
for (const name of ["optimization", "custom", "sensitivity"]) lines[`${name} short`] = await holdTab(`${name}, example with shorting`, name, SHORT);
for (const name of ["optimization", "custom"]) lines[`${name} high rate`] = await holdTab(`${name}, example at a 50% rate`, name, HIGH);

// The branches each case reaches, so a case that drifted to another branch is seen.
check(/^Sharpe = /.test(lines["optimization example"]) && /in-sample, maximum Sharpe over weights summing to 1, each in \[0, 1\]/.test(lines["optimization example"]),
  "optimization: the default example reaches the maximum-Sharpe branch, long-only", lines["optimization example"]);
check(/each in \[−1, 1\]/.test(lines["optimization short"]), "optimization: with shorting the bounds read [−1, 1]", lines["optimization short"]);
check(/at its highest in-sample over/.test(lines["optimization high rate"]) && lines["optimization high rate"].includes("50.00%"),
  "optimization: at a rate no mix beats, the line is the highest ratio's at that rate", lines["optimization high rate"]);
check(/^W = W₀ × ∏\(1 \+ r\)/.test(lines["returns example"]), "returns: the default amount draws the growth formula", lines["returns example"]);
check(/at the tangency weights, in-sample: \d\.\d{3}$/.test(lines["custom example"]), "custom: the tangency ratio the finding compares with is in the line", lines["custom example"]);
check(/^Sharpe = \(252 × mean\(r\)/.test(lines["live example"]), "live: a run with no daily rate series is scored flat", lines["live example"]);
check(/r_f = \d+\.\d%/.test(lines.published), "published: the published run's rate, as the segment prints it", lines.published);

// ---- (c) no figure, no line ------------------------------------------------------------------------------
check(F.returnsFormula({ amount: 10000, dates: [], lines: [{ name: "X", end: NaN, total: NaN }] }, true) === null, "no figure: a growth line that is not a number");
check(F.returnsFormula({ amount: 10000, dates: [], lines: [] }, true) === null, "no figure: no growth line");
check(F.riskFormula(null) === null, "no figure: no drawdown measured");
check(F.riskFormula({ name: "X", dates: [], values: [0], max: 0, trough: 0, peak: 0, recovered: null }) === null, "no figure: no asset ever fell");
check(F.correlationFormula({ high: null, low: null }) === null, "no figure: no pair with a correlation");
check(F.optimizationFormula(null, null, { mu: NaN, sigma: NaN, sharpe: NaN }, 0.04, false) === null, "no figure: every solve failed and equal weights have no figures");
check(F.optimizationFormula(null, { sigma: NaN }, { mu: 0.1, sigma: 0.1, sharpe: 0.6 }, 0.04, false) === null, "no figure: a GMV volatility that is not a number");
check(F.customFormula(false, { mu: 0.1, sigma: 0.1, sharpe: 0.6 }, 0.04, 1) === null, "no figure: refused custom weights");
check(F.sensitivityFormula(4, null, null, 0.04, false) === null, "no figure: neither optimisation succeeded in any window");
check(F.liveFormula([], "flat") === null, "no figure: no maximum-Sharpe row");
check(F.liveFormula([{ key: "tan", inSample: 1, oos: null }], "flat") === null, "no figure: no out-of-sample figure");
check(F.publishedFormula("", "0.5", 0.02) === null, "no figure: no published figure");
{
  // A refused mix, rendered: weights that sum to zero.
  const zero = Object.fromEntries(EX.tickers.map((t) => [t, 0]));
  const r = await mountTab("custom", EX, "formula", { weights: zero });
  const f = text(findingOf(r.container, "custom") ?? { textContent: "" });
  check(/^No custom portfolio/.test(f) && !r.container.querySelector(".formula-line"), "no figure: a refused custom mix draws no line at Formula", f);
  r.unmount();
}
{
  // Shorting changes the bounds and nothing else in the builder.
  const t = { w: [1], mu: 0.2, sigma: 0.1, sharpe: 1.5, beatsRf: true };
  const ew = { mu: 0.1, sigma: 0.1, sharpe: 0.5 };
  const long = F.optimizationFormula(t, null, ew, 0.05, false);
  const short = F.optimizationFormula(t, null, ew, 0.05, true);
  check(long.replace("[0, 1]", "[−1, 1]") === short, "builder: shorting changes only the bounds", `${long} | ${short}`);
  check(long.endsWith("(20.00% − 5.00%) / 10.00% = 1.500; equal weights: (10.00% − 5.00%) / 10.00% = 0.500"),
    "builder: each ratio is (return − rate) / volatility = Sharpe, at the figures given", long);
  // Operands that print as 16.89%, 2.85% and 14.06% give 0.9986, which prints 0.999: a printed 0.998 is "≈".
  const ew2 = { mu: 0.1, sigma: 0.1, sharpe: 0.715 };
  const near = F.optimizationFormula({ ...t, mu: 0.1689, sigma: 0.1406, sharpe: 0.9984 }, null, ew2, 0.0285, false);
  const exact = F.optimizationFormula({ ...t, mu: 0.1689, sigma: 0.1406, sharpe: 0.99858 }, null, ew2, 0.0285, false);
  check(near.includes("(16.89% − 2.85%) / 14.06% ≈ 0.998") && exact.includes("(16.89% − 2.85%) / 14.06% = 0.999") &&
    near.endsWith("(10.00% − 2.85%) / 10.00% = 0.715"),
    "builder: a ratio says ≈ where its printed operands give another third digit, and = where they give it", `${near} | ${exact}`);
  check(F.spoken("(16.89% − 2.85%) / 14.06% ≈ 0.998") === "(16.89% minus 2.85%) over 14.06% is about 0.998",
    "spoken: a ratio reads as words", F.spoken("(16.89% − 2.85%) / 14.06% ≈ 0.998"));
}

// ---- (d) the face -----------------------------------------------------------------------------------------
{
  const css = readFileSync(new URL("../src/components/FormulaLine.css", import.meta.url), "utf8");
  const rule = css.match(/\.formula-line\s*\{([^}]*)\}/)?.[1] ?? "";
  const prop = (p) => rule.match(new RegExp(`(?:^|;|\\s)${p}:\\s*([^;]+);`))?.[1]?.trim();
  check(prop("font-family") === "var(--font-mono)" && prop("font-size") === "16px" && prop("color") === "var(--color-ink2)",
    "face: the data face at the body's size, in the second ink", rule.replace(/\s+/g, " "));
  check(/^\d+px$/.test(prop("max-width") ?? "") && parseInt(prop("max-width"), 10) <= 720 && prop("overflow-wrap") === "anywhere",
    "face: a reading measure, and a long run breaks rather than pushing the page sideways", rule.replace(/\s+/g, " "));
}

console.log(`  ${seen.renders} renders, ${seen.lines} lines held, ${seen.numerals} numerals checked`);
done("t-formula");
