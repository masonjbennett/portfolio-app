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

// The Sharpe ratio behind those figures, at basket sizes past the page's ten. Long-only tangency once
// walked every face of the simplex through `1 << n`, which returns nothing at 31 and 32 assets and a
// mix drawn from a few faces past that. At each size below the solve must return a valid long-only
// portfolio that is the maximum: the KKT conditions hold (the problem is convex once homogenised, so
// they prove it), and no single asset, equal weights or seeded random mix does better.
const { tangency, tangencyFaces, FACES_CAP } = await import("../src/lib/optimize.ts");
const { mean, covMatrix, dot, matVec } = await import("../src/lib/num.ts");
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Daily returns from three factors plus noise, the same numbers on every run.
function panel(n, seed, T = 750) {
  const rand = seeded(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const beta = Array.from({ length: n }, () => [0, 1, 2].map(() => 0.6 + 0.4 * gauss()));
  const drift = Array.from({ length: n }, () => (0.08 + 0.12 * gauss()) / 252);
  const vol = Array.from({ length: n }, () => (0.1 + 0.25 * rand()) / Math.sqrt(252));
  const cols = Array.from({ length: n }, () => new Array(T));
  for (let t = 0; t < T; t++) {
    const f = [0, 1, 2].map(() => 0.008 * gauss());
    for (let i = 0; i < n; i++) cols[i][t] = drift[i] + dot(beta[i], f) + vol[i] * gauss();
  }
  return { m: cols.map(mean), S: covMatrix(cols) };
}
const sharpeAt = (w, m, S, rf) => (252 * dot(w, m) - rf) / Math.sqrt(252 * dot(w, matVec(S, w)));
// What the tangency has to beat: every single asset, equal weights, and 400 seeded random mixes, half
// of them on a random subset of the assets.
function rivals(n, seed) {
  const rand = seeded(seed);
  const out = [new Array(n).fill(1 / n)];
  for (let i = 0; i < n; i++) out.push(new Array(n).fill(0).map((_, k) => (k === i ? 1 : 0)));
  for (let r = 0; r < 400; r++) {
    const raw = new Array(n).fill(0).map(() => (r % 2 && rand() < 0.7 ? 0 : -Math.log(1 - rand())));
    const tot = raw.reduce((a, b) => a + b, 0) || 1;
    out.push(raw.map((x) => x / tot));
  }
  return out.filter((w) => w.some((x) => x > 0));
}
const RF = 0.04;
for (const n of [12, 16, 31, 32, 50]) {
  const { m, S } = panel(n, 1000 + n);
  const t = tangency(m, S, RF, false);
  const at = `sharpe: tangency at ${n} assets`;
  check(!!t && t.w.length === n && t.w.every((x) => Number.isFinite(x) && x >= 0) && Math.abs(t.w.reduce((a, b) => a + b, 0) - 1) <= 1e-12,
    `${at} returns a long-only portfolio, weights summing to 1`, t ? `min ${Math.min(...t.w)}, sum ${t.w.reduce((a, b) => a + b, 0)}` : "null");
  if (!t) continue;
  check(t.beatsRf && t.w.filter((x) => x > 0).length >= 2, `${at} holds a mix that beats the risk-free rate`,
    `${t.w.filter((x) => x > 0).length} held`);
  // KKT for long-only maximum Sharpe: the gradient vanishes on the assets held and is <= 0 off them.
  const e = m.map((x) => x - RF / 252);
  const Sw = matVec(S, t.w);
  const v = dot(t.w, Sw);
  const ex = dot(e, t.w);
  const grad = e.map((x, i) => x / Math.sqrt(v) - (ex * Sw[i]) / v ** 1.5);
  const scale = Math.max(...grad.map(Math.abs), ...e.map((x) => Math.abs(x) / Math.sqrt(v)));
  check(t.w.every((w, i) => (w > 1e-12 ? Math.abs(grad[i]) <= 1e-9 * scale : grad[i] <= 1e-9 * scale)), `${at} satisfies KKT`);
  const best = Math.max(...rivals(n, 2000 + n).map((w) => sharpeAt(w, m, S, RF)));
  check(t.sharpe >= best - 1e-12, `${at} is no worse than any single asset, equal weights or 400 random mixes`, `${t.sharpe} vs ${best}`);
  if (n <= 16) {
    const f = tangencyFaces(m, S, RF);
    check(!!f && t.sharpe >= f.sharpe - 1e-12, `${at} is no worse than the face walk`, `${t.sharpe} vs ${f && f.sharpe}`);
  }
}
// When no asset beats the risk-free rate the best long-only mix is one asset alone, and above 12 assets
// the page gets it without the face walk. 32 is where `1 << n` is 1 again.
for (const n of [16, 32, 50]) {
  const { m, S } = panel(n, 1000 + n);
  const rf = 252 * Math.max(...m) + 0.05;
  const t = tangency(m, S, rf, false);
  const lone = m.map((_, i) => sharpeAt(m.map((__, k) => (k === i ? 1 : 0)), m, S, rf));
  const top = lone.indexOf(Math.max(...lone));
  check(!!t && !t.beatsRf && t.w[top] === 1 && t.w.filter((x) => x !== 0).length === 1,
    `sharpe: at ${n} assets with no asset beating rf, the tangency is the best single asset, flagged`, t ? `sharpe ${t.sharpe}` : "null");
  const best = Math.max(...rivals(n, 3000 + n).map((w) => sharpeAt(w, m, S, rf)));
  check(!!t && t.sharpe >= best - 1e-12, `sharpe: at ${n} assets with no asset beating rf, no mix does better`, `${t && t.sharpe} vs ${best}`);
  if (n === 16) {
    const f = tangencyFaces(m, S, rf);
    check(!!f && maxDiff(f.w, t.w) === 0, "sharpe: at 16 assets with no asset beating rf, the face walk agrees");
  }
}
function maxDiff(a, b) {
  return Math.max(...a.map((x, i) => Math.abs(x - b[i])));
}
// The face walk refuses a basket past its cap instead of running `1 << n` into the ground.
// 33: past 32, `1 << n` wraps round to 2, 4, ..., so an unguarded walk would answer, from asset 0 alone.
check(tangencyFaces(...Object.values(panel(FACES_CAP + 13, 33)), RF) === null, `sharpe: the face walk refuses ${FACES_CAP + 13} assets`);

done("t-sharpe");
