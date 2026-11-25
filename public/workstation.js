// Research workstation sections (Part 08): valuation explorer, company research directory, quantitative screen,
// risk laboratory, data-quality monitor, model-performance monitor, and the layout manager (show / hide / reorder
// sections, persisted per browser). Every table sorts by any column; every number carries its source or kind.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fin = x => typeof x === 'number' && Number.isFinite(x);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pc = (x, d = 1) => fin(x) ? (x >= 0 ? '+' : '') + (100 * x).toFixed(d) + ' %' : 'n/a';
  const pu = (x, d = 1) => fin(x) ? (100 * x).toFixed(d) + ' %' : 'n/a';
  const nf = (x, d = 2) => fin(x) ? x.toFixed(d) : 'n/a';
  const big = x => !fin(x) ? 'n/a' : Math.abs(x) >= 1e12 ? (x / 1e12).toFixed(2) + ' T' : Math.abs(x) >= 1e9 ? (x / 1e9).toFixed(1) + ' B' : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(0) + ' M' : x.toFixed(0);
  const when = t => fin(t) ? new Date(t).toLocaleString() : 'n/a';
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const lay = extra => ({ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'IBM Plex Mono', size: 11, color: css('--text') }, margin: { l: 60, r: 14, t: 8, b: 36 }, ...extra });
  const cfg = { displayModeBar: false, responsive: true };
  const STATUS_COL = { below: '--accent', within: '--muted', above: '--sell', uncertain: '--warn', insufficient: '--grid' };
  const st = { u: null, uAt: 0, sort: {}, filter: { region: 'all', sector: 'all', status: 'all', q: '' } };
  const getU = async () => { if (!st.u || Date.now() - st.uAt > 30000) { st.u = await (await fetch('/api/research/universe')).json(); st.uAt = Date.now(); } return st.u; };
  const openCo = sym => window.HEAT?.open(sym);

  // ---------- sortable table helper ----------
  // cols: [{ k, label, get(s), fmt(v, s), cls?(v, s), title? }]
  function table(id, rows, cols, opts = {}) {
    const sk = st.sort[id] || { k: opts.sortKey || cols[0].k, dir: opts.sortDir || -1 }, col = cols.find(c => c.k === sk.k) || cols[0];
    const sorted = rows.slice().sort((a, b) => { const x = col.get(a), y = col.get(b); if (!fin(x) && !fin(y)) return String(col.fmt ? col.fmt(x, a) : x).localeCompare(String(col.fmt ? col.fmt(y, b) : y)) * sk.dir; if (!fin(x)) return 1; if (!fin(y)) return -1; return (x - y) * sk.dir; });
    const html = `<div class="cp-scroll"><table class="cp-t ws-t" id="${id}"><tr>${cols.map(c => `<th data-sk="${c.k}" title="${esc(c.title || 'Sort')}" class="${c.k === sk.k ? 'sorted' : ''}">${esc(c.label)}${c.k === sk.k ? (sk.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr>
      ${sorted.slice(0, opts.limit || 500).map(s => `<tr data-sym="${esc(s.sym || '')}">${cols.map(c => { const v = c.get(s); return `<td class="${c.cls ? c.cls(v, s) : ''}">${c.fmt ? c.fmt(v, s) : esc(v)}</td>`; }).join('')}</tr>`).join('')}</table></div>`;
    return { html, wire: (rerender) => {
      const t = $(id); if (!t) return;
      t.querySelectorAll('th[data-sk]').forEach(th => th.onclick = () => { const k = th.dataset.sk; st.sort[id] = { k, dir: st.sort[id]?.k === k ? -st.sort[id].dir : -1 }; rerender(); });
      if (opts.clickOpens) t.querySelectorAll('tr[data-sym]').forEach(tr => tr.onclick = () => openCo(tr.dataset.sym));
    } };
  }
  // Colour a cell by its z-score within the column (diverging); used to make unusual values stand out.
  const zcls = (arr) => { const m = mean(arr), sd = std(arr); return v => !fin(v) || !sd ? '' : (v - m) / sd > 1.5 ? 'z-hi' : (v - m) / sd < -1.5 ? 'z-lo' : ''; };
  const mean = a => { a = a.filter(fin); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
  const std = a => { a = a.filter(fin); if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  function filters(id, u, onChange, withStatus = true) {
    const sectors = [...new Set(u.stocks.map(s => s.sector))].sort(), f = st.filter;
    $(id).innerHTML = `<label>Search <input id="${id}Q" value="${esc(f.q)}" placeholder="name or symbol" size="16"></label>
      <label>Region <select id="${id}R"><option value="all">All</option><option value="US" ${f.region === 'US' ? 'selected' : ''}>US</option><option value="International" ${f.region === 'International' ? 'selected' : ''}>International</option></select></label>
      <label>Sector <select id="${id}S"><option value="all">All</option>${sectors.map(s => `<option ${f.sector === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      ${withStatus ? `<label>Valuation <select id="${id}V"><option value="all">All</option>${['below', 'within', 'above', 'uncertain', 'insufficient'].map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` : ''}`;
    const upd = () => { f.q = $(id + 'Q').value.trim().toLowerCase(); f.region = $(id + 'R').value; f.sector = $(id + 'S').value; if (withStatus) f.status = $(id + 'V').value; onChange(); };
    for (const k of ['Q', 'R', 'S', 'V']) if ($(id + k)) $(id + k)[k === 'Q' ? 'oninput' : 'onchange'] = upd;
  }
  const applyF = (stocks, withStatus = true) => stocks.filter(s => { const f = st.filter; return (f.region === 'all' || s.region === f.region) && (f.sector === 'all' || s.sector === f.sector)
    && (!withStatus || f.status === 'all' || s.valuation?.status === f.status) && (!f.q || s.sym.toLowerCase().includes(f.q) || (s.label || '').toLowerCase().includes(f.q) || (s.name || '').toLowerCase().includes(f.q)); });

  // ---------- 2. Valuation explorer ----------
  async function valuation() {
    const u = await getU(); filters('veF', u, valuation);
    const rows = applyF(u.stocks).filter(s => fin(s.valuation?.base) && fin(s.price)), n = rows.length;
    const byPrem = rows.slice().sort((a, b) => a.valuation.premium - b.valuation.premium), show = byPrem.length > 60 ? [...byPrem.slice(0, 30), ...byPrem.slice(-30)] : byPrem;
    // Value range relative to today's price: x = value ÷ price − 1. Left of 0 = the estimate is below the price (expensive).
    $('veChartWrap').style.height = Math.max(260, 18 * show.length + 60) + 'px';
    const y = show.map(s => `${s.label} (${s.sym})`);
    Plotly.react('veChart', [
      { type: 'scatter', mode: 'lines', x: show.flatMap(s => [s.valuation.low / s.price - 1, s.valuation.high / s.price - 1, null]), y: show.flatMap((s, i) => [y[i], y[i], null]), line: { width: 8, color: css('--accent2') }, opacity: 0.45, hoverinfo: 'skip', name: 'estimated range' },
      { type: 'scatter', mode: 'markers', x: show.map(s => s.valuation.base / s.price - 1), y, marker: { size: 9, color: show.map(s => css(STATUS_COL[s.valuation.status] || '--muted')), line: { width: 1, color: css('--text') } },
        customdata: show.map(s => [s.sym, s.valuation.status, s.scores.confidence]), hovertemplate: '%{y}<br>base value %{x:+.0%} vs price · %{customdata[1]} · confidence %{customdata[2]}<extra></extra>', name: 'base estimate' },
    ], lay({ showlegend: false, margin: { l: 210, r: 20, t: 10, b: 40 }, xaxis: { title: { text: 'estimated value relative to price (0 = price)' }, tickformat: '+.0%', zeroline: true, zerolinewidth: 2, zerolinecolor: css('--text'), gridcolor: css('--grid'), range: [-1, 1.5] }, yaxis: { automargin: true, autorange: 'reversed' } }), cfg);
    $('veChart').on?.('plotly_click', e => openCo(e.points[0].customdata?.[0]));
    $('veNote').innerHTML = `${n} companies with a valuation (${byPrem.length > 60 ? 'the 30 cheapest and 30 dearest relative to their estimates are drawn' : 'all drawn'}). Bar = conservative…optimistic estimate, dot = base estimate, coloured by classification. <b>Right of the 0 line = the estimate is above today's price.</b> Estimates, not exact fair values; being below an estimate does not imply the price will rise.`;
    const t = table('veT', rows, [
      { k: 'label', label: 'Company', get: s => s.label, fmt: (v, s) => `${esc(v)} <span class="muted">${esc(s.sym)}</span>` }, { k: 'sector', label: 'Sector', get: s => s.sector, fmt: v => esc(v) },
      { k: 'prem', label: 'Price vs base', get: s => s.valuation.premium, fmt: v => pc(v, 0), cls: v => v < -0.2 ? 'pos' : v > 0.2 ? 'neg' : '' },
      { k: 'status', label: 'Classification', get: s => ['below', 'within', 'above', 'uncertain', 'insufficient'].indexOf(s.valuation.status), fmt: (v, s) => `<span class="st st-${esc(s.valuation.status)}">${esc(s.valuation.status)}</span>` },
      { k: 'model', label: 'Primary model', get: s => s.valuation.primaryName || '', fmt: v => esc(v) }, { k: 'width', label: 'Range width', get: s => s.valuation.widthRatio, fmt: v => fin(v) ? '×' + v.toFixed(2) : 'n/a' },
      { k: 'agree', label: 'Models agreeing', get: s => s.valuation.agreement, fmt: v => pu(v, 0) }, { k: 'hist', label: 'P/E percentile (own history)', get: s => s.histPercentile, fmt: v => fin(v) ? (100 * v).toFixed(0) + 'th' : 'n/a' },
      { k: 'conf', label: 'Confidence', get: s => s.scores.confidence, fmt: v => v ?? 'n/a' }, { k: 'opp', label: 'Opportunity', get: s => s.scores.opportunity, fmt: v => v ?? 'n/a' }, { k: 'risk', label: 'Risk', get: s => s.scores.risk, fmt: v => v ?? 'n/a' },
    ], { sortKey: 'prem', sortDir: 1, clickOpens: true });
    $('veTable').innerHTML = t.html; t.wire(valuation);
  }

  // ---------- 3. Company research directory ----------
  async function companies() {
    const u = await getU(); filters('coF', u, companies);
    const t = table('coT', applyF(u.stocks), [
      { k: 'label', label: 'Company', get: s => s.label, fmt: (v, s) => `<b>${esc(v)}</b> <span class="muted">${esc(s.sym)}</span>` }, { k: 'sector', label: 'Sector', get: s => s.sector, fmt: v => esc(v) },
      { k: 'country', label: 'Country', get: s => s.country, fmt: v => esc(v) }, { k: 'cap', label: 'Market cap (US$)', get: s => s.marketCapUSD, fmt: v => '$' + big(v) },
      { k: 'd1', label: '1 day', get: s => s.change1d, fmt: v => pc(v), cls: v => v > 0 ? 'pos' : v < 0 ? 'neg' : '' }, { k: 'm3', label: '3 months', get: s => s.ret?.[63], fmt: v => pc(v), cls: v => v > 0 ? 'pos' : v < 0 ? 'neg' : '' },
      { k: 'status', label: 'Valuation', get: s => ['below', 'within', 'above', 'uncertain', 'insufficient'].indexOf(s.valuation.status), fmt: (v, s) => `<span class="st st-${esc(s.valuation.status)}">${esc(s.valuation.status)}</span>` },
      { k: 'opp', label: 'Opp.', get: s => s.scores.opportunity, fmt: v => v ?? '–' }, { k: 'risk', label: 'Risk', get: s => s.scores.risk, fmt: v => v ?? '–' }, { k: 'conf', label: 'Conf.', get: s => s.scores.confidence, fmt: v => v ?? '–' },
      { k: 'data', label: 'Data complete', get: s => s.completeness, fmt: v => pu(v, 0), cls: v => v < 0.6 ? 'warn' : '' },
      { k: 'price', label: 'Price (time)', get: s => s.fresh?.priceTime, fmt: (v, s) => `${nf(s.price)} ${esc(s.ccy)} <span class="muted">${s.fresh?.priceKind?.startsWith('delayed') ? 'delayed' : 'close'} ${when(v)}</span>` },
    ], { sortKey: 'cap', clickOpens: true });
    $('coTable').innerHTML = t.html; t.wire(companies);
    $('coTable').querySelectorAll('tr[data-sym]').forEach(tr => tr.addEventListener('mouseenter', () => filingsFor(tr.dataset.sym), { once: true }));
  }
  async function filingsFor(sym) {
    try { const j = await (await fetch('/api/research/filings?sym=' + encodeURIComponent(sym))).json();
      $('coFilings').innerHTML = `<h4>Recent announcements: ${esc(sym)} <span class="muted">${esc(j.sicDescription || '')}${j.sic ? ' (SIC ' + esc(j.sic) + ')' : ''}</span></h4>${j.filings?.length ? `<ul>${j.filings.slice(0, 12).map(f => `<li>${esc(f.date)} <b>${esc(f.form)}</b> ${esc(f.description || f.items || '')} ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">filing ↗</a>` : ''}</li>`).join('')}</ul>` : ''}<p class="muted">${esc(j.note || '')} Source: ${esc(j.source || 'n/a')}.</p>`;
    } catch (e) { $('coFilings').innerHTML = `<p class="muted">Announcements unavailable: ${esc(e.message)}</p>`; }
  }

  // ---------- 4. Quantitative screen ----------
  async function quant() {
    const u = await getU(); filters('qsF', u, quant, false);
    const rows = applyF(u.stocks, false), col = k => rows.map(s => k(s)).filter(fin);
    const C = [['mom', '12−1 momentum', s => s.quant?.mom12_1, v => pc(v)], ['rs', 'vs own index (3m)', s => s.quant?.relMarket63, v => pc(v)], ['sec', 'vs sector (3m)', s => s.relSector63, v => pc(v)],
      ['r2', 'Trend R² (3m)', s => s.maturity?.trendR2, v => nf(v)], ['dist', 'σ from 50-day avg', s => s.maturity?.distSMA50, v => nf(v, 1)], ['rsi', 'RSI(14)', s => s.quant?.rsi, v => nf(v, 0)],
      ['exh', 'Exhaustion signals', s => s.maturity?.exhaustion, v => v ?? '–'], ['vol', 'Volatility 1y', s => s.hv252, v => pu(v)], ['vx', 'Vol expansion', s => s.quant?.volExpansion, v => fin(v) ? '×' + v.toFixed(2) : 'n/a'],
      ['vz', 'Volume z', s => s.volumeZ, v => nf(v, 1)], ['beta', 'β (own index)', s => s.quant?.beta, v => nf(v)], ['dd', 'Max drawdown 1y', s => s.quant?.maxDD1y, v => pu(v)], ['liq', 'Traded $/day', s => s.addv, v => '$' + big(v)]];
    const t = table('qsT', rows, [{ k: 'label', label: 'Company', get: s => s.label, fmt: (v, s) => `${esc(v)} <span class="muted">${esc(s.sym)}</span>` },
      ...C.map(([k, label, get, fmt]) => ({ k, label, get, fmt, cls: zcls(col(get)) })), { k: 'div', label: 'RS divergence', get: s => s.quant?.rsDivergence ? 1 : 0, fmt: (v, s) => esc(s.quant?.rsDivergence || '') }],
      { sortKey: 'mom', clickOpens: true });
    $('qsTable').innerHTML = t.html; t.wire(quant);
  }

  // ---------- 5. Risk laboratory ----------
  async function risk() {
    const u = await getU();
    const regs = [{ name: 'S&P 500 (US)', ...u.regime }, ...(u.localRegimes || [])];
    $('rlRegimes').innerHTML = `<div class="rl-grid">${regs.map(r => `<div class="rl-cell t-${esc(r.trend || 'na')}"><b>${esc(r.name)}</b><div class="rl-trend">${esc(r.available === false ? 'n/a' : r.trend)}</div><div class="muted">${fin(r.trendAgreement) ? pu(r.trendAgreement, 0) + ' agree · uncertainty ' + esc(r.uncertainty) : ''}</div><div class="muted">volatility ${esc(r.volatility?.regime || 'n/a')}${r.liquidityStress ? ' · liquidity ' + esc(r.liquidityStress.level) : ''}</div></div>`).join('')}</div>
      <p class="muted">Rule-based votes from each index (trend: 200-day average, 50-day slope, drawdown, 6-month return, breadth where ≥ 10 tracked members). Regimes are clear only in hindsight.</p>`;
    try {
      const m = await (await fetch('/api/macro')).json();
      $('rlMacro').innerHTML = `<div class="rl-macro">${m.series.map(s => `<div class="cp-score"><div class="muted">${esc(s.label)}</div><div class="cp-num">${s.error ? 'n/a' : s.mode === 'yoy' ? pc(s.change1y) : nf(s.last)}</div><div class="muted">${s.error ? esc(s.error) : `${s.mode === 'yoy' ? 'year on year' : (s.change1y >= 0 ? '+' : '') + nf(s.change1y) + ' vs a year ago'} · ${esc(s.date)}`}</div><div class="plot spark" id="mac_${esc(s.id)}"></div></div>`).join('')}</div><p class="muted">Source: ${esc(m.source)}. Context only; not an input to the scores.</p>`;
      for (const s of m.series) if (s.history) Plotly.react('mac_' + s.id, [{ type: 'scatter', mode: 'lines', x: s.history.map(x => x[0]), y: s.history.map(x => x[1]), line: { color: css('--accent2'), width: 1.5 }, hoverinfo: 'x+y' }], lay({ margin: { l: 0, r: 0, t: 0, b: 0 }, xaxis: { visible: false }, yaxis: { visible: false }, showlegend: false }), cfg);
    } catch (e) { $('rlMacro').innerHTML = `<p class="muted">Macro data unavailable: ${esc(e.message)}</p>`; }
    // Universe stress: a 20 % fall in every local index, through each company's β (1 where unmeasured).
    const rows = u.stocks.filter(s => fin(s.price)).map(s => ({ ...s, shock: -0.2 * (fin(s.quant?.beta) ? s.quant.beta : 1) }));
    Plotly.react('rlScatter', [{ type: 'scatter', mode: 'markers', x: rows.map(s => s.hv252), y: rows.map(s => s.scores.risk), text: rows.map(s => s.label), customdata: rows.map(s => s.sym),
      marker: { size: rows.map(s => 6 + 14 * Math.sqrt(Math.max(0, (s.marketCapUSD || 0) / 3e12))), color: rows.map(s => css(STATUS_COL[s.valuation?.status] || '--muted')), line: { width: 1, color: css('--text') }, opacity: 0.85 },
      hovertemplate: '%{text}<br>volatility %{x:.0%} · risk score %{y}<extra></extra>' }], lay({ showlegend: false, xaxis: { title: { text: '1-year volatility' }, tickformat: '.0%', gridcolor: css('--grid') }, yaxis: { title: { text: 'risk score (universe percentile)' }, range: [0, 100], gridcolor: css('--grid') } }), cfg);
    $('rlScatter').on?.('plotly_click', e => openCo(e.points[0].customdata));
    const t = table('rlT', rows, [{ k: 'label', label: 'Company', get: s => s.label, fmt: (v, s) => `${esc(v)} <span class="muted">${esc(s.sym)}</span>` },
      { k: 'shock', label: 'Index −20 % → estimated move', get: s => s.shock, fmt: v => pc(v, 0), cls: v => v < -0.25 ? 'neg' : '' }, { k: 'beta', label: 'β', get: s => s.quant?.beta, fmt: (v, s) => fin(v) ? `${v.toFixed(2)} <span class="muted">vs ${esc(s.quant?.betaVs || '')}</span>` : '1 (assumed)' },
      { k: 'risk', label: 'Risk score', get: s => s.scores.risk, fmt: v => v ?? '–' }, { k: 'dd', label: 'Max drawdown 1y', get: s => s.quant?.maxDD1y, fmt: v => pu(v) }, { k: 'vol', label: 'Volatility', get: s => s.hv252, fmt: v => pu(v) }],
      { sortKey: 'shock', sortDir: 1, clickOpens: true, limit: 25 });
    $('rlStress').innerHTML = t.html; t.wire(risk);
  }

  // ---------- 9. Data quality monitor ----------
  async function dataMon() {
    const j = await (await fetch('/api/monitor/data', { cache: 'no-store' })).json(), c = j.coverage;
    const badge = s => `<span class="pv pv-${esc(s.replace(/\s/g, '-'))}">${esc(s)}</span>`;
    $('dqBody').innerHTML = `
      <div class="cp-scores pf-cards">${[['Companies', c.companies, `${c.withFilings} with filings`], ['With a current quote', c.withQuote, 'delayed quotes refresh while viewed'], ['With a valuation', c.withValuation, 'at least one model applies'], ['Stale fundamentals', c.staleFilings, 'filing > 450 days old'], ['Mean completeness', pu(c.meanCompleteness, 0), 'required fields present'], ['Disk free', fin(j.disk.diskFree) ? (j.disk.diskFree / 1e9).toFixed(2) + ' GB' : 'n/a', `data folder ${(j.disk.total / 1e6).toFixed(0)} MB`]].map(([k, v, n]) => `<div class="cp-score"><div class="muted">${k}</div><div class="cp-num">${v}</div><div class="muted">${n}</div></div>`).join('')}</div>
      <h4>Data providers</h4><div class="cp-scroll"><table class="cp-t"><tr><th>Provider</th><th>State</th><th>Data</th><th>Requests ok / failed</th><th>Median latency</th><th>Last success</th><th>Last error</th><th>Licence and terms</th></tr>${j.providers.map(p => `<tr><td><b>${esc(p.name)}</b><br><span class="muted">${esc(p.kinds.join('; '))}</span></td><td>${badge(p.state)}</td><td>${esc(p.data)}</td><td>${p.ok} / ${p.fail}</td><td>${fin(p.medianLatencyMs) ? Math.round(p.medianLatencyMs) + ' ms' : '–'}</td><td>${when(p.lastOk)}</td><td class="muted">${esc(p.lastError || '')} ${p.lastErrorAt ? when(p.lastErrorAt) : ''}</td><td class="muted">${esc(p.licence)}${p.needsKey ? ` <b>Key: ${esc(p.needsKey)}${p.configured ? ' ✓' : ' (not set)'}</b>` : ''}</td></tr>`).join('')}</table></div>
      <h4>Data kinds in this app</h4><ul>${Object.entries(j.kinds).map(([k, v]) => `<li><span class="kind kind-${k === 'estimated' ? 'estimate' : k}">${esc(k)}</span> ${esc(v)}</li>`).join('')}</ul>
      <h4>Companies with data issues <span class="muted">(${j.companies.filter(x => x.issues.length).length} of ${j.companies.length})</span></h4><div class="cp-scroll"><table class="cp-t"><tr><th>Company</th><th>Completeness</th><th>Latest filing</th><th>Price</th><th>Issues</th></tr>${j.companies.filter(x => x.issues.length).map(x => `<tr data-sym="${esc(x.sym)}"><td>${esc(x.label)} <span class="muted">${esc(x.sym)}</span></td><td>${pu(x.completeness, 0)}</td><td>${esc(x.filed || 'n/a')}${fin(x.filingAgeDays) ? ` <span class="muted">(${Math.round(x.filingAgeDays)} d)</span>` : ''}</td><td class="muted">${esc(x.priceKind || '')}</td><td>${x.issues.map(esc).join('<br>')}</td></tr>`).join('')}</table></div>
      <h4>Build</h4><p>Research built ${when(j.build.builtAt)}, prices recomputed ${when(j.build.recomputedAt)}. ${Object.keys(j.build.errors || {}).length ? `<span class="warn">Errors: ${Object.entries(j.build.errors).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('; ')}</span>` : 'No load errors.'}</p>
      <h4>FX sources</h4><p class="muted">${Object.entries(j.fx).map(([k, v]) => `${esc(k)}: ${esc(v.source || 'Yahoo')} (${fin(v.last?.c) ? v.last.c.toPrecision(5) : 'n/a'} USD, ${when(v.last?.t)})`).join(' · ')}</p>
      <h4>Storage and retention</h4><p>${Object.entries(j.disk.groups).map(([k, v]) => `${esc(k)} ${(v / 1e6).toFixed(1)} MB`).join(' · ')}. Market recordings older than 30 days are compacted daily${j.retention?.files ? `; last run ${esc(j.retention.at)}: ${j.retention.files.reduce((s, f) => s + (f.dropped || 0), 0)} old lines removed` : ''}. Logs, the paper book and experiments are never pruned.</p>`;
    $('dqBody').querySelectorAll('tr[data-sym]').forEach(tr => tr.onclick = () => openCo(tr.dataset.sym));
  }

  // ---------- 10. Model performance monitor ----------
  async function modelMon() {
    const j = await (await fetch('/api/monitor/models', { cache: 'no-store' })).json(), L = j.latest;
    const sd = j.statusDistribution, tot = Object.values(sd).reduce((a, b) => a + b, 0);
    $('mpBody').innerHTML = `
      <h4>Out-of-sample record of each signal <span class="muted">(latest experiment ${esc(L?.id || 'n/a')}, ${esc(L?.created?.slice(0, 10) || '')}; details in §5)</span></h4>
      ${L ? `<table class="cp-t"><tr><th>Signal</th><th class="cat-train">In-sample</th><th class="cat-val">Validation</th><th class="cat-test">Test</th><th class="cat-wf">Walk-forward</th><th>Deflated Sharpe</th></tr>${Object.values(L.scoreboard).filter(Boolean).map(r => `<tr><td>${esc(r.label)}</td><td>${nf(r.train)}</td><td>${nf(r.validation)}</td><td><b>${nf(r.test)}</b></td><td>${nf(r.walkForward)}</td><td>${pu(r.dsr, 0)}</td></tr>`).join('')}</table>` : '<p class="muted">No experiment yet.</p>'}
      <h4>How that evidence currently caps the decision engine</h4><table class="cp-t"><tr><th>Score component</th><th>Signal family</th><th>Evidence</th><th>Weight</th></tr>${j.evidenceCaps.map(c => `<tr><td>${esc(c.component)}</td><td>${esc(c.family)}</td><td>${esc(c.status)}</td><td>${c.prior}${c.k !== 1 ? ` → <b class="warn">${+(c.prior * c.k).toFixed(2)}</b>` : ''}</td></tr>`).join('')}</table>
      <h4>Prospective record <span class="muted">(${esc(j.prospective.category)})</span></h4><p>Started ${esc(j.prospective.started || 'today')} · ${j.prospective.days} daily snapshots.</p>
      ${j.prospective.horizons.map(h => `<div><b>${esc(h.horizon)} later</b>: ${h.observations ? `<table class="cp-t"><tr><th>Classification when recorded</th><th>n</th><th>Mean return</th><th>Median</th><th>Beat the median</th></tr>${h.byStatus.map(g => `<tr><td>${esc(g.status)}</td><td>${g.n}</td><td>${pc(g.mean)}</td><td>${pc(g.median)}</td><td>${pu(g.beatMedian, 0)}</td></tr>`).join('')}</table><p class="muted">Opportunity-score rank IC: ${nf(h.opportunityIC, 3)}. ${esc(h.note)}</p>` : `<span class="muted">${esc(h.note)}</span>`}</div>`).join('')}
      <div class="va-grid"><figure class="fig"><div class="plot" id="mpStatus" style="height:200px"></div><figcaption><b>Current classifications</b> of ${tot} companies. Many "uncertain" is the honest answer when models disagree.</figcaption></figure>
        <figure class="fig"><div class="plot" id="mpConf" style="height:200px"></div><figcaption><b>Per-model confidence</b> across companies (high / medium / low).</figcaption></figure></div>
      <h4>Paper trading <span class="muted">(${esc(j.paper.category)}; never mixed with backtests)</span></h4><p>Since ${esc(j.paper.start || 'n/a')}: ${pc(j.paper.returnPct)} · ${j.paper.orders} orders, ${j.paper.fills} fills.</p><div class="plot" id="mpPaper" style="height:200px"></div>
      ${j.calibration ? `<p class="muted">Rank-IC calibration (US, point-in-time EPS, total returns): earnings yield ${nf(j.calibration.valuation.ic, 3)} (t ${nf(j.calibration.valuation.t, 1)}, ${j.calibration.valuation.n} quarters); 12−1 momentum ${nf(j.calibration.momentum.ic, 3)} (t ${nf(j.calibration.momentum.t, 1)}).</p>` : ''}`;
    const order = ['below', 'within', 'above', 'uncertain', 'insufficient'];
    Plotly.react('mpStatus', [{ type: 'bar', x: order, y: order.map(k => sd[k] || 0), marker: { color: order.map(k => css(STATUS_COL[k])) } }], lay({ showlegend: false, yaxis: { gridcolor: css('--grid') } }), cfg);
    const ms = Object.keys(j.modelConfidence);
    Plotly.react('mpConf', ['high', 'medium', 'low'].map((lv, i) => ({ type: 'bar', name: lv, x: ms, y: ms.map(m => j.modelConfidence[m][lv]), marker: { color: css(['--buy', '--warn', '--sell'][i]) } })), lay({ barmode: 'stack', legend: { orientation: 'h', y: 1.2 }, yaxis: { gridcolor: css('--grid') } }), cfg);
    Plotly.react('mpPaper', [{ type: 'scatter', mode: 'lines+markers', name: 'paper equity', x: j.paper.equity.map(x => x[0]), y: j.paper.equity.map(x => x[1]), line: { color: css('--accent') } },
      { type: 'scatter', mode: 'lines', name: 'SPY', x: j.paper.spy.map(x => x[0]), y: j.paper.spy.map(x => x[1]), line: { color: css('--muted') } }], lay({ legend: { orientation: 'h', y: 1.2 }, yaxis: { gridcolor: css('--grid'), title: { text: 'growth of 1' } } }), cfg);
  }

  // ---------- layout manager ----------
  const LKEY = 'ws-layout';
  function layout() {
    const nav = document.querySelector('.tabs'); if (!nav) return;
    const btns = [...nav.querySelectorAll('button[data-v]')], saved = (() => { try { return JSON.parse(localStorage.getItem(LKEY) || 'null'); } catch { return null; } })();
    if (saved?.order) { for (const v of saved.order) { const b = btns.find(x => x.dataset.v === v); if (b) nav.appendChild(b); } }
    for (const b of btns) b.hidden = !!saved?.hidden?.includes(b.dataset.v) && !b.classList.contains('on');
    let gear = $('wsLayoutBtn'); if (!gear) { gear = document.createElement('button'); gear.id = 'wsLayoutBtn'; gear.textContent = '⚙ Layout'; gear.title = 'Show, hide and reorder sections'; nav.appendChild(gear); gear.onclick = editor; }
  }
  function editor() {
    const nav = document.querySelector('.tabs'), btns = [...nav.querySelectorAll('button[data-v]')];
    const box = $('wsLayout'); box.hidden = !box.hidden; if (box.hidden) return;
    box.innerHTML = `<b>Sections</b> <span class="muted">(order and visibility are saved in this browser)</span><ol>${btns.map(b => `<li><label><input type="checkbox" data-lv="${b.dataset.v}" ${b.hidden ? '' : 'checked'}> ${esc(b.textContent)}</label> <button class="btn mini" data-up="${b.dataset.v}">↑</button><button class="btn mini" data-dn="${b.dataset.v}">↓</button></li>`).join('')}</ol><button class="btn mini" id="wsReset">Reset</button>`;
    const save = () => { const bs = [...nav.querySelectorAll('button[data-v]')]; try { localStorage.setItem(LKEY, JSON.stringify({ order: bs.map(b => b.dataset.v), hidden: bs.filter(b => b.hidden).map(b => b.dataset.v) })); } catch {} };
    box.querySelectorAll('[data-lv]').forEach(c => c.onchange = () => { nav.querySelector(`button[data-v="${c.dataset.lv}"]`).hidden = !c.checked; save(); });
    box.querySelectorAll('[data-up],[data-dn]').forEach(b => b.onclick = () => { const v = b.dataset.up || b.dataset.dn, el = nav.querySelector(`button[data-v="${v}"]`), sib = b.dataset.up ? el.previousElementSibling : el.nextElementSibling;
      if (sib?.dataset?.v) { b.dataset.up ? nav.insertBefore(el, sib) : nav.insertBefore(sib, el); save(); box.hidden = true; editor(); } });
    $('wsReset').onclick = () => { try { localStorage.removeItem(LKEY); } catch {} location.reload(); };
  }

  const VIEWS = { valx: valuation, comp: companies, quant, riskl: risk, dq: dataMon, mp: modelMon };
  function init() {
    layout();
    window.addEventListener('viewchange', e => { const f = VIEWS[e.detail]; if (f) f().catch(err => { const s = document.querySelector('#' + e.detail + ' .ws-err'); if (s) s.textContent = 'Could not load: ' + err.message; }); });
  }
  window.WS = { VIEWS, table, state: st };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
