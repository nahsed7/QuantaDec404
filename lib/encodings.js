// Heat-map visual encodings: what size, colour, border, marker and corner flag mean for one company.
// One definition serves the tiles, the tooltip and the legend, so they cannot disagree. Pure and Node-testable (UMD).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'), require('./treemap'));
  else root.QEnc = factory(root.QStats, root.QTree);
})(this, function (S, T) {
  'use strict';
  const fin = S.fin;
  const pc = (x, d = 1) => fin(x) ? (x >= 0 ? '+' : '') + (100 * x).toFixed(d) + ' %' : 'n/a';
  const pu = (x, d = 1) => fin(x) ? (100 * x).toFixed(d) + ' %' : 'n/a';
  const big = x => !fin(x) ? 'n/a' : Math.abs(x) >= 1e12 ? (x / 1e12).toFixed(2) + ' T' : Math.abs(x) >= 1e9 ? (x / 1e9).toFixed(1) + ' B' : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(1) + ' M' : x.toFixed(0);
  const score = x => fin(x) ? x + '/100' : 'n/a';

  // Return over the last n daily closes (the last close is the latest quote when one is available).
  const retFrom = (s, n) => s.closes?.length > n && s.closes[s.closes.length - 1 - n] > 0 ? s.closes[s.closes.length - 1] / s.closes[s.closes.length - 1 - n] - 1 : null;
  const priceTime = s => s.fresh?.priceTime ?? null;
  const pricesTime = s => s.fresh?.pricesFetched ?? null;
  const filedTime = s => s.fresh?.filed ? Date.parse(s.fresh.filed) : null;
  const computedTime = (s, o) => o?.computedAt ?? null;
  const priceKind = s => s.fresh?.priceKind?.startsWith('delayed') ? 'delayed' : 'historical';

  // kind: live | delayed | historical | estimate | simulated. asOf(s, opts) → ms timestamp of the data behind the value.
  const COLOR = {
    d1: { label: '1-day return', get: s => s.change1d, scale: { kind: 'diverging', domain: 0.03 }, fmt: x => pc(x), kind: priceKind, asOf: priceTime, src: 'Yahoo quote vs previous close' },
    w1: { label: '1-week return (5 trading days)', get: s => retFrom(s, 5), scale: { kind: 'diverging', domain: 0.06 }, fmt: x => pc(x), kind: 'historical', asOf: priceTime, src: 'Yahoo daily closes' },
    m1: { label: '1-month return (21 trading days)', get: s => retFrom(s, 21), scale: { kind: 'diverging', domain: 0.12 }, fmt: x => pc(x), kind: 'historical', asOf: priceTime, src: 'Yahoo daily closes' },
    q1: { label: '3-month return (63 trading days)', get: s => retFrom(s, 63), scale: { kind: 'diverging', domain: 0.2 }, fmt: x => pc(x), kind: 'historical', asOf: priceTime, src: 'Yahoo daily closes' },
    h1: { label: '6-month return', get: s => retFrom(s, 126), scale: { kind: 'diverging', domain: 0.3 }, fmt: x => pc(x), kind: 'historical', asOf: priceTime, src: 'Yahoo daily closes' },
    y1: { label: '1-year return', get: s => retFrom(s, 252), scale: { kind: 'diverging', domain: 0.5 }, fmt: x => pc(x), kind: 'historical', asOf: priceTime, src: 'Yahoo daily closes' },
    custom: { label: 'Custom period return', get: (s, o) => retFrom(s, S.clamp(o?.customN || 10, 1, 252)), scale: { kind: 'diverging', domain: 0.15 }, fmt: x => pc(x), kind: 'historical', asOf: priceTime, src: 'Yahoo daily closes' },
    sector: { label: '3-month return minus sector median', get: s => s.relSector63, scale: { kind: 'diverging', domain: 0.15 }, fmt: x => pc(x), kind: 'historical', asOf: priceTime, src: 'Yahoo daily closes; sector = tracked peers in all regions' },
    prem: { label: 'Premium (+) / discount (−) to base valuation', get: s => s.valuation?.premium, scale: { kind: 'diverging', domain: 0.6, invert: true }, fmt: x => pc(x), kind: 'estimate', asOf: computedTime, src: 'Primary valuation model (estimate)' },
    unc: { label: 'Valuation uncertainty (optimistic ÷ conservative)', get: s => fin(s.valuation?.widthRatio) && fin(s.valuation?.base) ? s.valuation.widthRatio : null, scale: { kind: 'sequential', domain: [1.2, 3] }, fmt: x => fin(x) ? '×' + x.toFixed(2) : 'n/a', kind: 'estimate', asOf: computedTime, src: 'Width of the primary model range' },
    histpct: { label: 'P/E percentile in own history', get: s => s.histPercentile, scale: { kind: 'diverging', domain: 1, invert: true, center: 0.5 }, fmt: x => fin(x) ? (100 * x).toFixed(0) + 'th pct' : 'n/a', kind: 'estimate', asOf: filedTime, src: 'SEC EPS and Yahoo month-end prices' },
    opp: { label: 'Opportunity score', get: s => s.scores?.opportunity, scale: { kind: 'sequential', domain: [20, 80] }, fmt: score, kind: 'estimate', asOf: computedTime, src: 'Decision engine' },
    risk: { label: 'Risk score', get: s => s.scores?.risk, scale: { kind: 'sequential', domain: [20, 80] }, fmt: score, kind: 'estimate', asOf: computedTime, src: 'Decision engine' },
    conf: { label: 'Confidence score', get: s => s.scores?.confidence, scale: { kind: 'sequential', domain: [20, 80] }, fmt: score, kind: 'estimate', asOf: computedTime, src: 'Decision engine' },
    vol: { label: 'Volatility (1 year, annualised)', get: s => s.hv252, scale: { kind: 'sequential', domain: [0.15, 0.6] }, fmt: x => pu(x), kind: 'historical', asOf: priceTime, src: 'Yahoo daily closes' },
    vz: { label: 'Volume anomaly (σ vs 3-month log volume)', get: s => s.volumeZ, scale: { kind: 'diverging', domain: 3 }, fmt: x => fin(x) ? x.toFixed(1) + ' σ' : 'n/a', kind: 'historical', asOf: priceTime, src: 'Yahoo daily volume (today may be partial)' },
    div: { label: 'Dividend yield (trailing 12 months)', get: s => s.divYield, scale: { kind: 'sequential', domain: [0, 0.05] }, fmt: x => pu(x), kind: 'historical', asOf: pricesTime, src: 'Yahoo dividend events' },
    health: { label: 'Financial health (Piotroski F-score)', get: s => s.fscore?.of ? s.fscore.score / s.fscore.of : null, scale: { kind: 'diverging', domain: 1, center: 0.5 }, fmt: (x, s) => s?.fscore ? `${s.fscore.score}/${s.fscore.of}` : fin(x) ? (100 * x).toFixed(0) + ' %' : 'n/a', kind: 'historical', asOf: filedTime, src: 'SEC annual filings (10-K, 20-F, 40-F)' },
    mature: { label: 'Momentum maturity (σ from 50-day average)', get: s => s.maturity?.distSMA50, scale: { kind: 'diverging', domain: 3 }, fmt: x => fin(x) ? x.toFixed(1) + ' σ' : 'n/a', kind: 'historical', asOf: priceTime, src: 'Yahoo daily closes' },
    eps: { label: 'Reported EPS, latest quarter vs year ago', get: s => s.epsYoY, scale: { kind: 'diverging', domain: 0.5 }, fmt: x => pc(x), kind: 'historical', asOf: filedTime, src: 'SEC 10-Q (reported; analyst revisions unavailable; 20-F filers have no quarterly XBRL)' },
  };
  const SIZE = {
    cap: { label: 'Market capitalisation (US$)', get: s => s.marketCapUSD, fmt: x => '$' + big(x), src: 'Filed share count × price, converted at Yahoo FX' },
    dvol: { label: 'Traded value (median daily US$, 1 month)', get: s => s.addv, fmt: x => '$' + big(x), src: 'Yahoo daily bars, converted at Yahoo FX' },
    turn: { label: 'Relative liquidity (daily turnover, % of shares)', get: s => s.turnover, fmt: x => pu(x, 2), src: 'Yahoo volume ÷ filed share count' },
    eq: { label: 'Equal size', get: () => 1, fmt: () => '', src: '' },
  };
  const GROUP = {
    sector: { label: 'Sector', key: s => s.sector },
    region: { label: 'Region', key: s => s.region || 'US' },
    regionSector: { label: 'Region, then sector', key: s => `${s.region === 'International' ? 'Intl' : 'US'} · ${s.sector}` },
    country: { label: 'Country', key: s => s.country || 'US' },
  };
  const kindOf = (c, s) => typeof c.kind === 'function' ? c.kind(s) : c.kind;

  // Colour of one value, honouring a centred diverging scale (e.g. a percentile centred on 0.5).
  function colourVal(v, sc) { return sc.center != null && fin(v) ? T.colour(v - sc.center, { ...sc, domain: sc.domain / 2 }) : T.colour(v, sc); }
  function scaleEnds(sc) { if (sc.kind !== 'diverging') return sc.domain.slice(); const c = sc.center ?? 0, h = sc.center != null ? sc.domain / 2 : sc.domain; return [c - h, c + h]; }
  function legendStops(key, n = 10) { const sc = COLOR[key].scale, [lo, hi] = scaleEnds(sc); return Array.from({ length: n + 1 }, (_, i) => ({ v: lo + (hi - lo) * i / n, fill: colourVal(lo + (hi - lo) * i / n, sc).fill })); }

  // How today's move relates to the valuation range. A rise while already above the range moves *away* from the
  // estimate; a rise while below it moves *toward* it. Describes, never forecasts.
  const FLAT = 0.005;
  function moveContext(s) {
    const m = s.change1d, st = s.valuation?.status;
    if (!fin(m)) return { code: 'none', text: "No 1-day move available." };
    const dir = Math.abs(m) < FLAT ? 'flat' : m > 0 ? 'up' : 'down', mv = dir === 'flat' ? `Little changed today (${pc(m)})` : `${dir === 'up' ? 'Up' : 'Down'} ${pc(Math.abs(m)).slice(1)} today`;
    if (st === 'above' || st === 'below') {
      const gap = st === 'above' ? s.valuation.high > 0 ? s.price / s.valuation.high - 1 : null : s.valuation.low > 0 ? 1 - s.price / s.valuation.low : null;
      const where = `${fin(gap) ? (100 * gap).toFixed(0) + ' % ' : ''}${st === 'above' ? 'above the optimistic' : 'below the conservative'} estimate`;
      if (dir === 'flat') return { code: 'flat', text: `${mv}, ${where}.` };
      const away = (st === 'above') === (dir === 'up');
      return { code: away ? 'away' : 'toward', text: `${mv} while ${where}: the move takes the price ${away ? 'further from' : 'back toward'} the estimated range. Not a forecast; the range itself is uncertain.` };
    }
    if (st === 'within') return { code: 'inside', text: `${mv}, inside the estimated valuation range.` };
    return { code: 'none', text: `${mv}. Valuation is ${st === 'uncertain' ? 'too uncertain' : 'unavailable'}, so the move cannot be put in valuation context.` };
  }

  // Everything the map needs to draw one tile.
  function tile(s, o = {}) {
    const c = COLOR[o.color] || COLOR.d1, v = c.get(s, o), col = colourVal(v, c.scale);
    const status = T.STATUS[s.valuation?.status] ? s.valuation.status : 'insufficient', st = T.STATUS[status];
    return { fill: col.fill, missing: col.missing, clipped: !!col.clipped, value: v, valueText: c.fmt(v, s), kind: kindOf(c, s), asOf: c.asOf(s, o),
      status, statusLabel: st.label, border: o.borders === false || !st.colour ? null : { style: st.border, colour: st.colour },
      marker: o.markers === false ? null : T.marker(s.price, s.valuation), context: moveContext(s), label: s.label || s.sym };
  }
  // Size value with a visible fallback: a missing size is drawn at the smallest known size and flagged.
  function sizes(stocks, key) {
    const sz = SIZE[key] || SIZE.cap, known = stocks.map(s => sz.get(s)).filter(x => fin(x) && x > 0), min = known.length ? Math.min(...known) : 1;
    return stocks.map(s => { const v = sz.get(s); return fin(v) && v > 0 ? { size: v, sizeMissing: false } : { size: min, sizeMissing: true }; });
  }
  return { COLOR, SIZE, GROUP, colourVal, scaleEnds, legendStops, moveContext, tile, sizes, retFrom, kindOf, FLAT };
});
