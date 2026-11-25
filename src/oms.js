// Order management for the equity paper book (Part 07). Server-authoritative: working orders keep executing while no
// browser is open. Book: data/equity-book.json (atomic writes). Every event is appended to data/equity-audit.jsonl.
//
// Order states: rejected | working | partially_filled | filled | cancelled | expired.
// Flow: preview (estimate + risk checks) → submit (risk checks again, server-side) → working → fills on later quotes.
// Nothing submits orders automatically: orders only come from an explicit user request through the API.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const S = require('../lib/stats'), RC = require('../lib/riskcontrol'), X = require('../lib/fx');

function create({ dataDir, research, quotes, fetchQuotes, broker }) {
  const file = path.join(dataDir, 'equity-book.json'), audit = path.join(dataDir, 'equity-audit.jsonl');
  const fresh = (cash = 100000) => ({ version: 1, baseCcy: 'USD', created: new Date().toISOString(), startCashUSD: cash, cashUSD: cash, positions: {}, orders: [], fills: [], snapshots: [], limits: {}, rev: 0 });
  let book; try { book = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { book = fresh(); }
  const log = (event, data) => { try { fs.appendFileSync(audit, JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n'); } catch {} };
  const persist = () => { book.rev++; fs.writeFileSync(file + '.tmp', JSON.stringify(book)); fs.renameSync(file + '.tmp', file); };
  const dayKey = t => new Date(t).toISOString().slice(0, 10);

  // Market snapshot for one company: latest delayed quote (listing currency) and the liquidity model inputs.
  function snapshot(sym) {
    const d = research.state.dossiers.get(sym); if (!d) return null;
    const q = quotes().get(sym), last = q && S.fin(q.price) ? q.price * X.normaliseCurrency(q.currency || d.listing.ccy).factor : d.nativePrice;
    const time = q?.time ?? d.fresh?.priceTime ?? null;
    // The session state is re-evaluated now from the quote's session times (the quote itself may be minutes old).
    const state = q?.sessionStart && q?.sessionEnd ? (Date.now() >= q.sessionStart && Date.now() < q.sessionEnd ? 'REGULAR' : 'CLOSED') : (q?.state || 'unknown'), open = state === 'REGULAR';
    return { sym, last, time, open, state, sessionEnd: q?.sessionEnd ?? null, ageMin: S.fin(time) ? (Date.now() - time) / 60e3 : null, kind: q ? 'delayed' : 'historical',
      spreadEst: d.liquidity?.spreadEst ?? null, quotedSpread: d.liquidity?.quotedSpread ?? null, sigmaDaily: d.liquidity?.sigmaDaily ?? null, advShares: d.liquidity?.advShares ?? null,
      fxUSD: X.usdPer(d.listing.ccy, Date.now(), research.state.fx), region: d.region, sector: d.sector, ccy: d.listing.ccy, label: d.label };
  }
  function valuation() {
    let mv = 0; const pos = {};
    for (const [sym, p] of Object.entries(book.positions)) {
      const s = snapshot(sym), px = s?.last, fx = s?.fxUSD, v = S.fin(px) && S.fin(fx) ? p.qty * px * fx : p.qty * p.avgCostUSD;
      mv += v; pos[sym] = { ...p, last: px ?? null, fxUSD: fx ?? null, valueUSD: v, unrealizedUSD: v - p.qty * p.avgCostUSD, priceTime: s?.time ?? null, priced: S.fin(px) };
    }
    const equity = book.cashUSD + mv; for (const p of Object.values(pos)) p.weight = equity > 0 ? p.valueUSD / equity : null;
    return { equityUSD: equity, marketValueUSD: mv, positions: pos };
  }
  function dayStartEquity() { const today = dayKey(Date.now()), prev = book.snapshots.filter(s => s.date < today).at(-1); return prev?.equityUSD ?? book.startCashUSD; }
  function riskContext(order) {
    const v = valuation();
    return { book: { cashUSD: book.cashUSD - reservedCash(), equityUSD: v.equityUSD, positions: v.positions, dayStartEquityUSD: dayStartEquity() }, snap: snapshot(order.sym),
      recent: book.orders.slice(-50), now: Date.now(), brokerHealthy: broker.healthy(), limits: book.limits };
  }
  // Cash committed to working buy orders (so two orders cannot both spend the same cash).
  function reservedCash() {
    return S.sum(book.orders.filter(o => o.side === 'buy' && (o.status === 'working' || o.status === 'partially_filled')).map(o => {
      const s = snapshot(o.sym), px = S.fin(o.limit) ? o.limit : s?.last; return S.fin(px) && S.fin(s?.fxUSD) ? (o.qty - o.filled) * px * s.fxUSD * 1.01 : 0; }));
  }
  const clean = o => ({ sym: String(o.sym || '').toUpperCase(), side: o.side, type: o.type, qty: Math.floor(+o.qty), limit: S.fin(+o.limit) && +o.limit > 0 ? +o.limit : null,
    stop: S.fin(+o.stop) && +o.stop > 0 ? +o.stop : null, tif: o.tif === 'gtc' ? 'gtc' : 'day', clientId: o.clientId ? String(o.clientId).slice(0, 64) : null, refPrice: S.fin(+o.refPrice) ? +o.refPrice : null });

  function preview(input) {
    const o = clean(input), s = snapshot(o.sym); if (!s) return { error: 'unknown symbol' };
    return { order: o, snapshot: s, estimate: broker.estimate(o, s), checks: RC.check(o, riskContext(o)), disclosure: DISCLOSURE };
  }
  function submit(input) {
    const o = clean(input), s = snapshot(o.sym), checks = RC.check(o, riskContext(o));
    const rec = { id: crypto.randomBytes(6).toString('hex'), ...o, submittedAt: Date.now(), filled: 0, avgPrice: null, feesUSD: 0, fills: [], label: s?.label,
      session: s?.open && S.fin(s.time) ? dayKey(s.time) : null, sessionEnd: s?.open ? s.sessionEnd : null, status: checks.ok ? 'working' : 'rejected', checks, venue: broker.id };
    if (!checks.ok) rec.reason = checks.blocks.map(b => b.text).join(' ');
    book.orders.push(rec); log(rec.status === 'rejected' ? 'rejected' : 'accepted', { order: rec }); persist();
    if (checks.ok) setImmediate(() => tick().catch(() => {}));
    return rec;
  }
  function cancel(id) {
    const o = book.orders.find(x => x.id === id); if (!o) return { error: 'no such order' };
    if (!['working', 'partially_filled'].includes(o.status)) return { error: `order is ${o.status}` };
    o.status = 'cancelled'; o.closedAt = Date.now(); log('cancelled', { id, filled: o.filled }); persist(); return o;
  }
  function applyFill(o, f, s) {
    const signed = o.side === 'buy' ? f.qty : -f.qty, cost = f.qty * f.priceUSD;
    if (o.side === 'buy') book.cashUSD -= cost + f.feeUSD; else book.cashUSD += cost - f.feeUSD;
    const p = book.positions[o.sym] || { qty: 0, avgCostUSD: 0, avgCostLocal: 0, ccy: s.ccy, sector: s.sector, region: s.region, opened: Date.now(), realizedUSD: 0 };
    if (signed > 0) { p.avgCostUSD = (p.avgCostUSD * p.qty + cost + f.feeUSD) / (p.qty + f.qty); p.avgCostLocal = (p.avgCostLocal * p.qty + f.qty * f.price) / (p.qty + f.qty); p.qty += f.qty; }
    else { p.realizedUSD = (p.realizedUSD || 0) + f.qty * (f.priceUSD - p.avgCostUSD) - f.feeUSD; p.qty -= f.qty; }
    if (p.qty > 0) book.positions[o.sym] = p; else { book.realizedClosedUSD = (book.realizedClosedUSD || 0) + (p.realizedUSD || 0); delete book.positions[o.sym]; }
    o.avgPrice = ((o.avgPrice || 0) * o.filled + f.price * f.qty) / (o.filled + f.qty); o.filled += f.qty; o.feesUSD += f.feeUSD; o.fills.push(f);
    book.fills.push({ order: o.id, sym: o.sym, side: o.side, ...f }); log('fill', { order: o.id, sym: o.sym, side: o.side, fill: f });
  }
  // Evaluate every working order against the latest quotes (fetched for those symbols, so orders work unattended).
  let ticking = false;
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      const working = book.orders.filter(o => o.status === 'working' || o.status === 'partially_filled'); let changed = false;
      if (working.length && fetchQuotes) await fetchQuotes([...new Set(working.map(o => o.sym))]).catch(() => {});
      for (const o of working) {
        const s = snapshot(o.sym); if (!s) continue;
        // Day orders expire once their session has ended (a quote from a later day, or the market closed after submission).
        // Day orders expire when their session ends (the exchange's regular-session end; date change as a fallback).
        const ended = o.sessionEnd ? Date.now() >= o.sessionEnd : o.session && S.fin(s.time) && (dayKey(s.time) > o.session || (!s.open && dayKey(s.time) === o.session && s.time > o.submittedAt));
        if (o.tif === 'day' && ended) { o.status = 'expired'; o.closedAt = Date.now(); log('expired', { id: o.id, filled: o.filled }); changed = true; continue; }
        if (!o.session && s.open && S.fin(s.time)) { o.session = dayKey(s.time); o.sessionEnd = s.sessionEnd || null; }
        const r = broker.evaluate(o, s, o.lastEvalAt); o.lastNote = r.note || null; if (r.triggered) o.triggered = true;
        if (r.fill) {
          // A sell can never exceed the shares held; a buy can never spend more than the cash left (it is trimmed).
          if (o.side === 'sell') r.fill.qty = Math.min(r.fill.qty, book.positions[o.sym]?.qty || 0);
          if (o.side === 'buy') { const afford = Math.floor(book.cashUSD / (r.fill.priceUSD * 1.002 + r.fill.feeUSD / Math.max(1, r.fill.qty))); r.fill.qty = Math.min(r.fill.qty, Math.max(0, afford)); }
          if (r.fill.qty > 0) { applyFill(o, r.fill, s); changed = true; }
          o.status = o.filled >= o.qty ? 'filled' : o.filled > 0 ? 'partially_filled' : 'working'; if (o.status === 'filled') o.closedAt = Date.now();
        }
        if (S.fin(s.time)) o.lastEvalAt = Math.max(o.lastEvalAt || 0, s.time);
      }
      snapshotDay(); if (changed) persist();
    } finally { ticking = false; }
  }
  // One equity snapshot per UTC day: the paper-trading result series (kept apart from every backtest).
  function snapshotDay() {
    const v = valuation(), today = dayKey(Date.now()), last = book.snapshots.at(-1);
    if (last?.date === today) { last.equityUSD = v.equityUSD; last.cashUSD = book.cashUSD; } else book.snapshots.push({ date: today, equityUSD: v.equityUSD, cashUSD: book.cashUSD });
    if (book.snapshots.length > 2000) book.snapshots = book.snapshots.slice(-2000);
  }
  function view() {
    const v = valuation(), sec = {}; for (const p of Object.values(v.positions)) sec[p.sector] = (sec[p.sector] || 0) + (p.weight || 0);
    return { venue: broker.name, live: false, disclosure: DISCLOSURE, limits: { ...RC.LIMITS, ...book.limits }, cashUSD: book.cashUSD, reservedUSD: reservedCash(), startCashUSD: book.startCashUSD,
      created: book.created, equityUSD: v.equityUSD, marketValueUSD: v.marketValueUSD, pnlUSD: v.equityUSD - book.startCashUSD, positions: v.positions, sectors: sec,
      orders: book.orders.slice(-200).reverse(), fills: book.fills.slice(-200).reverse(), snapshots: book.snapshots, rev: book.rev, category: 'paper-trading (simulated fills, delayed data)' };
  }
  function reset(cash) { const c = S.clamp(+cash || 100000, 1000, 1e9); log('reset', { from: { cashUSD: book.cashUSD, positions: Object.keys(book.positions).length }, cash: c }); book = { ...fresh(c), rev: book.rev }; persist(); return view(); }
  function setLimits(l) {
    const out = {}; for (const [k, v] of Object.entries(l || {})) if (k in RC.LIMITS && typeof v === typeof RC.LIMITS[k]) out[k] = typeof v === 'number' ? S.clamp(v, 0, 1e6) : v;
    out.allowShort = false; book.limits = out; log('limits', { limits: out }); persist(); return view();
  }
  // Weights of the current holdings for the portfolio laboratory (and the concentration risk score).
  function holdings() { const v = valuation(); if (!Object.keys(v.positions).length) return null; const inv = S.sum(Object.values(v.positions).map(p => p.valueUSD)); return { name: 'Paper book', weights: Object.fromEntries(Object.entries(v.positions).map(([s, p]) => [s, p.valueUSD / inv])) }; }
  return { preview, submit, cancel, tick, view, reset, setLimits, holdings, snapshot, book: () => book };
}
const DISCLOSURE = 'Simulated paper trading. Fills are computed only against quotes timestamped after the order, and the free quotes are delayed (about 15–20 minutes), so a fill typically appears 15–20 minutes after submission with an estimated bid–ask spread, square-root market impact, a cap of 10 % of the volume in each interval (so large orders fill partially) and a fee schedule (US: $0.005/share, min $1, max 1 %; other markets: 0.10 %, min $5). Real execution can differ. No real money and no real broker are involved; live trading is disabled.';
module.exports = { create, DISCLOSURE };
