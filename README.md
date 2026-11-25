# Market Microstructure Laboratory

A local website with live market data (no simulations) and five analysis methods.

## Run
- **Windows:** install Node.js LTS from https://nodejs.org, then double-click `start.bat`.
- **Mac/Linux/Termux:** `./start.sh` (or `node server.js`), then open http://localhost:8080

No `npm install` needed.
- **Streamlit:** `pip install -r requirements.txt` then `streamlit run app.py`. It starts the Node server and shows the lab in the page (downloads a portable Node 22 if missing).

## Sections
1. Valuation-integrated equity heat map: 98 large companies (55 US, 43 international). Size, colour, borders, valuation-range markers and move-vs-value flags; a research panel with valuation models, scores and evidence. Prices refresh every 60 s while the page is open.
2. 10-D state space: time, price, volume, volatility, bid depth, ask depth, pressure, sentiment, future-price density; live candle chart and a demo trading account
3. Order flow: every trade, buyer- vs seller-initiated, Binance aggregate-trade stream
4. Analysis: multivariate time series, dynamical systems, information geometry, TDA (H0), manifold learning (PCA/Isomap)

## Data sources
- **FX:** TrueFX interbank quotes, plus Kraken WebSocket quotes and trades shifted to the interbank level by a measured basis (the "composite" feed, up to ~35 updates/s). JPY pairs use TrueFX only.
- **Crypto:** Binance spot (bars, trades, order book) and USD-M futures (long/short sentiment).
- **Equities:** Yahoo Finance (delayed quotes, daily and monthly history, dividends; home-market listings for international companies).
- **Fundamentals:** SEC EDGAR XBRL, free and official: 10-K for US companies, 20-F/40-F (IFRS or US GAAP) for international ones. Six international companies have no free filings source and are shown with prices only.
- **Rates and FX:** US Treasury yield curve; OECD 10-year government bond yields via the FRED CSV (no key needed); Yahoo FX.
- **Other:** alternative.me Fear & Greed.

Recorded data, the research cache and the demo account are stored in `data/` (not in the repo).

Tests: `node --test test/*.test.js`. Specification and progress: `PROJECT_SPECIFICATION.md`.
