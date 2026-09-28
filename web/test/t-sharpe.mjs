// Every Sharpe ratio the page prints has three decimal places, the app's own `:.3f` (portfolio_app.py
// formats Sharpe that way in every table and metric). Until Sep 28 2026 the sentences printed two and the
// plates three, so one page said 0.92 in the Optimization headline and 0.570 in the Custom headline and
// the band's plate for the same kind of number.
//
// Drives the shipping page: the band and all six tabs (Sensitivity with its custom mix switched on), each inside the real App (tabs loaded up front),
// on four analyses that between them reach every sentence that names a Sharpe ratio: the example, the
// same prices with shorting, a risk-free rate no asset beats (the "least negative" sentences), and one
// no tangency solve can answer (the failure sentences). What it reads:
//   - prose: every heading, paragraph, caption and list item that names a Sharpe ratio, and every bare
//     decimal in it (a percentage, a date or a count is not one);
//   - plates: every plate whose label names Sharpe;
//   - tables: every column whose header names Sharpe.
// Axis tick labels are gridline marks, not a portfolio's figure, and are not read.
import { readdirSync, readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { act, render, text } from "./_dom.mjs";

const { createElement: h, useState } = await import("react");
const { AppView, TAB_LOADERS } = await import("../src/App.tsx");
const { TAB_IDS, TAB_LABELS } = await import("../src/types.ts");
const { exampleAnalysis, examplePayload, fixtureAnalysis, fixturePayload, settingsFor } = await import("./_analysis.mjs");
const TABS = Object.fromEntries(await Promise.all(TAB_IDS.map(async (id) => [id, (await TAB_LOADERS[id]()).default])));

const quietly = (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};

function Harness({ analysis, settings }) {
  const [tab, setTab] = useState("returns");
  const [weights, setWeights] = useState({});
  const wb = {
    settings,
    setSettings() {},
    level: "finance",
    setLevel() {},
    analysis: { status: "ready", value: analysis },
    fetching: false,
    failure: null,
    rf: { status: "ready", value: { rate: analysis.rf, date: analysis.asOf, source: "test" } },
    weights,
    setWeights,
    tab,
    setTab,
  };
  return h(AppView, { wb, tabs: TABS });
}

// A bare decimal: not part of a longer number, not a percentage, not a date. Minus is U+2212 or a hyphen.
const DECIMAL = /(?<![\d.,:/-])[−-]?\d+\.(\d+)(?!\d|\.\d|\s*%)/g;
const SHARPE = /sharpe/i;
// What an element says on the page, without the text of the tips (the (i) marks) inside it.
function visible(el) {
  const copy = el.cloneNode(true);
  for (const tip of copy.querySelectorAll(".tip")) tip.remove();
  return text(copy);
}
const THREE = /^[−-]?\d+\.\d{3}$/;
const NA = new Set(["—", "–", "-", "n/a", "not available", ""]);

const EX = exampleAnalysis();
const cases = [
  ["the example", EX, settingsFor(examplePayload(), { rf: EX.rf })],
  ["shorting", fixtureAnalysis("cross", { allowShort: true }), null],
  ["a 30% risk-free rate", fixtureAnalysis("cross", { rf: 0.3 }), null],
  ["a failed tangency", fixtureAnalysis("cross", { allowShort: true, rf: 5 }), null],
];

const seen = { prose: 0, plates: 0, cells: 0 };
const wrong = [];
const branches = new Set();
for (const [name, a, given] of cases) {
  const settings = given ?? settingsFor(fixturePayload("cross"), { rf: a.rf, allowShort: a.allowShort });
  const r = quietly(() => render(h(Harness, { analysis: a, settings })));
  const row = r.container.querySelector(".app-tabs [role=tablist]");
  for (const id of TAB_IDS) {
    const pill = [...row.querySelectorAll("button")].find((b) => text(b) === TAB_LABELS[id]);
    quietly(() => act(() => pill.click()));
    // Sensitivity scores the custom mix only when asked, as the app does (its checkbox).
    const include = [...r.container.querySelectorAll("label")].find((l) => /Include Custom Portfolio/i.test(text(l)))?.querySelector("input");
    if (include && !include.checked) quietly(() => act(() => include.click()));
    const where = `${name}, ${TAB_LABELS[id]}`;
    // Prose. Nested blocks are read once, at the innermost element that holds the words.
    for (const el of r.container.querySelectorAll("h1, h2, h3, h4, p, figcaption, li")) {
      if (el.closest("table, .plate, [role=tooltip], [role=dialog]")) continue;
      if (el.querySelector("h1, h2, h3, h4, p, li")) continue;
      const t = visible(el);
      if (!SHARPE.test(t)) continue;
      for (const m of t.matchAll(DECIMAL)) {
        seen.prose += 1;
        branches.add(t.slice(0, 40));
        if (m[1].length !== 3) wrong.push(`${where}: "${m[0]}" in "${t.slice(0, 110)}"`);
      }
    }
    // Plates.
    for (const plate of r.container.querySelectorAll(".plate")) {
      const label = visible(plate.querySelector(".plate-label") ?? document.createElement("i"));
      if (!SHARPE.test(label)) continue;
      const v = text(plate.querySelector(".plate-value") ?? plate.querySelector(".plate-na") ?? {});
      if (NA.has(v)) continue;
      seen.plates += 1;
      if (!THREE.test(v)) wrong.push(`${where}: plate "${label}" shows ${v}`);
    }
    // Table columns.
    for (const table of r.container.querySelectorAll("table")) {
      const heads = [...table.querySelectorAll("thead th")].map(visible);
      heads.forEach((head, k) => {
        if (!SHARPE.test(head)) return;
        for (const tr of table.querySelectorAll("tbody tr")) {
          const v = text(tr.children[k] ?? {});
          if (NA.has(v)) continue;
          seen.cells += 1;
          if (!THREE.test(v)) wrong.push(`${where}: column "${head}" shows ${v}`);
        }
      });
    }
  }
  r.unmount();
}

check(seen.prose >= 8 && seen.plates >= 4 && seen.cells >= 10,
  "sharpe: the suite reads Sharpe ratios in sentences, plates and tables across the six tabs and the band",
  JSON.stringify(seen));
check(wrong.length === 0, "sharpe: every Sharpe ratio the page prints has three decimal places, the app's :.3f",
  wrong.slice(0, 6).join(" | ") + (wrong.length > 6 ? ` | and ${wrong.length - 6} more` : ""));
// The branches no fixture reaches ("Both optimisations failed ... at a Sharpe ratio of"), held in the
// source: no line under src/ that names a Sharpe ratio formats a number to two places.
const SRC = new URL("../src/", import.meta.url);
const files = readdirSync(SRC, { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f) && !/^lib[\\/]/.test(f));
const twoPlaces = /"num2"|\bnum2\(|\bn2\(/;
const offenders = files.flatMap((f) =>
  readFileSync(new URL(f.replace(/\\/g, "/"), SRC), "utf8").split("\n").flatMap((line, i) => (SHARPE.test(line) && twoPlaces.test(line) ? [`src/${f.replace(/\\/g, "/")}:${i + 1}`] : [])),
);
check(files.length > 20 && offenders.length === 0, "sharpe: no line in src/ that names a Sharpe ratio formats to two places", offenders.join(", "));
console.log(`  read ${seen.prose} in sentences (${branches.size} distinct), ${seen.plates} on plates, ${seen.cells} in table cells`);

done("t-sharpe");
