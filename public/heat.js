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

  // ---- what each mapping means (one place, so the legend and tooltips always agree) ----
  const retFrom = (s, n) => s.closes?.length > n ? s.closes[s.closes.length - 1] / s.closes[s.closes.length - 1 - n] - 1 : null;
  const COLOR = {
    d1: { label: '1-day return', get: s => s.change1d, scale: { kind: 'diverging', domain: 0.03 }, fmt: pc, kind: 'delayed', src: 'Yahoo quote vs previous close' },
    w1: { label: '1-week return', get: s => retFrom(s, 5), scale: { kind: 'diverging', domain: 0.06 }, fmt: pc, kind: 'historical', src: 'Yahoo daily closes (last bar = latest quote)' },
    m1: { label: '1-month return', get: s => retFrom(s, 21), scale: { kind: 'diverging', domain: 0.12 }, fmt: pc, kind: 'historical', src: 'Yahoo daily closes' },
    q1: { label: '3-month return', get: s => retFrom(s, 63), scale: { kind: 'diverging', domain: 0.2 }, fmt: pc, kind: 'historical', src: 'Yahoo daily closes' },
    h1: { label: '6-month return', get: s => retFrom(s, 126), scale: { kind: 'diverging', domain: 0.3 }, fmt: pc, kind: 'historical', src: 'Yahoo daily closes' },
    y1: { label: '1-year return', get: s => retFrom(s, 252), scale: { kind: 'diverging', domain: 0.5 }, fmt: pc, kind: 'historical', src: 'Yahoo daily closes' },
    custom: { label: 'Custom period return', get: s => retFrom(s, customN()), scale: { kind: 'diverging', domain: 0.15 }, fmt: pc, kind: 'historical', src: 'Yahoo daily closes' },
    sector: { label: '3-month return vs sector median', get: s => s.relSector63, scale: { kind: 'diverging', domain: 0.15 }, fmt: pc, kind: 'historical', src: 'Yahoo daily closes, sector = tracked peers' },
    prem: { label: 'Premium (+) / discount (−) to base valuation', get: s => s.valuation.premium, scale: { kind: 'diverging', domain: 0.6, invert: true }, fmt: pc, kind: 'estimate', src: 'Primary valuation model (estimate)' },
    histpct: { label: 'P/E percentile in own history', get: s => s.histPercentile, scale: { kind: 'diverging', domain: 1, invert: true, center: 0.5 }, fmt: x => fin(x) ? (100 * x).toFixed(0) + 'th pct' : 'n/a', kind: 'estimate', src: 'SEC EPS and Yahoo month-end prices' },
    opp: { label: 'Opportunity score', get: s => s.scores.opportunity, scale: { kind: 'sequential', domain: [20, 80] }, fmt: x => fin(x) ? x + '/100' : 'n/a', kind: 'estimate', src: 'Decision engine' },
    risk: { label: 'Risk score', get: s => s.scores.risk, scale: { kind: 'sequential', domain: [20, 80] }, fmt: x => fin(x) ? x + '/100' : 'n/a', kind: 'estimate', src: 'Decision engine' },
    conf: { label: 'Confidence score', get: s => s.scores.confidence, scale: { kind: 'sequential', domain: [20, 80] }, fmt: x => fin(x) ? x + '/100' : 'n/a', kind: 'estimate', src: 'Decision engine' },
    vol: { label: 'Volatility (1 year, annualised)', get: s => s.hv252, scale: { kind: 'sequential', domain: [0.15, 0.6] }, fmt: pu, kind: 'historical', src: 'Yahoo daily closes' },
    vz: { label: 'Volume anomaly (σ vs 3-month log volume)', get: s => s.volumeZ, scale: { kind: 'diverging', domain: 3 }, fmt: x => fin(x) ? x.toFixed(1) + ' σ' : 'n/a', kind: 'historical', src: 'Yahoo daily volume (today may be partial)' },
    div: { label: 'Dividend yield (trailing 12 months)', get: s => s.divYield, scale: { kind: 'sequential', domain: [0, 0.05] }, fmt: pu, kind: 'historical', src: 'Yahoo dividend events' },
    health: { label: 'Financial health (Piotroski F-score)', get: s => s.fscore ? s.fscore.score / s.fscore.of : null, scale: { kind: 'diverging', domain: 1, center: 0.5 }, fmt: (x, s) => s?.fscore ? `${s.fscore.score}/${s.fscore.of}` : 'n/a', kind: 'historical', src: 'SEC 10-K' },
    mature: { label: 'Momentum maturity (σ from 50-day average)', get: s => s.maturity.distSMA50, scale: { kind: 'diverging', domain: 3 }, fmt: x => fin(x) ? x.toFixed(1) + ' σ' : 'n/a', kind: 'historical', src: 'Yahoo daily closes' },
    eps: { label: 'Reported EPS, latest quarter vs year ago', get: s => s.epsYoY, scale: { kind: 'diverging', domain: 0.5 }, fmt: pc, kind: 'historical', src: 'SEC 10-Q (reported; analyst revisions unavailable)' },
  };
  const SIZE = {
    cap: { label: 'Market capitalisation', get: s => s.marketCap, fmt: big, src: 'SEC share count × price' },
    dvol: { label: 'Traded value (median daily $, 1 month)', get: s => s.addv, fmt: x => '$' + big(x), src: 'Yahoo daily bars' },
    turn: { label: 'Relative liquidity (daily turnover % of shares)', get: s => s.turnover, fmt: x => pu(x, 2), src: 'Yahoo volume ÷ SEC shares' },
    eq: { label: 'Equal size', get: () => 1, fmt: () => '', src: '' },
  };
  const customN = () => S.clamp(+($('hmN')?.value) || 10, 1, 252);
  function colourVal(v, sc) { return sc.center != null && fin(v) ? T.colour(v - sc.center, { ...sc, domain: sc.domain / 2 }) : T.colour(v, sc); }
  const colourFor = (s, key) => colourVal(COLOR[key].get(s), COLOR[key].scale);
  function scaleEnds(sc) { if (sc.kind !== 'diverging') return sc.domain; const c = sc.center ?? 0, h = sc.center != null ? sc.domain / 2 : sc.domain; return [c - h, c + h]; }

  // ---- state ----
  const st = { data: null, sel: null, compare: [], company: new Map(), tab: 'overview' };
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('hm-prefs') || '{}'); } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('hm-prefs', JSON.stringify({ size: $('hmSize').value, color: $('hmColor').value, n: $('hmN').value, borders: $('hmBorders').checked, markers: $('hmMarkers').checked })); } catch {} };

  async function load() {
    try {
      const r = await fetch('/api/research/universe', { cache: 'no-store' }); st.data = await r.json();
      window.setStatus?.('quotes', 'ok'); draw();
    } catch (e) { window.setStatus?.('quotes', 'error'); $('hmStatus').textContent = 'Could not load research data: ' + e.message; }
  }

  function draw() {
    const d = st.data, box = $('hmMap'); if (!d || !box || !box.clientWidth) return;
    regimeStrip(d);
    const sizeK = $('hmSize').value, colK = $('hmColor').value, sz = SIZE[sizeK];
    $('hmNL').hidden = colK !== 'custom';
    const known = d.stocks.map(s => sz.get(s)).filter(x => fin(x) && x > 0), minSize = known.length ? Math.min(...known) : 1;
    const items = d.stocks.map(s => { const v = sz.get(s); return { ...s, size: fin(v) && v > 0 ? v : minSize, sizeMissing: !(fin(v) && v > 0) }; });
    const W = box.clientWidth, H = Math.max(420, Math.min(820, Math.round(W * 0.58)));
    box.style.height = H + 'px';
    const L = T.layout(items, W, H, 16, 2);
    const html = [];
    for (const g of L.sectors) html.push(`<div class="hm-sector" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px">${g.header ? `<span>${esc(g.id)}</span>` : ''}</div>`);
    for (const t of L.tiles) {
      const c = colourFor(t, colK), status = T.STATUS[t.valuation.status] || T.STATUS.insufficient, v = COLOR[colK].get(t);
      const border = $('hmBorders').checked && status.colour ? `outline:2px ${status.border} ${status.colour};outline-offset:-3px;` : '';
      const mk = $('hmMarkers').checked && t.w > 54 && t.h > 38 ? T.marker(t.price, t.valuation) : null;
      const fs = Math.max(9, Math.min(16, Math.sqrt(t.w * t.h) / 6));
      html.push(`<button class="hm-tile${c.missing ? ' missing' : ''}${t.sizeMissing ? ' nosize' : ''}${st.compare.includes(t.sym) ? ' cmp' : ''}" data-sym="${esc(t.sym)}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;${c.fill ? `background:${c.fill};` : ''}${border}font-size:${fs}px">`
        + (t.w > 28 && t.h > 16 ? `<b>${esc(t.sym)}</b>` : '') + (t.w > 48 && t.h > 30 ? `<i>${esc(COLOR[colK].fmt(v, t))}</i>` : '')
        + (mk ? `<span class="hm-mk" title="price within valuation range"><span class="r" style="left:${100 * mk.low}%;width:${100 * (mk.high - mk.low)}%"></span>${fin(mk.base) ? `<span class="b" style="left:${100 * mk.base}%"></span>` : ''}<span class="p" style="left:${100 * mk.price}%"></span></span>` : '')
        + '</button>');
    }
    box.innerHTML = html.join('');
    legend(colK, sizeK, d);
    const err = Object.keys(d.errors || {});
    $('hmStatus').innerHTML = d.builtAt ? `${d.stocks.length} of ${d.total} companies · research built ${new Date(d.builtAt).toLocaleString()} · prices recomputed ${new Date(d.recomputedAt).toLocaleTimeString()}${err.length ? ` · <span class="warn">failed: ${esc(err.join(', '))}</span>` : ''}`
      : `Loading research data… ${d.loaded}/${d.total} companies (first load downloads ~15 MB of SEC filings, then caches them for a week).`;
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
    const c = COLOR[colK], sc = c.scale, [lo, hi] = scaleEnds(sc), stops = [];
    for (let i = 0; i <= 10; i++) stops.push(colourVal(lo + (hi - lo) * i / 10, sc).fill);
    $('hmLegend').innerHTML = `
      <div><b>Colour</b>: ${esc(c.label)} ${badge(c.kind)} <span class="muted">${esc(c.src)}</span>
        <div class="hm-grad" style="background:linear-gradient(90deg,${stops.join(',')})"></div>
        <div class="hm-gradl"><span>${esc(c.fmt(lo, null))}${sc.kind === 'diverging' ? ' or less' : ''}</span><span>${sc.invert ? 'expensive ← → cheap' : ''}</span><span>${esc(c.fmt(hi, null))}${sc.kind === 'diverging' ? ' or more' : ''}</span></div>
        <span class="hm-sw missing"></span> no data for this stock</div>
      <div><b>Size</b>: ${esc(SIZE[sizeK].label)} <span class="muted">${esc(SIZE[sizeK].src)}</span>. Tiles with <span class="hm-sw nosize"></span> a dashed corner have no value and are drawn at the smallest size.</div>
      <div><b>Border</b> = price vs estimated valuation range: ${Object.values(T.STATUS).map(s => `<span class="hm-sw" style="${s.colour ? `outline:2px ${s.border} ${s.colour};outline-offset:-3px` : ''}"></span>${esc(s.label)}`).join(' ')}</div>
      <div><b>Marker</b> (larger tiles): <span class="hm-mk demo"><span class="r" style="left:20%;width:55%"></span><span class="b" style="left:45%"></span><span class="p" style="left:85%"></span></span>
        bar = conservative…optimistic valuation, thin line = base, bright tick = current price. An estimate, never an exact fair value.</div>
      <div class="muted">Data kinds: ${badge('delayed')} quotes (Yahoo, may lag ~15 min) · ${badge('historical')} filings and daily bars · ${badge('estimate')} computed valuations and scores. Nothing on this map is simulated.</div>`;
  }
  // ---- tooltip ----
  function tip(e) {
    const t = e.target.closest('.hm-tile'), el = $('hmTip');
    if (!t) { el.hidden = true; return; }
    const s = st.data.stocks.find(x => x.sym === t.dataset.sym); if (!s) return;
    const v = s.valuation, colK = $('hmColor').value, c = COLOR[colK], status = T.STATUS[v.status] || T.STATUS.insufficient;
    el.innerHTML = `<b>${esc(s.sym)}</b> ${esc(s.name)} <span class="muted">${esc(s.sector)}</span><br>
      Price ${num(s.price)} ${badge(s.fresh?.priceKind?.startsWith('delayed') ? 'delayed' : 'historical')} <span class="muted">${s.fresh?.priceTime ? new Date(s.fresh.priceTime).toLocaleString() : ''}</span><br>
      ${esc(c.label)}: <b>${esc(c.fmt(c.get(s), s))}</b> ${badge(c.kind)}<br>
      Valuation ${badge('estimate')}: ${fin(v.base) ? `${num(v.low)} … <b>${num(v.base)}</b> … ${num(v.high)} (${esc(v.primary)}) · ${pc(v.premium, 0)}` : 'n/a'}<br>
      <span style="color:${status.colour || 'inherit'}">${esc(status.label)}</span><br>
      Opportunity ${s.scores.opportunity ?? 'n/a'} · Risk ${s.scores.risk ?? 'n/a'} · Confidence ${s.scores.confidence ?? 'n/a'} <span class="muted">(independent)</span><br>
      <span class="muted">Data completeness ${pu(s.completeness, 0)}${s.dataNotes?.length ? ' · ' + esc(s.dataNotes[0]) : ''} · click for research, shift-click to compare</span>`;
    const r = $('hmWrap').getBoundingClientRect(), x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    el.hidden = false; el.style.left = Math.min(x, r.width - el.offsetWidth - 4) + 'px'; el.style.top = Math.min(y, r.height - el.offsetHeight + 60) + 'px';
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

  const TABS = [['overview', 'Assessment'], ['valuation', 'Valuation'], ['history', 'Price & value history'], ['market', 'Market behaviour'], ['fund', 'Fundamentals'], ['sources', 'Sources']];
  function renderPanel(d) {
    const v = d.valuation.synthesis, status = T.STATUS[v.status] || T.STATUS.insufficient;
    $('hmPanelBody').innerHTML = `
      <div class="cp-head"><div><h3 class="cp-title">${esc(d.sym)} <span class="muted">${esc(d.name)}</span></h3>
        <div class="muted">${esc(d.sector)} · price ${num(d.price)} ${badge(d.fresh?.priceKind?.startsWith('delayed') ? 'delayed' : 'historical')} · market cap ${big(d.marketCap)}</div></div>
        <div><button class="btn mini" id="cpCmp">${st.compare.includes(d.sym) ? '− Remove from compare' : '+ Compare'}</button></div></div>
      <div class="cp-scores">${scoreCard('Opportunity', d.decision.opportunity)}${scoreCard('Risk', d.decision.risk)}${scoreCard('Confidence', d.decision.confidence)}</div>
      <p class="cp-interp">${esc(d.decision.interpretation)}</p>
      <p class="cp-val">Valuation ${badge('estimate')}: ${fin(v.base) ? `conservative <b>${num(v.low)}</b> · base <b>${num(v.base)}</b> · optimistic <b>${num(v.high)}</b> (${esc(modelName(d, v.primary))}) · price ${pc(v.premium, 0)} vs base` : 'no applicable model'}
        · <span style="color:${status.colour || 'inherit'}">${esc(status.label)}</span>${v.notes?.length ? `<br><span class="muted">${v.notes.map(esc).join(' ')}</span>` : ''}</p>
      <nav class="cp-tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
      <div id="cpTab"></div>`;
    $('cpCmp').onclick = () => { toggleCompare(d.sym); renderPanel(d); };
    $('hmPanelBody').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; renderPanel(d); });
    ({ overview: tabOverview, valuation: tabValuation, history: tabHistory, market: tabMarket, fund: tabFund, sources: tabSources })[st.tab](d);
  }
  const modelName = (d, id) => d.valuation.models.find(m => m.id === id)?.name || id || 'none';
  function scoreCard(name, s) {
    const b = window.QDecision.band(s.score);
    return `<div class="cp-score"><div class="muted">${name}</div><div class="cp-num">${s.score ?? 'n/a'}<small>/100</small></div><div class="muted">${b} · ${s.known}/${s.total} parts measured</div></div>`;
  }
  const list = (title, arr, cls = '') => `<div class="cp-ev ${cls}"><h4>${title} <span class="muted">(${arr.length})</span></h4>${arr.length ? '<ul>' + arr.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : '<p class="muted">None identified.</p>'}</div>`;
  function partsTable(s) {
    return `<table class="cp-t"><tr><th>Component</th><th>Score</th><th>Weight</th><th>Explanation</th></tr>${s.parts.map(p => `<tr class="${p.missing || !fin(p.score) ? 'muted' : ''}"><td>${esc(p.name)}</td><td>${fin(p.score) && !p.missing ? Math.round(p.score) : 'n/a'}</td><td>${p.weight}</td><td>${esc(p.explain)}</td></tr>`).join('')}</table>`;
  }
  function tabOverview(d) {
    const e = d.decision.evidence;
    $('cpTab').innerHTML = `
      <div class="cp-grid2">${list('Contradicting evidence', e.contradicting, 'con')}${list('Supporting evidence', e.supporting, 'sup')}</div>
      <div class="cp-grid2">${list('Unknown or unavailable', e.unknown, 'unk')}${list('Alternative explanations', e.alternatives)}</div>
      <div class="cp-grid2">${list('Assumptions that could be wrong', e.assumptions)}${list('Conditions that would change the conclusion', e.failureConditions)}</div>
      ${list('Variables with the largest effect (DCF)', e.swingVariables)}${list('Model limitations', e.limitations)}
      <details><summary>How the opportunity score is built</summary>${partsTable(d.decision.opportunity)}</details>
      <details><summary>How the risk score is built</summary>${partsTable(d.decision.risk)}</details>
      <details><summary>How the confidence score is built</summary>${partsTable(d.decision.confidence)}<p class="muted">Unmeasurable confidence components count as 0. Scores are rounded to 5 points; finer precision would be false.</p></details>
      ${d.calibration?.valuation?.n ? `<p class="muted">Calibration: ${esc(calText(d.calibration))}</p>` : ''}`;
  }
  const calText = c => `cheapness (earnings yield) vs next-3-month return, mean rank IC ${fin(c.valuation.ic) ? c.valuation.ic.toFixed(3) : 'n/a'} (t ${fin(c.valuation.t) ? c.valuation.t.toFixed(1) : 'n/a'}, ${c.valuation.n} quarters ${c.valuation.from}…${c.valuation.to}); 12−1 momentum IC ${fin(c.momentum.ic) ? c.momentum.ic.toFixed(3) : 'n/a'}. ${c.caveats.join(' ')}`;

  // Valuation tab: every model separately, an assumption editor that recomputes in the browser, sensitivity and scenarios.
  const EDIT = [['growth', 'Revenue growth, years 1–5', 'pct'], ['opMargin', 'Operating margin', 'pct'], ['discountRate', 'Discount rate (WACC)', 'pct'], ['costEquity', 'Cost of equity', 'pct'],
    ['terminalGrowth', 'Terminal growth', 'pct'], ['capexPct', 'Capex, % of revenue', 'pct'], ['eps', 'EPS forecast (per share)', 'num'], ['debt', 'Debt ($)', 'big'], ['cash', 'Cash & investments ($)', 'big']];
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
        <p class="muted">Data as of last filing ${esc(d.fresh?.filed || 'n/a')}; prices ${d.fresh?.priceTime ? new Date(d.fresh.priceTime).toLocaleString() : 'n/a'}.</p></details>`).join('')}</div>
      <h4>Sensitivity of the DCF base value</h4>${dcf?.applicable ? '<div class="plot" id="cpTornado" style="height:260px"></div>' : '<p class="muted">DCF not applicable.</p>'}
      <h4>Scenarios <span class="muted">(change in each model's base value; sorted by effect on the primary model)</span></h4>
      <table class="cp-t"><tr><th>Scenario</th>${ms.map(m => `<th>${esc(m.id)}</th>`).join('')}<th>Primary</th><th>Classification</th></tr>
        ${scen.map(s => `<tr><td>${esc(s.name)}</td>${ms.map(m => `<td>${fin(s.change[m.id]) ? pc(s.change[m.id], 0) : '–'}</td>`).join('')}<td>${pc(s.primaryChange, 0)}</td><td class="${s.statusChanged ? 'warn' : ''}">${esc(s.status)}${s.statusChanged ? ' (changes)' : ''}</td></tr>`).join('')}</table>`;
    $('cpTab').querySelectorAll('input[data-k]').forEach(inp => inp.onchange = () => {
      const x = parseFloat(inp.value), t = inp.dataset.t; if (!fin(x)) return;
      const k = inp.dataset.k, val = t === 'pct' ? x / 100 : t === 'big' ? x * 1e9 : x, old = st.edit[k];
      st.edit[k] = val;
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

  function tabHistory(d) {
    $('cpTab').innerHTML = `<div class="plot" id="cpHist" style="height:420px"></div>
      <p class="muted">Price: Yahoo month-end closes (10 years) and daily closes (5 years), split-adjusted ${badge('historical')}. Valuation points ${badge('estimate')}: DCF and earnings-power models rerun with only the filings available at each fiscal-year end and that month's 10-year yield.
      They use today's beta and the latest restated filings, so they are not strictly point-in-time.</p>
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
        ['Relative strength vs S&P 500 / sector (3m)', `${pc(m.relMarket63)} / ${pc(m.relSector63)}`],
        ['Trend persistence (3m)', `R² ${fin(m.trendR2) ? m.trendR2.toFixed(2) : 'n/a'}, ${pu(m.upDayShare, 0)} up days`, 'R² of log price vs time'],
        ['Acceleration', pc(m.accel), '3-month return now minus 1 month ago'],
        ['Volume confirmation', fin(m.upDownVolume) ? m.upDownVolume.toFixed(2) + '×' : 'n/a', 'avg volume on up days ÷ down days, 2 months'],
      ]) : `<p class="muted">${esc(m.reason)}</p>`}
      <h4>Movement exhaustion ${badge('estimate')}</h4>${x.available ? `${kv([
        ['Distance from 50-day average', fin(x.distSMA50) ? x.distSMA50.toFixed(2) + ' σ' : 'n/a'], ['1-month return percentile (own history)', fin(x.ret21Pct) ? (100 * x.ret21Pct).toFixed(0) + 'th' : 'n/a'],
        ['Volatility expansion (20d ÷ 120d)', fin(x.volExpansion) ? x.volExpansion.toFixed(2) + '×' : 'n/a'], ['RSI(14)', fin(x.rsi) ? x.rsi.toFixed(0) : 'n/a', x.divergence ? x.divergence + ' divergence' : ''],
        ['Volume anomaly', fin(x.volumeZ) ? x.volumeZ.toFixed(1) + ' σ' : 'n/a'], ['Valuation deviation', pc(x.valuationPremium, 0)]])}
        ${list('Signals present', x.signals)}<p class="muted">${esc(x.caveat)}</p>` : `<p class="muted">${esc(x.reason)}</p>`}
      <h4>Volatility ${badge('historical')}</h4>${vo.available ? kv([
        ['Historical σ 20d / 60d / 1y / 5y', [vo.hv20, vo.hv60, vo.hv252, vo.hvAll].map(v => pu(v)).join(' / '), 'annualised close-to-close'],
        ['Realised (Parkinson high–low, 20d)', pu(vo.parkinson20)], ['EWMA (λ 0.94)', pu(vo.ewma)],
        ['Clustering (autocorr. of r², lags 1–5)', vo.clustering.map(c => fin(c) ? c.toFixed(2) : 'n/a').join(' '), 'positive = volatile days bunch together'],
        ['Max drawdown 1y / 5y, current', `${pu(vo.maxDrawdown1y)} / ${pu(vo.maxDrawdown)}, now ${pu(vo.currentDrawdown)}`],
        ['1-day VaR / ES (95 %, historical 1y)', `${pu(vo.var95, 2)} / ${pu(vo.es95, 2)}`, `worst day ${pu(vo.worstDay, 2)}; skew ${fin(vo.skew) ? vo.skew.toFixed(2) : 'n/a'}, excess kurtosis ${fin(vo.kurtosis) ? vo.kurtosis.toFixed(1) : 'n/a'}`],
        ['σ when the market is above / below its 200-day average', vo.regimeVol ? `${pu(vo.regimeVol.marketUp)} / ${pu(vo.regimeVol.marketDown)}` : 'n/a', vo.regimeVol ? `${vo.regimeVol.nUp} / ${vo.regimeVol.nDown} days` : ''],
        ['β vs S&P 500 (SPY, 2y daily)', fin(vo.beta) ? vo.beta.toFixed(2) : 'n/a'],
      ]) : `<p class="muted">${esc(vo.reason)}</p>`}
      <h4>Liquidity</h4>${l.available ? kv([
        ['Median daily volume / traded value', `${big(l.advShares)} shares / $${big(l.addv)}`, '1 month'], ['Turnover', pu(l.turnover, 3), 'daily volume ÷ shares outstanding'],
        ['Amihud illiquidity', fin(l.amihud) ? l.amihud.toFixed(4) : 'n/a', '|return| per $1 B traded'],
        ['Bid–ask spread', fin(l.quotedSpread) ? pu(l.quotedSpread, 3) + ' quoted' : fin(l.spreadEst) ? pu(l.spreadEst, 3) + ' (estimate)' : 'n/a', 'estimated from daily high/low/close (Abdi–Ranaldo); no quoted spread in the free feed'],
        ['Market depth', 'not available', 'no free order-book data for US equities'],
      ]) + `<p>Estimated cost to trade $<input id="cpUsd" value="100000" size="10">: <b id="cpCost"></b></p><p class="muted">Theoretical: half-spread plus square-root market impact σ·√(order ÷ daily value). Actual execution depends on time of day, order type and venue.</p>` : `<p class="muted">${esc(l.reason)}</p>`}`;
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
      <h4>Reported statements (SEC 10-K)</h4><div class="cp-scroll"><table class="cp-t"><tr><th></th>${rows.map(r => `<th>${r.end.slice(0, 7)}</th>`).join('')}</tr>
      ${cols.map(([k, l]) => `<tr><td>${l}</td>${rows.map(r => `<td>${k === 'eps' ? num(r[k]) : big(r[k])}</td>`).join('')}</tr>`).join('')}</table></div>
      <p class="muted">Quarterly diluted EPS (10-Q): ${d.qEPS.slice(-6).map(q => `${q.end.slice(0, 7)} ${num(q.eps)}`).join(' · ') || 'n/a'}. Analyst estimates and revisions are not available from a free source.</p>`;
  }

  function tabSources(d) {
    const src = st.data.sources;
    $('cpTab').innerHTML = `<table class="cp-t"><tr><th>Data</th><th>Source</th><th>Kind</th><th>As of</th></tr>
      <tr><td>Price</td><td>${esc(src.quotes.name)}</td><td>${badge(d.live ? 'delayed' : 'historical')}</td><td>${d.fresh?.priceTime ? new Date(d.fresh.priceTime).toLocaleString() : 'n/a'}</td></tr>
      <tr><td>Daily / monthly prices</td><td>${esc(src.prices.name)}</td><td>${badge('historical')}</td><td>fetched ${new Date(d.fresh.pricesFetched).toLocaleString()}</td></tr>
      <tr><td>Financial statements</td><td>${esc(src.fundamentals.name)}</td><td>${badge('historical')}</td><td>latest filing ${esc(d.fresh.filed)} · fetched ${new Date(d.fresh.factsFetched).toLocaleString()}</td></tr>
      <tr><td>Risk-free rate</td><td>${esc(st.data.rf?.source || 'n/a')}</td><td>${badge('historical')}</td><td>${esc(st.data.rf?.date || '')}</td></tr>
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
      <p class="muted">The three scores are independent and are not combined. The table does not rank or select a company.</p>`;
  }

  // ---- wiring ----
  function init() {
    if (!$('hmMap')) return;
    $('hmColor').innerHTML = Object.entries(COLOR).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
    $('hmSize').innerHTML = Object.entries(SIZE).map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
    if (prefs.color && COLOR[prefs.color]) $('hmColor').value = prefs.color; else $('hmColor').value = 'd1';
    $('hmSize').value = prefs.size && SIZE[prefs.size] ? prefs.size : 'cap';
    if (prefs.n) $('hmN').value = prefs.n; if (prefs.borders === false) $('hmBorders').checked = false; if (prefs.markers === false) $('hmMarkers').checked = false;
    for (const id of ['hmSize', 'hmColor', 'hmN', 'hmBorders', 'hmMarkers']) $(id).addEventListener('change', () => { savePrefs(); draw(); });
    $('hmMap').addEventListener('mousemove', tip); $('hmMap').addEventListener('mouseleave', () => { $('hmTip').hidden = true; });
    $('hmMap').addEventListener('click', e => { const t = e.target.closest('.hm-tile'); if (!t) return; if (e.shiftKey) toggleCompare(t.dataset.sym); else { st.tab = st.tab || 'overview'; open(t.dataset.sym); } });
    $('hmClose').onclick = close; document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', () => draw());
    load(); setInterval(() => { if (!document.hidden) load(); }, 30000);
  }
  window.HEAT = { draw, open, compare: toggleCompare };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
