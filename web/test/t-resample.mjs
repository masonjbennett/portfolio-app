// The resampled tangency (tan.rs): src/lib/resample.ts, its column in src/lib/constructions.ts, and its rows on the page.
//
// The reference is written out here from the definition by the slow road: the same seeded rows from Session A's
// blockRows (src/lib/simulate.ts), each draw's means and covariance by a direct pass over those rows (covMatrix,
// ddof 1), tangency() on each, the counted draws averaged. resample() reads the moments from running sums instead,
// so agreement holds the sums, the run detection, the counting rule and the average at once. Tolerance: weights to
// 1e-9. Both sides solve the same QP; the moments differ only by rounding (measured worst 3e-13 on the weights).
import { check, done, maxAbsDiff, near } from "./_assert.mjs";
import { derive } from "./_fixtures.mjs";
import { exampleAnalysis } from "./_analysis.mjs";

const RS = await import("../src/lib/resample.ts");
const C = await import("../src/lib/constructions.ts");
const R = await import("../src/lib/robust.ts");
const SIM = await import("../src/lib/simulate.ts");
const { tangency } = await import("../src/lib/optimize.ts");
const { covMatrix, mean } = await import("../src/lib/num.ts");
const { DEFAULT_SEED, mulberry32 } = await import("../src/lib/rng.ts");
const { TRADING_DAYS } = await import("../src/lib/stats.ts");
const M = await import("../src/tabs/optimization/model.ts");
const SC = await import("../src/tabs/optimization/scorecard.ts");
const { customWeights } = M;
const { BUILD_ROWS } = await import("../src/tabs/build.ts");

// The definition, slowly: seeded rows, direct moments, tangency, the draws that beat the rate averaged.
function reference(cols, rf, allowShort, { draws = SIM.PATHS, seed = DEFAULT_SEED, m: centre } = {}) {
  const T = cols[0].length;
  const bar = cols.map(mean);
  const shift = centre ? centre.map((c, i) => c - bar[i]) : bar.map(() => 0);
  const u = mulberry32(seed);
  const kept = [];
  for (let p = 0; p < draws; p++) {
    const idx = SIM.blockRows(T, T, u);
    const rows = cols.map((c) => Array.from(idx, (t) => c[t]));
    const m = rows.map((r, i) => mean(r) + shift[i]);
    const S = covMatrix(rows);
    const t = tangency(m, S, rf, allowShort);
    if (t && t.beatsRf) kept.push(t.w);
  }
  if (!kept.length) return null;
  return { w: bar.map((_, i) => kept.reduce((s, k) => s + k[i], 0) / kept.length), counted: kept.length, kept };
}

const a = exampleAnalysis();
const cols = a.returns;
const n = cols.length;

// ---- the resampler against the slow definition -----------------------------------------------------------
for (const allowShort of [false, true]) {
  const tag = (s) => `${allowShort ? "shorting on" : "long only"}: ${s}`;
  const got = RS.resample(cols, a.rf, allowShort);
  const ref = reference(cols, a.rf, allowShort);
  check(got && ref && got.counted === ref.counted && got.draws === SIM.PATHS, tag("the same draws count, out of the Range of outcomes' path count"), `${got?.counted} ${ref?.counted}`);
  check(got && ref && maxAbsDiff(got.w, ref.w) < 1e-9, tag("averaged weights match the definition: seeded rows, direct moments, tangency, average"), String(got && ref && maxAbsDiff(got.w, ref.w)));
  const pct = (q) => ref.w.map((_, i) => R.percentile(ref.kept.map((k) => k[i]), q));
  check(got && maxAbsDiff(got.p10, pct(10)) < 1e-9 && maxAbsDiff(got.p90, pct(90)) < 1e-9, tag("each weight's 10th and 90th percentile over the counted draws"));
  check(got && Math.abs(got.w.reduce((s, x) => s + x, 0) - 1) < 1e-12 && got.p10.every((x, i) => x <= got.p90[i]), tag("weights sum to 1, and each band is in order"));
}

// The seed is the page's unless another is passed, and a different one moves the answer.
{
  const once = RS.resample(cols, a.rf, false);
  const again = RS.resample(cols, a.rf, false, { seed: DEFAULT_SEED });
  const other = RS.resample(cols, a.rf, false, { seed: DEFAULT_SEED + 1 });
  check(JSON.stringify(once) === JSON.stringify(again) && maxAbsDiff(once.w, other.w) > 1e-6, "seed: the default is DEFAULT_SEED, and another seed draws other rows");
}

// Centring: means moved by d for one asset move every draw by d, exactly as adding d to that asset's every return does.
{
  const d = -0.0002;
  const m = cols.map(mean);
  m[2] += d;
  const moved = RS.resample(cols, a.rf, false, { m });
  const shifted = RS.resample(cols.map((c, i) => (i === 2 ? c.map((x) => x + d) : c)), a.rf, false);
  check(maxAbsDiff(moved.w, shifted.w) < 1e-9 && maxAbsDiff(moved.w, RS.resample(cols, a.rf, false).w) > 1e-4,
    "centre: means passed in shift every draw, as shifting the returns themselves does", String(maxAbsDiff(moved.w, shifted.w)));
}

// Counting: a draw with no tangency above the rate is left out, never averaged as the least negative mix.
{
  const high = 0.2;
  const got = RS.resample(cols, high, false, { draws: 300 });
  const ref = reference(cols, high, false, { draws: 300 });
  check(got && ref && got.counted === ref.counted && got.counted < 300 && got.counted > 0 && maxAbsDiff(got.w, ref.w) < 1e-9,
    "counting: at a 20% rate only the draws whose tangency beats it are averaged", `${got?.counted} ${ref?.counted}`);
  check(RS.resample(cols, 5, false, { draws: 50 }) === null && RS.resample(cols.map((c) => c.slice(0, SIM.BLOCK_DAYS - 1)), a.rf, false) === null,
    "counting: null when no draw beats the rate, and on a window shorter than one block");
}

// ---- the column -------------------------------------------------------------------------------------------
{
  const fit = M.addedFit(a, "tan.rs");
  const rs = RS.resample(cols, a.rf, a.allowShort);
  check(fit.reason === null && fit.own.rows === a.returns && maxAbsDiff(fit.sol.w, rs.w) < 1e-15 && fit.sol.rs.counted === rs.counted,
    "column: tan.rs is the resample of the window's own rows at the page's rate and switch");
  const m = fit.own.m;
  near("column: mu is the averaged weights' on the sample means", fit.sol.mu, fit.sol.w.reduce((s, w, i) => s + w * m[i], 0) * TRADING_DAYS, 1e-12);
  check(C.solveAdded("tan.rs", fit.own.m, fit.own.S, fit.own.T, a.rf, a.allowShort) === null, "column: without the rows it was estimated from, there is nothing to resample");
  check(R.addedStrip("tan.rs", fit.own.m, fit.own.S, a.rf, a.allowShort, fit.own.T) === null && R.paramCount("tan.rs", n) === n + (n * (n + 1)) / 2,
    "column: no 200 redraws of an average of 2,000 solves; it estimates the tangency's parameters");
  // The cut row: the largest holding's mean lowered by one standard error, every draw centred on the cut means.
  const frag = SC.addedFragility(a, "tan.rs", null);
  const from = R.largestHoldingTied(fit.sol.w);
  const cutM = m.slice();
  cutM[from] = R.returnBand(m, fit.own.S, fit.own.T, from).lo1 / TRADING_DAYS;
  const after = RS.resample(cols, a.rf, a.allowShort, { m: cutM });
  check(frag.cut && frag.cut.from === from && Math.abs(frag.cut.weightAfter - after.w[from]) < 1e-12 && frag.cut.drop > 0 && frag.draws === null,
    "cut row: re-resampled on the cut means; its draw row is a dash", `${frag.cut?.drop}`);
  const looks = M.addedLookbacks(a, "tan.rs");
  const lb = 504;
  const short = cols.map((c) => c.slice(c.length - lb));
  check(looks.length > 1 && maxAbsDiff(looks[1], RS.resample(short, a.rf, a.allowShort).w) < 1e-12 && looks.at(-1) === fit.sol.w,
    "lookback row: each trailing window resampled on its own rows; the full window is the column itself");

  // The words: the caption ties it to the redraws row, the weights table carries the band.
  const c = customWeights(a, {});
  const ready = { status: "ready", value: null };
  const model = SC.scorecard(a, c, ready, ["tan.rs"], { "tan.rs": ready });
  const plain = SC.scorecard(a, c, ready);
  check(model.conventions.includes(`"${BUILD_ROWS.redraws}" shows how far one solve's weights swing`) && model.conventions.includes(`${SIM.PATHS.toLocaleString("en-US")} redraws`) &&
    model.conventions.includes(`under "${BUILD_ROWS.holdings}"`) && !plain.conventions.includes("Michaud"),
    "caption: names the redraws row and where the band is, only with the column on", model.conventions);
  check(!(SC.addedDrawNote(a, ["tan.rs"], { "tan.rs": ready }) ?? "").includes("Cholesky"),
    "caption: its dash in the draw row is not blamed on a covariance with no factor");
  const table = M.weightTable(a, ["tan.rs"]);
  const keys = table.value.columns.map((x) => x.key);
  check(keys.slice(-3).join() === "tan.rs,tan.rs.p10,tan.rs.p90" && table.value.rows.every((r, i) => r["tan.rs.p10"] === fit.sol.rs.p10[i] && r["tan.rs.p90"] === fit.sol.rs.p90[i]),
    "weights table: the averaged weight, then its 10th and 90th percentile across the draws");
}

// ---- cost: under the 150 ms line per resample, which is why each runs in its own macrotask --------------
{
  const set = derive("sectors");
  RS.resample(set.cols, set.oracle.rf, false, { draws: 20 });
  const t0 = performance.now();
  RS.resample(set.cols, set.oracle.rf, false);
  const ms = performance.now() - t0;
  const steps = (await import("../src/tabs/optimization/redraws.ts")).resampledSteps(a);
  check(ms < 400 && steps.length === 1 + (await import("../src/lib/portfolio.ts")).windows(a.dates.length).length + 1,
    "cost: one resample of nine assets is one macrotask; the column is one per resample", `${ms.toFixed(0)} ms, ${steps.length} steps`);
}

done("t-resample");
