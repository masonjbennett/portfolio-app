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
check(mismatches.length === 0, "tooltips: tipText is the app's text at every key and level with shorting off, bar the reviewed word overrides and closing lines", mismatches.join(" "));
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
      `ledger:short-bounds-copy: ${at} was reviewed against the app's current text, which says long-only`, TIPS[key][level]);
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
      check(o.was === TIPS[key][level], `ledger:plain-tip-words ${at} was reviewed against the app's current text`, TIPS[key][level]);
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

done("t-tooltips");
