// Part 03 tests: valuation engine (growth, WACC, tax, sensitivity, confidence, disagreement), point-in-time
// fundamentals, and market analytics (date alignment, beta, total return, spread estimator, costs, divergence).
// All inputs are SYNTHETIC test fixtures with known answers; none is market data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stats'), V = require('../lib/valuation'), F = require('../lib/fundamentals'), Q = require('../lib/quant'), C = require('../lib/calibrate');
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const DAY = 864e5;

const baseCtx = (over = {}) => ({ price: 50, shares: 1e9, rf: 0.04, beta: 1.2, country: 'US', isFinancial: false,
  rows: [{ end: '2022-12-31', revenue: 8e9, opIncome: 8e8, eps: 1.6, dilShares: 1e9 }, { end: '2023-12-31', revenue: 9e9, opIncome: 9e8, eps: 1.8, dilShares: 1e9 },
    { end: '2024-12-31', revenue: 1e10, opIncome: 1e9, capex: 4e8, da: 3e8, eps: 2, dilShares: 1e9, taxRate: 0.2 }],
  bal: { debt: 5e9, cash: 1e9, equity: 2e10 }, fund: { revGrowth1: 0.3, revGrowth3: 0.2, revGrowth5: 0.1, opMarginAvg: 0.1, opMarginStd: 0.01, roe: 0.1, payoutNI: 0.3 },
  peers: [], history: [], dps: 1, dpsGrowth5: 0.04, fresh: { filed: '2025-02-01', filingAgeDays: 300 }, ...over });

// ---------- valuation ----------
test('growth: median historical CAGR shrunk halfway toward terminal growth', () => {
  const a = V.defaults(baseCtx());
  const gT = Math.min(0.025, 0.04 - 0.005), gHist = 0.2;                        // median of 0.3, 0.2, 0.1
  close(a.terminalGrowth, gT); close(a.growth, gT + V.GROWTH_SHRINK * (gHist - gT)); close(a.growthLo, a.growth - 0.04); close(a.growthHi, a.growth + 0.04);
  assert.equal(V.defaults(baseCtx({ fund: { ...baseCtx().fund, revGrowth1: 2, revGrowth3: 2, revGrowth5: 2 } })).growth, 0.15);   // clamped
});
test('WACC: CAPM cost of equity, debt weighting, floored at risk-free + 2 pts', () => {
  const a = V.defaults(baseCtx());
  const beta = 0.67 * 1.2 + 0.33; close(a.costEquity, 0.04 + beta * V.ERP);
  const cheap = V.defaults(baseCtx({ beta: 0.2, bal: { debt: 1e12, cash: 0, equity: 1e10 } }));   // huge cheap debt
  assert.equal(cheap.waccFloored, true); close(cheap.discountRate, 0.04 + V.WACC_SPREAD_MIN); assert.ok(cheap.waccRaw < cheap.discountRate);
});
test('tax: own effective rate when available, otherwise the country statutory rate', () => {
  close(V.defaults(baseCtx()).taxRate, 0.2);
  const rows = baseCtx().rows.map(({ taxRate, ...r }) => r);
  const jp = V.defaults(baseCtx({ rows, country: 'JP' })); close(jp.taxRate, V.STATUTORY_TAX.JP); assert.match(jp.taxSource, /statutory/);
});
test('rederive: editing β, ERP or the risk-free rate keeps cost of equity and WACC consistent', () => {
  const a = V.defaults(baseCtx()), b = V.rederive({ ...a, erp: 0.07, beta: 1.5 });
  close(b.costEquity, a.rf + 1.5 * 0.07); assert.ok(b.discountRate > a.discountRate);
  const c = V.rederive({ ...a, rf: 0.01 }); assert.ok(c.costEquity < a.costEquity); assert.ok(c.discountRate >= 0.01 + V.WACC_SPREAD_MIN - 1e-12);
});
test('every applicable model reports sensitivity, freshness and a confidence level', () => {
  const ms = V.runAll(baseCtx(), V.defaults(baseCtx()));
  for (const m of ms.filter(x => x.applicable)) {
    assert.ok(['high', 'medium', 'low'].includes(m.confidence.level), m.id); assert.ok(m.confidence.reasons.length, m.id);
    assert.equal(m.freshness.filed, '2025-02-01', m.id); assert.ok(m.freshness.uses, m.id);
    if (!m.reference) assert.ok(m.sensitivity?.length > 0, `${m.id} sensitivity`);
  }
});
test('sensitivity directions: higher cost of equity lowers the dividend value; higher margin raises earnings power', () => {
  const ctx = baseCtx(), a = V.defaults(ctx);
  const ddm = V.sensitivity(ctx, a, 'ddm').find(x => x.key === 'costEquity'); assert.ok(ddm.up < ddm.base && ddm.down > ddm.base);
  const epv = V.sensitivity(ctx, a, 'epv').find(x => x.key === 'opMargin'); assert.ok(epv.up > epv.base && epv.down < epv.base);
});
test('model confidence drops one level per weakness', () => {
  const ok = V.modelConfidence({ id: 'epv', low: 90, base: 100, high: 110 }, { fresh: { filingAgeDays: 100 } });
  const wide = V.modelConfidence({ id: 'epv', low: 40, base: 100, high: 110 }, { fresh: { filingAgeDays: 100 } });
  const worse = V.modelConfidence({ id: 'epv', low: 40, base: 100, high: 110 }, { fresh: { filingAgeDays: 900 }, sharesConflict: true });
  assert.equal(ok.level, 'high'); assert.equal(wide.level, 'medium'); assert.equal(worse.level, 'low');
});
test('synthesis lists every cross-check model with its position relative to the primary range', () => {
  const mk = (id, low, base, high, extra = {}) => ({ id, name: id, applicable: true, low, base, high, ...extra });
  const syn = V.synthesize([mk('dcf', 90, 100, 110), mk('comps', 120, 130, 140), mk('epv', 60, 70, 95), mk('hist', 95, 105, 115)], 100, {});
  const pos = Object.fromEntries(syn.disagreements.map(d => [d.id, d.position]));
  assert.deepEqual(pos, { comps: 'above', epv: 'below', hist: 'inside' });
  assert.equal(syn.disagreements.find(d => d.id === 'epv').overlap, true); assert.equal(syn.disagreements.find(d => d.id === 'comps').overlap, false);
  close(syn.disagreements[0].vsPrimary, 0.3);                                     // sorted by size of the difference
});

// ---------- point-in-time fundamentals ----------
const cfFix = () => ({ facts: { Revenues: { unit: 'USD', v: [
  ['2023-01-01', '2023-12-31', 100, '10-K', '2024-02-15'],
  ['2023-01-01', '2023-12-31', 90, '10-K', '2025-02-15'],          // restated a year later in the next 10-K
  ['2024-01-01', '2024-12-31', 120, '10-K', '2025-02-15']] },
  NetIncomeLoss: { unit: 'USD', v: [['2023-01-01', '2023-12-31', 10, '10-K', '2024-02-15'], ['2024-01-01', '2024-12-31', 12, '10-K', '2025-02-15']] } } });
test('asOf: only facts filed by the date are visible; later restatements are invisible', () => {
  const early = F.annual(F.asOf(cfFix(), '2024-06-30')).rows, late = F.annual(F.asOf(cfFix(), '2025-06-30')).rows;
  assert.deepEqual(early.map(r => [r.end, r.revenue]), [['2023-12-31', 100]]);   // as first reported
  assert.deepEqual(late.map(r => [r.end, r.revenue]), [['2023-12-31', 90], ['2024-12-31', 120]]);
  assert.equal(F.annual(F.asOf(cfFix(), '2024-01-01')).rows.length, 0);
});
test('restatements: counts annual values revised by a later filing', () => {
  assert.deepEqual(F.restatements(cfFix()), { revised: 1, compared: 1 });
});
test('calibration uses only EPS versions filed before each formation date', () => {
  // Two stocks × 30 months. EPS for stock A is restated upward in a filing that comes after every formation date:
  // if the test leaked it, A's earnings yield ranking would change.
  const months = Array.from({ length: 30 }, (_, i) => Date.UTC(2020, i, 28));
  const mk = (sym, drift, eps) => ({ sym, monthly: months.map((t, i) => ({ t, c: 100 * Math.pow(1 + drift, i) })), annual: eps });
  const filed = Date.UTC(2020, 1, 1), others = [['B', 0.0, 5], ['C', 0.005, 3], ['D', 0.002, 4], ['E', 0.008, 2], ['F', -0.003, 6]].map(([k, dr, e]) => mk(k, dr, [{ end: '2019-12-31', eps: e, filed }]));
  const a1 = mk('A', 0.01, [{ end: '2019-12-31', eps: 1, filed }]), leak = { end: '2019-12-31', eps: 50, filed: Date.UTC(2030, 0, 1) };
  const r1 = C.run([a1, ...others]), r2 = C.run([{ ...a1, annual: [...a1.annual, leak] }, ...others]);
  assert.ok(r1.valuation.series.length >= 4);
  assert.deepEqual(r1.valuation.series.map(x => x.ic), r2.valuation.series.map(x => x.ic));
});

// ---------- market analytics ----------
const mkBars = (n, f, t0 = Date.UTC(2023, 0, 2, 14, 30)) => Array.from({ length: n }, (_, i) => { const c = f(i); return { t: t0 + i * DAY, o: c, h: c * 1.01, l: c * 0.99, c, v: 1e6 }; });
test('align: joins series on the calendar date even when exchange timestamps differ', () => {
  const a = mkBars(5, i => 10 + i), b = mkBars(5, i => 20 + i, Date.UTC(2023, 0, 2, 0, 0));   // same dates, different hours
  assert.deepEqual(Q.align(a, b), [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  assert.deepEqual(Q.align(a, b.slice(2)), [[2, 0], [3, 1], [4, 2]]);
});
test('beta: recovers a known slope with a small standard error', () => {
  const u = S.rng(3), mr = Array.from({ length: 600 }, () => 0.01 * (u() - 0.5));
  let m = 100, x = 100; const mb = [], sb = [];
  for (let i = 0; i < 600; i++) { m *= Math.exp(mr[i]); x *= Math.exp(1.5 * mr[i] + 0.002 * (u() - 0.5)); mb.push({ t: Date.UTC(2022, 0, 1) + i * DAY, c: m, h: m, l: m, o: m, v: 1 }); sb.push({ t: Date.UTC(2022, 0, 1, 9) + i * DAY, c: x, h: x, l: x, o: x, v: 1 }); }
  const v = Q.volatility(sb, { marketBars: mb, marketName: 'Test index' });
  assert.ok(Math.abs(v.beta - 1.5) < 0.02, `beta ${v.beta}`); assert.ok(v.betaSE > 0 && v.betaSE < 0.02); assert.equal(v.betaVs, 'Test index');
  assert.ok(v.regimeVol && Number.isFinite(v.regimeVol.marketCalm) && Number.isFinite(v.regimeVol.marketTurbulent));
});
test('total return index: dividends reinvested on the ex-date', () => {
  const bars = mkBars(3, () => 100), tri = Q.totalReturnIndex(bars, [{ t: bars[1].t, amount: 2 }]);
  assert.deepEqual(tri.map(x => +x.toFixed(6)), [1, 1.02, 1.02]);
  close(Q.totalReturns(bars, [{ t: bars[1].t, amount: 2 }], [2])[2], 0.02);
});
test('spread estimator (Abdi–Ranaldo) recovers a known 1 % bid–ask bounce within a reasonable band', () => {
  const u = S.rng(7); let p = 100; const bars = [];
  for (let i = 0; i < 300; i++) { const px = []; for (let k = 0; k < 50; k++) { p *= Math.exp(0.002 * (u() - 0.5)); px.push(p * (1 + (u() < 0.5 ? -0.005 : 0.005))); }
    bars.push({ t: i * DAY, o: px[0], h: Math.max(...px), l: Math.min(...px), c: px[49], v: 1e6 }); }
  const est = Q.liquidity(bars, {}).spreadEst; assert.ok(est > 0.006 && est < 0.014, `estimate ${est}`);
});
test('spread estimator does not overstate a tight (3 bp) spread; costs floor it at 2 bp', () => {
  const u = S.rng(7); let p = 100; const bars = [];
  for (let i = 0; i < 300; i++) { const px = []; for (let k = 0; k < 50; k++) { p *= Math.exp(0.002 * (u() - 0.5)); px.push(p * (1 + (u() < 0.5 ? -0.00015 : 0.00015))); }
    bars.push({ t: i * DAY, o: px[0], h: Math.max(...px), l: Math.min(...px), c: px[49], v: 1e6 }); }
  const l = Q.liquidity(bars, {}); assert.ok(l.spreadEst < 0.001, `estimate ${l.spreadEst}`);
  const c = Q.tradeCost({ ...l, addv: 1e9, sigmaDaily: 0.01 }, 1e4); assert.ok(c.halfSpread >= 0.0001 - 1e-12);
});
test('cost curve: cost rises with order size; orders above 10 % of daily value are flagged', () => {
  const curve = Q.costCurve({ available: true, addv: 1e7, sigmaDaily: 0.02, spreadEst: 0.001 }, [1e4, 1e5, 1e6, 5e6]);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i].bp > curve[i - 1].bp);
  assert.deepEqual(curve.map(c => c.feasible), [true, true, true, false]);
  close(curve[0].bp, 1e4 * (0.0005 + 0.02 * Math.sqrt(1e4 / 1e7)));
});
test('relative-strength divergence: a new price high while lagging the index is flagged bearish', () => {
  const n = 200, idx = mkBars(n, i => 100 * Math.pow(1.004, i)), stk = mkBars(n, i => 100 * Math.pow(1.001, i));
  const x = Q.exhaustion(stk, { marketBars: idx });
  assert.equal(x.rsDivergence, 'bearish'); assert.ok(x.signals.some(s => /Relative-strength bearish/.test(s)));
  assert.equal(Q.exhaustion(stk, {}).rsDivergence, null);                     // no index → not computed, not guessed
});
test('liquidity-tier spread model: tighter for more traded value; used by trade costs ahead of the daily-bar estimate', () => {
  assert.equal(Q.spreadTier(5e9), 0.0002); assert.equal(Q.spreadTier(3e8), 0.0004); assert.equal(Q.spreadTier(6e7), 0.0008); assert.equal(Q.spreadTier(2e7), 0.002); assert.equal(Q.spreadTier(1e6), 0.005); assert.equal(Q.spreadTier(null), null);
  const c = Q.tradeCost({ available: true, addv: 5e9, sigmaDaily: 0.02, spreadEst: 0.03, spreadModel: 0.0002 }, 1e5);
  close(c.halfSpread, 0.0001); assert.equal(c.spreadSource, 'liquidity-tier model');
  assert.equal(Q.tradeCost({ available: true, addv: 5e9, sigmaDaily: 0.02, quotedSpread: 0.0004, spreadModel: 0.0002 }, 1e5).spreadSource, 'quoted');
});
