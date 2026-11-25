// Part 09 interface tests: the page scripts run against the recorded API snapshot (real data, offline). Each view must
// render without "undefined", "NaN", "[object" or "Infinity", and every plotted value must be finite.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { env } = require('./helpers/dom');
const settle = () => new Promise(r => setTimeout(r, 50));

test('heat map: every colour × size × grouping × region renders; tooltips and legend are clean', async () => {
  const E = env(); for (const [k, v] of Object.entries({ hmRegion: 'all', hmGroup: 'sector', hmColor: 'd1', hmSize: 'cap', hmN: '10' })) E.el(k).value = v;
  E.load('lib/stats.js', 'lib/treemap.js', 'lib/encodings.js', 'lib/valuation.js', 'lib/quant.js', 'lib/decision.js', 'public/heat.js'); await settle();
  const { QEnc, HEAT } = E.ctx; let renders = 0;
  for (const c of Object.keys(QEnc.COLOR)) for (const s of Object.keys(QEnc.SIZE)) for (const g of Object.keys(QEnc.GROUP)) for (const r of ['all', 'US', 'International']) {
    Object.assign(E.el('hmColor'), { value: c }); E.el('hmSize').value = s; E.el('hmGroup').value = g; E.el('hmRegion').value = r; HEAT.draw(); renders++;
    const b = E.bad(E.els.hmMap.innerHTML + E.els.hmLegend.innerHTML); assert.equal(b, null, `${c}/${s}/${g}/${r}: ${b}`);
  }
  assert.ok(renders >= 300); E.el('hmRegion').value = 'all'; HEAT.draw();
  assert.equal((E.els.hmMap.innerHTML.match(/class="hm-tile/g) || []).length, E.SNAP['/api/research/universe'].stocks.length);
  for (const sym of ['AAPL', '7203.T', '0700.HK', 'JPM']) for (const col of ['d1', 'prem', 'unc']) { E.el('hmColor').value = col; HEAT.tip({ target: { closest: () => ({ dataset: { sym } }) }, clientX: 5, clientY: 5 }); assert.equal(E.bad(E.els.hmTip.innerHTML), null, `tip ${sym}/${col}`); }
  assert.deepEqual(E.errors, []);
});
test('company panel: all seven tabs render for US, international, price-only and bank companies; comparison never picks', async () => {
  const E = env(); for (const [k, v] of Object.entries({ hmRegion: 'all', hmGroup: 'sector', hmColor: 'd1', hmSize: 'cap' })) E.el(k).value = v;
  E.load('lib/stats.js', 'lib/treemap.js', 'lib/encodings.js', 'lib/valuation.js', 'lib/quant.js', 'lib/decision.js', 'public/heat.js', 'public/paper.js'); await settle();
  for (const sym of ['AAPL', '7203.T', '0700.HK', 'JPM']) {
    await E.ctx.HEAT.open(sym); const tabs = E.els.hmPanelBody._tabs || [];
    assert.equal(tabs.length, 7, `${sym} tabs`);
    for (const t of ['overview', 'valuation', 'history', 'market', 'fund', 'trade', 'sources']) { const b = (E.els.hmPanelBody._tabs || []).find(x => x.dataset.tab === t); b._c(); await settle(); assert.equal(E.bad(E.els.cpTab.innerHTML), null, `${sym}/${t}: ${E.bad(E.els.cpTab.innerHTML)}`); }
  }
  E.ctx.HEAT.compare('AAPL'); E.ctx.HEAT.compare('7203.T'); await E.els.hmCmpGo.onclick(); await settle();
  assert.match(E.els.hmPanelBody.innerHTML, /No company is selected automatically/); assert.equal(E.bad(E.els.hmPanelBody.innerHTML), null);
  assert.deepEqual(E.errors, []);
});
test('validation view: every strategy renders; categories shown separately', async () => {
  const E = env(); E.load('public/validation.js'); await E.ctx.VALID.load(false);
  for (const s of Object.keys(E.ctx.VALID.state.exp.results)) { E.ctx.VALID.state.sig = s; E.ctx.VALID.render(); assert.equal(E.bad(E.els.vaBody.innerHTML + E.els.vaBoard.innerHTML), null, s); }
  assert.match(E.els.vaBoard.innerHTML, /In-sample Sharpe/); assert.match(E.els.vaBoard.innerHTML, /Walk-forward/); assert.deepEqual(E.errors, []);
});
test('portfolio lab, paper book and the six workstation sections render from the snapshot', async () => {
  const E = env(); E.load('public/portfolio.js', 'public/paper.js', 'public/workstation.js'); await settle();
  await E.ctx.PORT.go(); for (let i = 0; i < 20 && !E.ctx.PORT.state.result; i++) await settle();
  assert.ok(E.ctx.PORT.state.result, 'portfolio analysed'); assert.equal(E.bad(E.els.pfResult.innerHTML + E.els.pfBuilder.innerHTML), null);
  await E.ctx.PAPER.loadView(); assert.equal(E.bad(E.els.ptBook.innerHTML), null); assert.match(E.els.ptBook.innerHTML, /Simulated paper trading/);
  for (const [v, ids] of Object.entries({ valx: ['veTable'], comp: ['coTable'], quant: ['qsTable'], riskl: ['rlRegimes', 'rlStress'], dq: ['dqBody'], mp: ['mpBody'] })) {
    await E.ctx.WS.VIEWS[v](); const h = ids.map(i => E.els[i].innerHTML).join(''); assert.ok(h.length > 200, v); assert.equal(E.bad(h), null, `${v}: ${E.bad(h)}`);
  }
  assert.deepEqual(E.errors, []);
});
