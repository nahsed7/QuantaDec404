// Brokerage adapters (Part 07). One interface for every execution venue:
//   { id, name, live (always false here), healthy(), evaluate?(order, snap, lastEvalAt), submit?(), cancel?() }
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

// Alpaca paper trading (https://paper-api.alpaca.markets). Implemented to the interface but NOT wired into the order
// manager yet and untested without keys; enabling it requires ALPACA_KEY_ID and ALPACA_SECRET_KEY in .env.
const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
function alpacaPaper(env = process.env, base = ALPACA_PAPER) {
  if (base !== ALPACA_PAPER) throw new Error('Refused: only the Alpaca paper endpoint is allowed. Live trading is disabled.');
  const key = env.ALPACA_KEY_ID, secret = env.ALPACA_SECRET_KEY;
  const configured = !!(key && secret), headers = () => ({ 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Content-Type': 'application/json' });
  async function call(method, path, body) {
    if (!configured) throw new Error('Alpaca paper keys are not configured (.env).');
    const r = await fetch(base + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`Alpaca ${r.status}: ${j.message || 'error'}`); return j;
  }
  return { id: 'alpaca-paper', name: 'Alpaca paper trading (US equities)', live: false, configured,
    healthy: async () => { if (!configured) return false; try { await call('GET', '/v2/clock'); return true; } catch { return false; } },
    submit: o => call('POST', '/v2/orders', { symbol: o.sym, qty: String(o.qty), side: o.side, type: o.type, time_in_force: o.tif === 'gtc' ? 'gtc' : 'day', limit_price: o.limit, stop_price: o.stop, client_order_id: o.clientId }),
    cancel: id => call('DELETE', '/v2/orders/' + encodeURIComponent(id)), status: id => call('GET', '/v2/orders/' + encodeURIComponent(id)) };
}

module.exports = { LIVE_TRADING_ENABLED, ALPACA_PAPER, paper, alpacaPaper };
