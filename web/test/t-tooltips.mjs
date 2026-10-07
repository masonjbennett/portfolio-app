// The app's tiered tooltips (portfolio_app.py 525-587), the port's one deliberate change to them, and
// the info mark that shows them.
//
// (a) src/content/tooltips.json equals a fresh dump of the app's TOOLTIPS dict
//     (test/oracle/dump_tooltips.py, standard library only). With no Python at all it prints SKIP.
// (b) every key carries all three levels, in LEVELS' order, and the keys are exactly TipKey.
// (c) tipText is the app's text with shorting off, for every key and level.
// (d) ledger:short-bounds-copy, tooltip half: the app's texts promise long-only weights and its tip()
//     ignores the toggle; the port's follow the toggle and state the [-1, 1] bounds.
// (e) Tip: the mark, its accessible name and description, tap to pin, Escape and a tap away to close.
import { render, text, act } from "./_dom.mjs";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { check, done } from "./_assert.mjs";

const { createElement: h } = await import("react");
const web = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, web), "utf8");
const app = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const committed = read("src/content/tooltips.json");
const TIPS = JSON.parse(committed);
const { tipText, SHORT_OVERRIDES, WORD_OVERRIDES, TIP_NAMES, NOTES } = await import("../src/content/tooltips.ts");
const { LEVELS } = await import("../src/types.ts");
const Tip = (await import("../src/components/Tip.tsx")).default;
const LEVEL_IDS = LEVELS.map((l) => l.id);
// A text as tipText should return it: the closing line on file for that key and level, if any, after it.
const withNote = (key, level, t) => (NOTES[key]?.[level] ? `${t} ${NOTES[key][level]}` : t);

// ---- (a) the committed json is a fresh dump ------------------------------------------------------
function findPython() {
  for (const rel of ["../../.venv/Scripts/python.exe", "../../.venv/bin/python"]) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return p;
  }
  for (const name of ["python3", "python"]) {
    const r = spawnSync(name, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return name;
  }
  return null;
}
const py = findPython();
if (!py) {
  console.log("t-tooltips: SKIP the freshness check: no Python interpreter (looked for ../.venv, python3, python)");
} else {
  const dump = fileURLToPath(new URL("./oracle/dump_tooltips.py", import.meta.url));
  const r = spawnSync(py, [dump, "--print"], { encoding: "utf8" });
  check(r.status === 0, "tooltips: dump_tooltips.py runs", (r.stderr || "").trim().split("\n").pop());
  const fresh = (r.stdout ?? "").replace(/\r\n/g, "\n");
  const ours = committed.replace(/\r\n/g, "\n");
  const at = fresh.split("\n").findIndex((line, i) => line !== ours.split("\n")[i]);
  check(r.status === 0 && fresh === ours, "tooltips: src/content/tooltips.json equals a fresh dump of TOOLTIPS (re-run dump_tooltips.py)",
    at < 0 ? "" : `first difference at line ${at + 1}: ${JSON.stringify(fresh.split("\n")[at])}`);
}

// ---- (b) keys and levels ---------------------------------------------------------------------------
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const keys = Object.keys(TIPS);
check(keys.length === 11, "tooltips: the app's eleven keys", keys.join(","));
for (const key of keys) {
  const levels = Object.keys(TIPS[key]);
  check(same(levels, LEVEL_IDS) && levels.every((l) => typeof TIPS[key][l] === "string" && TIPS[key][l].trim().length > 20),
    `tooltips: ${key} carries all three levels, in order, each with text`, levels.join(","));
}
const tipKeys = /export type TipKey =([^;]+);/.exec(read("src/types.ts"))?.[1].match(/"(\w+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
check(same(tipKeys, keys), "tooltips: TipKey in types.ts is exactly the app's keys, in the app's order", tipKeys.join(","));
check(same(Object.keys(TIP_NAMES), keys), "tooltips: every key has an accessible name", Object.keys(TIP_NAMES).join(","));

// ---- (c) the app's text with shorting off ----------------------------------------------------------
let mismatches = [];
for (const key of keys) for (const level of LEVEL_IDS) {
  if (!WORD_OVERRIDES[key]?.[level] && tipText(key, level) !== withNote(key, level, TIPS[key][level])) mismatches.push(`${key}/${level}`);
}
check(mismatches.length === 0, "tooltips: tipText is the app's text at every key and level with shorting off, bar the word overrides and closing lines", mismatches.join(" "));
mismatches = [];
for (const key of keys) for (const level of LEVEL_IDS) {
  if (!SHORT_OVERRIDES[key]?.[level] && !WORD_OVERRIDES[key]?.[level] && tipText(key, level, true) !== withNote(key, level, TIPS[key][level])) mismatches.push(`${key}/${level}`);
}
check(mismatches.length === 0, "tooltips: with shorting on, every text not overridden is still the app's", mismatches.join(" "));
check(tipText("no_such_key", "plain") === "" && tipText("no_such_key", "formula", true) === "",
  "tooltips: an unknown key has no text, as tip() gives \"\" (586)");

// ---- (d) ledger:short-bounds-copy, tooltip half ---------------------------------------------------
// The app: tip() reads the level and nothing else, so its text cannot follow the toggle.
const tipFn = app.slice(app.indexOf("def tip("), app.indexOf("\n# ──", app.indexOf("def tip(")));
check(tipFn.includes("knowledge") && !/allow_short|short/i.test(tipFn.replace("def tip(key: str) -> str:", "")),
  "ledger:short-bounds-copy: the app's tip() reads only the level, never the shorting toggle", tipFn);
const LONG_ONLY = /long-only|wᵢ≥0|w_i\s*>=\s*0/;
const claims = [];
for (const key of keys) for (const level of LEVEL_IDS) if (LONG_ONLY.test(TIPS[key][level])) claims.push(`${key}/${level}`);
const overridden = Object.entries(SHORT_OVERRIDES).flatMap(([k, byLevel]) => Object.keys(byLevel).map((l) => `${k}/${l}`));
check(claims.length >= 2 && same([...claims].sort(), [...overridden].sort()),
  "ledger:short-bounds-copy: every app text that promises long-only weights is overridden, and only those",
  `claims ${claims.join(" ")} | overridden ${overridden.join(" ")}`);
for (const [key, byLevel] of Object.entries(SHORT_OVERRIDES)) {
  for (const [level, o] of Object.entries(byLevel)) {
    const at = `${key}/${level}`;
    check(o.was === TIPS[key][level] && LONG_ONLY.test(o.was),
      `ledger:short-bounds-copy: ${at} was checked against the app's current text, which says long-only`, TIPS[key][level]);
    check(tipText(key, level, false) === withNote(key, level, TIPS[key][level]),
      `ledger:short-bounds-copy: ${at} with shorting OFF is the app's text, which is right then`);
    const on = tipText(key, level, true);
    check(on === withNote(key, level, o.short) && on !== withNote(key, level, TIPS[key][level]) && on.includes("[-1, 1]") && !LONG_ONLY.test(on) && !/unconstrained/i.test(on),
      `ledger:short-bounds-copy: ${at} with shorting ON states the [-1, 1] bounds and not long-only`, on);
  }
}
// The bounds the text states are the solver's (optimize.ts; the app's methodology note, 781-782).
check(/\[-1, 1\] with shorting/.test(read("src/lib/optimize.ts")) && app.includes("bounds become [−1,1]"),
  "ledger:short-bounds-copy: [-1, 1] is the bound both the solver and the app's methodology note use");

// ---- (d2) ledger:plain-tip-words ------------------------------------------------------------------
// The app calls the tangency mix best or optimal at the default level; the plates beside those tips say
// in-sample. Every such text is replaced, only those are, each was read against the app's current words,
// and what replaces it says neither word, at either setting of the shorting toggle.
{
  const WORDS = /\b(best|optimal)|optimally/i;
  const said = [];
  for (const key of keys) for (const level of LEVEL_IDS) if (WORDS.test(TIPS[key][level])) said.push(`${key}/${level}`);
  const replaced = Object.entries(WORD_OVERRIDES).flatMap(([k, byLevel]) => Object.keys(byLevel).map((l) => `${k}/${l}`));
  check(said.length >= 2 && same([...said].sort(), [...replaced].sort()),
    "ledger:plain-tip-words every app text that calls a mix best or optimal is replaced, and only those", `said ${said.join(" ")} | replaced ${replaced.join(" ")}`);
  for (const [key, byLevel] of Object.entries(WORD_OVERRIDES)) {
    for (const [level, o] of Object.entries(byLevel)) {
      const at = `${key}/${level}`;
      check(o.was === TIPS[key][level], `ledger:plain-tip-words ${at} was checked against the app's current text`, TIPS[key][level]);
      const off = tipText(key, level, false);
      const on = tipText(key, level, true);
      check(off === withNote(key, level, o.now) && on === off && !WORDS.test(off) && /in-sample/.test(o.now),
        `ledger:plain-tip-words ${at} shows the replacement, which says in-sample and neither best nor optimal`, `${off} | ${on}`);
    }
  }
}

// ---- (d3) ledger:sharpe-se-note -------------------------------------------------------------------
// The band's tangency Sharpe plate prints a standard error the app never had. Its tip closes with one line
// per level saying what the ± is and that the weights were fitted on the same prices; no other tip does.
{
  const WORDS = /\b(best|optimal)|optimally/i;
  const noted = Object.entries(NOTES).flatMap(([k, byLevel]) => Object.keys(byLevel).map((l) => `${k}/${l}`));
  check(same(noted, LEVEL_IDS.map((l) => `best_sharpe/${l}`)),
    "ledger:sharpe-se-note only the tangency Sharpe tip carries a closing line, at every level", noted.join(" "));
  const band = read("src/chrome/Band.tsx");
  check(/tip: "best_sharpe",\s*se: /.test(band),
    "ledger:sharpe-se-note the plate that carries that tip prints a standard error");
  for (const level of LEVEL_IDS) {
    const note = NOTES.best_sharpe?.[level] ?? "";
    for (const short of [false, true]) {
      const t = tipText("best_sharpe", level, short);
      check(t.endsWith(` ${note}`) && t.length > note.length + 20 && /±/.test(note) && /fixed|fitted|set on these same prices/.test(note)
        && !WORDS.test(note) && !/\p{Extended_Pictographic}/u.test(note),
        `ledger:sharpe-se-note best_sharpe/${level} (shorting ${short ? "on" : "off"}) ends with the ± line, which says the weights were fitted here`, t);
    }
  }
  // The formula the line prints is the bracket sharpeSE computes.
  check(read("src/lib/stats.ts").includes("const bracket = 1 + (sr * sr) / 2 - g1 * sr + (g2 / 4) * sr * sr;")
    && (NOTES.best_sharpe?.formula ?? "").includes("√((1 + SR²/2 − γ₁·SR + (γ₂/4)·SR²) / T) × √252"),
    "ledger:sharpe-se-note the formula line is the bracket sharpeSE computes");
}

// ---- (e) Tip ---------------------------------------------------------------------------------------
{
  const r = render(h(Tip, { tip: "sharpe", level: "plain" }));
  const btn = r.container.querySelector("button");
  const pop = btn && r.container.querySelector(`#${CSS.escape(btn.getAttribute("aria-describedby") ?? "none")}`);
  check(btn?.getAttribute("type") === "button" && btn.getAttribute("aria-label") === "About Sharpe ratio",
    "tip: a real button, named for its key", btn?.outerHTML);
  check(pop?.getAttribute("role") === "tooltip" && text(pop) === TIPS.sharpe.plain,
    "tip: the button is described by the tooltip, which holds the level's text", pop ? text(pop) : "no tooltip");
  check(text(btn) === "i" && !/\p{Extended_Pictographic}/u.test(r.container.innerHTML),
    "tip: the mark is a typographic i, no emoji", btn ? text(btn) : "");
  check(btn?.getAttribute("aria-expanded") === "false" && !r.container.querySelector(".tip[data-open]"), "tip: starts closed");
  act(() => btn.click());
  check(btn.getAttribute("aria-expanded") === "true" && r.container.querySelector(".tip[data-open]") !== null,
    "tip: a tap or click pins it open");
  act(() => btn.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  check(btn.getAttribute("aria-expanded") === "false" && r.container.querySelector(".tip[data-hushed]") !== null,
    "tip: Escape closes it and hushes a hover or focus showing");
  act(() => btn.click());
  act(() => document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true })));
  check(btn.getAttribute("aria-expanded") === "false", "tip: a tap elsewhere closes it");
  r.rerender(h(Tip, { tip: "sharpe", level: "formula" }));
  check(text(r.container.querySelector("[role=tooltip]")) === TIPS.sharpe.formula, "tip: follows the level");
  r.rerender(h(Tip, { tip: "best_sharpe", level: "formula", allowShort: true }));
  check(text(r.container.querySelector("[role=tooltip]")) === withNote("best_sharpe", "formula", SHORT_OVERRIDES.best_sharpe.formula.short),
    "ledger:short-bounds-copy: the Tip shows the shorting text when shorting is on");
  r.unmount();
  const none = render(h(Tip, { tip: "no_such_key", level: "plain" }));
  check(none.container.innerHTML === "", "tip: no text, no mark (586)", none.container.innerHTML);
  none.unmount();
}
const css = read("src/components/Tip.css");
check(/\.tip-mark:focus-visible \+ \.tip-text/.test(css) && /\.tip\[data-open\] \.tip-text/.test(css) && /@media \(hover: hover\)/.test(css),
  "tip: its CSS shows the text on keyboard focus, when pinned, and on hover only where hover exists");

// A text that must name no scorecard column is held to this pattern: every column's head as the page prints it
// (the three solved portfolios, each added construction and each part of its name, Custom, every benchmark the
// reader can pick), and the words a sentence would use to point at one. It is built from the labels the page
// reads, so a column added later is covered without editing it.
const COLUMN_NAMES = await (async () => {
  const { PORT_LABEL, ADDED_LABEL } = await import("../src/tabs/optimization/model.ts");
  const { BENCHMARKS } = await import("../src/state/defaults.ts");
  const heads = [...Object.values(PORT_LABEL), ...Object.values(ADDED_LABEL), "Custom", ...BENCHMARKS.flatMap((b) => [b.display, b.symbol])];
  const words = ["benchmark", "last year", "last-year", "equal weight", "minimum variance", "risk parity", "shrunk", "capped", "tangency"];
  const parts = [...heads.flatMap((h) => [h, ...h.split(/,\s*/)]), ...words].filter((x) => x.length >= 3);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[- ]/g, "[- ]");
  return new RegExp(parts.map(esc).join("|"), "i");
})();

// The scorecard's own texts: their own keys, beside the app's, never in the dump.
{
  const { SCORE_TIPS, SCORE_TIP_NAMES, isScoreTip, tipName } = await import("../src/content/tooltips.ts");
  const sk = Object.keys(SCORE_TIPS);
  check(sk.length >= 18 && sk.every((k) => !keys.includes(k)) && sk.every((k) => isScoreTip(k)) && !keys.some((k) => isScoreTip(k)),
    "score-tips: the scorecard keys are their own, none an app key", sk.join(","));
  check(sk.every((k) => same(Object.keys(SCORE_TIPS[k]), LEVEL_IDS) && LEVEL_IDS.every((l) => SCORE_TIPS[k][l].trim().length > 20 && tipText(k, l) === SCORE_TIPS[k][l])),
    "score-tips: every scorecard key carries all three levels, in order, and tipText returns them");
  check(same(Object.keys(SCORE_TIP_NAMES), sk) && tipName("var") === "value at risk" && tipName("sharpe") === TIP_NAMES.sharpe,
    "score-tips: every scorecard key has an accessible name, and the app's keys keep theirs");
  check(sk.every((k) => LEVEL_IDS.every((l) => !/\p{Extended_Pictographic}/u.test(SCORE_TIPS[k][l]) && !/best (possible|mix|portfolio)|optimal/i.test(SCORE_TIPS[k][l]))),
    "score-tips: no emoji, and no text calls a mix best or optimal");
  // The scorecard prints a ± beside every column's Sharpe, and every column whose weights were solved on these
  // prices (GMV, Tangency and each added construction, the last-year one on part of the window) has a ± that
  // understates its uncertainty, as the plate's note says of the tangency. Each level says so for all of them,
  // names none of them (a list of names goes stale as columns are added; COLUMN_NAMES holds every one), and points
  // at the line under each column's name, which the next check holds to the page.
  const seText = (l) => SCORE_TIPS.sharpe_se[l];
  const named = LEVEL_IDS.filter((l) => COLUMN_NAMES.test(seText(l)));
  check(named.length === 0 &&
    /weights were chosen on these same prices, as the line under its name says, could be off by more/.test(seText("plain")) &&
    /understates the uncertainty for every column whose weights were fitted on this window or on part of it, as the line under its name says/.test(seText("finance")) &&
    /holds w fixed, so it understates the error wherever w was solved on these T returns or on a subset of them/.test(seText("formula")),
    "score-tips: the Sharpe ± text says at every level that the error understates for every column solved on this window, naming none",
    named.length ? `names a column at ${named.map((l) => `${l} ("${seText(l).match(COLUMN_NAMES)[0]}")`).join(", ")}` : LEVEL_IDS.map(seText).join(" | "));
}

// "The line under its name" is how the Sharpe ± text tells a solved column from a fixed one, so it must hold on the
// page: every column whose weights were solved here (GMV, Tangency, each added construction, long-only and with
// shorting) carries a line saying its weights were chosen on this window or on its last year, and no fixed-weight
// column (equal weight, the typed mix, the benchmark) carries one. A construction added later without that line
// goes red here. The parameters row's text is held the same way: every construction's count is one of the two
// cases its formula level names, by what the solve reads.
{
  const { SCORE_TIPS } = await import("../src/content/tooltips.ts");
  const { scorecard } = await import("../src/tabs/optimization/scorecard.ts");
  const { customWeights } = await import("../src/tabs/optimization/model.ts");
  const { ADDED_IDS } = await import("../src/lib/constructions.ts");
  const { paramCount } = await import("../src/lib/robust.ts");
  const { exampleAnalysis } = await import("./_analysis.mjs");
  const CHOSEN = /^weights chosen on (the last year of )?this window\b/;
  const wrong = [];
  let solved = 0;
  for (const allowShort of [false, true]) {
    const a = exampleAnalysis({ allowShort });
    for (const mix of [{}, Object.fromEntries(a.tickers.map((t, i) => [t, i + 1]))]) {
      const m = scorecard(a, customWeights(a, mix), { status: "ready", value: null }, ADDED_IDS);
      for (const c of m.columns) {
        const fixed = c.id === "ew" || c.id === "custom" || c.id === "bench";
        if (!c.ok) continue;
        if (!fixed) solved += 1;
        if (fixed ? CHOSEN.test(c.sub ?? "") || /chosen on/.test(c.sub ?? "") : !CHOSEN.test(c.sub ?? "")) wrong.push(`${c.id}${allowShort ? " short" : ""}: ${c.sub}`);
      }
    }
  }
  check(solved === 24 && wrong.length === 0,
    "score-tips: every solved column, and no fixed one, carries the line under its name that the Sharpe ± text points to", `${solved} solved; ${wrong.join(" | ")}`);
  const n = 7;
  const cases = [(n * (n + 1)) / 2, n + (n * (n + 1)) / 2];
  const kinds = ["gmv", "tan", ...ADDED_IDS];
  const off = kinds.filter((k) => !cases.includes(paramCount(k, n)));
  const p = SCORE_TIPS.frag_params;
  check(off.length === 0 && paramCount("ew", n) === 0 && paramCount("custom", n) === 0 &&
    p.formula === "weights from the covariance alone: n(n + 1)/2; from the means and the covariance: n + n(n + 1)/2; fixed weights: 0." &&
    !COLUMN_NAMES.test(`${p.finance} ${p.formula}`),
    "score-tips: the parameters row's formula covers every construction by what it reads, and names none", `off: ${off.join(", ")}; ${p.formula}`);
  // The finance level says what each kind of solve needs estimated, with nothing a reader could take as the solve's
  // own variances.
  check(p.finance === "A solve that reads only the covariance matrix needs every variance and covariance estimated; one that maximises the Sharpe ratio needs every expected return estimated as well. Compare with the days of data they rest on.",
    "score-tips: the parameters row's finance level says what each kind of solve needs estimated", p.finance);
}

// The added columns' tips quote the engine's cap, its fewest assets and its year from the constants the page
// reads, never as typed text: each says the constant's value, and the source of those entries holds none of
// those values as a literal, so changing a constant cannot leave a tip saying the old one.
{
  const { SCORE_TIPS } = await import("../src/content/tooltips.ts");
  const { CAP, CAP_MIN_ASSETS, YEAR_ROWS } = await import("../src/lib/constructions.ts");
  const pct = `${Math.round(CAP * 100)}%`;
  const capped = SCORE_TIPS.col_capped;
  const year = SCORE_TIPS.col_last_year;
  const says = capped.plain.includes(pct) && capped.finance.includes(pct) && capped.finance.includes(`at least ${CAP_MIN_ASSETS} assets`) &&
    capped.formula.includes(`≤ ${CAP};`) && year.finance.includes(`last ${YEAR_ROWS} daily returns`) && year.formula.includes(`those ${YEAR_ROWS} days`);
  const src = read("src/content/tooltips.ts");
  const block = src.slice(src.indexOf("  col_last_year: {"), src.indexOf("  col_parity: {"));
  const typed = [pct, String(CAP), String(YEAR_ROWS), "₂₅₂", "five assets"].filter((s) => block.includes(s));
  check(says && block.length > 500 && typed.length === 0,
    "score-tips: the added columns' tips read the cap, the fewest assets and the year from the engine's constants", `says ${says}; typed ${typed.join(", ")}`);
}

// The band's plates: the tangency keeps the app's tip; equal weight, GMV and the benchmark carry the port's own,
// each true for the figure under it, and each plate shows its text at every level.
{
  const { SCORE_TIPS, tipName } = await import("../src/content/tooltips.ts");
  const { snapshotPlates, default: Band } = await import("../src/chrome/Band.tsx");
  const { exampleAnalysis } = await import("./_analysis.mjs");
  const a = exampleAnalysis();
  const plates = snapshotPlates(a);
  const own = ["ew_sharpe", "gmv_sharpe", "bench_sharpe"];
  check(same(plates.map((p) => p.tip), ["ew_sharpe", "best_sharpe", "gmv_sharpe", "bench_sharpe"]) && own.every((k) => Object.hasOwn(SCORE_TIPS, k)) &&
    tipName("ew_sharpe") === "equal-weight Sharpe" && tipName("gmv_sharpe") === "GMV Sharpe (in-sample)" && tipName("bench_sharpe") === "benchmark Sharpe",
    "band tips: the tangency plate keeps the app's tip, the other three plates carry the port's own keys and names", plates.map((p) => p.tip).join(","));
  const T = (k) => LEVEL_IDS.map((l) => SCORE_TIPS[k][l]);
  // Equal weight was not fitted, and its text says so and never calls it in-sample; GMV's was, and says in-sample;
  // the benchmark's names the benchmark; every formula annualises as the engine does (× 252) at the page's rate.
  check(T("ew_sharpe").every((t) => !/in-sample|fitted on|chosen on/i.test(t)) && /Nothing was fitted/.test(SCORE_TIPS.ew_sharpe.plain) &&
    /No estimate chooses the weights/.test(SCORE_TIPS.ew_sharpe.finance) && /wᵢ = 1\/N/.test(SCORE_TIPS.ew_sharpe.formula),
    "band tips: equal weight's tip says nothing was fitted, at no level calls it in-sample, and its formula sets every weight to 1/N", T("ew_sharpe").join(" | "));
  check(/in-sample/.test(SCORE_TIPS.gmv_sharpe.plain) && /In-sample/.test(SCORE_TIPS.gmv_sharpe.finance) && /argmin w′Σw/.test(SCORE_TIPS.gmv_sharpe.formula) &&
    !/long-only|wᵢ ≥ 0|0 ≤ wᵢ/.test(T("gmv_sharpe").join(" ")),
    "band tips: GMV's tip says in-sample in words and in finance terms, its formula is the minimum-variance solve, and it promises no bounds the shorting switch can change",
    T("gmv_sharpe").join(" | "));
  check(T("bench_sharpe").every((t) => /benchmark|μ_b/.test(t)) && T("bench_sharpe").every((t) => !/in-sample/i.test(t)),
    "band tips: the benchmark's tip is about the benchmark's own returns at every level, and does not call it in-sample", T("bench_sharpe").join(" | "));
  check(own.every((k) => /× 252|× √252/.test(SCORE_TIPS[k].formula) && /r_f/.test(SCORE_TIPS[k].formula)) &&
    own.every((k) => T(k).every((t) => !/\b(best|optimal\w*|winners?|race|outperform\w*|beat\w*|won)\b/i.test(t))),
    "band tips: every formula annualises by 252 days at the page's rate, and no text has a word of contest", own.map((k) => SCORE_TIPS[k].formula).join(" | "));
  // On the page: each plate's mark carries its own key's text, at each level.
  const shown = LEVEL_IDS.map((level) => {
    const r = render(h(Band, { analysis: { status: "ready", value: a }, level, fetching: false, failure: null }));
    const got = [...r.container.querySelectorAll(".band-plates .plate")].map((p) => text(p.querySelector("[role=tooltip]") ?? {}));
    r.unmount();
    return got.every((t, i) => t === tipText(plates[i].tip, level, a.allowShort)) && got.length === 4;
  });
  check(shown.every(Boolean), "band tips: each plate shows its own tip's text at Plain, Finance and Formula", shown.join(","));
}

done("t-tooltips");
