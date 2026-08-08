# Original User Request

## Initial Request — 2026-06-18T02:58:31Z

Conduct comprehensive web research to design the optimal workflow integrating Mathematical Walk Forward Optimization (WFO) with a Vision AI filter. You must determine how these two forces interact, identify any missing tools or indicators needed to enhance this hybrid strategy, and then translate these findings into specific parameter grids tailored to all 15 pairs in our portfolio.

Working directory: E:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh
Integrity mode: development

## Requirements

### R1. Workflow Architecture & Synergy Research
Research institutional and quantitative finance approaches that combine algorithmic execution with qualitative/visual filters. Determine the optimal workflow for our system: how should the mathematical WFO engine hand off trades to the Vision AI? How do we grade the AI's responses and feed them back to optimize the mathematical net? 

### R2. Extra Tools & Alpha Identifiers
Analyze our current 4 heads (Volatility, Hurst Exponent, KNN Fractals, Volume Profile) and research if there are any highly effective statistical or visual indicators missing from our arsenal. Identify any extra tools, algorithms, or APIs that should be integrated to drastically enhance our edge before the Vision AI filter is applied.

### R3. Per-Pair Specific Grid Translation
Based on the architectural workflow and new tools researched above, determine the optimal mathematical boundaries for each of our 15 unique pairs. Apply these researched parameter grids directly into `server/algo_trader/testing/GridFactory.ts`.

## Acceptance Criteria

### Verification
- [ ] A written report titled `hybrid_workflow_research.md` is produced, explicitly detailing the optimal workflow for combining the WFO and Vision AI, and proposing any new tools to add to the strategy.
- [ ] `server/algo_trader/testing/GridFactory.ts` has been fully updated with newly researched parameter bounds that explicitly account for the unique characteristics of all 15 pairs in the portfolio.
- [ ] The updated grid explicitly focuses on capturing a high density of gross-profit setups (wider bounds, smaller stop losses, aggressive risk-reward) tailored to the new workflow.
- [ ] The agents must run the `npm run wfo` script (or a smaller test script) to verify that their new `GridFactory.ts` correctly compiles and the engine can ingest the new combinations without crashing.

## Follow-up — 2026-06-19T03:03:00Z

Conduct a deep analysis of the Vision AI Backtester logs to identify specific patterns causing False Positives (losing trades taken) and False Negatives (winning trades missed). Iteratively implement and test concrete adjustments to both the trading mathematics (`MathBacktester.ts`) and the AI prompt system (`prompts.ts`) to maximize True Positives and True Negatives.

Working directory: `E:/Antigrav projects/Sniper-Trading-Analyst---by-Tazim-Sheikh`
Integrity mode: development

## Requirements

### R1. Root Cause Analysis
Analyze the `vision_feb2026_trades.json` and `vision_ai_evaluations_log.md` data. Identify mathematical rules in `MathBacktester.ts` or logical rules in `prompts.ts` that are incorrectly filtering out winning trades (False Negatives) or allowing losing trades (False Positives).

### R2. System Fine-Tuning (Pair-Specific & General)
Implement structural adjustments to balance the `MathBacktester` filters and the Vision AI `prompts.ts` evaluation logic. Solutions can be overall general changes, OR they can be extremely specific (e.g., specific to a particular pair, or a particular strategy "head"). 

### R3. Anti-Curve-Fitting Guardrails
Ensure that any pair-specific or strategy-specific adjustments are based on logical structural differences (e.g., volatility profiles, spread differences, structural behavior of indices vs. forex) rather than arbitrarily hardcoding rules to fix past individual trades. Do NOT curve-fit the data.

### R4. Iterative Verification
Iteratively run the backtesting and simulation tools (e.g., `test_nas100.ts` or `run_vision_feb2026.ts` and `generate_log.ts`) to objectively prove that the adjustments improve the system's metrics against the February 2026 out-of-sample data.

## Acceptance Criteria

### Metric Improvements
- [ ] At least one concrete fix is successfully implemented in `MathBacktester.ts` or `prompts.ts`.
- [ ] A re-run of the backtester and the `generate_log.ts` metric script proves that the total number of False Negatives and/or False Positives has objectively decreased.
- [ ] The global Accuracy (baseline 53.4%) or Precision (baseline 41.4%) metrics show mathematically measurable improvement without arbitrary curve-fitting.

### Final Reporting
- [ ] A final report detailing exactly what mathematical or logical rules were adjusted and why the AI was previously failing on those specific setups.

## Follow-up — 2026-06-19T14:33:00Z

Conduct comprehensive web research to design the optimal workflow integrating Mathematical Walk Forward Optimization (WFO) with a Vision AI filter. You must determine how these two forces interact, identify any missing tools or indicators needed to enhance this hybrid strategy, and then translate these findings into specific parameter grids tailored to all 15 pairs in our portfolio.

Working directory: E:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh
Integrity mode: development

## Requirements

### R1. Workflow Architecture & Synergy Research
Research institutional and quantitative finance approaches that combine algorithmic execution with qualitative/visual filters. Determine the optimal workflow for our system: how should the mathematical WFO engine hand off trades to the Vision AI? How do we grade the AI's responses and feed them back to optimize the mathematical net? 

### R2. Extra Tools & Alpha Identifiers
Analyze our current 4 heads (Volatility, Hurst Exponent, KNN Fractals, Volume Profile) and research if there are any highly effective statistical or visual indicators missing from our arsenal. Identify any extra tools, algorithms, or APIs that should be integrated to drastically enhance our edge before the Vision AI filter is applied.

### R3. Per-Pair Specific Grid Translation
Based on the architectural workflow and new tools researched above, determine the optimal mathematical boundaries for each of our 15 unique pairs. Apply these researched parameter grids directly into `server/algo_trader/testing/GridFactory.ts`.

## Acceptance Criteria

### Verification
- [ ] A written report titled `hybrid_workflow_research.md` is produced, explicitly detailing the optimal workflow for combining the WFO and Vision AI, and proposing any new tools to add to the strategy.
- [ ] `server/algo_trader/testing/GridFactory.ts` has been fully updated with newly researched parameter bounds that explicitly account for the unique characteristics of all 15 pairs in the portfolio.
- [ ] The updated grid explicitly focuses on capturing a high density of gross-profit setups (wider bounds, smaller stop losses, aggressive risk-reward) tailored to the new workflow.
- [ ] The agents must run the `npm run wfo` script (or a smaller test script) to verify that their new `GridFactory.ts` correctly compiles and the engine can ingest the new combinations without crashing.

## Follow-up — 2026-06-19T15:15:08Z

Conduct a deep data analysis of the Vision AI's performance over 3 months of backtest data (Feb, Mar, Aug) to identify why it rejected winning trades (False Negatives) and accepted losing trades (False Positives), and propose optimizations to extract more profit.

Working directory: E:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh
Integrity mode: development

## Requirements

### R1. Analyze False Negatives (Missed Winners)
Analyze the existing backtest logs (e.g. `scratch/retroactive_2_month_report.txt`, `vision_oos_august2025_report.txt`, `vision_feb2026_trades.json`) to find common structural or systemic reasons why the Vision AI rejected mathematically winning trades.

### R2. Analyze False Positives (Accepted Losers)
Analyze the same backtest logs to determine why the Vision AI was tricked into accepting trades that ultimately failed. Look for patterns in pair behavior, session timing, or candlestick shapes that bypassed the current AI filters.

### R3. Propose Concrete Optimizations
Provide a detailed written analytical report in an artifact (e.g., `vision_ai_optimization_report.md`). Do not edit the codebase directly. The report must contain explicit, actionable recommendations for how to modify the AI prompts or filters to reduce false signals and capture more winners.

## Acceptance Criteria

### Analytical Rigor
- [ ] The report explicitly cites at least 5 specific historical trades (including Symbol and Date/Time) from the provided logs to back up its hypotheses.
- [ ] The report provides concrete, copy-pasteable prompt modification recommendations (e.g., new rules for `PromptVault.ts` or `StacyBurkePrompt.ts`).
- [ ] The report addresses *both* False Negatives (why we missed winners) and False Positives (why we took losers).

## Follow-up — 2026-06-20T05:45:09Z

Design, test, and implement an advanced drawdown mitigation or hedging algorithm that allows an aggressive 10% risk per trade while mathematically preventing the peak-to-trough drawdown from exceeding 30%, without sacrificing the underlying strategy's total net compounding profit. The agent team has full freedom to explore all mathematical possibilities (hedging, dynamic options pricing math, Kelly Criterion variations, or machine learning filters) to find the optimal solution.

Working directory: `E:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh\scratch\teamwork_drawdown_mitigation`
Integrity mode: development

## Requirements

### R1. Advanced Drawdown Mitigation Logic
Develop an advanced mathematical or algorithmic drawdown mitigation strategy that strictly preserves the user's requirement of keeping the base risk allocation at 10% per trade. 

### R2. Performance Targets
The solution must reduce the peak-to-trough drawdown experienced in the Q4 2025 Out-of-Sample dataset (which is currently at 90.8%) down to 30% or less, while keeping the total net compounding return strictly above 400% (the raw benchmark is +433%).

### R3. Programmatic Proof
The agent team must test their proposed algorithms programmatically by writing custom simulators that read the `E:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh\vision_q4_2025_oos.json` dataset and output chronological compounding results.

## Acceptance Criteria

### Performance & Verification
- [ ] A standalone Python or TypeScript simulator script exists that reads the `vision_q4_2025_oos.json` trades and applies the new drawdown mitigation logic.
- [ ] Running the script outputs a final Max Drawdown of <= 30%.
- [ ] Running the script outputs a final Total Return of >= 400%.
- [ ] The logic is generalized and does not contain hard-coded dates or overfitted rules specific *only* to the Q4 dataset.

## Follow-up — 2026-06-20T06:21:03Z

Research and develop a systemic or logic-based modification to reduce the algorithmic maximum drawdown to below 30% (assuming 10% risk per trade), while maintaining a total net profit of at least 90% of the original unmitigated backtest results for whatever 3-month period is tested.

Working directory: E:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh
Integrity mode: demo

### Requirements

#### R1. Research Methodologies
Search the web for advanced institutional risk management strategies, specifically focusing on "equity curve trading" and "algorithmic circuit breakers" (e.g., halting trading after X consecutive losses, or dropping risk sizing after a specific drawdown percentage).

#### R2. Implement Circuit Breakers
Implement the best-researched methodology directly into the system's mathematical trade management logic (e.g., in `scratch/AccountSimulator.ts` or `VisionBacktester.ts`). Do **not** optimize the core AI prompts or trade selection rules. Focus strictly on equity-level circuit breakers.

#### R3. Cross-Quarter Verification
Test the new logic across all available 3-month backtest datasets in the workspace (e.g., Q4 2025, Q1 2026, and any historical 2024 data available) to prove it is not curve-fit to a single quarter.

### Acceptance Criteria

#### Objective Verification
- [ ] The agent provides an artifact summarizing the web research on circuit breaker methodologies.
- [ ] The new circuit breaker logic is successfully coded into the backtesting/simulation suite.
- [ ] The agent programmatically runs the updated simulator on multiple different 3-month OOS JSON files.
- [ ] The output logs mathematically prove that the new circuit breaker keeps the Maximum Drawdown below 30% (when compounding at 10% risk per trade).
- [ ] The output logs mathematically prove that the total net profit remains at least **90%** of what the original, unmodified backtest generated for those specific months (i.e. if the original generated +400 pips, the mitigated version must generate at least +360 pips).

## Follow-up — 2026-06-20T06:43:09Z

Research, design, and evaluate alternative risk management algorithms (including Zeno's Paradox Equity Buffer) that strictly maintain a 10% base risk parameter while minimizing maximum drawdown to 29% or lower.

Working directory: E:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh
Integrity mode: demo

## Requirements

### R1. Implement Zeno's Paradox Equity Buffer
Implement and test the Zeno's Paradox Equity Buffer approach in `scratch/AccountSimulator.ts` using a 29% maximum drawdown tolerance floor. 

### R2. Research Additional Risk Models
Research and implement at least one additional risk management algorithm that aims to minimize drawdown while satisfying the strict 10% risk constraint. Explore all possible logic-based sizing or halting mechanisms.

### R3. Strict 10% Risk Constraint
The base risk percentage multiplier must remain strictly at 10%. Position sizing can be calculated against a buffer, trailing peak, or other mathematical construct, but the risk multiplier itself cannot be artificially reduced (e.g., dropping to 1% is strictly prohibited).

## Acceptance Criteria

### Verification Checks
- [ ] Zeno's Paradox Equity Buffer is implemented and tested.
- [ ] At least one additional alternative risk model is researched, implemented, and tested.
- [ ] Both algorithms are stress-tested against **ALL available out-of-sample (OOS) data** in the database.
- [ ] Unit tests verify that the base risk multiplier remains fixed at exactly 10% in the core code logic.
- [ ] A final comparative report (`alternative_risk_models.md`) is generated showing the resulting Max Drawdown and Total Net Pips for each tested model.

## Follow-up — 2026-06-20T17:14:01Z

Analyze the 5-year mathematical backtest data (Markdown summary and CSV logs) to discover mathematical filters (time-based metrics, pair/setup combos, DWCB circuit tweaks, or other statistical patterns) that reliably eliminate the worst-performing trades. Provide and integrate a concrete Typescript implementation of these filters into the system.

Working directory: e:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh
Integrity mode: demo

## Requirements

### R1. Statistical Analysis
Analyze the `5yr_trade_logs.csv` and `5yr_math_breakdown.md` artifacts to identify underperforming clusters. Start by exploring time-based metrics (Time of Day, Day of Week), Pair/Setup combinations, and the existing DWCB circuit. If those don't show significant improvement, expand the search to any statistical patterns found in the CSV.

### R2. Trim the Worst Offenders
Develop programmatic filter logic based on the analysis. The goal is strictly to eliminate the specific setups, times, or structural clusters that actively bleed money, improving the baseline without unnecessarily gutting the total trade count. 

### R3. Engine Integration
Implement the discovered filters seamlessly into the existing Typescript backtesting environment (e.g., inside `MathBacktester.ts` or `LiveOrchestrator.ts`) so they become a permanent part of the system's baseline mathematical logic. Read the existing source code to understand expected behavior before modifying.

## Acceptance Criteria

### Data-Backed Validation
- [ ] An automated data analysis script must be written and executed that mathematically proves the proposed filters remove more losing pips than winning pips over the historical 5-year dataset.

### Baseline Improvement
- [ ] The Typescript backtesting engine must be successfully updated with the new filter logic.
- [ ] A validation run over the 5-year dataset must confirm that the new portfolio net pips are higher than the unfiltered baseline (+987.6 pips).


## Follow-up — 2026-06-21T02:51:23+05:30

Analyze the true positive (winning) and false positive (losing) trades from the 5,025-trade Forex baseline dataset to fundamentally fix and optimize the core algorithmic entry/exit math. The goal is to adjust the core technical parameters to make the raw mathematics intrinsically profitable on Forex without relying on hardcoded time, day, or setup blocks.

Working directory: e:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh
Integrity mode: benchmark

## Requirements

### R1. Deep Log Analysis
Write an automated script to deeply analyze the 5,025-trade `forex_5yr_trade_logs.csv` to find the exact mathematical differences between the True Positives and False Positives. 

### R2. Core Math Overhaul (FOREX ONLY)
Modify the core algorithmic constraints inside `MathBacktester.ts` and `PairConfig.ts` based on your analysis. You have full authorization to adjust EMAs, wick/body ratios, entry logic offsets, or stop-loss/take-profit formulas. **CRITICAL: You must isolate all mathematical changes ONLY to the Forex pairs (e.g., by checking if it's a Forex pair). DO NOT touch or alter any rules that might break the existing highly optimized baseline for Indices, Cryptos, and XTI.**

### R3. Two-Step Optimization
**Step One:** Naturally "fix the math" for Forex pairs by implementing the algorithmic adjustments from R2. 
**Step Two:** After the natural math is fixed and showing great results, identify the remaining structural "Death Clusters" (toxic hours, days, or pair setups) and inject those surgical blocks into `MathFilters.ts` to further enhance the net pips.

## Acceptance Criteria

### Verification
- [ ] An automated data analysis script must be written and executed that proves the mathematical differences between the losing and winning Forex setups.
- [ ] The core engine (`MathBacktester.ts`) must be successfully updated with the new mathematical constraints.
- [ ] All 61 existing E2E and Adversarial tests must pass cleanly.
- [ ] The `run_forex_math_report.ts` script must be re-run, proving that the new unfiltered 5-Year Forex baseline has swung from severely negative to strictly positive.


## Follow-up — 2026-06-22T04:45:18Z

The goal of this project is to formally audit the final backtest results for accuracy across the entire Master Portfolio (all 11 Forex pairs, plus Gold, Indices, and Cryptos). If the mathematical edge is verified, the agent team will deploy the optimized "Master Portfolio" into the live production trading environment. This requires updating backend configurations, pair-specific settings, and ensuring full integration within the frontend MAGE UI.

Working directory: e:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh
Integrity mode: demo

## Requirements

### R1. Backtest vs Live Execution Alignment (Masterful Audit)
The team must perform a masterful audit to guarantee the backtesting engine (`scratch/run_us30_mage_test.ts`) perfectly mirrors live execution realities. This means explicitly checking for edge-case scenarios, API latency considerations, overlapping logic, spread handling, and pair-specific pip math. They must definitively prove that the triggers, entries, and trade management rules simulated in the backtest will *actually* take place exactly as intended in a real live MetaAPI server environment without failing.

### R2. Independent Full Portfolio Audit
Once the backtester is fully hardened, the team must run the system to generate the final data and calculate the Win Rate and Net R for the full Master Portfolio. This includes the 11 Forex pairs AS WELL AS Gold, Indices (NAS100, US30, GER40), and Cryptos (ETHUSD). They must verify the overall profitability math before proceeding to deployment.

### R3. Backend Live Configuration
If the audit matches expectations, update the live backend configuration (`PairConfig.ts` or relevant production files) to formalize the "Master Portfolio" execution. This portfolio includes: NAS100, US30, XAUUSD, ETHUSD, GBPAUD, EURAUD, GBPNZD, USDJPY, EURNZD, EURJPY, and GER40.

### R4. Frontend MAGE UI Updates
Update the MAGE frontend UI code to ensure all pairs from the "Master Portfolio" are available in the active trading dropdown/selection list.

## Acceptance Criteria

### Masterful Audit Verification
- [ ] An **Execution Alignment Report** is provided, definitively proving that the backtest engine perfectly mirrors live MetaAPI execution (checking for latency gaps, spread logic, overlapping trade management, and API error handling).
- [ ] The report explicitly clears the system of data ingestion errors, CSV corruption, or mathematical pitfalls.
- [ ] A final audit script is run that recalculates and logs the overall Net R and Win Rate for the full Master Portfolio to the console.

### Deployment Verification
- [ ] The backend configuration files compile successfully after the new pairs are added.
- [ ] The frontend UI code is verified to contain the updated list of pairs.


## Follow-up — 2026-06-22T05:37:32Z

CRITICAL OVERRIDE: HALT ALL COMPILATION AND DEPLOYMENT.

The user just recovered the true original rule set for the Master Portfolio. We have been coding the wrong entry logic for Forex!

1. Indices, Gold, ETH: Pure 0% Breakout (Wick Touch).
2. EURUSD and standard Forex: Pure 0% Breakout (Wick Touch).
3. Japanese Crosses (AUDJPY, EURJPY, GBPJPY, USDJPY): Require a 15-25% pullback into the ORB box before entering!

Abort the "Candle Close" logic you just implemented for Forex. The Japanese crosses failed originally because they needed a pullback limit order (`orHigh - 0.20 * orRange`), not a Candle Close! 

Pause your execution and wait for the finalized math before you touch the codebase again!


## Follow-up — 2026-06-22T06:20:51Z

CRITICAL OVERRIDE LIFTED. HAND-OFF PACKAGE READY.

You are cleared to resume deployment operations. I have completed the massive global grid search across all 16 pairs, 3 sessions, and 5 pullbacks. 

**YOUR MISSION:**
You are to deploy the MAGE ORB engine across the Live Codebase (`PairConfig.ts`, `LiveOrchestrator.ts`). However, you must execute this with extreme mathematical skepticism and safety.

**THE SKEPTICISM DIRECTIVE:**
Before finalizing the deployment, you must critically review the backtest mechanics we used in `scratch/run_global_grid.ts` and the results in `global_session_pullback_grid.md`. We generated +2,900 R on ETHUSD and +1,300 R on US30. Your job is to ensure these numbers aren't the result of a hidden tick-data hallucination (e.g., verifying the minimum stop-loss expansion logic and Bid/Ask spread modeling). Are we mathematically sound?

**THE ISOLATION DIRECTIVE:**
MAGE ORB is an entirely different system from the "Four Heads" (Seductress, Sage, Seer, Reaper). They share the same codebase. You MUST NOT touch or break the Four Heads systems when updating `PairConfig.ts` or the Orchestrator logic.

**THE DEPLOYMENT MATRIX (TOP COMBINATIONS TO DEPLOY):**
- ETHUSD -> NY Forex Open (08:00 EST), 45% Pullback Limit Order
- US30 -> NY Indices Open (09:30 EST), 45% Pullback Limit Order
- USDJPY -> NY Indices Open (09:30 EST), 25% Pullback Limit Order
- XAUUSD -> NY Indices Open (09:30 EST), 35% Pullback Limit Order
- NAS100 -> NY Indices Open (09:30 EST), 45% Pullback Limit Order
- EURJPY -> NY Forex Open (08:00 EST), 15% Pullback Limit Order
- GBPAUD -> London Open (03:00 EST), 15% Pullback Limit Order

**THE FULL-PROOF EXECUTION TEST (CRITICAL):**
After compilation, you MUST write a test script that runs the Live Bot and verifies that its limit order placement precisely matches the grid simulation tick-for-tick. You are only authorized to declare this complete if the Live Bot's order execution is 100% mathematically synchronized with the backtest. It must be full-proof.

Report back once you have audited the grid math and completed the live implementation testing.


## Follow-up — 2026-06-22T07:17:07Z

CRITICAL ALIGNMENT UPDATE FROM PARENT: We have completed the mathematical verification of the 17-pair Master Portfolio using the flawless V2 Compounding Engine. The portfolio generates +246% growth in 30 days at 5% risk per trade with only 25% max drawdown!

However, you MUST relay the following strict execution rules to the Gen 4 Orchestrator for the live deployment implementation. These rules are the sole reason the system survived the 5% risk threshold:

1. VETO RULE: The system MUST skip entries if the ORB Box is too large (e.g., if `isForex && (orRangePips + 10) > maxSlPips`).
2. STOP LOSS BUFFER: There MUST be a 10-pip stop loss buffer added to Forex pairs to avoid premature wick-outs (`slBuffer = 10 * pipSize`).
3. DYNAMIC TRAILING STOP: The trailing stop MUST be active (moving to Breakeven at +0.5R, and locking in +0.5R profit when price hits +1.0R). Do NOT simplify this to a fixed 10R take profit.
4. TIME EXIT: The 16:50 EST Time Exit (or equivalent 6-hour max trade duration) must be strictly enforced.

Relay this to the active Gen 4 Orchestrator (ID: 85ea301b-11d2-41ad-a4cd-5427f0e25e94) immediately to ensure the live backend execution script mirrors these non-looping mathematical realities exactly. Update your BRIEFING.md to reflect this validation.

## Follow-up — 2026-06-22T10:58:37Z

Implement the "MAGE" Opening Range Breakout strategy (with dynamic 0.5R trailing stops and the Flawless 11 optimized parameters) as the fifth independent trading head in the existing multi-strategy engine, ensuring zero interference with the four legacy strategies.

Working directory: `e:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh`
Integrity mode: demo

## Requirements

### R1. Architectural Isolation
Implement the MAGE strategy as an isolated module or class structure. It must function as the 5th independent head in the engine without modifying the core signal generation flow of the 4 legacy strategies.

### R2. Flawless 11 Integration
Update the `PairConfig.ts` array to map the exact mathematically proven Flawless 11 parameters (Asset, Session Time, and Pullback Depth) for the MAGE strategy without deleting properties required by the legacy strategies.

### R3. Comprehensive Codebase Review
Before making any modifications, the team must thoroughly study the existing live orchestration architecture to fully understand how the first 4 heads were implemented.

### R4. UI Integration & Auditing
Perform a complete audit and fix of the frontend UI. The system must natively support the 5th head, and the UI pair dropdowns must dynamically filter and show only the specific pairs mapped to each individual bot strategy.

### R5. Parameter Isolation (DWCB)
The UI currently contains parameters specific to the previous strategies (like DWCB). Ensure these legacy parameters are hidden, disabled, or isolated so they do not appear or affect the configuration of the new 5th MAGE head.

### R6. Interactive Q&A
If there are any unresolved ambiguities after auditing the entire codebase (especially regarding the UI architecture or state management), the team must stop and ask the user questions before writing any code.

## Acceptance Criteria

### Execution & Safety
- [ ] The MAGE strategy logic exists in its own isolated structure and does not overwrite legacy files.
- [ ] `PairConfig.ts` is updated with the Flawless 11 parameters, while keeping all legacy strategy properties intact.
- [ ] The implementing agents provide a concrete summary verifying exactly how the 5th head was successfully injected without interfering with the first 4 strategies.

### UI & Parameter Logic
- [ ] The frontend UI pair dropdown menus are audited and fixed to correctly filter and display only the pairs specifically designated for each of the 5 bot strategies.
- [ ] The DWCB parameters (and any other legacy-specific UI options) are fully disabled or hidden when configuring the MAGE strategy head.
- [ ] The agent team stops to ask clarifying questions before committing frontend architectural changes if they encounter ambiguity.

## Follow-up — 2026-06-23T14:02:47Z

Conduct a comprehensive, production-readiness audit of the live execution bots (The Seer and The Mage, which encompass all strategies) within the trading application. Identify and resolve any double logic, orphaned code, contradictions, and edge cases, ensuring robust execution, functional circuit breakers, and safety guardrails are implemented so it can reliably take live trades.

Working directory: e:\Antigrav projects\Sniper-Trading-Analyst---by-Tazim-Sheikh
Integrity mode: benchmark

## Crucial Context
- **Read the Codebase First:** Do not blindly implement new guardrails. The system may already have circuit breakers, kill switches, or state recovery logic. Map out what is already working and adjust your implementation plan to optimize and fix existing code rather than reinventing the wheel.
- **The Mage Bot:** Deliberately runs **without** Vision AI in live execution. Keep it this way.
- **The Seer Bot:** A combination of four previous heads that runs **with** Vision AI.

## Requirements

### R1. Hardcore Execution Audit of Seer & Mage
Audit every aspect of the core trading logic of The Seer and The Mage execution heads with a zero-tolerance approach to execution latency and errors. Remove any orphaned code, resolve double logic, and fix contradictions to ensure flawless trade execution. 

### R2. Strict Fail-Safes, News Blocks, and Circuit Breakers
Audit and verify all circuit breakers across the entire board. Ensure that high-impact news correctly blocks trades and that strict kill switches and mock absolute worst-case network drops are fully handled without failure.

### R3. Memory Management & Zombie Process Prevention
Audit the system for memory leaks, specifically addressing the proper lifecycle management and cleanup of background processes (such as Chromium instances/zombies) to guarantee the app can run indefinitely without crashing from memory exhaustion.

### R4. State Recovery & API Quota Protection
Ensure the system can gracefully reconstruct its state (hydrate active trades from the broker) if the server crashes or restarts. Verify that API interactions (like MetaAPI) have robust exponential backoffs and rate-limit protections to prevent account bans during volatile market conditions.

## Acceptance Criteria

### Execution Reliability Verification
- [ ] Programmatic unit/integration tests mimicking the broker API confirm that both execution heads trigger trades under the correct conditions without duplicate logic errors.
- [ ] Tests programmatically simulate absolute worst-case network drops and verify the kill switches and fail-safes trigger correctly without catastrophic failure.
- [ ] Integration tests verify that trades are reliably and accurately blocked during designated news events.
- [ ] All system-wide circuit breakers are verified via test to engage and disengage correctly under extreme simulated market conditions.
- [ ] Scripts or tests demonstrate that the application correctly cleans up child processes and handles forced restarts by properly reconstructing active trade states from the broker without duplicating trades.


