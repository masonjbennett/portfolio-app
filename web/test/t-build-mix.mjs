// The Your mix panel (src/tabs/custom/YourMix.tsx, its arithmetic in src/tabs/custom/model.ts): the app's Custom
// Portfolio tab (portfolio_app.py 1708-1837), now the panel beside Build's frontier, drawn by the Optimization tab.
//
// (a) The weights and the five figures against the oracle's dump for cross and megacap, long-only and
//     short: the default is exactly 1/n, the app's division reproduced, the port's weights and figures
//     equal to it wherever the port builds a book, and refused, in numbers, where the app flips or
//     blows one up (ledger:custom-normalisation, the panel's half).
// (b) The frontier: the mix is a point on Build's one frontier, and the line saying how far it sits is held to
//     the app's own 60-point frontier.
// (c) The verdict, literal; the mix's growth, now Performance's line; and the merge itself, figure by figure:
//     every ending value the two deleted growth charts printed is in Performance's mixes table.
// (d) The panel rendered in its chapter in jsdom: anchor, title, verdict, a slider and a typed field per asset,
//     the plates with no info mark and their texts under How it is calculated, the frontier beside it moving with
//     a typed weight, the one table under Show the numbers with both downloads, no NaN, the reset.
// Ledger entries closed here (the panel's half of each): custom-normalisation, boundary, failed-tangency,
// rf-live, numeric-downloads, downloads-everywhere, daily-rebalanced-label, short-bounds-copy,
// frontier-hover. Each asserts the app's side, read out of portfolio_app.py or its dump, and the port's.
// Not applicable to this panel: excess-kurtosis, in-sample-label (these figures are the full sample's, and
// the weights are the reader's, not fitted), start-date-floor.
import { readFileSync } from "node:fs";
import { check, done, json, near, nearAll } from "./_assert.mjs";
import { act, expectUncaught, openAll, render, text } from "./_dom.mjs";

const { createElement: h, useState } = await import("react");
const Optimization = (await import("../src/tabs/Optimization.tsx")).default;
const { MIX_ANCHOR, MIX_TITLE } = await import("../src/tabs/custom/YourMix.tsx");
const { sectionId } = await import("../src/App.tsx");
const M = await import("../src/tabs/custom/model.ts");
const OPT = await import("../src/tabs/optimization/model.ts");
const { overviewWealth } = await import("../src/overview/OverviewWealth.tsx");
const { summaryRow, portfolioPerformance, portfolioReturns } = await import("../src/lib/portfolio.ts");
const { maxDrawdown } = await import("../src/lib/stats.ts");
const { frontierData, FRONTIER_HOVER } = await import("../src/charts/Frontier.tsx");
const { wealthCaption, wealthPlot } = await import("../src/charts/Wealth.tsx");
const { tipText } = await import("../src/content/tooltips.ts");
const { csvText } = await import("../src/download.ts");
const { format, MINUS } = await import("../src/format.ts");
const { fixtureAnalysis, tabProps } = await import("./_analysis.mjs");

const ORACLE = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8").split(/\r?\n/);
const lines = (a, b) => ORACLE.slice(a - 1, b).join("\n");
const REL = 1e-12;
const pct = (x) => format(x, "pct2");
const n2 = (x) => format(x, "num2");
const n3 = (x) => format(x, "num3");
const usd = (x) => format(x, "usd0");
const oracle = (set) => json(new URL(`./fixtures/oracle-${set}.json`, import.meta.url));
const byTicker = (a, xs) => Object.fromEntries(a.tickers.map((t, i) => [t, xs[i] ?? 0]));

// The oracle's line numbers must still point where this suite reads.
check(ORACLE[1707] === "with tab5:" && /raw_total == 0/.test(ORACLE[1724]) && ORACLE[1726].trim() === "st.stop()" &&
  /custom_w = np\.array\(\[raw_weights\[t\] \/ raw_total/.test(ORACLE[1731]) && /\{:\.2%\}/.test(ORACLE[1735]) &&
  /n_points=60/.test(ORACLE[1755]) && /hovermode="closest"/.test(ORACLE[1815]) && /style_chart\(fig_ef2/.test(ORACLE[1817]),
  "oracle: tab 5 opens at 1708; zero check 1725, stop 1727, division 1732, string weights 1736, 60 points 1756, hover 1816/1818");
const TAB5 = lines(1708, 1837);

const quietly = (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};

// ---- (a) the weights and figures against the dump -----------------------------------------------------
for (const set of ["cross", "megacap"]) {
  const o = oracle(set);
  for (const mode of ["long", "short"]) {
    const tag = (s) => `${set} ${mode}: ${s}`;
    const a = fixtureAnalysis(set, { allowShort: mode === "short" });
    check(a.tickers.join() === o.clean.tickers.join() && a.dates.length === o.returns.rows, tag("the analysis is the oracle's tickers and return rows"));
    for (const [k, c] of Object.entries(o.modes[mode].custom)) {
      const ck = (s) => tag(`custom ${k}: ${s}`);
      // "default" is the slider left alone: no entry at all, which must be exactly 1/n (1719).
      const v = M.customView(a, k === "default" ? {} : byTicker(a, c.raw));
      check(v.raw.every((x, i) => x === c.raw[i]), ck("the raw weights, as the app's sliders hold them (default exactly 1/n, 1720)"), v.raw.join());
      // The app's side, reproduced: raw / raw_total (1722, 1732).
      const app = c.raw.map((x) => x / c.total);
      nearAll(ck("the app's normalisation reproduced"), app, c.w, REL, 1e-15);
      const inBox = c.total > 0.05 && app.every((x) => x >= (mode === "short" ? -1 : 0) && x <= 1);
      if (inBox) {
        check(v.custom.ok && v.refusal === null, ck("the port builds the same book"));
        if (!v.custom.ok) continue;
        near(ck("the weight total"), v.custom.total, c.total, REL);
        nearAll(ck("normalised weights = the app's"), v.custom.w, c.w, REL, 1e-15);
        const p = M.customMetrics(a, v.custom.w);
        for (const f of ["mu", "sigma", "sharpe", "sortino"]) near(ck(`${f} (1739-1742)`), p[f], c.perf[f], 1e-11);
        // Max DD: the app's path starts a day in (904-908); the port's from the amount invested.
        const r = portfolioReturns(a.returns, v.custom.w);
        near(ck("the app's Max DD reproduced with the start left out"), maxDrawdown(r, false), c.perf.mdd, 1e-11);
        check(p.mdd === maxDrawdown(r, true) && p.mdd <= c.perf.mdd + 1e-15, ck("the port's Max DD counts from the amount invested"), `${p.mdd} vs ${c.perf.mdd}`);
      } else {
        // ledger:custom-normalisation, the tab's half.
        const muMax = o.modes[mode].frontier60.muMax;
        if (c.total < 0) {
          check(c.raw.every((x) => x < 0) && c.w.every((x) => x > 0),
            ck("ledger:custom-normalisation: the app turns an all-short book into an all-long one (1732)"), c.w.join());
        } else {
          check(Math.abs(c.total) < 0.05 && Math.max(...c.w.map(Math.abs)) > 20 && c.perf.mu > muMax,
            ck("ledger:custom-normalisation: the app divides by a total near zero, levers the book past 20x and plots it above its own frontier"),
            `total ${c.total}, max |w| ${Math.max(...c.w.map(Math.abs))}, mu ${c.perf.mu} vs frontier top ${muMax}`);
        }
        check(!v.custom.ok && v.custom.reason === "net-short" && M.customWeights(v) === null,
          ck("ledger:custom-normalisation: the port builds no book"));
        const total = n2(c.total);
        const want = c.total < 0
          ? `The weights add up to ${total}. Dividing by a negative total would turn every long into a short and every short into a long, so no custom portfolio is built. Make the weights add up to more than 0.05.`
          : `The weights add up to ${total}. Dividing by a total of 0.05 or less would multiply every weight by 20 or more, so no custom portfolio is built. Make the weights add up to more than 0.05.`;
        check(v.refusal?.detail === want, ck("ledger:custom-normalisation: the port says why, in numbers"), v.refusal?.detail);
        check(M.verdict(a, v) === `No custom portfolio: the weights add up to ${c.total < 0 ? `${total}, a net short` : `only ${total}`}.`,
          ck("the verdict names the refusal"), M.verdict(a, v));
      }
    }
  }
}

// The other refusals, and the clamp.
{
  const short = fixtureAnalysis("cross", { allowShort: true });
  const long = fixtureAnalysis("cross");
  const zero = M.customView(long, byTicker(long, []));
  check(!zero.custom.ok && zero.custom.reason === "zero" && M.verdict(long, zero) === "No custom portfolio: every weight is zero." &&
    zero.refusal.detail === "Every weight is zero, so there is no portfolio to build. Set at least one weight above zero.",
    "zero: all-zero weights are refused and named (the app's warning at 1726, without its st.stop)");
  const flat = M.customView(short, byTicker(short, [0.3, -0.3]));
  check(!flat.custom.ok && flat.custom.reason === "net-short" && flat.refusal.short === "the weights add up to zero",
    "zero total: 0.3 and -0.3 add to exactly zero and are refused as such", flat.refusal?.detail);
  const lev = M.customView(short, byTicker(short, [0.9, -0.8, 0.5]));
  check(!lev.custom.ok && lev.custom.reason === "leverage" &&
    lev.refusal.detail === `Divided by their total, 0.60, the weights would put 150.00% in VTI, outside the ${MINUS}100% to 100% each weight is held to, so no custom portfolio is built. Lower the short weights or raise the long ones.`,
    "leverage: a book the division pushes out of the box is refused, naming the asset and the weight", lev.refusal?.detail);
  const stale = M.customView(long, byTicker(long, [-0.4, 0.5, 0.5]));
  check(stale.custom.ok && stale.custom.w[0] === 0 && stale.custom.w[1] === 0.5 &&
    M.clampLine(stale, false) === `Outside the 0 to 1 range, so held to the nearest end of it: VTI (entered ${MINUS}0.4, counts as 0). Shorting is off.`,
    "clamp: a short kept from when shorting was on counts as 0 long-only, and the page says so", M.clampLine(stale, false));
  const tiny = M.customView(long, byTicker(long, [1 + 1e-15, 0]));
  check(tiny.clamps.length === 0, "clamp: a solver's 1.000000000000001 is not reported as a clamp");
  check(M.totalLine(M.customView(long, {})) === "Weight total: 1.00. Each weight is divided by it, so the normalized weights add up to 1.00." &&
    M.totalLine(stale) === "Weight total: 1.00, counting the clamped values. Each weight is divided by it, so the normalized weights add up to 1.00.",
    "the total line (1729), and that it counts the clamped values");
  check(M.parseWeight("0.25") === 0.25 && M.parseWeight("-1") === -1 && M.parseWeight(".5") === 0.5 &&
    [" ", "", "-", ".", "abc", "Infinity", "0x10", "1e999"].every((s) => M.parseWeight(s) === null),
    "parseWeight: a plain decimal, nothing else");
  check(M.clampWeight(1.5, false) === 1 && M.clampWeight(-0.3, false) === 0 && M.clampWeight(-0.3, true) === -0.3 && M.clampWeight(-2, true) === -1,
    "clampWeight: the slider's bounds (1719-1720)");
  check(M.shownWeight(1 / 7) === "0.1429" && M.shownWeight(0.2) === "0.2" && M.shownWeight(-0.4) === "-0.4", "shownWeight: four decimals at most");
  const w = { VTI: 0.3, AAPL: 0.5 };
  check(JSON.stringify(M.resetWeights(long.tickers, w)) === JSON.stringify({ AAPL: 0.5 }) && M.hasEntries(long.tickers, w) && !M.hasEntries(long.tickers, { AAPL: 1 }),
    "reset: this analysis's entries go back to 1/n, another ticker's entry is kept (the app keys sliders by ticker, 1720)");
}


// ---- (b) the frontier ------------------------------------------------------------------------------------
// One frontier: the mix is a point on Build's, the app's tab-4 frontier (80 targets, 1593). The app's tab 5 drew
// its own on 60 targets (1756); the port does not draw it twice. How far the mix sits from it is an exact solve,
// held below to the app's own 60-point frontier, so neither sampling enters the figure.
for (const set of ["cross", "megacap"]) {
  const o = oracle(set);
  for (const mode of ["long", "short"]) {
    const tag = (s) => `${set} ${mode}: ${s}`;
    const a = fixtureAnalysis(set, { allowShort: mode === "short" });
    const v = M.customView(a, {});
    const d = frontierData(a, M.customWeights(v));
    const cm = d.marks.find((m) => m.role === "custom");
    const c = o.modes[mode].custom.default;
    check(d.points === a.frontier && a.frontier.length === 80 && !!cm && close2(cm.mu, c.perf.mu) && close2(cm.sigma, c.perf.sigma),
      tag("the Custom mark on Build's one frontier is the app's custom point (1795-1798)"));

    // The sub-line quotes the frontier's volatility at the custom mix's return. Held to the app's own
    // 60-point frontier: between the two targets that bracket that return, the curve rises, so the
    // quoted figure lies between their volatilities (to the rounding of a printed percent).
    const title = M.frontierTitle(a, v);
    const m = /^The frontier reaches the custom mix's (.+) return at (.+) volatility, against the mix's (.+)$/.exec(title);
    check(!!m && m[1] === pct(c.perf.mu) && m[3] === pct(c.perf.sigma), tag("frontier line: the custom mix's return and volatility, the app's"), title);
    if (m) {
      const F = o.modes[mode].frontier60;
      const kept = F.kept.map((i) => ({ t: F.targets[i], s: F.sigma[i] }));
      const k = kept.findIndex((p) => p.t > c.perf.mu);
      const quoted = Number(m[2].replace(MINUS, "-").replace("%", "")) / 100;
      check(k > 0 && quoted >= kept[k - 1].s - 5e-5 && quoted <= kept[k].s + 5e-5 && quoted < c.perf.sigma,
        tag("frontier line: the quoted frontier volatility sits on the app's frontier at that return, left of the mix"),
        `${quoted} in [${kept[k - 1]?.s}, ${kept[k]?.s}]`);
    }
  }
}
function close2(x, y) {
  return Math.abs(x - y) <= 1e-11 * Math.abs(y);
}
{
  const o = oracle("cross");
  const long = fixtureAnalysis("cross");
  const agg = M.customView(long, byTicker(long, [0, 1]));
  const T = o.modes.long;
  check(M.frontierTitle(long, agg) ===
    `The GMV portfolio returns more than the custom mix, ${pct(T.frontier80tight.muMin)} a year against ${pct(o.perColumn.AGG.mu)}, with less volatility, ${pct(T.tight.gmv.fun)} against ${pct(o.perColumn.AGG.sigma)}`,
    "frontier line: all in AGG sits below the GMV return, and the GMV portfolio beats it on both counts", M.frontierTitle(long, agg));
  const onIt = M.customView(long, byTicker(long, long.tangency.w));
  check(M.frontierTitle(long, onIt) === `The custom mix sits on the frontier: no long-only mix returns ${pct(T.perf.tan.mu)} a year with less than its ${pct(T.perf.tan.sigma)} volatility`,
    "frontier line: the tangency weights sit on the frontier", M.frontierTitle(long, onIt));
  const short = fixtureAnalysis("cross", { allowShort: true });
  check(M.frontierTitle(short, M.customView(short, byTicker(short, short.tangency.w))).includes(`no mix with weights inside [${MINUS}1, 1] returns`),
    "frontier line: with shorting on, it names the bounds");
  check(M.frontierTitle(short, M.customView(short, byTicker(short, [-0.2, -0.2]))) === "The frontier with no custom portfolio on it: the weights entered were refused",
    "frontier line: refused weights say so");
}

// ---- (c) the verdict, and the growth the chapter no longer draws -----------------------------------------
const tanName = "Best-tradeoff (Tangency)";
for (const set of ["cross", "megacap"]) {
  const o = oracle(set);
  for (const mode of ["long", "short"]) {
    const tag = (s) => `${set} ${mode}: ${s}`;
    const a = fixtureAnalysis(set, { allowShort: mode === "short" });
    const T = o.modes[mode];
    const tan = n3(-T.tight.tan.fun); // the app's tangency Sharpe, from its ftol-1e-15 re-run
    check(n3(a.tangency.sharpe) === tan, tag("the port's tangency Sharpe prints as the app's"), `${a.tangency.sharpe} vs ${-T.tight.tan.fun}`);
    const d = T.custom.default.perf;
    const cmp = (s) => (n3(s) === tan ? "level with" : s < -T.tight.tan.fun ? "below" : "above");
    check(M.verdict(a, M.customView(a, {})) === `Left at equal weights, its Sharpe ratio is ${cmp(d.sharpe)} the ${tan} of ${tanName}.`,
      tag("verdict: left alone, the mix is the equal-weight mix, and it says so"), M.verdict(a, M.customView(a, {})));
    const u = T.custom.uneven;
    check(M.verdict(a, M.customView(a, byTicker(a, u.raw))) === `Its Sharpe ratio is ${cmp(u.perf.sharpe)} the ${tan} of ${tanName}.`,
      tag("verdict: uneven weights"), M.verdict(a, M.customView(a, byTicker(a, u.raw))));
    // The custom line's growth, now on Performance's growth card (its mixes view): its end is the app's (1832).
    const wd = overviewWealth(a, M.customWeights(M.customView(a, byTicker(a, u.raw))));
    const plot = wealthPlot({ status: "ready", value: wd }, o.w0);
    const mine = plot.value.lines.find((l) => l.role === "custom");
    const wantEnd = o.w0 * portfolioReturns(a.returns, M.customView(a, byTicker(a, u.raw)).custom.w).reduce((g, r) => g * (1 + r), 1);
    near(tag("growth: the mix's line on Performance ends where its own returns compound to"), mine?.end ?? NaN, wantEnd, 1e-10);
    near(tag("growth: at 1/n the mix's end is the app's equal-weight end (1832), the line Performance draws for it"),
      wealthPlot({ status: "ready", value: overviewWealth(a, a.ew) }, o.w0).value.lines.find((l) => l.role === "ew").end, T.wealth.ew.v.at(-1), 1e-10);
  }
}
{
  const failed = fixtureAnalysis("cross", { allowShort: true, rf: 5 });
  check(failed.tangency === null, "setup: at a 500% rate the shorting tangency solve has no answer");
  check(M.verdict(failed, M.customView(failed, {})) === `The tangency solve failed, so there is no ${tanName} Sharpe ratio to set the mix's against.`,
    "verdict: a failed tangency is named, not compared", M.verdict(failed, M.customView(failed, {})));
  const long = fixtureAnalysis("cross");
  const tan = M.customView(long, byTicker(long, long.tangency.w));
  check(M.verdict(long, tan) === `Its Sharpe ratio is level with the ${n3(long.tangency.sharpe)} of ${tanName}.`, "verdict: the tangency weights tie the tangency", M.verdict(long, tan));
  check(!/\d+\.\d+%/.test(M.verdict(long, M.customView(long, byTicker(long, [0.4, 0.1])))),
    "verdict: no return or volatility, which the plates beside it print");
  check(M.platesNote(long).includes("rebalanced daily") && M.platesNote(long).includes(`at the ${pct(long.rf)} risk-free rate`) &&
    M.platesNote(long).includes(`from ${long.dates[0]} to ${long.asOf}`), "plates note: the span, the rate, and daily rebalancing", M.platesNote(long));
}

// The merge, figure by figure: the two growth charts this chapter drew (Optimization's of the three portfolios and
// the benchmark, the Custom tab's with the mix) printed each line's ending value, and Performance's growth card
// (its mixes view) carries every one in its table, at the same dollar, for an equal split, an uneven mix and a
// refused one, long-only and shorting.
for (const set of ["cross", "megacap"]) {
  for (const mode of ["long", "short"]) {
    const a = fixtureAnalysis(set, { allowShort: mode === "short" });
    for (const [name, w] of [["1/n", {}], ["uneven", byTicker(a, [0.5, 0.1, 0.4])], ["refused", byTicker(a, Array(a.tickers.length).fill(0))]]) {
      const c = OPT.customWeights(a, w);
      const custom = c.ok ? c.w : null;
      const perf = wealthPlot({ status: "ready", value: overviewWealth(a, custom) }, 10000).value.lines.map((l) => usd(l.end));
      const old = OPT.wealthEnds(a, custom, 10000).map((e) => usd(e.end));
      const missing = old.filter((x) => !perf.includes(x));
      check(old.length >= 4 && missing.length === 0, `merge ${set} ${mode} ${name}: every ending value the deleted growth charts printed is in Performance's mixes table`,
        `missing ${missing.join(", ")} of ${old.join(", ")}`);
    }
  }
}

// ---- (d) the panel rendered, in its chapter ------------------------------------------------------------------
// jsdom lays nothing out; give boxes a size, as a browser would, so the frontier draws.
const rect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 360, width: 720, height: 360, toJSON() {} };
};
const mixOf = (root) => root.querySelector(".build-mix");
const frontierCard = (root) => root.querySelector("#build-frontier");
const chartLabels = (el) => [...(el?.querySelectorAll(".direct-label text") ?? [])].map((t) => t.textContent);
// The normalized weights table, inside the panel's Show the numbers.
const tables = (root) => [...(mixOf(root)?.querySelectorAll(".tbl") ?? [])];
const buttons = (tb) => [...tb.querySelectorAll(".tbl-dl button")].map((b) => b.textContent);
const plates = (root) => [...(mixOf(root)?.querySelectorAll(".cust-plates .plate") ?? [])].map((p) => ({
  label: p.querySelector(".plate-label span")?.textContent,
  value: p.querySelector(".plate-value")?.textContent,
  mark: !!p.querySelector(".tip-mark, .tip-text"),
}));
const rows = (root) => [...root.querySelectorAll(".cust-row")];
const field = (row) => row.querySelector('input[type="number"]');
const slider = (row) => row.querySelector('input[type="range"]');
const fold = (card, label) => {
  const b = [...(card?.querySelectorAll(".card-fold-button") ?? [])].find((x) => x.textContent === label);
  if (b && b.getAttribute("aria-expanded") === "false") act(() => b.click());
  return card?.querySelector(`[data-fold=${label === "Show the numbers" ? "numbers" : "how"}]`);
};
const setValue = (el, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
const clean = (s) => !/NaN|undefined|Infinity|null|\[object/.test(s);
const verdictOf = (root) => mixOf(root)?.querySelector(".card-sub")?.textContent;
const quietRender = (el) => quietly(() => render(el));

// A chapter that holds its own weights, as useWorkbench does, so typing reaches the page.
let latest = null;
function Harness({ a, init = {}, level = "plain" }) {
  const [w, setW] = useState(init);
  latest = w;
  return h(Optimization, tabProps(a, { weights: w, setWeights: setW, level }));
}

{
  const o = oracle("cross");
  const a = fixtureAnalysis("cross");
  const r = quietRender(h(Harness, { a }));
  const root = r.container;
  const mix = () => mixOf(root);
  const t = () => text(mix());
  const v0 = M.customView(a, {});
  check(mix()?.id === MIX_ANCHOR && MIX_ANCHOR === sectionId("custom") && mix().getAttribute("tabindex") === "-1",
    "anchor: the panel is the part an older ?tab=custom link lands on (App's sectionId), and takes focus there");
  check(mix().querySelector(".card-title")?.textContent === MIX_TITLE && MIX_TITLE === "Your mix (Custom)", "panel: titled by its plain name, the scorecard's beside it");
  check(verdictOf(root) === M.verdict(a, v0), "panel: the sub-line is the verdict", verdictOf(root));
  check(t().includes("Weight total: 1.00.") && t().includes("Drag or type a weight for each asset, from 0 to 1; every figure follows."),
    "panel: what to do, in one line, and the total line (1729)", t().slice(0, 200));
  check(clean(text(root)), "page: no NaN, undefined, Infinity or null in the text", text(root).match(/.{30}(NaN|undefined|Infinity|null).{30}/)?.[0]);

  // The editor: one row per ticker, in the entered order, at 1/n, bounded [0, 1] long-only.
  const rs = rows(root);
  check(rs.length === 5 && rs.map((x) => x.querySelector(".cust-ticker").textContent).join() === a.tickers.join(), "editor: one row per ticker, in the entered order");
  check(rs.every((x) => field(x).value === "0.2" && field(x).min === "0" && field(x).max === "1" && slider(x).min === "0" && slider(x).step === "0.01"),
    "editor: a slider AND a typed field per asset, every one at 1/n, from 0 to 1 on the app's 0.01 grid (1719-1720)");
  check(!root.querySelector(".cust-reset"), "editor: nothing to reset while every weight is at 1/n");

  // The plates, the app's labels and numbers (1745-1749), no info mark on any.
  const d = o.modes.long.custom.default.perf;
  const ps = plates(root);
  const mdd = maxDrawdown(portfolioReturns(a.returns, a.ew), true);
  check(ps.map((p) => p.label).join() === "Return,Volatility,Sharpe,Sortino,Max DD" &&
    ps.map((p) => p.value).join() === [pct(d.mu), pct(d.sigma), n3(d.sharpe), n3(d.sortino), pct(mdd)].join(),
    "plates: the app's five figures, the port's Max DD from the amount invested", ps.map((p) => `${p.label} ${p.value}`).join(" | "));
  check(ps.every((p) => !p.mark) && !mix().querySelector("button.tip-mark"), "plates: no info mark on the panel");
  // Their texts, all three levels at once, under How it is calculated (HowTips), word for word.
  const how = fold(mix(), "How it is calculated");
  const tips = [...(how?.querySelectorAll(".how-tip") ?? [])];
  check(tips.map((x) => x.getAttribute("data-tip")).join() === "return,volatility,sharpe,sortino,max_dd" &&
    tips.every((x) => ["plain", "finance", "formula"].every((l) => text(x.querySelector(`[data-level=${l}]`)).endsWith(tipText(x.getAttribute("data-tip"), l)))),
    "plates: each figure's former info mark prints its three texts under How it is calculated, the app's words");

  // The frontier beside it, labelled in the chart, the mix's distance as its sub-line.
  const fr = frontierCard(root);
  check(fr && fr.querySelector(".card-title")?.textContent === OPT.frontierTitle(a) && fr.querySelector(".card-sub")?.textContent === M.frontierTitle(a, v0),
    "frontier: titled where Tangency and GMV sit, and its sub-line is how far the mix sits from it", fr?.querySelector(".card-sub")?.textContent);
  const fl = chartLabels(fr);
  check([...a.tickers, a.benchLabel, "GMV", "Tangency", "Equal-Weight", "Custom"].every((n) => fl.includes(n)) && !fr.querySelector(".recharts-legend-wrapper"),
    "frontier: every asset, the benchmark and the four portfolios named on the chart, no legend", fl.join());
  check(fr.querySelectorAll(".frontier-line .recharts-scatter-symbol").length === a.frontier.length && a.frontier.length === 80,
    "frontier: one curve, Build's 80 targets; the app's second 60-point curve is not drawn again");
  check(!root.querySelector(".amount-field") && !root.querySelector(".cust-section"), "chapter: no growth chart of the mix here; Performance draws it");

  // The one table, with both downloads, under Show the numbers.
  check(tables(root).length === 0, "table: nothing drawn until Show the numbers is opened");
  fold(mix(), "Show the numbers");
  const tb = tables(root);
  check(tb.length === 1 && tb[0].querySelector("caption .tbl-title")?.textContent === "Normalized Weights" && buttons(tb[0]).join() === "Download CSV,Download Excel",
    "table: Normalized Weights, with CSV and Excel downloads", tb.map((x) => x.querySelector("caption")?.textContent).join());
  const cells = [...tb[0].querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent));
  check(cells.length === 5 && cells.every((c, i) => c[0] === a.tickers[i] && c[1] === "0.20" && c[2] === "20.00%"),
    "table: a row per ticker, entered 0.20, normalised 20.00% (1734-1737)", JSON.stringify(cells[0]));

  // Typing a weight: stored held to the bounds, and the panel and the frontier follow, live.
  const markAt = () => {
    const g = fr.querySelector(".frontier-mark--custom .recharts-scatter-symbol, .frontier-mark--custom path");
    return g ? g.outerHTML : "";
  };
  const before = markAt();
  setValue(field(rows(root)[0]), "0.5");
  check(latest.VTI === 0.5 && Object.keys(latest).join() === "VTI", "typing: 0.5 for VTI is stored for VTI alone", JSON.stringify(latest));
  const v1 = M.customView(a, { VTI: 0.5 });
  check(verdictOf(root) === M.verdict(a, v1) && verdictOf(root).startsWith("Its Sharpe ratio is "), "typing: the verdict follows the new weights", verdictOf(root));
  check(t().includes("Weight total: 1.30.") && [...tables(root)[0].querySelectorAll("tbody tr")][0].children[2].textContent === pct(0.5 / 1.3),
    "typing: the total and the normalised weight follow", t().match(/Weight total: [^.]+\.\d+/)?.[0]);
  check(plates(root)[2].value === n3(portfolioPerformance(v1.custom.w, a.m, a.S, a.rf).sharpe), "typing: the plates follow");
  check(frontierCard(root).querySelector(".card-sub")?.textContent === M.frontierTitle(a, v1) && markAt() !== before && markAt() !== "",
    "typing: the frontier's sub-line and the mix's point move with it, in the same render", frontierCard(root).querySelector(".card-sub")?.textContent);
  setValue(field(rows(root)[1]), "1.5");
  check(latest.AGG === 1 && latest.VTI === 0.5, "typing: 1.5 is held to the top of the range, 1, and VTI's entry stays", JSON.stringify(latest));
  setValue(field(rows(root)[2]), "-0.3");
  check(latest.GLD === 0, "typing: long-only, a negative weight is held to 0", JSON.stringify(latest));
  const was = JSON.stringify(latest);
  setValue(field(rows(root)[3]), "");
  check(JSON.stringify(latest) === was, "typing: an empty field stores nothing");
  setValue(slider(rows(root)[4]), "0.35");
  check(latest.EFA === 0.35, "dragging: the slider stores its value", JSON.stringify(latest));
  const reset = root.querySelector(".cust-reset");
  check(!!reset && text(reset) === "Reset to equal weights", "reset: offered once a weight is set");
  if (reset) act(() => reset.click());
  check(Object.keys(latest).length === 0 && verdictOf(root) === M.verdict(a, v0), "reset: every weight back to 1/n, and the verdict with them");

  // The level reaches the formula line under the panel's figures; nothing on the panel hides a level.
  r.rerender(h(Harness, { a, level: "formula" }));
  const line = mix().querySelector(".formula-line");
  check(!!line && /at the tangency weights, in-sample: \d\.\d{3}$/.test(text(line.querySelector(".formula-line-symbols") ?? line)),
    "level: at Formula the panel's line sets the mix's Sharpe ratio beside the tangency's", line ? text(line) : "none");
  r.unmount();
}

{
  // megacap: seven assets, the editor and the table carry every one.
  const a = fixtureAnalysis("megacap");
  const r = quietRender(h(Optimization, tabProps(a)));
  fold(mixOf(r.container), "Show the numbers");
  check(rows(r.container).length === 7 && rows(r.container).every((x) => field(x).value === "0.1429") &&
    tables(r.container)[0]?.querySelectorAll("tbody tr").length === 7 && clean(text(mixOf(r.container))),
    "megacap: seven rows at 1/7, seven table rows, no NaN");
  r.unmount();
}

{
  // Max DD from the amount invested (the engine's default), on a book whose worst fall starts on day
  // one: 10% down, then up. The app's path starts after that day and sees no drawdown at all (904-908).
  const cols = [[-0.1, 0.05, 0.01], [-0.1, 0.03, 0.02]];
  const syn = { returns: cols, m: cols.map((c) => c.reduce((x, y) => x + y) / 3), S: [[1e-3, 5e-4], [5e-4, 1e-3]], rf: 0 };
  near("Max DD: a 10% fall on day one counts in the port's figure", M.customMetrics(syn, [0.5, 0.5]).mdd, -0.1, 1e-12);
  near("Max DD: the app's path, starting a day in, reports none", summaryRow(cols, [0.5, 0.5], syn.m, syn.S, 0, false).mdd, 0, 0, 1e-15);
}

// ---- ledger ----------------------------------------------------------------------------------------------
// ledger:custom-normalisation, the page. The app plots the tiny-total book at 1732; the port builds none
// and says so, with no blown-up weight anywhere on the page.
{
  const o = oracle("cross");
  const a = fixtureAnalysis("cross", { allowShort: true });
  for (const k of ["tinyTotal", "negTotal"]) {
    const c = o.modes.short.custom[k];
    const r = quietRender(h(Optimization, tabProps(a, { weights: byTicker(a, c.raw) })));
    openAll(r);
    const t = text(r.container);
    const v = M.customView(a, byTicker(a, c.raw));
    const blown = c.w.map(pct).filter((s) => s !== "0.00%");
    check(t.includes(v.refusal.detail) && mixOf(r.container).querySelector('.cust-note--error[role="alert"]')?.textContent === v.refusal.detail,
      `ledger:custom-normalisation: ${k}: the port states the refusal literally`, t.slice(0, 200));
    // Where the mix is shown (the panel, the frontier): the equal-weight column elsewhere on the chapter rightly
    // prints 20.00% for five assets, which is not the mix.
    const mine = `${text(mixOf(r.container))} ${text(frontierCard(r.container))}`;
    check(blown.every((s) => !mine.includes(s)) && !chartLabels(frontierCard(r.container)).includes("Custom"),
      `ledger:custom-normalisation: ${k}: none of the app's weights (${blown.join(", ")}) where the mix is shown, and no Custom point on the frontier`);
    check(tables(r.container).length === 0 && t.includes(`No normalized weights: ${v.refusal.short}.`) &&
      plates(r.container).every((p) => p.value === "–") && clean(text(mixOf(r.container))),
      `ledger:custom-normalisation: ${k}: no weights table, dashes in the plates, each saying why`);
    r.unmount();
  }
}

// ledger:boundary, the panel's half. The app: all-zero sliders call st.stop() at 1727, so nothing after it
// in tab 5 is drawn and tab 6 is never built. The port: one refusal, the frontier still drawn; and a card
// that throws is replaced by one line naming it while the rest of the chapter renders.
{
  check(/if raw_total == 0:\n\s+st\.warning\("All weights are zero\. Adjust at least one slider\."\)\n\s+st\.stop\(\)/.test(lines(1725, 1727)),
    "ledger:boundary: the app's tab 5 stops the whole script on all-zero weights (1725-1727)");
  const a = fixtureAnalysis("cross");
  const r = quietRender(h(Optimization, tabProps(a, { weights: byTicker(a, []) })));
  check(verdictOf(r.container) === "No custom portfolio: every weight is zero." &&
    frontierCard(r.container)?.querySelector("svg.recharts-surface") && rows(r.container).length === 5,
    "ledger:boundary: the port names the refusal and keeps the editor and the frontier");
  r.unmount();
  // A frontier that throws: its card is one line, and the panel beside it keeps its sliders, figures and table.
  const broken = Object.create(a);
  Object.defineProperty(broken, "frontier", { get() { throw new Error("no frontier"); } });
  const b = quietly(() => expectUncaught(() => render(h(Optimization, tabProps(broken)))));
  fold(mixOf(b.container), "Show the numbers");
  const bt = text(b.container);
  check(bt.includes("Efficient frontier could not be shown.") && !frontierCard(b.container) &&
    plates(b.container).length === 5 && tables(b.container).length === 1 && rows(b.container).length === 5 && !!verdictOf(b.container),
    "ledger:boundary: a frontier that throws leaves one line naming it; the verdict, editor, plates and table remain", bt.slice(0, 300));
  b.unmount();
}

// ledger:failed-tangency, the panel's half. The app falls back to the equal weights for a missing tangency
// (1759), reached only because tab 4 stops the script first (1494-1502). The port draws no tangency.
{
  check(/tan_w2 = st\.session_state\.get\("tan_w", ew_weights\)/.test(lines(1759, 1759)),
    "ledger:failed-tangency: the app's tab 5 would plot equal weights as Tangency (1759)");
  const a = fixtureAnalysis("cross", { allowShort: true, rf: 5 });
  const r = quietRender(h(Optimization, tabProps(a)));
  const fr = frontierCard(r.container);
  check(verdictOf(r.container)?.startsWith("The tangency solve failed") && text(fold(fr, "How it is calculated")).includes("Tangency failed"),
    "ledger:failed-tangency: the port's verdict and frontier caption say the tangency solve failed");
  check(!chartLabels(fr).includes("Tangency") && clean(text(mixOf(r.container))), "ledger:failed-tangency: no Tangency point, and no stand-in", chartLabels(fr).join());
  r.unmount();
}

// ledger:rf-live, the panel's half. The app scores tab 5 at the rate frozen at Run (1087, read back at
// 1158); the port's figures are the analysis's, which the page rebuilds when the rate is edited.
{
  check(/st\.session_state\.rf = rf_annual/.test(lines(1087, 1087)) && /^rf = st\.session_state\.rf$/.test(ORACLE[1157]),
    "ledger:rf-live: the app freezes rf in session state at Run (1087) and every tab reads it back (1158)");
  const at5 = fixtureAnalysis("cross", { rf: 0.05 });
  const base = fixtureAnalysis("cross");
  // Each render is read and unmounted at once, so no chapter is left mounted for its after-paint work to land
  // outside the test.
  const once = (a, read) => {
    const r = quietRender(h(Optimization, tabProps(a)));
    try {
      return read(r.container);
    } finally {
      r.unmount();
    }
  };
  const sharpe = (a) => once(a, (c) => plates(c)[2].value);
  const s5 = n3(portfolioPerformance(at5.ew, at5.m, at5.S, 0.05).sharpe);
  check(sharpe(at5) === s5 && s5 !== sharpe(base) && once(at5, (c) => text(mixOf(c)).includes("at the 5.00% risk-free rate")),
    "ledger:rf-live: the Sharpe plate and its note follow the analysis's rate", `${sharpe(at5)} vs ${s5}`);
}

// ledger:numeric-downloads and ledger:downloads-everywhere, the panel's halves. The app: its one table holds
// "{:.2%}" strings (1736) and has no download at all (no download_button anywhere in 1708-1837). The
// port: CSV and Excel, of raw numbers.
{
  check(/nw_df\["Weight"\] = nw_df\["Weight"\]\.map\("\{:\.2%\}"\.format\)/.test(lines(1736, 1736)),
    "ledger:numeric-downloads: the app's weights table holds formatted strings (1736)");
  check(!/download_button/.test(TAB5), "ledger:downloads-everywhere: the app's tab 5 offers no download (1708-1837)");
  const a = fixtureAnalysis("cross");
  const v = M.customView(a, byTicker(a, [0.1, 0.33, 0.55, 0.78, 1]));
  const st = M.weightTable(v);
  const csv = csvText(M.WEIGHT_COLUMNS, st.value).trim().split(/\r?\n/).map((l) => l.split(","));
  check(csv[0].join() === "Ticker,Entered,Normalized weight" && csv.slice(1).every((c, i) => c[0] === a.tickers[i] && Number(c[1]) === v.raw[i] && Number(c[2]) === v.custom.w[i]),
    "ledger:numeric-downloads: the port's CSV carries the raw numbers, full precision", csv[1]?.join());
  check(st.value.every((row) => typeof row.entered === "number" && typeof row.weight === "number"), "ledger:numeric-downloads: the rows hold numbers, never strings");
  const r = quietRender(h(Optimization, tabProps(a, { weights: byTicker(a, v.raw) })));
  fold(mixOf(r.container), "Show the numbers");
  check(tables(r.container).length === 1 && buttons(tables(r.container)[0]).join() === "Download CSV,Download Excel" && !tables(r.container)[0].querySelector(".tbl-span"),
    "ledger:downloads-everywhere: the port's weights table downloads as CSV and Excel, and, typed weights, claims no span");
  r.unmount();
}

// ledger:daily-rebalanced-label, the panel's half. The app's tab 5 scores and plots R @ w (1740, 1825-1831),
// fixed weights applied every day, and never says so.
{
  check(/cust_port_ret = stock_returns @ custom_w/.test(lines(1740, 1740)) && /"Custom": cust_port_ret/.test(lines(1825, 1831)) && !/rebalanc/i.test(TAB5),
    "ledger:daily-rebalanced-label: the app's tab 5 applies fixed weights every day (1740, 1829) and never says so");
  const a = fixtureAnalysis("cross");
  const r = quietRender(h(Optimization, tabProps(a)));
  check(mixOf(r.container).querySelector(".cust-plates + .cust-note")?.textContent.includes("held fixed and rebalanced daily") &&
    /rebalanced daily to the target weights/.test(wealthCaption(10000, a.dates[0], a.asOf)),
    "ledger:daily-rebalanced-label: the port's figures say rebalanced daily, and so does the growth chart that carries the mix (Performance)");
  r.unmount();
}

// ledger:short-bounds-copy, the panel's half. The app's toggle help calls the shorting frontier
// "unconstrained" (750); the port's panel states the [-1, 1] bounds and never says unconstrained.
{
  check(/unconstrained frontier/.test(ORACLE[750]) && /slider_min = -1\.0 if allow_short else 0\.0/.test(ORACLE[1718]),
    "ledger:short-bounds-copy: the app calls the shorting frontier unconstrained (750-751) while its sliders stop at -1 (1719)");
  const a = fixtureAnalysis("cross", { allowShort: true });
  const r = quietRender(h(Optimization, tabProps(a)));
  const t = text(mixOf(r.container));
  const fr = text(fold(frontierCard(r.container), "How it is calculated"));
  check(fr.includes(`[${MINUS}1, 1]`) && t.includes(`from ${MINUS}1 to 1 (shorting is on)`) && !/unconstrained/i.test(text(r.container)) &&
    rows(r.container).every((x) => field(x).min === "-1" && slider(x).min === "-1"),
    "ledger:short-bounds-copy: with shorting on, the port's editor and frontier caption state [-1, 1]", t.match(/Drag or type.{60}/)?.[0]);
  r.unmount();
  const l = quietRender(h(Optimization, tabProps(fixtureAnalysis("cross"))));
  check(!/\[−1, 1\]|shorting is on/.test(text(mixOf(l.container))), "ledger:short-bounds-copy: long-only, nothing about shorting bounds on the panel");
  l.unmount();
}

// ledger:frontier-hover, the panel's half. The app asks its tab-5 frontier for "closest" (1816) and
// style_chart at 1818 overrides it with x unified. The port's mix is a point on the shared frontier, a
// ScatterChart whose tooltip is the closest point.
{
  check(/hovermode="closest"/.test(ORACLE[1815]) && /style_chart\(fig_ef2, height=520\)/.test(ORACLE[1817]),
    "ledger:frontier-hover: the app's tab-5 frontier asks for closest, then style_chart overrides it (1816, 1818)");
  const a = fixtureAnalysis("cross");
  const r = quietRender(h(Optimization, tabProps(a)));
  const fr = frontierCard(r.container);
  check(FRONTIER_HOVER === "closest" && !!fr?.querySelector(".recharts-scatter") && !!fr?.querySelector(".frontier-mark--custom"),
    "ledger:frontier-hover: the port draws the mix on the shared closest-point frontier");
  r.unmount();
}

// The clamp note on the page.
{
  const a = fixtureAnalysis("cross");
  const r = quietRender(h(Optimization, tabProps(a, { weights: { VTI: -0.4 } })));
  const note = mixOf(r.container).querySelector(".cust-note--flag");
  check(note?.textContent === M.clampLine(M.customView(a, { VTI: -0.4 }), false) && field(rows(r.container)[0]).value === "-0.4",
    "clamp: the page shows the entered -0.4 and says it counts as 0", note?.textContent);
  // The weights table prints the entered -0.4 beside a normalized weight built from 0, so its note may not
  // say each row is its entry over the total; with nothing held to a bound it may.
  const tableNote = (c) => text(fold(mixOf(c), "Show the numbers")?.querySelector(".cust-table-note") ?? { textContent: "" });
  check(/counts at the nearest bound/.test(tableNote(r.container)) && !/is it divided by/.test(tableNote(r.container)),
    "clamp: the weights table's note says a weight outside the bounds counts at the nearest bound", tableNote(r.container));
  r.unmount();
  const plain = quietRender(h(Optimization, tabProps(a, { weights: { VTI: 0.4 } })));
  check(/the normalized weight is it divided by the weight total/.test(tableNote(plain.container)) && !/nearest bound/.test(tableNote(plain.container)),
    "clamp: with every weight inside the bounds the note says each is its entry over the total", tableNote(plain.container));
  plain.unmount();
}

// Every typed field is 16px on a phone: iOS Safari zooms the page when a smaller input takes focus and
// leaves it zoomed (src/chrome/Settings.css guards the settings the same way). Each text, number or date input
// and select the panel renders needs a 16px rule under Custom.css's 760px query.
{
  const css = readFileSync(new URL("../src/tabs/custom/Custom.css", import.meta.url), "utf8");
  const at = css.indexOf("@media (max-width: 760px)");
  let depth = 0;
  let end = at;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const phone = css.slice(css.indexOf("{", at) + 1, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const sixteen = [...phone.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /font-size:\s*16px/.test(m[2])).flatMap((m) => m[1].split(",").map((x) => x.trim()));
  const r = quietRender(h(Optimization, tabProps(fixtureAnalysis("cross"))));
  const typed = [...mixOf(r.container).querySelectorAll("input, select, textarea")].filter((el) => !["range", "checkbox", "radio"].includes(el.type));
  const missing = typed.filter((el) => ![...el.classList].some((k) => sixteen.includes(`.${k}`)));
  check(at >= 0 && typed.length === 5 && missing.length === 0,
    "phone: every weight field is 16px under the 760px query, so focusing one does not zoom the page", `${typed.length} fields; ${sixteen.join(" ")}`);
  r.unmount();
}

HTMLElement.prototype.getBoundingClientRect = rect;
done("t-build-mix");
