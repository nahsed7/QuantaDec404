// §1 Valuation-integrated heat map, company research panel and comparison.
// Uses the shared analytics in /lib (QStats, QTree, QVal, QQuant, QDecision) so assumption edits recompute in the browser.
(function () {
  'use strict';
  const $ = id => document.getElementById(id), S = window.QStats, T = window.QTree, V = window.QVal, Q = window.QQuant;
  const fin = x => typeof x === 'number' && Number.isFinite(x);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pc = (x, d = 1) => fin(x) ? (x >= 0 ? '+' : '') + (100 * x).toFixed(d) + ' %' : 'n/a';
  const pu = (x, d = 1) => fin(x) ? (100 * x).toFixed(d) + ' %' : 'n/a';
  const num = (x, d = 2) => fin(x) ? x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) }) : 'n/a';
  const big = x => !fin(x) ? 'n/a' : Math.abs(x) >= 1e12 ? (x / 1e12).toFixed(2) + ' T' : Math.abs(x) >= 1e9 ? (x / 1e9).toFixed(1) + ' B' : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(1) + ' M' : num(x, 0);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const KIND = { live: 'live', delayed: 'delayed', historical: 'historical', estimate: 'estimate', simulated: 'simulated' };
  const badge = k => `<span class="kind kind-${k}">${KIND[k] || k}</span>`;

  // ---- encodings live in /lib/encodings.js (shared with the tests), so tiles, tooltip and legend always agree ----
  const E = window.QEnc, COLOR = E.COLOR, SIZE = E.SIZE, GROUP = E.GROUP;
  const customN = () => S.clamp(+($('hmN')?.value) || 10, 1, 252);
  const encOpts = () => ({ color: $('hmColor').value, customN: customN(), borders: $('hmBorders').checked, markers: $('hmMarkers').checked, computedAt: st.data?.recomputedAt });
  const colourVal = E.colourVal, scaleEnds = E.scaleEnds;
  const kindBadge = (c, s) => badge(E.kindOf(c, s || { fresh: { priceKind: 'delayed' } }));
  const when = t => fin(t) ? new Date(t).toLocaleString() : 'n/a';
  const ccyPrice = (s, x = s.price) => fin(x) ? `${num(x)} ${esc(s.ccy || '')}` : 'n/a';

  // ---- state ----
  const st = { data: null, sel: null, compare: [], company: new Map(), tab: 'overview' };
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('hm-prefs') || '{}'); } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('hm-prefs', JSON.stringify({ size: $('hmSize').value, color: $('hmColor').value, n: $('hmN').value, borders: $('hmBorders').checked, markers: $('hmMarkers').checked, flags: $('hmFlags').checked, group: $('hmGroup').value, region: $('hmRegion').value })); } catch {} };
  const visible = d => d.stocks.filter(s => $('hmRegion').value === 'all' || (s.region || 'US') === $('hmRegion').value);

  async function load() {
    try {
      const r = await fetch('/api/research/universe', { cache: 'no-store' }); st.data = await r.json();
      window.setStatus?.('quotes', 'ok'); draw();
    } catch (e) { window.setStatus?.('quotes', 'error'); $('hmStatus').textContent = 'Could not load research data: ' + e.message; }
  }

  function draw() {
    const d = st.data, box = $('hmMap'); if (!d || !box || !box.clientWidth) return;
    regimeStrip(d);
    const sizeK = $('hmSize').value, colK = $('hmColor').value, grp = GROUP[$('hmGroup').value] || GROUP.sector, o = encOpts();
    $('hmNL').hidden = colK !== 'custom';
    const shown = visible(d), sz = E.sizes(shown, sizeK);
    const items = shown.map((s, i) => ({ ...s, sector: grp.key(s), realSector: s.sector, ...sz[i] }));
    const W = box.clientWidth, H = Math.max(420, Math.min(900, Math.round(W * (shown.length > 60 ? 0.7 : 0.58))));
    box.style.height = H + 'px';
    const L = T.layout(items, W, H, 16, 2);
    const html = [];
    for (const g of L.sectors) html.push(`<div class="hm-sector" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px">${g.header ? `<span>${esc(g.id)}</span>` : ''}</div>`);
    for (const t of L.tiles) {
      const m = E.tile(t, o), border = m.border ? `outline:2px ${m.border.style} ${m.border.colour};outline-offset:-3px;` : '';
      const mk = m.marker && t.w > 54 && t.h > 38 ? m.marker : null, flag = $('hmFlags').checked && (m.context.code === 'away' || m.context.code === 'toward') ? m.context.code : '';
      const fs = Math.max(9, Math.min(16, Math.sqrt(t.w * t.h) / 6));
      html.push(`<button class="hm-tile${m.missing ? ' missing' : ''}${t.sizeMissing ? ' nosize' : ''}${st.compare.includes(t.sym) ? ' cmp' : ''}${flag ? ' ctx-' + flag : ''}" data-sym="${esc(t.sym)}" aria-label="${esc(m.label)}: ${esc(m.valueText)}, ${esc(m.statusLabel)}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;${m.fill ? `background:${m.fill};` : ''}${border}font-size:${fs}px">`
        + (t.w > 28 && t.h > 16 ? `<b>${esc(t.w > 70 ? m.label : (t.label || t.sym).slice(0, 8))}</b>` : '') + (t.w > 48 && t.h > 30 ? `<i>${esc(m.valueText)}</i>` : '')
        + (mk ? `<span class="hm-mk"><span class="r" style="left:${100 * mk.low}%;width:${100 * (mk.high - mk.low)}%"></span>${fin(mk.base) ? `<span class="b" style="left:${100 * mk.base}%"></span>` : ''}<span class="p" style="left:${100 * mk.price}%"></span></span>` : '')
        + '</button>');
    }
    box.innerHTML = html.join('');
    legend(colK, sizeK, d);
    pulse(shown);
    const err = Object.keys(d.errors || {}), nIntl = shown.filter(s => s.region === 'International').length, noFil = shown.filter(s => s.hasFilings === false).length;
    $('hmCaption').textContent = `${shown.length} large companies (${shown.length - nIntl} US, ${nIntl} international${noFil ? `, ${noFil} without a free filings source` : ''}) grouped by ${grp.label.toLowerCase()}.`;
    $('hmStatus').innerHTML = d.builtAt ? `research built ${new Date(d.builtAt).toLocaleString()} · prices recomputed ${new Date(d.recomputedAt).toLocaleTimeString()}${err.length ? ` · <span class="warn">failed: ${esc(err.join(', '))}</span>` : ''}`
      : `Loading research data… ${d.loaded}/${d.total} companies (first load downloads ~25 MB of SEC filings, then caches them for a week).`;
  }

  // One plain-language sentence about the whole map: breadth, typical move, moves relative to estimated value, movers.
  function pulse(shown) {
    const el = $('hmPulse'); if (!el) return;
    const m = shown.filter(s => fin(s.change1d)); if (m.length < 5) { el.textContent = ''; return; }
    const up = m.filter(s => s.change1d > 0).length, med = S.median(m.map(s => s.change1d)), ctx = m.map(s => [s, E.moveContext(s).code]);
    const away = ctx.filter(([, c]) => c === 'away').length, toward = ctx.filter(([, c]) => c === 'toward').length;
    const sorted = m.slice().sort((a, b) => b.change1d - a.change1d), name = s => `${esc(s.label || s.sym)} ${pc(s.change1d)}`;
    const breadth = up / m.length > 0.65 ? '<b class="up">broadly up</b>' : up / m.length < 0.35 ? '<b class="down">broadly down</b>' : '<b>mixed</b>';
    el.innerHTML = `<b>Today:</b> the market is ${breadth}: ${up} of ${m.length} companies rose; the typical move is ${pc(med)}.
      ${away ? `<b>${away}</b> are moving <i>further away</i> from their estimated value range` : ''}${away && toward ? ', ' : ''}${toward ? `<b>${toward}</b> are moving <i>back toward</i> it` : ''}${away || toward ? ' (corner flags).' : ''}
      Biggest gains: ${sorted.slice(0, 3).map(name).join(', ')}. Biggest falls: ${sorted.slice(-3).reverse().map(name).join(', ')}.
      <span class="muted">Moves use delayed quotes or the last close; estimated ranges are uncertain.</span>`;
  }
  function regimeStrip(d) {
    const r = d.regime, el = $('hmRegime'); if (!el) return;
    if (!r?.available) { el.innerHTML = '<span class="muted">Market regime: not available yet.</span>'; return; }
    el.innerHTML = `<span><b>Market regime</b> ${esc(r.trend)} <span class="muted">(${pu(r.trendAgreement, 0)} of indicators agree · uncertainty ${esc(r.uncertainty)})</span></span>
      <span><b>Volatility</b> ${esc(r.volatility.regime)} <span class="muted">(S&P 500 20-day ${pu(r.volatility.realised20, 0)}, ${fin(r.volatility.vix) ? 'VIX ' + r.volatility.vix.toFixed(1) : ''})</span></span>
      <span><b>Liquidity stress</b> ${esc(r.liquidityStress.level)}</span>
      <span><b>Risk-free</b> ${fin(d.rf?.y10) ? pu(d.rf.y10, 2) : 'n/a'} <span class="muted">10-yr Treasury ${esc(d.rf?.date || '')}</span></span>
      <button class="btn mini" id="hmRegimeBtn">details</button>`;
    $('hmRegimeBtn').onclick = () => openRegime();
  }

  function legend(colK, sizeK, d) {
    const c = COLOR[colK], sc = c.scale, [lo, hi] = scaleEnds(sc), stops = E.legendStops(colK).map(x => x.fill);
    $('hmLegend').innerHTML = `
      <div><b>Colour</b>: ${esc(c.label)} ${kindBadge(c)} <span class="muted">${esc(c.src)}</span>
        <div class="hm-grad" style="background:linear-gradient(90deg,${stops.join(',')})"></div>
        <div class="hm-gradl"><span>${esc(c.fmt(lo, null))}${sc.kind === 'diverging' ? ' or less' : ' or less'}</span><span>${sc.invert ? 'expensive ← → cheap' : ''}</span><span>${esc(c.fmt(hi, null))} or more</span></div>
        <span class="hm-sw missing"></span> no data for this company (never filled in)</div>
      <div><b>Size</b>: ${esc(SIZE[sizeK].label)} <span class="muted">${esc(SIZE[sizeK].src)}</span>. <span class="hm-sw nosize"></span> dashed corner = value unavailable, drawn at the smallest size.</div>
      <div><b>Border</b> = price vs estimated valuation range: ${Object.values(T.STATUS).map(s => `<span class="hm-sw" style="${s.colour ? `outline:2px ${s.border} ${s.colour};outline-offset:-3px` : ''}"></span>${esc(s.label)}`).join(' ')}</div>
      <div><b>Marker</b> (larger tiles): <span class="hm-mk demo"><span class="r" style="left:20%;width:55%"></span><span class="b" style="left:45%"></span><span class="p" style="left:85%"></span></span>
        bar = conservative…optimistic valuation, thin line = base, bright tick = current price. An estimate, never an exact fair value.</div>
      <div><b>Corner flag</b>: <span class="hm-sw ctx-away"></span> today's move (≥ ${(100 * E.FLAT).toFixed(1)} %) takes a price that is already outside the range <i>further away</i> from it ·
        <span class="hm-sw ctx-toward"></span> <i>back toward</i> it. A +2 % day reads differently above the range than below it. Neither is a forecast, and being below the range does not imply the price will rise.</div>
      <div class="muted">Data kinds: ${badge('delayed')} quotes (Yahoo, may lag ~15 min) · ${badge('historical')} filings, daily bars, FX and bond yields · ${badge('estimate')} computed valuations and scores · ${badge('simulated')} none on this map.
        International prices are converted to each company's reporting currency at Yahoo FX rates; sizes are in US$.</div>`;
  }
  // ---- tooltip ----
  function tip(e) {
    const t = e.target.closest('.hm-tile'), el = $('hmTip');
    if (!t) { el.hidden = true; return; }
    const s = st.data.stocks.find(x => x.sym === t.dataset.sym); if (!s) return;
    const v = s.valuation, o = encOpts(), c = COLOR[o.color], m = E.tile(s, o), a = v.assumptions || {};
    const conf = fin(v.agreement) ? `${pu(v.agreement, 0)} of other models inside the range` : 'no cross-check model';
    el.innerHTML = `<b>${esc(s.label || s.sym)}</b> ${esc(s.name !== s.label ? s.name : '')} <span class="muted">${esc(s.sym)} · ${esc(s.sector)} · ${esc(s.country || '')}</span><br>
      Price ${ccyPrice(s)}${fin(s.nativePrice) && s.listing?.quotedIn !== s.ccy ? ` <span class="muted">(${num(s.nativePrice)} ${esc(s.listing.quotedIn)})</span>` : ''} ${badge(s.fresh?.priceKind?.startsWith('delayed') ? 'delayed' : 'historical')} <span class="muted">${when(s.fresh?.priceTime)}</span><br>
      ${esc(c.label)}: <b>${esc(m.valueText)}</b> ${badge(m.kind)} <span class="muted">as of ${when(m.asOf)}</span><br>
      Valuation ${badge('estimate')}: ${fin(v.base) ? `${num(v.low)} … <b>${num(v.base)}</b> … ${num(v.high)} ${esc(s.ccy)} (${esc(v.primaryName || v.primary)}) · price ${pc(v.premium, 0)} vs base` : 'n/a'}<br>
      <span style="color:${T.STATUS[m.status].colour || 'inherit'}">${esc(m.statusLabel)}</span>${fin(v.base) ? ` <span class="muted">· model confidence: range ×${fin(v.widthRatio) ? v.widthRatio.toFixed(2) : 'n/a'} wide, ${conf}</span>` : ''}<br>
      ${fin(v.base) && fin(a.discountRate) ? `<span class="muted">Principal assumptions: discount rate ${pu(a.discountRate)}${fin(a.growth) ? `, growth ${pu(a.growth)}` : ''}${fin(a.terminalGrowth) ? `, terminal ${pu(a.terminalGrowth)}` : ''}; risk-free ${pu(s.rf?.value, 2)} (${esc(s.rf?.label || '')})</span><br>` : ''}
      <i>${esc(m.context.text)}</i><br>
      Opportunity ${s.scores.opportunity ?? 'n/a'} · Risk ${s.scores.risk ?? 'n/a'} · Confidence ${s.scores.confidence ?? 'n/a'} <span class="muted">(independent, not combined)</span><br>
      <span class="muted">Data completeness ${pu(s.completeness, 0)}${s.dataNotes?.length ? ' · ' + s.dataNotes.map(esc).join(' · ') : ''} · click for research, shift-click (or long-press) to compare</span>`;
    const r = $('hmWrap').getBoundingClientRect(), x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    el.hidden = false; el.style.left = Math.max(0, Math.min(x, r.width - el.offsetWidth - 4)) + 'px'; el.style.top = Math.min(y, r.height - el.offsetHeight + 60) + 'px';
  }

  // ---- research panel ----
  async function getCompany(sym) {
    if (st.company.has(sym) && Date.now() - st.company.get(sym).at < 60e3) return st.company.get(sym).d;
    const r = await fetch('/api/research/company?sym=' + encodeURIComponent(sym)); if (!r.ok) throw new Error((await r.json()).error || r.status);
    const d = await r.json(); st.company.set(sym, { at: Date.now(), d }); return d;
  }
  async function open(sym) {
    st.sel = sym; const p = $('hmPanel'); p.hidden = false; document.body.classList.add('hm-open');
    $('hmPanelBody').innerHTML = '<p class="muted">Loading…</p>';
    try { const d = await getCompany(sym); st.edit = { ...d.valuation.assumptions }; renderPanel(d); }
    catch (e) { $('hmPanelBody').innerHTML = `<p class="warn">Could not load ${esc(sym)}: ${esc(e.message)}</p>`; }
  }
  function close() { $('hmPanel').hidden = true; document.body.classList.remove('hm-open'); st.sel = null; }

  const TABS = [['overview', 'Assessment'], ['valuation', 'Valuation'], ['history', 'Price & value history'], ['market', 'Market behaviour'], ['fund', 'Fundamentals'], ['trade', 'Trade (paper)'], ['sources', 'Sources']];
  function renderPanel(d) {
    const v = d.valuation.synthesis, status = T.STATUS[v.status] || T.STATUS.insufficient;
    $('hmPanelBody').innerHTML = `
      <div class="cp-head"><div><h3 class="cp-title">${esc(d.label || d.sym)} <span class="muted">${esc(d.name)} · ${esc(d.sym)}</span></h3>
        <div class="muted">${esc(d.sector)} · ${esc(d.region || 'US')}${d.country && d.country !== 'US' ? ' (' + esc(d.country) + ')' : ''} · price ${ccyPrice(d)} ${badge(d.fresh?.priceKind?.startsWith('delayed') ? 'delayed' : 'historical')} · market cap ${big(d.marketCap)} ${esc(d.ccy || '')}${d.ccy !== 'USD' && fin(d.marketCapUSD) ? ` ($${big(d.marketCapUSD)})` : ''}</div>
        ${d.dataNotes?.length ? `<div class="warn small">${d.dataNotes.map(esc).join('<br>')}</div>` : ''}</div>
        <div><button class="btn mini" id="cpCmp">${st.compare.includes(d.sym) ? '− Remove from compare' : '+ Compare'}</button> <button class="btn mini" id="cpPort" title="Assess as an addition in the Portfolio lab (§6)">+ Portfolio candidate</button></div></div>
      <div class="cp-scores">${scoreCard('Opportunity', d.decision.opportunity)}${scoreCard('Risk', d.decision.risk)}${scoreCard('Confidence', d.decision.confidence)}</div>
      <p class="cp-interp">${esc(d.decision.interpretation)}</p>${d.regime?.available ? `<p class="muted">Market regime (${esc(d.marketName || 'S&P 500')}): <b>${esc(d.regime.trend)}</b>, volatility ${esc(d.regime.volatility.regime)}, ${pu(d.regime.trendAgreement, 0)} of indicators agree (uncertainty ${esc(d.regime.uncertainty)}).</p>` : ''}<p class="muted"><i>${esc(E.moveContext({ ...d, valuation: d.valuation.synthesis }).text)}</i></p>
      <p class="cp-val">Valuation ${badge('estimate')}: ${fin(v.base) ? `conservative <b>${num(v.low)}</b> · base <b>${num(v.base)}</b> · optimistic <b>${num(v.high)}</b> (${esc(modelName(d, v.primary))}) · price ${pc(v.premium, 0)} vs base` : 'no applicable model'}
        · <span style="color:${status.colour || 'inherit'}">${esc(status.label)}</span>${v.notes?.length ? `<br><span class="muted">${v.notes.map(esc).join(' ')}</span>` : ''}</p>
      <nav class="cp-tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
      <div id="cpTab"></div>`;
    $('cpCmp').onclick = () => { toggleCompare(d.sym); renderPanel(d); };
    $('cpPort').onclick = async () => { await window.PORT?.go?.(); window.PORT?.addCandidate(d.sym); $('cpPort').textContent = '✓ added to §6 candidates'; };
    $('hmPanelBody').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; renderPanel(d); });
    ({ overview: tabOverview, valuation: tabValuation, history: tabHistory, market: tabMarket, fund: tabFund, trade: tabTrade, sources: tabSources })[st.tab](d);
  }
  const modelName = (d, id) => d.valuation.models.find(m => m.id === id)?.name || id || 'none';
  function scoreCard(name, s) {
    const b = window.QDecision.band(s.score);
    return `<div class="cp-score"><div class="muted">${name}</div><div class="cp-num">${s.score ?? 'n/a'}<small>/100</small></div><div class="muted">${s.withheld ? `<span class="warn">withheld: ${esc(s.withheld)}</span>` : `${b} · ${s.known}/${s.total} parts measured`}</div></div>`;
  }
  const list = (title, arr, cls = '') => `<div class="cp-ev ${cls}"><h4>${title} <span class="muted">(${arr.length})</span></h4>${arr.length ? '<ul>' + arr.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : '<p class="muted">None identified.</p>'}</div>`;
  const EVS = { supported: 'supported out of sample', weak: 'weak out of sample → half weight', mixed: 'mixed out of sample → ¾ weight', untested: 'untested' };
  function partsTable(s) {
    return `<div class="cp-scroll"><table class="cp-t"><tr><th>Component</th><th>Score</th><th>Weight<br><span class="muted">prior → used</span></th><th>Out-of-sample evidence</th><th>Explanation</th><th>How it is computed (source)</th></tr>${s.parts.map(p => `<tr class="${p.missing || !fin(p.score) ? 'muted' : ''}"><td>${esc(p.name)}</td><td>${fin(p.score) && !p.missing ? Math.round(p.score) : 'n/a'}</td>
      <td>${p.priorWeight}${p.weight !== p.priorWeight ? ` → <b class="warn">${+p.weight.toFixed(2)}</b>` : ''}</td>
      <td>${p.evidence ? `${esc(EVS[p.evidence.status] || p.evidence.status)}${fin(p.evidence.testSharpe) ? `<br><span class="muted">${esc(p.evidence.family)}: test Sharpe ${p.evidence.testSharpe.toFixed(2)}, walk-forward ${pc(p.evidence.walkForwardExcess)}/yr, beats ${pu(p.evidence.randomPercentile, 0)} of random</span>` : ''}` : '<span class="muted">n/a</span>'}</td>
      <td>${esc(p.explain)}</td><td class="muted">${esc(p.calc || '')}${p.source ? ` (${esc(p.source)})` : ''}${p.weightRationale ? `<br>Weight: ${esc(p.weightRationale)}` : ''}</td></tr>`).join('')}</table></div>`;
  }
  // "At a glance": the valuation thermometer (price against the conservative…optimistic range, drawn to scale),
  // the three independent scores as bars, the verdict and the strongest reasons on each side.
  function glance(d) {
    const v = d.valuation.synthesis, e = d.decision.evidence, cur = esc(d.ccy || '');
    let thermo = '<p class="muted">No valuation range: too little data to estimate value.</p>';
    if (fin(v.low) && fin(v.high) && fin(d.price) && v.high > v.low) {
      const lo = Math.min(v.low, d.price) * 0.92, hi = Math.max(v.high, d.price) * 1.08, X = x => 20 + 560 * (x - lo) / (hi - lo);
      const col = (T.STATUS[v.status] || {}).colour || css('--accent2'), px = X(d.price);
      thermo = `<svg class="thermo" viewBox="0 0 600 78" role="img" aria-label="Price ${num(d.price)} against estimated value range ${num(v.low)} to ${num(v.high)}">
        <line x1="20" x2="580" y1="34" y2="34" stroke="currentColor" stroke-opacity=".25" stroke-width="2"/>
        <rect x="${X(v.low)}" y="24" width="${X(v.high) - X(v.low)}" height="20" rx="4" fill="${css('--accent2')}" fill-opacity=".35"/>
        ${fin(v.base) ? `<line x1="${X(v.base)}" x2="${X(v.base)}" y1="20" y2="48" stroke="currentColor" stroke-width="2"/>` : ''}
        <path d="M${px - 7},8 L${px + 7},8 L${px},20 Z" fill="${col}"/><line x1="${px}" x2="${px}" y1="20" y2="50" stroke="${col}" stroke-width="3"/>
        <text x="${px}" y="6" text-anchor="middle" font-size="11" fill="currentColor">price ${num(d.price)}</text>
        <text x="${X(v.low)}" y="64" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity=".8">conservative ${num(v.low)}</text>
        ${fin(v.base) ? `<text x="${X(v.base)}" y="76" text-anchor="middle" font-size="10" fill="currentColor">base ${num(v.base)}</text>` : ''}
        <text x="${X(v.high)}" y="64" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity=".8">optimistic ${num(v.high)}</text></svg>
        <p class="glance-v"><b style="color:${col}">${esc((T.STATUS[v.status] || {}).label || v.status)}</b>: the price is ${fin(v.premium) ? `${pu(Math.abs(v.premium), 0)} ${v.premium < 0 ? 'below' : 'above'}` : 'n/a vs'} the base estimate (${cur}, ${esc(v.primaryName || modelName(d, v.primary))}). An estimate, not an exact value.</p>`;
    }
    const bar = (name, s, cls, meaning) => `<div class="gbar"><span class="gname">${name}</span><span class="gtrack"><span class="gfill ${cls}" style="width:${fin(s.score) ? s.score : 0}%"></span></span><span class="gval">${s.score ?? '–'}</span><span class="muted gmean">${s.withheld ? 'withheld: too few inputs' : meaning(window.QDecision.band(s.score))}</span></div>`;
    return `<div class="glance">${thermo}
      ${bar('Opportunity', d.decision.opportunity, 'g-opp', b => ({ high: 'looks attractive on these measures', low: 'unattractive on these measures', moderate: 'mixed' }[b] || 'unknown'))}
      ${bar('Risk', d.decision.risk, 'g-risk', b => ({ high: 'riskier than most tracked companies', low: 'less risky than most', moderate: 'average risk' }[b] || 'unknown'))}
      ${bar('Confidence', d.decision.confidence, 'g-conf', b => ({ high: 'well-supported evidence', low: 'treat the assessment as highly uncertain', moderate: 'moderate' }[b] || 'unknown'))}
      <p class="muted">The three scores are independent: a high opportunity score does not mean high confidence.</p>
      <div class="cp-grid2"><div class="cp-ev con"><h4>Strongest reasons against</h4><ul>${e.contradicting.slice(0, 2).map(x => `<li>${esc(x)}</li>`).join('') || '<li class="muted">None identified.</li>'}</ul></div>
        <div class="cp-ev sup"><h4>Strongest reasons for</h4><ul>${e.supporting.slice(0, 2).map(x => `<li>${esc(x)}</li>`).join('') || '<li class="muted">None identified.</li>'}</ul></div></div></div>`;
  }
  function tabOverview(d) {
    const e = d.decision.evidence;
    $('cpTab').innerHTML = glance(d) + `
      <div class="cp-grid2">${list('Contradicting evidence', e.contradicting, 'con')}${list('Supporting evidence', e.supporting, 'sup')}</div>
      <div class="cp-grid2">${list('Unknown or unavailable', e.unknown, 'unk')}${list('Alternative explanations', e.alternatives)}</div>
      <div class="cp-grid2">${list('Assumptions that could be wrong', e.assumptions)}${list('Conditions that would change the conclusion', e.failureConditions)}</div>
      ${list('Variables with the largest effect (DCF)', e.swingVariables)}${list('Model limitations', e.limitations)}
      ${list('Potential catalysts (estimated dates, not announcements)', (e.catalysts || []).map(c => c.text))}
      ${scenarioScoreTable(d.decision.scenarios)}
      <details><summary>How the opportunity score is built</summary>${partsTable(d.decision.opportunity)}</details>
      <details><summary>How the risk score is built</summary>${partsTable(d.decision.risk)}</details>
      <details><summary>How the confidence score is built</summary>${partsTable(d.decision.confidence)}<p class="muted">Unmeasurable confidence components count as 0. Scores are rounded to 5 points; finer precision would be false.</p></details>
      <p class="muted">${esc(d.decision.method || '')} Validation evidence: see §5 Validation.</p>
      ${d.calibration?.valuation?.n ? `<p class="muted">Signal calibration (rank IC): ${esc(calText(d.calibration))}</p>` : ''}`;
  }
  function scenarioScoreTable(sc) {
    if (!sc?.length) return '';
    return `<div class="cp-ev"><h4>Which assumptions change the conclusion <span class="muted">(scenarios rerun every model, then the scores)</span></h4><table class="cp-t"><tr><th>Scenario</th><th>Primary value</th><th>Classification</th><th>Opportunity</th><th>Risk</th></tr>
      ${sc.map(s => `<tr><td>${esc(s.name)}</td><td>${pc(s.primaryChange, 0)}</td><td class="${s.statusChanged ? 'warn' : ''}">${esc(s.status)}${s.statusChanged ? ' (changes)' : ''}</td><td>${fin(s.scoreChange?.opportunity) ? (s.scoreChange.opportunity > 0 ? '+' : '') + s.scoreChange.opportunity : '–'}</td><td>${fin(s.scoreChange?.risk) ? (s.scoreChange.risk > 0 ? '+' : '') + s.scoreChange.risk : '–'}</td></tr>`).join('')}</table></div>`;
  }
  const calText = c => `cheapness (earnings yield) vs next-3-month return, mean rank IC ${fin(c.valuation.ic) ? c.valuation.ic.toFixed(3) : 'n/a'} (t ${fin(c.valuation.t) ? c.valuation.t.toFixed(1) : 'n/a'}, ${c.valuation.n} quarters ${c.valuation.from}…${c.valuation.to}); 12−1 momentum IC ${fin(c.momentum.ic) ? c.momentum.ic.toFixed(3) : 'n/a'}. ${c.caveats.join(' ')}`;

  // Valuation tab: every model separately, an assumption editor that recomputes in the browser, sensitivity and scenarios.
  const EDIT = [['growth', 'Revenue growth, years 1–5', 'pct'], ['opMargin', 'Operating margin', 'pct'], ['discountRate', 'Discount rate (WACC)', 'pct'], ['costEquity', 'Cost of equity', 'pct'],
    ['terminalGrowth', 'Terminal growth', 'pct'], ['capexPct', 'Capex, % of revenue', 'pct'], ['eps', 'EPS forecast (per share)', 'num'], ['debt', 'Debt (reporting currency)', 'big'], ['cash', 'Cash & investments (reporting currency)', 'big'],
    ['beta', 'β (Blume-adjusted)', 'num'], ['erp', 'Equity risk premium', 'pct'], ['rf', 'Risk-free rate', 'pct']];
  const REDERIVE = new Set(['beta', 'erp', 'rf']);   // editing these recomputes cost of equity and WACC
  function tabValuation(d) {
    const ctx = d.valuation.ctx, a = st.edit, ms = V.runAll(ctx, a), syn = V.synthesize(ms, d.price, ctx), changed = EDIT.some(([k]) => a[k] !== d.valuation.assumptions[k]);
    const scen = V.scenarios(ctx, a), dcf = ms.find(m => m.id === 'dcf');
    $('cpTab').innerHTML = `
      <div class="cp-edit">${EDIT.map(([k, l, t]) => `<label>${l}<input data-k="${k}" data-t="${t}" value="${a[k] == null ? '' : t === 'pct' ? (100 * a[k]).toFixed(2) : t === 'big' ? (a[k] / 1e9).toFixed(2) : (+a[k]).toFixed(2)}">${t === 'pct' ? '%' : t === 'big' ? 'B' : ''}</label>`).join('')}
        <button class="btn mini" id="cpReset" ${changed ? '' : 'disabled'}>Reset to data-derived defaults</button></div>
      <p class="muted">${changed ? '<b class="warn">Edited assumptions</b>: results below are your scenario, not the default estimate.' : 'Defaults are derived from filings and market data; edit any field to recompute every model.'}
        Synthesis: primary model <b>${esc(modelName(d, syn.primary))}</b>, ${fin(syn.base) ? `${num(syn.low)} … ${num(syn.base)} … ${num(syn.high)}` : 'n/a'} → ${esc((T.STATUS[syn.status] || {}).label || syn.status)}.
        Models are not averaged; the others are shown as cross-checks (${fin(syn.agreement) ? pu(syn.agreement, 0) + ' fall inside the primary range' : 'no cross-check'}).</p>
      <div class="plot" id="cpModels" style="height:${80 + 34 * ms.length}px"></div>
      <div class="cp-models">${ms.map(m => `<details ${m.id === syn.primary ? 'open' : ''}><summary><b>${esc(m.name)}</b> ${m.applicable ? `${num(m.low)} · <b>${num(m.base)}</b> · ${num(m.high)}${m.reference ? ' <span class="muted">(reference only)</span>' : ''}` : `<span class="muted">not applicable: ${esc(m.reason)}</span>`}</summary>
        ${m.applicable ? `<p><b>Assumptions</b></p><ul>${m.assumptions.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p><b>Limitations</b></p><ul>${m.limitations.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="muted">Inputs: ${Object.entries(m.inputs).map(([k, x]) => `${esc(k)} ${fin(x) ? (Math.abs(x) > 1e6 ? big(x) : Math.abs(x) < 1 ? x.toFixed(4) : num(x)) : 'n/a'}`).join(' · ')}</p>
        ${m.detail?.multiples ? `<table class="cp-t"><tr><th>Multiple</th><th>Peers</th><th>25th</th><th>Median</th><th>75th</th><th>Implied base</th></tr>${m.detail.multiples.map(x => `<tr><td>${x.multiple}</td><td>${x.peers}</td><td>${num(x.q25, 1)}</td><td>${num(x.median, 1)}</td><td>${num(x.q75, 1)}</td><td>${num(x.base)}</td></tr>`).join('')}</table>` : ''}
        ${m.detail?.percentile != null ? `<p>Current P/E ${num(m.detail.currentPE, 1)} is at the ${(100 * m.detail.percentile).toFixed(0)}th percentile of ${m.detail.years} fiscal-year-end values.</p>` : ''}` : ''}
        ${m.applicable && m.confidence ? `<p><b>Model confidence: <span class="conf-${m.confidence.level}">${m.confidence.level}</span></b> <span class="muted">(${m.confidence.reasons.map(esc).join(' ')})</span></p>` : ''}
        ${m.applicable && m.id !== 'dcf' && m.sensitivity?.length ? `<p><b>Sensitivity</b> (base ${num(m.base)})</p>${sensTable(m.sensitivity)}` : ''}
        <p class="muted">Freshness: uses ${esc(m.freshness?.uses || '')}. Latest filing ${esc(m.freshness?.filed || d.fresh?.filed || 'n/a')}${fin(m.freshness?.filingAgeDays) ? ` (${Math.round(m.freshness.filingAgeDays)} days ago)` : ''}; price ${when(d.fresh?.priceTime)}.</p></details>`).join('')}</div>
      <h4>Where the models disagree <span class="muted">(each cross-check vs the primary range ${fin(syn.low) ? `${num(syn.low)} … ${num(syn.high)}` : ''})</span></h4>
      ${syn.disagreements?.length ? `<table class="cp-t"><tr><th>Model</th><th>Base</th><th>vs primary base</th><th>Position</th><th>Ranges overlap</th></tr>${syn.disagreements.map(x => `<tr><td>${esc(x.name)}${x.reference ? ' <span class="muted">(reference)</span>' : ''}</td><td>${num(x.base)}</td><td>${pc(x.vsPrimary, 0)}</td><td class="${x.position === 'inside' ? '' : 'warn'}">${x.position}</td><td>${x.overlap ? 'yes' : '<b>no</b>'}</td></tr>`).join('')}</table>
        <p class="muted">Models are not averaged. Disagreement is information: models built on different inputs (cash flows, dividends, peers, book value, own history) pointing in different directions means the valuation is genuinely uncertain.</p>` : '<p class="muted">No cross-check model available.</p>'}
      <h4>Sensitivity of the DCF base value</h4>${dcf?.applicable ? '<div class="plot" id="cpTornado" style="height:260px"></div>' : '<p class="muted">DCF not applicable.</p>'}
      <h4>Scenarios <span class="muted">(change in each model's base value; sorted by effect on the primary model)</span></h4>
      <table class="cp-t"><tr><th>Scenario</th>${ms.map(m => `<th>${esc(m.id)}</th>`).join('')}<th>Primary</th><th>Classification</th></tr>
        ${scen.map(s => `<tr><td>${esc(s.name)}</td>${ms.map(m => `<td>${fin(s.change[m.id]) ? pc(s.change[m.id], 0) : '–'}</td>`).join('')}<td>${pc(s.primaryChange, 0)}</td><td class="${s.statusChanged ? 'warn' : ''}">${esc(s.status)}${s.statusChanged ? ' (changes)' : ''}</td></tr>`).join('')}</table>`;
    $('cpTab').querySelectorAll('input[data-k]').forEach(inp => inp.onchange = () => {
      const x = parseFloat(inp.value), t = inp.dataset.t; if (!fin(x)) return;
      const k = inp.dataset.k, val = t === 'pct' ? x / 100 : t === 'big' ? x * 1e9 : x, old = st.edit[k];
      st.edit[k] = val;
      if (REDERIVE.has(k)) st.edit = V.rederive(st.edit);
      if (k === 'growth' && fin(old)) { st.edit.growthLo += val - old; st.edit.growthHi += val - old; }
      if (k === 'terminalGrowth' && fin(old)) { st.edit.terminalLo += val - old; st.edit.terminalHi += val - old; }
      tabValuation(d);
    });
    $('cpReset').onclick = () => { st.edit = { ...d.valuation.assumptions }; tabValuation(d); };
    const ok = ms.filter(m => m.applicable), dark = css('--mode') !== 'light', fg = css('--text'), mu = css('--muted');
    const lay = (extra) => ({ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'IBM Plex Mono', size: 11, color: fg }, margin: { l: 190, r: 20, t: 10, b: 36 }, showlegend: false, ...extra });
    Plotly.react('cpModels', [
      { type: 'scatter', mode: 'lines', x: ok.flatMap(m => [m.low, m.high, null]), y: ok.flatMap(m => [m.name, m.name, null]), line: { width: 10, color: dark ? 'rgba(0,229,255,.45)' : 'rgba(31,78,140,.4)' }, hoverinfo: 'skip' },
      { type: 'scatter', mode: 'markers', x: ok.map(m => m.base), y: ok.map(m => m.name), marker: { size: 11, symbol: 'line-ns-open', line: { width: 3 }, color: fg }, hovertemplate: '%{y}: base %{x:.2f}<extra></extra>' },
    ], lay({ xaxis: { title: { text: 'value per share (estimate)' }, gridcolor: css('--grid'), zeroline: false }, yaxis: { automargin: true, categoryorder: 'array', categoryarray: ok.map(m => m.name).reverse() },
      shapes: [{ type: 'line', x0: d.price, x1: d.price, yref: 'paper', y0: 0, y1: 1, line: { color: css('--sell'), width: 2, dash: 'dot' } }],
      annotations: [{ x: d.price, yref: 'paper', y: 1, text: 'price ' + num(d.price), showarrow: false, yanchor: 'bottom', font: { color: css('--sell') } }] }), { displayModeBar: false, responsive: true });
    if (dcf?.applicable) {
      const tz = dcf.sensitivity.filter(t => fin(t.swing)).reverse();
      Plotly.react('cpTornado', [
        { type: 'bar', orientation: 'h', y: tz.map(t => t.label), x: tz.map(t => Math.min(t.down, t.up) - t.base), base: tz.map(t => t.base), marker: { color: css('--sell') }, name: 'lower', hovertemplate: '%{y}<br>value %{x:.2f}<extra></extra>' },
        { type: 'bar', orientation: 'h', y: tz.map(t => t.label), x: tz.map(t => Math.max(t.down, t.up) - t.base), base: tz.map(t => t.base), marker: { color: css('--buy') }, name: 'higher', hovertemplate: '%{y}<br>value %{x:.2f}<extra></extra>' },
      ], lay({ barmode: 'overlay', xaxis: { title: { text: 'DCF value per share' }, gridcolor: css('--grid') }, yaxis: { automargin: true },
        shapes: [{ type: 'line', x0: dcf.base, x1: dcf.base, yref: 'paper', y0: 0, y1: 1, line: { color: mu, width: 1 } }] }), { displayModeBar: false, responsive: true });
    }
  }

  function sensTable(rows) {
    return `<table class="cp-t"><tr><th>Input moved</th><th>Value if lower</th><th>Value if higher</th><th>Swing</th></tr>${rows.map(r => `<tr><td>${esc(r.label)}</td><td>${num(r.down)}</td><td>${num(r.up)}</td><td>${fin(r.base) && r.base ? pu(r.swing / Math.abs(r.base), 0) : num(r.swing)}</td></tr>`).join('')}</table>`;
  }
  function tabHistory(d) {
    $('cpTab').innerHTML = `<div class="plot" id="cpHist" style="height:420px"></div>
      <p class="muted">Price: Yahoo month-end closes (10 years) and daily closes (5 years), split-adjusted, in ${esc(d.ccy)} ${badge('historical')}. Valuation points ${badge('estimate')}: DCF, earnings-power and book models rerun <b>point-in-time</b>: only the filings public on the day each annual report was filed (later restatements excluded), priced at that month's close and that month's ${esc(d.rfInfo?.label || 'risk-free rate')}.
      β and the equity risk premium are today's values (no free point-in-time β).${d.restated?.revised ? ` ${d.restated.revised} of ${d.restated.compared} annual values were later restated.` : ''}</p>
      <div class="plot" id="cpPE" style="height:220px"></div>`;
    const fg = css('--text'), lay = (extra) => ({ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'IBM Plex Mono', size: 11, color: fg }, margin: { l: 56, r: 16, t: 10, b: 30 }, legend: { orientation: 'h', y: 1.08 }, ...extra });
    const vh = d.valuationHistory || [], tr = [
      { type: 'scatter', mode: 'lines', name: 'price (monthly)', x: d.monthly.map(b => new Date(b[0])), y: d.monthly.map(b => b[1]), line: { color: css('--accent2'), width: 1.5 } },
      { type: 'scatter', mode: 'lines', name: 'price (daily)', x: d.daily.map(b => new Date(b[0])), y: d.daily.map(b => b[1]), line: { color: css('--accent'), width: 1 } },
    ];
    for (const [id, name, col] of [['dcf', 'DCF base (range bar)', css('--violet')], ['epv', 'Earnings power value', css('--warn')], ['assets', 'Book value', css('--muted')]]) {
      const pts = vh.map(h => ({ t: h.end, m: h.models.find(m => m.id === id) })).filter(p => p.m);
      if (pts.length) tr.push({ type: 'scatter', mode: 'markers', name, x: pts.map(p => p.t), y: pts.map(p => p.m.base), marker: { color: col, size: 9, symbol: 'diamond' },
        error_y: id === 'dcf' ? { type: 'data', symmetric: false, array: pts.map(p => p.m.high - p.m.base), arrayminus: pts.map(p => p.m.base - p.m.low), color: col } : undefined });
    }
    const v = d.valuation.synthesis;
    Plotly.react('cpHist', tr, lay({ xaxis: { gridcolor: css('--grid') }, yaxis: { type: 'log', title: { text: 'per share (log)' }, gridcolor: css('--grid') },
      shapes: fin(v.low) ? [{ type: 'rect', xref: 'paper', x0: 0.97, x1: 1, y0: v.low, y1: v.high, fillcolor: 'rgba(179,136,255,.25)', line: { width: 0 } }] : [] }), { displayModeBar: false, responsive: true });
    const h = d.history.filter(x => fin(x.pe) && x.pe > 0 && x.pe < 200);
    Plotly.react('cpPE', [{ type: 'bar', x: h.map(x => x.end), y: h.map(x => x.pe), marker: { color: css('--accent2') }, name: 'P/E at fiscal-year end' }],
      lay({ yaxis: { title: { text: 'P/E' }, gridcolor: css('--grid') }, showlegend: false }), { displayModeBar: false, responsive: true });
  }

  function kv(rows) { return `<table class="cp-t">${rows.map(([k, v, n]) => `<tr><td>${esc(k)}</td><td><b>${v}</b></td><td class="muted">${esc(n || '')}</td></tr>`).join('')}</table>`; }
  function tabMarket(d) {
    const m = d.momentum, x = d.exhaustion, vo = d.volatility, l = d.liquidity, r = m.returns || {};
    $('cpTab').innerHTML = `
      <h4>Momentum ${badge('historical')}</h4>${m.available ? kv([
        ['Returns 1d / 1w / 1m / 3m / 6m / 1y', [1, 5, 21, 63, 126, 252].map(n => pc(r[n])).join(' / ')],
        ['12−1 month momentum', pc(m.mom12_1), 'standard momentum measure, skips the last month'],
        ['Price vs 50 / 200-day average', `${m.aboveSMA[50] == null ? 'n/a' : m.aboveSMA[50] ? 'above' : 'below'} / ${m.aboveSMA[200] == null ? 'n/a' : m.aboveSMA[200] ? 'above' : 'below'}`, `SMA50 ${num(m.sma[50])}, SMA200 ${num(m.sma[200])}`],
        ['50-day average slope (1 month)', pc(m.sma50Slope)],
        [`Relative strength vs ${d.marketName || 'market'} / sector (3m)`, `${pc(m.relMarket63)} / ${pc(m.relSector63)}`, 'return minus index return, and minus sector-peer median, on common dates'],
        ['Total return incl. dividends 1m / 3m / 1y', m.totalReturns ? [21, 63, 252].map(n => pc(m.totalReturns[n])).join(' / ') : 'n/a', `listing currency (${esc(d.listing?.ccy || d.ccy)}), dividends reinvested on the ex-date`],
        ['Trend persistence (3m)', `R² ${fin(m.trendR2) ? m.trendR2.toFixed(2) : 'n/a'}, ${pu(m.upDayShare, 0)} up days`, 'R² of log price vs time'],
        ['Acceleration', pc(m.accel), '3-month return now minus 1 month ago'],
        ['Volume confirmation', fin(m.upDownVolume) ? m.upDownVolume.toFixed(2) + '×' : 'n/a', 'avg volume on up days ÷ down days, 2 months'],
      ]) : `<p class="muted">${esc(m.reason)}</p>`}
      <h4>Movement exhaustion ${badge('estimate')}</h4>${x.available ? `${kv([
        ['Distance from 50-day average', fin(x.distSMA50) ? x.distSMA50.toFixed(2) + ' σ' : 'n/a'], ['1-month return percentile (own history)', fin(x.ret21Pct) ? (100 * x.ret21Pct).toFixed(0) + 'th' : 'n/a'],
        ['Volatility expansion (20d ÷ 120d)', fin(x.volExpansion) ? x.volExpansion.toFixed(2) + '×' : 'n/a'], ['RSI(14)', fin(x.rsi) ? x.rsi.toFixed(0) : 'n/a', x.divergence ? x.divergence + ' divergence' : ''],
        ['Volume anomaly', fin(x.volumeZ) ? x.volumeZ.toFixed(1) + ' σ' : 'n/a'], ['Relative-strength divergence', x.rsDivergence || 'none', `vs ${d.marketName || 'index'}: new price high/low not confirmed by the price ÷ index ratio`], ['Valuation deviation', pc(x.valuationPremium, 0)]])}
        ${list('Signals present', x.signals)}<p class="muted">${esc(x.caveat)}</p>` : `<p class="muted">${esc(x.reason)}</p>`}
      <h4>Volatility ${badge('historical')}</h4>${vo.available ? kv([
        ['Historical σ 20d / 60d / 1y / 5y', [vo.hv20, vo.hv60, vo.hv252, vo.hvAll].map(v => pu(v)).join(' / '), 'annualised close-to-close'],
        ['Realised (Parkinson high–low, 20d)', pu(vo.parkinson20)], ['EWMA (λ 0.94)', pu(vo.ewma)],
        ['Clustering (autocorr. of r², lags 1–5)', vo.clustering.map(c => fin(c) ? c.toFixed(2) : 'n/a').join(' '), 'positive = volatile days bunch together'],
        ['Max drawdown 1y / 5y, current', `${pu(vo.maxDrawdown1y)} / ${pu(vo.maxDrawdown)}, now ${pu(vo.currentDrawdown)}`],
        ['1-day VaR / ES (95 %, historical 1y)', `${pu(vo.var95, 2)} / ${pu(vo.es95, 2)}`, `worst day ${pu(vo.worstDay, 2)}; skew ${fin(vo.skew) ? vo.skew.toFixed(2) : 'n/a'}, excess kurtosis ${fin(vo.kurtosis) ? vo.kurtosis.toFixed(1) : 'n/a'}`],
        [`σ when ${d.marketName || 'the market'} is above / below its 200-day average`, vo.regimeVol ? `${pu(vo.regimeVol.marketUp)} / ${pu(vo.regimeVol.marketDown)}` : 'n/a', vo.regimeVol ? `${vo.regimeVol.nUp} / ${vo.regimeVol.nDown} days` : ''],
        ['σ in calm / turbulent markets', vo.regimeVol ? `${pu(vo.regimeVol.marketCalm)} / ${pu(vo.regimeVol.marketTurbulent)}` : 'n/a', vo.regimeVol ? `index 20-day σ below / above its median (measured to the previous day); ${vo.regimeVol.nCalm} / ${vo.regimeVol.nTurbulent} days` : ''],
        [`β vs ${vo.betaVs || 'market'} (2y daily)`, fin(vo.beta) ? `${vo.beta.toFixed(2)} ± ${fin(vo.betaSE) ? vo.betaSE.toFixed(2) : 'n/a'}` : 'n/a', fin(vo.betaN) ? `${vo.betaN} common trading days; ± is one standard error` : 'no common trading days with an index'],
      ]) : `<p class="muted">${esc(vo.reason)}</p>`}
      <h4>Liquidity</h4>${l.available ? kv([
        ['Median daily volume / traded value', `${big(l.advShares)} shares / $${big(l.addv)}`, '1 month'], ['Turnover', pu(l.turnover, 3), 'daily volume ÷ shares outstanding'],
        ['Amihud illiquidity', fin(l.amihud) ? l.amihud.toFixed(4) : 'n/a', '|return| per $1 B traded'],
        ['Bid–ask spread used for costs', fin(l.spreadUsed) ? (1e4 * l.spreadUsed).toFixed(1) + ' bp' : 'n/a', esc(l.spreadSource || '') + (fin(l.spreadEst) ? ` · daily-bar estimate ${(1e4 * l.spreadEst).toFixed(1)} bp (Abdi–Ranaldo; unreliable for liquid stocks, shown as a diagnostic only)` : '')],
        ['Market depth', 'not available', 'no free order-book data for US equities'],
      ]) + `<p>Estimated cost to trade $<input id="cpUsd" value="100000" size="10">: <b id="cpCost"></b></p>
        ${l.costCurve?.length ? `<table class="cp-t"><tr><th>Order (US$)</th><th>Share of daily value</th><th>Half-spread</th><th>Slippage (impact)</th><th>Total</th><th></th></tr>${l.costCurve.map(c => `<tr><td>$${big(c.usd)}</td><td>${pu(c.participation, 3)}</td><td>${fin(c.halfSpread) ? (1e4 * c.halfSpread).toFixed(1) + ' bp' : 'n/a'}</td><td>${c.slippageBp.toFixed(1)} bp</td><td><b>${c.bp.toFixed(1)} bp</b></td><td class="${c.feasible ? 'muted' : 'warn'}">${c.feasible ? '' : '> 10 % of daily value: would take days to fill'}</td></tr>`).join('')}</table>` : ''}
        <p class="muted"><b>Theoretical tradeability, not actual execution.</b> Half-spread (quoted if a quote feed is configured, otherwise the liquidity-tier model: 2 bp at ≥ $1 B a day up to 50 bp below $10 M; an assumption) plus square-root market impact σ·√(order ÷ daily value). Real fills depend on time of day, order type, venue, the order book (not available for equities here) and news.</p>` : `<p class="muted">${esc(l.reason)}</p>`}`;
    const cost = () => { const c = Q.tradeCost(l, +$('cpUsd').value || 0); $('cpCost').textContent = c ? `${(1e4 * c.total).toFixed(1)} bp ≈ $${num(c.total * (+$('cpUsd').value || 0), 0)} (spread ${fin(c.halfSpread) ? (1e4 * c.halfSpread).toFixed(1) : 'n/a'} bp ${c.spreadSource}, impact ${(1e4 * c.impact).toFixed(1)} bp, ${pu(c.participation, 3)} of daily value)` : 'n/a'; };
    if (l.available) { $('cpUsd').oninput = cost; cost(); }
  }

  function tabFund(d) {
    const f = d.fund, rows = d.rows.slice(-8);
    const cols = [['revenue', 'Revenue'], ['opIncome', 'Operating income'], ['netIncome', 'Net income'], ['eps', 'Diluted EPS'], ['ocf', 'Operating cash flow'], ['capex', 'Capex'], ['fcf', 'Free cash flow'],
      ['debt', 'Debt'], ['cash', 'Cash'], ['equity', 'Equity'], ['dilShares', 'Diluted shares'], ['divPaid', 'Dividends paid'], ['buyback', 'Buybacks']];
    $('cpTab').innerHTML = `<h4>Fundamental indicators ${badge('historical')} <span class="muted">last fiscal year ${esc(f.lastFY)}</span></h4>${kv([
      ['Revenue growth 1y / 3y / 5y (CAGR)', [f.revGrowth1, f.revGrowth3, f.revGrowth5].map(x => pc(x)).join(' / ')],
      ['Gross / operating / net margin', [f.grossMargin, f.opMargin, f.netMargin].map(x => pu(x)).join(' / '), `5-year average operating margin ${pu(f.opMarginAvg)}`],
      ['Free cash flow margin / conversion', `${pu(f.fcfMargin)} / ${fin(f.fcfConversion) ? f.fcfConversion.toFixed(2) + '×' : 'n/a'}`, 'FCF ÷ net income'],
      ['Earnings quality (accruals)', pu(f.accruals), '(net income − operating cash flow) ÷ average assets; high = weaker'],
      ['ROIC / ROE', `${pu(f.roic)} / ${pu(f.roe)}`], ['Debt/EBITDA · interest cover', `${fin(f.debtToEbitda) ? f.debtToEbitda.toFixed(2) : 'n/a'} · ${fin(f.interestCover) ? f.interestCover.toFixed(1) + '×' : 'n/a'}`],
      ['Current ratio · debt/equity', `${fin(f.currentRatio) ? f.currentRatio.toFixed(2) : 'n/a'} · ${fin(f.debtToEquity) ? f.debtToEquity.toFixed(2) : 'n/a'}`],
      ['Dilution (share count CAGR, 3y) · SBC/revenue', `${pc(f.dilution3)} · ${pu(f.sbcToRevenue)}`],
      ['Dividend payout of FCF / of net income', `${pu(f.payoutFCF, 0)} / ${pu(f.payoutNI, 0)}`, fin(d.dps) ? `trailing dividend ${num(d.dps)} per share` : 'no dividend'],
      ['Piotroski F-score', f.fscore ? `${f.fscore.score} / ${f.fscore.of} tests` : 'n/a'],
    ])}${list('Deterioration indicators', f.flags, 'con')}
      <h4>Reported statements (SEC ${d.region === 'International' ? '20-F / 40-F' : '10-K'}; ${esc(d.ccy || 'USD')})</h4><div class="cp-scroll"><table class="cp-t"><tr><th></th>${rows.map(r => `<th>${r.end.slice(0, 7)}</th>`).join('')}</tr>
      ${cols.map(([k, l]) => `<tr><td>${l}</td>${rows.map(r => `<td>${k === 'eps' ? num(r[k]) : big(r[k])}</td>`).join('')}</tr>`).join('')}</table></div>
      <p class="muted">Quarterly diluted EPS (10-Q): ${d.qEPS.slice(-6).map(q => `${q.end.slice(0, 7)} ${num(q.eps)}`).join(' · ') || 'n/a'}. Analyst estimates and revisions are not available from a free source.</p>`;
  }

  function tabTrade(d) { if (window.PAPER) window.PAPER.ticket(d, $('cpTab')); else $('cpTab').innerHTML = '<p class="muted">Paper trading module not loaded.</p>'; }
  function tabSources(d) {
    const src = st.data.sources;
    $('cpTab').innerHTML = `<table class="cp-t"><tr><th>Data</th><th>Source</th><th>Kind</th><th>As of</th></tr>
      <tr><td>Price</td><td>${esc(src.quotes.name)}</td><td>${badge(d.live ? 'delayed' : 'historical')}</td><td>${d.fresh?.priceTime ? new Date(d.fresh.priceTime).toLocaleString() : 'n/a'}</td></tr>
      <tr><td>Daily / monthly prices</td><td>${esc(src.prices.name)}</td><td>${badge('historical')}</td><td>fetched ${new Date(d.fresh.pricesFetched).toLocaleString()}</td></tr>
      <tr><td>Financial statements</td><td>${d.hasFilings === false ? '<span class="warn">none: no free source for this company</span>' : esc(d.region === 'International' ? src.internationalFilings.name : src.fundamentals.name)}</td><td>${badge('historical')}</td><td>${d.hasFilings === false ? 'n/a' : `latest filing ${esc(d.fresh.filed)} · fetched ${when(d.fresh.factsFetched)} · reported in ${esc(d.ccy)}`}</td></tr>
      <tr><td>Risk-free rate (${esc(d.ccy)})</td><td>${esc(d.rfInfo?.source || st.data.rf?.source || 'n/a')}: ${fin(d.rfInfo?.value) ? pu(d.rfInfo.value, 2) : 'n/a'}${d.rfInfo?.fallback ? ' <span class="warn">(fallback: no free local-currency yield)</span>' : ''}</td><td>${badge('historical')}</td><td>${esc(d.rfInfo?.date || '')}</td></tr>
      ${d.ccy !== 'USD' || d.listing?.ccy !== 'USD' ? `<tr><td>FX</td><td>${esc(st.data.sources.fx?.name || 'Yahoo FX')}: ${[...new Set([d.ccy, d.listing?.ccy])].filter(c => c && c !== 'USD').map(c => `${c}USD ${fin(st.data.fx?.[c]?.last?.c) ? st.data.fx[c].last.c.toPrecision(5) : 'n/a'}`).join(', ')}</td><td>${badge('historical')}</td><td>${[...new Set([d.ccy, d.listing?.ccy])].filter(c => c && c !== 'USD').map(c => when(st.data.fx?.[c]?.last?.t)).join(', ')}</td></tr>` : ''}
      <tr><td>Valuations, scores, regime</td><td>${esc(src.valuation.name)}</td><td>${badge('estimate')}</td><td>${new Date(st.data.recomputedAt).toLocaleString()}</td></tr></table>
      ${list('Data notes', [...(d.dataNotes || []), ...(d.fresh.stale || []).map(s => 'Served from cache because a refresh failed: ' + s)])}
      <p class="muted">XBRL tags used: ${Object.entries(d.tagsUsed).map(([k, v]) => `${esc(k)} ← ${esc(v.join(', '))}`).join('; ')}</p>`;
  }

  // ---- regime details ----
  async function openRegime() {
    const p = $('hmPanel'); p.hidden = false; document.body.classList.add('hm-open'); st.sel = null;
    const j = await (await fetch('/api/research/regime')).json(), r = j.regime;
    $('hmPanelBody').innerHTML = `<h3 class="cp-title">Market regime</h3><p>${esc(r.note)}</p>
      ${kv(r.indicators.map(i => [i.name, i.vote, i.text]))}
      <p>Trend: <b>${esc(r.trend)}</b> · votes ${Object.entries(r.tally).map(([k, v]) => `${k} ${v}`).join(', ')} · classification uncertainty <b>${esc(r.uncertainty)}</b></p>
      ${kv([['Volatility regime', esc(r.volatility.regime), `S&P 500 20-day ${pu(r.volatility.realised20)} = ${(100 * r.volatility.realisedPct).toFixed(0)}th pct of 5 y; VIX ${fin(r.volatility.vix) ? r.volatility.vix.toFixed(1) : 'n/a'} = ${fin(r.volatility.vixPct) ? (100 * r.volatility.vixPct).toFixed(0) + 'th pct' : 'n/a'}`],
        ['Liquidity stress', esc(r.liquidityStress.level), `${r.liquidityStress.signals} of 3 signals; median Amihud change vs 3 months ago ${fin(r.liquidityStress.amihudChange) ? r.liquidityStress.amihudChange.toFixed(2) + '×' : 'n/a'}`],
        ['Sector rotation', fin(r.rotation.rankCorrelation) ? r.rotation.rankCorrelation.toFixed(2) : 'n/a', 'rank correlation of sector returns, last 3 months vs the 3 before (low = leadership changed)']])}
      <table class="cp-t"><tr><th>Sector</th><th>3m return</th><th>Rank</th><th>Previous 3m</th><th>Rank change</th></tr>${r.rotation.sectors.map(s => `<tr><td>${esc(s.sector)}</td><td>${pc(s.ret63)}</td><td>${s.ret63Rank ?? ''}</td><td>${pc(s.prev63)}</td><td>${fin(s.rankChange) ? (s.rankChange > 0 ? '+' : '') + s.rankChange : ''}</td></tr>`).join('')}</table>
      ${j.calibration?.valuation ? `<h4>Signal calibration</h4><p>${esc(calText(j.calibration))}</p>` : ''}`;
  }

  // ---- comparison ----
  function toggleCompare(sym) { const i = st.compare.indexOf(sym); if (i >= 0) st.compare.splice(i, 1); else st.compare.push(sym); renderTray(); draw(); }
  function renderTray() {
    $('hmTray').hidden = !st.compare.length;
    $('hmTray').innerHTML = `Compare: ${st.compare.map(s => `<button class="chip" data-rm="${esc(s)}">${esc(s)} ×</button>`).join('')} <button class="btn mini" id="hmCmpGo" ${st.compare.length < 2 ? 'disabled' : ''}>Compare ${st.compare.length}</button> <button class="btn mini" id="hmCmpClr">clear</button>`;
    $('hmTray').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => toggleCompare(b.dataset.rm));
    $('hmCmpGo').onclick = openCompare; $('hmCmpClr').onclick = () => { st.compare = []; renderTray(); draw(); };
  }
  async function openCompare() {
    const p = $('hmPanel'); p.hidden = false; document.body.classList.add('hm-open'); st.sel = null;
    $('hmPanelBody').innerHTML = '<p class="muted">Loading…</p>';
    const ds = await Promise.all(st.compare.map(getCompany)), c = window.QDecision.compare(ds);
    const row = (l, f) => `<tr><td>${l}</td>${ds.map(d => `<td>${f(d)}</td>`).join('')}</tr>`;
    $('hmPanelBody').innerHTML = `<h3 class="cp-title">Comparison</h3>${list('Observations', c.notes)}
      <div class="cp-scroll"><table class="cp-t"><tr><th></th>${ds.map(d => `<th>${esc(d.sym)}</th>`).join('')}</tr>
      ${row('Opportunity / Risk / Confidence', d => `${d.decision.opportunity.score ?? 'n/a'} / ${d.decision.risk.score ?? 'n/a'} / ${d.decision.confidence.score ?? 'n/a'}`)}
      ${row('Valuation range (primary)', d => fin(d.valuation.synthesis.base) ? `${num(d.valuation.synthesis.low)} … ${num(d.valuation.synthesis.base)} … ${num(d.valuation.synthesis.high)}` : 'n/a')}
      ${row('Price vs base', d => pc(d.valuation.synthesis.premium, 0))}${row('Classification', d => esc((T.STATUS[d.valuation.synthesis.status] || {}).label || ''))}
      ${row('Model spread (log st. dev.)', d => fin(d.valuation.synthesis.dispersion) ? d.valuation.synthesis.dispersion.toFixed(2) : 'n/a')}
      ${row('Yield (FCF or earnings)', d => pu(d.isFinancial ? d.eps / d.price : d.fcf / d.marketCap))}
      ${row('Revenue growth 3y', d => pc(d.fund.revGrowth3))}${row('Operating margin', d => pu(d.fund.opMargin))}${row('ROIC', d => pu(d.fund.roic))}
      ${row('12−1 momentum', d => pc(d.momentum.mom12_1))}${row('Volatility 1y', d => pu(d.volatility.hv252))}${row('Max drawdown 1y', d => pu(d.volatility.maxDrawdown1y))}
      ${row('Traded value / day', d => '$' + big(d.liquidity.addv))}${row('Data completeness', d => pu(d.completeness, 0))}${row('Latest filing', d => esc(d.fresh.filed))}
      ${row('Contradicting evidence', d => d.decision.evidence.contradicting.length + ' items')}</table></div>
      ${c.correlations?.length ? `<h4>Do they diversify each other?</h4><table class="cp-t"><tr><th>Pair</th><th>Daily return correlation (≈1 year)</th><th>Days</th></tr>${c.correlations.map(x => `<tr><td>${esc(x.a)} / ${esc(x.b)}</td><td>${fin(x.corr) ? x.corr.toFixed(2) : 'n/a'}</td><td>${x.days}</td></tr>`).join('')}</table>` : ''}
      <p class="muted">The three scores are independent and are not combined. The table does not rank or select a company.</p>`;
  }

  // ---- wiring ----
  function init() {
    if (!$('hmMap')) return;
    $('hmColor').innerHTML = Object.entries(COLOR).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
    $('hmSize').innerHTML = Object.entries(SIZE).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
    if (prefs.color && COLOR[prefs.color]) $('hmColor').value = prefs.color; else $('hmColor').value = 'd1';
    $('hmSize').value = prefs.size && SIZE[prefs.size] ? prefs.size : 'cap';
    $('hmGroup').innerHTML = Object.entries(GROUP).map(([k, g]) => `<option value="${k}">${g.label}</option>`).join('');
    $('hmGroup').value = prefs.group && GROUP[prefs.group] ? prefs.group : 'sector';
    if (prefs.region) $('hmRegion').value = prefs.region;
    if (prefs.n) $('hmN').value = prefs.n; if (prefs.borders === false) $('hmBorders').checked = false; if (prefs.markers === false) $('hmMarkers').checked = false; if (prefs.flags === false) $('hmFlags').checked = false;
    for (const id of ['hmSize', 'hmColor', 'hmN', 'hmBorders', 'hmMarkers', 'hmFlags', 'hmGroup', 'hmRegion']) $(id).addEventListener('change', () => { savePrefs(); draw(); });
    // Touch: long-press adds to the comparison (there is no shift key on a phone).
    let press = null;
    $('hmMap').addEventListener('touchstart', e => { const t = e.target.closest('.hm-tile'); if (!t) return; press = setTimeout(() => { press = 'done'; toggleCompare(t.dataset.sym); }, 550); }, { passive: true });
    $('hmMap').addEventListener('touchend', e => { if (press === 'done') { e.preventDefault(); } else clearTimeout(press); press = null; });
    $('hmMap').addEventListener('mousemove', tip); $('hmMap').addEventListener('mouseleave', () => { $('hmTip').hidden = true; });
    $('hmMap').addEventListener('click', e => { const t = e.target.closest('.hm-tile'); if (!t) return; if (e.shiftKey) toggleCompare(t.dataset.sym); else { st.tab = st.tab || 'overview'; open(t.dataset.sym); } });
    $('hmClose').onclick = close; document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', () => draw());
    load(); setInterval(() => { if (!document.hidden) load(); }, 30000);
  }
  window.HEAT = { draw, open, compare: toggleCompare, tip, compareList: () => st.compare.slice() };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
