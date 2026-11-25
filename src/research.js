// Research data pipeline: SEC EDGAR fundamentals (10-K, 20-F, 40-F), Yahoo daily/monthly prices and FX,
// US Treasury and OECD (via FRED) government bond yields.
// Builds one dossier per company with independent analytical components. Everything is cached on disk.
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../lib/stats'), F = require('../lib/fundamentals'), V = require('../lib/valuation');
const Q = require('../lib/quant'), R = require('../lib/regime'), D = require('../lib/decision'), C = require('../lib/calibrate'), X = require('../lib/fx');

// US universe: ticker, sector, SEC CIK (each verified against EDGAR submissions on 2026-11-25).
const US = [
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
// International universe: Yahoo symbol of the home listing, display name, sector, SEC CIK of the 20-F / 40-F / 10-K filer
// (null = no free filings source: price data only, valuation shown as unavailable), country.
// Coverage verified 2026-11-25: each CIK has annual XBRL facts and each symbol has 10 years of Yahoo monthly prices.
// Home listings are used so per-share figures need no ADR ratio; ARM, Spotify, MercadoLibre and Shopify use their US
// listings (one share each, no ADR ratio).
const INTL = [
  ['2330.TW', 'TSMC', 'Technology', 1046179, 'TW'], ['ASML.AS', 'ASML', 'Technology', 937966, 'NL'], ['SAP.DE', 'SAP', 'Technology', 1000184, 'DE'],
  ['6758.T', 'Sony', 'Technology', 313838, 'JP'], ['INFY.NS', 'Infosys', 'Technology', 1067491, 'IN'], ['ARM', 'Arm Holdings', 'Technology', 1973239, 'GB'],
  ['SHOP', 'Shopify', 'Technology', 1594805, 'CA'], ['005930.KS', 'Samsung Electronics', 'Technology', null, 'KR'],
  ['SPOT', 'Spotify', 'Communication', 1639920, 'SE'], ['9999.HK', 'NetEase', 'Communication', 1110646, 'CN'], ['0700.HK', 'Tencent', 'Communication', null, 'CN'],
  ['9988.HK', 'Alibaba', 'Consumer Cyclical', 1577552, 'CN'], ['7203.T', 'Toyota', 'Consumer Cyclical', 1094517, 'JP'], ['7267.T', 'Honda', 'Consumer Cyclical', 715153, 'JP'],
  ['MELI', 'MercadoLibre', 'Consumer Cyclical', 1099590, 'UY'], ['MC.PA', 'LVMH', 'Consumer Cyclical', null, 'FR'],
  ['ULVR.L', 'Unilever', 'Consumer Defensive', 217410, 'GB'], ['DGE.L', 'Diageo', 'Consumer Defensive', 835403, 'GB'], ['ABI.BR', 'AB InBev', 'Consumer Defensive', 1668717, 'BE'],
  ['NESN.SW', 'Nestlé', 'Consumer Defensive', null, 'CH'],
  ['NOVO-B.CO', 'Novo Nordisk', 'Healthcare', 353278, 'DK'], ['AZN.L', 'AstraZeneca', 'Healthcare', 901832, 'GB'], ['NOVN.SW', 'Novartis', 'Healthcare', 1114448, 'CH'],
  ['SAN.PA', 'Sanofi', 'Healthcare', 1121404, 'FR'], ['GSK.L', 'GSK', 'Healthcare', 1131399, 'GB'], ['ROP.SW', 'Roche (non-voting)', 'Healthcare', null, 'CH'],
  ['SHEL.L', 'Shell', 'Energy', 1306965, 'GB'], ['TTE.PA', 'TotalEnergies', 'Energy', 879764, 'FR'], ['BP.L', 'BP', 'Energy', 313807, 'GB'], ['EQNR.OL', 'Equinor', 'Energy', 1140625, 'NO'],
  ['BHP.AX', 'BHP', 'Materials', 811809, 'AU'], ['RIO.L', 'Rio Tinto', 'Materials', 863064, 'GB'], ['SIE.DE', 'Siemens', 'Industrials', null, 'DE'],
  ['HSBA.L', 'HSBC', 'Financials', 1089113, 'GB'], ['8306.T', 'Mitsubishi UFJ', 'Financials', 67088, 'JP'], ['8316.T', 'Sumitomo Mitsui FG', 'Financials', 1022837, 'JP'],
  ['HDFCBANK.NS', 'HDFC Bank', 'Financials', 1144967, 'IN'], ['UBSG.SW', 'UBS', 'Financials', 1610520, 'CH'], ['SAN.MC', 'Banco Santander', 'Financials', 891478, 'ES'],
  ['BBVA.MC', 'BBVA', 'Financials', 842180, 'ES'], ['INGA.AS', 'ING', 'Financials', 1039765, 'NL'], ['RY.TO', 'Royal Bank of Canada', 'Financials', 1000275, 'CA'],
  ['TD.TO', 'TD Bank', 'Financials', 947263, 'CA'],
];
const UNIVERSE = [
  ...US.map(([sym, sector, cik]) => ({ sym, label: sym, sector, cik, region: 'US', country: 'US' })),
  ...INTL.map(([sym, label, sector, cik, country]) => ({ sym, label, sector, cik, region: 'International', country })),
];
// Balance-sheet lenders and insurers: FCFF-based models do not apply. (Visa and Mastercard are payment networks and do.)
const FINANCIAL = new Set(['JPM', 'BAC', 'WFC', 'GS', 'MS', 'BRK-B', 'HSBA.L', '8306.T', '8316.T', 'HDFCBANK.NS', 'UBSG.SW', 'SAN.MC', 'BBVA.MC', 'INGA.AS', 'RY.TO', 'TD.TO']);
// Local-currency 10-year government bond yields (OECD, monthly, via FRED's keyless CSV). The euro uses the German Bund.
// TWD, CNY and HKD have no free series here: those valuations fall back to the US Treasury yield, with a visible note.
const LOCAL_RF = { JPY: 'IRLTLT01JPM156N', EUR: 'IRLTLT01DEM156N', GBP: 'IRLTLT01GBM156N', CHF: 'IRLTLT01CHM156N', DKK: 'IRLTLT01DKM156N',
  AUD: 'IRLTLT01AUM156N', CAD: 'IRLTLT01CAM156N', NOK: 'IRLTLT01NOM156N', SEK: 'IRLTLT01SEM156N', KRW: 'IRLTLT01KRM156N', INR: 'INDIRLTLT01STM' };
// Local benchmark index per exchange suffix (Yahoo symbols, each verified to return 5 years of daily bars on 2026-11-25).
const INDEX = { '.T': ['^N225', 'Nikkei 225'], '.L': ['^FTSE', 'FTSE 100'], '.DE': ['^GDAXI', 'DAX'], '.PA': ['^FCHI', 'CAC 40'], '.AS': ['^AEX', 'AEX'],
  '.SW': ['^SSMI', 'SMI'], '.CO': ['^OMXC25', 'OMX Copenhagen 25'], '.MC': ['^IBEX', 'IBEX 35'], '.BR': ['^BFX', 'BEL 20'], '.OL': ['OBX.OL', 'OBX'],
  '.TW': ['^TWII', 'TAIEX'], '.NS': ['^NSEI', 'NIFTY 50'], '.HK': ['^HSI', 'Hang Seng'], '.KS': ['^KS11', 'KOSPI'], '.AX': ['^AXJO', 'S&P/ASX 200'], '.TO': ['^GSPTSE', 'S&P/TSX Composite'] };
// Berkshire reports per-share figures per Class A share; one A share = 1500 B shares.
const CLASS_FACTOR = { 'BRK-B': 1500 };

const SEC_UA = { 'User-Agent': 'QuantaDec404 research tool (local, non-commercial)', 'Accept-Encoding': 'gzip' };
const YH_UA = { 'User-Agent': 'Mozilla/5.0' };
const DAY = 864e5;

// Yahoo v8 chart → bars, dividends, splits. Validates the shape and converts minor-unit currencies (GBp → GBP).
function parseYahooChart(j) {
  const r = j?.chart?.result?.[0];
  if (!r || !r.meta || !Array.isArray(r.timestamp) || !r.indicators?.quote?.[0]) throw new Error('Yahoo chart: unexpected response' + (j?.chart?.error ? ' (' + (j.chart.error.description || j.chart.error.code) + ')' : ''));
  const q = r.indicators.quote[0], { ccy, factor } = X.normaliseCurrency(r.meta.currency), bars = [];
  r.timestamp.forEach((t, i) => { if (q.close[i] != null && q.open[i] != null) bars.push({ t: t * 1000, o: q.open[i] * factor, h: q.high[i] * factor, l: q.low[i] * factor, c: q.close[i] * factor, v: q.volume?.[i] || 0 }); });
  const div = Object.values(r.events?.dividends || {}).map(d => ({ t: d.date * 1000, amount: d.amount * factor })).sort((a, b) => a.t - b.t);
  const splits = Object.values(r.events?.splits || {}).map(s => ({ t: s.date * 1000, ratio: s.numerator / s.denominator })).sort((a, b) => a.t - b.t);
  return { fetched: Date.now(), currency: ccy, quotedIn: r.meta.currency, tz: r.meta.exchangeTimezoneName, bars, div, splits };
}

function create({ dataDir, quotes }) {
  const dir = path.join(dataDir, 'research'); fs.mkdirSync(dir, { recursive: true });
  const st = { started: Date.now(), loaded: 0, errors: {}, building: false, builtAt: null, dossiers: new Map(), regime: null, calibration: null, rf: null, market: null, vix: null };

  // ---- disk cache with TTL ----
  async function cachedFile(name, ttl, fetcher, valid = () => true) {
    const f = path.join(dir, name);
    try { const s = fs.statSync(f); if (Date.now() - s.mtimeMs < ttl) { const v = JSON.parse(fs.readFileSync(f, 'utf8')); if (valid(v)) return v; } } catch {}
    try { const v = await fetcher(); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); return v; }
    catch (e) { try { const old = JSON.parse(fs.readFileSync(f, 'utf8')); old._stale = String(e.message); return old; } catch { throw e; } }   // fall back to stale cache
  }
  // Every request has a timeout and retries with back-off: on mobile data a single connection attempt can hang or fail.
  async function getRaw(url, headers, { tries = 3, timeout = 20000, as = 'json' } = {}) {
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
        if (r.status === 404) throw Object.assign(new Error(`HTTP 404 ${url.replace(/\?.*/, '')}`), { final: true });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${url.replace(/\?.*/, '')}`);
        return as === 'text' ? await r.text() : await r.json();
      } catch (e) { last = e; if (e.final) break; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
    }
    throw new Error(`${last?.cause?.code || last?.name || 'error'}: ${last?.message} (${tries} attempts)`);
  }
  const getJSON = (url, headers) => getRaw(url, headers);
  let secNext = 0;
  async function secGet(url) { const wait = secNext - Date.now(); secNext = Math.max(Date.now(), secNext) + 150; if (wait > 0) await new Promise(r => setTimeout(r, wait)); return getJSON(url, SEC_UA); }

  // Bump FACTS_VERSION when the tag list changes so cached company facts are re-extracted.
  const FACTS_VERSION = 3;
  const facts = (sym, cik) => cachedFile(`facts-${sym}.json`, 7 * DAY, async () => ({ fetched: Date.now(), version: FACTS_VERSION, ...F.compact(await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`)) }), v => v.version === FACTS_VERSION);
  const parseChart = parseYahooChart;
  const yahoo = (sym, iv, range, ttl) => cachedFile(`px-${sym.replace(/[^A-Z0-9-]/gi, '_')}-${iv}.json`, ttl, async () =>
    parseChart(await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&range=${range}&events=div%2Csplit`, YH_UA)));
  // Yahoo FX: USD per unit of `ccy`; 10 years monthly joined to 5 years daily.
  const fxSeries = async ccy => {
    const [m, d] = await Promise.all([yahoo(`${ccy}USD=X`, '1mo', '10y', 7 * DAY), yahoo(`${ccy}USD=X`, '1d', '5y', 12 * 3600e3)]);
    const t0 = d.bars[0]?.t ?? Infinity;
    return { ccy, series: [...m.bars.filter(b => b.t < t0), ...d.bars].map(b => ({ t: b.t, c: b.c })), fetched: d.fetched, stale: [m._stale, d._stale].filter(Boolean) };
  };
  const fred = id => cachedFile(`fred-${id}.json`, 24 * 3600e3, async () => {
    const txt = await getRaw(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, YH_UA, { as: 'text' });
    const rows = txt.trim().split('\n').slice(1).map(l => l.split(',')).filter(([d, v]) => d && v && v !== '.' && Number.isFinite(+v)).map(([d, v]) => ({ t: Date.parse(d), date: d, y: +v / 100 }));
    if (rows.length < 12) throw new Error('FRED series ' + id + ' too short');
    return { fetched: Date.now(), id, rows };
  });
  const treasury = () => cachedFile('treasury.json', 12 * 3600e3, async () => {
    const y = new Date().getUTCFullYear(), rows = [];
    for (const yr of [y, y - 1]) {
      let txt; try { txt = await getRaw(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`, {}, { as: 'text' }); } catch { continue; }
      const lines = txt.trim().split('\n'), hdr = lines[0].split(',').map(s => s.replace(/"/g, '')), k = hdr.indexOf('10 Yr');
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
  async function loadOnce(u) {
    const { sym, cik } = u;
    const [cf, daily, monthly] = await Promise.all([cik ? facts(sym, cik) : null, yahoo(sym, '1d', '5y', 12 * 3600e3), yahoo(sym, '1mo', '10y', 7 * DAY)]);
    // Keep memory small: quarterly facts are only needed for the latest balance sheet and recent quarterly EPS.
    const cut = new Date(Date.now() - 3 * 365 * DAY).toISOString().slice(0, 10);
    if (cf) for (const t of Object.values(cf.facts)) t.v = t.v.filter(x => /^(10-K|20-F|40-F)/.test(x[3]) || x[1] >= cut);
    return { ...u, cf, daily, monthly };
  }
  const EMPTY_CF = { facts: {}, currency: null };
  // Risk-free rate in the analysis currency: US Treasury for USD, OECD 10-year yield otherwise, US fallback with a note.
  function rfFor(ccy, t = Date.now()) {
    if (ccy === 'USD' || !ccy) return { value: st.rf, source: st.rfSource?.source || 'U.S. Treasury', date: st.rfSource?.date, label: '10-year US Treasury', fallback: false };
    const rows = st.localRf?.[ccy];
    if (rows?.length) { const r = rows.filter(x => x.t <= t).pop() || rows[0]; return { value: r.y, source: `OECD long-term government bond yield via FRED (${LOCAL_RF[ccy]})`, date: r.date, label: `10-year ${ccy} government bond`, fallback: false }; }
    return { value: st.rf, source: st.rfSource?.source || 'U.S. Treasury', date: st.rfSource?.date, label: '10-year US Treasury (no free ' + ccy + ' yield)', fallback: true };
  }

  // Per-share figures on today's share basis: EPS ÷ later splits (÷ class factor), share counts rescaled and × later splits.
  function normaliseRows(rows, splits, cls, units) {
    for (const r of rows) {
      if (S.fin(r.eps)) r.eps = r.eps / splitFactor(splits, r.end, r._f?.eps ?? 0) / cls;
      if (S.fin(r.dilShares)) r.dilShares = units(r.dilShares) * splitFactor(splits, r.end, r._f?.dilShares ?? 0);
    }
    return rows;
  }
  // Some filers tag share counts in millions or thousands, and Berkshire in Class A equivalents. Rescale against the cover-page count.
  const unitsFor = (cls, ref, notes) => x => { if (!(x > 0)) return x; if (cls > 1 && x < 1e7) return x * cls; if (x >= 1e6 || cls > 1) return x;
    if (ref > 1e6) { const k = [1e3, 1e6].sort((a, b) => Math.abs(Math.log(x * a / ref)) - Math.abs(Math.log(x * b / ref)))[0]; notes?.push(`Share counts rescaled ×${k} (filed in ${k === 1e6 ? 'millions' : 'thousands'}).`); return x * k; } return x * 1e6; };

  // First pass: per-company facts and market statistics that do not depend on peers.
  // Two currencies per company:
  //  - market statistics (returns, volatility, beta, liquidity) use the listing's own currency, so they are free of FX noise
  //    and comparable with the local index;
  //  - valuation uses the reporting currency of the financial statements; the price is converted at today's FX rate,
  //    and historical prices at each month-end's rate.
  function prepare(raw, live) {
    const { sym, sector, label, region, country } = raw, cf = raw.cf || EMPTY_CF, cls = CLASS_FACTOR[sym] || 1;
    const listCcy = raw.daily.currency || 'USD', ccy = raw.cf ? (cf.currency || 'USD') : listCcy, ccyNotes = [];
    const daily = raw.daily, kNow = X.cross(listCcy, ccy, Date.now(), st.fx);
    if (!S.fin(kNow)) throw new Error(`no ${listCcy}→${ccy} FX rate`);
    const monthlyRep = listCcy === ccy ? raw.monthly.bars : X.convertBars(raw.monthly.bars, listCcy, ccy, st.fx);
    const divRep = listCcy === ccy ? daily.div : X.convertEvents(daily.div, listCcy, ccy, st.fx);
    const mDivRep = listCcy === ccy ? raw.monthly.div : X.convertEvents(raw.monthly.div, listCcy, ccy, st.fx);
    if (listCcy !== ccy) ccyNotes.push(`Listed in ${listCcy}, reports in ${ccy}. Returns, volatility and liquidity use ${listCcy} prices; valuation converts the price to ${ccy} at Yahoo FX rates.`);
    if (daily.quotedIn && daily.quotedIn !== listCcy) ccyNotes.push(`Yahoo quotes this listing in ${daily.quotedIn}; converted to ${listCcy}.`);
    const splits = daily.splits.concat(raw.monthly.splits.filter(s => !daily.splits.some(d => Math.abs(d.t - s.t) < 5 * DAY)));
    const { rows: rows0, tagsUsed } = F.annual(cf), bal = F.latest(cf), notes = [];
    const units = unitsFor(cls, bal.sharesOut, notes), rows = normaliseRows(rows0, splits, cls, units);
    if (S.fin(bal.dilShares)) bal.dilShares = units(bal.dilShares) * splitFactor(splits, bal.asOf.dilShares, Date.parse(bal.asOf.dilShares) + 45 * DAY);   // 10-Q filed ~45 days after quarter end
    if (raw.cf && !S.fin(bal.dilShares) && !S.fin(rows.at(-1)?.dilShares) && !(bal.sharesOut > 0)) notes.push('No total share count in SEC XBRL (reported only by share class), so per-share values and market cap are unavailable.');
    const qEPS = F.quarterlyEPS(cf).map(q => ({ ...q, eps: q.eps / splitFactor(splits, q.end, q.filed) / cls }));
    // Share count: the newest diluted count (quarterly or annual). The cover-page count is a cross-check, and is used instead
    // when there is no diluted count, or when it is newer and disagrees by more than 25 % (typically a split after the
    // fiscal year). Disagreements are flagged because per-share values then depend on which count is right.
    const dil = [[bal.dilShares, bal.asOf?.dilShares, 'quarterly diluted'], [rows.at(-1)?.dilShares, rows.at(-1)?.end, 'annual diluted']].filter(([v, d]) => v > 0 && d).sort((x, y) => y[1].localeCompare(x[1]))[0];
    const cover = cls === 1 && bal.sharesOut > 0 && bal.asOf?.sharesOut ? [bal.sharesOut, bal.asOf.sharesOut, 'cover-page outstanding'] : null;
    let pick = dil || cover, sharesConflict = false;
    if (dil && cover && Math.abs(Math.log(cover[0] / dil[0])) > Math.log(1.25) && Math.abs(Date.parse(cover[1]) - Date.parse(dil[1])) / DAY < 400) {
      sharesConflict = true; if (cover[1] > dil[1]) pick = cover;
      notes.push(`Share counts disagree: ${dil[2]} ${(dil[0] / 1e6).toFixed(0)} M (${dil[1]}) vs ${cover[2]} ${(cover[0] / 1e6).toFixed(0)} M (${cover[1]}). Using the newer (${pick[2]}); per-share values are uncertain.`);
    }
    const shares = pick?.[0] ?? null;
    if (pick && pick === cover && !sharesConflict) notes.push('Share count from the filing cover page (shares outstanding, not diluted).');
    // Price: live quote when available, otherwise the last daily close. Bars stay in the listing currency.
    const q = nativeQuote(live?.get(sym), listCcy), bars = mergeQuote(daily.bars, q);
    const nativePrice = bars.length ? bars[bars.length - 1].c : null, price = S.fin(nativePrice) ? nativePrice * kNow : null;
    const yr = Date.now() - 365 * DAY, dps = S.sum(divRep.filter(d => d.t > yr).map(d => d.amount)) || null;
    const byYear = {}; for (const d of mDivRep.length ? mDivRep : divRep) { const y = new Date(d.t).getUTCFullYear(); byYear[y] = (byYear[y] || 0) + d.amount; }
    const cy = new Date().getUTCFullYear(), dpsGrowth5 = byYear[cy - 1] && byYear[cy - 6] ? S.cagr(byYear[cy - 6], byYear[cy - 1], 5) : null;
    // Own valuation history: P/E at each fiscal-year end from the month-end close (reporting currency).
    const mAt = t => { let best = null; for (const b of monthlyRep) if (b.t <= t + 20 * DAY) best = b; return best?.c ?? null; };
    const history = rows.filter(r => S.fin(r.eps)).map(r => { const p = mAt(Date.parse(r.end)); return { end: r.end, price: p, eps: r.eps, pe: S.fin(p) && r.eps > 0 ? p / r.eps : null,
      pfcf: S.fin(p) && r.fcf > 0 && r.dilShares > 0 ? p / (r.fcf / r.dilShares) : null }; });
    const lastQ = qEPS[qEPS.length - 1], prevQ = lastQ && qEPS.find(x => Math.abs(Date.parse(lastQ.end) - Date.parse(x.end) - 365 * DAY) < 20 * DAY);
    const epsYoY = lastQ && prevQ && Math.abs(prevQ.eps) > 0.01 ? (lastQ.eps - prevQ.eps) / Math.abs(prevQ.eps) : null;
    const L = rows.at(-1) || {};
    const need = ['revenue', 'opIncome', 'netIncome', 'eps', 'ocf', 'capex', 'assets', 'liabilities', 'equity', 'cash', 'dilShares'];
    const present = need.filter(k => S.fin(L[k])).length + (daily.bars.length >= 252 ? 1 : 0) + (S.fin(shares) ? 1 : 0) + (S.fin(price) ? 1 : 0);
    const missing = need.filter(k => !S.fin(L[k]));
    if (!raw.cf) notes.push('No free source of financial statements (not an SEC filer). Price-based measures only; no valuation, fundamentals or valuation-based scores.');
    const rs = raw.cf ? F.restatements(cf) : null;
    if (rs?.revised) notes.push(`${rs.revised} of ${rs.compared} annual revenue, profit or EPS values were later restated. Current figures use the latest filings; valuation history uses values as first reported.`);
    const fxUSD = X.usdPer(ccy, Date.now(), st.fx), fxListUSD = X.usdPer(listCcy, Date.now(), st.fx), marketCap = S.fin(price) && S.fin(shares) ? price * shares : null;
    if (ccy !== 'USD' && !S.fin(fxUSD)) notes.push(`No ${ccy}/USD rate: US-dollar sizes unavailable.`);
    const usListed = listCcy === 'USD' && /^[A-Z-]+$/.test(sym), index = indexFor(sym, usListed);
    return { sharesConflict, sym, sector, label: label || sym, region: region || 'US', country: country || 'US', ccy, listing: { ccy: listCcy, quotedIn: daily.quotedIn || listCcy }, usListed, index,
      fxUSD, fxListUSD, kNow, name: cf.name || label || sym, isFinancial: FINANCIAL.has(sym), hasFilings: !!raw.cf, rows, tagsUsed, bal, qEPS, shares, price, nativePrice, bars,
      monthly: monthlyRep, monthlyNative: raw.monthly.bars, divNative: daily.div, div: divRep, splits, cls,
      dps, dpsGrowth5, history, epsYoY, restated: rs, dataNotes: [...new Set([...ccyNotes, ...notes])], completeness: present / (need.length + 3), missingFields: missing,
      marketCap, marketCapUSD: S.fin(marketCap) && S.fin(fxUSD) ? marketCap * fxUSD : null, eps: L.eps ?? null, fcf: L.fcf ?? null,
      fresh: { filed: bal.lastFiled, filingAgeDays: bal.lastFiled ? (Date.now() - Date.parse(bal.lastFiled)) / DAY : null, factsFetched: cf.fetched ?? null, pricesFetched: daily.fetched,
        priceTime: q?.time ?? bars[bars.length - 1]?.t, priceAgeMin: q?.time ? (Date.now() - q.time) / 60e3 : null, priceKind: q ? 'delayed quote (Yahoo; may lag up to ~15 min)' : 'last daily close (historical)',
        stale: [cf._stale, raw.daily._stale, raw.monthly._stale].filter(Boolean) },
      live: q ? { ...q, price, nativePrice: q.price, nativeCurrency: listCcy } : null };
  }
  // A live quote in the listing's quoted unit (e.g. GBp) → the listing currency (GBP).
  function nativeQuote(q, listCcy) {
    if (!q || !S.fin(q.price)) return null;
    const { ccy: qc, factor } = X.normaliseCurrency(q.currency || 'USD');
    if (qc !== listCcy) return null;                    // unexpected currency: ignore the quote rather than mix units
    return { ...q, price: q.price * factor };
  }
  // Local market index for a listing (by exchange suffix); US listings use SPY.
  function indexFor(sym, usListed) {
    if (usListed) return { sym: 'SPY', name: 'S&P 500 (SPY)' };
    const sfx = (sym.match(/\.[A-Z]+$/) || [''])[0]; return INDEX[sfx] ? { sym: INDEX[sfx][0], name: INDEX[sfx][1] } : null;
  }
  const marketFor = p => p.index?.sym === 'SPY' ? st.market?.bars : st.indices?.[p.index?.sym]?.bars || null;

  // Data-integrity override: a classification against fair value is withheld when the per-share basis is in doubt.
  function guard(syn, p) {
    if (p.sharesConflict && ['below', 'within', 'above'].includes(syn.status)) return { ...syn, status: 'uncertain', notes: [...(syn.notes || []), 'Classification withheld: share counts in the filings disagree, so per-share values are unreliable.'] };
    return syn;
  }
  function peerMultiples(p) {
    const L = p.rows.at(-1) || {}, ev = p.marketCap + (S.fin(p.bal.debt) ? p.bal.debt : 0) - (S.fin(p.bal.cash) ? p.bal.cash : 0);
    return { sym: p.sym, pe: p.eps > 0 ? p.price / p.eps : null, evEbit: L.opIncome > 0 ? ev / L.opIncome : null, evSales: L.revenue > 0 ? ev / L.revenue : null,
      pb: p.bal.equity > 0 ? p.marketCap / p.bal.equity : null, pfcf: L.fcf > 0 ? p.marketCap / L.fcf : null };
  }
  // Traded value and Amihud in US dollars so they compare across markets (bars are in the listing currency).
  function liquidityUSD(p) {
    const l = Q.liquidity(p.bars, { shares: p.shares });
    if (p.listing.ccy !== 'USD' && l.available) { const k = p.fxListUSD; l.addvLocal = l.addv; l.addv = S.fin(k) ? l.addv * k : null; l.amihud = S.fin(k) && S.fin(l.amihud) ? l.amihud / k : null; }
    return l;
  }

  // Second pass: everything that needs the market, peers or regime.
  function analyse(p, all, opts = {}) {
    const marketBars = marketFor(p), marketName = p.index?.name || null, sectorPeers = all.filter(x => x.sector === p.sector), rfi = rfFor(p.ccy);
    const sec63 = S.median(sectorPeers.filter(x => x.sym !== p.sym).map(x => Q.returns(x.bars, [63])[63]));
    const fund = F.analyse(p.rows, p.bal, p.price, V.STATUTORY_TAX[p.country] ?? 0.25);
    const volatility = Q.volatility(p.bars, { marketBars, marketName }), momentum = Q.momentum(p.bars, { marketBars, marketName, sectorMedian63: sec63, divs: p.divNative });
    const liquidity = liquidityUSD(p);
    liquidity.costCurve = Q.costCurve(liquidity);
    const ctx = { sym: p.sym, sector: p.sector, country: p.country, isFinancial: p.isFinancial, price: p.price, shares: p.shares, rows: p.rows, bal: p.bal, fund, rf: rfi.value, beta: volatility.beta,
      peers: sectorPeers.map(peerMultiples), history: p.history, dps: p.dps, dpsGrowth5: p.dpsGrowth5, epsTTM: null, fresh: p.fresh, sharesConflict: p.sharesConflict };
    const assumptions = V.defaults(ctx), models = V.runAll(ctx, assumptions), synthesis = guard(V.synthesize(models, p.price, ctx), p);
    const scen = opts.light ? null : V.scenarios(ctx, assumptions);
    const histModel = models.find(m => m.id === 'hist');
    const exhaustion = Q.exhaustion(p.bars, { marketBars, marketName, valuationPremium: synthesis.premium });
    return { ...p, fund, volatility, momentum, liquidity, exhaustion, rf: rfi.value, rfInfo: rfi, erp: V.ERP,
      valuation: { ctx, assumptions, models, synthesis, scenarios: scen, histPercentile: histModel?.detail?.percentile ?? null } };
  }

  // Point-in-time valuation history. For each annual report, the DCF, earnings-power and book models are rerun with only
  // the filings public on the day that report was filed (restated later values are excluded), priced at that month's
  // close and that month's risk-free rate. β and the equity risk premium are today's (no free point-in-time β).
  function valuationHistory(d) {
    const raw = st.raws?.find(r => r.sym === d.sym); if (!raw?.cf) return [];
    const ends = [...new Set(d.rows.map(r => r._filed).filter(Boolean))].sort((x, y) => x - y), out = [];
    for (const t of ends) {
      const cfT = F.asOf(raw.cf, t), notes = [], { rows: r0 } = F.annual(cfT), balT = F.latest(cfT);
      const rows = normaliseRows(r0, d.splits, d.cls, unitsFor(d.cls, balT.sharesOut, notes)), L = rows.at(-1);
      if (!L || rows.length < 3) continue;
      const mb = d.monthly.filter(b => b.t <= t + 31 * DAY).pop(), price = mb?.c, shares = L.dilShares;
      if (!S.fin(price) || !(shares > 0)) continue;
      let rf; if (d.ccy === 'USD') { const rfRow = st.tnx?.filter(b => b.t <= t).pop(); rf = rfRow ? rfRow.c / 100 : st.rf; } else rf = rfFor(d.ccy, t).value;
      const bal = { equity: L.equity, debt: L.debt, cash: L.cash, curAssets: L.curAssets, curLiab: L.curLiab, goodwill: L.goodwill, intangibles: L.intangibles };
      const fund = F.analyse(rows, bal, price, V.STATUTORY_TAX[d.country] ?? 0.25), ctx = { ...d.valuation.ctx, price, shares, rows, bal, fund, rf, history: [], peers: [], fresh: null };
      const a = V.defaults(ctx), ms = [V.dcf(ctx, a), V.earnings(ctx, a), V.assets(ctx, a)];
      out.push({ end: L.end, filed: new Date(t).toISOString().slice(0, 10), price, rf, models: ms.filter(m => m.applicable).map(m => ({ id: m.id, low: m.low, base: m.base, high: m.high })) });
    }
    return out;
  }

  // Annual EPS as each filing reported it (every version), for point-in-time signal tests. Per-share basis = today's.
  function epsVersions(raw, d) {
    if (!raw?.cf) return [];
    const out = [];
    for (const t of F.TAGS.eps) for (const [start, end, val, form, filed] of raw.cf.facts[t]?.v || []) {
      if (!/^(10-K|20-F|40-F)/.test(form) || !start) continue; const days = (Date.parse(end) - Date.parse(start)) / DAY; if (days < 330 || days > 380) continue;
      const f = Date.parse(filed); out.push({ end, filed: f, eps: val / splitFactor(d.splits, end, f) / d.cls, tag: t });
    }
    // Keep the highest-priority tag per (end, filed).
    const best = new Map(); for (const x of out) { const k = x.end + '|' + x.filed, c = best.get(k); if (!c || F.TAGS.eps.indexOf(x.tag) < F.TAGS.eps.indexOf(c.tag)) best.set(k, x); }
    return [...best.values()].sort((a, b) => a.end.localeCompare(b.end) || a.filed - b.filed);
  }

  async function build() {
    if (st.building) return; st.building = true;
    try {
      const [tr, spy, vix, tnx] = await Promise.allSettled([treasury(), yahoo('SPY', '1d', '5y', 12 * 3600e3), yahoo('^VIX', '1d', '5y', 12 * 3600e3), yahoo('^TNX', '1mo', '10y', 7 * DAY)]);
      st.rf = tr.status === 'fulfilled' ? tr.value.latest.y10 : null; st.rfSource = tr.status === 'fulfilled' ? { ...tr.value.latest, source: tr.value.source } : { error: String(tr.reason?.message) };
      if (!S.fin(st.rf) && tnx.status === 'fulfilled') { const b = tnx.value.bars.at(-1); st.rf = b.c / 100; st.rfSource = { date: new Date(b.t).toISOString().slice(0, 10), y10: st.rf, source: 'Yahoo ^TNX (fallback)' }; }
      st.market = spy.status === 'fulfilled' ? spy.value : null; st.vix = vix.status === 'fulfilled' ? vix.value : null; st.tnx = tnx.status === 'fulfilled' ? tnx.value.bars : null;
      if (!st.market) st.errors['SPY'] = String(spy.reason?.message); else delete st.errors['SPY'];
      const raws = [];
      for (let i = 0; i < UNIVERSE.length; i += 4) {             // 4 companies at a time keeps memory and request rate low
        const res = await Promise.allSettled(UNIVERSE.slice(i, i + 4).map(loadOne));
        res.forEach((r, j) => { const sym = UNIVERSE[i + j].sym; if (r.status === 'fulfilled') { raws.push(r.value); delete st.errors[sym]; } else st.errors[sym] = String(r.reason?.message || r.reason); });
        st.loaded = raws.length;
      }
      // FX for every listing and reporting currency, and local-currency bond yields for every currency in use.
      const ccys = [...new Set(raws.flatMap(r => [r.daily.currency, r.cf?.currency]).filter(c => c && c !== 'USD'))];
      const fx = await Promise.allSettled(ccys.map(fxSeries));
      st.fx = {}; st.fxInfo = {};
      fx.forEach((r, i) => { if (r.status === 'fulfilled' && r.value.series.length) { st.fx[ccys[i]] = r.value.series; st.fxInfo[ccys[i]] = { pair: ccys[i] + 'USD=X', last: r.value.series.at(-1), fetched: r.value.fetched, stale: r.value.stale }; delete st.errors['FX ' + ccys[i]]; } else st.errors['FX ' + ccys[i]] = String(r.reason?.message || 'no data'); });
      const rc = [...new Set(raws.flatMap(r => [r.cf?.currency, r.daily.currency]).filter(c => c && LOCAL_RF[c]))];
      const yl = await Promise.allSettled(rc.map(c => fred(LOCAL_RF[c])));
      st.localRf = {}; yl.forEach((r, i) => { if (r.status === 'fulfilled') st.localRf[rc[i]] = r.value.rows; else st.errors['Yield ' + rc[i]] = String(r.reason?.message); });
      // Local market indices for non-US listings (beta, relative strength, regime-dependent volatility, local regimes).
      const idx = [...new Set(raws.map(r => indexFor(r.sym, (r.daily.currency || 'USD') === 'USD' && /^[A-Z-]+$/.test(r.sym))?.sym).filter(x => x && x !== 'SPY'))];
      const ir = await Promise.allSettled(idx.map(i => yahoo(i, '1d', '5y', 12 * 3600e3)));
      st.indices = {}; ir.forEach((r, i) => { if (r.status === 'fulfilled') { st.indices[idx[i]] = r.value; delete st.errors['Index ' + idx[i]]; } else st.errors['Index ' + idx[i]] = String(r.reason?.message); });
      st.raws = raws;
      recompute();
      // Calibration: US only (one calendar, one currency, longest filing histories). Point-in-time EPS (every filed
      // version, used only after its filing date) and total returns (dividends reinvested).
      st.calibration = C.run([...st.dossiers.values()].filter(d => d.region === 'US').map(d => {
        const tri = Q.totalReturnIndex(d.monthlyNative, d.divNative);
        return { sym: d.sym, monthly: d.monthlyNative.map((b, i) => ({ t: b.t, c: b.c, tr: tri[i] })), annual: epsVersions(raws.find(r => r.sym === d.sym), d) };
      }));
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
    const uniOf = list => list.map(d => ({ sector: d.sector, ret63: d.momentum.returns?.[63], ret63prev: d.bars.length > 126 ? d.bars[d.bars.length - 64].c / d.bars[d.bars.length - 127].c - 1 : null,
      aboveSMA50: d.momentum.aboveSMA?.[50] ?? null, amihud: d.liquidity.amihud, amihudPrev: Q.liquidity(d.bars.slice(0, -63), { shares: d.shares }).amihud }));
    st.regime = R.classify(st.market?.bars, st.vix?.bars, uniOf(ds.filter(d => d.region === 'US')));
    // One regime per local index (no VIX equivalent; breadth only where at least 10 tracked stocks share the index).
    st.localRegimes = {};
    for (const [sym, v] of Object.entries(st.indices || {})) {
      const members = ds.filter(d => d.index?.sym === sym), r = R.classify(v.bars, null, uniOf(members));
      st.localRegimes[sym] = { ...r, name: members[0]?.index?.name || sym, members: members.map(m => m.sym) };
    }
    const universe = { mom12_1: ds.map(d => d.momentum.mom12_1).filter(S.fin), rel63: ds.map(d => d.momentum.relSector63).filter(S.fin) };
    for (const d of ds) d.decision = D.assess(d, { universe, regime: regimeFor(d), calibration: st.calibration });
    st.dossiers = out; st.recomputedAt = st.fullAt = Date.now();
  }
  const regimeFor = d => d.index?.sym && d.index.sym !== 'SPY' && st.localRegimes?.[d.index.sym]?.available ? st.localRegimes[d.index.sym] : st.regime;

  // Cheap refresh between full recomputes: new prices move premiums, classifications, returns and scores, but not the models.
  function refreshPrices() {
    const live = quotes(), ds = [...st.dossiers.values()];
    for (const d of ds) {
      const q = nativeQuote(live.get(d.sym), d.listing.ccy); if (!q) continue;
      const marketBars = marketFor(d), marketName = d.index?.name || null;
      d.bars = mergeQuote(d.bars, q); d.nativePrice = q.price; d.price = q.price * d.kNow; d.live = { ...q, price: d.price, nativePrice: q.price, nativeCurrency: d.listing.ccy };
      d.marketCap = S.fin(d.shares) ? d.price * d.shares : null;
      d.marketCapUSD = S.fin(d.marketCap) && S.fin(d.fxUSD) ? d.marketCap * d.fxUSD : null;
      d.fresh = { ...d.fresh, priceTime: q.time, priceAgeMin: (Date.now() - q.time) / 60e3, priceKind: 'delayed quote (Yahoo; may lag up to ~15 min)' };
      d.valuation.ctx.price = d.price; d.valuation.synthesis = guard(V.synthesize(d.valuation.models, d.price, d.valuation.ctx), d);
      d.momentum = { ...d.momentum, returns: Q.returns(d.bars) };
      d.exhaustion = Q.exhaustion(d.bars, { marketBars, marketName, valuationPremium: d.valuation.synthesis.premium });
    }
    const universe = { mom12_1: ds.map(d => d.momentum.mom12_1).filter(S.fin), rel63: ds.map(d => d.momentum.relSector63).filter(S.fin) };
    for (const d of ds) d.decision = D.assess(d, { universe, regime: regimeFor(d), calibration: st.calibration });
    st.recomputedAt = Date.now();
  }
  // Called every minute while someone is looking: full recompute every 15 minutes, price refresh otherwise.
  function tick() { if (!st.raws || st.building) return; if (Date.now() - (st.fullAt || 0) > 15 * 60e3) recompute(); else refreshPrices(); }

  function summary(d) {
    const v = d.valuation.synthesis, m = d.momentum, x = d.exhaustion, vo = d.volatility, l = d.liquidity, f = d.fund;
    const a = d.valuation.assumptions || {};
    return { sym: d.sym, label: d.label, name: d.name, sector: d.sector, region: d.region, country: d.country, ccy: d.ccy, listing: d.listing, hasFilings: d.hasFilings,
      price: d.price, nativePrice: d.nativePrice ?? null, index: d.index, isFinancial: d.isFinancial, fxUSD: d.fxUSD, rf: d.rfInfo,
      change1d: d.live?.change != null ? d.live.change / 100 : m.returns?.[1] ?? null, ret: m.returns || {}, marketCap: d.marketCap, marketCapUSD: d.ccy === 'USD' ? d.marketCap : d.marketCapUSD, addv: l.addv, advShares: l.advShares,
      turnover: l.turnover, amihud: l.amihud, hv20: vo.hv20, hv252: vo.hv252, volumeZ: x.volumeZ ?? null, divYield: d.dps && d.price ? d.dps / d.price : null,
      fscore: f.fscore, debtToEbitda: f.debtToEbitda, interestCover: f.interestCover, flags: f.flags, epsYoY: d.epsYoY,
      maturity: { trendR2: m.trendR2, distSMA50: x.distSMA50, ret21Pct: x.ret21Pct, exhaustion: x.count ?? null, direction: x.direction ?? null },
      relSector63: m.relSector63 ?? null, closes: d.bars.slice(-253).map(b => +b.c.toPrecision(6)),
      valuation: { low: v.low, base: v.base, high: v.high, premium: v.premium, status: v.status, primary: v.primary, primaryName: d.valuation.models.find(x => x.id === v.primary)?.name || null,
        widthRatio: v.widthRatio, dispersion: v.dispersion, agreement: v.agreement, models: v.models, notes: v.notes,
        assumptions: { discountRate: a.discountRate, costEquity: a.costEquity, growth: a.growth, terminalGrowth: a.terminalGrowth, opMargin: a.opMargin, rf: a.rf, erp: a.erp, beta: a.beta } },
      histPercentile: d.valuation.histPercentile, scores: { opportunity: d.decision.opportunity.score, risk: d.decision.risk.score, confidence: d.decision.confidence.score },
      interpretation: d.decision.interpretation, completeness: d.completeness, fresh: d.fresh, dataNotes: d.dataNotes };
  }

  function universeView() {
    return { builtAt: st.builtAt, recomputedAt: st.recomputedAt, building: st.building, loaded: st.loaded, total: UNIVERSE.length, errors: st.errors, rf: st.rfSource, fx: st.fxInfo || {},
      regime: st.regime && { available: st.regime.available, trend: st.regime.trend, trendAgreement: st.regime.trendAgreement, uncertainty: st.regime.uncertainty, volatility: st.regime.volatility, liquidityStress: st.regime.liquidityStress },
      sources: SOURCES, stocks: [...st.dossiers.values()].map(summary) };
  }
  function company(sym) {
    const d = st.dossiers.get(sym); if (!d) return null;
    const thin = b => b.map(x => [x.t, +x.c.toPrecision(6), x.v, +x.h.toPrecision(6), +x.l.toPrecision(6)]);
    return { ...summary(d), rows: d.rows.map(({ _f, ...r }) => r), tagsUsed: d.tagsUsed, bal: d.bal, qEPS: d.qEPS, shares: d.shares, dps: d.dps, dpsGrowth5: d.dpsGrowth5,
      fund: d.fund, momentum: d.momentum, exhaustion: d.exhaustion, volatility: d.volatility, liquidity: d.liquidity,
      valuation: { ...d.valuation, ctx: { ...d.valuation.ctx } }, valuationHistory: valuationHistory(d), history: d.history,
      decision: d.decision, rfInfo: d.rfInfo, daily: thin(d.listing.ccy === d.ccy ? d.bars : X.convertBars(d.bars, d.listing.ccy, d.ccy, st.fx)), dailyNative: d.listing.ccy === d.ccy ? null : thin(d.bars.slice(-260)), monthly: d.monthly.map(b => [b.t, b.c]), div: d.div, splits: d.splits, rf: d.rf, erp: d.erp, regime: regimeFor(d), usRegime: st.regime, calibration: st.calibration, index: d.index, restated: d.restated, missingFields: d.missingFields,
      market: marketFor(d) ? marketFor(d).slice(-d.bars.length).map(b => [b.t, b.c]) : null, marketName: d.index?.name || null };
  }

  const SOURCES = {
    fundamentals: { name: 'SEC EDGAR XBRL company facts (10-K, 10-Q)', kind: 'historical', refresh: 'weekly' },
    prices: { name: 'Yahoo Finance chart API (daily 5 y, monthly 10 y)', kind: 'historical', refresh: 'twice a day' },
    quotes: { name: 'Yahoo Finance quote (regular market)', kind: 'delayed', refresh: '15 s' },
    riskFree: { name: 'U.S. Treasury daily par yield curve, 10-year', kind: 'historical (daily)', refresh: 'twice a day' },
    regime: { name: 'SPY and ^VIX daily bars (Yahoo)', kind: 'historical', refresh: 'twice a day' },
    valuation: { name: 'Computed in this app from the data above', kind: 'estimate', refresh: 'on every price update' },
    fx: { name: 'Yahoo Finance FX (XXXUSD=X), daily 5 y + monthly 10 y', kind: 'historical', refresh: 'twice a day' },
    localRates: { name: 'OECD long-term government bond yields (monthly) via FRED CSV', kind: 'historical (monthly)', refresh: 'daily' },
    internationalFilings: { name: 'SEC EDGAR XBRL company facts (20-F, 40-F; IFRS or US GAAP)', kind: 'historical', refresh: 'weekly' },
  };

  return { build, recompute, refreshPrices, tick, universeView, company, state: st, UNIVERSE, FINANCIAL };
}

module.exports = { create, UNIVERSE, FINANCIAL, LOCAL_RF, parseYahooChart };
