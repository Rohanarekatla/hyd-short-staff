// Forecast calibration and verification. A raw "fraction of members over threshold" is not a probability:
// models share biases and 25 km grids smooth cloudbursts. We fit a logistic EMOS-style correction
// (Wilks & Hamill; Scheuerer 2014) on past monsoons and score it with the Brier score, reliability,
// ROC area and Richardson's relative economic value (the cost-loss model).

const cbrt = Math.cbrt;
export function features(memberTotals, threshold) {
  const xs = memberTotals.filter((v) => v != null);
  const frac = xs.filter((v) => v >= threshold).length / xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return [1, frac, cbrt(mean), cbrt(Math.max(...xs))];
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
export const predict = (w, x) => sigmoid(w.reduce((s, wi, i) => s + wi * x[i], 0));

// L2-regularised logistic regression by Newton steps (4 features: tiny, exact enough)
export function fitLogistic(X, y, l2 = 1) {
  const k = X[0].length;
  let w = Array(k).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = Array(k).fill(0), H = Array.from({ length: k }, () => Array(k).fill(0));
    X.forEach((x, n) => {
      const p = predict(w, x), r = p * (1 - p);
      for (let i = 0; i < k; i++) {
        g[i] += (p - y[n]) * x[i];
        for (let j = 0; j < k; j++) H[i][j] += r * x[i] * x[j];
      }
    });
    for (let i = 1; i < k; i++) { g[i] += l2 * w[i]; H[i][i] += l2; }
    const step = solve(H, g);
    w = w.map((wi, i) => wi - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return w;
}

function solve(A, b) { // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    const p = M.reduce((best, r, i) => (i >= c && Math.abs(r[c]) > Math.abs(M[best][c]) ? i : best), c);
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / (M[c][c] || 1e-12);
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  const x = Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) x[r] = (M[r][n] - M[r].slice(r + 1, n).reduce((s, v, j) => s + v * x[r + 1 + j], 0)) / (M[r][r] || 1e-12);
  return x;
}

export const brier = (p, y) => p.reduce((s, pi, i) => s + (pi - y[i]) ** 2, 0) / p.length;

export function reliability(p, y, bins = 10) {
  return Array.from({ length: bins }, (_, b) => {
    const idx = p.map((v, i) => i).filter((i) => (b === bins - 1 ? p[i] >= b / bins : p[i] >= b / bins && p[i] < (b + 1) / bins));
    return { bin: (b + 0.5) / bins, n: idx.length, forecast: idx.length ? idx.reduce((s, i) => s + p[i], 0) / idx.length : null,
      observed: idx.length ? idx.reduce((s, i) => s + y[i], 0) / idx.length : null };
  });
}

export function rocArea(p, y) { // Mann-Whitney U
  const pos = p.filter((_, i) => y[i]), neg = p.filter((_, i) => !y[i]);
  if (!pos.length || !neg.length) return null;
  let u = 0;
  for (const a of pos) for (const b of neg) u += a > b ? 1 : a === b ? 0.5 : 0;
  return u / (pos.length * neg.length);
}

// Richardson (2000) relative economic value for a user with cost/loss ratio a, acting when p >= a.
// 1 = as good as a perfect forecast, 0 = no better than always/never acting on climatology.
export function economicValue(p, y, a) {
  const s = y.reduce((x, v) => x + v, 0) / y.length;
  let hits = 0, fa = 0;
  p.forEach((pi, i) => { if (pi >= a) { if (y[i]) hits++; else fa++; } });
  const H = hits / Math.max(1, y.filter(Boolean).length), F = fa / Math.max(1, y.filter((v) => !v).length);
  const eClim = Math.min(a, s), eFc = F * a * (1 - s) - H * s * (1 - a) + s, ePerf = s * a;
  return eClim - ePerf > 0 ? (eClim - eFc) / (eClim - ePerf) : 0;
}
