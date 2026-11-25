# Data providers

Every external source the app uses. The registry with live health is in `src/providers.js`; the §8 Data quality section shows its state. None of the free sources permits redistribution or commercial use; this is a private research tool. Live trading must not rely on any of them.

| Provider | Data | Kind | Key | Licence / terms |
|---|---|---|---|---|
| **Yahoo Finance chart API** | equity quotes (delayed); daily and monthly bars; dividends and splits; FX history; index levels | delayed / historical | none | Unofficial endpoint, no published terms for automated use. Personal, non-commercial research only; can change or rate-limit without notice. Not for redistribution or live trading. |
| **SEC EDGAR (XBRL company facts, submissions)** | financial statements (10-K, 10-Q, 20-F, 40-F); filing history and announcements (8-K, 6-K); SIC industry codes | historical (as filed) | none | US government data, public domain. Fair-access policy: at most 10 requests/s with a descriptive User-Agent. |
| **U.S. Treasury yield curve** | daily par yields (10-year) | historical (daily) | none | US government data, public domain. |
| **FRED (St. Louis Fed) keyless CSV** | OECD 10-year government yields; macro indicators (CPI, unemployment, policy rate, yield curve, credit spread, VIX) | historical (daily / monthly) | none | Free; each series carries its source's terms (most allow non-commercial use with attribution). |
| **Frankfurter (ECB reference rates)** | FX fallback (daily ECB rates) | historical (daily, ~16:00 CET) | none | Free, open source service over ECB data. No TWD. |
| **Binance public market data** | crypto trades, bars, order book; futures positioning | live | none | Public API; terms of use apply. Futures endpoints are geo-restricted in some countries. |
| **Kraken WebSocket v2** | FX and crypto quotes and trades | live | none | Public API; terms of use apply. |
| **TrueFX** | indicative interbank FX quotes | live (indicative, not executable) | none | Free for personal use; indicative prices only. |
| **alternative.me Fear & Greed** | crypto sentiment index | daily | none | Free with attribution. |
| **Finnhub (optional)** | earnings calendar; earnings surprises; company news | delayed / historical | FINNHUB_KEY | Free tier: personal use, 60 requests/min. Needs an API key in .env. |
| **Alpaca market data and paper trading (optional)** | US real-time quotes (IEX); paper order execution | live (IEX venue only) | ALPACA_KEY_ID | Free tier: IEX quotes (~2–3 % of US volume) for personal use. Needs keys in .env. |
| **Stooq end-of-day CSV (rejected)** | would have been: daily bars fallback | n/a | none | Not used: since 2026 the CSV endpoint answers with a JavaScript bot challenge (checked 2026-11-25), so it cannot serve as an automated fallback. |

## Fallbacks and failure behaviour
- **Every request:** 20 s timeout and 3 attempts with back-off (server quotes: 15 s and 1 retry). The outcome is recorded per provider.
- **Disk cache:** everything fetched is cached on disk. When a refresh fails, the last cached copy is served and flagged as stale on the company ("served from cache after a refresh failed").
- **FX:** Yahoo first; Frankfurter (ECB reference rates, daily) if Yahoo fails. TWD has no fallback.
- **Risk-free rate:** US Treasury, with Yahoo ^TNX if the Treasury CSV fails. Other currencies use OECD 10-year yields via FRED. TWD, CNY and HKD fall back to the US rate, flagged.
- **Missing data stays missing.** A company without filings is shown as price-only; a missing value is never filled with an invented one.

## Optional keys (`.env` in the repo root, gitignored)
```
ALPACA_KEY_ID=...        # Alpaca paper account: real-time US quotes (IEX) and spreads; broker-side paper trading
ALPACA_SECRET_KEY=...
FINNHUB_KEY=...          # earnings calendar, earnings surprises, company news
```
Keys are read at server start and never logged or sent to the browser.

## Considered and rejected
- **Stooq:** its CSV endpoint now requires a JavaScript bot challenge (checked 2026-11-25).
- **OANDA:** rejected by the user as too expensive.
- **Unofficial broker session-cookie APIs:** terms-of-service and account-security risk.
