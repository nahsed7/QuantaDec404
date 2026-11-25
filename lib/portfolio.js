// Portfolio research (Part 06): risk, diversification, concentration, liquidity, scenarios, alternative allocations
// and opportunity cost. Pure (UMD). All outputs are hypothetical model results; nothing here places an order.
//
// Inputs: assets [{ sym, sector, region, ccy, beta, addv (US$/day), spread, sigmaDaily, premium, base, rateShock, … }],
// aligned daily US$ closes { dates: [...], closes: { sym: [...] } }, weights { sym: w } summing to 1.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QPort = factory(root.QStats);
})(this, function (S) {
  'use strict';
  // ppy = periods per year of the return series (52 for the weekly returns the server uses: weekly returns avoid the
  // false low correlations that daily returns show between markets closing at different times).
  const fin = S.fin;

  // Daily log returns on dates where every asset has a price (complete cases), last `window` days.
  function returnsMatrix(series, syms, window = 504) {
    const n = series.dates.length, rows = [], dates = [];
    for (let i = 1; i < n; i++) {
      const r = []; let ok = true;
      for (const s of syms) { const a = series.closes[s]?.[i - 1], b = series.closes[s]?.[i]; if (!(a > 0) || !(b > 0)) { ok = false; break; } r.push(Math.log(b / a)); }
      if (ok) { rows.push(r); dates.push(series.dates[i]); }
    }
    return { R: rows.slice(-window), dates: dates.slice(-window) };
  }

  // Ledoit & Wolf (2004) shrinkage towards a scaled identity: Σ* = (b²/d²)·m·I + (a²/d²)·S.
  // Well-conditioned even with few observations per asset; the shrinkage intensity is estimated, not chosen.
  function covariance(R) {
    const T = R.length, N = R[0]?.length || 0; if (T < 30 || !N) return null;
    const mu = new Array(N).fill(0); for (const r of R) for (let j = 0; j < N; j++) mu[j] += r[j] / T;
    const X = R.map(r => r.map((x, j) => x - mu[j]));
    const Sm = Array.from({ length: N }, () => new Array(N).fill(0));
    for (const x of X) for (let i = 0; i < N; i++) for (let j = i; j < N; j++) Sm[i][j] += x[i] * x[j] / T;
    for (let i = 0; i < N; i++) for (let j = 0; j < i; j++) Sm[i][j] = Sm[j][i];
    let m = 0; for (let i = 0; i < N; i++) m += Sm[i][i] / N;
    let d2 = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) d2 += (Sm[i][j] - (i === j ? m : 0)) ** 2 / N;
    let b2 = 0; for (const x of X) { let s = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) s += (x[i] * x[j] - Sm[i][j]) ** 2; b2 += s / N / (T * T); }
    b2 = Math.min(b2, d2); const a2 = d2 - b2, k = d2 > 0 ? b2 / d2 : 1;
    const C = Sm.map((row, i) => row.map((v, j) => k * (i === j ? m : 0) + (1 - k) * v));
    return { cov: C, sample: Sm, shrinkage: k, T, N };
  }
  const corrFromCov = C => C.map((row, i) => row.map((v, j) => v / Math.sqrt(C[i][i] * C[j][j])));
  const mv = (C, w) => C.map(row => row.reduce((s, v, j) => s + v * w[j], 0));
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

  // Risk decomposition of weights w (array aligned with syms) under daily covariance C.
  function risk(C, w, syms, ppy = 52) {
    const A = ppy, Cw = mv(C, w), varD = dot(w, Cw), vol = Math.sqrt(Math.max(varD, 0) * A);
    const rc = w.map((x, i) => x * Cw[i] / varD);                     // percentage risk contributions (sum to 1)
    const sig = C.map((row, i) => Math.sqrt(row[i] * A)), dr = dot(w, sig) / vol;
    return { vol, var95: 1.645 * Math.sqrt(Math.max(varD, 0)), contributions: syms.map((s, i) => ({ sym: s, weight: w[i], vol: sig[i], pctRisk: rc[i], marginal: Cw[i] / Math.sqrt(varD) * Math.sqrt(A) })),
      diversificationRatio: dr, effectiveBets: 1 / S.sum(rc.map(x => x * x)), effectiveHoldings: 1 / S.sum(w.map(x => x * x)) };
  }

  // Allocation methods (long-only, fully invested). Each is a research alternative, not a recommendation.
  function equalWeight(N) { return new Array(N).fill(1 / N); }
  function inverseVol(C) { const iv = C.map((r, i) => 1 / Math.sqrt(r[i])), s = S.sum(iv); return iv.map(x => x / s); }
  // Minimum variance, long-only, weights capped: projected gradient descent with projection onto the capped simplex.
  function minVariance(C, cap = 0.25, iters = 3000) {
    const N = C.length; let w = equalWeight(N); const L = Math.max(...C.map(r => r.reduce((s, v) => s + Math.abs(v), 0))), step = 1 / (2 * L);
    for (let t = 0; t < iters; t++) { const g = mv(C, w); w = projectCappedSimplex(w.map((x, i) => x - step * 2 * g[i]), cap); }
    return w;
  }
  // Equal risk contribution (risk parity): multiplicative fixed point w_i ∝ w_i / RC_i, normalised.
  function riskParity(C, iters = 500) {
    const N = C.length; let w = inverseVol(C);
    for (let t = 0; t < iters; t++) { const Cw = mv(C, w), v = dot(w, Cw); const nw = w.map((x, i) => x * Math.sqrt((v / N) / (x * Cw[i]))); const s = S.sum(nw); w = nw.map(x => x / s); }
    return w;
  }
  // Valuation tilt: equal weight scaled by (1 + tilt × z), z = −standardised log premium across the candidates; capped.
  function valuationTilt(assets, tilt = 0.5, cap = 0.25) {
    const lp = assets.map(a => fin(a.premium) ? Math.log(1 + a.premium) : null), m = S.mean(lp), sd = S.std(lp) || 1;
    const raw = lp.map(x => Math.max(0.1, 1 + tilt * (fin(x) ? -(x - m) / sd : 0))), s = S.sum(raw);
    return projectCappedSimplex(raw.map(x => x / s), cap);
  }
  // Euclidean projection onto { w ≥ 0, Σw = 1, w ≤ cap } by bisection on the shift τ.
  function projectCappedSimplex(v, cap = 1) {
    const N = v.length; cap = Math.max(cap, 1 / N);
    let lo = Math.min(...v) - cap, hi = Math.max(...v);
    for (let k = 0; k < 100; k++) { const tau = (lo + hi) / 2, s = v.reduce((a, x) => a + S.clamp(x - tau, 0, cap), 0); if (s > 1) lo = tau; else hi = tau; }
    const tau = (lo + hi) / 2; return v.map(x => S.clamp(x - tau, 0, cap));
  }

  // Concentration by a grouping key, with the Herfindahl index.
  function exposure(assets, w, key) {
    const g = {}; assets.forEach((a, i) => { const k = a[key] || 'n/a'; g[k] = (g[k] || 0) + w[i]; });
    const rows = Object.entries(g).map(([k, x]) => ({ group: k, weight: x })).sort((a, b) => b.weight - a.weight);
    return { rows, hhi: S.sum(rows.map(r => r.weight ** 2)), max: rows[0] || null };
  }
  // Liquidity: days to exit each position trading at most `part` of daily value; cost to build or exit (half-spread + √ impact).
  function liquidity(assets, w, capital, part = 0.1) {
    return assets.map((a, i) => {
      const usd = w[i] * capital, days = a.addv > 0 ? usd / (part * a.addv) : null;
      const half = fin(a.spread) ? a.spread / 2 : null, impact = fin(a.sigmaDaily) && a.addv > 0 ? a.sigmaDaily * Math.sqrt(Math.min(usd, part * a.addv) / a.addv) : null;
      const costBp = fin(impact) ? 1e4 * ((half ?? 0) + impact) : null;
      return { sym: a.sym, usd, daysToExit: days, costBp, costUSD: fin(costBp) ? usd * costBp / 1e4 : null };
    });
  }

  // Stress scenarios. Each returns the portfolio's estimated loss (fraction) or the stressed statistic, with its method.
  function scenarios(assets, w, C, syms, capital, opt = {}) {
    const ppy = opt.ppy || 52, out = [], base = risk(C, w, syms, ppy);
    const mkt = opt.marketShock ?? -0.2;
    const betaLoss = S.sum(assets.map((a, i) => w[i] * (fin(a.beta) ? a.beta : 1) * mkt));
    out.push({ name: `Market-wide decline ${Math.round(100 * mkt)} %`, impact: betaLoss, unit: 'return', method: `Σ w·β·(${Math.round(100 * mkt)} %); β against each stock's own index (1 where unmeasured). All markets assumed to fall together.` });
    const sec = opt.sector || exposure(assets, w, 'sector').max?.group, ss = opt.sectorShock ?? -0.25;
    if (sec) out.push({ name: `${sec} sector decline ${Math.round(100 * ss)} %`, impact: S.sum(assets.map((a, i) => a.sector === sec ? w[i] * ss : 0)), unit: 'return', method: `Holdings in ${sec} fall ${Math.round(100 * ss)} %; other holdings unchanged (no spill-over assumed).` });
    // Correlations move halfway to 1 (crisis behaviour); volatilities unchanged.
    const R = corrFromCov(C), sd = C.map((r, i) => Math.sqrt(r[i])), Cs = R.map((row, i) => row.map((rho, j) => (i === j ? 1 : rho + (1 - rho) * 0.5) * sd[i] * sd[j]));
    out.push({ name: 'Correlations rise halfway to 1', impact: risk(Cs, w, syms, ppy).vol, before: base.vol, unit: 'vol', method: 'ρ′ = ρ + (1 − ρ)/2 for every pair; volatility of each stock unchanged.' });
    const Cv = C.map(row => row.map(v => 4 * v));
    out.push({ name: 'Volatility doubles', impact: risk(Cv, w, syms, ppy).vol, before: base.vol, unit: 'vol', var95: risk(Cv, w, syms, ppy).var95, var95Before: base.var95, method: `Every σ × 2 (covariances × 4); 1-${ppy === 52 ? 'week' : 'day'} parametric 95 % VaR shown.` });
    const lq0 = liquidity(assets, w, capital), lq1 = liquidity(assets.map(a => ({ ...a, addv: a.addv / 2, spread: fin(a.spread) ? a.spread * 3 : a.spread })), w, capital);
    out.push({ name: 'Liquidity deteriorates (volume −50 %, spreads ×3)', impact: S.sum(lq1.map(x => x.costUSD || 0)) / capital, before: S.sum(lq0.map(x => x.costUSD || 0)) / capital, unit: 'cost',
      daysBefore: Math.max(...lq0.map(x => x.daysToExit || 0)), daysAfter: Math.max(...lq1.map(x => x.daysToExit || 0)), method: 'Cost to exit everything (half-spread + √ impact, at most 10 % of daily value per day) and the longest exit time.' });
    const rs = assets.map((a, i) => fin(a.rateShock) ? w[i] * a.rateShock : null).filter(fin);
    out.push({ name: 'Interest rates +1 pt', impact: rs.length ? S.sum(rs) / S.sum(assets.map((a, i) => fin(a.rateShock) ? w[i] : 0)) : null, unit: 'value', coverage: rs.length / assets.length,
      method: 'Change in each company\'s primary valuation when discount rates rise 1 pt (its own model), weighted. A change in estimated value, not a price forecast.' });
    return out;
  }

  // Hypothetical performance of fixed weights over the look-back (monthly rebalanced). In-sample by construction.
  function backtest(series, syms, w, bench, rebalanceEvery = 4, ppy = 52) {
    const A = ppy, rebalanceDays = rebalanceEvery, { R, dates } = returnsMatrix(series, syms, 100000); if (!R.length) return null;
    let wt = w.slice(), eq = 1, peak = 1, mdd = 0; const curve = [];
    R.forEach((r, t) => {
      if (t % rebalanceDays === 0) wt = w.slice();
      const g = r.map(Math.exp), port = S.sum(wt.map((x, i) => x * g[i])); eq *= port; peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak);
      wt = wt.map((x, i) => x * g[i] / port); curve.push([dates[t], eq]);
    });
    const bm = bench ? new Map(bench) : null, b0 = bm?.get(dates[0]);
    return { category: 'hypothetical look-back (in-sample)', curve, total: eq - 1, maxDrawdown: mdd, years: R.length / A, cagr: Math.pow(eq, A / R.length) - 1,
      bench: b0 ? curve.map(([d]) => [d, bm.get(d) / b0]).filter(x => fin(x[1])) : null };
  }

  // Volatility and return by market regime (regime known at the time: SPY vs its 200-day average; SPY 20-day σ vs its
  // median to the previous day).
  function regimeExposure(series, syms, w, spy, ppy = 52) {
    const A = ppy, { R, dates } = returnsMatrix(series, syms, 100000); if (!R.length || !spy?.length) return null;
    const smaN = Math.round(200 / 252 * ppy), volN = ppy === 52 ? 13 : 21;           // 40 weeks ≈ 200 days; 13-week σ
    const sc = spy.map(x => x[1]), sd = new Map(spy.map((x, i) => [x[0], i])), sma = S.sma(sc, smaN), lr = S.logReturns(sc);
    const vol = sc.map((_, j) => j > volN ? S.std(lr.slice(j - volN, j - 1)) : null), med = S.median(vol.filter(fin));
    const g = { 'bull (above 200-day)': [], 'bear (below 200-day)': [], 'calm market': [], 'turbulent market': [] };
    R.forEach((r, t) => { const j = sd.get(dates[t]); if (j == null || j < 1) return; const pr = S.sum(r.map((x, i) => w[i] * x));
      if (fin(sma[j - 1])) (sc[j - 1] > sma[j - 1] ? g['bull (above 200-day)'] : g['bear (below 200-day)']).push(pr);
      if (fin(vol[j])) (vol[j] > med ? g['turbulent market'] : g['calm market']).push(pr); });
    return Object.entries(g).map(([k, xs]) => ({ regime: k, periods: xs.length, annReturn: xs.length > 8 ? S.mean(xs) * A : null, annVol: xs.length > 8 ? S.std(xs) * Math.sqrt(A) : null }));
  }

  // Opportunity cost of adding each candidate to the current holdings with weight `add` (funded pro rata).
  function opportunityCost(cands, holdings, ctx) {
    const { C, idx, assets, capital, holdYears = 1, rf = 0.04, ppy = 52 } = ctx, A = ppy, hs = Object.keys(holdings);
    const wBase = assets.map(a => holdings[a.sym] || 0), baseRisk = hs.length ? risk(C, wBase, assets.map(a => a.sym), ppy) : null;
    return cands.map(sym => {
      const i = idx[sym], a = assets[i]; if (i == null) return { sym, error: 'not in the data set' };
      const add = ctx.add ?? 0.05, w = wBase.map(x => x * (1 - add)); w[i] += add;
      const r1 = hs.length ? risk(C, w, assets.map(x => x.sym), ppy) : null;
      const corrH = hs.length ? S.sum(hs.map(h => holdings[h] * corrFromCov(C)[i][idx[h]])) / S.sum(hs.map(h => holdings[h])) : null;
      const lq = liquidity([a], [1], add * capital)[0], roundTrip = fin(lq.costBp) ? 2 * lq.costBp / 1e4 : null;
      const yld = fin(a.yield) ? a.yield : null;
      return { sym, label: a.label || sym, sector: a.sector, premium: a.premium ?? null, status: a.status ?? null, growth: a.growth ?? null, riskScore: a.riskScore ?? null, confidence: a.confidence ?? null,
        volAlone: Math.sqrt(C[i][i] * A), corrWithHoldings: corrH, portfolioVolBefore: baseRisk?.vol ?? null, portfolioVolAfter: r1?.vol ?? null,
        marginalVol: r1 && baseRisk ? r1.vol - baseRisk.vol : null, sectorWeightAfter: exposure(assets, w, 'sector').rows.find(x => x.group === a.sector)?.weight ?? null,
        entryCostBp: lq.costBp, roundTripCost: roundTrip, hurdle: fin(roundTrip) ? roundTrip / holdYears : null, yield: yld, yieldVsRiskFree: fin(yld) ? yld - rf : null, daysToBuild: lq.daysToExit };
    });
  }

  return { returnsMatrix, covariance, corrFromCov, risk, equalWeight, inverseVol, minVariance, riskParity, valuationTilt, projectCappedSimplex, exposure, liquidity, scenarios, backtest, regimeExposure, opportunityCost };
});
