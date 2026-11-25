// Decision intelligence (Part 04): three independent scores (opportunity, risk, confidence) with traceable
// components, an uncertainty decomposition, score-level scenario effects and a comparison that never picks a winner.
//
// How a score is built (documented in docs/MODELS.md §6):
//  - Opportunity and risk components are percentile ranks within the tracked universe (0–100): scale-free, and a value
//    of 70 means "better (or riskier) than 70 % of tracked companies on this measure". Regime risk is absolute.
//  - Each component has a documented prior weight. Components whose signal family was tested out of sample (Part 05)
//    have that weight capped by the evidence: never increased, halved when the evidence is weak.
//  - Confidence components are absolute (0–100): data quality is not relative. A component that cannot be measured
//    counts as 0, because absence of evidence is not support.
//  - Scores are rounded to 5 points; finer precision would be false.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QDecision = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin, cl = x => S.clamp(x, 0, 100), pct = x => (100 * x).toFixed(0) + ' %', pp = x => (100 * x).toFixed(1) + ' %';

  // ---------- prior weights and their rationale ----------
  const PRIORS = {
    opportunity: {
      valuation: [2, 'Central thesis of the system: price relative to estimated value.'],
      momentum: [1, 'Documented cross-sectional anomaly at 3–12 month horizons; short-lived.'],
      quality: [1, 'Profitable, cash-generative firms have historically been safer to own; overlaps with valuation.'],
      relative: [0.5, 'Overlaps with momentum (same price data), so half weight.'],
      growth: [1, 'Growth prospects matter for value; uses the shrunk growth assumption, not raw history.'],
      catalyst: [0.5, 'Reported earnings change only (no analyst revisions); weak proxy, half weight.'],
      opportunityCost: [1, 'Yield over the local risk-free rate: what holding the stock pays versus a bond.'],
    },
    risk: {
      volatility: [1, 'Equal weights: no evidence here that one risk dominates.'], drawdown: [1, ''], valuationRisk: [1, ''], distress: [1, ''],
      liquidity: [0.5, 'The universe is large caps, so liquidity differences are small; half weight.'], concentration: [1, ''], model: [1, ''], regime: [1, ''],
    },
    confidence: {
      completeness: [2, 'Without the inputs there is no assessment.'], quality: [1, ''], freshness: [1, ''], agreement: [2, 'Independent models agreeing is the strongest internal check.'],
      modelConfidence: [1, ''], history: [1, ''], stability: [1, ''], sensitivity: [1, ''], oos: [1, ''], width: [1, ''], coverage: [1, ''],
    },
  };
  // Which validated signal family (Part 05) speaks to which opportunity component.
  const FAMILY = { valuation: 'engine', momentum: 'momentum', relative: 'momentum', opportunityCost: 'value' };

  // Evidence multiplier from out-of-sample results. Caps only: 1 at most.
  //  supported: walk-forward excess > 0.5 %/yr AND test result beats ≥ 75 % of random portfolios → 1
  //  weak:      walk-forward excess ≤ 0.5 %/yr OR test result beats < 50 % of random portfolios → 0.5
  //  otherwise 0.75; untested → 1 (flagged as untested).
  function evidenceMultiplier(ev) {
    if (!ev) return { k: 1, status: 'untested' };
    const wf = ev.walkForwardExcess, pr = ev.randomPercentileTest;
    if (!fin(wf) || !fin(pr)) return { k: 1, status: 'untested' };
    if (wf > 0.005 && pr >= 0.75) return { k: 1, status: 'supported' };
    if (wf <= 0.005 || pr < 0.5) return { k: 0.5, status: 'weak' };
    return { k: 0.75, status: 'mixed' };
  }

  // Weighted mean over the components that could be evaluated, rounded to 5 points.
  // minKnown: below this many measured components the score is withheld (null): a score built on one or two inputs
  // would claim more than the evidence supports.
  const MIN_KNOWN = 3;
  function combine(parts, missingAs = null, minKnown = 0) {
    if (missingAs != null) parts = parts.map(p => fin(p.score) ? p : { ...p, score: missingAs, missing: true, explain: (p.explain ? p.explain + ' ' : '') + '(Not measurable, counted as 0.)' });
    const known = parts.filter(p => fin(p.score) && !p.missing), all = parts.filter(p => fin(p.score));
    const W = S.sum(all.map(p => p.weight)), raw = W ? S.sum(all.map(p => p.score * p.weight)) / W : null;
    const withheld = known.length < minKnown;
    return { score: fin(raw) && !withheld ? Math.round(raw / 5) * 5 : null, raw: withheld ? null : raw, known: known.length, total: parts.length, parts,
      withheld: withheld ? `Only ${known.length} of ${parts.length} components could be measured (at least ${minKnown} needed).` : null };
  }

  // ---------- raw component values (no ranking yet), shared by every company so ranks are consistent ----------
  function raw(d) {
    const v = d.valuation?.synthesis, m = d.momentum, f = d.fund, vo = d.volatility, l = d.liquidity, a = d.valuation?.assumptions;
    const fcfYield = fin(d.fcf) && d.marketCap > 0 ? d.fcf / d.marketCap : null, eqYield = fin(d.eps) && d.price > 0 ? d.eps / d.price : null;
    const yld = d.isFinancial ? eqYield : (fcfYield ?? eqYield);
    const quality = S.mean([f?.fscore ? f.fscore.score / f.fscore.of : null, fin(f?.roic) ? S.clamp(f.roic / 0.3, -1, 1) : null, fin(f?.fcfMargin) ? S.clamp(f.fcfMargin / 0.3, -1, 1) : null]);
    const distress = d.isFinancial ? null : S.mean([fin(f?.debtToEbitda) ? S.clamp(f.debtToEbitda / 6, 0, 1) : null, fin(f?.interestCover) ? S.clamp(1 - f.interestCover / 15, 0, 1) : null,
      fin(f?.currentRatio) ? S.clamp(1.5 - f.currentRatio, 0, 1) : null, f?.fscore ? 1 - f.fscore.score / f.fscore.of : null]);
    const model = fin(v?.dispersion) || fin(v?.widthRatio) ? S.mean([fin(v.dispersion) ? v.dispersion : null, fin(v.widthRatio) && v.widthRatio < 50 ? Math.log(v.widthRatio) : null]) : null;
    return { premium: fin(v?.premium) ? Math.log(1 + v.premium) : null, mom: m?.mom12_1 ?? null, rel: m?.relSector63 ?? null, quality, growth: fin(a?.growth) && fin(a?.growthHist) ? a.growth : null,
      eps: fin(d.epsYoY) ? S.clamp(d.epsYoY, -1, 1) : null, carry: fin(yld) && fin(d.rf) ? yld - d.rf : null, yld,
      vol: vo?.hv252 ?? null, dd: vo?.maxDrawdown1y ?? null, distress, liq: fin(l?.addv) && l.addv > 0 ? -Math.log10(l.addv) : null, model };
  }
  // Universe arrays for ranking: { key: [values…] } from all dossiers.
  function universe(ds) { const u = {}; for (const d of ds) { const r = raw(d); for (const [k, x] of Object.entries(r)) if (fin(x)) (u[k] ||= []).push(x); } return u; }
  const rank = (u, k, x, higherBetter = true) => fin(x) && u?.[k]?.length >= 10 ? 100 * (higherBetter ? S.percentileRank(u[k], x) : 1 - S.percentileRank(u[k], x)) : null;

  const part = (key, group, name, score, explain, extra = {}) => {
    const [w0, why] = PRIORS[group][key];
    return { key, name, score: fin(score) ? cl(score) : null, weight: w0 * (extra.k ?? 1), priorWeight: w0, weightRationale: why, explain, ...extra };
  };

  function opportunity(d, ctx = {}) {
    const u = ctx.universe, r = raw(d), v = d.valuation?.synthesis, m = d.momentum, f = d.fund, ev = ctx.evidence || {};
    const ex = key => { const fam = FAMILY[key], e = fam ? ev[fam] : null, mlt = fam ? evidenceMultiplier(e) : { k: 1, status: 'not tested (no historical signal)' };
      return { k: mlt.k, evidence: fam ? { family: fam, status: mlt.status, testSharpe: e?.testSharpe ?? null, walkForwardExcess: e?.walkForwardExcess ?? null, randomPercentile: e?.randomPercentileTest ?? null, experiment: e?.experiment ?? null } : { status: mlt.status } }; };
    return combine([
      part('valuation', 'opportunity', 'Valuation', rank(u, 'premium', r.premium, false),
        fin(v?.premium) ? `Price is ${pct(Math.abs(v.premium))} ${v.premium < 0 ? 'below' : 'above'} the base estimate of the ${v.primary} model; ranked against the universe (cheaper = higher).` : 'No applicable valuation model.',
        { raw: v?.premium ?? null, source: 'valuation models (lib/valuation.js)', calc: 'percentile rank of −log(1 + premium)', ...ex('valuation') }),
      part('momentum', 'opportunity', 'Momentum (12−1 month)', rank(u, 'mom', r.mom),
        fin(m?.mom12_1) ? `12-month return excluding the last month is ${pp(m.mom12_1)}.` : 'Needs over a year of daily prices.',
        { raw: m?.mom12_1 ?? null, source: 'daily prices (Yahoo)', calc: 'percentile rank of P(t−21)/P(t−252) − 1', ...ex('momentum') }),
      part('quality', 'opportunity', 'Fundamental quality', rank(u, 'quality', r.quality),
        `Piotroski ${f?.fscore ? f.fscore.score + '/' + f.fscore.of : 'n/a'}, ROIC ${fin(f?.roic) ? pp(f.roic) : 'n/a'}, FCF margin ${fin(f?.fcfMargin) ? pp(f.fcfMargin) : 'n/a'}.`,
        { raw: r.quality, source: 'SEC filings', calc: 'percentile rank of mean(F-score/9, ROIC/30 %, FCF margin/30 %)', ...ex('quality') }),
      part('relative', 'opportunity', 'Relative performance (3 months vs sector)', rank(u, 'rel', r.rel),
        fin(m?.relSector63) ? `${pp(m.relSector63)} versus the sector-peer median.` : 'Not enough sector peers.',
        { raw: m?.relSector63 ?? null, source: 'daily prices', calc: 'percentile rank of 63-day return − sector median', ...ex('relative') }),
      part('growth', 'opportunity', 'Growth prospects', rank(u, 'growth', r.growth),
        fin(r.growth) ? `Assumed growth ${pp(r.growth)} a year for 5 years (history ${pp(d.valuation.assumptions.growthHist)}, shrunk toward the long-run rate). Not a forecast.` : 'Not enough revenue history.',
        { raw: r.growth, source: 'SEC filings → valuation defaults', calc: 'percentile rank of the shrunk growth assumption', ...ex('growth') }),
      part('catalyst', 'opportunity', 'Catalysts: latest reported earnings change', rank(u, 'eps', r.eps),
        fin(d.epsYoY) ? `Latest quarterly EPS ${pp(d.epsYoY)} versus a year earlier. Analyst revisions are not available.` : 'No comparable quarterly EPS (20-F filers report annually in XBRL).',
        { raw: d.epsYoY ?? null, source: 'SEC 10-Q', calc: 'percentile rank of quarterly EPS change (clamped ±100 %)', ...ex('catalyst') }),
      part('opportunityCost', 'opportunity', 'Opportunity cost (yield over risk-free)', rank(u, 'carry', r.carry),
        fin(r.carry) ? `${d.isFinancial || !(fin(d.fcf) && d.marketCap > 0) ? 'Earnings' : 'Free-cash-flow'} yield ${pp(r.yld)} versus ${pp(d.rf)} on the ${d.rfInfo?.label || '10-year Treasury'}${d.rfInfo?.fallback ? ' (no local-currency yield available)' : ''}.` : 'Yield unavailable.',
        { raw: r.carry, source: 'SEC filings, prices, government bond yields', calc: 'percentile rank of yield − risk-free', ...ex('opportunityCost') }),
    ], null, MIN_KNOWN);
  }

  function risk(d, ctx = {}) {
    const u = ctx.universe, r = raw(d), vo = d.volatility, f = d.fund, v = d.valuation?.synthesis, l = d.liquidity, regime = ctx.regime;
    const beta = fin(vo?.beta) ? vo.beta : null;
    // Regime risk (absolute): 50 × β × adversity, adversity = 1.5 in a bear trend, 0.8 in a bull trend, ×1.3 when volatility is high.
    const adverse = regime?.available ? (regime.trend === 'bear' ? 1.5 : regime.trend === 'bull' ? 0.8 : 1) * (regime.volatility.regime === 'high' ? 1.3 : 1) : null;
    return combine([
      part('volatility', 'risk', 'Volatility', rank(u, 'vol', r.vol), fin(vo?.hv252) ? `Annualised volatility ${pp(vo.hv252)} over 1 year.` : 'Not enough prices.',
        { raw: vo?.hv252 ?? null, source: 'daily prices', calc: 'percentile rank of 1-year σ (higher = riskier)' }),
      part('drawdown', 'risk', 'Drawdown exposure', rank(u, 'dd', r.dd), fin(vo?.maxDrawdown1y) ? `Worst fall in 1 year ${pp(vo.maxDrawdown1y)}; now ${pp(vo.currentDrawdown)} below the peak.` : '',
        { raw: vo?.maxDrawdown1y ?? null, source: 'daily prices', calc: 'percentile rank of 1-year max drawdown' }),
      part('valuationRisk', 'risk', 'Valuation risk', rank(u, 'premium', r.premium), fin(v?.premium) ? `Premium to base value ${pp(v.premium)}: the more the price exceeds estimated value, the further it can fall if the estimate is right.` : 'No valuation.',
        { raw: v?.premium ?? null, source: 'valuation models', calc: 'percentile rank of log(1 + premium)' }),
      part('distress', 'risk', 'Financial distress', rank(u, 'distress', r.distress), d.isFinancial ? 'Leverage ratios are not comparable for financial companies.' : `Debt/EBITDA ${fin(f?.debtToEbitda) ? f.debtToEbitda.toFixed(1) : 'n/a'}, interest cover ${fin(f?.interestCover) ? f.interestCover.toFixed(1) + '×' : 'n/a'}, current ratio ${fin(f?.currentRatio) ? f.currentRatio.toFixed(2) : 'n/a'}.`,
        { raw: r.distress, source: 'SEC filings', calc: 'percentile rank of mean(debt/EBITDA ÷ 6, 1 − cover ÷ 15, 1.5 − current ratio, 1 − F-score/9)' }),
      part('liquidity', 'risk', 'Liquidity risk', rank(u, 'liq', r.liq), fin(l?.addv) ? `Median daily traded value $${(l.addv / 1e6).toFixed(0)} M.` : '',
        { raw: l?.addv ?? null, source: 'daily volume × price, US$', calc: 'percentile rank of −log10(daily traded value)' }),
      part('concentration', 'risk', 'Concentration risk', fin(d.concentration) ? d.concentration : null, fin(d.concentration) ? (d.concentrationText || '') : 'No equity positions in the paper portfolio, so concentration cannot be assessed.',
        { raw: d.concentration ?? null, source: 'paper portfolio (Part 06)', calc: 'portfolio weight of the company and its sector after a hypothetical addition' }),
      part('model', 'risk', 'Model risk', rank(u, 'model', r.model), fin(v?.dispersion) ? `Spread between valuation models (log σ) ${v.dispersion.toFixed(2)}; primary range ×${fin(v.widthRatio) ? v.widthRatio.toFixed(2) : 'n/a'}.` : 'Only one model, so model risk cannot be measured.',
        { raw: r.model, source: 'valuation models', calc: 'percentile rank of mean(model log-dispersion, log range width)' }),
      part('regime', 'risk', 'Market regime risk', fin(beta) && fin(adverse) ? 50 * beta * adverse : null, fin(beta) && regime?.available ? `β ${beta.toFixed(2)} vs ${vo.betaVs || 'the market'} in a ${regime.trend} / ${regime.volatility.regime}-volatility regime.` : 'Regime or β unavailable.',
        { raw: beta, source: 'local index regime + β', calc: '50 × β × adversity (bear 1.5, bull 0.8; high volatility ×1.3), absolute' }),
    ], null, MIN_KNOWN);
  }

  function confidence(d, ctx = {}, cover) {
    const v = d.valuation?.synthesis, ms = d.valuation?.models || [], dcf = ms.find(m => m.id === 'dcf'), prim = ms.find(m => m.id === v?.primary);
    const fileAge = d.fresh?.filingAgeDays, priceAge = d.fresh?.priceAgeMin, ev = ctx.evidence || {};
    const worst = dcf?.applicable && dcf.sensitivity?.[0]?.swing > 0 ? dcf.sensitivity[0] : null;
    // Data quality: start at 100, subtract for each documented issue.
    const issues = [];
    if (d.sharesConflict) issues.push([35, 'share counts in the filings disagree']);
    if (d.restated?.revised) issues.push([Math.min(25, 5 * d.restated.revised), `${d.restated.revised} annual values were later restated`]);
    if (d.fresh?.stale?.length) issues.push([20, 'served from cache after a failed refresh']);
    if (d.rfInfo?.fallback) issues.push([10, 'no local-currency risk-free rate']);
    if ((d.dataNotes || []).some(n => /cover page/.test(n))) issues.push([10, 'share count from the cover page (not diluted)']);
    if (d.hasFilings === false) issues.push([60, 'no financial statements at all']);
    // Nothing to check means quality is unknown, not perfect.
    const quality = fin(d.completeness) && d.completeness > 0 ? Math.max(0, 100 - S.sum(issues.map(x => x[0]))) : null;
    // Historical performance and out-of-sample results of the signal families this assessment leans on (weighted by opportunity weight).
    const fams = Object.entries(FAMILY).map(([k, fam]) => [PRIORS.opportunity[k][0], ev[fam]]).filter(([, e]) => e);
    const histScore = fams.length ? S.sum(fams.map(([w, e]) => w * (fin(e.randomPercentileTest) ? 100 * e.randomPercentileTest : 50))) / S.sum(fams.map(([w]) => w)) : null;
    const oosScore = fams.length ? S.sum(fams.map(([w, e]) => w * (fin(e.walkForwardExcess) ? 50 + 50 * Math.tanh(e.walkForwardExcess / 0.05) : 50))) / S.sum(fams.map(([w]) => w)) : null;
    const famText = fams.length ? Object.entries(ev).filter(([k]) => Object.values(FAMILY).includes(k)).map(([k, e]) => `${e.label}: test Sharpe ${fin(e.testSharpe) ? e.testSharpe.toFixed(2) : 'n/a'}, beats ${fin(e.randomPercentileTest) ? pct(e.randomPercentileTest) : 'n/a'} of random portfolios, walk-forward excess ${fin(e.walkForwardExcess) ? pp(e.walkForwardExcess) : 'n/a'}/yr`).join('; ') : '';
    const lvl = { high: 85, medium: 55, low: 25 };
    return combine([
      part('completeness', 'confidence', 'Data completeness', fin(d.completeness) ? 100 * d.completeness : null, fin(d.completeness) ? `${pct(d.completeness)} of the required fields are present${d.missingFields?.length ? ` (missing: ${d.missingFields.join(', ')})` : ''}.` : '',
        { raw: d.completeness ?? null, source: 'SEC filings, prices', calc: '100 × share of required fields present' }),
      part('quality', 'confidence', 'Data quality', quality, issues.length ? `Issues: ${issues.map(x => x[1]).join('; ')}.` : 'No data-quality issue detected.',
        { raw: issues.length, source: 'data checks', calc: '100 − penalties (share conflict 35, restatements 5 each up to 25, stale cache 20, no local rate 10, cover-page shares 10, no statements 60)' }),
      part('freshness', 'confidence', 'Data freshness', fin(fileAge) ? S.mean([100 - 100 * Math.max(0, fileAge - 100) / 300, fin(priceAge) ? 100 - priceAge / 30 : null]) : null,
        fin(fileAge) ? `Latest filing ${fileAge.toFixed(0)} days old; price ${fin(priceAge) ? priceAge.toFixed(0) + ' min' : 'age unknown'}.` : '', { raw: fileAge ?? null, source: 'filing and quote timestamps', calc: 'filings lose 1 point per 3 days after 100 days; prices 1 point per 30 min' }),
      part('agreement', 'confidence', 'Agreement between models', fin(v?.dispersion) ? 100 - 150 * v.dispersion : null,
        fin(v?.agreement) ? `${pct(v.agreement)} of the other models fall inside the primary range; log spread ${v.dispersion?.toFixed(2)}.` : 'Fewer than two applicable models.', { raw: v?.dispersion ?? null, source: 'valuation models', calc: '100 − 150 × log-dispersion of model values' }),
      part('modelConfidence', 'confidence', 'Primary model confidence', prim?.confidence ? lvl[prim.confidence.level] : null, prim?.confidence ? `${prim.name}: ${prim.confidence.level} (${prim.confidence.reasons.join(' ')})` : 'No primary model.',
        { raw: prim?.confidence?.level ?? null, source: 'lib/valuation.js modelConfidence', calc: 'high 85, medium 55, low 25' }),
      part('history', 'confidence', 'Historical performance of the signals', histScore, fams.length ? `Out-of-sample test segment (Part 05): ${famText}.` : 'No validation experiment available yet.',
        { raw: histScore, source: 'validation experiment', calc: 'weighted mean of the test-segment percentile against random portfolios' }),
      part('stability', 'confidence', 'Stability of assumptions', fin(d.fund?.opMarginStd) ? 100 - 1000 * d.fund.opMarginStd : null,
        fin(d.fund?.opMarginStd) ? `Operating margin varied by ${pp(d.fund.opMarginStd)} (σ) over 5 years.` : '', { raw: d.fund?.opMarginStd ?? null, source: 'SEC filings', calc: '100 − 1000 × σ(operating margin)' }),
      part('sensitivity', 'confidence', 'Sensitivity to inputs', worst && worst.base > 0 ? 100 - 100 * worst.swing / worst.base : null,
        worst ? `"${worst.label}" alone moves the DCF value by ${pct(worst.swing / worst.base)} of base.` : 'No DCF sensitivity available.', { raw: worst ? worst.swing / worst.base : null, source: 'DCF tornado', calc: '100 − 100 × largest one-input swing ÷ base' }),
      part('oos', 'confidence', 'Out-of-sample validation', oosScore, fams.length ? 'Walk-forward results (parameters chosen without hindsight): ' + famText + '.' : 'No walk-forward result yet.',
        { raw: oosScore, source: 'validation experiment', calc: '50 + 50 × tanh(walk-forward excess ÷ 5 %/yr), weighted' }),
      part('width', 'confidence', 'Width of valuation range', fin(v?.widthRatio) && v.widthRatio < 50 ? 100 - 50 * (v.widthRatio - 1) : null,
        fin(v?.widthRatio) ? `Primary model range spans ${v.widthRatio.toFixed(2)}× from low to high.` : 'No valuation range.', { raw: v?.widthRatio ?? null, source: 'valuation models', calc: '100 − 50 × (high ÷ low − 1)' }),
      part('coverage', 'confidence', 'Coverage of the other scores', fin(cover) ? 100 * cover : null, fin(cover) ? `${pct(cover)} of the opportunity and risk components could be evaluated.` : '',
        { raw: cover ?? null, source: 'this engine', calc: '100 × share of opportunity and risk components measured' }),
    ], 0);
  }

  // Bands: ≥ 65 high, ≤ 40 low (so the brief's example, confidence 38, reads as low), otherwise moderate.
  const band = s => !fin(s) ? 'unknown' : s >= 65 ? 'high' : s <= 40 ? 'low' : 'moderate';
  function interpret(o, r, c) {
    const O = band(o.score), R = band(r.score), C = band(c.score);
    if (o.withheld && r.withheld) return 'Not assessable: too few measurable inputs. This is a research summary, not a recommendation to buy or sell.';
    const head = O === 'high' ? 'Potentially attractive' : O === 'low' ? 'Unattractive on these measures' : O === 'unknown' ? 'Not assessable' : 'Mixed';
    const rk = R === 'high' ? 'with high risk' : R === 'low' ? 'with low measured risk' : R === 'unknown' ? '' : 'with moderate risk';
    const cf = C === 'low' ? 'and low confidence: treat the assessment as highly uncertain' : C === 'high' ? 'and reasonably well-supported evidence' : C === 'unknown' ? '' : 'and moderate confidence';
    return `${head} ${rk} ${cf}. This is a research summary, not a recommendation to buy or sell.`.replace(/\s+/g, ' ');
  }

  // Catalyst calendar: estimated, never announced, dates.
  function catalysts(d) {
    const out = [], DAY = 864e5, now = Date.now();
    const q = d.qEPS || [];
    if (q.length >= 4) {
      const lags = q.slice(-4).map(x => (x.filed - Date.parse(x.end)) / DAY).filter(x => x > 0 && x < 120), lag = S.median(lags) ?? 40;
      let end = Date.parse(q.at(-1).end); while (end + lag * DAY < now) end += 91.3 * DAY;
      out.push({ kind: 'earnings', date: new Date(end + lag * DAY).toISOString().slice(0, 10), text: `Next quarterly report expected around ${new Date(end + lag * DAY).toISOString().slice(0, 10)} (estimated from the last four filing lags, median ${Math.round(lag)} days after quarter end; not an announced date).` });
    } else if (d.rows?.length && d.rows.at(-1)?._filed) {
      const L = d.rows.at(-1), lag = (L._filed - Date.parse(L.end)) / DAY; let end = Date.parse(L.end); while (end + lag * DAY < now) end += 365.25 * DAY;
      out.push({ kind: 'earnings', date: new Date(end + lag * DAY).toISOString().slice(0, 10), text: `Next annual report expected around ${new Date(end + lag * DAY).toISOString().slice(0, 10)} (estimated from the last filing lag; interim reports are not in XBRL).` });
    }
    const dv = (d.div || []).slice(-8);
    if (dv.length >= 3) {
      const gaps = dv.slice(1).map((x, i) => (x.t - dv[i].t) / DAY), gap = S.median(gaps); let t = dv.at(-1).t; while (t < now) t += gap * DAY;
      out.push({ kind: 'dividend', date: new Date(t).toISOString().slice(0, 10), text: `Next ex-dividend date around ${new Date(t).toISOString().slice(0, 10)} (every ~${Math.round(gap)} days in the past; estimated).` });
    }
    if (fin(d.epsYoY) && Math.abs(d.epsYoY) > 0.2) out.push({ kind: 'reported', text: `Latest reported quarterly EPS changed ${pp(d.epsYoY)} year on year.` });
    return out;
  }

  // Uncertainty decomposition.
  function evidence(d, o, r, c, scen) {
    const sup = [], con = [], unk = [], alt = [], fail = [];
    for (const p of o.parts) { if (!fin(p.score)) unk.push(`${p.name}: ${p.explain}`); else if (p.score >= 65) sup.push(`${p.name}: ${p.explain}`); else if (p.score <= 35) con.push(`${p.name}: ${p.explain}`); }
    for (const p of o.parts) if (p.evidence?.status === 'weak') con.push(`${p.name} carries half weight: its signal family did poorly out of sample (${p.evidence.family}).`);
    for (const p of r.parts) { if (!fin(p.score)) unk.push(`${p.name}: ${p.explain}`); else if (p.score >= 65) con.push(`${p.name} is high: ${p.explain}`); }
    for (const p of c.parts) if (p.missing) unk.push(`${p.name}: ${p.explain}`); else if (fin(p.score) && p.score <= 35) con.push(`Low confidence from ${p.name.toLowerCase()}: ${p.explain}`);
    for (const fl of d.fund?.flags || []) con.push(`Fundamental flag: ${fl}`);
    if (d.exhaustion?.available) for (const s of d.exhaustion.signals) (d.exhaustion.direction === 'up' ? con : sup).push(`Exhaustion signal (${d.exhaustion.direction}trend): ${s}`);
    const st = d.valuation?.synthesis;
    for (const n of st?.notes || []) con.push(`Valuation: ${n}`);
    for (const x of (st?.disagreements || []).filter(x => !x.overlap && !x.reference)) con.push(`Model disagreement: ${x.name} puts value at ${pct(Math.abs(x.vsPrimary))} ${x.vsPrimary < 0 ? 'below' : 'above'} the primary model, with no overlap in ranges.`);
    for (const m of d.valuation?.models || []) if (!m.applicable) unk.push(`${m.name}: ${m.reason}`);
    unk.push('Analyst estimates and revisions: no free source, so not included.', 'News, guidance and management commentary: not ingested.', 'Quoted bid/ask and order-book depth for equities: not available from the free feeds (spread is estimated).');
    const prem = st?.premium, mom = d.momentum?.mom12_1;
    if (fin(prem) && prem < -0.2 && fin(mom) && mom < -0.1) alt.push('Value trap: the market may be pricing a deterioration that has not reached the reported numbers yet.');
    if (fin(prem) && prem > 0.2 && fin(d.fund?.revGrowth3) && d.fund.revGrowth3 > 0.1) alt.push('The premium may reflect growth or margin expansion that a model built on historical averages cannot capture.');
    if (fin(d.fund?.accruals) && d.fund.accruals > 0.05) alt.push('Reported earnings may be flattered by accruals; cash flow is weaker than net income.');
    if (d.exhaustion?.count >= 2) alt.push('The recent move may reflect news or flows rather than a change in value; such moves can extend further or reverse.');
    if (d.isFinancial) alt.push('For financial firms, book values depend on loan-loss and fair-value assumptions that outsiders cannot verify.');
    if (d.region === 'International') alt.push('Accounting standard (IFRS vs US GAAP) and currency differences can make peer multiples look cheaper or dearer than they are.');
    alt.push('Being cheap or expensive relative to a model does not imply the price will move toward it within any horizon.');
    for (const s of scen || []) if (s.statusChanged) fail.push(`${s.name}: the primary value changes by ${fin(s.primaryChange) ? pct(s.primaryChange) : 'n/a'} and the classification becomes "${s.status}".`);
    for (const s of scen || []) if (s.scoreChange && Math.abs(s.scoreChange.opportunity ?? 0) >= 10) fail.push(`${s.name}: the opportunity score moves ${s.scoreChange.opportunity > 0 ? '+' : ''}${s.scoreChange.opportunity} points.`);
    const prim = d.valuation?.models?.find(m => m.id === st?.primary);
    const swing = (d.valuation?.models?.find(m => m.id === 'dcf')?.sensitivity || []).slice(0, 3).filter(t => fin(t.swing)).map(t => `${t.label}: value ${t.down?.toFixed(2)} … ${t.up?.toFixed(2)}`);
    return { supporting: sup, contradicting: con, unknown: unk, assumptions: [...(prim?.assumptions || []), `Equity risk premium ${(100 * (d.erp ?? 0.05)).toFixed(1)} % (judgement).`, 'Score weights are documented priors, capped by out-of-sample evidence (see each score\'s table).'],
      swingVariables: swing, alternatives: alt, failureConditions: fail.length ? fail : ['No single tested scenario changes the classification or moves the opportunity score by 10 points. Combined shocks still could.'],
      limitations: [...(prim?.limitations || []), 'Composite scores cannot be rebuilt historically (too many inputs lack point-in-time history); only their validated signal families are calibrated.'], catalysts: catalysts(d) };
  }

  // Score effects of the valuation scenarios: rerun opportunity and risk with the scenario's primary value.
  function scenarioScores(d, ctx, o0, r0) {
    const v = d.valuation?.synthesis; if (!fin(v?.base) || !fin(d.price)) return d.valuation?.scenarios || [];
    return (d.valuation?.scenarios || []).map(s => {
      if (!fin(s.primaryBase) || !(s.primaryBase > 0)) return { ...s, scoreChange: null };
      const alt = { ...d, valuation: { ...d.valuation, synthesis: { ...v, base: s.primaryBase, premium: d.price / s.primaryBase - 1 } } };
      const o = opportunity(alt, ctx), r = risk(alt, ctx);
      return { ...s, scoreChange: { opportunity: fin(o.score) && fin(o0.score) ? o.score - o0.score : null, risk: fin(r.score) && fin(r0.score) ? r.score - r0.score : null } };
    }).sort((a, b) => Math.abs(b.scoreChange?.opportunity ?? 0) + Math.abs(b.scoreChange?.risk ?? 0) - Math.abs(a.scoreChange?.opportunity ?? 0) - Math.abs(a.scoreChange?.risk ?? 0) || Math.abs(b.primaryChange ?? 0) - Math.abs(a.primaryChange ?? 0));
  }

  // ctx: { universe (from universe()), regime, evidence (validation evidence per family) }
  function assess(d, ctx = {}) {
    const o = opportunity(d, ctx), r = risk(d, ctx), c = confidence(d, ctx, (o.known + r.known) / (o.total + r.total));
    const scen = scenarioScores(d, ctx, o, r);
    return { opportunity: o, risk: r, confidence: c, interpretation: interpret(o, r, c), evidence: evidence(d, o, r, c, scen), scenarios: scen,
      method: 'Opportunity and risk: universe percentile ranks; weights = documented priors capped by out-of-sample evidence. Confidence: absolute; unmeasurable parts count as 0. Rounded to 5 points.' };
  }

  // Side-by-side comparison on independent dimensions; deliberately does not pick a winner.
  // items: company objects (with daily [[t, c, …]] for correlation).
  function compare(items) {
    const rows = items.map(x => ({ sym: x.sym, premium: x.valuation?.synthesis?.premium ?? null, status: x.valuation?.synthesis?.status, opportunity: x.decision?.opportunity.score, risk: x.decision?.risk.score,
      confidence: x.decision?.confidence.score, completeness: x.completeness, yield: x.isFinancial ? (x.eps / x.price) : (x.fcf / x.marketCap), hv: x.volatility?.hv252, rf: x.rf, addv: x.liquidity?.addv }));
    const notes = [], by = (k, dir = 1) => [...rows].filter(r => fin(r[k])).sort((a, b) => dir * (b[k] - a[k]));
    const hiO = by('opportunity')[0], loC = by('confidence', -1)[0], hiR = by('risk')[0];
    if (hiO && loC && hiO.sym === loC.sym && rows.length > 1) notes.push(`${hiO.sym} has the highest opportunity score but the lowest confidence.`);
    if (hiO && hiR && hiO.sym === hiR.sym && rows.length > 1) notes.push(`${hiO.sym} also carries the highest risk score.`);
    const ch = by('premium', -1), rel = x => `${pct(Math.abs(x.premium))} ${x.premium < 0 ? 'below' : 'above'}`;
    if (ch.length > 1) notes.push(`Relative valuation: ${ch[0].sym} has the lowest price relative to its base estimate (${rel(ch[0])}); ${ch[ch.length - 1].sym} the highest (${rel(ch[ch.length - 1])}).`);
    const rk = by('risk'); if (rk.length > 1) notes.push(`Relative risk: ${rk[0].sym} scores ${rk[0].risk} vs ${rk[rk.length - 1].sym} ${rk[rk.length - 1].risk} (volatility ${pp(rk[0].hv ?? NaN)} vs ${pp(rk[rk.length - 1].hv ?? NaN)}).`);
    const cf = by('confidence'); if (cf.length > 1 && cf[0].confidence - cf[cf.length - 1].confidence >= 15) notes.push(`Confidence differs: ${cf[0].sym} ${cf[0].confidence} vs ${cf[cf.length - 1].sym} ${cf[cf.length - 1].confidence}; the lower-confidence assessment deserves less weight.`);
    const y = by('yield'); if (y.length > 1) notes.push(`Opportunity cost: choosing ${y[y.length - 1].sym} over ${y[0].sym} gives up ${pp(y[0].yield - y[y.length - 1].yield)} of current yield.`);
    for (const r of rows) if (fin(r.yield) && fin(r.rf) && r.yield < r.rf) notes.push(`${r.sym} yields ${pp(r.yield)}, less than its risk-free rate ${pp(r.rf)}: the bond pays more today, so the case rests on growth.`);
    const dq = by('completeness'); if (dq.length > 1 && dq[0].completeness - dq[dq.length - 1].completeness > 0.1) notes.push(`Data quality differs: ${dq[0].sym} ${pct(dq[0].completeness)} complete vs ${dq[dq.length - 1].sym} ${pct(dq[dq.length - 1].completeness)}.`);
    // Correlation of daily returns over the last year of common dates (diversification between the candidates).
    const corr = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i].daily || [], b = items[j].daily || [], mb = new Map(b.map(x => [new Date(x[0]).toISOString().slice(0, 10), x[1]])), xs = [], ys = [];
      let pa = null, pb = null; for (const x of a.slice(-300)) { const k = new Date(x[0]).toISOString().slice(0, 10), vb = mb.get(k); if (vb == null) continue; if (pa != null) { xs.push(Math.log(x[1] / pa)); ys.push(Math.log(vb / pb)); } pa = x[1]; pb = vb; }
      const c = xs.length > 60 ? S.corr(xs, ys) : null; corr.push({ a: items[i].sym, b: items[j].sym, corr: c, days: xs.length });
      if (fin(c) && c > 0.7) notes.push(`${items[i].sym} and ${items[j].sym} move closely together (daily correlation ${c.toFixed(2)}): holding both diversifies little.`);
    }
    notes.push('No company is selected automatically. Higher scores in one dimension come with trade-offs in the others.');
    return { rows, notes, correlations: corr };
  }

  return { MIN_KNOWN, PRIORS, FAMILY, evidenceMultiplier, combine, raw, universe, opportunity, risk, confidence, interpret, evidence, catalysts, scenarioScores, assess, compare, band };
});
