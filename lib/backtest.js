// Historical validation engine (pure, UMD). Monthly cross-sectional strategies on a point-in-time panel.
//
// Look-ahead rules enforced here:
//  - a signal formed at month m sees only prices with index ≤ m and EPS versions filed on or before month m's date;
//  - eligibility at m depends only on data at m (never on whether a price exists at m + 1);
//  - holdings formed at m earn the return from m to m + 1; costs are charged on the weights actually traded.
// Results are always tagged with a category (in-sample / validation / out-of-sample); they are never pooled.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QBT = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin;

  // ---------- panel ----------
  // stocks: [{ sym, monthly: [{t, c, tr}], eps: [{end, filed, eps}] }], bench: [{t, tr}], rf: [{t, y}] (annual yield).
  // Months are joined on 'YYYY-MM'. tr = total-return index (dividends reinvested).
  const mk = t => new Date(t).toISOString().slice(0, 7);
  function panel(stocks, bench, rf) {
    const keys = [...new Set(stocks.flatMap(s => s.monthly.map(b => mk(b.t))))].sort();
    const idx = new Map(keys.map((k, i) => [k, i])), T = keys.length;
    const t = keys.map(k => { const [y, mo] = k.split('-').map(Number); return Date.UTC(y, mo, 0, 23, 59, 59); });   // end of the month's last day
    const P = {}, R = {}, E = {};
    for (const s of stocks) {
      const px = new Array(T).fill(null), tr = new Array(T).fill(null);
      for (const b of s.monthly) { const i = idx.get(mk(b.t)); if (i != null && fin(b.c) && b.c > 0) { px[i] = b.c; tr[i] = fin(b.tr) && b.tr > 0 ? b.tr : null; } }
      // If no total-return index was supplied, fall back to price (and say so via trMissing).
      if (tr.every(x => x == null)) for (let i = 0; i < T; i++) tr[i] = px[i];
      P[s.sym] = px; R[s.sym] = tr; E[s.sym] = (s.eps || []).slice().sort((a, b) => a.filed - b.filed);
    }
    const B = new Array(T).fill(null); for (const b of bench || []) { const i = idx.get(mk(b.t)); if (i != null) B[i] = b.tr; }
    const RF = new Array(T).fill(null); let last = null;
    const rfm = new Map((rf || []).map(x => [mk(x.t), x.y]));
    for (let i = 0; i < T; i++) { const y = rfm.get(keys[i]); if (fin(y)) last = y; RF[i] = fin(last) ? last / 12 : 0; }   // monthly rate, carried forward
    return { months: keys, t, syms: stocks.map(s => s.sym), px: P, tr: R, eps: E, bench: B, rf: RF };
  }
  // Latest EPS known at month m: the version with the latest fiscal year end among those filed by month m's date,
  // and for that year the latest version filed by then. Stale (> 18 months since fiscal year end) counts as unknown.
  function epsAt(pn, sym, m) {
    const tm = pn.t[m]; let best = null;
    for (const x of pn.eps[sym]) { if (x.filed > tm) break; if (!best || x.end > best.end || (x.end === best.end && x.filed >= best.filed)) best = x; }
    if (!best || tm - Date.parse(best.end) > 548 * 864e5) return null;
    return best.eps;
  }
  const ret = (arr, a, b) => fin(arr[a]) && fin(arr[b]) && arr[a] > 0 ? arr[b] / arr[a] - 1 : null;

  // ---------- signals (higher score = more attractive). Each reads only indices ≤ m. ----------
  const SIGNALS = {
    momentum: { label: 'Momentum (12−1)', params: { lookback: [6, 9, 12] }, score: (pn, s, m, p) => m - p.lookback >= 0 ? ret(pn.px[s], m - p.lookback, m - 1) : null },
    value: { label: 'Value (earnings yield, point-in-time)', params: {}, score: (pn, s, m) => { const e = epsAt(pn, s, m), px = pn.px[s][m]; return fin(e) && fin(px) ? e / px : null; } },
    lowvol: { label: 'Low volatility (12-month σ)', params: { window: [12] }, score: (pn, s, m, p) => {
      const r = []; for (let i = m - p.window + 1; i <= m; i++) { const x = ret(pn.tr[s], i - 1, i); if (fin(x)) r.push(x); }
      return r.length >= p.window - 1 ? -S.std(r) : null; } },
    combo: { label: 'Value + momentum (rank blend)', params: { lookback: [12], wValue: [0.25, 0.5, 0.75] }, cross: true },
    engine: { label: 'Valuation engine (point-in-time premium)', params: {}, external: true },
  };
  // Scores for every symbol at m. Cross-sectional signals (rank blends) need the whole cross-section.
  function scoresAt(pn, name, m, p, ext) {
    const out = new Map();
    if (name === 'combo') {
      const v = scoresAt(pn, 'value', m, p), mo = scoresAt(pn, 'momentum', m, p), rank = mp => { const xs = [...mp.entries()].filter(([, x]) => fin(x)).sort((a, b) => a[1] - b[1]); const r = new Map(); xs.forEach(([k], i) => r.set(k, xs.length > 1 ? i / (xs.length - 1) : 0.5)); return r; };
      const rv = rank(v), rm = rank(mo);
      for (const s of pn.syms) if (rv.has(s) && rm.has(s)) out.set(s, p.wValue * rv.get(s) + (1 - p.wValue) * rm.get(s));
      return out;
    }
    if (name === 'engine') { for (const s of pn.syms) { const x = ext?.[s]?.[m]; if (fin(x)) out.set(s, -x); } return out; }   // lower premium = more attractive
    const sig = SIGNALS[name];
    for (const s of pn.syms) { if (!fin(pn.px[s][m])) continue; const x = sig.score(pn, s, m, p); if (fin(x)) out.set(s, x); }
    return out;
  }
  // Top-N selection; ties broken by symbol for determinism.
  function select(scores, n) { return [...scores.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([s]) => s); }

  // ---------- simulation ----------
  // strategy: { kind: 'signal' | 'ew' | 'buyhold' | 'random' | 'bench', signal, params | paramsAt(m), n, every (months), costBps (one-way, per unit traded) }
  // Returns one row per holding month m→m+1 for m in [from, to): { m, month, gross, cost, net, traded, names, exposure }.
  function simulate(pn, st, from, to, ext) {
    const rows = []; let w = new Map(), u = st.seed != null ? S.rng(st.seed) : null, since = Infinity, bought = false;
    for (let m = from; m < to; m++) {
      const p = st.paramsAt ? st.paramsAt(m) : st.params || {};
      let traded = 0, target = null;
      const due = since >= (st.every || 1);
      if (st.kind === 'bench') {
        const r = ret(pn.bench, m, m + 1); rows.push({ m, month: pn.months[m], gross: r, cost: 0, net: r, traded: 0, names: 1, exposure: fin(r) ? 1 : 0 }); continue;
      }
      if (st.kind === 'buyhold') { if (!bought) { const el = pn.syms.filter(s => fin(pn.px[s][m])); target = new Map(el.map(s => [s, 1 / el.length])); bought = true; } }
      else if (due) {
        const el = pn.syms.filter(s => fin(pn.px[s][m]));
        let pick;
        if (st.kind === 'ew') pick = el;
        else if (st.kind === 'random') { const a = el.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } pick = a.slice(0, st.n); }
        else pick = select(scoresAt(pn, st.signal, m, p, ext), st.n);
        if (pick.length) target = new Map(pick.map(s => [s, 1 / pick.length]));
      }
      if (target) {
        for (const s of new Set([...w.keys(), ...target.keys()])) traded += Math.abs((target.get(s) || 0) - (w.get(s) || 0));
        w = target; since = 0;
      }
      since++;
      // Return over the month; a holding with no price at m+1 is exited at its last price (0 % return) and counted.
      let gross = 0, wsum = 0, missing = 0; const next = new Map();
      for (const [s, x] of w) { let r = ret(pn.tr[s], m, m + 1); if (!fin(r)) { r = 0; missing++; } gross += x * r; wsum += x; next.set(s, x * (1 + r)); }
      const cost = traded * (st.costBps || 0) / 1e4, net = wsum ? gross - cost : -cost;
      rows.push({ m, month: pn.months[m], gross: wsum ? gross : 0, cost, net, traded, names: w.size, exposure: wsum, missing });
      // Drift weights to the end of the month (renormalised to the invested total).
      const tot = [...next.values()].reduce((a, b) => a + b, 0); w = new Map([...next].map(([s, x]) => [s, tot > 0 ? x / tot : 0]));
    }
    return rows;
  }

  // ---------- metrics ----------
  function metrics(rows, pn, benchRows) {
    const r = rows.map(x => x.net).filter(fin), n = r.length;
    if (n < 6) return { n, insufficient: true };
    const rf = rows.map(x => pn.rf[x.m] ?? 0), ex = rows.map((x, i) => fin(x.net) ? x.net - rf[i] : null).filter(fin);
    let eq = 1, peak = 1, mdd = 0; for (const x of r) { eq *= 1 + x; peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak); }
    const total = eq - 1, years = n / 12, sd = S.std(ex), down = Math.sqrt(S.mean(ex.map(x => Math.min(0, x) ** 2)));
    const pos = r.filter(x => x > 0), neg = r.filter(x => x < 0);
    const out = { n, from: rows[0].month, to: rows[rows.length - 1].month, total, cagr: Math.pow(1 + total, 1 / years) - 1, vol: S.std(r) * Math.sqrt(12),
      sharpe: sd ? S.mean(ex) / sd * Math.sqrt(12) : null, sortino: down ? S.mean(ex) * 12 / (down * Math.sqrt(12)) : null, maxDrawdown: mdd,
      turnover: S.mean(rows.map(x => x.traded / 2)) * 12, costDrag: S.mean(rows.map(x => x.cost)) * 12, positiveMonths: pos.length / n,
      profitFactor: neg.length ? S.sum(pos) / Math.abs(S.sum(neg)) : null, exposure: S.mean(rows.map(x => x.exposure)), names: S.mean(rows.map(x => x.names)),
      missingExits: S.sum(rows.map(x => x.missing || 0)), skew: S.skew(ex), kurtosis: S.kurtosis(ex), srMonthly: sd ? S.mean(ex) / sd : null };
    if (benchRows) {
      const byM = new Map(benchRows.map(x => [x.m, x.net])), act = rows.map(x => fin(x.net) && fin(byM.get(x.m)) ? x.net - byM.get(x.m) : null).filter(fin);
      out.winRate = act.length ? act.filter(x => x > 0).length / act.length : null;            // months beating the benchmark
      const te = S.std(act); out.excessAnn = S.mean(act) * 12; out.trackingError = te ? te * Math.sqrt(12) : null; out.infoRatio = te ? S.mean(act) / te * Math.sqrt(12) : null;
    }
    return out;
  }
  const slice = (rows, a, b) => rows.filter(x => x.m >= a && x.m < b);

  // Deflated Sharpe ratio (Bailey & López de Prado 2014): probability that the true Sharpe exceeds the maximum expected
  // from `trials` independent tries of a zero-skill strategy. Inputs are per-period (monthly) Sharpe ratios.
  function deflatedSharpe(sr, T, skew, kurtExcess, trialSRs) {
    const N = trialSRs.length; if (!fin(sr) || T < 12 || N < 2) return null;
    const v = S.std(trialSRs) ** 2, g = 0.5772156649;
    const sr0 = Math.sqrt(v) * ((1 - g) * S.normInv(1 - 1 / N) + g * S.normInv(1 - 1 / (N * Math.E)));
    const k = (fin(kurtExcess) ? kurtExcess : 0) + 3, sk = fin(skew) ? skew : 0;
    const den = Math.sqrt(Math.max(1e-12, 1 - sk * sr + (k - 1) / 4 * sr * sr));
    return { dsr: S.normCdf((sr - sr0) * Math.sqrt(T - 1) / den), sr0, trials: N };
  }

  // Market regime known at the start of each month (no look-ahead): trend = benchmark above its 10-month average;
  // volatility = benchmark's trailing 6-month σ above or below the median of all trailing σ observed so far.
  function regimes(pn) {
    const B = pn.bench, out = new Array(B.length).fill(null), vols = [];
    for (let m = 10; m < B.length; m++) {
      const w = B.slice(m - 9, m + 1); if (w.some(x => !fin(x))) continue;
      const trend = B[m] > S.mean(w) ? 'bull' : 'bear';
      const rs = []; for (let i = m - 5; i <= m; i++) { const r = ret(B, i - 1, i); if (fin(r)) rs.push(r); }
      const v = S.std(rs); let vol = null;
      if (fin(v)) { vol = vols.length >= 6 ? (v > S.median(vols) ? 'high' : 'low') : null; vols.push(v); }
      out[m] = { trend, vol };
    }
    return out;
  }
  function byRegime(rows, reg, benchRows) {
    const bm = new Map((benchRows || []).map(x => [x.m, x.net])), groups = {};
    for (const x of rows) { const g = reg[x.m]; if (!g || !fin(x.net)) continue; for (const k of [g.trend, g.vol && g.vol + ' vol'].filter(Boolean)) (groups[k] ||= []).push([x.net, bm.get(x.m)]); }
    return Object.entries(groups).map(([k, xs]) => ({ regime: k, months: xs.length, annReturn: S.mean(xs.map(a => a[0])) * 12,
      benchAnn: S.mean(xs.map(a => a[1]).filter(fin)) * 12, excessAnn: S.mean(xs.filter(a => fin(a[1])).map(a => a[0] - a[1])) * 12 }));
  }

  // Expand a parameter grid: { a: [1, 2], b: [3] } → [{a:1,b:3}, {a:2,b:3}].
  function grid(spec) { return Object.entries(spec).reduce((acc, [k, vs]) => acc.flatMap(o => vs.map(v => ({ ...o, [k]: v }))), [{}]); }

  // Full validation of one signal family. Everything that chooses (parameters) sees only the training segment, or
  // only the trailing window in walk-forward. Test results are computed once, after selection, and reported as such.
  function validate(pn, opts) {
    const o = { n: [11], every: [1, 3], costBps: 10, trainFrac: 0.6, valFrac: 0.2, wfWindow: 36, wfStep: 12, randomDraws: 300, seed: 7, ...opts };
    const first = 13, last = pn.months.length - 1;              // need 12 months of history; last month has no forward return
    const span = last - first, a = first, b = first + Math.round(span * o.trainFrac), c = first + Math.round(span * (o.trainFrac + o.valFrac)), d = last;
    const seg = { train: [a, b], validation: [b, c], test: [c, d] };
    const bench = simulate(pn, { kind: 'bench' }, a, d);
    const sig = SIGNALS[o.signal], configs = grid({ ...sig.params, n: o.n, every: o.every });
    const runs = configs.map(p => { const rows = simulate(pn, { kind: 'signal', signal: o.signal, params: p, n: p.n, every: p.every, costBps: o.costBps }, a, d, o.ext); return { params: p, rows, train: metrics(slice(rows, a, b), pn, slice(bench, a, b)) }; });
    const ok = runs.filter(r => fin(r.train.sharpe));
    if (!ok.length) return { signal: o.signal, label: sig.label, insufficient: true, reason: 'No configuration produced enough months of returns.' };
    const best = ok.slice().sort((x, y) => y.train.sharpe - x.train.sharpe)[0];
    const cat = (name, [s, e]) => ({ category: name, ...metrics(slice(best.rows, s, e), pn, slice(bench, s, e)), bench: metrics(slice(bench, s, e), pn) });
    // Parameter sensitivity: every configuration on train and on validation (never test, so the test stays untouched).
    const sensitivity = runs.map(r => ({ params: r.params, trainSharpe: r.train.sharpe ?? null, valSharpe: metrics(slice(r.rows, b, c), pn).sharpe ?? null }));
    // Walk-forward: at each step pick the configuration with the best Sharpe on the trailing window, hold it for wfStep months.
    const sched = []; for (let s = a + o.wfWindow; s < d; s += o.wfStep) {
      const pick = ok.map(r => ({ r, sh: metrics(slice(r.rows, s - o.wfWindow, s), pn).sharpe })).filter(x => fin(x.sh)).sort((x, y) => y.sh - x.sh)[0];
      if (pick) sched.push({ from: s, to: Math.min(d, s + o.wfStep), params: pick.r.params });
    }
    let walkForward = null;
    if (sched.length) {
      // Parameters (including n and rebalance frequency) can change between windows; holdings carry over.
      const rows = simulateSchedule(pn, o.signal, sched, o.costBps, o.ext);
      walkForward = { category: 'out-of-sample (walk-forward)', schedule: sched.map(x => ({ from: pn.months[x.from], to: pn.months[x.to - 1], params: x.params })),
        ...metrics(rows, pn, slice(bench, sched[0].from, d)), bench: metrics(slice(bench, sched[0].from, d), pn), rows: rows.map(x => [x.month, x.net]) };
    }
    // Rolling 24-month Sharpe of the chosen configuration and of the benchmark (descriptive; spans all segments, so it is
    // labelled as such and never used for selection).
    const rolling = []; for (let e = a + 24; e <= d; e++) rolling.push({ month: pn.months[e - 1], strategy: metrics(slice(best.rows, e - 24, e), pn).sharpe ?? null, bench: metrics(slice(bench, e - 24, e), pn).sharpe ?? null, segment: e - 1 < b ? 'train' : e - 1 < c ? 'validation' : 'test' });
    // Cost sensitivity on the validation segment.
    const costs = [0, 10, 25, 50].map(bp => ({ costBps: bp, ...pick(metrics(slice(simulate(pn, { kind: 'signal', signal: o.signal, params: best.params, n: best.params.n, every: best.params.every, costBps: bp }, a, d, o.ext), b, c), pn), ['cagr', 'sharpe', 'costDrag', 'turnover']) }));
    // Random baseline: same number of names and rebalance frequency, random picks; distribution on validation and test.
    const rnd = { validation: [], test: [] };
    for (let i = 0; i < o.randomDraws; i++) {
      const rows = simulate(pn, { kind: 'random', n: best.params.n, every: best.params.every, costBps: o.costBps, seed: o.seed + i }, a, d);
      for (const k of ['validation', 'test']) { const sh = metrics(slice(rows, ...seg[k]), pn).sharpe; if (fin(sh)) rnd[k].push(sh); }
    }
    const val = cat('validation', seg.validation), tst = cat('out-of-sample (test)', seg.test);
    const randomBaseline = Object.fromEntries(['validation', 'test'].map(k => { const xs = rnd[k], sh = k === 'validation' ? val.sharpe : tst.sharpe;
      return [k, { draws: xs.length, median: S.median(xs), p10: S.quantile(xs, 0.1), p90: S.quantile(xs, 0.9), strategyPercentile: fin(sh) ? S.percentileRank(xs, sh) : null, hist: histogram(xs, 20) }]; }));
    // Overfitting check: deflated Sharpe of the selected configuration on train, accounting for every configuration tried.
    const trialSR = ok.map(r => r.train.srMonthly).filter(fin);
    const dsr = deflatedSharpe(best.train.srMonthly, best.train.n, best.train.skew, best.train.kurtosis, trialSR);
    const reg = regimes(pn);
    return {
      signal: o.signal, label: sig.label, configsTried: configs.length, chosen: best.params, costBps: o.costBps,
      segments: Object.fromEntries(Object.entries(seg).map(([k, [s, e]]) => [k, { from: pn.months[s], to: pn.months[e - 1], months: e - s }])),
      inSample: { category: 'in-sample (train)', ...best.train, bench: metrics(slice(bench, a, b), pn) }, validation: val, test: tst, walkForward,
      degradation: { trainSharpe: best.train.sharpe, validationSharpe: val.sharpe ?? null, testSharpe: tst.sharpe ?? null, walkForwardSharpe: walkForward?.sharpe ?? null },
      deflatedSharpe: dsr, sensitivity, costs, randomBaseline, rolling,
      regimes: { validation: byRegime(slice(best.rows, ...seg.validation), reg, slice(bench, ...seg.validation)), test: byRegime(slice(best.rows, ...seg.test), reg, slice(bench, ...seg.test)) },
      equity: { strategy: best.rows.map(x => [x.month, x.net]), bench: bench.map(x => [x.month, x.net]) },
    };
  }
  // Walk-forward simulation with parameters that change between windows (holdings carry over; switching costs are charged).
  function simulateSchedule(pn, signal, sched, costBps, ext) {
    const rows = []; let w = new Map(), since = Infinity;
    for (const win of sched) {
      const p = win.params;
      for (let m = win.from; m < win.to; m++) {
        let traded = 0;
        if (m === win.from || since >= p.every) {
          const pick = select(scoresAt(pn, signal, m, p, ext), p.n), target = new Map(pick.map(s => [s, 1 / pick.length]));
          if (pick.length) { for (const s of new Set([...w.keys(), ...target.keys()])) traded += Math.abs((target.get(s) || 0) - (w.get(s) || 0)); w = target; since = 0; }
        }
        since++;
        let gross = 0, wsum = 0, missing = 0; const next = new Map();
        for (const [s, x] of w) { let r = ret(pn.tr[s], m, m + 1); if (!fin(r)) { r = 0; missing++; } gross += x * r; wsum += x; next.set(s, x * (1 + r)); }
        const cost = traded * (costBps || 0) / 1e4;
        rows.push({ m, month: pn.months[m], gross, cost, net: gross - cost, traded, names: w.size, exposure: wsum, missing });
        const tot = [...next.values()].reduce((a, b) => a + b, 0); w = new Map([...next].map(([s, x]) => [s, tot > 0 ? x / tot : 0]));
      }
    }
    return rows;
  }
  function pick(o, ks) { const r = {}; for (const k of ks) r[k] = o[k] ?? null; return r; }
  function histogram(xs, bins) {
    if (xs.length < 2) return null; const lo = Math.min(...xs), hi = Math.max(...xs), w = (hi - lo) / bins || 1, h = new Array(bins).fill(0);
    for (const x of xs) h[Math.min(bins - 1, Math.floor((x - lo) / w))]++; return { lo, width: w, counts: h };
  }

  // Descriptive comparisons that are not strategies: equal-weight universe (monthly rebalanced), buy-and-hold equal
  // weight, and the benchmark, over the full sample. The gap between the equal-weight universe and the index is an upper
  // bound on survivorship + selection bias (today's survivors versus an index that included the losers at the time).
  function baselines(pn, costBps = 10) {
    const a = 13, d = pn.months.length - 1, bench = simulate(pn, { kind: 'bench' }, a, d);
    const ew = simulate(pn, { kind: 'ew', every: 1, costBps }, a, d), bh = simulate(pn, { kind: 'buyhold', costBps }, a, d);
    const mb = metrics(bench, pn), me = metrics(ew, pn, bench);
    return { category: 'descriptive (full sample, no selection)', benchmark: mb, equalWeight: me, buyHold: metrics(bh, pn, bench),
      survivorshipGap: fin(me.cagr) && fin(mb.cagr) ? me.cagr - mb.cagr : null,
      equity: { bench: bench.map(x => [x.month, x.net]), equalWeight: ew.map(x => [x.month, x.net]), buyHold: bh.map(x => [x.month, x.net]) } };
  }

  return { panel, epsAt, SIGNALS, scoresAt, select, simulate, simulateSchedule, metrics, deflatedSharpe, regimes, byRegime, grid, validate, baselines, histogram };
});
