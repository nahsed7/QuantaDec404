# Architecture

A private, local-first market research workstation. Everything runs in one Node.js process with **no npm dependencies**. It runs on an Android phone (Termux, proot Ubuntu, aarch64) or any PC with Node ≥ 22.

```
                ┌──────────────────────────── external sources (src/providers.js registry, health) ─────────────────────────────┐
                │ Yahoo (delayed quotes, bars, FX, indices) · SEC EDGAR (filings, XBRL) · US Treasury · FRED · Frankfurter (FX)     │
                │ Binance · Kraken · TrueFX (live crypto/FX) · optional: Alpaca, Finnhub (keys in .env)                           │
                └───────────────┬──────────────────────────────────────────────────────────────┬──────────────────────────────────┘
                                │ timeouts · retries · validation · disk cache (stale fallback) │
 server.js (router, write gate) │                                                              │
  ├─ market-data layer ─────────┴── live streams (crypto/FX), delayed equity quotes + session times, order-book recorder
  ├─ src/research.js ── analytical engine: universe (55 US + 43 intl), currency handling, point-in-time fundamentals,
  │                      valuation (lib/valuation), market behaviour (lib/quant), fundamentals (lib/fundamentals),
  │                      regimes (lib/regime), calibration (lib/calibrate) → per-company dossiers
  ├─ lib/decision.js ── decision engine: opportunity / risk / confidence + evidence (no path to orders)
  ├─ src/validation.js + lib/backtest.js ── historical validation, reproducible experiments → evidence caps
  ├─ src/portfolio.js + lib/portfolio.js ── portfolio research and opportunity cost (hypothetical only)
  ├─ lib/riskcontrol.js ── pre-trade risk controls
  ├─ src/oms.js ── order management (equity paper book, audit log)
  ├─ src/brokers.js ── broker adapters: local paper simulator (lib/execsim.js); Alpaca paper (US orders, when keys are set) via a venue router; live disabled
  ├─ src/monitor.js ── data quality, model performance, prospective log, macro, filings
  ├─ src/retention.js ── disk retention    src/auth.js ── write token, .env loader
  └─ public/ ── workstation UI (vanilla JS + Plotly): map, valuation explorer, company research, quant screen,
                risk lab, backtesting, portfolio lab, paper trading, data quality, model performance, live micro-structure
```

## Design rules
1. **Pure analytics:** `lib/*` are pure UMD modules. The same code runs in Node (server, tests) and in the browser, so assumption edits recompute locally.
2. **Independent outputs:** valuation, momentum, risk, confidence and execution are separate. The decision engine never places orders, and orders only come from an explicit two-step user action.
3. **Point in time:** historical computations use `F.asOf()` and filing dates; signals read only data available at the formation date (tested by shocking the future).
4. **No fabrication:** missing data stays missing and visible. Estimates are labelled. Fallback sources are named.
5. **Server-authoritative state:** working paper orders execute without a browser. Every write needs a token unless it comes from the phone itself.
6. **Light:** about 6,000 lines. A full research build takes about 17 s with a warm cache, the heap is about 80 MB after GC, and validation takes about 15 s.

## Data files (`data/`, gitignored)
| File | Content | Pruned? |
|---|---|---|
| `research/` | cached filings, prices, FX, yields, experiments, prospective log | caches by TTL; experiments and log never |
| `equity-book.json`, `equity-audit.jsonl` | equity paper book and its audit trail | never |
| `account.json`, `account-log.jsonl` | crypto/FX demo account and its history | never |
| `portfolios.json` | saved hypothetical portfolios | never |
| `<SYM>.jsonl`, `fx-*.jsonl` | recorded order-book depth and FX bars | after 30 days |
| `auth-token` | write-access token | — |
