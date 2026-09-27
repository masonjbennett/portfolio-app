// Parity: the TypeScript engine against the Streamlit app's own functions, on frozen prices.
//
// The oracle numbers come from test/oracle/dump_oracle.py, which slices the SHIPPING functions out
// of portfolio_app.py. Tiers (numbers, never formatted strings):
//   deterministic statistics                         1e-12 relative
//   rolling std / corr (pandas' online update)       1e-9
//   analytics fed the ORACLE's weights (T0)          1e-12 (1e-10 for ~1,900-day wealth paths)
//   solver objective (T1), one-sided                 port vol <= oracle, port Sharpe >= oracle
//   weights vs the shipping SLSQP (T2)               1.5e-2 GMV, 5e-3 tangency: the oracle's own noise
//   weights vs the oracle re-run at ftol 1e-15       TIGHT, below
//   frontier sigma at the oracle's kept targets (T3) 1e-8 relative
// This suite reproduces the app, divergences included. What the port does DIFFERENTLY, on purpose,
// is asserted in t-ledger.mjs.
import { check, near, nearAll, maxAbsDiff, done } from "./_assert.mjs";
import { SETS, derive } from "./_fixtures.mjs";
import { mean, covMatrix, corrMatrix, linspace } from "../src/lib/num.ts";
import {
  annualizedStats, skew, excessKurtosis, maxDrawdown, drawdowns, wealth, capm,
  rollingStd, rollingCorr, probplot,
} from "../src/lib/stats.ts";
import { gmv, tangency, frontierAt } from "../src/lib/optimize.ts";
import { summaryRow, riskContribution, portfolioReturns, windows, windowMoments } from "../src/lib/portfolio.ts";

const REL = 1e-12;
const TIGHT = 1e-7; // weights vs the ftol-1e-15 re-run; measured worst 8.9e-8, see where it is used

const at = (series, idx) => idx.map((i) => series[i]);

function isoOf(text) {
  const d = new Date(text + " 00:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The app's st.warning / st.info text, read back into the port's structured events.
function oracleEvents(messages) {
  return messages.map(({ kind, text }) => {
    const list = (/\*\*([^*]+)\*\*/.exec(text) || [])[1];
    if (text.startsWith("Could not download data for")) return { kind: "failed", tickers: list.split(", ") };
    if (text.startsWith("Dropped tickers")) return { kind: "dropped", tickers: list.split(", ") };
    const m = /\((\w+ \d+, \d+) to (\w+ \d+, \d+), (\d+) trading days\)/.exec(text);
    if (m) return { kind: "truncated", first: isoOf(m[1]), last: isoOf(m[2]), rows: Number(m[3]) };
    return { kind, text };
  });
}

for (const name of SETS) {
  const { px, oracle: o, cleaned, returns, cols, bench } = derive(name);
  const tag = (s) => `${name}: ${s}`;

  // ── cleaning (1007-1092) ──
  check(cleaned.ok, tag("cleaning succeeds as it does in the app"));
  check(JSON.stringify(cleaned.frame.columns) === JSON.stringify(o.clean.columns), tag("cleaned columns and order"),
    `${cleaned.frame.columns} vs ${o.clean.columns}`);
  check(JSON.stringify(cleaned.tickers) === JSON.stringify(o.clean.tickers), tag("portfolio tickers"));
  check(cleaned.frame.dates.length === o.clean.rows, tag("rows after cleaning"));
  check(cleaned.frame.dates[0] === o.clean.first && cleaned.frame.dates.at(-1) === o.clean.last, tag("date span"));
  check(JSON.stringify(cleaned.events) === JSON.stringify(oracleEvents(o.clean.messages)), tag("cleaning events"),
    `${JSON.stringify(cleaned.events)} vs ${JSON.stringify(oracleEvents(o.clean.messages))}`);

  // ── returns: the same two operations as pandas, so bit-identical ──
  const R = [...cols, bench];
  check(returns.dates.length === o.returns.rows && returns.dates[0] === o.returns.first, tag("return rows"));
  const retCols = o.returns.columns.map((c) => returns.values[returns.columns.indexOf(c)]);
  check(o.returns.head.every((row, t) => row.every((v, j) => retCols[j][t] === v)), tag("first returns exact"));
  const T = returns.dates.length;
  check(o.returns.tail.every((row, k) => row.every((v, j) => retCols[j][T - 3 + k] === v)), tag("last returns exact"));
  nearAll(tag("column sums"), retCols.map((c) => c.reduce((a, b) => a + b, 0)), o.returns.colSums, 1e-12, 1e-15);

  // ── moments ──
  const m = cols.map(mean);
  const S = covMatrix(cols);
  nearAll(tag("daily means"), m, o.mean, REL);
  nearAll(tag("daily covariance"), S.flat(), o.cov.flat(), REL, 1e-20);
  nearAll(tag("correlation"), corrMatrix(cols).flat(), o.corr.flat(), 0, 1e-12);

  // ── tab 1 / tab 2 per column, tickers then the benchmark ──
  [...cleaned.tickers, px.benchmark].forEach((c, j) => {
    const r = R[j];
    const e = o.perColumn[c];
    const s = annualizedStats(r, o.rf);
    near(tag(`${c} mu`), s.mu, e.mu, REL);
    near(tag(`${c} sigma`), s.sigma, e.sigma, REL);
    near(tag(`${c} sharpe`), s.sharpe, e.sharpe, REL);
    near(tag(`${c} sortino`), s.sortino, e.sortino, REL);
    near(tag(`${c} skew`), skew(r), e.skew, 1e-10);
    near(tag(`${c} excess kurtosis`), excessKurtosis(r), e.kurt, 1e-10);
    check(Math.min(...r) === e.min && Math.max(...r) === e.max, tag(`${c} min/max exact`));
    near(tag(`${c} max drawdown`), maxDrawdown(r, false), e.mdd, REL);
    nearAll(tag(`${c} drawdown path`), at(drawdowns(r, false), e.drawdown.i), e.drawdown.v, 0, 1e-12);
    nearAll(tag(`${c} growth of $${o.w0}`), at(wealth(r, o.w0, false), e.cumulative.i), e.cumulative.v, 1e-10);
  });

  // ── CAPM (1377-1392) ──
  cleaned.tickers.forEach((t, j) => {
    const c = capm(cols[j], bench, o.rf);
    near(tag(`${t} beta`), c.beta, o.capm[t].beta, 1e-11);
    near(tag(`${t} alpha`), c.alphaAnn, o.capm[t].alphaAnn, 1e-9, 1e-13);
    near(tag(`${t} R2`), c.r2, o.capm[t].r2, 1e-11);
  });

  // ── rolling (1324, 1451) and the Q-Q plot (1296) ──
  for (const w of ["30", "60", "120"]) {
    cleaned.tickers.forEach((t, j) => {
      const e = o.rolling[w].vol[t];
      nearAll(tag(`${t} ${w}d rolling vol`), at(rollingStd(cols[j], +w).map((x) => x * Math.sqrt(252)), e.i), e.v, 1e-9);
    });
    const e = o.rolling[w].corr01;
    nearAll(tag(`${w}d rolling corr`), at(rollingCorr(cols[0], cols[1], +w), e.i), e.v, 0, 1e-9);
  }
  const qq = probplot(cols[0]);
  nearAll(tag("Q-Q theoretical quantiles"), at(qq.osm, o.probplot.osm.i), o.probplot.osm.v, 1e-13, 1e-15);
  check(at(qq.osr, o.probplot.osr.i).every((v, k) => v === o.probplot.osr.v[k]), tag("Q-Q sample quantiles exact"));
  near(tag("Q-Q slope"), qq.slope, o.probplot.slope, 1e-11);
  near(tag("Q-Q intercept"), qq.intercept, o.probplot.intercept, 1e-9, 1e-15);

  // ── tabs 4-6, both short settings ──
  for (const mode of ["long", "short"]) {
    const M = o.modes[mode];
    const short = mode === "short";
    const mt = (s) => tag(`${mode}: ${s}`);
    const n = cols.length;
    const ew = new Array(n).fill(1 / n);

    // T0: the arithmetic, fed the oracle's own weights.
    const rows = { ew, gmv: M.shipping.gmv.x, tan: M.shipping.tan.x };
    for (const [k, w] of Object.entries(rows)) {
      const row = summaryRow(cols, w, m, S, o.rf, false);
      const e = M.perf[k];
      for (const f of ["mu", "sigma", "sharpe", "sortino", "mdd"]) near(mt(`${k} ${f} (oracle weights)`), row[f], e[f], REL);
      if (k !== "ew") {
        nearAll(mt(`${k} risk contribution`), riskContribution(w, S), M.prc[k], REL, 1e-15);
      }
      const wp = M.wealth[k];
      nearAll(mt(`${k} wealth path`), at(wealth(portfolioReturns(cols, w), o.w0, false), wp.i), wp.v, 1e-10);
    }
    for (const [k, c] of Object.entries(M.custom)) {
      const w = c.raw.map((x) => x / c.total); // the app's normalisation (1732), reproduced
      nearAll(mt(`custom ${k} weights`), w, c.w, REL, 1e-15);
      const row = summaryRow(cols, w, m, S, o.rf, false);
      for (const f of ["mu", "sigma", "sharpe", "sortino", "mdd"]) near(mt(`custom ${k} ${f}`), row[f], c.perf[f], 1e-11);
    }

    // T1 / T2: the exact solve.
    const solve = (mm, SS, ship, tight, label) => {
      const g = gmv(mm, SS, short);
      const t = tangency(mm, SS, o.rf, short);
      check(!!g && !!t, mt(`${label} solves`));
      if (!g || !t) return;
      const oVol = ship.gmv.fun;
      check(g.sigma <= oVol * (1 + 1e-9), mt(`${label} GMV vol no worse than the app's`), `${g.sigma} vs ${oVol}`);
      check(g.sigma >= oVol * (1 - 2e-4), mt(`${label} GMV vol within 2e-4 of the app's`), `${g.sigma} vs ${oVol}`);
      const oSh = -ship.tan.fun;
      check(t.sharpe >= oSh - 1e-9, mt(`${label} tangency Sharpe no worse than the app's`), `${t.sharpe} vs ${oSh}`);
      check(t.sharpe <= oSh + 5e-6, mt(`${label} tangency Sharpe within 5e-6 of the app's`), `${t.sharpe} vs ${oSh}`);
      check(maxAbsDiff(g.w, ship.gmv.x) <= 1.5e-2, mt(`${label} GMV weights within the app's SLSQP noise`));
      check(maxAbsDiff(t.w, ship.tan.x) <= 5e-3, mt(`${label} tangency weights within the app's SLSQP noise`));
      // TIGHT: SLSQP at ftol 1e-15 with finite-difference gradients is itself only good to about
      // 1e-7 on a flat objective (measured Sep 27 2026: worst 5.4e-8 GMV, 8.9e-8 tangency, and in both
      // the port's objective was the better one), so this bounds the reference as much as the port.
      // The port's exactness is proved by the KKT checks in t-ledger.mjs, not here.
      check(maxAbsDiff(g.w, tight.gmv.x) <= TIGHT, mt(`${label} GMV weights = tight re-run`),
        maxAbsDiff(g.w, tight.gmv.x).toExponential(2));
      check(maxAbsDiff(t.w, tight.tan.x) <= TIGHT, mt(`${label} tangency weights = tight re-run`),
        maxAbsDiff(t.w, tight.tan.x).toExponential(2));
      return { g, t };
    };
    const full = solve(m, S, M.shipping, M.tight, "tab 4");

    // T3: the frontier at the app's exact grid, at the targets it kept.
    for (const key of ["frontier80", "frontier60", "frontier80tight"]) {
      const F = M[key];
      const grid = linspace(F.muMin, F.muMax, F.targets.length);
      check(grid.every((t, i) => t === F.targets[i]), mt(`${key}: numpy.linspace grid reproduced to the bit`));
      const pts = frontierAt(m, S, F.kept.map((i) => F.targets[i]), short);
      check(pts.every((p) => p.feasible), mt(`${key}: every target the app kept is feasible`));
      nearAll(mt(`${key}: sigma at the app's targets`), pts.map((p) => p.sigma), F.sigma, 1e-8);
    }

    // Tab 6 windows.
    const W = windows(T);
    check(JSON.stringify(W.map((w) => [w.label, w.lb])) === JSON.stringify(M.windows.map((w) => [w.label, w.lb])),
      mt("window labels and lengths"));
    M.windows.forEach((ow, k) => {
      const { m: sm, S: sS } = windowMoments(cols, ow.lb);
      nearAll(mt(`${ow.label} means`), sm, ow.mean, REL);
      nearAll(mt(`${ow.label} covariance`), sS.flat(), ow.cov.flat(), REL, 1e-20);
      const s = solve(sm, sS, ow.shipping, ow.tight, ow.label);
      if (ow.label === "Full Sample" && s && full) {
        check(maxAbsDiff(s.g.w, full.g.w) === 0 && maxAbsDiff(s.t.w, full.t.w) === 0, mt("Full Sample window = tab 4"));
      }
    });
  }

  // A risk-free rate of 30%, a stress case. Where a portfolio still beats it, the port's Sharpe is at
  // least the app's; the band above is wider than tab 4's 5e-6 because SLSQP stops further short with
  // many bounds active (measured: 1.7e-5 on `sectors` with shorting). Where nothing beats it, the
  // app's SLSQP is on a non-convex problem and can stop at a local optimum (`cross_vti` long-only:
  // all-VNQ at -0.936 where all-GLD scores -0.741), so only "no worse" is asserted. What the port
  // SHOWS in that case is in t-ledger.mjs.
  for (const mode of ["long", "short"]) {
    const e = o.rfHigh[mode];
    const t = tangency(m, S, o.rfHigh.rf, mode === "short");
    if (e.sharpe > 0) {
      check(!!t && t.sharpe >= e.sharpe - 1e-9 && t.sharpe <= e.sharpe + 5e-5, tag(`rf 30% ${mode}: Sharpe matches`),
        `${t && t.sharpe} vs ${e.sharpe}`);
    } else if (mode === "long") {
      check(!!t && !t.beatsRf && t.sharpe >= e.sharpe - 1e-9, tag("rf 30% long: Sharpe no worse than the app's"),
        `${t && t.sharpe} vs ${e.sharpe}`);
    }
  }
}

done("t-parity");
