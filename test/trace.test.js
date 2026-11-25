// Part 09 traceability and failure tests. Uses the recorded real snapshot (test/fixtures). Checks that the figures the
// interface shows can be recomputed from the underlying inputs the API also exposes, and that a failing data source
// degrades to a flagged stale cache instead of fabricated values.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const V = require('../lib/valuation'), E = require('../lib/encodings');
const { SNAP } = require('./helpers/dom');
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const companies = Object.entries(SNAP).filter(([k]) => k.startsWith('/api/research/company')).map(([, v]) => v);

test('valuation range and premium trace back to the individual models', () => {
  for (const d of companies) {
    const syn = d.valuation.synthesis, again = V.synthesize(d.valuation.models, d.price, { isFinancial: d.isFinancial, fund: d.fund });
    assert.equal(again.primary, syn.primary, d.sym);
    if (syn.primary) { close(again.base, syn.base); close(again.low, syn.low); close(again.high, syn.high); close(syn.premium, d.price / syn.base - 1); }
    if (syn.status !== again.status) assert.match((syn.notes || []).join(' '), /withheld/, `${d.sym}: status differs only when the share-count guard withholds it`);
  }
});
test('DCF base value recomputes from the stated assumptions', () => {
  for (const d of companies) {
    const m = d.valuation.models.find(x => x.id === 'dcf'); if (!m?.applicable) continue;
    close(V.dcfValue(d.valuation.assumptions).perShare, m.base, 1e-9);
  }
});
test('each displayed score is the rounded weighted mean of its listed components', () => {
  for (const d of companies) for (const k of ['opportunity', 'risk', 'confidence']) {
    const s = d.decision[k], parts = s.parts.filter(p => Number.isFinite(p.score)), W = parts.reduce((a, p) => a + p.weight, 0);
    if (s.score == null) { assert.ok(s.withheld || !parts.length, `${d.sym} ${k} null without reason`); continue; }
    assert.equal(s.score, Math.round(parts.reduce((a, p) => a + p.score * p.weight, 0) / W / 5) * 5, `${d.sym} ${k}`);
  }
});
test('the map summary, tooltip value and company record agree', () => {
  const u = SNAP['/api/research/universe'];
  for (const d of companies) {
    const s = u.stocks.find(x => x.sym === d.sym); assert.ok(s, d.sym);
    close(s.price, d.price); assert.equal(s.scores.opportunity, d.decision.opportunity.score); assert.equal(s.valuation.status, d.valuation.synthesis.status);
    if (Number.isFinite(s.valuation.premium)) assert.equal(E.tile(s, { color: 'prem' }).valueText, E.COLOR.prem.fmt(d.valuation.synthesis.premium));
    assert.ok(d.fresh.priceTime && d.fresh.priceKind, `${d.sym} price carries time and kind`);
  }
});
test('a failing source serves the stale cache, flagged; with no cache it fails loudly after 3 attempts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fail-')); fs.mkdirSync(path.join(dir, 'research'));
  const f = path.join(dir, 'research', 'px-XYZ-1d.json'); fs.writeFileSync(f, JSON.stringify({ fetched: 1, currency: 'USD', bars: [{ t: 1, c: 1 }], div: [], splits: [] }));
  const old = new Date(Date.now() - 30 * 864e5); fs.utimesSync(f, old, old);
  let calls = 0; const providers = { tracked: async () => { calls++; throw Object.assign(new Error('connect timeout'), { cause: { code: 'ETIMEDOUT' } }); } };
  const RS = require('../src/research').create({ dataDir: dir, quotes: () => new Map(), providers });
  const v = await RS.yahoo('XYZ', '1d', '5y', 1000);
  assert.equal(v.bars.length, 1); assert.match(v._stale, /ETIMEDOUT/); assert.equal(calls, 3);
  calls = 0; await assert.rejects(RS.yahoo('NOPE', '1d', '5y', 1000), /3 attempts/); assert.equal(calls, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});
