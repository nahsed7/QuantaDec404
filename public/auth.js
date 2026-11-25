// Write access for this browser (Part 07). Reads are open; changes (paper orders, portfolios, the paper account) need
// the access token unless the page is opened on the phone itself. Open the page once with ?token=… on another device;
// the token is kept in localStorage and sent with every non-GET request as X-Auth-Token.
(function () {
  'use strict';
  const KEY = 'qd-token';
  const get = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  try {
    const u = new URL(location.href), t = u.searchParams.get('token');
    if (t && /^[a-f0-9]{32,}$/.test(t)) { localStorage.setItem(KEY, t); u.searchParams.delete('token'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); }
  } catch {}
  const headers = () => { const t = get(); return t ? { 'X-Auth-Token': t } : {}; };
  // Add the token to same-origin writes made by any script on the page (trade.js, portfolio.js, paper.js).
  const orig = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase(), url = typeof input === 'string' ? input : input?.url || '';
    if (method !== 'GET' && method !== 'HEAD' && (url.startsWith('/') || url.startsWith(location.origin))) init = { ...init, headers: { ...(init.headers || {}), ...headers() } };
    return orig(input, init);
  };
  const state = { canWrite: null, loopback: false, token: null };
  async function refresh() {
    try { const j = await (await orig('/api/auth', { headers: headers(), cache: 'no-store' })).json(); Object.assign(state, j); } catch {}
    const el = document.getElementById('authBadge');
    if (el) { el.textContent = state.canWrite ? (state.loopback ? '✎ edit (this phone)' : '✎ edit (token)') : '👁 read-only'; el.title = state.canWrite ? 'This browser can place paper orders and save changes.' : 'Open the page once with ?token=… (shown on the phone in §7 Paper trading) to allow changes from this device.'; el.className = 'btn ' + (state.canWrite ? '' : 'warn'); }
    window.dispatchEvent(new CustomEvent('authchange', { detail: state }));
  }
  window.AUTH = { headers, refresh, state, forget: () => { try { localStorage.removeItem(KEY); } catch {} refresh(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh); else refresh();
})();
