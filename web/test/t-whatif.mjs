// The band's what-if panel (src/chrome/WhatIf.tsx), rendered in jsdom and read back as a visitor would.
//
// Every figure the sentence prints is held to the engine: the moved return to returnBand, the tangency
// weight to tangency() solved here on means moved by hand (not to the panel's own call), the
// minimum-variance weight to the window's gmv(), which must not change anywhere on the range. The two
// lines under it are held to estimationLoad. Past ten assets the solve waits for the thumb to be let go.
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { act, render, text } from "./_dom.mjs";

const { createElement: h } = await import("react");
const W = await import("../src/chrome/WhatIf.tsx");
const { default: WhatIf, LIVE_UP_TO, SE_REACH, SE_STEP, defaultAsset, whatIfWords } = W;
const { returnBand, largestTangencyHolding, meanStdErrors } = await import("../src/lib/robust.ts");
const { tangency, gmv } = await import("../src/lib/optimize.ts");
const { estimationLoad, TRADING_DAYS } = await import("../src/lib/stats.ts");
const { mulberry32, normals } = await import("../src/lib/rng.ts");
const { format } = await import("../src/format.ts");
const { FITTED } = await import("../src/tabs/caption.ts");
const { exampleAnalysis } = await import("./_analysis.mjs");

const EX = exampleAnalysis();
const T = EX.returns[0].length;
const pct = (x) => format(x, "pct1");

function setValue(el, value, type) {
  const select = el instanceof HTMLSelectElement;
  const proto = select ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  act(() => {
    el.dispatchEvent(new window.Event(type ?? (select ? "change" : "input"), { bubbles: true }));
  });
}
const fire = (el, ev) => act(() => el.dispatchEvent(ev));
const parts = (root) => ({
  panel: root.querySelector("section.whatif"),
  sentence: text(root.querySelector(".whatif-sentence") ?? {}),
  tan: root.querySelector(".whatif-tan") ? text(root.querySelector(".whatif-tan")) : null,
  gmv: root.querySelector(".whatif-gmv") ? text(root.querySelector(".whatif-gmv")) : null,
  range: root.querySelector("input.whatif-range"),
  select: root.querySelector(".whatif-pick select"),
  load: [...root.querySelectorAll(".whatif-load p")].map(text),
});

// What the sentence must say at z standard errors for asset i, from the engine alone.
function expected(a, i, z) {
  const band = returnBand(a.m, a.S, a.returns[0].length, i);
  const mu = band.estimate + z * band.se;
  const means = a.m.slice();
  means[i] = mu / TRADING_DAYS;
  const t = tangency(means, a.S, a.rf, a.allowShort);
  return { band, mu, tan: t ? pct(t.w[i]) : null, gmv: a.gmv ? pct(a.gmv.w[i]) : null };
}

// ---- (a) the asset it opens on, and the sentence across the whole range -----------------------------
{
  const i0 = largestTangencyHolding(EX.m, EX.S, EX.rf, EX.allowShort);
  check(defaultAsset(EX) === i0 && i0 !== null, "whatif: opens on the tangency portfolio's largest holding", `${defaultAsset(EX)} ${i0}`);
  const r = render(h(WhatIf, { a: EX }));
  const p0 = parts(r.container);
  check(p0.select?.value === String(i0) && p0.range?.value === "0",
    "whatif: the select names that holding and the range starts at the window's own average", `${p0.select?.value} ${p0.range?.value}`);
  check(Number(p0.range?.min) === -SE_REACH && Number(p0.range?.max) === SE_REACH && SE_REACH === 2 && Number(p0.range?.step) === SE_STEP,
    "whatif: the range runs two standard errors either side, in standard errors", `${p0.range?.min} ${p0.range?.max} ${p0.range?.step}`);

  const zs = [-2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const wrong = [];
  const tans = new Set();
  const gmvs = new Set();
  for (const z of zs) {
    setValue(p0.range, String(z));
    const zz = Number(p0.range.value);
    const e = expected(EX, i0, zz);
    const p = parts(r.container);
    tans.add(p.tan);
    gmvs.add(p.gmv);
    if (p.tan !== e.tan) wrong.push(`z ${zz}: tangency ${p.tan}, engine ${e.tan}`);
    if (p.gmv !== e.gmv) wrong.push(`z ${zz}: gmv ${p.gmv}, engine ${e.gmv}`);
    if (!p.sentence.includes(`were ${pct(e.mu)},`)) wrong.push(`z ${zz}: return ${pct(e.mu)} not printed`);
    if (!p.sentence.includes(`over this window was ${pct(e.band.estimate)} a year`) ||
      !p.sentence.includes(`runs from ${pct(e.band.lo1)} to ${pct(e.band.hi1)}.`)) wrong.push(`z ${zz}: the one-SE band is not the engine's`);
  }
  check(wrong.length === 0, "whatif: at every stop on the range the tangency weight is tangency() on the moved means, and the return and its band are the engine's", wrong.slice(0, 4).join("; "));
  check(tans.size > 1, "whatif: the tangency weight moves across the range", [...tans].join(" "));
  check(gmvs.size === 1 && [...gmvs][0] === pct(EX.gmv.w[i0]), "whatif: the minimum-variance weight is the window's own and never moves", [...gmvs].join(" "));
  check(meanStdErrors(EX.S, T)[i0] === returnBand(EX.m, EX.S, T, i0).se && W.solveAt(EX, i0, SE_REACH)?.clamped === false && W.solveAt(EX, i0, -SE_REACH)?.clamped === false,
    "whatif: the range's ends are exactly the engine's clamp, never past it");

  // (b) the select changes the asset, and the range goes back to that asset's own average.
  const j = (i0 + 1) % EX.tickers.length;
  setValue(p0.range, "1");
  setValue(p0.select, String(j));
  const p1 = parts(r.container);
  const e1 = expected(EX, j, 0);
  check(p1.range.value === "0" && p1.sentence.startsWith(`${EX.tickers[j]}'s average return`) && p1.tan === e1.tan && p1.gmv === e1.gmv &&
    p1.sentence.includes(`were ${pct(e1.mu)},`),
    "whatif: the select changes the asset, restarts the range at its average, and the sentence follows it", p1.sentence.slice(0, 160));

  // (c) the two lines under the sentence, held to estimationLoad.
  const L = estimationLoad(EX.returns);
  const n = EX.tickers.length;
  const ses = L.assets.map((x) => (x.se * 100).toFixed(1));
  const lo = Math.min(...L.assets.map((x) => x.se));
  const hi = Math.max(...L.assets.map((x) => x.se));
  check(L.assets.every((x, k) => Math.abs(x.se - meanStdErrors(EX.S, T)[k]) < 1e-12), "whatif: estimationLoad's error of each mean is the band's", ses.join(" "));
  check(p1.load[0] === `With ${n} assets and ${format(T, "int")} days of returns, the optimizer estimates ${n} expected returns and ` +
    `${n * (n + 1) / 2} variances and covariances; each expected return is known to about ±${(lo * 100).toFixed(1)} to ±${(hi * 100).toFixed(1)} points a year (one standard error).`,
    "whatif: the first line counts the means and covariances from the days, and how well each mean is known", p1.load[0]);
  check(p1.load[1] === `To pin ${EX.tickers[j]}'s expected return to ±${(L.h * 100).toFixed(0)} points a year would take about ` +
    `${format(Math.round(L.assets[j].yearsNeeded), "int")} years of daily prices; this window has ${(T / TRADING_DAYS).toFixed(1)}.`,
    "whatif: the second line gives the chosen asset's years needed against the window's years", p1.load[1]);
  check(p1.load.length === 2, "whatif: no thin-data line on a window with enough days per asset", `${T / n} days per asset`);

  // (d) labelled as a what-if on these prices, never the published study, and in plain words.
  const all = text(p1.panel ?? {});
  const src = readFileSync(new URL("../src/chrome/WhatIf.tsx", import.meta.url), "utf8");
  check(src.includes('import { FITTED } from "../content/words.ts";') && !src.includes(JSON.stringify(FITTED)) && W.FITTED_WORDS === undefined,
    "whatif: the fitted words are imported from the one shared copy the tabs use, never written out again");
  check(/What-if on these prices/.test(all) && /Not the published study/.test(all) && all.includes(FITTED) && all.includes("in-sample"),
    "whatif: labelled a what-if on these prices, not the published study, in-sample, weights chosen on this window", all.slice(0, 200));
  check(!/\b(best|optimal)|optimally|forecast|out of sample|out-of-sample/i.test(all), "whatif: no best, optimal, forecast or out-of-sample claim", all.match(/\b(best|optimal)|forecast|out.of.sample/i)?.[0] ?? "");
  r.unmount();
}

// ---- (e) shorting on: the same holds with weights that can go below zero -----------------------------
{
  const a = exampleAnalysis({ allowShort: true });
  const i = defaultAsset(a);
  const r = render(h(WhatIf, { a }));
  const wrong = [];
  for (const z of [-2, -1, 0, 1, 2]) {
    setValue(parts(r.container).range, String(z));
    const e = expected(a, i, z);
    const p = parts(r.container);
    if (p.tan !== e.tan || p.gmv !== e.gmv) wrong.push(`z ${z}: ${p.tan}/${p.gmv} against ${e.tan}/${e.gmv}`);
  }
  check(a.tangency !== null && wrong.length === 0, "whatif: with shorting on, the weights are still the engine's at every stop", wrong.join("; "));
  r.unmount();
}

// ---- (f) the odd baskets: nothing beats the rate, and no tangency at all -----------------------------
{
  const noBeat = exampleAnalysis({ rf: 0.4 });
  const r = render(h(WhatIf, { a: noBeat }));
  const p = parts(r.container);
  const e = expected(noBeat, defaultAsset(noBeat), 0);
  check(noBeat.tangency?.beatsRf === false && p.sentence.includes(`no mix would earn more than the ${format(0.4, "pct2")} risk-free rate`) && p.tan === e.tan,
    "whatif: long only with nothing beating the rate, the sentence says so and still prints the engine's weight", p.sentence.slice(0, 200));
  r.unmount();

  const failed = exampleAnalysis({ allowShort: true, rf: 0.4 });
  const f = render(h(WhatIf, { a: failed }));
  const pf = parts(f.container);
  check(failed.tangency === null && !pf.range && !pf.tan && /no highest-Sharpe mix to move/.test(pf.sentence),
    "whatif: with no tangency on these settings the panel says so and offers no range", pf.sentence);
  f.unmount();

  // A moved mean with no tangency (shorting on, nothing in the box beats the rate): the words, directly.
  const words = whatIfWords("VTI", 0.4, true, { asset: 0, requested: 0.1, mu: 0.1, clamped: false, band: null, means: [], tangency: null, gmv: EX.gmv, largest: null });
  check(words.tan === null && /within the shorting limits would earn more than the 40\.00% risk-free rate, so there would be no highest-Sharpe mix to hold/.test(words.lead) &&
    words.gmv === pct(EX.gmv.w[0]),
    "whatif: a move that leaves no tangency says there is none, and the minimum-variance weight still stands", JSON.stringify(words));
  const noGmv = whatIfWords("VTI", 0.04, false, { asset: 0, requested: 0.1, mu: 0.1, clamped: false, band: null, means: [], tangency: EX.tangency, gmv: null, largest: 0 });
  check(noGmv.gmv === null && /lowest-variance solve failed/.test(noGmv.tail), "whatif: a failed minimum-variance solve is named, never a stand-in", JSON.stringify(noGmv));
}

// ---- (g) past ten assets the solve waits for the thumb to be let go ----------------------------------
{
  const N = LIVE_UP_TO + 1;
  const days = 600;
  const z = normals(mulberry32(7));
  const returns = Array.from({ length: N }, () => new Array(days));
  for (let t = 0; t < days; t++) {
    const common = z();
    for (let k = 0; k < N; k++) returns[k][t] = 0.0003 + 0.00004 * k + 0.006 * common + (0.008 + 0.0005 * k) * z();
  }
  const m = returns.map((c) => c.reduce((s, x) => s + x, 0) / days);
  const S = m.map((mi, p) => m.map((mj, q) => {
    let s = 0;
    for (let t = 0; t < days; t++) s += (returns[p][t] - mi) * (returns[q][t] - mj);
    return s / (days - 1);
  }));
  const rf = 0.02;
  const a = { tickers: Array.from({ length: N }, (_, k) => `S${k + 1}`), m, S, rf, allowShort: false, returns, tangency: tangency(m, S, rf, false), gmv: gmv(m, S, false) };
  const i = defaultAsset(a);
  const r = render(h(WhatIf, { a }));
  const before = parts(r.container).tan;
  const range = parts(r.container).range;
  setValue(range, "1.5");
  const mid = parts(r.container);
  const e = expected(a, i, Number(range.value));
  check(a.tangency !== null && e.tan !== before && mid.tan === before && !!r.container.querySelector(".whatif-wait"),
    `whatif: past ${LIVE_UP_TO} assets moving the thumb does not solve`, `${before} ${mid.tan} ${e.tan}`);
  fire(range, new window.KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
  const after = parts(r.container);
  check(after.tan === e.tan && !r.container.querySelector(".whatif-wait"), `whatif: past ${LIVE_UP_TO} assets letting go solves on the moved mean`, `${after.tan} ${e.tan}`);
  setValue(range, "-1.5");
  fire(range, new window.MouseEvent("mouseup", { bubbles: true }));
  check(parts(r.container).tan === expected(a, i, Number(range.value)).tan, "whatif: a mouse release solves too");
  r.unmount();

  // At ten or fewer, every step solves at once.
  const live = render(h(WhatIf, { a: EX }));
  const lr = parts(live.container).range;
  setValue(lr, "-2");
  check(parts(live.container).tan === expected(EX, defaultAsset(EX), -2).tan && !live.container.querySelector(".whatif-wait"),
    `whatif: at ${EX.tickers.length} assets the weight follows the thumb with no release`);
  live.unmount();
}

// ---- (h) the track: full width, and the teal band is exactly one standard error either side ---------
{
  const sheet = readFileSync(new URL("../src/chrome/WhatIf.css", import.meta.url), "utf8");
  const at = sheet.indexOf(".whatif-range {");
  const block = at < 0 ? "" : sheet.slice(at, sheet.indexOf("\n}", at));
  const edge = (50 * (1 - 1 / SE_REACH)).toString();
  const far = (100 - 50 * (1 - 1 / SE_REACH)).toString();
  check(/width:\s*100%/.test(block) && /appearance:\s*none/.test(block), "whatif: the range fills the panel's width under the sentence", block.slice(0, 120));
  check(block.includes(`var(--color-teal) calc(${edge}% + var(--thumb) / 4)`) && block.includes(`calc(${far}% - var(--thumb) / 4)`),
    "whatif: the teal stretch of the track starts and ends one standard error either side of the average", `${edge} ${far}`);
  check(!/#[0-9a-f]{3,6}\b|rgb\(/i.test(sheet), "whatif: paper and ink tokens only");
}

done("t-whatif");
