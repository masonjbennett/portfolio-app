// The four added constructions: src/lib/constructions.ts, tangencyCapped() and riskParity() in
// src/lib/optimize.ts, and their fragility rows in src/lib/robust.ts.
//
// The oracle is test/oracle/dump_oracle.py, written from the definitions by other methods (see its
// "added constructions" block). Tolerances, each from a measured worst case on the five fixture sets:
//   - Bayes-Stein intensity, target and shrunk means: relative 1e-12. Both sides are the closed form, the port
//     through Cholesky solves and numpy through a matrix inverse; measured worst 1.2e-15.
//   - the three maximum-Sharpe constructions: weights to 1e-12. Both sides are exact (the port's QP, the
//     oracle's KKT solve on SLSQP's active set); measured worst 1.3e-15.
//   - risk parity: weights to 1e-9. The port stops once every risk share is within RP_TOL (1e-10) of 1/n,
//     so its weights are good to about that and no further; the oracle's root is good to 1e-14. Measured
//     worst 8.4e-11.
//   - the last-year tangency against the existing SLSQP re-run of the 1-year window at ftol 1e-15: 1e-7, the
//     bound t-parity holds every tight re-run to (that solver's own noise, not the port's).
import { check, done, maxAbsDiff, near, nearAll } from "./_assert.mjs";
import { derive, SETS } from "./_fixtures.mjs";
import { exampleAnalysis } from "./_analysis.mjs";

const C = await import("../src/lib/constructions.ts");
const O = await import("../src/lib/optimize.ts");
const R = await import("../src/lib/robust.ts");
const { riskContribution, windowMoments, windows } = await import("../src/lib/portfolio.ts");
const { loadVerdict, TN_REFUSE, TRADING_DAYS } = await import("../src/lib/stats.ts");
const { DEFAULT_SEED, mulberry32, normals } = await import("../src/lib/rng.ts");

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sumOf = (w) => w.reduce((a, b) => a + b, 0);
const argmax = (w) => w.reduce((b, x, i) => (x > w[b] ? i : b), 0);
// The added constructions break ties to 1e-12, first ticker first: a cap leaves exact ties.
const firstTop = (w) => w.findIndex((x) => x >= Math.max(...w) - 1e-12);
const KEY = { "tan.1y": "tan1y", "tan.bs": "tanBs" };

// ---- every fixture set against the oracle, shorting off and on ----------------------------------------

for (const name of SETS) {
  const d = derive(name);
  const o = d.oracle.constructions;
  const { cols } = d;
  const rf = d.oracle.rf;
  const T = cols[0].length;
  const n = cols.length;
  check(o.T === T && o.n === n, `${name}: the oracle saw the same window`, `${o.T}x${o.n} vs ${T}x${n}`);

  // The windows each construction reads.
  const full = C.ownWindow("tan.bs", cols);
  const year = C.ownWindow("tan.1y", cols);
  const ref = windowMoments(cols, T);
  check(full.T === T && same(full.m, ref.m) && same(full.S, ref.S), `${name}: the full-window constructions read every row`);
  for (const id of ["tan.cap", "rp"]) check(same(C.ownWindow(id, cols), full), `${name}: ${id} reads the same full window`);
  const last = windowMoments(cols.map((c) => c.slice(T - TRADING_DAYS)), TRADING_DAYS);
  check(year.T === TRADING_DAYS && same(year.m, last.m) && same(year.S, last.S), `${name}: the last-year tangency reads the last 252 rows`);

  // Bayes-Stein.
  const bs = C.bayesStein(full.m, full.S, T);
  check(bs !== null, `${name}: Bayes-Stein solves`);
  if (bs) {
    near(`${name}: shrinkage intensity`, bs.phi, o.bayesStein.phi, 1e-12);
    near(`${name}: shrinkage target`, bs.mu0, o.bayesStein.mu0, 1e-12);
    nearAll(`${name}: shrunk means`, bs.means, o.bayesStein.means, 1e-12);
    check(bs.phi >= 0 && bs.phi <= 1, `${name}: intensity in [0, 1]`, String(bs.phi));
    const between = bs.means.every((x, i) => {
      const lo = Math.min(full.m[i], bs.mu0);
      const hi = Math.max(full.m[i], bs.mu0);
      const slack = 1e-15 * Math.max(Math.abs(lo), Math.abs(hi));
      return x >= lo - slack && x <= hi + slack;
    });
    check(between, `${name}: every shrunk mean lies between its sample mean and the target`);
  }

  for (const allowShort of [false, true]) {
    const mode = allowShort ? "short" : "long";
    const lab = `${name} ${mode}`;
    const sol = {};
    for (const id of C.ADDED_IDS) {
      const own = C.ownWindow(id, cols);
      sol[id] = C.solveAdded(id, own.m, own.S, own.T, rf, allowShort);
      check(sol[id] !== null, `${lab}: ${id} solves`);
    }
    if (C.ADDED_IDS.some((id) => !sol[id])) continue;
    for (const id of ["tan.1y", "tan.bs"]) {
      const want = o[mode][KEY[id]];
      check(want && want.exact, `${lab}: the oracle's ${id} took its exact step`);
      if (want) nearAll(`${lab}: ${id} weights = oracle`, sol[id].w, want.w, 0, 1e-12);
    }
    const tight = d.oracle.modes[mode].windows.find((w) => w.lb === TRADING_DAYS);
    if (tight) check(maxAbsDiff(sol["tan.1y"].w, tight.tight.tan.x) <= 1e-7, `${lab}: tan.1y = the tight re-run of the 1-year window`);
    check(same(sol["tan.bs"].shrink, bs), `${lab}: tan.bs carries the intensity and target it was solved with`);
    const plain = O.tangency(bs.means, full.S, rf, allowShort);
    check(same(sol["tan.bs"].w, plain.w), `${lab}: tan.bs is tangency() on the shrunk means and the sample covariance`);

    // The cap, long-only whatever the switch.
    const cap = sol["tan.cap"];
    if (o.capped) {
      check(o.capped.exact, `${lab}: the oracle's capped tangency took its exact step`);
      nearAll(`${lab}: tan.cap weights = oracle`, cap.w, o.capped.w, 0, 1e-12);
    }
    check(cap.w.every((x) => x >= 0 && x <= C.CAP + 1e-12), `${lab}: every capped weight in [0, 25%] to 1e-12`, String(Math.max(...cap.w) - C.CAP));
    check(Math.abs(sumOf(cap.w) - 1) <= 1e-12, `${lab}: capped weights sum to 1`);
    check(cap.beatsRf === true, `${lab}: the capped mix beats the risk-free rate`);

    // Risk parity, long-only whatever the switch.
    const rp = sol.rp;
    nearAll(`${lab}: rp weights = oracle`, rp.w, o.riskParity.w, 0, 1e-9);
    const share = riskContribution(rp.w, full.S);
    check(share.every((s) => Math.abs(s - 1 / n) <= O.RP_TOL), `${lab}: every risk share within 1e-10 of 1/n`, String(maxAbsDiff(share, share.map(() => 1 / n))));
    check(rp.w.every((x) => x > 0) && Math.abs(sumOf(rp.w) - 1) <= 1e-12, `${lab}: rp long-only, summing to 1`);
    check(rp.beatsRf === null && rp.shrink === null, `${lab}: rp claims nothing about the risk-free rate`);
  }
  for (const id of ["tan.cap", "rp"]) {
    const own = C.ownWindow(id, cols);
    check(same(C.solveAdded(id, own.m, own.S, own.T, rf, false), C.solveAdded(id, own.m, own.S, own.T, rf, true)), `${name}: ${id} ignores the shorting switch`);
  }
}

// ---- the last year is the LAST 252 rows ---------------------------------------------------------------
// Three assets over 600 rows: in the first 348 the first asset earns most, in the last 252 the third does.

{
  const z = normals(mulberry32(97));
  const rows = 600;
  const early = [0.004, 0.0005, -0.001];
  const late = [-0.001, 0.0005, 0.004];
  const cols = [0, 1, 2].map(() => new Array(rows));
  for (let t = 0; t < rows; t++) {
    const mu = t < rows - TRADING_DAYS ? early : late;
    for (let i = 0; i < 3; i++) cols[i][t] = mu[i] + 0.01 * z();
  }
  const y = C.ownWindow("tan.1y", cols);
  const tail = windowMoments(cols.map((c) => c.slice(rows - TRADING_DAYS)), TRADING_DAYS);
  const head = windowMoments(cols.map((c) => c.slice(0, TRADING_DAYS)), TRADING_DAYS);
  check(same(y.m, tail.m) && same(y.S, tail.S) && y.T === TRADING_DAYS, "synthetic: the year's moments are the last 252 rows'");
  const t = C.solveAdded("tan.1y", y.m, y.S, y.T, 0.0389, false);
  const tTail = O.tangency(tail.m, tail.S, 0.0389, false);
  const tHead = O.tangency(head.m, head.S, 0.0389, false);
  check(same(t.w, tTail.w), "synthetic: tan.1y = tangency on the last 252 rows");
  check(argmax(t.w) === 2 && argmax(tHead.w) === 0, "synthetic: the first year would have chosen another asset", `${t.w} vs ${tHead.w}`);
}

// ---- availability, both sides of every boundary --------------------------------------------------------

{
  const Y = TRADING_DAYS;
  check(C.unavailable("tan.1y", Y, 5) === "window-is-one-year", "tan.1y: a window of exactly a year is refused");
  check(C.unavailable("tan.1y", Y + 1, 5) === null, "tan.1y: one row more than a year is offered");
  // The thin-year boundary is loadVerdict's, read here rather than typed in.
  const nOk = Math.floor(Y / TN_REFUSE);
  check(loadVerdict(Y, nOk) !== "refuse" && loadVerdict(Y, nOk + 1) === "refuse", "the refuse boundary sits between nOk and nOk + 1 assets");
  check(C.unavailable("tan.1y", Y + 1, nOk) === null, "tan.1y: a year of nOk assets is offered");
  check(C.unavailable("tan.1y", Y + 1, nOk + 1) === "year-too-thin", "tan.1y: a year of nOk + 1 assets is refused");
  check(C.unavailable("tan.1y", 2000, nOk + 1) === "year-too-thin", "tan.1y: thin is judged on the year, not the whole window");
  check(C.unavailable("tan.1y", Y, nOk + 1) === "window-is-one-year", "tan.1y: a one-year window is named as such first");
  for (const n of [2, 5, 9]) {
    check(C.unavailable("tan.bs", n + 2, n) === "too-few-rows", `tan.bs: T = n + 2 refused at n = ${n}`);
    check(C.unavailable("tan.bs", n + 3, n) === null, `tan.bs: T = n + 3 offered at n = ${n}`);
  }
  check(C.unavailable("tan.cap", 1943, C.CAP_MIN_ASSETS - 1) === "too-few-assets", "tan.cap: four assets refused");
  check(C.unavailable("tan.cap", 1943, C.CAP_MIN_ASSETS) === null, "tan.cap: five assets offered");
  check(C.CAP_MIN_ASSETS === 5 && C.CAP === 0.25, "the cap is 25% and needs five assets");
  check([[3, 1], [253, 2], [1943, 30]].every(([T, n]) => C.unavailable("rp", T, n) === null), "rp: always offered");
  check(same(C.availability(253, 7), { "tan.1y": null, "tan.bs": null, "tan.cap": null, rp: null }), "availability: all four at 253 x 7");
  check(same(C.availability(252, 4), { "tan.1y": "window-is-one-year", "tan.bs": null, "tan.cap": "too-few-assets", rp: null }), "availability: reasons at 252 x 4");
  check(C.ADDED_IDS.every(C.isAddedId) && !["ew", "gmv", "tan", "custom", "bench"].some(C.isAddedId), "isAddedId names the four and nothing else");
}

// ---- Bayes-Stein, capped tangency and risk parity at their edges ---------------------------------------

{
  const d = derive("megacap");
  const full = C.ownWindow("tan.bs", d.cols);
  const n = full.m.length;
  check(C.bayesStein(full.m, full.S, n + 2) === null, "bayesStein: null at T = n + 2");
  check(C.bayesStein(full.m, full.S, n + 3) !== null, "bayesStein: solves at T = n + 3");
  // The target is the unconstrained minimum-variance portfolio's mean: worked here from its weights.
  const inv1 = (() => {
    // S^-1 1 by Gauss-Jordan, a third route to the same weights.
    const A = full.S.map((r, i) => [...r, 1]);
    for (let c = 0; c < n; c++) {
      const p = A[c][c];
      for (let j = c; j <= n; j++) A[c][j] /= p;
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j]; }
    }
    return A.map((r) => r[n]);
  })();
  const wMin = inv1.map((x) => x / sumOf(inv1));
  near("bayesStein: target = mean of the unconstrained minimum-variance mix", C.bayesStein(full.m, full.S, full.T).mu0, wMin.reduce((s, w, i) => s + w * full.m[i], 0), 1e-12);
  // Equal means: nothing to shrink.
  const flatMeans = full.m.map(() => 0.0005);
  const e = C.bayesStein(flatMeans, full.S, full.T);
  check(Math.abs(e.mu0 - 0.0005) < 1e-18 && e.phi === 1 && e.means.every((x) => Math.abs(x - 0.0005) < 1e-18), "bayesStein: equal means come back as they went in, phi = 1");

  // No capped mix beats the risk-free rate, though one asset does: null, where the uncapped QP answers.
  const S5 = [0, 1, 2, 3, 4].map((i) => [0, 1, 2, 3, 4].map((j) => (i === j ? 1e-4 : 2e-5)));
  const rfd = 0.0389 / TRADING_DAYS;
  const below = [rfd + 0.001, rfd - 0.001, rfd - 0.001, rfd - 0.001, rfd - 0.001];
  const above = [rfd + 0.004, rfd - 0.001, rfd - 0.001, rfd - 0.001, rfd - 0.001];
  check(O.tangencyCapped(below, S5, 0.0389, C.CAP) === null, "tangencyCapped: null when the capped simplex cannot beat rf");
  check(O.tangency(below, S5, 0.0389, false)?.beatsRf === true, "...while the uncapped long-only tangency can");
  const ab = O.tangencyCapped(above, S5, 0.0389, C.CAP);
  check(ab !== null && ab.beatsRf && Math.max(...ab.w) <= C.CAP + 1e-12, "tangencyCapped: solves once the capped simplex can beat rf");
  const cross = derive("cross");
  const cw = C.ownWindow("tan.cap", cross.cols);
  check(O.tangencyCapped(cw.m, cw.S, 0.3, C.CAP) === null, "tangencyCapped: null on cross at a 30% risk-free rate");
  check(C.solveAdded("tan.cap", cw.m, cw.S, cw.T, 0.3, true) === null, "solveAdded: tan.cap null there, shorting or not");
  // Four assets: the cap forces equal weight; three: no mix at all.
  const S4 = S5.slice(0, 4).map((r) => r.slice(0, 4));
  const w4 = O.tangencyCapped(above.slice(0, 4), S4, 0.0389, C.CAP);
  check(w4 !== null && w4.w.every((x) => Math.abs(x - 0.25) < 1e-12), "tangencyCapped: four assets at 25% are equal weight");
  check(O.tangencyCapped(above.slice(0, 3), S4.slice(0, 3).map((r) => r.slice(0, 3)), 0.0389, C.CAP) === null, "tangencyCapped: three assets cannot be held to 25%");

  // Risk parity reads no means, and on a diagonal covariance it is inverse volatility.
  const rp1 = O.riskParity(full.m, full.S);
  const rp2 = O.riskParity(full.m.map((x, i) => x * (i + 3) - 0.001), full.S);
  check(same(rp1.w, rp2.w), "riskParity: the means do not move the weights");
  const vols = [0.1, 0.2, 0.25, 0.4];
  const D = vols.map((v, i) => vols.map((_, j) => (i === j ? (v * v) / TRADING_DAYS : 0)));
  const inv = vols.map((v) => 1 / v);
  nearAll("riskParity: diagonal covariance gives inverse volatility", O.riskParity([0, 0, 0, 0], D).w, inv.map((x) => x / sumOf(inv)), 0, 1e-12);
  // A strongly correlated pair beside a lone asset: shares still equal.
  const P = [[4e-4, 3.6e-4, 0], [3.6e-4, 4e-4, 0], [0, 0, 1e-4]];
  const rpP = O.riskParity([0, 0, 0], P);
  check(riskContribution(rpP.w, P).every((s) => Math.abs(s - 1 / 3) <= O.RP_TOL), "riskParity: equal shares with a correlated pair");
  check(O.riskParity([0, 0], [[1e-4, 0], [0, -1e-4]]) === null, "riskParity: null when a variance is not positive");
}

// ---- the fragility rows -------------------------------------------------------------------------------

for (const [name, cols, rf] of [
  ["megacap", derive("megacap").cols, derive("megacap").oracle.rf],
  ["sectors", derive("sectors").cols, derive("sectors").oracle.rf],
  ["example", exampleAnalysis({}).returns, exampleAnalysis({}).rf],
]) {
  const T = cols[0].length;
  const n = cols.length;
  for (const allowShort of [false, true]) {
    const lab = `${name}${allowShort ? " short" : ""}`;
    for (const id of C.ADDED_IDS) {
      const own = C.ownWindow(id, cols);
      // The caller's lookback weights: the construction solved on each trailing window.
      const lookbacks = windows(T).map(({ lb }) => {
        const w = windowMoments(cols, lb);
        return C.solveAdded(id, w.m, w.S, lb, rf, allowShort)?.w ?? null;
      });
      const strip = R.addedStrip(id, own.m, own.S, rf, allowShort, own.T);
      const x = { m: own.m, S: own.S, rf, allowShort, T: own.T, lookbacks, redraws: null, strip };
      const f = R.fragility(id, x);
      const base = C.solveAdded(id, own.m, own.S, own.T, rf, allowShort);

      // Row 4.
      const want = id === "rp" ? (n * (n + 1)) / 2 : n + (n * (n + 1)) / 2;
      check(f.params === want && R.paramCount(id, n) === want, `${lab}: ${id} estimates ${want} parameters`);
      check(f.days === (id === "tan.1y" ? TRADING_DAYS : T), `${lab}: ${id} from its own window's days`);

      // Row 1.
      if (id === "tan.1y") check(f.lookback === null, `${lab}: tan.1y has no lookback row`);
      else check(same(f.lookback, R.lookbackSpread(lookbacks)), `${lab}: ${id} lookback row from the caller's windows`);

      // Row 2, worked here: the largest holding's daily mean lowered by one standard error, sqrt(S_ii / T).
      const from = firstTop(base.w);
      const cutMeans = own.m.slice();
      cutMeans[from] = own.m[from] - Math.sqrt(own.S[from][from] / own.T);
      const after = C.solveAdded(id, cutMeans, own.S, own.T, rf, allowShort);
      check(f.cut !== null && f.cut.from === from && f.cut.to === firstTop(after.w), `${lab}: ${id} cut row names the right holdings`);
      if (f.cut) {
        near(`${lab}: ${id} weight before the cut`, f.cut.weightBefore, base.w[from], 0, 1e-15);
        near(`${lab}: ${id} weight after the cut`, f.cut.weightAfter, after.w[from], 0, 1e-9);
        near(`${lab}: ${id} drop`, f.cut.drop, base.w[from] - after.w[from], 0, 1e-9);
      }
      if (id === "rp") check(f.cut && f.cut.drop === 0 && f.cut.to === f.cut.from, `${lab}: rp's cut moves nothing`);

      // Row 3: the strip, re-solved here draw by draw on the same seed.
      const draws = R.drawMeans(own.m, own.S, own.T, R.REDRAWS, DEFAULT_SEED);
      const manual = draws.map((dm) => C.solveAdded(id, dm, own.S, own.T, rf, allowShort)?.w ?? null);
      check(strip.solved === manual.filter(Boolean).length && same(strip.w, manual), `${lab}: ${id} strip = the construction re-solved on each seeded draw`);
      const counts = new Array(n).fill(0);
      for (const w of manual) if (w) counts[firstTop(w)] += 1;
      check(same(strip.largest, counts), `${lab}: ${id} largest-holding counts break ties to the first ticker`);
      check(same(f.draws, R.drawSpread(strip, firstTop(base.w))), `${lab}: ${id} draw row from its own strip`);
      check(same(R.addedStrip(id, own.m, own.S, rf, allowShort, own.T), strip), `${lab}: ${id} strip repeats on the same seed`);
      if (id === "rp") {
        check(strip.solved === R.REDRAWS && strip.p10.every((p, i) => p === strip.p90[i]) && f.draws.width === 0, `${lab}: rp strip has zero width`);
      } else {
        check(!same(R.addedStrip(id, own.m, own.S, rf, allowShort, own.T, R.REDRAWS, DEFAULT_SEED + 1).w, strip.w), `${lab}: ${id} strip moves with the seed`);
      }
      check(R.fragility(id, { ...x, strip: null }).draws === null, `${lab}: ${id} no strip, no draw row`);
    }
    // The last-year strip is drawn with T = 252, not the window's T.
    const y = C.ownWindow("tan.1y", cols);
    const wide = R.addedStrip("tan.1y", y.m, y.S, rf, allowShort, T);
    check(!same(wide.w, R.addedStrip("tan.1y", y.m, y.S, rf, allowShort, y.T).w), `${lab}: the year's strip depends on its own T`);
  }
}

// ---- ties at the cap ----------------------------------------------------------------------------------

{
  check(R.largestHoldingTied([0.25, 0.1, 0.25000000000000006, 0.25]) === 0, "tied: rounding above the cap does not win a tie");
  check(R.largestHoldingTied([0.2, 0.3, 0.3 + 1e-9]) === 2 && R.largestHoldingTied([]) === -1, "tied: a real difference still wins; empty is -1");
  const d = derive("megacap");
  const own = C.ownWindow("tan.cap", d.cols);
  const cut = R.cutAdded("tan.cap", own.m, own.S, d.oracle.rf, false, own.T);
  const at = (w) => w.map((x, i) => (Math.abs(x - C.CAP) <= 1e-12 ? i : -1)).filter((i) => i >= 0);
  const base = C.solveAdded("tan.cap", own.m, own.S, own.T, d.oracle.rf, false);
  check(at(base.w).length > 1 && cut.from === at(base.w)[0], "megacap: the capped mix ties at 25% and the cut starts from the first of them");
}

// ---- the four portfolios that were there before: unchanged ---------------------------------------------

{
  const { fitWindows } = await import("../src/tabs/sensitivity/model.ts");
  for (const allowShort of [false, true]) {
    const a = exampleAnalysis({ allowShort });
    const T = a.dates.length;
    const n = a.m.length;
    const red = R.redraw(a.m, a.S, a.rf, allowShort, T);
    const fits = fitWindows(a).value;
    const stray = R.addedStrip("tan.bs", a.m, a.S, a.rf, allowShort, T);
    for (const kind of ["ew", "custom", "gmv", "tan"]) {
      const x = { m: a.m, S: a.S, rf: a.rf, allowShort, T, lookbacks: fits.map((f) => f[kind]?.w ?? null), redraws: red };
      const f = R.fragility(kind, x);
      check(same(R.fragility(kind, { ...x, strip: stray }), f), `example ${allowShort}: ${kind} ignores an added strip`);
      if (kind === "ew" || kind === "custom") {
        check(f.params === 0 && f.lookback.spread === 0 && f.cut.drop === 0 && f.draws.width === 0, `example ${allowShort}: ${kind} rows are zero`);
        continue;
      }
      const base = kind === "tan" ? O.tangency(a.m, a.S, a.rf, allowShort) : O.gmv(a.m, a.S, allowShort);
      const s = kind === "tan" ? red.tan : red.gmv;
      check(same(f.lookback, R.lookbackSpread(x.lookbacks)) && same(f.cut, R.cutLargest(kind, a.m, a.S, a.rf, allowShort, T))
        && same(f.draws, R.drawSpread(s, argmax(base.w))) && f.days === T, `example ${allowShort}: ${kind} rows as before`);
      check(f.params === (kind === "gmv" ? (n * (n + 1)) / 2 : n + (n * (n + 1)) / 2), `example ${allowShort}: ${kind} parameter count as before`);
    }
    check(R.paramCount("ew", n) === 0 && R.paramCount("custom", n) === 0, "fixed portfolios estimate nothing");
  }
}

done("t-constructions");
