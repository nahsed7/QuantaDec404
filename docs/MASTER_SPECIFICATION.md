# Master specification (as supplied by the user, 2026-11-25)

Nine layers of one integrated system. Progress is tracked in `PROJECT_SPECIFICATION.md`.

We'll divide the master specification into sequential Claude Code prompts. Each part will be independently usable, but all parts will belong to the same project specification.

The important distinction: Claude should not start rebuilding the project every time it receives another part. It must preserve previous work, maintain a project specification, and wait for the next instruction where required.

### Delivery structure

### Master specification — 9 parts

01

Project identity and repository inspection

Role, objectives, existing project audit and hardware constraints.

02

Multidimensional market heat map

Market visualisation, fair value and interactive company exploration.

03

Valuation and quantitative engines

DCF, fundamentals, momentum, volatility and liquidity.

04

Decision intelligence

Opportunity, risk, confidence and uncertainty decomposition.

05

Historical validation

Backtesting, overfitting, point-in-time data and benchmarks.

06

Portfolio intelligence

Capital allocation, correlations, diversification and opportunity cost.

07

Trading and execution architecture

Order simulation, paper trading and brokerage abstractions.

08

Data infrastructure and interface

Data providers, professional interface, caching and integrity.

09

Testing and final implementation

Verification, development workflow and final objectives.

### Part 1 — Project identity and repository inspection

Send to Claude Code first

# PART 01 — PROJECT IDENTITY, ENGINEERING ROLE AND INITIAL REPOSITORY AUDIT

## PROJECT: VALUATION-INTEGRATED MARKET INTELLIGENCE & TRADING SYSTEM

### ROLE

Act as a senior quantitative researcher, financial systems architect, computational economist, data engineer, and full-stack software engineer.

Your task is to engineer a sophisticated, privately operated market intelligence and trading research platform.

This is not a conventional stock dashboard, a TradingView clone, or a simplistic algorithmic trading bot.

The objective is to build an integrated environment combining:

- Multidimensional stock market visualisation.
- Fundamental and quantitative analysis.
- Intrinsic valuation estimation.
- Statistical and probabilistic modelling.
- Risk and uncertainty decomposition.
- Opportunity identification.
- Historical and forward-looking scenario analysis.
- Portfolio and capital allocation research.
- Trading simulation.
- Brokerage execution architecture.

The system should prioritise analytical quality, transparency, independent decision-making, capital preservation, and adaptability to changing market conditions.

Live trading must remain disabled until separately authorised, validated, and legally appropriate.

---

## PHASE 0 — INSPECT BEFORE BUILDING

Before modifying anything:

1. Inspect the complete existing project directory.
2. Identify the programming languages, frameworks, dependencies, architecture, databases, existing interfaces, and available data sources.
3. Identify existing functionality that can be reused.
4. Identify incomplete, unreliable, duplicated, or unnecessary components.
5. Examine available hardware and memory constraints.
6. Determine which components should operate locally and which require external APIs.
7. Preserve useful existing implementations rather than unnecessarily replacing them.

Do not assume that an existing implementation is correct simply because it works.

Produce a technical assessment containing:

- Existing project structure.
- Current capabilities.
- Missing capabilities.
- Technical limitations.
- Dependency assessment.
- Hardware limitations.
- Data-source availability.
- Potential architectural improvements.

Do not destroy existing data, configurations, or working features.

### DEVELOPMENT ENVIRONMENT CONSIDERATIONS

Prefer a lightweight, local-first architecture where practical.

Avoid introducing unnecessarily large machine-learning models, expensive infrastructure, or excessive dependencies.

Account for constrained RAM and CPU resources.

Prefer efficient numerical computation, modular components, caching, and asynchronous operations where appropriate.

Do not introduce hardware-intensive components without a clear technical justification.

---

## CORE ENGINEERING PHILOSOPHY

The system must not merely display financial information.

It must investigate relationships between market prices, underlying business value, market behaviour, risk, uncertainty, and possible investment opportunities.

Avoid simplistic conclusions.

A positive price movement does not necessarily indicate an attractive purchase.

A low valuation does not necessarily indicate a good investment.

A profitable historical strategy does not necessarily generalise to future market conditions.

A high opportunity score does not necessarily imply high confidence.

These distinctions must be preserved throughout the architecture.

### ANALYTICAL INDEPENDENCE

Keep valuation, momentum, risk, confidence, and execution as independent analytical components.

Do not allow one metric to silently dominate the entire decision-making process.

Expose assumptions and calculations.

Never fabricate market data, financial information, or analytical results.

### PROJECT CONTINUITY RULE

This is Part 1 of a larger specification.

Maintain a persistent project specification file in the repository, preferably:

`PROJECT_SPECIFICATION.md`

Record:
- Agreed architecture.
- Implementation decisions.
- Dependencies.
- Data-source decisions.
- Completed features.
- Outstanding requirements.
- Known limitations.
- Testing status.

Future specification parts must extend this document rather than replace previous requirements.

Do not interpret subsequent parts as permission to discard existing work.

---

## INITIAL EXECUTION INSTRUCTIONS

For now, perform the repository audit only.

Do not begin implementing the entire system.

After inspection, provide:

1. A concise description of the existing project.
2. Its current architecture.
3. A list of reusable components.
4. A list of missing capabilities.
5. Recommended architecture.
6. Recommended dependencies.
7. Data-provider options and limitations.
8. Hardware-related considerations.
9. An incremental implementation roadmap.

Wait for the next specification part before proceeding with implementation.

The ultimate objective is a private, extensible financial research environment that prioritises mathematical correctness, reliable data, decision quality, and transparent uncertainty.

### Part 2 — Multidimensional market heat map

Send after Part 1

# PART 02 — MULTIDIMENSIONAL MARKET HEAT MAP

Extend the existing project architecture with an interactive market heat map.

The heat map must become the central market exploration interface.

It must communicate substantially more information than conventional green/red stock visualisations.

## 1. VISUAL DIMENSIONS

### Rectangle size
Support configurable mappings:
- Market capitalisation.
- Trading volume.
- Relative liquidity.
- Other appropriate market metrics.

### Primary colour
Support:
- Daily performance.
- Weekly performance.
- Monthly performance.
- Quarterly performance.
- Relative sector performance.
- Customisable performance periods.

### Valuation indicators

Every company should expose:
- Current market price.
- Estimated intrinsic value.
- Fair-value range.
- Percentage premium or discount.
- Historical valuation percentile.
- Valuation uncertainty.

### Additional indicators
Include:
- Volatility.
- Liquidity.
- Volume anomalies.
- Earnings revisions.
- Dividend information.
- Financial health.
- Momentum maturity.

Allow users to change visual mappings without losing interpretability.

## 2. VALUATION-INTEGRATED HEAT MAP

This is an essential feature.

Every stock should expose the relationship between its current market price and estimated fair value.

Never represent fair value as an objectively known or exact number.

Provide:
- Lower valuation estimate.
- Base valuation estimate.
- Upper valuation estimate.
- Current market price.
- Percentage premium or discount.
- Valuation-model confidence.
- Principal assumptions.

Show whether the stock is:
- Below estimated fair value.
- Within its estimated valuation range.
- Above estimated fair value.
- Too uncertain to classify reliably.

A stock rising 2% today while already trading significantly above its estimated valuation range should communicate something different from a stock rising 2% while trading below its estimated valuation range.

Do not assume that being undervalued guarantees future appreciation.

## 3. INTERACTIVE COMPANY EXPLORATION

Selecting a stock should open a detailed contextual research panel without unnecessarily navigating away from the heat map.

Display:
- Price history.
- Valuation history.
- Fundamental indicators.
- Momentum.
- Volatility.
- Liquidity.
- Opportunity score.
- Risk score.
- Confidence score.
- Supporting and contradictory evidence.

Allow comparison of multiple companies.

## 4. VISUAL INTERPRETABILITY

Do not overload each rectangle with unreadable information.

Use a combination of:
- Colour.
- Size.
- Borders.
- Small valuation markers.
- Hover information.
- Contextual panels.
- Expandable analytical details.

Include a clear legend explaining every visual encoding.

Allow the user to customise the heat map.

## 5. DATA INTEGRITY

Every displayed metric must identify its source and timestamp.

Distinguish:
- Live data.
- Delayed data.
- Historical data.
- Simulated data.
- Estimated valuation outputs.

Never fabricate unavailable market values.

If a stock lacks sufficient information, communicate that limitation visibly.

## IMPLEMENTATION

Integrate this into the existing project.

Do not replace the existing architecture without justification.

Build the heat map with reusable components and efficient data handling.

Add tests for visual data mapping, missing data, valuation indicators, and metric consistency.

Document completed work and wait for the next specification part.

### Part 3 — Valuation and quantitative engines

Send after Part 2

# PART 03 — MULTI-MODEL VALUATION AND QUANTITATIVE ANALYSIS

Implement independent valuation and quantitative analysis engines.

## PHASE A — MULTI-MODEL VALUATION

Implement:

1. Discounted cash flow (DCF).
2. Discounted dividend model.
3. Comparable company valuation.
4. Earnings-based valuation.
5. Asset-based valuation where appropriate.
6. Historical valuation analysis.

Each model must be independently inspectable.

### Required outputs

- Conservative valuation.
- Base-case valuation.
- Optimistic valuation.
- Valuation range.
- Sensitivity to assumptions.
- Model limitations.
- Data freshness.
- Confidence and uncertainty.

Do not average incompatible models blindly.

Expose model disagreements.

Allow users to modify:
- Revenue growth.
- Operating margins.
- Discount rates.
- Terminal growth.
- Earnings forecasts.
- Capital expenditure.
- Debt.
- Cash reserves.

Implement scenario and sensitivity analysis.

## PHASE B — MOMENTUM ANALYSIS

Study:
- Multiple-period returns.
- Moving averages.
- Relative strength.
- Trend persistence.
- Momentum acceleration and deceleration.
- Sector-relative performance.
- Volume confirmation.

## PHASE C — MOVEMENT EXHAUSTION ANALYSIS

Identify potentially overextended movements through:
- Distance from moving averages.
- Historical return distributions.
- Volatility expansion.
- Relative strength divergence.
- Volume anomalies.
- Momentum deterioration.
- Valuation deviations.

Do not assume overextension necessarily implies an imminent reversal.

## PHASE D — VOLATILITY ANALYSIS

Include:
- Historical volatility.
- Realised volatility.
- Volatility clustering.
- Drawdowns.
- Tail-risk estimates.
- Regime-dependent volatility.

## PHASE E — LIQUIDITY ANALYSIS

Study:
- Bid-ask spread.
- Trading volume.
- Average daily turnover.
- Market depth where available.
- Estimated transaction costs.
- Potential slippage.

Distinguish theoretical tradeability from actual execution conditions.

## PHASE F — FUNDAMENTAL ANALYSIS

Include:
- Revenue growth.
- Profitability.
- Earnings quality.
- Cash flow.
- Debt.
- Return on invested capital.
- Balance-sheet strength.
- Dilution.
- Dividend sustainability.
- Financial deterioration indicators.

## PHASE G — MARKET REGIME ANALYSIS

Investigate:
- Bull markets.
- Bear markets.
- Sideways markets.
- High-volatility regimes.
- Low-volatility regimes.
- Sector rotations.
- Liquidity stress.

Use multiple indicators and expose classification uncertainty.

## IMPLEMENTATION REQUIREMENTS

Keep every analytical module independent.

Document formulas, assumptions, inputs, limitations, and tests.

Do not use fabricated financial data.

Integrate completed modules into the existing project and update PROJECT_SPECIFICATION.md.

### Part 4 — Decision intelligence and uncertainty

Send after Part 3

# PART 04 — DECISION INTELLIGENCE AND UNCERTAINTY DECOMPOSITION

Implement the central analytical decision engine.

## 1. THREE INDEPENDENT OUTPUTS

Never collapse all analytical information into one BUY/SELL score.

Every company must receive three independent outputs.

### Opportunity score

Evaluate:
- Valuation.
- Momentum.
- Fundamentals.
- Relative performance.
- Growth prospects.
- Potential catalysts.
- Opportunity cost.

### Risk score

Evaluate:
- Volatility.
- Drawdown exposure.
- Valuation risk.
- Financial distress.
- Liquidity risk.
- Concentration risk.
- Model risk.
- Market regime risk.

### Confidence score

Evaluate:
- Data quality.
- Data completeness.
- Data freshness.
- Agreement between independent models.
- Historical model performance.
- Stability of assumptions.
- Sensitivity to input changes.
- Out-of-sample validation results.

A high opportunity score must never automatically imply high confidence.

Illustrative output:

Opportunity: 86/100
Risk: 79/100
Confidence: 38/100

Interpret this as a potentially attractive but highly uncertain opportunity, not an automatic purchase recommendation.

Provide explanations for every score.

Calibrate scores against actual historical outcomes wherever possible. Do not invent numerical precision.

## 2. UNCERTAINTY DECOMPOSITION

For every assessment distinguish:

1. Evidence supporting the assessment.
2. Evidence contradicting the assessment.
3. Information that is unavailable.
4. Assumptions that could be wrong.
5. Variables that could materially change the conclusion.

Display:
- Supporting evidence.
- Contradictory evidence.
- Unknown variables.
- Alternative explanations.
- Potential failure conditions.
- Model limitations.

## 3. SCENARIO ANALYSIS

Evaluate changes in estimated valuation under different assumptions.

Examples:
- Revenue growth falls by 3 percentage points.
- Discount rates increase.
- Operating margins deteriorate.
- Sector valuations contract.
- Debt increases.
- Earnings expectations change.

Show which assumptions have the greatest effect on conclusions.

## 4. DECISION EXPLANATIONS

Never produce unexplained recommendations.

Every assessment must be traceable to:
- Source data.
- Calculations.
- Model assumptions.
- Historical validation.
- Identified uncertainty.

Make contradictory evidence prominent rather than hiding it.

## 5. OPPORTUNITY COMPARISON

Allow two or more companies to be compared using independent dimensions.

Identify:
- Relative valuation.
- Relative risk.
- Relative opportunity.
- Confidence differences.
- Data-quality differences.
- Potential opportunity costs.

Do not automatically select the company with the highest projected return.

Integrate the decision engine with the heat map and company research panels.

Update the project specification and add tests.

### Part 5 — Historical validation and overfitting protection

Send after Part 4

# PART 05 — HISTORICAL VALIDATION AND OVERFITTING PROTECTION

This is a mandatory engineering priority.

A system that performs well on historical data is not necessarily useful in future markets.

Implement rigorous historical evaluation.

## 1. VALIDATION METHODOLOGY

Implement:
- Chronological train/validation/test separation.
- Rolling-window testing.
- Walk-forward validation.
- Out-of-sample evaluation.
- Historical market-regime testing.
- Transaction-cost modelling.
- Survivorship-bias controls.
- Look-ahead-bias prevention.
- Point-in-time fundamental data wherever available.
- Delisted-stock consideration where data permits.

Never randomly shuffle financial time series when doing so introduces temporal leakage.

## 2. BENCHMARK COMPARISONS

Compare models against:
- Buy-and-hold.
- Relevant market indices.
- Simple momentum strategies.
- Simple valuation strategies.
- Randomised baseline strategies where appropriate.

## 3. EVALUATION METRICS

Include:
- Total return.
- Risk-adjusted return.
- Maximum drawdown.
- Sharpe ratio.
- Sortino ratio.
- Turnover.
- Transaction costs.
- Win rate.
- Profit factor.
- Exposure.
- Performance by market regime.

## 4. MODEL RELIABILITY

Do not optimise exclusively for historical profitability.

Report:
- Model degradation.
- Performance instability.
- Sensitivity to parameter choices.
- Performance across different periods.
- Performance under changing market conditions.

Avoid presenting a model as reliable simply because it performs well on one historical period.

Clearly distinguish:
- In-sample results.
- Validation results.
- Out-of-sample results.
- Paper-trading results.
- Actual live results, if ever separately authorised.

Never mix these categories.

Build reproducible experiments and document their assumptions.

Update PROJECT_SPECIFICATION.md.

### Part 6 — Portfolio intelligence

Send after Part 5

# PART 06 — PORTFOLIO AND OPPORTUNITY-COST ENGINE

Develop a portfolio research module.

Consider:
- Existing holdings.
- Sector concentration.
- Correlations.
- Portfolio volatility.
- Diversification.
- Capital exposure.
- Liquidity.
- Transaction costs.
- Risk contributions.

## 1. OPPORTUNITY-COST ANALYSIS

When comparing companies, evaluate whether the potential benefits of one justify choosing it over another.

Consider:
- Valuation differences.
- Growth expectations.
- Risk differences.
- Liquidity.
- Correlation with existing holdings.
- Expected holding period.
- Alternative uses of available capital.

Do not assume that the stock with the highest projected return is automatically the best portfolio addition.

## 2. PORTFOLIO SCENARIOS

Allow hypothetical portfolio construction and scenario testing.

Evaluate:
- Market-wide declines.
- Sector-specific declines.
- Increased correlations.
- Liquidity deterioration.
- Volatility shocks.
- Interest-rate changes.

## 3. PORTFOLIO VISUALISATION

Display:
- Asset allocation.
- Sector allocation.
- Concentration.
- Correlation matrix.
- Portfolio risk contributions.
- Hypothetical performance.
- Exposure by market regime.

## 4. CAPITAL ALLOCATION

Provide research tools for comparing alternative capital allocations.

Clearly separate hypothetical model outputs from actual financial outcomes.

Do not automatically deploy capital or execute orders.

Integrate with the existing valuation and decision engines.

Update the project specification and test the implementation.

### Part 7 — Trading and execution architecture

Send after Part 6

# PART 07 — TRADING INTERFACE AND EXECUTION ARCHITECTURE

Integrate trade research and order simulation directly into the market heat map.

## 1. CONTEXTUAL COMPANY PANEL

Selecting a company should expose:
- Current price.
- Valuation range.
- Opportunity score.
- Risk score.
- Confidence score.
- Available liquidity information.
- Recent performance.
- Supporting evidence.
- Contradictory evidence.

## 2. ORDER SIMULATION

Implement paper-trading support for:
- Market orders.
- Limit orders.
- Stop orders.
- Position sizing.
- Hypothetical entry and exit.
- Portfolio exposure.
- Transaction fees.
- Bid-ask spread.
- Estimated slippage.
- Order execution simulation.
- Rejected and partially filled order scenarios.

The simulator must not assume every order executes instantly at the displayed market price.

Use realistic execution assumptions and clearly disclose simulated conditions.

## 3. MODULAR EXECUTION ARCHITECTURE

Separate:

1. Market data.
2. Analytical engine.
3. Decision engine.
4. Risk-control engine.
5. Order management.
6. Brokerage adapter.

Initially use paper trading exclusively.

Live brokerage connectivity must remain disabled unless explicitly authorised, independently tested, legally appropriate, and protected by strict order controls.

Never store brokerage credentials in source code.

Do not implement automatic live trading merely because a model generates a signal.

## 4. RISK CONTROLS

Design safeguards for:
- Maximum hypothetical position exposure.
- Portfolio concentration.
- Invalid orders.
- Stale market data.
- Insufficient liquidity.
- Unexpected price changes.
- Duplicate submissions.
- Unavailable brokerage connections.

The user must retain control over execution.

Integrate with the existing project and update the project specification.

### Part 8 — Data infrastructure and professional interface

Send after Part 7

# PART 08 — DATA INFRASTRUCTURE AND PROFESSIONAL INTERFACE

## 1. DATA PROVIDERS

Choose data providers based on actual availability, quality, licensing, coverage and cost.

Investigate APIs before committing to dependencies.

Potential data categories:

- Historical OHLCV.
- Real-time or delayed market prices.
- Company fundamentals.
- Financial statements.
- Corporate actions.
- Earnings information.
- Dividends.
- Sector classifications.
- Economic indicators.
- Interest rates.
- News and company announcements.

Use a provider abstraction layer so data sources can be replaced without rewriting the analytical engine.

Clearly distinguish:
- Live data.
- Delayed data.
- Historical data.
- Simulated data.

Implement appropriate caching, validation and error handling.

Do not assume free data providers permit unrestricted commercial use or live trading.

## 2. DATA INTEGRITY

Record data sources and timestamps.

Identify:
- Delayed data.
- Missing data.
- Estimated data.
- Stale fundamentals.
- Unverified information.
- API failures.

Never silently replace unavailable data with fabricated values.

If data is unavailable, communicate that explicitly.

## 3. INTERFACE DESIGN

Create a professional, information-dense, highly interactive interface.

The heat map should be the central navigation and research environment.

Suggested sections:

1. Global Market Map.
2. Valuation Explorer.
3. Company Research.
4. Quantitative Analysis.
5. Risk Laboratory.
6. Portfolio Laboratory.
7. Strategy Backtesting.
8. Paper Trading.
9. Data Quality Monitor.
10. Model Performance Monitor.

### DESIGN PRINCIPLES

- Avoid unnecessary decorative elements.
- Prioritise useful information density.
- Allow custom layouts.
- Support dark and light modes.
- Make important metrics inspectable.
- Provide detailed explanations on demand.
- Ensure the interface remains responsive.
- Avoid excessive API calls.
- Cache appropriately.
- Support local persistence.

The interface should feel like a professional research workstation, not a gamified trading application.

## 4. TECHNICAL CONSIDERATIONS

Keep the architecture modular.

Optimise for the actual available hardware.

Avoid unnecessary heavyweight dependencies.

Ensure the system remains functional when external APIs are unavailable, while clearly communicating data limitations.

Update PROJECT_SPECIFICATION.md and document implementation decisions.

### Part 9 — Testing, verification and final objectives

Final specification

# PART 09 — TESTING, VERIFICATION AND FINAL IMPLEMENTATION OBJECTIVES

## 1. AUTOMATED TESTING

Build automated tests for:
- Valuation calculations.
- Financial ratios.
- Statistical calculations.
- Data validation.
- Missing values.
- Time-series leakage.
- Risk calculations.
- Portfolio calculations.
- Order simulation.
- Transaction-cost calculations.
- API failures.
- Interface behaviour.

Include reproducible test datasets.

Use synthetic data only when clearly labelled.

Verify that all displayed figures can be traced back to their underlying data and calculations.

## 2. IMPLEMENTATION RULES

1. Work within the existing project rather than creating an unrelated replacement.
2. Do not fabricate live prices, financial statements, company valuations or market signals.
3. Do not hardcode stock-specific conclusions.
4. Do not use arbitrary weights without documenting their rationale.
5. Preserve the independence of valuation, opportunity, risk and confidence.
6. Make assumptions configurable.
7. Use modular, maintainable architecture.
8. Document every significant calculation.
9. Do not sacrifice correctness for visual sophistication.
10. Do not claim that a feature works until it has been tested.
11. Keep paper trading separate from live brokerage execution.
12. Prioritise capital preservation and transparent analysis.

## 3. REQUIRED DEVELOPMENT WORKFLOW

Proceed incrementally.

Stage 1: Inspect the repository and report the existing architecture.

Stage 2: Propose the technical architecture, dependencies, data sources and implementation sequence.

Stage 3: Establish the data infrastructure and validation layer.

Stage 4: Build the valuation and quantitative analysis engines.

Stage 5: Build the integrated heat map and company research interface.

Stage 6: Build risk analysis, uncertainty decomposition and portfolio research.

Stage 7: Implement historical validation and backtesting.

Stage 8: Implement paper trading and order simulation.

Stage 9: Test the complete system and document its limitations.

Do not attempt to implement every component in one enormous unverified change.

After each stage:
- Explain what was implemented.
- Identify changed files.
- Run relevant tests.
- Report failures.
- Identify remaining work.

If a feature requires unavailable data or services, implement a clearly labelled alternative only where scientifically appropriate, and document the limitation.

## 4. FOUR NON-NEGOTIABLE ENGINEERING PRIORITIES

| Priority | Requirement | Reason |
|---|---|---|
| Critical | Point-in-time data | Prevents future information contaminating historical testing |
| Critical | Independent valuation models | Prevents one flawed model dominating conclusions |
| Critical | Out-of-sample validation | Tests whether the system generalises |
| High | Transaction-cost simulation | Prevents unrealistic backtesting results |

## 5. DEVELOPMENT ENVIRONMENT

Prefer a lightweight, local-first architecture.

Account for constrained hardware resources.

Do not introduce enormous machine-learning models or expensive cloud infrastructure without a clear justification.

Prioritise efficient numerical methods, modularity, caching and reproducibility.

## 6. FINAL OBJECTIVE

Build a private, extensible market intelligence environment that helps the user:

- Understand markets.
- Estimate company value.
- Identify potential opportunities.
- Quantify risks.
- Evaluate uncertainty.
- Compare alternatives.
- Research portfolio allocation.
- Simulate trading decisions.

The central principle:

**Do not merely show what the market is doing. Explain what is happening, what might be driving it, what the underlying business may be worth, what could go wrong, how uncertain the assessment is, and what evidence would change the conclusion.**

The system should make better-informed decisions possible, not pretend that uncertainty can be eliminated.

## FINAL DEVELOPMENT PHILOSOPHY

Mathematical correctness first.

Data reliability second.

Decision quality third.

Interface fourth.

Execution last.

A beautiful interface connected to unreliable financial models is worse than a plain interface connected to sound mathematics.

Complete the project through verified, incremental development rather than claiming completeness prematurely.

At completion, produce:
- Final architecture documentation.
- Setup instructions.
- Dependency list.
- Data-provider documentation.
- Testing report.
- Known limitations.
- Feature completion matrix.
- Instructions for safely operating the paper-trading environment.

Update PROJECT_SPECIFICATION.md with the final state.

### How to feed these to Claude Code

I recommend this exact sequence:

* Open Claude Code in your existing project directory.

* Send Part 1.

* Review its repository audit and architecture proposal.

* Send Parts 2–9 sequentially, preserving the same project session where possible.

* Require implementation and testing after the specification has been fully supplied.

One particularly important instruction: Don't let Claude interpret the nine parts as nine independent projects. They are nine layers of one integrated system.

The final product should have one shared data infrastructure, one consistent analytical architecture, and one coherent interface.
