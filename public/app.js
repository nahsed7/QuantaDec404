'use strict';
const $ = id => document.getElementById(id);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (n, d = 2) => n == null || !isFinite(n) ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const sig = (n, s = 4) => n == null || !isFinite(n) ? '–' : Number(n).toPrecision(s);
const pct = (n, d = 1) => n == null || !isFinite(n) ? '–' : (n * 100).toFixed(d) + '%';
const getJSON = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
const CFG = { responsive: true, displaylogo: false };
const IV_MS = { '1s': 1e3, '1m': 60e3, '5m': 300e3, '15m': 900e3 };
const IV_UNIT = { '1s': 's', '1m': 'min', '5m': '×5 min', '15m': '×15 min' };
// Binance market-data WebSocket. Measured from the phone (2026-11-25): stream.binance.com p50 93 ms / p90 132 ms after the
// exchange event; the data-stream.binance.vision mirror p50 101 / p90 215 ms. The faster endpoint is used first; if it
// fails to open (it is blocked in some countries) the mirror is used for the rest of the session.
const STREAMS = ['wss://stream.binance.com:9443/stream?streams=', 'wss://data-stream.binance.vision/stream?streams='];
let streamIdx = 0;
const STREAM_URL = () => STREAMS[streamIdx];
// Tick-to-screen latency: time from a message arriving to the next drawn frame of the live chart.
const LAT = { rx: 0, pending: false, screen: [] };
const markRx = () => { if (!LAT.pending) { LAT.rx = performance.now(); LAT.pending = true; } };

/* ---------- theme ---------- */
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
const isDark = () => css('--mode') !== 'light';
$('themeBtn').onclick = () => {
  document.documentElement.dataset.theme = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('theme', document.documentElement.dataset.theme); } catch {}
  labAt = 0; Object.keys(dirty).forEach(k => dirty[k] = true);
};
const base = (extra = {}) => ({ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: '"IBM Plex Mono", ui-monospace, monospace', size: 11, color: css('--text') },
  hoverlabel: { bgcolor: css('--panel-solid'), bordercolor: css('--accent'), font: { family: 'IBM Plex Mono', color: css('--text'), size: 11 } },
  margin: { t: 10, l: 56, r: 14, b: 44 }, showlegend: false, ...extra });
const ax = (title, extra = {}) => ({ title: { text: title, font: { size: 11, color: css('--muted') } }, gridcolor: css('--grid'), zerolinecolor: css('--line'),
  linecolor: css('--line'), tickfont: { size: 10, color: css('--muted') }, mirror: true, showline: true, ...extra });
const ax3 = (title, extra = {}) => ({ ...ax(title), backgroundcolor: css('--plane'), showbackground: true, mirror: false, spikecolor: css('--accent'), ...extra });
const seqScale = () => isDark() ? [[0, '#06301f'], [0.35, '#00875c'], [0.7, '#00f09c'], [1, '#eafff6']] : 'Viridis';
const divScale = () => [[0, css('--sell')], [0.5, isDark() ? '#0b2a1d' : '#e6e2d8'], [1, css('--buy')]];
const plot = (id, data, layout) => Plotly.react(id, data, layout, CFG);

/* ---------- status bar ---------- */
const status = { quotes: 'idle', stream: 'idle', book: 'idle' };
const setStatus = (k, v) => { status[k] = v; };
let frames = 0, fpsShown = 0, heavyShown = 0;
setInterval(() => {
  fpsShown = frames; frames = 0; heavyShown = heavyFrames; heavyFrames = 0;
  const dot = v => `<i class="${['live', 'ok', 'recording'].includes(v) ? 'ok' : ['error', 'retrying'].includes(v) ? 'bad' : ''}"></i>`;
  const q = M.quote, age = q ? Date.now() - q.t : null;
  $('status').innerHTML = `<span>UTC ${new Date().toISOString().slice(11, 19)}</span>` +
    Object.entries(status).map(([k, v]) => `<span>${dot(v)}${k}: ${v}</span>`).join('') +
    (isFX(M.sym) && FXQ[M.sym.slice(3)] ? `<span>feed ${FXQ[M.sym.slice(3)].src}${FXQ[M.sym.slice(3)].src === 'composite' ? ` · basis ${(FXQ[M.sym.slice(3)].basis / pipOf(M.sym)).toFixed(2)} pip · tracking ±${FXQ[M.sym.slice(3)].te == null ? '–' : (FXQ[M.sym.slice(3)].te / pipOf(M.sym)).toFixed(2)} pip` : ''}</span>` : '') + `<span>${M.sym} · ${M.iv} · ${M.bars.length} bars</span><span>quotes/s ${M.qps}</span><span>last quote ${age == null ? '–' : age + ' ms ago'}</span><span>chart ${fpsShown} fps · 3D ${heavyShown} fps</span><span title="exchange event → browser, clock-corrected against Binance server time (± half the round trip)">feed ${CLK.lat.length ? '≈ ' + Math.round(CLK.lat.slice().sort((x, y) => x - y)[CLK.lat.length >> 1]) + ' ms (±' + Math.round(CLK.rtt / 2) + ')' : '–'}</span><span title="message arrival → drawn on the live chart (median of the last 120)">→ screen ${LAT.screen.length ? Math.round(LAT.screen.slice().sort((x, y) => x - y)[LAT.screen.length >> 1]) + ' ms' : '–'}</span><span title="your device clock vs exchange time (corrected in the latency figure)">clock ${CLK.ok ? (CLK.off >= 0 ? '−' : '+') + Math.abs(Math.round(CLK.off)) + ' ms' : '–'}</span>`;
  M.qps = M.qcount; M.qcount = 0;
}, 1000);

/* ---------- navigation + render loop ---------- */
let view = 'heat', labAt = 0;
const dirty = { heat: true, state: true, flow: true, lab: true };
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  view = b.dataset.v;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === view));
  $('controls').hidden = !['state', 'flow', 'lab'].includes(view);   // instrument controls belong to the live views only
  labAt = 0; dirty[view] = true;
  window.dispatchEvent(new CustomEvent('viewchange', { detail: view }));
});
let lastFrame = 0, heavyFrames = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (view === 'state') { frames++; try { drawLiveCanvas(ts); } catch (e) { console.error(e); } }   // every display frame
  const fps = +$('fps').value;
  if (fps && ts - lastFrame < 1000 / fps - 2) return;
  if (view === 'flow' || view === 'state') dirty[view] = true;      // time axis slides continuously
  if (!dirty[view]) return;
  lastFrame = ts; dirty[view] = false; heavyFrames++;
  const draw = ({ heat: drawHeat, state: () => { if (!STATE_SIMPLE()) drawState(); }, flow: drawFlow, lab: drawLab })[view];   // other views render themselves
  if (draw) try { draw(); } catch (e) { console.error(e); }
}
requestAnimationFrame(loop);

/* ======================= §1 equity heatmap ======================= */
// The heat map lives in heat.js (valuation-integrated research map); this keeps the view switcher working.
function drawHeat() { window.HEAT?.draw(); }

/* ======================= market data: one combined real-time stream ======================= */
// kline (authoritative bars) + aggTrade (every trade, updates the forming bar instantly) + bookTicker (every best bid/ask change)
const M = { sym: $('sym').value, iv: $('iv').value, bars: [], sent: { available: false, series: [] }, fng: null, book: [], bookErr: null,
            gen: 0, ws: null, quote: null, ticks: [], dir: 0, qcount: 0, qps: 0 };
const T = { trades: [] };
const cache = { F: null, fc: null, fcAt: 0 };
const touch = () => { cache.F = null; dirty.state = dirty.flow = dirty.lab = true; };

/* ---------- real FX via the local relay (Server-Sent Events) ----------
   tq = interbank quote (TrueFX), kq = Kraken quote + measured basis, tr = Kraken trade.
   Feeds: composite = Kraken quote shifted by the basis (fast, interbank level); interbank = TrueFX only; kraken = raw venue. */
const isFX = s => s.startsWith('FX:');
const KR_PAIRS = ['EUR/USD', 'GBP/USD', 'AUD/USD', 'USD/CAD', 'USD/CHF', 'EUR/GBP', 'EUR/CHF'];
const FXQ = {}, FXT = {}, FXK = {};   // effective quote per pair (selected feed), raw interbank, raw Kraken
let fxES = null, fxKey = null, fxPrev = null;
const fxSrc = () => $('fxsrc').value;
const pipOf = p => p.endsWith('JPY') ? 0.01 : 0.0001;
function fxEffective(pair) {
  const t = FXT[pair], k = FXK[pair], src = fxSrc(), kOk = k && Date.now() - k.rx < 5000 && KR_PAIRS.includes(pair);
  if (src === 'kraken' && kOk) return { bid: k.bid, ask: k.ask, t: k.t, src: 'kraken' };
  if (src === 'composite' && kOk && k.basis != null) {
    const d = pair.endsWith('JPY') ? 3 : 5;
    return { bid: +(k.bid + k.basis).toFixed(d), ask: +(k.ask + k.basis).toFixed(d), t: k.t, src: 'composite', basis: k.basis, te: k.te };
  }
  return t ? { bid: t.bid, ask: t.ask, t: t.t, src: 'interbank' } : null;
}
function fxWanted() {
  const s = new Set(); if (isFX(M.sym)) s.add(M.sym.slice(3));
  if (typeof AC !== 'undefined' && AC.acct) for (const p of AC.acct.positions) if (isFX(p.sym)) s.add(p.sym.slice(3));
  return [...s].sort().join(',');
}
function openFX() {
  const key = fxWanted(); if (fxES && key === fxKey) return;
  fxKey = key; if (fxES) fxES.close();
  fxES = new EventSource('/api/fx/stream?pairs=' + encodeURIComponent(key));
  fxES.onopen = () => { if (isFX(M.sym)) setStatus('stream', 'live'); };
  fxES.onerror = () => { if (isFX(M.sym)) setStatus('stream', 'retrying'); };
  fxES.onmessage = e => {
    const touched = new Map(), rx = Date.now(); markRx();
    for (const ev of JSON.parse(e.data)) {
      if (ev.k === 'tq') { FXT[ev.pair] = { bid: ev.bid, ask: ev.ask, t: ev.t, rx }; touched.set(ev.pair, ev.t);
        if (CLK.ok && 'FX:' + ev.pair === M.sym && fxEffective(ev.pair)?.src === 'interbank') { CLK.lat.push(rx + CLK.off - ev.t); if (CLK.lat.length > 60) CLK.lat.shift(); } }
      else if (ev.k === 'kq') { FXK[ev.pair] = { bid: ev.bid, ask: ev.ask, t: ev.t, rx, basis: ev.basis, te: ev.te }; touched.set(ev.pair, ev.t); }
      else if (ev.k === 'tr' && 'FX:' + ev.pair === M.sym) fxTrade(ev, rx);
    }
    for (const [pair, t] of touched) {
      const q = fxEffective(pair); if (!q) continue;
      const prev = FXQ[pair]; FXQ[pair] = q; if (typeof AC !== 'undefined') AC.quotes['FX:' + pair] = { ...q, t: rx };
      if ('FX:' + pair !== M.sym || (prev && prev.bid === q.bid && prev.ask === q.ask && prev.src === q.src)) continue;
      onQuote({ b: q.bid, a: q.ask }); fxBarTick((q.bid + q.ask) / 2, t);
    }
  };
}
setInterval(openFX, 2000);
const cndMs = () => ({ '1s': 1e3, '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3 }[CND.base]);
const fxTickVolume = () => fxSrc() === 'interbank' || !KR_PAIRS.includes(M.sym.slice(3));
// A new quote moves the forming bar and candle. Bar times use the server clock, so they line up with recorded history.
function fxBarTick(mid, t) {
  const up = fxPrev != null && mid > fxPrev, tv = fxTickVolume(); fxPrev = mid;
  const add = (bars, ms) => {
    let b = bars[bars.length - 1];
    if (!b || t >= b.t + ms) { bars.push(b = { t: Math.floor(t / ms) * ms, o: mid, h: mid, l: mid, c: mid, v: 0, n: 0, tb: 0 }); if (bars.length > 4000) bars.splice(0, 500); }
    else if (t < b.t) return;
    b.c = mid; b.h = Math.max(b.h, mid); b.l = Math.min(b.l, mid); b.n++;
    if (tv) { b.v++; if (up) b.tb++; }
  };
  add(M.bars, IV_MS[M.iv]); add(CND.bars, cndMs()); touch();
}
// A real Kraken trade: drawn at the feed's price level, adds real volume and taker side to the forming bar.
function fxTrade(ev, rx) {
  if (fxSrc() === 'interbank') return;
  const p = fxSrc() === 'kraken' || ev.basis == null ? ev.p : +(ev.p + ev.basis).toFixed(ev.pair.endsWith('JPY') ? 3 : 5);
  T.trades.push({ t: rx, p, q: ev.q, buy: ev.buy }); if (T.trades.length > 30000) T.trades.splice(0, 5000);
  const addV = (bars, ms) => { const b = bars[bars.length - 1]; if (b && ev.at >= b.t && ev.at < b.t + ms) { b.v += ev.q; if (ev.buy) b.tb += ev.q; } };
  addV(M.bars, IV_MS[M.iv]); addV(CND.bars, cndMs());
  if (CLK.ok) { CLK.lat.push(rx + CLK.off - ev.t); if (CLK.lat.length > 60) CLK.lat.shift(); }
  touch();
}
$('fxsrc').onchange = () => { fxPrev = null; T.trades = []; const p = M.sym.slice(3); if (isFX(M.sym)) { const q = fxEffective(p); if (q) { FXQ[p] = q; onQuote({ b: q.bid, a: q.ask }); } } dirty.state = true; };
openFX();

async function startMarket() {
  const gen = ++M.gen;
  M.sym = $('sym').value; M.iv = $('iv').value;
  Object.assign(M, { bars: [], book: [], ticks: [], quote: null, dir: 0 }); T.trades = []; cache.fc = null; touch();
  if (M.ws) { M.ws.onclose = null; M.ws.close(); }
  setStatus('stream', 'loading'); fxPrev = null;
  $('fxsrcL').hidden = !isFX(M.sym);
  if (isFX(M.sym)) {
    const pair = M.sym.slice(3);
    try { M.bars = await getJSON(`/api/fx/bars?pair=${encodeURIComponent(pair)}&interval=${M.iv}`); } catch { setStatus('stream', 'error'); }
    if (gen !== M.gen) return;
    M.sent = { available: false, series: [] }; setStatus('book', 'n/a (OTC FX)');
    const fq = fxEffective(pair); if (fq) { FXQ[pair] = fq; M.quote = { bid: fq.bid, ask: fq.ask, mid: (fq.bid + fq.ask) / 2, t: Date.now() }; }
    openFX();
    setStatus('stream', fxES && fxES.readyState === 1 ? 'live' : 'connecting');
    touch(); startCandles(); return;
  }
  const [ks, tr] = await Promise.allSettled([getJSON(`/api/klines?symbol=${M.sym}&interval=${M.iv}`), getJSON('/api/trades?symbol=' + M.sym)]);
  if (gen !== M.gen) return;
  if (ks.status === 'fulfilled') M.bars = ks.value.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], n: +k[8], tb: +k[9] }));
  if (tr.status === 'fulfilled') tr.value.forEach(t => T.trades.push({ t: t.T, p: +t.p, q: +t.q, buy: !t.m }));
  touch(); loadSent(); loadBook(gen); openStream(gen); startCandles();
}
function openStream(gen) {
  const s = M.sym.toLowerCase();
  const ws = M.ws = new WebSocket(STREAM_URL() + [`${s}@kline_${M.iv}`, `${s}@aggTrade`, `${s}@bookTicker`].join('/'));
  let opened = false;
  ws.onopen = () => { opened = true; setStatus('stream', 'live'); };
  ws.onmessage = e => {
    if (gen !== M.gen) return;
    const { stream, data } = JSON.parse(e.data); markRx();
    if (stream.endsWith('@bookTicker')) onQuote(data); else if (stream.endsWith('@aggTrade')) onTrade(data); else onKline(data.k);
  };
  ws.onclose = () => { if (!opened && streamIdx < STREAMS.length - 1) streamIdx++; if (gen === M.gen) { setStatus('stream', 'retrying'); setTimeout(() => gen === M.gen && openStream(gen), opened ? 2000 : 200); } };
}
function onQuote(d) {
  const bid = +d.b, ask = +d.a, mid = (bid + ask) / 2, now = Date.now();
  if (mid > 0) { NAR.spreads.push((ask - bid) / mid); if (NAR.spreads.length > 2000) NAR.spreads.splice(0, 500); }
  if (M.quote && mid !== M.quote.mid) M.dir = mid > M.quote.mid ? 1 : -1;
  M.quote = { bid, ask, mid, t: now }; M.qcount++;
  const tfMs = CND.tf * 1000, ct = Math.floor(now / tfMs) * tfMs;
  if (!CND.qx || CND.qx.t !== ct || CND.qx.tf !== CND.tf) CND.qx = { t: ct, tf: CND.tf, h: mid, l: mid }; else { CND.qx.h = Math.max(CND.qx.h, mid); CND.qx.l = Math.min(CND.qx.l, mid); }
  const last = M.ticks[M.ticks.length - 1];
  if (!last || last.mid !== mid || now - last.t > 250) M.ticks.push({ t: now, mid, bid, ask });
  while (M.ticks.length && now - M.ticks[0].t > 16 * 60e3) M.ticks.shift();
  dirty.state = true;
}
function onTrade(d) {
  const t = { t: d.T, p: +d.p, q: +d.q, buy: !d.m };     // m = buyer is maker, so the seller was the aggressor
  if (CLK.ok && d.E) { CLK.lat.push(Date.now() + CLK.off - d.E); if (CLK.lat.length > 60) CLK.lat.shift(); }
  T.trades.push(t); if (T.trades.length > 30000) T.trades.splice(0, 5000);
  candleTrade(t);
  const dt = IV_MS[M.iv], b = M.bars[M.bars.length - 1];
  if (b && t.t >= b.t && t.t < b.t + dt) { b.c = t.p; b.h = Math.max(b.h, t.p); b.l = Math.min(b.l, t.p); b.v += t.q; if (t.buy) b.tb += t.q; b.n++; }
  else if (b && t.t >= b.t + dt) { M.bars.push({ t: Math.floor(t.t / dt) * dt, o: t.p, h: t.p, l: t.p, c: t.p, v: t.q, n: 1, tb: t.buy ? t.q : 0 }); if (M.bars.length > 1500) M.bars.shift(); }
  touch();
}
function onKline(k) {
  const b = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, n: +k.n, tb: +k.V };
  const i = M.bars.findIndex(x => x.t === b.t);
  if (i >= 0) M.bars[i] = b; else { M.bars.push(b); M.bars.sort((x, y) => x.t - y.t); if (M.bars.length > 1500) M.bars.shift(); }
  touch();
}
async function loadBook(gen = M.gen) {
  if (isFX(M.sym)) return;
  try {
    const since = M.book.length ? M.book[M.book.length - 1].t : 0;
    const r = await getJSON(`/api/book?symbol=${M.sym}&since=${since}`);
    if (gen !== M.gen) return;
    if (r.series.length) { M.book.push(...r.series); if (M.book.length > 30000) M.book.splice(0, M.book.length - 30000); touch(); }
    M.bookErr = r.err; setStatus('book', r.err ? 'error' : M.book.length ? 'recording' : 'starting');
  } catch { setStatus('book', 'error'); }
}
setInterval(() => loadBook(), 3000);
async function loadSent() {
  if (isFX(M.sym)) { M.sent = { available: false, series: [] }; return; }
  try { M.sent = await getJSON(`/api/sentiment?symbol=${M.sym}&interval=${M.iv}`); } catch { M.sent = { available: false, series: [] }; }
  touch();
}
async function loadFng() { try { M.fng = await getJSON('/api/fng'); } catch {} }
setInterval(loadSent, 60000); loadFng(); setInterval(loadFng, 600000);

/* ---------- §2 simple / advanced mode and the plain-language "right now" summary ---------- */
// Simple mode (default) shows the live chart, a one-paragraph summary, the depth chart and the demo account; the
// 10-dimensional 3D view is optional because it is powerful but hard to read at a glance.
const NAR = { spreads: [] };
const STATE_SIMPLE = () => document.getElementById('state')?.classList.contains('simple');
(function initStateMode() {
  const sec = document.getElementById('state'), btn = document.getElementById('stMode'); if (!sec || !btn) return;
  let simple = true; try { simple = localStorage.getItem('state-mode') !== 'advanced'; } catch {}
  const apply = () => { sec.classList.toggle('simple', simple); btn.textContent = simple ? 'Show advanced 3D view' : 'Back to simple view'; if (!simple) { dirty.state = true; setTimeout(() => { try { Plotly.Plots.resize('p8d'); } catch {} }, 50); } };
  btn.onclick = () => { simple = !simple; try { localStorage.setItem('state-mode', simple ? 'simple' : 'advanced'); } catch {} apply(); };
  apply();
})();
const word = (x, pos, neg, flat = 'flat') => x > 0 ? pos : x < 0 ? neg : flat;
function narrate() {
  const el = document.getElementById('plainNow'); if (!el || view !== 'state') return;
  const now = Date.now(), W = 5 * 60e3, tr = T.trades.filter(t => t.t > now - W), prev = T.trades.filter(t => t.t > now - 35 * 60e3 && t.t <= now - W);
  if (tr.length < 5) { el.innerHTML = 'Waiting for enough trades to describe the last 5 minutes…'; return; }
  const p0 = tr[0].p, p1 = tr[tr.length - 1].p, ch = p1 / p0 - 1, qty = tr.reduce((a, t) => a + t.q, 0), buy = tr.filter(t => t.buy).reduce((a, t) => a + t.q, 0), share = qty ? buy / qty : 0.5;
  const rate = tr.length / 5, prate = prev.length / 30, busy = prate > 0 ? rate / prate : null;
  const sp = M.quote?.mid ? (M.quote.ask - M.quote.bid) / M.quote.mid : null, spMed = NAR.spreads.length > 50 ? NAR.spreads.slice().sort((a, b) => a - b)[NAR.spreads.length >> 1] : null;
  const dp = Math.abs(ch) < 0.0002 ? 'is roughly unchanged' : `is <b class="${ch > 0 ? 'up' : 'down'}">${word(ch, 'up', 'down')} ${(100 * Math.abs(ch)).toFixed(2)} %</b>`;
  const pressure = share > 0.6 ? '<b class="up">buyers are in control</b>' : share < 0.4 ? '<b class="down">sellers are in control</b>' : 'buying and selling are <b>balanced</b>';
  const activity = busy == null ? '' : busy > 1.5 ? ` Trading is <b>${busy.toFixed(1)}× busier</b> than in the previous half hour.` : busy < 0.67 ? ` Trading is <b>quieter</b> than in the previous half hour (${busy.toFixed(1)}×).` : ' Trading activity is normal.';
  const spread = sp != null && spMed ? (sp > 2 * spMed ? ` The bid–ask spread is <b class="down">wider than usual</b> (${(1e4 * sp).toFixed(2)} bp vs ${(1e4 * spMed).toFixed(2)} bp), so trading costs more right now.` : ` The spread is normal (${(1e4 * sp).toFixed(2)} bp).`) : '';
  el.innerHTML = `<b>Right now (${String(M.sym).replace(/[<>&"]/g, "")}):</b> over the last 5 minutes the price ${dp}, and ${pressure} (${Math.round(100 * share)} % of the traded volume was bought aggressively).${activity}${spread} <span class="muted">A description of recent trades, not a forecast.</span>`;
}
setInterval(narrate, 1000);
/* ---------- clock sync with Binance (for honest latency numbers) ---------- */
const CLK = { off: 0, rtt: 0, ok: false, lat: [] };
async function syncClock() {
  try { const t0 = Date.now(), r = await getJSON('https://data-api.binance.vision/api/v3/time'), t1 = Date.now();
        if (!CLK.ok || t1 - t0 < CLK.rtt * 1.5) { CLK.off = r.serverTime - (t0 + t1) / 2; CLK.rtt = t1 - t0; } CLK.ok = true; } catch {}
}
syncClock(); setInterval(syncClock, 30000);

/* ---------- candlestick feed ---------- */
const CND = { tf: 15, base: '1s', bars: [], ws: null, gen: 0 };
async function startCandles() {
  const gen = ++CND.gen, tf = +$('ctf').value, base = tf < 60 ? '1s' : tf === 60 ? '1m' : tf === 300 ? '5m' : tf === 900 ? '15m' : '1h';
  Object.assign(CND, { tf, base, bars: [], qx: null });
  if (CND.ws) { CND.ws.onclose = null; CND.ws.close(); CND.ws = null; }
  if (isFX(M.sym)) {          // FX candles: recorded ticks (+ Yahoo history for ≥ 1 min); live updates come from fxBarTick
    try { const b = await getJSON(`/api/fx/bars?pair=${encodeURIComponent(M.sym.slice(3))}&interval=${base}`); if (gen === CND.gen) CND.bars = b; } catch {}
    dirty.state = true; return;
  }
  try {
    const ks = await getJSON(`/api/klines?symbol=${M.sym}&interval=${base}`);
    if (gen !== CND.gen) return;
    CND.bars = ks.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], tb: +k[9] }));
  } catch {}
  const open = () => {
    const ws = CND.ws = new WebSocket(STREAM_URL() + `${M.sym.toLowerCase()}@kline_${base}`);
    ws.onmessage = e => {
      if (gen !== CND.gen) return;
      const k = JSON.parse(e.data).data.k, b = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, tb: +k.V };
      const last = CND.bars[CND.bars.length - 1];
      if (last && last.t === b.t) CND.bars[CND.bars.length - 1] = b; else if (!last || b.t > last.t) CND.bars.push(b);
      if (CND.bars.length > 4000) CND.bars.splice(0, 500);
      dirty.state = true;
    };
    ws.onclose = () => { if (gen === CND.gen) setTimeout(() => gen === CND.gen && open(), 2000); };
  };
  open(); dirty.state = true;
}
// a trade moves the forming base bar instantly (price only; volume comes from the authoritative kline)
function candleTrade(t) {
  const b = CND.bars[CND.bars.length - 1], ms = { '1s': 1e3, '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3 }[CND.base];
  if (!b) return;
  if (t.t >= b.t && t.t < b.t + ms) { b.c = t.p; b.h = Math.max(b.h, t.p); b.l = Math.min(b.l, t.p); }
  else if (t.t >= b.t + ms) CND.bars.push({ t: Math.floor(t.t / ms) * ms, o: t.p, h: t.p, l: t.p, c: t.p, v: 0, tb: 0 });
}
function candles() {
  const tfMs = CND.tf * 1000, out = [];
  for (const b of CND.bars) {
    const t = Math.floor(b.t / tfMs) * tfMs, c = out[out.length - 1];
    if (c && c.t === t) { c.h = Math.max(c.h, b.h); c.l = Math.min(c.l, b.l); c.c = b.c; c.v += b.v; }
    else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
  }
  return out;
}
['ctf'].forEach(id => $(id).onchange = () => startCandles());
$('lmode').onchange = () => {
  const c = $('lmode').value === 'candles';
  document.querySelectorAll('.c-only').forEach(e => e.hidden = !c); document.querySelectorAll('.t-only').forEach(e => e.hidden = c);
  dirty.state = true;
};

function sample() {
  if (!cache.F) cache.F = Lab.features(M.bars, M.sent.available ? M.sent.series : [], M.book, IV_MS[M.iv]);
  return cache.F.slice(-(+$('win').value));
}
$('sym').onchange = $('iv').onchange = () => startMarket();
$('win').onchange = () => { cache.fc = null; touch(); };

/* ======================= dimension registry (selectable z / colour) ======================= */
const dep = l => l == null ? null : 10 ** l - 1;
const DIMS = {
  vol:   { name: 'Volume', short: 'Volume V', get: f => f.v, def: 'base volume in the bar' },
  svol:  { name: 'Signed volume', short: 'V_buy − V_sell', get: f => f.press * f.v, div: true, def: 'buyer- minus seller-initiated volume' },
  sigma: { name: 'Volatility', short: 'σ (%)', get: f => f.vol * 100, def: 'sd of the last 20 log-returns, %' },
  depth: { name: 'Liquidity (total depth)', short: 'Depth ±10bp', get: f => dep(f.liq), def: 'resting bid+ask depth within ±10 bp, quote ccy' },
  bid:   { name: 'Bid depth', short: 'Bid depth', get: f => dep(f.bidD), def: 'resting bids within 10 bp below mid' },
  ask:   { name: 'Ask depth', short: 'Ask depth', get: f => dep(f.askD), def: 'resting asks within 10 bp above mid' },
  imb:   { name: 'Book imbalance', short: '(bid−ask)/(bid+ask)', div: true, get: f => { const b = dep(f.bidD), a = dep(f.askD); return b == null ? null : (b - a) / ((b + a) || 1); }, def: 'depth imbalance' },
  press: { name: 'Buy/sell pressure', short: 'π', get: f => f.press, div: true, def: 'π = (2V_buy − V)/V' },
  sent:  { name: 'Sentiment', short: 'L − S share', get: f => f.sent, div: true, def: 'futures long − short account share' },
  trades:{ name: 'Trade count', short: 'N trades', get: f => f.n, def: 'executed trades in the bar' },
};
const fill = (sel, keys, dflt) => { sel.innerHTML = keys.map(k => `<option value="${k}"${k === dflt ? ' selected' : ''}>${DIMS[k].name}</option>`).join(''); };
fill($('zax'), Object.keys(DIMS), 'vol');
fill($('cax'), ['sigma', 'press', 'imb', 'sent', 'depth', 'svol', 'trades'], 'sigma');
try { const z = localStorage.getItem('zax'), c = localStorage.getItem('cax'); if (z && DIMS[z]) $('zax').value = z; if (c && DIMS[c]) $('cax').value = c; } catch {}
['zax', 'cax'].forEach(id => $(id).onchange = () => { try { localStorage.setItem(id, $(id).value); } catch {} cache.fc = null; dirty.state = true; });

function encTable() {
  const z = $('zax').value, c = $('cax').value;
  const rows = [
    ['Time', 'x-axis', 't − now, in bar units'], ['Price', 'y-axis', 'close C_t; live mid at t = 0'],
    ['Volume', null, DIMS.vol.def, 'vol'], ['Volatility', null, DIMS.sigma.def, 'sigma'],
    ['Liquidity', null, DIMS.depth.def + '; open marker = not yet recorded', 'depth', 'marker size'],
    ['Buy/sell pressure', null, 'π = (2V_buy − V)/V; ◆ π>0.2 · ■ π<−0.2 · ● otherwise', 'press', 'marker shape'],
    ['Sentiment', null, DIMS.sent.def, 'sent', 'floor-path colour'],
    ['Future-price p.d.f.', 'surface', 'KDE of C·e^(r_h), h = 2…30 bars'],
    ['Bid depth', null, DIMS.bid.def + '; Fig. 2b ↑', 'bid', 'stem colour'],
    ['Ask depth', null, DIMS.ask.def + '; Fig. 2b ↓', 'ask', 'stem colour'],
  ];
  $('encBody').innerHTML = rows.map(([n, fixed, d, key, other], i) => {
    const ch = fixed || [key === z && 'z-axis', key === c && 'colour', other].filter(Boolean).join(' · ') || 'hover';
    return `<tr><td>${i + 1}</td><td>${n}</td><td class="ch">${ch}</td><td>${d}</td></tr>`;
  }).join('') + (['svol', 'imb', 'trades'].includes(z) || ['svol', 'imb', 'trades'].includes(c)
    ? `<tr><td>+</td><td>${[z, c].filter(k => ['svol', 'imb', 'trades'].includes(k)).map(k => DIMS[k].name).join(', ')}</td><td class="ch">${[z === 'svol' || z === 'imb' || z === 'trades' ? 'z-axis' : '', c === 'svol' || c === 'imb' || c === 'trades' ? 'colour' : ''].filter(Boolean).join(' · ')}</td><td>derived</td></tr>` : '');
}

/* ======================= §2 live quote + state space ======================= */
function cell(k, v, s = '', cls = '') { return `<div class="${cls.startsWith('big') ? cls : ''}"><span class="k">${k}</span><span class="v ${cls.startsWith('big') ? '' : cls}">${v}</span>${s ? `<span class="s">${s}</span>` : ''}</div>`; }
let lastEnc = '';
/* ---------- Figure 2a: canvas renderer, drawn on every display frame ---------- */
// Candles with the forming candle driven by the live mid quote (broker-style), or a tick line.
function candlesLive() {
  const cs = candles(), q = M.quote;
  if ($('csrc').value !== 'quote' || !q || !cs.length) return cs;
  const tfMs = CND.tf * 1000, cur = Math.floor(Date.now() / tfMs) * tfMs, qx = CND.qx && CND.qx.t === cur ? CND.qx : null;
  let last = cs[cs.length - 1];
  if (cur > last.t) cs.push({ t: cur, o: last.c, h: Math.max(last.c, qx ? qx.h : q.mid), l: Math.min(last.c, qx ? qx.l : q.mid), c: q.mid, v: 0 });
  else if (cur === last.t) cs[cs.length - 1] = { ...last, c: q.mid, h: Math.max(last.h, q.mid, qx ? qx.h : -Infinity), l: Math.min(last.l, q.mid, qx ? qx.l : Infinity) };
  return cs;
}
const LV = { cv: $('cLive'), ctx: $('cLive').getContext('2d'), w: 0, h: 0, dpr: 1, p: null, lo: null, hi: null, last: 0, mouse: null, col: null, colAt: 0, hintAt: 0 };
LV.cv.addEventListener('mousemove', e => { const r = LV.cv.getBoundingClientRect(); LV.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
LV.cv.addEventListener('mouseleave', () => { LV.mouse = null; });
const niceStep = (range, n) => { const raw = range / n || 1, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
const TSTEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400].map(x => x * 1000);
function drawLiveCanvas(ts) {
  if (LAT.pending) { LAT.pending = false; LAT.screen.push(performance.now() - LAT.rx); if (LAT.screen.length > 120) LAT.screen.shift(); }
  const L = LV, wrap = L.cv.parentElement, r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (!r.width || !r.height) return;
  if (r.width !== L.w || r.height !== L.h || dpr !== L.dpr) {
    Object.assign(L, { w: r.width, h: r.height, dpr }); L.cv.width = Math.round(r.width * dpr); L.cv.height = Math.round(r.height * dpr);
    L.cv.style.width = r.width + 'px'; L.cv.style.height = r.height + 'px';
  }
  if (!L.col || ts - L.colAt > 500) { L.colAt = ts; L.col = { text: css('--text'), muted: css('--muted'), grid: css('--grid'), line: css('--line'), acc: css('--accent'), acc2: css('--accent2'), up: css('--buy'), dn: css('--sell'), panel: css('--panel-solid'), dark: isDark() }; }
  const C = L.col, ctx = L.ctx, w = L.w, h = L.h, now = Date.now(), q = M.quote, mode = $('lmode').value;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const frameDt = L.last ? Math.min(ts - L.last, 250) : 16; L.last = ts;
  const tau = +$('smooth').value, ease = (cur, target, k = 1) => cur == null || !tau ? target : cur + (target - cur) * (1 - Math.exp(-frameDt / (tau * k)));

  const padR = 84, padB = 22, top = 8, x1 = w - padR, yb = h - padB;
  let left, right, items = [], tfMs = 0, cs = null, tk = null, tr = null;
  if (mode === 'candles') {
    tfMs = CND.tf * 1000; cs = candlesLive().slice(-(+$('cn').value));
    if (!cs.length) { ctx.fillStyle = C.muted; ctx.font = '12px "IBM Plex Mono", monospace'; ctx.fillText('loading candles…', 12, 24); return; }
    right = now + tfMs * 3; left = right - (cs.length + 3) * tfMs;
  } else {
    const span = +$('lspan').value * 1000; left = now - span; right = now + span * 0.05;
    tk = M.ticks.filter(t => t.t >= left - 5000); tr = T.trades.filter(t => t.t >= left).slice(-2000);
  }
  const target = q ? q.mid : cs ? cs[cs.length - 1].c : null;
  if (target == null) return;
  L.p = ease(L.p, target);
  // y-range (eased so the scale never jumps)
  let lo = L.p, hi = L.p;
  if (cs) for (const c of cs) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
  else { for (const t of tk) { lo = Math.min(lo, t.bid); hi = Math.max(hi, t.ask); } for (const t of tr) { lo = Math.min(lo, t.p); hi = Math.max(hi, t.p); } }
  const pad = (hi - lo) * 0.08 || target * 2e-5; lo -= pad; hi += pad;
  L.lo = ease(L.lo, lo, 4); L.hi = ease(L.hi, hi, 4);
  const volH = cs ? (yb - top) * 0.18 : 0, pb = yb - volH - 6;
  const X = t => (t - left) / (right - left) * x1, Y = p => top + (L.hi - p) / (L.hi - L.lo) * (pb - top);
  const step = niceStep(L.hi - L.lo, Math.max(3, Math.floor((pb - top) / 48)));
  const dec = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  ctx.font = '11px "IBM Plex Mono", monospace'; ctx.textBaseline = 'middle';
  // grid + price labels
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.fillStyle = C.muted;
  for (let p = Math.ceil(L.lo / step) * step; p <= L.hi; p += step) { const y = Math.round(Y(p)) + 0.5; if (y < top || y > pb) continue;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.fillText(p.toFixed(dec), x1 + 8, y); }
  const tstep = TSTEPS.find(s => (right - left) / s <= Math.max(3, x1 / 110)) || 14400e3;
  ctx.textAlign = 'center';
  for (let t = Math.ceil(left / tstep) * tstep; t <= right; t += tstep) { const x = Math.round(X(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, yb); ctx.stroke();
    const d = new Date(t); ctx.fillText(tstep < 60e3 ? d.toTimeString().slice(0, 8) : d.toTimeString().slice(0, 5), x, yb + 11); }
  ctx.textAlign = 'left';
  ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(x1 + 0.5, top); ctx.lineTo(x1 + 0.5, yb); ctx.moveTo(0, yb + 0.5); ctx.lineTo(x1, yb + 0.5); ctx.stroke();

  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x1, yb); ctx.clip();
  if (cs) {
    const cw = tfMs / (right - left) * x1, bw = Math.max(1, cw * 0.66), vmax = Math.max(...cs.map(c => c.v)) || 1;
    cs.forEach((c, i) => {
      const isLast = i === cs.length - 1, close = isLast && $('csrc').value === 'quote' ? L.p : c.c;
      const hiC = isLast ? Math.max(c.h, close) : c.h, loC = isLast ? Math.min(c.l, close) : c.l;
      const upC = close >= c.o, col = upC ? C.up : C.dn, xc = X(c.t + tfMs / 2);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(xc) + 0.5, Y(hiC)); ctx.lineTo(Math.round(xc) + 0.5, Y(loC)); ctx.stroke();
      const y0 = Y(Math.max(c.o, close)), y1 = Y(Math.min(c.o, close));
      ctx.globalAlpha = C.dark ? 0.75 : 1; ctx.fillStyle = col;
      if (isLast && C.dark) { ctx.shadowColor = col; ctx.shadowBlur = 14; }
      ctx.fillRect(xc - bw / 2, y0, bw, Math.max(1, y1 - y0)); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      if (c.v > 0) { ctx.globalAlpha = 0.35; ctx.fillRect(xc - bw / 2, yb - c.v / vmax * volH, bw, c.v / vmax * volH); ctx.globalAlpha = 1; }
    });
  } else {
    ctx.fillStyle = C.dark ? 'rgba(0,229,255,0.07)' : 'rgba(31,78,140,0.07)'; ctx.beginPath();
    tk.forEach((t, i) => { const x = X(t.t), nx = i + 1 < tk.length ? X(tk[i + 1].t) : X(now); ctx.rect(x, Y(t.ask), nx - x, Y(t.bid) - Y(t.ask)); }); ctx.fill();
    const grad = ctx.createLinearGradient(0, top, 0, pb); grad.addColorStop(0, C.dark ? 'rgba(0,255,156,0.22)' : 'rgba(10,125,85,0.15)'); grad.addColorStop(1, 'rgba(0,255,156,0)');
    ctx.beginPath(); let started = false, py = 0;
    for (const t of tk) { const x = X(t.t), y = Y(t.mid); if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, py); ctx.lineTo(x, y); } py = y; }
    if (started) { ctx.lineTo(X(now), py); ctx.lineTo(X(now), Y(L.p)); }
    ctx.strokeStyle = C.acc; ctx.lineWidth = 2; if (C.dark) { ctx.shadowColor = C.acc; ctx.shadowBlur = 10; } ctx.stroke(); ctx.shadowBlur = 0;
    if (started) { ctx.lineTo(X(now), pb); ctx.lineTo(X(tk[0].t), pb); ctx.closePath(); ctx.fillStyle = grad; ctx.fill(); }
    const maxQ = Math.max(1e-12, ...tr.map(t => t.q));
    for (const t of tr) { ctx.globalAlpha = 0.85; ctx.fillStyle = t.buy ? C.up : C.dn; ctx.beginPath(); ctx.arc(X(t.t), Y(t.p), 1.5 + 5 * Math.sqrt(t.q / maxQ), 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    const pr = 4 + 2.5 * (1 + Math.sin(ts / 220)); ctx.fillStyle = C.acc; ctx.shadowColor = C.acc; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(X(now), Y(L.p), pr, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  }
  if (window.tradeOverlay) window.tradeOverlay(ctx, Y, x1, top, pb, C);
  // current price line
  const yp = Y(L.p); ctx.setLineDash([5, 4]); ctx.strokeStyle = M.dir < 0 ? C.dn : C.acc; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, Math.round(yp) + 0.5); ctx.lineTo(x1, Math.round(yp) + 0.5); ctx.stroke(); ctx.setLineDash([]);
  // crosshair
  let hover = null;
  if (L.mouse && L.mouse.x < x1 && L.mouse.y < yb) {
    const { x, y } = L.mouse; ctx.strokeStyle = C.muted; ctx.globalAlpha = 0.6; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(x + 0.5, top); ctx.lineTo(x + 0.5, yb); ctx.moveTo(0, y + 0.5); ctx.lineTo(x1, y + 0.5); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const tAt = left + x / x1 * (right - left);
    if (cs) hover = cs.find(c => tAt >= c.t && tAt < c.t + tfMs);
    hover = { t: tAt, p: L.hi - (y - top) / (pb - top) * (L.hi - L.lo), c: hover };
  }
  ctx.restore();
  // price tag (+ countdown for candles)
  const tagH = cs ? 32 : 20, ty = Math.min(Math.max(yp - tagH / 2, top), yb - tagH);
  ctx.fillStyle = M.dir < 0 ? C.dn : C.acc; if (C.dark) { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12; }
  ctx.fillRect(x1 + 2, ty, padR - 4, tagH); ctx.shadowBlur = 0;
  ctx.fillStyle = C.dark ? '#00170e' : '#ffffff'; ctx.font = '600 12px "IBM Plex Mono", monospace';
  ctx.fillText(sig(L.p, 7), x1 + 7, ty + 10);
  if (cs) { const lastC = cs[cs.length - 1], left_ = Math.max(0, lastC.t + tfMs - now); ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(`${Math.floor(left_ / 60000)}:${String(Math.floor(left_ / 1000) % 60).padStart(2, '0')}.${Math.floor(left_ / 100) % 10}`, x1 + 7, ty + 24); }
  if (hover) {
    ctx.fillStyle = C.panel; ctx.fillRect(x1 + 2, L.mouse.y - 9, padR - 4, 18); ctx.fillStyle = C.text; ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(hover.p.toFixed(dec + 1), x1 + 7, L.mouse.y);
  }
  // header line (OHLC / hover), throttled DOM write
  if (ts - L.hintAt > 100) {
    L.hintAt = ts;
    const c = hover?.c || (cs && cs[cs.length - 1]);
    $('liveHint').textContent = cs
      ? `${hover?.c ? new Date(c.t).toLocaleTimeString() + ' · ' : ''}O ${sig(c.o, 7)}  H ${sig(c.h, 7)}  L ${sig(c.l, 7)}  C ${sig(hover?.c ? c.c : L.p, 7)}${c.v ? '  V ' + fmt(c.v, 4) : ''}`
      : `Tick-by-tick best bid/ask with trades (● buy · ● sell) · ${M.qps} quotes/s`;
  }
}

/* ---------- 10-D scene: interaction state ---------- */
const frac = x => x - Math.floor(x);
const V3 = { layers: { bars: true, stems: true, path: true, cloud: true, now: true, box: true }, cam: { eye: { x: 1.5, y: -1.75, z: 0.75 }, up: { x: 0, y: 0, z: 1 } },
             camRev: 0, rotate: false, sel: null, box: null, fcRef: null, fcPts: [] };
try { const l = JSON.parse(localStorage.getItem('layers3d') || 'null'); if (l) Object.assign(V3.layers, l); } catch {}
const LAYERS = [['bars', 'Bars (dots)'], ['stems', 'Stems'], ['path', 'Price path'], ['cloud', 'Future cloud'], ['now', 'Live price'], ['box', 'Sprinkle box']];
function renderLayerChips() { $('layers').innerHTML = LAYERS.map(([k, n]) => `<button class="btn chip ${V3.layers[k] ? 'on' : ''}" data-l="${k}">${V3.layers[k] ? '☑' : '☐'} ${n}</button>`).join(''); }
renderLayerChips();
$('layers').onclick = e => { const k = e.target.closest('[data-l]')?.dataset.l; if (!k) return; V3.layers[k] = !V3.layers[k];
  try { localStorage.setItem('layers3d', JSON.stringify(V3.layers)); } catch {} renderLayerChips(); dirty.state = true; };
const VIEWS = { '3d': { eye: { x: 1.5, y: -1.75, z: 0.75 } }, top: { eye: { x: 0, y: -0.001, z: 2.6 } }, front: { eye: { x: 0, y: -2.6, z: 0.05 } }, side: { eye: { x: 2.6, y: 0, z: 0.05 } } };
$('views').onclick = e => { const v = e.target.closest('[data-v]')?.dataset.v; if (!v) return;
  if (v === 'rotate') { V3.rotate = !V3.rotate; if (!V3.rotate && V3.lastCam) { V3.cam = V3.lastCam; V3.camRev++; } e.target.closest('button').classList.toggle('on', V3.rotate); }
  else { V3.rotate = false; document.querySelector('#views [data-v="rotate"]')?.classList.remove('on'); V3.cam = { ...VIEWS[v], up: { x: 0, y: 0, z: 1 } }; V3.camRev++; }
  dirty.state = true; };
$('inspect').onclick = e => { if (e.target.closest('[data-x]')) { V3.sel = null; $('inspect').innerHTML = INSPECT_EMPTY; dirty.state = true; } };
const INSPECT_EMPTY = '<div class="s">Click any dot in the 3D graph to see what was happening in that bar, in plain words.</div>';
$('inspect').innerHTML = INSPECT_EMPTY;
// Plain-language explanation of one bar, with each value ranked against the rest of the sample.
function explainBar(f, F, Z, zval) {
  const rank = get => { const v = get(f); if (v == null) return null; const vals = F.map(get).filter(x => x != null);
    if (!vals.length || Math.max(...vals) === Math.min(...vals)) return null;             // no spread to rank against
    return vals.filter(x => x <= v).length / vals.length; };
  const fxAny = isFX(M.sym), fx = fxAny && fxTickVolume();   // fx: tick-volume semantics (interbank feed or no Kraken market)
  const lvl = p => p == null ? '' : p > 0.9 ? 'very high' : p > 0.7 ? 'high' : p >= 0.3 ? 'typical' : p >= 0.1 ? 'low' : 'very low';
  const i = F.indexOf(f), prev = F[i - 1], ch = prev ? f.c / prev.c - 1 : 0;
  const buy = f.v > 0 ? (f.press + 1) / 2 : null, b = dep(f.bidD), a = dep(f.askD);
  const who = buy == null ? (fx ? 'no tick data for this bar (older history from Yahoo has prices only)' : 'no trades in this bar')
    : fx ? (buy > 0.6 ? `<b class="pos">price was ticking up</b> (${pct(buy, 0)} of quote changes were upticks)` : buy < 0.4 ? `<b class="neg">price was ticking down</b> (${pct(1 - buy, 0)} downticks)` : `up- and downticks were balanced (${pct(buy, 0)} upticks)`) : buy > 0.6 ? `<b class="pos">buyers were in control</b> (${pct(buy, 0)} of volume was buyers hitting the ask)`
    : buy < 0.4 ? `<b class="neg">sellers were in control</b> (${pct(1 - buy, 0)} of volume was sellers hitting the bid)` : `buyers and sellers were balanced (${pct(buy, 0)} buy volume)`;
  const book = fxAny ? 'not applicable: interbank FX has no public order book' : b == null ? 'not recorded yet (this bar is from before the server started recording the order book)'
    : `$${fmt(b, 0)} of bids vs $${fmt(a, 0)} of asks waiting within 0.1 % of the price: ${Math.abs(b - a) / (a + b) < 0.1 ? 'balanced' : b > a ? '<b class="pos">more buyers waiting</b>' : '<b class="neg">more sellers waiting</b>'}`;
  const row = (k, v) => `<div class="ir"><span class="k">${k}</span><span>${v}</span></div>`;
  return `<div class="tp-head"><b>Bar at ${new Date(f.t).toLocaleTimeString()}</b><button class="btn small" data-x="1">✕</button></div>` +
    row('Price', `closed at <b>${sig(f.c, 7)}</b>, ${ch === 0 ? 'unchanged' : (ch > 0 ? '<span class="pos">up ' : '<span class="neg">down ') + fmt(Math.abs(ch) * 1e4, 2) + ' bp</span>'} from the previous bar`) +
    row('Height (z)', `${Z.name}: <b>${zval == null ? 'n/a' : sig(zval, 5)}</b>`) +
    row(fx ? 'Tick volume' : 'Volume', fx ? (f.v > 0 ? `${fmt(f.v, 0)} quote changes, ${lvl(rank(x => x.v)) || 'n/a'} for this sample` : 'not recorded (Yahoo history)')
      : `${fmt(f.v, 4)} traded, ${lvl(rank(x => x.v)) || 'n/a'} for this sample`) +
    row('Who pushed', who) +
    row('Volatility', `${sig(f.vol * 100, 3)} % per bar, ${lvl(rank(x => x.vol))}: ${rank(x => x.vol) > 0.7 ? 'the price was swinging more than usual' : rank(x => x.vol) < 0.3 ? 'a calm period' : 'normal movement'}`) +
    row('Order book', book) +
    row('Liquidity', fxAny ? 'not measurable for interbank FX' : f.liq == null ? 'unknown' : `$${fmt(dep(f.liq), 0)} total, ${lvl(rank(x => x.liq))}. More liquidity means big orders move the price less.`) +
    row('Sentiment', f.sent == null ? 'not available for this instrument' : `${pct((f.sent + 1) / 2, 0)} of futures accounts were long: ${f.sent > 0.2 ? 'traders leaned bullish' : f.sent < -0.2 ? 'traders leaned bearish' : 'roughly neutral'}`);
}

function drawState() {
  const F = sample(); if (F.length < 40) return;
  const dt = IV_MS[M.iv], now = Date.now(), rel = t => (t - now) / dt, t0 = F[F.length - 1].t;
  const Z = DIMS[$('zax').value], C = DIMS[$('cax').value];
  if (!cache.fc || now - cache.fcAt > 2000) { cache.fc = Lab.forecast(F); cache.fcAt = now; }
  const fc = cache.fc, q = M.quote;
  const zv = F.map(f => Z.get(f)), cv = F.map(f => C.get(f));
  const zAbs = Math.max(1e-12, ...zv.filter(v => v != null).map(Math.abs));
  const liqs = F.map(f => f.liq).filter(l => l != null), lmin = Math.min(...liqs), lmax = Math.max(...liqs), cover = liqs.length / F.length;
  const size = l => l == null ? 3 : 4 + 12 * ((l - lmin) / ((lmax - lmin) || 1));
  const shape = (p, l) => (p > 0.2 ? 'diamond' : p < -0.2 ? 'square' : 'circle') + (l == null ? '-open' : '');
  const stemX = [], stemY = [], stemZ = [], stemC = [];
  F.forEach((f, i) => { if (zv[i] == null) return; const x = rel(f.t), d = f.bidD == null ? 0 : f.bidD - f.askD;
    stemX.push(x, x, null); stemY.push(f.c, f.c, null); stemZ.push(0, zv[i], null); stemC.push(d, d, d); });
  const dAbs = Math.max(0.05, ...stemC.map(Math.abs));
  const cvals = cv.filter(v => v != null), cAbs = Math.max(1e-12, ...cvals.map(Math.abs));
  const hover = F.map((f, i) => [new Date(f.t).toLocaleString(), sig(f.c, 7), fmt(f.v, 4), sig(f.vol * 100, 3), fmt(dep(f.liq), 0), fmt(f.press, 2),
    f.sent == null ? 'n/a' : fmt(f.sent, 3), f.bidD == null ? '–' : '$' + fmt(dep(f.bidD), 0), f.askD == null ? '–' : '$' + fmt(dep(f.askD), 0), Z.name, zv[i] == null ? 'n/a' : sig(zv[i], 5),
    f.v > 0 ? pct((f.press + 1) / 2, 0) : '–']);
  // ---- layers (toggle chips), sprinkle clouds, click-to-inspect, camera presets ----
  const LY = V3.layers, xs = F.map(f => rel(f.t)), xEnd = rel(t0) + (fc ? fc.H : 1);
  const traces = [];
  const yLo = Math.min(...F.map(f => f.c), q ? q.mid : Infinity, ...(fc ? fc.q05 : [])), yHi = Math.max(...F.map(f => f.c), q ? q.mid : -Infinity, ...(fc ? fc.q95 : []));
  const zMin = Math.min(0, ...zv.filter(v => v != null)), zMax = Math.max(0, ...zv.filter(v => v != null));
  if (LY.box) {     // faint cuboid of sprinkles marking the volume (fixed pseudo-random points, rescaled to the data box)
    if (!V3.box) V3.box = Array.from({ length: 700 }, (_, i) => [frac(i * 0.754877666), frac(i * 0.569840291), frac(i * 0.362348484)]);
    traces.push({ type: 'scatter3d', mode: 'markers', hoverinfo: 'skip', name: 'box',
      x: V3.box.map(p => xs[0] + p[0] * (xEnd - xs[0])), y: V3.box.map(p => yLo + p[1] * (yHi - yLo)), z: V3.box.map(p => zMin + p[2] * (zMax - zMin)),
      marker: { size: 1.6, color: css('--accent'), opacity: isDark() ? 0.22 : 0.3, line: { width: 0 } } });
  }
  if (LY.stems) traces.push({ type: 'scatter3d', mode: 'lines', x: stemX, y: stemY, z: stemZ, hoverinfo: 'skip', name: 'stems',
    line: { width: 3, color: stemC, cmin: -dAbs, cmax: dAbs, colorscale: divScale() } });
  if (LY.path) traces.push({ type: 'scatter3d', mode: 'lines', x: xs, y: F.map(f => f.c), z: F.map(() => zMin), hoverinfo: 'skip', name: 'path',
    line: M.sent.available ? { width: 5, color: F.map(f => f.sent ?? 0), colorscale: [[0, '#2f7bff'], [0.5, '#7a8a85'], [1, '#ff9f43']], cmin: -1, cmax: 1 }
                           : { width: 4, color: css('--accent2') } });
  if (LY.bars) traces.push({ type: 'scatter3d', mode: 'markers', name: 'bars', x: xs, y: F.map(f => f.c), z: zv, customdata: hover,
    marker: { size: F.map(f => size(f.liq)), symbol: F.map(f => shape(f.press, f.liq)), opacity: 0.95, line: { width: 0 },
      color: cv.map(v => v ?? 0), colorscale: C.div ? divScale() : seqScale(), ...(C.div ? { cmin: -cAbs, cmax: cAbs } : {}),
      colorbar: { title: { text: 'colour: ' + C.short, side: 'right', font: { color: css('--muted') } }, thickness: 10, len: 0.55, x: 1.0, tickfont: { color: css('--muted') } } },
    hovertemplate: '<b>%{customdata[0]}</b><br>price %{customdata[1]}<br>%{customdata[9]}: %{customdata[10]}<br>buyers %{customdata[11]} of volume<br>book: bids %{customdata[7]} · asks %{customdata[8]}<br><i>click for full explanation</i><extra></extra>' });
  const sel = V3.sel != null ? F.findIndex(f => f.t === V3.sel) : -1;
  if (sel >= 0 && zv[sel] != null) traces.push({ type: 'scatter3d', mode: 'markers', hoverinfo: 'skip', name: 'sel', x: [xs[sel]], y: [F[sel].c], z: [zv[sel]],
    marker: { size: 18, symbol: 'circle-open', color: css('--warn'), line: { width: 3, color: css('--warn') } } });
  if (q && LY.now) {
    const zl = zv[zv.length - 1] ?? 0;
    traces.push({ type: 'scatter3d', mode: 'lines', x: [xs[0], xEnd], y: [q.mid, q.mid], z: [zMin, zMin], line: { color: css('--accent'), width: 2, dash: 'dash' }, hoverinfo: 'skip', name: 'nowline' });
    traces.push({ type: 'scatter3d', mode: 'markers+text', x: [0], y: [q.mid], z: [zl], text: [' now ' + sig(q.mid, 7)], textposition: 'middle right',
      textfont: { color: css('--accent'), size: 11, family: 'IBM Plex Mono' }, hoverinfo: 'skip', name: 'now',
      marker: { size: 7, color: M.dir < 0 ? css('--sell') : css('--accent'), line: { width: 0 } } });
  }
  if (fc && LY.cloud) {   // future-price distribution as a cloud of sprinkles: denser where price has more often gone
    if (V3.fcRef !== fc) {
      V3.fcRef = fc; const pts = []; const dmax = Math.max(...fc.dens.flat()) || 1, dy = fc.prices[1] - fc.prices[0], dh = fc.hs[1] - fc.hs[0];
      let k = 0;
      fc.hs.forEach((h, hi) => fc.prices.forEach((p, yi) => {
        const n = Math.round(6 * fc.dens[hi][yi] / dmax);
        for (let j = 0; j < n; j++, k++) pts.push([h + (frac(k * 0.618034) - 0.5) * dh, p + (frac(k * 0.414214) - 0.5) * dy, frac(k * 0.732051), fc.dens[hi][yi] / dmax]);
      }));
      V3.fcPts = pts;
    }
    const xo = rel(t0), zr = (zMax - zMin) || 1;
    traces.push({ type: 'scatter3d', mode: 'markers', name: 'cloud', x: V3.fcPts.map(p => xo + p[0]), y: V3.fcPts.map(p => p[1]), z: V3.fcPts.map(p => zMin + p[2] * zr * 0.5),
      marker: { size: 2.2, color: V3.fcPts.map(p => p[3]), colorscale: [[0, 'rgba(179,136,255,0.25)'], [1, css('--violet')]], cmin: 0, cmax: 1, opacity: 0.7, line: { width: 0 } },
      hovertemplate: `in %{x:.0f} ${IV_UNIT[M.iv]}: price %{y:.6g}<br>(past behaviour, not a prediction)<extra></extra>` });
    [['q05', 'dash', '5 %'], ['q50', 'solid', 'median'], ['q95', 'dash', '95 %']].forEach(([key, d]) =>
      traces.push({ type: 'scatter3d', mode: 'lines', x: fc.hs.map(h => xo + h), y: fc[key], z: fc.hs.map(() => zMin), line: { color: css('--violet'), width: 3, dash: d }, hoverinfo: 'skip', name: key }));
  }
  let cam = V3.cam, uirev = M.sym + M.iv + ':' + V3.camRev;
  if (V3.rotate) { const a = performance.now() / 7000; cam = { eye: { x: 2.1 * Math.cos(a), y: 2.1 * Math.sin(a), z: 0.75 }, up: { x: 0, y: 0, z: 1 } }; V3.lastCam = cam; uirev = 'rot' + performance.now(); }
  const noBg = { showbackground: false, gridcolor: css('--grid'), zeroline: false };
  plot('p8d', traces, base({ margin: { t: 0, l: 0, r: 0, b: 0 }, uirevision: uirev,
    scene: { xaxis: ax3(`time (${IV_UNIT[M.iv]}, 0 = now)`, noBg), yaxis: ax3('price', { ...noBg, tickformat: '.6~g' }), zaxis: ax3(Z.name.toLowerCase(), noBg),
      aspectmode: 'manual', aspectratio: { x: 1.8, y: 1, z: 0.7 }, camera: cam, dragmode: 'turntable', uirevision: uirev } }));
  const gd = $('p8d');
  if (gd.on && !gd._inspectBound) {
    gd._inspectBound = true;
    gd.on('plotly_click', ev => {
      const p = ev.points.find(pt => pt.data.name === 'bars'); if (!p) return;
      const Fs = sample(); const f = Fs.find(x => Math.abs(rel(x.t) - p.x) < 1e-9 && x.c === p.y) || Fs[p.pointNumber];
      if (f) { V3.sel = f.t; dirty.state = true; }
    });
  }
  if (sel >= 0) $('inspect').innerHTML = explainBar(F[sel], F, Z, zv[sel]);

  // Figure 2b — depth profile (refresh at most every second; book changes every 3 s)
  if (!drawState.dAt || now - drawState.dAt > 1000) {
    drawState.dAt = now;
    const bk = M.book.filter(o => o.t >= F[0].t), bx = bk.map(o => new Date(o.t));
    plot('pDepth', [
      { type: 'scatter', mode: 'lines', name: 'bid depth', x: bx, y: bk.map(o => o.bd), fill: 'tozeroy', fillcolor: 'rgba(0,255,156,0.15)', line: { color: css('--buy'), width: 1 }, hovertemplate: '%{x|%H:%M:%S}<br>bid %{y:,.0f}<extra></extra>' },
      { type: 'scatter', mode: 'lines', name: 'ask depth', x: bx, y: bk.map(o => -o.ad), customdata: bk.map(o => o.ad), fill: 'tozeroy', fillcolor: 'rgba(255,61,113,0.15)', line: { color: css('--sell'), width: 1 }, hovertemplate: '%{x|%H:%M:%S}<br>ask %{customdata:,.0f}<extra></extra>' },
      { type: 'scatter', mode: 'lines', name: 'imbalance', x: bx, y: bk.map(o => o.imb), yaxis: 'y2', line: { color: css('--accent2'), width: 1, dash: 'dot' }, hovertemplate: 'imbalance %{y:.3f}<extra></extra>' },
    ], base({ showlegend: true, legend: { orientation: 'h', y: 1.14, x: 0, font: { color: css('--muted') } }, margin: { t: 30, l: 70, r: 56, b: 36 },
      xaxis: ax('', { type: 'date', range: [new Date(F[0].t), new Date(now)] }),
      yaxis: ax('depth ±10 bp (bid ↑ / ask ↓)', { tickformat: '~s' }),
      yaxis2: ax('(bid − ask)/(bid + ask)', { overlaying: 'y', side: 'right', range: [-1, 1], showgrid: false, mirror: false }) }));
  }

  const L = F[F.length - 1], ob = M.book[M.book.length - 1], s = M.sent;
  const prevMid = M.ticks.find(t => t.t >= now - 60e3)?.mid, ch = q && prevMid ? q.mid / prevMid - 1 : null;
  $('readout').innerHTML =
    cell('Live mid', q ? sig(q.mid, 7) : sig(L.c, 7), q ? `bid ${sig(q.bid, 7)} · ask ${sig(q.ask, 7)}` : 'waiting for quotes', 'big ' + (M.dir > 0 ? 'up' : M.dir < 0 ? 'down' : '')) +
    cell('Δ 60 s', ch == null ? '–' : (ch >= 0 ? '+' : '') + (ch * 1e4).toFixed(2) + ' bp', q ? `spread ${fmt((q.ask - q.bid) / q.mid * 1e4, 2)} bp` : '', ch > 0 ? 'pos' : ch < 0 ? 'neg' : '') +
    cell('σ, 20-bar', sig(L.vol * 100, 3) + ' %', 'per bar') +
    cell('Depth ±10 bp', ob ? fmt(ob.bd + ob.ad, 0) : '–', ob ? `bid ${fmt(ob.bd, 0)} / ask ${fmt(ob.ad, 0)} · ${pct(cover, 0)} of bars` : 'recorder starting') +
    cell('Pressure π', fmt(L.press, 2), ob ? `book imbalance ${fmt(ob.imb, 2)}` : '', L.press > 0 ? 'pos' : L.press < 0 ? 'neg' : '') +
    cell('Sentiment', s.available && s.series.length ? fmt(s.series[s.series.length - 1].ratio, 3) : 'n/a', s.available ? `L/S ratio · funding ${pct(s.funding, 4)}` : 'no futures market') +
    cell('Fear & Greed', M.fng ? M.fng.value : '–', M.fng ? M.fng.value_classification + ' (crypto-wide)' : '') +
    cell(`P(up), h=${fc?.H ?? 30}`, fc ? pct(fc.pUp) : '–', fc ? `90 %: ${sig(fc.q05.at(-1), 6)}–${sig(fc.q95.at(-1), 6)}` : '');
  const enc = $('zax').value + $('cax').value;
  if (enc !== lastEnc) { lastEnc = enc; encTable(); }
  $('sentNote').textContent = isFX(M.sym)
    ? (fxTickVolume() ? 'Interbank FX (TrueFX). Volume is tick volume (the number of quote changes) and pressure uses the tick rule. Order-book depth and sentiment are not available.'
       : 'Fast composite FX: live Kraken quotes shifted by their measured offset from the interbank price (TrueFX), so the price moves at Kraken speed at the interbank level. Volume and buy/sell pressure are real Kraken trades. Order-book depth and sentiment are not shown for FX.')
    : (cover < 1 ? `Liquidity: the local server has recorded the order book since ${M.book.length ? new Date(M.book[0].t).toLocaleString() : '—'}; ${pct(1 - cover, 0)} of bars predate that and are drawn as open markers. ` : '') +
    (s.available ? `Sentiment: ${s.source}, 5-minute snapshots carried forward.` : `Sentiment is unavailable for ${M.sym} because no futures market exists for it, so the floor path is drawn in a single colour.`);
}

/* ======================= §3 trade-level order flow ======================= */
function drawFlow() {
  if (isFX(M.sym) && (!KR_PAIRS.includes(M.sym.slice(3)) || fxSrc() === 'interbank')) {
    if (drawFlow.fx !== M.sym) { drawFlow.fx = M.sym; plot('pFlow', [], base({ margin: { t: 0, l: 0, r: 0, b: 0 } })); }
    $('flowReadout').innerHTML = cell('Order flow', 'not available', KR_PAIRS.includes(M.sym.slice(3)) ? 'Switch the FX feed to "fast composite" or "Kraken" to see real Kraken trades for this pair.' : 'Interbank FX has no public trade tape, and Kraken has no active market in this pair.');
    return;
  }
  drawFlow.fx = null;
  const win = +$('fwin').value * 1000, now = Date.now();
  let w = T.trades.filter(t => now - t.t < win);
  const B = w.filter(t => t.buy), S = w.filter(t => !t.buy);
  const bv = B.reduce((a, t) => a + t.q, 0), sv = S.reduce((a, t) => a + t.q, 0);
  if (w.length > 5000) w = w.slice(-5000);
  const maxQ = Math.max(1e-12, ...w.map(t => t.q)), size = t => 2.5 + 12 * Math.sqrt(t.q / maxQ), x = t => (t.t - now) / 1000;
  const pts = (arr, sign, color, name) => ({ type: 'scatter3d', mode: 'markers', name, x: arr.map(x), y: arr.map(t => t.p), z: arr.map(t => sign * t.q),
    customdata: arr.map(t => [new Date(t.t).toLocaleTimeString(), fmt(t.q, 6)]),
    marker: { size: arr.map(size), color, opacity: 0.88, line: { width: 0 } },
    hovertemplate: `${name}<br>%{customdata[0]}<br>P = %{y}<br>q = %{customdata[1]}<extra></extra>` });
  const stems = (arr, sign, color) => { const X = [], Y = [], Z = []; arr.slice(-2500).forEach(t => { X.push(x(t), x(t), null); Y.push(t.p, t.p, null); Z.push(0, sign * t.q, null); });
    return { type: 'scatter3d', mode: 'lines', x: X, y: Y, z: Z, line: { color, width: 2 }, opacity: 0.35, hoverinfo: 'skip' }; };
  const wb = w.filter(t => t.buy), ws_ = w.filter(t => !t.buy), q = M.quote;
  const data = [
    { type: 'scatter3d', mode: 'lines', x: w.map(x), y: w.map(t => t.p), z: w.map(() => 0), line: { color: css('--accent2'), width: 4 }, hoverinfo: 'skip' },
    stems(wb, 1, css('--buy')), stems(ws_, -1, css('--sell')), pts(wb, 1, css('--buy'), 'buyer-initiated'), pts(ws_, -1, css('--sell'), 'seller-initiated'),
  ];
  if (q) data.push({ type: 'scatter3d', mode: 'markers', x: [0, 0], y: [q.mid, q.mid], z: [0, 0], hoverinfo: 'skip',
    marker: { size: [22, 7], color: ['rgba(0,255,156,0.25)', css('--accent')], line: { width: 0 } } });
  plot('pFlow', data, base({ margin: { t: 0, l: 0, r: 0, b: 0 }, uirevision: 'flow' + M.sym,
    scene: { xaxis: ax3('t − now (s)', { range: [-win / 1000, 1], autorange: false }), yaxis: ax3('Price', { tickformat: '.6~g' }), zaxis: ax3('Signed size  (+buy / −sell)'),
      aspectmode: 'manual', aspectratio: { x: 1.7, y: 1, z: 0.8 }, camera: { eye: { x: 1.5, y: -1.7, z: 0.8 } } } }));
  const last = T.trades[T.trades.length - 1], share = bv + sv ? bv / (bv + sv) : 0.5;
  $('flowReadout').innerHTML =
    cell('Live mid', q ? sig(q.mid, 7) : '–', q ? `spread ${fmt((q.ask - q.bid) / q.mid * 1e4, 2)} bp` : '', 'big ' + (M.dir > 0 ? 'up' : M.dir < 0 ? 'down' : '')) +
    cell('Last trade', last ? sig(last.p, 7) : '–', last ? new Date(last.t).toLocaleTimeString() : '') +
    cell('Buy volume', fmt(bv, 4), `${B.length} trades`, 'pos') + cell('Sell volume', fmt(sv, 4), `${S.length} trades`, 'neg') +
    cell('Net flow', fmt(bv - sv, 4), `buy share ${pct(share)}`, bv >= sv ? 'pos' : 'neg') +
    cell('Dominant side', bv === sv ? 'even' : bv > sv ? 'buyers' : 'sellers', `window ${$('fwin').selectedOptions[0].text}`, bv > sv ? 'pos' : bv < sv ? 'neg' : '');
}

/* ======================= §4 analysis (heavy; recomputed every 3 s) ======================= */
let maniCache = { key: '', iso: null };
$('mmethod').onchange = () => { labAt = 0; dirty.lab = true; };
function drawLab() {
  if (performance.now() - labAt < 3000) { dirty.lab = true; return; }
  labAt = performance.now();
  const F = sample(); if (F.length < 80) { $('labLede').textContent = 'Waiting for at least 80 bars…'; return; }
  const times = F.map(f => new Date(f.t)), band = 2 / Math.sqrt(F.length);
  const cols = Lab.featureMatrix(F), names = cols.map(c => c[0]), C = Lab.corrMatrix(cols);
  const liqIn = names.includes('Bid D'), lcov = F.filter(f => f.liq != null).length / F.length;
  $('labLede').textContent = `Sample: ${M.sym}, ${F.length} bars of ${M.iv}, ${times[0].toLocaleString()} – ${times[times.length - 1].toLocaleString()}. Recomputed every 3 s.` +
    (liqIn ? ' Bid and ask depth come from the recorded order book.' : ` Bid/ask depth are excluded until the recorded book covers ≥ 80 % of the sample (now ${pct(lcov, 0)}). A shorter bar Δt includes them sooner.`);

  plot('pCorr', [{ type: 'heatmap', z: C, x: names, y: names, zmin: -1, zmax: 1, colorscale: divScale(), texttemplate: '%{z:.2f}',
    textfont: { size: 10, color: css('--text') }, hovertemplate: 'ρ(%{y}, %{x}) = %{z:.3f}<extra></extra>', colorbar: { thickness: 10, title: { text: 'ρ' }, tickfont: { color: css('--muted') } } }],
    base({ margin: { t: 10, l: 56, r: 10, b: 40 }, yaxis: { autorange: 'reversed', tickfont: { size: 11, color: css('--muted') } }, xaxis: { tickfont: { size: 11, color: css('--muted') } } }));
  const xc = Lab.xcorr(F.map(f => f.press), F.map(f => f.ret), 15);
  plot('pXcorr', [{ type: 'bar', x: xc.map(o => o.k), y: xc.map(o => o.r), marker: { color: xc.map(o => Math.abs(o.r) > band ? css('--accent') : css('--line')) },
    hovertemplate: 'k = %{x}<br>ρ = %{y:.3f}<extra></extra>' }],
    base({ xaxis: ax('lag k (bars)'), yaxis: ax('ρ(π_t, r_t+k)'),
      shapes: [band, -band].map(y => ({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: y, y1: y, line: { dash: 'dash', color: css('--muted'), width: 1 } })) }));
  const h6 = 60 + 52 * cols.length; $('pTraces').style.height = h6 + 'px';
  plot('pTraces', cols.map(([n, v], i) => ({ type: 'scatter', mode: 'lines', x: times, y: Lab.zs(v).map(z => Math.max(-4, Math.min(4, z)) - i * 5),
    line: { width: 1, color: i % 2 ? css('--accent2') : css('--accent') }, hovertemplate: `${n}: z = %{customdata:.2f}<extra></extra>`, customdata: Lab.zs(v) })),
    base({ margin: { t: 10, l: 56, r: 14, b: 36 }, xaxis: ax('', { type: 'date' }),
      yaxis: ax('', { tickvals: cols.map((_, i) => -i * 5), ticktext: names, zeroline: false, showgrid: false }) }));

  const x = Lab.detrended(F), tau = Lab.chooseTau(x), E = Lab.embed(x, tau), H = Lab.hurst(F.map(f => f.ret)), a1 = Lab.acf(F.map(f => f.ret), 1)[1];
  plot('pEmbed', [{ type: 'scatter3d', mode: 'lines+markers', x: E.map(p => p[0]), y: E.map(p => p[1]), z: E.map(p => p[2]),
    line: { color: E.map((_, i) => i), colorscale: seqScale(), width: 3 }, marker: { size: 2, color: E.map((_, i) => i), colorscale: seqScale() }, hoverinfo: 'skip' }],
    base({ margin: { t: 0, l: 0, r: 0, b: 0 }, uirevision: 'emb', scene: { xaxis: ax3('x_t'), yaxis: ax3(`x_t−${tau}`), zaxis: ax3(`x_t−${2 * tau}`) } }));
  const R = E.slice(-200), D = Lab.distMatrix(R); let rec = 0; D.forEach(r => r.forEach(d => { if (d < 0.5) rec++; }));
  const rr = rec / (D.length * D.length);
  plot('pRecur', [{ type: 'heatmap', z: D, showscale: true,
    colorscale: isDark() ? [[0, '#eafff6'], [0.15, '#00ff9c'], [0.5, '#00573a'], [1, '#010604']] : 'Greys', reversescale: !isDark(),
    colorbar: { thickness: 10, title: { text: '‖Δx‖' }, tickfont: { color: css('--muted') } }, hovertemplate: 'i=%{x} j=%{y}<br>‖Δx‖=%{z:.2f}<extra></extra>' }],
    base({ xaxis: ax('state i'), yaxis: ax('state j', { scaleanchor: 'x' }) }));

  const G = Lab.gaussianPath(F.map(f => f.ret), F.map(f => f.t)), ds = G.slice(1).map(g => g.d), frTot = ds.reduce((s, d) => s + d, 0);
  plot('pPoinc', [{ type: 'scatter', mode: 'lines+markers', x: G.map(g => g.mu / Math.SQRT2 * 1e4), y: G.map(g => g.sigma * 1e4),
    marker: { size: 5, color: G.map((_, i) => i), colorscale: seqScale() }, line: { color: css('--line'), width: 1 },
    customdata: G.map(g => new Date(g.t).toLocaleTimeString()), hovertemplate: '%{customdata}<br>μ/√2 = %{x:.3f} bp<br>σ = %{y:.3f} bp<extra></extra>' }],
    base({ xaxis: ax('μ / √2  (bp)'), yaxis: ax('σ  (bp)', { rangemode: 'tozero' }) }));
  plot('pFR', [{ type: 'scatter', mode: 'lines', x: G.slice(1).map(g => new Date(g.t)), y: ds, fill: 'tozeroy', fillcolor: 'rgba(179,136,255,0.15)', line: { color: css('--violet'), width: 1.5 },
    hovertemplate: '%{x|%H:%M:%S}<br>d_FR = %{y:.3f}<extra></extra>' }],
    base({ xaxis: ax('', { type: 'date' }), yaxis: ax('d_FR (consecutive)') }));

  const ph = Lab.persistenceH0(R), shown = ph.deaths.slice(0, 60);
  plot('pBar', [{ type: 'bar', orientation: 'h', y: shown.map((_, i) => i), x: shown, base: 0, marker: { color: shown.map((_, i) => i < ph.significant ? css('--accent') : css('--line')) },
    hovertemplate: 'born 0, dies ε = %{x:.3f}<extra></extra>' }],
    base({ xaxis: ax('filtration scale ε'), yaxis: ax('H₀ class (sorted)', { autorange: 'reversed', showticklabels: false }), bargap: 0.25 }));
  const eps = Array.from({ length: 80 }, (_, i) => i / 79 * (ph.deaths[0] || 1) * 1.05);
  plot('pBetti', [{ type: 'scatter', mode: 'lines', line: { shape: 'hv', color: css('--accent'), width: 2 }, x: eps, y: eps.map(e => 1 + ph.deaths.filter(d => d > e).length) }],
    base({ xaxis: ax('ε'), yaxis: ax('β₀(ε)', { type: 'log' }) }));

  const P = Lab.pca(cols), method = $('mmethod').value;
  let S = P.scores, off = 0;
  if (method === 'iso') {
    const key = M.sym + M.iv + F.length + ':' + Math.floor(Date.now() / 15000);
    if (maniCache.key !== key) maniCache = { key, iso: Lab.isomap(cols) };
    S = maniCache.iso.scores; off = maniCache.iso.offset;
  }
  plot('pMani', [{ type: 'scatter3d', mode: 'markers', x: S.map(s => s[0]), y: S.map(s => s[1]), z: S.map(s => s[2]),
    customdata: S.map((_, i) => times[i + off]?.toLocaleTimeString()),
    marker: { size: 3, color: S.map((_, i) => i), colorscale: seqScale(), opacity: 0.9 }, hovertemplate: '%{customdata}<extra></extra>' }],
    base({ margin: { t: 0, l: 0, r: 0, b: 0 }, uirevision: 'mani' + method,
      scene: method === 'pca' ? { xaxis: ax3(`PC1 (${pct(P.explained[0])})`), yaxis: ax3(`PC2 (${pct(P.explained[1])})`), zaxis: ax3(`PC3 (${pct(P.explained[2])})`) }
                              : { xaxis: ax3('Isomap 1'), yaxis: ax3('Isomap 2'), zaxis: ax3('Isomap 3') } }));
  plot('pLoad', [{ type: 'heatmap', z: P.loadings, x: P.names, y: P.loadings.map((_, i) => `PC${i + 1} · ${pct(P.explained[i])}`), zmin: -1, zmax: 1,
    colorscale: divScale(), texttemplate: '%{z:.2f}', textfont: { color: css('--text') }, colorbar: { thickness: 10, title: { text: 'w' }, tickfont: { color: css('--muted') } } }],
    base({ margin: { t: 10, l: 110, r: 10, b: 40 }, yaxis: { autorange: 'reversed', tickfont: { color: css('--muted') } }, xaxis: { tickfont: { color: css('--muted') } } }));

  const cum3 = P.explained.slice(0, 3).reduce((a, b) => a + b, 0);
  $('labReadout').innerHTML =
    cell('Hurst H (R/S)', fmt(H, 3), H == null ? '' : H > 0.55 ? 'persistent' : H < 0.45 ? 'anti-persistent' : '≈ random walk') +
    cell('ACF₁ of r', fmt(a1, 3), Math.abs(a1) > band ? 'significant' : 'not significant') +
    cell('Embedding τ', tau + ' bars', 'm = 3') + cell('Recurrence rate', pct(rr), 'ε = 0.5') +
    cell('Fisher–Rao length', fmt(frTot, 2), `${G.length} windows`) +
    cell('H₀ entropy', fmt(ph.entropy, 2), `${ph.significant} long-lived components`) +
    cell('PCA, top 3', pct(cum3), `of ${names.length} features`);
}

startMarket();
