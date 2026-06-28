/**
 * Logistic regression via IRLS/Newton (§4.3), for confound adjustment with continuous
 * or co-firing predictors: read the adjusted coefficient of one predictor
 * (e.g. `resolved ~ tool + intent + turn_index + prior_failures`).
 */

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Solve A·x = b for small dense A via Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => (Math.abs(M[i][i]) < 1e-12 ? 0 : row[n] / M[i][i]));
}

export interface LogisticOptions {
  iters?: number;
  ridge?: number;
}

/**
 * Fit logistic regression. `X` rows are predictor vectors (WITHOUT intercept; an
 * intercept column is prepended). Returns `coef` with coef[0] = intercept and
 * coef[j+1] = the coefficient of predictor column j.
 */
export function logisticFit(X: number[][], y: number[], opts: LogisticOptions = {}): { coef: number[] } {
  const iters = opts.iters ?? 50;
  const ridge = opts.ridge ?? 1e-6;
  const n = X.length;
  const p = (X[0]?.length ?? 0) + 1;
  const design = X.map((row) => [1, ...row]);
  const beta = new Array(p).fill(0);

  for (let it = 0; it < iters; it++) {
    const grad = new Array(p).fill(0);
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      const xi = design[i];
      let eta = 0;
      for (let j = 0; j < p; j++) eta += beta[j] * xi[j];
      const mu = sigmoid(eta);
      const w = Math.max(mu * (1 - mu), 1e-9);
      const r = y[i] - mu;
      for (let j = 0; j < p; j++) {
        grad[j] += xi[j] * r;
        for (let k = 0; k < p; k++) H[j][k] += xi[j] * xi[k] * w;
      }
    }
    for (let j = 0; j < p; j++) {
      grad[j] -= ridge * beta[j];
      H[j][j] += ridge;
    }
    const delta = solve(H, grad);
    let maxStep = 0;
    for (let j = 0; j < p; j++) {
      beta[j] += delta[j];
      maxStep = Math.max(maxStep, Math.abs(delta[j]));
    }
    if (maxStep < 1e-8) break;
  }
  return { coef: beta };
}

/** Convenience: adjusted coefficient of predictor column `index` (0-based among predictors). */
export function adjustedCoefficient(X: number[][], y: number[], index: number, opts?: LogisticOptions): number {
  return logisticFit(X, y, opts).coef[index + 1];
}
