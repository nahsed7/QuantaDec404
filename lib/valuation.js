// Independent valuation models. Each returns its own conservative / base / optimistic value per share,
// with inputs, assumptions and limitations. Models are never averaged together; see synthesize().
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QVal = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin, r2 = x => fin(x) ? +x.toPrecision(4) : null;
  const ERP = 0.05;            // equity risk premium: assumption (long-run US estimates are roughly 4–6 %)
  const DEBT_SPREAD = 0.015;   // pre-tax cost of debt over the risk-free rate when it cannot be inferred: assumption

  // ---- defaults from data (every field is user-editable) ----
  function defaults(ctx) {
    const rows = ctx.rows || [], L = rows[rows.length - 1] || {}, f = ctx.fund || {}, b = ctx.bal || {};
    const last = k => rows.slice(-k);
    const pct = (num, den) => S.mean(last(5).map(x => fin(x[num]) && x[den] > 0 ? x[num] / x[den] : null));
    const beta = fin(ctx.beta) ? 0.67 * ctx.beta + 0.33 : 1;                 // Blume-adjusted
    const ke = ctx.rf + beta * ERP;
    const kdPre = fin(L.interest) && b.debt > 0 ? S.clamp(L.interest / b.debt, ctx.rf, ctx.rf + 0.06) : ctx.rf + DEBT_SPREAD;
    const tax = S.fin(S.median(last(5).map(x => x.taxRate))) ? S.median(last(5).map(x => x.taxRate)) : 0.21;
    const E = ctx.price * ctx.shares, D = fin(b.debt) ? b.debt : 0;
    const wacc = E > 0 ? (E * ke + D * kdPre * (1 - tax)) / (E + D) : ke;
    const g0 = fin(f.revGrowth3) ? f.revGrowth3 : fin(f.revGrowth1) ? f.revGrowth1 : 0.03;
    const growth = S.clamp(g0, -0.05, 0.20);
    const epsRows = last(3).map(x => x.eps).filter(fin);
    const ttm = ctx.epsTTM;
    return {
      revenue0: fin(L.revenue) ? L.revenue : null,
      growth, growthLo: growth - 0.05, growthHi: growth + 0.03,
      opMargin: fin(f.opMarginAvg) ? f.opMarginAvg : null,
      marginBand: Math.max(0.02, fin(f.opMarginStd) ? f.opMarginStd : 0),
      taxRate: tax,
      capexPct: fin(pct('capex', 'revenue')) ? pct('capex', 'revenue') : null,
      daPct: fin(pct('da', 'revenue')) ? pct('da', 'revenue') : 0,
      nwcPct: 0.05,                                       // working capital per $ of new revenue: assumption
      discountRate: wacc, discountBand: 0.01,
      costEquity: ke, beta, rf: ctx.rf, erp: ERP,
      terminalGrowth: Math.min(0.025, ctx.rf - 0.005), terminalLo: 0.015, terminalHi: 0.03,
      debt: D, cash: (fin(b.cash) ? b.cash : 0) + (fin(b.stInvest) ? b.stInvest : 0), shares: ctx.shares,
      eps: fin(ttm) ? ttm : epsRows.length ? epsRows[epsRows.length - 1] : null,
      epsNormal: epsRows.length ? S.mean(epsRows) : null,
      dps: ctx.dps, dpsGrowth: fin(ctx.dpsGrowth5) ? S.clamp(ctx.dpsGrowth5, -0.05, 0.10) : null,
    };
  }

  // ---- 1. discounted cash flow to the firm (two-stage, 10 years) ----
  function dcfValue(a) {
    const r = a.discountRate, gT = a.terminalGrowth;
    if (!(r > gT + 0.01)) return null;
    let rev = a.revenue0, pv = 0, fcff = 0, g = a.growth;
    // Net investment (capex − D&A) supports growth, so it scales down with growth: by year 10 it is in proportion gT / g.
    const netInv0 = a.capexPct - a.daPct, netInvT = a.growth > gT && netInv0 > 0 ? netInv0 * Math.max(0, gT) / a.growth : netInv0;
    for (let t = 1; t <= 10; t++) {
      const fade = t <= 5 ? 0 : (t - 5) / 5;
      g = a.growth + (gT - a.growth) * fade;                                // fade linearly to terminal growth in years 6–10
      const capexPct = a.daPct + netInv0 + (netInvT - netInv0) * fade;
      const prev = rev; rev *= 1 + g;
      fcff = rev * a.opMargin * (1 - a.taxRate) + rev * a.daPct - rev * capexPct - a.nwcPct * (rev - prev);
      pv += fcff / Math.pow(1 + r, t);
    }
    const tv = fcff * (1 + gT) / (r - gT), pvTV = tv / Math.pow(1 + r, 10);
    const equity = pv + pvTV - a.debt + a.cash;
    return { perShare: equity / a.shares, ev: pv + pvTV, pvTV, tvShare: pvTV / (pv + pvTV) };
  }
  function dcf(ctx, a) {
    const m = base('dcf', 'Discounted cash flow (FCFF)');
    if (ctx.isFinancial) return na(m, 'Not meaningful for banks, brokers and insurers: debt is operating capital, so free cash flow to the firm is undefined.');
    for (const k of ['revenue0', 'opMargin', 'capexPct', 'shares']) if (!fin(a[k])) return na(m, `Missing input: ${k}.`);
    if (a.opMargin <= 0) return na(m, 'Average operating margin is not positive; a constant-margin DCF would be meaningless.');
    const v = dcfValue(a); if (!v) return na(m, 'Discount rate must exceed terminal growth by at least 1 point.');
    // Monte Carlo over the stated assumption ranges (triangular distributions), seeded so results are reproducible.
    const u = S.rng(42), draws = [], N = a.mcDraws || 2000;
    for (let i = 0; i < N; i++) {
      const b = { ...a, growth: S.triangular(u(), a.growthLo, a.growth, a.growthHi), opMargin: Math.max(0.001, S.triangular(u(), a.opMargin - a.marginBand, a.opMargin, a.opMargin + a.marginBand)),
        discountRate: S.triangular(u(), a.discountRate - a.discountBand, a.discountRate, a.discountRate + a.discountBand), terminalGrowth: S.triangular(u(), a.terminalLo, a.terminalGrowth, a.terminalHi) };
      const x = dcfValue(b); if (x) draws.push(x.perShare);
    }
    m.base = v.perShare; [m.low, m.high] = S.quantiles(draws, [0.1, 0.9]);
    m.inputs = pick(a, ['revenue0', 'growth', 'opMargin', 'taxRate', 'capexPct', 'daPct', 'nwcPct', 'discountRate', 'terminalGrowth', 'debt', 'cash', 'shares']);
    m.detail = { terminalShareOfValue: r2(v.tvShare), draws: draws.length };
    m.assumptions = [`Revenue grows ${pctS(a.growth)} a year for 5 years, then fades to ${pctS(a.terminalGrowth)} by year 10.`,
      `Operating margin stays at ${pctS(a.opMargin)} (5-year average).`, `Discount rate (WACC) ${pctS(a.discountRate)}: risk-free ${pctS(a.rf)} + β ${a.beta.toFixed(2)} × ERP ${pctS(a.erp)} for equity, weighted with after-tax debt.`,
      `Capex ${pctS(a.capexPct)} and D&A ${pctS(a.daPct)} of revenue (5-year averages); net investment above D&A shrinks in proportion to growth in years 6–10; working capital ${pctS(a.nwcPct)} of new revenue.`,
      `Range = 10th–90th percentile of ${N} draws: growth ${pctS(a.growthLo)}…${pctS(a.growthHi)}, margin ±${pctS(a.marginBand)}, WACC ±${pctS(a.discountBand)}, terminal ${pctS(a.terminalLo)}…${pctS(a.terminalHi)}.`];
    m.limitations = ['Highly sensitive to the discount rate and terminal growth.', `The terminal value is ${pctS(v.tvShare)} of the total, so most value sits beyond year 10.`, 'Uses historical margins; a business in transition can break this.', 'Assumption ranges are judgement, not measured probabilities.'];
    m.sensitivity = tornado(a);
    return m;
  }
  function tornado(a) {
    const shocks = [['Revenue growth ±2 pts', 'growth', 0.02, 'add'], ['Operating margin ±2 pts', 'opMargin', 0.02, 'add'], ['Discount rate ±1 pt', 'discountRate', 0.01, 'add'],
      ['Terminal growth ±0.5 pt', 'terminalGrowth', 0.005, 'add'], ['Capex ±1 pt of revenue', 'capexPct', 0.01, 'add'], ['Debt ±20 %', 'debt', 0.2, 'mul'], ['Cash ±20 %', 'cash', 0.2, 'mul']];
    const b = dcfValue(a)?.perShare;
    return shocks.map(([label, k, d, mode]) => {
      const lo = dcfValue({ ...a, [k]: mode === 'add' ? a[k] - d : a[k] * (1 - d) })?.perShare, hi = dcfValue({ ...a, [k]: mode === 'add' ? a[k] + d : a[k] * (1 + d) })?.perShare;
      return { label, key: k, down: lo ?? null, up: hi ?? null, swing: fin(lo) && fin(hi) ? Math.abs(hi - lo) : null, base: b };
    }).sort((x, y) => (y.swing ?? -1) - (x.swing ?? -1));
  }

  // ---- 2. dividend discount (two-stage) ----
  function ddmValue(dps, g1, gT, ke) { if (!(ke > gT + 0.01)) return null; let pv = 0, d = dps; for (let t = 1; t <= 5; t++) { d *= 1 + g1; pv += d / Math.pow(1 + ke, t); } return pv + d * (1 + gT) / (ke - gT) / Math.pow(1 + ke, 5); }
  function ddm(ctx, a) {
    const m = base('ddm', 'Dividend discount (two-stage)');
    if (!(a.dps > 0)) return na(m, 'No regular cash dividend in the last 12 months.');
    const sustainable = fin(ctx.fund?.roe) && fin(ctx.fund?.payoutNI) ? ctx.fund.roe * (1 - S.clamp(ctx.fund.payoutNI, 0, 1)) : null;
    const g1 = S.clamp(fin(a.dpsGrowth) ? (fin(sustainable) ? Math.min(a.dpsGrowth, sustainable) : a.dpsGrowth) : (sustainable ?? 0.02), -0.05, 0.10);
    const v = ddmValue(a.dps, g1, a.terminalGrowth, a.costEquity); if (!fin(v)) return na(m, 'Cost of equity must exceed terminal growth by at least 1 point.');
    m.base = v; m.low = ddmValue(a.dps, g1 - 0.02, a.terminalLo, a.costEquity + 0.01); m.high = ddmValue(a.dps, g1 + 0.02, a.terminalHi, Math.max(a.costEquity - 0.01, a.terminalHi + 0.011));
    m.inputs = { dps: a.dps, growth5y: g1, terminalGrowth: a.terminalGrowth, costEquity: a.costEquity };
    m.assumptions = [`Dividend per share ${a.dps.toFixed(2)} (last 12 months) grows ${pctS(g1)} a year for 5 years (lower of the 5-year dividend growth and ROE × retention), then ${pctS(a.terminalGrowth)}.`,
      `Discounted at the cost of equity ${pctS(a.costEquity)}.`, 'Conservative: growth −2 pts, terminal 1.5 %, cost of equity +1 pt. Optimistic: growth +2 pts, terminal 3 %, cost of equity −1 pt.'];
    m.limitations = ['Ignores buybacks, so it undervalues companies that return cash mainly through repurchases.', 'Only meaningful for stable dividend payers.'];
    return m;
  }

  // ---- 3. comparable companies (sector peers within the tracked universe) ----
  function comps(ctx, a) {
    const m = base('comps', 'Comparable companies (sector multiples)');
    const peers = (ctx.peers || []).filter(p => p.sym !== ctx.sym);
    const own = { pe: a.eps, evEbit: ctx.rows?.at(-1)?.opIncome, evSales: ctx.rows?.at(-1)?.revenue, pb: ctx.bal?.equity, pfcf: ctx.rows?.at(-1)?.fcf };
    const res = [], mult = ctx.multipleShock || 1;
    const defs = ctx.isFinancial ? [['pe', 'P/E', 'perShare'], ['pb', 'P/B', 'equity']] : [['pe', 'P/E', 'perShare'], ['evEbit', 'EV/EBIT', 'ev'], ['evSales', 'EV/Sales', 'ev'], ['pfcf', 'P/FCF', 'equity']];
    for (const [k, label, kind] of defs) {
      const xs = peers.map(p => p[k]).filter(x => fin(x) && x > 0 && x < 200);
      if (xs.length < 3 || !(own[k] > 0)) continue;
      const toPrice = mlt => kind === 'perShare' ? mlt * mult * own[k] : kind === 'ev' ? (mlt * mult * own[k] - a.debt + a.cash) / a.shares : mlt * mult * own[k] / a.shares;
      res.push({ multiple: label, peers: xs.length, q25: S.quantile(xs, 0.25), median: S.median(xs), q75: S.quantile(xs, 0.75), low: toPrice(S.quantile(xs, 0.25)), base: toPrice(S.median(xs)), high: toPrice(S.quantile(xs, 0.75)) });
    }
    if (!res.length) return na(m, 'Fewer than 3 sector peers with usable multiples, or the company metric is not positive.');
    m.low = S.median(res.map(x => x.low)); m.base = S.median(res.map(x => x.base)); m.high = S.median(res.map(x => x.high));
    m.detail = { multiples: res };
    m.assumptions = [`Peers: other ${ctx.sector} companies in the tracked universe (${peers.length}).`, 'Conservative / base / optimistic = peer 25th percentile / median / 75th percentile multiple, then the median across multiples.'];
    m.limitations = ['Small peer group drawn only from this universe.', 'Relative: if the whole sector is mispriced, so is this estimate.', 'Peers differ in growth, risk and accounting.'];
    return m;
  }

  // ---- 4. earnings power value (no-growth, Greenwald) ----
  function epvValue(a, r) { const ebit = a.revenue0 * a.opMargin; return (ebit * (1 - a.taxRate) / r - a.debt + a.cash) / a.shares; }
  function earnings(ctx, a) {
    const m = base('epv', 'Earnings power value (no growth)');
    if (ctx.isFinancial) {
      if (!(a.epsNormal > 0)) return na(m, 'Normalised EPS is not positive.');
      m.base = a.epsNormal / a.costEquity; m.low = a.epsNormal / (a.costEquity + 0.01); m.high = a.epsNormal / Math.max(0.03, a.costEquity - 0.01);
      m.inputs = { epsNormal: a.epsNormal, costEquity: a.costEquity };
      m.assumptions = [`Normalised EPS ${a.epsNormal.toFixed(2)} (3-year average) earned forever with no growth, capitalised at the cost of equity ${pctS(a.costEquity)} ±1 pt.`];
    } else {
      for (const k of ['revenue0', 'opMargin', 'shares']) if (!fin(a[k])) return na(m, `Missing input: ${k}.`);
      if (a.opMargin <= 0) return na(m, 'Average operating margin is not positive.');
      m.base = epvValue(a, a.discountRate); m.low = epvValue(a, a.discountRate + 0.01); m.high = epvValue(a, Math.max(0.03, a.discountRate - 0.01));
      m.inputs = pick(a, ['revenue0', 'opMargin', 'taxRate', 'discountRate', 'debt', 'cash', 'shares']);
      m.assumptions = [`Current revenue × 5-year average operating margin ${pctS(a.opMargin)}, after ${pctS(a.taxRate)} tax, earned forever with no growth.`, `Capitalised at WACC ${pctS(a.discountRate)} ±1 pt, then net debt removed.`];
    }
    m.limitations = ['Assigns zero value to growth, so it is a floor for growing firms rather than a fair value.', 'Treats depreciation as equal to maintenance capex.'];
    return m;
  }

  // ---- 5. asset-based ----
  function assets(ctx, a) {
    const m = base('assets', ctx.isFinancial ? 'Book value / justified P/B' : 'Book value (reference)');
    const b = ctx.bal || {}; if (!(b.equity > 0) || !(a.shares > 0)) return na(m, 'Book equity is not positive or is missing.');
    const bv = b.equity / a.shares, tbv = (b.equity - (fin(b.goodwill) ? b.goodwill : 0) - (fin(b.intangibles) ? b.intangibles : 0)) / a.shares;
    m.inputs = { bookPerShare: bv, tangibleBookPerShare: tbv };
    if (ctx.isFinancial && fin(ctx.fund?.roe)) {
      const roe = ctx.fund.roe, g = a.terminalGrowth, ke = a.costEquity, pb = k => Math.max(0, (roe - g) / (k - g));
      m.base = bv * pb(ke); m.low = Math.max(0, tbv) * pb(ke + 0.01); m.high = bv * pb(Math.max(g + 0.011, ke - 0.01));
      m.inputs = { ...m.inputs, roe, costEquity: ke, growth: g };
      m.assumptions = [`Justified P/B = (ROE − g)/(cost of equity − g) with ROE ${pctS(roe)}, g ${pctS(g)}, cost of equity ${pctS(ke)} ±1 pt.`, 'Conservative case applies it to tangible book.'];
      m.limitations = ['Assumes the latest ROE persists.', 'Book values depend on loan-loss provisions and fair-value marks.'];
    } else {
      m.low = Math.max(0, tbv); m.base = bv; m.high = bv; m.reference = true;
      m.assumptions = ['Conservative = tangible book (excluding goodwill and intangibles); base = book equity per share.'];
      m.limitations = ['Ignores the earning power of the business; for most operating companies this is a floor, not a fair value.', 'Book values are historical cost.'];
    }
    return m;
  }

  // ---- 6. own valuation history ----
  function historical(ctx, a) {
    const m = base('hist', 'Own valuation history (P/E)');
    const h = (ctx.history || []).filter(x => fin(x.pe) && x.pe > 0 && x.pe < 200);
    if (h.length < 5) return na(m, `Only ${h.length} fiscal years with a positive P/E; at least 5 are needed.`);
    if (!(a.eps > 0)) return na(m, 'Current EPS is not positive.');
    const pes = h.map(x => x.pe), mult = ctx.multipleShock || 1;
    m.low = S.quantile(pes, 0.25) * a.eps * mult; m.base = S.median(pes) * a.eps * mult; m.high = S.quantile(pes, 0.75) * a.eps * mult;
    const cur = ctx.price / a.eps;
    m.detail = { currentPE: cur, percentile: S.percentileRank(pes, cur), years: h.length, series: h };
    m.inputs = { eps: a.eps, medianPE: S.median(pes) };
    m.assumptions = [`EPS ${a.eps.toFixed(2)} (${fin(ctx.epsTTM) ? 'last 4 reported quarters' : 'last fiscal year'}) × own P/E at fiscal year ends over ${h.length} years: 25th / median / 75th percentile.`];
    m.limitations = ['Assumes the past valuation regime still applies.', 'Year-end P/E is noisy when earnings are depressed or inflated.'];
    return m;
  }

  function base(id, name) { return { id, name, applicable: true, reason: null, low: null, base: null, high: null, inputs: {}, assumptions: [], limitations: [] }; }
  function na(m, reason) { return { ...m, applicable: false, reason }; }
  function pick(o, ks) { const r = {}; for (const k of ks) r[k] = o[k]; return r; }
  const pctS = x => fin(x) ? (100 * x).toFixed(1) + ' %' : 'n/a';

  function runAll(ctx, a) {
    a = a || defaults(ctx);
    const ms = [dcf(ctx, a), ddm(ctx, a), comps(ctx, a), earnings(ctx, a), assets(ctx, a), historical(ctx, a)];
    for (const m of ms) if (m.applicable && !(fin(m.base) && fin(m.low) && fin(m.high))) Object.assign(m, { applicable: false, reason: 'A required value could not be computed.' });
    for (const m of ms) if (m.applicable) { const lo = Math.min(m.low, m.base, m.high), hi = Math.max(m.low, m.base, m.high); m.low = lo; m.high = hi; }
    return ms;
  }

  // Combine without averaging: one primary model defines the range; the others are checks on it.
  function synthesize(models, price, opt = {}) {
    const ok = models.filter(m => m.applicable && m.base > 0);
    const order = opt.isFinancial ? ['assets', 'hist', 'comps', 'epv', 'ddm'] : ['dcf', 'hist', 'comps', 'ddm', 'epv'];
    // The dividend model leads only for companies that pay out most of their free cash flow as dividends.
    const eligible = m => !m.reference && (m.id !== 'ddm' || (S.fin(opt.fund?.payoutFCF) && opt.fund.payoutFCF >= 0.5));
    const primary = order.map(id => ok.find(m => m.id === id && eligible(m))).find(Boolean) || null;
    const out = { primary: primary?.id || null, price, low: primary?.low ?? null, base: primary?.base ?? null, high: primary?.high ?? null, models: ok.length, notes: [] };
    if (!primary) return { ...out, status: 'insufficient', premium: null, agreement: null, dispersion: null, notes: ['No applicable valuation model.'] };
    const others = ok.filter(m => m !== primary && !m.reference);
    out.agreement = others.length ? others.filter(m => m.base >= primary.low && m.base <= primary.high).length / others.length : null;
    const logs = ok.filter(m => !m.reference).map(m => Math.log(m.base));
    out.dispersion = logs.length >= 2 ? S.std(logs) : null;            // st. dev. of log model values: 0.5 ≈ models differ by ±65 %
    out.widthRatio = primary.low > 0 ? primary.high / primary.low : Infinity;
    out.premium = fin(price) ? price / primary.base - 1 : null;
    const tooWide = out.widthRatio > 2.5, disagree = out.dispersion != null && out.dispersion > 0.5 && others.length >= 2;
    if (tooWide) out.notes.push(`The primary range is very wide (high is ${out.widthRatio.toFixed(1)}× low).`);
    if (disagree) out.notes.push(`Models disagree strongly (log spread ${out.dispersion.toFixed(2)}).`);
    if (!others.length) out.notes.push('Only one model is applicable, so there is no cross-check.');
    out.status = !fin(price) ? 'insufficient' : (tooWide || disagree) ? 'uncertain' : price < primary.low ? 'below' : price > primary.high ? 'above' : 'within';
    return out;
  }

  // Named what-if scenarios. Each changes assumptions (or market multiples) and re-runs every model.
  const SCENARIOS = [
    ['Revenue growth −3 pts', a => ({ ...a, growth: a.growth - 0.03, growthLo: a.growthLo - 0.03, growthHi: a.growthHi - 0.03, dpsGrowth: fin(a.dpsGrowth) ? a.dpsGrowth - 0.03 : a.dpsGrowth })],
    ['Discount rates +1 pt', a => ({ ...a, discountRate: a.discountRate + 0.01, costEquity: a.costEquity + 0.01 })],
    ['Operating margin −3 pts', a => ({ ...a, opMargin: fin(a.opMargin) ? a.opMargin - 0.03 : a.opMargin })],
    ['Sector multiples −20 %', a => a, { multipleShock: 0.8 }],
    ['Debt +25 %', a => ({ ...a, debt: a.debt * 1.25 })],
    ['Earnings −15 %', a => ({ ...a, eps: fin(a.eps) ? a.eps * 0.85 : a.eps, epsNormal: fin(a.epsNormal) ? a.epsNormal * 0.85 : a.epsNormal, opMargin: fin(a.opMargin) ? a.opMargin * 0.85 : a.opMargin })],
    ['Terminal growth −1 pt', a => ({ ...a, terminalGrowth: a.terminalGrowth - 0.01, terminalLo: a.terminalLo - 0.01, terminalHi: a.terminalHi - 0.01 })],
  ];
  function scenarios(ctx, a) {
    const baseMs = runAll(ctx, a), baseSyn = synthesize(baseMs, ctx.price, ctx);
    const rows = SCENARIOS.map(([name, fn, extra]) => {
      // Fewer Monte Carlo draws here: scenarios report base values, and the range only sets the classification.
      const ms = runAll({ ...ctx, ...(extra || {}) }, { ...fn(a), mcDraws: 500 }), syn = synthesize(ms, ctx.price, ctx);
      const ch = {}; for (const m of ms) { const b0 = baseMs.find(x => x.id === m.id); ch[m.id] = m.applicable && b0?.applicable ? m.base / b0.base - 1 : null; }
      return { name, change: ch, primaryBase: syn.base, primaryChange: fin(syn.base) && fin(baseSyn.base) ? syn.base / baseSyn.base - 1 : null, status: syn.status, statusChanged: syn.status !== baseSyn.status };
    });
    return rows.sort((x, y) => Math.abs(y.primaryChange ?? 0) - Math.abs(x.primaryChange ?? 0));
  }

  return { ERP, defaults, dcf, dcfValue, ddm, ddmValue, comps, earnings, assets, historical, runAll, synthesize, scenarios, tornado, SCENARIOS };
});
