// Research data pipeline: SEC EDGAR fundamentals, Yahoo daily/monthly prices, US Treasury yields.
// Builds one dossier per company with independent analytical components. Everything is cached on disk.
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../lib/stats'), F = require('../lib/fundamentals'), V = require('../lib/valuation');
const Q = require('../lib/quant'), R = require('../lib/regime'), D = require('../lib/decision'), C = require('../lib/calibrate');

// Universe: ticker, sector, SEC CIK (each verified against EDGAR submissions on 2026-11-25).
const UNIVERSE = [
  ['AAPL', 'Technology', 320193], ['MSFT', 'Technology', 789019], ['NVDA', 'Technology', 1045810], ['AVGO', 'Technology', 1730168],
  ['ORCL', 'Technology', 1341439], ['ADBE', 'Technology', 796343], ['CRM', 'Technology', 1108524], ['AMD', 'Technology', 2488],
  ['INTC', 'Technology', 50863], ['QCOM', 'Technology', 804328], ['CSCO', 'Technology', 858877], ['IBM', 'Technology', 51143],
  ['GOOGL', 'Communication', 1652044], ['META', 'Communication', 1326801], ['NFLX', 'Communication', 1065280], ['DIS', 'Communication', 1744489],
  ['T', 'Communication', 732717], ['VZ', 'Communication', 732712],
  ['AMZN', 'Consumer Cyclical', 1018724], ['TSLA', 'Consumer Cyclical', 1318605], ['HD', 'Consumer Cyclical', 354950], ['MCD', 'Consumer Cyclical', 63908],
  ['NKE', 'Consumer Cyclical', 320187], ['SBUX', 'Consumer Cyclical', 829224],
  ['WMT', 'Consumer Defensive', 104169], ['COST', 'Consumer Defensive', 909832], ['PG', 'Consumer Defensive', 80424], ['KO', 'Consumer Defensive', 21344], ['PEP', 'Consumer Defensive', 77476],
  ['JPM', 'Financials', 19617], ['V', 'Financials', 1403161], ['MA', 'Financials', 1141391], ['BAC', 'Financials', 70858], ['WFC', 'Financials', 72971],
  ['GS', 'Financials', 886982], ['MS', 'Financials', 895421], ['BRK-B', 'Financials', 1067983],
  ['LLY', 'Healthcare', 59478], ['UNH', 'Healthcare', 731766], ['JNJ', 'Healthcare', 200406], ['ABBV', 'Healthcare', 1551152], ['MRK', 'Healthcare', 310158],
  ['PFE', 'Healthcare', 78003], ['TMO', 'Healthcare', 97745],
  ['XOM', 'Energy', 34088], ['CVX', 'Energy', 93410], ['COP', 'Energy', 1163165],
  ['CAT', 'Industrials', 18230], ['GE', 'Industrials', 40545], ['BA', 'Industrials', 12927], ['UPS', 'Industrials', 1090727], ['RTX', 'Industrials', 101829],
  ['LIN', 'Materials', 1707925], ['NEE', 'Utilities', 753308], ['PLD', 'Real Estate', 1045609],
];
// Balance-sheet lenders and insurers: FCFF-based models do not apply. (Visa and Mastercard are payment networks and do.)
const FINANCIAL = new Set(['JPM', 'BAC', 'WFC', 'GS', 'MS', 'BRK-B']);
// Berkshire reports per-share figures per Class A share; one A share = 1500 B shares.
const CLASS_FACTOR = { 'BRK-B': 1500 };

const SEC_UA = { 'User-Agent': 'QuantaDec404 research tool (local, non-commercial)', 'Accept-Encoding': 'gzip' };
const YH_UA = { 'User-Agent': 'Mozilla/5.0' };
const DAY = 864e5;

function create({ dataDir, quotes }) {
  const dir = path.join(dataDir, 'research'); fs.mkdirSync(dir, { recursive: true });
  const st = { started: Date.now(), loaded: 0, errors: {}, building: false, builtAt: null, dossiers: new Map(), regime: null, calibration: null, rf: null, market: null, vix: null };

  // ---- disk cache with TTL ----
  async function cachedFile(name, ttl, fetcher) {
    const f = path.join(dir, name);
    try { const s = fs.statSync(f); if (Date.now() - s.mtimeMs < ttl) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    try { const v = await fetcher(); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); return v; }
    catch (e) { try { const old = JSON.parse(fs.readFileSync(f, 'utf8')); old._stale = String(e.message); return old; } catch { throw e; } }   // fall back to stale cache
  }
  const getJSON = async (url, headers) => { const r = await fetch(url, { headers }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url.replace(/\?.*/, '')}`); return r.json(); };
  let secNext = 0;
  async function secGet(url) { const wait = secNext - Date.now(); secNext = Math.max(Date.now(), secNext) + 150; if (wait > 0) await new Promise(r => setTimeout(r, wait)); return getJSON(url, SEC_UA); }

  const facts = (sym, cik) => cachedFile(`facts-${sym}.json`, 7 * DAY, async () => ({ fetched: Date.now(), ...F.compact(await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`)) }));
  function parseChart(j) {
    const r = j.chart.result[0], q = r.indicators.quote[0], bars = [];
    (r.timestamp || []).forEach((t, i) => { if (q.close[i] != null && q.open[i] != null) bars.push({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 }); });
    const div = Object.values(r.events?.dividends || {}).map(d => ({ t: d.date * 1000, amount: d.amount })).sort((a, b) => a.t - b.t);
    const splits = Object.values(r.events?.splits || {}).map(s => ({ t: s.date * 1000, ratio: s.numerator / s.denominator })).sort((a, b) => a.t - b.t);
    return { fetched: Date.now(), currency: r.meta.currency, tz: r.meta.exchangeTimezoneName, bars, div, splits };
  }
  const yahoo = (sym, iv, range, ttl) => cachedFile(`px-${sym.replace(/[^A-Z0-9-]/gi, '_')}-${iv}.json`, ttl, async () =>
    parseChart(await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&range=${range}&events=div%2Csplit`, YH_UA)));
  const treasury = () => cachedFile('treasury.json', 12 * 3600e3, async () => {
    const y = new Date().getUTCFullYear(), rows = [];
    for (const yr of [y, y - 1]) {
      const r = await fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`);
      if (!r.ok) continue; const lines = (await r.text()).trim().split('\n'), hdr = lines[0].split(',').map(s => s.replace(/"/g, '')), k = hdr.indexOf('10 Yr');
      for (const l of lines.slice(1)) { const c = l.split(','), [m, d, yy] = c[0].split('/'); rows.push({ date: `${yy}-${m}-${d}`, y10: +c[k] / 100 }); }
      if (rows.length) break;
    }
    if (!rows.length) throw new Error('Treasury yield CSV unavailable');
    rows.sort((a, b) => a.date.localeCompare(b.date)); return { fetched: Date.now(), source: 'U.S. Treasury daily par yield curve', latest: rows[rows.length - 1] };
  });

  // The latest quote replaces today's daily bar (or starts one), so returns and ranges use the current price.
  function mergeQuote(src, q) {
    const bars = src.slice(); if (!q || !S.fin(q.price)) return bars;
    const last = bars[bars.length - 1], lastDay = last && new Date(last.t).toISOString().slice(0, 10), qDay = new Date(q.time).toISOString().slice(0, 10);
    if (lastDay === qDay) bars[bars.length - 1] = { ...last, c: q.price, h: Math.max(last.h, q.price), l: Math.min(last.l, q.price), v: Math.max(last.v, q.volume || 0) };
    else if (!last || q.time > last.t) bars.push({ t: q.time, o: q.price, h: q.price, l: q.price, c: q.price, v: q.volume || 0, partial: true });
    return bars;
  }

  // Split adjustment: a per-share value filed before a later split is scaled to today's share basis.
  const splitFactor = (splits, end, filed) => splits.filter(s => s.t > Date.parse(end) && s.t > filed).reduce((f, s) => f * s.ratio, 1);

  async function loadOne(u, retry = 1) {
    try { return await loadOnce(u); } catch (e) { if (!retry) throw e; await new Promise(r => setTimeout(r, 3000)); return loadOne(u, retry - 1); }
  }
  async function loadOnce([sym, sector, cik]) {
    const [cf, daily, monthly] = await Promise.all([facts(sym, cik), yahoo(sym, '1d', '5y', 12 * 3600e3), yahoo(sym, '1mo', '10y', 7 * DAY)]);
    // Keep memory small: quarterly facts are only needed for the latest balance sheet and recent quarterly EPS.
    const cut = new Date(Date.now() - 3 * 365 * DAY).toISOString().slice(0, 10);
    for (const t of Object.values(cf.facts)) t.v = t.v.filter(x => /^10-K/.test(x[3]) || x[1] >= cut);
    return { sym, sector, cik, cf, daily, monthly };
  }

  // First pass: per-company facts and market statistics that do not depend on peers.
  function prepare(raw, live) {
    const { sym, sector, cf, daily, monthly } = raw, cls = CLASS_FACTOR[sym] || 1, splits = daily.splits.concat(monthly.splits.filter(s => !daily.splits.some(d => Math.abs(d.t - s.t) < 5 * DAY)));
    const { rows, tagsUsed } = F.annual(cf), bal = F.latest(cf), notes = [];
    // Some filers tag share counts in millions or thousands, and Berkshire in Class A equivalents. Rescale against the cover-page count.
    const units = x => { if (!(x > 0)) return x; if (cls > 1 && x < 1e7) return x * cls; if (x >= 1e6 || cls > 1) return x;
      const ref = bal.sharesOut; if (ref > 1e6) { const k = [1e3, 1e6].sort((a, b) => Math.abs(Math.log(x * a / ref)) - Math.abs(Math.log(x * b / ref)))[0]; notes.push(`Share counts rescaled ×${k} (filed in ${k === 1e6 ? 'millions' : 'thousands'}).`); return x * k; } return x * 1e6; };
    for (const r of rows) {                                       // per-share figures on today's share basis
      if (S.fin(r.eps)) r.eps = r.eps / splitFactor(splits, r.end, r._f?.eps ?? 0) / cls;
      if (S.fin(r.dilShares)) r.dilShares = units(r.dilShares) * splitFactor(splits, r.end, r._f?.dilShares ?? 0);
    }
    if (S.fin(bal.dilShares)) bal.dilShares = units(bal.dilShares) * splitFactor(splits, bal.asOf.dilShares, Date.parse(bal.asOf.dilShares) + 45 * DAY);   // 10-Q filed ~45 days after quarter end
    if (!S.fin(bal.dilShares) && !S.fin(rows.at(-1)?.dilShares)) notes.push('No total share count in SEC XBRL (reported only by share class), so per-share values and market cap are unavailable.');
    const qEPS = F.quarterlyEPS(cf).map(q => ({ ...q, eps: q.eps / splitFactor(splits, q.end, q.filed) / cls }));
    const shares = S.fin(bal.dilShares) ? bal.dilShares : rows.at(-1)?.dilShares ?? null;
    // Price: live quote when available, otherwise the last daily close.
    const q = live?.get(sym), bars = mergeQuote(daily.bars, q);
    const price = bars.length ? bars[bars.length - 1].c : null;
    const yr = Date.now() - 365 * DAY, dps = S.sum(daily.div.filter(d => d.t > yr).map(d => d.amount)) || null;
    const byYear = {}; for (const d of monthly.div.length ? monthly.div : daily.div) { const y = new Date(d.t).getUTCFullYear(); byYear[y] = (byYear[y] || 0) + d.amount; }
    const cy = new Date().getUTCFullYear(), dpsGrowth5 = byYear[cy - 1] && byYear[cy - 6] ? S.cagr(byYear[cy - 6], byYear[cy - 1], 5) : null;
    // Own valuation history: P/E at each fiscal-year end from the month-end close.
    const mAt = t => { let best = null; for (const b of monthly.bars) if (b.t <= t + 20 * DAY) best = b; return best?.c ?? null; };
    const history = rows.filter(r => S.fin(r.eps)).map(r => { const p = mAt(Date.parse(r.end)); return { end: r.end, price: p, eps: r.eps, pe: S.fin(p) && r.eps > 0 ? p / r.eps : null,
      pfcf: S.fin(p) && r.fcf > 0 && r.dilShares > 0 ? p / (r.fcf / r.dilShares) : null }; });
    const lastQ = qEPS[qEPS.length - 1], prevQ = lastQ && qEPS.find(x => Math.abs(Date.parse(lastQ.end) - Date.parse(x.end) - 365 * DAY) < 20 * DAY);
    const epsYoY = lastQ && prevQ && Math.abs(prevQ.eps) > 0.01 ? (lastQ.eps - prevQ.eps) / Math.abs(prevQ.eps) : null;
    const L = rows.at(-1) || {};
    const need = ['revenue', 'opIncome', 'netIncome', 'eps', 'ocf', 'capex', 'assets', 'liabilities', 'equity', 'cash', 'dilShares'];
    const present = need.filter(k => S.fin(L[k])).length + (daily.bars.length >= 252 ? 1 : 0) + (S.fin(shares) ? 1 : 0) + (S.fin(price) ? 1 : 0);
    return { sym, sector, name: cf.name, isFinancial: FINANCIAL.has(sym), rows, tagsUsed, bal, qEPS, shares, price, bars, monthly: monthly.bars, div: daily.div, splits,
      dps, dpsGrowth5, history, epsYoY, dataNotes: [...new Set(notes)], completeness: present / (need.length + 3),
      marketCap: S.fin(price) && S.fin(shares) ? price * shares : null, eps: L.eps ?? null, fcf: L.fcf ?? null,
      fresh: { filed: bal.lastFiled, filingAgeDays: bal.lastFiled ? (Date.now() - Date.parse(bal.lastFiled)) / DAY : null, factsFetched: cf.fetched, pricesFetched: daily.fetched,
        priceTime: q?.time ?? bars[bars.length - 1]?.t, priceAgeMin: q?.time ? (Date.now() - q.time) / 60e3 : null, priceKind: q ? 'delayed quote (Yahoo; may lag up to ~15 min)' : 'last daily close (historical)',
        stale: [cf._stale, daily._stale, monthly._stale].filter(Boolean) },
      live: q || null };
  }

  function peerMultiples(p) {
    const L = p.rows.at(-1) || {}, ev = p.marketCap + (S.fin(p.bal.debt) ? p.bal.debt : 0) - (S.fin(p.bal.cash) ? p.bal.cash : 0);
    return { sym: p.sym, pe: p.eps > 0 ? p.price / p.eps : null, evEbit: L.opIncome > 0 ? ev / L.opIncome : null, evSales: L.revenue > 0 ? ev / L.revenue : null,
      pb: p.bal.equity > 0 ? p.marketCap / p.bal.equity : null, pfcf: L.fcf > 0 ? p.marketCap / L.fcf : null };
  }

  // Second pass: everything that needs the market, peers or regime.
  function analyse(p, all, opts = {}) {
    const marketBars = st.market?.bars, sectorPeers = all.filter(x => x.sector === p.sector);
    const sec63 = S.median(sectorPeers.filter(x => x.sym !== p.sym).map(x => Q.returns(x.bars, [63])[63]));
    const fund = F.analyse(p.rows, p.bal, p.price);
    const volatility = Q.volatility(p.bars, { marketBars }), momentum = Q.momentum(p.bars, { marketBars, sectorMedian63: sec63 });
    const liquidity = Q.liquidity(p.bars, { shares: p.shares });
    const ctx = { sym: p.sym, sector: p.sector, isFinancial: p.isFinancial, price: p.price, shares: p.shares, rows: p.rows, bal: p.bal, fund, rf: st.rf, beta: volatility.beta,
      peers: sectorPeers.map(peerMultiples), history: p.history, dps: p.dps, dpsGrowth5: p.dpsGrowth5, epsTTM: null };
    const assumptions = V.defaults(ctx), models = V.runAll(ctx, assumptions), synthesis = V.synthesize(models, p.price, ctx);
    const scen = opts.light ? null : V.scenarios(ctx, assumptions);
    const histModel = models.find(m => m.id === 'hist');
    const exhaustion = Q.exhaustion(p.bars, { marketBars, valuationPremium: synthesis.premium });
    return { ...p, fund, volatility, momentum, liquidity, exhaustion, rf: st.rf, erp: V.ERP,
      valuation: { ctx, assumptions, models, synthesis, scenarios: scen, histPercentile: histModel?.detail?.percentile ?? null } };
  }

  // Point-in-time-ish valuation history: rerun DCF and EPV with the data available at each fiscal-year end.
  function valuationHistory(d, tnx) {
    const out = [];
    for (let i = 3; i < d.rows.length; i++) {
      const rows = d.rows.slice(0, i + 1), L = rows[i], t = Date.parse(L.end);
      const price = d.history.find(h => h.end === L.end)?.price, rfRow = tnx?.filter(b => b.t <= t).pop(), rf = rfRow ? rfRow.c / 100 : st.rf;
      const shares = L.dilShares; if (!S.fin(price) || !(shares > 0)) continue;
      const bal = { equity: L.equity, debt: L.debt, cash: L.cash, curAssets: L.curAssets, curLiab: L.curLiab, goodwill: L.goodwill, intangibles: L.intangibles };
      const fund = F.analyse(rows, bal, price), ctx = { ...d.valuation.ctx, price, shares, rows, bal, fund, rf, history: [], peers: [] };
      const a = V.defaults(ctx), ms = [V.dcf(ctx, a), V.earnings(ctx, a), V.assets(ctx, a)];
      out.push({ end: L.end, price, rf, models: ms.filter(m => m.applicable).map(m => ({ id: m.id, low: m.low, base: m.base, high: m.high })) });
    }
    return out;
  }

  async function build() {
    if (st.building) return; st.building = true;
    try {
      const [tr, spy, vix, tnx] = await Promise.allSettled([treasury(), yahoo('SPY', '1d', '5y', 12 * 3600e3), yahoo('^VIX', '1d', '5y', 12 * 3600e3), yahoo('^TNX', '1mo', '10y', 7 * DAY)]);
      st.rf = tr.status === 'fulfilled' ? tr.value.latest.y10 : null; st.rfSource = tr.status === 'fulfilled' ? { ...tr.value.latest, source: tr.value.source } : { error: String(tr.reason?.message) };
      if (!S.fin(st.rf) && tnx.status === 'fulfilled') { const b = tnx.value.bars.at(-1); st.rf = b.c / 100; st.rfSource = { date: new Date(b.t).toISOString().slice(0, 10), y10: st.rf, source: 'Yahoo ^TNX (fallback)' }; }
      st.market = spy.status === 'fulfilled' ? spy.value : null; st.vix = vix.status === 'fulfilled' ? vix.value : null; st.tnx = tnx.status === 'fulfilled' ? tnx.value.bars : null;
      const raws = [];
      for (let i = 0; i < UNIVERSE.length; i += 4) {             // 4 companies at a time keeps memory and request rate low
        const res = await Promise.allSettled(UNIVERSE.slice(i, i + 4).map(loadOne));
        res.forEach((r, j) => { const sym = UNIVERSE[i + j][0]; if (r.status === 'fulfilled') { raws.push(r.value); delete st.errors[sym]; } else st.errors[sym] = String(r.reason?.message || r.reason); });
        st.loaded = raws.length;
      }
      st.raws = raws;
      recompute();
      // Calibration uses only monthly prices and annual EPS with filing dates (no look-ahead).
      st.calibration = C.run([...st.dossiers.values()].map(d => ({ sym: d.sym, monthly: d.monthly, annual: d.rows.map(r => ({ end: r.end, eps: r.eps, filed: r._f?.eps })) })));
      recompute();
      st.builtAt = Date.now();
    } finally { st.building = false; }
  }

  // Recompute everything that depends on live prices (cheap: no network).
  function recompute() {
    if (!st.raws || !S.fin(st.rf)) return;
    const live = quotes();
    const prepared = st.raws.map(r => { try { return prepare(r, live); } catch (e) { st.errors[r.sym] = 'prepare: ' + e.message; return null; } }).filter(Boolean);
    const out = new Map();
    for (const p of prepared) { try { out.set(p.sym, analyse(p, prepared)); } catch (e) { st.errors[p.sym] = 'analyse: ' + e.message; } }
    const ds = [...out.values()];
    const uni = ds.map(d => ({ sector: d.sector, ret63: d.momentum.returns?.[63], ret63prev: d.bars.length > 126 ? d.bars[d.bars.length - 64].c / d.bars[d.bars.length - 127].c - 1 : null,
      aboveSMA50: d.momentum.aboveSMA?.[50] ?? null, amihud: d.liquidity.amihud, amihudPrev: Q.liquidity(d.bars.slice(0, -63), { shares: d.shares }).amihud }));
    st.regime = R.classify(st.market?.bars, st.vix?.bars, uni);
    const universe = { mom12_1: ds.map(d => d.momentum.mom12_1).filter(S.fin), rel63: ds.map(d => d.momentum.relSector63).filter(S.fin) };
    for (const d of ds) d.decision = D.assess(d, { universe, regime: st.regime, calibration: st.calibration });
    st.dossiers = out; st.recomputedAt = st.fullAt = Date.now();
  }

  // Cheap refresh between full recomputes: new prices move premiums, classifications, returns and scores, but not the models.
  function refreshPrices() {
    const live = quotes(), ds = [...st.dossiers.values()], marketBars = st.market?.bars;
    for (const d of ds) {
      const q = live.get(d.sym); if (!q || !S.fin(q.price)) continue;
      d.bars = mergeQuote(d.bars, q); d.price = q.price; d.live = q; d.marketCap = S.fin(d.shares) ? q.price * d.shares : null;
      d.fresh = { ...d.fresh, priceTime: q.time, priceAgeMin: (Date.now() - q.time) / 60e3, priceKind: 'delayed quote (Yahoo; may lag up to ~15 min)' };
      d.valuation.ctx.price = q.price; d.valuation.synthesis = V.synthesize(d.valuation.models, q.price, d.valuation.ctx);
      d.momentum = { ...d.momentum, returns: Q.returns(d.bars) };
      d.exhaustion = Q.exhaustion(d.bars, { marketBars, valuationPremium: d.valuation.synthesis.premium });
    }
    const universe = { mom12_1: ds.map(d => d.momentum.mom12_1).filter(S.fin), rel63: ds.map(d => d.momentum.relSector63).filter(S.fin) };
    for (const d of ds) d.decision = D.assess(d, { universe, regime: st.regime, calibration: st.calibration });
    st.recomputedAt = Date.now();
  }
  // Called every minute while someone is looking: full recompute every 15 minutes, price refresh otherwise.
  function tick() { if (!st.raws || st.building) return; if (Date.now() - (st.fullAt || 0) > 15 * 60e3) recompute(); else refreshPrices(); }

  function summary(d) {
    const v = d.valuation.synthesis, m = d.momentum, x = d.exhaustion, vo = d.volatility, l = d.liquidity, f = d.fund;
    return { sym: d.sym, name: d.name, sector: d.sector, price: d.price, isFinancial: d.isFinancial,
      change1d: d.live?.change != null ? d.live.change / 100 : m.returns?.[1] ?? null, ret: m.returns || {}, marketCap: d.marketCap, addv: l.addv, advShares: l.advShares,
      turnover: l.turnover, amihud: l.amihud, hv20: vo.hv20, hv252: vo.hv252, volumeZ: x.volumeZ ?? null, divYield: d.dps && d.price ? d.dps / d.price : null,
      fscore: f.fscore, debtToEbitda: f.debtToEbitda, interestCover: f.interestCover, flags: f.flags, epsYoY: d.epsYoY,
      maturity: { trendR2: m.trendR2, distSMA50: x.distSMA50, ret21Pct: x.ret21Pct, exhaustion: x.count ?? null, direction: x.direction ?? null },
      relSector63: m.relSector63 ?? null, closes: d.bars.slice(-253).map(b => +b.c.toPrecision(6)),
      valuation: { low: v.low, base: v.base, high: v.high, premium: v.premium, status: v.status, primary: v.primary, widthRatio: v.widthRatio, dispersion: v.dispersion, agreement: v.agreement, models: v.models },
      histPercentile: d.valuation.histPercentile, scores: { opportunity: d.decision.opportunity.score, risk: d.decision.risk.score, confidence: d.decision.confidence.score },
      interpretation: d.decision.interpretation, completeness: d.completeness, fresh: d.fresh, dataNotes: d.dataNotes };
  }

  function universeView() {
    return { builtAt: st.builtAt, recomputedAt: st.recomputedAt, building: st.building, loaded: st.loaded, total: UNIVERSE.length, errors: st.errors, rf: st.rfSource,
      regime: st.regime && { available: st.regime.available, trend: st.regime.trend, trendAgreement: st.regime.trendAgreement, uncertainty: st.regime.uncertainty, volatility: st.regime.volatility, liquidityStress: st.regime.liquidityStress },
      sources: SOURCES, stocks: [...st.dossiers.values()].map(summary) };
  }
  function company(sym) {
    const d = st.dossiers.get(sym); if (!d) return null;
    const thin = b => b.map(x => [x.t, +x.c.toPrecision(6), x.v, +x.h.toPrecision(6), +x.l.toPrecision(6)]);
    return { ...summary(d), rows: d.rows.map(({ _f, ...r }) => r), tagsUsed: d.tagsUsed, bal: d.bal, qEPS: d.qEPS, shares: d.shares, dps: d.dps, dpsGrowth5: d.dpsGrowth5,
      fund: d.fund, momentum: d.momentum, exhaustion: d.exhaustion, volatility: d.volatility, liquidity: d.liquidity,
      valuation: { ...d.valuation, ctx: { ...d.valuation.ctx } }, valuationHistory: valuationHistory(d, st.tnx), history: d.history,
      decision: d.decision, daily: thin(d.bars), monthly: d.monthly.map(b => [b.t, b.c]), div: d.div, splits: d.splits, rf: d.rf, erp: d.erp, regime: st.regime, calibration: st.calibration,
      market: st.market ? st.market.bars.slice(-d.bars.length).map(b => [b.t, b.c]) : null };
  }

  const SOURCES = {
    fundamentals: { name: 'SEC EDGAR XBRL company facts (10-K, 10-Q)', kind: 'historical', refresh: 'weekly' },
    prices: { name: 'Yahoo Finance chart API (daily 5 y, monthly 10 y)', kind: 'historical', refresh: 'twice a day' },
    quotes: { name: 'Yahoo Finance quote (regular market)', kind: 'delayed', refresh: '15 s' },
    riskFree: { name: 'U.S. Treasury daily par yield curve, 10-year', kind: 'historical (daily)', refresh: 'twice a day' },
    regime: { name: 'SPY and ^VIX daily bars (Yahoo)', kind: 'historical', refresh: 'twice a day' },
    valuation: { name: 'Computed in this app from the data above', kind: 'estimate', refresh: 'on every price update' },
  };

  return { build, recompute, refreshPrices, tick, universeView, company, state: st, UNIVERSE, FINANCIAL };
}

module.exports = { create, UNIVERSE };
