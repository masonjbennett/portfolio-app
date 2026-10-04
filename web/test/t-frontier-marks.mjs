// The constructions the Optimization tab's scorecard can add, drawn on its efficient frontier
// (src/charts/Frontier.tsx), from real analyses through the shipping solvers (src/lib/constructions.ts).
//
// (a) each added construction's point is its weights' annualized return and volatility over this window,
//     worked out here from the daily moments, not through the chart's own helper.
// (b) nothing added changes nothing: frontierData without the fourth argument deep-equals it with [],
//     carries no `added` key, and the chart drawn from either is the same markup, title and caption.
// (c) every added marker has its own outline: none shares a shape with another added one or with the
//     six markers already on the chart (asset, benchmark, GMV, Tangency, Equal-Weight, Custom), and each
//     is hollow where those are filled, so none is told apart by colour alone; drawn over the four
//     portfolio markers. Only token colours.
// (d) at the chart's width on a 1440px desktop and on a 375px phone, on the cross-asset example and the
//     mega-cap fixture, long-only and shorting, no name overlaps another name, any marker or the chart's
//     edge. Every added construction is named on the chart, or, where their names cannot all be set clear,
//     none is and one key line under the chart names each outline. Which frontiers take the key line is
//     pinned.
// (e) the tooltip names an added point; (f) an added point the chart cannot draw fails closed by name;
// (g) the axes reach every added point, however far it lies from the rest.
import { render, text, act, setMedia } from "./_dom.mjs";
import { check, near, done } from "./_assert.mjs";
import { exampleAnalysis, fixtureAnalysis } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const F = await import("../src/charts/Frontier.tsx");
const { ADDED_IDS, ownWindow, solveAdded } = await import("../src/lib/constructions.ts");
const { textWidth } = await import("../src/charts/labels.ts");
const { contrastRatio, TEXT_AA } = await import("../src/charts/contrast.ts");
const { tokens, PHONE_QUERY } = await import("../src/styles/tokens.ts");
const { format } = await import("../src/format.ts");
const REL = 1e-12;
const TOKEN_COLORS = new Set(Object.values(tokens.color));

// The scorecard's heads for the four columns, which the tab hands the chart as each point's name: read
// from the tab's own table, so a renamed head is measured here as the page draws it.
const { ADDED_LABEL: HEADS } = await import("../src/tabs/optimization/model.ts");
// Each construction solved on its own window, as the tab solves it; one with no answer is left out.
const addedFor = (a) =>
  ADDED_IDS.flatMap((id) => {
    const { m, S, T } = ownWindow(id, a.returns);
    const s = solveAdded(id, m, S, T, a.rf, a.allowShort);
    return s ? [{ id, label: HEADS[id], w: s.w }] : [];
  });

// The two baskets, long-only and shorting; the page's chart widths, measured in Chromium on the
// Optimization tab (the frontier's box at a 1440px window with its scrollbar, and at 375px).
const BASKETS = [
  ["cross-asset example", (o) => exampleAnalysis(o)],
  ["mega-cap fixture", (o) => fixtureAnalysis("megacap", o)],
];
const WIDTHS = [928, 343];
const cases = BASKETS.flatMap(([name, make]) => [false, true].map((allowShort) => {
  const a = make({ allowShort });
  return { tag: `${name} ${allowShort ? "short" : "long"}`, a, added: addedFor(a) };
}));
check(cases.every((c) => c.added.length === 4), "setup: all four constructions solve on both baskets, long-only and shorting",
  cases.map((c) => `${c.tag}: ${c.added.map((x) => x.id).join(",")}`).join("; "));

const ready = (value) => ({ status: "ready", value });
const realRect = window.HTMLElement.prototype.getBoundingClientRect;
// The chart drawn at a given box width: the phone query answers true below 600px, as on a phone.
function drawAt(width, a, data) {
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const r = realRect.call(this);
    return this.classList?.contains("frontier-chart") ? { x: 0, y: 0, top: 0, left: 0, width, height: 0, right: width, bottom: 0 } : r;
  };
  setMedia((q) => q === PHONE_QUERY && width < 600);
  try {
    return render(h(F.default, { title: "Frontier", state: ready(data), allowShort: a.allowShort, rf: a.rf }));
  } finally {
    window.HTMLElement.prototype.getBoundingClientRect = realRect;
    setMedia(() => false);
  }
}

// ---- (a) the points ----------------------------------------------------------------------------------
for (const { tag, a, added } of cases) {
  const d = F.frontierData(a, a.ew, a.frontier, added);
  check(d.added?.length === added.length && d.added.every((x, k) => x.id === added[k].id && x.label === added[k].label),
    `points: ${tag}: one point per added construction, in the order given, named by its head`);
  for (const [k, x] of added.entries()) {
    // mean x 252 and sqrt(w'Sw x 252), the annualizing every other mark uses.
    const daily = x.w.reduce((s, wi, i) => s + wi * a.m[i], 0);
    let v = 0;
    for (let i = 0; i < x.w.length; i++) for (let j = 0; j < x.w.length; j++) v += x.w[i] * a.S[i][j] * x.w[j];
    near(`points: ${tag}: ${x.id} return is its weights' mean daily return x 252 over this window`, d.added[k].mu, daily * 252, REL);
    near(`points: ${tag}: ${x.id} volatility is its weights' daily standard deviation x sqrt(252) over this window`, d.added[k].sigma, Math.sqrt(v * 252), REL);
  }
}

// ---- (b) nothing added changes nothing -------------------------------------------------------------
{
  const { a } = cases[0];
  const plain = F.frontierData(a, a.ew);
  const empty = F.frontierData(a, a.ew, a.frontier, []);
  check(JSON.stringify(plain) === JSON.stringify(empty) && !("added" in plain) && !("added" in empty),
    "unchanged: frontierData without the fourth argument equals it with [], and neither carries an added key");
  check(JSON.stringify(F.frontierData(a)) === JSON.stringify(F.frontierData(a, null, a.frontier, [])),
    "unchanged: the same with no custom weights");
  // Recharts numbers each chart's clip path, and React each scatter's id, as they mount; those counters
  // are all two drawings may differ in.
  const markup = (r) => r.container.innerHTML.replace(/recharts\d+-/g, "recharts#-").replace(/:r[0-9a-z]+:/g, ":r#:");
  for (const width of WIDTHS) {
    const r1 = drawAt(width, a, plain);
    const r2 = drawAt(width, a, empty);
    check(markup(r1) === markup(r2) && !r1.container.querySelector(".frontier-added"),
      `unchanged: at ${width}px the chart drawn with [] is the same markup as without, and draws no added marker`);
    r1.unmount();
    r2.unmount();
  }
  // The title sentence and the caption are the chart's own, with or without additions.
  const r1 = drawAt(928, a, plain);
  const r2 = drawAt(928, a, F.frontierData(a, a.ew, a.frontier, cases[0].added));
  const head = (r) => text(r.container.querySelector("figcaption"));
  check(head(r1) === head(r2) && head(r1).length > 0, "unchanged: the title sentence and caption read the same with all four added", head(r2));
  r1.unmount();
  r2.unmount();
}

// ---- (c) the outlines ---------------------------------------------------------------------------------
// A drawn marker's corners about its centre, read off the path: M/L and h/v as written, a circle's arcs
// sampled every 10 degrees.
function corners(d) {
  const out = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLHVAZmlhvaz])([^MLHVAZmlhvaz]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    if (cmd === "M" || cmd === "L") for (let k = 0; k + 1 < n.length; k += 2) out.push({ x: (x = n[k]), y: (y = n[k + 1]) });
    else if (cmd === "h") out.push({ x: (x += n[0]), y });
    else if (cmd === "v") out.push({ x, y: (y += n[0]) });
    else if (cmd === "H") out.push({ x: (x = n[0]), y });
    else if (cmd === "V") out.push({ x, y: (y = n[0]) });
    else if (cmd === "A") {
      if (!out.some((q) => q.round)) for (let t = 0; t < 360; t += 10) out.push({ x: n[0] * Math.cos((t * Math.PI) / 180), y: n[0] * Math.sin((t * Math.PI) / 180), round: true });
      x = n[5];
      y = n[6];
    } else if (cmd !== "Z" && cmd !== "z") throw new Error(`corners: no rule for ${cmd}`);
  }
  // A repeated corner (a closing L back to the start) is one corner.
  return out.filter((q, k) => out.findIndex((p) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6) === k);
}
// An outline's silhouette: how far it reaches from its centre in each direction, every 3 degrees, as a
// share of its farthest reach (a circle is 1 all round). Read from the corners for a polygon, along each
// ray to the edge it crosses.
function silhouette(ps) {
  const round = ps.some((q) => q.round);
  const out = [];
  for (let t = 0; t < 360; t += 3) {
    const ux = Math.cos((t * Math.PI) / 180);
    const uy = Math.sin((t * Math.PI) / 180);
    let r = round ? 1 : 0;
    if (!round) {
      for (let k = 0; k < ps.length; k++) {
        const p = ps[k];
        const q = ps[(k + 1) % ps.length];
        // Solve s u = p + v (q - p) for s >= 0, v in [0, 1].
        const ex = q.x - p.x;
        const ey = q.y - p.y;
        const det = ux * -ey - uy * -ex;
        if (Math.abs(det) < 1e-12) continue;
        const sDist = (p.x * -ey - p.y * -ex) / det;
        const v = (ux * p.y - uy * p.x) / det;
        if (sDist >= 0 && v >= -1e-9 && v <= 1 + 1e-9) r = Math.max(r, sDist);
      }
    }
    out.push(r);
  }
  const top = Math.max(...out);
  return out.map((r) => r / top);
}
// Two outlines' difference: the most their silhouettes differ in any one direction. A shape and itself at
// any size are 0 apart; a plus and an X, a triangle up and one down, a square and a diamond are far apart.
const apart = (p, q) => {
  const [a, b] = [silhouette(p), silhouette(q)];
  return Math.max(...a.map((x, k) => Math.abs(x - b[k])));
};
const SHAPE_APART = 0.3;
{
  const { tag, a, added } = cases[0];
  const r = drawAt(928, a, F.frontierData(a, a.ew, a.frontier, added));
  const root = r.container;
  const drawn = [
    ...[["asset", ".frontier-asset"], ["benchmark", ".frontier-bench"], ...["gmv", "tangency", "ew", "custom"].map((k) => [k, `.frontier-mark--${k}`])]
      .map(([name, sel]) => {
        const p = root.querySelector(`${sel} .recharts-symbols`);
        return { name, added: false, d: p?.getAttribute("d") ?? "", fill: p?.getAttribute("fill"), opacity: p?.getAttribute("fill-opacity"), stroke: p?.getAttribute("stroke") };
      }),
    ...added.map((x) => {
      const p = root.querySelector(`.frontier-added--${x.id.replace(".", "-")} .frontier-glyph`);
      return { name: x.id, added: true, d: p?.getAttribute("d") ?? "", fill: p?.getAttribute("fill"), opacity: p?.getAttribute("fill-opacity"), stroke: p?.getAttribute("stroke") };
    }),
  ];
  check(drawn.every((m) => m.d.length > 0), `outlines: ${tag}: all ten marker kinds drawn`, drawn.filter((m) => !m.d).map((m) => m.name).join());
  const close = [];
  let least = Infinity;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      if (!drawn[i].added && !drawn[j].added) continue;
      const gap = apart(corners(drawn[i].d), corners(drawn[j].d));
      least = Math.min(least, gap);
      if (!(gap >= SHAPE_APART)) close.push(`${drawn[i].name}/${drawn[j].name} ${gap.toFixed(3)}`);
    }
  }
  check(close.length === 0, `outlines: each added outline differs in shape from every other marker on the chart (closest pair ${least.toFixed(3)} apart, at least ${SHAPE_APART})`, close.join("; "));
  const mine = drawn.filter((m) => m.added);
  const theirs = drawn.filter((m) => !m.added);
  // Hollow: an ink outline with nothing painted inside (a fill at no opacity takes the pointer only).
  check(mine.every((m) => m.stroke === tokens.color.ink && Number(m.opacity) === 0) && theirs.every((m) => m.fill !== tokens.color.paper && Number(m.opacity ?? 1) > 0),
    "outlines: every added marker is a hollow ink outline, where every other marker is filled",
    drawn.map((m) => `${m.name} ${m.fill}@${m.opacity ?? 1}/${m.stroke}`).join("; "));
  // Drawn after the four portfolio markers, so one that lands on a portfolio is not hidden under it.
  const order = [...root.querySelectorAll(".frontier-mark, .frontier-added")].map((g) => (g.classList.contains("frontier-added") ? "added" : "mark"));
  check(order.length === 8 && order.lastIndexOf("mark") < order.indexOf("added"), "outlines: the added markers are drawn over the four portfolio markers", order.join(","));
  check(new Set(Object.values(F.ADDED_GLYPH)).size === ADDED_IDS.length && ADDED_IDS.every((id) => F.ADDED_GLYPH[id]),
    "outlines: every construction has an outline, and no two share one");
  const strangers = [];
  for (const el of root.querySelectorAll("*")) {
    for (const k of ["fill", "stroke"]) {
      const v = el.getAttribute(k);
      if (v && v !== "none" && !TOKEN_COLORS.has(v)) strangers.push(`${el.tagName}.${k}=${v}`);
    }
  }
  check(strangers.length === 0, "outlines: every fill and stroke on the chart with all four added is a paper or ink token", strangers.join("; "));
  // The placement's model of each outline is what was drawn, to a tenth of a pixel.
  const off = [];
  for (const x of added) {
    const p = root.querySelector(`.frontier-added--${x.id.replace(".", "-")} .frontier-glyph`);
    const cs = corners(p.getAttribute("d"));
    const half = Number(p.getAttribute("stroke-width")) / 2;
    const e = F.glyphExtent(F.ADDED_GLYPH[x.id]);
    const w = Math.max(...cs.map((q) => q.x)) - Math.min(...cs.map((q) => q.x)) + 2 * half;
    const hgt = Math.max(...cs.map((q) => q.y)) - Math.min(...cs.map((q) => q.y)) + 2 * half;
    if (Math.abs(w - (e.left + e.right)) > 0.1 || Math.abs(hgt - (e.up + e.down)) > 0.1 || p.getAttribute("stroke-linejoin") !== "round")
      off.push(`${x.id} drawn ${w.toFixed(2)}x${hgt.toFixed(2)}, modelled ${(e.left + e.right).toFixed(2)}x${(e.up + e.down).toFixed(2)}`);
  }
  check(off.length === 0, "outlines: glyphExtent matches the drawn size of every added outline, round-joined", off.join("; "));
  r.unmount();
}

// ---- (d) every name placed, clear of every other name and marker, at a desk's width and a phone's ------
// Each marker's box is read off the path drawn (its corners and its translate, plus half its outline);
// each name's box off the text drawn, at the face's measured advances (textWidth) and 12px tall.
// At 343px the four heads (the longest about 150px) do not all fit beside their points among the five or
// seven assets on three of these frontiers: there the key line names them. Desktop width always names
// them on the chart.
const KEYED = ["cross-asset example long @343", "cross-asset example short @343", "mega-cap fixture long @343"];
{
  const markersIn = (root) =>
    [...root.querySelectorAll(".frontier-asset .recharts-symbols, .frontier-bench .recharts-symbols, .frontier-mark .recharts-symbols, .frontier-added .frontier-glyph")].map((p) => {
      const [, cx, cy] = /translate\(\s*([-\d.e]+)[ ,]\s*([-\d.e]+)\s*\)/.exec(p.getAttribute("transform") ?? "") ?? [];
      const cs = corners(p.getAttribute("d") ?? "");
      const half = Number(p.getAttribute("stroke-width") ?? 0) / 2;
      const name = p.parentElement?.closest(".frontier-asset, .frontier-bench, .frontier-mark, .frontier-added")?.getAttribute("class")?.match(/frontier-(asset|bench|mark--\w+|added--[\w-]+)/)?.[1];
      return {
        name,
        lo: +cx + Math.min(...cs.map((q) => q.x)) - half, hi: +cx + Math.max(...cs.map((q) => q.x)) + half,
        top: +cy + Math.min(...cs.map((q) => q.y)) - half, bot: +cy + Math.max(...cs.map((q) => q.y)) + half,
      };
    });
  const namesIn = (root) => [...root.querySelectorAll(".direct-label text")].map((t) => {
    const x = +t.getAttribute("x");
    const y = +t.getAttribute("y");
    const w = textWidth(t.textContent);
    const end = t.getAttribute("text-anchor") === "end";
    return { text: t.textContent, fill: t.getAttribute("fill"), lo: end ? x - w : x, hi: end ? x : x + w, top: y - 6, bot: y + 6 };
  });
  const meets = (p, q) => p.lo < q.hi && q.lo < p.hi && p.top < q.bot && q.top < p.bot;
  const bad = [];
  const keyedAt = [];
  const keyBad = [];
  let drawnCases = 0;
  for (const { tag, a, added } of cases) {
    for (const width of WIDTHS) {
      const r = drawAt(width, a, F.frontierData(a, a.ew, a.frontier, added));
      const root = r.container;
      const at = `${tag} @${width}`;
      const svg = root.querySelector("svg.recharts-surface");
      if (svg?.getAttribute("width") !== String(width)) bad.push(`${at}: drawn ${svg?.getAttribute("width")} wide`);
      const ms = markersIn(root);
      const ns = namesIn(root);
      if (ms.filter((m) => m.name?.startsWith("added--")).length !== added.length) bad.push(`${at}: ${ms.filter((m) => m.name?.startsWith("added--")).length} added markers drawn`);
      const key = root.querySelector(".frontier-key");
      const onChart = added.filter((x) => ns.some((n) => n.text === x.label));
      if (key) {
        keyedAt.push(at);
        // The key: every added construction, in order, each with the outline drawn on the chart.
        const items = [...key.querySelectorAll(".frontier-key-item")].map((el) => ({
          text: text(el), d: el.querySelector("path")?.getAttribute("d"), fill: el.querySelector("path")?.getAttribute("fill"),
          stroke: el.querySelector("path")?.getAttribute("stroke"), hidden: el.querySelector("svg")?.getAttribute("aria-hidden"),
          nowrap: el.style.whiteSpace === "nowrap",
        }));
        const sameAsChart = (x, k) => items[k]?.d === root.querySelector(`.frontier-added--${x.id.replace(".", "-")} .frontier-glyph`)?.getAttribute("d");
        if (onChart.length) keyBad.push(`${at}: the key line is drawn and ${onChart.map((x) => `"${x.label}"`).join(", ")} named on the chart as well`);
        if (items.length !== added.length || !added.every((x, k) => items[k].text === x.label && sameAsChart(x, k)))
          keyBad.push(`${at}: the key reads ${items.map((i) => `"${i.text}"`).join(", ")}`);
        if (!items.every((i) => i.fill === "none" && i.stroke === tokens.color.ink && i.hidden === "true" && i.nowrap))
          keyBad.push(`${at}: a key entry's outline is not the chart's hollow ink outline, is read aloud, or can break apart`);
        // Each entry wraps whole: an outline (20px and 4px of air) and its name fit the chart's width.
        for (const x of added) if (20 + 4 + textWidth(x.label) > width) keyBad.push(`${at}: the "${x.label}" entry is wider than the chart`);
      } else {
        for (const x of added) if (!onChart.includes(x)) bad.push(`${at}: "${x.label}" is not named, and there is no key line`);
      }
      for (const n of ns) {
        for (const m of ms) if (meets(n, m)) bad.push(`${at}: "${n.text}" on the ${m.name} marker`);
        if (n.lo < 0 || n.hi > width) bad.push(`${at}: "${n.text}" runs off the chart`);
        if (contrastRatio(n.fill, tokens.color.paper) < TEXT_AA) bad.push(`${at}: "${n.text}" is set in ${n.fill}, under AA on paper`);
      }
      ns.forEach((p, i) => ns.slice(i + 1).forEach((q) => {
        if (meets(p, q)) bad.push(`${at}: names "${p.text}" and "${q.text}" overlap`);
      }));
      drawnCases += 1;
      r.unmount();
    }
  }
  check(drawnCases === 8 && bad.length === 0,
    `placement: on ${drawnCases} frontiers (two baskets, long and short, at 928 and 343px) every added construction is named on the chart or in the key line, and no name overlaps another, any marker or the chart's edge`,
    bad.join("; "));
  check(keyedAt.join("; ") === KEYED.join("; "), `placement: the key line is drawn exactly where pinned (${KEYED.join("; ")})`, keyedAt.join("; ") || "nowhere");
  check(keyedAt.length > 0 && keyBad.length === 0,
    "placement: where drawn, the key line names every added construction in order beside the outline drawn on the chart, and none is named twice", keyBad.join("; "));
}

// ---- (e) the tooltip -------------------------------------------------------------------------------------
{
  const { a, added } = cases[0];
  const d = F.frontierData(a, a.ew, a.frontier, added);
  const r = drawAt(928, a, d);
  const tip = () => text(r.container.querySelector(".recharts-tooltip-wrapper"));
  const wrong = [];
  for (const [k, x] of added.entries()) {
    const el = r.container.querySelector(`.frontier-added--${x.id.replace(".", "-")} .recharts-scatter-symbol`);
    act(() => el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    const want = `${x.label}Volatility ${format(d.added[k].sigma, "pct2")}Return ${format(d.added[k].mu, "pct2")}`;
    if (tip() !== want) wrong.push(`${x.id}: "${tip()}"`);
  }
  check(wrong.length === 0, "tooltip: hovering an added point names it by its head, with its volatility and return", wrong.join("; "));
  r.unmount();
}

// ---- (f) fails closed --------------------------------------------------------------------------------------
{
  const { a, added } = cases[0];
  const quiet = (fn) => {
    const { error, warn } = console;
    console.error = console.warn = () => {};
    try {
      return fn();
    } finally {
      Object.assign(console, { error, warn });
    }
  };
  const base = F.frontierData(a, a.ew, a.frontier, added);
  const unknown = { ...base, added: [...base.added, { id: "tan.2y", label: "Somewhere else", mu: 0.05, sigma: 0.1 }] };
  const r1 = quiet(() => drawAt(928, a, unknown));
  check(!r1.container.querySelector("svg") && text(r1.container).includes("Somewhere else"),
    "fails closed: an added point with no marker of its own draws no chart and names the point", text(r1.container));
  r1.unmount();
  const nan = { ...base, added: base.added.map((x, k) => (k === 1 ? { ...x, mu: NaN } : x)) };
  const r2 = quiet(() => drawAt(928, a, nan));
  check(!r2.container.querySelector("svg") && text(r2.container).includes(added[1].label) && !/NaN/.test(r2.container.innerHTML),
    "fails closed: an added point whose return is not a number draws no chart and names the point", text(r2.container));
  r2.unmount();
}

// ---- (g) the axes reach every added point ----------------------------------------------------------------
{
  const { a } = cases[0];
  // Ten times the first asset, short nine times the second: far above and right of everything else drawn,
  // the capital allocation line's far end included.
  const w = a.tickers.map((_, i) => (i === 0 ? 10 : i === 1 ? -9 : 0));
  const d = F.frontierData(a, a.ew, a.frontier, [{ id: "tan.1y", label: HEADS["tan.1y"], w }]);
  const far = d.added[0];
  const sigMax = Math.max(...d.assets.map((x) => x.sigma), ...d.marks.map((m) => m.sigma), d.bench.sigma);
  const muMax = Math.max(...d.assets.map((x) => x.mu), ...d.marks.map((m) => m.mu), d.bench.mu);
  const r = drawAt(928, a, d);
  const clip = r.container.querySelector("clipPath rect");
  const box = { x: +clip.getAttribute("x"), y: +clip.getAttribute("y"), w: +clip.getAttribute("width"), h: +clip.getAttribute("height") };
  const [, cx, cy] = /translate\(\s*([-\d.e]+)[ ,]\s*([-\d.e]+)\s*\)/.exec(r.container.querySelector(".frontier-added .frontier-glyph")?.getAttribute("transform") ?? "") ?? [];
  // Recharts widens a domain to hold its data, so the point is inside the plot either way; what the chart
  // must do is carry its ticks out to it, or the point sits past the last labelled value on both axes.
  const ticks = (axis, k) => [...r.container.querySelectorAll(`.recharts-${axis}-tick-labels .recharts-cartesian-axis-tick-value`)].map((t) => +t.getAttribute(k));
  const right = Math.max(...ticks("xAxis", "x"));
  const top = Math.min(...ticks("yAxis", "y"));
  check(far.sigma > 2 * sigMax && far.mu > 2 * muMax && +cx >= box.x && +cx <= box.x + box.w && +cy >= box.y && +cy <= box.y + box.h && right >= +cx && top <= +cy,
    "axes: a point beyond every other mark on both axes is drawn inside the plot, with ticks out past it on both axes",
    `point ${cx},${cy}; last x tick at ${right}, top y tick at ${top}; plot ${JSON.stringify(box)}`);
  r.unmount();
}

done("t-frontier-marks");
