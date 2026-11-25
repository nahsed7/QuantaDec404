# Project Specification: Valuation-Integrated Market Intelligence & Trading System

Repository: github.com/nahsed7/QuantaDec404 (MIT). The full nine-part brief is in `docs/MASTER_SPECIFICATION.md`.

**Status, 2026-11-25:**
- **Part 01 has been redone from scratch at the user's request**, as a fresh audit of the current code (§2).
- Parts 02–09 will be implemented one at a time, each with tests, a spec update and its own commit.
- **Done:** Part 02 heat map (§11), Part 03 valuation and quantitative engines (§12), Part 05 historical validation (§13), Part 04 decision intelligence (§14), Part 06 portfolio laboratory (§15).
- The user then sent Parts 04–09 together and added a Part 10 (intuitive visualisation, plus cutting the live-chart delay to 0.1 s or less). They asked for all ten to be completed in order, with the best free choices made automatically and API keys requested once at the end.
- Order agreed: 03 → 05 → 04 → 06 → 07 → 08 → 09 → 10. Validation comes before the decision-weight rework, so weights can be capped by evidence.
- Live trading is disabled.

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

1. **Fundamentals are not point-in-time** (*fixed in Part 03*: `F.asOf()`; point-in-time valuation history and calibration).
   - `fundamentals.annual()` keeps the *latest* filing for each fiscal year (`filed > cur[1]`), so restated numbers replace what was originally reported.
   - Any historical test built on this has look-ahead bias, or at best runs late.
   - **Critical for Part 05.** Fix: keep every filed version and select "as known on date t".
2. **Price returns ignore dividends** (*fixed in Part 03*: total-return index). Calibration uses close-to-close returns, so high-yield stocks look worse than they were. Fix: total return from Yahoo dividend events, which are already fetched.
3. **Survivorship bias.**
   - The universe is today's 54 large caps; companies that left the index or were delisted are absent.
   - Free price data for delisted stocks is not available from Yahoo.
   - This must be disclosed on every historical result, and reduced where data permits.
4. **Market-regime panel was down** (*fixed in Part 02*: timeouts, retries and response validation on every request).
   - The SPY download failed on the last build: Node's `fetch` timed out connecting to one Yahoo IP, while `curl` succeeded. Nothing was cached, so the regime shows "needs 210 bars".
   - `getJSON` has no timeout or retry, and Yahoo responses are never validated.
5. **Score weights and scales are hand-picked and undocumented** (*fixed in Part 04*: percentile ranks plus documented prior weights, capped by evidence).
   - Examples: valuation weight 3, `1000·(yield − rf)`, volatility/0.6.
   - This breaks the brief's rule 4: no weights without a documented rationale.
6. **Valuation dominates opportunity although the data does not support it** (*fixed in Part 04*: the valuation-engine signal was weak out of sample, so its weight is halved).
   - Valuation has the largest weight (3).
   - The live calibration shows the earnings-yield signal had *negative* rank-IC (−0.056, t = −1.19, 35 quarters) in this universe.
   - The design should let the validation results (Part 05) set or cap how much each component counts.
7. **The "out-of-sample validation" input to confidence is not out-of-sample** (*fixed in Part 04*: it now uses Part 05 walk-forward and test results). It is the later half of the same calibration sample, with no held-out test and no protection against choosing models after seeing the data.
8. **Fixed assumptions** (*Part 03*: β, ERP and the risk-free rate are now editable and re-derive the discount rates; the tax fallback is the statutory rate per country). The equity risk premium is a constant 5%. The CAPM beta uses a Blume adjustment. Both are reasonable, but they apply to all stocks and only the browser can override them.
9. **Liquidity cost model** (*Part 03*: the spread estimator was 2× too high, now fixed; a cost curve is labelled theoretical) (half-spread + σ√(Q/ADV), k = 1). The spread is estimated from daily bars, not quotes; this is never labelled in the UI.
10. **Paper trading realism.** Fills at the displayed bid or ask, with no fees, financing, slippage, partial fills or rejections.
11. **No access control.** The server listens on `0.0.0.0` without authentication, so anyone on the hotspot can change the paper account. This must be fixed before Part 07.
12. **Two copies of the code** (*done in Part 02*: the live server now runs from the clone, with data copied; `/root/market-site` is kept as a backup). The live server runs from `/root/market-site`. The working clone is `/data/data/com.termux/files/home/QuantaDec404`. Decision: **the clone is canonical**; the server will be moved to run from it.
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
| 2026-11-25 | Part 02: international universe from SEC 20-F/40-F filers on home listings; analysis in the reporting currency; US$ for sizes; local yields from FRED's keyless CSV. |
| 2026-11-25 | Data-integrity guards withhold a valuation classification when share counts disagree. DCF net investment floored at zero. |
| 2026-11-25 | The live server runs from the canonical clone. |
| 2026-11-25 | Part 03: years 1–5 growth = terminal + 50 % of (historical − terminal); WACC floor = risk-free + 2 pts; statutory tax fallback. |
| 2026-11-25 | Part 03: market statistics in the listing currency against the local index (16 indices); valuation in the reporting currency. |
| 2026-11-25 | Part 05: validation on the US universe (point-in-time EPS, total returns); 60/20/20 chronological split; walk-forward 36/12; 10 bp per unit traded; seeded random baselines. |
| 2026-11-25 | Answers to the open questions, chosen automatically at the user's request: fixed documented weights capped by validation; a stock paper book inside the existing account file; a one-time token for writes; compact tick data older than 30 days. |

## 8. Questions to the user: answers and decisions
The user answered "go international and keep the 54 too", agreed to create API keys, and asked for the best free choice wherever a decision was open.

| Question | Decision (2026-11-25) | Why |
|---|---|---|
| Equity universe | **55 US + 43 international**. The US list holds 55, not the 54 stated earlier. | SEC 20-F/40-F filers are free and official, and cover most of the world's largest non-US companies. |
| Companies that don't file with the SEC | Kept on the map with **prices only**, clearly labelled: Samsung, Tencent, LVMH, Nestlé, Roche, Siemens. | No free statements source exists. Showing them as visibly limited beats silently leaving them out. |
| SEC User-Agent | Generic tool name, no personal details. | It works (no 403s). The user's contact details stay out of outside requests. |
| API keys | **None needed for Part 02.** Local yields come from FRED's keyless CSV. | Keys are requested only when a part needs them (see §8.1). |
| Heavy research | Phone only for now. | A full build of 98 companies takes about 17 s with a warm cache and about 220 MB, which the phone handles. |

### 8.1 API keys to create (free), for later parts
| Key | Used for | Part | Where to put it |
|---|---|---|---|
| Alpaca, paper-trading account (API key ID and secret) | Paper broker adapter; free IEX real-time US quotes | 07, 08 | `.env` in the repo root as `ALPACA_KEY_ID=` and `ALPACA_SECRET_KEY=` (`.env` is gitignored) |
| Finnhub (free) | Earnings surprises and analyst recommendation trends, closer to the brief's "earnings revisions" than reported EPS | 08 | `.env` as `FINNHUB_KEY=` |
| FRED (optional) | Only if the keyless CSV stops working | — | `.env` as `FRED_KEY=` |

## 9. Testing status
- **41 unit tests pass** (`node --test test/*.test.js`, 2026-11-25): 22 earlier, plus 19 for Part 02 in `test/heatmap.test.js`.
- **UI check (stub DOM, against a test server on port 8099 with a separate data folder):**
  - every colour × size × grouping × region combination (336 renders);
  - tooltips for US, converted-currency, bank and price-only companies;
  - every research-panel tab for 11 companies, plus the comparison view.
  - No `undefined`, `NaN` or `Infinity` anywhere. The harness is in the session scratchpad and will be moved into `test/` in Part 09.
- **Live server:** 98/98 companies load, 98/98 have delayed quotes, no errors, regime available. Shell is quoted at 3,552 GBp and shown as $46.52, consistent with GBP/USD 1.309.
- **Not covered yet:** server routes, provider failures end to end, leakage, trading.

## 10. Existing implementation of Parts 03–04 (first pass, before the re-audit)
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

## 11. Part 02: multidimensional heat map (done, 2026-11-25)
### 11.1 Review of the first pass against the brief
Already met:
- size mappings: market cap, traded value, turnover;
- colour periods: 1D, 1W, 1M, 3M, 6M, 1Y, custom, sector-relative;
- valuation status borders and range markers;
- research panel with every requested section; comparison; legend; data-kind badges; visible missing data.

Gaps found and closed:
| Gap | Change |
|---|---|
| No "valuation uncertainty" mapping | New colour mapping: optimistic ÷ conservative value. The tooltip also shows model confidence: range width and the share of cross-check models inside the range. |
| A +2 % day above vs below the range looked the same | **Move-vs-value corner flag:** orange when today's move takes an out-of-range price further away, teal when back toward the range. The tooltip and panel say it in words, e.g. "Up 2.0 % today while 18 % above the optimistic estimate…". Explicitly not a forecast. |
| Principal assumptions not shown on hover | Tooltip lists discount rate, growth, terminal growth, and the risk-free rate with its source. |
| Colour metric had a source but no timestamp | Every mapping declares `asOf`; the tooltip shows it. |
| Encodings lived in browser-only code | Moved to `lib/encodings.js`, shared by the tiles, tooltip, legend and tests, so they cannot disagree. |
| No region view | Grouping by sector, region, region then sector, or country; region filter; US$ sizes across currencies. |
| Phone usability | Long-press adds a company to the comparison (no shift key on touch). |
| Bugs found by the new tests and the UI harness | Formatters received the company object as their decimal-places argument, so "+1.4 %" showed as "+1 %". Comparison text called a +117 % premium "below". The Sources tab showed the US Treasury for every company. |

### 11.2 International universe (`src/research.js`)
- **Coverage:** 43 companies across 17 countries.
  - **37 with SEC filings:** 20-F (IFRS or US GAAP), 40-F (Canada), or 10-K for MercadoLibre and Shopify.
  - **6 price-only:** no free filings source.
  - Each CIK and Yahoo symbol was verified on 2026-11-25. Roche uses `ROP.SW`, the liquid non-voting line, because `ROG.SW` now returns 404.
- **Listings:** home listings are used, so no ADR ratio is needed. ARM, SPOT, MELI and SHOP use their US listings, one share each.
- **Fundamentals** (`lib/fundamentals.js`):
  - `ifrs-full` tags added for every field, and 20-F/40-F accepted as annual forms.
  - The reporting currency is the unit carrying the most annual income-statement facts, so TSMC's USD convenience translation is ignored.
  - Facts with no unit in that currency are dropped rather than mixed in.
- **Currencies** (`lib/fx.js`): the analysis currency is the reporting currency.
  - Prices listed in another currency (e.g. Shell: GBp listing, USD statements) are converted at each day's Yahoo FX rate. Returns then include currency moves, which the company's notes say.
  - Minor units are normalised: GBp → GBP, ZAc, ILA.
  - Sizes, traded value and Amihud are in US$, so they compare across markets.
- **Risk-free rate per currency:** OECD 10-year government yields via FRED, with the Bund used for EUR.
  - TWD, CNY and HKD have no free series, so they fall back to the US Treasury with a visible "(no free … yield)" label.
- **Beta and market-relative measures:** only for listings on the SPY trading calendar. Elsewhere they show as unavailable, and the DCF uses β = 1 (stated in its assumptions).
- **Kept US-only (stated in the UI):** the regime indicators (S&P 500-based) and the calibration.
- **Data-integrity guards added:**
  - Share counts from different filings that disagree by more than 25 % are flagged, and the valuation classification is withheld as "too uncertain" (e.g. SMFG: 7.8 B weighted diluted vs 3.8 B on the cover page).
  - The cover-page count is used when no diluted count exists (TotalEnergies, AB InBev).
  - The DCF floors net investment at zero when D&A exceeds capex. Otherwise depreciation of leased assets adds cash for ever (Honda, AstraZeneca); the model's assumptions say so.

### 11.3 Network robustness
- Every research request has a 20 s timeout, 3 attempts with back-off, and response validation.
- Server quotes have a 15 s timeout and 1 retry.
- This fixed the SPY download that had taken the regime panel down.

### 11.4 Files
- **New:** `lib/encodings.js`, `lib/fx.js`, `test/heatmap.test.js`.
- **Changed:** `src/research.js`, `lib/fundamentals.js`, `lib/valuation.js` (DCF floor), `lib/decision.js` (comparison wording, local risk-free label), `public/heat.js`, `public/index.html`, `public/style.css`, `server.js`, `README.md`.

### 11.5 Known limitations (Part 02)
- **Valuation pathologies are flagged, not fixed** (Part 03 will address them):
  - Honda's DCF is about 9× its price, driven by 14 % yen revenue growth and a 4.4 % WACC from cheap yen debt.
  - SMFG's book-value model reflects the disputed share count.
  - Both are withheld as "too uncertain".
- **Earnings revisions:** only reported EPS changes for US 10-Q filers. 20-F filers have no quarterly XBRL. Analyst revisions need a key (Finnhub, §8.1).
- **Price-only companies:** no market cap, since there is no share count, so they are drawn at the smallest size with the "size unavailable" corner.
- **Quotes:** delayed (Yahoo, about 15 min), refreshed every 60 s while viewed. They are not live, and the map says so.
- **Sector peers** for comparables now include international companies. That is broader, but mixes accounting standards (IFRS vs US GAAP).

## 12. Part 03: valuation and quantitative engines (done, 2026-11-25)
The formulas, inputs, assumptions and limitations of every module are in **`docs/MODELS.md`**.

### 12.1 Review against the brief, and what changed
| Brief item | First pass | Now |
|---|---|---|
| 6 models, independently inspectable | yes | unchanged; every model card is expandable |
| Conservative / base / optimistic, range | yes | unchanged |
| Sensitivity to assumptions | DCF only | **every model** (`V.sensitivity`), shown as a table per model |
| Model limitations | yes | unchanged |
| Data freshness | page-level only | **per model**: filing date and age, price time, and which data it uses |
| Confidence and uncertainty | synthesis-level only | **per model**: `high` / `medium` / `low` with stated reasons |
| No blind averaging; expose disagreement | primary + agreement % | plus a **disagreement table**: each model vs the primary range, % difference, range overlap |
| User-editable inputs | growth, margin, discount, terminal, EPS, capex, debt, cash | plus **β, ERP, risk-free rate**, which re-derive cost of equity and WACC |
| Scenarios | 7 named scenarios | unchanged (sorted by effect; classification change flagged) |
| Momentum: relative strength | vs SPY by bar count; US only | **vs local index on common dates** (16 indices); international stocks now included |
| Exhaustion: relative-strength divergence | RSI divergence only | plus price ÷ index divergence |
| Volatility: regime-dependent | index above/below its 200-day average (US only) | plus calm vs turbulent index (20-day σ vs median, no look-ahead); all markets |
| Liquidity: costs and slippage | single estimate; **spread 2× too high** | estimator fixed (per-pair floor, ×2 bug removed); **cost curve** $10 k–$10 M with a not-fillable-in-a-day flag; labelled theoretical |
| Fundamentals | full list | ROIC tax fallback = statutory rate; IFRS revenue and EPS tags added (Novartis, Sanofi, Shell) |
| Regime: multiple indicators, uncertainty | US only | plus **one regime per local index** |
| Valuation history | restated data (look-ahead) | **point-in-time**: filings public on each annual report's filing date, priced that month |
| Calibration | price returns; restated EPS | **total returns**; EPS versions used only after their filing date |

### 12.2 Changes to defaults (rationale in `docs/MODELS.md` §1.1)
- **Growth:** the median of the 1-, 3- and 5-year revenue CAGRs, shrunk halfway toward terminal growth, clamped to [−5 %, 15 %], range ±4 pts.
  - Effect: TSMC 20 % → 12.3 %, Honda 14 % → 5 %.
- **WACC:** floored at risk-free + 2 pts. Honda's 4.4 % becomes 4.8 %, flagged in the assumptions.
- **Tax fallback:** the country statutory rate (OECD 2024) instead of US 21 %.

### 12.3 Verified on the live data (2026-11-25)
- 98/98 companies, no errors.
- International β against local indices, e.g. TSMC 1.09 ± 0.02 vs TAIEX, Shell 0.50 ± 0.08 vs FTSE 100.
- 4–10 point-in-time valuation-history points per company.
- 16 local regimes.
- Calibration (US, total returns, point-in-time EPS, 35 quarters):
  - earnings-yield IC −0.034 (t −0.79);
  - 12−1 momentum IC +0.035 (t +0.74);
  - neither significant.
- Build: about 60 s with a full SEC re-download, about 17 s with a warm cache. Heap about 80 MB after GC, RSS about 320 MB.

### 12.4 Files
- **New:** `docs/MODELS.md`, `test/engines.test.js`.
- **Changed:** `lib/valuation.js`, `lib/quant.js`, `lib/stats.js` (slope standard error), `lib/fundamentals.js` (`asOf`, `restatements`, tags, tax fallback), `lib/calibrate.js`, `src/research.js`, `public/heat.js`, `public/style.css`.

### 12.5 Tests
- **58 pass:** 41 earlier, plus 17 in `test/engines.test.js`. They cover:
  - growth shrinkage, the WACC floor, the tax fallback, consistent re-derivation;
  - sensitivity, freshness and confidence for every model; sensitivity directions; confidence levels; disagreement positions;
  - `asOf` hiding later restatements; restatement counting; calibration not leaking future EPS versions;
  - date alignment; β recovery with its standard error; the total-return index;
  - the spread estimator on a known 1 % bounce; the cost curve; relative-strength divergence.
- **UI harness:** 0 errors (all colour, size, grouping and region combinations; 11 company panels × 6 tabs; comparison).

### 12.6 Known limitations (Part 03)
- **Captive-finance groups (Honda, Toyota):** consolidated FCFF mixes a lending business funded by debt. The DCF is misspecified (Honda about 4× its price), and every Honda model is rated low confidence with the classification "uncertain".
- **SMFG:** ROE from XBRL (2.9 %) looks implausibly low and the share counts conflict, so it is flagged and withheld.
- **BP:** no EPS or share counts in its XBRL at all, so it remains "insufficient".
- **β and ERP in valuation history** are today's values. No free point-in-time β exists.
- **Spread estimates** come from daily bars, not quotes: about 0.8 % against a true 1 % on synthetic data.

## 13. Part 05: historical validation and overfitting protection (done, 2026-11-25)
Engine `lib/backtest.js` (pure, tested); runner `src/validation.js`; view §5 **Validation** (`public/validation.js`). API: `/api/validation`, `/api/validation/run?force=1`, `/api/validation/experiments`, `/api/validation/experiment?id=`.

### 13.1 Brief → implementation
| Requirement | Implementation |
|---|---|
| Chronological train / validation / test | 60 % / 20 % / 20 % of the months. Parameters are chosen on train Sharpe only; test is computed once and reported as out-of-sample. |
| Rolling-window testing | Rolling 24-month Sharpe, strategy vs benchmark, labelled descriptive. |
| Walk-forward | Choose on the trailing 36 months, hold 12, repeat. Holdings carry over and switching costs are charged (`simulateSchedule`). |
| Out-of-sample evaluation | The test segment and the concatenated walk-forward windows. |
| Market-regime testing | Each month labelled from SPY up to that month (above or below its 10-month average; 6-month σ vs its median so far). Results per regime on validation and test. |
| Transaction costs | 10 bp per unit of weight traded, on every rebalance. Sensitivity at 0, 10, 25 and 50 bp on validation. Turnover and cost drag reported. |
| Survivorship bias | Cannot be removed with free data (no delisted prices). Disclosed everywhere. **Survivorship gap** = equal-weight universe CAGR − SPY CAGR (+3.5 %/yr) as an upper bound. |
| Look-ahead prevention | Signals read only indices ≤ m; eligibility depends only on data at m; returns m → m+1. Tested by shocking every price after m and checking all signals and regimes at m are unchanged. |
| Point-in-time fundamentals | EPS versions used from their filing date (originals, and restatements once filed); stale > 18 months = unknown. The valuation-engine signal reruns DCF, EPV and book with `F.asOf()` and β = 1. |
| Delisted stocks | Not available from free sources. A holding without a next price exits at its last price and is counted as a "missing exit". |
| No shuffling | Never; all splits are chronological. Random baselines randomise *picks*, not time. |
| Benchmarks | SPY total return; equal-weight universe; buy-and-hold equal weight; 12−1 momentum; earnings-yield value; low volatility; value + momentum; 300 seeded random portfolios. |
| Metrics | Total return, CAGR, volatility, Sharpe (vs 13-week T-bill), Sortino, max drawdown, excess return, information ratio, win rate vs benchmark, profit factor, turnover, cost drag, exposure, names, regime breakdown. |
| Reliability | Degradation (in-sample → validation → test → walk-forward), parameter sensitivity (train and validation only), deflated Sharpe ratio (Bailey & López de Prado 2014), random-baseline percentile. |
| Categories never mixed | Separate columns per category with distinct colours. Paper-trading results live in the paper book (Part 07); live is disabled. |
| Reproducible experiments | id = sha1(config + data fingerprint). Stored in `data/research/experiments/`, with assumptions and biases. The same inputs give the same id and results (verified: scratch and live runs identical). |

### 13.2 First results (experiment `6bc6096c65a0`, 55 US stocks, 2016-12 → 2026-11, 14.7 s on the phone)
| Strategy | In-sample Sharpe | Validation | **Test** | **Walk-forward** | Test vs random |
|---|---|---|---|---|---|
| Momentum 12−1 | 1.09 | 1.34 | **0.06** | 0.66 | 18th pct |
| Value (earnings yield, point-in-time) | 0.43 | 1.50 | **1.29** | 1.03 | 94th pct |
| Low volatility | 0.45 | 1.30 | 0.78 | 0.59 | 59th pct |
| Value + momentum | 0.83 | 1.98 | 0.49 | 0.96 | 31st pct |
| Valuation engine (point-in-time premium) | 0.47 | 1.47 | 0.53 | 0.58 (excess ≈ 0) | 46th pct |

SPY (full sample) CAGR 12.8 %, Sharpe 0.65. Equal-weight universe CAGR 16.3 %.

Reading:
- Momentum's in-sample strength did not survive out of sample.
- Value is the only signal that beat most random portfolios in the test segment. About 21 test months is still weak evidence, and survivorship flatters every row.
- These results feed the decision-engine weights in Part 04.

### 13.3 Tests
- **70 pass**, 12 of them in `test/backtest.test.js`:
  - signals and regimes unchanged when the future is shocked; EPS and restatements visible only from their filing date; eligibility independent of the future;
  - exact two-stock accounting (drift, traded weight, costs); metrics on known series;
  - parameter choice unchanged when test data change; chronological, non-overlapping segments; walk-forward first window independent of later data;
  - seeded reproducibility; deflated Sharpe monotonic in the number of trials and in Sharpe; survivorship gap.
- **UI stub:** every strategy renders with no `undefined` or `NaN`, and all 4 charts get finite data.

### 13.4 Limitations
- US universe only. International filing histories are shorter, and the currencies differ.
- Monthly frequency; long-only, equal-weight portfolios.
- One test segment of about 21 months.
- The valuation-engine signal omits comparables and own history (they need point-in-time peers), and uses β = 1.

## 14. Part 04: decision intelligence and uncertainty decomposition (done, 2026-11-25)
The method is in `docs/MODELS.md` §6.

### 14.1 Brief → implementation
| Requirement | Implementation |
|---|---|
| Three independent outputs | Opportunity, risk and confidence, built from disjoint inputs. A test checks that confidence inputs cannot move the other two. |
| Opportunity items | valuation, momentum, quality, relative performance, growth prospects (the shrunk assumption), **catalysts** (reported EPS change, plus estimated report and ex-dividend dates), opportunity cost (yield − local risk-free) |
| Risk items | volatility, drawdown, valuation risk, distress, liquidity, concentration (from the paper portfolio, Part 06), model risk, regime risk |
| Confidence items | completeness, **data quality** (new), freshness, model agreement, **primary-model confidence** (new), historical signal performance and out-of-sample results (**real Part 05 evidence**), stability, sensitivity, range width, coverage |
| High opportunity ≠ high confidence | Independent by construction. Interpretation bands make 86/79/38 read as attractive but highly uncertain. |
| Explanations for every score | Every component carries its raw value, explanation, calculation, source, prior weight with rationale, the weight used, and its evidence. Shown in expandable tables. |
| Calibrate against history; no false precision | Weights are capped by out-of-sample results. Scores are rounded to 5 and withheld with fewer than 3 measured components. The composite cannot be rebuilt historically (stated as a limitation); its validated signal families are. |
| Uncertainty decomposition | supporting / contradicting (shown first) / unknown / assumptions / swing variables / alternative explanations / failure conditions / limitations / catalysts. Model disagreements without range overlap count as contradicting evidence. |
| Scenario analysis | 7 valuation scenarios, now also fed into the **scores**, sorted by effect on the conclusion |
| Traceability | source → calculation → assumption → validation evidence → uncertainty, per component |
| Comparison | relative valuation, risk, opportunity, confidence and data quality; opportunity cost; **return correlation**. Never selects a winner. |

### 14.2 Current evidence caps (experiment `6bc6096c65a0`)
| Component | Result |
|---|---|
| Valuation | weight 2 → **1** (valuation-engine signal weak out of sample: walk-forward excess ≈ 0, test 46th percentile) |
| Momentum | weight 1 → **0.5** (test 18th percentile) |
| Relative performance | weight 0.5 → **0.25** (momentum family) |
| Opportunity cost | weight **1** kept (value family supported: walk-forward excess +6.4 %/yr, test 94th percentile) |

Quality, growth and catalysts are untested and keep their priors, labelled "untested".

### 14.3 Live distribution (98 companies)
| Score | Min / median / max |
|---|---|
| Opportunity | 5 / 50 / 90 |
| Risk | 10 / 50 / 85 |
| Confidence | 15 / 60 / 75 |

Price-only companies now show "withheld" rather than a score built on 2 price inputs.

### 14.4 Tests
- **81 pass**, 11 of them in `test/decision.test.js`:
  - rank semantics; evidence multipliers (caps only); weak evidence halving weights and being listed as contradicting;
  - independence; the brief's example interpretation; traceability fields; scenario score effects;
  - data-quality penalties and "unknown when empty"; catalyst estimates labelled; comparison correlation; withholding.
- **UI harnesses:** heat map and validation views on the live server, 0 errors.

### 14.5 Limitations
- Percentile ranks are relative to this universe of 98. A score of 80 means "better than most of these", not good in absolute terms.
- Untested components (quality, growth, catalysts) rely on priors.
- Catalyst dates are estimates; no earnings calendar API is used. A Finnhub key, if provided, would add announced dates.

## 15. Part 06: portfolio and opportunity-cost engine (done, 2026-11-25)
- **Engine:** `lib/portfolio.js` (pure, tested).
- **Server:** `src/portfolio.js`. Weekly US$ series; saved portfolios in `data/portfolios.json` with a revision check.
- **View:** §6 **Portfolio lab** (`public/portfolio.js`).
- **API:** `GET/PUT /api/portfolio`, `POST /api/portfolio/analyze`.
- **Method:** `docs/MODELS.md` §7.

### 15.1 Brief → implementation
| Requirement | Implementation |
|---|---|
| Existing holdings | Saved portfolios (the "current" one), and the equity paper book from Part 07, which takes precedence once it has positions |
| Sector concentration, diversification, correlations, volatility, risk contributions | Exposures with Herfindahl; diversification ratio; effective bets and holdings; shrunk correlation matrix; σ; risk contributions vs weights |
| Capital exposure, liquidity, transaction costs | US$ per holding; currency, region and country exposure; days to exit; build cost |
| Opportunity cost | Per candidate: price vs value, growth, risk score, confidence, correlation with holdings, Δ portfolio σ, sector weight after, entry cost, cost hurdle per year of holding, yield vs risk-free (the alternative use of capital). Never picks. |
| Portfolio scenarios | Market decline, sector decline, correlation rise, volatility shock, liquidity deterioration, rates +1 pt |
| Visualisation | Money vs risk bars, correlation heatmap, stacked concentration bars, look-back vs SPY, tables |
| Capital allocation research | 6 allocations side by side: σ, diversification, effective bets, max sector, build cost, weighted premium, look-back (marked in-sample) |
| Hypothetical vs actual | Every output is labelled hypothetical. The look-back is labelled in-sample. No order is ever placed. |
| Integration with the valuation and decision engines | Assets carry premium, status, growth and the three scores. The rates scenario uses each company's valuation model. Portfolio concentration feeds the risk score's concentration component (re-scored on save). The company panel has a "+ Portfolio candidate" button; the comparison tray can feed candidates. |

### 15.2 Verified on live data
Example portfolio: AAPL 30 %, MSFT 20 %, TSMC 20 %, Novo 15 %, JPM 15 % (US$ 250 k).
- **Shape:** 100 weeks; shrinkage 0.22; σ 19.1 %; diversification ratio 1.79; 4.6 effective bets; β 1.10.
- **Risk vs money:** Novo is 15 % of the money but 23 % of the risk.
- **Scenarios:** market −20 % → −22 %; correlations halfway to 1 → σ 27.7 %; rates +1 pt → estimated value −13.8 %.
- **Candidates:** Shell has 0.02 correlation with the holdings and **lowers** σ; NVDA raises it and takes Tech to 72 %.
- **Speed:** analysis about 130 ms on the phone.

### 15.3 Tests
- **91 pass**, 10 of them in `test/portfolio.test.js`:
  - shrinkage bounds, symmetry and its dependence on sample size; refusal with too little data;
  - risk contributions summing to 1; effective bets = N for equal uncorrelated assets;
  - closed-form minimum variance; equal risk contributions; inverse-volatility ratio; capped-simplex projection;
  - exposures, Herfindahl, liquidity days and cost; every scenario's formula;
  - opportunity-cost direction and hurdle; valuation-tilt ordering; storage validation and revision conflicts.
- **UI stub:** the Portfolio lab against the live server, 0 errors, 4 charts.

### 15.4 Limitations
- **Spread estimates** come from daily bars and are biased upward for volatile stocks (NVDA reads about 76 bp; the real spread is about 1 bp). They are replaced when a quote feed is configured (Part 08).
- **Two years of weekly data** describe the recent regime only.
- **Scenarios are first-order:** β-linear, no option-like effects, no spill-over between sectors.
- **US$ is the base currency.** No hedging is modelled.

