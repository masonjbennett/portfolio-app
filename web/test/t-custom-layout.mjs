// The Custom tab's arrangement (src/tabs/Custom.tsx, src/tabs/custom/Custom.css, src/tabs/custom/layout.ts):
// on a desktop wide enough for both, the weights on the left and the frontier on the right; stacked below
// that width, a phone included, exactly in the order the sections have always stood.
//
// (a) The stylesheet, read as text (jsdom lays nothing out): the side-by-side rule sits under one
//     min-width media query whose number is SIDE_BY_SIDE_MIN_PX, the weights in the left area, the
//     frontier in the right, the figures beneath both; outside that query nothing places, orders or
//     displays the pair, so every narrower width stacks in markup order; the desktop and phone rules
//     for the editor and the tiles are the ones they were.
// (b) The markup: weights, figures, frontier inside the pair, in that order, between the builder's
//     heading and the wealth chart; every slider and field comes before the frontier; no tabindex.
// (c) The frontier's height: the side-by-side height only while the query matches, the chart's own
//     default otherwise.
// (d) A native range moved: the frontier's Custom point lands at the risk and return customWeights()
//     gives for the new mix, read on the chart's own axes through the GMV and Tangency points.
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { act, render, setMedia, text } from "./_dom.mjs";

const { createElement: h, useState } = await import("react");
const Custom = (await import("../src/tabs/Custom.tsx")).default;
const M = await import("../src/tabs/custom/model.ts");
const L = await import("../src/tabs/custom/layout.ts");
const { frontierData } = await import("../src/charts/Frontier.tsx");
const { PHONE_QUERY } = await import("../src/styles/tokens.ts");
const { fixtureAnalysis, tabProps } = await import("./_analysis.mjs");

// ---- (a) the stylesheet ----------------------------------------------------------------------------------
const CSS = readFileSync(new URL("../src/tabs/custom/Custom.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// The at-rules in the sheet: each header with its body, braces matched, and where it sits.
function atRules(src) {
  const out = [];
  for (const m of src.matchAll(/@media\s*([^{]+)\{/g)) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) {
        out.push({ cond: m[1].trim(), body: src.slice(m.index + m[0].length, i), from: m.index, to: i + 1 });
        break;
      }
    }
  }
  return out;
}
// Plain rules: selector (whitespace collapsed) and its declarations, property to value.
function rules(src) {
  return [...src.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: m[1].trim().replace(/\s+/g, " "),
    decl: Object.fromEntries(
      m[2]
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim().replace(/\s+/g, " ")]),
    ),
  }));
}
const pick = (rs, sel) => rs.find((r) => r.sel === sel)?.decl ?? {};

const media = atRules(CSS);
const wide = media.filter((m) => /min-width/.test(m.cond));
const phone = media.find((m) => m.cond === `(max-width: ${"760px"})`);
const outside = media.reduceRight((s, m) => s.slice(0, m.from) + s.slice(m.to), CSS);
const top = rules(outside);

check(wide.length === 1 && wide[0].cond === L.SIDE_BY_SIDE_QUERY && L.SIDE_BY_SIDE_QUERY === `(min-width: ${L.SIDE_BY_SIDE_MIN_PX}px)` && L.SIDE_BY_SIDE_MIN_PX > 760,
  "layout: one min-width query holds the side-by-side rule, at SIDE_BY_SIDE_MIN_PX, wider than a phone", media.map((m) => m.cond).join(" | "));
{
  const rs = rules(wide[0]?.body ?? "");
  const pair = pick(rs, ".cust-pair");
  const tracks = (pair["grid-template-columns"] ?? "").match(/minmax\([^)]*\)|[\d.]+fr/g) ?? [];
  check(pair.display === "grid" && pair["grid-template-areas"] === `"weights frontier" "figures figures"` && tracks.length === 2 &&
    pick(rs, ".cust-pair > .cust-section--weights")["grid-area"] === "weights" &&
    pick(rs, ".cust-pair > .cust-section--frontier")["grid-area"] === "frontier" &&
    pick(rs, ".cust-pair > .cust-section--figures")["grid-area"] === "figures",
    "layout: side by side, the weights on the left, the frontier on the right, the figures beneath both", JSON.stringify(rs));
  check(pick(rs, ".cust-pair .cust-editor")["grid-template-columns"] === "minmax(0, 1fr)",
    "layout: beside the frontier the slider rows run in one column");
}
{
  // Below the breakpoint: no rule outside the min-width query names the pair or its sections, and none
  // anywhere in the sheet reorders, so the sections stand in their markup order.
  const placing = /^(order|grid-area|grid-row|grid-column|grid-template-areas)$|^flex-direction$/;
  const outsideRules = [...top, ...media.filter((m) => !wide.includes(m)).flatMap((m) => rules(m.body))];
  const strays = outsideRules.filter((r) => /cust-pair|cust-section--/.test(r.sel) || Object.keys(r.decl).some((k) => placing.test(k)));
  const reorders = /(^|[\s;{])order\s*:|-reverse|direction\s*:/.test(CSS);
  check(strays.length === 0 && !reorders && !pick(top, ".cust").display && !pick(top, ".cust-section").display,
    "layout: below the breakpoint the pair is an ordinary block and nothing reorders the sections", JSON.stringify(strays));
  check(pick(top, ".cust-editor")["grid-template-columns"] === "repeat(2, minmax(0, 1fr))" && pick(top, ".cust-plates")["grid-template-columns"] === "repeat(5, minmax(0, 1fr))",
    "layout: stacked on a desktop, two columns of slider rows and five tiles, as before");
  const pr = rules(phone?.body ?? "");
  check(pr.map((r) => r.sel).join() === ".cust-headline,.cust-editor,.cust-plates,.cust-field" &&
    pick(pr, ".cust-editor")["grid-template-columns"] === "minmax(0, 1fr)" && pick(pr, ".cust-plates")["grid-template-columns"] === "repeat(2, minmax(0, 1fr))",
    "layout: the phone rules are the ones they were", pr.map((r) => r.sel).join());
}

// ---- (b)-(d) the tab rendered -------------------------------------------------------------------------------
let latest = null;
function Harness({ a }) {
  const [w, setW] = useState({});
  latest = w;
  return h(Custom, tabProps(a, { weights: w, setWeights: setW }));
}
const quiet = (fn) => {
  const warn = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = warn;
  }
};
const sectionName = (s) => s.getAttribute("aria-labelledby") ?? s.getAttribute("aria-label");
const setValue = (el, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
// A drawn mark's centre, from the translate recharts gives its symbol.
function centre(root, role) {
  const p = root.querySelector(`.frontier-mark--${role} .recharts-symbols`);
  const m = /translate\(\s*([-\d.e]+)[ ,]\s*([-\d.e]+)\s*\)/.exec(p?.getAttribute("transform") ?? "");
  return m ? { x: +m[1], y: +m[2] } : null;
}

{
  setMedia(() => false);
  const a = fixtureAnalysis("cross");
  const r = quiet(() => render(h(Harness, { a })));
  const root = r.container;
  const cust = root.querySelector(".cust");
  const pair = root.querySelector(".cust-pair");
  const order = [...root.querySelectorAll(".cust-section")].map(sectionName);
  check(order.join() === "cust-weights,Custom portfolio figures,cust-frontier,cust-wealth,cust-scorecard,cust-table" &&
    [...(pair?.children ?? [])].map(sectionName).join() === "cust-weights,Custom portfolio figures,cust-frontier" &&
    pair?.parentElement === cust && text(pair?.previousElementSibling ?? cust) === "Custom Portfolio Builder" &&
    pair?.nextElementSibling?.getAttribute("aria-labelledby") === "cust-wealth",
    "order: weights, figures, frontier in the pair, between the builder's heading and the wealth chart", order.join());
  const fig = root.querySelector('section[aria-labelledby="cust-frontier"] figure');
  const inputs = [...root.querySelectorAll('section[aria-labelledby="cust-weights"] input')];
  check(!!fig && inputs.length === 2 * a.tickers.length && inputs.every((x) => x.compareDocumentPosition(fig) & window.Node.DOCUMENT_POSITION_FOLLOWING) &&
    !root.querySelector("[tabindex]:not([tabindex='0']):not([tabindex='-1'])"),
    "order: every slider and field comes before the frontier, and no tabindex reorders the keyboard");
  check(root.querySelector(".cust .frontier-chart")?.style.height === "480px", "height: stacked on a desktop, the frontier keeps the chart's own height",
    root.querySelector(".cust .frontier-chart")?.style.height);
  r.unmount();

  setMedia((q) => q === PHONE_QUERY);
  const rp = quiet(() => render(h(Harness, { a })));
  check(rp.container.querySelector(".cust .frontier-chart")?.style.height === "380px" && !!rp.container.querySelector(".cust-pair"),
    "height: on a phone, the chart's own phone height");
  rp.unmount();

  setMedia((q) => q === L.SIDE_BY_SIDE_QUERY);
  const rs = quiet(() => render(h(Harness, { a })));
  check(rs.container.querySelector(".cust .frontier-chart")?.style.height === `${L.SIDE_FRONTIER_HEIGHT}px` && L.SIDE_FRONTIER_HEIGHT < 480,
    "height: beside the weights, the frontier is SIDE_FRONTIER_HEIGHT tall, shorter than stacked", rs.container.querySelector(".cust .frontier-chart")?.style.height);
  rs.unmount();
}

// (d) Moving a native range moves the dot to the new mix's risk and return. The chart's axes are read
// through the GMV and Tangency points it draws, and Equal-Weight must land where that reading puts it,
// so the check stands on the axes the reader sees.
for (const name of ["cross", "megacap"]) {
  setMedia((q) => q === L.SIDE_BY_SIDE_QUERY);
  const a = fixtureAnalysis(name);
  const r = quiet(() => render(h(Harness, { a })));
  const root = r.container;
  const before = centre(root, "custom");
  const range = root.querySelector('.cust-row input[type="range"]');
  quiet(() => setValue(range, "1"));
  const v = M.customView(a, latest);
  const w = M.customWeights(v);
  const want = w ? M.customMetrics(a, w) : null;
  const marks = Object.fromEntries(frontierData(a, w, M.customFrontier(a)).marks.map((m) => [m.role, m]));
  const [g, t, e, c] = ["gmv", "tangency", "ew", "custom"].map((role) => centre(root, role));
  const ok = !!(want && g && t && e && c && before && marks.gmv && marks.tangency && marks.ew);
  const px = (s) => g.x + ((s - marks.gmv.sigma) * (t.x - g.x)) / (marks.tangency.sigma - marks.gmv.sigma);
  const py = (m) => g.y + ((m - marks.gmv.mu) * (t.y - g.y)) / (marks.tangency.mu - marks.gmv.mu);
  const off = ok ? Math.max(Math.abs(px(want.sigma) - c.x), Math.abs(py(want.mu) - c.y)) : NaN;
  const axes = ok ? Math.max(Math.abs(px(marks.ew.sigma) - e.x), Math.abs(py(marks.ew.mu) - e.y)) : NaN;
  const moved = ok ? Math.hypot(c.x - before.x, c.y - before.y) : NaN;
  check(ok && latest[a.tickers[0]] === 1 && Object.keys(latest).length === 1 && axes < 0.5 && off < 0.5 && moved > 2,
    `slider (${name}): moving ${a.tickers[0]}'s range to 1 moves the frontier's Custom point to the risk and return customWeights() gives`,
    `off ${off} px, axes ${axes} px, moved ${moved} px`);
  r.unmount();
}
setMedia(() => false);

done("t-custom-layout");
