// Part 04 tests: decision engine. Percentile-rank semantics, evidence-capped weights, independence of the three
// scores, interpretation, traceability, score-level scenarios, catalysts and comparison.
// All dossiers below are SYNTHETIC fixtures; none is market data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/stats'), D = require('../lib/decision');

const u = S.rng(5);
const dossier = (i, over = {}) => ({ sym: 'X' + i, price: 100, rf: 0.04, eps: 4 + u(), fcf: 3e9 + 1e9 * u(), marketCap: 1e11, completeness: 0.9, isFinancial: false,
  valuation: { synthesis: { premium: -0.4 + 0.04 * i, primary: 'dcf', dispersion: 0.1 + 0.01 * i, agreement: 0.6, widthRatio: 1.3 + 0.02 * i, base: 100 / (0.6 + 0.04 * i) },
    models: [], assumptions: { growth: 0.03 + 0.002 * i, growthHist: 0.05 }, scenarios: [{ name: 'Revenue growth −3 pts', primaryChange: -0.2, primaryBase: 80 / (0.6 + 0.04 * i), status: 'within', statusChanged: false }] },
  fund: { revGrowth3: 0.05, roic: 0.05 + 0.01 * i, fcfMargin: 0.1, fscore: { score: 5, of: 9 }, opMarginStd: 0.01, debtToEbitda: 1 + 0.1 * i, interestCover: 10, currentRatio: 1.5 },
  momentum: { mom12_1: -0.1 + 0.02 * i, relSector63: 0.01 * (i - 10) }, volatility: { hv252: 0.15 + 0.01 * i, maxDrawdown1y: 0.1 + 0.01 * i, currentDrawdown: 0.05, beta: 1, betaVs: 'Index' },
  liquidity: { addv: 1e9 / (1 + i) }, epsYoY: 0.1, fresh: { filingAgeDays: 60, priceAgeMin: 10 }, dataNotes: [], ...over });
const ds = Array.from({ length: 20 }, (_, i) => dossier(i)), U = D.universe(ds);
const comp = (score, key) => score.parts.find(p => p.key === key);

test('components are universe percentile ranks: cheaper ranks higher on valuation, more volatile ranks higher on risk', () => {
  const cheap = D.assess(ds[0], { universe: U }), dear = D.assess(ds[19], { universe: U });
  assert.ok(comp(cheap.opportunity, 'valuation').score > 90 && comp(dear.opportunity, 'valuation').score < 10);
  assert.ok(comp(dear.risk, 'volatility').score > comp(cheap.risk, 'volatility').score);
  assert.ok(comp(dear.risk, 'valuationRisk').score > comp(cheap.risk, 'valuationRisk').score);
});
test('evidence multipliers only cap weights: supported 1, mixed 0.75, weak 0.5, untested 1', () => {
  assert.deepEqual(D.evidenceMultiplier({ walkForwardExcess: 0.03, randomPercentileTest: 0.9 }), { k: 1, status: 'supported' });
  assert.deepEqual(D.evidenceMultiplier({ walkForwardExcess: 0.03, randomPercentileTest: 0.6 }), { k: 0.75, status: 'mixed' });
  assert.deepEqual(D.evidenceMultiplier({ walkForwardExcess: 0.001, randomPercentileTest: 0.9 }), { k: 0.5, status: 'weak' });
  assert.deepEqual(D.evidenceMultiplier({ walkForwardExcess: 0.03, randomPercentileTest: 0.3 }), { k: 0.5, status: 'weak' });
  assert.deepEqual(D.evidenceMultiplier(null), { k: 1, status: 'untested' });
  for (const wf of [-0.1, 0, 0.01, 0.2]) for (const p of [0, 0.4, 0.8, 1]) assert.ok(D.evidenceMultiplier({ walkForwardExcess: wf, randomPercentileTest: p }).k <= 1);
});
test('weak out-of-sample evidence halves the momentum and relative-performance weights, and is listed as contradicting', () => {
  const ev = { momentum: { label: 'Momentum', walkForwardExcess: 0, randomPercentileTest: 0.2, testSharpe: 0.1 } };
  const a = D.assess(ds[10], { universe: U, evidence: ev });
  assert.equal(comp(a.opportunity, 'momentum').weight, 0.5 * D.PRIORS.opportunity.momentum[0]);
  assert.equal(comp(a.opportunity, 'relative').weight, 0.5 * D.PRIORS.opportunity.relative[0]);
  assert.equal(comp(a.opportunity, 'valuation').weight, D.PRIORS.opportunity.valuation[0]);      // untested here → prior
  assert.ok(a.evidence.contradicting.some(x => /half weight/.test(x)));
});
test('the three scores are independent: confidence inputs do not move opportunity or risk', () => {
  const a = D.assess(ds[7], { universe: U }), b = D.assess({ ...ds[7], completeness: 0.3, fresh: { filingAgeDays: 500 }, sharesConflict: true, restated: { revised: 3, compared: 10 } }, { universe: U });
  assert.equal(a.opportunity.score, b.opportunity.score); assert.equal(a.risk.score, b.risk.score); assert.ok(b.confidence.score < a.confidence.score);
  for (const s of [a.opportunity.score, a.risk.score, a.confidence.score]) assert.equal(s % 5, 0);
});
test('interpretation of the brief\'s example (86 / 79 / 38): attractive but highly uncertain, not a recommendation', () => {
  const t = D.interpret({ score: 85 }, { score: 80 }, { score: 40 });
  assert.match(t, /Potentially attractive/); assert.match(t, /high risk/); assert.match(t, /low confidence/); assert.match(t, /not a recommendation/);
});
test('every component is traceable: raw value, calculation, source, prior weight and rationale', () => {
  const a = D.assess(ds[3], { universe: U });
  for (const sc of [a.opportunity, a.risk, a.confidence]) for (const p of sc.parts) {
    assert.ok(p.calc, `${p.name} calc`); assert.ok(p.source, `${p.name} source`); assert.ok(Number.isFinite(p.priorWeight), p.name); assert.ok('raw' in p, p.name); assert.ok(typeof p.weightRationale === 'string');
  }
});
test('scenario effects reach the scores: a lower primary value lowers opportunity and raises valuation risk', () => {
  const a = D.assess(ds[10], { universe: U }), s = a.scenarios[0];
  assert.ok(s.scoreChange.opportunity <= 0, JSON.stringify(s.scoreChange)); assert.ok(s.scoreChange.risk >= 0);
});
test('data quality: share-count conflicts and restatements lower it; no data means unknown, not perfect', () => {
  const q = d => comp(D.assess(d, { universe: U }).confidence, 'quality');
  assert.equal(q(ds[2]).score, 100);
  assert.equal(q({ ...ds[2], sharesConflict: true, restated: { revised: 2, compared: 8 } }).score, 100 - 35 - 10);
  assert.equal(q({ ...ds[2], completeness: 0 }).missing, true);
});
test('catalyst dates are estimated from filing cadence, in the future, and labelled as estimates', () => {
  const DAY = 864e5, now = Date.now(), q = [3, 2, 1, 0].map(k => { const end = new Date(now - (k * 91 + 50) * DAY).toISOString().slice(0, 10); return { end, filed: Date.parse(end) + 40 * DAY, eps: 1 }; });
  const c = D.catalysts({ qEPS: q, div: [0, 1, 2, 3].map(k => ({ t: now - (k * 91 + 30) * DAY, amount: 1 })).reverse() });
  const e = c.find(x => x.kind === 'earnings'), dv = c.find(x => x.kind === 'dividend');
  assert.ok(Date.parse(e.date) > now - DAY && /estimated/.test(e.text)); assert.ok(Date.parse(dv.date) > now - DAY && /estimated/.test(dv.text));
});
test('comparison reports correlation and never picks a winner', () => {
  const daily = Array.from({ length: 200 }, (_, i) => [Date.UTC(2024, 0, 1) + i * 864e5, 100 * Math.exp(0.01 * Math.sin(i) + 0.001 * i)]);
  const a = { ...ds[1], decision: D.assess(ds[1], { universe: U }), daily }, b = { ...ds[2], decision: D.assess(ds[2], { universe: U }), daily };
  const c = D.compare([a, b]);
  assert.ok(Math.abs(c.correlations[0].corr - 1) < 1e-9); assert.ok(c.notes.some(n => /diversifies little/.test(n)));
  assert.ok(c.notes.some(n => /No company is selected/.test(n))); assert.ok(!('winner' in c) && !('best' in c));
});
test('scores built on fewer than 3 measured components are withheld, not shown', () => {
  const thin = { sym: 'P', price: 10, completeness: 0.14, hasFilings: false, valuation: { synthesis: { status: 'insufficient' }, models: [] }, fund: {}, momentum: { mom12_1: 0.2, relSector63: 0.05 }, volatility: {}, liquidity: {}, fresh: {} };
  const a = D.assess(thin, { universe: U });
  assert.equal(a.opportunity.score, null); assert.match(a.opportunity.withheld, /Only 2 of 7/);
  assert.equal(a.risk.score, null); assert.match(a.interpretation, /Not assessable/);
});
