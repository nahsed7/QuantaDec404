// Portfolio laboratory (Part 06): weekly US$ series for any set of tracked companies, saved hypothetical portfolios,
// full analysis (risk, exposures, liquidity, scenarios, alternative allocations, look-back, regimes, opportunity cost)
// and the concentration input for the decision engine. Nothing here places an order.
'use strict';
const fs = require('fs'), path = require('path');
const S = require('../lib/stats'), P = require('../lib/portfolio'), X = require('../lib/fx');
const DAY = 864e5, WEEK = 7 * DAY, MON0 = Date.UTC(1970, 0, 5);   // a Monday

function create({ dataDir, research, holdings }) {
  const file = path.join(dataDir, 'portfolios.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { portfolios: [], current: null, rev: 0 }; } };
  let store = load();
  function save(next, rev) {
    if (rev != null && rev !== store.rev) throw Object.assign(new Error('portfolios changed elsewhere; reload'), { status: 409 });
    const v = validate(next); store = { ...v, rev: (store.rev || 0) + 1 };
    fs.writeFileSync(file + '.tmp', JSON.stringify(store, null, 1)); fs.renameSync(file + '.tmp', file); return store;
  }
  function validate(s) {
    if (!s || !Array.isArray(s.portfolios)) throw Object.assign(new Error('portfolios must be an array'), { status: 400 });
    const known = new Set(research.UNIVERSE.map(u => u.sym));
    const portfolios = s.portfolios.slice(0, 50).map(p => {
      const w = {}; for (const [k, x] of Object.entries(p.weights || {})) if (known.has(k) && Number.isFinite(+x) && +x > 0) w[k] = +x;
      const tot = S.sum(Object.values(w)); for (const k of Object.keys(w)) w[k] = w[k] / (tot || 1);
      return { id: String(p.id || Date.now().toString(36)).slice(0, 40), name: String(p.name || 'Portfolio').slice(0, 80), capital: Math.max(1000, +p.capital || 100000),
        holdYears: S.clamp(+p.holdYears || 1, 0.1, 30), weights: w, updated: new Date().toISOString() };
    });
    return { portfolios, current: portfolios.some(p => p.id === s.current) ? s.current : portfolios[0]?.id ?? null };
  }

  // Weekly closes in US$ (last close of each Monday-based week), from daily bars in the listing currency.
  const weekKey = t => MON0 + Math.floor((t - MON0) / WEEK) * WEEK;
  function weeklyUSD(d) {
    const fx = research.state.fx, out = new Map();
    for (const b of d.bars) { const k = X.usdPer(d.listing.ccy, b.t, fx); if (S.fin(k)) out.set(weekKey(b.t), b.c * k); }
    return out;
  }
  function series(syms) {
    const R = research.state, ds = syms.map(s => R.dossiers.get(s)).filter(Boolean), maps = ds.map(weeklyUSD);
    const spy = new Map(); for (const b of R.market?.bars || []) spy.set(weekKey(b.t), b.c);
    const dates = [...new Set(maps.flatMap(m => [...m.keys()]))].sort((a, b) => a - b).slice(-105);   // ~2 years
    return { ds, series: { dates, closes: Object.fromEntries(ds.map((d, i) => [d.sym, dates.map(t => maps[i].get(t) ?? null)])) }, spy: dates.map(t => [t, spy.get(t) ?? null]).filter(x => S.fin(x[1])) };
  }
  const asset = d => {
    const v = d.valuation?.synthesis, rate = (d.decision?.scenarios || d.valuation?.scenarios || []).find(s => /Discount rates/.test(s.name));
    const fcfY = S.fin(d.fcf) && d.marketCap > 0 ? d.fcf / d.marketCap : null, eY = S.fin(d.eps) && d.price > 0 ? d.eps / d.price : null;
    return { sym: d.sym, label: d.label, sector: d.sector, region: d.region, country: d.country, ccy: d.listing.ccy, beta: d.volatility?.beta ?? null, betaVs: d.volatility?.betaVs ?? null,
      addv: d.liquidity?.addv ?? null, spread: d.liquidity?.spreadUsed ?? d.liquidity?.spreadEst ?? null, sigmaDaily: d.liquidity?.sigmaDaily ?? null, premium: v?.premium ?? null, status: v?.status ?? null,
      rateShock: rate?.primaryChange ?? null, growth: d.valuation?.assumptions?.growth ?? null, yield: d.isFinancial ? eY : (fcfY ?? eY),
      riskScore: d.decision?.risk?.score ?? null, opportunity: d.decision?.opportunity?.score ?? null, confidence: d.decision?.confidence?.score ?? null };
  };

  // Full analysis of a weight vector. weights: { sym: w } (normalised here). candidates: symbols to assess as additions.
  function analyse({ weights, capital = 100000, holdYears = 1, candidates = [], add = 0.05 }) {
    const R = research.state; if (!R.dossiers?.size) throw Object.assign(new Error('research data not loaded yet'), { status: 503 });
    const held = Object.entries(weights || {}).filter(([s, x]) => R.dossiers.has(s) && x > 0);
    if (!held.length) throw Object.assign(new Error('no holdings with data'), { status: 400 });
    const tot = S.sum(held.map(x => x[1])), wmap = Object.fromEntries(held.map(([s, x]) => [s, x / tot]));
    const cands = [...new Set(candidates.filter(s => R.dossiers.has(s) && !wmap[s]))].slice(0, 10);
    const syms = [...Object.keys(wmap), ...cands], { ds, series: ser, spy } = series(syms);
    const symsOk = ds.map(d => d.sym), { R: Rm, dates } = P.returnsMatrix(ser, symsOk, 104);
    if (Rm.length < 40) throw Object.assign(new Error(`only ${Rm.length} common weeks of prices`), { status: 422 });
    const cv = P.covariance(Rm), C = cv.cov, idx = Object.fromEntries(symsOk.map((s, i) => [s, i])), assets = ds.map(asset);
    const hs = Object.keys(wmap).filter(s => idx[s] != null), hIdx = hs.map(s => idx[s]);
    const sub = M => hIdx.map(i => hIdx.map(j => M[i][j])), Ch = sub(C), Ah = hIdx.map(i => assets[i]), w = hs.map(s => wmap[s]);
    const rf = R.rf ?? 0.04;
    const alloc = (name, wv, note) => {
      const r = P.risk(Ch, wv, hs), liq = P.liquidity(Ah, wv, capital), bt = P.backtest({ dates: ser.dates, closes: Object.fromEntries(hs.map(s => [s, ser.closes[s]])) }, hs, wv, spy);
      return { name, note, weights: Object.fromEntries(hs.map((s, i) => [s, wv[i]])), vol: r.vol, diversificationRatio: r.diversificationRatio, effectiveBets: r.effectiveBets, effectiveHoldings: r.effectiveHoldings,
        maxWeight: Math.max(...wv), maxSector: P.exposure(Ah, wv, 'sector').max, buildCostUSD: S.sum(liq.map(x => x.costUSD || 0)), maxDaysToExit: Math.max(...liq.map(x => x.daysToExit || 0)),
        lookback: bt ? { category: bt.category, cagr: bt.cagr, maxDrawdown: bt.maxDrawdown } : null,
        weightedPremium: S.sum(Ah.map((a, i) => S.fin(a.premium) ? wv[i] * a.premium : 0)) / (S.sum(Ah.map((a, i) => S.fin(a.premium) ? wv[i] : 0)) || 1) };
    };
    const allocations = [alloc('Your weights', w, 'as entered'), alloc('Equal weight', P.equalWeight(hs.length), '1/N'), alloc('Inverse volatility', P.inverseVol(Ch), 'w ∝ 1/σ'),
      alloc('Minimum variance (cap 25 %)', P.minVariance(Ch, Math.max(0.25, 1 / hs.length)), 'long-only, capped'), alloc('Equal risk contribution', P.riskParity(Ch), 'each holding adds the same risk'),
      alloc('Valuation tilt (cap 25 %)', P.valuationTilt(Ah, 0.5, Math.max(0.25, 1 / hs.length)), 'equal weight tilted toward lower premium to estimated value')];
    const rsk = P.risk(Ch, w, hs), bt = P.backtest({ dates: ser.dates, closes: Object.fromEntries(hs.map(s => [s, ser.closes[s]])) }, hs, w, spy);
    const corr = P.corrFromCov(Ch);
    return {
      asOf: new Date(dates.at(-1)).toISOString().slice(0, 10), weeks: Rm.length, frequency: 'weekly US$ returns (avoids asynchronous-close bias between markets)', shrinkage: cv.shrinkage,
      capital, holdYears, holdings: hs.map((s, i) => ({ ...Ah[i], weight: w[i], usd: w[i] * capital })),
      risk: rsk, correlation: { syms: hs, matrix: corr }, exposures: { sector: P.exposure(Ah, w, 'sector'), region: P.exposure(Ah, w, 'region'), currency: P.exposure(Ah, w, 'ccy'), country: P.exposure(Ah, w, 'country') },
      beta: S.sum(Ah.map((a, i) => w[i] * (S.fin(a.beta) ? a.beta : 1))), liquidity: P.liquidity(Ah, w, capital),
      scenarios: P.scenarios(Ah, w, Ch, hs, capital, { ppy: 52 }), allocations, lookback: bt, regimes: P.regimeExposure({ dates: ser.dates, closes: Object.fromEntries(hs.map(s => [s, ser.closes[s]])) }, hs, w, spy),
      opportunity: cands.length ? P.opportunityCost(cands, wmap, { C, idx, assets, capital, holdYears, rf, add, ppy: 52 }) : [],
      riskFree: { rate: rf, label: '10-year US Treasury (cash alternative for a US$ investor)' },
      notes: ['Hypothetical model outputs. They are not financial outcomes and nothing is executed.',
        `Covariance: Ledoit–Wolf shrinkage (intensity ${cv.shrinkage.toFixed(2)}) on ${Rm.length} weeks of US$ returns; currency moves are part of the risk for a US$ investor.`,
        'Look-back performance uses the same period the risk was measured on: in-sample by construction.'],
    };
  }

  // Concentration input for the decision engine: sector weight after a hypothetical 5 % addition to the current portfolio.
  // score = 100 × min(1, sector weight after ÷ 40 %). Only when a current portfolio exists.
  function concentration() {
    const cur = currentWeights(); if (!cur) return null;
    const R = research.state, sec = {}; for (const [s, x] of Object.entries(cur.weights)) { const d = R.dossiers.get(s); if (d) sec[d.sector] = (sec[d.sector] || 0) + x; }
    return sym => { const d = R.dossiers.get(sym); if (!d) return null; const after = (sec[d.sector] || 0) * 0.95 + 0.05, own = (cur.weights[sym] || 0) * 0.95 + 0.05;
      return { score: 100 * Math.min(1, after / 0.4), text: `Adding 5 % to "${cur.name}" would bring ${d.sector} to ${(100 * after).toFixed(0)} % of the portfolio and this company to ${(100 * own).toFixed(0)} % (40 % in one sector scores 100).` }; };
  }
  function currentWeights() {
    const h = holdings?.(); if (h && Object.keys(h.weights || {}).length) return h;                       // paper book (Part 07) takes precedence
    const p = store.portfolios.find(x => x.id === store.current); return p && Object.keys(p.weights).length ? p : null;
  }
  return { get: () => store, save, analyse, concentration, currentWeights };
}
module.exports = { create };
