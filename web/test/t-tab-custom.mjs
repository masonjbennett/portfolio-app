// The Custom Portfolio tab (src/tabs/Custom.tsx, its arithmetic in src/tabs/custom/model.ts),
// portfolio_app.py 1708-1837.
//
// (a) The weights and the five figures against the oracle's dump for cross and megacap, long-only and
//     short: the default is exactly 1/n, the app's division reproduced, the port's weights and figures
//     equal to it wherever the port builds a book, and refused, in numbers, where the app flips or
//     blows one up (ledger:custom-normalisation, the tab's half).
// (b) The frontier: the app's 60 targets, and a title whose every figure is held to the app's frontier.
// (c) The sentences: the headline and the two chart titles, literal, from the oracle's numbers.
// (d) The tab rendered in jsdom: headline, weights, plates, both charts labelled in the chart, the one
//     table with both downloads, no NaN, the level switch, typing and dragging a weight, the reset.
// Ledger entries closed here (the tab's half of each): custom-normalisation, boundary, failed-tangency,
// rf-live, numeric-downloads, downloads-everywhere, daily-rebalanced-label, short-bounds-copy,
// frontier-hover. Each asserts the app's side, read out of portfolio_app.py or its dump, and the port's.
// Not applicable to this tab: excess-kurtosis, in-sample-label (these figures are the full sample's, and
// the weights are the reader's, not fitted), start-date-floor.
import { readFileSync } from "node:fs";
import { check, done, json, near, nearAll } from "./_assert.mjs";
import { act, render, text } from "./_dom.mjs";

const { createElement: h, useState } = await import("react");
const Custom = (await import("../src/tabs/Custom.tsx")).default;
const M = await import("../src/tabs/custom/model.ts");
const { summaryRow, portfolioPerformance, portfolioReturns } = await import("../src/lib/portfolio.ts");
const { maxDrawdown } = await import("../src/lib/stats.ts");
const { maxReturn } = await import("../src/lib/optimize.ts");
const { frontierData, FRONTIER_HOVER } = await import("../src/charts/Frontier.tsx");
const { wealthData } = await import("../src/charts/Wealth.tsx");
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
        check(M.headline(a, v) === `No custom portfolio: the weights add up to ${c.total < 0 ? `${total}, a net short` : `only ${total}`}.`,
          ck("the headline names the refusal"), M.headline(a, v));
      }
    }
  }
}

// The other refusals, and the clamp.
{
  const short = fixtureAnalysis("cross", { allowShort: true });
  const long = fixtureAnalysis("cross");
  const zero = M.customView(long, byTicker(long, []));
  check(!zero.custom.ok && zero.custom.reason === "zero" && M.headline(long, zero) === "No custom portfolio: every weight is zero." &&
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
for (const set of ["cross", "megacap"]) {
  const o = oracle(set);
  for (const mode of ["long", "short"]) {
    const tag = (s) => `${set} ${mode}: ${s}`;
    const a = fixtureAnalysis(set, { allowShort: mode === "short" });
    const pts = M.customFrontier(a);
    check(pts.length === 60 && pts[0].target === a.gmv.mu && pts[59].target === maxReturn(a.m, a.allowShort).mu && pts.every((p) => p.feasible),
      tag("the tab's frontier: the app's 60 targets (1756), GMV return to the highest the bounds allow, every one solved"));
    const v = M.customView(a, {});
    const d = frontierData(a, M.customWeights(v), pts);
    const cm = d.marks.find((m) => m.role === "custom");
    const c = o.modes[mode].custom.default;
    check(d.points === pts && !!cm && close2(cm.mu, c.perf.mu) && close2(cm.sigma, c.perf.sigma), tag("the Custom mark is the app's custom point (1795-1798)"));

    // The title quotes the frontier's volatility at the custom mix's return. Held to the app's own
    // 60-point frontier: between the two targets that bracket that return, the curve rises, so the
    // quoted figure lies between their volatilities (to the rounding of a printed percent).
    const title = M.frontierTitle(a, v);
    const m = /^The frontier reaches the custom mix's (.+) return at (.+) volatility, against the mix's (.+)$/.exec(title);
    check(!!m && m[1] === pct(c.perf.mu) && m[3] === pct(c.perf.sigma), tag("frontier title: the custom mix's return and volatility, the app's"), title);
    if (m) {
      const F = o.modes[mode].frontier60;
      const kept = F.kept.map((i) => ({ t: F.targets[i], s: F.sigma[i] }));
      const k = kept.findIndex((p) => p.t > c.perf.mu);
      const quoted = Number(m[2].replace(MINUS, "-").replace("%", "")) / 100;
      check(k > 0 && quoted >= kept[k - 1].s - 5e-5 && quoted <= kept[k].s + 5e-5 && quoted < c.perf.sigma,
        tag("frontier title: the quoted frontier volatility sits on the app's frontier at that return, left of the mix"),
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
    "frontier title: all in AGG sits below the GMV return, and the GMV portfolio beats it on both counts", M.frontierTitle(long, agg));
  const onIt = M.customView(long, byTicker(long, long.tangency.w));
  check(M.frontierTitle(long, onIt) === `The custom mix sits on the frontier: no long-only mix returns ${pct(T.perf.tan.mu)} a year with less than its ${pct(T.perf.tan.sigma)} volatility`,
    "frontier title: the tangency weights sit on the frontier", M.frontierTitle(long, onIt));
  const short = fixtureAnalysis("cross", { allowShort: true });
  check(M.frontierTitle(short, M.customView(short, byTicker(short, short.tangency.w))).includes(`no mix with weights inside [${MINUS}1, 1] returns`),
    "frontier title: with shorting on, it names the bounds");
  check(M.frontierTitle(short, M.customView(short, byTicker(short, [-0.2, -0.2]))) === "The frontier with no custom portfolio on it: the weights above were refused",
    "frontier title: refused weights say so");
}

// ---- (c) the headline and the wealth title -------------------------------------------------------------
const hindsightSeen = [];
for (const set of ["cross", "megacap"]) {
  const o = oracle(set);
  for (const mode of ["long", "short"]) {
    const tag = (s) => `${set} ${mode}: ${s}`;
    const a = fixtureAnalysis(set, { allowShort: mode === "short" });
    const T = o.modes[mode];
    const tan = n3(-T.tight.tan.fun); // the app's tangency Sharpe, from its ftol-1e-15 re-run
    check(n3(a.tangency.sharpe) === tan, tag("the port's tangency Sharpe prints as the app's"), `${a.tangency.sharpe} vs ${-T.tight.tan.fun}`);
    const d = T.custom.default.perf;
    check(M.headline(a, M.customView(a, {})) ===
      `At equal weights, the custom mix returns ${pct(d.mu)} a year at ${pct(d.sigma)} volatility, a Sharpe ratio of ${n3(d.sharpe)}, below the tangency portfolio's ${tan}.`,
      tag("headline: left alone, the custom mix is the equal-weight mix, and it says so"), M.headline(a, M.customView(a, {})));
    const u = T.custom.uneven;
    check(M.headline(a, M.customView(a, byTicker(a, u.raw))) ===
      `The custom mix returns ${pct(u.perf.mu)} a year at ${pct(u.perf.sigma)} volatility, a Sharpe ratio of ${n3(u.perf.sharpe)}, below the tangency portfolio's ${tan}.`,
      tag("headline: uneven weights"), M.headline(a, M.customView(a, byTicker(a, u.raw))));
    // The wealth title: the custom mix's end against the highest line. Default custom = equal weights.
    const wd = wealthData(a, M.customWeights(M.customView(a, {})));
    const ends = M.wealthEnds(wd, o.w0);
    near(tag("wealth: the custom end is the app's equal-weight end (1832)"), ends.find((e) => e.role === "custom").end, T.wealth.ew.v.at(-1), 1e-10);
    near(tag("wealth: the tangency end, within the app's SLSQP noise"), ends.find((e) => e.role === "tangency").end, T.wealth.tan.v.at(-1), 5e-3);
    check(T.wealth.ew.i.at(-1) === o.returns.rows - 1, tag("wealth: the dump's last sample is the last day"));
    const top = ends.filter((e) => e.role !== "custom").reduce((b, e) => (e.end > b.end ? e : b));
    const hind = top.role === "gmv" || top.role === "tangency" ? " with hindsight weights" : "";
    check(M.wealthTitle(wd, o.w0, true) === `${usd(o.w0)} in the custom mix ended at ${usd(T.wealth.ew.v.at(-1))} on ${o.clean.last}; ${top.label} ended highest, at ${usd(top.end)}${hind}`,
      tag("wealth title: where the custom mix ended, against the highest line"), M.wealthTitle(wd, o.w0, true));
    // D1's words on this tab as on Optimization: a GMV or tangency line that ends highest had its weights
    // picked from the same prices, and the title says so.
    hindsightSeen.push(top.role);
    check(M.wealthTitle(wd, o.w0, true).endsWith(" with hindsight weights") === (top.role === "gmv" || top.role === "tangency"),
      tag("wealth title: 'with hindsight weights' exactly when GMV or tangency ended highest"), `${top.role}: ${M.wealthTitle(wd, o.w0, true)}`);
  }
}
check(hindsightSeen.some((r) => r === "gmv" || r === "tangency"),
  "wealth title: the fixtures reach a hindsight line ending highest, so the check above is not vacuous", hindsightSeen.join(","));
{
  const failed = fixtureAnalysis("cross", { allowShort: true, rf: 5 });
  check(failed.tangency === null, "setup: at a 500% rate the shorting tangency solve has no answer");
  check(/, a Sharpe ratio of −?\d+\.\d{3}; the tangency solve failed, so there is no tangency Sharpe ratio to set it against\.$/.test(M.headline(failed, M.customView(failed, {}))),
    "headline: a failed tangency is named, not compared", M.headline(failed, M.customView(failed, {})));
  const long = fixtureAnalysis("cross");
  const tan = M.customView(long, byTicker(long, long.tangency.w));
  check(M.headline(long, tan).endsWith(`, level with the tangency portfolio's ${n3(long.tangency.sharpe)}.`), "headline: the tangency weights tie the tangency", M.headline(long, tan));
  const d = wealthData(long, tan.custom.w);
  check(M.wealthTitle(d, 10000, true).endsWith(", the same as Tangency"), "wealth title: a tie at the printed dollar is called the same", M.wealthTitle(d, 10000, true));
  check(M.wealthTitle(wealthData(long, null), 10000, false) === "Growth of $10,000 with no custom portfolio: the weights above were refused", "wealth title: refused weights say so");
  const best = byTicker(long, [0, 0, 1]); // all gold, which beat everything in this sample
  const bd = wealthData(long, M.customWeights(M.customView(long, best)));
  const e = M.wealthEnds(bd, 10000);
  if (e.find((x) => x.role === "custom").end > Math.max(...e.filter((x) => x.role !== "custom").map((x) => x.end))) {
    check(M.wealthTitle(bd, 10000, true).endsWith(", more than any other line here"), "wealth title: a custom mix that ends highest says so");
  } else {
    check(!M.wealthTitle(bd, 10000, true).includes("more than any other"), "wealth title: a custom mix that does not end highest never claims to");
  }
  check(M.platesNote(long).includes("rebalanced daily") && M.platesNote(long).includes(`at the ${pct(long.rf)} risk-free rate`) &&
    M.platesNote(long).includes(`from ${long.dates[0]} to ${long.asOf}`), "plates note: the span, the rate, and daily rebalancing", M.platesNote(long));
}

// ---- (d) the tab rendered ----------------------------------------------------------------------------
const figures = (root) => [...root.querySelectorAll("figure.chart-frame")];
const titleOf = (fig) => fig?.querySelector(".chart-title")?.textContent ?? "";
const chartLabels = (fig) => [...(fig?.querySelectorAll(".direct-label text") ?? [])].map((t) => t.textContent);
const tables = (root) => [...root.querySelectorAll(".tbl")];
const buttons = (tb) => [...tb.querySelectorAll(".tbl-dl button")].map((b) => b.textContent);
const plates = (root) => [...root.querySelectorAll(".cust-plates .plate")].map((p) => ({
  label: p.querySelector(".plate-label span")?.textContent,
  value: p.querySelector(".plate-value")?.textContent,
  tip: p.querySelector(".tip-text")?.textContent,
}));
const rows = (root) => [...root.querySelectorAll(".cust-row")];
const field = (row) => row.querySelector('input[type="number"]');
const slider = (row) => row.querySelector('input[type="range"]');
const setValue = (el, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
const clean = (s) => !/NaN|undefined|Infinity|null|\[object/.test(s);

// A tab that holds its own weights, as useWorkbench does, so typing reaches the page.
let latest = null;
function Harness({ a, init = {}, level = "plain" }) {
  const [w, setW] = useState(init);
  latest = w;
  return h(Custom, tabProps(a, { weights: w, setWeights: setW, level }));
}

{
  const o = oracle("cross");
  const a = fixtureAnalysis("cross");
  const r = render(h(Harness, { a }));
  const root = r.container;
  const t = () => text(root);
  const v0 = M.customView(a, {});
  check(root.querySelector(".cust-headline")?.textContent === M.headline(a, v0), "page: the headline is the model's sentence", root.querySelector(".cust-headline")?.textContent);
  check(t().includes("Custom Portfolio Builder") && t().includes("Weight total: 1.00."), "page: the app's heading (1709) and the total line (1729)");
  check(clean(t()), "page: no NaN, undefined, Infinity or null in the text", t().match(/.{30}(NaN|undefined|Infinity|null).{30}/)?.[0]);

  // The editor: one row per ticker, in the entered order, at 1/n, bounded [0, 1] long-only.
  const rs = rows(root);
  check(rs.length === 5 && rs.map((x) => x.querySelector(".cust-ticker").textContent).join() === a.tickers.join(), "editor: one row per ticker, in the entered order");
  check(rs.every((x) => field(x).value === "0.2" && field(x).min === "0" && field(x).max === "1" && slider(x).min === "0" && slider(x).step === "0.01"),
    "editor: every field at 1/n, from 0 to 1 on the app's 0.01 grid (1719-1720)");
  check(!root.querySelector(".cust-reset"), "editor: nothing to reset while every weight is at 1/n");

  // The plates, the app's labels and numbers (1745-1749), at the current level.
  const d = o.modes.long.custom.default.perf;
  const ps = plates(root);
  const mdd = maxDrawdown(portfolioReturns(a.returns, a.ew), true);
  check(ps.map((p) => p.label).join() === "Return,Volatility,Sharpe,Sortino,Max DD" &&
    ps.map((p) => p.value).join() === [pct(d.mu), pct(d.sigma), n3(d.sharpe), n3(d.sortino), pct(mdd)].join(),
    "plates: the app's five figures, the port's Max DD from the amount invested", ps.map((p) => `${p.label} ${p.value}`).join(" | "));
  check(ps.map((p) => p.tip).join("|") === ["return", "volatility", "sharpe", "sortino", "max_dd"].map((k) => tipText(k, "plain")).join("|"),
    "plates: each carries the app's tooltip at the current level");

  // The two charts, labelled in the chart.
  const [fr, we] = figures(root);
  check(figures(root).length === 2 && titleOf(fr) === M.frontierTitle(a, v0) && titleOf(we) === M.wealthTitle(wealthData(a, a.ew), 10000, true),
    "charts: the frontier and the wealth chart, each titled by its finding", figures(root).map(titleOf).join(" | "));
  const fl = chartLabels(fr);
  check([...a.tickers, a.benchLabel, "GMV", "Tangency", "Equal-Weight", "Custom"].every((n) => fl.includes(n)) && !fr.querySelector(".recharts-legend-wrapper"),
    "frontier: every asset, the benchmark and the four portfolios named on the chart, no legend", fl.join());
  check(fr.querySelectorAll(".frontier-line .recharts-scatter-symbol").length === 60 && a.frontier.length === 80,
    "frontier: the tab draws its own 60-point frontier (1756), not the Optimization tab's 80");
  const wl = chartLabels(we);
  check(["Equal-Weight", "GMV", "Tangency", "Custom", a.benchLabel].every((n) => wl.some((l) => l.startsWith(`${n} $`))), "wealth: each line named at its end", wl.join());

  // The one table, with both downloads.
  const tb = tables(root);
  check(tb.length === 1 && tb[0].querySelector("caption")?.textContent === "Normalized Weights" && buttons(tb[0]).join() === "Download CSV,Download Excel",
    "table: Normalized Weights, with CSV and Excel downloads", tb.map((x) => x.querySelector("caption")?.textContent).join());
  const cells = [...tb[0].querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent));
  check(cells.length === 5 && cells.every((c, i) => c[0] === a.tickers[i] && c[1] === "0.20" && c[2] === "20.00%"),
    "table: a row per ticker, entered 0.20, normalised 20.00% (1734-1737)", JSON.stringify(cells[0]));

  // The level switch changes the tooltip text.
  r.rerender(h(Harness, { a, level: "formula" }));
  const tipsF = plates(root).map((p) => p.tip);
  check(tipsF[2] === tipText("sharpe", "formula") && tipsF[2] !== tipText("sharpe", "plain"), "level: the Advanced switch changes the Sharpe tooltip", tipsF[2]);

  // Typing a weight: stored held to the bounds, and the page follows.
  setValue(field(rows(root)[0]), "0.5");
  check(latest.VTI === 0.5 && Object.keys(latest).join() === "VTI", "typing: 0.5 for VTI is stored for VTI alone", JSON.stringify(latest));
  const v1 = M.customView(a, { VTI: 0.5 });
  check(root.querySelector(".cust-headline").textContent === M.headline(a, v1) && M.headline(a, v1).startsWith("The custom mix returns"),
    "typing: the headline follows the new weights", root.querySelector(".cust-headline").textContent);
  check(t().includes("Weight total: 1.30.") && [...tables(root)[0].querySelectorAll("tbody tr")][0].children[2].textContent === pct(0.5 / 1.3),
    "typing: the total and the normalised weight follow", t().match(/Weight total: [^.]+\.\d+/)?.[0]);
  check(plates(root)[2].value === n3(portfolioPerformance(v1.custom.w, a.m, a.S, a.rf).sharpe), "typing: the plates follow");
  setValue(field(rows(root)[1]), "1.5");
  check(latest.AGG === 1 && latest.VTI === 0.5, "typing: 1.5 is held to the top of the range, 1, and VTI's entry stays", JSON.stringify(latest));
  setValue(field(rows(root)[2]), "-0.3");
  check(latest.GLD === 0, "typing: long-only, a negative weight is held to 0", JSON.stringify(latest));
  const before = JSON.stringify(latest);
  setValue(field(rows(root)[3]), "");
  check(JSON.stringify(latest) === before, "typing: an empty field stores nothing");
  setValue(slider(rows(root)[4]), "0.35");
  check(latest.EFA === 0.35, "dragging: the slider stores its value", JSON.stringify(latest));
  const reset = root.querySelector(".cust-reset");
  check(!!reset, "reset: offered once a weight is set");
  if (reset) act(() => reset.click());
  check(Object.keys(latest).length === 0 && root.querySelector(".cust-headline").textContent === M.headline(a, v0), "reset: every weight back to 1/n, and the headline with them");
  r.unmount();
}

{
  // The starting amount reaches the wealth chart and its title (1823-1837, the rail's field at 724-725).
  const a = fixtureAnalysis("cross");
  const props = tabProps(a);
  const r = render(h(Custom, { ...props, settings: { ...props.settings, amount: 25000 } }));
  const we = figures(r.container)[1];
  check(titleOf(we) === M.wealthTitle(wealthData(a, a.ew), 25000, true) && titleOf(we).startsWith("$25,000 in the custom mix ended at ") &&
    text(we).includes("Growth of $25,000"), "amount: $25,000 invested is what the wealth chart and its title start from", titleOf(we));
  r.unmount();
}

{
  // The wealth chart carries the amount field, and says which lines are hypothetical.
  const a = fixtureAnalysis("cross");
  const calls = [];
  const r = render(h(Custom, tabProps(a, { requestSettings: (p) => calls.push(p) })));
  const we = figures(r.container)[1];
  const input = we.querySelector(".amount-field input");
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "12000");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  check(JSON.stringify(calls) === JSON.stringify([{ amount: 12000 }]), "amount: the Custom tab's wealth chart edits the same starting amount", JSON.stringify(calls));
  check(text(we.querySelector(".chart-sub")).endsWith("GMV and Tangency are hypothetical: weights chosen with the whole period's prices."),
    "hypothetical: the Custom tab's wealth caption names GMV and Tangency as hypothetical", text(we.querySelector(".chart-sub")));
  const tb = r.container.querySelector(".tbl");
  check(tb && !tb.querySelector(".tbl-span"), "spans: the normalized weights come from no dates, and their table claims none");
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

{
  // megacap: seven assets, the editor and the table carry every one.
  const a = fixtureAnalysis("megacap");
  const r = render(h(Custom, tabProps(a)));
  check(rows(r.container).length === 7 && rows(r.container).every((x) => field(x).value === "0.1429") &&
    tables(r.container)[0]?.querySelectorAll("tbody tr").length === 7 && clean(text(r.container)),
    "megacap: seven rows at 1/7, seven table rows, no NaN");
  r.unmount();
}

// ---- ledger ----------------------------------------------------------------------------------------------
// ledger:custom-normalisation, the page. The app plots the tiny-total book at 1732; the port builds none
// and says so, with no blown-up weight anywhere on the page.
{
  const o = oracle("cross");
  const a = fixtureAnalysis("cross", { allowShort: true });
  for (const k of ["tinyTotal", "negTotal"]) {
    const c = o.modes.short.custom[k];
    const r = render(h(Custom, tabProps(a, { weights: byTicker(a, c.raw) })));
    const t = text(r.container);
    const v = M.customView(a, byTicker(a, c.raw));
    const [fr, we] = figures(r.container);
    const blown = c.w.map(pct).filter((s) => s !== "0.00%");
    check(t.includes(v.refusal.detail) && r.container.querySelector('.cust-note--error[role="alert"]')?.textContent === v.refusal.detail,
      `ledger:custom-normalisation: ${k}: the port states the refusal literally`, t.slice(0, 200));
    check(blown.every((s) => !t.includes(s)) && !chartLabels(fr).includes("Custom") && !chartLabels(we).some((l) => l.startsWith("Custom")),
      `ledger:custom-normalisation: ${k}: none of the app's weights (${blown.join(", ")}) and no Custom point or line on the page`);
    check(tables(r.container).length === 0 && t.includes(`No normalized weights: ${v.refusal.short}.`) &&
      plates(r.container).every((p) => p.value === "–") && clean(t),
      `ledger:custom-normalisation: ${k}: no weights table, dashes in the plates, each saying why`);
    r.unmount();
  }
}

// ledger:boundary, the tab's half. The app: all-zero sliders call st.stop() at 1727, so nothing after it
// in tab 5 is drawn and tab 6 is never built. The port: one refusal, the charts still drawn; and a card
// that throws is replaced by one line naming it while the rest of the tab renders.
{
  check(/if raw_total == 0:\n\s+st\.warning\("All weights are zero\. Adjust at least one slider\."\)\n\s+st\.stop\(\)/.test(lines(1725, 1727)),
    "ledger:boundary: the app's tab 5 stops the whole script on all-zero weights (1725-1727)");
  const a = fixtureAnalysis("cross");
  const r = render(h(Custom, tabProps(a, { weights: byTicker(a, []) })));
  const [fr, we] = figures(r.container);
  check(r.container.querySelector(".cust-headline")?.textContent === "No custom portfolio: every weight is zero." &&
    fr?.querySelector("svg.recharts-surface") && we?.querySelector("svg.recharts-surface") && rows(r.container).length === 5,
    "ledger:boundary: the port names the refusal and keeps the editor and both charts");
  r.unmount();
  const broken = { ...a, benchStats: null };
  const b = quietly(() => render(h(Custom, tabProps(broken))));
  const bt = text(b.container);
  check(bt.includes("Custom portfolio on the efficient frontier could not be shown.") && figures(b.container).length === 1 &&
    plates(b.container).length === 5 && tables(b.container).length === 1 && b.container.querySelector(".cust-headline"),
    "ledger:boundary: a frontier that throws leaves one line naming it; the headline, plates, wealth chart and table remain", bt.slice(0, 300));
  b.unmount();
}

// ledger:failed-tangency, the tab's half. The app falls back to the equal weights for a missing tangency
// (1759), reached only because tab 4 stops the script first (1494-1502). The port draws no tangency.
{
  check(/tan_w2 = st\.session_state\.get\("tan_w", ew_weights\)/.test(lines(1759, 1759)),
    "ledger:failed-tangency: the app's tab 5 would plot equal weights as Tangency (1759)");
  const a = fixtureAnalysis("cross", { allowShort: true, rf: 5 });
  const r = render(h(Custom, tabProps(a)));
  const [fr, we] = figures(r.container);
  check(r.container.querySelector(".cust-headline")?.textContent.includes("the tangency solve failed") && text(fr).includes("Tangency failed"),
    "ledger:failed-tangency: the port's headline and frontier caption say the tangency solve failed");
  check(!chartLabels(fr).includes("Tangency") && !chartLabels(we).some((l) => l.startsWith("Tangency")) && clean(text(r.container)),
    "ledger:failed-tangency: no Tangency point or line, and no stand-in", chartLabels(fr).join());
  r.unmount();
}

// ledger:rf-live, the tab's half. The app scores tab 5 at the rate frozen at Run (1087, read back at
// 1158); the port's figures are the analysis's, which the page rebuilds when the rate is edited.
{
  check(/st\.session_state\.rf = rf_annual/.test(lines(1087, 1087)) && /^rf = st\.session_state\.rf$/.test(ORACLE[1157]),
    "ledger:rf-live: the app freezes rf in session state at Run (1087) and every tab reads it back (1158)");
  const at5 = fixtureAnalysis("cross", { rf: 0.05 });
  const base = fixtureAnalysis("cross");
  const sharpe = (a) => plates(render(h(Custom, tabProps(a))).container)[2].value;
  const s5 = n3(portfolioPerformance(at5.ew, at5.m, at5.S, 0.05).sharpe);
  check(sharpe(at5) === s5 && s5 !== sharpe(base) && render(h(Custom, tabProps(at5))).container.textContent.includes("at the 5.00% risk-free rate"),
    "ledger:rf-live: the Sharpe plate and its note follow the analysis's rate", `${sharpe(at5)} vs ${s5}`);
}

// ledger:numeric-downloads and ledger:downloads-everywhere, the tab's halves. The app: its one table holds
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
  const r = render(h(Custom, tabProps(a, { weights: byTicker(a, v.raw) })));
  check(tables(r.container).length === 1 && buttons(tables(r.container)[0]).join() === "Download CSV,Download Excel",
    "ledger:downloads-everywhere: the port's weights table downloads as CSV and Excel");
  r.unmount();
}

// ledger:daily-rebalanced-label, the tab's half. The app's tab 5 scores and plots R @ w (1740, 1825-1831),
// fixed weights applied every day, and never says so.
{
  check(/cust_port_ret = stock_returns @ custom_w/.test(lines(1740, 1740)) && /"Custom": cust_port_ret/.test(lines(1825, 1831)) && !/rebalanc/i.test(TAB5),
    "ledger:daily-rebalanced-label: the app's tab 5 applies fixed weights every day (1740, 1829) and never says so");
  const a = fixtureAnalysis("cross");
  const r = render(h(Custom, tabProps(a)));
  const [, we] = figures(r.container);
  check(r.container.querySelector(".cust-plates + .cust-note")?.textContent.includes("held fixed and rebalanced daily") && text(we).includes("rebalanced daily to the target weights"),
    "ledger:daily-rebalanced-label: the port's figures and wealth chart both say rebalanced daily");
  r.unmount();
}

// ledger:short-bounds-copy, the tab's half. The app's toggle help calls the shorting frontier
// "unconstrained" (750); the port's tab states the [-1, 1] bounds and never says unconstrained.
{
  check(/unconstrained frontier/.test(ORACLE[750]) && /slider_min = -1\.0 if allow_short else 0\.0/.test(ORACLE[1718]),
    "ledger:short-bounds-copy: the app calls the shorting frontier unconstrained (750-751) while its sliders stop at -1 (1719)");
  const a = fixtureAnalysis("cross", { allowShort: true });
  const r = render(h(Custom, tabProps(a)));
  const t = text(r.container);
  check(t.includes(`[${MINUS}1, 1]`) && t.includes(`from ${MINUS}1 to 1 (shorting is on)`) && !/unconstrained/i.test(t) &&
    rows(r.container).every((x) => field(x).min === "-1" && slider(x).min === "-1"),
    "ledger:short-bounds-copy: with shorting on, the port's editor and caption state [-1, 1]", t.match(/Set a weight.{60}/)?.[0]);
  r.unmount();
  const l = render(h(Custom, tabProps(fixtureAnalysis("cross"))));
  check(!/\[−1, 1\]|shorting is on/.test(text(l.container)), "ledger:short-bounds-copy: long-only, nothing about shorting bounds");
  l.unmount();
}

// ledger:frontier-hover, the tab's half. The app asks its tab-5 frontier for "closest" (1816) and
// style_chart at 1818 overrides it with x unified. The port's tab draws the shared frontier, a
// ScatterChart whose tooltip is the closest point.
{
  check(/hovermode="closest"/.test(ORACLE[1815]) && /style_chart\(fig_ef2, height=520\)/.test(ORACLE[1817]),
    "ledger:frontier-hover: the app's tab-5 frontier asks for closest, then style_chart overrides it (1816, 1818)");
  const a = fixtureAnalysis("cross");
  const r = render(h(Custom, tabProps(a)));
  const [fr] = figures(r.container);
  check(FRONTIER_HOVER === "closest" && !!fr?.querySelector(".recharts-scatter") && !!fr?.querySelector(".frontier-mark--custom"),
    "ledger:frontier-hover: the port's tab draws the shared closest-point frontier, with the Custom mark");
  r.unmount();
}

// The clamp note on the page.
{
  const a = fixtureAnalysis("cross");
  const r = render(h(Custom, tabProps(a, { weights: { VTI: -0.4 } })));
  const note = r.container.querySelector(".cust-note--flag");
  check(note?.textContent === M.clampLine(M.customView(a, { VTI: -0.4 }), false) && field(rows(r.container)[0]).value === "-0.4",
    "clamp: the page shows the entered -0.4 and says it counts as 0", note?.textContent);
  // The weights table prints the entered -0.4 beside a normalized weight built from 0, so its note may not
  // say each row is its entry over the total; with nothing held to a bound it may.
  const tableNote = () => r.container.querySelector('[aria-labelledby="cust-table"] .cust-note')?.textContent ?? "";
  check(/counts at the nearest bound/.test(tableNote()) && !/is it divided by/.test(tableNote()),
    "clamp: the weights table's note says a weight outside the bounds counts at the nearest bound", tableNote());
  r.unmount();
  const plain = render(h(Custom, tabProps(a, { weights: { VTI: 0.4 } })));
  const plainNote = plain.container.querySelector('[aria-labelledby="cust-table"] .cust-note')?.textContent ?? "";
  check(/the normalized weight is it divided by the weight total/.test(plainNote) && !/nearest bound/.test(plainNote),
    "clamp: with every weight inside the bounds the note says each is its entry over the total", plainNote);
  plain.unmount();
}

// Every typed field is 16px on a phone: iOS Safari zooms the page when a smaller input takes focus and
// leaves it zoomed (src/chrome/Rail.css guards the rail the same way). Each text, number or date input
// and select the tab renders needs a 16px rule under Custom.css's 760px query.
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
  const r = render(h(Custom, tabProps(fixtureAnalysis("cross"))));
  // The wealth chart's starting amount is the chart's own field, held to 16px by its own sheet (t-charts-portfolio).
  const typed = [...r.container.querySelectorAll("input, select, textarea")].filter((el) => !["range", "checkbox", "radio"].includes(el.type) && !el.closest(".amount-field"));
  const missing = typed.filter((el) => ![...el.classList].some((k) => sixteen.includes(`.${k}`)));
  check(at >= 0 && typed.length === 5 && missing.length === 0,
    "phone: every weight field is 16px under the 760px query, so focusing one does not zoom the page", `${typed.length} fields; ${sixteen.join(" ")}`);
  r.unmount();
}

done("t-tab-custom");
