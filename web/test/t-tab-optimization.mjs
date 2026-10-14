// The Portfolio Optimization tab (src/tabs/Optimization.tsx, src/tabs/optimization/), portfolio_app.py
// 1467-1703: Build a portfolio's tab, which also holds the Your mix panel (its own suite: t-build-mix.mjs).
//
// (a) The view-model's numbers against the oracle dump, cross and megacap, long-only and with
//     shorting: fed the ORACLE's weights (T0, 1e-12) the tiles, summary, risk contribution and wealth
//     ends reproduce the app's; the port's own exact solves meet the solver tiers (T1 objective, T2
//     weights) of t-parity.mjs; the custom row reproduces the app's normalisation where it is sound.
// (b) The view-model's logic on hand-made weights and on real edge cases: the headline's phrase, a
//     rate no portfolio beats, a failed tangency from the real engine.
// (c) Ledger entries, both sides each: failed-tangency (the tab half), boundary (the tab half),
//     rf-live, numeric-downloads and downloads-everywhere (the tab halves), and that the tab hands the
//     shared charts the props their own suites hold (short-bounds-copy, daily-rebalanced-label). The
//     frontier's closest-point hover is the shared chart's, held by t-charts-portfolio and t-build-mix.
// (d) The whole tab rendered in jsdom: the headline, the lead (the frontier card and the Your mix panel), three
//     charts drawn, four tables with both downloads, no NaN, series named in the charts, and the level switch
//     changing the tooltip text. The chapter draws no growth chart: Performance's carries its lines.
import { act, expectUncaught, render, text } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, near, nearAll, maxAbsDiff, json, done } from "./_assert.mjs";
import { fixtureAnalysis, tabProps } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const M = await import("../src/tabs/optimization/model.ts");
const Optimization = (await import("../src/tabs/Optimization.tsx")).default;
const { frontierCaption, frontierData } = await import("../src/charts/Frontier.tsx");
const { wealthCaption, wealthData, wealthPlot } = await import("../src/charts/Wealth.tsx");
const { format, DASH, MINUS } = await import("../src/format.ts");
const { tokens } = await import("../src/styles/tokens.ts");
const { ROLE } = await import("../src/charts/theme.ts");
const { contrastRatio, TEXT_AA } = await import("../src/charts/contrast.ts");
const { csvText, cellFor } = await import("../src/download.ts");
const { tipText } = await import("../src/content/tooltips.ts");
const { riskContribution } = await import("../src/lib/portfolio.ts");
const SC = await import("../src/tabs/optimization/scorecard.ts");
const { maxDrawdown } = await import("../src/lib/stats.ts");
const { openMore } = await import("../src/components/MoreList.tsx");
// Build's figures beyond the lead sit in its More rows, drawn the first time a row opens: open the four with figures,
// as a reader would, before the chapter is first drawn (the list remembers them for the run).
for (const k of ["scorecard", "holdings", "redraws", "prc"]) openMore("build", k);

const ORACLE = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8").split(/\r?\n/);
// The oracle's lines first..last (1-based, inclusive), joined.
const lines = (first, last) => ORACLE.slice(first - 1, last).join("\n");
const oracle = (set) => json(new URL(`./fixtures/oracle-${set}.json`, import.meta.url));
const REL = 1e-12; // T0, as t-parity.mjs
const FIELDS = ["mu", "sigma", "sharpe", "sortino", "mdd"];
const quiet = (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};
const ready = (s, what) => {
  check(s.status === "ready", `${what} is ready`, s.status === "error" ? `${s.name}: ${s.message}` : s.status);
  return s.status === "ready" ? s.value : { columns: [], rows: [], groups: [], series: [] };
};
// The analysis with the oracle's own SLSQP weights in place of the port's exact ones (T0).
const withOracleWeights = (a, S) => ({ ...a, gmv: { ...a.gmv, w: S.gmv.x }, tangency: { ...a.tangency, w: S.tan.x } });

// ---- (a) parity with the oracle dump ------------------------------------------------------------------
for (const set of ["cross", "megacap"]) {
  const o = oracle(set);
  for (const mode of ["long", "short"]) {
    const short = mode === "short";
    const a = fixtureAnalysis(set, { allowShort: short });
    const E = o.modes[mode];
    const tag = (s) => `${set} ${mode}: ${s}`;
    check(JSON.stringify(a.tickers) === JSON.stringify(o.clean.tickers) && a.rf === o.rf && a.allowShort === short, tag("the analysis is the oracle's input"));

    // T0: every figure, fed the app's own weights.
    const ao = withOracleWeights(a, E.shipping);
    // The scorecard prints these five figures for each mix (t-scorecard holds its cells to portRow, figure by figure),
    // in the app's summary order, the benchmark last under its display name.
    const cols = SC.scoreColumns(ao, M.customWeights(ao, {}));
    check(JSON.stringify(cols.map((c) => c.label)) === JSON.stringify(["Equal-Weight", "GMV", "Tangency", "Custom", o.benchLabel]),
      tag("scorecard columns in the app's summary order, the benchmark last under its display name (1681, 1689)"), cols.map((c) => c.label).join());
    [["ew", ao.ew], ["gmv", E.shipping.gmv.x], ["tan", E.shipping.tan.x]].forEach(([k, w]) => {
      const row = M.portRow(ao, w);
      for (const f of FIELDS) near(tag(`${k} ${f} (oracle weights)`), row[f], E.perf[k][f], REL);
    });
    // The app's Max DD path starts a day in (904-908); the port's at the amount invested. On these sets
    // no portfolio's worst fall starts on day one, so the two agree, and the model reaches the app's too.
    near(tag("GMV Max DD, the app's path reproduced"), M.portRow(ao, E.shipping.gmv.x, false).mdd, E.perf.gmv.mdd, REL);
    // Before tab 5 is touched, Custom is 1/n (1581): the dump's default custom row.
    const cd = M.portRow(ao, M.customWeights(ao, {}).w);
    for (const f of FIELDS) near(tag(`default Custom ${f}`), cd[f], E.custom.default.perf[f], 1e-11);
    const bs = { ...ao.benchStats, mdd: maxDrawdown(ao.bench) };
    for (const f of FIELDS) near(tag(`benchmark ${f}`), bs[f], o.bench[f], REL);

    const prc = ready(M.prcTable(ao), tag("risk contribution table"));
    nearAll(tag("GMV PRC (oracle weights)"), prc.rows.map((r) => r.gmvPrc), E.prc.gmv, REL, 1e-15);
    nearAll(tag("Tangency PRC (oracle weights)"), prc.rows.map((r) => r.tanPrc), E.prc.tan, REL, 1e-15);
    check(prc.rows.every((r, i) => r.gmvW === E.shipping.gmv.x[i] && r.tanW === E.shipping.tan.x[i]), tag("the PRC table's weight columns are the weights"));

    // The wealth chart's ends: the dump's last sample is the last return day.
    const ends = M.wealthEnds(ao, null, o.w0);
    const last = (p) => p.v[p.i.length - 1];
    check(E.wealth.ew.i.at(-1) === a.dates.length - 1, tag("the dump's wealth path reaches the last day"));
    near(tag("Equal-Weight ends where the app's does"), ends[0].end, last(E.wealth.ew), 1e-10);
    near(tag("GMV ends where the app's does (oracle weights)"), ends[1].end, last(E.wealth.gmv), 1e-10);
    near(tag("Tangency ends where the app's does (oracle weights)"), ends[2].end, last(E.wealth.tan), 1e-10);
    near(tag("the benchmark ends where the app's does"), ends[3].end, o.bench.wealth.v.at(-1), 1e-10);
    const plot = wealthPlot({ status: "ready", value: wealthData(ao, null) }, o.w0);
    check(plot.status === "ready" && JSON.stringify(plot.value.lines.map((l) => [l.label, l.end])) === JSON.stringify(ends.map((e) => [e.label, e.end])),
      tag("the ends are the ones the shared growth chart draws"));

    // T1 / T2: the port's own exact solves, at t-parity.mjs's tiers.
    const gRow = M.portRow(a, a.gmv.w);
    const tRow = M.portRow(a, a.tangency.w);
    const oVol = E.shipping.gmv.fun;
    check(gRow.sigma <= oVol * (1 + 1e-9) && gRow.sigma >= oVol * (1 - 2e-4), tag("GMV volatility: no worse than the app's, within 2e-4"), `${gRow.sigma} vs ${oVol}`);
    const oSh = -E.shipping.tan.fun;
    check(tRow.sharpe >= oSh - 1e-9 && tRow.sharpe <= oSh + 5e-6, tag("Tangency Sharpe: no worse than the app's, within 5e-6"), `${tRow.sharpe} vs ${oSh}`);
    const wt = ready(M.weightTable(a), tag("weights table"));
    check(JSON.stringify(wt.columns.map((c) => c.label)) === JSON.stringify(["Asset", "GMV", "Tangency", "Equal-Weight"]), tag("weights columns in the app's order (1535)"));
    check(wt.rows.map((r) => r.asset).join() === a.tickers.join(), tag("a weights row per ticker, in the entered order"));
    check(wt.rows.every((r, i) => r.gmv === a.gmv.w[i] && r.tangency === a.tangency.w[i] && r.ew === 1 / a.tickers.length), tag("the weights table holds the solves' own weights"));
    check(maxAbsDiff(wt.rows.map((r) => r.gmv), E.shipping.gmv.x) <= 1.5e-2, tag("GMV weights within the app's SLSQP noise (T2)"));
    check(maxAbsDiff(wt.rows.map((r) => r.tangency), E.shipping.tan.x) <= 5e-3, tag("Tangency weights within the app's SLSQP noise (T2)"));
    const wb = ready(M.weightBars(a), tag("weights chart"));
    check(JSON.stringify(wb.series.map((s) => s.label)) === JSON.stringify(["GMV", "Tangency", "Equal-Weight"]) && wb.groups.every((g, i) => g.values[0] === a.gmv.w[i] && g.values[1] === a.tangency.w[i]),
      tag("weights chart: GMV, Tangency, Equal-Weight bars per ticker (1535-1537)"));
    const pb = ready(M.prcBars(a), tag("PRC chart"));
    const gp = riskContribution(a.gmv.w, a.S);
    check(JSON.stringify(pb.series.map((s) => s.label)) === JSON.stringify(["GMV PRC", "Tangency PRC"]) && pb.groups.every((g, i) => g.values[0] === gp[i]),
      tag("PRC chart: the GMV and Tangency PRC columns (1567)"));
    near(tag("each portfolio's PRC sums to 1"), gp.reduce((x, y) => x + y, 0), 1, 1e-12);
    if (!short) {
      // KKT at the exact long-only GMV optimum: PRC_i = w_i. The app's SLSQP only gets near it.
      nearAll(tag("long-only GMV: PRC equals the weight at the exact optimum"), gp, a.gmv.w, 0, 1e-9);
    }
  }

  // Custom weights, the app's normalisation (1581-1586) where it is sound, and refused where it is not.
  const aL = fixtureAnalysis(set);
  const cU = o.modes.long.custom.uneven;
  const byTicker = (raw) => Object.fromEntries(aL.tickers.map((t, i) => [t, raw[i]]));
  const cu = M.customWeights(aL, byTicker(cU.raw));
  nearAll(`${set}: uneven custom weights normalise as the app's`, cu.w, cU.w, REL, 1e-15);
  const su = M.portRow(aL, cu.w);
  for (const f of FIELDS) near(`${set}: uneven Custom ${f}`, su[f], cU.perf[f], 1e-11);
  const aS = fixtureAnalysis(set, { allowShort: true });
  for (const k of ["negTotal", "tinyTotal"]) {
    const e = o.modes.short.custom[k];
    const c = M.customWeights(aS, Object.fromEntries(aS.tickers.map((t, i) => [t, e.raw[i]])));
    check(e.w.some((x, i) => Math.abs(x) > 1 || Math.sign(x) !== Math.sign(e.raw[i])),
      `${set}: the app's ${k} custom weights flip sign or leave the [-1, 1] box (1582-1584)`, JSON.stringify(e.w));
    const col = SC.scoreColumns(aS, c)[3];
    check(!c.ok && col.label === "Custom (not shown)" && col.weights === null && SC.columnFigures(aS, c, null)[3].row === null,
      `${set}: the port refuses the ${k} custom weights and the scorecard prints no figures for them`, JSON.stringify(col));
    check(!c.ok && M.customNote(aS, c) === M.CUSTOM_REFUSAL[c.reason], `${set}: the ${k} refusal is said, by reason`);
  }
}

// ---- (b) the view-model's logic -------------------------------------------------------------------------
{
  const T = ["AAA", "BBB", "CCC", "DDD"];
  check(M.mixPhrase([0.6, 0.4, 0, 0], T) === "holds 60.0% AAA and 40.0% BBB", "phrase: two holdings are named in full", M.mixPhrase([0.6, 0.4, 0, 0], T));
  check(M.mixPhrase([1, 0, 0, 0], T) === "holds 100.0% AAA", "phrase: one holding");
  check(M.mixPhrase([0.2, 0.5, 0.3, 0], T) === "puts its largest weights on BBB (50.0%) and CCC (30.0%)", "phrase: three holdings name the two largest",
    M.mixPhrase([0.2, 0.5, 0.3, 0], T));
  check(M.mixPhrase([1, 0.4, -0.2, -0.2], T) === "puts its largest weights on AAA (100.0%) and BBB (40.0%), with 2 short positions", "phrase: shorts are counted",
    M.mixPhrase([1, 0.4, -0.2, -0.2], T));
  check(M.mixPhrase([0.7, 0.3, 0.0004, -0.0004], T) === "holds 70.0% AAA and 30.0% BBB", "phrase: a weight that prints as 0.0% is not a holding");

  const a = fixtureAnalysis("cross");
  check(M.headline(a) === "With hindsight, the maximum-Sharpe portfolio holds 54.2% GLD and 45.8% VTI, for an in-sample Sharpe of 0.946 against 0.597 for equal weights; the last chapter's fitting-window rows show how much that depends on the window.",
    "headline: cross, long-only, literal", M.headline(a));
  check(M.frontierTitle(a) === `Tangency has the highest Sharpe ratio on the frontier, at ${format(a.tangency.sigma, "pct2")} volatility; GMV the lowest volatility, ${format(a.gmv.sigma, "pct2")}`,
    "frontier title: where Tangency and GMV sit", M.frontierTitle(a));
  check(M.weightsTitle(a) === "GMV's largest weight is AGG, 95.4%; Tangency's is GLD, 54.2%", "weights title: each largest weight", M.weightsTitle(a));
  const rich = fixtureAnalysis("cross", { rf: 0.5 });
  check(!rich.tangency.beatsRf && M.headline(rich) === `No long-only mix of these assets earned more than the 50.00% risk-free rate, even with hindsight: the highest in-sample Sharpe ratio is ${format(rich.tangency.sharpe, "num3")}.`,
    "headline: a rate no portfolio beats is said, not dressed as a tangency mix, and names the long-only bounds searched", M.headline(rich));
  check(M.headline({ ...rich, allowShort: true }).startsWith(`No mix of these assets with weights inside [${MINUS}1, 1] earned more than the 50.00% risk-free rate`),
    "headline: with shorting on it names those bounds instead", M.headline({ ...rich, allowShort: true }));
  const failed = fixtureAnalysis("cross", { allowShort: true, rf: 0.5 });
  check(failed.tangency === null && failed.gmv !== null, "a real failed tangency: shorting on, no portfolio in the box beats a 50% rate");
  check(M.headline(failed) === `The maximum-Sharpe solve failed, so there is no tangency portfolio; the minimum-variance portfolio's volatility is ${format(failed.gmv.sigma, "pct2")}.`,
    "headline: a failed tangency is said", M.headline(failed));
  const neither = { ...a, gmv: null, tangency: null };
  check(M.headline(neither).startsWith("Both optimisations failed") && M.prcBars(neither).status === "empty" && M.frontierTitle(neither) === "Efficient Frontier",
    "neither solve: the headline says so, the PRC chart is empty and named");

  // The custom note: equal weights say so; changed weights do not.
  check(/still equal weights/.test(M.customNote(a, M.customWeights(a, {}))), "custom note: untouched weights are said to repeat Equal-Weight");
  const moved = M.customWeights(a, { VTI: 0.5 });
  check(moved.ok && !M.customIsEqual(a, moved) && !/still equal/.test(M.customNote(a, moved)), "custom note: moved weights are not called equal");

  // Max DD from the amount invested, as the scorecard's note says: a 60% fall on the first day counts. The
  // app's path starts at 1 + r1 (904-908) and does not see it.
  const dayOne = { ...a, returns: a.returns.map((r) => [-0.6, ...r.slice(1)]), bench: [-0.6, ...a.bench.slice(1)] };
  const dayFigs = SC.columnFigures(dayOne, M.customWeights(dayOne, {}), null);
  const ewDD = dayFigs[0].row.maxDrawdown;
  check(ewDD <= -0.6 + 1e-12 && M.portRow(dayOne, dayOne.ew).mdd <= -0.6 + 1e-12 && M.portRow(dayOne, dayOne.ew, false).mdd > -0.6,
    "scorecard: Max drawdown counts a 60% fall on the first day; the app's path would not", `${ewDD} vs ${M.portRow(dayOne, dayOne.ew, false).mdd}`);
  const benchDD = dayFigs.at(-1).row.maxDrawdown;
  check(benchDD <= -0.6 + 1e-12, "scorecard: the benchmark's Max drawdown counts its first-day fall too", String(benchDD));

  // A NaN figure fails its table closed and named.
  const broke = { ...a, gmv: { ...a.gmv, w: a.gmv.w.map((x, i) => (i === 0 ? NaN : x)) } };
  const ws = M.weightTable(broke);
  check(ws.status === "error" && /VTI/.test(ws.message), "a weight that is not a number refuses the weights table by name", JSON.stringify(ws));
  check(M.weightBars(broke).status === "error" && M.prcBars(broke).status === "error", "and the two bar charts");

  // The bar layout leaves room for the names above the roomiest group.
  const lay = M.barLayout([{ name: "A", values: [0.9, 0.8] }, { name: "B", values: [0.1, 0.05] }], 100, 300);
  check(lay.host === 1 && lay.lo === 0 && (lay.hi - 0.1) / (lay.hi - lay.lo) >= 100 / 300 - 1e-12 && lay.hi >= 0.9, "bar layout: the names go over the lowest group, with room", JSON.stringify(lay));
}

// ---- (c) ledger -----------------------------------------------------------------------------------------
// jsdom lays nothing out, so every box measures 0 x 0 and Recharts would draw no chart. Give boxes a
// size, as a browser would.
const rect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 360, width: 720, height: 360, toJSON() {} };
};
// A Build row's card, by its key (`#build-<key>`), with its folds opened: Show the numbers and How it is calculated draw
// their contents the first time they open.
const sectionOf = (r, key) => {
  const row = r.container.querySelector(`#build-${key}`);
  for (const b of row?.querySelectorAll(".card-fold-button[aria-expanded='false']") ?? []) act(() => b.click());
  return row;
};
const openAll = (r) => {
  ["scorecard", "holdings", "redraws", "prc"].forEach((k) => sectionOf(r, k));
  for (const b of r.container.querySelectorAll(".build-mix .card-fold-button[aria-expanded='false']")) act(() => b.click());
};
const scoreCells = (r, metric) => [...(r.container.querySelector(`#build-scorecard tr[data-metric="${metric}"]`)?.children ?? [])].slice(1).map(text);
// The lead's frontier card, its "How it is calculated" fold opened (where the chart's caption now sits).
const frontierOf = (r) => {
  const card = r.container.querySelector("#build-frontier");
  const how = card && [...card.querySelectorAll(".card-fold-button")].find((b) => text(b) === "How it is calculated");
  if (how && how.getAttribute("aria-expanded") === "false") act(() => how.click());
  return card;
};
const tablesOf = (r) => [...r.container.querySelectorAll(".tbl")];
const rowCells = (tbl, k) => [...([...tbl.querySelectorAll("tbody tr")][k]?.children ?? [])].map(text);

// failed-tangency, the tab half.
{
  check(/tan_w_snap = ew_w_snap/.test(lines(1200, 1202)) && /tan_mu_snap, tan_sig_snap, tan_sh_snap = ew_mu_snap, ew_sig_snap, ew_sh_snap/.test(lines(1200, 1202)),
    "ledger:failed-tangency the app's band shows equal-weight figures under the Tangency labels when the solve fails (1200-1202)");
  check(/if not tan_res\.success:\s*\n\s*st\.error\("Tangency optimization did not converge/.test(lines(1491, 1494)) && /st\.stop\(\)/.test(lines(1494, 1494)),
    "ledger:failed-tangency the app's tab 4 errors and stops the script at a failed tangency: no tiles, weights or summary (1492-1494)");
  const a = fixtureAnalysis("cross", { allowShort: true, rf: 0.5 });
  const ew = M.portRow(a, a.ew);
  const col = SC.scoreColumns(a, M.customWeights(a, {}))[2];
  check(col.label === "Tangency (failed)" && col.weights === null && SC.columnFigures(a, M.customWeights(a, {}), null)[2].row === null,
    "ledger:failed-tangency the port's Tangency column holds no figure and says it failed");
  const r = quiet(() => render(h(Optimization, tabProps(a))));
  openAll(r);
  const score = sectionOf(r, "scorecard");
  const tanHead = score?.querySelector('.tbl.sc thead th[data-col="tangency"]');
  const tanCells = ["annual", "vol", "sharpe", "sortino", "mdd"].map((m) => scoreCells(r, m)[2]);
  check(score && text(score).includes("Tangency failed") && tanHead && text(tanHead).startsWith("Tangency (failed)") && tanCells.every((c) => c === DASH),
    "ledger:failed-tangency the scorecard says Tangency failed, its column all dashes", tanCells.join(" "));
  check(!tanCells.some((c) => c === format(ew.mu, "pct2") || c === format(ew.sharpe, "num3")), "ledger:failed-tangency no equal-weight stand-in under the Tangency heading");
  const weights = sectionOf(r, "holdings");
  const wtbl = weights?.querySelector(".tbl");
  check(weights && text(weights).includes("Tangency failed") && wtbl && [...wtbl.querySelectorAll("thead th")].map(text).includes("Tangency (failed)"),
    "ledger:failed-tangency the weights say Tangency failed, its column labelled failed");
  check(wtbl && rowCells(wtbl, 0)[2] === DASH, "ledger:failed-tangency the failed column prints a dash, no weight", wtbl ? rowCells(wtbl, 0).join(" ") : "");
  check(!/NaN|undefined|Infinity/.test(text(r.container)), "failed tangency: no NaN, undefined or Infinity on the tab");
  check(r.container.querySelectorAll(".recharts-surface").length === 3, "failed tangency: the three charts still draw, without a tangency", `${r.container.querySelectorAll(".recharts-surface").length}`);
  check(text(frontierOf(r)).includes("Tangency failed"), "failed tangency: the frontier's caption says so too");
  r.unmount();
}

// boundary, the tab half.
{
  check((lines(1470, 1502).match(/st\.stop\(\)/g) ?? []).length === 3,
    "ledger:boundary the app's tab 4 holds three st.stop() calls (1483, 1494, 1502): a failed solve ends the script run, tabs 5 and 6 with it");
  const a = fixtureAnalysis("cross");
  const broken = Object.create(a);
  Object.defineProperty(broken, "frontier", { get() { throw new Error("no frontier"); } });
  let r = null;
  try {
    r = quiet(() => expectUncaught(() => render(h(Optimization, tabProps(broken)))));
  } catch (err) {
    check(false, "ledger:boundary a failing section stays inside its own boundary", err.message);
  }
  if (r) {
    const fallback = [...r.container.querySelectorAll(".boundary")].map(text);
    check(JSON.stringify(fallback) === JSON.stringify(["Efficient frontier could not be shown."]), "ledger:boundary the failed section is one line naming it", fallback.join(" | "));
    openAll(r);
    check(!!r.container.querySelector(".opt-headline") && r.container.querySelectorAll(".recharts-surface").length === 2 && tablesOf(r).length === 4 &&
      r.container.querySelectorAll(".build-mix .cust-row").length === a.tickers.length,
      "ledger:boundary the headline, the Your mix panel, the other two charts and all four tables (the panel's own among them) still render");
    r.unmount();
  }
  // A failed GMV: said in every place its figures would be, and the tab still renders.
  const g = { ...a, gmv: null, frontier: [] };
  const rg = quiet(() => render(h(Optimization, tabProps(g))));
  openAll(rg);
  const gHead = rg.container.querySelector('#build-scorecard .tbl.sc thead th[data-col="gmv"]');
  check(text(sectionOf(rg, "scorecard")).includes("GMV failed") && gHead && text(gHead).startsWith("GMV (failed)") &&
    ["annual", "vol", "sharpe", "sortino", "mdd"].every((m) => scoreCells(rg, m)[1] === DASH),
    "a failed GMV is said in the scorecard, its column with no figures");
  check(!/NaN|undefined|Infinity/.test(text(rg.container)) && rg.container.querySelectorAll(".boundary").length === 0, "a failed GMV breaks no section");
  rg.unmount();
}

// numeric-downloads, the tab half: the app's summary is f-strings (1686-1694), so its downloads are text.
{
  const src = lines(1678, 1695);
  check(/"Ann\. Return": f"\{mu_p:\.2%\}"/.test(src) && /"Sharpe": f"\{sh_p:\.3f\}"/.test(src) && /comp_df = pd\.DataFrame\(comp_data\)\.T/.test(src),
    "ledger:numeric-downloads the app's summary cells are formatted strings, so its CSV and Excel hold text (1686-1695)");
  const a = fixtureAnalysis("cross");
  // The port's summary figures download from the scorecard (t-scorecard holds its CSV and Excel); here, the weights.
  const s = ready(M.weightTable(a, [], M.customWeights(a, {})), "weights");
  const csv = csvText(s.columns, s.rows).split("\n");
  check(csv[0] === "Asset,GMV,Tangency,Equal-Weight,Custom" && csv[1] === `${a.tickers[0]},${s.rows[0].gmv},${s.rows[0].tangency},${s.rows[0].ew},${s.rows[0].custom}` && String(s.rows[0].gmv).length > 8,
    "ledger:numeric-downloads the port's weights CSV holds the full numbers, your mix's column too", csv[1]);
  const cell = cellFor(s.rows[0].gmv, s.columns[1]);
  check(cell?.t === "n" && cell.v === s.rows[0].gmv && cell.z === "0.00%",
    "ledger:numeric-downloads the port's Excel cells are numbers, formatted 0.00%", JSON.stringify(cell));
  const p = ready(M.prcTable(a), "PRC");
  const pc = cellFor(p.rows[0].gmvPrc, p.columns[2]);
  check(pc?.t === "n" && pc.v === p.rows[0].gmvPrc && pc.z === "0.00%", "ledger:numeric-downloads the risk contribution downloads as numbers", JSON.stringify(pc));
}

// rf-live, the tab half: the app freezes rf at Run (1087) and every tab reads the frozen copy (1158).
{
  check(/st\.session_state\.rf = rf_annual/.test(lines(1087, 1087)) && /rf = st\.session_state\.rf/.test(lines(1158, 1158)),
    "ledger:rf-live the app's tabs read the rate saved at Run (1087, 1158)");
  const a = fixtureAnalysis("cross");
  const props = tabProps(a);
  const r = quiet(() => render(h(Optimization, props)));
  const b = fixtureAnalysis("cross", { rf: 0.05 });
  quiet(() => r.rerender(h(Optimization, { ...props, analysis: b })));
  const ewSharpe = M.portRow(b, b.ew).sharpe;
  const ewCell = scoreCells(r, "sharpe")[0] ?? "";
  check(ewCell.startsWith(format(ewSharpe, "num3")) && format(ewSharpe, "num3") !== format(M.portRow(a, a.ew).sharpe, "num3"),
    "ledger:rf-live the scorecard's Sharpe follows a new rate at once", ewCell);
  check(text(frontierOf(r)).includes("from the 5.00% risk-free rate") && text(sectionOf(r, "scorecard")).includes("5.00% risk-free rate"),
    "ledger:rf-live the frontier's line and the scorecard's note use the new rate");
  check(text(r.container.querySelector(".opt-headline")) === M.headline(b) && M.headline(b) !== M.headline(a), "ledger:rf-live the headline is recomputed at the new rate");
  r.unmount();
}

// ---- (d) the tab, rendered ------------------------------------------------------------------------------
{
  const o = oracle("cross");
  const a = fixtureAnalysis("cross");
  const props = tabProps(a);
  const r = quiet(() => render(h(Optimization, props)));
  openAll(r);
  act(() => r.container.querySelector(".sc-toggle").click());
  const all = text(r.container);
  check(!/NaN|undefined|Infinity|\bnan\b/.test(all), "tab: no NaN, undefined or Infinity anywhere on it");
  const head = r.container.querySelector(".opt-headline");
  check(head && text(head) === M.headline(a) && text(head).startsWith("With hindsight, the maximum-Sharpe portfolio holds 54.2% GLD"), "tab: the headline is on it, literal", head ? text(head) : "none");
  // The lead comes right after the headline: the frontier, then the Your mix panel beside it.
  const order = [...r.container.querySelectorAll(".opt-headline, #build-frontier, .build-mix, .more-row")].map((e) => (e.classList.contains("opt-headline") ? "headline" : e.id));
  check(JSON.stringify(order) === JSON.stringify(["headline", "build-frontier", "section-custom", "build-scorecard", "build-holdings", "build-redraws", "build-prc", "build-whatif"]),
    "tab: headline, the frontier and Your mix, then the rows: scorecard, what each mix holds, the redraws, risk contribution, the what-if", order.join(" "));
  check(!r.container.querySelector(".opt-tile, .plate-na") && !/Summary comparison/i.test(all), "tab: neither the three portfolios' plates nor the summary comparison is drawn: the scorecard carries their figures");
  check(!!r.container.querySelector(".build-lead > #build-frontier:first-child") && !!r.container.querySelector(".build-lead > .build-mix:last-child"),
    "tab: the frontier card and the Your mix panel are the lead's two parts, the frontier first");
  check(r.container.querySelectorAll(".recharts-surface").length === 3, "tab: all three charts are drawn", `${r.container.querySelectorAll(".recharts-surface").length}`);
  check(!r.container.querySelector(".amount-field") && !/Cumulative Wealth/.test(all), "tab: no growth chart and no amount field: Performance's growth card carries those lines");
  check(r.container.querySelectorAll(".recharts-legend-wrapper").length === 0, "tab: no legend, the series are named in the charts");

  // Every table, and each carries both downloads (downloads-everywhere, the tab half).
  const tables = tablesOf(r).filter((t) => !t.closest(".build-mix"));
  const captions = tables.map((t) => text(t.querySelector("caption .tbl-title")));
  check(JSON.stringify(captions) === JSON.stringify(["Scorecard", "Portfolio weights", "Weight, return and risk contribution"]), "tab: its three tables beyond the Your mix panel's", captions.join(" | "));
  check(tables.length === 3 && tables.every((t) => {
    const b = [...t.querySelectorAll("button")].map(text);
    return b.includes("Download CSV") && b.includes("Download Excel");
  }), "ledger:downloads-everywhere every table on the tab has a CSV and an Excel download");
  check(!/download_button/.test(lines(1553, 1573)) && (lines(1543, 1551).match(/download_button/g) ?? []).length === 2 && (lines(1697, 1703).match(/download_button/g) ?? []).length === 2,
    "ledger:downloads-everywhere the app gives the weights and the summary two downloads each (1548-1551, 1700-1703) and the risk contribution none (1555-1572)");
  const prcSec = sectionOf(r, "prc");
  check(prcSec && [...prcSec.querySelectorAll(".tbl button")].map(text).join() === "Download CSV,Download Excel", "ledger:downloads-everywhere the port's risk contribution table has both");
  check(r.container.querySelectorAll("table").length === tablesOf(r).length && r.container.querySelectorAll(".tbl.sc table").length === 1,
    "tab: no table outside the Table and Scorecard components");

  // Printed cells: the scorecard's Equal-Weight column, the old summary row's five figures, at the app's formats and
  // from the oracle's own figures.
  const e = o.modes.long.perf.ew;
  const ewCol = ["mean", "vol", "sharpe", "sortino", "mdd"].map((m) => scoreCells(r, m)[0] ?? "");
  const wantEw = [format(e.mu, "pct2"), format(e.sigma, "pct2"), format(e.sharpe, "num3"), format(e.sortino, "num3"), format(e.mdd, "pct2")];
  check(ewCol.every((c, i) => (i === 2 ? c.startsWith(wantEw[i]) : c === wantEw[i])),
    "tab: the scorecard's Equal-Weight column prints the oracle's figures at the app's formats", `${ewCol.join(" ")} / ${wantEw.join(" ")}`);
  const benchHead = r.container.querySelector('#build-scorecard .tbl.sc thead th[data-col="bench"]');
  check(text(benchHead ?? {}).startsWith("S&P 500") && (scoreCells(r, "sharpe")[4] ?? "").startsWith(format(o.bench.sharpe, "num3")), "tab: the benchmark column, under its display name");

  // Series named in the charts.
  const svgText = (id) => text(sectionOf(r, id).querySelector(".recharts-surface"));
  check(["GMV", "Tangency", "Equal-Weight"].every((s) => svgText("holdings").includes(s)), "tab: the weights chart names its three series on the bars", svgText("holdings"));
  check(["Weight", "Return share", "Risk share"].every((s) => svgText("prc").includes(s)), "tab: the share chart names its three series on the bars", svgText("prc"));
  // Bronze text measures 3.6:1 on paper, under WCAG AA's 4.5:1: Tangency's bars stay bronze, their name is ink2.
  const bn = ["holdings", "prc"].flatMap((id) => [...sectionOf(r, id).querySelectorAll(".opt-bar-name")].map((n) => ({ text: n.textContent, fill: n.getAttribute("fill") })));
  const nameFill = (s) => bn.find((n) => n.text === s)?.fill;
  const tanBars = [...sectionOf(r, "holdings").querySelectorAll(".recharts-bar-rectangle path")].filter((p) => p.getAttribute("fill") === ROLE.tangency);
  check(bn.length === 6 && nameFill("Tangency") === tokens.color.ink2 && nameFill("Risk share") === tokens.color.ink2 && nameFill("GMV") === ROLE.gmv &&
    nameFill("Equal-Weight") === ROLE.ew && bn.every((n) => contrastRatio(n.fill, tokens.color.paper) >= TEXT_AA) && tanBars.length > 0,
    "tab: every series name on the bars reads on paper at 4.5:1; Tangency's is ink2 while its bars stay bronze", JSON.stringify(bn));
  // Hovering a Tangency bar: Recharts writes the hover row in the series' colour, so ReadableTip sets it in ink2.
  const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  const rowColour = (id, fill) => {
    const bar = [...sectionOf(r, id).querySelectorAll(".recharts-bar-rectangle")].find((g) => g.querySelector("path")?.getAttribute("fill") === fill);
    act(() => bar.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    const rows = [...sectionOf(r, id).querySelectorAll(".recharts-tooltip-item")];
    return rows.map((li) => `${text(li.querySelector(".recharts-tooltip-item-name"))}=${li.style.color}`).join(" ");
  };
  const tanRow = rowColour("holdings", ROLE.tangency);
  const gmvRow = rowColour("holdings", ROLE.gmv);
  const retRow = rowColour("prc", ROLE.frontier);
  check(tanRow === `Tangency=${rgb(tokens.color.ink2)}` && gmvRow === `GMV=${rgb(ROLE.gmv)}` && retRow === `Return share=${rgb(ROLE.frontier)}`,
    "tab: hovering a bar names it alone, Tangency in ink2, GMV in its teal and a return share in navy", `${tanRow} | ${gmvRow} | ${retRow}`);
  const frSvg = text(r.container.querySelector("#build-frontier .recharts-surface"));
  check([...a.tickers, "GMV", "Tangency", "Equal-Weight", "Custom", "S&P 500"].every((s) => frSvg.includes(s)), "tab: the frontier names every asset and all four mixes in the chart", frSvg);
  check(text(r.container.querySelector("#build-frontier .card-title")) === M.frontierTitle(a), "tab: the frontier card's title is where Tangency and GMV sit");
  check(/still equal weights/.test(text(sectionOf(r, "scorecard"))), "tab: untouched custom weights are said to repeat Equal-Weight, under the scorecard");

  // The tab hands the shared charts what their suites hold them to. The frontier's caption is its card's
  // "How it is calculated"; the chart keeps its title for a screen reader and prints no caption of its own.
  const fr = frontierOf(r);
  check(!fr.querySelector(".chart-sub") && text(fr.querySelector("[data-fold=how]")).includes(frontierCaption(a.allowShort, a.rf, frontierData(a).cal)),
    "tab: the shared Frontier's caption, the analysis's own bounds and rate, is under the card's How it is calculated", text(fr));
  // The growth lines this chapter used to draw are Performance's now, and so is the sentence.
  check(/rebalanced daily/.test(wealthCaption(props.settings.amount, a.prices.dates[0], a.asOf)),
    "ledger:daily-rebalanced-label the growth chart that carries these portfolios says each is rebalanced daily");
  check(!/rebalanc/i.test(lines(1660, 1674)), "ledger:daily-rebalanced-label the app's wealth chart does not say so (1660-1674)");
  check(/holds its weights fixed, rebalanced daily/.test(text(sectionOf(r, "scorecard"))), "ledger:daily-rebalanced-label the scorecard says the weights are held fixed, rebalanced daily");
  check(/Max drawdown is measured from the amount invested/.test(text(sectionOf(r, "scorecard"))), "tab: the scorecard says its maximum drawdown counts from the amount invested, as the plates' note did");
  check(!/\[\u22121, 1\]|\u2212100%/.test(all), "ledger:short-bounds-copy long-only, the tab says nothing about [-1, 1] bounds");

  // The level switch changes the tooltip text.
  const tipOf = () => r.container.querySelector("button[aria-label='About annual return']")?.parentElement.querySelector("[role=tooltip]");
  const plain = tipOf() ? text(tipOf()) : "";
  quiet(() => r.rerender(h(Optimization, { ...props, level: "formula" })));
  const formula = tipOf() ? text(tipOf()) : "";
  check(plain === tipText("return", "plain") && formula === tipText("return", "formula") && plain !== formula, "tab: the level switch changes the tooltip text", `${plain} / ${formula}`);
  const mddTip = r.container.querySelector("button[aria-label='About maximum drawdown']")?.parentElement.querySelector("[role=tooltip]");
  check(mddTip && text(mddTip) === tipText("max_dd", "formula"), "tab: the Max DD tip follows the level too");

  // Custom weights from the Your mix panel reach the frontier and the summary (1581).
  const raw = o.modes.long.custom.uneven.raw;
  quiet(() => r.rerender(h(Optimization, { ...props, weights: Object.fromEntries(a.tickers.map((t, i) => [t, raw[i]])) })));
  const cp = o.modes.long.custom.uneven.perf;
  const custMean = scoreCells(r, "mean")[3] ?? "";
  const custSharpe = scoreCells(r, "sharpe")[3] ?? "";
  check(custMean === format(cp.mu, "pct2") && custSharpe.startsWith(format(cp.sharpe, "num3")), "tab: the custom weights score in the scorecard", `${custMean} ${custSharpe}`);
  check(!/still equal weights/.test(text(sectionOf(r, "scorecard"))), "tab: moved custom weights are not called equal");
  const cw = M.customWeights(a, Object.fromEntries(a.tickers.map((t, i) => [t, raw[i]]))).w;
  const cm = M.portRow(a, cw);
  const wtbl = sectionOf(r, "holdings").querySelector(".tbl");
  const at = [...wtbl.querySelectorAll("thead th")].map(text).indexOf("Custom");
  const wcells = [...wtbl.querySelectorAll("tbody tr")].map((tr) => text(tr.children[at]));
  check(at > 0 && wcells.join() === cw.map((x) => format(x, "pct2")).join() && wcells.join() !== a.ew.map((x) => format(x, "pct2")).join(),
    "tab: a typed mix's weights, scaled to 100%, are the weights table's Custom column", wcells.join(" "));
  check(text(r.container.querySelector("#build-frontier .card-sub")).includes(format(cm.mu, "pct2")), "tab: moved custom weights, and the frontier's sub-line reads the new mix");
  r.unmount();
}

// short-bounds-copy: with shorting on the tab states the box, as the frontier's caption does.
{
  check(/unconstrained frontier/i.test(lines(747, 752)), "ledger:short-bounds-copy the app's shorting help calls the frontier unconstrained (750)");
  const a = fixtureAnalysis("cross", { allowShort: true });
  const r = quiet(() => render(h(Optimization, tabProps(a))));
  const fr = text(frontierOf(r));
  check(fr.includes(frontierCaption(true, a.rf, frontierData(a).cal)) && fr.includes("[\u22121, 1]"), "ledger:short-bounds-copy with shorting on, the tab's frontier caption bounds each weight to [-1, 1]", fr);
  check(text(sectionOf(r, "holdings")).includes("bounded to [\u2212100%, 100%]") && !/unconstrained/i.test(text(r.container)),
    "ledger:short-bounds-copy the weights state the bounds and nothing says unconstrained");
  check(text(r.container.querySelector(".opt-headline")).includes("with 3 short positions"), "short: the headline counts the tangency's shorts");
  check(!/NaN|undefined|Infinity/.test(text(r.container)) && r.container.querySelectorAll(".recharts-surface").length === 3, "short: the tab renders whole");
  r.unmount();
}

// ---- (d2) the rows' findings: each names figures its card then prints ----------------------------------------
// A finding is computed from the models its card draws, so every figure in it is printed in that card: the scorecard's
// Sharpe row, the weights table, the redraw strips' 10th-to-90th ranges, the risk contribution table. The scorecard's
// names the mix with the highest Sharpe ratio, which no other mix beats.
{
  const { scorecardFinding, holdingsFinding, redrawsFinding, prcFinding } = await import("../src/tabs/build.ts");
  const { solveRedraws, seedOf } = await import("../src/tabs/optimization/redraws.ts");
  const a = fixtureAnalysis("cross");
  const r = quiet(() => render(h(Optimization, tabProps(a))));
  openAll(r);
  await act(async () => void (await new Promise((res) => setTimeout(res, 30))));
  const finding = (key) => text(r.container.querySelector(`#build-${key} .more-finding`));
  const figs = (s) => s.match(/\d+\.\d+%?/g) ?? [];
  // Whole figures, never a substring of a longer one ("0.603" is not in "10.6031").
  const inCard = (key, s) => {
    const card = new Set(figs(text(sectionOf(r, key))));
    return figs(s).filter((f) => !card.has(f));
  };
  const c = M.customWeights(a, {});
  const rows = { scorecard: scorecardFinding(a, c), holdings: holdingsFinding(a), redraws: redrawsFinding(a, solveRedraws(a, seedOf(0))), prc: prcFinding(a) };
  for (const [key, want] of Object.entries(rows)) {
    const got = finding(key);
    const lost = inCard(key, got);
    check(got === want && figs(got).length >= 2 && lost.length === 0, `findings: the ${key} row's finding is its model's, and its card prints every figure in it`,
      `${got} | missing: ${lost.join(", ")}`);
  }
  // Your mix's and the benchmark's figures are their own columns' Sharpe cells, not merely somewhere on the card.
  const mine = /Your mix (\d+\.\d+)/.exec(finding("scorecard"))?.[1];
  const bench = new RegExp(String.raw`${a.benchLabel} (\d+\.\d+)`).exec(finding("scorecard"))?.[1];
  const sc = scoreCells(r, "sharpe");
  check(!!mine && !!bench && sc[3]?.startsWith(mine) && sc[4]?.startsWith(bench), "findings: the scorecard's Your mix and benchmark figures are those columns' Sharpe ratios",
    `${mine} ${bench} | ${sc.join(" | ")}`);
  const sharpes = [a.ew, a.gmv.w, a.tangency.w].map((w) => M.portRow(a, w).sharpe);
  const top = Number(/Highest Sharpe: [^,]+, (\d+\.\d+)/.exec(finding("scorecard"))?.[1]);
  check(Number.isFinite(top) && sharpes.every((x) => x <= top + 5e-4), "findings: the scorecard's names the highest Sharpe ratio among the mixes", `${top} vs ${sharpes.join(", ")}`);
  const range = /spans (\d+\.\d+%) to (\d+\.\d+%)/.exec(finding("redraws"));
  const widths = [...r.container.querySelectorAll(".opt-strip-range")].map((x) => text(x).match(/(\d+\.\d+)%/g)).filter((m) => m?.length === 2).map((m) => parseFloat(m[1]) - parseFloat(m[0]));
  check(!!range && widths.length === a.tickers.length && parseFloat(range[2]) - parseFloat(range[1]) >= Math.max(...widths) - 1e-9,
    "findings: the redraws' names the widest 10th-to-90th range of any asset", `${finding("redraws")} | ${widths.join(", ")}`);
  r.unmount();
}

// ---- (e) in-sample: what the tab says about weights chosen with the prices they are scored on ------------
{
  const { FITTED } = await import("../src/tabs/caption.ts");
  const { PUBLISHED_URL } = await import("../src/content/published.ts");
  const a = fixtureAnalysis("cross");
  const calls = [];
  const props = tabProps(a, { requestSettings: (p) => calls.push(p) });
  const r = quiet(() => render(h(Optimization, props)));
  openAll(r);
  const head = M.headline(a);
  check(head.startsWith("With hindsight, ") && head.includes(", for an in-sample Sharpe of ") && head.endsWith(`; ${M.SENSITIVITY_POINTER}.`) &&
    text(r.container.querySelector(".opt-headline")) === head,
    "in-sample: the headline says with hindsight and in-sample, and points at the Sensitivity tab", head);
  // Every GMV and Tangency head in a table carries the sub-line; Equal-Weight, Custom and the benchmark do not
  // (the scorecard's Custom head may say instead that its weights are equal, which is not the fitted line).
  const own = (th) => (th.firstChild?.nodeType === 3 ? th.firstChild.textContent : text(th)).trim();
  const heads = [...r.container.querySelectorAll(".tbl thead th, .tbl tbody th")].map((th) => ({ own: own(th), sub: th.querySelector(".tbl-sub") ? text(th.querySelector(".tbl-sub")) : null }));
  const fitted = heads.filter((x) => /^(GMV|Tangency)\b/.test(x.own));
  const plain = heads.filter((x) => /^(Equal-Weight|Custom|S&P 500)/.test(x.own));
  // Ten: the scorecard's two heads, the weights table's two and the risk contribution table's six. The summary
  // comparison's two rows went with it; the scorecard carries its figures.
  check(fitted.length === 10 && fitted.every((x) => x.sub === FITTED) && plain.length >= 3 && plain.every((x) => x.sub === null || (x.own === "Custom" && x.sub !== FITTED)),
    "fitted-heads: every GMV and Tangency head in the tab's tables says weights chosen on this window, and no Equal-Weight head does",
    heads.map((x) => `${x.own}=${x.sub}`).join(" | "));
  const scHeads = [...r.container.querySelectorAll("#build-scorecard .tbl.sc thead th[data-col]")].slice(0, 3)
    .map((th) => [th.getAttribute("data-col"), th.querySelector(".tbl-sub, .sc-sub") ? text(th.querySelector(".tbl-sub, .sc-sub")) : null]);
  check(JSON.stringify(scHeads) === JSON.stringify([["ew", null], ["gmv", FITTED], ["tangency", FITTED]]),
    "fitted-heads: the scorecard's GMV and Tangency heads carry it, and its Equal-Weight head does not", JSON.stringify(scHeads));
  const notes = r.container.querySelectorAll('[data-note="in-sample"]');
  const link = notes[0]?.querySelector("a");
  check(notes.length === 1 && link && link.getAttribute("href") === PUBLISHED_URL && PUBLISHED_URL === "https://masonjbennett.com/projects#portfolio-method" &&
    /in-sample/.test(text(notes[0])) && /what happened next/.test(text(notes[0])),
    "fitted-heads: one note says reviews like this print in-sample figures and links the walk-forward on the method card", notes[0] ? text(notes[0]) : "none");
  // Inside the page the same words open the Walk-forward tab on the published test instead of leaving it.
  {
    const { TabContext } = await import("../src/state/useWorkbench.ts");
    const went = [];
    const ctx = { view: "basket", setTab: (t, v) => went.push(`${t}:${v}`), rfHistory: { basis: "window", series: null, loading: false } };
    const inPage = quiet(() => render(h(TabContext.Provider, { value: ctx }, h(Optimization, props))));
    openAll(inPage);
    const note = inPage.container.querySelector('[data-note="in-sample"]');
    const open = note?.querySelector("button.text-button");
    if (open) open.click();
    check(!!open && text(open) === "The walk-forward test" && !note.querySelector("a") && went.join() === "walkforward:published" &&
      text(note) === text(notes[0]),
      "fitted-heads: in the page the note's words switch to the Walk-forward tab on the published test, and the note reads the same",
      `${went.join()} / ${note ? text(note) : "none"}`);
    inPage.unmount();
  }
  const wt = M.weightTable(a).value;
  check(csvText(wt.columns, wt.rows).split("\n")[0] === "Asset,GMV,Tangency,Equal-Weight",
    "fitted-heads: the weights CSV keeps the app's plain header; the note is the page's", csvText(wt.columns, wt.rows).split("\n")[0]);
  check(JSON.stringify(M.fittedHeads(M.weightTable({ ...a, gmv: null }).value)) === JSON.stringify(["Tangency"]),
    "fitted-heads: a failed GMV column chose nothing and carries nothing");

  // Every table says which window and which frequency.
  // The Your mix panel's typed weights claim no window (t-tables); the chapter's three tables each do.
  const spans = tablesOf(r).filter((t) => !t.closest(".build-mix")).map((t) => text(t.querySelector(".tbl-span")));
  check(spans.length === 3 && spans.every((s) => s === `Daily returns, ${a.dates[0]} to ${a.asOf}`),
    "spans: every table's caption states its window and that the returns are daily", spans.join(" | "));

  // The starting amount is not edited here any more (Performance's growth card has the field); it still reaches
  // the scorecard's workbook, and nothing on the chapter asks for it.
  check(!r.container.querySelector(".amount-field input") && calls.length === 0, "amount: Build has no amount field and asks for no setting at rest");
  r.unmount();
}

HTMLElement.prototype.getBoundingClientRect = rect;
done("t-tab-optimization");
