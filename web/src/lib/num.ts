// Numeric primitives. Each one says which numpy / pandas routine it stands in for, because the
// parity suite holds these to the Streamlit app's numbers at 1e-12, and summation order is the
// whole difference at that tolerance.

export type Vec = number[];
export type Mat = number[][];

// Neumaier-compensated sum. numpy's pairwise sum and pandas' reductions both land within a few
// ulps of the exact sum on these inputs; a naive loop over ~1,900 daily returns can drift past
// 1e-12 relative when the mean is small against the terms.
export function sum(xs: ArrayLike<number>): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const t = s + x;
    c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    s = t;
  }
  return s + c;
}

export function mean(xs: ArrayLike<number>): number {
  return sum(xs) / xs.length;
}

// pandas nanvar: avg = sum / n, then sum((avg - x)^2) / (n - ddof).
export function variance(xs: ArrayLike<number>, ddof = 1): number {
  const n = xs.length;
  if (n - ddof <= 0) return NaN;
  const avg = sum(xs) / n;
  const sq = new Array<number>(n);
  for (let i = 0; i < n; i++) sq[i] = (avg - xs[i]) ** 2;
  return sum(sq) / (n - ddof);
}

export function std(xs: ArrayLike<number>, ddof = 1): number {
  return Math.sqrt(variance(xs, ddof));
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const p = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) p[i] = a[i] * b[i];
  return sum(p);
}

export function matVec(A: Mat, x: Vec): Vec {
  return A.map((row) => dot(row, x));
}

export function quadForm(A: Mat, x: Vec): number {
  return dot(x, matVec(A, x));
}

// numpy.linspace with endpoint=True: start + i*step, and the last element set exactly to stop.
export function linspace(start: number, stop: number, num: number): Vec {
  if (num <= 0) return [];
  if (num === 1) return [start];
  const div = num - 1;
  const step = (stop - start) / div;
  const out = new Array<number>(num);
  for (let i = 0; i < num; i++) out[i] = step === 0 ? ((i / div) * (stop - start)) + start : i * step + start;
  out[num - 1] = stop;
  return out;
}

// DataFrame.cov() on NaN-free data is np.cov(mat.T, ddof=1): centre each column on its mean,
// then (X^T X) / (n - 1). Columns are passed column-major.
export function covMatrix(cols: Vec[], ddof = 1): Mat {
  const k = cols.length;
  const n = k ? cols[0].length : 0;
  const centred = cols.map((c) => {
    const m = mean(c);
    return c.map((x) => x - m);
  });
  const out: Mat = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j <= i; j++) {
      const v = dot(centred[i], centred[j]) / (n - ddof);
      out[i][j] = v;
      out[j][i] = v;
    }
  }
  return out;
}

// DataFrame.corr() (Pearson) is pandas' libalgos.nancorr, Welford's update pair by pair. It is
// reproduced step for step, so the heatmap matches the app to the last bit or two.
export function corrMatrix(cols: Vec[]): Mat {
  const k = cols.length;
  const out: Mat = Array.from({ length: k }, () => new Array<number>(k).fill(NaN));
  for (let xi = 0; xi < k; xi++) {
    for (let yi = 0; yi <= xi; yi++) {
      const X = cols[xi];
      const Y = cols[yi];
      let nobs = 0, ssqdmx = 0, ssqdmy = 0, covxy = 0, meanx = 0, meany = 0;
      for (let i = 0; i < X.length; i++) {
        const vx = X[i];
        const vy = Y[i];
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
        nobs += 1;
        const dx = vx - meanx;
        const dy = vy - meany;
        meanx += (1 / nobs) * dx;
        meany += (1 / nobs) * dy;
        ssqdmx += (vx - meanx) * dx;
        ssqdmy += (vy - meany) * dy;
        covxy += (vx - meanx) * dy;
      }
      const divisor = Math.sqrt(ssqdmx * ssqdmy);
      const v = nobs < 1 || divisor === 0 ? NaN : Math.min(1, Math.max(-1, covxy / divisor));
      out[xi][yi] = v;
      out[yi][xi] = v;
    }
  }
  return out;
}

// Solve A x = b for symmetric positive-definite A by Cholesky. Returns null when A is not PD.
export function cholSolve(A: Mat, b: Vec): Vec | null {
  const n = b.length;
  const L: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) return null;
        L[i][i] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}
