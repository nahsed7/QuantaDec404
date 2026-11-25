// §5 Historical validation: experiment viewer. Results are shown per category (in-sample, validation, out-of-sample,
// walk-forward) and never pooled. Data come from /api/validation (see src/validation.js and lib/backtest.js).
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fin = x => typeof x === 'number' && Number.isFinite(x);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pc = (x, d = 1) => fin(x) ? (x >= 0 ? '+' : '') + (100 * x).toFixed(d) + ' %' : 'n/a';
  const pu = (x, d = 1) => fin(x) ? (100 * x).toFixed(d) + ' %' : 'n/a';
  const nf = (x, d = 2) => fin(x) ? x.toFixed(d) : 'n/a';
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const CAT = { train: ['In-sample (train)', '--muted'], validation: ['Validation', '--accent2'], test: ['Out-of-sample (test)', '--buy'], wf: ['Walk-forward (out-of-sample)', '--violet'] };
  const st = { exp: null, sig: 'value', poll: null };

  const lay = extra => ({ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'IBM Plex Mono', size: 11, color: css('--text') },
    margin: { l: 56, r: 16, t: 10, b: 36 }, legend: { orientation: 'h', y: 1.12 }, xaxis: { gridcolor: css('--grid') }, yaxis: { gridcolor: css('--grid') }, ...extra });
  const cfg = { displayModeBar: false, responsive: true };
  const growth = rows => { let e = 1; return rows.map(([m, r]) => { e *= 1 + (fin(r) ? r : 0); return [m, e]; }); };

  async function load(force) {
    try {
      if (force) await fetch('/api/validation/run?force=1');
      const j = await (await fetch('/api/validation', { cache: 'no-store' })).json();
      if (j.running || !j.experiment) {
        $('vaStatus').textContent = j.error ? 'Validation failed: ' + j.error : `Running validation… ${j.progress ? `${j.progress.step}${j.progress.of ? ` ${j.progress.done}/${j.progress.of}` : ''}` : 'waiting for research data'}`;
        clearTimeout(st.poll); st.poll = setTimeout(() => load(false), 3000); return;
      }
      st.exp = j.experiment; render();
    } catch (e) { $('vaStatus').textContent = 'Could not load validation results: ' + e.message; }
  }

  function render() {
    const e = st.exp, r = e.results[st.sig]; if (!r) return;
    $('vaStatus').innerHTML = `Experiment <b>${esc(e.id)}</b> · ${esc(e.created.slice(0, 16).replace('T', ' '))} · ${e.data.stocks} stocks, ${esc(e.data.from)} → ${esc(e.data.to)} · benchmark ${esc(e.data.benchmark)} · risk-free ${esc(e.data.riskFree)} · data fingerprint ${esc(e.dataFingerprint)} · ${nf(e.seconds, 0)} s`;
    $('vaSig').innerHTML = Object.entries(e.results).map(([k, x]) => `<option value="${k}" ${k === st.sig ? 'selected' : ''}>${esc(x.label || k)}</option>`).join('');
    scoreboard(e); if (r.insufficient) { $('vaBody').innerHTML = `<p class="warn">${esc(r.reason)}</p>`; return; }
    const seg = r.segments;
    $('vaBody').innerHTML = `
      <p class="va-chosen">Chosen on the training segment only: <b>${esc(JSON.stringify(r.chosen))}</b> (best of ${r.configsTried} configurations by train Sharpe). Costs ${r.costBps} bp per unit traded.</p>
      ${verdict(r)}
      <figure class="fig"><div class="plot" id="vaEq" style="height:360px"></div><figcaption><b>Growth of 1</b> (log scale). Shaded: train ${esc(seg.train.from)}–${esc(seg.train.to)}, validation ${esc(seg.validation.from)}–${esc(seg.validation.to)}, test ${esc(seg.test.from)}–${esc(seg.test.to)}. The dashed line is the walk-forward strategy, which re-chooses its parameters every ${e.config.wfStep} months using only the previous ${e.config.wfWindow}.</figcaption></figure>
      <h4>Results by category <span class="muted">(never pooled)</span></h4>${catTable(r)}
      <div class="va-grid">
        <figure class="fig"><div class="plot" id="vaRnd" style="height:240px"></div><figcaption><b>Against luck.</b> Sharpe ratios of ${r.randomBaseline.test.draws} random portfolios (same size and rebalancing) in the test segment, and where the strategy falls (${pu(r.randomBaseline.test.strategyPercentile, 0)} percentile).</figcaption></figure>
        <figure class="fig"><div class="plot" id="vaRoll" style="height:240px"></div><figcaption><b>Stability.</b> Rolling 24-month Sharpe ratio, strategy vs benchmark. Descriptive: it spans all segments and is not used for selection.</figcaption></figure>
      </div>
      <h4>Parameter sensitivity <span class="muted">(train and validation only; the test segment is never used to compare parameters)</span></h4>${sensTable(r)}
      <h4>Transaction-cost sensitivity <span class="muted">(validation segment)</span></h4>
      <table class="cp-t"><tr><th>Cost (bp)</th>${r.costs.map(c => `<th>${c.costBps}</th>`).join('')}</tr><tr><td>CAGR</td>${r.costs.map(c => `<td>${pc(c.cagr)}</td>`).join('')}</tr><tr><td>Sharpe</td>${r.costs.map(c => `<td>${nf(c.sharpe)}</td>`).join('')}</tr><tr><td>Cost drag / yr</td>${r.costs.map(c => `<td>${pu(c.costDrag, 2)}</td>`).join('')}</tr><tr><td>Turnover / yr</td>${r.costs.map(c => `<td>${nf(c.turnover, 1)}×</td>`).join('')}</tr></table>
      <h4>Performance by market regime <span class="muted">(regime known at the start of each month: SPY vs its 10-month average; 6-month σ vs its median so far)</span></h4>
      <div class="va-grid">${['validation', 'test'].map(k => `<div><b>${k === 'test' ? 'Out-of-sample (test)' : 'Validation'}</b>${regTable(r.regimes[k])}</div>`).join('')}</div>
      <h4>Overfitting check</h4><p>${dsrText(r)}</p>`;
    charts(r, e);
  }
  function verdict(r) {
    const d = r.degradation, notes = [];
    if (fin(d.trainSharpe) && fin(d.testSharpe) && d.testSharpe < 0.5 * d.trainSharpe) notes.push(`Out-of-sample Sharpe (${nf(d.testSharpe)}) is less than half the in-sample value (${nf(d.trainSharpe)}): the in-sample result was largely fit to that period.`);
    if (fin(r.walkForward?.excessAnn) && Math.abs(r.walkForward.excessAnn) <= 0.005) notes.push(`Walk-forward excess return is about zero (${pc(r.walkForward.excessAnn)} a year): no edge over the benchmark once parameters are chosen without hindsight.`);
    if (fin(r.test.excessAnn) && r.test.excessAnn < 0) notes.push(`Out of sample it trailed the benchmark by ${pu(-r.test.excessAnn)} a year.`);
    if (fin(r.randomBaseline.test.strategyPercentile) && r.randomBaseline.test.strategyPercentile < 0.75) notes.push(`In the test segment it did not beat ${pu(1 - r.randomBaseline.test.strategyPercentile, 0)} of random portfolios, so skill cannot be distinguished from luck.`);
    if (fin(r.walkForward?.excessAnn) && r.walkForward.excessAnn > 0.005 && fin(r.test.excessAnn) && r.test.excessAnn > 0.005) notes.push(`Positive excess return both in the test segment (${pc(r.test.excessAnn)}) and walk-forward (${pc(r.walkForward.excessAnn)}). Still about ${r.test.n} months of test data: weak evidence.`);
    return `<div class="va-verdict">${notes.length ? notes.map(n => `<p>• ${esc(n)}</p>`).join('') : '<p class="muted">No strong conclusion either way.</p>'}<p class="muted">A good backtest is not evidence of future returns. This universe has survivorship bias (see below).</p></div>`;
  }
  function catTable(r) {
    const cols = [['In-sample (train)', r.inSample, 'cat-train'], ['Validation', r.validation, 'cat-val'], ['Out-of-sample (test)', r.test, 'cat-test'], ['Walk-forward (out-of-sample)', r.walkForward, 'cat-wf']];
    const row = (l, f, bf) => `<tr><td>${l}</td>${cols.map(([, x]) => `<td>${x ? f(x) : 'n/a'}${bf && x?.bench ? ` <span class="muted">(${bf(x.bench)})</span>` : ''}</td>`).join('')}</tr>`;
    return `<div class="cp-scroll"><table class="cp-t va-cat"><tr><th></th>${cols.map(([l, x, c]) => `<th class="${c}">${l}<br><span class="muted">${x ? `${esc(x.from)} → ${esc(x.to)}, ${x.n} months` : ''}</span></th>`).join('')}</tr>
      ${row('Total return <span class="muted">(benchmark)</span>', x => pc(x.total), b => pc(b.total))}${row('CAGR', x => pc(x.cagr), b => pc(b.cagr))}${row('Volatility', x => pu(x.vol))}
      ${row('Sharpe', x => nf(x.sharpe), b => nf(b.sharpe))}${row('Sortino', x => nf(x.sortino))}${row('Max drawdown', x => pu(x.maxDrawdown), b => pu(b.maxDrawdown))}
      ${row('Excess vs benchmark / yr', x => pc(x.excessAnn))}${row('Information ratio', x => nf(x.infoRatio))}${row('Win rate (months beating benchmark)', x => pu(x.winRate, 0))}
      ${row('Profit factor', x => nf(x.profitFactor))}${row('Turnover / yr (one-way)', x => nf(x.turnover, 1) + '×')}${row('Cost drag / yr', x => pu(x.costDrag, 2))}
      ${row('Exposure · average names', x => `${pu(x.exposure, 0)} · ${nf(x.names, 1)}`)}${row('Missing exits', x => x.missingExits || 0)}</table></div>`;
  }
  function sensTable(r) {
    const keys = Object.keys(r.sensitivity[0]?.params || {});
    return `<div class="cp-scroll"><table class="cp-t"><tr>${keys.map(k => `<th>${esc(k)}</th>`).join('')}<th>Train Sharpe</th><th>Validation Sharpe</th></tr>${r.sensitivity.map(x => `<tr class="${JSON.stringify(x.params) === JSON.stringify(r.chosen) ? 'va-pick' : ''}">${keys.map(k => `<td>${esc(x.params[k])}</td>`).join('')}<td>${nf(x.trainSharpe)}</td><td>${nf(x.valSharpe)}</td></tr>`).join('')}</table></div>
      <p class="muted">Highlighted: the chosen configuration. A robust signal performs similarly across neighbouring settings; a single standout row is a warning sign of overfitting.</p>`;
  }
  const regTable = rows => rows?.length ? `<table class="cp-t"><tr><th>Regime</th><th>Months</th><th>Strategy / yr</th><th>Benchmark / yr</th><th>Excess / yr</th></tr>${rows.map(x => `<tr><td>${esc(x.regime)}</td><td>${x.months}</td><td>${pc(x.annReturn)}</td><td>${pc(x.benchAnn)}</td><td>${pc(x.excessAnn)}</td></tr>`).join('')}</table>` : '<p class="muted">Not enough months.</p>';
  function dsrText(r) {
    const d = r.deflatedSharpe; if (!d) return 'Not enough data for a deflated Sharpe ratio.';
    return `Deflated Sharpe ratio on the training segment: <b>${pu(d.dsr, 0)}</b> probability that the true Sharpe exceeds what the best of ${d.trials} zero-skill configurations would show by chance (Bailey & López de Prado 2014). It accounts for the number of configurations tried and for non-normal returns. Training-sample evidence only; the test segment is the honest check.`;
  }
  function scoreboard(e) {
    const rs = Object.entries(e.results).filter(([, r]) => !r.insufficient), b = e.baselines;
    $('vaBoard').innerHTML = `<table class="cp-t"><tr><th>Strategy</th><th class="cat-train">In-sample Sharpe</th><th class="cat-val">Validation Sharpe</th><th class="cat-test">Test Sharpe</th><th class="cat-test">Test excess / yr</th><th class="cat-wf">Walk-forward Sharpe</th><th class="cat-wf">Walk-forward excess / yr</th><th>Test vs random</th></tr>
      ${rs.map(([k, r]) => `<tr class="${k === st.sig ? 'va-pick' : ''}" data-sig="${k}"><td>${esc(r.label)}</td><td>${nf(r.inSample.sharpe)}</td><td>${nf(r.validation.sharpe)}</td><td><b>${nf(r.test.sharpe)}</b></td><td>${pc(r.test.excessAnn)}</td><td>${nf(r.walkForward?.sharpe)}</td><td>${pc(r.walkForward?.excessAnn)}</td><td>${pu(r.randomBaseline.test.strategyPercentile, 0)}</td></tr>`).join('')}
      <tr class="muted"><td>Benchmark: ${esc(e.data.benchmark)} (full sample)</td><td colspan="7">CAGR ${pc(b.benchmark.cagr)} · Sharpe ${nf(b.benchmark.sharpe)} · max drawdown ${pu(b.benchmark.maxDrawdown)}</td></tr>
      <tr class="muted"><td>Equal-weight universe, monthly rebalanced (full sample)</td><td colspan="7">CAGR ${pc(b.equalWeight.cagr)} · Sharpe ${nf(b.equalWeight.sharpe)} · <b>survivorship gap ${pc(b.survivorshipGap)}</b>: an upper bound on how much today's-survivors bias flatters any result here</td></tr>
      <tr class="muted"><td>Buy-and-hold equal weight (full sample)</td><td colspan="7">CAGR ${pc(b.buyHold.cagr)} · Sharpe ${nf(b.buyHold.sharpe)}</td></tr></table>
      <div class="plot" id="vaDeg" style="height:230px"></div>
      <p class="muted"><b>Degradation chart.</b> Each strategy's Sharpe ratio from in-sample to validation to test to walk-forward. Bars that shrink from left to right reveal overfitting. Paper-trading results are kept separately in the paper book; live trading is disabled.</p>`;
    $('vaBoard').querySelectorAll('[data-sig]').forEach(tr => tr.onclick = () => { st.sig = tr.dataset.sig; render(); });
    const names = rs.map(([, r]) => r.label.replace(/ \(.*\)/, ''));
    Plotly.react('vaDeg', [['inSample', 'In-sample', '--muted'], ['validation', 'Validation', '--accent2'], ['test', 'Test', '--buy'], ['walkForward', 'Walk-forward', '--violet']].map(([k, n, c]) => ({
      type: 'bar', name: n, x: names, y: rs.map(([, r]) => r[k]?.sharpe ?? null), marker: { color: css(c) } })), lay({ barmode: 'group', yaxis: { title: { text: 'Sharpe' }, gridcolor: css('--grid'), zeroline: true } }), cfg);
  }
  function charts(r, e) {
    const sEq = growth(r.equity.strategy), bEq = growth(r.equity.bench), seg = r.segments;
    const shade = (a, b, c) => ({ type: 'rect', xref: 'x', yref: 'paper', x0: a, x1: b, y0: 0, y1: 1, fillcolor: css(c), opacity: 0.08, line: { width: 0 } });
    const tr = [{ type: 'scatter', mode: 'lines', name: 'Strategy (chosen on train)', x: sEq.map(x => x[0]), y: sEq.map(x => x[1]), line: { color: css('--accent'), width: 2 } },
      { type: 'scatter', mode: 'lines', name: 'Benchmark (SPY total return)', x: bEq.map(x => x[0]), y: bEq.map(x => x[1]), line: { color: css('--muted'), width: 1.5 } }];
    if (r.walkForward) { const start = bEq.find(x => x[0] === r.walkForward.rows[0][0])?.[1] ?? 1, w = growth(r.walkForward.rows).map(([m, v]) => [m, v * start]);
      tr.push({ type: 'scatter', mode: 'lines', name: 'Walk-forward (out-of-sample)', x: w.map(x => x[0]), y: w.map(x => x[1]), line: { color: css('--violet'), width: 2, dash: 'dash' } }); }
    Plotly.react('vaEq', tr, lay({ yaxis: { type: 'log', gridcolor: css('--grid'), title: { text: 'growth of 1 (log)' } },
      shapes: [shade(seg.train.from, seg.train.to, '--muted'), shade(seg.validation.from, seg.validation.to, '--accent2'), shade(seg.test.from, seg.test.to, '--buy')],
      annotations: [['train', seg.train], ['validation', seg.validation], ['test', seg.test]].map(([t, s]) => ({ x: s.from, yref: 'paper', y: 1, text: t, showarrow: false, xanchor: 'left', yanchor: 'top', font: { color: css('--muted') } })) }), cfg);
    const h = r.randomBaseline.test.hist;
    if (h) Plotly.react('vaRnd', [{ type: 'bar', x: h.counts.map((_, i) => h.lo + (i + 0.5) * h.width), y: h.counts, marker: { color: css('--grid') }, name: 'random portfolios', hovertemplate: 'Sharpe %{x:.2f}: %{y}<extra></extra>' }],
      lay({ showlegend: false, xaxis: { title: { text: 'test-segment Sharpe' }, gridcolor: css('--grid') }, yaxis: { title: { text: 'count' }, gridcolor: css('--grid') },
        shapes: fin(r.test.sharpe) ? [{ type: 'line', x0: r.test.sharpe, x1: r.test.sharpe, yref: 'paper', y0: 0, y1: 1, line: { color: css('--accent'), width: 3 } }] : [],
        annotations: fin(r.test.sharpe) ? [{ x: r.test.sharpe, yref: 'paper', y: 1, text: 'strategy', showarrow: false, yanchor: 'bottom', font: { color: css('--accent') } }] : [] }), cfg);
    Plotly.react('vaRoll', [{ type: 'scatter', mode: 'lines', name: 'Strategy', x: r.rolling.map(x => x.month), y: r.rolling.map(x => x.strategy), line: { color: css('--accent') } },
      { type: 'scatter', mode: 'lines', name: 'Benchmark', x: r.rolling.map(x => x.month), y: r.rolling.map(x => x.bench), line: { color: css('--muted') } }], lay({ yaxis: { title: { text: '24-month Sharpe' }, gridcolor: css('--grid'), zeroline: true } }), cfg);
    $('vaNotes').innerHTML = `<h4>Assumptions</h4><ul>${e.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul><h4>Known biases</h4><ul>${e.biases.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
      <p class="muted">Reproducible: the same configuration on the same data (fingerprint ${esc(e.dataFingerprint)}) gives experiment ${esc(e.id)}. Random baselines use seed ${e.config.seed}.</p>`;
  }

  function init() {
    if (!$('vaBody')) return;
    $('vaSig').onchange = () => { st.sig = $('vaSig').value; render(); };
    $('vaRerun').onclick = () => { $('vaStatus').textContent = 'Starting a fresh run…'; load(true); };
    let loaded = false;
    window.addEventListener('viewchange', e => { if (e.detail === 'valid' && !loaded) { loaded = true; load(false); } else if (e.detail === 'valid' && st.exp) render(); });
  }
  window.VALID = { load, render, state: st };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
