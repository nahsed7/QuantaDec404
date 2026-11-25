// Heat-map geometry and visual encodings (pure functions, testable without a browser).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats'));
  else root.QTree = factory(root.QStats);
})(this, function (S) {
  'use strict';
  const fin = S.fin;

  // Squarified treemap (Bruls, Huizing & van Wijk 2000). items: [{value, ...}] → same items with x, y, w, h.
  function squarify(items, x, y, w, h) {
    const tot = S.sum(items.map(i => i.value)); if (!(tot > 0) || w <= 0 || h <= 0) return [];
    const scale = (w * h) / tot, nodes = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value).map(i => ({ ...i, area: i.value * scale })), out = [];
    let row = [], rect = { x, y, w, h };
    const worst = (r, side) => { const s = S.sum(r.map(n => n.area)), mx = Math.max(...r.map(n => n.area)), mn = Math.min(...r.map(n => n.area)); return Math.max(side * side * mx / (s * s), (s * s) / (side * side * mn)); };
    const lay = (r) => {
      const s = S.sum(r.map(n => n.area)), horiz = rect.w >= rect.h, side = horiz ? rect.h : rect.w, thick = s / side; let off = 0;
      for (const n of r) { const len = n.area / thick; out.push(horiz ? { ...n, x: rect.x, y: rect.y + off, w: thick, h: len } : { ...n, x: rect.x + off, y: rect.y, w: len, h: thick }); off += len; }
      rect = horiz ? { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h } : { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
    };
    for (const n of nodes) {
      const side = Math.min(rect.w, rect.h);
      if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n); else { lay(row); row = [n]; }
    }
    if (row.length) lay(row);
    return out;
  }

  // Two-level layout: sectors, then companies inside each sector (with a header strip).
  function layout(stocks, W, H, header = 16, pad = 2) {
    const groups = {}; for (const s of stocks) if (s.size > 0) (groups[s.sector] ||= []).push(s);
    const sec = squarify(Object.entries(groups).map(([k, v]) => ({ id: k, value: S.sum(v.map(s => s.size)), members: v })), 0, 0, W, H);
    const tiles = [];
    for (const g of sec) {
      const hh = g.h > header * 3 ? header : 0;
      for (const t of squarify(g.members.map(s => ({ ...s, value: s.size })), g.x + pad, g.y + hh + pad, g.w - 2 * pad, g.h - hh - 2 * pad)) tiles.push(t);
      g.header = hh;
    }
    return { sectors: sec.map(({ members, ...g }) => ({ ...g, count: members.length })), tiles };
  }

  // Colour scales. Diverging for signed quantities (red–grey–green), sequential for magnitudes. Missing → hatched grey.
  const DIV = [[0, [214, 39, 70]], [0.5, [62, 70, 80]], [1, [0, 200, 120]]];
  const SEQ = [[0, [30, 50, 70]], [0.5, [60, 140, 200]], [1, [250, 210, 90]]];
  function ramp(stops, t) {
    t = S.clamp(t, 0, 1); let i = 0; while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const [a, ca] = stops[i], [b, cb] = stops[i + 1], u = (t - a) / (b - a || 1);
    return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * u)).join(',')})`;
  }
  // kind: 'diverging' (domain ±d around 0, optionally inverted) or 'sequential' (domain [lo, hi]).
  function colour(value, scale) {
    if (!fin(value)) return { fill: null, missing: true };
    if (scale.kind === 'diverging') { const t = 0.5 + (scale.invert ? -1 : 1) * value / (2 * scale.domain); return { fill: ramp(DIV, t), t: S.clamp(t, 0, 1), clipped: Math.abs(value) > scale.domain }; }
    const t = (value - scale.domain[0]) / (scale.domain[1] - scale.domain[0]); return { fill: ramp(scale.invert ? [...SEQ].reverse().map(([p, c]) => [1 - p, c]) : SEQ, t), t: S.clamp(t, 0, 1), clipped: t < 0 || t > 1 };
  }

  // Valuation marker: position of the price inside [low, high], drawn as a tick on a small bar. null if no range.
  function marker(price, v) {
    if (!v || !fin(price) || !fin(v.low) || !fin(v.high) || !(v.high > v.low)) return null;
    const lo = Math.min(v.low, price) , hi = Math.max(v.high, price), span = hi - lo;
    return { low: (v.low - lo) / span, base: fin(v.base) ? (v.base - lo) / span : null, high: (v.high - lo) / span, price: (price - lo) / span };
  }
  const STATUS = {
    below: { label: 'Below estimated range', border: 'solid', colour: '#00e5ff' },
    within: { label: 'Within estimated range', border: 'none', colour: null },
    above: { label: 'Above estimated range', border: 'solid', colour: '#ff4fd8' },
    uncertain: { label: 'Too uncertain to classify', border: 'dashed', colour: '#ffd166' },
    insufficient: { label: 'Insufficient data', border: 'dotted', colour: '#8a94a0' },
  };
  return { squarify, layout, colour, ramp, marker, STATUS };
});
