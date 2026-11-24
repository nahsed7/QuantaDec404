# Market Microstructure Laboratory

A local website with live market data (no simulations) and five analysis methods.

## Run
- **Windows:** install Node.js LTS from https://nodejs.org, then double-click `start.bat`.
- **Mac/Linux/Termux:** `./start.sh` (or `node server.js`), then open http://localhost:8080

No `npm install` needed.
- **Streamlit:** `pip install -r requirements.txt` then `streamlit run app.py`. It starts the Node server and shows the lab in the page (downloads a portable Node 22 if missing).

## Sections
1. Equity heatmap: 54 US large caps, Yahoo Finance, 15 s refresh
2. 10-D state space: time, price, volume, volatility, bid depth, ask depth, pressure, sentiment, future-price density; live candle chart and a demo trading account
3. Order flow: every trade, buyer- vs seller-initiated, Binance aggregate-trade stream
4. Analysis: multivariate time series, dynamical systems, information geometry, TDA (H0), manifold learning (PCA/Isomap)

## Data sources
- **FX:** TrueFX interbank quotes, plus Kraken WebSocket quotes and trades shifted to the interbank level by a measured basis (the "composite" feed, up to ~35 updates/s). JPY pairs use TrueFX only.
- **Crypto:** Binance spot (bars, trades, order book) and USD-M futures (long/short sentiment).
- **Other:** Yahoo Finance (equities, FX history), alternative.me Fear & Greed.

Recorded data and the demo account are stored in `data/` (not in the repo).
