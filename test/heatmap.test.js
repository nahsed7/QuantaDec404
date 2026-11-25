// Part 02 tests: heat-map encodings, missing data, valuation indicators, metric consistency, and the international
// data path (currencies, IFRS filings). Fixtures are small synthetic inputs labelled as such; none is market data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stats'), T = require('../lib/treemap'), E = require('../lib/encodings'), X = require('../lib/fx');
const F = require('../lib/fundamentals'), V = require('../lib/valuation');
const { parseYahooChart, UNIVERSE, FINANCIAL, LOCAL_RF } = require('../src/research');
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

// Synthetic company summary in the shape /api/research/universe returns.
const closes = Array.from({ length: 260 }, (_, i) => 100 * Math.pow(1.001, i));
const stock = (over = {}) => ({ sym: 'TEST', label: 'Test Co', sector: 'Technology', region: 'US', country: 'US', ccy: 'USD', price: 100, change1d: 0.02,
  closes, relSector63: 0.03, hv252: 0.25, volumeZ: 1.2, divYield: 0.01, fscore: { score: 6, of: 9 }, maturity: { distSMA50: 1.5 }, epsYoY: 0.1, histPercentile: 0.7,
  marketCapUSD: 1e11, addv: 5e8, turnover: 0.004, scores: { opportunity: 60, risk: 40, confidence: 50 },
  valuation: { low: 80, base: 95, high: 110, premium: 100 / 95 - 1, status: 'within', widthRatio: 110 / 80 },
  fresh: { priceTime: 1.7e12, pricesFetched: 1.7e12, filed: '2025-02-01', priceKind: 'delayed quote' }, ...over });
const blank = () => stock({ change1d: null, closes: [], relSector63: null, hv252: null, volumeZ: null, divYield: null, fscore: null, maturity: {}, epsYoY: null,
  histPercentile: null, marketCapUSD: null, addv: null, turnover: null, scores: { opportunity: null, risk: null, confidence: null },
  valuation: { low: null, base: null, high: null, premium: null, status: 'insufficient', widthRatio: null } });

// ---------- visual data mapping ----------
test('every colour mapping: real values get a fill; missing values are flagged missing, never coloured as zero', () => {
  for (const key of Object.keys(E.COLOR)) {
    const full = E.tile(stock(), { color: key, customN: 10 }), empty = E.tile(blank(), { color: key, customN: 10 });
    assert.ok(full.fill && !full.missing, `${key}: expected a colour`);
    assert.equal(empty.fill, null, `${key}: missing data must not get a colour`);
    assert.equal(empty.missing, true, key);
    assert.equal(empty.valueText.includes('n/a'), true, `${key}: missing value must read n/a, got ${empty.valueText}`);
  }
});
test('every mapping documents a label, a source and a data kind, and reports a timestamp', () => {
  const kinds = new Set(['live', 'delayed', 'historical', 'estimate', 'simulated']);
  for (const [k, c] of Object.entries(E.COLOR)) {
    assert.ok(c.label && (c.src || k === 'eq'), k); assert.ok(kinds.has(E.kindOf(c, stock())), `${k}: kind`);
    assert.ok(Number.isFinite(c.asOf(stock(), { computedAt: 1.7e12 })), `${k}: asOf`);
  }
  for (const [k, z] of Object.entries(E.SIZE)) assert.ok(z.label && (z.src || k === 'eq'), k);
});
test('legend stops run from the scale minimum to maximum and match tile colours', () => {
  for (const key of Object.keys(E.COLOR)) {
    const stops = E.legendStops(key, 10), sc = E.COLOR[key].scale, [lo, hi] = E.scaleEnds(sc);
    close(stops[0].v, lo); close(stops[10].v, hi);
    for (const st of stops) assert.equal(st.fill, E.colourVal(st.v, sc).fill);
  }
});
test('premium colour is inverted: cheaper than the estimate looks green, dearer looks red', () => {
  const cheap = E.tile(stock({ valuation: { ...stock().valuation, premium: -0.4 } }), { color: 'prem' }).fill;
  const dear = E.tile(stock({ valuation: { ...stock().valuation, premium: 0.4 } }), { color: 'prem' }).fill;
  const g = f => +f.match(/\d+/g)[1], r = f => +f.match(/\d+/g)[0];
  assert.ok(g(cheap) > r(cheap)); assert.ok(r(dear) > g(dear));
});
test('custom period colour uses the chosen number of days', () => {
  const a = E.tile(stock(), { color: 'custom', customN: 5 }).value, b = E.tile(stock(), { color: 'custom', customN: 50 }).value;
  close(a, Math.pow(1.001, 5) - 1, 1e-9); close(b, Math.pow(1.001, 50) - 1, 1e-9);
});
test('size: missing values are drawn at the smallest known size and flagged', () => {
  const z = E.sizes([stock({ marketCapUSD: 5e10 }), stock({ marketCapUSD: 2e11 }), blank()], 'cap');
  assert.deepEqual(z.map(x => x.sizeMissing), [false, false, true]);
  assert.equal(z[2].size, 5e10);
});
test('grouping keys: sector, region and region-sector', () => {
  const s = stock({ region: 'International', country: 'JP' });
  assert.equal(E.GROUP.sector.key(s), 'Technology'); assert.equal(E.GROUP.region.key(s), 'International');
  assert.equal(E.GROUP.regionSector.key(s), 'Intl · Technology'); assert.equal(E.GROUP.country.key(s), 'JP');
});

// ---------- valuation indicators ----------
test('status, border and marker are consistent with the price and the range', () => {
  for (const [price, status] of [[70, 'below'], [95, 'within'], [130, 'above']]) {
    const s = stock({ price, valuation: { ...stock().valuation, status, premium: price / 95 - 1 } }), m = E.tile(s, {});
    assert.equal(m.status, status);
    const mk = m.marker;
    if (status === 'below') assert.ok(mk.price < mk.low); else if (status === 'above') assert.ok(mk.price > mk.high); else assert.ok(mk.price >= mk.low && mk.price <= mk.high);
    assert.equal(!!m.border, status !== 'within');                // inside the range = no border
  }
});
test('unknown or missing status reads as insufficient data, with no marker', () => {
  const m = E.tile(blank(), {});
  assert.equal(m.status, 'insufficient'); assert.equal(m.marker, null); assert.equal(m.statusLabel, T.STATUS.insufficient.label);
  assert.equal(E.tile(stock({ valuation: { ...stock().valuation, status: 'bogus' } }), {}).status, 'insufficient');
});
test('the same +2 % day reads differently above and below the valuation range', () => {
  const v = stock().valuation;
  const above = E.moveContext(stock({ price: 130, change1d: 0.02, valuation: { ...v, status: 'above' } }));
  const below = E.moveContext(stock({ price: 70, change1d: 0.02, valuation: { ...v, status: 'below' } }));
  assert.equal(above.code, 'away'); assert.equal(below.code, 'toward');
  assert.match(above.text, /further from/); assert.match(below.text, /back toward/);
  assert.match(above.text, /18 % above the optimistic/);        // 130 / 110 − 1
  assert.match(below.text, /13 % below the conservative/);      // 1 − 70 / 80
  assert.equal(E.moveContext(stock({ price: 70, change1d: -0.03, valuation: { ...v, status: 'below' } })).code, 'away');
  assert.equal(E.moveContext(stock({ change1d: 0.001, valuation: { ...v, status: 'above' }, price: 130 })).code, 'flat');
  assert.equal(E.moveContext(stock({ valuation: { ...v, status: 'uncertain' } })).code, 'none');
  assert.equal(E.moveContext(blank()).code, 'none');
  for (const c of [above, below]) assert.match(c.text, /Not a forecast/);
});
test('valuation uncertainty mapping only exists when a range exists', () => {
  assert.equal(E.COLOR.unc.get(stock()), 110 / 80);
  assert.equal(E.COLOR.unc.get(blank()), null);
});

// ---------- currencies ----------
const fxTable = { GBP: [{ t: 0, c: 1.2 }, { t: 100, c: 1.3 }], EUR: [{ t: 0, c: 1.1 }], JPY: [{ t: 0, c: 0.0067 }] };
test('FX: minor units, rate lookup, cross rates', () => {
  assert.deepEqual(X.normaliseCurrency('GBp'), { ccy: 'GBP', factor: 0.01 });
  assert.deepEqual(X.normaliseCurrency('EUR'), { ccy: 'EUR', factor: 1 });
  assert.equal(X.rateAt(fxTable.GBP, 50).rate, 1.2); assert.equal(X.rateAt(fxTable.GBP, 100).rate, 1.3); assert.equal(X.rateAt(fxTable.GBP, -5).extrapolated, true);
  close(X.cross('GBP', 'EUR', 150, fxTable), 1.3 / 1.1); assert.equal(X.cross('USD', 'USD', 0, fxTable), 1); assert.equal(X.cross('CHF', 'USD', 0, fxTable), null);
});
test('FX: bars are converted at each bar\'s own date; volume is unchanged; unconvertible bars are dropped', () => {
  const bars = [{ t: 50, o: 10, h: 11, l: 9, c: 10, v: 7 }, { t: 120, o: 10, h: 10, l: 10, c: 10, v: 8 }];
  const out = X.convertBars(bars, 'GBP', 'USD', fxTable);
  close(out[0].c, 12); close(out[1].c, 13); assert.equal(out[0].v, 7);
  assert.equal(X.convertBars(bars, 'CHF', 'USD', fxTable).length, 0);
  assert.equal(X.convertBars(bars, 'USD', 'USD', fxTable), bars);
});
test('Yahoo chart parser: pence are converted to pounds; malformed responses throw', () => {
  const j = { chart: { result: [{ meta: { currency: 'GBp', exchangeTimezoneName: 'Europe/London' }, timestamp: [1, 2], indicators: { quote: [{ open: [100, 200], high: [110, 210], low: [90, 190], close: [105, null], volume: [5, 6] }] },
    events: { dividends: { a: { date: 1, amount: 50 } } } }] } };
  const p = parseYahooChart(j);
  assert.equal(p.currency, 'GBP'); assert.equal(p.quotedIn, 'GBp'); assert.equal(p.bars.length, 1); close(p.bars[0].c, 1.05); close(p.div[0].amount, 0.5);
  assert.throws(() => parseYahooChart({ chart: { result: null, error: { description: 'No data found' } } }), /No data found/);
  assert.throws(() => parseYahooChart({}), /unexpected response/);
});

// ---------- international filings (IFRS 20-F) ----------
const ifrsFixture = () => ({ cik: 1, entityName: 'Fixture plc', facts: {
  'ifrs-full': {
    Revenue: { units: { TWD: [{ start: '2023-01-01', end: '2023-12-31', val: 2000, form: '20-F', filed: '2024-04-01', fp: 'FY' }, { start: '2024-01-01', end: '2024-12-31', val: 2600, form: '20-F', filed: '2025-04-01', fp: 'FY' }],
      USD: [{ start: '2024-01-01', end: '2024-12-31', val: 80, form: '20-F', filed: '2025-04-01', fp: 'FY' }] } },   // convenience translation
    ProfitLossAttributableToOwnersOfParent: { units: { TWD: [{ start: '2023-01-01', end: '2023-12-31', val: 500, form: '20-F', filed: '2024-04-01' }, { start: '2024-01-01', end: '2024-12-31', val: 700, form: '20-F', filed: '2025-04-01' }] } },
    DilutedEarningsLossPerShare: { units: { 'TWD/shares': [{ start: '2024-01-01', end: '2024-12-31', val: 7, form: '20-F', filed: '2025-04-01' }], 'USD/shares': [{ start: '2024-01-01', end: '2024-12-31', val: 0.2, form: '20-F', filed: '2025-04-01' }] } },
    AdjustedWeightedAverageShares: { units: { shares: [{ start: '2024-01-01', end: '2024-12-31', val: 100, form: '20-F', filed: '2025-04-01' }] } },
    Equity: { units: { TWD: [{ end: '2024-12-31', val: 3000, form: '20-F', filed: '2025-04-01' }] } },
    InterimOnly: { units: { TWD: [{ end: '2024-06-30', val: 1, form: '6-K', filed: '2024-08-01' }] } },
  } } });
test('IFRS 20-F: reporting currency ignores convenience translations; units and forms are filtered', () => {
  const cf = F.compact(ifrsFixture());
  assert.equal(cf.currency, 'TWD');
  assert.equal(cf.facts['ifrs-full:Revenue'].unit, 'TWD');
  assert.equal(cf.facts['ifrs-full:DilutedEarningsLossPerShare'].unit, 'TWD/shares');
  const { rows, currency } = F.annual(cf);
  assert.equal(currency, 'TWD'); assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.revenue), [2000, 2600]); assert.equal(rows[1].netIncome, 700); assert.equal(rows[1].eps, 7); assert.equal(rows[1].dilShares, 100);
});
test('a fact with no unit in the reporting currency is dropped rather than mixed in', () => {
  const raw = ifrsFixture(); raw.facts['ifrs-full'].CashAndCashEquivalents = { units: { USD: [{ end: '2024-12-31', val: 9, form: '20-F', filed: '2025-04-01' }] } };
  assert.equal(F.compact(raw).facts['ifrs-full:CashAndCashEquivalents'], undefined);
});
test('US filings keep working: us-gaap 10-K facts with no currency field default to USD', () => {
  const cf = { cik: 2, entityName: 'US Co', facts: { 'us-gaap': { Revenues: { units: { USD: [{ start: '2024-01-01', end: '2024-12-31', val: 10, form: '10-K', filed: '2025-02-01' }] } },
    NetIncomeLoss: { units: { USD: [{ start: '2024-01-01', end: '2024-12-31', val: 2, form: '10-K', filed: '2025-02-01' }] } } } } };
  const c = F.compact(cf); assert.equal(c.currency, 'USD'); assert.equal(F.annual(c).rows[0].revenue, 10);
  assert.equal(F.annual({ facts: c.facts }).currency, 'USD');
});

// ---------- valuation guard added with the international universe ----------
test('DCF: depreciation above capex does not create cash for ever (net investment floored at zero)', () => {
  const ctx = { price: 10, shares: 100, rf: 0.04, beta: 1, isFinancial: false, rows: [], bal: { debt: 0, cash: 0 }, fund: {}, peers: [], history: [] };
  const a = { revenue0: 1000, growth: 0.03, opMargin: 0.1, taxRate: 0.25, capexPct: 0.03, nwcPct: 0, discountRate: 0.08, terminalGrowth: 0.02, debt: 0, cash: 0, shares: 100, growthLo: 0.02, growthHi: 0.04, terminalLo: 0.015, terminalHi: 0.025 };
  const eq = V.dcfValue({ ...a, daPct: 0.03 }), over = V.dcfValue({ ...a, daPct: 0.09 });
  close(over.perShare ?? over, eq.perShare ?? eq, 1e-9);
});

// ---------- universe definition ----------
test('universe: unique symbols, every company has a sector and region, financials are known symbols, local rates map', () => {
  const syms = UNIVERSE.map(u => u.sym);
  assert.equal(new Set(syms).size, syms.length);
  for (const u of UNIVERSE) { assert.ok(u.sector && u.region && u.country, u.sym); assert.ok(u.cik === null || Number.isInteger(u.cik), u.sym); }
  for (const f of FINANCIAL) assert.ok(syms.includes(f), f);
  assert.equal(UNIVERSE.filter(u => u.region === 'US').length, 55);
  assert.ok(UNIVERSE.filter(u => u.region === 'International').length >= 30);
  for (const id of Object.values(LOCAL_RF)) assert.match(id, /^[A-Z0-9]+$/);
});
