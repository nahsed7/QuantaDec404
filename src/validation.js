// Historical validation runs (Part 05): builds the point-in-time panel from the research pipeline, computes the
// valuation-engine signal point-in-time, runs every strategy through lib/backtest.validate, and stores each run as a
// reproducible experiment (config + data fingerprint + seed → id) under data/research/experiments/.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const S = require('../lib/stats'), V = require('../lib/valuation'), Q = require('../lib/quant'), B = require('../lib/backtest');
const DAY = 864e5;

const DEFAULT = Object.freeze({ universe: 'US large caps (55)', n: [6, 11, 16], every: [1, 3], costBps: 10, trainFrac: 0.6, valFrac: 0.2,
  wfWindow: 36, wfStep: 12, randomDraws: 300, seed: 7, signals: ['momentum', 'value', 'lowvol', 'combo', 'engine'] });

function create({ dataDir, research }) {
  const dir = path.join(dataDir, 'research', 'experiments'); fs.mkdirSync(dir, { recursive: true });
  const st = { running: false, progress: null, latest: null, error: null };

  async function inputs() {
    const R = research.state, us = [...R.dossiers.values()].filter(d => d.region === 'US');
    if (us.length < 20) throw new Error('Research data not loaded yet');
    const stocks = us.map(d => { const tri = Q.totalReturnIndex(d.monthlyNative, d.divNative);
      return { sym: d.sym, isFinancial: d.isFinancial, monthly: d.monthlyNative.map((b, i) => ({ t: b.t, c: b.c, tr: tri[i] })), eps: research.epsVersionsFor(d.sym) }; });
    const [spy, irx] = await Promise.all([research.yahoo('SPY', '1mo', '10y', 7 * DAY), research.yahoo('^IRX', '1mo', '10y', 7 * DAY).catch(() => null)]);
    const sTri = Q.totalReturnIndex(spy.bars, spy.div);
    const bench = spy.bars.map((b, i) => ({ t: b.t, tr: sTri[i] }));
    // Risk-free for Sharpe ratios: 13-week T-bill (^IRX); 10-year yield as a labelled fallback.
    const rf = irx?.bars?.length ? irx.bars.map(b => ({ t: b.t, y: b.c / 100 })) : (R.tnx || []).map(b => ({ t: b.t, y: b.c / 100 }));
    return { stocks, bench, rf, rfSource: irx?.bars?.length ? '13-week US T-bill (^IRX)' : '10-year Treasury (^TNX), fallback', benchName: 'SPY total return (dividends reinvested)' };
  }
  const fingerprint = (inp, pn) => crypto.createHash('sha1').update(JSON.stringify({ syms: pn.syms, months: [pn.months[0], pn.months.at(-1)],
    last: pn.syms.map(s => pn.px[s].filter(S.fin).at(-1)), eps: inp.stocks.map(s => s.eps.length), bench: pn.bench.filter(S.fin).at(-1) })).digest('hex').slice(0, 16);

  // The app's own valuation engine as a signal: at each quarter-end, rerun DCF, earnings-power and book models with only
  // the filings public by then, that month's price and 10-year yield, and β = 1 (no point-in-time β is available, and
  // today's β would leak). Signal = premium of price over the primary base value, carried forward for 3 months.
  async function engineSignal(pn, stocks) {
    const tnx = research.state.tnx || [], out = {};
    for (const s of stocks) {
      const arr = new Array(pn.months.length).fill(null); let last = null;
      for (let m = 12; m < pn.months.length; m++) {
        if ([2, 5, 8, 11].includes(+pn.months[m].slice(5) - 1)) {
          last = null;
          const t = pn.t[m], px = pn.px[s.sym][m], p = research.pit(s.sym, t);
          if (p?.rows?.length >= 3 && S.fin(px)) {
            const L = p.rows.at(-1), shares = L.dilShares, rf = (tnx.filter(b => b.t <= t).pop()?.c ?? NaN) / 100;
            if (shares > 0 && S.fin(rf)) {
              const ctx = { sym: s.sym, isFinancial: s.isFinancial, price: px, shares, rows: p.rows, bal: p.bal, fund: p.fund, rf, beta: null, peers: [], history: [], country: 'US', fresh: null };
              const a = { ...V.defaults(ctx), mcDraws: 200 };
              const ms = s.isFinancial ? [V.earnings(ctx, a), V.assets(ctx, a)] : [V.dcf(ctx, a), V.earnings(ctx, a), V.assets(ctx, a)];
              const syn = V.synthesize(ms.filter(x => x.applicable && S.fin(x.base) && S.fin(x.low) && S.fin(x.high)), px, ctx);
              if (S.fin(syn.premium)) last = Math.log(1 + syn.premium);            // log premium: symmetric, robust to outliers
            }
          }
        }
        arr[m] = last;
      }
      out[s.sym] = arr;
      st.progress = { step: 'valuation engine (point-in-time)', done: Object.keys(out).length, of: stocks.length };
      await new Promise(r => setImmediate(r));                                   // keep the server responsive
    }
    return out;
  }

  async function run(cfg = {}) {
    if (st.running) return { running: true, progress: st.progress };
    st.running = true; st.error = null;
    try {
      const config = { ...DEFAULT, ...cfg };
      st.progress = { step: 'loading data' };
      const inp = await inputs(), pn = B.panel(inp.stocks, inp.bench, inp.rf), fp = fingerprint(inp, pn);
      const id = crypto.createHash('sha1').update(JSON.stringify(config) + fp).digest('hex').slice(0, 12);
      const file = path.join(dir, id + '.json');
      if (!cfg.force && fs.existsSync(file)) { st.latest = JSON.parse(fs.readFileSync(file, 'utf8')); return st.latest; }
      const t0 = Date.now(), ext = config.signals.includes('engine') ? await engineSignal(pn, inp.stocks) : null, results = {};
      for (const sig of config.signals) {
        st.progress = { step: 'validating ' + sig };
        results[sig] = B.validate(pn, { ...config, signal: sig, ext });
        await new Promise(r => setImmediate(r));
      }
      const exp = {
        id, created: new Date().toISOString(), seconds: (Date.now() - t0) / 1000, config, dataFingerprint: fp,
        data: { universe: config.universe, stocks: pn.syms.length, from: pn.months[0], to: pn.months.at(-1), months: pn.months.length, benchmark: inp.benchName, riskFree: inp.rfSource,
          prices: 'Yahoo monthly closes, split-adjusted; total return with Yahoo dividends', fundamentals: 'SEC EDGAR EPS, each version used only after its filing date' },
        baselines: B.baselines(pn, config.costBps), results,
        categories: {
          'paper-trading': { available: false, note: 'Equity paper trading results are kept in the paper book (Part 07) and are never merged with backtests.' },
          live: { available: false, note: 'Live trading is disabled.' } },
        assumptions: [
          'Long-only, equally weighted top-N portfolios; holdings drift between rebalances.',
          `Costs: ${config.costBps} bp per unit of weight traded (one-way), on every rebalance; cost sensitivity 0–50 bp on the validation segment.`,
          'Signals at month m use month-end prices ≤ m and filings filed on or before month m\'s last day; returns are earned from m to m + 1.',
          'Eligibility depends only on data at m; a holding with no next price exits at its last price (counted as a missing exit).',
          `Chronological split: ${Math.round(100 * config.trainFrac)} % train / ${Math.round(100 * config.valFrac)} % validation / rest test. Parameters are chosen on train only; test is reported once.`,
          `Walk-forward: choose on the trailing ${config.wfWindow} months, hold ${config.wfStep} months, repeat.`,
          'Market regimes per month use only the benchmark up to that month.',
          'The valuation-engine signal uses β = 1 and today\'s equity risk premium (no point-in-time β).'],
        biases: [
          'Survivorship bias: the universe is today\'s large caps, so companies that fell out or were delisted are missing. Delisted prices are not available from free sources. The equal-weight-universe minus index return (survivorship gap) bounds how much this flatters results.',
          'Small cross-section (55 stocks) and about 10 years of monthly data: estimates are noisy, and a single test segment is about 2 years.',
          'The partial current month is the last price, not a month-end close.'],
      };
      fs.writeFileSync(file, JSON.stringify(exp));
      st.latest = exp; return exp;
    } catch (e) { st.error = e.message; throw e; }
    finally { st.running = false; st.progress = null; }
  }
  function list() {
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { try { const e = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { id: e.id, created: e.created, fingerprint: e.dataFingerprint, data: e.data, config: e.config }; } catch { return null; } }).filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
  }
  function get(id) { const f = path.join(dir, String(id).replace(/[^a-f0-9]/g, '') + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; }
  // Out-of-sample evidence for the decision engine (Part 04): test-segment and walk-forward results per signal.
  function evidence() {
    const e = st.latest; if (!e) return null;
    return Object.fromEntries(Object.entries(e.results).filter(([, r]) => !r.insufficient).map(([k, r]) => [k, { label: r.label, testSharpe: r.test.sharpe ?? null, testExcess: r.test.excessAnn ?? null,
      walkForwardSharpe: r.walkForward?.sharpe ?? null, walkForwardExcess: r.walkForward?.excessAnn ?? null, trainSharpe: r.inSample.sharpe ?? null, dsr: r.deflatedSharpe?.dsr ?? null,
      randomPercentileTest: r.randomBaseline?.test?.strategyPercentile ?? null, months: r.test.n, experiment: e.id }]));
  }
  return { run, list, get, evidence, state: st, DEFAULT };
}
module.exports = { create, DEFAULT };
