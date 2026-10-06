// The Portfolio Optimization tab (src/tabs/Optimization.tsx, src/tabs/optimization/), portfolio_app.py
// 1467-1703.
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
//     frontier's closest-point hover is the shared chart's, held by t-charts-portfolio and t-tab-custom.
// (d) The whole tab rendered in jsdom: the headline, four charts drawn, three tables with both
//     downloads, no NaN, series named in the charts, and the level switch changing the tooltip text.
import { act, render, text } from "./_dom.mjs";
import { readFileSync } from "node:fs";
import { check, near, nearAll, maxAbsDiff, json, done } from "./_assert.mjs";
import { fixtureAnalysis, tabProps } from "./_analysis.mjs";

const { createElement: h } = await import("react");
const M = await import("../src/tabs/optimization/model.ts");
const Optimization = (await import("../src/tabs/Optimization.tsx")).default;
const { frontierCaption, frontierData } = await import("../src/charts/Frontier.tsx");
const { CUSTOM_COVERS, wealthCaption, wealthData, wealthPlot } = await import("../src/charts/Wealth.tsx");
const { format, DASH, MINUS } = await import("../src/format.ts");
const { tokens } = await import("../src/styles/tokens.ts");
const { ROLE } = await import("../src/charts/theme.ts");
const { contrastRatio, TEXT_AA } = await import("../src/charts/contrast.ts");
const { csvText, cellFor } = await import("../src/download.ts");
const { tipText } = await import("../src/content/tooltips.ts");
const { riskContribution } = await import("../src/lib/portfolio.ts");

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
    const t0 = M.tiles(ao);
    check(JSON.stringify(t0.map((t) => t.title)) === JSON.stringify(["Equal-Weight Portfolio (1/N)", "Global Min Variance", "Max Sharpe (Tangency)"]),
      tag("tiles in the app's order, under its headings (1505, 1517, 1524)"));
    [["ew", 0], ["gmv", 1], ["tan", 2]].forEach(([k, i]) => {
      for (const f of FIELDS) near(tag(`tile ${k} ${f} (oracle weights)`), t0[i].row[f], E.perf[k][f], REL);
    });
    // The app's Max DD path starts a day in (904-908); the port's at the amount invested. On these sets
    // no portfolio's worst fall starts on day one, so the two agree, and the model reaches the app's too.
    near(tag("GMV Max DD, the app's path reproduced"), M.portRow(ao, E.shipping.gmv.x, false).mdd, E.perf.gmv.mdd, REL);

    const sum = ready(M.summaryTable(ao, M.customWeights(ao, {})), tag("summary"));
    check(JSON.stringify(sum.rows.map((r) => r.portfolio)) === JSON.stringify(["Equal-Weight", "GMV", "Tangency", "Custom", o.benchLabel]),
      tag("summary rows in the app's order, the benchmark last under its display name (1681, 1689)"), sum.rows.map((r) => r.portfolio).join());
    check(JSON.stringify(sum.columns.map((c) => c.label)) === JSON.stringify(["Portfolio", "Ann. Return", "Ann. Volatility", "Sharpe", "Sortino", "Max DD"]),
      tag("summary columns in the app's order (1687-1688)"));
    [["ew", 0], ["gmv", 1], ["tan", 2]].forEach(([k, i]) => {
      for (const f of FIELDS) near(tag(`summary ${k} ${f}`), sum.rows[i][f], E.perf[k][f], REL);
    });
    // Before tab 5 is touched, Custom is 1/n (1581): the dump's default custom row.
    for (const f of FIELDS) near(tag(`summary default Custom ${f}`), sum.rows[3][f], E.custom.default.perf[f], 1e-11);
    for (const f of FIELDS) near(tag(`summary benchmark ${f}`), sum.rows[4][f], o.bench[f], REL);

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
      tag("the wealth title reads the same ends the shared chart draws"));

    // T1 / T2: the port's own exact solves, at t-parity.mjs's tiers.
    const t = M.tiles(a);
    const oVol = E.shipping.gmv.fun;
    check(t[1].row.sigma <= oVol * (1 + 1e-9) && t[1].row.sigma >= oVol * (1 - 2e-4), tag("GMV tile volatility: no worse than the app's, within 2e-4"), `${t[1].row.sigma} vs ${oVol}`);
    const oSh = -E.shipping.tan.fun;
    check(t[2].row.sharpe >= oSh - 1e-9 && t[2].row.sharpe <= oSh + 5e-6, tag("Tangency tile Sharpe: no worse than the app's, within 5e-6"), `${t[2].row.sharpe} vs ${oSh}`);
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
  const su = ready(M.summaryTable(aL, cu), `${set}: summary with uneven custom`);
  for (const f of FIELDS) near(`${set}: uneven Custom ${f}`, su.rows[3][f], cU.perf[f], 1e-11);
  const aS = fixtureAnalysis(set, { allowShort: true });
  for (const k of ["negTotal", "tinyTotal"]) {
    const e = o.modes.short.custom[k];
    const c = M.customWeights(aS, Object.fromEntries(aS.tickers.map((t, i) => [t, e.raw[i]])));
    check(e.w.some((x, i) => Math.abs(x) > 1 || Math.sign(x) !== Math.sign(e.raw[i])),
      `${set}: the app's ${k} custom weights flip sign or leave the [-1, 1] box (1582-1584)`, JSON.stringify(e.w));
    const s = ready(M.summaryTable(aS, c), `${set}: summary with ${k} custom`);
    check(!c.ok && s.rows[3].portfolio === "Custom (not shown)" && FIELDS.every((f) => s.rows[3][f] === null),
      `${set}: the port refuses the ${k} custom weights and prints no figures for them`, JSON.stringify(s.rows[3]));
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
  check(M.headline(a) === "With hindsight, the maximum-Sharpe portfolio holds 54.2% GLD and 45.8% VTI, for an in-sample Sharpe of 0.946 against 0.597 for equal weights; the Sensitivity tab shows how much that depends on the window.",
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

  // Wealth title: the highest line, then the benchmark; a bad amount falls back, never "NaN".
  const ends = M.wealthEnds(a, null, 10000);
  const best = ends.reduce((x, y) => (y.end > x.end ? y : x));
  const hind = ["GMV", "Tangency"].includes(best.label) ? " with hindsight weights" : "";
  check(M.wealthTitle(a, null, 10000) === `${best.label} ended highest, at ${format(best.end, "usd0")} from $10,000${hind}; the S&P 500 ended at ${format(ends.at(-1).end, "usd0")}`,
    "wealth title: the highest line and the benchmark", M.wealthTitle(a, null, 10000));
  check(M.wealthTitle(a, null, NaN) === "Portfolio Comparison: Cumulative Wealth", "wealth title: an unusable amount prints no figure");

  // Max DD from the amount invested, as the tiles' note says: a 30% fall on the first day counts. The
  // app's path starts at 1 + r1 (904-908) and does not see it.
  const dayOne = { ...a, returns: a.returns.map((r) => [-0.6, ...r.slice(1)]), bench: [-0.6, ...a.bench.slice(1)] };
  const tileDD = M.tiles(dayOne)[0].row.mdd;
  check(tileDD <= -0.6 + 1e-12 && M.portRow(dayOne, dayOne.ew, false).mdd > -0.6, "tiles: Max DD counts a 60% fall on the first day; the app's path would not",
    `${tileDD} vs ${M.portRow(dayOne, dayOne.ew, false).mdd}`);
  const benchDD = ready(M.summaryTable(dayOne, M.customWeights(dayOne, {})), "summary, a first-day fall").rows[4].mdd;
  check(benchDD <= -0.6 + 1e-12, "summary: the benchmark's Max DD counts its first-day fall too", String(benchDD));

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
const sectionOf = (r, id) => r.container.querySelector(`section[aria-labelledby="${id}"]`);
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
  const t = M.tiles(a)[2];
  check(t.row === null && t.failed === M.FAILED.tangency, "ledger:failed-tangency the port's Tangency tile holds no figure and says it failed");
  const r = quiet(() => render(h(Optimization, tabProps(a))));
  const tiles = sectionOf(r, "opt-tiles");
  const tanTile = tiles?.querySelector('[data-port="tangency"]');
  check(tanTile && text(tanTile).includes("Tangency failed") && tanTile.querySelectorAll(".plate-na").length === 5,
    "ledger:failed-tangency the tiles say Tangency failed, five plates not available", tanTile ? text(tanTile) : "none");
  check(tanTile && !text(tanTile).includes(format(ew.mu, "pct2")) && !text(tanTile).includes(format(ew.sharpe, "num3")), "ledger:failed-tangency no equal-weight stand-in under the Tangency heading");
  const weights = sectionOf(r, "opt-weights");
  const wtbl = weights?.querySelector(".tbl");
  check(weights && text(weights).includes("Tangency failed") && wtbl && [...wtbl.querySelectorAll("thead th")].map(text).includes("Tangency (failed)"),
    "ledger:failed-tangency the weights say Tangency failed, its column labelled failed");
  check(wtbl && rowCells(wtbl, 0)[2] === DASH, "ledger:failed-tangency the failed column prints a dash, no weight", wtbl ? rowCells(wtbl, 0).join(" ") : "");
  const summary = sectionOf(r, "opt-summary");
  const stbl = summary?.querySelector(".tbl");
  const tanRow = stbl ? rowCells(stbl, 2) : [];
  check(summary && text(summary).includes("Tangency failed") && tanRow[0] === "Tangency (failed)" && tanRow.slice(1).every((c) => c === DASH),
    "ledger:failed-tangency the summary says Tangency failed, its row all dashes", tanRow.join(" "));
  check(!/NaN|undefined|Infinity/.test(text(r.container)), "failed tangency: no NaN, undefined or Infinity on the tab");
  check(r.container.querySelectorAll(".recharts-surface").length === 4, "failed tangency: the four charts still draw, without a tangency", `${r.container.querySelectorAll(".recharts-surface").length}`);
  check(text(sectionOf(r, "opt-frontier")).includes("Tangency failed"), "failed tangency: the frontier's caption says so too");
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
    r = quiet(() => render(h(Optimization, tabProps(broken))));
  } catch (err) {
    check(false, "ledger:boundary a failing section stays inside its own boundary", err.message);
  }
  if (r) {
    const fallback = [...r.container.querySelectorAll(".boundary")].map(text);
    check(JSON.stringify(fallback) === JSON.stringify(["Efficient frontier could not be shown."]), "ledger:boundary the failed section is one line naming it", fallback.join(" | "));
    check(!!r.container.querySelector(".opt-headline") && r.container.querySelectorAll(".recharts-surface").length === 3 && tablesOf(r).length === 4,
      "ledger:boundary the headline, the other three charts and all four tables still render");
    r.unmount();
  }
  // A failed GMV: said in every place its figures would be, and the tab still renders.
  const g = { ...a, gmv: null, frontier: [] };
  const rg = quiet(() => render(h(Optimization, tabProps(g))));
  const gt = sectionOf(rg, "opt-tiles")?.querySelector('[data-port="gmv"]');
  check(gt && text(gt).includes("GMV failed") && gt.querySelectorAll(".plate-na").length === 5 && text(sectionOf(rg, "opt-summary")).includes("GMV failed"),
    "a failed GMV is said in the tiles and the summary, with no figures");
  check(!/NaN|undefined|Infinity/.test(text(rg.container)) && rg.container.querySelectorAll(".boundary").length === 0, "a failed GMV breaks no section");
  rg.unmount();
}

// numeric-downloads, the tab half: the app's summary is f-strings (1686-1694), so its downloads are text.
{
  const src = lines(1678, 1695);
  check(/"Ann\. Return": f"\{mu_p:\.2%\}"/.test(src) && /"Sharpe": f"\{sh_p:\.3f\}"/.test(src) && /comp_df = pd\.DataFrame\(comp_data\)\.T/.test(src),
    "ledger:numeric-downloads the app's summary cells are formatted strings, so its CSV and Excel hold text (1686-1695)");
  const a = fixtureAnalysis("cross");
  const s = ready(M.summaryTable(a, M.customWeights(a, {})), "summary");
  const csv = csvText(s.columns, s.rows).split("\n");
  check(csv[0] === "Portfolio,Ann. Return,Ann. Volatility,Sharpe,Sortino,Max DD" && csv[1] === `Equal-Weight,${s.rows[0].mu},${s.rows[0].sigma},${s.rows[0].sharpe},${s.rows[0].sortino},${s.rows[0].mdd}` && String(s.rows[0].mu).length > 8,
    "ledger:numeric-downloads the port's summary CSV holds the full numbers", csv[1]);
  const cell = cellFor(s.rows[0].mu, s.columns[1]);
  const sh = cellFor(s.rows[0].sharpe, s.columns[3]);
  check(cell?.t === "n" && cell.v === s.rows[0].mu && cell.z === "0.00%" && sh?.t === "n" && sh.z === "0.000",
    "ledger:numeric-downloads the port's Excel cells are numbers, formatted 0.00% and 0.000", `${JSON.stringify(cell)} ${JSON.stringify(sh)}`);
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
  const sum = sectionOf(r, "opt-summary").querySelector(".tbl");
  const ewSharpe = M.portRow(b, b.ew).sharpe;
  check(rowCells(sum, 0)[3] === format(ewSharpe, "num3") && format(ewSharpe, "num3") !== format(M.portRow(a, a.ew).sharpe, "num3"),
    "ledger:rf-live the summary's Sharpe follows a new rate at once", rowCells(sum, 0).join(" "));
  check(text(sectionOf(r, "opt-frontier")).includes("from the 5.00% risk-free rate") && text(sectionOf(r, "opt-tiles")).includes("5.00% risk-free rate"),
    "ledger:rf-live the frontier's line and the tiles use the new rate");
  check(text(r.container.querySelector(".opt-headline")) === M.headline(b) && M.headline(b) !== M.headline(a), "ledger:rf-live the headline is recomputed at the new rate");
  r.unmount();
}

// ---- (d) the tab, rendered ------------------------------------------------------------------------------
{
  const o = oracle("cross");
  const a = fixtureAnalysis("cross");
  const props = tabProps(a);
  const r = quiet(() => render(h(Optimization, props)));
  const all = text(r.container);
  check(!/NaN|undefined|Infinity|\bnan\b/.test(all), "tab: no NaN, undefined or Infinity anywhere on it");
  const head = r.container.querySelector(".opt-headline");
  check(head && text(head) === M.headline(a) && text(head).startsWith("With hindsight, the maximum-Sharpe portfolio holds 54.2% GLD"), "tab: the headline is on it, literal", head ? text(head) : "none");
  // The hero chart comes right after the headline.
  const order = [...r.container.querySelectorAll(".opt-headline, section[aria-labelledby]")].map((e) => e.getAttribute("aria-labelledby") ?? "headline");
  check(JSON.stringify(order) === JSON.stringify(["headline", "opt-frontier", "opt-tiles", "opt-weights", "opt-scorecard", "opt-prc", "opt-wealth", "opt-summary"]),
    "tab: headline, the frontier, then the figures, weights, scorecard, risk contribution, wealth and summary", order.join(" "));
  check(r.container.querySelectorAll(".recharts-surface").length === 4, "tab: all four charts are drawn", `${r.container.querySelectorAll(".recharts-surface").length}`);
  check(r.container.querySelectorAll(".recharts-legend-wrapper").length === 0, "tab: no legend, the series are named in the charts");

  // Every table, and each carries both downloads (downloads-everywhere, the tab half).
  const tables = tablesOf(r);
  const captions = tables.map((t) => text(t.querySelector("caption .tbl-title")));
  check(JSON.stringify(captions) === JSON.stringify(["Portfolio weights", "Scorecard", "Weight, return and risk contribution", "Summary comparison"]), "tab: its four tables", captions.join(" | "));
  check(tables.length === 4 && tables.every((t) => {
    const b = [...t.querySelectorAll("button")].map(text);
    return b.includes("Download CSV") && b.includes("Download Excel");
  }), "ledger:downloads-everywhere every table on the tab has a CSV and an Excel download");
  check(!/download_button/.test(lines(1553, 1573)) && (lines(1543, 1551).match(/download_button/g) ?? []).length === 2 && (lines(1697, 1703).match(/download_button/g) ?? []).length === 2,
    "ledger:downloads-everywhere the app gives the weights and the summary two downloads each (1548-1551, 1700-1703) and the risk contribution none (1555-1572)");
  const prcSec = sectionOf(r, "opt-prc");
  check(prcSec && [...prcSec.querySelectorAll(".tbl button")].map(text).join() === "Download CSV,Download Excel", "ledger:downloads-everywhere the port's risk contribution table has both");
  check(r.container.querySelectorAll("table").length === 4 && r.container.querySelectorAll(".tbl.sc table").length === 1,
    "tab: no table outside the Table and Scorecard components");

  // Printed cells: the summary's Equal-Weight row at the app's formats, from the oracle's own figures.
  const sumCells = rowCells(tables[3], 0);
  const e = o.modes.long.perf.ew;
  check(JSON.stringify(sumCells) === JSON.stringify(["Equal-Weight", format(e.mu, "pct2"), format(e.sigma, "pct2"), format(e.sharpe, "num3"), format(e.sortino, "num3"), format(e.mdd, "pct2")]),
    "tab: the Equal-Weight summary row prints the oracle's figures at the app's formats", sumCells.join(" "));
  check(rowCells(tables[3], 4)[0] === "S&P 500" && rowCells(tables[3], 4)[3] === format(o.bench.sharpe, "num3"), "tab: the benchmark row, under its display name");
  const ewPlates = [...sectionOf(r, "opt-tiles").querySelector('[data-port="ew"]').querySelectorAll(".plate-value")].map(text);
  check(JSON.stringify(ewPlates) === JSON.stringify([format(e.mu, "pct2"), format(e.sigma, "pct2"), format(e.sharpe, "num3"), format(e.sortino, "num3"), format(e.mdd, "pct2")]),
    "tab: the Equal-Weight plates print the oracle's figures", ewPlates.join(" "));

  // Series named in the charts.
  const svgText = (id) => text(sectionOf(r, id).querySelector(".recharts-surface"));
  check(["GMV", "Tangency", "Equal-Weight"].every((s) => svgText("opt-weights").includes(s)), "tab: the weights chart names its three series on the bars", svgText("opt-weights"));
  check(["Weight", "Return share", "Risk share"].every((s) => svgText("opt-prc").includes(s)), "tab: the share chart names its three series on the bars", svgText("opt-prc"));
  // Bronze text measures 3.6:1 on paper, under WCAG AA's 4.5:1: Tangency's bars stay bronze, their name is ink2.
  const bn = ["opt-weights", "opt-prc"].flatMap((id) => [...sectionOf(r, id).querySelectorAll(".opt-bar-name")].map((n) => ({ text: n.textContent, fill: n.getAttribute("fill") })));
  const nameFill = (s) => bn.find((n) => n.text === s)?.fill;
  const tanBars = [...sectionOf(r, "opt-weights").querySelectorAll(".recharts-bar-rectangle path")].filter((p) => p.getAttribute("fill") === ROLE.tangency);
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
  const tanRow = rowColour("opt-weights", ROLE.tangency);
  const gmvRow = rowColour("opt-weights", ROLE.gmv);
  const retRow = rowColour("opt-prc", ROLE.frontier);
  check(tanRow === `Tangency=${rgb(tokens.color.ink2)}` && gmvRow === `GMV=${rgb(ROLE.gmv)}` && retRow === `Return share=${rgb(ROLE.frontier)}`,
    "tab: hovering a bar names it alone, Tangency in ink2, GMV in its teal and a return share in navy", `${tanRow} | ${gmvRow} | ${retRow}`);
  check([...a.tickers, "GMV", "Tangency", "Equal-Weight", "Custom", "S&P 500"].every((s) => svgText("opt-frontier").includes(s)), "tab: the frontier names every asset and portfolio in the chart");
  check(/still equal weights/.test(text(sectionOf(r, "opt-summary"))), "tab: untouched custom weights are said to repeat Equal-Weight");
  const wsub = () => text(sectionOf(r, "opt-wealth").querySelector(".chart-sub"));
  check(wsub().endsWith(` ${CUSTOM_COVERS}`), "tab: untouched custom weights, and the wealth caption says Custom's line covers Equal-Weight's", wsub());

  // The tab hands the shared charts what their suites hold them to.
  const fcap = text(sectionOf(r, "opt-frontier").querySelector(".chart-sub"));
  check(fcap.includes(frontierCaption(a.allowShort, a.rf, frontierData(a).cal)), "tab: the shared Frontier's caption states the analysis's own bounds and rate", fcap);
  const wcap = text(sectionOf(r, "opt-wealth"));
  check(wcap.includes(wealthCaption(props.settings.amount, a.prices.dates[0], a.asOf)) && /rebalanced daily/.test(wcap),
    "ledger:daily-rebalanced-label the tab's wealth chart says each portfolio is rebalanced daily", wcap);
  check(!/rebalanc/i.test(lines(1660, 1674)), "ledger:daily-rebalanced-label the app's wealth chart does not say so (1660-1674)");
  check(/rebalanced daily/.test(text(sectionOf(r, "opt-tiles"))), "ledger:daily-rebalanced-label the tiles say the weights are held fixed, rebalanced daily");
  check(!/\[\u22121, 1\]|\u2212100%/.test(all), "ledger:short-bounds-copy long-only, the tab says nothing about [-1, 1] bounds");

  // The level switch changes the tooltip text.
  const tipOf = () => r.container.querySelector("button[aria-label='About annual return']")?.parentElement.querySelector("[role=tooltip]");
  const plain = tipOf() ? text(tipOf()) : "";
  quiet(() => r.rerender(h(Optimization, { ...props, level: "formula" })));
  const formula = tipOf() ? text(tipOf()) : "";
  check(plain === tipText("return", "plain") && formula === tipText("return", "formula") && plain !== formula, "tab: the level switch changes the tooltip text", `${plain} / ${formula}`);
  const mddTip = r.container.querySelector("button[aria-label='About maximum drawdown']")?.parentElement.querySelector("[role=tooltip]");
  check(mddTip && text(mddTip) === tipText("max_dd", "formula"), "tab: the Max DD tip follows the level too");

  // Custom weights from the Custom tab reach the frontier, the wealth chart and the summary (1581).
  const raw = o.modes.long.custom.uneven.raw;
  quiet(() => r.rerender(h(Optimization, { ...props, weights: Object.fromEntries(a.tickers.map((t, i) => [t, raw[i]])) })));
  const cust = rowCells(tablesOf(r)[3], 3);
  const cp = o.modes.long.custom.uneven.perf;
  check(cust[0] === "Custom" && cust[1] === format(cp.mu, "pct2") && cust[3] === format(cp.sharpe, "num3"), "tab: the custom weights score in the summary", cust.join(" "));
  check(!/still equal weights/.test(text(sectionOf(r, "opt-summary"))), "tab: moved custom weights are not called equal");
  check(!wsub().includes(CUSTOM_COVERS) && wsub().endsWith(" whole period's prices."), "tab: moved custom weights, and the wealth caption no longer says Custom covers Equal-Weight", wsub());
  r.unmount();
}

// A custom mix that ends highest leads the wealth chart's title (the custom line is passed through).
{
  const a = fixtureAnalysis("megacap");
  const props = tabProps(a, { weights: Object.fromEntries(a.tickers.map((t) => [t, t === "NVDA" ? 1 : 0])) });
  const r = quiet(() => render(h(Optimization, props)));
  const w = M.customWeights(a, props.weights);
  const title = text(sectionOf(r, "opt-wealth").querySelector(".chart-title"));
  check(w.ok && title === M.wealthTitle(a, w.w, props.settings.amount) && title.startsWith("Custom ended highest"), "tab: a custom mix that ends highest leads the wealth title", title);
  check(!/hindsight/.test(title), "in-sample: a custom mix that ends highest was typed, not chosen with hindsight, and the title does not say it was", title);
  check(text(sectionOf(r, "opt-wealth").querySelector(".recharts-surface")).includes("Custom"), "tab: the wealth chart draws the custom line");
  r.unmount();
}

// short-bounds-copy: with shorting on the tab states the box, as the frontier's caption does.
{
  check(/unconstrained frontier/i.test(lines(747, 752)), "ledger:short-bounds-copy the app's shorting help calls the frontier unconstrained (750)");
  const a = fixtureAnalysis("cross", { allowShort: true });
  const r = quiet(() => render(h(Optimization, tabProps(a))));
  const fr = text(sectionOf(r, "opt-frontier"));
  check(fr.includes(frontierCaption(true, a.rf, frontierData(a).cal)) && fr.includes("[\u22121, 1]"), "ledger:short-bounds-copy with shorting on, the tab's frontier caption bounds each weight to [-1, 1]", fr);
  check(text(sectionOf(r, "opt-weights")).includes("bounded to [\u2212100%, 100%]") && !/unconstrained/i.test(text(r.container)),
    "ledger:short-bounds-copy the weights state the bounds and nothing says unconstrained");
  check(text(r.container.querySelector(".opt-headline")).includes("with 3 short positions"), "short: the headline counts the tangency's shorts");
  check(!/NaN|undefined|Infinity/.test(text(r.container)) && r.container.querySelectorAll(".recharts-surface").length === 4, "short: the tab renders whole");
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
  const head = M.headline(a);
  check(head.startsWith("With hindsight, ") && head.includes(", for an in-sample Sharpe of ") && head.endsWith(`; ${M.SENSITIVITY_POINTER}.`) &&
    text(r.container.querySelector(".opt-headline")) === head,
    "in-sample: the headline says with hindsight and in-sample, and points at the Sensitivity tab", head);
  const title = text(sectionOf(r, "opt-wealth").querySelector(".chart-title"));
  check(title.startsWith("Tangency ended highest") && title.includes(" with hindsight weights;"),
    "in-sample: a Tangency line that ends highest does so with hindsight weights, and the title says so", title);

  // The wealth caption: GMV and Tangency are hypothetical (then, at the default equal custom weights, Custom covers Equal-Weight).
  const wcap = text(sectionOf(r, "opt-wealth").querySelector(".chart-sub"));
  check(wcap === wealthCaption(props.settings.amount, a.prices.dates[0], a.asOf, ["GMV", "Tangency"], true) &&
    wcap.endsWith(` GMV and Tangency are hypothetical: weights chosen with the whole period's prices. ${CUSTOM_COVERS}`),
    "hypothetical: the wealth caption names GMV and Tangency as hypothetical, weights chosen with the whole period's prices", wcap);

  // Every GMV and Tangency head in a table carries the sub-line; Equal-Weight, Custom and the benchmark do not
  // (the scorecard's Custom head may say instead that its weights are equal, which is not the fitted line).
  const own = (th) => (th.firstChild?.nodeType === 3 ? th.firstChild.textContent : text(th)).trim();
  const heads = [...r.container.querySelectorAll(".tbl thead th, .tbl tbody th")].map((th) => ({ own: own(th), sub: th.querySelector(".tbl-sub") ? text(th.querySelector(".tbl-sub")) : null }));
  const fitted = heads.filter((x) => /^(GMV|Tangency)\b/.test(x.own));
  const plain = heads.filter((x) => /^(Equal-Weight|Custom|S&P 500)/.test(x.own));
  check(fitted.length === 12 && fitted.every((x) => x.sub === FITTED) && plain.length >= 3 && plain.every((x) => x.sub === null || (x.own === "Custom" && x.sub !== FITTED)),
    "fitted-heads: every GMV and Tangency head in the tab's tables says weights chosen on this window, and no Equal-Weight head does",
    heads.map((x) => `${x.own}=${x.sub}`).join(" | "));
  const tiles = [...r.container.querySelectorAll(".opt-tile")].map((t) => [t.dataset.port, t.querySelector(".opt-tile-sub") ? text(t.querySelector(".opt-tile-sub")) : null]);
  check(JSON.stringify(tiles) === JSON.stringify([["ew", null], ["gmv", FITTED], ["tangency", FITTED]]),
    "fitted-heads: the GMV and Tangency plate rows carry it, and the Equal-Weight row does not", JSON.stringify(tiles));
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
  check(JSON.stringify(M.fittedHeads(M.summaryTable({ ...a, gmv: null }, M.customWeights(a, {})).value)) === JSON.stringify(["Tangency"]),
    "fitted-heads: a failed GMV row chose nothing and carries nothing");

  // Every table says which window and which frequency.
  const spans = tablesOf(r).map((t) => text(t.querySelector(".tbl-span")));
  check(spans.length === 4 && spans.every((s) => s === `Daily returns, ${a.dates[0]} to ${a.asOf}`),
    "spans: every table's caption states its window and that the returns are daily", spans.join(" | "));

  // The starting amount is edited on the wealth chart itself.
  const input = sectionOf(r, "opt-wealth").querySelector(".amount-field input");
  const type = (v) => act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, v);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  check(!!input && input.value === "10000" && text(sectionOf(r, "opt-wealth").querySelector(".amount-field label")) === "Growth of $",
    "amount: the wealth chart carries its own Growth of $ field, at the $10,000 default");
  type("25000");
  type("50");
  const alert = sectionOf(r, "opt-wealth").querySelector(".amount-field [role=alert]");
  check(JSON.stringify(calls) === JSON.stringify([{ amount: 25000 }]) && alert && /at least \$100/.test(text(alert)),
    "amount: a valid amount on the chart becomes the setting, one under $100 is refused and says why", JSON.stringify(calls));
  r.unmount();
}

HTMLElement.prototype.getBoundingClientRect = rect;
done("t-tab-optimization");
