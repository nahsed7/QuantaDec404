# Project Specification: Valuation-Integrated Market Intelligence & Trading System

Repository: github.com/nahsed7/QuantaDec404 (MIT). The full nine-part brief is in `docs/MASTER_SPECIFICATION.md`.

**Status, 2026-11-25:**
- **Part 01 has been redone from scratch at the user's request**, as a fresh audit of the current code (§2).
- Parts 02–09 will be implemented one at a time, each with tests, a spec update and its own commit.
- An earlier pass already built a first version of Parts 02–04 (§10). The user asked for those parts to be redone. That code stays in place until each part is re-sent; it is then reviewed against the audit and reworked or replaced.
- Live trading is disabled. **Waiting for Part 02.**

---

## 1. Standing principles (Part 01)
- **Analytical independence.** Valuation, momentum, risk, confidence and execution are separate components with separate outputs. No single metric may silently dominate.
- **Transparency.** Every number exposes its inputs, assumptions, source and timestamp. Estimates are labelled as estimates.
- **No fabrication.** Only real market and financial data. A missing value stays missing and is shown as missing.
- **Capital preservation.** Live trading stays **disabled** until it is separately authorised, validated and legally appropriate. Paper trading only until then.
- **Lightweight, local-first.** Few dependencies and modest RAM and CPU use. Any heavy component needs a written justification here.
- **Continuity.** Existing data, configuration and working features are preserved. Later parts extend this document rather than replace it.
- **Working code is not assumed correct** (see the findings in §2.6).

## 2. Repository audit (fresh, 2026-11-25)

### 2.1 What the project is
"Market Microstructure Laboratory" grew into a private web app with three halves:
1. **Live market observation.** Crypto, FX and an equity heat map.
2. **A first equity research engine.** Fundamentals, valuation and scores.
3. **Paper trading.** Leveraged crypto and FX.

It runs on an Android phone (Termux, proot Ubuntu, aarch64). It is viewed in a browser there, or from a PC over the phone's hotspot.

### 2.2 Stack and dependencies
| Layer | Technology | Assessment |
|---|---|---|
| Server | Node.js 22.22, **zero npm dependencies** (`http`, `fetch`, `WebSocket`, `zlib`) | Good fit for the phone. One 388-line `server.js` is the router, feeds, recorder, account store and zip builder all in one. |
| Analytics | `lib/*.js`: UMD modules shared by server and browser | Good design: the same code runs in tests, on the server and in the browser. |
| Research pipeline | `src/research.js` | Fetching, caching, normalisation and orchestration mixed in one file. |
| Front end | Vanilla JS, Plotly 2.35.2 (CDN), custom canvas, GeoGebra (CDN, function page only) | Works, but `public/app.js` (757 lines) shares global state. Dark "holographic" and light themes exist. |
| Storage | JSONL tick and order-book files, a JSON paper account (with versioned history) and a JSON disk cache in `data/research` (26 MB) | No database. JSONL never compacts: `EURUSDT.jsonl` is already 2.3 MB. |
| Launchers | `start.sh`, `start.bat`, `serve-bg.sh` (256 MB heap cap), `app.py` (Streamlit wrapper) | `app.py` has never been run (Streamlit is not installed). |
| Tests | `test/analytics.test.js`: 22 `node:test` unit tests, all passing | No tests for the server, API failures, UI or trading. |

### 2.3 Components
| File | Lines | Role |
|---|---|---|
| `server.js` | 388 | Static files plus API: `/api/heatmap`, `klines`, `trades`, `book`, `sentiment`, `fng`, `fx/bars`, `fx/stream` (SSE), `fx/status`, `account` (+`/history`), `research/universe`, `research/company`, `research/regime`, `/download` |
| `public/app.js` | 757 | Live candles, 10-D 3D state space, order flow, analysis figures |
| `public/lab.js` | 203 | Maths: KDE, correlations, Takens embedding, Hurst, Fisher–Rao, H0 persistence, PCA, Isomap |
| `public/trade.js` | 212 | Paper account: bid/ask fills, leverage, TP/SL, stop-out |
| `public/heat.js` | 388 | Valuation heat map, research panel, comparison |
| `public/fn.js`, `function.html` | 269 | Live price as P(x) for GeoGebra and Desmos |
| `lib/stats.js` | 71 | Quantiles, rank correlation, regression, EWMA volatility, drawdown, seeded RNG |
| `lib/treemap.js` | 70 | Squarified treemap, colour scales, valuation marker |
| `lib/fundamentals.js` | 176 | SEC XBRL to annual rows, latest balance sheet, ratios, Piotroski-style F-score |
| `lib/valuation.js` | 250 | DCF, DDM, comparables, earnings power, assets, historical multiples, synthesis, scenarios |
| `lib/quant.js` | 150 | Momentum, exhaustion, volatility (VaR/ES), liquidity, trade-cost estimate |
| `lib/regime.js` | 60 | Vote-based regime (SPY trend, VIX, breadth, rotation, Amihud stress) |
| `lib/decision.js` | 143 | Opportunity, risk and confidence scores, evidence and comparison |
| `lib/calibrate.js` | 41 | Quarterly rank-IC of earnings yield and 12−1 momentum |
| `src/research.js` | 269 | Universe of 54 US large caps; EDGAR, Yahoo and Treasury loaders; cache; build and refresh loop |

### 2.4 Current capabilities (verified)
- Live crypto (Binance WS) and FX: a Kraken + TrueFX composite at about 21–35 quotes/s on EUR/USD, tracking TrueFX to about 0.2 pip.
- Order-book depth recording, the 10-D state-space view and the function view.
- Equity research for 54 US large caps:
  - SEC fundamentals and a Treasury risk-free rate (10-year at 4.91% on 2026-11-24).
  - Six valuation models and three scores.
  - Full recompute about 5.8 s, price refresh about 0.24 s, about 47 MB heap.
- Paper trading for crypto and FX, with a versioned account file.

### 2.5 Missing capabilities (against the 9-part brief)
| Part | Missing |
|---|---|
| 05 Validation | No backtester. No train/validation/test split or walk-forward. No benchmarks, costs or metrics (Sharpe, Sortino, drawdown, turnover). No experiment records. |
| 06 Portfolio | No equity holdings. No correlation matrix, risk contributions, portfolio scenarios or allocation comparison. |
| 07 Execution | Paper trading covers leveraged crypto and FX only. No equity orders, limit or stop orders, partial fills or rejections, and no slippage or fee model. No risk-control engine, and no broker-adapter layer. |
| 08 Data and UI | No provider abstraction, no data-quality monitor and no model-performance monitor. No local database. The ten workstation sections do not exist. |
| 09 Testing | No reproducible test datasets, API-failure tests, interface tests, leakage tests or traceability checks. |

### 2.6 Findings: things that work but are not correct enough
These were found by reading the code and checking the live data. They are weaknesses, not cosmetic issues.

1. **Fundamentals are not point-in-time.**
   - `fundamentals.annual()` keeps the *latest* filing for each fiscal year (`filed > cur[1]`), so restated numbers replace what was originally reported.
   - Any historical test built on this has look-ahead bias, or at best runs late.
   - **Critical for Part 05.** Fix: keep every filed version and select "as known on date t".
2. **Price returns ignore dividends.** Calibration uses close-to-close returns, so high-yield stocks look worse than they were. Fix: total return from Yahoo dividend events, which are already fetched.
3. **Survivorship bias.**
   - The universe is today's 54 large caps; companies that left the index or were delisted are absent.
   - Free price data for delisted stocks is not available from Yahoo.
   - This must be disclosed on every historical result, and reduced where data permits.
4. **Market-regime panel is currently down.**
   - The SPY download failed on the last build: Node's `fetch` timed out connecting to one Yahoo IP, while `curl` succeeded. Nothing was cached, so the regime shows "needs 210 bars".
   - `getJSON` has no timeout or retry, and Yahoo responses are never validated.
5. **Score weights and scales are hand-picked and undocumented.**
   - Examples: valuation weight 3, `1000·(yield − rf)`, volatility/0.6.
   - This breaks the brief's rule 4: no weights without a documented rationale.
6. **Valuation dominates opportunity although the data does not support it.**
   - Valuation has the largest weight (3).
   - The live calibration shows the earnings-yield signal had *negative* rank-IC (−0.056, t = −1.19, 35 quarters) in this universe.
   - The design should let the validation results (Part 05) set or cap how much each component counts.
7. **The "out-of-sample validation" input to confidence is not out-of-sample.** It is the later half of the same calibration sample, with no held-out test and no protection against choosing models after seeing the data.
8. **Fixed assumptions.** The equity risk premium is a constant 5%. The CAPM beta uses a Blume adjustment. Both are reasonable, but they apply to all stocks and only the browser can override them.
9. **Liquidity cost model** (half-spread + σ√(Q/ADV), k = 1). The spread is estimated from daily bars, not quotes; this is never labelled in the UI.
10. **Paper trading realism.** Fills at the displayed bid or ask, with no fees, financing, slippage, partial fills or rejections.
11. **No access control.** The server listens on `0.0.0.0` without authentication, so anyone on the hotspot can change the paper account. This must be fixed before Part 07.
12. **Two copies of the code.** The live server runs from `/root/market-site`. The working clone is `/data/data/com.termux/files/home/QuantaDec404`. Decision: **the clone is canonical**; the server will be moved to run from it.
13. **Unverified pieces.** `app.py` has not been run, and GeoGebra was only tested with a stub.

### 2.7 Hardware (phone, the current host)
- 8-core aarch64, 3.6 GB RAM (about 1 GB available while running) and 4 GB swap.
- **About 2.4 GB of disk free (96 % full).**
- Mobile data with about 0.4–0.6 s latency and occasional connection timeouts.
- Node 22.22. Python 3.14 without numpy or pandas.

Consequences:
- All analytics stay in plain JavaScript typed arrays.
- No ML frameworks and no Docker.
- The JSON cache and logs need size limits.
- A PC is available for viewing and optional heavy offline runs.

### 2.8 Local vs external
- **Local:** all computation, caches, the paper account, experiments and the UI.
- **External (read-only):**
  - SEC EDGAR: fundamentals.
  - Yahoo: equity and FX prices and dividends.
  - US Treasury: rates.
  - Binance, Kraken and TrueFX: live crypto and FX.
  - alternative.me: crypto sentiment.
- **Future broker adapter:** external, disabled.

## 3. Recommended architecture
Keep the zero-dependency Node core and the shared UMD `lib/`, and split by responsibility:

```
server.js                 thin router + static files + auth
src/providers/            one interface per data kind (quotes, bars, fundamentals, rates); adapters: yahoo, sec, treasury, binance, kraken, truefx
                          → timeout, retry, schema validation, source + timestamp + kind (live/delayed/historical/estimated) on every record
src/store/                cache with size limits; node:sqlite for point-in-time fundamentals, experiments, orders (built in to Node ≥ 22.5)
lib/ (pure, tested)       stats · fundamentals (point-in-time) · valuation · quant · regime · decision · backtest · portfolio · execution-sim · risk-controls
src/engines/              research (orchestration), validation runs, portfolio, order management (paper)
src/brokers/              adapter interface; paper adapter; live adapters hard-disabled behind config + explicit authorisation
public/                   one workstation shell, a module per section (map, valuation, research, quant, risk, portfolio, backtest, paper, data quality, model performance)
test/                     unit + leakage + API-failure + simulation + UI (stub DOM); fixtures under test/fixtures (real snapshots, synthetic sets labelled as such)
```

## 4. Dependency policy
- **Default:** Node built-ins only. The CDN libraries already in use (Plotly, GeoGebra) stay.
- **Allowed if needed:** `node:sqlite` (built in), and optional Python on the PC for offline research notebooks.
- **Not allowed without justification:** ML frameworks, databases needing a server, or front-end build tool-chains.

## 5. Data providers
| Need | Provider | Limits |
|---|---|---|
| US fundamentals | **SEC EDGAR XBRL** (companyfacts) | Official and free. The User-Agent should carry contact details. US filers only. As-reported data needs normalising, and every filed version is available, so point-in-time is possible. |
| Equity prices and dividends | Yahoo chart API (in use) | Unofficial: can rate-limit or change without notice. No delisted history. Personal use only. |
| Alternative prices | Stooq end-of-day CSV; Alpaca market data (free IEX feed, needs an account) | Stooq has no API terms; IEX covers about 2–3 % of US volume. |
| Rates | US Treasury yield curve (in use); FRED (free key) | Official. |
| Crypto and FX | Binance, Kraken, TrueFX (in use) | TrueFX is indicative only. |
| Broader fundamentals | FMP, Finnhub, Alpha Vantage free tiers | Need keys; small daily quotas. |
| Paper or live broker | Alpaca paper API; Interactive Brokers | Live stays disabled. |

None of the free sources permit commercial redistribution. This is a private research tool.

## 6. Roadmap (one part at a time)
| Step | Part | Content | Fixes from §2.6 |
|---|---|---|---|
| 1 | 02 | Heat map: review and rework the existing version against the brief | 4, 9 (labels) |
| 2 | 03 | Valuation and quant engines; point-in-time fundamentals; total returns | 1, 2, 8 |
| 3 | 04 | Decision engine with documented weights and scales | 5, 6, 7 |
| 4 | 05 | Walk-forward validation, benchmarks, costs, experiments; feeds confidence | 3, 7 |
| 5 | 06 | Portfolio and opportunity cost | — |
| 6 | 07 | Order simulation, risk controls, broker adapters (disabled), auth | 10, 11 |
| 7 | 08 | Provider layer, data-quality and model monitors, workstation UI, storage limits | 4, 12 |
| 8 | 09 | Full test suite, traceability, final documentation | 13 |

## 7. Decision log
| Date | Decision |
|---|---|
| 2026-11-24 | Real data only; no simulations. |
| 2026-11-24 | Free FX composite (Kraken + TrueFX) instead of OANDA. |
| 2026-11-24 | Tests never target the live server (port 8080) or `data/account.json`; use `PORT=8099 DATA_DIR=<tmp>`. |
| 2026-11-25 | Part 01 redone at the user's request. Earlier Parts 02–04 code is kept until each part is re-sent, then reworked or replaced. |
| 2026-11-25 | Parts are implemented one at a time, each tested and committed separately. |
| 2026-11-25 | `/data/data/com.termux/files/home/QuantaDec404` is the canonical working copy. |

## 8. Outstanding questions for the user
- Equity universe: keep the 54 US large caps, widen it (e.g. S&P 500 via EDGAR), or go international?
- Contact string for the SEC User-Agent (the SEC asks for one; it stays local).
- Would you create free API keys (FRED, Alpaca paper) if a part needs them?
- Should heavy research runs use the PC, or stay phone-only?

## 9. Testing status
- 22 unit tests pass (`node --test test/*.test.js`, 2026-11-25).
- Not covered: server routes, provider failures, leakage, UI and trading.

## 10. Existing implementation of Parts 02–04 (first pass, before the re-audit)
Kept for reference. It will be reviewed when each part is re-sent.
- **Part 02 (heat map):**
  - `public/heat.js`, `lib/treemap.js`.
  - Size: market cap, volume or turnover. Colour: 1D, 1W, 1M, 3M or sector-relative return.
  - Valuation marker and status border; hover card; research panel; comparison; legend; source and timestamp tags.
- **Part 03 (engines):**
  - `lib/valuation.js`: six models, never averaged. A primary model sets the range and the others are checks. Scenarios and editable assumptions.
  - `lib/fundamentals.js`, `lib/quant.js`, `lib/regime.js`.
- **Part 04 (decision):**
  - `lib/decision.js`: three independent scores, with evidence, unknowns, failure conditions and a comparison that never picks a winner.
  - `lib/calibrate.js`: historical IC.
- **Known issues:** see §2.6, items 1, 2 and 4–9.
