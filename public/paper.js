// §7 Equity paper trading: order ticket inside the company research panel, plus the paper book view (positions, working
// orders, fills, rejections with reasons, equity curve, exposures, risk limits). Two steps for every order: preview
// (estimate + risk checks) then an explicit confirmation. Nothing is ever submitted automatically.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fin = x => typeof x === 'number' && Number.isFinite(x);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pc = (x, d = 1) => fin(x) ? (x >= 0 ? '+' : '') + (100 * x).toFixed(d) + ' %' : 'n/a';
  const pu = (x, d = 1) => fin(x) ? (100 * x).toFixed(d) + ' %' : 'n/a';
  const num = (x, d = 2) => fin(x) ? x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) }) : 'n/a';
  const usd = x => fin(x) ? '$' + x.toLocaleString(undefined, { maximumFractionDigits: 0 }) : 'n/a';
  const when = t => fin(t) ? new Date(t).toLocaleString() : 'n/a';
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); return { ok: r.ok, status: r.status, j }; };
  const st = { view: null, poll: null };

  // ---------- order ticket (inside the company panel) ----------
  function ticket(d, el) {
    const v = d.valuation?.synthesis, e = d.decision?.evidence || {}, r = d.momentum?.returns || {}, l = d.liquidity || {};
    const listing = d.listing?.ccy || d.ccy, px = fin(d.nativePrice) ? d.nativePrice : d.price;
    el.innerHTML = `
      <div class="pt-ctx">
        <div><b>Price</b> ${num(px)} ${esc(listing)} <span class="kind kind-${d.fresh?.priceKind?.startsWith('delayed') ? 'delayed' : 'historical'}">${d.fresh?.priceKind?.startsWith('delayed') ? 'delayed' : 'historical'}</span> <span class="muted">${when(d.fresh?.priceTime)}</span></div>
        <div><b>Valuation range</b> ${fin(v?.base) ? `${num(v.low)} … ${num(v.base)} … ${num(v.high)} ${esc(d.ccy)} · ${pc(v.premium, 0)} vs base · ${esc(v.status)}` : 'n/a'}</div>
        <div><b>Scores</b> opportunity ${d.decision?.opportunity?.score ?? 'n/a'} · risk ${d.decision?.risk?.score ?? 'n/a'} · confidence ${d.decision?.confidence?.score ?? 'n/a'} <span class="muted">(independent)</span></div>
        <div><b>Recent performance</b> 1w ${pc(r[5])} · 1m ${pc(r[21])} · 3m ${pc(r[63])} · 1y ${pc(r[252])}</div>
        <div><b>Liquidity</b> median ${fin(l.advShares) ? num(l.advShares, 0) : 'n/a'} shares/day ($${fin(l.addv) ? (l.addv / 1e6).toFixed(0) + ' M' : 'n/a'}); spread ${fin(l.spreadEst) ? (1e4 * l.spreadEst).toFixed(1) + ' bp (estimated)' : 'n/a'}</div>
        <div class="cp-grid2"><div class="cp-ev con"><h4>Contradicting evidence (top 3)</h4><ul>${(e.contradicting || []).slice(0, 3).map(x => `<li>${esc(x)}</li>`).join('') || '<li class="muted">None identified.</li>'}</ul></div>
          <div class="cp-ev sup"><h4>Supporting evidence (top 3)</h4><ul>${(e.supporting || []).slice(0, 3).map(x => `<li>${esc(x)}</li>`).join('') || '<li class="muted">None identified.</li>'}</ul></div></div>
      </div>
      <div class="pt-ticket">
        <div class="pf-row"><label>Side <select id="ptSide"><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
          <label>Type <select id="ptType"><option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option><option value="stop_limit">Stop-limit</option></select></label>
          <label>Time in force <select id="ptTif"><option value="day">Day</option><option value="gtc">Good till cancelled</option></select></label></div>
        <div class="pf-row"><label>Size by <select id="ptBy"><option value="shares">shares</option><option value="usd">US$ amount</option><option value="pct">% of paper equity</option><option value="risk">risk to stop (US$)</option></select></label>
          <label><input id="ptAmt" value="10" size="9"></label><span class="muted" id="ptShares"></span></div>
        <div class="pf-row"><label id="ptLimL" hidden>Limit <input id="ptLim" size="9"></label><label id="ptStopL" hidden>Stop <input id="ptStop" size="9"></label></div>
        <div class="pf-row"><button class="btn" id="ptPrev">Preview order</button><button class="btn" id="ptConf" disabled>Confirm paper order</button><span id="ptMsg" class="muted"></span></div>
        <div id="ptOut"></div>
      </div>`;
    const ref = { price: px, clientId: null, preview: null };
    const shares = async () => {
      const by = $('ptBy').value, a = parseFloat($('ptAmt').value), fx = fin(d.price) && fin(px) && px ? (d.fxUSD ?? 1) * d.price / px : 1, pxUSD = px * fx;
      if (!fin(a) || a <= 0) return 0;
      if (by === 'shares') return Math.floor(a);
      if (by === 'usd') return Math.floor(a / pxUSD);
      const eq = st.view?.equityUSD ?? (await loadView())?.equityUSD;
      if (by === 'pct') return Math.floor(eq * a / 100 / pxUSD);
      const stop = parseFloat($('ptStop').value); if (!fin(stop) || stop >= px) return 0;
      return Math.floor(a / ((px - stop) * fx));                        // risk-based: lose about $a if the stop is hit
    };
    const sync = async () => {
      const t = $('ptType').value; $('ptLimL').hidden = !(t === 'limit' || t === 'stop_limit'); $('ptStopL').hidden = !(t === 'stop' || t === 'stop_limit' || $('ptBy').value === 'risk');
      if (!$('ptLim').value) $('ptLim').value = fin(px) ? px.toPrecision(6) : ''; if (!$('ptStop').value) $('ptStop').value = fin(px) ? (px * 0.95).toPrecision(6) : '';
      $('ptShares').textContent = `= ${await shares()} shares`; $('ptConf').disabled = true; ref.preview = null;
    };
    for (const id of ['ptSide', 'ptType', 'ptTif', 'ptBy', 'ptAmt', 'ptLim', 'ptStop']) $(id).onchange = sync;
    $('ptAmt').oninput = sync; sync();
    const order = async () => ({ sym: d.sym, side: $('ptSide').value, type: $('ptType').value, tif: $('ptTif').value, qty: await shares(), limit: parseFloat($('ptLim').value), stop: parseFloat($('ptStop').value), refPrice: ref.price });
    $('ptPrev').onclick = async () => {
      const o = await order(), { j } = await post('/api/paper/preview', o); ref.preview = j;
      if (j.error) { $('ptOut').innerHTML = `<p class="warn">${esc(j.error)}</p>`; return; }
      const es = j.estimate, c = j.checks;
      $('ptOut').innerHTML = `
        <table class="cp-t"><tr><td>Order</td><td><b>${esc(o.side)} ${o.qty} ${esc(d.sym)} · ${esc(o.type.replace('_', '-'))}${fin(o.limit) && o.type.includes('limit') ? ' @ ' + o.limit : ''}${fin(o.stop) && o.type.includes('stop') ? ' stop ' + o.stop : ''} · ${esc(o.tif)}</b></td></tr>
          <tr><td>Estimated fill</td><td>${es ? `${num(es.price, 4)} ${esc(listing)} ≈ ${usd(es.valueUSD)} (half-spread ${(1e4 * es.halfSpread).toFixed(1)} bp ${esc(es.spreadSource)}, impact ${fin(es.impact) ? (1e4 * es.impact).toFixed(1) + ' bp' : 'n/a'})` : 'n/a'}</td></tr>
          <tr><td>Fees (simulated)</td><td>${es ? usd(es.feeUSD) : 'n/a'}</td></tr>
          <tr><td>Expected time to fill</td><td>${es && fin(es.minutesToFill) ? (es.minutesToFill < 1 ? 'within the next quote' : `about ${es.minutesToFill.toFixed(0)} min of trading (≤ 10 % of volume per interval; partial fills likely)`) : 'n/a'} · ${pu(es?.participationOfADV, 3)} of daily volume</td></tr>
          <tr><td>Market</td><td>${j.snapshot.open ? 'open' : `<span class="warn">closed (${esc(j.snapshot.state)})</span>`} · quote ${when(j.snapshot.time)}</td></tr></table>
        ${c.blocks.length ? `<div class="cp-ev con"><h4>Blocked by risk controls</h4><ul>${c.blocks.map(b => `<li>${esc(b.text)}</li>`).join('')}</ul></div>` : ''}
        ${c.warnings.length ? `<div class="cp-ev unk"><h4>Warnings (confirming accepts them)</h4><ul>${c.warnings.map(b => `<li>${esc(b.text)}</li>`).join('')}</ul></div>` : ''}
        <p class="muted">${esc(j.disclosure)}</p>`;
      $('ptConf').disabled = !c.ok || !(o.qty > 0); ref.clientId = c.ok ? Math.random().toString(36).slice(2) + Date.now().toString(36) : null;
      $('ptMsg').textContent = c.ok ? 'Review, then confirm.' : 'Fix the blocking issues first.';
    };
    $('ptConf').onclick = async () => {
      $('ptConf').disabled = true; const o = { ...(await order()), clientId: ref.clientId }, { status, j } = await post('/api/paper/order', o);
      $('ptMsg').innerHTML = status === 401 ? `<span class="warn">${esc(j.error)}</span>` : j.status === 'rejected' ? `<span class="warn">Rejected: ${esc(j.reason)}</span>` : `Order ${esc(j.id)} accepted (${esc(j.status)}). It fills on later delayed quotes; see §7 Paper trading.`;
      loadView();
    };
  }

  // ---------- paper book view ----------
  async function loadView() { try { st.view = await (await fetch('/api/paper', { cache: 'no-store' })).json(); } catch { } if (document.getElementById('paper')?.classList.contains('on')) render(); return st.view; }
  function render() {
    const v = st.view; if (!v || !$('ptBook')) return;
    const pos = Object.entries(v.positions), A = window.AUTH?.state || {};
    $('ptBook').innerHTML = `
      <p class="muted">${esc(v.disclosure)} Venue: ${esc(v.venue)}. Category: <b>${esc(v.category)}</b>; never mixed with backtests.</p>
      <div class="cp-scores pf-cards">${[['Equity', usd(v.equityUSD), `started ${usd(v.startCashUSD)} on ${esc(v.created.slice(0, 10))}`], ['P&L', usd(v.pnlUSD), pc(v.pnlUSD / v.startCashUSD)], ['Cash', usd(v.cashUSD), `${usd(v.reservedUSD)} reserved by working buys`], ['Invested', usd(v.marketValueUSD), pu(v.marketValueUSD / v.equityUSD, 0) + ' of equity']].map(([k, a, b]) => `<div class="cp-score"><div class="muted">${k}</div><div class="cp-num">${a}</div><div class="muted">${b}</div></div>`).join('')}</div>
      <div class="va-grid"><figure class="fig"><div class="plot" id="ptEq" style="height:220px"></div><figcaption><b>Paper equity</b> (one point per day). Simulated fills against delayed quotes.</figcaption></figure>
        <figure class="fig"><div class="plot" id="ptSec" style="height:220px"></div><figcaption><b>Exposure by sector</b> (share of equity); the risk limit is ${pu(v.limits.maxSectorPct, 0)}.</figcaption></figure></div>
      <h4>Positions</h4>${pos.length ? `<div class="cp-scroll"><table class="cp-t"><tr><th>Company</th><th>Shares</th><th>Avg cost</th><th>Last</th><th>Value</th><th>Unrealised</th><th>Weight</th><th>Sector</th></tr>${pos.map(([s, p]) => `<tr><td>${esc(s)}</td><td>${p.qty}</td><td>$${num(p.avgCostUSD)}</td><td>${num(p.last)} ${esc(p.ccy)}${p.priced ? '' : ' <span class="warn">(no quote)</span>'}</td><td>${usd(p.valueUSD)}</td><td class="${p.unrealizedUSD < 0 ? 'neg' : 'pos'}">${usd(p.unrealizedUSD)}</td><td>${pu(p.weight)}</td><td>${esc(p.sector)}</td></tr>`).join('')}</table></div>` : '<p class="muted">No positions. Open a company on the heat map (§1) and use its "Trade (paper)" tab.</p>'}
      <h4>Orders</h4><div class="cp-scroll"><table class="cp-t"><tr><th>Time</th><th>Order</th><th>Status</th><th>Filled</th><th>Avg price</th><th>Fees</th><th>Note</th><th></th></tr>${v.orders.slice(0, 60).map(o => `<tr><td>${when(o.submittedAt)}</td><td>${esc(o.side)} ${o.qty} ${esc(o.sym)} ${esc(o.type.replace('_', '-'))}${o.limit ? ' @' + o.limit : ''}${o.stop ? ' stop ' + o.stop : ''} ${esc(o.tif)}</td>
        <td class="${o.status === 'rejected' ? 'warn' : ''}">${esc(o.status.replace('_', ' '))}</td><td>${o.filled}/${o.qty}</td><td>${fin(o.avgPrice) ? num(o.avgPrice, 4) : ''}</td><td>${o.feesUSD ? '$' + num(o.feesUSD) : ''}</td><td class="muted">${esc(o.reason || o.lastNote || '')}</td>
        <td>${['working', 'partially_filled'].includes(o.status) ? `<button class="btn mini" data-cx="${esc(o.id)}">Cancel</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No orders yet.</td></tr>'}</table></div>
      <details><summary>Fills (${v.fills.length})</summary><div class="cp-scroll"><table class="cp-t"><tr><th>Time (quote)</th><th>Fill</th><th>Price</th><th>Spread</th><th>Impact</th><th>vs last</th><th>Fee</th></tr>${v.fills.slice(0, 100).map(f => `<tr><td>${when(f.at)}</td><td>${esc(f.side)} ${f.qty} ${esc(f.sym)}</td><td>${num(f.price, 4)} ($${num(f.priceUSD, 4)})</td><td>${(1e4 * f.spread).toFixed(1)} bp</td><td>${(1e4 * f.impact).toFixed(1)} bp</td><td>${pc(f.slippageVsLast, 2)}</td><td>$${num(f.feeUSD)}</td></tr>`).join('')}</table></div></details>
      <details><summary>Risk limits</summary><table class="cp-t">${Object.entries(v.limits).map(([k, x]) => `<tr><td>${esc(k)}</td><td>${typeof x === 'boolean' ? (x ? 'yes' : 'no') : k.endsWith('Pct') ? `<input data-lim="${k}" value="${(100 * x).toFixed(1)}" size="5"> %` : `<input data-lim="${k}" value="${x}" size="6">`}</td></tr>`).join('')}</table><button class="btn mini" id="ptLimSave">Save limits</button> <span class="muted">Short selling stays disabled.</span></details>
      <details><summary>Reset the paper book</summary><p>Start again with <input id="ptCash" value="100000" size="9"> US$ of paper cash. Positions and orders are cleared; the audit log keeps the history. <button class="btn mini warn" id="ptReset">Reset</button></p></details>
      <details ${A.canWrite ? '' : 'open'}><summary>Access from other devices</summary>${A.loopback && A.token ? `<p>To place orders from your PC, open <code>http://&lt;phone address&gt;:8080/?token=${esc(A.token)}</code> once. Keep this token private.</p>` : `<p>${A.canWrite ? 'This browser can make changes.' : 'This browser is read-only. Open the page on the phone, copy the access link from here, and open it once on this device.'}</p>`}<button class="btn mini" id="ptForget">Forget token on this browser</button></details>`;
    $('ptBook').querySelectorAll('[data-cx]').forEach(b => b.onclick = async () => { const { j, status } = await post('/api/paper/cancel', { id: b.dataset.cx }); if (status >= 400) alert(j.error); loadView(); });
    $('ptLimSave').onclick = async () => { const l = {}; $('ptBook').querySelectorAll('[data-lim]').forEach(i => { const x = parseFloat(i.value); if (fin(x)) l[i.dataset.lim] = i.dataset.lim.endsWith('Pct') ? x / 100 : x; });
      const r = await fetch('/api/paper/limits', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(l) }); if (!r.ok) alert((await r.json()).error); loadView(); };
    $('ptReset').onclick = async () => { if (!confirm('Clear all paper positions and orders?')) return; const { j, status } = await post('/api/paper/reset', { cash: parseFloat($('ptCash').value) }); if (status >= 400) alert(j.error); loadView(); };
    $('ptForget').onclick = () => window.AUTH?.forget();
    const lay = extra => ({ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'IBM Plex Mono', size: 11, color: css('--text') }, margin: { l: 60, r: 10, t: 8, b: 30 }, showlegend: false, ...extra });
    Plotly.react('ptEq', [{ type: 'scatter', mode: 'lines+markers', x: v.snapshots.map(s => s.date), y: v.snapshots.map(s => s.equityUSD), line: { color: css('--accent') } }], lay({ yaxis: { gridcolor: css('--grid'), tickprefix: '$' } }), { displayModeBar: false, responsive: true });
    const secs = Object.entries(v.sectors).sort((a, b) => b[1] - a[1]);
    Plotly.react('ptSec', [{ type: 'bar', orientation: 'h', y: secs.map(x => x[0]), x: secs.map(x => x[1]), marker: { color: css('--accent2') } }], lay({ xaxis: { tickformat: '.0%', gridcolor: css('--grid'), range: [0, Math.max(0.5, ...secs.map(x => x[1]))] },
      shapes: [{ type: 'line', x0: v.limits.maxSectorPct, x1: v.limits.maxSectorPct, yref: 'paper', y0: 0, y1: 1, line: { color: css('--sell'), dash: 'dot' } }] }), { displayModeBar: false, responsive: true });
  }
  function init() {
    window.addEventListener('viewchange', e => { clearInterval(st.poll); if (e.detail === 'paper') { loadView(); st.poll = setInterval(loadView, 15000); } });
    window.addEventListener('authchange', () => render());
  }
  window.PAPER = { ticket, loadView, state: st };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
