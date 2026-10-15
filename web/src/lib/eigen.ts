// A symmetric eigen solver (cyclic Jacobi) and the principal-component summary the Diversification chapter
// prints. Jacobi is plenty for the app's 2 to 10 assets: each sweep zeroes every off-diagonal entry in turn
// by a plane rotation, and a handful of sweeps brings the off-diagonal mass under 1e-30 of the matrix's.
//
// The PCA runs on the CORRELATION matrix, not the covariance (FDA2 Week 12: on returns of different scales
// the covariance's first component is mostly the most volatile asset). Its eigenvalues then sum to N, the
// number of assets, so a share is λ / N.
import type { Mat, Vec } from "./num.ts";

export interface Eigen {
  /** Eigenvalues, largest first. */
  values: Vec;
  /** `vectors[k]` is the unit eigenvector of `values[k]`. */
  vectors: Mat;
}

const MAX_SWEEPS = 100;

/** Eigenvalues and eigenvectors of a symmetric matrix. Only the upper triangle is read. */
export function symEigen(m: Mat): Eigen {
  const n = m.length;
  const A = m.map((row, i) => row.map((_, j) => (j >= i ? m[i][j] : m[j][i])));
  const V: Mat = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
  let total = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) total += A[i][j] ** 2;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off <= 1e-30 * total || off === 0) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p][q];
        if (apq === 0) continue;
        // The rotation angle that zeroes A[p][q]: t = tan θ, the smaller root, for stability.
        const theta = (A[q][q] - A[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = A.map((_, i) => i).sort((x, y) => A[y][y] - A[x][x]);
  return { values: order.map((i) => A[i][i]), vectors: order.map((i) => V.map((row) => row[i])) };
}

export interface Bets {
  /** Each component's share of the total variance, λₖ / Σλ, largest first; they sum to 1. */
  shares: Vec;
  /** The first component's loading on each asset, in the tickers' order, signed so they sum to 0 or more. */
  pc1: Vec;
  /** The effective number of independent bets: exp of the entropy of the shares (Meucci 2009), 1 to N. */
  bets: number;
}

/**
 * The principal components of a correlation matrix, summed up. null when the matrix has an undefined entry
 * (an asset whose returns never varied) or fewer than two assets: there is nothing to decompose.
 */
export function bets(corr: Mat): Bets | null {
  const n = corr.length;
  if (n < 2 || corr.some((row) => row.length !== n || row.some((x) => !Number.isFinite(x)))) return null;
  const { values, vectors } = symEigen(corr);
  // A correlation matrix is positive semi-definite; rounding can leave a zero eigenvalue a hair below it.
  const lam = values.map((v) => Math.max(v, 0));
  const sum = lam.reduce((x, y) => x + y, 0);
  if (!(sum > 0)) return null;
  const shares = lam.map((v) => v / sum);
  let h = 0;
  for (const p of shares) if (p > 0) h -= p * Math.log(p);
  const v1 = vectors[0];
  const sign = v1.reduce((x, y) => x + y, 0) < 0 ? -1 : 1;
  return { shares, pc1: v1.map((x) => sign * x), bets: Math.exp(h) };
}
