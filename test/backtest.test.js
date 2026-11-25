// Part 05 tests: historical validation engine. Leakage (look-ahead) checks, exact portfolio accounting, costs,
// metrics on known series, chronological selection, walk-forward, reproducibility, deflated Sharpe, regimes.
// All panels below are SYNTHETIC test fixtures generated from a seeded RNG; none is market data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stats'), B = require('../lib/backtest');
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

const MONTHS = 72, T0 = Date.UTC(2018, 0, 15);
const mt = i => Date.UTC(2018, i, 15);
function synth(seed = 1, nStocks = 20, tweak) {
  const u = S.rng(seed), stocks = [];
  for (let k = 0; k < nStocks; k++) {
    let p = 50 + 10 * u(); const drift = 0.004 * (u() - 0.3), monthly = [];
    for (let i = 0; i < MONTHS; i++) { p *= 1 + drift + 0.06 * (u() - 0.5); monthly.push({ t: mt(i), c: p, tr: p }); }
    const eps = []; for (let y = 2017; y <= 2023; y++) eps.push({ end: `${y}-12-31`, filed: Date.UTC(y + 1, 1, 20), eps: 2 + u() });
    stocks.push({ sym: 'S' + String(k).padStart(2, '0'), monthly, eps });
  }
  let b = 100; const bench = []; for (let i = 0; i < MONTHS; i++) { b *= 1.006 + 0.04 * (u() - 0.5); bench.push({ t: mt(i), tr: b }); }
  const rf = Array.from({ length: MONTHS }, (_, i) => ({ t: mt(i), y: 0.02 }));
  if (tweak) tweak(stocks, bench);
  return B.panel(stocks, bench, rf);
}
void T0;

// ---------- look-ahead ----------
test('signals formed at month m do not change when any data after m changes', () => {
  const m = 40, base = synth(3), shocked = synth(3, 20, (st, bench) => { for (const s of st) for (let i = m + 1; i < MONTHS; i++) { s.monthly[i].c *= 3; s.monthly[i].tr *= 3; } for (let i = m + 1; i < MONTHS; i++) bench[i].tr *= 0.2; });
  for (const [sig, p] of [['momentum', { lookback: 12 }], ['value', {}], ['lowvol', { window: 12 }], ['combo', { lookback: 12, wValue: 0.5 }]]) {
    const a = B.scoresAt(base, sig, m, p), b = B.scoresAt(shocked, sig, m, p);
    assert.deepEqual([...a.entries()], [...b.entries()], sig);
  }
  assert.deepEqual(B.regimes(base).slice(0, m + 1), B.regimes(shocked).slice(0, m + 1));
});
test('EPS is used only after its filing date (point-in-time)', () => {
  const pn = synth(4), s = pn.syms[0];
  const mJan = pn.months.indexOf('2021-01'), mMar = pn.months.indexOf('2021-03');
  const e2019 = pn.eps[s].find(x => x.end === '2019-12-31').eps, e2020 = pn.eps[s].find(x => x.end === '2020-12-31').eps;
  assert.equal(B.epsAt(pn, s, mJan), e2019);                // FY2020 is filed 2021-02-20: not yet known in January
  assert.equal(B.epsAt(pn, s, mMar), e2020);
});
test('a restated EPS version is visible only from its own filing date', () => {
  const pn = synth(5, 20, st => { st[0].eps.push({ end: '2019-12-31', filed: Date.UTC(2020, 6, 1), eps: 99 }); });
  const s = pn.syms[0];
  assert.notEqual(B.epsAt(pn, s, pn.months.indexOf('2020-05')), 99);
  assert.equal(B.epsAt(pn, s, pn.months.indexOf('2020-08')), 99);
  assert.notEqual(B.epsAt(pn, s, pn.months.indexOf('2021-03')), 99);   // superseded by the FY2020 report filed 2021-02-20
});
test('eligibility does not depend on future prices; a holding with no next price exits flat and is counted', () => {
  const pn = synth(6, 20, st => { for (let i = 30; i < MONTHS; i++) { st[0].monthly[i].c = NaN; st[0].monthly[i].tr = NaN; } });
  const rows = B.simulate(pn, { kind: 'ew', every: 1 }, 29, 30);
  assert.equal(rows[0].names, 20); assert.equal(rows[0].missing, 1);
  const next = B.simulate(pn, { kind: 'ew', every: 1 }, 30, 31); assert.equal(next[0].names, 19);
});

// ---------- accounting ----------
test('portfolio return, drift and costs are exact on a two-stock example', () => {
  const stocks = [{ sym: 'A', monthly: [100, 110, 121].map((c, i) => ({ t: mt(i), c, tr: c })), eps: [] }, { sym: 'B', monthly: [100, 90, 99].map((c, i) => ({ t: mt(i), c, tr: c })), eps: [] }];
  const pn = B.panel(stocks, [], []);
  const rows = B.simulate(pn, { kind: 'ew', every: 12, costBps: 10 }, 0, 2);          // buy once, then drift
  close(rows[0].traded, 1); close(rows[0].cost, 0.001); close(rows[0].gross, 0.5 * 0.1 + 0.5 * -0.1); close(rows[0].net, -0.001);
  // After month 1 the weights drifted to 110/200 and 90/200; month 2 returns are +10 % and +10 %.
  close(rows[1].gross, 0.1); close(rows[1].traded, 0);
  const rb = B.simulate(pn, { kind: 'ew', every: 1, costBps: 10 }, 0, 2);            // monthly rebalancing trades back to 50/50
  close(rb[1].traded, Math.abs(0.5 - 110 / 200) + Math.abs(0.5 - 90 / 200));
});
test('metrics on known series: CAGR, drawdown, Sharpe, profit factor, win rate', () => {
  const pn = synth(7), rows = Array.from({ length: 24 }, (_, i) => ({ m: i, month: pn.months[i], net: i === 5 ? -0.1 : 0.02, traded: 0.2, cost: 0.0002, names: 10, exposure: 1 }));
  const m = B.metrics(rows, pn), r = rows.map(x => x.net);
  close(m.total, r.reduce((a, x) => a * (1 + x), 1) - 1); close(m.cagr, Math.pow(1 + m.total, 12 / 24) - 1);
  close(m.maxDrawdown, 0.1); close(m.profitFactor, (23 * 0.02) / 0.1); close(m.turnover, 0.1 * 12);
  const ex = r.map(x => x - 0.02 / 12); close(m.sharpe, S.mean(ex) / S.std(ex) * Math.sqrt(12));
  const bench = rows.map(x => ({ ...x, net: 0.01 })); close(B.metrics(rows, pn, bench).winRate, 23 / 24);
});

// ---------- selection discipline ----------
test('parameters are chosen on the training segment only: changing test-period data does not change the choice', () => {
  const opts = { signal: 'momentum', n: [5, 8], every: [1, 3], randomDraws: 20 };
  const a = B.validate(synth(8), opts);
  const cut = Math.round(13 + (MONTHS - 1 - 13) * 0.8) + 1;
  const b = B.validate(synth(8, 20, (st, bench) => { for (const s of st) for (let i = cut; i < MONTHS; i++) { s.monthly[i].c *= 0.5; s.monthly[i].tr *= 0.5; } }), opts);
  assert.deepEqual(a.chosen, b.chosen);
  assert.deepEqual(a.inSample.sharpe, b.inSample.sharpe);
  assert.notEqual(a.test.total, b.test.total);
});
test('segments are chronological and do not overlap; every result carries its category', () => {
  const r = B.validate(synth(9), { signal: 'value', n: [5], every: [1], randomDraws: 10 });
  const s = r.segments; assert.ok(s.train.to < s.validation.from && s.validation.to < s.test.from);
  assert.equal(s.train.months + s.validation.months + s.test.months, MONTHS - 1 - 13);
  assert.match(r.inSample.category, /in-sample/); assert.match(r.validation.category, /validation/); assert.match(r.test.category, /out-of-sample/);
  assert.match(r.walkForward.category, /walk-forward/);
});
test('walk-forward: each window\'s choice uses only the trailing window', () => {
  const opts = { signal: 'momentum', n: [5, 8], every: [1], randomDraws: 5, wfWindow: 24, wfStep: 12 };
  const a = B.validate(synth(10), opts), firstTo = 13 + 24 + 12;           // data after the first window's end
  const b = B.validate(synth(10, 20, st => { for (const s of st) for (let i = firstTo; i < MONTHS; i++) { s.monthly[i].c *= 1.5 + (s.sym.charCodeAt(2) % 3); s.monthly[i].tr = s.monthly[i].c; } }), opts);
  assert.deepEqual(a.walkForward.schedule[0], b.walkForward.schedule[0]);
});
test('random baselines are reproducible with the same seed', () => {
  const pn = synth(11), r1 = B.simulate(pn, { kind: 'random', n: 5, every: 1, seed: 42 }, 13, 40), r2 = B.simulate(pn, { kind: 'random', n: 5, every: 1, seed: 42 }, 13, 40);
  assert.deepEqual(r1.map(x => x.net), r2.map(x => x.net));
  const r3 = B.simulate(pn, { kind: 'random', n: 5, every: 1, seed: 43 }, 13, 40); assert.notDeepEqual(r1.map(x => x.net), r3.map(x => x.net));
});

// ---------- overfitting statistics ----------
test('deflated Sharpe falls as more configurations are tried, and rises with the Sharpe ratio', () => {
  const trials = n => Array.from({ length: n }, (_, i) => 0.05 + 0.1 * Math.sin(i));
  const few = B.deflatedSharpe(0.3, 60, 0, 0, trials(3)).dsr, many = B.deflatedSharpe(0.3, 60, 0, 0, trials(50)).dsr;
  assert.ok(many < few, `${many} < ${few}`);
  assert.ok(B.deflatedSharpe(0.4, 60, 0, 0, trials(20)).dsr > B.deflatedSharpe(0.2, 60, 0, 0, trials(20)).dsr);
  assert.equal(B.deflatedSharpe(0.3, 60, 0, 0, [0.1]), null);
});
test('baselines report the survivorship gap as equal-weight universe minus benchmark CAGR', () => {
  const b = B.baselines(synth(12));
  close(b.survivorshipGap, b.equalWeight.cagr - b.benchmark.cagr); assert.match(b.category, /descriptive/);
});
