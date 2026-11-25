// Write protection (Part 07). The server listens on the hotspot, so any device on it could otherwise change the paper
// account, portfolios or orders. Rule: reads are open; every write needs the access token, except from the phone itself
// (loopback). The token is random, stored in data/auth-token (not in the repo) and shown in server.log and on the phone.
// From the PC, open the link with ?token=… once; the page keeps it in localStorage and sends it as X-Auth-Token.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

function create(dataDir) {
  const file = path.join(dataDir, 'auth-token');
  let token; try { token = fs.readFileSync(file, 'utf8').trim(); } catch {}
  if (!/^[a-f0-9]{32,}$/.test(token || '')) { token = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(file, token + '\n', { mode: 0o600 }); }
  const loopback = req => { const a = req.socket?.remoteAddress || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; };
  const given = req => String(req.headers['x-auth-token'] || '').trim();
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const allowed = req => loopback(req) || same(given(req), token);
  return { token: () => token, allowed, loopback };
}
// Minimal .env loader: KEY=VALUE lines, # comments; existing environment variables win. Values are never printed.
function loadEnv(file) {
  try { for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); } return true; } catch { return false; }
}
module.exports = { create, loadEnv };
