// Part 07 tests: execution simulator, pre-trade risk controls, order manager (end to end with a stub market),
// broker adapters (live disabled) and write protection. SYNTHETIC quotes and books only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const E = require('../lib/execsim'), RC = require('../lib/riskcontrol');
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

const T0 = Date.UTC(2026, 0, 5, 15, 0);
const snap = (over = {}) => ({ last: 100, time: T0 + 60e3, open: true, spreadEst: 0.001, sigmaDaily: 0.02, advShares: 1e6, fxUSD: 1, region: 'US', ...over });
const ord = (over = {}) => ({ side: 'buy', type: 'market', qty: 100, filled: 0, submittedAt: T0, tif: 'day', status: 'working', ...over });

// ---------- simulator ----------
test('never fills on the quote shown when the order was placed: needs a quote newer than submission + latency', () => {
  assert.equal(E.evaluate(ord(), snap({ time: T0 + 500 }), null).fill, null);
  assert.ok(E.evaluate(ord(), snap({ time: T0 + 5000 }), null).fill);
});
test('market orders pay the spread and market impact; sells receive less than the last price', () => {
  const b = E.evaluate(ord({ qty: 50 }), snap(), null).fill, s = E.evaluate(ord({ side: 'sell', qty: 50 }), snap(), null).fill;
  close(b.price, 100 * (1 + 0.0005) * (1 + 0.02 * Math.sqrt(50 / 1e6)));
  assert.ok(b.price > 100 && s.price < 100); assert.ok(b.slippageVsLast > 0 && s.slippageVsLast > 0);
});
test('fills are capped at 10 % of the volume traded since the last evaluation: large orders fill partially', () => {
  const r = E.evaluate(ord({ qty: 1e5 }), snap(), null);                      // 1 minute ≈ 1e6/390 shares traded → cap ≈ 256
  assert.equal(r.status, 'partially_filled'); assert.equal(r.fill.qty, Math.floor(0.1 * 1e6 / (390 * 60e3) * 60e3));
});
test('limit orders: no fill when the ask is above the limit; when filled, the price never exceeds the limit', () => {
  assert.equal(E.evaluate(ord({ type: 'limit', limit: 99.9 }), snap(), null).fill, null);
  const r = E.evaluate(ord({ type: 'limit', limit: 100.06, qty: 200 }), snap(), null); assert.ok(r.fill && r.fill.price <= 100.06 + 1e-12);
});
test('stop orders trigger on the last price; closed markets do not fill', () => {
  assert.equal(E.evaluate(ord({ type: 'stop', stop: 105 }), snap(), null).fill, null);
  const t = E.evaluate(ord({ type: 'stop', stop: 105 }), snap({ last: 106 }), null); assert.equal(t.triggered, true); assert.ok(t.fill);
  const sl = E.evaluate(ord({ side: 'sell', type: 'stop', stop: 95 }), snap({ last: 94 }), null); assert.ok(sl.fill);
  const cl = E.evaluate(ord(), snap({ open: false }), null); assert.equal(cl.fill, null); assert.match(cl.note, /closed/);
});
test('fee schedule: US per share with minimum and cap; other markets percentage with minimum', () => {
  close(E.fee('US', 10, 100), 1); close(E.fee('US', 1000, 100), 5); close(E.fee('US', 1e6, 0.5), 0.01 * 5e5);
  close(E.fee('International', 10, 100), 5); close(E.fee('International', 1000, 100), 100);
});

// ---------- risk controls ----------
const book = (over = {}) => ({ cashUSD: 50000, equityUSD: 100000, positions: { AAA: { qty: 100, sector: 'Tech', valueUSD: 15000 } }, dayStartEquityUSD: 100000, ...over });
const rc = (o, c = {}) => RC.check({ sym: 'AAA', side: 'buy', type: 'market', qty: 10, tif: 'day', ...o }, { book: book(), snap: { last: 100, open: true, ageMin: 5, advShares: 1e6, sector: 'Tech', fxUSD: 1, kind: 'delayed' }, recent: [], now: T0, brokerHealthy: true, ...c });
const codes = r => r.blocks.map(b => b.code);
test('risk controls block invalid, short, cash, position, sector, liquidity, stale, moved-price and kill-switch cases', () => {
  assert.deepEqual(codes(rc({ qty: 0 })), ['invalid']); assert.deepEqual(codes(rc({ qty: 1.5 })), ['invalid']); assert.deepEqual(codes(rc({ type: 'limit' })), ['invalid']);
  assert.ok(codes(rc({ side: 'sell', qty: 101 })).includes('short'));
  assert.ok(codes(rc({ qty: 600 })).includes('cash'));
  assert.ok(codes(rc({ qty: 60 })).includes('position'));                     // 15 % + 6 % > 20 %
  assert.ok(codes(rc({ qty: 30 }, { book: book({ positions: { BBB: { qty: 1, sector: 'Tech', valueUSD: 39000 } } }) })).includes('concentration'));
  assert.ok(codes(rc({ qty: 60000 }, { book: book({ cashUSD: 1e9, equityUSD: 1e9 }) })).includes('liquidity'));
  assert.ok(codes(rc({}, { snap: { last: 100, open: true, ageMin: 45, advShares: 1e6, fxUSD: 1 } })).includes('stale'));
  assert.ok(codes(rc({ refPrice: 90 })).includes('price_moved'));
  assert.ok(codes(rc({ type: 'limit', limit: 130 })).includes('price_band'));
  assert.ok(codes(rc({}, { book: book({ equityUSD: 94000 }) })).includes('kill_switch'));
  assert.ok(codes(rc({}, { brokerHealthy: false })).includes('broker'));
});
test('risk controls warn (not block) for delayed data, a closed market and moderate liquidity', () => {
  const r = rc({ qty: 20 }, { snap: { last: 100, open: false, ageMin: 600, advShares: 1500, sector: 'Tech', fxUSD: 1, kind: 'delayed' } });
  assert.deepEqual(r.warnings.map(w => w.code).sort(), ['closed', 'delayed', 'liquidity']); assert.ok(!codes(r).includes('stale'));
  assert.equal(rc({}).ok, true);
});
test('duplicate submissions and order floods are blocked', () => {
  assert.ok(codes(rc({ clientId: 'x1' }, { recent: [{ clientId: 'x1', submittedAt: T0 - 100 }] })).includes('duplicate'));
  assert.ok(codes(rc({}, { recent: [{ sym: 'AAA', side: 'buy', qty: 10, type: 'market', submittedAt: T0 - 3000 }] })).includes('duplicate'));
  assert.ok(codes(rc({}, { recent: Array.from({ length: 10 }, (_, i) => ({ sym: 'Z' + i, side: 'buy', qty: i + 1, type: 'limit', submittedAt: T0 - 1000 * i })) })).includes('rate'));
});

// ---------- order manager, end to end ----------
const NOW = Date.now();
function stubWorld() {
  const quotes = new Map([['AAA', { price: 100, time: NOW - 60e3, state: 'REGULAR', currency: 'USD' }]]);   // a fresh quote, 1 minute old
  const d = { sym: 'AAA', label: 'Aaa Co', sector: 'Tech', region: 'US', listing: { ccy: 'USD' }, nativePrice: 100, fresh: { priceTime: NOW - 60e3 }, liquidity: { spreadEst: 0.001, sigmaDaily: 0.02, advShares: 5e7 } };
  const research = { state: { dossiers: new Map([['AAA', d]]), fx: {} } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-'));
  const oms = require('../src/oms').create({ dataDir: dir, research, quotes: () => quotes, broker: require('../src/brokers').paper() });
  return { oms, quotes, dir };
}
test('order manager: accepted order fills on a later quote; cash, position, fees and audit log are updated', async () => {
  const { oms, quotes, dir } = stubWorld();
  const o = oms.submit({ sym: 'AAA', side: 'buy', type: 'market', qty: 100 });
  assert.equal(o.status, 'working');
  await oms.tick(); assert.equal(oms.view().orders[0].filled, 0);              // same quote as at submission: no fill
  quotes.set('AAA', { price: 101, time: Date.now() + 60e3, state: 'REGULAR', currency: 'USD' });
  await oms.tick();
  const v = oms.view(), f = v.fills[0];
  assert.equal(v.orders[0].status, 'filled'); assert.equal(v.positions.AAA.qty, 100);
  close(v.cashUSD, 100000 - 100 * f.priceUSD - f.feeUSD); assert.ok(f.price > 101);
  const audit = fs.readFileSync(path.join(dir, 'equity-audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(audit.map(a => a.event), ['accepted', 'fill']);
  assert.deepEqual(oms.holdings().weights, { AAA: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});
test('order manager: rejected orders are recorded with reasons; working orders can be cancelled; day orders expire', async () => {
  const { oms, quotes, dir } = stubWorld();
  const bad = oms.submit({ sym: 'AAA', side: 'sell', type: 'market', qty: 5 }); assert.equal(bad.status, 'rejected'); assert.match(bad.reason, /short selling is disabled/);
  const lim = oms.submit({ sym: 'AAA', side: 'buy', type: 'limit', limit: 95, qty: 10 }); assert.equal(oms.cancel(lim.id).status, 'cancelled'); assert.ok(oms.cancel(lim.id).error);
  const day = oms.submit({ sym: 'AAA', side: 'buy', type: 'limit', limit: 95, qty: 11 });
  quotes.set('AAA', { price: 100, time: NOW + 86400e3, state: 'REGULAR', currency: 'USD' }); await oms.tick();   // next session
  assert.equal(oms.view().orders.find(x => x.id === day.id).status, 'expired');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- brokers and auth ----------
test('live trading is disabled: no live adapter, and the Alpaca adapter refuses anything but its paper endpoint', () => {
  const B = require('../src/brokers');
  assert.equal(B.LIVE_TRADING_ENABLED, false); assert.equal(B.paper().live, false);
  assert.throws(() => B.alpacaPaper({}, 'https://api.alpaca.markets'), /only the Alpaca paper endpoint/);
  const a = B.alpacaPaper({}); assert.equal(a.live, false); assert.equal(a.configured, false);
});
test('write protection: loopback or the right token is allowed; anything else is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-')), A = require('../src/auth').create(dir), tok = A.token();
  assert.match(tok, /^[a-f0-9]{32}$/); assert.equal(require('../src/auth').create(dir).token(), tok);   // persisted
  const req = (addr, t) => ({ socket: { remoteAddress: addr }, headers: t ? { 'x-auth-token': t } : {} });
  assert.equal(A.allowed(req('127.0.0.1')), true); assert.equal(A.allowed(req('::ffff:127.0.0.1')), true);
  assert.equal(A.allowed(req('192.168.43.2')), false); assert.equal(A.allowed(req('192.168.43.2', 'nope')), false); assert.equal(A.allowed(req('192.168.43.2', tok)), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('.env loader reads KEY=VALUE without overriding existing variables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-')), f = path.join(dir, '.env');
  fs.writeFileSync(f, '# comment\nQD_TEST_A=one\nQD_TEST_B="two words"\nPATH=hacked\n');
  require('../src/auth').loadEnv(f); assert.equal(process.env.QD_TEST_A, 'one'); assert.equal(process.env.QD_TEST_B, 'two words'); assert.notEqual(process.env.PATH, 'hacked');
  fs.rmSync(dir, { recursive: true, force: true });
});
test('market state comes from the exchange trading periods (regular, pre, post, closed)', () => {
  const tp = { pre: { start: 1000, end: 2000 }, regular: { start: 2000, end: 5000 }, post: { start: 5000, end: 6000 } };
  assert.equal(E.session(tp, 2500e3).state, 'REGULAR'); assert.equal(E.session(tp, 1500e3).state, 'PRE'); assert.equal(E.session(tp, 5500e3).state, 'POST');
  assert.equal(E.session(tp, 7000e3).state, 'CLOSED'); assert.equal(E.session(null).state, 'unknown'); assert.equal(E.session(tp, 2500e3).sessionEnd, 5e6);
});
