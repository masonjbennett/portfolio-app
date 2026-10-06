// The Sensitivity tab (src/tabs/Sensitivity.tsx, its arithmetic in src/tabs/sensitivity/model.ts),
// portfolio_app.py 1842-2021.
//
// (a) Every window re-estimated and re-optimised as the app does (1874-1901), held to the oracle's
//     dump for cross and megacap, long-only and short: the window list, each window's moments, the
//     weights (the exact solve, against the app's ftol-1e-15 re-run and within its shipped SLSQP
//     noise), the metrics fed the app's own weights, the Full Sample window = tab 4, the custom
//     portfolio on each window.
// (b) The tables' shape: weight rows in the app's pivot order, the chart in the entered order.
// (c) The sentences: the headline states the biggest swing, literally; the too-short message states
//     the rule the code applies.
// (d) The chart kit's pure parts: where the series names hang, and round ticks.
// (e) The tab rendered in jsdom: headline, every table with both downloads, the charts labelled in
//     the chart, no NaN, the level switch, the custom section.
// Ledger entries closed here (the tab's half of each): in-sample-label, downloads-everywhere,
// numeric-downloads, boundary, failed-tangency. Each asserts the app's side, read out of
// portfolio_app.py, and the port's side. daily-rebalanced-label does not apply: this tab draws no
// wealth path.
import { readFileSync } from "node:fs";
import { check, close, done, json, maxAbsDiff, near, nearAll } from "./_assert.mjs";
import { act, render, text } from "./_dom.mjs";

const { createElement: h } = await import("react");
const Sensitivity = (await import("../src/tabs/Sensitivity.tsx")).default;
const M = await import("../src/tabs/sensitivity/model.ts");
const { portfolioPerformance, windows } = await import("../src/lib/portfolio.ts");
const { tipText } = await import("../src/content/tooltips.ts");
const { csvText } = await import("../src/download.ts");
const { format, DASH, MINUS } = await import("../src/format.ts");
const { ROLE } = await import("../src/charts/theme.ts");
const { tokens } = await import("../src/styles/tokens.ts");
const { contrastRatio, TEXT_AA } = await import("../src/charts/contrast.ts");
// The series names written on the bars, with the colour each is drawn in.
const barNames = (root) => [...root.querySelectorAll(".gbars-name")].map((n) => ({ text: n.textContent, fill: n.getAttribute("fill") }));
const readable = (ns) => ns.every((n) => contrastRatio(n.fill, tokens.color.paper) >= TEXT_AA);
const { exampleAnalysis, fixtureAnalysis, tabProps } = await import("./_analysis.mjs");

const ORACLE = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8").split(/\r?\n/);
const lines = (a, b) => ORACLE.slice(a - 1, b).join("\n");
const REL = 1e-12;
const TIGHT = 1e-7; // the exact solve vs the app's ftol-1e-15 re-run; see t-parity.mjs

// The oracle's line numbers must still point where this suite reads.
check(ORACLE[1841] === "with tab6:" && /Portfolio Metrics Across Windows/.test(ORACLE[1903]) && ORACLE[1726].trim() === "st.stop()",
  "oracle: tab 6 opens at 1842, its metrics heading is at 1904, tab 5's zero-weights stop is at 1727", `${ORACLE[1841]} | ${ORACLE[1902]}`);
const TAB6 = lines(1842, 2021);

const quietly = (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};

// ---- (a) the windows against the oracle's dump --------------------------------------------------------
for (const set of ["cross", "megacap"]) {
  const o = json(new URL(`./fixtures/oracle-${set}.json`, import.meta.url));
  for (const mode of ["long", "short"]) {
    const short = mode === "short";
    const tag = (s) => `${set} ${mode}: ${s}`;
    const a = fixtureAnalysis(set, { allowShort: short });
    const OW = o.modes[mode].windows;
    const st = M.fitWindows(a);
    check(st.status === "ready", tag("windows fitted"));
    if (st.status !== "ready") continue;
    const fits = st.value;
    const T = a.dates.length;
    check(T === o.returns.rows, tag("the return rows the windows cut from"), `${T} vs ${o.returns.rows}`);
    check(JSON.stringify(fits.map((f) => [f.label, f.lb])) === JSON.stringify(OW.map((w) => [w.label, w.lb])),
      tag("window labels and lengths, in the app's order (1854-1868)"), JSON.stringify(fits.map((f) => f.label)));
    check(fits.every((f) => f.from === a.dates[T - f.lb]) && fits.at(-1).from === a.dates[0] &&
      fits.every((f, i) => i === 0 || f.from < fits[i - 1].from),
      tag("each window is the TRAILING lb rows (iloc[-lb:], 1875): nested, the full sample from the first return"));

    fits.forEach((f, k) => {
      const ow = OW[k];
      nearAll(tag(`${f.label} means`), f.m, ow.mean, REL);
      nearAll(tag(`${f.label} covariance (ddof 1)`), f.S.flat(), ow.cov.flat(), REL, 1e-20);
      check(!!f.gmv && !!f.tan, tag(`${f.label} both solves succeed`));
      if (!f.gmv || !f.tan) return;
      check(maxAbsDiff(f.gmv.w, ow.tight.gmv.x) <= TIGHT, tag(`${f.label} GMV weights = the app's tight re-run`),
        maxAbsDiff(f.gmv.w, ow.tight.gmv.x).toExponential(2));
      check(maxAbsDiff(f.tan.w, ow.tight.tan.x) <= TIGHT, tag(`${f.label} tangency weights = the app's tight re-run`),
        maxAbsDiff(f.tan.w, ow.tight.tan.x).toExponential(2));
      check(maxAbsDiff(f.gmv.w, ow.shipping.gmv.x) <= 1.5e-2 && maxAbsDiff(f.tan.w, ow.shipping.tan.x) <= 5e-3,
        tag(`${f.label} weights within the shipped app's SLSQP noise`));
    });

    // The metrics arithmetic, fed the app's OWN shipped weights: portfolio_performance on each window's
    // moments at the one rf (1884, 1893) reproduces the app's numbers.
    const withOracle = fits.map((f, k) => ({ ...f, gmv: { ...f.gmv, w: OW[k].shipping.gmv.x }, tan: { ...f.tan, w: OW[k].shipping.tan.x } }));
    for (const [p, key] of [["gmv", "gmv"], ["tan", "tan"]]) {
      const rows = M.metricRows(withOracle, p, o.rf);
      for (const f of ["mu", "sigma", "sharpe"]) {
        nearAll(tag(`${p} ${f} per window (the app's weights)`), rows.map((r) => r[f]), OW.map((w) => w.perf[key][f]), REL);
      }
    }
    // With the port's exact weights: GMV no more volatile, tangency no lower Sharpe, than the app's.
    const gRows = M.metricRows(fits, "gmv", o.rf);
    const tRows = M.metricRows(fits, "tan", o.rf);
    check(gRows.every((r, k) => r.sigma <= OW[k].perf.gmv.sigma * (1 + 1e-9)), tag("GMV volatility no worse than the app's in every window"));
    check(tRows.every((r, k) => r.sharpe >= OW[k].perf.tan.sharpe - 1e-9 && r.sharpe <= OW[k].perf.tan.sharpe + 5e-6),
      tag("tangency Sharpe matches the app's, no lower, in every window"));

    // The Full Sample window is tab 4, bit for bit (the invariant spec'd for 1874 + 1156-1169).
    const full = fits.at(-1);
    check(maxAbsDiff(full.gmv.w, a.gmv.w) === 0 && maxAbsDiff(full.tan.w, a.tangency.w) === 0, tag("Full Sample weights = tab 4's, exactly"));

    // The custom portfolio: the dump's custom weights scored on the full-sample window reproduce the
    // app's figures, and on EVERY window a fixed mix never out-scores that window's tangency (the
    // claim the page's caption makes).
    for (const [k, c] of Object.entries(o.modes[mode].custom)) {
      const weights = Object.fromEntries(a.tickers.map((t, i) => [t, c.raw[i]]));
      const cw = M.customWeights(a.tickers, weights, short);
      if (c.total <= 0.05) {
        // The app divides by whatever the raw total is (1732): -1 flips every sign, 0.01 multiplies
        // every weight by 100. The port refuses both and says why (src/lib/portfolio.ts).
        check(!cw.ok && cw.reason === "net-short", tag(`custom ${k}: the app divides by a raw total of ${c.total}; the port refuses it`), JSON.stringify(cw));
        continue;
      }
      check(cw.ok, tag(`custom ${k} normalised`));
      if (!cw.ok) continue;
      nearAll(tag(`custom ${k} weights (1966-1969)`), cw.w, c.w, REL, 1e-15);
      const rows = M.customRows(fits, cw.w, o.rf);
      for (const f of ["mu", "sigma", "sharpe"]) near(tag(`custom ${k} ${f}, full sample`), rows.at(-1)[f], c.perf[f], 1e-11);
      check(rows.length === fits.length && rows.every((r, i) => r.window === fits[i].named), tag(`custom ${k}: a row for every window (no solver, 1981)`));
      const own = rows.map((r, i) => portfolioPerformance(cw.w, fits[i].m, fits[i].S, o.rf).sharpe);
      nearAll(tag(`custom ${k} Sharpe on each window's own moments`), rows.map((r) => r.sharpe), own, 0, 0);
      check(rows.every((r, i) => r.sharpe <= tRows[i].sharpe + 1e-12), tag(`custom ${k}: never above the in-window tangency (the caption's claim)`));
      const g = M.sharpeGroups(fits, cw.w, o.rf);
      check(g.every((x, i) => x.name === fits[i].label && x.values[0] === gRows[i].sharpe && x.values[1] === tRows[i].sharpe && x.values[2] === rows[i].sharpe),
        tag(`custom ${k}: the Sharpe chart plots the table's numbers unrounded (the app parses back 3-dp strings, 2011-2013)`));
    }
  }
}

// ---- (b) table and chart order ---------------------------------------------------------------------
{
  const a = fixtureAnalysis("cross");
  const fits = M.fitWindows(a).value;
  const rows = M.weightRows(fits, "tan", a.tickers);
  check(JSON.stringify(rows.map((r) => r.ticker)) === JSON.stringify(["AGG", "EFA", "GLD", "VNQ", "VTI"]),
    "tables: weight rows in code-point order of the ticker, as the app's pivot sorts them (1920)", rows.map((r) => r.ticker).join(" "));
  check(JSON.stringify(M.weightRows(fits, "gmv", ["b", "B", "a", "A-1", "A"]).map((r) => r.ticker)) === JSON.stringify(["A", "A-1", "B", "a", "b"]),
    "tables: the sort is code point (upper case before lower, '-' before letters), never localeCompare");
  check(rows.every((r) => fits.every((f, k) => r[`w${k}`] === f.tan.w[a.tickers.indexOf(r.ticker)])), "tables: each cell is that window's raw weight for that ticker");
  const cols = M.weightColumns(fits);
  check(cols[0].key === "ticker" && cols[0].first === true && cols[0].label === "Ticker" &&
    cols.slice(1).every((c, k) => c.label === fits[k].label && c.format === "pct2"),
    "tables: Ticker first, then a column per window headed with the app's label (the CSV header at 1930)");
  const g = M.weightGroups(fits, "gmv", a.tickers);
  check(JSON.stringify(g.map((x) => x.name)) === JSON.stringify(a.tickers) && g.every((x, i) => x.values.every((v, k) => v === fits[k].gmv.w[i])),
    "chart: a group per ticker in the entered order (1939), a bar per window");
  const failed = fits.map((f, k) => (k === 1 ? { ...f, tan: null } : f));
  const fr = M.metricRows(failed, "tan", a.rf);
  check(fr[1].mu === null && fr[1].sigma === null && fr[1].sharpe === null && fr[1].window === fits[1].named && fr[0].sharpe !== null,
    "tables: a window whose solve failed keeps its row, as dashes (the app drops it silently, 1891)");
  check(JSON.stringify(M.failedWindows(failed, "tan")) === JSON.stringify([fits[1].label]) && M.tableState(failed, "tan", fr).status === "ready",
    "tables: the failed window is named, and the table still shows");
  check(M.weightRows(failed, "tan", a.tickers).every((r) => r.w1 === null) && M.weightGroups(failed, "tan", a.tickers).every((x) => x.values[1] === null),
    "tables: its weight cells and bars are empty, never a stand-in");
}

// ---- (c) the sentences --------------------------------------------------------------------------------
{
  const a = fixtureAnalysis("cross");
  const fits = M.fitWindows(a).value;
  // The swing re-derived here, independently: the ticker whose weight has the widest range.
  const widest = (p) => {
    let best = null;
    a.tickers.forEach((t, i) => {
      const vs = fits.map((f) => (p === "gmv" ? f.gmv : f.tan).w[i]);
      const r = Math.max(...vs) - Math.min(...vs);
      if (!best || r > best.r) best = { t, r, lo: Math.min(...vs), hi: Math.max(...vs), loW: fits[vs.indexOf(Math.min(...vs))].named, hiW: fits[vs.indexOf(Math.max(...vs))].named };
    });
    return best;
  };
  const t = widest("tan");
  const g = widest("gmv");
  const head = M.headline(fits, a.tickers);
  const want =
    `Re-estimated over 5 trailing windows, the tangency (maximum-Sharpe) portfolio's weight in ${t.t} runs from ${format(t.lo, "pct1")} (${t.loW}) ` +
    `to ${format(t.hi, "pct1")} (${t.hiW}), and the minimum-variance (GMV) portfolio's weight in ${g.t} runs from ${format(g.lo, "pct1")} (${g.loW}) ` +
    `to ${format(g.hi, "pct1")} (${g.hiW}).`;
  check(head === want, "headline: states the widest swing of each portfolio's weights, literally", `${head}\n   want ${want}`);
  check(t.t === "GLD" && g.t === "AGG", "headline: on cross, GLD moves most in the tangency and AGG in the GMV", `${t.t} ${g.t}`);
  const noTan = fits.map((f) => ({ ...f, tan: null }));
  check(/the tangency optimisation failed in every window\.$/.test(M.headline(noTan, a.tickers)), "headline: says when the tangency failed in every window");
  check(/^Neither optimisation succeeded/.test(M.headline(noTan.map((f) => ({ ...f, gmv: null })), a.tickers)), "headline: says when neither succeeded");
  const flat = fits.map((f) => ({ ...f, gmv: { ...f.gmv, w: [0.2, 0.2, 0.2, 0.2, 0.2] } }));
  check(/GMV\) portfolio holds VTI at 20\.0% in every window/.test(M.headline(flat, a.tickers)), "headline: a weight that does not move is said to hold", M.headline(flat, a.tickers));

  // The too-short rule. The app needs one year of returns (total_years >= 1 at 1855, len < 2 at 1870)
  // but says two (1871); the port says what the code does.
  check(/if total_years >= 1:/.test(lines(1855, 1855)) && /Need at least 2 years/.test(lines(1871, 1871)),
    "too short: the app tests one year (1855) and its message says two (1871)");
  const cut = (n) => ({ ...a, dates: a.dates.slice(-n), returns: a.returns.map((c) => c.slice(-n)) });
  const s251 = M.fitWindows(cut(251));
  check(s251.status === "empty" && s251.reason === M.tooShort(251) && /one year \(252 trading days\)/.test(s251.reason) && /has 251\./.test(s251.reason),
    "too short: under 252 returns there is nothing to compare, and the message states the one-year rule", JSON.stringify(s251));
  const s252 = M.fitWindows(cut(252));
  check(s252.status === "ready" && s252.value.map((f) => f.label).join() === "1 Year,Full Sample", "too short: at exactly 252 returns, 1 Year and Full Sample");
  check(windows(503).length === 2 && windows(504).length === 3, "windows: '2 Years' needs 504 returns (252 per year)");

  // Too short, rendered: the tab says why in the chart's place and draws no chart and no table.
  const s = render(h(Sensitivity, tabProps(cut(251))));
  const note = s.container.querySelector(".chart-note--empty");
  check(!!note && text(note) === M.tooShort(251) && !s.container.querySelector(".recharts-wrapper") && !s.container.querySelector("table"),
    "too short: the page shows the one-year message in the chart's place, and no chart or table", text(s.container));
  check(s.container.querySelector("h2.tab-finding")?.textContent === "No estimation window could be compared." &&
    s.container.querySelector("h1, h2, h3, h4, h5, h6") === s.container.querySelector("h2.tab-finding"),
    "too short: the tab still opens on a finding, before its section header", text(s.container).slice(0, 120));
  s.unmount();
}

// ---- (d) the chart kit's pure parts ------------------------------------------------------------------
{
  const groups = [
    { name: "A", values: [0.9, 0.8] },
    { name: "B", values: [0.1, 0.05] },
    { name: "C", values: [0.4, null] },
  ];
  const tall = M.labelLayout([{ name: "A", values: [0.9] }, { name: "B", values: [0.8] }], 60, 300);
  check(tall.host === 1 && (tall.hi - 0.8) / (tall.hi - tall.lo) >= 0.2 - 1e-12 && tall.hi > 0.9,
    "labels: when every group is tall, the range is raised above the tallest bar to make room", JSON.stringify(tall));
  const L = M.labelLayout(groups, 60, 300);
  check(L.host === 1, "labels: they hang on the group with the lowest top", JSON.stringify(L));
  check(L.lo === 0 && (L.hi - 0.1) / (L.hi - L.lo) >= 60 / 300 - 1e-12 && L.hi >= 0.9, "labels: the range leaves 60px of the 300px plot above that group, and holds every bar", JSON.stringify(L));
  const neg = M.labelLayout([{ name: "x", values: [-1.3, 0.4] }, { name: "y", values: [0.2, 1.5] }], 50, 250);
  check(neg.lo === -1.3 && neg.host === 0 && (neg.hi - 0.4) / (neg.hi - neg.lo) >= 0.2 - 1e-12, "labels: negative bars widen the range downward", JSON.stringify(neg));
  const t1 = M.niceTicks(0, 1, 100);
  check(JSON.stringify(t1.ticks) === "[0,0.2,0.4,0.6,0.8,1]" && t1.decimals === 0, "ticks: [0, 1] as 0-100% in steps of 20", JSON.stringify(t1));
  const t2 = M.niceTicks(0, 0.12, 100);
  check(t2.ticks[1] === 0.025 && t2.decimals === 1 && M.tickText(0.025, "pct", t2.decimals) === "2.5%", "ticks: a 2.5% step prints 2.5%, not 3%", JSON.stringify(t2));
  const t3 = M.niceTicks(-1.27, 1.6, 1);
  check(t3.ticks[0] <= -1.27 && t3.ticks.at(-1) >= 1.6 && t3.ticks.includes(0), "ticks: cover the range and include zero", JSON.stringify(t3));
  check(M.tickText(-0.4, "num", 1) === `${MINUS}0.4` && M.tickText(-1e-17, "pct", 0) === "0%", "ticks: a true minus, and no sign on a tick that rounds to zero");

  // Leaving off a name that cannot be placed, the last step after labelLayout. The plot as GroupedBars
  // lays it out: 4px left plus a 52px axis, 8px right, 12px top, 4px bottom and a 30px axis.
  const plotAt = (w, height = 400) => ({ x: 56, y: 12, width: w - 64, height: height - 46 });
  const five = ["1Y", "2Y", "3Y", "5Y", "Full"];
  const room = (names) => Math.max(...names.map((s) => s.length)) * 11 * 0.62 + 10;
  // Ten groups of five bars; the label group's bars rise and fall, so a name may run into a neighbour.
  const ten = Array.from({ length: 10 }, (_, g) => ({ name: `T${g}`, values: five.map((_, k) => (g === 3 ? [0.02, 0.06, 0.01, 0.05, 0.03][k] : 0.1 + 0.05 * ((g + k) % 4))) }));
  const lay = M.labelLayout(ten, room(five), 400 - 46);
  const phone = M.namesDrawn(ten, lay.host, five, plotAt(343), lay.lo, lay.hi, 11);
  const desk = M.namesDrawn(ten, lay.host, five, plotAt(928), lay.lo, lay.hi, 11);
  check(lay.host === 3 && phone.some((d) => !d) && phone.filter(Boolean).length >= 2,
    "cull: at ten groups on a phone, names that would overlap are left off and the rest drawn", phone.join());
  // On a phone each bar is 3px at a 4px pitch: two drawn names are never on neighbouring bars.
  const drawnAt = phone.flatMap((d, k) => (d ? [k] : []));
  check(drawnAt.every((k, i) => i === 0 || k - drawnAt[i - 1] >= 2), "cull: no two drawn names are on neighbouring bars", drawnAt.join());
  check(desk.every(Boolean), "cull: at a desktop's width every name is drawn", desk.join());
  // The default example: no name is left off on either chart, at a phone's width or a desktop's.
  const ex = exampleAnalysis();
  const ef = M.fitWindows(ex).value;
  const windowNames = ef.map((f) => f.short);
  const lost = [];
  const each = (g, names, w, height, unit) => {
    const L = M.labelLayout(g, room(names), height - 46);
    const tk = M.niceTicks(L.lo, L.hi, unit).ticks;
    M.namesDrawn(g, L.host, names, plotAt(w, height), tk[0], tk.at(-1), 11).forEach((d, k) => d || lost.push(`${names[k]} @${w}`));
  };
  for (const w of [343, 560, 928, 1240]) {
    for (const port of ["tan", "gmv"]) each(M.weightGroups(ef, port, ex.tickers), windowNames, w, 400, 100);
    each(M.sharpeGroups(ef, ex.tickers.map(() => 1 / ex.tickers.length), ex.rf), ["GMV", "Tangency", "Custom"], w, 380, 1);
  }
  check(ef.length === 5 && lost.length === 0, "cull: at the default example no bar name is left off on either chart, at any width", lost.join("; "));
  // On a 360px phone the chart is 328px: Recharts draws the default's bars 6px wide at a 7px pitch, under
  // the names' 8px ink, so every other window name is left off (at 343px the pitch is 8 and all are drawn).
  const narrow = [];
  for (const port of ["tan", "gmv"]) {
    const g = M.weightGroups(ef, port, ex.tickers);
    const L = M.labelLayout(g, room(windowNames), 400 - 46);
    const tk = M.niceTicks(L.lo, L.hi, 100).ticks;
    narrow.push(M.namesDrawn(g, L.host, windowNames, plotAt(328), tk[0], tk.at(-1), 11).map((d) => (d ? "on" : "off")).join(","));
  }
  check(M.barSlots((328 - 64) / 5, 5).size === 6 && narrow.every((d) => d === "on,off,on,off,on"),
    "cull: at a 360px phone the default's window names, 7px apart under 8px of ink, are drawn every other one", narrow.join(" | "));
  // A missing value draws no bar: its series has no name to leave off, is not counted, and is in no one's way.
  const gap = [{ name: "A", values: [0.1, null, 0.12, 0.08, 0.1] }, { name: "B", values: [0.3, null, 0.2, 0.25, 0.3] }];
  const gd = M.namesDrawn(gap, 0, five, plotAt(343), 0, 0.5, 11);
  check(gd[1] === null && gd.filter((d) => d === null).length === 1 && gd.filter((d) => d !== null).every((d) => typeof d === "boolean"),
    "cull: a series with no bar in the label group is neither drawn nor left off", gd.join());
}


// ---- (e) the tab rendered ----------------------------------------------------------------------------
// ResponsiveContainer measures its box; jsdom has no layout, so give chart boxes a size.
const rect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function () {
  return this.classList?.contains("recharts-responsive-container")
    ? { x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 400, width: 720, height: 400, toJSON() {} }
    : rect.call(this);
};

const buttons = (root) => [...root.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? "");
const captions = (root) => [...root.querySelectorAll("caption .tbl-title")].map(text);
const hasBoth = (root, title) => {
  const b = buttons(root);
  return b.includes(`Download CSV of ${title}`) && b.includes(`Download Excel of ${title}`);
};
const clean = (s) => !/NaN|undefined|Infinity|null/.test(s);
const svgText = (root) => [...root.querySelectorAll("svg text")].map((n) => n.textContent);

const a = fixtureAnalysis("cross");
const fits = M.fitWindows(a).value;
const r = render(h(Sensitivity, tabProps(a)));
const page = () => text(r.container);
{
  check(text(r.container.querySelector(".sens-finding") ?? r.container) === M.headline(fits, a.tickers) && page().includes(M.headline(fits, a.tickers)),
    "page: the headline sentence is the computed finding");
  const T4 = ["GMV Portfolio (in-sample)", "Tangency Portfolio (in-sample)", "GMV Weights Across Windows", "Tangency Weights Across Windows"];
  check(JSON.stringify(captions(r.container)) === JSON.stringify(T4), "page: the four tables, in order", captions(r.container).join(" | "));
  check(T4.every((t) => hasBoth(r.container, t)), "page: every table carries CSV and Excel downloads");
  check(r.container.querySelectorAll("table").length === 4, "page: every table is a Table (one <table> each)");
  check(clean(page()), "page: no NaN, undefined, Infinity or null in the text");
  check(page().includes(`Each window is the most recent 1, 2, 3 or 5 years of daily returns (252 trading days to a year), or the full sample, all ending ${a.asOf}.`),
    "page: says what each window is and the day they all end");
  check(page().includes(`Every window is scored at the same risk-free rate, ${format(a.rf, "pct2")}, the one this page uses throughout (by default the mean over the whole date range), not the rate that prevailed during each shorter window.`),
    "page: says every window uses the one current risk-free rate (the app does too, 1882, and does not say so)");
  // The metric table prints the window rows with their numbers.
  const gmvT = r.container.querySelectorAll("table")[0];
  const g0 = M.metricRows(fits, "gmv", a.rf)[0];
  check(text(gmvT).includes(`${fits[0].named}${fits[0].from}${format(g0.mu, "pct2")}${format(g0.sigma, "pct2")}${format(g0.sharpe, "num3")}`),
    "page: the GMV table's first row is the 1 Year window's figures", text(gmvT).slice(0, 160));

  // ledger:in-sample-label
  const head = lines(1903, 1905);
  check(/st\.subheader\("Portfolio Metrics Across Windows"\)/.test(head) && !/in-sample|in sample/i.test(TAB6),
    "ledger:in-sample-label: the app heads the window metrics \"Portfolio Metrics Across Windows\" and nothing in tab 6 says in-sample (1904-1905)");
  check(/optimize_gmv\(sub_mean, sub_cov/.test(lines(1881, 1881)) && /portfolio_performance\(gmv_r\.x, sub_mean, sub_cov, rf\)/.test(lines(1884, 1884)),
    "ledger:in-sample-label: the app optimises and scores on the SAME window's moments (1881, 1884)");
  const heads = [...r.container.querySelectorAll(".slug-text")].map(text);
  check(heads.includes("Portfolio Metrics Across Windows (in-sample)") &&
    page().includes("In-sample: each portfolio is optimised on a window's returns and then scored on those same returns"),
    "ledger:in-sample-label: the port's heading and caption say in-sample", heads.join(" | "));
  check(captions(r.container).slice(0, 2).every((c) => c.endsWith("(in-sample)")), "ledger:in-sample-label: so do the metric tables' own titles, which name the downloads' sheets");

  // ledger:downloads-everywhere (the tab's half)
  const dl = ORACLE.slice(1841, 2021).filter((l) => /st\.download_button\(/.test(l));
  check(dl.length === 2 && dl.every((d) => /"text\/csv"/.test(d)) && !/xlsx|excel/i.test(TAB6),
    "ledger:downloads-everywhere: the app's tab 6 has two downloads, both CSV, and no Excel at all (1930-1932)", dl.join(" || "));
  check(buttons(r.container).filter((b) => b.startsWith("Download Excel of ")).length === 4,
    "ledger:downloads-everywhere: the port's tab offers Excel for every table");

  // ledger:numeric-downloads (the tab's half): the app builds the metric rows from f-strings.
  check(/"Ann\. Return": f"\{g_mu:\.2%\}"/.test(lines(1887, 1887)) && /"Sharpe": f"\{t_sh:\.3f\}"/.test(lines(1895, 1895)),
    "ledger:numeric-downloads: the app's window metrics are formatted text (1887, 1895)");
  const mRows = M.metricRows(fits, "tan", a.rf);
  const csv = csvText(M.METRIC_COLUMNS, mRows);
  check(mRows.every((x) => typeof x.mu === "number" && typeof x.sigma === "number" && typeof x.sharpe === "number") &&
    csv.split("\n")[1] === `${fits[0].named},${fits[0].from},${mRows[0].mu},${mRows[0].sigma},${mRows[0].sharpe}` && !/%/.test(csv),
    "ledger:numeric-downloads: the port's metric rows are numbers and its CSV carries them raw", csv.split("\n")[1]);

  // The level switch changes the tooltip text.
  const tips = () => [...r.container.querySelectorAll("[role=tooltip]")].map(text);
  const plain = tips();
  check(plain.length === 3 && plain[2] === tipText("sharpe", "plain"), "page: three tooltips (return, volatility, Sharpe) at the chosen level", plain.join(" | "));
  r.rerender(h(Sensitivity, tabProps(a, { level: "formula" })));
  const formula = tips();
  check(formula[2] === tipText("sharpe", "formula") && formula.every((t, i) => t !== plain[i]), "page: the level switch changes every tooltip's text");

  // The hero chart: the series named IN the chart, no legend; the switch redraws for the tangency.
  const hero = r.container.querySelector(".sens-hero");
  const heroSvg = svgText(hero);
  check(text(hero.querySelector(".chart-sub")) === "Weight in each asset, one bar per window (1Y, 2Y, 3Y, 5Y, Full); darker bars are longer windows.",
    "chart: the subtitle names the windows as the chart labels them", text(hero.querySelector(".chart-sub")));
  check(fits.every((f) => heroSvg.includes(f.short)) && !hero.querySelector(".recharts-legend-wrapper"),
    "chart: every window is named on the chart itself, and there is no legend", heroSvg.join(" "));
  check(a.tickers.every((t) => heroSvg.includes(t)), "chart: the tickers along the axis, in the entered order");
  // The chart opens on Tangency, the portfolio the headline leads with; the GMV pill switches it.
  const pressed = () => text(hero.querySelector("[role=radio][aria-checked=true]") ?? hero);
  const openFills = new Set([...hero.querySelectorAll(".recharts-bar-rectangle path")].map((p) => p.getAttribute("fill")));
  check(pressed() === "Tangency" && text(hero.querySelector(".chart-title")) === M.weightChartTitle(fits, "tan", a.tickers) &&
    [...openFills].join() === ROLE.tangency && M.headline(fits, a.tickers).includes("the tangency (maximum-Sharpe) portfolio's weight in GLD"),
    "opens-on-tangency: the weight chart opens on Tangency, the portfolio the headline leads with", `${pressed()}: ${text(hero.querySelector(".chart-title"))}`);
  act(() => [...hero.querySelectorAll("[role=radio]")].find((b) => text(b) === "GMV").click());
  check(text(hero.querySelector(".chart-title")) === M.weightChartTitle(fits, "gmv", a.tickers), "chart: the GMV pill shows the GMV finding");
  const fills = (root) => new Set([...root.querySelectorAll(".recharts-bar-rectangle path")].map((p) => p.getAttribute("fill")));
  check([...fills(hero)].join() === ROLE.gmv, "chart: GMV bars in the GMV colour", [...fills(hero)].join());
  // A faded fill alone falls under 3:1 on paper; each bar's edge is drawn in the full token colour.
  const edges = [...hero.querySelectorAll(".recharts-bar-rectangle path")].map((p) => [p.getAttribute("fill"), p.getAttribute("stroke"), Number(p.getAttribute("fill-opacity") ?? 1)]);
  check(edges.length > 0 && edges.every(([f, s]) => s === f) && edges.some(([, , o]) => o < 0.5),
    "chart: every bar has an edge in its full colour, so the faded short windows still show on paper", JSON.stringify(edges.slice(0, 5)));
  check(barNames(hero).length === fits.length && barNames(hero).every((n) => n.fill === ROLE.gmv) && readable(barNames(hero)),
    "chart: the window names on the GMV view are in the GMV colour, which reads on paper", JSON.stringify(barNames(hero)));
  const tanPill = [...hero.querySelectorAll("[role=radio]")].find((b) => text(b) === "Tangency");
  act(() => tanPill.click());
  check(text(hero.querySelector(".chart-title")) === M.weightChartTitle(fits, "tan", a.tickers) && [...fills(hero)].join() === ROLE.tangency,
    "chart: the Tangency pill redraws the chart for the tangency weights", text(hero.querySelector(".chart-title")));
  // Bronze text measures 3.6:1 on paper, under WCAG AA's 4.5:1: the bars keep the bronze, their names are ink2.
  check(barNames(hero).length === fits.length && barNames(hero).every((n) => n.fill === tokens.color.ink2) && readable(barNames(hero)),
    "chart: on the Tangency view the window names are ink2, since bronze text does not read on paper", JSON.stringify(barNames(hero)));
  // And the hover box: Recharts writes its row in the bar's colour, so ReadableTip sets a bronze row in ink2.
  const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  act(() => hero.querySelector(".recharts-bar-rectangle").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  const tipRows = [...hero.querySelectorAll(".recharts-tooltip-item")].map((li) => li.style.color);
  check(tipRows.length === 1 && tipRows[0] === rgb(tokens.color.ink2), "chart: hovering a Tangency bar writes its row in ink2, not bronze", tipRows.join(" "));

  // The custom section: off by default, as the app's checkbox (1950-1954).
  const box = r.container.querySelector(".sens-check input");
  check(!!box && box.checked === false && !page().includes("Custom weights being evaluated"), "custom: off until the box is ticked (value=False, 1951)");
  act(() => box.click());
  const T6 = [...T4, "Custom weights being evaluated", "Custom Portfolio (in-sample)"];
  check(JSON.stringify(captions(r.container)) === JSON.stringify(T6) && T6.every((t) => hasBoth(r.container, t)),
    "custom: its two tables appear, each with both downloads", captions(r.container).join(" | "));
  check(buttons(r.container).filter((b) => b.startsWith("Download Excel of ")).length === 6, "ledger:downloads-everywhere: Excel for the custom tables too (the app has no download there)");
  const cust = r.container.querySelector(".sens-custom");
  const cw = M.customWeights(a.tickers, {}, false);
  const sg = M.sharpeGroups(fits, cw.w, a.rf);
  check(text(cust.querySelector(".chart-title")) === M.sharpeChartTitle(sg), "custom: the Sharpe chart's title states its finding");
  check(["GMV", "Tangency", "Custom"].every((s) => svgText(cust).includes(s)) && !cust.querySelector(".recharts-legend-wrapper"),
    "custom: GMV, Tangency and Custom named on the Sharpe chart, no legend", svgText(cust).join(" "));
  const cn = Object.fromEntries(barNames(cust).map((n) => [n.text, n.fill]));
  check(cn.GMV === ROLE.gmv && cn.Custom === ROLE.custom && cn.Tangency === tokens.color.ink2 && readable(barNames(cust)),
    "custom: each name on the Sharpe chart reads on paper; Tangency's in ink2, not its bars' bronze", JSON.stringify(cn));
  check(page().includes("so a fixed mix can at best tie it") && clean(page()), "custom: says it can at best tie the tangency; still no NaN");
  r.unmount();
}

// ledger:boundary (the tab's half). In the app, all-zero custom weights stop the script inside tab 5
// (1725-1727), so tab 6, which runs after it (1842), is never built.
{
  check(/if raw_total == 0:/.test(lines(1725, 1725)) && /st\.stop\(\)/.test(lines(1727, 1727)) && ORACLE[1707] === "with tab5:",
    "ledger:boundary: the app's tab 5 calls st.stop() on all-zero weights (1725-1727), ahead of tab 6 at 1842");
  const zero = Object.fromEntries(a.tickers.map((t) => [t, 0]));
  const z = render(h(Sensitivity, tabProps(a, { weights: zero })));
  const zt = () => text(z.container);
  check(zt().includes(M.headline(fits, a.tickers)) && captions(z.container).length === 4, "ledger:boundary: with every custom weight zero, the port's tab still shows its finding and four tables");
  act(() => z.container.querySelector(".sens-check input").click());
  check(zt().includes(M.CUSTOM_REFUSAL.zero) && !zt().includes("Custom weights being evaluated") && captions(z.container).length === 4,
    "ledger:boundary: and its custom section says why it cannot evaluate, in place of the tables");
  z.unmount();
}

// ledger:failed-tangency (the tab's half). The app appends tangency rows only `if tan_r.success`
// (1891), so a failed window vanishes, and when every one fails line 1907 raises KeyError on the
// missing Portfolio column.
{
  check(/if tan_r\.success:/.test(lines(1891, 1891)) && /metrics_df\["Portfolio"\] == "Tangency"/.test(lines(1907, 1907)),
    "ledger:failed-tangency: the app drops a failed tangency window silently (1891) and indexes a column that may not exist (1907)");
  // With shorting on and a 500% rate, no portfolio in the box beats the rate: no tangency anywhere.
  const hot = fixtureAnalysis("cross", { allowShort: true, rf: 5 });
  const hf = M.fitWindows(hot).value;
  check(hf.every((f) => f.tan === null && f.gmv !== null), "ledger:failed-tangency: at rf 500% with shorting, every window's tangency is null and every GMV solves");
  const x = quietly(() => render(h(Sensitivity, tabProps(hot))));
  const xt = text(x.container);
  check(captions(x.container).join() === "GMV Portfolio (in-sample),GMV Weights Across Windows",
    "ledger:failed-tangency: the port keeps the GMV tables and shows no tangency table", captions(x.container).join(" | "));
  // Two tables and the weight chart, which opens on Tangency.
  check((xt.match(/The Tangency optimisation failed\. It failed in every window/g) ?? []).length === 3 &&
    /Tangency Portfolio \(in-sample\): not shown\./.test(xt) && /the tangency optimisation failed in every window\./.test(xt),
    "ledger:failed-tangency: it names the failed optimisation where each table would be, and in the headline");
  const hero = x.container.querySelector(".sens-hero");
  act(() => [...hero.querySelectorAll("[role=radio]")].find((b) => text(b) === "Tangency").click());
  check(/The Tangency optimisation failed\. It failed in every window/.test(text(hero.querySelector(".chart-note--error") ?? hero)) &&
    !hero.querySelector(".recharts-wrapper"),
    "ledger:failed-tangency: the tangency chart is replaced by the named failure, never drawn empty");
  check(clean(text(x.container)) && !text(x.container).includes(DASH + DASH), "ledger:failed-tangency: no NaN, no stand-in figures");
  x.unmount();
}

// ---- window-ends: every window says the day it ends, so a weight here cannot be read as one fitted
// on some earlier stretch of history.
{
  const a = fixtureAnalysis("cross");
  const fits = M.fitWindows(a).value;
  const end = a.dates[a.dates.length - 1];
  check(end === a.asOf && JSON.stringify(fits.map((f) => f.named)) ===
    JSON.stringify([`1 year to ${end}`, `2 years to ${end}`, `3 years to ${end}`, `5 years to ${end}`, `Full sample to ${end}`]) &&
    JSON.stringify(fits.map((f) => f.label)) === JSON.stringify(["1 Year", "2 Years", "3 Years", "5 Years", "Full Sample"]),
    "window-ends: each window's name carries its end date, and the app's own label is kept beside it", fits.map((f) => f.named).join(" | "));
  const head = M.headline(fits, a.tickers);
  const named = [...head.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]).filter((x) => !/maximum-Sharpe|GMV/.test(x));
  check(named.length === 4 && named.every((x) => x.endsWith(` to ${end}`)), "window-ends: every window the headline names carries its end date", head);
  const r = render(h(Sensitivity, tabProps(a)));
  const tables = [...r.container.querySelectorAll(".tbl")];
  const rowHeads = [...tables[0].querySelectorAll("tbody th")].map(text);
  check(JSON.stringify(rowHeads) === JSON.stringify(fits.map((f) => f.named)), "window-ends: the metric tables' rows name each window with its end date", rowHeads.join(" | "));
  const subs = [...tables[2].querySelectorAll("thead th .tbl-sub")].map(text);
  check(subs.length === fits.length && subs.every((s) => s === `to ${end}`), "window-ends: each window column of the weight tables says the day it ends", subs.join(" | "));
  const spans = tables.map((t) => text(t.querySelector(".tbl-span")));
  check(spans.length === 4 && spans.every((s) => s === `Daily returns, each window ending ${end}`), "spans: every table on the tab says its returns are daily and the day each window ends", spans.join(" | "));
  r.unmount();
}

// Long-only with a rate no asset beats: the tangency is the least-negative Sharpe (as the app's SLSQP
// returns), and the page says so instead of presenting it as a portfolio that beats the rate.
{
  const cold = fixtureAnalysis("cross", { rf: 0.5 });
  const cf = M.fitWindows(cold).value;
  check(cf.every((f) => f.tan && !f.tan.beatsRf) && JSON.stringify(M.belowRf(cf)) === JSON.stringify(cf.map((f) => f.label)),
    "below rf: at a 50% rate, long-only, no window's tangency beats it");
  const y = render(h(Sensitivity, tabProps(cold)));
  check(text(y.container).includes(`In the 1 Year, 2 Years, 3 Years, 5 Years and Full Sample windows no long-only mix beat the ${format(0.5, "pct2")} risk-free rate, so the tangency row there is the mix with the least negative Sharpe ratio`),
    "below rf: the page says the tangency rows are the least-negative Sharpe, and that only long-only mixes were searched", text(y.container).slice(0, 200));
  // With shorting on, a window where no mix in the box beats the rate has no tangency at all (the solve
  // fails, above), so no window is ever listed here: the note's shorting wording is defensive.
  const hotFits = M.fitWindows(fixtureAnalysis("cross", { allowShort: true, rf: 0.5 })).value;
  check(M.belowRf(hotFits).length === 0 && hotFits.every((f) => f.tan === null || f.tan.beatsRf) && hotFits.some((f) => f.tan === null),
    "below rf: with shorting on, a window whose rate no mix beats fails the tangency instead of being listed here");
  // So the shorting wording is reached through the sentence builder the note renders, not the page.
  const { belowNote } = await import("../src/tabs/Sensitivity.tsx");
  check(belowNote(["1 Year"], 0.5, true) === `In the 1 Year window no mix with weights inside [${MINUS}1, 1] beat the ${format(0.5, "pct2")} risk-free ` +
    "rate, so the tangency row there is the mix with the least negative Sharpe ratio." && belowNote(["1 Year"], 0.5, false).includes(" no long-only mix beat "),
    "below rf: with shorting on, the note names the [-1, 1] bounds searched instead of long-only", belowNote(["1 Year"], 0.5, true));
  check(close(M.metricRows(cf, "tan", 0.5)[0].sharpe, cf[0].tan.sharpe, 1e-12), "below rf: the row is that portfolio's own Sharpe ratio");
  y.unmount();
}

// Drawn: a chart crowded enough to leave names off says how many in one line under it, and each name
// left off is a keyboard stop that draws the name while it has focus.
{
  const GroupedBars = (await import("../src/tabs/sensitivity/GroupedBars.tsx")).default;
  const five = ["1Y", "2Y", "3Y", "5Y", "Full"];
  const groups = Array.from({ length: 16 }, (_, g) => ({ name: `T${g}`, values: five.map((_, k) => 0.05 + 0.04 * ((g + 2 * k) % 5)) }));
  const series = five.map((label, k) => ({ name: label, label, color: [ROLE.gmv, ROLE.tangency, ROLE.ew, ROLE.custom, ROLE.frontier][k] }));
  const r = render(h(GroupedBars, { groups, series, valueFormat: "pct2", axis: "pct", height: 400 }));
  const shown = [...r.container.querySelectorAll(".gbars-name")].map((t) => text(t));
  const stops = [...r.container.querySelectorAll("g.gbars-name-off")];
  const line = r.container.querySelector(".chart-cull");
  const { namesCull } = await import("../src/tabs/sensitivity/GroupedBars.tsx");
  check(stops.length > 0 && shown.length + stops.length === 5 && line && text(line) === namesCull(stops.length),
    "cull: drawn crowded, the names left off are counted in one line under the chart", `${shown.join(",")} | off ${stops.length} | ${line ? text(line) : "no line"}`);
  const name = stops[0]?.getAttribute("aria-label");
  const before = stops[0]?.querySelector("text");
  act(() => stops[0].dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
  const during = r.container.querySelector("g.gbars-name-off text");
  const drawnName = during ? text(during) : "";
  check(stops.every((g) => g.getAttribute("tabindex") === "0") && !before && !!during && five.includes(drawnName) && !shown.includes(drawnName) &&
    new RegExp(String.raw`^${drawnName}, T\d+: \d+\.\d{2}%$`).test(name ?? ""),
    "cull: a name left off is a keyboard stop that names its bar, its group and its value, and draws the name while it has focus", `${name} ${drawnName || "none"}`);
  r.unmount();
}

// Drawn at a width where Recharts' sizing and a floored share part ways (ten groups in a 590px chart: 6px
// bars, where flooring the share before the 1px gaps gives 7): the model's bars are the bars Recharts draws.
{
  const GroupedBars = (await import("../src/tabs/sensitivity/GroupedBars.tsx")).default;
  const five = ["1Y", "2Y", "3Y", "5Y", "Full"];
  const at = (w, groups, series) => {
    const real = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return this.classList?.contains("recharts-responsive-container")
        ? { x: 0, y: 0, top: 0, left: 0, right: w, bottom: 400, width: w, height: 400, toJSON() {} }
        : real.call(this);
    };
    try {
      return render(h(GroupedBars, { groups, series, valueFormat: "pct2", axis: "pct", height: 400 }));
    } finally {
      HTMLElement.prototype.getBoundingClientRect = real;
    }
  };
  const series = five.map((label) => ({ name: `${label} window`, label, color: ROLE.tangency }));
  const ten = Array.from({ length: 10 }, (_, g) => ({ name: `T${g}`, values: five.map((_, k) => 0.1 + 0.02 * ((g + k) % 3)) }));
  const W = 590;
  const r = at(W, ten, series);
  const band = (W - 64) / ten.length;
  const slot = M.barSlots(band, five.length);
  const bars = [...r.container.querySelectorAll(".recharts-bar-rectangle path")]
    .map((p) => ({ x: Number(p.getAttribute("x")), w: Number(p.getAttribute("width")) }))
    .filter((b) => Number.isFinite(b.x) && Number.isFinite(b.w));
  const first = bars.filter((b) => b.x < 56 + band).sort((p, q) => p.x - q.x);
  const want = five.map((_, i) => ({ x: 56 + slot.at(i), w: slot.size }));
  const floored = Math.floor((band - 2 * M.BAR_SPACING.categoryGap * band) / five.length);
  check(first.length === 5 && slot.size !== floored && first.every((b, i) => Math.abs(b.x - want[i].x) < 1e-6 && b.w === want[i].w),
    "cull: the bars the model places are the bars Recharts draws, at a width where a floored share would not be",
    `drawn ${JSON.stringify(first)} | model ${JSON.stringify(want)} | floored ${floored}`);
  r.unmount();

  // A series with no value in any group draws no bar: the line counts only the names really left off,
  // each a keyboard stop, and the stand-in names its window, its group and the value.
  const none = Array.from({ length: 16 }, (_, g) => ({ name: `T${g}`, values: five.map((_, k) => (k === 1 ? null : 0.05 + 0.04 * ((g + 2 * k) % 5))) }));
  const { namesCull } = await import("../src/tabs/sensitivity/GroupedBars.tsx");
  const counted = [];
  for (const w of [343, 330, 300]) {
    const q = at(w, none, series);
    const stops = [...q.container.querySelectorAll("g.gbars-name-off")];
    const line = q.container.querySelector(".chart-cull");
    const ok = line ? text(line) === namesCull(stops.length) : stops.length === 0;
    const named = stops.every((g) => /^\S+ window, T\d+: \d+\.\d{2}%$/.test(g.getAttribute("aria-label") ?? ""));
    const phantom = stops.some((g) => (g.getAttribute("aria-label") ?? "").startsWith("2Y"));
    if (!ok || !named || phantom) counted.push(`${w}: ${stops.length} stops, ${line ? text(line) : "no line"}, ${stops.map((g) => g.getAttribute("aria-label")).join(" / ")}`);
    q.unmount();
  }
  check(counted.length === 0, "cull: the line counts the names left off and nothing else, each a stop naming its bar and value; a series with no bar has none",
    counted.join(" | "));
  check(namesCull(2).includes("subtitle's order"), "cull: the line points at the bars' order, since a bar a few px wide is hard to tap", namesCull(2));
}

HTMLElement.prototype.getBoundingClientRect = rect;
// ---- (f) the phone ---------------------------------------------------------------------------------
// Every grid on the tab has one shrinkable track. An implicit track sizes to its widest child's
// min-content, which let a metrics table push the tab to 446px on a 375px phone.
{
  const sheet = readFileSync(new URL("../src/tabs/sensitivity/Sensitivity.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const grids = [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /display:\s*grid/.test(m[2]));
  const loose = grids.filter((m) => !/grid-template-columns:\s*(minmax\(0,|repeat\(\d+,\s*minmax\(0,)/.test(m[2])).map((m) => m[1].trim());
  check(grids.length >= 4 && loose.length === 0, "phone: every grid on the tab sizes its tracks with minmax(0, ...), so none outgrows the page", loose.join(", ") || String(grids.length));
}

done("t-tab-sensitivity");
