'use strict';
/* ======================= Demo trading account =======================
   Paper trading at live Binance prices. A buy fills at the current ask, a sell at the current bid,
   so every trade pays the real spread. Nothing is ever sent to an exchange.
   The account lives on the local server (data/account.json), so every device sees the same balance. */
const QUOTE_USD = s => /(USDT|USDC|FDUSD)$/.test(s);
// USD value of a currency, from the live FX quotes (e.g. JPY via USD/JPY, GBP via GBP/USD)
const fxPair = s => s.startsWith('FX:') ? s.slice(3).split('/') : null;
function usdOf(ccy) {
  if (ccy === 'USD') return 1;
  let q = FXQ[ccy + '/USD']; if (q) return (q.bid + q.ask) / 2;
  q = FXQ['USD/' + ccy]; if (q) return 2 / (q.bid + q.ask);
  return NaN;
}
const usdPerBase = (s, mid) => { const f = fxPair(s); if (f) return f[0] === 'USD' ? 1 : f[1] === 'USD' ? mid : usdOf(f[0]);
  return QUOTE_USD(s) ? mid : /^(USDT|USDC)/.test(s) ? 1 : NaN; };                     // USD value of 1 unit of the base
const usdPerQuote = (s, mid) => { const f = fxPair(s); if (f) return f[1] === 'USD' ? 1 : f[0] === 'USD' ? 1 / mid : usdOf(f[1]);
  return QUOTE_USD(s) ? 1 : 1 / mid; };                                                // e.g. USDTTRY: 1 TRY = 1/mid USD
const AC = { acct: null, rev: -1, quotes: {}, ws: null, wsKey: '', saving: false, pending: false, posKey: '', histKey: '' };
const money = v => (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const smoney = v => (v >= 0 ? '+' : '−') + '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function quoteFor(sym) { if (sym === M.sym && M.quote) return M.quote; return AC.quotes[sym] || null; }
function upnl(p) {
  const q = quoteFor(p.sym); if (!q) return p.last ?? 0;
  const mid = (q.bid + q.ask) / 2, d = p.side === 'buy' ? q.bid - p.entry : p.entry - q.ask, conv = usdPerQuote(p.sym, mid);
  if (!isFinite(conv)) return p.last ?? 0;
  return (p.last = Math.max(d * p.qty * conv, -p.amount));     // loss is capped at the position's margin
}
function stats() {
  const a = AC.acct; let u = 0, m = 0;
  for (const p of a.positions) { u += upnl(p); m += p.amount; }
  const eq = a.balance + u; return { u, m, eq, free: eq - m };
}
function toast(msg, cls = '') {
  const t = $('toast'); t.textContent = msg; t.className = 'toast show ' + cls;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.className = 'toast'; }, 3200);
}

/* ---------- persistence (server, with revision check so two devices can't silently overwrite each other) ---------- */
async function loadAccount() {
  if (AC.saving || AC.pending) return;
  try {
    const r = await getJSON('/api/account');
    if (r.rev !== AC.rev) { AC.acct = r.account; AC.rev = r.rev; AC.posKey = AC.histKey = ''; }
    if (!AC.acct) showSetup(); else renderAccount();
  } catch {}
}
async function saveAccount() {
  if (AC.saving) { AC.pending = true; return; }
  AC.saving = true;
  try {
    const r = await fetch('/api/account', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: AC.rev, account: AC.acct }) });
    const j = await r.json();
    if (r.status === 409) { AC.acct = j.account; AC.rev = j.rev; AC.posKey = AC.histKey = ''; toast('The account was changed on another device, so it was reloaded.', 'warn'); }
    else if (r.ok) AC.rev = j.rev; else toast('Save failed: ' + (j.error || r.status), 'neg');
  } catch { toast('Could not save: is the server running?', 'neg'); }
  AC.saving = false;
  if (AC.pending) { AC.pending = false; saveAccount(); }
  if (!AC.acct) showSetup(); else renderAccount();
}

/* ---------- account setup ---------- */
function showSetup() { $('setup').hidden = false; }
function createAccount(amount) {
  if (!(amount > 0) || amount > 1e9) return toast('Choose an amount between $0.01 and $1,000,000,000', 'neg');
  AC.acct = { currency: 'USD', start: amount, balance: amount, created: Date.now(), seq: 0, positions: [], history: [] };
  AC.posKey = AC.histKey = ''; $('setup').hidden = true;
  $('tAmt').value = +(amount >= 100 ? Math.round(amount / 100) : Math.max(0.01, amount / 10)).toFixed(2);
  toast(`Demo account opened with ${money(amount)}`, 'pos'); saveAccount();
}
$('setupChips').innerHTML = [10, 100, 1000, 10000, 100000].map(v => `<button class="btn chip" data-v="${v}">${money(v).replace('.00', '')}</button>`).join('');
$('setupChips').onclick = e => { const v = e.target.dataset.v; if (v) createAccount(+v); };
$('setupGo').onclick = () => createAccount(+$('setupCustom').value);
$('setupCancel').onclick = () => { if (AC.acct) $('setup').hidden = true; };
$('tReset').onclick = () => { if (!AC.acct || confirm('Reset the demo account? Open positions and history will be deleted.')) showSetup(); };

/* ---------- trading ---------- */
function openPos(side) {
  const a = AC.acct; if (!a) return showSetup();
  const q = quoteFor(M.sym);
  if (!q || Date.now() - q.t > 15000) return toast('No live quote yet. Wait a moment.', 'neg');
  const amount = +$('tAmt').value, lev = +$('tLev').value, tp = +$('tTP').value, sl = +$('tSL').value;
  if (!(amount > 0)) return toast('Enter an amount in USD', 'neg');
  const s = stats();
  if (amount > s.free + 1e-9) return toast(`Not enough free margin: ${money(Math.max(0, s.free))} available`, 'neg');
  const mid = (q.bid + q.ask) / 2, ub = usdPerBase(M.sym, mid);
  if (!isFinite(ub) || !isFinite(usdPerQuote(M.sym, mid))) return toast('Waiting for the FX rates needed to value ' + M.sym + ' in USD', 'neg');
  const entry = side === 'buy' ? q.ask : q.bid;
  const p = { id: ++a.seq, sym: M.sym, side, amount, lev, qty: amount * lev / ub, entry, t: Date.now(), tp: tp > 0 ? tp : null, sl: sl > 0 ? Math.min(sl, amount) : null };
  a.positions.push(p);
  toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${M.sym}: ${money(amount)} ×${lev} at ${sig(entry, 7)}`, side === 'buy' ? 'pos' : 'neg');
  renderAccount(); saveAccount(); syncQuoteWs();
}
function closePos(id, reason = 'manual') {
  const a = AC.acct, i = a ? a.positions.findIndex(p => p.id === id) : -1; if (i < 0) return;
  const p = a.positions[i], q = quoteFor(p.sym);
  if (!q) return toast('No live quote for ' + p.sym + ' yet', 'neg');
  const pnl = upnl(p), exit = p.side === 'buy' ? q.bid : q.ask;
  a.positions.splice(i, 1); a.balance += pnl;
  a.history.unshift({ ...p, exit, tClose: Date.now(), pnl, reason }); if (a.history.length > 500) a.history.length = 500;
  toast(`Closed #${p.id} ${p.sym}: ${smoney(pnl)} (${reason})`, pnl >= 0 ? 'pos' : 'neg');
  renderAccount(); saveAccount(); syncQuoteWs();
}
$('tBuy').onclick = () => openPos('buy');
$('tSell').onclick = () => openPos('sell');
$('tCloseAll').onclick = () => { if (AC.acct && AC.acct.positions.length && confirm('Close all open positions?')) [...AC.acct.positions].forEach(p => closePos(p.id, 'manual')); };
$('posBody').onclick = e => { const id = e.target.closest('[data-close]')?.dataset.close; if (id) closePos(+id); };
$('tChips').innerHTML = ['1', '5', '10', '50', '100', '1000', '25%', '50%', 'MAX'].map(v => `<button class="btn chip" data-v="${v}">${/%|MAX/.test(v) ? v : '$' + (+v).toLocaleString()}</button>`).join('');
$('tChips').onclick = e => {
  const v = e.target.dataset.v; if (!v || !AC.acct) return;
  const free = Math.max(0, stats().free);
  $('tAmt').value = v === 'MAX' ? Math.floor(free * 100) / 100 : v.endsWith('%') ? Math.floor(free * parseFloat(v)) / 100 : v;
  renderTicket();
};
['tAmt', 'tLev'].forEach(id => $(id).addEventListener('input', () => renderTicket()));

// Take-profit / stop-loss / stop-out checks run 10× a second against the live quote.
function checkRisk() {
  const a = AC.acct; if (!a) return;
  for (const p of [...a.positions]) {
    if (!quoteFor(p.sym)) continue;
    const v = upnl(p);
    if (v <= -p.amount * 0.999) closePos(p.id, 'stop-out');
    else if (p.tp && v >= p.tp) closePos(p.id, 'take-profit');
    else if (p.sl && v <= -p.sl) closePos(p.id, 'stop-loss');
  }
}
// Live quotes for positions in instruments other than the one on screen.
function syncQuoteWs() {
  const syms = [...new Set((AC.acct?.positions || []).map(p => p.sym))].filter(s => s !== M.sym && !s.startsWith('FX:')).sort(), key = syms.join(',');
  if (key === AC.wsKey) return;
  AC.wsKey = key; if (AC.ws) { AC.ws.onclose = null; AC.ws.close(); AC.ws = null; }
  if (!syms.length) return;
  const open = () => {
    const ws = AC.ws = new WebSocket(STREAM + syms.map(s => s.toLowerCase() + '@bookTicker').join('/'));
    ws.onmessage = e => { const d = JSON.parse(e.data).data; AC.quotes[d.s] = { bid: +d.b, ask: +d.a, t: Date.now() }; };
    ws.onclose = () => { if (AC.wsKey === key) setTimeout(() => AC.wsKey === key && open(), 2000); };
  };
  open();
}

/* ---------- rendering ---------- */
function renderTicket() {
  const q = M.quote, amt = +$('tAmt').value || 0, lev = +$('tLev').value;
  $('tAsk').textContent = q ? sig(q.ask, 7) : '–'; $('tBid').textContent = q ? sig(q.bid, 7) : '–';
  if (!q) { $('tInfo').textContent = 'waiting for live quote…'; return; }
  const mid = (q.bid + q.ask) / 2, ub = usdPerBase(M.sym, mid), qty = amt * lev / ub, spreadCost = (q.ask - q.bid) * qty * usdPerQuote(M.sym, mid);
  $('tInfo').innerHTML = `${esc(M.sym.replace('FX:', ''))} · position size ${money(amt * lev)} · qty ${fmt(qty, 6)}<br>spread ${fmt((q.ask - q.bid) / mid * 1e4, 2)} bp · cost to cross the spread ≈ ${money(spreadCost)}`;
}
function renderAccount() {
  renderTicket();
  const a = AC.acct;
  if (!a) { $('acctBar').innerHTML = '<div class="s">No demo account yet.</div>'; $('posBody').innerHTML = ''; return; }
  const s = stats(), ret = (s.eq / a.start - 1);
  $('acctBar').innerHTML =
    `<div><span class="k">Equity</span><span class="v big ${s.eq >= a.start ? 'pos' : 'neg'}">${money(s.eq)}</span><span class="s">${ret >= 0 ? '+' : ''}${(ret * 100).toFixed(2)}% vs start ${money(a.start)}</span></div>` +
    `<div><span class="k">Balance</span><span class="v">${money(a.balance)}</span></div>` +
    `<div><span class="k">Open P&amp;L</span><span class="v ${s.u >= 0 ? 'pos' : 'neg'}">${smoney(s.u)}</span></div>` +
    `<div><span class="k">Free margin</span><span class="v">${money(Math.max(0, s.free))}</span><span class="s">used ${money(s.m)}</span></div>`;
  // positions: rebuild rows only when the set changes, otherwise update the live cells (keeps Close buttons clickable)
  const key = a.positions.map(p => p.id).join(',');
  if (key !== AC.posKey) {
    AC.posKey = key;
    $('posBody').innerHTML = a.positions.length ? a.positions.map(p => `<tr>
      <td>#${p.id}</td><td>${esc(p.sym)}</td><td class="${p.side === 'buy' ? 'pos' : 'neg'}">${p.side === 'buy' ? '▲ BUY' : '▼ SELL'}</td>
      <td>${money(p.amount)}</td><td>×${p.lev}</td><td>${sig(p.entry, 7)}</td><td id="pc${p.id}">–</td><td id="pp${p.id}">–</td>
      <td>${p.tp ? '+' + money(p.tp) : '–'} / ${p.sl ? '−' + money(p.sl) : '–'}</td><td>${new Date(p.t).toLocaleTimeString()}</td>
      <td><button class="btn small" data-close="${p.id}">Close</button></td></tr>`).join('')
      : `<tr><td colspan="11" class="empty">No open positions. Choose an amount and press BUY or SELL.</td></tr>`;
  }
  for (const p of a.positions) {
    const q = quoteFor(p.sym), v = upnl(p), pc = $('pc' + p.id), pp = $('pp' + p.id);
    if (pc) pc.textContent = q ? sig(p.side === 'buy' ? q.bid : q.ask, 7) : 'waiting…';
    if (pp) { pp.textContent = `${smoney(v)} (${(v / p.amount * 100).toFixed(1)}%)`; pp.className = v >= 0 ? 'pos' : 'neg'; }
  }
  const hk = a.history.length + ':' + (a.history[0]?.id ?? '');
  if (hk !== AC.histKey) {
    AC.histKey = hk;
    const H = a.history, wins = H.filter(h => h.pnl > 0).length, tot = H.reduce((x, h) => x + h.pnl, 0);
    $('histSum').textContent = H.length ? `${H.length} closed · win rate ${(wins / H.length * 100).toFixed(0)}% · realised ${smoney(tot)}` : 'no closed trades yet';
    $('histBody').innerHTML = H.slice(0, 100).map(h => `<tr><td>#${h.id}</td><td>${esc(h.sym)}</td><td class="${h.side === 'buy' ? 'pos' : 'neg'}">${h.side.toUpperCase()}</td>
      <td>${money(h.amount)} ×${h.lev}</td><td>${sig(h.entry, 7)}</td><td>${sig(h.exit, 7)}</td><td class="${h.pnl >= 0 ? 'pos' : 'neg'}">${smoney(h.pnl)}</td>
      <td>${esc(h.reason)}</td><td>${new Date(h.tClose).toLocaleString()}</td></tr>`).join('');
  }
}

// Entry / TP / SL lines on the live chart (called by the canvas renderer every frame)
window.tradeOverlay = (ctx, Y, x1, top, pb, C) => {
  const a = AC.acct; if (!a) return;
  ctx.font = '600 11px "IBM Plex Mono", monospace'; ctx.textBaseline = 'middle';
  for (const p of a.positions) {
    if (p.sym !== M.sym) continue;
    const col = p.side === 'buy' ? C.up : C.dn, q = quoteFor(p.sym), upq = q ? usdPerQuote(p.sym, (q.bid + q.ask) / 2) : 1, dir = p.side === 'buy' ? 1 : -1;
    const line = (price, label, dash, alpha) => {
      const y = Math.round(Y(price)) + 0.5; if (y < top || y > pb) return;
      ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
      const tw = ctx.measureText(label).width + 10; ctx.fillStyle = col; ctx.fillRect(6, y - 9, tw, 18);
      ctx.fillStyle = C.dark ? '#00170e' : '#fff'; ctx.fillText(label, 11, y); ctx.globalAlpha = 1;
    };
    line(p.entry, `#${p.id} ${p.side === 'buy' ? '▲ BUY' : '▼ SELL'} ${money(p.amount)}×${p.lev}  ${smoney(upnl(p))}`, [6, 3], 0.95);
    if (p.tp) line(p.entry + dir * p.tp / (p.qty * upq), `TP #${p.id} +${money(p.tp)}`, [2, 3], 0.6);
    if (p.sl) line(p.entry - dir * p.sl / (p.qty * upq), `SL #${p.id} −${money(p.sl)}`, [2, 3], 0.6);
  }
};

setInterval(() => { checkRisk(); if (view === 'state') renderAccount(); }, 100);
setInterval(syncQuoteWs, 1000);
setInterval(loadAccount, 3000);
loadAccount();
