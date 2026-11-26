/* §2 "10-D" market scene: an animated WebGL view of the market (Three.js, loaded from the jsDelivr CDN).
 *
 * Default view, LIVE FOCUS: the camera is locked onto the current price dot and follows it tick by tick. Only the
 * last few dozen bars are in frame, the axes zoom smoothly around recent movement, and a glowing trail shows the
 * individual quotes that led to the current price. A badge says how fast the price is moving right now.
 *
 * The whole-period views (3D, Front, Top, Side) show the full sample. The idea that keeps them readable: the BACK
 * WALL is the ordinary price chart (time → right, price ↑) and every bar is a dot that sticks OUT of that wall by its
 * value on the chosen third axis. Front = the price chart, Top = third axis over time, Side = third axis vs price.
 *
 * Everything is placed every frame from a smoothly moving "window" (the data range in frame), so zooms, view changes
 * and new data glide instead of jumping. "Explain it to me" walks through one dimension at a time.
 *
 * app.js builds the model (data units + colours) and calls Scene3D.update(model); quotes go to Scene3D.live(mid, t).
 * If Three.js cannot be loaded (offline), Scene3D.failed is set and app.js falls back to the Plotly chart.
 */
(function () {
  'use strict';
  const THREE_URL = window.THREE_URL || 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
  const W = 3.6, H = 2.0, D = 1.6;            // world box: time (x) × price (y) × third axis (z, toward the viewer)
  const CAP = 1200;                           // instanced-mesh capacity per marker shape
  const LIVE_BARS = 36;                       // bars kept in frame in live focus
  const VIEWS = {
    live:  { th: 0.5, ph: 1.24, r: 3.1, label: '● Live focus', live: true },
    '3d':  { th: 0.62, ph: 1.12, r: 6.4, label: 'Whole period' },
    front: { th: 0, ph: Math.PI / 2, r: 5.6, label: 'Front' },
    top:   { th: 0, ph: 0.0001, r: 5.9, label: 'Top' },
    side:  { th: Math.PI / 2, ph: Math.PI / 2, r: 5.0, label: 'Side' },
  };
  const TITLES = { live: 'Follows the current price', '3d': 'The whole sample in 3D', front: 'Whole period: the price chart (price vs time)',
                   top: 'Whole period from above: the third axis over time', side: 'Whole period from the side: the third axis vs price' };
  const S = { ready: false, failed: false, loading: null, root: null, T: null, model: null, bars: new Map(), order: [], active: () => true,
              cam: { ...VIEWS.live, tgt: [0, H / 2, 0] }, viewName: 'live', live: true, tween: null, rotate: false, layers: {}, focus: null, fade: {},
              hoverBar: null, tour: -1, tourTimer: 0, onPick: null, lastTs: 0, rng: null, trail: [], liveP: null, moves: [], dragging: false };
  const Scene3D = { get ready() { return S.ready; }, get failed() { return S.failed; } };
  window.Scene3D = Scene3D;
  if (window.__dbg) Scene3D._s = () => S;     // test hook (headless tests only)

  /* ---------- colour helpers (shared with app.js) ---------- */
  const VIRIDIS = [[0, '#440154'], [0.25, '#3b528b'], [0.5, '#21918c'], [0.75, '#5ec962'], [1, '#fde725']];
  const hex = c => { c = String(c).trim();
    if (c.startsWith('#')) { if (c.length === 4) c = '#' + [...c.slice(1)].map(x => x + x).join(''); const n = parseInt(c.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    const m = c.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : [128, 128, 128]; };
  /** Colour at t ∈ [0,1] on a Plotly-style colourscale ([[stop, colour], …] or 'Viridis'). Returns [r,g,b] 0–255. */
  function scaleRGB(stops, t) {
    if (!Array.isArray(stops)) stops = VIRIDIS;
    t = Math.min(1, Math.max(0, isFinite(t) ? t : 0.5));
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], u = (t - a) / ((b - a) || 1), A = hex(ca), B = hex(cb);
      return A.map((v, k) => v + (B[k] - v) * u);
    }
    return hex(stops[stops.length - 1][1]);
  }
  const cssGrad = stops => `linear-gradient(90deg, ${(Array.isArray(stops) ? stops : VIRIDIS).map(([s, c]) => `${c} ${100 * s}%`).join(', ')})`;
  Scene3D.scaleRGB = scaleRGB; Scene3D.cssGrad = cssGrad;

  const cssv = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const dark = () => cssv('--mode') !== 'light';
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;     // easeInOutCubic
  const nice = (range, n) => { const raw = range / n || 1, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
  const ticks = (lo, hi, n) => { if (!(hi > lo)) return { v: [lo], step: 1 }; const s = nice(hi - lo, n), out = []; for (let v = Math.ceil(lo / s) * s; v <= hi + s * 1e-9; v += s) out.push(+v.toPrecision(12)); return { v: out, step: s }; };
  const short = v => { const a = Math.abs(v); return a >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : a >= 100 ? v.toFixed(0) : +v.toPrecision(3) + ''; };
  const byStep = (v, step) => v.toFixed(Math.max(0, Math.min(8, -Math.floor(Math.log10(step)))));   // price labels: as many decimals as the grid needs
  const lerpA = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

  /* ---------- guided tour (whole-period views; it ends back in live focus) ---------- */
  const TOUR = [
    { v: 'front', on: ['path', 'now', 'walls'], h: 'Start with the price chart you know',
      t: 'Zoomed out to the whole sample. The glowing line on the back wall is the price: time runs left → right and <b>0 is now</b>. The pulsing dot is the live price.' },
    { v: 'front', on: ['path', 'now', 'walls', 'bars'], h: 'Each dot is one bar',
      t: 'Every dot sits at that bar’s time and closing price, so from the front the dots trace the same line.' },
    { v: '3d', on: ['path', 'now', 'walls', 'bars', 'stems'], h: 'Turn it: depth is {Z}',
      t: 'Now the chart is turned. Each dot <b>sticks out of the wall</b> by its {Z}: the longer the stem, the higher the {Z} in that bar.' },
    { v: 'top', on: ['walls', 'bars', 'stems'], h: 'From above: {Z} over time',
      t: 'Looking straight down, left → right is still time, and the distance from the wall is {Z}. Spikes show bursts of {Z}.' },
    { v: '3d', on: ['walls', 'bars'], h: 'Colour is {C}', legend: 'colour',
      t: 'Dot colour shows {C}, using the colour bar at the bottom left.' },
    { v: '3d', on: ['walls', 'bars'], h: 'Size and shape', legend: 'shape',
      t: '<b>Bigger dots</b> had more orders waiting in the book (more liquidity). <b>Shape</b> shows who pushed the price: ◆ buyers, ■ sellers, ● balanced. Faded dots are from before the order book was being recorded.' },
    { v: 'side', on: ['walls', 'bars', 'stems'], h: 'Stem colour is the order book',
      t: 'A <b class="up">green stem</b> means more buy orders were waiting than sell orders; <b class="down">red</b> means more sell orders.' },
    { v: 'front', on: ['walls', 'path', 'now', 'cloud'], h: 'The violet cloud: where price went next, in the past',
      t: 'To the right of now, the cloud shows where the price ended up after similar stretches in this sample: denser means more often, dashed lines are the 5 % and 95 % range. It describes the past, <b>not a prediction</b>.' },
    { v: 'live', on: null, h: 'Back to live focus',
      t: 'The camera now locks onto the <b>current price</b> and follows every quote. The bright trail is the last quotes, the badge at the top says how fast price is moving. <b>Drag</b> to turn, <b>pinch</b> to zoom, <b>tap a dot</b> for an explanation, <b>double-tap</b> to come back here.' },
  ];

  /* ---------- DOM ---------- */
  function buildDom(root) {
    root.classList.add('s3');
    root.innerHTML = `
      <canvas class="s3-cv"></canvas>
      <div class="s3-labels"></div>
      <div class="s3-tip" hidden></div>
      <div class="s3-top">
        <div class="s3-views" id="views">${Object.entries(VIEWS).map(([k, v]) => `<button class="s3-btn${k === 'live' ? ' s3-live' : ''}" data-v="${k}" title="${TITLES[k]}">${v.label}</button>`).join('')}
          <button class="s3-btn" data-v="rotate" title="Slowly turn the scene">⟳</button></div>
        <div class="s3-right"><button class="s3-btn s3-cta" data-a="tour">▶ Explain it to me</button><button class="s3-btn" data-a="full" title="Full screen">⛶</button></div>
      </div>
      <div class="s3-pulse" hidden></div>
      <div class="s3-legend"></div>
      <div class="s3-tour" hidden>
        <div class="s3-tour-h"><span class="s3-step"></span><b class="s3-th"></b><button class="s3-btn s3-x" data-a="tourx" title="Close">✕</button></div>
        <div class="s3-tt"></div>
        <div class="s3-dots"></div>
        <div class="s3-tour-nav"><button class="s3-btn" data-a="prev">← Back</button><button class="s3-btn" data-a="auto">⏵ Auto-play</button><button class="s3-btn s3-cta" data-a="next">Next →</button></div>
      </div>
      <div class="s3-msg">Loading the 3D engine…</div>`;
    const q = s => root.querySelector(s);
    S.el = { cv: q('.s3-cv'), labels: q('.s3-labels'), tip: q('.s3-tip'), legend: q('.s3-legend'), tour: q('.s3-tour'), msg: q('.s3-msg'), views: q('.s3-views'), pulse: q('.s3-pulse') };
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-v],[data-a]'); if (!b) return;
      const v = b.dataset.v, a = b.dataset.a;
      if (v === 'rotate') { S.rotate = !S.rotate; markViews(); }
      else if (v) { stopTour(); setView(v); }
      else if (a === 'tour') S.tour >= 0 ? stopTour() : startTour();
      else if (a === 'tourx') stopTour();
      else if (a === 'next') tourStep(S.tour + 1);
      else if (a === 'prev') tourStep(Math.max(0, S.tour - 1));
      else if (a === 'auto') { S.tourAuto = !S.tourAuto; S.tourTimer = performance.now(); b.classList.toggle('on', S.tourAuto); }
      else if (a === 'full') toggleFull();
    });
    document.addEventListener('keydown', e => {
      if (!S.ready || !S.active() || /input|select|textarea/i.test(document.activeElement?.tagName || '')) return;
      if (e.key === 'Escape' && root.classList.contains('s3-max')) toggleFull();
      if (S.tour >= 0 && e.key === 'ArrowRight') tourStep(S.tour + 1);
      if (S.tour >= 0 && e.key === 'ArrowLeft') tourStep(Math.max(0, S.tour - 1));
    });
  }
  function markViews() {
    S.el.views.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === 'rotate' ? S.rotate : b.dataset.v === S.viewName));
  }
  function toggleFull() {
    const r = S.root, on = !r.classList.contains('s3-max');
    if (on && r.requestFullscreen && !/iPhone|iPad/.test(navigator.userAgent)) r.requestFullscreen().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    r.classList.toggle('s3-max', on); document.body.classList.toggle('s3-lock', on);
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.root) { S.root.classList.remove('s3-max'); document.body.classList.remove('s3-lock'); } });

  /* ---------- engine ---------- */
  /** Create the scene inside `root`. `opts.active()` says whether the scene is on screen (rendering pauses otherwise). */
  Scene3D.init = function (root, opts = {}) {
    if (S.loading) return S.loading;
    S.root = root; S.active = opts.active || S.active; S.onPick = opts.onPick || null; S.layers = opts.layers || {};
    buildDom(root);
    S.loading = import(THREE_URL).then(T => { S.T = T; setup(); S.ready = true; S.el.msg.hidden = true; if (S.model) apply(S.model); requestAnimationFrame(frame); })
      .catch(e => { console.error('3D engine failed to load', e); S.failed = true; S.el.msg.textContent = 'The 3D engine could not be loaded (offline?). Showing the basic chart instead.'; opts.onFail?.(); });
    return S.loading;
  };

  function setup() {
    const T = S.T, cv = S.el.cv;
    const R = S.R = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance' });
    R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    R.localClippingEnabled = true;
    // data outside the box (older bars in live focus, cloud beyond the price range) is clipped away
    S.clip = [new T.Plane(new T.Vector3(1, 0, 0), W / 2 + 0.04), new T.Plane(new T.Vector3(-1, 0, 0), W / 2 + 0.04),
              new T.Plane(new T.Vector3(0, 1, 0), 0.04), new T.Plane(new T.Vector3(0, -1, 0), H + 0.04)];
    const sc = S.scene = new T.Scene();
    S.camera = new T.PerspectiveCamera(34, 1, 0.05, 100);
    sc.add(new T.AmbientLight(0xffffff, 0.75));
    const dl = new T.DirectionalLight(0xffffff, 1.4); dl.position.set(3, 5, 4); sc.add(dl);
    const dl2 = new T.DirectionalLight(0xffffff, 0.45); dl2.position.set(-4, 2, -3); sc.add(dl2);

    // walls: back (price × time), floor (third axis × time), left (third axis × price)
    S.g = {};
    const wallMat = () => new T.MeshBasicMaterial({ transparent: true, opacity: 0.05, side: T.DoubleSide, depthWrite: false });
    const back = new T.Mesh(new T.PlaneGeometry(W, H), wallMat()); back.position.set(0, H / 2, -D / 2);
    const floor = new T.Mesh(new T.PlaneGeometry(W, D), wallMat()); floor.rotation.x = -Math.PI / 2;
    const left = new T.Mesh(new T.PlaneGeometry(D, H), wallMat()); left.rotation.y = Math.PI / 2; left.position.set(-W / 2, H / 2, 0);
    S.g.walls = new T.Group(); S.g.walls.add(back, floor, left); sc.add(S.g.walls);
    S.wallMeshes = [back, floor, left];
    S.grid = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })); S.g.walls.add(S.grid);
    S.zero = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ transparent: true, opacity: 0.7 })); S.g.walls.add(S.zero);

    const clipped = m => { m.clippingPlanes = S.clip; return m; };
    // bars: one instanced mesh per marker shape
    const mat = () => clipped(new T.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1, transparent: true, opacity: 1 }));
    S.shapes = {
      flat: new T.InstancedMesh(new T.SphereGeometry(1, 14, 10), mat(), CAP),
      buy: new T.InstancedMesh(new T.OctahedronGeometry(1.25), mat(), CAP),
      sell: new T.InstancedMesh(new T.BoxGeometry(1.5, 1.5, 1.5), mat(), CAP),
    };
    S.g.bars = new T.Group();
    for (const m of Object.values(S.shapes)) { m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.setColorAt(0, new T.Color()); m.count = 0; m.frustumCulled = false; S.g.bars.add(m); }
    sc.add(S.g.bars);
    S.sel = new T.Mesh(new T.TorusGeometry(1, 0.12, 8, 32), new T.MeshBasicMaterial({ transparent: true })); S.sel.visible = false; sc.add(S.sel);

    const lineGeo = n => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage)); return g; };
    S.g.stems = new T.LineSegments(lineGeo(CAP * 2), clipped(new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }))); S.g.stems.frustumCulled = false; sc.add(S.g.stems);
    S.g.path = new T.Group(); sc.add(S.g.path);
    S.path = new T.Line(lineGeo(CAP), clipped(new T.LineBasicMaterial({ vertexColors: true, transparent: true }))); S.path.frustumCulled = false; S.g.path.add(S.path);
    S.g.cloud = new T.Group(); sc.add(S.g.cloud);
    S.cloud = new T.Points(new T.BufferGeometry(), clipped(new T.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true })));
    S.cloud.frustumCulled = false; S.g.cloud.add(S.cloud);
    S.qlines = ['q05', 'q50', 'q95'].map(k => { const l = new T.Line(new T.BufferGeometry(), clipped(k === 'q50' ? new T.LineBasicMaterial({ transparent: true }) : new T.LineDashedMaterial({ transparent: true, dashSize: 0.05, gapSize: 0.04 })));
      l.frustumCulled = false; S.g.cloud.add(l); return l; });
    // live price: pulsing core + halo + level line + a trail of the latest quotes that leads into the dot
    S.g.now = new T.Group(); sc.add(S.g.now);
    S.nowDot = new T.Mesh(new T.SphereGeometry(0.035, 20, 14), new T.MeshBasicMaterial({ transparent: true }));
    S.nowHalo = new T.Mesh(new T.SphereGeometry(0.035, 20, 14), new T.MeshBasicMaterial({ transparent: true, opacity: 0.3, blending: T.AdditiveBlending, depthWrite: false }));
    S.nowLine = new T.Line(new T.BufferGeometry(), new T.LineDashedMaterial({ transparent: true, dashSize: 0.06, gapSize: 0.05 })); S.nowLine.frustumCulled = false;
    S.nowDrop = new T.Line(new T.BufferGeometry(), new T.LineDashedMaterial({ transparent: true, dashSize: 0.03, gapSize: 0.03 })); S.nowDrop.frustumCulled = false;
    S.trail = new T.Line(lineGeo(3000), clipped(new T.LineBasicMaterial({ vertexColors: true, transparent: true }))); S.trail.frustumCulled = false;
    S.trailWall = new T.Line(S.trail.geometry.clone(), clipped(new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 }))); S.trailWall.frustumCulled = false;
    S.g.now.add(S.nowDot, S.nowHalo, S.nowLine, S.nowDrop, S.trail, S.trailWall);

    bindPointer(cv);
    new ResizeObserver(resize).observe(S.root); resize();
    applyTheme();
    new MutationObserver(() => { applyTheme(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    for (const k of ['walls', 'bars', 'stems', 'path', 'cloud', 'now']) S.fade[k] = 1;
    markViews();
  }

  function applyTheme() {
    if (!S.T) return;
    const T = S.T, c = v => new T.Color(cssv(v) || '#888');
    S.col = { acc: c('--accent'), acc2: c('--accent2'), vio: c('--violet'), warn: c('--warn'), muted: c('--muted'), text: c('--text'), buy: c('--buy'), sell: c('--sell') };
    for (const w of S.wallMeshes) w.material.color = S.col.acc;
    S.grid.material.color = S.col.muted; S.zero.material.color = S.col.acc;
    S.sel.material.color = S.col.warn;
    S.nowLine.material.color = S.col.acc; S.nowDrop.material.color = S.col.acc;
    S.qlines.forEach(l => { l.material.color = S.col.vio; });
    const d = dark();
    for (const m of Object.values(S.shapes)) { m.material.emissive = new T.Color(d ? 0x0a1a12 : 0x000000); m.material.emissiveIntensity = d ? 1 : 0; }
    S.trail.material.blending = d ? T.AdditiveBlending : T.NormalBlending; S.trail.material.needsUpdate = true;
    S.cloudRef = null;                                  // recolour the cloud
  }

  function resize() {
    if (!S.R) return;
    const r = S.root.getBoundingClientRect(); if (!r.width || !r.height) return;
    S.R.setSize(r.width, r.height, false); S.el.cv.style.width = r.width + 'px'; S.el.cv.style.height = r.height + 'px';
    S.camera.aspect = r.width / r.height;
    S.camera.fov = r.width / r.height < 1 ? 52 : r.width / r.height < 1.4 ? 42 : 34;     // keep the box in frame on portrait phones
    S.camera.updateProjectionMatrix(); S.w = r.width; S.h = r.height;
  }

  /* ---------- camera: spherical orbit with animated moves ---------- */
  function setView(name, ms = 1100) {
    const v = VIEWS[name]; if (!v) return;
    S.viewName = name; S.live = !!v.live; S.rotate = false; markViews();
    let th0 = S.cam.th % (2 * Math.PI); if (th0 > Math.PI) th0 -= 2 * Math.PI; if (th0 < -Math.PI) th0 += 2 * Math.PI; S.cam.th = th0;
    S.tween = { t0: performance.now(), ms, from: { th: S.cam.th, ph: S.cam.ph, r: S.cam.r, tgt: S.cam.tgt.slice() }, to: { th: v.th, ph: v.ph, r: v.r, tgt: [0, H / 2, 0] } };
    S.el.pulse.hidden = !S.live;
  }
  Scene3D.setView = setView;
  function placeCamera() {
    const { th, ph, r, tgt } = S.cam, sp = Math.sin(ph), cp = Math.cos(ph), st = Math.sin(th), ct = Math.cos(th);
    S.camera.position.set(tgt[0] + r * sp * st, tgt[1] + r * cp, tgt[2] + r * sp * ct);
    S.camera.up.set(-cp * st, sp, -cp * ct);           // "north" tangent: stays well defined when looking straight down
    S.camera.lookAt(tgt[0], tgt[1], tgt[2]);
  }
  function bindPointer(cv) {
    const P = new Map(); let pinch = 0, moved = 0, lastTap = 0;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); P.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; S.dragging = true;
      if (P.size === 2) { const [a, b] = [...P.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
    cv.addEventListener('pointermove', e => {
      const p = P.get(e.pointerId);
      if (!p) { hover(e); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) S.tween = null;
      if (P.size === 1 && moved > 6) {
        S.cam.th -= dx * 0.008; S.cam.ph = Math.min(Math.PI - 0.05, Math.max(0.0001, S.cam.ph - dy * 0.008));
        S.rotate = false; if (!S.live) S.viewName = null; markViews(); hideTip();   // live focus keeps following while you turn it
      } else if (P.size === 2) {
        const [a, b] = [...P.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) S.cam.r = Math.min(14, Math.max(1.2, S.cam.r * pinch / d)); pinch = d;
      }
    });
    const up = e => {
      if (P.has(e.pointerId) && P.size === 1 && moved < 6) {
        const now = performance.now();
        if (now - lastTap < 320) { stopTour(); setView('live'); } else click(e);
        lastTap = now;
      }
      P.delete(e.pointerId); if (P.size < 2) pinch = 0; if (!P.size) S.dragging = false;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => { P.delete(e.pointerId); pinch = 0; if (!P.size) S.dragging = false; });
    cv.addEventListener('pointerleave', hideTip);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => { e.preventDefault(); S.tween = null; S.cam.r = Math.min(14, Math.max(1.2, S.cam.r * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  }

  /* ---------- picking ---------- */
  function rayHit(e) {
    if (!S.ready || !S.model) return null;
    const r = S.el.cv.getBoundingClientRect(), T = S.T;
    const ndc = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = S.rc || (S.rc = new T.Raycaster()); rc.setFromCamera(ndc, S.camera);
    const hits = rc.intersectObjects(Object.values(S.shapes), false);
    for (const h of hits) { const b = h.object.userData.map?.[h.instanceId]; if (b && inBox(b)) return b; }
    // generous fallback for fingers: nearest visible dot within 18 px on screen
    let best = null, bd = 18 * 18; const v = new T.Vector3();
    for (const b of S.order) { if (!inBox(b)) continue; v.set(b.cx, b.cy, b.cz).project(S.camera); const sx = (v.x + 1) / 2 * r.width, sy = (1 - v.y) / 2 * r.height;
      const d = (sx - (e.clientX - r.left)) ** 2 + (sy - (e.clientY - r.top)) ** 2; if (d < bd) { bd = d; best = b; } }
    return best;
  }
  const inBox = b => b.cx >= -W / 2 - 0.04 && b.cx <= W / 2 + 0.04 && b.cy >= -0.04 && b.cy <= H + 0.04;
  function hover(e) {
    const b = rayHit(e); S.hoverBar = b;
    if (!b) return hideTip();
    const r = S.root.getBoundingClientRect(), tip = S.el.tip;
    tip.innerHTML = b.d.tip; tip.hidden = false;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    tip.style.left = Math.max(8, Math.min(x + 14, r.width - tip.offsetWidth - 8)) + 'px'; tip.style.top = Math.max(8, y - tip.offsetHeight - 10) + 'px';
    S.el.cv.style.cursor = 'pointer';
  }
  function hideTip() { if (S.el?.tip) S.el.tip.hidden = true; if (S.el?.cv) S.el.cv.style.cursor = 'grab'; S.hoverBar = null; }
  function click(e) { const b = rayHit(e); if (b && S.onPick) S.onPick(b.d.t); }

  /* ---------- data in ---------- */
  /** model: { key, dtMs, nowMs, bars:[{t,x,p,z,rgb,size:0..1,shape:'buy'|'sell'|'flat',hollow,stem:[r,g,b],tip}], path:[{x,p,rgb}],
   *   now:{p,z,down,label}|null, ticks:[{t,mid}], cloud:{pts:[[h,p,zFrac,dens]], xo, q:{x:[],q05,q50,q95}}|null,
   *   x:[lo,hi], p:[lo,hi], z:[lo,hi] (whole period), labels:{x,y,z,zName}, legend:{name,stops,lo,hi}, sel:t|null }  */
  Scene3D.update = function (m) { S.model = m; if (S.ready) apply(m); };
  Scene3D.setLayers = function (l) { S.layers = { ...l }; };
  Scene3D.resize = () => resize();
  /** Every quote: moves the live dot and extends the trail immediately (between the slower model updates). */
  Scene3D.live = function (mid, t = Date.now()) {
    if (!(mid > 0)) return; S.liveP = mid;
    const tr = S.trail_ || (S.trail_ = []); const last = tr[tr.length - 1];
    if (!last || last.mid !== mid || t - last.t > 200) tr.push({ t, mid });
    if (tr.length > 2900) tr.splice(0, tr.length - 2900);
  };

  function apply(m) {
    const T = S.T, lc = new T.Color(), lin = c => { lc.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, T.SRGBColorSpace); return [lc.r, lc.g, lc.b]; };   // line colours are linear
    const keyChanged = S.key !== m.key; S.key = m.key;
    if (keyChanged) { S.bars.clear(); S.rng = null; S.trail_ = (m.ticks || []).map(k => ({ t: k.t, mid: k.mid })); S.liveP = m.now?.p ?? null; S.moves = []; S.cloudRef = null; }
    if (S.liveP == null && m.now) S.liveP = m.now.p;
    const seen = new Set(), order = [], now = performance.now();
    m.bars.forEach((d, i) => {
      if (d.z == null) return;
      let b = S.bars.get(d.t);
      if (!b) { b = { cx: null, cs: 0, born: now + (keyChanged ? i * 4 : 0) }; S.bars.set(d.t, b); }
      Object.assign(b, { d, ts: 0.018 + 0.05 * d.size, stemL: lin(d.stem), i }); seen.add(d.t); order.push(b);
    });
    for (const t of S.bars.keys()) if (!seen.has(t)) S.bars.delete(t);
    S.order = order;
    S.pathL = m.path.map(q => ({ x: q.x, p: q.p, c: lin(q.rgb) }));
    legend(m);
    if (S.tour >= 0) tourCaption();
  }

  /** The data range that should be in frame: the whole sample, or (live focus) the last bars around the current price. */
  function targetRange() {
    const m = S.model, n = S.order.length;
    if (!S.live || n < 3) return { x: m.x.slice(), p: m.p.slice(), z: m.z.slice() };
    const k = Math.min(LIVE_BARS, n), rec = S.order.slice(-k), xNow = liveX();
    const xlo = rec[0].d.x, xhi = xNow + Math.max(2, k * 0.14);
    let plo = Infinity, phi = -Infinity, zlo = 0, zhi = 0;
    // the price/height zoom uses only the bars the close-up camera actually shows (about the newest 60 %)
    const seenRec = rec.slice(-Math.ceil(k * 0.6)), xSeen = seenRec[0].d.x;
    for (const b of seenRec) { plo = Math.min(plo, b.d.p); phi = Math.max(phi, b.d.p); zlo = Math.min(zlo, b.d.z); zhi = Math.max(zhi, b.d.z); }
    for (const q of S.trail_ || []) if (q.t >= (m.nowMs + xSeen * m.dtMs)) { plo = Math.min(plo, q.mid); phi = Math.max(phi, q.mid); }
    if (S.liveP) { plo = Math.min(plo, S.liveP); phi = Math.max(phi, S.liveP); }
    const pad = Math.max((phi - plo) * 0.18, (phi || 1) * 2e-5);
    return { x: [xlo, xhi], p: [plo - pad, phi + pad], z: [zlo, zhi === zlo ? zlo + 1 : zhi * 1.08] };
  }
  const liveX = () => S.model ? (Date.now() - S.model.nowMs) / S.model.dtMs : 0;

  function buildGrid(X, Y, Z, R) {
    const T = S.T, v = [], z = [];
    const xt = ticks(R.x[0], R.x[1], 7), pt = ticks(R.p[0], R.p[1], 5), zt = ticks(R.z[0], R.z[1], 4);
    for (const t of xt.v) { const x = X(t); v.push(x, 0, -D / 2, x, H, -D / 2, x, 0, -D / 2, x, 0, D / 2); }
    for (const p of pt.v) { const y = Y(p); v.push(-W / 2, y, -D / 2, W / 2, y, -D / 2, -W / 2, y, -D / 2, -W / 2, y, D / 2); }
    for (const q of zt.v) { const zz = Z(q); v.push(-W / 2, 0, zz, W / 2, 0, zz, -W / 2, 0, zz, -W / 2, H, zz); }
    S.grid.geometry.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    const x0 = X(liveX());                                 // the "now" column on the walls
    if (x0 >= -W / 2 && x0 <= W / 2) z.push(x0, 0, -D / 2, x0, H, -D / 2, x0, 0, -D / 2, x0, 0, D / 2);
    if (R.z[0] < 0 && R.z[1] > 0) { const zz = Z(0); z.push(-W / 2, 0, zz, W / 2, 0, zz); }
    S.zero.geometry.setAttribute('position', new T.Float32BufferAttribute(z, 3));
    S.ticks = { xt, pt, zt };
  }

  function legend(m) {
    const L = m.legend, key = [L.name, L.lo, L.hi, JSON.stringify(L.stops), S.legendHi].join('|'); if (key === S.legendKey) return; S.legendKey = key;
    S.el.legend.innerHTML = `
      <div class="s3-lg ${S.legendHi === 'colour' ? 'hi' : ''}"><span class="k">Colour · ${esc(L.name)}</span>
        <div class="s3-grad" style="background:${cssGrad(L.stops)}"></div><div class="s3-gl"><span>${esc(L.lo)}</span><span>${esc(L.hi)}</span></div></div>
      <div class="s3-lg ${S.legendHi === 'shape' ? 'hi' : ''}"><span class="k">Shape · who pushed</span><div class="s3-shapes"><span>◆ buyers</span><span>■ sellers</span><span>● balanced</span></div>
        <span class="k">Size · liquidity</span><div class="s3-shapes"><span class="s3-sz"><i style="width:5px;height:5px"></i><i style="width:9px;height:9px"></i><i style="width:14px;height:14px"></i></span><span>more orders waiting →</span></div></div>`;
  }

  /* ---------- labels (HTML, projected) ---------- */
  function labels(X, Y, Z, R, nowPos) {
    const m = S.model; if (!m || !S.ticks) return;
    const v = new S.T.Vector3(), out = [];
    const put = (x, y, z, html, cls = '') => { v.set(x, y, z).project(S.camera); if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return;
      out.push(`<span class="s3-l ${cls}" style="transform:translate(${((v.x + 1) / 2 * S.w).toFixed(1)}px,${((1 - v.y) / 2 * S.h).toFixed(1)}px) translate(${cls.includes('now') ? '0' : '-50%'},-50%)">${html}</span>`); };
    const { xt, pt, zt } = S.ticks, camX = S.camera.position.x, camZ = S.camera.position.z;
    const xz = camZ >= -D / 2 ? D / 2 + 0.06 : -D / 2 - 0.06, px = camX >= 0 ? W / 2 + 0.07 : -W / 2 - 0.07;
    for (const t of xt.v) if (Math.abs(t - liveX()) > xt.step * 0.4) put(X(t), -0.07, xz, short(t), 'tx');
    for (const p of pt.v) put(px, Y(p), -D / 2, byStep(p, pt.step), 'ty');
    for (const q of zt.v) put(-W / 2 - 0.06, -0.04, Z(q), short(q), 'tz');
    put(0, -0.24, xz, esc(m.labels.x), 'ax');
    put(px, H + 0.14, -D / 2, esc(m.labels.y), 'ax');
    put(-W / 2 - 0.1, -0.2, D / 2 + 0.12, esc(m.labels.z) + ' →', 'ax az');
    if (nowPos && S.fade.now > 0.3 && (S.layers.now ?? true) && S.liveP) put(nowPos.x + 0.05, nowPos.y, nowPos.z, 'now ' + esc(+S.liveP.toPrecision(7)), 'now');
    S.el.labels.innerHTML = out.join('');
  }

  /* ---------- "how fast is it moving" badge (live focus) ---------- */
  function pulseBadge(ts) {
    if (!S.live || ts - (S.pulseAt || 0) < 250) return; S.pulseAt = ts;
    const tr = S.trail_ || [], now = Date.now(), p = S.liveP; if (!p || tr.length < 2) { S.el.pulse.hidden = true; return; }
    const past = tr.find(q => q.t >= now - 10e3) || tr[0], ch = p / past.mid - 1, bp = ch * 1e4;
    if (!S.movesAt || now - S.movesAt > 1000) { S.movesAt = now; S.moves.push(Math.abs(bp)); if (S.moves.length > 300) S.moves.shift(); }
    const med = S.moves.length > 20 ? S.moves.slice().sort((a, b) => a - b)[S.moves.length >> 1] : null;
    const pace = med == null ? '' : Math.abs(bp) > Math.max(2.5 * med, 0.3) ? '<b class="fast">moving fast</b>' : Math.abs(bp) < 0.5 * med ? 'calm' : 'normal pace';
    const ago = Math.max(1, Math.round((now - past.t) / 1000));
    S.el.pulse.className = 's3-pulse ' + (bp > 0.05 ? 'up' : bp < -0.05 ? 'down' : '');
    S.el.pulse.innerHTML = `<span class="ar">${bp > 0.05 ? '▲' : bp < -0.05 ? '▼' : '◆'}</span><b>${bp >= 0 ? '+' : ''}${bp.toFixed(2)} bp</b> in ${ago} s ${pace ? '· ' + pace : ''}`;
    S.el.pulse.hidden = false;
  }

  /* ---------- tour ---------- */
  function startTour() { S.tour = -1; S.tourAuto = false; S.el.tour.hidden = false; S.root.querySelector('[data-a="tour"]').textContent = '■ Stop explaining';
    S.el.tour.querySelector('[data-a="auto"]').classList.remove('on'); tourStep(0); }
  function stopTour() { if (S.tour < 0) return; S.tour = -1; S.focus = null; S.legendHi = null; S.legendKey = null; S.el.tour.hidden = true;
    S.root.querySelector('[data-a="tour"]').textContent = '▶ Explain it to me'; if (S.model) legend(S.model); if (!S.live) setView('live'); }
  Scene3D.stopTour = stopTour;
  function tourStep(i) {
    if (i >= TOUR.length) return stopTour();
    S.tour = i; S.tourTimer = performance.now(); const st = TOUR[i];
    setView(st.v, 1300);
    S.focus = st.on ? new Set(st.on) : null; S.legendHi = st.legend || null; S.legendKey = null;
    if (S.model) legend(S.model);
    tourCaption();
  }
  function tourCaption() {
    const st = TOUR[S.tour], m = S.model; if (!st) return;
    const fill = s => s.replace(/\{Z\}/g, `<b>${esc(m?.labels.zName || 'the third axis')}</b>`).replace(/\{C\}/g, `<b>${esc(m?.legend.name || 'the colour dimension')}</b>`);
    const el = S.el.tour, html = fill(st.t), h = fill(st.h);
    if (el.dataset.k === S.tour + html) return; el.dataset.k = S.tour + html;
    el.querySelector('.s3-step').textContent = `${S.tour + 1} / ${TOUR.length}`;
    el.querySelector('.s3-th').innerHTML = h; el.querySelector('.s3-tt').innerHTML = html;
    el.querySelector('.s3-dots').innerHTML = TOUR.map((_, k) => `<i class="${k === S.tour ? 'on' : k < S.tour ? 'done' : ''}"></i>`).join('');
    el.querySelector('[data-a="next"]').textContent = S.tour === TOUR.length - 1 ? 'Done ✓' : 'Next →';
    el.querySelector('[data-a="prev"]').disabled = S.tour === 0;
    el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  }

  /* ---------- per-frame animation ---------- */
  const _m = {};
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!S.active() || document.hidden || !S.w || !S.model) { S.lastTs = ts; return; }
    const dt = Math.min(0.1, (ts - (S.lastTs || ts)) / 1000); S.lastTs = ts;
    const T = S.T, m = S.model, kB = 1 - Math.exp(-dt * 9), kR = 1 - Math.exp(-dt * (S.live ? 5 : 3.5)), kF = 1 - Math.exp(-dt * 18);
    if (!_m.mat) Object.assign(_m, { mat: new T.Matrix4(), q: new T.Quaternion(), s: new T.Vector3(), p: new T.Vector3(), c: new T.Color(), e: new T.Euler() });

    // 1. the window in frame glides towards its target (zooms in live focus, out for the whole period)
    const tgt = targetRange();
    if (!S.rng) S.rng = tgt; else S.rng = { x: lerpA(S.rng.x, tgt.x, kR), p: lerpA(S.rng.p, tgt.p, kR), z: lerpA(S.rng.z, tgt.z, kR) };
    const R = S.rng;
    const X = v => -W / 2 + (v - R.x[0]) / ((R.x[1] - R.x[0]) || 1) * W;
    const Y = v => (v - R.p[0]) / ((R.p[1] - R.p[0]) || 1) * H;
    const Z = v => -D / 2 + (v - R.z[0]) / ((R.z[1] - R.z[0]) || 1) * D;
    const z0 = Z(Math.min(Math.max(0, R.z[0]), R.z[1]));

    // 2. live dot (moves on every quote) and its world position
    const xNow = liveX(), nowZ = m.now && m.now.z != null ? Z(m.now.z) : z0;
    const nowPos = S.liveP ? { x: X(xNow), y: Y(S.liveP), z: nowZ } : null;

    // 3. camera: animated moves between views; live focus keeps the current dot in the middle and chases it
    let camGoal = [0, H / 2, 0];
    if (S.live && nowPos) camGoal = [nowPos.x - 0.45, nowPos.y, nowPos.z * 0.5];
    if (S.tween) { const u = Math.min(1, Math.max(0, (ts - S.tween.t0) / S.tween.ms)), e = ease(u), a = S.tween.from, b = S.tween.to;
      S.cam.th = a.th + (b.th - a.th) * e; S.cam.ph = a.ph + (b.ph - a.ph) * e; S.cam.r = a.r + (b.r - a.r) * e; S.cam.tgt = a.tgt.map((v, i) => v + (camGoal[i] - v) * e);
      if (u >= 1) S.tween = null; }
    else S.cam.tgt = S.cam.tgt.map((v, i) => v + (camGoal[i] - v) * (S.live ? 1 - Math.exp(-dt * 6) : kR));
    if (S.rotate && !S.tween) S.cam.th += dt * 0.18;
    const sway = S.live && !S.dragging && !S.tween && !S.rotate ? 0.05 * Math.sin(ts / 3200) : 0;       // a slight drift keeps the depth readable
    S.cam.th += sway * dt; placeCamera();

    // 4. layer fades: off = hidden, outside the tour step = dimmed
    const L = S.layers;
    for (const name of Object.keys(S.fade)) {
      const want = (L[name] ?? true) ? (S.focus && !S.focus.has(name) ? 0.07 : 1) : 0;
      S.fade[name] += (want - S.fade[name]) * (1 - Math.exp(-dt * 6));
      const g = S.g[name]; if (g) g.visible = S.fade[name] > 0.01;
    }
    for (const w of S.wallMeshes) w.material.opacity = (dark() ? 0.045 : 0.06) * S.fade.walls;
    S.grid.material.opacity = 0.32 * S.fade.walls; S.zero.material.opacity = 0.6 * S.fade.walls;
    for (const s of Object.values(S.shapes)) s.material.opacity = S.fade.bars;
    S.g.stems.material.opacity = 0.85 * S.fade.stems;
    S.path.material.opacity = S.live ? 0.55 * S.fade.path : S.fade.path;
    S.cloud.material.opacity = (0.55 + 0.25 * Math.sin(ts / 900)) * S.fade.cloud;
    S.qlines.forEach(l => { l.material.opacity = 0.9 * S.fade.cloud; });

    // 5. bars: glide to their place in the current window; the newest bars are brightest, the forming bar is biggest
    const cnt = { flat: 0, buy: 0, sell: 0 }, maps = { flat: [], buy: [], sell: [] }, st = S.g.stems.geometry, sp = st.attributes.position.array, sc = st.attributes.color.array;
    let ns = 0, selB = null; const now = performance.now(), n = S.order.length;
    for (const b of S.order) {
      const tx = X(b.d.x), ty = Y(b.d.p), tz = Z(b.d.z), born = now >= b.born;
      if (b.cx == null) { b.cx = tx; b.cy = ty; b.cz = z0; }
      b.cx += (tx - b.cx) * kB; b.cy += (ty - b.cy) * kB; if (born) b.cz += (tz - b.cz) * kB;
      const age = n - 1 - b.i, forming = age === 0;
      b.cs += ((born ? b.ts : 0) * (forming ? 1.45 : 1) - b.cs) * kB;
      const sh = b.d.shape, mesh = S.shapes[sh]; if (cnt[sh] >= CAP) continue;
      const s = b.cs * (S.hoverBar === b ? 1.5 : 1) * (b.d.hollow ? 0.7 : 1);
      _m.e.set(sh === 'flat' ? 0 : ts / 2400 + b.d.t % 7, sh === 'buy' ? ts / 1800 : 0, 0); _m.q.setFromEuler(_m.e);
      _m.mat.compose(_m.p.set(b.cx, b.cy, b.cz), _m.q, _m.s.set(s, s, s));
      mesh.setMatrixAt(cnt[sh], _m.mat);
      const rec = S.live ? 0.35 + 0.65 * Math.max(0, 1 - age / LIVE_BARS) : 1, dim = (b.d.hollow ? 0.45 : 1) * rec, [r, g, bl] = b.d.rgb, gr = (1 - dim) * 0.3;
      _m.c.setRGB(r / 255 * dim + gr, g / 255 * dim + gr, bl / 255 * dim + gr, T.SRGBColorSpace);
      mesh.setColorAt(cnt[sh], _m.c); maps[sh][cnt[sh]++] = b;
      if (ns < CAP) { sp.set([b.cx, b.cy, z0, b.cx, b.cy, b.cz], ns * 6); const c = b.stemL; sc.set([c[0], c[1], c[2], c[0], c[1], c[2]], ns * 6); ns++; }
      if (m.sel === b.d.t) selB = b;
    }
    for (const [sh, mesh] of Object.entries(S.shapes)) { mesh.count = cnt[sh]; mesh.userData.map = maps[sh]; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); }
    if (selB) { S.sel.visible = true; S.sel.position.set(selB.cx, selB.cy, selB.cz); S.sel.scale.setScalar(Math.max(0.05, selB.cs * 2.2)); S.sel.lookAt(S.camera.position); } else S.sel.visible = false;
    st.setDrawRange(0, ns * 2); st.attributes.position.needsUpdate = st.attributes.color.needsUpdate = true;

    // 6. price path on the back wall
    const pg = S.path.geometry, pp = pg.attributes.position.array, pc = pg.attributes.color.array, pl = S.pathL || [], np = Math.min(pl.length, CAP);
    for (let i = 0; i < np; i++) { const q = pl[i]; pp[i * 3] = X(q.x); pp[i * 3 + 1] = Y(q.p); pp[i * 3 + 2] = -D / 2 + 0.002; pc.set(q.c, i * 3); }
    pg.setDrawRange(0, np); pg.attributes.position.needsUpdate = pg.attributes.color.needsUpdate = true;

    // 7. future cloud + quantile lines
    if (m.cloud) {
      const c = m.cloud;
      if (S.cloudRef !== c.pts) {
        S.cloudRef = c.pts; const N = c.pts.length, col = new Float32Array(N * 3), vio = S.col.vio;
        c.pts.forEach((p, i) => { const k = 0.25 + 0.75 * p[3]; col.set([vio.r * k, vio.g * k, vio.b * k], i * 3); });
        S.cloud.geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 3), 3));
        S.cloud.geometry.setAttribute('color', new T.BufferAttribute(col, 3));
      }
      const pos = S.cloud.geometry.attributes.position;
      if (pos) { const a = pos.array; for (let i = 0; i < c.pts.length; i++) { const p = c.pts[i]; a[i * 3] = X(c.xo + p[0]); a[i * 3 + 1] = Y(p[1]); a[i * 3 + 2] = -D / 2 + p[2] * D * 0.35; } pos.needsUpdate = true; }
      S.qlines.forEach((l, i) => { const k = ['q05', 'q50', 'q95'][i]; l.geometry.setFromPoints(c.q.x.map((x, j) => _v(X(x), Y(c.q[k][j]), -D / 2 + 0.004))); l.computeLineDistances?.(); });
    }
    S.g.cloud.visible = !!m.cloud && S.fade.cloud > 0.01;

    // 8. live dot, level line, drop line to the wall and the quote trail (fades out with age, coloured by direction)
    if (nowPos) {
      const p = S.nowDot.position;
      if (S.nowInit !== S.key) { S.nowInit = S.key; p.set(nowPos.x, nowPos.y, nowPos.z); }
      p.x += (nowPos.x - p.x) * kF; p.y += (nowPos.y - p.y) * kF; p.z += (nowPos.z - p.z) * kF;
      const up = (m.now?.down) ? S.col.sell : S.col.acc;
      S.nowDot.material.color = up; S.nowHalo.material.color = up;
      S.nowHalo.position.copy(p); const pulse = (ts % 1200) / 1200; S.nowHalo.scale.setScalar(1 + 3 * pulse); S.nowHalo.material.opacity = 0.5 * (1 - pulse) * S.fade.now;
      S.nowDot.scale.setScalar(S.live ? 1.25 : 1);
      S.nowDot.material.opacity = S.fade.now; S.nowLine.material.opacity = 0.55 * S.fade.now; S.nowDrop.material.opacity = 0.5 * S.fade.now;
      S.nowLine.geometry.setFromPoints([_v(-W / 2, p.y, -D / 2 + 0.003), _v(W / 2, p.y, -D / 2 + 0.003)]); S.nowLine.computeLineDistances();
      S.nowDrop.geometry.setFromPoints([_v(p.x, p.y, p.z), _v(p.x, p.y, -D / 2)]); S.nowDrop.computeLineDistances();
      // quote trail at the depth of the live dot, plus its shadow on the back wall
      const tr = S.trail_ || [], tmin = m.nowMs + R.x[0] * m.dtMs, g1 = S.trail.geometry, g2 = S.trailWall.geometry;
      while (tr.length > 2 && tr[0].t < tmin - 60e3) tr.shift();
      const a1 = g1.attributes.position.array, c1 = g1.attributes.color.array, a2 = g2.attributes.position.array, c2 = g2.attributes.color.array;
      const tail = Math.max(m.dtMs * 6, 20e3), nowMs = Date.now(); let k = 0;
      for (let i = Math.max(0, tr.length - 2999); i < tr.length && k < 2999; i++) {
        const q = tr[i]; if (q.t < tmin) continue;
        const x = X((q.t - m.nowMs) / m.dtMs), y = Y(q.mid), f = Math.max(0.08, 1 - (nowMs - q.t) / tail), prev = tr[i - 1], col = prev && q.mid < prev.mid ? S.col.sell : S.col.acc;
        a1.set([x, y, p.z], k * 3); a2.set([x, y, -D / 2 + 0.003], k * 3); c1.set([col.r * f, col.g * f, col.b * f], k * 3); c2.set([col.r * f, col.g * f, col.b * f], k * 3); k++;
      }
      a1.set([p.x, p.y, p.z], k * 3); a2.set([p.x, p.y, -D / 2 + 0.003], k * 3); c1.set([up.r, up.g, up.b], k * 3); c2.set([up.r, up.g, up.b], k * 3); k++;
      for (const g of [g1, g2]) { g.setDrawRange(0, k); g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true; }
      S.trail.material.opacity = S.fade.now * (S.live ? 1 : 0.6); S.trailWall.material.opacity = 0.35 * S.fade.now;
      S.g.now.visible = S.fade.now > 0.01;
    } else S.g.now.visible = false;

    // 9. grid follows the window; labels; speed badge; tour auto-play
    buildGrid(X, Y, Z, R);
    pulseBadge(ts);
    if (S.tour >= 0 && S.tourAuto && ts - S.tourTimer > 6500) tourStep(S.tour + 1);

    S.R.render(S.scene, S.camera);
    if (ts - (S.labAt || 0) > 50) { S.labAt = ts; labels(X, Y, Z, R, S.nowDot.position); }
  }
  const _v = (x, y, z) => new S.T.Vector3(x, y, z);
})();
