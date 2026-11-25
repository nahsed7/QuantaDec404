// Pre-trade risk controls (Part 07). Pure (UMD). Every order passes through check() before the order manager accepts it.
// A "block" rejects the order; a "warning" is shown and needs the user's explicit confirmation. The user always keeps
// control: nothing in the system submits orders on its own, and there is no path from a model score to an order.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QRisk = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin;
  // Defaults (configurable in the paper-trading settings). Each is a documented choice, not a recommendation.
  const LIMITS = Object.freeze({
    maxPositionPct: 0.20,        // a single holding may not exceed 20 % of equity after the order
    maxSectorPct: 0.40,          // one sector may not exceed 40 % of equity after the order
    maxADVPct: 0.05,             // block orders above 5 % of the stock's average daily volume
    warnADVPct: 0.01,            // warn above 1 %
    maxPriceMovePct: 0.05,       // block if the price moved > 5 % since the ticket was opened (re-confirm at the new price)
    staleQuoteMin: 30,           // block if the latest quote is older than 30 minutes while the market is open
    limitBandPct: 0.20,          // a limit or stop price must lie within ±20 % of the last price
    duplicateWindowMs: 10000,    // same symbol, side, quantity and type within 10 s = duplicate
    maxOrdersPerMinute: 10,
    dailyLossLimitPct: 0.05,     // kill switch: no new buys after equity falls 5 % in a day
    allowShort: false,           // equities: no short selling in the paper book
  });
  const TYPES = new Set(['market', 'limit', 'stop', 'stop_limit']), SIDES = new Set(['buy', 'sell']), TIFS = new Set(['day', 'gtc']);

  // order: { sym, side, type, qty, limit, stop, tif, clientId, refPrice }
  // ctx: { book: { cashUSD, equityUSD, positions: { sym: { qty, sector, valueUSD } }, dayStartEquityUSD },
  //        snap: { last, time, open, ageMin, advShares, sector, fxUSD, region, kind }, recent: [orders], now, brokerHealthy, limits }
  function check(order, ctx) {
    const L = { ...LIMITS, ...(ctx.limits || {}) }, blocks = [], warns = [], b = ctx.book, sn = ctx.snap || {}, now = ctx.now ?? Date.now();
    const block = (code, text) => blocks.push({ code, text }), warn = (code, text) => warns.push({ code, text });
    // ---- invalid orders ----
    if (!order || typeof order.sym !== 'string' || !order.sym) block('invalid', 'No symbol.');
    if (!SIDES.has(order?.side)) block('invalid', 'Side must be buy or sell.');
    if (!TYPES.has(order?.type)) block('invalid', 'Type must be market, limit, stop or stop_limit.');
    if (!TIFS.has(order?.tif || 'day')) block('invalid', 'Time in force must be day or gtc.');
    if (!(Number.isInteger(order?.qty) && order.qty > 0)) block('invalid', 'Quantity must be a whole number of shares above 0.');
    if ((order?.type === 'limit' || order?.type === 'stop_limit') && !(order.limit > 0)) block('invalid', 'A limit price is required.');
    if ((order?.type === 'stop' || order?.type === 'stop_limit') && !(order.stop > 0)) block('invalid', 'A stop price is required.');
    if (blocks.length) return { ok: false, blocks, warnings: warns };
    // ---- broker and data availability ----
    if (ctx.brokerHealthy === false) block('broker', 'The execution venue is unavailable; try again later.');
    if (!fin(sn.last)) block('stale', 'No price for this company.');
    else if (sn.open && fin(sn.ageMin) && sn.ageMin > L.staleQuoteMin) block('stale', `The latest quote is ${sn.ageMin.toFixed(0)} minutes old while the market is open.`);
    else if (sn.kind === 'delayed') warn('delayed', 'Prices are delayed (up to ~15 minutes); the simulated fill uses the next delayed quote, not the price on screen.');
    if (!sn.open) warn('closed', 'The market is closed. Market orders will wait for the next session; day orders expire at its end.');
    // ---- prices ----
    if (fin(order.refPrice) && fin(sn.last) && Math.abs(sn.last / order.refPrice - 1) > L.maxPriceMovePct) block('price_moved', `The price moved ${(100 * (sn.last / order.refPrice - 1)).toFixed(1)} % since the ticket was opened. Review and confirm again at the new price.`);
    for (const [k, v] of [['limit', order.limit], ['stop', order.stop]]) if (fin(v) && fin(sn.last) && Math.abs(v / sn.last - 1) > L.limitBandPct) block('price_band', `The ${k} price ${v} is more than ${100 * L.limitBandPct} % from the last price ${sn.last.toFixed(2)}.`);
    if (order.type === 'limit' && fin(sn.last) && ((order.side === 'buy' && order.limit > sn.last * 1.02) || (order.side === 'sell' && order.limit < sn.last * 0.98))) warn('marketable', 'This limit is well through the market and will behave like a market order.');
    // ---- liquidity ----
    if (sn.advShares > 0) { const p = order.qty / sn.advShares; if (p > L.maxADVPct) block('liquidity', `${(100 * p).toFixed(1)} % of average daily volume (limit ${100 * L.maxADVPct} %).`); else if (p > L.warnADVPct) warn('liquidity', `${(100 * p).toFixed(2)} % of average daily volume: expect partial fills and market impact.`); }
    else warn('liquidity', 'No volume data: fills cannot be sized realistically.');
    // ---- exposure and cash ----
    const px = (fin(order.limit) ? order.limit : sn.last) * (fin(sn.fxUSD) ? sn.fxUSD : 1), value = order.qty * px, pos = b?.positions?.[order.sym];
    if (order.side === 'sell') {
      const have = pos?.qty || 0; if (!L.allowShort && order.qty > have) block('short', `Selling ${order.qty} but holding ${have}: short selling is disabled.`);
    } else if (b) {
      if (fin(b.cashUSD) && value > b.cashUSD) block('cash', `Needs about $${value.toFixed(0)} but cash is $${b.cashUSD.toFixed(0)} (no margin in the paper book).`);
      const eq = b.equityUSD > 0 ? b.equityUSD : null;
      if (eq) {
        const after = ((pos?.valueUSD || 0) + value) / eq; if (after > L.maxPositionPct) block('position', `The position would be ${(100 * after).toFixed(1)} % of equity (limit ${100 * L.maxPositionPct} %).`);
        const sec = sn.sector, secNow = S.sum(Object.values(b.positions || {}).filter(p => p.sector === sec).map(p => p.valueUSD || 0)), sAfter = (secNow + value) / eq;
        if (sec && sAfter > L.maxSectorPct) block('concentration', `${sec} would be ${(100 * sAfter).toFixed(1)} % of equity (limit ${100 * L.maxSectorPct} %).`);
        if (fin(b.dayStartEquityUSD) && b.equityUSD < b.dayStartEquityUSD * (1 - L.dailyLossLimitPct)) block('kill_switch', `Equity is down ${(100 * (1 - b.equityUSD / b.dayStartEquityUSD)).toFixed(1)} % today; new buys are paused (daily loss limit ${100 * L.dailyLossLimitPct} %).`);
      }
    }
    // ---- duplicates and rate ----
    const recent = (ctx.recent || []).filter(o => now - o.submittedAt < 60e3);
    if (order.clientId && (ctx.recent || []).some(o => o.clientId === order.clientId)) block('duplicate', 'This order was already submitted (same client id).');
    else if (recent.some(o => o.sym === order.sym && o.side === order.side && o.qty === order.qty && o.type === order.type && now - o.submittedAt < L.duplicateWindowMs)) block('duplicate', `An identical order was submitted ${((now - recent.find(o => o.sym === order.sym).submittedAt) / 1000).toFixed(0)} s ago.`);
    if (recent.length >= L.maxOrdersPerMinute) block('rate', `More than ${L.maxOrdersPerMinute} orders in a minute.`);
    return { ok: !blocks.length, blocks, warnings: warns };
  }
  return { LIMITS, check };
});
