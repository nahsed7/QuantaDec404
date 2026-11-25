// Part 08 tests: provider registry and health tracking (with a failing API), disk retention, prospective log.
// SYNTHETIC files and stubbed network only.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('provider health: successes, HTTP errors and network failures are recorded per provider', async () => {
  const PV = require('../src/providers').create(), real = global.fetch;
  try {
    global.fetch = async url => { if (/fail/.test(url)) throw Object.assign(new Error('boom'), { cause: { code: 'ETIMEDOUT' } }); return { ok: !/500/.test(url), status: /500/.test(url) ? 500 : 200 }; };
    await PV.tracked('https://query1.finance.yahoo.com/ok');
    await PV.tracked('https://query1.finance.yahoo.com/500');
    await assert.rejects(PV.tracked('https://data.sec.gov/fail'));
    const st = Object.fromEntries(PV.status().map(p => [p.id, p]));
    assert.equal(st.yahoo.ok, 1); assert.equal(st.yahoo.fail, 1); assert.equal(st.yahoo.state, 'failing'); assert.match(st.yahoo.lastError, /500/);
    assert.equal(st.sec.fail, 1); assert.match(st.sec.lastError, /ETIMEDOUT/);
    assert.equal(st.treasury.state, 'idle'); assert.equal(st.stooq.state, 'not used');
    for (const p of PV.status()) assert.ok(p.licence && p.data && p.kinds.length, p.id);
  } finally { global.fetch = real; }
});
test('providers needing keys report "needs key" until configured; keys are never part of the status', () => {
  const saved = process.env.FINNHUB_KEY; delete process.env.FINNHUB_KEY;
  try {
    const PV = require('../src/providers').create(); assert.equal(PV.status().find(p => p.id === 'finnhub').state, 'needs key');
    process.env.FINNHUB_KEY = 'secret-value-123'; const s = PV.status().find(p => p.id === 'finnhub');
    assert.equal(s.configured, true); assert.ok(!JSON.stringify(PV.status()).includes('secret-value-123'));
  } finally { if (saved == null) delete process.env.FINNHUB_KEY; else process.env.FINNHUB_KEY = saved; }
});
test('retention compacts only market recordings, never logs; corrupt lines dropped', () => {
  const dir = tmp('ret-'), now = Date.UTC(2026, 10, 25), old = now - 40 * 864e5, recent = now - 5 * 864e5;
  fs.writeFileSync(path.join(dir, 'fx-EURUSD.jsonl'), [JSON.stringify({ t: old, c: 1 }), JSON.stringify({ t: recent, c: 2 }), 'not json'].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'BTCUSDT.jsonl'), JSON.stringify({ t: recent, mid: 1 }) + '\n');
  const log = [JSON.stringify({ at: old, rev: 1 })].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'account-log.jsonl'), log); fs.writeFileSync(path.join(dir, 'equity-audit.jsonl'), JSON.stringify({ t: '2020-01-01' }) + '\n');
  const r = require('../src/retention').compact(dir, { days: 30, now });
  assert.equal(fs.readFileSync(path.join(dir, 'fx-EURUSD.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'account-log.jsonl'), 'utf8'), log);
  assert.equal(r.files.find(f => f.file === 'fx-EURUSD.jsonl').dropped, 2); assert.ok(!r.files.some(f => f.file === 'account-log.jsonl'));
  const u = require('../src/retention').usage(dir); assert.ok(u.groups['market recordings'] > 0 && u.groups.logs > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('prospective log: one record per company per day; outcomes appear only after the horizon', () => {
  const dir = tmp('mon-'); fs.mkdirSync(path.join(dir, 'research'));
  const DAY = 864e5, now = Date.now();
  const bars = [{ t: now - 100 * DAY, c: 100 }, { t: now - 60 * DAY, c: 110 }, { t: now - 1 * DAY, c: 120 }];
  const d = { sym: 'AAA', region: 'US', nativePrice: 100, listing: { ccy: 'USD' }, bars, valuation: { synthesis: { status: 'below', premium: -0.3 } }, decision: { opportunity: { score: 70 } } };
  const research = { state: { dossiers: new Map([['AAA', d]]) }, UNIVERSE: [] };
  // A record written 100 days ago at price 100 (as if logged then).
  fs.writeFileSync(path.join(dir, 'research', 'prospective.jsonl'), JSON.stringify({ date: new Date(now - 100 * DAY).toISOString().slice(0, 10), sym: 'AAA', status: 'below', price: 100, opp: 70 }) + '\n');
  const M = require('../src/monitor').create({ dataDir: dir, research, validation: {}, oms: {}, providers: {} });
  assert.equal(M.logToday(), 1); assert.equal(M.logToday(), 0);                  // second call the same day writes nothing
  const p = M.prospective(), m1 = p.horizons[0], m3 = p.horizons[1];
  assert.equal(m1.byStatus[0].status, 'below'); assert.ok(Math.abs(m1.byStatus[0].mean - 0.10) < 1e-9);   // first bar ≥ 30 days later: 110
  assert.equal(m3.observations, 0 + m3.byStatus.reduce((s, g) => s + g.n, 0)); assert.ok(m1.observations >= 1);
  assert.equal(p.days, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
