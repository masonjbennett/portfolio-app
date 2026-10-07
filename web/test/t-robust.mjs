// The what-if arithmetic in src/lib/robust.ts and the seeded generator in src/lib/rng.ts.
//
// Every what-if re-solves the SHIPPING tangency() and gmv(), so the oracle for a what-if is those two
// functions called directly on the what-if's inputs, and the checks below hold the module to them bit for
// bit. What they pin:
//   - one expected return replaced: the re-solve equals tangency() on the replaced means, the input is held
//     to two standard errors either side, and the minimum-variance weights never move (they never read the
//     means, and the module does not special-case that: this suite proves it);
//   - the seeded draws: the same seed gives the same draws, another seed gives others, and over many draws
//     their sample mean and covariance approach the window's means and S / T;
//   - the percentiles: numpy's default ("linear") method, against values worked by hand and against a
//     direct sort-and-interpolate written here;
//   - the four fragility rows, the lookback row against the Sensitivity tab's own swing();
//   - the odd baskets: no asset beating the risk-free rate, long-only and with shorting, and shorting on.
//
// There is no numpy oracle for the draws: a JavaScript generator cannot reproduce numpy's stream, so the
// draws are held to their distribution (within a tolerance derived below) and to their own seed instead.
import { check, close, done, near } from "./_assert.mjs";
import { exampleAnalysis, fixtureAnalysis } from "./_analysis.mjs";

const R = await import("../src/lib/robust.ts");
const { DEFAULT_SEED, mulberry32, normals } = await import("../src/lib/rng.ts");
const { gmv, tangency } = await import("../src/lib/optimize.ts");
const { TRADING_DAYS } = await import("../src/lib/stats.ts");
const { fitWindows, swing } = await import("../src/tabs/sensitivity/model.ts");

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const argmax = (w) => w.reduce((b, x, i) => (x > w[b] ? i : b), 0);

const baskets = [];
for (const [name, make] of [
  ["example", (o) => exampleAnalysis(o)],
  ["megacap", (o) => fixtureAnalysis("megacap", o)],
]) {
  for (const allowShort of [false, true]) baskets.push({ label: `${name}${allowShort ? " short" : ""}`, a: make({ allowShort }) });
}

// ---- standard errors and the band ---------------------------------------------------------------------

for (const { label, a } of baskets) {
  const T = a.dates.length;
  const se = R.meanStdErrors(a.S, T);
  // The same quantity reached another way: annual volatility times sqrt(252 / T).
  a.S.forEach((row, i) => near(`${label}: standard error of ${a.tickers[i]}`, se[i], Math.sqrt(TRADING_DAYS * row[i]) * Math.sqrt(TRADING_DAYS / T), 1e-12));
  const b = R.returnBand(a.m, a.S, T, 0);
  check(b.estimate === a.m[0] * TRADING_DAYS && b.se === se[0], `${label}: band centred on the annual estimate`);
  check(b.lo1 === b.estimate - b.se && b.hi1 === b.estimate + b.se, `${label}: one-SE band`);
  check(b.lo2 === b.estimate - 2 * b.se && b.hi2 === b.estimate + 2 * b.se, `${label}: two-SE range`);
}

// ---- one expected return replaced ---------------------------------------------------------------------

for (const { label, a } of baskets) {
  const T = a.dates.length;
  const g0 = gmv(a.m, a.S, a.allowShort);
  let exact = true;
  let gmvStill = true;
  let largestOk = true;
  for (let i = 0; i < a.m.length; i++) {
    const b = R.returnBand(a.m, a.S, T, i);
    for (const v of [b.lo2, b.lo1, b.estimate, b.hi1, b.hi2]) {
      const nu = R.nudgeTangency(a.m, a.S, a.rf, a.allowShort, T, i, v);
      const means = a.m.slice();
      means[i] = v / TRADING_DAYS;
      const direct = tangency(means, a.S, a.rf, a.allowShort);
      if (!same(nu.tangency, direct) || !same(nu.means, means) || nu.clamped) exact = false;
      if (!same(nu.gmv.w, g0.w)) gmvStill = false;
      if (nu.largest !== (direct ? argmax(direct.w) : null)) largestOk = false;
    }
  }
  check(exact, `${label}: every what-if equals tangency() on the replaced means`);
  check(gmvStill, `${label}: GMV weights identical under every what-if`);
  check(largestOk, `${label}: largest holding of each what-if`);

  const b = R.returnBand(a.m, a.S, T, 1);
  const hi = R.nudgeTangency(a.m, a.S, a.rf, a.allowShort, T, 1, b.hi2 + 1);
  const lo = R.nudgeTangency(a.m, a.S, a.rf, a.allowShort, T, 1, b.lo2 - 1);
  check(hi.mu === b.hi2 && hi.clamped && hi.requested === b.hi2 + 1, `${label}: a request above +2 SE is held at +2 SE`);
  check(lo.mu === b.lo2 && lo.clamped, `${label}: a request below -2 SE is held at -2 SE`);
  check(same(hi.tangency, R.nudgeTangency(a.m, a.S, a.rf, a.allowShort, T, 1, b.hi2).tangency), `${label}: the held request solves at the edge`);
  const t0 = tangency(a.m, a.S, a.rf, a.allowShort);
  check(R.largestTangencyHolding(a.m, a.S, a.rf, a.allowShort) === argmax(t0.w), `${label}: largest tangency holding`);
}

{
  const { a } = baskets[0];
  const T = a.dates.length;
  const bad = [-1, a.m.length, 0.5, NaN].map((i) => R.nudgeTangency(a.m, a.S, a.rf, false, T, i, 0.1));
  check(bad.every((x) => x === null), "a what-if on no asset is null");
  check([NaN, Infinity].every((v) => R.nudgeTangency(a.m, a.S, a.rf, false, T, 0, v) === null), "a what-if on no number is null");
  check(R.largestHolding([0.4, 0.4, 0.2]) === 0, "largest holding: a tie goes to the first ticker");
  check(R.largestHolding([-0.9, 0.3, 0.6]) === 2, "largest holding: the largest long, not the largest short");
  check(R.largestHolding([]) === -1, "largest holding of nothing");
}

// ---- the generator --------------------------------------------------------------------------------------

{
  const seq = (seed, k) => {
    const u = mulberry32(seed);
    return Array.from({ length: k }, () => u());
  };
  const a = seq(DEFAULT_SEED, 1000);
  check(same(a, seq(DEFAULT_SEED, 1000)), "uniforms: the same seed repeats exactly");
  check(!same(a, seq(DEFAULT_SEED + 1, 1000)), "uniforms: another seed differs");
  check(a.every((x) => x >= 0 && x < 1), "uniforms lie in [0, 1)");
  // K standard normals: their mean has standard error 1/sqrt(K) and their variance about sqrt(2/K).
  // Four standard errors either side is a band a correct generator leaves with probability under 1e-4,
  // and the seed is fixed, so this is the same check on every run.
  const K = 100000;
  const z = normals(mulberry32(DEFAULT_SEED));
  const zs = Array.from({ length: K }, () => z());
  const mz = zs.reduce((s, x) => s + x, 0) / K;
  const vz = zs.reduce((s, x) => s + (x - mz) ** 2, 0) / (K - 1);
  check(Math.abs(mz) < 4 / Math.sqrt(K), "normals: mean 0", `${mz}`);
  check(Math.abs(vz - 1) < 4 * Math.sqrt(2 / K), "normals: variance 1", `${vz}`);
  check(zs.every(Number.isFinite), "normals are finite");
}

// ---- the draws -------------------------------------------------------------------------------------------

{
  const { label, a } = baskets[0];
  const T = a.dates.length;
  const n = a.m.length;
  const L = R.cholFactor(a.S);
  let worst = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += L[i][k] * L[j][k];
      worst = Math.max(worst, Math.abs(s - a.S[i][j]) / Math.abs(a.S[i][i]));
    }
  }
  check(worst < 1e-12, `${label}: Cholesky factor reproduces S`, `${worst}`);
  check(L.every((row, i) => row.every((v, k) => k <= i || v === 0)), `${label}: Cholesky factor is lower-triangular`);
  const flat = [[1, 1], [1, 1]];
  check(R.cholFactor(flat) === null && R.drawMeans([0, 0], flat, 100, 5) === null, "no factor, no draws");
  check(R.redraw([0, 0], flat, 0, false, 100) === null, "no factor, no redraw");

  const d1 = R.drawMeans(a.m, a.S, T, 50, DEFAULT_SEED);
  check(same(d1, R.drawMeans(a.m, a.S, T, 50, DEFAULT_SEED)), `${label}: draws repeat exactly for the same seed`);
  check(same(d1, R.drawMeans(a.m, a.S, T, 50)), `${label}: the default seed is DEFAULT_SEED`);
  check(!same(d1, R.drawMeans(a.m, a.S, T, 50, DEFAULT_SEED + 1)), `${label}: another seed draws differently`);

  // Over K draws the sample mean of asset i has standard error sqrt(C_ii / K), with C = S / T, and the
  // sample covariance of i and j has standard error about sqrt((C_ii C_jj + C_ij^2) / K), the normal
  // distribution's own. Four standard errors: a correct draw leaves that band with probability under 1e-4
  // per entry, and a draw scaled by S instead of S / T, or with its factor transposed, misses it by far.
  const K = 20000;
  const D = R.drawMeans(a.m, a.S, T, K, DEFAULT_SEED);
  const C = a.S.map((row) => row.map((v) => v / T));
  const mean = a.m.map((_, i) => D.reduce((s, d) => s + d[i], 0) / K);
  let meanOk = true;
  let covOk = true;
  for (let i = 0; i < n; i++) {
    if (Math.abs(mean[i] - a.m[i]) > 4 * Math.sqrt(C[i][i] / K)) meanOk = false;
    for (let j = 0; j < n; j++) {
      const c = D.reduce((s, d) => s + (d[i] - mean[i]) * (d[j] - mean[j]), 0) / (K - 1);
      if (Math.abs(c - C[i][j]) > 4 * Math.sqrt((C[i][i] * C[j][j] + C[i][j] ** 2) / K)) covOk = false;
    }
  }
  check(meanOk, `${label}: draws centre on the window's means`);
  check(covOk, `${label}: draws spread as S / T`);
}

// ---- percentiles -----------------------------------------------------------------------------------------

{
  // numpy.percentile([1, 2, 3, 4], 10) is 1.3 and at 90 is 3.7: position (n - 1) q / 100 = 0.3 and 2.7.
  check(close(R.percentile([4, 1, 3, 2], 10), 1.3, 1e-15) && close(R.percentile([4, 1, 3, 2], 90), 3.7, 1e-15), "percentile: worked values");
  check(R.percentile([3, 1, 2], 0) === 1 && R.percentile([3, 1, 2], 100) === 3 && R.percentile([3, 1, 2], 50) === 2, "percentile: ends and middle");
  check(R.percentile([7], 10) === 7 && Number.isNaN(R.percentile([], 10)), "percentile: one value, and none");
  // A direct sort-and-interpolate: the rank h = (n - 1) q / 100 falls between two sorted values.
  const direct = (xs, q) => {
    const s = [...xs].sort((x, y) => x - y);
    const h = ((s.length - 1) * q) / 100;
    const k = Math.floor(h);
    return k + 1 < s.length ? s[k] + (h - k) * (s[k + 1] - s[k]) : s[k];
  };
  const u = mulberry32(DEFAULT_SEED + 7);
  let ok = true;
  for (let t = 0; t < 200; t++) {
    const xs = Array.from({ length: 1 + Math.floor(u() * 40) }, () => u() - 0.5);
    for (const q of [0, 10, 25, 50, 90, 100]) if (!close(R.percentile(xs, q), direct(xs, q), 1e-12, 1e-15)) ok = false;
  }
  check(ok, "percentile: matches a direct sort-and-interpolate");
}

// ---- redraws ---------------------------------------------------------------------------------------------

const redraws = new Map();
for (const { label, a } of baskets) {
  const T = a.dates.length;
  const r = R.redraw(a.m, a.S, a.rf, a.allowShort, T);
  redraws.set(label, r);
  check(r.count === R.REDRAWS && r.tan.w.length === R.REDRAWS && r.seed === DEFAULT_SEED, `${label}: redraw count and seed`);
  const D = R.drawMeans(a.m, a.S, T, R.REDRAWS, DEFAULT_SEED);
  check(r.tan.w.every((w, d) => same(w, tangency(D[d], a.S, a.rf, a.allowShort)?.w ?? null)), `${label}: each draw's weights are tangency() on that draw`);
  check(r.means.every((mu, d) => mu.every((x, i) => x === D[d][i] * TRADING_DAYS)), `${label}: each draw's means, annualised`);
  const g0 = gmv(a.m, a.S, a.allowShort).w;
  check(r.gmv.w.every((w) => same(w, g0)), `${label}: GMV identical on every draw`);
  check(r.gmv.p10.every((x, i) => x === r.gmv.p90[i]), `${label}: GMV strip is a single point`);
  const ok = r.tan.w.filter(Boolean);
  check(r.tan.solved === ok.length, `${label}: solved count`);
  check(r.tan.weights.every((xs, i) => same(xs, ok.map((w) => w[i]))), `${label}: per-asset weights in draw order`);
  check(r.tan.p10.every((x, i) => x === R.percentile(r.tan.weights[i], 10)) && r.tan.p90.every((x, i) => x === R.percentile(r.tan.weights[i], 90)), `${label}: strip percentiles`);
  const counts = a.m.map((_, i) => ok.filter((w) => argmax(w) === i).length);
  check(same(r.tan.largest, counts), `${label}: largest-holding counts`);
  check(r.belowRf === r.tan.w.filter((w, d) => w && !tangency(D[d], a.S, a.rf, a.allowShort).beatsRf).length, `${label}: below-rf count`);
  check(same(r, R.redraw(a.m, a.S, a.rf, a.allowShort, T)), `${label}: a redraw repeats exactly`);
  check(!same(r.tan.w, R.redraw(a.m, a.S, a.rf, a.allowShort, T, R.REDRAWS, DEFAULT_SEED + 1).tan.w), `${label}: another seed redraws differently`);
}

// ---- fragility rows ----------------------------------------------------------------------------------------

for (const { label, a } of baskets) {
  const T = a.dates.length;
  const n = a.m.length;
  const fits = fitWindows(a).value;
  const input = (kind) => ({ m: a.m, S: a.S, rf: a.rf, allowShort: a.allowShort, T, lookbacks: fits.map((f) => f[kind]?.w ?? null), redraws: redraws.get(label) });

  for (const kind of ["ew", "custom"]) {
    // Nothing to read: no windows, no draws. The zeros must come back without them.
    const f = R.fragility(kind, { m: a.m, S: a.S, rf: a.rf, allowShort: a.allowShort, T, lookbacks: [], redraws: null });
    check(f.lookback.spread === 0 && f.cut.drop === 0 && f.draws.width === 0, `${label}: ${kind} reads zero on rows 1-3`);
    check([f.lookback.asset, f.lookback.lo, f.cut.from, f.cut.to, f.cut.weightAfter, f.draws.asset, f.draws.p10].every((x) => x === null), `${label}: ${kind} names no asset`);
    check(f.params === 0 && f.days === T, `${label}: ${kind} estimates nothing`);
  }

  for (const kind of ["gmv", "tan"]) {
    const f = R.fragility(kind, input(kind));
    const s = swing(fits, kind, a.tickers);
    check(f.lookback.spread === s.hi - s.lo && a.tickers[f.lookback.asset] === s.ticker, `${label}: ${kind} lookback row equals the Sensitivity tab's swing`);
    const base = kind === "tan" ? tangency(a.m, a.S, a.rf, a.allowShort) : gmv(a.m, a.S, a.allowShort);
    const from = argmax(base.w);
    const lo1 = R.returnBand(a.m, a.S, T, from).lo1;
    const means = a.m.slice();
    means[from] = lo1 / TRADING_DAYS;
    const after = kind === "tan" ? tangency(means, a.S, a.rf, a.allowShort) : gmv(means, a.S, a.allowShort);
    check(f.cut.from === from && f.cut.weightBefore === base.w[from] && f.cut.weightAfter === after.w[from], `${label}: ${kind} cut row re-solves at -1 SE`);
    check(f.cut.to === argmax(after.w) && f.cut.toWeight === after.w[f.cut.to] && f.cut.drop === base.w[from] - after.w[from], `${label}: ${kind} largest after the cut`);
    const st = redraws.get(label)[kind];
    check(f.draws.asset === from && f.draws.p10 === st.p10[from] && f.draws.p90 === st.p90[from] && f.draws.width === st.p90[from] - st.p10[from], `${label}: ${kind} draw row`);
    // Parameters, counted: every covariance entry on or above the diagonal, plus a mean per asset for tangency.
    let cov = 0;
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) cov += 1;
    check(f.params === cov + (kind === "tan" ? n : 0) && f.days === T, `${label}: ${kind} parameters against days`);
    check(R.fragility(kind, { ...input(kind), redraws: null }).draws === null, `${label}: ${kind} draw row without redraws`);
  }
  const g = R.fragility("gmv", input("gmv"));
  check(g.cut.drop === 0 && g.draws.width === 0, `${label}: GMV does not move on the means (computed, not assumed)`);
}

{
  const w = [[0.2, 0.8], null, [0.5, 0.5], [0.1, 0.9]];
  const s = R.lookbackSpread(w);
  check(s.asset === 0 && s.lo === 0.1 && s.hi === 0.5 && s.spread === 0.5 - 0.1, "lookback row skips a failed window");
  check(R.lookbackSpread([[0.3, 0.7], null]) === null && R.lookbackSpread([]) === null, "lookback row needs two solved windows");
  check(R.lookbackSpread([[0.3, 0.7], [0.4, 0.6]]).asset === 0, "lookback row: a tie goes to the first ticker");

  // Ranges that differ only in the last bit print alike (60.0 points), so they tie and the first asset
  // wins, in either order and whichever is wider in the last bit; the Sensitivity tab's swing() is held to
  // the same answer. A range wider as printed (60.1) still wins on size.
  const two = (aLo, bHi) => [[1, 0], [aLo, bHi], [0.7, 0.3]];
  const flip = (W) => W.map((w) => w.slice().reverse());
  const out = [];
  for (const [what, W] of [["second a bit wider", two(0.4, 0.6000000000000001)], ["first a bit wider", two(0.39999999999999997, 0.6)]]) {
    for (const [order, V] of [["as given", W], ["reversed", flip(W)]]) {
      const s = R.lookbackSpread(V);
      const fits = V.map((w, k) => ({ named: `w${k}`, tan: { w }, gmv: null }));
      const t = swing(fits, "tan", ["P", "Q"]);
      out.push(`${what}, ${order}: ${s.asset}/${t?.ticker}`);
      if (s.asset !== 0 || t?.ticker !== "P" || s.spread !== V.reduce((m, w) => Math.max(m, w[0]), -1) - V.reduce((m, w) => Math.min(m, w[0]), 2)) out.push("  ^ wrong");
    }
  }
  check(!out.some((x) => x.includes("wrong")), "lookback row: ranges that print alike tie, and the first asset wins in either order, as the Sensitivity tab's swing() does", out.join("; "));
  const wider = R.lookbackSpread(two(0.4, 0.6006));
  check(wider.asset === 1 && (wider.spread * 100).toFixed(1) === "60.1", "lookback row: a range wider as printed (60.1 against 60.0) wins, though its asset comes later", JSON.stringify(wider));

  // The precision the ranges are compared at is the precision the row prints, no finer: two ranges equal at
  // one decimal and apart at the second (60.04 against 60.00 points), the later asset the wider, tie. And two
  // ranges a few ulps apart across a rounding edge, which print 60.5 and 60.4, are one range, so the last bit
  // does not decide either. The first asset wins in both orders, and swing() names the same one.
  const edge = [[0, 0], [0.6044999999999999, 0.6045], [0.3, 0.3]];
  const fine = [];
  for (const [what, W] of [["apart at the second decimal", two(0.4, 0.6004)], ["a few ulps across a rounding edge", edge]]) {
    for (const [order, V] of [["as given", W], ["reversed", flip(W)]]) {
      const s = R.lookbackSpread(V);
      const t = swing(V.map((w, k) => ({ named: `w${k}`, tan: { w }, gmv: null })), "tan", ["P", "Q"]);
      fine.push(`${what}, ${order}: ${s.asset}/${t?.ticker}`);
      if (s.asset !== 0 || t?.ticker !== "P") fine.push("  ^ wrong");
    }
  }
  const sides = [two(0.4, 0.6004), edge].map((W) => [0, 1].map((i) => Math.max(...W.map((w) => w[i])) - Math.min(...W.map((w) => w[i]))));
  check(sides[0].every((x) => (x * 100).toFixed(1) === "60.0") && sides[0][1] - sides[0][0] > 1e-4 && (sides[1][0] * 100).toFixed(1) !== (sides[1][1] * 100).toFixed(1),
    "lookback row: the precision cases are what they say (equal at one decimal and apart at the second; printing apart across the edge)", JSON.stringify(sides));
  check(!fine.some((x) => x.includes("wrong")), "lookback row: ranked at the precision it prints, no finer, and one range across a rounding edge, the first asset in either order, as swing() does", fine.join("; "));

  // A window whose weights hold a NaN is a failed window in both rules, wherever the NaN sits, so the two
  // still agree; before, the row took Math.min over the NaN and the finding skipped it, or froze on it.
  const nan = [];
  for (const [what, V] of [["NaN in the second asset's second window", [[0.1, 0.0, 0.3], [0.2, NaN, 0.3], [0.3, 0.9, 0.3]]], ["NaN in the first asset's first window", [[NaN, 0.1, 0.3], [0.2, 0.5, 0.3], [0.3, 0.9, 0.3]]]]) {
    const s = R.lookbackSpread(V);
    const t = swing(V.map((w, k) => ({ named: `w${k}`, tan: { w }, gmv: null })), "tan", ["AAA", "BBB", "CCC"]);
    nan.push(`${what}: ${s?.asset}/${t?.ticker} ${s?.lo}..${s?.hi} ${t?.lo}..${t?.hi}`);
    if (s?.asset !== 1 || t?.ticker !== "BBB" || !Number.isFinite(s.spread) || s.lo !== t.lo || s.hi !== t.hi) nan.push("  ^ wrong");
  }
  check(!nan.some((x) => x.includes("wrong")), "lookback row: a window holding a NaN weight counts as failed, and swing() agrees on the asset and its range", nan.join("; "));
}

// ---- odd baskets --------------------------------------------------------------------------------------------

{
  // A risk-free rate above every asset's expected return by six of its standard errors: past the two
  // a what-if may move it, and past anything a draw reaches (a normal passes six standard deviations
  // about once in a billion).
  const base = exampleAnalysis({ allowShort: false });
  const T = base.dates.length;
  const se = R.meanStdErrors(base.S, T);
  const rf = Math.max(...base.m.map((x, i) => x * TRADING_DAYS + 6 * se[i]));

  // Long-only: tangency() returns the least-negative portfolio, one asset alone; beatsRf is false.
  const a = exampleAnalysis({ allowShort: false, rf });
  const nu = R.nudgeTangency(a.m, a.S, a.rf, false, T, 0, a.m[0] * TRADING_DAYS);
  check(nu.tangency !== null && nu.tangency.beatsRf === false, "none beats rf, long-only: the least-negative portfolio, flagged");
  check(nu.tangency.w.filter((x) => x > 0).length === 1 && nu.tangency.w[nu.largest] === 1, "none beats rf, long-only: one asset alone is the largest");
  const r = R.redraw(a.m, a.S, a.rf, false, T);
  check(r.tan.solved === r.count && r.belowRf === r.count, "none beats rf, long-only: every draw solves, none beats rf");
  const f = R.fragility("tan", { m: a.m, S: a.S, rf: a.rf, allowShort: false, T, lookbacks: fitWindows(a).value.map((x) => x.tan?.w ?? null), redraws: r });
  check(f.cut !== null && f.draws !== null, "none beats rf, long-only: the rows still read");

  // Shorting: nothing inside the box beats the risk-free rate, so there is no tangency portfolio at all.
  const s = exampleAnalysis({ allowShort: true, rf: 50 });
  const ns = R.nudgeTangency(s.m, s.S, s.rf, true, T, 0, s.m[0] * TRADING_DAYS);
  check(ns.tangency === null && ns.largest === null && ns.gmv !== null, "none beats rf, shorting: no tangency, GMV still answers");
  check(R.largestTangencyHolding(s.m, s.S, s.rf, true) === null, "none beats rf, shorting: no largest holding");
  const rs = R.redraw(s.m, s.S, s.rf, true, T);
  check(rs.tan.solved === 0 && rs.tan.w.every((w) => w === null) && rs.tan.p10.every(Number.isNaN) && rs.tan.largest.every((c) => c === 0) && rs.belowRf === 0, "none beats rf, shorting: no draw solves");
  check(rs.gmv.solved === rs.count, "none beats rf, shorting: GMV solves on every draw");
  const fs = R.fragility("tan", { m: s.m, S: s.S, rf: s.rf, allowShort: true, T, lookbacks: [null, null], redraws: rs });
  check(fs.cut === null && fs.draws === null && fs.lookback === null, "none beats rf, shorting: the tangency rows are null");
  check(R.cutLargest("tan", s.m, s.S, s.rf, true, T) === null, "none beats rf, shorting: no cut row");
}

{
  // Shorting on: the what-if carries shorts, and the largest holding is the largest long.
  const a = baskets.find((b) => b.label === "example short").a;
  const T = a.dates.length;
  const t0 = tangency(a.m, a.S, a.rf, true);
  check(t0.w.some((x) => x < 0), "shorting: the example's tangency holds a short");
  const nu = R.nudgeTangency(a.m, a.S, a.rf, true, T, 0, R.returnBand(a.m, a.S, T, 0).lo1);
  check(nu.largest === argmax(nu.tangency.w) && nu.tangency.w[nu.largest] > 0, "shorting: the largest holding is a long");
}

done("t-robust");
