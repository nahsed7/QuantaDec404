// Unit tests for the shared analytics. Run: node --test test/
// Fixtures below are small synthetic inputs built to have known answers; they are test data, not market data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stats'), F = require('../lib/fundamentals'), V = require('../lib/valuation');
const Q = require('../lib/quant'), T = require('../lib/treemap'), D = require('../lib/decision'), R = require('../lib/regime'), C = require('../lib/calibrate');
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

// ---------- visual data mapping ----------
test('squarify: areas proportional to values, inside the box, no overlaps', () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ id: i, value: v }));
  const out = T.squarify(items, 0, 0, 600, 400), tot = 24;
  assert.equal(out.length, items.length);
  for (const r of out) {
    close(r.w * r.h, 600 * 400 * r.value / tot, 1e-6);
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 600 + 1e-6 && r.y + r.h <= 400 + 1e-6);
  }
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    const a = out[i], b = out[j], ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    assert.ok(ox <= 1e-6 || oy <= 1e-6, 'tiles overlap');
  }
});
test('layout: every stock gets a tile inside its sector', () => {
  const st = [['A', 'X', 5], ['B', 'X', 3], ['C', 'Y', 4], ['D', 'Z', 1]].map(([sym, sector, size]) => ({ sym, sector, size }));
  const L = T.layout(st, 800, 500);
  assert.equal(L.tiles.length, 4);
  for (const t of L.tiles) { const g = L.sectors.find(s => s.id === t.sector); assert.ok(t.x >= g.x && t.x + t.w <= g.x + g.w + 1e-6 && t.y >= g.y && t.y + t.h <= g.y + g.h + 1e-6); }
});
test('colour: diverging scale is symmetric, clips, inverts; missing values are flagged not coloured', () => {
  const sc = { kind: 'diverging', domain: 0.03 };
  assert.equal(T.colour(0, sc).t, 0.5);
  assert.equal(T.colour(0.03, sc).t, 1); assert.equal(T.colour(-0.03, sc).t, 0);
  assert.equal(T.colour(0.09, sc).clipped, true);
  assert.equal(T.colour(0.03, { ...sc, invert: true }).t, 0);
  for (const v of [null, undefined, NaN, Infinity]) { const c = T.colour(v, sc); assert.equal(c.missing, true); assert.equal(c.fill, null); }
});
test('valuation marker: positions price inside the range and stays in [0, 1]', () => {
  const m = T.marker(150, { low: 100, base: 120, high: 140 });
  assert.equal(m.price, 1); assert.equal(m.low, 0); close(m.high, 0.8); close(m.base, 0.4);
  assert.equal(T.marker(150, { low: null, high: 140 }), null);
  assert.equal(T.marker(NaN, { low: 100, high: 140 }), null);
});

// ---------- valuation indicators ----------
const A0 = { revenue0: 1000, growth: 0.03, growthLo: 0.0, growthHi: 0.05, opMargin: 0.2, marginBand: 0.02, taxRate: 0.2, capexPct: 0.05, daPct: 0.05, nwcPct: 0,
  discountRate: 0.08, discountBand: 0.01, costEquity: 0.09, beta: 1, rf: 0.04, erp: 0.05, terminalGrowth: 0.03, terminalLo: 0.02, terminalHi: 0.035, debt: 0, cash: 0, shares: 100, eps: 1.6, epsNormal: 1.6, dps: null };
test('DCF equals the Gordon growth value when growth is constant and investment equals depreciation', () => {
  const v = V.dcfValue(A0).perShare;                      // FCFF_1 = 1000·1.03·0.2·0.8 = 164.8; value = 164.8/(0.08−0.03) = 3296
  close(v * 100, 1000 * 1.03 * 0.2 * 0.8 / (0.08 - 0.03), 1e-9);
});
test('DCF: higher discount rate lowers value; net cash raises it one for one', () => {
  assert.ok(V.dcfValue({ ...A0, discountRate: 0.09 }).perShare < V.dcfValue(A0).perShare);
  close(V.dcfValue({ ...A0, cash: 500 }).perShare - V.dcfValue(A0).perShare, 5);
  close(V.dcfValue(A0).perShare - V.dcfValue({ ...A0, debt: 500 }).perShare, 5);
  assert.equal(V.dcfValue({ ...A0, discountRate: 0.035 }), null);   // r must exceed g by 1 point
});
test('DCF model: conservative ≤ base ≤ optimistic, reproducible, with sensitivity sorted by effect', () => {
  const ctx = { isFinancial: false };
  const a = V.dcf(ctx, A0), b = V.dcf(ctx, A0);
  assert.ok(a.applicable && a.low <= a.base && a.base <= a.high);
  assert.equal(a.low, b.low);
  for (let i = 1; i < a.sensitivity.length; i++) assert.ok(a.sensitivity[i - 1].swing >= a.sensitivity[i].swing);
  assert.equal(V.dcf({ isFinancial: true }, A0).applicable, false);
  assert.equal(V.dcf(ctx, { ...A0, opMargin: -0.1 }).applicable, false);
  assert.match(V.dcf(ctx, { ...A0, revenue0: null }).reason, /Missing input/);
});
test('DDM matches a hand-computed two-stage value', () => {
  let pv = 0, d = 2; for (let t = 1; t <= 5; t++) { d *= 1.05; pv += d / 1.09 ** t; }
  close(V.ddmValue(2, 0.05, 0.03, 0.09), pv + d * 1.03 / 0.06 / 1.09 ** 5);
  assert.equal(V.ddm({}, { ...A0, dps: null }).applicable, false);
});
test('Comparables use peer quartiles and exclude the company itself', () => {
  const peers = [10, 12, 14, 16, 18].map((pe, i) => ({ sym: 'P' + i, pe })).concat([{ sym: 'SELF', pe: 99 }]);
  const m = V.comps({ sym: 'SELF', peers, rows: [{}], sector: 'X' }, { ...A0, eps: 2 });
  assert.ok(m.applicable); close(m.base, 14 * 2); close(m.low, 12 * 2); close(m.high, 16 * 2);
  assert.equal(V.comps({ sym: 'SELF', peers: peers.slice(0, 2), rows: [{}] }, A0).applicable, false);
});
test('Synthesis never averages models and classifies against the primary range', () => {
  const mk = (id, low, base, high) => ({ id, name: id, applicable: true, low, base, high });
  const ms = [mk('dcf', 90, 100, 110), mk('comps', 95, 105, 115), mk('hist', 98, 102, 108)];
  const below = V.synthesize(ms, 80), within = V.synthesize(ms, 100), above = V.synthesize(ms, 130);
  assert.equal(below.status, 'below'); assert.equal(within.status, 'within'); assert.equal(above.status, 'above');
  assert.equal(within.base, 100);                                  // primary (DCF) value, not a mean of 100/105/102
  close(above.premium, 0.3);
  const wide = V.synthesize([mk('dcf', 20, 100, 200)], 100); assert.equal(wide.status, 'uncertain');
  const split = V.synthesize([mk('dcf', 90, 100, 110), mk('comps', 280, 300, 320), mk('hist', 30, 35, 40)], 100); assert.equal(split.status, 'uncertain');
  assert.equal(V.synthesize([], 100).status, 'insufficient');
  assert.equal(V.synthesize(ms, null).status, 'insufficient');
});
test('Scenarios: lower growth and higher discount rates reduce the DCF value', () => {
  const ctx = { isFinancial: false, price: 30, rows: [{}], peers: [], history: [] };
  const sc = V.scenarios(ctx, A0), get = n => sc.find(s => s.name === n);
  assert.ok(get('Revenue growth −3 pts').change.dcf < 0);
  assert.ok(get('Discount rates +1 pt').change.dcf < 0);
  assert.ok(get('Debt +25 %').change.dcf <= 0);
});

// ---------- missing data ----------
test('Fundamentals: missing statements give nulls, never invented numbers', () => {
  const r = F.analyse([], {}, 100);
  for (const k of ['revGrowth1', 'opMargin', 'roic', 'currentRatio', 'debtToEbitda', 'fscore']) assert.equal(r[k], null);
  assert.deepEqual(r.flags, []);
});
test('Valuation with no data: every model is not applicable with a reason', () => {
  const ctx = { sym: 'X', price: 10, shares: null, rows: [], bal: {}, fund: {}, rf: 0.04, peers: [], history: [] };
  const ms = V.runAll(ctx);
  for (const m of ms) { assert.equal(m.applicable, false); assert.ok(m.reason && m.reason.length > 5); }
  assert.equal(V.synthesize(ms, 10).status, 'insufficient');
});
test('Quant functions report unavailability instead of computing on too little data', () => {
  const bars = Array.from({ length: 10 }, (_, i) => ({ t: i, o: 1, h: 1, l: 1, c: 1, v: 1 }));
  assert.equal(Q.momentum(bars).available, false); assert.equal(Q.exhaustion(bars).available, false);
  assert.equal(Q.volatility(bars).available, false); assert.equal(Q.liquidity(bars).available, false);
  assert.equal(R.classify(bars).available, false);
});
test('Decision: unmeasurable components lower confidence and are listed as unknown', () => {
  const d = { valuation: { synthesis: { status: 'insufficient' }, models: [] }, fund: {}, momentum: {}, volatility: {}, liquidity: {} };
  const a = D.assess(d, {});
  assert.equal(a.confidence.score, 0);
  assert.equal(a.opportunity.score, null);
  assert.ok(a.evidence.unknown.length >= 5);
});

// ---------- metric consistency ----------
test('Returns, drawdown and volatility match hand calculations', () => {
  const c = [100, 110, 99, 120, 90, 108];
  const bars = c.map((x, i) => ({ t: i, c: x, o: x, h: x, l: x, v: 1 }));
  close(Q.returns(bars, [1, 5])[1], 108 / 90 - 1); close(Q.returns(bars, [1, 5])[5], 0.08);
  close(S.drawdown(c).max, 1 - 90 / 120); close(S.drawdown(c).current, 1 - 108 / 120);
  const r = S.logReturns(c); close(S.std(r), Math.sqrt(r.reduce((s, x) => s + (x - S.mean(r)) ** 2, 0) / (r.length - 1)));
});
test('Constant-growth price series: zero volatility, perfect trend, 12-month momentum as constructed', () => {
  const bars = Array.from({ length: 300 }, (_, i) => { const c = 100 * Math.exp(0.001 * i); return { t: i * 864e5, o: c, h: c, l: c, c, v: 1000 }; });
  const vo = Q.volatility(bars), m = Q.momentum(bars);
  assert.ok(vo.hv20 < 1e-9); close(m.trendR2, 1, 1e-9);
  close(m.mom12_1, Math.exp(0.001 * 231) - 1, 1e-9);
});
test('Fundamentals extraction: annual rows from a companyfacts-shaped fixture, restatements win, ratios consistent', () => {
  const fact = (vals) => ({ unit: 'USD', v: vals });
  const cf = { cik: 1, name: 'Fixture Co', facts: {
    Revenues: fact([['2022-01-01', '2022-12-31', 100, '10-K', '2023-02-01', 'FY'], ['2023-01-01', '2023-12-31', 110, '10-K', '2024-02-01', 'FY'], ['2023-01-01', '2023-12-31', 112, '10-K', '2025-02-01', 'FY'],
      ['2024-01-01', '2024-12-31', 121, '10-K', '2025-02-01', 'FY'], ['2024-07-01', '2024-09-30', 30, '10-Q', '2024-11-01', 'Q3']]),
    OperatingIncomeLoss: fact([['2022-01-01', '2022-12-31', 20, '10-K', '2023-02-01'], ['2023-01-01', '2023-12-31', 22, '10-K', '2024-02-01'], ['2024-01-01', '2024-12-31', 25, '10-K', '2025-02-01']]),
    NetIncomeLoss: fact([['2024-01-01', '2024-12-31', 18, '10-K', '2025-02-01']]),
    NetCashProvidedByUsedInOperatingActivities: fact([['2024-01-01', '2024-12-31', 24, '10-K', '2025-02-01']]),
    PaymentsToAcquirePropertyPlantAndEquipment: fact([['2024-01-01', '2024-12-31', 6, '10-K', '2025-02-01']]),
    StockholdersEquity: fact([[null, '2024-12-31', 80, '10-K', '2025-02-01']]),
  } };
  const { rows } = F.annual(cf);
  assert.deepEqual(rows.map(r => r.end), ['2022-12-31', '2023-12-31', '2024-12-31']);
  assert.equal(rows[1].revenue, 112);                       // later filing (restatement) wins
  assert.equal(rows[2].fcf, 18);                            // 24 − 6
  const f = F.analyse(rows, {}, 10);
  close(f.revGrowth1, 121 / 112 - 1); close(f.opMargin, 25 / 121);
  assert.ok(!rows.some(r => r.revenue === 30));             // quarterly value not used as annual
});
test('Market cap identity and liquidity units', () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({ t: i, o: 50, h: 51, l: 49, c: 50 + (i % 2), v: 1e6 }));
  const l = Q.liquidity(bars, { shares: 1e8 });
  close(l.turnover, l.advShares / 1e8);
  assert.ok(l.addv >= 50e6 && l.addv <= 51e6);
  const c = Q.tradeCost(l, 1e6); assert.ok(c.total > 0 && c.participation > 0);
});
test('Scores are independent: changing confidence inputs does not move opportunity or risk', () => {
  const base = { valuation: { synthesis: { premium: -0.2, primary: 'dcf', dispersion: 0.1, agreement: 1, widthRatio: 1.3 }, models: [] }, fund: { revGrowth3: 0.08, roic: 0.15, opMarginStd: 0.01 },
    momentum: { mom12_1: 0.1 }, volatility: { hv252: 0.25, maxDrawdown1y: 0.15, currentDrawdown: 0.05, beta: 1 }, liquidity: { addv: 5e8 }, completeness: 1, fresh: { filingAgeDays: 30 } };
  const a = D.assess(base, {}), b = D.assess({ ...base, completeness: 0.3, fresh: { filingAgeDays: 400 } }, {});
  assert.equal(a.opportunity.score, b.opportunity.score); assert.equal(a.risk.score, b.risk.score);
  assert.ok(b.confidence.score < a.confidence.score);
  for (const s of [a.opportunity.score, a.risk.score, a.confidence.score]) assert.equal(s % 5, 0);   // no false precision
});
test('Comparison never selects a winner', () => {
  const mk = (sym, o, c) => ({ sym, valuation: { synthesis: { premium: 0 } }, decision: { opportunity: { score: o }, risk: { score: 50 }, confidence: { score: c } }, completeness: 1 });
  const r = D.compare([mk('A', 80, 30), mk('B', 50, 70)]);
  assert.ok(r.notes.some(n => /highest opportunity score but the lowest confidence/.test(n)));
  assert.ok(r.notes.some(n => /No company is selected/.test(n)));
});
test('Calibration uses only filings published before each formation date', () => {
  const months = Array.from({ length: 30 }, (_, i) => Date.UTC(2020, i, 15));
  const mkS = (sym, k) => ({ sym, monthly: months.map((t, i) => ({ t, c: 100 * (1 + k * i / 100) })), annual: [{ end: '2021-12-31', eps: k, filed: Date.UTC(2030, 0, 1) }] });
  const r = C.run(Array.from({ length: 6 }, (_, i) => mkS('S' + i, i + 1)));
  assert.equal(r.valuation.n, 0);                           // all EPS filed in the future → no valuation cross-sections
  assert.ok(r.momentum.n >= 1);
});
