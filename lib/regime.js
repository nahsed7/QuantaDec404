// Market regime from several independent indicators. Each indicator votes; the vote split is the uncertainty.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QRegime = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin;

  // market: SPY daily bars; vix: ^VIX daily bars (optional); universe: [{sector, ret63, ret63prev, aboveSMA50, amihud, amihudPrev}]
  function classify(market, vix, universe = []) {
    if (!market || market.length < 210) return { available: false, reason: 'Needs at least 210 daily bars of the market index.' };
    const c = market.map(b => b.c), n = c.length, s200 = S.sma(c, 200), s50 = S.sma(c, 50), r = S.logReturns(c).filter(fin);
    const ind = [], vote = (name, value, side, text) => ind.push({ name, value, vote: side, text });
    // Trend indicators (bull / bear / sideways votes).
    const d200 = c[n - 1] / s200[n - 1] - 1;
    vote('Index vs 200-day average', d200, d200 > 0.03 ? 'bull' : d200 < -0.03 ? 'bear' : 'sideways', `${(100 * d200).toFixed(1)} % from the 200-day average`);
    const slope = s50[n - 1] / s50[n - 22] - 1;
    vote('50-day average slope (1 month)', slope, slope > 0.01 ? 'bull' : slope < -0.01 ? 'bear' : 'sideways', `${(100 * slope).toFixed(2)} % over the last month`);
    const hi = Math.max(...c.slice(-252)), dd = 1 - c[n - 1] / hi;
    vote('Drawdown from 52-week high', -dd, dd < 0.05 ? 'bull' : dd > 0.2 ? 'bear' : 'sideways', `${(100 * dd).toFixed(1)} % below the 52-week high`);
    const r6 = c[n - 1] / c[n - 127] - 1;
    vote('6-month return', r6, r6 > 0.05 ? 'bull' : r6 < -0.05 ? 'bear' : 'sideways', `${(100 * r6).toFixed(1)} %`);
    if (universe.length >= 10) {
      const breadth = universe.filter(u => u.aboveSMA50 === true).length / universe.filter(u => u.aboveSMA50 != null).length;
      vote('Breadth (share of tracked stocks above their 50-day average)', breadth, breadth > 0.6 ? 'bull' : breadth < 0.4 ? 'bear' : 'sideways', `${(100 * breadth).toFixed(0)} %`);
    }
    const tally = { bull: 0, bear: 0, sideways: 0 }; for (const i of ind) tally[i.vote]++;
    const trend = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    const trendAgreement = tally[trend] / ind.length;

    // Volatility regime: current 20-day realised vol as a percentile of this index's own 5-year history.
    const rv = []; for (let i = 20; i <= r.length; i++) rv.push(S.std(r.slice(i - 20, i)) * Math.sqrt(252));
    const rvNow = rv[rv.length - 1], rvPct = S.percentileRank(rv, rvNow);
    const vixNow = vix?.length ? vix[vix.length - 1].c : null, vixPct = vix?.length > 100 ? S.percentileRank(vix.map(b => b.c), vixNow) : null;
    const volVotes = [rvPct, vixPct].filter(fin), volScore = S.mean(volVotes);
    const volRegime = volScore > 0.75 ? 'high' : volScore < 0.25 ? 'low' : 'normal';

    // Liquidity stress: high VIX percentile together with rising price impact (Amihud) across the tracked universe.
    const am = universe.filter(u => fin(u.amihud) && fin(u.amihudPrev) && u.amihudPrev > 0).map(u => u.amihud / u.amihudPrev);
    const amihudChange = am.length >= 10 ? S.median(am) : null;
    const stress = [vixPct != null && vixPct > 0.85, amihudChange != null && amihudChange > 1.5, rvPct > 0.9].filter(Boolean).length;

    // Sector rotation: change in sector ranking between the previous 3 months and the latest 3 months.
    const sectors = {}; for (const u of universe) if (fin(u.ret63)) (sectors[u.sector] ||= []).push(u);
    const rot = Object.entries(sectors).map(([s, us]) => ({ sector: s, ret63: S.median(us.map(u => u.ret63)), prev63: S.median(us.map(u => u.ret63prev)), n: us.length }));
    const rk = (k) => { const s = [...rot].filter(x => fin(x[k])).sort((a, b) => b[k] - a[k]); s.forEach((x, i) => { x[k + 'Rank'] = i + 1; }); };
    rk('ret63'); rk('prev63'); rot.forEach(x => { x.rankChange = fin(x.prev63Rank) && fin(x.ret63Rank) ? x.prev63Rank - x.ret63Rank : null; });
    const rotationIntensity = rot.length >= 4 ? S.spearman(rot.map(x => x.ret63), rot.map(x => x.prev63)) : null;   // low or negative = leadership changed

    return {
      available: true, asOf: market[n - 1].t, trend, trendAgreement, tally, indicators: ind,
      volatility: { regime: volRegime, realised20: rvNow, realisedPct: rvPct, vix: vixNow, vixPct },
      liquidityStress: { level: stress >= 2 ? 'elevated' : stress === 1 ? 'watch' : 'normal', signals: stress, amihudChange },
      rotation: { sectors: rot.sort((a, b) => (a.ret63Rank || 99) - (b.ret63Rank || 99)), rankCorrelation: rotationIntensity },
      uncertainty: trendAgreement >= 0.8 ? 'low' : trendAgreement >= 0.6 ? 'moderate' : 'high',
      note: 'Rule-based classification from the indicators shown. Thresholds are judgement and regimes are only clear in hindsight.',
    };
  }
  return { classify };
});
