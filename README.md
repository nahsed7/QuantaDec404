# QuantaDec404: market research workstation

A private, local-first environment for understanding markets, estimating what companies may be worth, quantifying risk and uncertainty, testing ideas out of sample, researching portfolios and simulating trades. Real data only, with every estimate labelled. **Live trading is disabled.**

## Setup
| Platform | Steps |
|---|---|
| Phone (Termux + proot Ubuntu) | Install Node ≥ 22, then `sh serve-bg.sh` (background; heap capped at 256 MB). Open http://localhost:8080. |
| Windows | Install Node.js LTS (≥ 22) from https://nodejs.org, then double-click `start.bat` |
| Mac / Linux | `./start.sh` or `npm start` (= `node server.js`), then open http://localhost:8080 |
| Streamlit wrapper | `pip install -r requirements.txt` then `streamlit run app.py` (starts the Node server; untested) |

- **No `npm install` is needed:** zero npm dependencies.
- **Data:** the first start downloads about 25 MB of SEC filings and prices, then caches them in `data/`, which is not in the repo.
- **Other devices:** from the PC on the phone's hotspot, open `http://<phone address>:8080/?token=<token>` once to allow changes. The token is in `server.log` and in §7 on the phone.
- **Optional keys:** put them in `.env` (gitignored). See `docs/DATA_PROVIDERS.md`.

## Dependencies
| Kind | Item |
|---|---|
| Runtime | Node.js ≥ 22 (built-in `http`, `fetch`, `WebSocket`, `zlib`, `crypto`, `node:test`) |
| Browser libraries (CDN) | Plotly 2.35.2; GeoGebra (function view only); Google Fonts (IBM Plex) |
| Optional | Python + Streamlit (wrapper only) |

## Sections
| § | Section | What it answers |
|---|---|---|
| 1 | Global market map | 98 companies (55 US, 43 international). Colour, size and grouping options; borders show price vs estimated value range; corner flags show whether today's move goes toward or away from that range. |
| 1b | Valuation explorer | Every company's estimated value range relative to its price |
| 1c | Company research | Directory, research panel (assessment, valuation, history, market behaviour, fundamentals, paper ticket, sources) and SEC announcements |
| 1d | Quant screen | Momentum, trend, exhaustion, volatility and liquidity; unusual values highlighted |
| 1e | Risk lab | 17 market regimes, macro indicators, universe stress test |
| 2–4 | Live micro-structure | Crypto/FX: 10-D state space, order flow, analysis methods, demo account |
| 5 | Validation | Backtests with train / validation / test, walk-forward, costs, random baselines, deflated Sharpe |
| 6 | Portfolio lab | Risk contributions, correlations, scenarios, alternative allocations, opportunity cost |
| 7 | Paper trading | Equity paper book with realistic simulated fills and risk controls |
| 8 | Data quality | Provider health, data issues, storage |
| 9 | Model performance | Out-of-sample record, evidence caps, prospective log, paper vs SPY |

## Documentation
- `docs/ARCHITECTURE.md`: components and data flow.
- `docs/MODELS.md`: every formula, input, assumption and limitation.
- `docs/DATA_PROVIDERS.md`: sources, licences, fallbacks, keys.
- `docs/PAPER_TRADING.md`: operating the paper environment safely.
- `docs/TESTING.md`: the testing report.
- `PROJECT_SPECIFICATION.md`: decisions, status, feature matrix, known limitations.
- `docs/MASTER_SPECIFICATION.md`: the original brief.

## Tests
`npm test` (= `node --test test/*.test.js`): synthetic fixtures with known answers, plus a recorded real API snapshot for the interface and traceability tests. No network is needed.
