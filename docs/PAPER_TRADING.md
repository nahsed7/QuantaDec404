# Operating the paper-trading environment safely

## What it is
- **Simulated trading:** every fill is simulated. There is no real money. **Live trading is disabled in code**: no live adapter exists, and the Alpaca adapter refuses any non-paper URL.
- **Venue:** without keys, every order goes to the local simulator described below. With Alpaca paper keys in `.env`, US orders go to Alpaca paper instead (see *Alpaca paper trading*); all other orders stay local.
- **Two separate paper accounts:**
  - **§7 Paper trading (equities):** server-side book, with US$ cash.
  - **§2 demo account (crypto/FX, leveraged):** browser-driven, the older account.

## Placing an order
1. **Open a company** from any section and go to its **Trade (paper)** tab.
2. **Read the context first:** valuation range, the three independent scores, liquidity, and the contradicting evidence.
3. **Fill in the ticket:** side, type (market, limit, stop, stop-limit), time in force (day or good-till-cancelled) and size. Size can be in shares, US$, % of equity, or US$ at risk to a stop.
4. **Preview:**
   - estimated fill price, fees, spread and impact;
   - time to fill;
   - every risk check. **Blocks** stop the order; **warnings** must be read.
5. **Confirm.** The order is then *working*.

## How fills behave (do not expect instant fills)
- **Delayed quotes:** an order fills only on a quote timestamped after the order. Free quotes are delayed about 15–20 minutes, so fills typically appear that long after submission.
- **Costs:** buys pay the ask and sells receive the bid, each with square-root market impact.
- **Partial fills:** each quote can fill at most 10 % of the volume traded since the previous one.
- **Sessions:** market orders wait while the market is closed. Day orders expire at the exchange's regular-session end.
- **Fees:** US $0.005/share (min $1, max 1 %); other markets 0.10 % (min $5).
- **Spreads:** quoted when a quote feed is configured, otherwise the liquidity-tier model (2–50 bp). That model is an assumption.

## Alpaca paper trading (optional, free)
1. Create a free account at alpaca.markets, open the **Paper** dashboard and generate an API key.
2. Put both values in `.env` in the project folder (it is gitignored):
   ```
   ALPACA_KEY_ID=PK...
   ALPACA_SECRET_KEY=...
   ```
3. Restart: `sh serve-bg.sh`. §7 then shows the venue as "Alpaca paper trading … for US orders".

How it behaves:
- **Checks first:** the local risk checks run before anything is sent. Alpaca can still reject the order (buying power, symbol, hours), and its reason is shown.
- **Fills:** Alpaca fills against real-time quotes, commission-free. The order manager polls each order every 30 s and books any new shares as one fill at the incremental average price. Regulatory fees on sells are not modelled.
- **Cancels** go to Alpaca first. Shares filled before the cancel arrived stay booked.
- **Health:** checked every 60 s. While Alpaca is unreachable, new US orders are blocked.
- **Accounts:** the local book mirrors only the orders placed from this app. Alpaca's own paper cash and positions are separate, and they diverge if you also trade from Alpaca's website.

## Risk limits (§7 → Risk limits; defaults)
- Position ≤ 20 % of equity; sector ≤ 40 %; order ≤ 5 % of average daily volume.
- No short selling (it cannot be enabled). No margin: buys need cash, and working buys reserve it.
- Blocks:
  - stale quotes (> 30 min while open);
  - prices moved > 5 % since the ticket opened;
  - limit or stop > 20 % from the last price;
  - duplicates (same client id, or identical within 10 s);
  - more than 10 orders a minute.
- **Kill switch:** no new buys after equity falls 5 % in a day.

## Access
- **On the phone:** full access without a token.
- **From the PC:** open `http://<phone address>:8080/?token=<token>` once. The token is shown on the phone in §7 under "Access from other devices", and in `server.log`. Without it, the PC is read-only.
- **If the token leaks:** delete `data/auth-token` and restart. A new token is created.

## Records
- **Audit trail:** every acceptance, rejection (with reasons), fill, cancel, expiry, limit change and reset is appended to `data/equity-audit.jsonl`.
- **Daily equity snapshots** form the paper-trading result series.
  - They are shown in §9 against SPY.
  - They are **never** mixed with backtest results.

## Before ever considering live trading
This system does not support it. Live trading would need, at minimum:
- separate authorisation;
- independent testing of a live adapter;
- legal review;
- real-time data;
- quoted spreads;
- broker-side risk limits.
