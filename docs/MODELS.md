# Analytical models: formulas, inputs, assumptions and limitations

Every module in `lib/` is a pure function of its inputs. The same code runs in the browser, on the server and in the tests.

**Notation:**
- *r* = discount rate;
- *g* = growth;
- *g*ᵀ = terminal growth;
- *k*ₑ = cost of equity;
- *r*f = risk-free rate;
- β = beta;
- ERP = equity risk premium;
- σ = standard deviation.

Every constant below is an **assumption**, and the user can override it per company in the research panel (Valuation tab).

---

## 1. Valuation (`lib/valuation.js`)

### 1.1 Common inputs (`defaults`)

| Quantity | Formula / source | Rationale |
|---|---|---|
| Risk-free *r*f | US: 10-year Treasury (daily par curve). Other currencies: OECD 10-year government yield via FRED (EUR uses the Bund). TWD, CNY and HKD fall back to the US rate, flagged. | Long-dated, matches a long-lived equity cash flow. |
| β | OLS slope of 2 years of daily log returns against the local index on common dates; Blume-adjusted 0.67·β + 0.33. If unmeasured, 1. | Raw betas mean-revert towards 1 (Blume 1975). |
| ERP | 5 % | Long-run US historical and implied estimates mostly fall in 4–6 %. |
| *k*ₑ | *r*f + β·ERP | CAPM. |
| Pre-tax cost of debt | interest ÷ debt, clamped to [*r*f, *r*f + 6 %]; if unmeasurable, *r*f + 1.5 % | |
| Tax | median effective rate of the last 5 years; otherwise the combined statutory rate of the country (OECD 2024) | |
| WACC | (E·*k*ₑ + D·*k*d·(1 − t)) / (E + D), with **floor *r*f + 2 %** | Large cheap debt (captive finance, utilities) otherwise drives WACC towards *r*f. |
| *g*ᵀ | min(2.5 %, *r*f − 0.5 %) | Terminal growth cannot exceed long-run nominal growth, proxied by the long rate. |
| Growth (years 1–5) | *g*ᵀ + 0.5·(*g*hist − *g*ᵀ), where *g*hist is the median of the 1-, 3- and 5-year revenue CAGRs; clamped to [−5 %, 15 %]. Range ±4 pts. | Revenue growth shows little persistence (Chan, Karceski & Lakonishok 2003), so history is shrunk, not extrapolated. |
| Operating margin | 5-year mean of operating income ÷ revenue; band = max(2 pts, 5-year σ) | |
| Capex, D&A | 5-year mean, % of revenue | |
| Working capital | 5 % of new revenue | assumption |

### 1.2 The six models

| Model | Base value per share | Conservative / optimistic | Applies to | Main limitations |
|---|---|---|---|---|
| **DCF (FCFF)** | 10-year projection: growth *g* for years 1–5, linear fade to *g*ᵀ by year 10. FCFF = Rev·m·(1−t) + Rev·D&A% − Rev·capex% − nwc·ΔRev. Net investment (capex − D&A) is floored at 0 and scales to *g*ᵀ/*g* by year 10. TV = FCFF₁₀·(1+*g*ᵀ)/(r − *g*ᵀ). Equity = EV − debt + cash. | 10th / 90th percentile of 2,000 seeded Monte-Carlo draws (triangular on growth, margin, WACC ±1 pt, terminal growth) | non-financials with positive margin | Terminal-value share; margin assumed stable; captive-finance groups (Honda, Toyota) are misspecified |
| **Dividend discount** | Two-stage: DPS grows *g*₁ = min(5-year DPS CAGR, ROE·(1−payout)) for 5 years, then *g*ᵀ; discounted at *k*ₑ | *g*₁ ∓ 2 pts, *g*ᵀ 1.5 % / 3 %, *k*ₑ ± 1 pt | dividend payers; leads only if payout ≥ 50 % of FCF | ignores buybacks |
| **Comparables** | Median across multiples (P/E, EV/EBIT, EV/Sales, P/FCF; P/E and P/B for financials) of peer-median multiple × own metric | peer 25th / 75th percentile | ≥ 3 sector peers with usable multiples | relative only; peers differ in growth and accounting (IFRS vs US GAAP) |
| **Earnings power** | Rev·m̄·(1−t) / WACC − net debt (financials: 3-year mean EPS / *k*ₑ) | WACC ± 1 pt | positive margin | zero growth: a floor for growing firms |
| **Asset-based** | Book equity / share. Financials: justified P/B = (ROE − g)/(*k*ₑ − g) × book | tangible book; *k*ₑ ± 1 pt | positive equity | reference only for non-financials |
| **Own history** | current EPS × median own P/E at fiscal-year ends | 25th / 75th percentile P/E | ≥ 5 years of positive P/E | assumes the past valuation regime persists |

### 1.3 Outputs common to every model
- `low`, `base`, `high`: conservative, base and optimistic values (sorted).
- `inputs`, `assumptions[]`, `limitations[]`.
- `sensitivity[]`: one-at-a-time shocks, each input moved down and up with the model rerun.
  - DCF: growth ±2 pts, margin ±2 pts, WACC ±1 pt, terminal ±0.5 pt, capex ±1 pt, debt and cash ±20 %.
  - Other models: their own inputs (see `SHOCKS`).
- `freshness`: latest filing date and age, price time, and which data the model uses.
- `confidence`: `high` / `medium` / `low`. It starts high, and each detected weakness lowers it one level:
  - range > 1.5× (> 2× counts as wide);
  - terminal value > 75 % of the total;
  - fewer than 6 peers;
  - fewer than 8 years of history;
  - reference-only model;
  - filing > 450 days old;
  - share-count conflict.

  Levels, not numbers: finer precision would be false.

### 1.4 Synthesis (no averaging)
- One **primary** model defines the range:
  - non-financials: DCF → history → comparables → DDM (if payout ≥ 50 % of FCF) → EPV;
  - financials: book → history → comparables → EPV → DDM.
- The others are cross-checks:
  - `agreement` = share of other models whose base lies inside the primary range;
  - `dispersion` = σ of the log base values;
  - `disagreements[]` lists each model's base vs the primary: inside / below / above, % difference, and whether the ranges overlap.
- **Classification:**
  - below / within / above the primary range;
  - **uncertain** if the range is wider than 2.5× or the dispersion exceeds 0.5 with ≥ 2 cross-checks;
  - **insufficient** if no model applies or there is no price;
  - withheld (uncertain) when share counts in the filings disagree by more than 25 %.

### 1.5 Scenarios
Each scenario reruns every model:
- growth −3 pts;
- discount rates +1 pt;
- margin −3 pts;
- sector multiples −20 %;
- debt +25 %;
- earnings −15 %;
- terminal growth −1 pt.

The results are sorted by effect on the primary value, and a change in classification is flagged.

---

## 2. Market behaviour (`lib/quant.js`)
All series are daily bars in the **listing currency**. Market comparisons use the local index joined on the UTC calendar date: S&P 500 (SPY) for US listings, otherwise Nikkei 225, FTSE 100, DAX, CAC 40, AEX, SMI, OMXC25, IBEX, BEL 20, OBX, TAIEX, NIFTY 50, Hang Seng, KOSPI, ASX 200 or TSX.

| Measure | Formula |
|---|---|
| Returns | P_t / P_{t−n} − 1 for n = 1, 5, 21, 63, 126, 252; total return uses an index with dividends reinvested on the ex-date |
| Moving averages | SMA 20/50/200; price above or below; 50-day slope over 21 days |
| 12−1 momentum | P_{t−21} / P_{t−252} − 1 |
| Relative strength | 63-day return − index 63-day return (common dates); minus sector-peer median |
| Trend persistence | R² and slope of log price on time (63 days); share of up days |
| Acceleration | r₆₃(t) − r₆₃(t−21) |
| Volume confirmation | mean volume on up days ÷ on down days (42 days) |
| Exhaustion | distance from SMA50 in units of σ·√50; 21-day return percentile in own history; σ₂₀/σ₁₂₀; RSI(14) and RSI divergence; **relative-strength divergence** (3-month price high or low not confirmed by the price ÷ index ratio within 3 %); volume z-score of log volume (60 days); momentum fading; valuation premium > 40 %. Listed as signals, never as a reversal prediction. |
| Volatility | close-to-close σ (20, 60, 252 days, all; ×√252); Parkinson σ = √(mean ln²(H/L) / (4 ln 2) · 252); EWMA (λ = 0.94); clustering = autocorrelation of r², lags 1–5; drawdowns; 1-day historical VaR and ES at 95 % (1 year); skew and kurtosis |
| Regime-dependent σ | stock σ when the index is above or below its 200-day average, and when the index's 20-day σ (measured to the previous day) is above or below its median |
| β | OLS on daily log returns, common consecutive dates, 2 years; ± one standard error |
| Liquidity | median daily volume and traded value (1 month, US$); turnover = volume ÷ shares; Amihud = mean \|r\| / traded value × 10⁹ |
| Spread estimate | Abdi–Ranaldo 2017: per two-day pair √max(0, 4·(c_t − η_t)(c_t − η_{t+1})), averaged (η = log mid-range). An estimate; no quoted spreads in the free feeds |
| Trading cost | half-spread + σ_daily·√(order ÷ daily value) (square-root impact, k = 1); cost curve for $10 k to $10 M; above 10 % of daily value flagged as not fillable in a day. **Theoretical**: real fills depend on the book, time and venue. |

## 3. Fundamentals (`lib/fundamentals.js`)
- **Sources:** SEC XBRL company facts.
  - US: us-gaap 10-K/10-Q.
  - International: ifrs-full or us-gaap in 20-F/40-F.
  - The reporting currency is the unit with the most annual facts; convenience translations are ignored.
- **Point in time:** `asOf(cf, t)` keeps only facts filed on or before *t*. `restatements(cf)` counts annual values revised by later filings.
- **Ratios:**
  - Growth: revenue CAGR over 1, 3 and 5 years.
  - Margins: gross, operating, net.
  - Cash flow: FCF = OCF − capex; FCF margin and conversion.
  - Earnings quality: Sloan accruals = (NI − OCF) ÷ average assets.
  - Returns: ROIC = EBIT·(1−t) ÷ (equity + debt − cash); ROE.
  - Balance sheet: current ratio, debt ÷ EBITDA, debt ÷ equity, interest cover.
  - Dilution: share-count CAGR over 3 years; SBC ÷ revenue.
  - Payout: dividends ÷ FCF and ÷ NI.
  - Piotroski F-score: 9 tests, needs ≥ 7 evaluable.
- **Deterioration flags:**
  - revenue down;
  - operating margin down > 2 pts;
  - negative FCF;
  - accruals > 8 %;
  - interest cover < 3×;
  - dilution > 2 % a year;
  - dividends > FCF;
  - current ratio < 0.8.

## 4. Market regime (`lib/regime.js`)
- **Trend:** indicators vote bull / bear / sideways:
  - index vs 200-day average (±3 %);
  - 50-day slope (±1 %);
  - drawdown from the 52-week high (< 5 % / > 20 %);
  - 6-month return (±5 %);
  - breadth, the share of tracked stocks above SMA50 (> 60 % / < 40 %, only with ≥ 10 stocks).
- **Uncertainty:** the majority's share of the votes (≥ 80 % low, ≥ 60 % moderate, otherwise high).
- **Volatility regime:** mean of the 20-day realised-σ percentile and (US) the VIX percentile within 5 years: high > 75th, low < 25th.
- **Liquidity stress:** count of three signals (VIX > 85th percentile, median Amihud up > 1.5× in 3 months, realised σ > 90th percentile).
- **Sector rotation:** Spearman correlation of sector median returns, last 3 months vs the 3 before.
- One regime is computed per local index.
- Thresholds are judgement, and regimes are clear only in hindsight.

## 5. Signal calibration (`lib/calibrate.js`)
- **Formation:** each quarter-end.
- **Test:** rank correlation (IC) between a signal and the next 3-month total return across the US universe. The signals are earnings yield (EPS as known at that date) and 12−1 momentum.
- **Reported:** mean IC, t-statistic, hit rate, and earlier vs later halves.
- **Caveats:** survivorship bias (today's universe) and small samples. Part 05 replaces this with full walk-forward validation.

## 6. Decision engine (`lib/decision.js`)
Three **independent** scores. They are never combined into buy/sell.

### 6.1 Construction
- **Opportunity and risk components:**
  - percentile rank within the tracked universe (0–100; at least 10 companies needed);
  - for risk, higher = riskier;
  - market-regime risk is absolute: 50 × β × adversity (bear 1.5, bull 0.8; high volatility ×1.3).
- **Score:** weighted mean of the measured components, rounded to 5. **Withheld** when fewer than 3 components can be measured.
- **Confidence components:** absolute 0–100. A component that cannot be measured counts as 0.
- **Interpretation bands:** ≥ 65 high, ≤ 40 low, otherwise moderate.
  - The brief's example, 86 / 79 / 38, reads "potentially attractive with high risk and low confidence: treat the assessment as highly uncertain".

### 6.2 Prior weights (rationale in `PRIORS`)
| Score | Component (weight) |
|---|---|
| Opportunity | valuation 2 · momentum 1 · quality 1 · relative performance 0.5 · growth 1 · catalysts 0.5 · opportunity cost 1 |
| Risk | volatility 1 · drawdown 1 · valuation risk 1 · distress 1 · liquidity 0.5 · concentration 1 · model risk 1 · regime 1 |
| Confidence | completeness 2 · data quality 1 · freshness 1 · model agreement 2 · primary-model confidence 1 · historical signal performance 1 · stability 1 · sensitivity 1 · out-of-sample 1 · range width 1 · coverage 1 |

### 6.3 Evidence caps (from the latest validation experiment, Part 05)
**Mapping:** valuation → valuation-engine signal; momentum and relative performance → momentum; opportunity cost → value.

| Evidence | Multiplier |
|---|---|
| Walk-forward excess > 0.5 %/yr **and** test result beats ≥ 75 % of random portfolios | × 1 |
| Walk-forward excess ≤ 0.5 %/yr **or** beats < 50 % | × 0.5 |
| Otherwise | × 0.75 |
| Untested | × 1, labelled untested |

Weights are only ever **capped**, never raised, so a single lucky test period cannot inflate a component.

### 6.4 Confidence details
- **Data quality** = 100 − penalties:
  - share-count conflict 35;
  - restatements 5 each (at most 25);
  - stale cache 20;
  - no local risk-free rate 10;
  - cover-page share count 10;
  - no statements 60.
  - With no data at all, it is unknown.
- **Historical signal performance:** weighted test-segment percentile against random portfolios.
- **Out-of-sample:** 50 + 50·tanh(walk-forward excess ÷ 5 %/yr), weighted.

### 6.5 Other outputs
- **Scenario effects:** each valuation scenario's primary value is fed back into opportunity and risk; the score changes are reported.
- **Catalysts (estimated, never announced dates):**
  - next quarterly report = last quarter end + 91 days × k + the median of the last four filing lags;
  - next ex-dividend date from the median gap between past dividends;
  - large reported EPS changes.
- **Comparison:** relative valuation, risk, confidence and data quality; opportunity cost (yield gap, yield vs risk-free); daily-return correlation over about a year. It never selects a company.

## 7. Portfolio engine (`lib/portfolio.js`, `src/portfolio.js`)
- **Returns:** weekly US$ returns, the last close of each week converted at that day's FX rate, about 2 years. Weekly, not daily, because markets close at different times, which makes daily cross-market correlations falsely low.
- **Covariance:** Ledoit–Wolf (2004) shrinkage toward a scaled identity, with the intensity estimated from the data. Fewer than 30 periods is refused.
- **Risk:**
  - σ_p = √(wᵀΣw · 52);
  - risk contribution RC_i = w_i(Σw)_i / wᵀΣw, summing to 1;
  - diversification ratio Σw_iσ_i / σ_p;
  - effective bets 1/ΣRC_i²; effective holdings 1/Σw_i²;
  - 1-week parametric VaR 1.645·σ_week.
- **Allocations** (long-only, fully invested; research only):
  - equal weight;
  - inverse volatility;
  - minimum variance (projected gradient onto the capped simplex, cap 25 %);
  - equal risk contribution (multiplicative fixed point);
  - valuation tilt (equal weight × (1 + 0.5·z), z = −standardised log premium, cap 25 %).
- **Liquidity:** days to exit at ≤ 10 % of daily value. Cost = half-spread + σ_daily·√(min(order, 10 % ADV) ÷ ADV).
- **Scenarios:**
  - market −20 % through β (1 if unmeasured);
  - largest sector −25 %;
  - correlations ρ′ = ρ + (1−ρ)/2;
  - σ × 2;
  - volume −50 % and spreads ×3;
  - rates +1 pt through each company's own "discount rates +1 pt" valuation scenario.
- **Look-back** (in-sample, labelled): fixed weights rebalanced every 4 weeks.
- **Regime exposure:** SPY above or below its 40-week average; 13-week σ vs median, measured to the previous week.
- **Opportunity cost** of adding a candidate at 5 % (funded pro rata):
  - correlation with holdings; Δ portfolio σ; sector weight after;
  - entry cost; round-trip cost ÷ holding years (the hurdle);
  - yield − risk-free.
  - It never chooses.
- **Concentration input to the risk score:** 100 × min(1, sector weight after a hypothetical 5 % addition ÷ 40 %), using the current saved portfolio (or the paper book once it holds equities).

## 8. Execution and risk controls (`lib/execsim.js`, `lib/riskcontrol.js`, `src/oms.js`, `src/brokers.js`, `src/auth.js`)

### 8.1 Simulated fills (paper venue)
- **No fill on the displayed price:** only a quote timestamped after submission + 2 s can fill. The free quotes are delayed about 15–20 minutes, so fills typically appear that long after submission.
- **Prices:**
  - bid/ask = last × (1 ∓ s/2), with s the quoted spread if available, else the Abdi–Ranaldo estimate clamped to [2 bp, 2 %];
  - buys pay ask × (1 + σ_d·√(q/ADV)) and sells receive bid × (1 − σ_d·√(q/ADV)).
- **Partial fills:** at most 10 % of the volume expected since the previous evaluation, ADV pro rata over a 390-minute session, minimum 1 share.
- **Limit orders:** no fill if the touch is beyond the limit; the quantity is reduced until the impacted price respects the limit.
- **Stop orders:** trigger on the last price (buy stops at ≥ stop, sell stops at ≤ stop), then behave as market or limit orders.
- **Sessions:** the market state comes from the exchange's current regular trading period (lunch breaks count as open). Market orders wait while the market is closed. Day orders expire at the regular-session end.
- **Fees:**
  - US: $0.005 per share, minimum $1, maximum 1 % of value;
  - elsewhere: 0.10 %, minimum $5.
- **Cash and positions in US$:** prices are converted at the current FX rate; the average cost includes fees; realised P&L is tracked; no margin and no short selling.

### 8.2 Pre-trade risk controls (defaults; each configurable except short selling)
| Control | Block | Warn |
|---|---|---|
| Invalid order (side, type, whole shares > 0, limit/stop present, time in force) | always | |
| Position size after the order | > 20 % of equity | |
| Sector after the order | > 40 % of equity | |
| Cash (including cash reserved by working buys) | value > cash | |
| Liquidity | > 5 % of ADV | > 1 % of ADV |
| Stale data | quote > 30 min old while open | delayed feed |
| Price moved since the ticket opened | > 5 % | |
| Limit/stop distance from last | > 20 % | marketable limit |
| Duplicate | same client id, or identical order within 10 s | |
| Rate | > 10 orders a minute | |
| Daily loss (kill switch) | equity −5 % since the day's first snapshot | |
| Venue unavailable | always | |
| Market closed | | always |

### 8.3 Architecture (six separated layers)
| Layer | Module | Responsibility |
|---|---|---|
| Market data | server quotes and research bars | delayed quotes, session times, liquidity inputs |
| Analytical engine | `src/research.js` | models, quant, regime |
| Decision engine | `lib/decision.js` | scores only. **No code path leads from a score to an order.** |
| Risk control | `lib/riskcontrol.js` | pure checks, run at preview and again server-side at submit |
| Order management | `src/oms.js` | state machine (rejected / working / partially filled / filled / cancelled / expired), server-side book, append-only audit log, daily equity snapshots |
| Broker adapter | `src/brokers.js` | local paper simulator. The Alpaca adapter accepts only the paper endpoint; live trading is disabled in code. |

### 8.4 Access control and credentials
- **Writes need a token:** paper orders, cancels, resets, limits, portfolios, the crypto/FX account and its restores, and forced validation runs.
- **Exception:** requests from the phone itself (loopback) need no token.
- **Token:** random 128-bit, stored in `data/auth-token`. It is shown only to the phone (in §7 and `server.log`) and used from another device as `?token=` once.
- **Credentials:** only from `.env` (gitignored) or the environment; never in source, logs or responses.
