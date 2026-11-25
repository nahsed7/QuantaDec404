// §6 Portfolio laboratory: build hypothetical portfolios from the tracked companies, see risk, diversification,
// exposures, liquidity, stress scenarios, alternative allocations and the opportunity cost of candidate additions.
// Everything is a hypothetical model output; nothing places an order. Data: /api/portfolio (saved), /api/portfolio/analyze.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fin = x => typeof x === 'number' && Number.isFinite(x);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pc = (x, d = 1) => fin(x) ? (x >= 0 ? '+' : '') + (100 * x).toFixed(d) + ' %' : 'n/a';
  const pu = (x, d = 1) => fin(x) ? (100 * x).toFixed(d) + ' %' : 'n/a';
  const nf = (x, d = 2) => fin(x) ? x.toFixed(d) : 'n/a';
  const usd = x => !fin(x) ? 'n/a' : Math.abs(x) >= 1e6 ? '$' + (x / 1e6).toFixed(2) + ' M' : Math.abs(x) >= 1e3 ? '$' + (x / 1e3).toFixed(1) + ' k' : '$' + x.toFixed(0);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const lay = extra => ({ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'IBM Plex Mono', size: 11, color: css('--text') }, margin: { l: 70, r: 12, t: 8, b: 32 }, legend: { orientation: 'h', y: 1.15 }, ...extra });
  const cfg = { displayModeBar: false, responsive: true };
  const st = { store: null, cur: null, universe: [], result: null, busy: false };
  const blank = () => ({ id: Date.now().toString(36), name: 'New portfolio', capital: 100000, holdYears: 2, weights: {}, candidates: [] });

  async function loadStore() {
    try { st.store = await (await fetch('/api/portfolio', { cache: 'no-store' })).json(); } catch { st.store = { portfolios: [], current: null, rev: 0 }; }
    st.cur = JSON.parse(JSON.stringify(st.store.portfolios.find(p => p.id === st.store.current) || st.store.portfolios[0] || starter()));
    if (!st.cur.candidates) st.cur.candidates = [];
  }
  // A first portfolio so the page is not empty: the five largest tracked companies by US$ market cap, equally weighted.
  function starter() {
    const top = st.universe.filter(s => fin(s.marketCapUSD)).sort((a, b) => b.marketCapUSD - a.marketCapUSD).slice(0, 5);
    return { ...blank(), name: 'Example: five largest (equal weight)', weights: Object.fromEntries(top.map(s => [s.sym, 0.2])) };
  }
  async function loadUniverse() { try { const u = await (await fetch('/api/research/universe')).json(); st.universe = u.stocks || []; } catch { st.universe = []; } }

  function renderBuilder() {
    const p = st.cur, lab = s => st.universe.find(x => x.sym === s)?.label || s, tot = Object.values(p.weights).reduce((a, b) => a + b, 0) || 1;
    $('pfBuilder').innerHTML = `
      <div class="pf-row"><label>Saved <select id="pfSel">${(st.store.portfolios.length ? st.store.portfolios : [p]).map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <button class="btn mini" id="pfNew">+ New</button><button class="btn mini" id="pfSave">Save</button><button class="btn mini" id="pfDel">Delete</button></div>
      <div class="pf-row"><label>Name <input id="pfName" value="${esc(p.name)}" size="22"></label><label>Capital (US$) <input id="pfCap" value="${p.capital}" size="9"></label>
        <label>Holding period (years) <input id="pfHold" value="${p.holdYears}" size="3"></label></div>
      <table class="cp-t pf-h"><tr><th>Holding</th><th>Weight %</th><th>US$</th><th></th></tr>${Object.entries(p.weights).map(([s, w]) => `<tr><td>${esc(lab(s))} <span class="muted">${esc(s)}</span></td>
        <td><input data-w="${esc(s)}" value="${(100 * w / tot).toFixed(1)}" size="5"></td><td>${usd(p.capital * w / tot)}</td><td><button class="btn mini" data-rm="${esc(s)}">×</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No holdings yet.</td></tr>'}</table>
      <div class="pf-row"><input id="pfAdd" list="pfList" placeholder="add a company (name or symbol)" size="28"><button class="btn mini" id="pfAddH">+ Holding</button><button class="btn mini" id="pfAddC">+ Candidate</button>
        <button class="btn mini" id="pfTray" title="Use the companies in the heat-map comparison tray as candidates">⇠ from compare tray</button></div>
      <datalist id="pfList">${st.universe.map(s => `<option value="${esc(s.sym)}">${esc(s.label)} · ${esc(s.sector)} · ${esc(s.country)}</option>`).join('')}</datalist>
      <div class="pf-row">Candidates to compare as additions: ${p.candidates.map(s => `<button class="chip" data-rc="${esc(s)}">${esc(lab(s))} ×</button>`).join(' ') || '<span class="muted">none</span>'}</div>
      <div class="pf-row"><button class="btn" id="pfRun">▶ Analyse</button><span class="muted" id="pfMsg"></span></div>`;
    const P = st.cur, num = (id, f) => { const x = parseFloat($(id).value); if (fin(x)) f(x); };
    $('pfName').onchange = () => { P.name = $('pfName').value; }; $('pfCap').onchange = () => num('pfCap', x => { P.capital = Math.max(1000, x); renderBuilder(); });
    $('pfHold').onchange = () => num('pfHold', x => { P.holdYears = Math.max(0.1, x); });
    $('pfBuilder').querySelectorAll('[data-w]').forEach(i => i.onchange = () => { const x = parseFloat(i.value); if (fin(x) && x > 0) P.weights[i.dataset.w] = x / 100; renderBuilder(); });
    $('pfBuilder').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { delete P.weights[b.dataset.rm]; renderBuilder(); });
    $('pfBuilder').querySelectorAll('[data-rc]').forEach(b => b.onclick = () => { P.candidates = P.candidates.filter(s => s !== b.dataset.rc); renderBuilder(); });
    const pickSym = () => { const v = $('pfAdd').value.trim(), u = st.universe.find(x => x.sym === v || x.sym === v.toUpperCase() || x.label.toLowerCase() === v.toLowerCase()); return u?.sym; };
    $('pfAddH').onclick = () => { const s = pickSym(); if (!s) return msg('Unknown company.'); const n = Object.keys(P.weights).length; P.weights[s] = n ? 1 / (n + 1) : 1; P.candidates = P.candidates.filter(x => x !== s); renderBuilder(); };
    $('pfAddC').onclick = () => { const s = pickSym(); if (!s) return msg('Unknown company.'); if (!P.candidates.includes(s) && !P.weights[s]) P.candidates.push(s); renderBuilder(); };
    $('pfTray').onclick = () => { for (const s of window.HEAT?.compareList?.() || []) if (!P.candidates.includes(s) && !P.weights[s]) P.candidates.push(s); renderBuilder(); };
    $('pfSel').onchange = () => { const x = st.store.portfolios.find(p => p.id === $('pfSel').value); if (x) { st.cur = JSON.parse(JSON.stringify({ candidates: [], ...x })); renderBuilder(); analyse(); } };
    $('pfNew').onclick = () => { st.cur = blank(); renderBuilder(); $('pfResult').innerHTML = ''; };
    $('pfSave').onclick = save; $('pfDel').onclick = del; $('pfRun').onclick = analyse;
  }
  const msg = t => { $('pfMsg').textContent = t; };
  async function put(next) {
    const r = await fetch('/api/portfolio', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(window.AUTH?.headers?.() || {}) }, body: JSON.stringify({ ...next, rev: st.store.rev }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); st.store = j; return j;
  }
  async function save() {
    const list = st.store.portfolios.filter(p => p.id !== st.cur.id).concat([{ ...st.cur }]);
    try { await put({ portfolios: list, current: st.cur.id }); msg('Saved. This portfolio now drives the concentration component of the risk score.'); renderBuilder(); } catch (e) { msg('Save failed: ' + e.message); }
  }
  async function del() {
    try { await put({ portfolios: st.store.portfolios.filter(p => p.id !== st.cur.id), current: null }); await loadStore(); renderBuilder(); $('pfResult').innerHTML = ''; msg('Deleted.'); } catch (e) { msg('Delete failed: ' + e.message); }
  }
  async function analyse() {
    if (st.busy) return; st.busy = true; msg('Analysing…');
    try {
      const r = await fetch('/api/portfolio/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weights: st.cur.weights, capital: st.cur.capital, holdYears: st.cur.holdYears, candidates: st.cur.candidates }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); st.result = j; msg(''); renderResult();
    } catch (e) { msg('Analysis failed: ' + e.message); } finally { st.busy = false; }
  }

  function renderResult() {
    const a = st.result, r = a.risk, liq = a.liquidity, maxDays = Math.max(...liq.map(x => x.daysToExit || 0));
    const card = (k, v, n) => `<div class="cp-score"><div class="muted">${k}</div><div class="cp-num">${v}</div><div class="muted">${n}</div></div>`;
    $('pfResult').innerHTML = `
      <p class="muted">${a.notes.map(esc).join(' ')} Data to ${esc(a.asOf)} (${a.weeks} weeks, ${esc(a.frequency)}).</p>
      <div class="cp-scores pf-cards">${card('Volatility', pu(r.vol), 'annualised')}${card('β', nf(a.beta), 'vs each stock\'s index')}${card('Diversification ratio', nf(r.diversificationRatio), 'Σwσ ÷ σ portfolio (1 = none)')}
        ${card('Effective bets', nf(r.effectiveBets, 1), `of ${r.contributions.length} holdings, by risk`)}${card('1-week VaR 95 %', pu(r.var95), usd(r.var95 * a.capital) + ' (parametric)')}${card('Longest exit', fin(maxDays) ? maxDays.toFixed(1) + ' days' : 'n/a', 'at ≤ 10 % of daily volume')}</div>
      <div class="va-grid">
        <figure class="fig"><div class="plot" id="pfRC" style="height:${70 + 26 * r.contributions.length}px"></div><figcaption><b>Money vs risk.</b> Each holding's share of the capital and its share of the portfolio's risk. Risk shares above the money shares mean that holding dominates the outcome.</figcaption></figure>
        <figure class="fig"><div class="plot" id="pfCorr" style="height:${120 + 30 * r.contributions.length}px"></div><figcaption><b>Correlation</b> of weekly US$ returns (shrunk). Dark = move together; light = diversify.</figcaption></figure>
      </div>
      <div class="va-grid">
        <figure class="fig"><div class="plot" id="pfExp" style="height:230px"></div><figcaption><b>Concentration</b> by sector, region and currency (Herfindahl: sector ${nf(a.exposures.sector.hhi)}, currency ${nf(a.exposures.currency.hhi)}; 1 = everything in one).</figcaption></figure>
        <figure class="fig"><div class="plot" id="pfLB" style="height:230px"></div><figcaption><b>Hypothetical look-back</b> (rebalanced every 4 weeks) vs SPY. <span class="warn">In-sample:</span> the same period the risk was measured on; not a forecast and not a real result.</figcaption></figure>
      </div>
      <h4>Stress scenarios</h4><table class="cp-t"><tr><th>Scenario</th><th>Effect</th><th>How it is estimated</th></tr>${a.scenarios.map(s => `<tr><td>${esc(s.name)}</td><td><b>${scenText(s, a)}</b></td><td class="muted">${esc(s.method)}</td></tr>`).join('')}</table>
      <h4>Alternative allocations of the same capital <span class="muted">(research comparison; none is executed)</span></h4>${allocTable(a)}
      <h4>Exposure by market regime <span class="muted">(regime known at the time; hypothetical, in-sample)</span></h4>
      <table class="cp-t"><tr><th>Regime</th><th>Weeks</th><th>Return / yr</th><th>Volatility</th></tr>${(a.regimes || []).map(x => `<tr><td>${esc(x.regime)}</td><td>${x.periods}</td><td>${pc(x.annReturn)}</td><td>${pu(x.annVol)}</td></tr>`).join('')}</table>
      <h4>Liquidity and cost to build</h4><table class="cp-t"><tr><th>Holding</th><th>US$</th><th>Days to exit</th><th>Cost</th></tr>${liq.map(x => `<tr><td>${esc(x.sym)}</td><td>${usd(x.usd)}</td><td>${nf(x.daysToExit, 2)}</td><td>${fin(x.costBp) ? x.costBp.toFixed(1) + ' bp · ' + usd(x.costUSD) : 'n/a'}</td></tr>`).join('')}</table>
      <p class="muted">Costs = half the spread (estimated from daily high/low/close; this estimate is biased upward for very volatile stocks) + square-root market impact. Quoted spreads would replace the estimate when a quote feed is configured.</p>
      ${a.opportunity.length ? oppTable(a) : '<p class="muted">Add candidates to see what adding each one would do to this portfolio.</p>'}`;
    charts(a);
  }
  function scenText(s, a) {
    if (s.unit === 'return' || s.unit === 'value') return `${pc(s.impact)} ${fin(s.impact) && s.unit === 'return' ? `(${usd(s.impact * a.capital)})` : ''}${s.coverage != null && s.coverage < 1 ? ` · ${pu(s.coverage, 0)} of holdings have a valuation` : ''}`;
    if (s.unit === 'vol') return `volatility ${pu(s.before)} → ${pu(s.impact)}${fin(s.var95) ? ` · 1-week VaR ${pu(s.var95Before)} → ${pu(s.var95)}` : ''}`;
    if (s.unit === 'cost') return `exit cost ${pu(s.before, 2)} → ${pu(s.impact, 2)} of capital · longest exit ${nf(s.daysBefore, 1)} → ${nf(s.daysAfter, 1)} days`;
    return nf(s.impact);
  }
  function allocTable(a) {
    const syms = Object.keys(a.allocations[0].weights);
    return `<div class="cp-scroll"><table class="cp-t"><tr><th>Allocation</th>${syms.map(s => `<th>${esc(s)}</th>`).join('')}<th>Volatility</th><th>Diversification</th><th>Effective bets</th><th>Max sector</th><th>Build cost</th><th>Premium to value</th><th>Look-back CAGR <span class="warn">(in-sample)</span></th></tr>
      ${a.allocations.map((x, k) => `<tr class="${k === 0 ? 'va-pick' : ''}"><td>${esc(x.name)}<br><span class="muted">${esc(x.note)}</span></td>${syms.map(s => `<td>${pu(x.weights[s], 0)}</td>`).join('')}<td>${pu(x.vol)}</td><td>${nf(x.diversificationRatio)}</td><td>${nf(x.effectiveBets, 1)}</td>
        <td>${esc(x.maxSector?.group || '')} ${pu(x.maxSector?.weight, 0)}</td><td>${usd(x.buildCostUSD)}</td><td>${pc(x.weightedPremium, 0)}</td><td>${pc(x.lookback?.cagr)}</td></tr>`).join('')}</table></div>
      <p class="muted">Lower volatility or more diversification is not automatically better: each allocation trades off concentration, valuation and cost differently. The look-back column is in-sample and must not be used to choose.</p>`;
  }
  function oppTable(a) {
    const o = a.opportunity;
    return `<h4>Opportunity cost of each candidate <span class="muted">(added at 5 %, funded pro rata; holding period ${a.holdYears} years)</span></h4>
      <div class="cp-scroll"><table class="cp-t"><tr><th>Candidate</th><th>Price vs value</th><th>Assumed growth</th><th>Risk score</th><th>Confidence</th><th>Correlation with holdings</th><th>Portfolio volatility</th><th>Sector weight after</th><th>Entry cost</th><th>Return needed to cover costs</th><th>Yield vs risk-free</th></tr>
      ${o.map(x => x.error ? `<tr><td>${esc(x.sym)}</td><td colspan="10">${esc(x.error)}</td></tr>` : `<tr><td>${esc(x.label)} <span class="muted">${esc(x.sector)}</span></td><td>${pc(x.premium, 0)} <span class="muted">${esc(x.status || '')}</span></td><td>${pu(x.growth)}</td><td>${x.riskScore ?? 'n/a'}</td><td>${x.confidence ?? 'n/a'}</td>
        <td>${nf(x.corrWithHoldings)}</td><td>${pu(x.portfolioVolBefore)} → ${pu(x.portfolioVolAfter)} (${fin(x.marginalVol) ? (x.marginalVol >= 0 ? '+' : '') + (100 * x.marginalVol).toFixed(2) + ' pts' : 'n/a'})</td><td>${pu(x.sectorWeightAfter, 0)}</td>
        <td>${fin(x.entryCostBp) ? x.entryCostBp.toFixed(1) + ' bp' : 'n/a'}</td><td>${fin(x.hurdle) ? pu(x.hurdle, 2) + ' / yr' : 'n/a'}</td><td>${pc(x.yieldVsRiskFree)}</td></tr>`).join('')}</table></div>
      <p class="muted">Alternative use of the capital: the ${esc(a.riskFree.label)} at ${pu(a.riskFree.rate, 2)}. A candidate only adds value if its expected excess return beats that rate plus the cost hurdle, after the change in risk. The highest projected return is not automatically the best addition; this table does not choose.</p>`;
  }
  function charts(a) {
    const rc = a.risk.contributions, y = rc.map(c => c.sym);
    Plotly.react('pfRC', [{ type: 'bar', orientation: 'h', name: 'share of money', y, x: rc.map(c => c.weight), marker: { color: css('--accent2') } },
      { type: 'bar', orientation: 'h', name: 'share of risk', y, x: rc.map(c => c.pctRisk), marker: { color: css('--sell') } }], lay({ barmode: 'group', xaxis: { tickformat: '.0%', gridcolor: css('--grid') }, yaxis: { autorange: 'reversed' } }), cfg);
    const M = a.correlation.matrix, s = a.correlation.syms;
    Plotly.react('pfCorr', [{ type: 'heatmap', z: M, x: s, y: s, zmin: -1, zmax: 1, colorscale: [[0, '#1f78b4'], [0.5, '#f2f2f2'], [1, '#b2182b']], text: M.map(r => r.map(v => v.toFixed(2))), texttemplate: '%{text}', hovertemplate: '%{y} / %{x}: %{z:.2f}<extra></extra>', showscale: false }],
      lay({ margin: { l: 90, r: 10, t: 8, b: 80 }, yaxis: { autorange: 'reversed' } }), cfg);
    const ex = a.exposures, groups = [['Sector', ex.sector], ['Region', ex.region], ['Currency', ex.currency]], palette = ['--accent', '--accent2', '--violet', '--warn', '--buy', '--sell', '--muted'];
    const names = [...new Set(groups.flatMap(([, g]) => g.rows.map(r => r.group)))];
    Plotly.react('pfExp', names.map((n, k) => ({ type: 'bar', orientation: 'h', name: n, y: groups.map(g => g[0]), x: groups.map(([, g]) => g.rows.find(r => r.group === n)?.weight || 0), marker: { color: css(palette[k % palette.length]) }, hovertemplate: n + ': %{x:.0%}<extra></extra>' })),
      lay({ barmode: 'stack', showlegend: false, xaxis: { tickformat: '.0%', range: [0, 1], gridcolor: css('--grid') } }), cfg);
    const lb = a.lookback;
    if (lb) Plotly.react('pfLB', [{ type: 'scatter', mode: 'lines', name: 'portfolio (hypothetical)', x: lb.curve.map(p => new Date(p[0])), y: lb.curve.map(p => p[1]), line: { color: css('--accent'), width: 2 } },
      ...(lb.bench ? [{ type: 'scatter', mode: 'lines', name: 'SPY', x: lb.bench.map(p => new Date(p[0])), y: lb.bench.map(p => p[1]), line: { color: css('--muted') } }] : [])], lay({ yaxis: { gridcolor: css('--grid'), title: { text: 'growth of 1' } }, xaxis: { gridcolor: css('--grid') } }), cfg);
  }

  async function init() {
    if (!$('pfBuilder')) return;
    let ready = false;
    const go = async () => { if (ready) return; ready = true; await loadUniverse(); await loadStore(); renderBuilder(); if (Object.keys(st.cur.weights).length) analyse(); };
    window.addEventListener('viewchange', e => { if (e.detail === 'port') go(); });
    window.PORT = { addCandidate: s => { if (!st.cur) return; if (!st.cur.candidates.includes(s) && !st.cur.weights[s]) st.cur.candidates.push(s); renderBuilder(); }, state: st, go, analyse };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
