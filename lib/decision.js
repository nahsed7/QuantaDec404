// Decision intelligence: three independent scores (opportunity, risk, confidence) with their components,
// plus an uncertainty decomposition. Scores never collapse into a buy/sell signal.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QDecision = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin, cl = x => S.clamp(x, 0, 100), pct = x => (100 * x).toFixed(0) + ' %', pp = x => (100 * x).toFixed(1) + ' %';

  // Weighted mean over the components that could be evaluated, rounded to 5 points (finer precision would be false).
  // missingAs: for confidence, a component that cannot be measured counts as 0 (absence of evidence is not support).
  function combine(parts, missingAs = null) {
    if (missingAs != null) parts = parts.map(p => fin(p.score) ? p : { ...p, score: missingAs, missing: true, explain: (p.explain ? p.explain + ' ' : '') + '(Not measurable, counted as 0.)' });
    const known = parts.filter(p => fin(p.score) && !p.missing), all = parts.filter(p => fin(p.score)), w = S.sum(known.map(p => p.weight));
    const W = S.sum(all.map(p => p.weight)), raw = W ? S.sum(all.map(p => p.score * p.weight)) / W : null;
    return { score: fin(raw) ? Math.round(raw / 5) * 5 : null, raw, known: known.length, total: parts.length, parts };
  }
  const part = (name, score, weight, explain, source) => ({ name, score: fin(score) ? cl(score) : null, weight, explain, source });

  // d: a company dossier (see server research module). u: universe context { mom12_1: [...], rel63: [...] }. cal: calibration.
  function opportunity(d, u = {}) {
    const v = d.valuation?.synthesis, m = d.momentum, f = d.fund, rf = d.rf;
    const rank = (arr, x) => fin(x) && arr?.length >= 10 ? 100 * S.percentileRank(arr, x) : null;
    const fcfYield = fin(d.fcf) && d.marketCap > 0 ? d.fcf / d.marketCap : null;
    const eqYield = fin(d.eps) && d.price > 0 ? d.eps / d.price : null, y = d.isFinancial ? eqYield : (fcfYield ?? eqYield);
    return combine([
      part('Valuation', fin(v?.premium) ? 50 - 100 * v.premium : null, 3,
        fin(v?.premium) ? `Price is ${pct(Math.abs(v.premium))} ${v.premium < 0 ? 'below' : 'above'} the base estimate of the ${v.primary} model.` : 'No applicable valuation model.', 'valuation'),
      part('Momentum (12−1 month)', rank(u.mom12_1, m?.mom12_1), 2,
        fin(m?.mom12_1) ? `12-month return excluding the last month is ${pp(m.mom12_1)}; ranked against the tracked universe.` : 'Needs over a year of daily prices.', 'momentum'),
      part('Fundamental quality', S.mean([f?.fscore ? 100 * f.fscore.score / f.fscore.of : null, fin(f?.roic) ? 100 * f.roic / 0.2 : null, fin(f?.fcfMargin) ? 100 * f.fcfMargin / 0.2 : null]), 2,
        `Piotroski ${f?.fscore ? f.fscore.score + '/' + f.fscore.of : 'n/a'}, ROIC ${fin(f?.roic) ? pp(f.roic) : 'n/a'}, FCF margin ${fin(f?.fcfMargin) ? pp(f.fcfMargin) : 'n/a'}.`, 'fundamentals'),
      part('Relative performance (3 months vs sector)', rank(u.rel63, m?.relSector63), 1,
        fin(m?.relSector63) ? `${pp(m.relSector63)} versus the sector median.` : 'Not enough sector peers.', 'momentum'),
      part('Growth', fin(f?.revGrowth3) ? 50 + 250 * f.revGrowth3 : null, 2,
        fin(f?.revGrowth3) ? `Revenue grew ${pp(f.revGrowth3)} a year over 3 years (historical, not a forecast).` : 'Fewer than 4 years of revenue.', 'fundamentals'),
      part('Reported earnings trend', fin(d.epsYoY) ? 50 + 100 * S.clamp(d.epsYoY, -0.5, 0.5) : null, 1,
        fin(d.epsYoY) ? `Latest quarterly EPS is ${pp(d.epsYoY)} versus a year earlier. This is a catalyst proxy; analyst revisions are not available.` : 'No comparable quarterly EPS.', 'fundamentals'),
      part('Opportunity cost (yield vs risk-free)', fin(y) && fin(rf) ? 50 + 1000 * (y - rf) : null, 1,
        fin(y) ? `${d.isFinancial || !fin(fcfYield) ? 'Earnings' : 'Free-cash-flow'} yield ${pp(y)} versus a ${pp(rf)} ${d.rfInfo?.label || '10-year Treasury'}${d.rfInfo?.fallback ? ' (no local-currency yield available)' : ''}.` : 'Yield unavailable.', 'valuation'),
    ]);
  }

  function risk(d, regime) {
    const vo = d.volatility, f = d.fund, v = d.valuation?.synthesis, l = d.liquidity;
    const distress = d.isFinancial ? null : S.mean([fin(f?.debtToEbitda) ? 100 * f.debtToEbitda / 5 : null, fin(f?.interestCover) ? 100 - 10 * f.interestCover : null,
      fin(f?.currentRatio) ? 100 - 60 * (f.currentRatio - 0.5) : null, f?.fscore ? 100 - 100 * f.fscore.score / f.fscore.of : null]);
    const beta = fin(vo?.beta) ? vo.beta : null;
    const adverse = regime?.available ? (regime.trend === 'bear' ? 1.5 : regime.trend === 'bull' ? 0.8 : 1) * (regime.volatility.regime === 'high' ? 1.3 : 1) : null;
    return combine([
      part('Volatility', fin(vo?.hv252) ? 100 * vo.hv252 / 0.6 : null, 2, fin(vo?.hv252) ? `Annualised volatility ${pp(vo.hv252)} over 1 year (60 % scores 100).` : 'Not enough prices.', 'volatility'),
      part('Drawdown exposure', fin(vo?.maxDrawdown1y) ? 100 * vo.maxDrawdown1y / 0.5 : null, 2, fin(vo?.maxDrawdown1y) ? `Worst peak-to-trough fall in 1 year: ${pp(vo.maxDrawdown1y)}; currently ${pp(vo.currentDrawdown)} below the peak.` : '', 'volatility'),
      part('Valuation risk', fin(v?.premium) ? 50 + 100 * v.premium : null, 2, fin(v?.premium) ? `Premium to base value ${pp(v.premium)}.` : 'No valuation.', 'valuation'),
      part('Financial distress', distress, 2, d.isFinancial ? 'Leverage ratios are not comparable for financial companies.' : `Debt/EBITDA ${fin(f?.debtToEbitda) ? f.debtToEbitda.toFixed(1) : 'n/a'}, interest cover ${fin(f?.interestCover) ? f.interestCover.toFixed(1) + '×' : 'n/a'}, current ratio ${fin(f?.currentRatio) ? f.currentRatio.toFixed(2) : 'n/a'}.`, 'fundamentals'),
      part('Liquidity risk', fin(l?.addv) ? 100 * (9.5 - Math.log10(l.addv)) / 3 : null, 1, fin(l?.addv) ? `Median daily traded value $${(l.addv / 1e6).toFixed(0)} M.` : '', 'liquidity'),
      part('Concentration risk', d.concentration ?? null, 1, d.concentration == null ? 'No equity positions in the paper portfolio, so concentration cannot be assessed.' : '', 'portfolio'),
      part('Model risk', fin(v?.dispersion) || fin(v?.widthRatio) ? S.mean([fin(v.dispersion) ? 100 * v.dispersion / 0.8 : null, fin(v.widthRatio) && v.widthRatio < 50 ? 100 * (v.widthRatio - 1) / 2 : null]) : null, 1,
        fin(v?.dispersion) ? `Spread between valuation models (log st. dev.) ${v.dispersion.toFixed(2)}; primary range high/low ${fin(v.widthRatio) ? v.widthRatio.toFixed(2) : 'n/a'}.` : 'Only one model, so model risk cannot be measured.', 'valuation'),
      part('Market regime risk', fin(beta) && fin(adverse) ? 50 * beta * adverse : null, 1, fin(beta) && regime?.available ? `β ${beta.toFixed(2)} in a ${regime.trend} / ${regime.volatility.regime}-volatility regime.` : 'Regime or beta unavailable.', 'regime'),
    ]);
  }

  function confidence(d, cal, cover) {
    const v = d.valuation?.synthesis, dcf = d.valuation?.models?.find(m => m.id === 'dcf');
    const fileAge = d.fresh?.filingAgeDays, priceAge = d.fresh?.priceAgeMin;
    const worst = dcf?.applicable && dcf.sensitivity?.[0]?.swing > 0 ? dcf.sensitivity[0] : null;
    return combine([
      part('Data completeness', fin(d.completeness) ? 100 * d.completeness : null, 2, fin(d.completeness) ? `${pct(d.completeness)} of the required fields are present.` : '', 'data'),
      part('Data freshness', fin(fileAge) ? S.mean([100 - 100 * Math.max(0, fileAge - 100) / 300, fin(priceAge) ? 100 - priceAge / 30 : null]) : null, 1,
        fin(fileAge) ? `Latest filing ${fileAge.toFixed(0)} days old; price ${fin(priceAge) ? priceAge.toFixed(0) + ' min' : 'age unknown'}.` : '', 'data'),
      part('Agreement between models', fin(v?.dispersion) ? 100 - 150 * v.dispersion : null, 2,
        fin(v?.agreement) ? `${pct(v.agreement)} of the other models fall inside the primary range; log spread ${v.dispersion?.toFixed(2)}.` : 'Fewer than two applicable models.', 'valuation'),
      part('Historical performance of the signal', fin(cal?.valuation?.ic) ? 50 + 500 * cal.valuation.ic : null, 1,
        fin(cal?.valuation?.ic) ? `Cheapness (earnings yield) vs next-quarter return across this universe: mean rank IC ${cal.valuation.ic.toFixed(3)} over ${cal.valuation.n} quarters.` : 'Calibration not available.', 'calibration'),
      part('Stability of assumptions', fin(d.fund?.opMarginStd) ? 100 - 1000 * d.fund.opMarginStd : null, 1,
        fin(d.fund?.opMarginStd) ? `Operating margin varied by ${pp(d.fund.opMarginStd)} (st. dev.) over 5 years.` : '', 'fundamentals'),
      part('Sensitivity to inputs', worst && worst.base > 0 ? 100 - 100 * worst.swing / worst.base : null, 1,
        worst ? `"${worst.label}" alone moves the DCF value by ${pct(worst.swing / worst.base)} of base.` : 'No DCF sensitivity available.', 'valuation'),
      part('Out-of-sample validation', fin(cal?.valuation?.icLater) ? 50 + 500 * cal.valuation.icLater : null, 1,
        fin(cal?.valuation?.icLater) ? `Later half of the sample, not used to choose anything: IC ${cal.valuation.icLater.toFixed(3)} (earlier half ${cal.valuation.icEarlier?.toFixed(3)}).` : 'No out-of-sample result.', 'calibration'),
      part('Width of valuation range', fin(v?.widthRatio) && v.widthRatio < 50 ? 100 - 50 * (v.widthRatio - 1) : null, 1,
        fin(v?.widthRatio) ? `Primary model range spans ${v.widthRatio.toFixed(2)}× from low to high.` : 'No valuation range.', 'valuation'),
      part('Coverage of the other scores', fin(cover) ? 100 * cover : null, 1, fin(cover) ? `${pct(cover)} of the opportunity and risk components could be evaluated.` : '', 'data'),
    ], 0);
  }

  const band = s => !fin(s) ? 'unknown' : s >= 65 ? 'high' : s <= 35 ? 'low' : 'moderate';
  function interpret(o, r, c) {
    const O = band(o.score), R = band(r.score), C = band(c.score);
    const head = O === 'high' ? 'Potentially attractive' : O === 'low' ? 'Unattractive on these measures' : O === 'unknown' ? 'Not assessable' : 'Mixed';
    const risk = R === 'high' ? 'with high risk' : R === 'low' ? 'with low measured risk' : R === 'unknown' ? '' : 'with moderate risk';
    const conf = C === 'low' ? 'and low confidence: treat the assessment as highly uncertain' : C === 'high' ? 'and reasonably well-supported evidence' : C === 'unknown' ? '' : 'and moderate confidence';
    return `${head} ${risk} ${conf}. This is a research summary, not a recommendation to buy or sell.`.replace(/\s+/g, ' ');
  }

  // Uncertainty decomposition: supporting, contradicting, unknown, assumptions, swing variables, alternatives, failure conditions.
  function evidence(d, o, r, c, scen) {
    const sup = [], con = [], unk = [], alt = [], fail = [];
    for (const p of o.parts) { if (!fin(p.score)) unk.push(`${p.name}: ${p.explain}`); else if (p.score >= 65) sup.push(`${p.name}: ${p.explain}`); else if (p.score <= 35) con.push(`${p.name}: ${p.explain}`); }
    for (const p of r.parts) { if (!fin(p.score)) unk.push(`${p.name}: ${p.explain}`); else if (p.score >= 65) con.push(`${p.name} is high: ${p.explain}`); }
    for (const p of c.parts) if (p.missing) unk.push(`${p.name}: ${p.explain}`); else if (fin(p.score) && p.score <= 35) con.push(`Low confidence from ${p.name.toLowerCase()}: ${p.explain}`);
    for (const fl of d.fund?.flags || []) con.push(`Fundamental flag: ${fl}`);
    if (d.exhaustion?.available) for (const s of d.exhaustion.signals) (d.exhaustion.direction === 'up' ? con : sup).push(`Exhaustion signal (${d.exhaustion.direction}trend): ${s}`);
    const st = d.valuation?.synthesis;
    for (const n of st?.notes || []) con.push(`Valuation: ${n}`);
    for (const m of d.valuation?.models || []) if (!m.applicable) unk.push(`${m.name}: ${m.reason}`);
    unk.push('Analyst estimates and revisions: no free source, so not included.', 'News, guidance and management commentary: not ingested.', 'Quoted bid/ask and order-book depth for US equities: not available from the free feed (spread is estimated).');
    const prem = st?.premium, mom = d.momentum?.mom12_1;
    if (fin(prem) && prem < -0.2 && fin(mom) && mom < -0.1) alt.push('Value trap: the market may be pricing a deterioration that has not reached the reported numbers yet.');
    if (fin(prem) && prem > 0.2 && fin(d.fund?.revGrowth3) && d.fund.revGrowth3 > 0.1) alt.push('The premium may reflect growth or margin expansion that a model built on historical averages cannot capture.');
    if (fin(d.fund?.accruals) && d.fund.accruals > 0.05) alt.push('Reported earnings may be flattered by accruals; cash flow is weaker than net income.');
    if (d.exhaustion?.count >= 2) alt.push('The recent move may reflect news or flows rather than a change in value; such moves can extend further or reverse.');
    if (d.isFinancial) alt.push('For financial firms, book values depend on loan-loss and fair-value assumptions that outsiders cannot verify.');
    alt.push('Being cheap or expensive relative to a model does not imply the price will move toward it within any horizon.');
    for (const s of scen || []) if (s.statusChanged) fail.push(`${s.name}: the primary value changes by ${fin(s.primaryChange) ? pct(s.primaryChange) : 'n/a'} and the classification becomes "${s.status}".`);
    const prim = d.valuation?.models?.find(m => m.id === st?.primary);
    const swing = (d.valuation?.models?.find(m => m.id === 'dcf')?.sensitivity || []).slice(0, 3).filter(t => fin(t.swing)).map(t => `${t.label}: value ${t.down?.toFixed(2)} … ${t.up?.toFixed(2)}`);
    return { supporting: sup, contradicting: con, unknown: unk, assumptions: [...(prim?.assumptions || []), `Equity risk premium ${(100 * (d.erp ?? 0.05)).toFixed(1)} % (judgement).`], swingVariables: swing,
      alternatives: alt, failureConditions: fail.length ? fail : ['No single tested scenario changes the classification. Combined shocks still could.'], limitations: prim?.limitations || [] };
  }

  function assess(d, ctx = {}) {
    const o = opportunity(d, ctx.universe), r = risk(d, ctx.regime), c = confidence(d, ctx.calibration, (o.known + r.known) / (o.total + r.total));
    return { opportunity: o, risk: r, confidence: c, interpretation: interpret(o, r, c), evidence: evidence(d, o, r, c, d.valuation?.scenarios) };
  }

  // Side-by-side comparison on independent dimensions; deliberately does not pick a winner.
  function compare(items) {
    const rows = items.map(x => ({ sym: x.sym, premium: x.valuation?.synthesis?.premium ?? null, status: x.valuation?.synthesis?.status, opportunity: x.decision?.opportunity.score, risk: x.decision?.risk.score,
      confidence: x.decision?.confidence.score, completeness: x.completeness, yield: x.isFinancial ? (x.eps / x.price) : (x.fcf / x.marketCap), hv: x.volatility?.hv252 }));
    const notes = [], by = (k, dir = 1) => [...rows].filter(r => fin(r[k])).sort((a, b) => dir * (b[k] - a[k]));
    const hiO = by('opportunity')[0], loC = by('confidence', -1)[0];
    if (hiO && loC && hiO.sym === loC.sym && rows.length > 1) notes.push(`${hiO.sym} has the highest opportunity score but the lowest confidence.`);
    const hiR = by('risk')[0]; if (hiO && hiR && hiO.sym === hiR.sym && rows.length > 1) notes.push(`${hiO.sym} also carries the highest risk score.`);
    const ch = by('premium', -1), rel = x => `${pct(Math.abs(x.premium))} ${x.premium < 0 ? 'below' : 'above'}`;
    if (ch.length > 1) notes.push(`Relative valuation: ${ch[0].sym} has the lowest price relative to its base estimate (${rel(ch[0])}); ${ch[ch.length - 1].sym} the highest (${rel(ch[ch.length - 1])}).`);
    const y = by('yield'); if (y.length > 1) notes.push(`Opportunity cost: choosing ${y[y.length - 1].sym} over ${y[0].sym} gives up ${pp(y[0].yield - y[y.length - 1].yield)} of current yield.`);
    const dq = by('completeness'); if (dq.length > 1 && dq[0].completeness - dq[dq.length - 1].completeness > 0.1) notes.push(`Data quality differs: ${dq[0].sym} ${pct(dq[0].completeness)} complete vs ${dq[dq.length - 1].sym} ${pct(dq[dq.length - 1].completeness)}.`);
    notes.push('No company is selected automatically. Higher scores in one dimension come with trade-offs in the others.');
    return { rows, notes };
  }

  return { combine, opportunity, risk, confidence, interpret, evidence, assess, compare, band };
});
