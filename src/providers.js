// Data provider layer (Part 08): one registry of every external source with its data kind, licence notes and live
// health; fallbacks; and the sources added in Part 08 (SEC filings feed, FRED macro indicators, Frankfurter FX).
// Every HTTP request in the app goes through record(), via the host → provider map, so the Data Quality Monitor sees
// every success, failure and latency. Swapping a source means changing its adapter here, not the analytics.
'use strict';
const S = require('../lib/stats');

const PROVIDERS = {
  yahoo: { name: 'Yahoo Finance chart API', hosts: ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'], kinds: ['equity quotes (delayed)', 'daily and monthly bars', 'dividends and splits', 'FX history', 'index levels'],
    data: 'delayed / historical', key: false, licence: 'Unofficial endpoint, no published terms for automated use. Personal, non-commercial research only; can change or rate-limit without notice. Not for redistribution or live trading.' },
  sec: { name: 'SEC EDGAR (XBRL company facts, submissions)', hosts: ['data.sec.gov', 'www.sec.gov'], kinds: ['financial statements (10-K, 10-Q, 20-F, 40-F)', 'filing history and announcements (8-K, 6-K)', 'SIC industry codes'],
    data: 'historical (as filed)', key: false, licence: 'US government data, public domain. Fair-access policy: at most 10 requests/s with a descriptive User-Agent.' },
  treasury: { name: 'U.S. Treasury yield curve', hosts: ['home.treasury.gov'], kinds: ['daily par yields (10-year)'], data: 'historical (daily)', key: false, licence: 'US government data, public domain.' },
  fred: { name: 'FRED (St. Louis Fed) keyless CSV', hosts: ['fred.stlouisfed.org'], kinds: ['OECD 10-year government yields', 'macro indicators (CPI, unemployment, policy rate, yield curve, credit spread, VIX)'],
    data: 'historical (daily / monthly)', key: false, licence: 'Free; each series carries its source\'s terms (most allow non-commercial use with attribution).' },
  frankfurter: { name: 'Frankfurter (ECB reference rates)', hosts: ['api.frankfurter.dev', 'api.frankfurter.app'], kinds: ['FX fallback (daily ECB rates)'], data: 'historical (daily, ~16:00 CET)', key: false,
    licence: 'Free, open source service over ECB data. No TWD.' },
  binance: { name: 'Binance public market data', hosts: ['data-api.binance.vision', 'api.binance.com', 'stream.binance.com', 'fapi.binance.com'], kinds: ['crypto trades, bars, order book', 'futures positioning'], data: 'live', key: false,
    licence: 'Public API; terms of use apply. Futures endpoints are geo-restricted in some countries.' },
  kraken: { name: 'Kraken WebSocket v2', hosts: ['ws.kraken.com'], kinds: ['FX and crypto quotes and trades'], data: 'live', key: false, licence: 'Public API; terms of use apply.' },
  truefx: { name: 'TrueFX', hosts: ['webrates.truefx.com'], kinds: ['indicative interbank FX quotes'], data: 'live (indicative, not executable)', key: false, licence: 'Free for personal use; indicative prices only.' },
  alternative: { name: 'alternative.me Fear & Greed', hosts: ['api.alternative.me'], kinds: ['crypto sentiment index'], data: 'daily', key: false, licence: 'Free with attribution.' },
  finnhub: { name: 'Finnhub (optional)', hosts: ['finnhub.io'], kinds: ['earnings calendar', 'earnings surprises', 'company news'], data: 'delayed / historical', key: 'FINNHUB_KEY',
    licence: 'Free tier: personal use, 60 requests/min. Needs an API key in .env.' },
  alpaca: { name: 'Alpaca market data and paper trading (optional)', hosts: ['data.alpaca.markets', 'paper-api.alpaca.markets'], kinds: ['US real-time quotes (IEX)', 'paper order execution'], data: 'live (IEX venue only)', key: 'ALPACA_KEY_ID',
    licence: 'Free tier: IEX quotes (~2–3 % of US volume) for personal use. Needs keys in .env.' },
  stooq: { name: 'Stooq end-of-day CSV (rejected)', hosts: ['stooq.com'], kinds: ['would have been: daily bars fallback'], data: 'n/a', key: false,
    licence: 'Not used: since 2026 the CSV endpoint answers with a JavaScript bot challenge (checked 2026-11-25), so it cannot serve as an automated fallback.', disabled: true },
};
const HOST = new Map(Object.entries(PROVIDERS).flatMap(([id, p]) => p.hosts.map(h => [h, id])));

function create() {
  let seq = 0;                                         // event order (timestamps can tie within a millisecond)
  const health = Object.fromEntries(Object.keys(PROVIDERS).map(id => [id, { ok: 0, fail: 0, lastOk: null, lastError: null, lastErrorAt: null, latencyMs: [], inFlight: 0 }]));
  // Record one request outcome. url: full URL (the host picks the provider).
  function record(url, ok, ms, err) {
    let host = ''; try { host = new URL(url).host; } catch {}
    const id = HOST.get(host); if (!id) return; const h = health[id];
    if (ok) { h.ok++; h.lastOk = Date.now(); h.okSeq = ++seq; } else { h.fail++; h.lastError = String(err?.message || err || 'error').slice(0, 300); h.lastErrorAt = Date.now(); h.errSeq = ++seq; }
    if (S.fin(ms)) { h.latencyMs.push(ms); if (h.latencyMs.length > 50) h.latencyMs.shift(); }
  }
  // fetch() wrapper that records health (used by every adapter in the app).
  async function tracked(url, opts) {
    const t0 = Date.now();
    try { const r = await fetch(url, opts); record(url, r.ok || r.status === 404, Date.now() - t0, r.ok ? null : `HTTP ${r.status}`); return r; }
    catch (e) { record(url, false, Date.now() - t0, e.cause?.code || e.name || e.message); throw e; }
  }
  function status() {
    const now = Date.now();
    return Object.entries(PROVIDERS).map(([id, p]) => {
      const h = health[id], recentFail = !!h.errSeq && (h.errSeq > (h.okSeq || 0));
      const configured = p.key ? !!process.env[p.key] : true;
      return { id, name: p.name, kinds: p.kinds, data: p.data, licence: p.licence, needsKey: p.key || null, configured, disabled: !!p.disabled,
        ok: h.ok, fail: h.fail, lastOk: h.lastOk, lastError: h.lastError, lastErrorAt: h.lastErrorAt, medianLatencyMs: S.median(h.latencyMs),
        state: p.disabled ? 'not used' : !configured ? 'needs key' : !h.ok && !h.fail ? 'idle' : recentFail ? 'failing' : now - (h.lastOk || 0) > 6 * 3600e3 ? 'stale' : 'ok' };
    });
  }

  // ---- Frankfurter: daily ECB rates as a fallback FX history (USD per unit of ccy). ----
  async function frankfurterUSDPer(ccy, fromISO) {
    const r = await tracked(`https://api.frankfurter.dev/v1/${fromISO}..?from=${encodeURIComponent(ccy)}&to=USD`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('Frankfurter HTTP ' + r.status);
    const j = await r.json(); return Object.entries(j.rates || {}).map(([d, x]) => ({ t: Date.parse(d + 'T16:00:00Z'), c: x.USD })).filter(x => S.fin(x.c)).sort((a, b) => a.t - b.t);
  }
  // ---- SEC submissions: SIC code and the recent filing list (announcements). ----
  const SEC_UA = { 'User-Agent': 'QuantaDec404 research tool (local, non-commercial)', 'Accept-Encoding': 'gzip' };
  async function secFilings(cik) {
    const r = await tracked(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, { headers: SEC_UA, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('SEC submissions HTTP ' + r.status);
    const j = await r.json(), f = j.filings?.recent || {}, out = [];
    const KEEP = /^(8-K|6-K|10-Q|10-K|20-F|40-F|DEF 14A|S-1|424B|SC 13D|SC 13G)/;
    for (let i = 0; i < (f.form || []).length && out.length < 40; i++) {
      if (!KEEP.test(f.form[i])) continue;
      const acc = f.accessionNumber[i], doc = f.primaryDocument[i];
      out.push({ form: f.form[i], date: f.filingDate[i], reportDate: f.reportDate?.[i] || null, items: f.items?.[i] || '', description: f.primaryDocDescription?.[i] || '',
        url: doc ? `https://www.sec.gov/Archives/edgar/data/${+cik}/${acc.replace(/-/g, '')}/${doc}` : null });
    }
    return { fetched: Date.now(), name: j.name, sic: j.sic, sicDescription: j.sicDescription, fiscalYearEnd: j.fiscalYearEnd, filings: out };
  }
  // ---- FRED macro dashboard (keyless CSV). ----
  const MACRO = [['CPIAUCSL', 'US CPI (index)', 'monthly', 'yoy'], ['UNRATE', 'US unemployment rate', 'monthly', 'level'], ['FEDFUNDS', 'Fed funds rate', 'monthly', 'level'],
    ['T10Y2Y', 'US yield curve (10y − 2y)', 'daily', 'level'], ['BAMLH0A0HYM2', 'US high-yield credit spread', 'daily', 'level'], ['VIXCLS', 'VIX', 'daily', 'level']];
  async function fredSeries(id) {
    const r = await tracked(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('FRED HTTP ' + r.status);
    return (await r.text()).trim().split('\n').slice(1).map(l => l.split(',')).filter(([d, v]) => d && v && v !== '.' && S.fin(+v)).map(([d, v]) => ({ date: d, t: Date.parse(d), v: +v }));
  }
  return { PROVIDERS, record, tracked, status, frankfurterUSDPer, secFilings, fredSeries, MACRO };
}
module.exports = { create, PROVIDERS };
