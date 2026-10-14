// Build's lead (src/tabs/Optimization.tsx, src/tabs/optimization/Optimization.css, src/tabs/custom/layout.ts, the
// panel's own rules in src/tabs/custom/Custom.css): on a desktop wide enough for both, the frontier card on the
// left and the Your mix panel on the right; below that width, a phone included, the panel under the chart.
//
// (a) The stylesheets, read as text (jsdom lays nothing out): the side-by-side rule sits under one min-width
//     media query whose number is SIDE_BY_SIDE_MIN_PX, two tracks, the chart's the wider; inside it the slider rows
//     run in one column and the figures three a row; outside it nothing places, orders or displays the lead's
//     parts, so every narrower width stacks in markup order; the panel's desktop and phone rules for the editor
//     and the figures are the ones they were.
// (b) The markup: the frontier card then the panel, the lead's only two parts, right after the headline and
//     before the chapter's More list; no tabindex reorders the keyboard; the frontier keeps the chart's own height.
// (c) A native range moved: the frontier's Custom point lands at the risk and return customWeights() gives
//     for the new mix, read on the chart's own axes through the GMV and Tangency points.
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { act, render, setMedia, text } from "./_dom.mjs";

const { createElement: h, useState } = await import("react");
const Optimization = (await import("../src/tabs/Optimization.tsx")).default;
const M = await import("../src/tabs/custom/model.ts");
const L = await import("../src/tabs/custom/layout.ts");
const { frontierData } = await import("../src/charts/Frontier.tsx");
const { PHONE_QUERY } = await import("../src/styles/tokens.ts");
const { fixtureAnalysis, tabProps } = await import("./_analysis.mjs");

// ---- (a) the stylesheet ----------------------------------------------------------------------------------
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const CSS = strip(readFileSync(new URL("../src/tabs/custom/Custom.css", import.meta.url), "utf8"));
const OPT_CSS = strip(readFileSync(new URL("../src/tabs/optimization/Optimization.css", import.meta.url), "utf8"));

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
const optMedia = atRules(OPT_CSS);
const wide = [...media, ...optMedia].filter((m) => /min-width/.test(m.cond));
const phone = media.find((m) => m.cond === `(max-width: ${"760px"})`);
const outside = media.reduceRight((s, m) => s.slice(0, m.from) + s.slice(m.to), CSS);
const optOutside = optMedia.reduceRight((s, m) => s.slice(0, m.from) + s.slice(m.to), OPT_CSS);
const top = rules(outside);
const optTop = rules(optOutside);

check(wide.length === 1 && optMedia.includes(wide[0]) && wide[0].cond === L.SIDE_BY_SIDE_QUERY && L.SIDE_BY_SIDE_QUERY === `(min-width: ${L.SIDE_BY_SIDE_MIN_PX}px)` && L.SIDE_BY_SIDE_MIN_PX > 760,
  "layout: one min-width query, in Optimization.css, holds the side-by-side rule, at SIDE_BY_SIDE_MIN_PX, wider than a phone", wide.map((m) => m.cond).join(" | "));
{
  const rs = rules(wide[0]?.body ?? "");
  const lead = pick(rs, ".build-lead");
  const tracks = (lead["grid-template-columns"] ?? "").match(/minmax\(0, ([\d.]+)fr\)/g) ?? [];
  const fr = tracks.map((x) => Number(/([\d.]+)fr/.exec(x)[1]));
  check(tracks.length === 2 && fr[0] > fr[1] && lead["align-items"] === "start",
    "layout: side by side, two tracks, the frontier's (first in the markup) the wider", JSON.stringify(rs));
  check(pick(rs, ".build-lead .cust-editor")["grid-template-columns"] === "minmax(0, 1fr)" && pick(rs, ".build-lead .cust-plates")["grid-template-columns"] === "repeat(3, minmax(0, 1fr))",
    "layout: beside the frontier the slider rows run in one column and the figures three a row");
}
{
  // Below the breakpoint: the lead is one column, and no rule anywhere in either sheet reorders its parts.
  const placing = /^(order|grid-area|grid-row|grid-column|grid-template-areas)$|^flex-direction$/;
  // Every rule of the panel's sheet, and every rule of Optimization.css that names the lead or its parts (the dot
  // strips further down that sheet place their own names, which is not the lead).
  const outsideRules = [...top, ...media.filter((m) => !wide.includes(m)).flatMap((m) => rules(m.body)),
    ...[...optTop, ...optMedia.filter((m) => !wide.includes(m)).flatMap((m) => rules(m.body))].filter((r) => /build-|cust-/.test(r.sel))];
  const strays = outsideRules.filter((r) => Object.keys(r.decl).some((k) => placing.test(k)));
  const reorders = /(^|[\s;{])order\s*:|-reverse|direction\s*:/.test(CSS + OPT_CSS);
  check(strays.length === 0 && !reorders && pick(optTop, ".build-lead")["grid-template-columns"] === "minmax(0, 1fr)",
    "layout: below the breakpoint the lead is one column and nothing reorders its parts", JSON.stringify(strays));
  check(pick(top, ".cust-editor")["grid-template-columns"] === "repeat(2, minmax(0, 1fr))" && pick(top, ".cust-plates")["grid-template-columns"] === "repeat(5, minmax(0, 1fr))",
    "layout: stacked on a desktop, two columns of slider rows and five figures, as before");
  const pr = rules(phone?.body ?? "");
  check(pr.map((r) => r.sel).join() === ".cust-editor,.cust-plates,.cust-field" &&
    pick(pr, ".cust-editor")["grid-template-columns"] === "minmax(0, 1fr)" && pick(pr, ".cust-plates")["grid-template-columns"] === "repeat(2, minmax(0, 1fr))",
    "layout: the phone rules are the ones they were", pr.map((r) => r.sel).join());
}

// ---- (b)-(c) the chapter rendered -------------------------------------------------------------------------------// ---- (b)-(d) the tab rendered -------------------------------------------------------------------------------
let latest = null;
function Harness({ a }) {
  const [w, setW] = useState({});
  latest = w;
  return h(Optimization, tabProps(a, { weights: w, setWeights: setW }));
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
const setValue = (el, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
// A drawn mark's centre, from the translate recharts gives its symbol.
function centre(root, role) {
  const p = root.querySelector(`#build-frontier .frontier-mark--${role} .recharts-symbols`);
  const m = /translate\(\s*([-\d.e]+)[ ,]\s*([-\d.e]+)\s*\)/.exec(p?.getAttribute("transform") ?? "");
  return m ? { x: +m[1], y: +m[2] } : null;
}

{
  setMedia(() => false);
  const a = fixtureAnalysis("cross");
  const r = quiet(() => render(h(Harness, { a })));
  const root = r.container;
  const lead = root.querySelector(".build-lead");
  const parts = [...(lead?.children ?? [])].map((el) => el.id || el.className);
  check(parts.join() === "build-frontier,section-custom" && lead.previousElementSibling?.matches(".formula-fold, .opt-headline") &&
    root.querySelector(".build-lead + section.more") !== null,
    "order: the frontier card, then the Your mix panel, after the headline and before the More list", parts.join());
  const fig = root.querySelector("#build-frontier figure");
  const inputs = [...root.querySelectorAll(".build-mix input")];
  check(!!fig && inputs.length === 2 * a.tickers.length && inputs.every((x) => fig.compareDocumentPosition(x) & window.Node.DOCUMENT_POSITION_FOLLOWING) &&
    !root.querySelector("[tabindex]:not([tabindex='0']):not([tabindex='-1'])"),
    "order: the frontier comes before every slider and field, and no tabindex reorders the keyboard");
  check(root.querySelector("#build-frontier .frontier-chart")?.style.height === "480px", "height: on a desktop the frontier keeps the chart's own height",
    root.querySelector("#build-frontier .frontier-chart")?.style.height);
  r.unmount();

  setMedia((q) => q === PHONE_QUERY);
  const rp = quiet(() => render(h(Harness, { a })));
  check(rp.container.querySelector("#build-frontier .frontier-chart")?.style.height === "380px" && !!rp.container.querySelector(".build-lead > .build-mix"),
    "height: on a phone, the chart's own phone height, the panel still in the lead");
  rp.unmount();

  // The panel stands beside the frontier on a wide desktop and under it otherwise: so with the weights refused,
  // neither may say where the weights are.
  const zero = Object.fromEntries(a.tickers.map((t) => [t, 0]));
  const rz = quiet(() => render(h(Optimization, tabProps(a, { weights: zero }))));
  const said = [".build-mix .cust-figures > p.cust-note", "#build-frontier .card-sub"].map((s) => text(rz.container.querySelector(s) ?? rz.container));
  check(said.every((s) => /refused/.test(s) && !/\b(above|below|beside|left|right)\b/.test(s)),
    "refused: the figures and the frontier say the weights were refused without saying where they stand", said.join(" | ").slice(0, 300));
  rz.unmount();
}

// (c) Moving a native range moves the dot to the new mix's risk and return. The chart's axes are read
// through the GMV and Tangency points it draws, and Equal-Weight must land where that reading puts it,
// so the check stands on the axes the reader sees.
for (const name of ["cross", "megacap"]) {
  setMedia((q) => q === L.SIDE_BY_SIDE_QUERY);
  const a = fixtureAnalysis(name);
  const r = quiet(() => render(h(Harness, { a })));
  const root = r.container;
  const before = centre(root, "custom");
  const range = root.querySelector('.build-mix .cust-row input[type="range"]');
  quiet(() => setValue(range, "1"));
  const v = M.customView(a, latest);
  const w = M.customWeights(v);
  const want = w ? M.customMetrics(a, w) : null;
  const marks = Object.fromEntries(frontierData(a, w).marks.map((m) => [m.role, m]));
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

done("t-build-layout");
