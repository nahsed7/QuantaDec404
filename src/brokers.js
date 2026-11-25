// Brokerage adapters (Part 07). One interface for every execution venue:
//   local:  { id, name, live (always false), healthy(), estimate(order, snap), evaluate(order, snap, lastEvalAt) }
//   remote: { id, name, live (always false), remote: true, configured, healthy(), checkHealth(), estimate(), submit(order), cancel(id), status(id) }
// Only paper venues exist. Live trading is disabled in code: there is no live adapter, and the Alpaca adapter refuses
// any base URL other than Alpaca's paper endpoint. Credentials come only from environment variables (.env, gitignored),
// never from source code, and are never logged or sent to the browser.
'use strict';
const E = require('../lib/execsim');

const LIVE_TRADING_ENABLED = false;   // Changing this alone does nothing: no live adapter is implemented.

// Local simulator: fills computed by lib/execsim.js against delayed quotes.
function paper(cfg = {}) {
  const c = { ...E.DEFAULTS, ...cfg };
  return { id: 'paper', name: 'Local paper simulator (delayed quotes)', live: false, healthy: () => true, evaluate: (o, s, t) => E.evaluate(o, s, t, c), estimate: (o, s) => E.estimate(o, s, c), config: c };
}

// Alpaca paper trading (https://paper-api.alpaca.markets), US equities only. Enabled automatically when ALPACA_KEY_ID
// and ALPACA_SECRET_KEY are in .env. Fills are Alpaca's own paper fills (real-time quotes at Alpaca, commission-free),
// mirrored into the local book by polling each order's status. `fetchImpl` exists only so tests can use a fake API.
const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
// Alpaca order status → local status. Everything not listed (new, accepted, pending_new, held, done_for_day, …) is working.
const ALPACA_STATUS = { partially_filled: 'partially_filled', filled: 'filled', canceled: 'cancelled', expired: 'expired', rejected: 'rejected', replaced: 'cancelled' };
function alpacaPaper(env = process.env, base = ALPACA_PAPER, fetchImpl = (...a) => fetch(...a)) {
  if (base !== ALPACA_PAPER) throw new Error('Refused: only the Alpaca paper endpoint is allowed. Live trading is disabled.');
  const key = env.ALPACA_KEY_ID, secret = env.ALPACA_SECRET_KEY;
  const configured = !!(key && secret), headers = () => ({ 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Content-Type': 'application/json' });
  async function call(method, path, body) {
    if (!configured) throw new Error('Alpaca paper keys are not configured (.env).');
    const r = await fetchImpl(base + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`Alpaca ${r.status}: ${j.message || 'error'}`); return j;
  }
  // Health is cached so the (synchronous) risk check can read it; null = not checked yet (not a block).
  let health = null;
  const local = paper();
  return { id: 'alpaca-paper', name: 'Alpaca paper trading (US equities, real-time fills at Alpaca)', live: false, configured, remote: true,
    healthy: () => configured ? health : false,
    checkHealth: async () => { if (!configured) return (health = false); try { await call('GET', '/v2/clock'); health = true; } catch { health = false; } return health; },
    estimate: local.estimate,   // pre-trade cost estimate only; the fill itself comes from Alpaca
    submit: async o => {
      const j = await call('POST', '/v2/orders', { symbol: o.sym, qty: String(o.qty), side: o.side, type: o.type, time_in_force: o.tif === 'gtc' ? 'gtc' : 'day',
        limit_price: o.limit != null ? String(o.limit) : undefined, stop_price: o.stop != null ? String(o.stop) : undefined, client_order_id: o.clientId || undefined });
      return { remoteId: j.id, status: ALPACA_STATUS[j.status] || 'working', raw: j.status };
    },
    cancel: id => call('DELETE', '/v2/orders/' + encodeURIComponent(id)),
    status: async id => {
      const j = await call('GET', '/v2/orders/' + encodeURIComponent(id));
      return { status: ALPACA_STATUS[j.status] || 'working', raw: j.status, filledQty: +j.filled_qty || 0, avgPrice: j.filled_avg_price != null ? +j.filled_avg_price : null, updatedAt: Date.parse(j.updated_at || j.filled_at || '') || Date.now() };
    } };
}

// Venue router: US orders go to Alpaca when it is configured; every other order stays with the local simulator.
function routed({ local = paper(), remote } = {}) {
  const useRemote = (o, s) => !!(remote?.configured && (s?.region || o.region) === 'US');
  return { id: 'routed', name: remote?.configured ? `${remote.name} for US orders; ${local.name} for the rest` : local.name, live: false,
    venues: { [local.id]: local, ...(remote ? { [remote.id]: remote } : {}) },
    venueFor: (o, s) => useRemote(o, s) ? remote : local,
    healthy: () => true, estimate: local.estimate, evaluate: local.evaluate, remote };
}

module.exports = { LIVE_TRADING_ENABLED, ALPACA_PAPER, ALPACA_STATUS, paper, alpacaPaper, routed };
