// Analysis engine — pure functions, shared by the browser and Node.
(function (root) {
'use strict';
const mean = a => { let s = 0; for (const x of a) s += x; return a.length ? s / a.length : 0; };
const sd = a => { const m = mean(a); let s = 0; for (const x of a) s += (x - m) ** 2; return Math.sqrt(s / Math.max(1, a.length - 1)); };
const zs = a => { const m = mean(a), s = sd(a) || 1; return a.map(x => (x - m) / s); };
function corr(a, b) {
  const n = Math.min(a.length, b.length); if (n < 3) return null;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n)); let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : null;
}
function quantile(sorted, q) { if (!sorted.length) return NaN; const i = (sorted.length - 1) * q, lo = Math.floor(i); return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo); }

// ---- bar features (dimensions 4–7) ----
// Liquidity (dim 5) = log10 of resting quote-currency depth within ±10 bp of mid, averaged over the
// order-book snapshots that fall inside the bar (or the latest snapshot ≤ 2 poll intervals before the
// bar ends, for bars shorter than the poll interval). Bars with no snapshot get liq = null.
function features(bars, sentSeries = [], book = [], dt = 60000, poll = 3000) {
  const out = [], rets = []; let j = 0, k = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    const ret = p ? Math.log(b.c / p.c) : 0; rets.push(ret);
    const vol = sd(rets.slice(Math.max(0, i - 19), i + 1));
    // dims 5, 9, 10: total, bid-side and ask-side depth (log10, quote currency, ±10 bp of mid)
    const L = x => Math.log10(1 + x), end = b.t + dt; let s = 0, sb = 0, sa = 0, m = 0;
    while (k < book.length && book[k].t < b.t) k++;
    for (let q = k; q < book.length && book[q].t < end; q++) { const o = book[q]; s += L(o.bd + o.ad); sb += L(o.bd); sa += L(o.ad); m++; }
    let liq = m ? s / m : null, bidD = m ? sb / m : null, askD = m ? sa / m : null;
    if (liq == null && k > 0 && end - book[k - 1].t <= 2 * poll) { const o = book[k - 1]; liq = L(o.bd + o.ad); bidD = L(o.bd); askD = L(o.ad); }
    const press = b.v > 0 ? (2 * b.tb - b.v) / b.v : 0;
    while (j + 1 < sentSeries.length && sentSeries[j + 1].t <= b.t) j++;
    const sent = sentSeries.length && sentSeries[j].t <= b.t ? 2 * sentSeries[j].long - 1 : null;
    out.push({ t: b.t, c: b.c, v: b.v, n: b.n, ret, vol, liq, bidD, askD, press, sent });
  }
  return out;
}

// ---- dimension 8: empirical future-price density ----
function forecast(F, H = 30, gridN = 60) {
  const c = F.map(f => f.c), n = c.length, last = c[n - 1];
  const hs = []; for (let h = 2; h <= H; h += 2) hs.push(h);
  const R = hs.map(h => { const r = []; for (let i = 0; i + h < n; i++) r.push(Math.log(c[i + h] / c[i])); return r.sort((a, b) => a - b); });
  const rH = R[R.length - 1];
  if (!rH || rH.length < 10) return null;
  let lo = quantile(rH, 0.005), hi = quantile(rH, 0.995), pad = Math.max((hi - lo) * 0.25, 1e-5);
  lo -= pad; hi += pad;
  const xs = Array.from({ length: gridN }, (_, k) => lo + (hi - lo) * k / (gridN - 1));
  const dens = R.map(r => {
    const s = sd(r), bw = Math.max(1.06 * s * Math.pow(r.length, -0.2), (hi - lo) / gridN);
    return xs.map(x => { let d = 0; for (const v of r) { const u = (x - v) / bw; d += Math.exp(-0.5 * u * u); } return d / (r.length * bw * Math.sqrt(2 * Math.PI)); });
  });
  const q = p => R.map(r => last * Math.exp(quantile(r, p)));
  return { hs, prices: xs.map(x => last * Math.exp(x)), dens, q05: q(0.05), q50: q(0.5), q95: q(0.95),
    pUp: rH.filter(x => x > 0).length / rH.length, pDown: rH.filter(x => x < 0).length / rH.length, samples: rH.length, H: hs[hs.length - 1] };
}

// ---- 4.1 multivariate ----
function featureMatrix(F) {
  const cols = [
    ['r', F.map(f => f.ret)], ['|r|', F.map(f => Math.abs(f.ret))], ['ln V', F.map(f => Math.log1p(f.v))],
    ['σ', F.map(f => f.vol)], ['Liq', F.map(f => f.liq)], ['π', F.map(f => f.press)], ['ln N', F.map(f => Math.log1p(f.n))],
  ];
  // Liquidity only enters the analysis once the recorded book covers ≥ 80 % of the sample.
  const lCount = F.filter(f => f.liq != null).length;
  // In the analysis, total depth is replaced by its two sides (total ≈ their sum, so keeping it would be redundant).
  const li = cols.findIndex(c => c[0] === 'Liq');
  if (lCount < F.length * 0.8) cols.splice(li, 1);
  else {
    const fill = key => { let last = null; const v = F.map(f => (f[key] != null ? (last = f[key]) : last)); const first = v.find(x => x != null); return v.map(x => x ?? first); };
    cols.splice(li, 1, ['Bid D', fill('bidD')], ['Ask D', fill('askD')]);
  }
  const sCount = F.filter(f => f.sent != null).length;
  if (sCount > F.length * 0.5) { let last = 0; cols.push(['Sent', F.map(f => (f.sent != null ? (last = f.sent) : last))]); }
  return cols.filter(([, v]) => sd(v) > 0);
}
function corrMatrix(cols) { return cols.map(([, a]) => cols.map(([, b]) => corr(a, b))); }
function xcorr(a, b, K = 15) {
  const out = [];
  for (let k = -K; k <= K; k++) {
    const x = [], y = [];
    for (let i = 0; i < a.length; i++) { const j = i + k; if (j >= 0 && j < b.length) { x.push(a[i]); y.push(b[j]); } }
    out.push({ k, r: corr(x, y) });
  }
  return out;
}

// ---- 4.2 dynamical systems ----
function detrended(F, w = 30) {
  const lp = F.map(f => Math.log(f.c)), out = [];
  for (let i = 0; i < lp.length; i++) { const s = lp.slice(Math.max(0, i - w + 1), i + 1); out.push(lp[i] - mean(s)); }
  return zs(out.slice(w));
}
function acf(x, L) { const m = mean(x); let v = 0; for (const a of x) v += (a - m) ** 2; return Array.from({ length: L + 1 }, (_, k) => { let s = 0; for (let i = 0; i + k < x.length; i++) s += (x[i] - m) * (x[i + k] - m); return v ? s / v : 0; }); }
function embed(x, tau, m = 3) { const pts = []; for (let i = (m - 1) * tau; i < x.length; i++) pts.push(Array.from({ length: m }, (_, d) => x[i - d * tau])); return pts; }
function chooseTau(x) { const a = acf(x, 40); for (let k = 1; k < a.length; k++) if (a[k] < 1 / Math.E) return Math.min(k, 20); return 20; }
function hurst(r) {
  const pts = [];
  for (let s = 8; s <= r.length / 2; s *= 2) {
    const rs = [];
    for (let o = 0; o + s <= r.length; o += s) {
      const seg = r.slice(o, o + s), m = mean(seg); let cum = 0, mx = -Infinity, mn = Infinity;
      for (const x of seg) { cum += x - m; mx = Math.max(mx, cum); mn = Math.min(mn, cum); }
      const S = sd(seg); if (S > 0) rs.push((mx - mn) / S);
    }
    if (rs.length) pts.push([Math.log(s), Math.log(mean(rs))]);
  }
  if (pts.length < 2) return null;
  const mx = mean(pts.map(p => p[0])), my = mean(pts.map(p => p[1]));
  let num = 0, den = 0; for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return num / den;
}
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); };
function distMatrix(P) { const n = P.length; return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => dist(P[i], P[j]))); }

// ---- 4.3 information geometry ----
function fisherRao(m1, s1, m2, s2) {
  const a = (m1 - m2) ** 2 / 2, num = a + (s1 - s2) ** 2, den = a + (s1 + s2) ** 2;
  const d = Math.sqrt(num / den); return 2 * Math.SQRT2 * Math.atanh(Math.min(d, 1 - 1e-12));
}
function gaussianPath(r, t, W = 30, step = 3) {
  const out = [];
  for (let e = W; e <= r.length; e += step) { const w = r.slice(e - W, e); out.push({ t: t[e - 1], mu: mean(w), sigma: Math.max(sd(w), 1e-9) }); }
  for (let i = 1; i < out.length; i++) out[i].d = fisherRao(out[i - 1].mu, out[i - 1].sigma, out[i].mu, out[i].sigma);
  return out;
}

// ---- 4.4 topological data analysis: exact H0 persistence ----
function persistenceH0(P) {
  const n = P.length, edges = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([dist(P[i], P[j]), i, j]);
  edges.sort((a, b) => a[0] - b[0]);
  const par = Array.from({ length: n }, (_, i) => i), find = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  const deaths = [];
  for (const [w, i, j] of edges) { const a = find(i), b = find(j); if (a !== b) { par[a] = b; deaths.push(w); if (deaths.length === n - 1) break; } }
  const L = deaths.reduce((s, d) => s + d, 0);
  const entropy = L > 0 ? -deaths.reduce((s, d) => s + (d > 0 ? d / L * Math.log(d / L) : 0), 0) : 0;
  const m = mean(deaths), s = sd(deaths);
  return { deaths: deaths.sort((a, b) => b - a), entropy, significant: deaths.filter(d => d > m + 2 * s).length };
}

// ---- 4.5 manifold learning ----
function jacobi(A) {
  const n = A.length, a = A.map(r => r.slice()), V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
      for (let k = 0; k < n; k++) { const kp = V[k][p], kq = V[k][q]; V[k][p] = c * kp - s * kq; V[k][q] = s * kp + c * kq; }
    }
  }
  return Array.from({ length: n }, (_, i) => ({ val: a[i][i], vec: V.map(r => r[i]) })).sort((x, y) => y.val - x.val);
}
function standardize(cols) { return cols.map(([n, v]) => [n, zs(v)]); }
function pca(cols, k = 3) {
  const S = standardize(cols), d = S.length, n = S[0][1].length;
  const C = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => { let s = 0; for (let t = 0; t < n; t++) s += S[i][1][t] * S[j][1][t]; return s / (n - 1); }));
  const eig = jacobi(C), tot = eig.reduce((s, e) => s + Math.max(e.val, 0), 0);
  const scores = Array.from({ length: n }, (_, t) => eig.slice(0, k).map(e => e.vec.reduce((s, w, i) => s + w * S[i][1][t], 0)));
  return { scores, explained: eig.map(e => Math.max(e.val, 0) / tot), loadings: eig.slice(0, k).map(e => e.vec), names: S.map(c => c[0]) };
}
function isomap(cols, kNN = 10, maxN = 250) {
  const S = standardize(cols), n0 = S[0][1].length, off = Math.max(0, n0 - maxN);
  const P = Array.from({ length: n0 - off }, (_, t) => S.map(c => c[1][t + off])), n = P.length;
  const D = distMatrix(P), G = Array.from({ length: n }, () => new Float64Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    G[i][i] = 0;
    const nb = D[i].map((d, j) => [d, j]).sort((a, b) => a[0] - b[0]).slice(1, kNN + 1);
    for (const [d, j] of nb) { G[i][j] = Math.min(G[i][j], d); G[j][i] = Math.min(G[j][i], d); }
  }
  const geo = G.map((row, s) => {           // Dijkstra (dense) from each source
    const dd = Float64Array.from(row), done = new Uint8Array(n); dd[s] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1, best = Infinity; for (let v = 0; v < n; v++) if (!done[v] && dd[v] < best) { best = dd[v]; u = v; }
      if (u < 0) break; done[u] = 1;
      for (let v = 0; v < n; v++) { const w = G[u][v]; if (w < Infinity && dd[u] + w < dd[v]) dd[v] = dd[u] + w; }
    }
    return dd;
  });
  let mx = 0; for (const r of geo) for (const x of r) if (x < Infinity && x > mx) mx = x;
  const D2 = geo.map(r => Array.from(r, x => (x < Infinity ? x : mx * 1.5) ** 2));
  const rm = D2.map(mean), gm = mean(rm);
  const B = D2.map((r, i) => r.map((x, j) => -0.5 * (x - rm[i] - rm[j] + gm)));
  const vecs = [], vals = [];
  for (let k = 0; k < 3; k++) {          // power iteration with deflation
    let v = Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898 + k * 78.233)), lam = 0;
    for (let it = 0; it < 300; it++) {
      let w = B.map(r => r.reduce((s, x, j) => s + x * v[j], 0));
      for (const u of vecs) { const p = w.reduce((s, x, i) => s + x * u[i], 0); w = w.map((x, i) => x - p * u[i]); }
      const nrm = Math.hypot(...w) || 1; lam = nrm; v = w.map(x => x / nrm);
    }
    vecs.push(v); vals.push(lam);
  }
  return { scores: P.map((_, i) => vecs.map((v, k) => v[i] * Math.sqrt(Math.max(vals[k], 0)))), offset: off };
}

const Lab = { mean, sd, zs, corr, quantile, features, forecast, featureMatrix, corrMatrix, xcorr, detrended, acf, embed, chooseTau, hurst, distMatrix, fisherRao, gaussianPath, persistenceH0, pca, isomap };
if (typeof module !== 'undefined') module.exports = Lab; else root.Lab = Lab;
})(this);
