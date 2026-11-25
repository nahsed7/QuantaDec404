// Disk retention (Part 08). The phone's disk is ~96 % full, so recorded market streams are compacted: lines older than
// the retention window are dropped. Only market recordings are touched (order-book depth <SYM>.jsonl and FX bars
// fx-*.jsonl). The paper account log, the equity audit log, experiments and caches are never pruned here.
'use strict';
const fs = require('fs'), path = require('path');

const RECORDINGS = /^(fx-[A-Z]{6}|[A-Z0-9]{5,12})\.jsonl$/;          // fx-EURUSD.jsonl, BTCUSDT.jsonl …
const PROTECTED = new Set(['account-log.jsonl', 'equity-audit.jsonl']);

function compact(dataDir, { days = 30, now = Date.now() } = {}) {
  const cut = now - days * 864e5, report = [];
  for (const f of fs.readdirSync(dataDir)) {
    if (PROTECTED.has(f) || !RECORDINGS.test(f)) continue;
    const p = path.join(dataDir, f), before = fs.statSync(p).size;
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    const keep = lines.filter(l => { try { const t = JSON.parse(l).t; return !(typeof t === 'number' && t < cut); } catch { return false; } });   // corrupt lines are dropped too
    if (keep.length === lines.length) { report.push({ file: f, kept: keep.length, dropped: 0, bytes: before }); continue; }
    fs.writeFileSync(p + '.tmp', keep.map(l => l + '\n').join('')); fs.renameSync(p + '.tmp', p);
    report.push({ file: f, kept: keep.length, dropped: lines.length - keep.length, bytesBefore: before, bytes: fs.statSync(p).size });
  }
  return { at: new Date(now).toISOString(), days, files: report };
}
// Disk usage of the data folder by category, for the Data Quality Monitor.
function usage(dataDir) {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? walk(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
  const out = { total: 0, groups: {} };
  for (const e of fs.readdirSync(dataDir, { withFileTypes: true })) {
    const p = path.join(dataDir, e.name), size = e.isDirectory() ? walk(p) : fs.statSync(p).size;
    const g = e.isDirectory() ? e.name : RECORDINGS.test(e.name) ? 'market recordings' : /log|audit/.test(e.name) ? 'logs' : 'state';
    out.groups[g] = (out.groups[g] || 0) + size; out.total += size;
  }
  let free = null; try { const st = fs.statfsSync(dataDir); free = st.bavail * st.bsize; } catch {}
  return { ...out, diskFree: free };
}
module.exports = { compact, usage, RECORDINGS, PROTECTED };
