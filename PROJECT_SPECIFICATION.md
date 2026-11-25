# Project Specification: Valuation-Integrated Market Intelligence & Trading System

Living document. Each new specification part **extends** this file and does not replace earlier requirements.
Status as of 2026-11-25: **Parts 01–04 implemented** (audit, valuation-integrated heat map, multi-model valuation and quant analysis, decision intelligence). Live trading stays disabled. Waiting for Part 05.

---

## 1. Standing principles (from Part 01)
- **Analytical independence.** Valuation, momentum, risk, confidence and execution are separate components with separate outputs. No single composite score may silently dominate.
- **Transparency.** Every number shows its inputs, assumptions and data source. Estimates are labelled as estimates.
- **No fabrication.** Only real market and financial data. A missing value stays missing; it is never filled with synthetic data.
- **Capital preservation first.** Live trading stays **disabled** until it is separately authorised, validated and legally appropriate. Paper trading only until then.
- **Lightweight and local-first.** Few dependencies and modest RAM and CPU use. Heavy components need a written justification here.
- **Continuity.** Existing data, configuration and working features are preserved.

## 2. Existing system (audit, 2026-11-25)

### 2.1 Identity
"Market Microstructure Laboratory": a private, local web app for live market observation and paper trading.
- Runs on an Android phone (Termux, proot Ubuntu, aarch64) and is viewed from a PC over the phone's hotspot.
- Repository: github.com/nahsed7/QuantaDec404 (MIT).

### 2.2 Stack
| Layer | Technology | Notes |
|---|---|---|
| Server | Node.js 22, **zero npm dependencies** (`http`, `fetch`, global `WebSocket`, `zlib`) | `server.js`, 390 lines, ~22 MB RSS |
| Front end | Vanilla JS, Plotly 2.35.2 (CDN), custom canvas renderer, GeoGebra (CDN, function page only) | `public/` |
| Storage | JSONL append files plus one JSON account file in `data/` (gitignored, ~6 MB) | No database |
| Launcher | `start.sh`, `start.bat`, `serve-bg.sh`, `app.py` (Streamlit wrapper, untested) | |

### 2.3 Components
| File | Lines | Role |
|---|---|---|
| `server.js` | 390 | Static server and REST/SSE API, data feeds, order-book recorder, FX composite relay, account store, zip download |
| `public/app.js` | 778 | Main UI: heatmap, live candles, 10-D 3D state space, order flow, analysis figures |
| `public/lab.js` | 203 | Pure maths (UMD, Node-testable): features, KDE forecast, correlations, Takens embedding, Hurst R/S, Fisher–Rao distance, H0 persistence, PCA (Jacobi), Isomap |
| `public/trade.js` | 212 | Paper-trading account: bid/ask fills, leverage, TP/SL, stop-out, revision-checked saves |
| `public/fn.js` + `function.html` | 196 + 73 | Live price as closed-form P(x) (line + sine-series least squares) for GeoGebra/Desmos |
| `public/index.html`, `style.css` | 237, 146 | Layout, holographic dark theme plus a light theme |

### 2.4 API surface
`/api/heatmap`, `/api/klines`, `/api/trades`, `/api/sentiment`, `/api/fng`, `/api/book`, `/api/fx/bars`, `/api/fx/stream` (SSE), `/api/fx/status`, `/api/account` (GET/PUT, rev check), `/api/account/history` (versions plus restore), `/download`.

### 2.5 Data sources in use
| Source | Data | Access | Reliability |
|---|---|---|---|
| Yahoo Finance v8 chart | Equity quotes (54 hard-coded large caps), FX history | Unofficial, no key | Can break or rate-limit without notice |
| Binance (data-api.binance.vision, WS stream) | Crypto klines, trades, book ticker, depth | Official public, no key | Good |
| Binance futures (fapi) | Long/short ratio, funding | Official public | Geo-blocked in some regions (e.g. US) |
| TrueFX | Indicative interbank FX quotes | Free, no login | Indicative only, not executable; ~1 update/s |
| Kraken WS v2 | Real fiat FX quotes and trades for 7 pairs | Official public | Good; JPY pairs inactive |
| alternative.me | Crypto Fear & Greed index | Free | A crypto index, not equity sentiment |

### 2.6 What works (verified in earlier sessions)
- Live equity heatmap.
- Crypto and FX live candles.
- Composite FX feed: Kraken shifted onto the TrueFX level; ~0.16–0.19 pip tracking error vs TrueFX; ~21–35 quotes/s on EUR/USD.
- Order-book depth recording.
- 10-D state-space view and the five analysis methods.
- Paper trading with P&L currency conversion.
- Function view: the formula text matches the fit to within 0.001 units.

### 2.7 Limitations and weaknesses found
1. **No fundamentals at all.** No financial statements, valuation, filings, macro data or risk-free rate. This is the largest gap against Part 01.
2. **Equity coverage.** 54 hard-coded tickers. Price change only, with no history store and no corporate actions.
3. **Unofficial Yahoo dependency** for equities and FX history.
4. **No database.** JSONL suits tick streams but not relational financial data. Order-book JSONL files grow without on-disk compaction.
5. **FX recording gaps.** FX bars are recorded only while someone views the site or requested bars in the last 10 min, and Yahoo 1-m FX history is sparse.
6. **Monolithic UI file.** `app.js` (778 dense lines, shared global state) is hard to test and extend.
7. **No tests in the repo.** The harnesses (`smoke.js`, `tradetest.js`, fake DOM) live outside it.
8. **No access control.** The server binds `0.0.0.0` with no authentication, so anyone on the hotspot can read or modify the paper account and download the source. This must be fixed before any brokerage integration.
9. **Statistical caveats.**
   - The KDE "forecast" is the empirical distribution of past returns, not a predictive model.
   - Hurst, persistence and Isomap run on small samples with no confidence intervals.
   - The FX composite assumes a slowly varying basis, and TrueFX is itself indicative.
10. **Paper-trading realism.** Bid/ask spread only: no commissions, swaps or financing, slippage model, or margin calls beyond a stop-out at margin.
11. **Isomap cost.** O(n²) memory, plus Dijkstra over all points; slow on the phone for n ≥ 1000.
12. **Untested pieces.** `app.py` was syntax-checked only. GeoGebra rendering was tested with a stub only.

### 2.8 Hardware (phone, the current host)
- 8-core aarch64, 3.6 GB RAM (~1 GB available), 4 GB swap.
- **2.6 GB disk free (95% full).**
- Mobile data, with ~0.4–0.6 s network latency.
- Python 3 is minimal: no numpy or pandas installed.
- A PC is available for viewing and could run heavier jobs.

## 3. Recommended architecture (proposal, not yet agreed)
Keep the Node core and grow it in modules. Each analytical component is independent and exposes its inputs.

```
server.js (thin router)
src/
  feeds/        market data adapters (binance, kraken, truefx, yahoo, …), one interface: quotes, bars, trades
  fundamentals/ SEC EDGAR XBRL loader, normaliser (statements, shares, segments), restatement-aware
  macro/        risk-free curve (US Treasury), rates, inflation (FRED)
  store/        node:sqlite for fundamentals/valuations/runs; JSONL for tick streams (with rotation)
  valuation/    DCF (FCFF/FCFE), residual income, multiples, reverse-DCF; each returns a distribution plus assumptions
  quant/        momentum, factor exposures, volatility models; reuse lab.js
  risk/         VaR/ES, drawdown, beta, liquidity, scenario and stress tests
  confidence/   data quality, model agreement and parameter-sensitivity scores (separate from opportunity)
  portfolio/    allocation research (risk parity, Kelly-capped, mean-variance with shrinkage)
  backtest/     walk-forward, transaction costs, out-of-sample discipline
  execution/    broker interface; paper adapter = current trade logic; live adapters behind a hard disabled flag
public/         UI split into per-view modules
test/           unit tests (node:test) plus the existing harnesses moved in
```
- **Storage:** built-in `node:sqlite` (Node ≥ 22.13), so no new dependency.
- **Computation:** JavaScript `Float64Array` numerics for the online parts. Optional Python (numpy/scipy/statsmodels) on the PC for heavy offline research, with no requirement on the phone.
- **Security before brokerage:** an access token, an option to bind to localhost only, and an audit log of every order.

## 4. Dependency policy
- **Default:** none beyond Node built-ins. Existing CDN libraries (Plotly, GeoGebra) stay.
- **Candidates, only when needed:**
  - `node:sqlite` (built-in).
  - Optional PC-side Python: numpy, scipy, pandas and statsmodels, for research notebooks only.
  - No large ML models.

## 5. Data-provider options
| Need | Provider | Cost and limits | Notes |
|---|---|---|---|
| US fundamentals | **SEC EDGAR XBRL API** (companyfacts, submissions) | Free, official, 10 req/s | Requires a User-Agent with contact info (the user must supply it). US filers only. As-reported data needs normalising. |
| Fundamentals (broader, normalised) | Financial Modeling Prep | Free tier ~250 req/day | API key; limited history on free tier |
| | Alpha Vantage | Free 25 req/day | API key; too limited for screening |
| | Finnhub | Free tier, 60 req/min | API key; fundamentals partly premium |
| Equity prices | Yahoo (current), Stooq (EOD CSV), Alpaca market data (free IEX feed) | Free | Yahoo is unofficial; Alpaca needs an account |
| Risk-free and macro | US Treasury yield-curve XML, FRED | Free (FRED key) | Official |
| FX | TrueFX + Kraken (current) | Free | OANDA rejected by the user as too expensive |
| Paper or live brokerage | Alpaca (paper API free; US equities and crypto), Interactive Brokers (broad; heavier gateway) | Free paper | Live stays disabled per §1 |
| Not used | Broker session-cookie or unofficial binary-option APIs | n/a | Terms-of-service and account-security risk |

## 6. Incremental roadmap (proposal)
0. **Hygiene.**
   - Move tests into `test/` and run them against an isolated port and data dir, never the live account.
   - Add an access token and a bind option.
   - Rotate the order-book JSONL files.
   - Split `app.js` into modules.
1. **Data layer.**
   - `node:sqlite` store.
   - Equity price history (daily) for a configurable universe.
   - Treasury risk-free curve.
2. **Fundamentals.** EDGAR XBRL ingestion and normalisation (income, balance, cash flow, shares), with data-quality flags.
3. **Valuation.** DCF, residual income, multiples and reverse-DCF. Every model outputs a value distribution (Monte Carlo over stated assumption ranges) plus a sensitivity table.
4. **Quant and risk.** Momentum, volatility, beta, drawdown, VaR/ES and liquidity, kept separate from valuation.
5. **Confidence and opportunity.**
   - Confidence measures data completeness, model dispersion and assumption sensitivity.
   - Opportunity is a valuation gap compared with risk, reported alongside confidence and never merged into it.
6. **Scenarios and backtesting.** Historical and forward scenarios, and walk-forward backtests with costs.
7. **Portfolio research.** Allocation methods with constraints, plus the paper portfolio.
8. **Execution architecture.** Broker interface, a paper adapter, and live adapters coded but hard-disabled.

## 7. Decision log
| Date | Decision |
|---|---|
| 2026-11-24 | Real data only; no simulations. |
| 2026-11-24 | Free FX composite (Kraken + TrueFX) instead of OANDA. |
| 2026-11-24 | Tests must never target the live server (port 8080) or `data/account.json`. Use `PORT=8099 DATA_DIR=<tmp>`. |
| 2026-11-25 | Part 01: audit only. Spec file created. Live trading disabled. |
| 2026-11-25 | Parts 02–04 built with zero npm dependencies; analytics in `lib/` shared by server and browser. Fundamentals from SEC EDGAR (free, official), risk-free rate from US Treasury. Valuation models never averaged. |

## 8. Outstanding questions for the user
- Equity universe: US only (EDGAR) or international?
- SEC User-Agent: currently a generic tool name. The SEC asks for contact details; add yours if requests get blocked.
- Willingness to create free API keys (FRED, FMP, Alpaca paper).
- Should heavy research run on the PC (Python allowed there) or stay phone-only?

## 9. Testing status
- Manual and harness smoke tests passed for the earlier features (2026-11-24).
- `node --test test/*.test.js`: **22 tests, all passing** (2026-11-25). They cover treemap geometry and colour mapping, valuation markers, DCF/DDM against hand-computed values, comparables excluding the company itself, synthesis never averaging, scenarios, missing-data handling, quant functions refusing short data, score independence, comparison never picking a winner, and calibration using only filings public at each formation date.
- Browser code exercised against real data with a stub DOM (every tab, comparison, regime panel).
- Performance on the phone: full research recompute ~5.8 s, per-minute price refresh ~0.24 s, heap ~47 MB after GC (capped at 256 MB in `serve-bg.sh`).

## 10. Part 02: valuation-integrated heat map (done)
- **Files:** `public/heat.js` (UI), `lib/treemap.js` (squarified treemap, colour scales, valuation marker; pure, tested).
- **Size:** market cap, volume, dollar turnover or other metrics, chosen by the user. **Colour:** 1D, 1W, 1M, 3M returns, or sector-relative return.
- **Valuation on every tile:** a small marker places the price inside the primary model's low/base/high range. The border shows the status: below, within, above, or "too uncertain". The hover card shows price, range, premium or discount, valuation percentile and confidence.
- **Research panel** opens beside the map (no page change). It shows price and valuation history, fundamentals, momentum, volatility, liquidity, the three scores, and supporting and contradicting evidence. Several companies can be compared.
- **Legend** explains every encoding. Each metric carries its source and timestamp, labelled live, delayed, historical or estimated. Missing data is shown as missing.

## 11. Part 03: valuation and quantitative engines (done)
- **Data** (`src/research.js`, cached on disk in `data/`, stale cache used if a source fails):
  - SEC EDGAR XBRL companyfacts for fundamentals. The SEC User-Agent is a generic tool name, with no personal contact details.
  - Yahoo daily and monthly prices.
  - US Treasury yields for the risk-free rate.
- **Universe:** 54 US large caps with CIKs verified against EDGAR. Banks, brokers and insurers (JPM, BAC, WFC, GS, MS, BRK-B) are excluded from FCFF models. BRK-B per-share figures are divided by 1500.
- **Valuation** (`lib/valuation.js`): DCF, dividend discount, comparables (peer quartiles, the company itself excluded), earnings-based, asset-based and historical multiples. Each model gives a conservative, base and optimistic value, with its inputs, assumptions and limitations.
  - `synthesize()` never averages. One primary model sets the range; the others are checks, and their agreement and dispersion are reported. If the range is too wide or the models disagree, the status is "uncertain".
  - Growth, margins, discount rate, terminal growth, EPS, capex, debt and cash can be edited in the browser. The models recompute there because `lib/` is shared (UMD).
  - `scenarios()` ranks which assumption moves the value most.
- **Fundamentals** (`lib/fundamentals.js`): growth, margins, earnings quality, FCF, leverage, ROIC, dilution, dividend cover and deterioration flags.
- **Quant** (`lib/quant.js`): multi-period returns, moving averages, RSI, relative strength, trend persistence, acceleration and volume confirmation.
  - Exhaustion: distance from moving averages, return-distribution percentile, volatility expansion, divergence. This is never presented as a reversal signal.
  - Volatility: realised volatility, clustering, drawdowns and tail estimates (VaR/ES).
  - Liquidity: spread, ADV, turnover, Amihud ratio and estimated cost and slippage. These are theoretical; real execution can differ.
- **Regime** (`lib/regime.js`): independent indicators (SPY trend, VIX, breadth, sector rotation, liquidity stress) vote. The vote split is shown as the uncertainty.

## 12. Part 04: decision intelligence (done)
- **Engine** (`lib/decision.js`): three independent scores (opportunity, risk, confidence), each listing its components and the reason for each. A component that cannot be measured is excluded from opportunity and risk and counts as 0 for confidence. Scores are rounded to 5 points, since finer precision would be false.
- **Interpretation text** is written for each combination, e.g. "attractive but highly uncertain". There is never a buy or sell signal.
- **Uncertainty decomposition:** supporting and contradicting evidence (contradicting evidence shown first), unknowns, assumptions, alternative explanations, failure conditions and model limits.
- **Scenarios:** growth −3 pp, higher discount rate, lower margins, sector multiples contracting, more debt and EPS changes. Each shows how the value and status change.
- **Comparison** (`compare()`) shows relative valuation, risk, opportunity, confidence and data quality. It never selects a winner.
- **Calibration** (`lib/calibrate.js`): checks cheapness (earnings yield) and 12−1 momentum against the following quarter's return, using only filings already public at each formation date. The result feeds the "historical performance" part of confidence.
- **API:** `/api/research/universe`, `/api/research/company?sym=`, `/api/research/regime`.

## 13. Known limitations (Parts 02–04)
- Yahoo remains unofficial for prices. EDGAR covers US filers only. There are no analyst estimates, so "earnings revisions" come from changes between filings, not from consensus.
- The calibration sample is small (54 stocks, a few years of quarters), so its results are indicative only.
- There is no out-of-sample backtesting of the scores yet (roadmap: scenarios and backtesting).
