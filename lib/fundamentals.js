// Financial statements from SEC EDGAR XBRL "companyfacts", and the fundamental ratios built on them.
// Values are as reported in 10-K / 10-Q filings. Nothing is estimated here except where a ratio says so.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QFund = factory(root.QStats);
})(this, function (S) {
  'use strict';

  // Each field lists XBRL tags in priority order; a company may switch tags between years, so all are merged.
  // US filers use us-gaap (10-K/10-Q). Foreign private issuers file 20-F (or 40-F from Canada) in ifrs-full or us-gaap.
  const TAGS = {
    revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense', 'ifrs-full:Revenue', 'ifrs-full:RevenueFromContractsWithCustomers', 'ifrs-full:RevenueFromSaleOfGoods'],
    grossProfit: ['GrossProfit', 'ifrs-full:GrossProfit'],
    opIncome: ['OperatingIncomeLoss', 'ifrs-full:ProfitLossFromOperatingActivities'],
    pretax: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments', 'ifrs-full:ProfitLossBeforeTax'],
    tax: ['IncomeTaxExpenseBenefit', 'ifrs-full:IncomeTaxExpenseContinuingOperations'],
    netIncome: ['NetIncomeLoss', 'ProfitLoss', 'ifrs-full:ProfitLossAttributableToOwnersOfParent', 'ifrs-full:ProfitLoss'],
    eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic', 'ifrs-full:DilutedEarningsLossPerShare', 'ifrs-full:BasicEarningsLossPerShare', 'ifrs-full:DilutedEarningsLossPerShareFromContinuingOperations'],
    ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'ifrs-full:CashFlowsFromUsedInOperatingActivities'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
    da: ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization', 'ifrs-full:DepreciationAndAmortisationExpense', 'ifrs-full:DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss'],
    interest: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt', 'ifrs-full:InterestExpense', 'ifrs-full:FinanceCosts'],
    divPaid: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends', 'ifrs-full:DividendsPaidClassifiedAsFinancingActivities', 'ifrs-full:DividendsPaid'],
    buyback: ['PaymentsForRepurchaseOfCommonStock', 'ifrs-full:PaymentsToAcquireOrRedeemEntitysShares'],
    sbc: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense', 'ifrs-full:ExpenseFromSharebasedPaymentTransactionsWithEmployees'],
    dilShares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic', 'ifrs-full:AdjustedWeightedAverageShares', 'ifrs-full:WeightedAverageShares'],
    assets: ['Assets', 'ifrs-full:Assets'],
    liabilities: ['Liabilities', 'ifrs-full:Liabilities'],
    curAssets: ['AssetsCurrent', 'ifrs-full:CurrentAssets'],
    curLiab: ['LiabilitiesCurrent', 'ifrs-full:CurrentLiabilities'],
    equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'ifrs-full:EquityAttributableToOwnersOfParent', 'ifrs-full:Equity'],
    cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'CashAndDueFromBanks', 'ifrs-full:CashAndCashEquivalents'],
    stInvest: ['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'],
    ltDebt: ['LongTermDebtNoncurrent', 'LongTermDebt', 'ifrs-full:LongtermBorrowings', 'ifrs-full:NoncurrentPortionOfNoncurrentBorrowings'],
    stDebt: ['LongTermDebtCurrent', 'DebtCurrent', 'ShortTermBorrowings', 'CommercialPaper', 'ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings', 'ifrs-full:ShorttermBorrowings'],
    goodwill: ['Goodwill', 'ifrs-full:Goodwill'],
    intangibles: ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet', 'ifrs-full:IntangibleAssetsOtherThanGoodwill'],
    sharesOut: ['dei:EntityCommonStockSharesOutstanding'],
  };
  const INSTANT = new Set(['assets', 'liabilities', 'curAssets', 'curLiab', 'equity', 'cash', 'stInvest', 'ltDebt', 'stDebt', 'goodwill', 'intangibles', 'sharesOut']);
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

  // Reduce a raw companyfacts JSON to just the tags above (keeps the cache small).
  const FORMS = /^(10-[KQ]|20-F|40-F)/, ANNUAL = /^(10-K|20-F|40-F)/;
  const nsTag = t => t.includes(':') ? t.split(':') : ['us-gaap', t];
  // Reporting currency: the currency unit carrying the most annual income-statement facts. Foreign filers often add
  // a convenience translation (e.g. TSMC reports TWD and also USD for the latest year); those must not be mixed in.
  function reportingCurrency(cf) {
    const n = {};
    for (const t of [...TAGS.netIncome, ...TAGS.revenue, ...TAGS.assets]) {
      const [ns, tag] = nsTag(t), f = cf.facts?.[ns]?.[tag]; if (!f) continue;
      for (const [u, xs] of Object.entries(f.units)) if (/^[A-Z]{3}$/.test(u)) n[u] = (n[u] || 0) + xs.filter(x => ANNUAL.test(x.form)).length;
    }
    const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] > 0 ? best[0] : null;
  }
  function pickUnit(units, ccy) {
    const ks = Object.keys(units);
    const prefer = [ccy, `${ccy}/shares`, 'shares'].filter(Boolean).find(u => ks.includes(u));
    if (prefer) return prefer;
    // No unit in the reporting currency: only a non-monetary unit is safe to use.
    return ks.find(u => u === 'shares' || u === 'pure') || (ccy ? null : ks[0]);
  }
  function compact(cf) {
    const ccy = reportingCurrency(cf);
    const out = { cik: cf.cik, name: cf.entityName, currency: ccy || 'USD', facts: {} };
    for (const tags of Object.values(TAGS)) for (const t of tags) {
      const [ns, tag] = nsTag(t);
      const f = cf.facts?.[ns]?.[tag]; if (!f) continue;
      const unit = pickUnit(f.units, ccy); if (!unit) continue;
      const v = f.units[unit].filter(x => FORMS.test(x.form)).map(x => [x.start || null, x.end, x.val, x.form, x.filed, x.fp]);
      if (v.length) out.facts[t] = { unit, v };
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
          if (!ANNUAL.test(form)) continue;
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
    return { rows: rows.slice(-15), currency: cf.currency || 'USD', tagsUsed: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, [...v]])) };
  }

  // Point-in-time view: the facts exactly as they were known on date t (only filings with filed ≤ t). Restatements filed
  // later are invisible, so a historical test sees what an investor could have seen. annual(asOf(cf, t)) gives the
  // fiscal-year rows as originally reported up to t (a later 10-K restating an earlier year only counts once filed).
  function asOf(cf, t) {
    const cut = typeof t === 'number' ? new Date(t).toISOString().slice(0, 10) : String(t).slice(0, 10), facts = {};
    for (const [k, f] of Object.entries(cf.facts || {})) { const v = f.v.filter(x => x[4] <= cut); if (v.length) facts[k] = { ...f, v }; }
    return { ...cf, facts, asOf: cut };
  }
  // How many fiscal-year values were later revised (latest filing differs from the first one by more than 0.5 %).
  function restatements(cf, fields = ['revenue', 'netIncome', 'eps']) {
    let n = 0, of = 0;
    for (const f of fields) for (const t of TAGS[f]) {
      const byEnd = new Map();
      for (const [start, end, val, form, filed] of cf.facts?.[t]?.v || []) { if (!ANNUAL.test(form) || !start) continue; const d = (Date.parse(end) - Date.parse(start)) / 864e5; if (d < 330 || d > 380) continue; (byEnd.get(end) || byEnd.set(end, []).get(end)).push([filed, val]); }
      for (const xs of byEnd.values()) { if (xs.length < 2) continue; xs.sort((a, b) => a[0].localeCompare(b[0])); of++; const a = xs[0][1], b = xs[xs.length - 1][1]; if (Math.abs(b - a) > 0.005 * Math.max(Math.abs(a), 1e-9)) n++; }
    }
    return { revised: n, compared: of };
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
  // taxFallback: rate used for ROIC when the company's own effective rate is missing (caller passes the statutory rate).
  function analyse(rows, bal, price, taxFallback = 0.21) {
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
    const tax = S.fin(L?.taxRate) ? L.taxRate : taxFallback;
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

  return { TAGS, compact, reportingCurrency, asOf, restatements, annual, latest, quarterlyEPS, analyse, piotroski };
});
