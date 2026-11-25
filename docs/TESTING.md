# Testing report (2026-11-25)

**Command:** `npm test` (`node --test test/*.test.js`).
**Result:** **121 tests, 121 pass**, about 21 s on the phone. No network is used.

## Test data
- **Synthetic fixtures**, labelled as such in every file: built from seeded RNGs or with closed-form answers. Examples: a 1 % bid–ask bounce, two-asset minimum variance, DCF = Gordon growth.
- **A recorded real snapshot** (`test/fixtures/api-snapshot.json.gz`, captured 2026-11-25 from the running app) for the interface and traceability tests.

## Coverage by category (brief Part 09 §1)
| Category | Files | What is checked |
|---|---|---|
| Valuation calculations | analytics, engines, trace | DCF vs Gordon; DDM by hand; comparables exclude self; synthesis never averages; scenarios; growth shrinkage; WACC floor; tax fallback; re-derivation; sensitivities; confidence levels; disagreement table; DCF recomputes from its inputs |
| Financial ratios | analytics, heatmap | Fundamentals from companyfacts fixtures; IFRS 20-F currency and unit selection; missing statements give nulls |
| Statistical calculations | analytics, engines, backtest | Returns, volatility, β with standard error, total-return index, spread estimators, Sharpe, drawdown, deflated Sharpe, normal CDF |
| Data validation | heatmap, portfolio, execution | Yahoo response validation (pence → pounds, malformed → error), portfolio storage validation, order validation |
| Missing values | heatmap, analytics, decision | Missing data never coloured or scored as zero; scores withheld with fewer than 3 inputs; quality "unknown" when there is no data |
| Time-series leakage | backtest, engines | Shocking every price after month *m* leaves all signals and regimes at *m* unchanged; EPS and restatements visible only from their filing date; parameter choice unchanged when test data change; walk-forward windows independent of later data; `asOf` hides later restatements |
| Risk calculations | portfolio, decision | Risk contributions, effective bets, scenarios, concentration |
| Portfolio calculations | portfolio | Ledoit–Wolf shrinkage, minimum variance (closed form), risk parity, capped simplex, exposures, liquidity, opportunity cost |
| Order simulation | execution | No fill on the submission quote; spread and impact; partial fills; limits respected; stops; closed markets; order manager end to end (cash, fees, positions, audit log, cancel, expiry) |
| Transaction costs | engines, execution, backtest | Cost curve; liquidity-tier spread model; fee schedule; costs charged on traded weight |
| API failures | data, trace | Provider health with HTTP and network errors; stale cache served and flagged; three attempts and then a clear error |
| Interface behaviour | ui | 336 heat-map renders; tooltips; 7 panel tabs × 4 companies (US, international, price-only, bank); comparison; validation, portfolio, paper and six workstation sections. No undefined, NaN or Infinity text; every plotted value finite. |
| Traceability | trace | Valuation range ← models; premium ← price ÷ base; scores ← weighted components; map summary = company record = tooltip value; every price carries time and kind |
| Security | execution, data | Write gate (loopback or token only); token persisted; `.env` loader does not override; keys never appear in status |

## Manual and live verification (recorded in `PROJECT_SPECIFICATION.md`)
- **Live builds:** 98/98 companies, no errors. The international conversion was checked by hand: Shell 3,552 GBp → $46.50 at GBP/USD 1.309.
- **Validation:** a scratch run and the live run produced identical experiments (reproducibility).
- **Paper fill:** a live fill on the Tokyo session (Toyota), with cash and fee arithmetic checked.
- **Write gate:** tested from the phone's network address.

## Defects found by testing and fixed
1. Spread estimator returned twice its value.
2. Formatter precision bug ("+1.4 %" shown as "+1 %").
3. Comparison text called a premium "below".
4. Missing `marketState` made every market look closed, so market orders could never fill.
5. Provider failing-state ties within one millisecond.
6. Empty-data quality shown as 100.
7. Daily-bar spread estimators were unreliable, so they were replaced by a liquidity-tier model.

## Not covered by automated tests
- Real browsers: the tests use a DOM stand-in, so layout and CSS are unchecked.
- The Alpaca adapter (needs keys).
- Very long uptime.
- Behaviour on Yahoo API changes beyond the shapes captured.
