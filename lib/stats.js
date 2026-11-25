// Small numerical toolkit shared by the server and the browser (UMD, no dependencies).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QStats = factory();
})(this, function () {
  'use strict';
  const fin = x => typeof x === 'number' && Number.isFinite(x);
  const clean = a => a.filter(fin);
  const sum = a => a.reduce((s, x) => s + x, 0);
  const mean = a => { a = clean(a); return a.length ? sum(a) / a.length : null; };
  function std(a, ddof = 1) { a = clean(a); if (a.length <= ddof) return null; const m = mean(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - ddof)); }
  // Linear-interpolated quantile (type 7, as in R / numpy default).
  function quantile(a, q) {
    a = clean(a).sort((x, y) => x - y); if (!a.length) return null;
    const h = (a.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
    return a[lo] + (a[hi] - a[lo]) * (h - lo);
  }
  const median = a => quantile(a, 0.5);
  // Several quantiles from one sort.
  function quantiles(a, qs) { a = clean(a).sort((x, y) => x - y); if (!a.length) return qs.map(() => null); return qs.map(q => { const h = (a.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h); return a[lo] + (a[hi] - a[lo]) * (h - lo); }); }
  // Share of observations strictly below x plus half of ties, in [0, 1].
  function percentileRank(a, x) {
    a = clean(a); if (!a.length || !fin(x)) return null;
    let below = 0, eq = 0; for (const v of a) { if (v < x) below++; else if (v === x) eq++; }
    return (below + eq / 2) / a.length;
  }
  function skew(a) { a = clean(a); const m = mean(a), s = std(a, 0); if (!s || a.length < 3) return null; return mean(a.map(x => ((x - m) / s) ** 3)); }
  function kurtosis(a) { a = clean(a); const m = mean(a), s = std(a, 0); if (!s || a.length < 4) return null; return mean(a.map(x => ((x - m) / s) ** 4)) - 3; }
  function corr(x, y) {
    const p = []; for (let i = 0; i < Math.min(x.length, y.length); i++) if (fin(x[i]) && fin(y[i])) p.push([x[i], y[i]]);
    if (p.length < 3) return null;
    const mx = mean(p.map(v => v[0])), my = mean(p.map(v => v[1]));
    let sxy = 0, sxx = 0, syy = 0; for (const [a, b] of p) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; syy += (b - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }
  function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length); let i = 0;
    while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; }
  function spearman(x, y) { const p = []; for (let i = 0; i < Math.min(x.length, y.length); i++) if (fin(x[i]) && fin(y[i])) p.push([x[i], y[i]]); if (p.length < 5) return null; return corr(ranks(p.map(v => v[0])), ranks(p.map(v => v[1]))); }
  // Ordinary least squares y = a + b·x; returns slope, intercept and R².
  function linreg(x, y) {
    const n = Math.min(x.length, y.length); if (n < 3) return null;
    const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n)); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    if (!sxx) return null; const b = sxy / sxx, rss = Math.max(0, syy - b * sxy);
    return { slope: b, intercept: my - b * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 0, slopeSE: n > 2 ? Math.sqrt(rss / (n - 2) / sxx) : null, n };
  }
  // Rolling simple moving average in O(n). Windows containing a non-finite value give null.
  function sma(a, n) {
    const out = new Array(a.length).fill(null); let s = 0, bad = 0;
    for (let i = 0; i < a.length; i++) {
      if (fin(a[i])) s += a[i]; else bad++;
      if (i >= n) { if (fin(a[i - n])) s -= a[i - n]; else bad--; }
      if (i + 1 >= n && !bad) out[i] = s / n;
    }
    return out;
  }
  function ewmaVol(r, lambda = 0.94) { let v = null; for (const x of r) if (fin(x)) v = v == null ? x * x : lambda * v + (1 - lambda) * x * x; return v == null ? null : Math.sqrt(v); }
  function logReturns(p) { const r = []; for (let i = 1; i < p.length; i++) r.push(p[i] > 0 && p[i - 1] > 0 ? Math.log(p[i] / p[i - 1]) : null); return r; }
  // Maximum peak-to-trough fall of a price path, as a positive fraction, plus the current drawdown.
  function drawdown(p) {
    let peak = -Infinity, max = 0, cur = 0; for (const x of p) { if (!fin(x)) continue; peak = Math.max(peak, x); cur = 1 - x / peak; max = Math.max(max, cur); }
    return { max, current: cur };
  }
  function autocorr(a, lag) { a = clean(a); if (a.length <= lag + 2) return null; return corr(a.slice(lag), a.slice(0, -lag)); }
  // Deterministic pseudo-random numbers so a valuation range is reproducible run to run.
  function rng(seed = 1) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  // Triangular draw on [lo, hi] with mode m.
  function triangular(u, lo, m, hi) { if (hi <= lo) return m; const c = (m - lo) / (hi - lo); return u < c ? lo + Math.sqrt(u * (hi - lo) * (m - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - m)); }
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function cagr(first, last, years) { if (!fin(first) || !fin(last) || first <= 0 || last <= 0 || years <= 0) return null; return Math.pow(last / first, 1 / years) - 1; }
  // Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf, |error| < 1.5e-7) and inverse CDF (Acklam's rational
  // approximation, relative error < 1.2e-9).
  function normCdf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2); return x >= 0 ? (1 + y) / 2 : (1 - y) / 2; }
  function normInv(p) {
    if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416], pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  return { normCdf, normInv, fin, clean, sum, mean, std, quantile, quantiles, median, percentileRank, skew, kurtosis, corr, spearman, linreg, sma, ewmaVol, logReturns, drawdown, autocorr, rng, triangular, clamp, cagr };
});
