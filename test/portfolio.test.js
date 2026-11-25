// Part 06 tests: portfolio engine. Covariance shrinkage, risk decomposition, allocation methods, exposures,
// liquidity, stress scenarios, opportunity cost and portfolio storage. SYNTHETIC fixtures only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const S = require('../lib/stats'), P = require('../lib/portfolio');
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

const diag = v => v.map((x, i) => v.map((_, j) => i === j ? x : 0));
function sim(T, sig, rho, seed = 1) {                                            // T periods of N correlated normal returns
  const u = S.rng(seed), N = sig.length, z = () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u());
  return Array.from({ length: T }, () => { const f = z(); return sig.map(s => s * (Math.sqrt(rho) * f + Math.sqrt(1 - rho) * z())); });
}

test('Ledoit–Wolf: symmetric, shrinkage in [0, 1], more shrinkage with fewer observations', () => {
  const few = P.covariance(sim(40, [0.02, 0.03, 0.025, 0.04, 0.02, 0.03], 0.3)), many = P.covariance(sim(4000, [0.02, 0.03, 0.025, 0.04, 0.02, 0.03], 0.3));
  for (const c of [few, many]) { assert.ok(c.shrinkage >= 0 && c.shrinkage <= 1); for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) close(c.cov[i][j], c.cov[j][i]); }
  assert.ok(few.shrinkage > many.shrinkage, `${few.shrinkage} > ${many.shrinkage}`);
  assert.equal(P.covariance(sim(10, [0.01, 0.01], 0)), null);                   // too few observations: refuse
});
test('risk decomposition: contributions sum to 1; equal uncorrelated assets give N effective bets', () => {
  const C = diag([0.0004, 0.0004, 0.0004, 0.0004]), r = P.risk(C, [0.25, 0.25, 0.25, 0.25], ['a', 'b', 'c', 'd'], 52);
  close(S.sum(r.contributions.map(c => c.pctRisk)), 1); close(r.effectiveBets, 4); close(r.effectiveHoldings, 4); close(r.diversificationRatio, 2);
  close(r.vol, Math.sqrt(0.25 * 0.0004 * 52));
});
test('minimum variance: two uncorrelated assets get w₁ = σ₂²/(σ₁² + σ₂²); the weight cap is respected', () => {
  const w = P.minVariance(diag([0.0001, 0.0004]), 1); close(w[0], 0.0004 / 0.0005, 1e-4);
  const wc = P.minVariance(diag([0.0001, 0.0004, 0.0009]), 0.5); assert.ok(Math.max(...wc) <= 0.5 + 1e-9); close(S.sum(wc), 1, 1e-9);
});
test('risk parity equalises risk contributions; inverse volatility is ∝ 1/σ', () => {
  const C = [[0.0004, 0.0001, 0], [0.0001, 0.0009, 0.0002], [0, 0.0002, 0.0016]], w = P.riskParity(C), r = P.risk(C, w, ['a', 'b', 'c']);
  for (const c of r.contributions) close(c.pctRisk, 1 / 3, 1e-6);
  const iv = P.inverseVol(diag([0.0001, 0.0004])); close(iv[0] / iv[1], 2);
});
test('capped-simplex projection: non-negative, at most the cap, sums to 1', () => {
  for (const v of [[0.9, 0.05, 0.05], [-1, 2, 0.3, 0.1], [0.2, 0.2, 0.2, 0.2, 0.2]]) { const w = P.projectCappedSimplex(v, 0.4); close(S.sum(w), 1, 1e-9); for (const x of w) assert.ok(x >= -1e-12 && x <= 0.4 + 1e-9); }
});
const assets = [{ sym: 'a', sector: 'Tech', region: 'US', ccy: 'USD', beta: 1.2, addv: 1e8, spread: 0.001, sigmaDaily: 0.02, rateShock: -0.1 },
  { sym: 'b', sector: 'Tech', region: 'International', ccy: 'EUR', beta: 0.8, addv: 5e7, spread: 0.002, sigmaDaily: 0.015, rateShock: -0.05 },
  { sym: 'c', sector: 'Energy', region: 'US', ccy: 'USD', beta: null, addv: 2e7, spread: null, sigmaDaily: 0.025, rateShock: null }];
const w = [0.5, 0.3, 0.2], C3 = [[0.0004, 0.0001, 0.00005], [0.0001, 0.0003, 0.00002], [0.00005, 0.00002, 0.0006]];
test('exposures and liquidity: sector weights, Herfindahl, days to exit at 10 % of daily value', () => {
  const e = P.exposure(assets, w, 'sector'); assert.deepEqual(e.rows.map(r => [r.group, +r.weight.toFixed(6)]), [['Tech', 0.8], ['Energy', 0.2]]); close(e.hhi, 0.68);
  const l = P.liquidity(assets, w, 1e6); close(l[0].daysToExit, 5e5 / 1e7); close(l[2].daysToExit, 2e5 / 2e6);
  close(l[0].costBp, 1e4 * (0.0005 + 0.02 * Math.sqrt(5e5 / 1e8)));
});
test('stress scenarios: market decline uses β (1 if unmeasured); vol doubling doubles vol; correlation stress raises vol', () => {
  const sc = P.scenarios(assets, w, C3, ['a', 'b', 'c'], 1e6, { ppy: 52 }), by = n => sc.find(s => s.name.startsWith(n));
  close(by('Market-wide').impact, -0.2 * (0.5 * 1.2 + 0.3 * 0.8 + 0.2 * 1));
  close(by('Tech sector').impact, -0.25 * 0.8);
  const v = by('Volatility doubles'); close(v.impact, 2 * v.before);
  const c = by('Correlations'); assert.ok(c.impact > c.before);
  const r = by('Interest rates'); close(r.impact, (0.5 * -0.1 + 0.3 * -0.05) / 0.8); close(r.coverage, 2 / 3);
  const lq = by('Liquidity'); assert.ok(lq.impact > lq.before && lq.daysAfter > lq.daysBefore);
});
test('opportunity cost: an uncorrelated low-volatility candidate lowers portfolio volatility; hurdle = round trip ÷ years', () => {
  const C = [[0.0009, 0.0006, 0], [0.0006, 0.0009, 0], [0, 0, 0.0001]], as = [{ sym: 'h1', sector: 'Tech', addv: 1e9, spread: 0.001, sigmaDaily: 0.01 }, { sym: 'h2', sector: 'Tech', addv: 1e9, spread: 0.001, sigmaDaily: 0.01 }, { sym: 'c', sector: 'Utilities', addv: 1e9, spread: 0.002, sigmaDaily: 0.005, yield: 0.06 }];
  const [o] = P.opportunityCost(['c'], { h1: 0.5, h2: 0.5 }, { C, idx: { h1: 0, h2: 1, c: 2 }, assets: as, capital: 1e6, holdYears: 2, rf: 0.04, add: 0.05 });
  assert.ok(o.marginalVol < 0); close(o.corrWithHoldings, 0); close(o.hurdle, o.roundTripCost / 2); close(o.yieldVsRiskFree, 0.02); close(o.sectorWeightAfter, 0.05);
});
test('valuation tilt: lower premium to value gets more weight; capped', () => {
  const t = P.valuationTilt([{ premium: -0.3 }, { premium: 0 }, { premium: 0.5 }], 0.5, 0.6);
  assert.ok(t[0] > t[1] && t[1] > t[2]); close(S.sum(t), 1, 1e-9);
});
test('portfolio storage: unknown symbols dropped, weights normalised, revision conflicts refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-')), PF = require('../src/portfolio').create({ dataDir: dir, research: { UNIVERSE: [{ sym: 'AAA' }, { sym: 'BBB' }], state: {} } });
  const s1 = PF.save({ portfolios: [{ id: 'p1', name: 'T', capital: 5e4, weights: { AAA: 3, BBB: 1, ZZZ: 5 } }], current: 'p1' }, 0);
  assert.deepEqual(s1.portfolios[0].weights, { AAA: 0.75, BBB: 0.25 }); assert.equal(s1.current, 'p1'); assert.equal(s1.rev, 1);
  assert.throws(() => PF.save({ portfolios: [] }, 0), /changed elsewhere/);
  assert.throws(() => PF.save({ portfolios: 'x' }, 1), /must be an array/);
  fs.rmSync(dir, { recursive: true, force: true });
});
