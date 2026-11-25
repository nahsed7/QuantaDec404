// Paper execution simulator (Part 07). Pure (UMD). Decides whether and how much of a working order fills against one
// market snapshot, at what price, and at what cost. It never fills at the price shown when the order was placed:
//  - only a quote that arrives after submission + latency can fill;
//  - buys pay the ask (sells receive the bid), estimated as mid ± half the spread;
//  - market impact adds σ_daily·√(fill ÷ daily volume) against the trader (square-root law);
//  - each evaluation can fill at most `participation` of the volume traded since the previous evaluation, so large
//    orders fill partially over time;
//  - stop orders trigger on the last price and then behave as market (or limit) orders;
//  - market orders do not fill while the market is closed (they wait); day orders expire at the session's end.
// Quotes are delayed (Yahoo, ~15 min), so every fill is labelled as simulated against delayed data.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QExec = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin;
  const DEFAULTS = Object.freeze({ latencyMs: 2000, participation: 0.1, impactK: 1, sessionMinutes: 390, minSpread: 0.0002, maxSpread: 0.02 });
  // Fees: US equities $0.005 per share, minimum $1, maximum 1 % of value (typical retail-broker tiered pricing);
  // other markets 0.10 % of value, minimum US$5. Configurable; disclosed with every fill.
  const FEES = Object.freeze({ US: { perShare: 0.005, min: 1, maxPct: 0.01 }, other: { pct: 0.001, min: 5 } });
  function fee(region, qty, priceUSD, schedule = FEES) {
    const value = qty * priceUSD;
    if (region === 'US') { const f = schedule.US; return Math.min(Math.max(f.min, f.perShare * qty), f.maxPct * value); }
    const f = schedule.other; return Math.max(f.min, f.pct * value);
  }

  // Bid and ask around the last price from the spread estimate (clamped to a plausible band; the estimate is biased
  // upward for volatile stocks).
  function quotes(snap, cfg = DEFAULTS) {
    const s = S.clamp(fin(snap.quotedSpread) ? snap.quotedSpread : fin(snap.spreadEst) ? snap.spreadEst : 0.001, cfg.minSpread, cfg.maxSpread);
    return { bid: snap.last * (1 - s / 2), ask: snap.last * (1 + s / 2), spread: s, spreadSource: fin(snap.quotedSpread) ? 'quoted' : 'liquidity-tier model (no quote feed)' };
  }
  // Shares tradable in this evaluation: participation × volume expected since the previous evaluation (pro rata of the
  // daily volume over the session). At least 1 share when the market is open, so tiny orders are not starved.
  function capacity(snap, elapsedMs, cfg = DEFAULTS) {
    if (!(snap.advShares > 0)) return 0;
    const perMs = snap.advShares / (cfg.sessionMinutes * 60e3);
    return Math.max(1, Math.floor(cfg.participation * perMs * Math.max(0, elapsedMs)));
  }

  // Evaluate one working order against one snapshot. Returns { fill: {qty, price, ...} | null, triggered, status, note }.
  // order: { side: 'buy'|'sell', type: 'market'|'limit'|'stop'|'stop_limit', qty, filled, limit, stop, submittedAt, tif, triggered }
  // snap:  { last, time, open (bool), spreadEst, quotedSpread, sigmaDaily, advShares, fxUSD, region }
  function evaluate(order, snap, lastEvalAt, cfg = DEFAULTS) {
    const remaining = order.qty - (order.filled || 0);
    if (remaining <= 0) return { status: 'filled', fill: null };
    if (!fin(snap.last) || !fin(snap.time)) return { status: order.status, fill: null, note: 'no quote' };
    if (snap.time < order.submittedAt + cfg.latencyMs) return { status: order.status, fill: null, note: `waiting for a quote newer than the order (delayed feed: the latest is ${Math.max(0, Math.round((order.submittedAt - snap.time) / 60e3))} min older than the order)` };
    let triggered = order.triggered || false;
    if ((order.type === 'stop' || order.type === 'stop_limit') && !triggered) {
      triggered = order.side === 'buy' ? snap.last >= order.stop : snap.last <= order.stop;
      if (!triggered) return { status: 'working', fill: null, triggered, note: `stop ${order.stop} not reached (last ${snap.last.toFixed(4)})` };
    }
    if (!snap.open) return { status: 'working', fill: null, triggered, note: 'market closed: waiting for the session' };
    const q = quotes(snap, cfg), cap = capacity(snap, snap.time - Math.max(lastEvalAt || order.submittedAt, order.submittedAt), cfg);
    let qty = Math.min(remaining, cap);
    if (qty <= 0) return { status: 'working', fill: null, triggered, note: 'no volume available in this interval' };
    const sigma = fin(snap.sigmaDaily) ? snap.sigmaDaily : 0.02;
    const impact = q => cfg.impactK * sigma * Math.sqrt(q / snap.advShares);
    const touch = order.side === 'buy' ? q.ask : q.bid, sign = order.side === 'buy' ? 1 : -1;
    let price = touch * (1 + sign * impact(qty));
    const lim = order.type === 'limit' || order.type === 'stop_limit' ? order.limit : null;
    if (fin(lim)) {
      if (sign * (touch - lim) > 0) return { status: 'working', fill: null, triggered, note: `${order.side === 'buy' ? 'ask' : 'bid'} ${touch.toFixed(4)} beyond limit ${lim}` };
      // Reduce the quantity until the impacted price respects the limit (impact grows with √qty).
      while (qty > 1 && sign * (price - lim) > 0) { qty = Math.floor(qty / 2); price = touch * (1 + sign * impact(qty)); }
      if (sign * (price - lim) > 0) price = lim;
    }
    const priceUSD = price * (fin(snap.fxUSD) ? snap.fxUSD : 1), f = fee(snap.region, qty, priceUSD, cfg.fees);
    const slip = sign * (price - snap.last) / snap.last;
    return { status: qty < remaining ? 'partially_filled' : 'filled', triggered,
      fill: { qty, price, priceUSD, feeUSD: f, at: snap.time, spread: q.spread, spreadSource: q.spreadSource, impact: impact(qty), slippageVsLast: slip, quoteTime: snap.time,
        note: `simulated against a delayed quote (last ${snap.last.toFixed(4)} at ${new Date(snap.time).toISOString()})` } };
  }
  // Pre-trade estimate shown before confirmation (same model as the simulator, for the whole quantity at once).
  function estimate(order, snap, cfg = DEFAULTS) {
    if (!fin(snap.last)) return null;
    const q = quotes(snap, cfg), sigma = fin(snap.sigmaDaily) ? snap.sigmaDaily : 0.02, sign = order.side === 'buy' ? 1 : -1;
    const imp = snap.advShares > 0 ? cfg.impactK * sigma * Math.sqrt(order.qty / snap.advShares) : null;
    const px = (order.side === 'buy' ? q.ask : q.bid) * (1 + sign * (imp ?? 0)), fx = fin(snap.fxUSD) ? snap.fxUSD : 1;
    const perInterval = capacity(snap, 60e3, cfg), minutes = perInterval > 0 ? order.qty / perInterval : null;
    return { price: px, priceUSD: px * fx, valueUSD: order.qty * px * fx, feeUSD: fee(snap.region, order.qty, px * fx, cfg.fees), halfSpread: q.spread / 2, spreadSource: q.spreadSource, impact: imp,
      costBp: 1e4 * (q.spread / 2 + (imp ?? 0)), minutesToFill: minutes, participationOfADV: snap.advShares > 0 ? order.qty / snap.advShares : null };
  }
  // Market state from the exchange's current trading periods (Yahoo's chart endpoint has no marketState field).
  // Lunch breaks (e.g. Tokyo 11:30–12:30) are not represented, so those count as open.
  function session(tp, now = Date.now()) {
    const r = tp?.regular, inside = p => p && now >= p.start * 1000 && now < p.end * 1000;
    const state = !r ? 'unknown' : inside(r) ? 'REGULAR' : inside(tp.pre) ? 'PRE' : inside(tp.post) ? 'POST' : 'CLOSED';
    return { state, sessionStart: r ? r.start * 1000 : null, sessionEnd: r ? r.end * 1000 : null };
  }
  return { DEFAULTS, FEES, fee, quotes, capacity, evaluate, estimate, session };
});
