// Historical check of two signals across the tracked universe: cheapness (earnings yield) and 12−1 momentum,
// against the following quarter's return. Uses only filings already public at each formation date.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QCal = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin;
  // stocks: [{ sym, monthly: [{t, c}], annual: [{end, eps, filed}] }]. Formation at each quarter-month end.
  function run(stocks) {
    const months = [...new Set(stocks.flatMap(s => s.monthly.map(b => monthKey(b.t))))].sort();
    const at = new Map(stocks.map(s => [s.sym, new Map(s.monthly.map(b => [monthKey(b.t), b.c]))]));
    const val = [], mom = [];
    for (let i = 12; i + 3 < months.length; i += 3) {
      const m0 = months[i], m3 = months[i + 3], tForm = Date.parse(m0 + '-28');
      const ey = [], mo = [], fwdV = [], fwdM = [];
      for (const s of stocks) {
        const p = at.get(s.sym), c0 = p.get(m0), c3 = p.get(m3), c12 = p.get(months[i - 12]), c1 = p.get(months[i - 1]);
        if (!fin(c0) || !fin(c3)) continue;
        const fwd = c3 / c0 - 1;
        const known = s.annual.filter(a => fin(a.eps) && a.filed && a.filed < tForm);   // no look-ahead: filing date before formation
        if (known.length) { ey.push(known[known.length - 1].eps / c0); fwdV.push(fwd); }
        if (fin(c12) && fin(c1)) { mo.push(c1 / c12 - 1); fwdM.push(fwd); }
      }
      const a = S.spearman(ey, fwdV), b = S.spearman(mo, fwdM);
      if (fin(a)) val.push({ month: m0, ic: a, n: ey.length }); if (fin(b)) mom.push({ month: m0, ic: b, n: mo.length });
    }
    const summ = arr => {
      if (arr.length < 4) return { n: arr.length, ic: null };
      const ics = arr.map(x => x.ic), h = Math.floor(arr.length / 2), sd = S.std(ics);
      return { n: arr.length, ic: S.mean(ics), t: sd ? S.mean(ics) / (sd / Math.sqrt(ics.length)) : null, hitRate: ics.filter(x => x > 0).length / ics.length,
        icEarlier: S.mean(ics.slice(0, h)), icLater: S.mean(ics.slice(h)), from: arr[0].month, to: arr[arr.length - 1].month, series: arr };
    };
    return { valuation: summ(val), momentum: summ(mom), horizon: '3 months', caveats: [
      'Survivorship bias: the universe is today\'s large caps, so past losers that left the index are missing.',
      'Few cross-sections (one per quarter) and about 50 stocks each, so the estimates are noisy.',
      'Earnings yield is a simple stand-in for the full valuation models, which cannot be rebuilt point-in-time from this data.'] };
  }
  const monthKey = t => new Date(t).toISOString().slice(0, 7);
  return { run };
});
