// Monitors (Part 08): data quality, model performance, macro context and company filings (announcements).
// The prospective log records, once a day, every company's valuation status and scores *before* outcomes are known,
// then measures what actually happened 1 and 3 months later: a genuinely out-of-sample record that grows over time.
'use strict';
const fs = require('fs'), path = require('path');
const S = require('../lib/stats'), D = require('../lib/decision'), RT = require('./retention');
const DAY = 864e5;

function create({ dataDir, research, validation, oms, providers }) {
  const dir = path.join(dataDir, 'research'), plog = path.join(dir, 'prospective.jsonl');
  const day = t => new Date(t).toISOString().slice(0, 10);
  const cache = new Map();
  async function cached(key, ttl, fn) { const c = cache.get(key); if (c && Date.now() - c.t < ttl) return c.v; try { const v = await fn(); cache.set(key, { t: Date.now(), v }); return v; } catch (e) { if (c) return { ...c.v, _stale: e.message }; throw e; } }

  // ---- prospective log ----
  let lastLogged = null;
  try { const tail = fs.readFileSync(plog, 'utf8').trim().split('\n').slice(-1)[0]; lastLogged = tail ? JSON.parse(tail).date : null; } catch {}
  function logToday() {
    const today = day(Date.now()); if (lastLogged === today) return 0;
    const rows = [...research.state.dossiers.values()].filter(d => S.fin(d.nativePrice)).map(d => ({ date: today, sym: d.sym, region: d.region, status: d.valuation?.synthesis?.status || 'insufficient',
      premium: d.valuation?.synthesis?.premium ?? null, opp: d.decision?.opportunity?.score ?? null, risk: d.decision?.risk?.score ?? null, conf: d.decision?.confidence?.score ?? null, price: d.nativePrice, ccy: d.listing.ccy }));
    if (!rows.length) return 0;
    fs.appendFileSync(plog, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); lastLogged = today; return rows.length;
  }
  function prospective() {
    let rows = []; try { rows = fs.readFileSync(plog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
    const R = research.state, out = { category: 'prospective (recorded before outcomes; out-of-sample)', started: rows[0]?.date || null, days: new Set(rows.map(r => r.date)).size, horizons: [] };
    for (const [h, name] of [[30, '1 month'], [91, '3 months']]) {
      const groups = {}, opp = [];
      for (const r of rows) {
        const d = R.dossiers.get(r.sym); if (!d) continue;
        const t1 = Date.parse(r.date) + h * DAY; if (t1 > Date.now()) continue;
        const b = d.bars.find(x => x.t >= t1); if (!b || !(r.price > 0)) continue;
        const fwd = b.c / r.price - 1; (groups[r.status] ||= []).push(fwd); if (S.fin(r.opp)) opp.push([r.opp, fwd]);
      }
      const all = Object.values(groups).flat(), med = S.median(all);
      out.horizons.push({ horizon: name, observations: all.length, byStatus: Object.entries(groups).map(([k, xs]) => ({ status: k, n: xs.length, mean: S.mean(xs), median: S.median(xs), beatMedian: xs.filter(x => x > med).length / xs.length })),
        opportunityIC: opp.length >= 20 ? S.spearman(opp.map(x => x[0]), opp.map(x => x[1])) : null,
        note: all.length ? 'Returns are price changes in the listing currency (no dividends); the dates overlap, so observations are not independent.' : `No ${name} outcomes yet: the first records mature ${rows[0] ? day(Date.parse(rows[0].date) + h * DAY) : 'after the first daily record'}.` });
    }
    return out;
  }

  // ---- data quality ----
  function dataQuality() {
    const R = research.state, ds = [...R.dossiers.values()], now = Date.now();
    const companies = ds.map(d => {
      const issues = [];
      if (d.hasFilings === false) issues.push('no financial statements (price only)');
      if (d.missingFields?.length) issues.push('missing: ' + d.missingFields.join(', '));
      if (S.fin(d.fresh?.filingAgeDays) && d.fresh.filingAgeDays > 450) issues.push(`latest filing ${Math.round(d.fresh.filingAgeDays)} days old (stale fundamentals)`);
      if (d.sharesConflict) issues.push('share counts disagree between filings (unverified per-share basis)');
      if (d.restated?.revised) issues.push(`${d.restated.revised} annual values restated`);
      if (d.rfInfo?.fallback) issues.push('no local risk-free rate (US Treasury used)');
      if (d.fresh?.stale?.length) issues.push('served from cache after a refresh failed: ' + d.fresh.stale.join('; '));
      if (!d.live) issues.push('no current quote (last close used)');
      if ((d.dataNotes || []).some(n => /cover page/.test(n))) issues.push('share count from the cover page (not diluted)');
      return { sym: d.sym, label: d.label, region: d.region, completeness: d.completeness, filed: d.fresh?.filed || null, filingAgeDays: d.fresh?.filingAgeDays ?? null,
        priceTime: d.fresh?.priceTime ?? null, priceKind: d.fresh?.priceKind || null, issues, estimated: ['valuation ranges', 'scores', 'spread (from daily bars)'] };
    }).sort((a, b) => b.issues.length - a.issues.length || a.completeness - b.completeness);
    const n = ds.length;
    return { generated: now, build: { builtAt: R.builtAt, recomputedAt: R.recomputedAt, errors: R.errors, loaded: R.loaded },
      providers: providers.status(), coverage: { companies: n, withFilings: ds.filter(d => d.hasFilings !== false).length, withQuote: ds.filter(d => d.live).length,
        withValuation: ds.filter(d => S.fin(d.valuation?.synthesis?.base)).length, staleFilings: companies.filter(c => c.issues.some(i => /stale fundamentals/.test(i))).length,
        meanCompleteness: S.mean(ds.map(d => d.completeness)) }, companies, fx: R.fxInfo || {}, disk: RT.usage(dataDir), retention: lastRetention,
      kinds: { live: 'crypto and FX streams (Binance, Kraken, TrueFX)', delayed: 'equity quotes (Yahoo, ~15–20 min)', historical: 'bars, filings, rates, FX history', estimated: 'valuations, scores, spreads, catalyst dates', simulated: 'paper fills only' } };
  }
  let lastRetention = null;
  function retention() { try { lastRetention = RT.compact(dataDir, { days: 30 }); } catch (e) { lastRetention = { error: e.message }; } return lastRetention; }

  // ---- model performance ----
  function modelPerformance() {
    const R = research.state, ds = [...R.dossiers.values()], e = validation.state.latest, pv = oms.view();
    const status = {}; for (const d of ds) { const k = d.valuation?.synthesis?.status || 'insufficient'; status[k] = (status[k] || 0) + 1; }
    const conf = {}; for (const d of ds) for (const m of d.valuation?.models || []) if (m.applicable && m.confidence) { conf[m.id] ||= { high: 0, medium: 0, low: 0 }; conf[m.id][m.confidence.level]++; }
    const ev = validation.evidence() || {}, caps = Object.entries(D.FAMILY).map(([k, fam]) => ({ component: k, family: fam, prior: D.PRIORS.opportunity[k][0], ...D.evidenceMultiplier(ev[fam]), evidence: ev[fam] || null }));
    // Paper results against SPY over the same dates (simulated fills; its own category).
    const spy = R.market?.bars || [], snaps = pv.snapshots, s0 = snaps[0];
    const spyAt = t => spy.filter(b => b.t <= t).at(-1)?.c ?? null, b0 = s0 ? spyAt(Date.parse(s0.date) + DAY) : null;
    const paper = { category: pv.category, start: s0?.date || null, equity: snaps.map(s => [s.date, s.equityUSD / pv.startCashUSD]), spy: b0 ? snaps.map(s => [s.date, (spyAt(Date.parse(s.date) + DAY) ?? NaN) / b0]) : [],
      returnPct: pv.equityUSD / pv.startCashUSD - 1, orders: pv.orders.length, fills: pv.fills.length };
    return { generated: Date.now(), experiments: validation.list().slice(0, 20), latest: e ? { id: e.id, created: e.created, scoreboard: Object.fromEntries(Object.entries(e.results).map(([k, r]) => [k, r.insufficient ? null : { label: r.label, train: r.inSample.sharpe, validation: r.validation.sharpe, test: r.test.sharpe, walkForward: r.walkForward?.sharpe ?? null, dsr: r.deflatedSharpe?.dsr ?? null }])) } : null,
      evidenceCaps: caps, calibration: R.calibration ? { valuation: { ic: R.calibration.valuation?.ic, t: R.calibration.valuation?.t, n: R.calibration.valuation?.n }, momentum: { ic: R.calibration.momentum?.ic, t: R.calibration.momentum?.t, n: R.calibration.momentum?.n } } : null,
      statusDistribution: status, modelConfidence: conf, prospective: prospective(), paper };
  }

  // ---- macro and filings ----
  const macro = () => cached('macro', 6 * 3600e3, async () => {
    const res = await Promise.allSettled(providers.MACRO.map(([id]) => providers.fredSeries(id)));
    return { fetched: Date.now(), source: 'FRED (St. Louis Fed) keyless CSV', series: providers.MACRO.map(([id, label, freq, mode], i) => {
      if (res[i].status !== 'fulfilled') return { id, label, error: String(res[i].reason?.message) };
      const xs = res[i].value, last = xs.at(-1), yearAgo = xs.filter(x => x.t <= last.t - 365 * DAY).at(-1);
      return { id, label, frequency: freq, last: last.v, date: last.date, change1y: yearAgo ? (mode === 'yoy' ? last.v / yearAgo.v - 1 : last.v - yearAgo.v) : null, mode,
        history: xs.filter(x => x.t > last.t - 5 * 365 * DAY).filter((_, k, a) => freq === 'monthly' || k % 5 === 0 || k === a.length - 1).map(x => [x.date, x.v]) };
    }) };
  });
  const filings = sym => {
    const u = research.UNIVERSE.find(x => x.sym === sym); if (!u?.cik) return Promise.resolve({ sym, filings: [], note: 'No SEC filer: announcements are not available from a free source.' });
    return cached('filings:' + sym, 24 * 3600e3, async () => ({ sym, ...(await providers.secFilings(u.cik)), source: 'SEC EDGAR submissions', note: 'Filings are announcements as filed; 8-K/6-K cover material events. Headlines and news are not ingested (no free source).' }));
  };
  return { logToday, prospective, dataQuality, modelPerformance, macro, filings, retention };
}
module.exports = { create };
