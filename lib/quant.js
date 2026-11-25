// Market-behaviour analytics from daily bars: momentum, exhaustion, volatility, liquidity.
// Each function is independent and returns its components, not just a score.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QQuant = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin, A = 252;
  const ret = (c, n) => c.length > n && c[c.length - 1 - n] > 0 ? c[c.length - 1] / c[c.length - 1 - n] - 1 : null;

  function returns(bars, periods = [1, 5, 21, 63, 126, 252]) {
    const c = bars.map(b => b.c), o = {}; for (const n of periods) o[n] = ret(c, n); return o;
  }

  // Wilder RSI.
  function rsi(c, n = 14) {
    if (c.length <= n) return [];
    let g = 0, l = 0; const out = new Array(c.length).fill(null);
    for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n; out[n] = l ? 100 - 100 / (1 + g / l) : 100;
    for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out[i] = l ? 100 - 100 / (1 + g / l) : 100; }
    return out;
  }

  // ---- momentum ----
  function momentum(bars, ctx = {}) {
    const c = bars.map(b => b.c), v = bars.map(b => b.v), n = c.length, last = c[n - 1];
    if (n < 30) return { available: false, reason: `Only ${n} daily bars.` };
    const m = { available: true, returns: returns(bars) };
    const s20 = S.sma(c, 20), s50 = S.sma(c, 50), s200 = S.sma(c, 200);
    m.sma = { 20: s20[n - 1], 50: s50[n - 1], 200: s200[n - 1] };
    m.aboveSMA = { 50: fin(s50[n - 1]) ? last > s50[n - 1] : null, 200: fin(s200[n - 1]) ? last > s200[n - 1] : null };
    m.sma50Slope = fin(s50[n - 1]) && fin(s50[n - 22]) ? s50[n - 1] / s50[n - 22] - 1 : null;          // 1-month change in the 50-day average
    // 12-1 momentum: 12-month return excluding the most recent month (standard in the momentum literature).
    m.mom12_1 = n > 252 ? c[n - 22] / c[n - 253] - 1 : null;
    // Relative strength vs the market (SPY) and vs the sector median, over 3 months.
    if (ctx.marketBars?.length > 63) m.relMarket63 = (m.returns[63] ?? NaN) - ret(ctx.marketBars.map(b => b.c), 63);
    if (fin(ctx.sectorMedian63)) m.relSector63 = (m.returns[63] ?? NaN) - ctx.sectorMedian63;
    // Trend persistence: R² and slope of log price over 63 days, and share of up days.
    const lp = c.slice(-63).map(Math.log), reg = S.linreg(lp.map((_, i) => i), lp);
    m.trendR2 = reg?.r2 ?? null; m.trendSlopeAnn = reg ? reg.slope * A : null;
    const r = S.logReturns(c.slice(-64)); m.upDayShare = r.filter(x => x > 0).length / r.length;
    // Acceleration: 3-month return now minus the 3-month return one month ago.
    m.accel = n > 85 ? (m.returns[63] ?? NaN) - (c[n - 22] / c[n - 85] - 1) : null;
    // Volume confirmation: average volume on up days ÷ on down days, last 2 months.
    let uv = 0, un = 0, dv = 0, dn = 0; for (let i = n - 42; i < n; i++) { if (i < 1) continue; if (c[i] > c[i - 1]) { uv += v[i]; un++; } else if (c[i] < c[i - 1]) { dv += v[i]; dn++; } }
    m.upDownVolume = un && dn && dv ? (uv / un) / (dv / dn) : null;
    return m;
  }

  // ---- exhaustion (over-extension) ----
  function exhaustion(bars, ctx = {}) {
    const c = bars.map(b => b.c), v = bars.map(b => b.v), n = c.length;
    if (n < 130) return { available: false, reason: `Needs about 6 months of daily bars (have ${n}).` };
    const r = S.logReturns(c), sd = S.std(r.slice(-60)), s50 = S.sma(c, 50)[n - 1];
    const out = { available: true, signals: [] };
    out.distSMA50 = fin(s50) && sd ? Math.log(c[n - 1] / s50) / (sd * Math.sqrt(50)) : null;    // in units of 50-day σ
    // Where the latest 1-month return sits in this stock's own history of 1-month returns.
    const r21 = []; for (let i = 21; i < n; i++) r21.push(c[i] / c[i - 21] - 1);
    out.ret21Pct = S.percentileRank(r21, r21[r21.length - 1]);
    out.volExpansion = S.std(r.slice(-20)) / S.std(r.slice(-120));
    const R = rsi(c); out.rsi = R[n - 1];
    // Bearish divergence: price at a 3-month high but RSI clearly below its 3-month high (and the mirror for lows).
    const w = c.slice(-63), wr = R.slice(-63).filter(fin);
    out.divergence = c[n - 1] >= Math.max(...w) * 0.995 && fin(out.rsi) && out.rsi < Math.max(...wr) - 10 ? 'bearish'
      : c[n - 1] <= Math.min(...w) * 1.005 && fin(out.rsi) && out.rsi > Math.min(...wr) + 10 ? 'bullish' : null;
    const lv = v.slice(-61, -1).filter(x => x > 0).map(Math.log), lsd = S.std(lv);
    out.volumeZ = v[n - 1] > 0 && lsd ? (Math.log(v[n - 1]) - S.mean(lv)) / lsd : null;
    const mo = momentum(bars, ctx); out.momentumFading = mo.available && fin(mo.accel) && fin(mo.returns[63]) ? Math.sign(mo.returns[63]) !== Math.sign(mo.accel) && Math.abs(mo.returns[63]) > 0.05 : null;
    out.valuationPremium = ctx.valuationPremium ?? null;
    const dir = Math.sign(out.distSMA50 || 0);
    const add = (cond, text) => { if (cond) out.signals.push(text); };
    add(Math.abs(out.distSMA50) > 2, `Price is ${Math.abs(out.distSMA50).toFixed(1)} σ ${dir > 0 ? 'above' : 'below'} its 50-day average.`);
    add(out.ret21Pct > 0.95 || out.ret21Pct < 0.05, `1-month return is at the ${(100 * out.ret21Pct).toFixed(0)}th percentile of its own history.`);
    add(out.volExpansion > 1.5, `Volatility has expanded to ${out.volExpansion.toFixed(1)}× its 6-month level.`);
    add(out.rsi > 75 || out.rsi < 25, `RSI(14) is ${out.rsi.toFixed(0)}.`);
    add(out.divergence, `RSI ${out.divergence} divergence at a 3-month ${out.divergence === 'bearish' ? 'high' : 'low'}.`);
    add(Math.abs(out.volumeZ) > 2.5, `Volume anomaly: today's volume is ${out.volumeZ.toFixed(1)} σ from its 3-month norm.`);
    add(out.momentumFading, 'Momentum is decelerating against the 3-month trend.');
    add(fin(out.valuationPremium) && Math.abs(out.valuationPremium) > 0.4, `Price is ${(100 * out.valuationPremium).toFixed(0)} % from the base valuation.`);
    out.direction = dir > 0 ? 'up' : dir < 0 ? 'down' : null;
    out.count = out.signals.length;
    out.caveat = 'Over-extension is common in strong trends and does not by itself predict a reversal.';
    return out;
  }

  // ---- volatility ----
  function volatility(bars, ctx = {}) {
    const c = bars.map(b => b.c), n = c.length;
    if (n < 30) return { available: false, reason: `Only ${n} daily bars.` };
    const r = S.logReturns(c).filter(fin), o = { available: true };
    const ann = a => { const s = S.std(a); return fin(s) ? s * Math.sqrt(A) : null; };
    o.hv20 = ann(r.slice(-20)); o.hv60 = ann(r.slice(-60)); o.hv252 = ann(r.slice(-252)); o.hvAll = ann(r);
    o.ewma = S.ewmaVol(r) * Math.sqrt(A);
    // Parkinson (high–low) realised volatility over 20 days: uses intraday range, so it reacts to intraday swings.
    const hl = bars.slice(-20).filter(b => b.h > 0 && b.l > 0).map(b => Math.log(b.h / b.l) ** 2);
    o.parkinson20 = hl.length > 10 ? Math.sqrt(S.mean(hl) / (4 * Math.log(2)) * A) : null;
    // Clustering: autocorrelation of squared returns (lags 1–5). Positive values mean calm and turbulent days bunch together.
    const sq = r.slice(-504).map(x => x * x); o.clustering = [1, 2, 3, 4, 5].map(l => S.autocorr(sq, l));
    const dd = S.drawdown(c); o.maxDrawdown = dd.max; o.currentDrawdown = dd.current;
    const dd1 = S.drawdown(c.slice(-252)); o.maxDrawdown1y = dd1.max;
    const r1 = r.slice(-252); o.var95 = -S.quantile(r1, 0.05); o.es95 = -S.mean(r1.filter(x => x <= S.quantile(r1, 0.05)));
    o.skew = S.skew(r1); o.kurtosis = S.kurtosis(r1);
    o.worstDay = Math.min(...r1);
    // Regime-dependent volatility: this stock's volatility on days when the market was above vs below its 200-day average.
    if (ctx.marketBars?.length > 210) {
      const mc = ctx.marketBars.map(b => b.c), ms = S.sma(mc, 200), byT = new Map(ctx.marketBars.map((b, i) => [b.t, i]));
      const up = [], dn = [];
      for (let i = 1; i < n; i++) { const j = byT.get(bars[i].t); if (j == null || !fin(ms[j])) continue; const x = Math.log(c[i] / c[i - 1]); (mc[j] > ms[j] ? up : dn).push(x); }
      o.regimeVol = { marketUp: up.length > 20 ? ann(up) : null, marketDown: dn.length > 20 ? ann(dn) : null, nUp: up.length, nDown: dn.length };
    }
    if (ctx.marketBars?.length > 60) {                   // beta from aligned daily log returns, last 2 years
      const byT = new Map(ctx.marketBars.map(b => [b.t, b.c])), x = [], y = [];
      for (let i = Math.max(1, n - 504); i < n; i++) { const m0 = byT.get(bars[i - 1].t), m1 = byT.get(bars[i].t); if (m0 && m1) { x.push(Math.log(m1 / m0)); y.push(Math.log(c[i] / c[i - 1])); } }
      const reg = S.linreg(x, y); o.beta = reg?.slope ?? null; o.betaN = x.length;
    }
    return o;
  }

  // ---- liquidity and estimated trading costs ----
  function liquidity(bars, ctx = {}) {
    const n = bars.length; if (n < 21) return { available: false, reason: `Only ${n} daily bars.` };
    const w = bars.slice(-21, -1).length >= 15 ? bars.slice(-21) : bars;      // last ~1 month incl. today
    const o = { available: true };
    o.advShares = S.median(w.map(b => b.v)); o.addv = S.median(w.map(b => b.v * b.c));
    o.turnover = ctx.shares > 0 && o.advShares ? o.advShares / ctx.shares : null;
    // Amihud illiquidity: mean |return| per $ traded (×1e9 for readability). Higher = price moves more per dollar.
    const am = []; for (let i = n - 20; i < n; i++) if (i > 0 && bars[i].v > 0) am.push(Math.abs(bars[i].c / bars[i - 1].c - 1) / (bars[i].v * bars[i].c));
    o.amihud = am.length ? S.mean(am) * 1e9 : null;
    // Spread estimate from daily close, high and low (Abdi & Ranaldo 2017). An estimate, not a quoted spread.
    const ar = []; for (let i = Math.max(1, n - 60); i < n - 1; i++) {
      const eta = x => (Math.log(x.h) + Math.log(x.l)) / 2, ci = Math.log(bars[i].c);
      ar.push((ci - eta(bars[i])) * (ci - eta(bars[i + 1])));
    }
    const m = S.mean(ar); o.spreadEst = fin(m) ? 2 * Math.sqrt(Math.max(0, 4 * m)) : null;
    o.quotedSpread = fin(ctx.bid) && fin(ctx.ask) && ctx.ask > ctx.bid ? (ctx.ask - ctx.bid) / ((ctx.ask + ctx.bid) / 2) : null;
    const r = S.logReturns(bars.slice(-61).map(b => b.c)).filter(fin); o.sigmaDaily = S.std(r);
    o.depth = ctx.depth ?? null;
    return o;
  }
  // Estimated cost of trading `usd`: half the spread plus square-root market impact σ·√(Q/ADV). Model estimate.
  function tradeCost(liq, usd, k = 1) {
    if (!liq?.available || !(liq.addv > 0) || !fin(liq.sigmaDaily)) return null;
    const spread = fin(liq.quotedSpread) ? liq.quotedSpread : fin(liq.spreadEst) ? liq.spreadEst : null;
    const half = fin(spread) ? spread / 2 : null, impact = k * liq.sigmaDaily * Math.sqrt(usd / liq.addv);
    return { halfSpread: half, impact, total: (half ?? 0) + impact, participation: usd / liq.addv, spreadSource: fin(liq.quotedSpread) ? 'quoted' : 'estimated from daily bars' };
  }

  return { returns, rsi, momentum, exhaustion, volatility, liquidity, tradeCost };
});
