// Live price → closed-form function. Pure maths first (testable in Node), page code after.
(function (root) {
  'use strict';

  // Solve A·x = b (A symmetric positive definite, small) by Gaussian elimination with partial pivoting.
  function solve(A, b) {
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-300) continue;
      for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = M[r][r] ? s / M[r][r] : 0; }
    return x;
  }

  // Least squares on a sine basis sin(kπ(x+T)/T), k = 1..K, with a small ridge so short or gappy windows stay stable.
  function sineFit(xs, ys, T, K) {
    K = Math.max(0, Math.min(K, Math.floor(xs.length / 2)));
    if (!K) return [];
    const A = Array.from({ length: K }, () => new Array(K).fill(0)), b = new Array(K).fill(0), phi = new Array(K);
    for (let i = 0; i < xs.length; i++) {
      for (let k = 0; k < K; k++) phi[k] = Math.sin((k + 1) * Math.PI * (xs[i] + T) / T);
      for (let a = 0; a < K; a++) { b[a] += phi[a] * ys[i]; for (let c = 0; c <= a; c++) A[a][c] += phi[a] * phi[c]; }
    }
    for (let a = 0; a < K; a++) { for (let c = 0; c < a; c++) A[c][a] = A[a][c]; A[a][a] += 1e-6 * xs.length; }
    return solve(A, b);
  }

  // Unit so the coefficients are readable: 1 pip for FX (0.0001, or 0.01 for JPY), about 1/10 000 of the price otherwise.
  const unitFor = (price, fx, pair) => fx ? (/JPY/.test(pair) ? 0.01 : 0.0001) : Math.pow(10, Math.floor(Math.log10(price)) - 4);

  // bars: [{t (ms), c, v, tb}] oldest first. now: ms. Returns the function and its fit quality.
  //   P(x) = p0 + u·( m·x + Σ a_k sin(ω_k (x+T)) ),  x = minutes from now (x = 0 is now, x = −T the window start)
  // The straight line through the first and last price is removed first, so P passes exactly through the latest price.
  function fitPrice(bars, now, K, unit) {
    const T = +((now - bars[0].t) / 60000).toFixed(3), p0 = bars[bars.length - 1].c, pS = bars[0].c;
    const m = (p0 - pS) / unit / T;                                  // units per minute
    const xs = bars.map(b => (b.t - now) / 60000);
    const rs = bars.map((b, i) => (b.c - p0) / unit - m * xs[i]);    // residual from the end-to-end line, in units
    const a = sineFit(xs, rs, T, K);
    const f = x => { let s = m * x; for (let k = 0; k < a.length; k++) s += a[k] * Math.sin((k + 1) * Math.PI * (x + T) / T); return p0 + unit * s; };
    let se = 0; bars.forEach((b, i) => { se += ((f(xs[i]) - b.c) / unit) ** 2; });
    return { T, p0, m, a, unit, f, rms: Math.sqrt(se / bars.length), n: bars.length };
  }

  // Buy pressure in [−1, 1] per bar = 2·(buy volume / volume) − 1, fitted as c + Σ b_k sin(...) (no endpoint constraint).
  function fitPressure(bars, now, T, K) {
    const pts = bars.filter(b => b.v > 0).map(b => ({ x: (b.t - now) / 60000, y: 2 * b.tb / b.v - 1 }));
    if (pts.length < 8) return null;
    const c = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const b = sineFit(pts.map(p => p.x), pts.map(p => p.y - c), T, K);
    const f = x => { let s = c; for (let k = 0; k < b.length; k++) s += b[k] * Math.sin((k + 1) * Math.PI * (x + T) / T); return Math.max(-1, Math.min(1, s)); };
    return { c, b, f, n: pts.length };
  }

  // ---- formula text ----
  const dp = u => Math.max(0, -Math.round(Math.log10(u)));
  const fmt = (v, d) => { const s = v.toFixed(d); return /^-?0\.?0*$/.test(s) ? '0' : s; };
  const sgn = s => s.startsWith('-') ? ' - ' + s.slice(1) : ' + ' + s;
  const omega = (k, T) => +((k * Math.PI / T).toPrecision(9));
  const tStr = T => fmt(T, 3);

  // style: 'geogebra' (plain text) or 'desmos' (LaTeX that Desmos accepts when pasted)
  function priceFormula(F, style, name = 'P') {
    const L = style === 'desmos', inner = [];
    const m = fmt(F.m, 4); if (m !== '0') inner.push(`${m}${L ? '' : '*'}x`);
    F.a.forEach((a, k) => {
      const s = fmt(a, 3); if (s === '0') return;
      const arg = `${omega(k + 1, F.T)}${L ? '' : '*'}(x+${tStr(F.T)})`;
      inner.push(L ? `${s}\\sin\\left(${arg}\\right)` : `${s}*sin(${arg})`);
    });
    const body = inner.length ? inner.reduce((acc, s, i) => i ? acc + sgn(s) : s, '') : '0';
    const p0 = String(+F.p0.toPrecision(10)), u = String(+F.unit.toPrecision(3));
    return L ? `${name}\\left(x\\right)=${p0}+${u}\\left(${body}\\right)\\left\\{-${tStr(F.T)}\\le x\\le0\\right\\}`
             : `${name}(x)=If(-${tStr(F.T)}<=x<=0, ${p0}+${u}*(${body}))`;
  }
  function pressureFormula(B, T, style, name = 'B') {
    const L = style === 'desmos'; let s = fmt(B.c, 3);
    B.b.forEach((b, k) => { const v = fmt(b, 3); if (v === '0') return; const arg = `${omega(k + 1, T)}${L ? '' : '*'}(x+${tStr(T)})`; s += sgn(L ? `${v}\\sin\\left(${arg}\\right)` : `${v}*sin(${arg})`); });
    return L ? `${name}\\left(x\\right)=${s}\\left\\{-${tStr(T)}\\le x\\le0\\right\\}` : `${name}(x)=If(-${tStr(T)}<=x<=0, ${s})`;
  }

  const api = { solve, sineFit, fitPrice, fitPressure, priceFormula, pressureFormula, unitFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FN = api;
})(this);

// ---- page ----
if (typeof document !== 'undefined') (function () {
  'use strict';
  const $ = id => document.getElementById(id), FN = window.FN;
  const WINDOWS = { '15m': ['1s', 900e3], '1h': ['1m', 3600e3], '4h': ['1m', 4 * 3600e3], '16h': ['1m', 16 * 3600e3] };
  let ggb = null, ggbMode = null, busy = false, last = null, lastSet = '';

  const qs = new URLSearchParams(location.search);
  for (const id of ['sym', 'win', 'K', 'mode']) if (qs.get(id)) $(id).value = qs.get(id);

  async function bars() {
    const sym = $('sym').value, [iv, span] = WINDOWS[$('win').value], fx = sym.startsWith('FX:');
    const url = fx ? `/api/fx/bars?pair=${encodeURIComponent(sym.slice(3))}&interval=${iv}` : `/api/klines?symbol=${sym}&interval=${iv}`;
    const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
    const raw = await r.json();
    let bs = fx ? raw.map(b => ({ t: b.t, c: b.c, v: b.v || 0, tb: b.tb || 0 }))
                : raw.map(k => ({ t: +k[0], c: +k[4], v: +k[5], tb: +k[9] }));
    const ms = iv === '1s' ? 1e3 : 60e3;
    bs = bs.map(b => ({ ...b, t: b.t + ms }));                     // a bar's close happens at the end of its interval
    const now = Math.max(Date.now(), bs.length ? bs[bs.length - 1].t : 0);
    bs = bs.filter(b => b.t > now - span && Number.isFinite(b.c));
    return { sym, fx, bs, now };
  }

  function loadGGB(mode) {
    if (ggbMode === mode) return; ggbMode = mode; ggb = null; lastSet = '';
    $('ggb').innerHTML = '<div id="ggbApp"></div>';
    const params = {
      appName: mode === '3d' ? '3d' : 'graphing', width: $('ggb').clientWidth, height: $('ggb').clientHeight,
      showToolBar: false, showAlgebraInput: true, showMenuBar: false, showResetIcon: true, enableShiftDragZoom: true,
      perspective: mode === '3d' ? 'AT' : 'AG', language: 'en',
      appletOnLoad: a => { ggb = a; draw(true); },
    };
    new window.GGBApplet(params, true).inject('ggbApp');
  }

  function rgb(name, r, g, b, thick) { ggb.setColor(name, r, g, b); if (thick) ggb.setLineThickness(name, thick); }

  function push(view, fresh) {
    if (!ggb) return;
    const { F, B, pts, mode } = view;
    const cmds = [F.geogebra];
    cmds.push(B ? B.geogebra : "B(x)=0");
    const yLo = Math.min(...pts.map(p => p.y)), yHi = Math.max(...pts.map(p => p.y)), pad = (yHi - yLo) * 0.08 || F.unit * 5;
    if (mode === '3d') {
      const u = String(+F.unit.toPrecision(3)), p0 = F.p0;
      cmds.push(`c = Curve(t, (P(t)-${p0})/${u}, 100*B(t), t, -${F.T.toFixed(3)}, 0)`);
      cmds.push(`Now = (0, 0, ${B ? (100 * B.f(0)).toFixed(1) : 0})`);
    } else {
      cmds.push(`Now = (0, ${F.p0})`);
      if ($('raw').checked) {
        const step = Math.max(1, Math.ceil(pts.length / 400));
        const list = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(p => `(${p.x.toFixed(4)},${+p.y.toPrecision(10)})`).join(',');
        cmds.push(`data = Polyline(${list})`);
      } else cmds.push('Delete(data)');
    }
    const key = cmds.join('\n');
    if (key === lastSet && !fresh) return;
    lastSet = key;
    for (const c of cmds) ggb.evalCommand(c);
    if (mode === '3d') {
      rgb('c', 0, 200, 120, 6);
      if (fresh) ggb.evalCommand(`ZoomIn(-${F.T.toFixed(3)}, ${((yLo - pad - F.p0) / F.unit).toFixed(1)}, -100, 0, ${((yHi + pad - F.p0) / F.unit).toFixed(1)}, 100)`);
    } else {
      rgb('P', 0, 170, 110, 5); if (ggb.exists('data')) { rgb('data', 120, 120, 120, 2); }
      if (fresh) ggb.evalCommand(`ZoomIn(-${(F.T * 1.02).toFixed(3)}, ${yLo - pad}, ${(F.T * 0.04).toFixed(3)}, ${yHi + pad})`);
    }
    rgb('Now', 255, 61, 113); ggb.setPointSize?.('Now', 5);
    if (ggb.exists('B')) ggb.setVisible('B', false);
  }

  async function draw(fresh) {
    if (busy) return; busy = true;
    try {
      const { sym, fx, bs, now } = await bars();
      if (bs.length < 10) { $('status').textContent = 'Not enough bars yet for this window (' + bs.length + '). Try a shorter one or wait.'; return; }
      const K = +$('K').value, unit = FN.unitFor(bs[bs.length - 1].c, fx, sym.slice(3));
      const F = FN.fitPrice(bs, now, K, unit), Bf = FN.fitPressure(bs, now, F.T, Math.min(K, 20));
      F.geogebra = FN.priceFormula(F, 'geogebra'); F.desmos = FN.priceFormula(F, 'desmos');
      const B = Bf && { ...Bf, geogebra: FN.pressureFormula(Bf, F.T, 'geogebra'), desmos: FN.pressureFormula(Bf, F.T, 'desmos') };
      const pts = bs.map(b => ({ x: (b.t - now) / 60000, y: b.c }));
      last = { F, B, pts, mode: $('mode').value, sym, fx };
      if (ggbMode !== last.mode) loadGGB(last.mode); else push(last, fresh);
      $('fDesmos').value = F.desmos + (B ? '\n' + B.desmos : '');
      $('fGeo').value = F.geogebra + (B ? '\n' + B.geogebra : '') + (last.mode === '3d' ? `\nc=Curve(t, (P(t)-${F.p0})/${String(+unit.toPrecision(3))}, 100*B(t), t, -${F.T.toFixed(3)}, 0)` : '');
      $('stats').innerHTML = `<b>${sym.replace('FX:', '')}</b> now <b>${F.p0}</b> · window ${F.T.toFixed(1)} min, ${F.n} bars · ${F.a.length} harmonics` +
        ` · fit error <b>${fx ? F.rms.toFixed(2) + " pip" : "$" + (F.rms * unit).toPrecision(3)}</b> RMS` + (B ? ` · buy pressure now <b>${(100 * B.f(0)).toFixed(0)}%</b>` : '');
      $('status').textContent = `Updated ${new Date().toLocaleTimeString()}. x = minutes from now (0 = now).`;
    } catch (e) { $('status').textContent = 'Error: ' + e.message; }
    finally { busy = false; }
  }

  for (const id of ['sym', 'win', 'K', 'mode', 'raw']) $(id).addEventListener('change', () => {
    history.replaceState(null, '', '?' + ['sym', 'win', 'K', 'mode'].map(k => k + '=' + encodeURIComponent($(k).value)).join('&'));
    if (id === 'mode') loadGGB($('mode').value); else draw(true);
  });
  $('K').addEventListener('input', () => { $('Kv').textContent = $('K').value; });
  $('Kv').textContent = $('K').value;
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const t = $(b.dataset.copy); try { await navigator.clipboard.writeText(t.value); } catch { t.select(); document.execCommand('copy'); }
    b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200);
  }));
  $('live').addEventListener('change', () => { $('live').checked && draw(false); });
  setInterval(() => { if ($('live').checked && !document.hidden) draw(false); }, 1000);
  loadGGB($('mode').value);
  draw(true);
})();
