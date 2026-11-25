// Currency handling for international listings (pure functions, UMD).
// Rates are Yahoo "XXXUSD=X" series: units of USD per 1 unit of XXX. Cross rates go through USD.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QFx = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin;

  // Yahoo quotes some London, Johannesburg and Tel Aviv prices in minor units (pence, cents, agorot).
  const MINOR = { GBp: ['GBP', 0.01], GBX: ['GBP', 0.01], ZAc: ['ZAR', 0.01], ILA: ['ILS', 0.01] };
  function normaliseCurrency(ccy) { const m = MINOR[ccy]; return m ? { ccy: m[0], factor: m[1] } : { ccy: ccy || null, factor: 1 }; }

  // series: [{t, c}] sorted by t, value = USD per unit. Rate at time t = last observation at or before t
  // (falls back to the first observation when t is earlier than the series, flagged by `extrapolated`).
  function rateAt(series, t) {
    if (!series?.length) return null;
    let lo = 0, hi = series.length - 1;
    if (t < series[0].t) return { rate: series[0].c, t: series[0].t, extrapolated: true };
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (series[mid].t <= t) lo = mid; else hi = mid - 1; }
    return { rate: series[lo].c, t: series[lo].t, extrapolated: false };
  }

  // USD per unit of `ccy` at time t. USD is 1 by definition.
  function usdPer(ccy, t, table) {
    if (ccy === 'USD') return 1;
    const r = rateAt(table?.[ccy], t); return r && fin(r.rate) && r.rate > 0 ? r.rate : null;
  }
  // Units of `to` per unit of `from` at time t (cross through USD).
  function cross(from, to, t, table) {
    if (from === to) return 1;
    const a = usdPer(from, t, table), b = usdPer(to, t, table);
    return fin(a) && fin(b) ? a / b : null;
  }

  // Convert OHLC bars (and optionally dividends) from one currency to another at each bar's own date.
  // Volume (shares) is unchanged. Bars whose date has no rate are dropped rather than guessed.
  function convertBars(bars, from, to, table) {
    if (from === to) return bars;
    const out = [];
    for (const b of bars) { const k = cross(from, to, b.t, table); if (!fin(k)) continue; out.push({ ...b, o: b.o * k, h: b.h * k, l: b.l * k, c: b.c * k }); }
    return out;
  }
  function convertEvents(evs, from, to, table, field = 'amount') {
    if (from === to) return evs;
    return evs.map(e => { const k = cross(from, to, e.t, table); return fin(k) ? { ...e, [field]: e[field] * k } : null; }).filter(Boolean);
  }
  return { normaliseCurrency, rateAt, usdPer, cross, convertBars, convertEvents };
});
