// Minimal browser stand-in for interface tests: element stubs, a fake fetch that serves the recorded API snapshot
// (test/fixtures/api-snapshot.json.gz, a real capture), a Plotly stub that checks every plotted number is finite,
// and vm loading of the page scripts. No network, no server.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..', '..');
const SNAP = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'api-snapshot.json.gz'))));

function env() {
  const els = {}, errors = [], plots = {}, requests = [];
  const el = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', checked: true, hidden: false, clientWidth: 1200, style: {}, offsetWidth: 300, offsetHeight: 200,
    classList: { contains: () => true, add() {}, remove() {}, toggle() {} }, addEventListener() {}, on() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    querySelectorAll(sel) { const out = []; if (sel === '[data-tab]') for (const m of this.innerHTML.matchAll(/data-tab="(\w+)"/g)) { const o = { dataset: { tab: m[1] } }; Object.defineProperty(o, 'onclick', { set(f) { o._c = f; } }); out.push(o); } this._tabs = out; return out; } });
  const fetchStub = async (u, o = {}) => {
    const method = (o.method || 'GET').toUpperCase(), key = method === 'GET' ? u : `${method} ${u.split('?')[0]}`; requests.push(key);
    const body = SNAP[key] ?? (method === 'GET' ? SNAP[u.split('&')[0]] : undefined);
    return { ok: body !== undefined, status: body !== undefined ? 200 : 404, json: async () => body ?? { error: 'not in snapshot: ' + key } };
  };
  const ctx = { console, Date, Math, JSON, Number, String, Object, Array, Promise, Set, Map, isFinite, parseFloat, parseInt, URL,
    setTimeout: (f, ms) => (ms > 2000 ? 0 : setTimeout(f, ms)), clearTimeout, setInterval: () => 0, clearInterval() {},
    document: { getElementById: el, readyState: 'complete', addEventListener() {}, querySelector: () => null, documentElement: {}, body: { classList: { add() {}, remove() {} } }, hidden: false },
    getComputedStyle: () => ({ getPropertyValue: () => '#888888' }), localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: fetchStub,
    Plotly: { react: (id, tr) => { plots[id] = tr.length; for (const t of tr) for (const k of ['x', 'y', 'z']) { const a = t[k]; const flat = Array.isArray(a) ? a.flat(2) : []; if (flat.some(v => typeof v === 'number' && !Number.isFinite(v))) errors.push(`non-finite ${k} in ${id}`); } } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, addEventListener() {}, dispatchEvent() {} };
  ctx.window = ctx; vm.createContext(ctx);
  const load = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); };
  // Text that must never be shown to a user.
  const bad = html => { const t = String(html).replace(/<[^>]+>/g, ' '); const m = t.match(/.{0,40}((?<![a-z] is )\bundefined\b|\bNaN\b|\[object|Infinity).{0,30}/); return m ? m[0] : null; };
  return { ctx, els, el, errors, plots, requests, load, bad, SNAP };
}
module.exports = { env, SNAP };
