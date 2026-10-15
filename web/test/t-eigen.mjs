// The symmetric eigen solver and the "independent bets" summary (src/lib/eigen.ts), FDA2 Week 12.
//
// (a) Known matrices: diagonal, 2 x 2 correlation (1 ± r), equicorrelation (1 + (n-1)ρ, then 1 - ρ), and a
//     4 x 4 with a negative eigenvalue against numpy 2.4.6's eigvalsh.
// (b) On a 10 x 10 correlation matrix: eigenvalues sum to N, eigenvectors orthonormal, V Λ Vᵀ rebuilds it.
// (c) bets(): shares sum to 1, one driver gives 1 bet, independence gives N, the entropy form, PC1's sign,
//     and null on an undefined entry.
import { check, near, done } from "./_assert.mjs";
import { symEigen, bets } from "../src/lib/eigen.ts";
import { corrMatrix } from "../src/lib/num.ts";
import { mulberry32 } from "../src/lib/rng.ts";

const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
const maxAbs = (m) => Math.max(...m.flat().map(Math.abs));

// ---- (a) known matrices ---------------------------------------------------------------------------------
{
  const e = symEigen([[3, 0, 0], [0, 7, 0], [0, 0, 1]]);
  check(JSON.stringify(e.values) === "[7,3,1]", "diagonal: its entries, largest first", e.values.join());
  check(Math.abs(e.vectors[0][1]) === 1, "diagonal: the largest value's vector is its own axis", e.vectors[0].join());
}
{
  const r = 0.6;
  const e = symEigen([[1, r], [r, 1]]);
  near("2 x 2: the larger eigenvalue is 1 + r", e.values[0], 1 + r, 1e-14);
  near("2 x 2: the smaller is 1 - r", e.values[1], 1 - r, 1e-14);
  near("2 x 2: the first vector loads equally", Math.abs(e.vectors[0][0]), Math.SQRT1_2, 1e-14);
  near("2 x 2: ... on both", e.vectors[0][0] * e.vectors[0][1], 0.5, 1e-14);
}
{
  const n = 6;
  const rho = 0.4;
  const m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : rho)));
  const e = symEigen(m);
  near("equicorrelation: the first eigenvalue is 1 + (n-1)ρ", e.values[0], 1 + (n - 1) * rho, 1e-12);
  check(e.values.slice(1).every((v) => Math.abs(v - (1 - rho)) < 1e-12), "equicorrelation: the other n - 1 are 1 - ρ", e.values.join());
}
{
  // numpy.linalg.eigvalsh on the same matrix (numpy 2.4.6), reversed to largest first.
  const m = [[4, 1, -2, 2], [1, 2, 0, 1], [-2, 0, 3, -2], [2, 1, -2, -1]];
  const want = [6.844621107234966, 2.2685314064312423, 1.0843644637732177, -2.197516977439427];
  const e = symEigen(m);
  want.forEach((w, k) => near(`numpy 4 x 4: eigenvalue ${k + 1}`, e.values[k], w, 1e-12));
  // Each pair satisfies A v = λ v.
  const resid = e.vectors.map((v, k) => Math.max(...m.map((row, i) => Math.abs(dot(row, v) - e.values[k] * v[i]))));
  check(Math.max(...resid) < 1e-12, "numpy 4 x 4: A v = λ v for every pair", resid.join());
  // Only the upper triangle is read: a lower triangle of junk changes nothing.
  const junk = m.map((row, i) => row.map((x, j) => (j < i ? 99 : x)));
  check(JSON.stringify(symEigen(junk).values) === JSON.stringify(e.values), "only the upper triangle is read");
}

// ---- (b) a 10 x 10 correlation matrix from seeded returns ------------------------------------------------
const rand = mulberry32(20261015);
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const T = 400;
const N = 10;
const common = Array.from({ length: T }, normal);
const returns = Array.from({ length: N }, (_, j) => common.map((c) => (0.3 + 0.06 * j) * c + normal()));
const C = corrMatrix(returns);
{
  const e = symEigen(C);
  near("10 x 10: the eigenvalues sum to N", e.values.reduce((x, y) => x + y, 0), N, 1e-12);
  check(e.values.every((v, k) => k === 0 || v <= e.values[k - 1]), "10 x 10: largest first", e.values.join());
  let orth = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) orth = Math.max(orth, Math.abs(dot(e.vectors[i], e.vectors[j]) - (i === j ? 1 : 0)));
  check(orth < 1e-12, "10 x 10: the eigenvectors are orthonormal", orth);
  const rebuilt = C.map((_, i) => C.map((__, j) => e.values.reduce((s, l, k) => s + l * e.vectors[k][i] * e.vectors[k][j], 0)));
  const gap = maxAbs(rebuilt.map((row, i) => row.map((x, j) => x - C[i][j])));
  check(gap < 1e-12, "10 x 10: V Λ Vᵀ rebuilds the matrix", gap);
}

// ---- (c) bets ---------------------------------------------------------------------------------------------
{
  const b = bets(C);
  near("bets: the shares sum to 1", b.shares.reduce((x, y) => x + y, 0), 1, 1e-12);
  const e = symEigen(C);
  near("bets: PC1's share is its eigenvalue over N", b.shares[0], e.values[0] / N, 1e-12);
  const h = -b.shares.reduce((s, p) => s + p * Math.log(p), 0);
  near("bets: exp of the entropy of the shares", b.bets, Math.exp(h), 1e-12);
  check(b.bets > 1 && b.bets < N, "bets: between 1 and N on a mixed matrix", b.bets);
  check(b.pc1.every((x) => x > 0), "bets: PC1 signed so it loads positively on a one-driver basket", b.pc1.join());
  near("bets: PC1 is a unit vector", dot(b.pc1, b.pc1), 1, 1e-12);
}
{
  // On this matrix the solver's own first vector sums below zero; bets() turns it round.
  const m = [[1, -0.7, -0.6], [-0.7, 1, 0.5], [-0.6, 0.5, 1]];
  const raw = symEigen(m).vectors[0];
  const flipped = bets(m);
  check(raw.reduce((x, y) => x + y, 0) < 0 && flipped.pc1.every((x, i) => x === -raw[i]), "bets: PC1's sign is chosen, not left to the solver", flipped.pc1.join());
  const one = bets([[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
  near("bets: three copies of one asset are one bet", one.bets, 1, 1e-9);
  near("bets: ... and PC1 explains all of it", one.shares[0], 1, 1e-12);
  const ind = bets([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
  near("bets: four uncorrelated assets are four bets", ind.bets, 4, 1e-12);
  check(bets([[1, NaN], [NaN, 1]]) === null, "bets: an undefined correlation gives nothing, not a number");
  check(bets([[1]]) === null, "bets: one asset gives nothing");
  const scaled = bets([[2, 0], [0, 2]]);
  check(scaled.shares[0] === 0.5 && scaled.shares[1] === 0.5, "bets: a share is over the eigenvalues' own sum, not the asset count", scaled.shares.join());
}

done("t-eigen");
