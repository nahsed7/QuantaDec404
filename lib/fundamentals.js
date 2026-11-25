// Financial statements from SEC EDGAR XBRL "companyfacts", and the fundamental ratios built on them.
// Values are as reported in 10-K / 10-Q filings. Nothing is estimated here except where a ratio says so.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QFund = factory(root.QStats);
})(this, function (S) {
  'use strict';

  // Each field lists XBRL tags in priority order; a company may switch tags between years, so all are merged.
  const TAGS = {
    revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense'],
    grossProfit: ['GrossProfit'],
    opIncome: ['OperatingIncomeLoss'],
    pretax: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
    tax: ['IncomeTaxExpenseBenefit'],
    netIncome: ['NetIncomeLoss', 'ProfitLoss'],
    eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
    ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
    da: ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization'],
    interest: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'],
    divPaid: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
    buyback: ['PaymentsForRepurchaseOfCommonStock'],
    sbc: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
    dilShares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic'],
    assets: ['Assets'],
    liabilities: ['Liabilities'],
    curAssets: ['AssetsCurrent'],
    curLiab: ['LiabilitiesCurrent'],
    equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'CashAndDueFromBanks'],
    stInvest: ['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'],
    ltDebt: ['LongTermDebtNoncurrent', 'LongTermDebt'],
    stDebt: ['LongTermDebtCurrent', 'DebtCurrent', 'ShortTermBorrowings', 'CommercialPaper'],
    goodwill: ['Goodwill'],
    intangibles: ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet'],
    sharesOut: ['dei:EntityCommonStockSharesOutstanding'],
  };
  const INSTANT = new Set(['assets', 'liabilities', 'curAssets', 'curLiab', 'equity', 'cash', 'stInvest', 'ltDebt', 'stDebt', 'goodwill', 'intangibles', 'sharesOut']);
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

  // Reduce a raw companyfacts JSON to just the tags above (keeps the cache small).
  function compact(cf) {
    const out = { cik: cf.cik, name: cf.entityName, facts: {} };
    for (const tags of Object.values(TAGS)) for (const t of tags) {
      const [ns, tag] = t.includes(':') ? t.split(':') : ['us-gaap', t];
      const f = cf.facts?.[ns]?.[tag]; if (!f) continue;
      const unit = Object.keys(f.units)[0];
      out.facts[t] = { unit, v: f.units[unit].filter(x => /^10-[KQ]/.test(x.form)).map(x => [x.start || null, x.end, x.val, x.form, x.filed, x.fp]) };
    }
    return out;
  }

  // Annual rows keyed by fiscal-year end date. Durations must be ~1 year from a 10-K; restated values (later filings) win.
  function annual(cf) {
    const byEnd = new Map(), src = {};
    for (const [field, tags] of Object.entries(TAGS)) {
      if (field === 'sharesOut') continue;
      const best = new Map();                                   // end → [val, filed, tagRank]
      tags.forEach((t, rank) => {
        for (const [start, end, val, form, filed] of cf.facts[t]?.v || []) {
          if (!/^10-K/.test(form)) continue;
          if (!INSTANT.has(field) && !(start && days(start, end) > 330 && days(start, end) < 380)) continue;
          const cur = best.get(end);
          if (!cur || rank < cur[2] || (rank === cur[2] && filed > cur[1])) best.set(end, [val, filed, rank, t]);
        }
      });
      for (const [end, [val, filed, , t]] of best) { if (!byEnd.has(end)) byEnd.set(end, { end }); byEnd.get(end)[field] = val; (byEnd.get(end)._f ||= {})[field] = Date.parse(filed); (src[field] ||= new Set()).add(t); byEnd.get(end)._filed = Math.max(byEnd.get(end)._filed || 0, Date.parse(filed)); }
    }
    // Fiscal years are the period ends that carry an income-statement value.
    const rows = [...byEnd.values()].filter(r => S.fin(r.revenue) || S.fin(r.netIncome)).sort((a, b) => a.end.localeCompare(b.end));
    for (const r of rows) {
      r.fcf = S.fin(r.ocf) && S.fin(r.capex) ? r.ocf - r.capex : null;
      r.debt = (S.fin(r.ltDebt) ? r.ltDebt : 0) + (S.fin(r.stDebt) ? r.stDebt : 0);
      if (!S.fin(r.ltDebt) && !S.fin(r.stDebt)) r.debt = null;
      r.taxRate = S.fin(r.tax) && S.fin(r.pretax) && r.pretax > 0 ? S.clamp(r.tax / r.pretax, 0, 0.5) : null;
    }
    return { rows: rows.slice(-15), tagsUsed: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, [...v]])) };
  }

  // Latest balance-sheet values (from the newest 10-Q or 10-K) and the latest share count.
  function latest(cf) {
    const out = { asOf: {} };
    for (const field of INSTANT) for (const t of TAGS[field]) {
      let best = null; for (const [, end, val, , filed] of cf.facts[t]?.v || []) if (!best || end > best[0] || (end === best[0] && filed > best[2])) best = [end, val, filed];
      if (best && (!out.asOf[field] || best[0] > out.asOf[field])) { out[field] = best[1]; out.asOf[field] = best[0]; }
    }
    // Latest quarterly diluted share count (10-Q, ~3-month duration) is more current than the 10-K one.
    let q = null; for (const [start, end, val, form, filed] of cf.facts.WeightedAverageNumberOfDilutedSharesOutstanding?.v || [])
      if (start && days(start, end) < 100 && (!q || end > q[0] || (end === q[0] && filed > q[2]))) q = [end, val, filed, form];
    if (q) { out.dilShares = q[1]; out.asOf.dilShares = q[0]; }
    out.debt = (S.fin(out.ltDebt) ? out.ltDebt : 0) + (S.fin(out.stDebt) ? out.stDebt : 0);
    if (!S.fin(out.ltDebt) && !S.fin(out.stDebt)) out.debt = null;
    let filed = 0; for (const t of Object.values(cf.facts)) for (const x of t.v) filed = Math.max(filed, Date.parse(x[4]));
    out.lastFiled = filed ? new Date(filed).toISOString().slice(0, 10) : null;
    return out;
  }

  // Quarterly diluted EPS (3-month periods) for a reported-earnings trend. Not analyst revisions.
  function quarterlyEPS(cf) {
    const m = new Map();
    for (const t of TAGS.eps) for (const [start, end, val, , filed] of cf.facts[t]?.v || []) {
      if (!start || days(start, end) > 100 || days(start, end) < 80) continue;
      const c = m.get(end); if (!c || filed > c[1]) m.set(end, [val, filed, start]);
    }
    return [...m].map(([end, [v, filed, start]]) => ({ start, end, eps: v, filed: Date.parse(filed) })).sort((a, b) => a.end.localeCompare(b.end)).slice(-12);
  }

  // Ratios and quality indicators from annual rows (most recent last). Every output says what it needs.
  function analyse(rows, bal, price) {
    const L = rows[rows.length - 1], P = rows[rows.length - 2], n = rows.length, r = {}, flags = [];
    const yrs = k => rows.slice(-k);
    const g = (f, k) => { const a = yrs(k + 1); return a.length === k + 1 ? S.cagr(a[0][f], a[k][f], k) : null; };
    r.revGrowth1 = L && P && S.fin(L.revenue) && P.revenue > 0 ? L.revenue / P.revenue - 1 : null;
    r.revGrowth3 = g('revenue', 3); r.revGrowth5 = g('revenue', 5);
    r.grossMargin = L && S.fin(L.grossProfit) && L.revenue > 0 ? L.grossProfit / L.revenue : null;
    r.opMargin = L && S.fin(L.opIncome) && L.revenue > 0 ? L.opIncome / L.revenue : null;
    r.netMargin = L && S.fin(L.netIncome) && L.revenue > 0 ? L.netIncome / L.revenue : null;
    r.opMarginAvg = S.mean(yrs(5).map(x => S.fin(x.opIncome) && x.revenue > 0 ? x.opIncome / x.revenue : null));
    r.opMarginStd = S.std(yrs(5).map(x => S.fin(x.opIncome) && x.revenue > 0 ? x.opIncome / x.revenue : null));
    r.fcfMargin = L && S.fin(L.fcf) && L.revenue > 0 ? L.fcf / L.revenue : null;
    r.fcfConversion = L && S.fin(L.fcf) && L.netIncome > 0 ? L.fcf / L.netIncome : null;
    // Sloan accruals: (net income − operating cash flow) / average total assets. High positive = weaker earnings quality.
    r.accruals = L && P && S.fin(L.netIncome) && S.fin(L.ocf) && L.assets > 0 && P.assets > 0 ? (L.netIncome - L.ocf) / ((L.assets + P.assets) / 2) : null;
    const tax = S.fin(L?.taxRate) ? L.taxRate : 0.21;
    const ic = L && S.fin(L.equity) ? L.equity + (S.fin(L.debt) ? L.debt : 0) - (S.fin(L.cash) ? L.cash : 0) : null;
    r.roic = L && S.fin(L.opIncome) && ic > 0 ? L.opIncome * (1 - tax) / ic : null;
    r.roe = L && S.fin(L.netIncome) && L.equity > 0 ? L.netIncome / L.equity : null;
    r.currentRatio = S.fin(bal.curAssets) && bal.curLiab > 0 ? bal.curAssets / bal.curLiab : null;
    const ebitda = L && S.fin(L.opIncome) ? L.opIncome + (S.fin(L.da) ? L.da : 0) : null;
    r.debtToEbitda = S.fin(bal.debt) && ebitda > 0 ? bal.debt / ebitda : null;
    r.netDebt = S.fin(bal.debt) ? bal.debt - (S.fin(bal.cash) ? bal.cash : 0) - (S.fin(bal.stInvest) ? bal.stInvest : 0) : null;
    r.debtToEquity = S.fin(bal.debt) && bal.equity > 0 ? bal.debt / bal.equity : null;
    r.interestCover = L && S.fin(L.opIncome) && L.interest > 0 ? L.opIncome / L.interest : null;
    const sh = yrs(4).map(x => x.dilShares);
    r.dilution3 = sh.length === 4 && sh[0] > 0 && sh[3] > 0 ? Math.pow(sh[3] / sh[0], 1 / 3) - 1 : null;
    r.sbcToRevenue = L && S.fin(L.sbc) && L.revenue > 0 ? L.sbc / L.revenue : null;
    r.payoutFCF = L && S.fin(L.divPaid) && L.fcf > 0 ? L.divPaid / L.fcf : null;
    r.payoutNI = L && S.fin(L.divPaid) && L.netIncome > 0 ? L.divPaid / L.netIncome : null;
    r.fscore = piotroski(L, P);
    // Deterioration indicators: each is a plain comparison of the last two fiscal years.
    if (L && P) {
      if (S.fin(L.revenue) && S.fin(P.revenue) && L.revenue < P.revenue) flags.push('Revenue fell year on year');
      if (r.opMargin != null && P.revenue > 0 && S.fin(P.opIncome) && r.opMargin < P.opIncome / P.revenue - 0.02) flags.push('Operating margin fell by more than 2 points');
      if (S.fin(L.fcf) && L.fcf < 0) flags.push('Negative free cash flow');
      if (r.accruals != null && r.accruals > 0.08) flags.push('High accruals (earnings well above cash flow)');
      if (r.interestCover != null && r.interestCover < 3) flags.push('Interest cover below 3×');
      if (r.dilution3 != null && r.dilution3 > 0.02) flags.push('Share count growing over 2% a year');
      if (r.payoutFCF != null && r.payoutFCF > 1) flags.push('Dividends exceed free cash flow');
      if (r.currentRatio != null && r.currentRatio < 0.8) flags.push('Current ratio below 0.8');
    }
    r.flags = flags; r.years = n; r.lastFY = L?.end || null;
    return r;
  }

  // Piotroski F-score (0–9) from two fiscal years; returns null if fewer than 7 of the 9 tests can be evaluated.
  function piotroski(L, P) {
    if (!L || !P) return null;
    const t = [], ok = (c) => t.push(c);
    const roa = x => S.fin(x.netIncome) && x.assets > 0 ? x.netIncome / x.assets : null;
    const add = (cond) => ok(cond == null ? null : cond ? 1 : 0);
    add(roa(L) == null ? null : roa(L) > 0);
    add(S.fin(L.ocf) ? L.ocf > 0 : null);
    add(roa(L) != null && roa(P) != null ? roa(L) > roa(P) : null);
    add(S.fin(L.ocf) && S.fin(L.netIncome) ? L.ocf > L.netIncome : null);
    add(S.fin(L.ltDebt) && S.fin(P.ltDebt) && L.assets > 0 && P.assets > 0 ? L.ltDebt / L.assets <= P.ltDebt / P.assets : null);
    add(L.curLiab > 0 && P.curLiab > 0 && S.fin(L.curAssets) && S.fin(P.curAssets) ? L.curAssets / L.curLiab > P.curAssets / P.curLiab : null);
    add(L.dilShares > 0 && P.dilShares > 0 ? L.dilShares <= P.dilShares * 1.005 : null);
    add(L.revenue > 0 && P.revenue > 0 && S.fin(L.grossProfit) && S.fin(P.grossProfit) ? L.grossProfit / L.revenue > P.grossProfit / P.revenue : null);
    add(L.assets > 0 && P.assets > 0 && L.revenue > 0 && P.revenue > 0 ? L.revenue / L.assets > P.revenue / P.assets : null);
    const known = t.filter(x => x != null);
    return known.length >= 7 ? { score: known.reduce((s, x) => s + x, 0), of: known.length } : null;
  }

  return { TAGS, compact, annual, latest, quarterlyEPS, analyse, piotroski };
});
