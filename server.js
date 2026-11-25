// Market Microstructure Laboratory — local server (no dependencies, Node 18+).
// Run: node server.js   ->  http://localhost:8080
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const SPOT = 'https://data-api.binance.vision/api/v3';
const FUT = 'https://fapi.binance.com';

// Equity universe (ticker, sector, SEC CIK) lives in src/research.js. Market cap now comes from SEC share counts × price.
const research = require("./src/research");
const STOCKS = research.UNIVERSE.map(u => [u.sym, u.sector]);

const UA = { 'User-Agent': 'Mozilla/5.0' };
const memo = new Map();
// Small TTL cache with in-flight de-duplication.
function cached(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && (hit.p || Date.now() - hit.t < ttl)) return hit.p || Promise.resolve(hit.v);
  const p = fn().then(v => { memo.set(key, { t: Date.now(), v }); return v; })
               .catch(e => { memo.delete(key); throw e; });
  memo.set(key, { ...(hit || {}), p });
  return p;
}
// Timeout plus one retry: on mobile data a connection attempt can hang (seen with Yahoo) and must not block a refresh.
const getJSON = async (url, opt = {}) => {
  for (let i = 0; ; i++) {
    try { const r = await PV.tracked(url, { ...opt, signal: AbortSignal.timeout(opt.timeout || 15000) }); if (!r.ok) throw Object.assign(new Error(`${r.status} ${url}`), { status: r.status }); return await r.json(); }
    catch (e) { if (i >= 1 || (e.status >= 400 && e.status < 500 && e.status !== 429)) throw e; await new Promise(r => setTimeout(r, 1000)); }
  }
};
const cleanSym = s => String(s || 'EURUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');

const { session } = require('./lib/execsim');   // market state from Yahoo's trading periods (tested)
async function quote(sym) {
  const m = (await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`, { headers: UA })).chart?.result?.[0]?.meta;
  if (!m || !Number.isFinite(m.regularMarketPrice)) throw new Error('Yahoo quote: unexpected response for ' + sym);
  // Prefer Yahoo's own daily change %; chartPreviousClose can be stale (e.g. after splits)
  const pct = m.regularMarketChangePercent ?? (m.chartPreviousClose ? (m.regularMarketPrice / m.chartPreviousClose - 1) * 100 : 0);
  return { price: m.regularMarketPrice, prev: m.regularMarketPrice / (1 + pct / 100), change: pct,
           time: m.regularMarketTime * 1000, name: m.shortName || sym, volume: m.regularMarketVolume ?? null, currency: m.currency || 'USD', ...session(m.currentTradingPeriod) };
}

let lastQuotes = new Map();
const heatmap = () => cached('heat', 10000, async () => {
  const out = [];
  for (let i = 0; i < STOCKS.length; i += 12) {
    const batch = STOCKS.slice(i, i + 12);
    const res = await Promise.allSettled(batch.map(([s]) => quote(s)));
    res.forEach((r, j) => { const [sym, sector] = batch[j]; if (r.status === 'fulfilled') out.push({ sym, sector, ...r.value }); });
  }
  lastQuotes = new Map(out.map(q => [q.sym, q]));
  return { updated: Date.now(), stocks: out };
});

// Positioning sentiment from the USD-M futures market (crypto pairs only).
const sentiment = (sym, iv) => cached(`sent:${sym}:${iv}`, 60000, async () => {
  const period = iv === '15m' ? '15m' : '5m';
  try {
    const [ls, prem] = await Promise.all([
      getJSON(`${FUT}/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=${period}&limit=500`),
      getJSON(`${FUT}/fapi/v1/premiumIndex?symbol=${sym}`),
    ]);
    if (!Array.isArray(ls) || !ls.length) throw new Error('no data');
    return { available: true, source: 'Binance USD-M futures — global long/short account ratio',
      funding: +prem.lastFundingRate, mark: +prem.markPrice,
      series: ls.map(x => ({ t: x.timestamp, long: +x.longAccount, ratio: +x.longShortRatio })).sort((a, b) => a.t - b.t) };
  } catch { return { available: false, series: [] }; }
});

// ---- order-book depth recorder ----
// Binance offers no historical order books, so we record our own: every 3 s, the resting
// quote-currency depth within ±10 bp of mid. Persisted to data/<SYM>.jsonl so it survives restarts.
const BOOK_BAND = 0.001, BOOK_EVERY = 3000, BOOK_KEEP = 30000;
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');   // DATA_DIR lets tests use a separate folder
fs.mkdirSync(DATA, { recursive: true });
// Credentials (API keys) only from .env (gitignored) or the environment; never from source code, never logged.
const { create: authCreate, loadEnv } = require('./src/auth');
loadEnv(path.join(ROOT, '.env'));
const AUTH = authCreate(DATA);
// Provider layer (Part 08): registry, health tracking and fallbacks for every external data source.
const PV = require('./src/providers').create();
const books = new Map();
function bookRecorder(sym, pinned = false) {
  let b = books.get(sym);
  if (!b) {
    b = { series: [], lastReq: Date.now(), pinned, err: null, limit: 100 };   // depth levels fetched; grows only if ±10 bp is not covered
    books.set(sym, b);
    try {
      const lines = fs.readFileSync(path.join(DATA, sym + '.jsonl'), 'utf8').trim().split('\n').slice(-BOOK_KEEP);
      b.series = lines.filter(Boolean).map(l => JSON.parse(l));
    } catch {}
    const tick = async () => {
      if (!b.pinned && Date.now() - b.lastReq > 3600e3) { clearInterval(b.timer); books.delete(sym); return; }
      try {
        const d = await getJSON(`${SPOT}/depth?symbol=${sym}&limit=${b.limit}`);
        const bid = +d.bids[0][0], ask = +d.asks[0][0], mid = (bid + ask) / 2;
        const sum = (side, ok) => { let s = 0; for (const [p, q] of side) { if (!ok(+p)) break; s += +p * +q; } return s; };
        const bd = sum(d.bids, p => p >= mid * (1 - BOOK_BAND)), ad = sum(d.asks, p => p <= mid * (1 + BOOK_BAND));
        const covered = +d.bids[d.bids.length - 1][0] < mid * (1 - BOOK_BAND) && +d.asks[d.asks.length - 1][0] > mid * (1 + BOOK_BAND);
        const snap = { t: Date.now(), mid, spreadBps: +((ask - bid) / mid * 1e4).toFixed(4), bd: +bd.toFixed(2), ad: +ad.toFixed(2),
                       imb: bd + ad ? +((bd - ad) / (bd + ad)).toFixed(4) : 0, covered };
        if (!covered && b.limit < 1000) b.limit = b.limit < 500 ? 500 : 1000;
        b.series.push(snap); if (b.series.length > BOOK_KEEP) b.series.splice(0, b.series.length - BOOK_KEEP);
        fs.mkdirSync(DATA, { recursive: true });
        fs.appendFile(path.join(DATA, sym + '.jsonl'), JSON.stringify(snap) + '\n', () => {});
        b.err = null;
      } catch (e) { b.err = String(e.message); }
    };
    tick(); b.timer = setInterval(tick, BOOK_EVERY);
  }
  b.lastReq = Date.now();
  return b;
}
bookRecorder('EURUSDT', true);   // default instrument records from server start

// ---- Real interbank FX: TrueFX top-of-book (free, no login) ----
// Polled only while a browser is watching (SSE client connected, or bars requested in the last 10 min).
// Ticks are pushed to browsers instantly over Server-Sent Events and aggregated into 1-s bars,
// which are kept on disk (data/fx-EURUSD.jsonl …) so sub-minute candles have history.
const FX_PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'USD/CHF', 'EUR/GBP', 'EUR/JPY', 'EUR/CHF', 'GBP/JPY'];
const FX_KEEP = 4 * 3600;                       // 1-s bars kept in memory per pair (4 h)
const FX = { last: {}, dir: {}, bars: {}, clients: new Set(), inflight: 0, lastWant: 0, err: null, polls: 0 };
const fxFile = p => path.join(DATA, 'fx-' + p.replace('/', '') + '.jsonl');
for (const p of FX_PAIRS) {
  try {
    const lines = fs.readFileSync(fxFile(p), 'utf8').trim().split('\n').slice(-FX_KEEP).filter(Boolean);
    FX.bars[p] = lines.map(l => JSON.parse(l));
    fs.writeFileSync(fxFile(p), lines.join('\n') + (lines.length ? '\n' : ''));   // compact on start
  } catch { FX.bars[p] = []; }
}
function parseTrueFX(csv) {
  const out = [];
  for (const line of csv.trim().split('\n')) {
    const f = line.trim().split(',');
    if (f.length < 6 || !FX_PAIRS.includes(f[0])) continue;
    const bid = parseFloat(f[2] + f[3]), ask = parseFloat(f[4] + f[5]);
    if (isFinite(bid) && isFinite(ask) && ask >= bid) out.push({ pair: f[0], t: +f[1], bid, ask });
  }
  return out;
}
// 1-s bar update. Price comes from the pair's primary feed (composite if Kraken is live, else TrueFX).
// Volume: Kraken traded volume where Kraken trades the pair (v, tb = taker-buy volume); otherwise tick count + tick rule.
function fxBar(pair, t, mid, vol = 0, buyVol = 0, tick = true) {
  const bars = FX.bars[pair], sec = Math.floor(t / 1000) * 1000;
  let b = bars[bars.length - 1];
  if (!b || sec > b.t) {
    if (b) fs.appendFile(fxFile(pair), JSON.stringify(b) + '\n', () => {});
    const o = mid ?? b?.c; if (o == null) return;
    bars.push(b = { t: sec, o, h: o, l: o, c: o, n: 0, v: 0, tb: 0 });
    if (bars.length > FX_KEEP) bars.splice(0, bars.length - FX_KEEP);
  } else if (sec < b.t) return;
  if (mid != null) {
    const dir = Math.sign(mid - b.c) || FX.dir[pair] || 0; FX.dir[pair] = dir;
    b.h = Math.max(b.h, mid); b.l = Math.min(b.l, mid); b.c = mid;
    if (tick) { b.n++; if (!KR_PAIRS.includes(pair)) { b.v++; if (dir > 0) b.tb++; } }
  }
  if (vol) { b.v += vol; b.tb += buyVol; }
}
function fxTick(q) {   // TrueFX quote
  FX.last[q.pair] = q;
  if (!krLive(q.pair)) fxBar(q.pair, q.t, (q.bid + q.ask) / 2);
}

// ---- Fast FX relay: Kraken real fiat-pair quotes + trades, basis-corrected to the interbank level ----
// Kraken prints real EUR/USD etc. up to ~35 times a second but sits at a small, steady offset ("basis") from the
// interbank price. Each TrueFX update re-measures that basis (EMA); composite = Kraken quote + basis.
// JPY pairs are inactive on Kraken, so they stay on TrueFX only.
const KR_PAIRS = ['EUR/USD', 'GBP/USD', 'AUD/USD', 'USD/CAD', 'USD/CHF', 'EUR/GBP', 'EUR/CHF'];
const KR = { ws: null, subs: new Set(), want: new Map(), quote: {}, basis: {}, resid2: {}, status: 'idle', reconnect: null, gen: 0 };
const krLive = p => KR_PAIRS.includes(p) && KR.quote[p] && Date.now() - KR.quote[p].at < 5000 && KR.basis[p] != null;
const round = (x, p) => +x.toFixed(p.endsWith('JPY') ? 3 : 5);
// Events are sent as soon as the current event-loop turn ends (setImmediate), so ticks that arrive together share one
// message but none waits for a timer. (A 40 ms flush timer used to add ~20 ms on average.)
let outbox = [], flushing = false;
const flush = () => { flushing = false; if (!outbox.length) return; const msg = 'data: ' + JSON.stringify(outbox) + '\n\n'; outbox = []; for (const c of FX.clients) c.write(msg); };
const emit = ev => { outbox.push(ev); if (!flushing) { flushing = true; setImmediate(flush); } };
function krSync() {
  const now = Date.now(), want = new Set([...KR.want].filter(([, t]) => now - t < 60000).map(([p]) => p).filter(p => KR_PAIRS.includes(p)));
  if (!want.size) { if (KR.ws) { KR.gen++; KR.ws.close(); KR.ws = null; KR.subs.clear(); KR.status = 'idle'; } return; }
  if (!KR.ws) {
    const gen = ++KR.gen, ws = KR.ws = new WebSocket('wss://ws.kraken.com/v2'); KR.status = 'connecting';
    const t0 = Date.now();
    ws.onopen = () => { PV.record('https://ws.kraken.com', true, Date.now() - t0); if (gen !== KR.gen) return; KR.status = 'live'; KR.subs.clear(); krSync(); };
    ws.onmessage = e => { if (gen === KR.gen) krMessage(JSON.parse(e.data)); };
    ws.onerror = () => PV.record('https://ws.kraken.com', false, null, 'WebSocket error');
    ws.onclose = () => { if (gen !== KR.gen) return; KR.ws = null; KR.subs.clear(); KR.status = 'reconnecting'; clearTimeout(KR.reconnect); KR.reconnect = setTimeout(krSync, 2000); };
    return;
  }
  if (KR.ws.readyState !== 1) return;
  const add = [...want].filter(p => !KR.subs.has(p)), del = [...KR.subs].filter(p => !want.has(p));
  for (const [method, list] of [['subscribe', add], ['unsubscribe', del]]) if (list.length) {
    KR.ws.send(JSON.stringify({ method, params: { channel: 'ticker', symbol: list, event_trigger: 'bbo' } }));
    KR.ws.send(JSON.stringify({ method, params: { channel: 'trade', symbol: list } }));
    list.forEach(p => method === 'subscribe' ? KR.subs.add(p) : KR.subs.delete(p));
  }
}
setInterval(krSync, 5000);
setInterval(() => { if (KR.ws?.readyState === 1) KR.ws.send('{"method":"ping"}'); }, 20000);
function krMessage(m) {
  const now = Date.now();
  if (m.channel === 'ticker' && m.data) for (const d of m.data) {
    const p = d.symbol; if (!KR_PAIRS.includes(p) || !(d.ask >= d.bid)) continue;
    KR.quote[p] = { bid: d.bid, ask: d.ask, at: now };
    const b = KR.basis[p];
    emit({ k: 'kq', pair: p, t: now, bid: d.bid, ask: d.ask, basis: b ?? null, te: KR.resid2[p] != null ? Math.sqrt(KR.resid2[p]) : null });
    if (b != null) fxBar(p, now, round((d.bid + d.ask) / 2 + b, p));
  }
  if (m.channel === 'trade' && m.type === 'update' && m.data) for (const d of m.data) {
    const p = d.symbol; if (!KR_PAIRS.includes(p)) continue;
    const ts = Date.parse(d.timestamp) || now, buy = d.side === 'buy';
    emit({ k: 'tr', pair: p, t: ts, at: now, p: d.price, q: d.qty, buy, basis: KR.basis[p] ?? null });
    if (KR.basis[p] != null) fxBar(p, now, null, d.qty, buy ? d.qty : 0, false);
  }
}
// Called for every new TrueFX quote: re-measure Kraken's offset from the interbank price.
function krBasis(q) {
  const k = KR.quote[q.pair]; if (!k || Date.now() - k.at > 2000) return;
  const x = (q.bid + q.ask) / 2 - (k.bid + k.ask) / 2, b = KR.basis[q.pair];
  if (b == null) { KR.basis[q.pair] = x; KR.resid2[q.pair] = 0; return; }
  const r = x - b; KR.resid2[q.pair] = 0.95 * KR.resid2[q.pair] + 0.05 * r * r;
  KR.basis[q.pair] = b + 0.2 * r;
}
async function pollFX() {
  FX.inflight++;
  try {
    const r = await PV.tracked('https://webrates.truefx.com/rates/connect.html?f=csv', { signal: AbortSignal.timeout(5000) });
    const changed = parseTrueFX(await r.text()).filter(q => !FX.last[q.pair] || q.t > FX.last[q.pair].t);
    for (const c of changed) { krBasis(c); fxTick(c); emit({ k: 'tq', ...c }); }
    FX.polls++; FX.err = null;
  } catch (e) { FX.err = String(e.message); }
  finally { FX.inflight--; }
}
setInterval(() => { if ((FX.clients.size || Date.now() - FX.lastWant < 600e3) && FX.inflight < 2) pollFX(); }, 200);   // TrueFX updates ~1/s; a 200 ms poll notices a change within ~100 ms on average
setInterval(() => { for (const c of FX.clients) c.write(': keep-alive\n\n'); }, 15000);
const YF = { '1m': ['1m', '1d'], '5m': ['5m', '5d'], '15m': ['15m', '5d'], '1h': ['60m', '1mo'] };
const yahooFX = (pair, iv) => cached(`yfx:${pair}:${iv}`, 60000, async () => {
  const [i, range] = YF[iv], r = (await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${pair.replace('/', '')}=X?interval=${i}&range=${range}`, { headers: UA })).chart.result[0];
  const q = r.indicators.quote[0];
  const rd = x => x == null ? null : +x.toPrecision(6);     // Yahoo returns float32 noise; real quotes have 5–6 significant digits
  return r.timestamp.map((t, k) => ({ t: t * 1000, o: rd(q.open[k]), h: rd(q.high[k]), l: rd(q.low[k]), c: rd(q.close[k]), n: 0, tb: 0 })).filter(b => b.o != null && b.c != null && b.h != null && b.l != null);
});
async function fxBars(pair, iv) {
  FX.lastWant = Date.now();
  const ms = { '1s': 1e3, '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3 }[iv] || 60e3;
  const agg = [];
  for (const b of FX.bars[pair]) {
    const t = Math.floor(b.t / ms) * ms, a = agg[agg.length - 1];
    if (a && a.t === t) { a.h = Math.max(a.h, b.h); a.l = Math.min(a.l, b.l); a.c = b.c; a.n += b.n; a.tb += b.tb; a.v += b.v ?? b.n; }
    else agg.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, n: b.n, tb: b.tb, v: b.v ?? b.n });
  }
  let hist = [];
  if (iv !== '1s') { try { hist = (await yahooFX(pair, iv)).filter(b => !agg.length || b.t < agg[0].t); } catch (e) { console.error('Yahoo FX history failed:', pair, iv, e.message); } }
  return [...hist, ...agg].slice(-1000).map(b => ({ ...b, v: b.v ?? b.n }));   // v = Kraken traded volume, or tick count where Kraken has no market
}

// ---- demo trading account (paper money; stored locally, never sent anywhere) ----
const ACCT_FILE = path.join(DATA, 'account.json');
let acctStore = (() => { try { return JSON.parse(fs.readFileSync(ACCT_FILE, 'utf8')); } catch { return { rev: 0, account: null }; } })();
const readBody = (req, limit = 2e6) => new Promise((ok, fail) => {
  const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { fail(new Error('body too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => ok(Buffer.concat(chunks).toString('utf8'))); req.on('error', fail);
});
function validAccount(a) {
  return a === null || (a && typeof a === 'object' && Number.isFinite(a.balance) && Number.isFinite(a.start) && Array.isArray(a.positions) && Array.isArray(a.history)
    && a.positions.every(p => p && ['buy', 'sell'].includes(p.side) && Number.isFinite(p.amount) && Number.isFinite(p.qty) && Number.isFinite(p.entry)));
}

const fng = () => cached('fng', 600000, async () => (await getJSON('https://api.alternative.me/fng/?limit=1')).data[0]);

// ---- minimal ZIP writer (deflate) so the project can be downloaded to a PC ----
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(files) {
  const parts = [], central = []; let off = 0;
  for (const { name, data } of files) {
    const nm = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x5B71, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nm.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x5B71, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nm, comp); central.push(c, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
function projectFiles(dir = ROOT, rel = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    if (d.name.startsWith('.') || d.name === 'node_modules' || d.name === 'data' || d.name.endsWith('.log')) return [];
    const p = path.join(dir, d.name), r = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? projectFiles(p, r) : [{ name: `market-lab/${r}`, data: fs.readFileSync(p) }];
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const json = (res, code, v) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(typeof v === 'string' ? v : JSON.stringify(v)); };

// ---- research pipeline (fundamentals, valuation, quant, decision scores) ----
const RS = research.create({ dataDir: DATA, quotes: () => lastQuotes, providers: PV });
RS.wanted = 0;
// ---- historical validation (Part 05): runs after each research build; identical inputs reuse the stored experiment ----
const VS = require('./src/validation').create({ dataDir: DATA, research: RS });
const vsRun = (force) => VS.run({ force }).then(() => RS.setEvidence(VS.evidence)).catch(e => console.error('validation failed:', e.message));
RS.setEvidence(VS.evidence);
// ---- portfolio laboratory (Part 06) ----
// ---- equity paper trading (Part 07): risk controls → order manager → broker adapter (paper only) ----
const BROKERS = require('./src/brokers'), BROKER = BROKERS.paper();
async function fetchQuotes(syms) {                       // quotes for symbols with working orders, even when nobody is viewing
  const res = await Promise.allSettled(syms.map(s => quote(s)));
  res.forEach((r, i) => { if (r.status === 'fulfilled') lastQuotes.set(syms[i], { sym: syms[i], ...r.value }); });
}
const OMS = require('./src/oms').create({ dataDir: DATA, research: RS, quotes: () => lastQuotes, fetchQuotes, broker: BROKER });
setInterval(() => OMS.tick().catch(e => console.error('order manager:', e.message)), 30e3);
const PF = require('./src/portfolio').create({ dataDir: DATA, research: RS, holdings: () => OMS.holdings() });
RS.setConcentration(PF.concentration);
// ---- monitors (Part 08): data quality, model performance, prospective log, macro, filings; disk retention ----
const MON = require('./src/monitor').create({ dataDir: DATA, research: RS, validation: VS, oms: OMS, providers: PV });
setTimeout(() => MON.retention(), 60e3); setInterval(() => MON.retention(), 24 * 3600e3);
setInterval(() => { if (RS.state.builtAt) try { MON.logToday(); } catch (e) { console.error('prospective log:', e.message); } }, 3600e3);
const rsBuild = () => RS.build().then(() => { try { MON?.logToday(); } catch {} return vsRun(false); }).catch(e => console.error('research build failed:', e.message));
setTimeout(rsBuild, 2000); setInterval(rsBuild, 6 * 3600e3);
// Live prices change premiums and scores: refresh every 60 s while someone is looking (full model rerun every 15 min).
setInterval(async () => { if (Date.now() - RS.wanted < 600e3 && !RS.state.building) { try { await heatmap(); RS.tick(); } catch (e) { console.error('research recompute:', e.message); } } }, 60e3);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), q = url.searchParams;
  // Write gate: every state-changing request needs the access token unless it comes from the phone itself.
  const READ_ONLY_POST = new Set(['/api/portfolio/analyze', '/api/paper/preview']);
  const writes = (req.method !== 'GET' && req.method !== 'HEAD' && !READ_ONLY_POST.has(url.pathname)) || (url.pathname === '/api/account/history' && q.has('restore')) || (url.pathname === '/api/validation/run' && q.get('force') === '1');
  if (writes && !AUTH.allowed(req)) return json(res, 401, { error: 'read-only: open this page with ?token=… (shown on the phone, Paper trading tab) to make changes' });
  try {
    switch (url.pathname) {
      case '/api/auth': return json(res, 200, { canWrite: AUTH.allowed(req), loopback: AUTH.loopback(req), token: AUTH.loopback(req) ? AUTH.token() : undefined });
      case '/api/paper': return json(res, 200, OMS.view());
      case '/api/monitor/data': return json(res, 200, MON.dataQuality());
      case '/api/monitor/models': return json(res, 200, MON.modelPerformance());
      case '/api/macro': try { return json(res, 200, await MON.macro()); } catch (e) { return json(res, 502, { error: e.message }); }
      case '/api/research/filings': try { return json(res, 200, await MON.filings(String(q.get('sym') || '').toUpperCase())); } catch (e) { return json(res, 502, { error: e.message }); }
      case '/api/paper/preview': { let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); } const p = OMS.preview(b); return json(res, p.error ? 400 : 200, p); }
      case '/api/paper/order': { let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); } const o = OMS.submit(b); return json(res, o.status === 'rejected' ? 422 : 201, o); }
      case '/api/paper/cancel': { let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); } const o = OMS.cancel(String(b.id || '')); return json(res, o.error ? 400 : 200, o); }
      case '/api/paper/reset': { let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); } return json(res, 200, OMS.reset(b.cash)); }
      case '/api/paper/limits': { let b; try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); } return json(res, 200, OMS.setLimits(b)); }
      case '/api/heatmap': return json(res, 200, await heatmap());
      case '/api/trades': {           // recent real trades (seed for the order-flow view)
        const r = await PV.tracked(`${SPOT}/aggTrades?symbol=${cleanSym(q.get('symbol'))}&limit=1000`);
        return json(res, r.status, await r.text());
      }
      case '/api/klines': {           // recent real OHLCV bars incl. taker-buy volume
        const iv = ['1s', '1m', '5m', '15m', '1h'].includes(q.get('interval')) ? q.get('interval') : '1m';
        const r = await PV.tracked(`${SPOT}/klines?symbol=${cleanSym(q.get('symbol'))}&interval=${iv}&limit=1000`);
        return json(res, r.status, await r.text());
      }
      case '/api/sentiment': return json(res, 200, await sentiment(cleanSym(q.get('symbol')), q.get('interval')));
      case '/api/book': {
        const b = bookRecorder(cleanSym(q.get('symbol'))), since = +q.get('since') || 0;
        return json(res, 200, { band: BOOK_BAND, every: BOOK_EVERY, err: b.err, first: b.series[0]?.t ?? null,
                                series: since ? b.series.filter(s => s.t > since) : b.series });
      }
      case '/api/fx/bars': {
        const pair = q.get('pair'); if (!FX_PAIRS.includes(pair)) return json(res, 400, { error: 'unknown pair' });
        return json(res, 200, await fxBars(pair, q.get('interval')));
      }
      case '/api/fx/stream': {      // Server-Sent Events: every new TrueFX quote, as soon as it arrives
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders?.();
        res.write('retry: 2000\n\n');
        const want = (q.get('pairs') || '').split(',').filter(p => FX_PAIRS.includes(p));
        const snap = Object.values(FX.last).map(x => ({ k: 'tq', ...x }))
          .concat(Object.entries(KR.quote).map(([p, x]) => ({ k: 'kq', pair: p, t: x.at, bid: x.bid, ask: x.ask, basis: KR.basis[p] ?? null, te: KR.resid2[p] != null ? Math.sqrt(KR.resid2[p]) : null })));
        if (snap.length) res.write('data: ' + JSON.stringify(snap) + '\n\n');
        FX.clients.add(res); FX.lastWant = Date.now();
        const touchWant = () => { for (const p of want) KR.want.set(p, Date.now()); };
        touchWant(); krSync(); const keep = setInterval(touchWant, 10000);
        req.on('close', () => { FX.clients.delete(res); clearInterval(keep); });
        return;
      }
      case '/api/fx/status': return json(res, 200, { pairs: FX_PAIRS, clients: FX.clients.size, polls: FX.polls, err: FX.err,
        kraken: { status: KR.status, subscribed: [...KR.subs], basisPips: Object.fromEntries(Object.entries(KR.basis).map(([p, b]) => [p, +(b / (p.endsWith('JPY') ? 0.01 : 0.0001)).toFixed(2)])),
                  trackingErrorPips: Object.fromEntries(Object.entries(KR.resid2).map(([p, r]) => [p, +(Math.sqrt(r) / 0.0001).toFixed(2)])) }, recorded: Object.fromEntries(FX_PAIRS.map(p => [p, FX.bars[p].length])) });
      case '/api/account/history': {      // list saved versions, or restore one with ?restore=<rev>
        let log = []; try { log = fs.readFileSync(path.join(DATA, 'account-log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
        const want = q.get('restore');
        if (want != null && req.method === 'POST') {
          const v = log.find(x => x.rev === +want); if (!v) return json(res, 404, { error: 'no such version' });
          acctStore = { rev: acctStore.rev + 1, account: v.account };
          fs.writeFileSync(ACCT_FILE + '.tmp', JSON.stringify(acctStore)); fs.renameSync(ACCT_FILE + '.tmp', ACCT_FILE);
          fs.appendFileSync(path.join(DATA, 'account-log.jsonl'), JSON.stringify({ at: Date.now(), restoredFrom: v.rev, ...acctStore }) + '\n');
          return json(res, 200, { rev: acctStore.rev, restoredFrom: v.rev });
        }
        return json(res, 200, log.slice(-200).map(x => ({ at: x.at, rev: x.rev, balance: x.account?.balance ?? null, positions: x.account?.positions.length ?? 0, trades: x.account?.history.length ?? 0 })));
      }
      case '/api/account': {
        if (req.method === 'GET') return json(res, 200, acctStore);
        if (req.method !== 'PUT') return json(res, 405, { error: 'use GET or PUT' });
        let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
        if (body.rev !== acctStore.rev) return json(res, 409, acctStore);           // someone else saved first
        if (!validAccount(body.account)) return json(res, 400, { error: 'invalid account' });
        acctStore = { rev: acctStore.rev + 1, account: body.account };
        fs.mkdirSync(DATA, { recursive: true });
        // every saved version is also appended to a log, so any earlier state can be restored (see /api/account/history)
        fs.appendFileSync(path.join(DATA, 'account-log.jsonl'), JSON.stringify({ at: Date.now(), ...acctStore }) + '\n');
        fs.writeFileSync(ACCT_FILE + '.tmp', JSON.stringify(acctStore)); fs.renameSync(ACCT_FILE + '.tmp', ACCT_FILE);
        return json(res, 200, { rev: acctStore.rev });
      }
      case '/api/research/universe': RS.wanted = Date.now(); return json(res, 200, RS.universeView());
      case '/api/research/company': { RS.wanted = Date.now(); const c = RS.company(String(q.get('sym') || '').toUpperCase()); return c ? json(res, 200, c) : json(res, 404, { error: RS.state.builtAt ? 'unknown symbol' : 'research data still loading' }); }
      case '/api/portfolio': {
        if (req.method === 'PUT') {
          let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
          try { const st = PF.save(body, body.rev); RS.setConcentration(PF.concentration); return json(res, 200, st); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
        }
        return json(res, 200, PF.get());
      }
      case '/api/portfolio/analyze': {
        let body; try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
        try { return json(res, 200, PF.analyse(body)); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
      }
      case '/api/validation': {
        if (!VS.state.latest && !VS.state.running && RS.state.builtAt) vsRun(false);
        return json(res, 200, { running: VS.state.running, progress: VS.state.progress, error: VS.state.error, experiment: VS.state.latest });
      }
      case '/api/validation/run': if (!VS.state.running && RS.state.builtAt) vsRun(q.get('force') === '1'); return json(res, 202, { running: true, progress: VS.state.progress });
      case '/api/validation/experiments': return json(res, 200, VS.list());
      case '/api/validation/experiment': { const e = VS.get(q.get('id') || ''); return e ? json(res, 200, e) : json(res, 404, { error: 'no such experiment' }); }
      case '/api/research/regime': return json(res, 200, { regime: RS.state.regime, calibration: RS.state.calibration, rf: RS.state.rfSource });
      case '/api/fng': return json(res, 200, await fng());
      case '/download': {
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="market-lab.zip"' });
        return res.end(makeZip(projectFiles()));
      }
    }
    const LIB = path.join(ROOT, 'lib'), isLib = url.pathname.startsWith('/lib/');   // shared analytics modules, also used by the browser
    const file = isLib ? path.join(LIB, path.normalize(decodeURIComponent(url.pathname.slice(5)))) : path.join(PUB, url.pathname === '/' ? 'index.html' : path.normalize(decodeURIComponent(url.pathname)));
    if (!file.startsWith(isLib ? LIB + path.sep : PUB)) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('not found'); }
    json(res, 502, { error: String(e.message) });
  }
}).on('connection', sock => sock.setNoDelay(true))   // no Nagle delay: small live messages (SSE ticks) go out immediately
  .listen(PORT, '0.0.0.0', () => {
  console.log(`Market Microstructure Laboratory\n  this device:  http://localhost:${PORT}`);
  console.log(`  write access from another device: add ?token=${AUTH.token()} to the address once`);
  for (const [name, nets] of Object.entries(os.networkInterfaces()))
    for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`  other device: http://${n.address}:${PORT}   [${name}${/^(swlan|ap)/.test(name) ? ' = phone hotspot' : /^wlan/.test(name) ? ' = Wi-Fi' : /^rmnet/.test(name) ? ' = mobile data, not reachable' : ''}]`);
});
