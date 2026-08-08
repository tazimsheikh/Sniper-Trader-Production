<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

# 🧠 Sniper Trader — Master Architecture & Agent Manual

> This document is the **absolute law** for all agents operating in this repository.
> Every rule, every grid value, every lifecycle description here is canonical.
> Deviation will cause parity failures, live trading errors, or optimizer starvation.

---

## ⚡ The Single Most Important Rule: Parity Synchronization

The system operates across **two computational tiers**. Any change to a trading rule (entries, trailing stops, break-even, spread filters, body filters) **MUST be applied symmetrically across BOTH tiers simultaneously**. You cannot change only one side.

```
TIER 1 (Math / Backtest)          TIER 2 (Live / Orchestrator)
─────────────────────────         ──────────────────────────────
A: Optimizer                      A: LiveOrchestrator.ts
B: MathBacktester                 B: OrchestratorShadowBacktester.ts
```

**The Golden Parity Rule:** If Net R or Trade Counts diverge by even **0.01R** between Tier 1 and Tier 2 on any historical CSV test, **PARITY IS BROKEN**. Stop immediately, trace the discrepancy, do NOT auto-patch.

**Shared Math Bridge:** All boundary logic shared between tiers lives in:
`server/trading/backtester/math_core/` → `MageMathCore.ts`, `SageMathCore.ts`

---

## 🔴 The "Be Careful" Protocol

When the user says **"be careful"**, the following mandatory behavior applies:
1. Re-read this entire AGENTS.md before touching any code.
2. If a parity failure or logic error is found, **STOP** and present an Implementation Plan to the user. Wait for explicit approval before touching a single line.
3. Never guess. Never auto-patch. Never suppress TypeScript errors with `as any`, `@ts-ignore`, or `@ts-nocheck`.

---

## 🤖 The 4-Bot Framework

The system is divided into four **completely isolated** bots. Never intertwine their logic.

| Bot | Strategy | Vision? | Engine File |
|-----|----------|---------|-------------|
| **MAGE** | Open Range Breakout (ORB) | ❌ | `MageEngine.ts` |
| **SAGE** | Liquidity Sweep Reversals | ❌ | `SageEngine.ts` |
| **SEER** | Stacy Burke Liquidity Hunts + False Breakouts | ✅ | `SeerEngine.ts` |
| **BLACK SWAN** | Hybrid meta-engine, delegates Mage+Sage trailing for outlier moves | ❌ | `BlackSwanEngine.ts` |

---

## 🗂️ Complete Codebase File Map

### `/server/core/` — Platform Infrastructure

| File | Role |
|------|------|
| `auth.ts` | All HTTP authentication endpoints, session management, `deduplicateRequest` Promise cache to prevent DB pool exhaustion (max 20 connections). |
| `db.ts` | SQLite database module. Owns the `trading_profiles` table with `dwcb_enabled`, `dwcb_peak_balance` for the Daily Drawdown Circuit Breaker. |
| `socket.ts` | WebSocket server. Broadcasts real-time trade updates to the frontend dashboard. |
| `crypto.ts` | AES decryption for MetaApi Account IDs stored encrypted in the database. |
| `email.ts` | Email notification dispatch (trade alerts, drawdown warnings). |
| `settings.ts` | User-facing settings endpoints (risk parameters, enabled bots, lot sizing rules). |

---

### `/server/news/` — Macro Event Intelligence

| File | Role |
|------|------|
| `newsStore.ts` | Fetches and caches high-impact economic calendar events (NFP, CPI, FOMC). Exposes `isHighImpactNews(dateStr, hour, minute)` used by every engine to block trades. |
| `newsAgent.ts` | Background task that periodically refreshes the news cache from external APIs. |

---

### `/server/utils/` — Shared System Utilities

| File | Role |
|------|------|
| `GlobalTradeGate.ts` | The global concurrency gate. Prevents two bots from placing trades simultaneously on the same account. |
| `MetaApiQueue.ts` | Serial queue for all MetaApi broker calls. Prevents API rate-limit violations. |
| `VisionApiQueue.ts` | Serial queue for Gemini Vision API calls (Seer bot only). |
| `DwcbCalculator.ts` | Calculates whether the Daily Drawdown Circuit Breaker has been hit for a given account. |
| `PropFirmRiskMonitor.ts` | Monitors prop firm rule compliance (max daily loss, max total drawdown). |
| `discoverSymbols.ts` | On startup, discovers all available symbols from the connected MetaApi account. |
| `ensureMetaApiReliability.ts` | Wraps MetaApi calls with retry logic and timeout handling. |
| `logger.ts` | Structured console logger with timestamps and log levels. |
| `magicNumber.ts` | Encodes/decodes the MetaTrader "magic number" embedded in each live order to identify which bot placed it and on which pair. |
| `trade_cleanup.ts` | Utility to remove orphaned/stale trade records from the database. |

---

### `/server/trading/config/` — Immutable Configuration Layer

| File | Role |
|------|------|
| `types.ts` | **The single source of truth for all TypeScript interfaces.** `TradeRecord`, `AggregatedCandle`, `MageConfig`, `SageConfig`, `SageOptimizerConfig`, `M1Row`, `M1TypedArrays`, `TriggerEvent`. **Never re-declare these interfaces anywhere else.** |
| `OptimizerPairConfig.ts` | Locked, immutable per-pair constants: `pipSize`, `spread` (in pips), `contractSize`. Used by the optimizer during backtesting. |
| `PairConfig.ts` | Runtime configuration loader. Exports `PairConfigManager` class with helpers: `getRepresentativeConfig(pair)`, `isForex(pair)`, `getBaseSymbol(order.symbol)`. Also exports `MAGE_PAIR_CONFIG`, `SAGE_PAIR_CONFIG`, `SEER_PAIR_CONFIG`, `BLACKSWAN_PAIR_CONFIG`. |

---

### `/server/trading/market/` — Market Pre-Filters & Context

| File | Role |
|------|------|
| `CandleAggregator.ts` | Aggregates M1 rows into M5 or any N-minute candles. Attaches `m1StartIndex` to each M5 candle for fast M1 indexing. |
| `DailyContextTracker.ts` | Tracks rolling 3-day high/low, day-of-week, and daily open. Used by MageEngine to filter low-context days. |
| `HTFContextTracker.ts` | Higher Timeframe context tracker. Monitors weekly/daily trend bias. |
| `Indicators.ts` | Pure math indicator library: ATR, EMA, RSI, Bollinger Bands. Used by Seer for chart analysis. |
| `MathFilters.ts` | Shared pre-trade filters: `isEODSession()`, `isRolloverCircuitBreaker()`. Prevents trading during the 4:55–5:05 PM EST rollover window. |
| `historicalNews.ts` | Static `Set<string>` objects: `NFP_DATES`, `CPI_DATES`, `FOMC_DATES`. Used by the math backtester (which cannot call the live newsStore). |

---

### `/server/trading/broker/` — Broker Interface

| File | Role |
|------|------|
| `metaApiHandler.ts` | The sole interface to the MetaTrader 5 broker via MetaApi. Handles: position opening, modification (move SL), closing, pending order management, account info fetching. All calls go through `MetaApiQueue.ts`. |

---

### `/server/trading/ai/` — Vision Intelligence (Seer Only)

| File | Role |
|------|------|
| `VisionEvaluator.ts` | Sends a chart image to Gemini Vision API and parses the response to approve/reject a Seer trade setup. |
| `ChartRenderer.ts` | Generates a PNG chart image from M1/M5 candle data using `canvas`. The image is passed to `VisionEvaluator`. |
| `PromptVault.ts` | Library of pre-written Gemini prompts for different market conditions. Selects appropriate prompt for each Seer setup. |
| `StacyBurkePrompt.ts` | Stacy Burke–specific prompt templates for liquidity hunt and false breakout evaluation. |

---

### `/server/trading/engine/` — The Live Production Engine (Tier 2-A)

> ⚠️ **Air-Gap Rule:** Files in this directory MUST NEVER import from `backtester/` or `stubs/`. Production-critical only.

| File | Role |
|------|------|
| `LiveOrchestrator.ts` | The central event-driven state machine. Receives ticks from `TickFeed`, fans them out to `MageEngine`, `SageEngine`, `SeerEngine`, `BlackSwanEngine`. Manages pending order recovery on server restart via `orbStates` (Mage) and `sageStates` (Sage). Exports `getFixedEstDate()` — the canonical timezone converter. |
| `MageEngine.ts` | Mage ORB breakout logic. Maintains an ORB range per pair per session. Detects breakouts and routes signals to `LiveOrchestrator` → `metaApiHandler`. |
| `SageEngine.ts` | Sage reversal logic. Detects M5 liquidity sweeps of ORB range, confirms rejection via `actionCandle`, places limit orders. |
| `SeerEngine.ts` | Seer liquidity hunt logic. Generates mathematical candidates → calls `ChartRenderer` → calls `VisionEvaluator` → routes approved setups. |
| `BlackSwanEngine.ts` | Delegates trailing stop management to Mage/Sage logic specifically for outlier high-magnitude moves. |
| `TickFeed.ts` | Connects to MetaApi streaming. Receives real-time ticks, aggregates M1 candles, and feeds them to `LiveOrchestrator`. Uses `getFixedEstDate()` for session gating. |

#### `getFixedEstDate()` — The Timezone Cornerstone
```typescript
// Defined in LiveOrchestrator.ts, exported to all engines and TickFeed
export function getFixedEstDate(date = new Date()) {
  if ((global as any).__SIM_TIME_PROVIDER__) {
    return (global as any).__SIM_TIME_PROVIDER__(date); // Shadow backtester hook
  }
  const estStr = date.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(estStr + " UTC");
}
```
This uses the JavaScript `Intl` API to convert any timestamp into **New York Local Time (EST/EDT)**, automatically handling Daylight Saving Time transitions year-round. All session hours in this codebase are **New York Local Time**, not UTC or broker server time.

---

### `/server/trading/backtester/` — Simulation & Parity Layer (Tier 1-B & 2-B)

| File | Role |
|------|------|
| `loadCsv.ts` | Parses MetaTrader 5 CSV export files (M1 data). Dynamically calculates the EET (Helsinki/broker) and EST (New York) offset for every candle using `Intl.DateTimeFormat`, correctly handling DST. Outputs `M1Row[]` with pre-computed `estHour` field. |
| `MageMathBacktester.ts` | Lightweight loop-based Mage backtester. Iterates M5 candles, calls `MageMathCore.preComputeTriggers()` and `MageMathCore.evaluateExits()`. Used for quick validation. |
| `MageMathBacktesterExp.ts` | Extended Mage backtester with additional instrumentation and session diagnostics. Used for deep debugging. |
| `SageMathBacktester.ts` | Lightweight loop-based Sage backtester. Calls `SageMathCore.preComputeTriggers()` and `SageMathCore.evaluateExits()`. |
| `OrchestratorShadowBacktester.ts` | **The Parity Bridge.** Re-uses the real `LiveOrchestrator.ts` code verbatim, but injects stubs for all broker/DB dependencies via `__SIM_TIME_PROVIDER__`, `MockBrokerAccount`, etc. Simulates tick-by-tick execution on historical CSV data, producing results that must exactly match the Math Backtester (Tier 1 = Tier 2). |
| `SeerMathBacktester.ts` | Mathematical (no-Vision) Seer backtester. Tests the Seer setup detection logic without calling the Vision API. |
| `SeerVisionBacktester.ts` | Full Seer backtester that calls `VisionEvaluator`. Used for end-to-end Seer pipeline validation. |

#### `/server/trading/backtester/math_core/`

| File | Role |
|------|------|
| `MageMathCore.ts` | The canonical Mage math algorithm. `preComputeTriggers()` detects ORB breakout events. `evaluateExits()` simulates trailing stop, break-even, force-close logic on M1 tick data. This is the source of truth for Mage math used by BOTH the optimizer and the MathBacktester. |
| `SageMathCore.ts` | The canonical Sage math algorithm. `preComputeTriggers()` detects M5 liquidity sweeps using `getActionCandle(m5Candles, i-1, actionMinutes)`. `evaluateExits()` simulates limit order fill, trailing SL, and force-close on M1 ticks. |
| `MathCoreUtils.ts` | Shared utility functions: `roundPrice()`, `getActionCandle()` for N-minute candle aggregation from M5 slices. |

#### `/server/trading/backtester/stubs/`

These stubs **mirror** their production counterparts exactly. Any interface change in production MUST be reflected here.

| File | Mirrors |
|------|---------|
| `MockBrokerAccount.ts` | `metaApiHandler.ts` — Simulates trade fills, SL modifications, order cancellations in memory. |
| `crypto.stub.ts` | `server/core/crypto.ts` |
| `db.stub.ts` | `server/core/db.ts` |
| `globalTradeGate.stub.ts` | `server/utils/GlobalTradeGate.ts` |
| `metaApiHandler.stub.ts` | `server/trading/broker/metaApiHandler.ts` |
| `metaApiQueue.stub.ts` | `server/utils/MetaApiQueue.ts` |
| `newsStore.stub.ts` | `server/news/newsStore.ts` — Uses `historicalNews.ts` static sets instead of live API. |
| `socket.stub.ts` | `server/core/socket.ts` |

---

### `/server/trading/optimizer/` — The Alpha Generation Pipeline (Tier 1-A)

#### `/server/trading/optimizer/core/` — Optimizer Engines

| File | Role |
|------|------|
| `ChromosomeMapper.ts` | Maps a flat integer chromosome array (from the GA) to actual typed parameter values (e.g., index 3 → `minSl = 15`). Used by both Mage and Sage optimizers. |
| `HybridGeneticOptimizer.ts` | The Genetic Algorithm engine. Population: 300 chromosomes, 80 generations. Uses tournament selection, crossover, mutation. Fitness = Walk-Forward OOS Net R. |
| `WalkForwardEngine.ts` | Generates Walk-Forward Analysis (WFA) windows. Default: 6-month In-Sample, 2-month Out-of-Sample, rolling forward. |
| `GpuFitnessBridge.ts` | TypeScript bridge to `gpu_evaluator.py`. Batches chromosome fitness evaluations and sends to Python GPU process via stdin/stdout IPC. |
| `gpu_evaluator.py` | Python/PyTorch GPU evaluator. Runs massive batched fitness evaluations on CUDA GPU for extreme speed. |
| `gpu_setup_check.py` | Diagnostic script to verify CUDA/PyTorch availability. |
| `gpu_parity_test.ts` | Validates that GPU evaluations match CPU evaluations to 0.01R tolerance. |
| `test_all_gpu_parity.ts` | Full GPU parity test suite across all pairs and bots. |

#### `/server/trading/optimizer/mage/`

| File | Role |
|------|------|
| `mage_optimizer.ts` | Main Mage optimizer. Spawns 8 parallel Worker threads (one per pair). For each pair: loads CSV → aggregates M5 → generates WFA windows → runs `HybridGeneticOptimizer` per session → dumps `state_<PAIR>.json` and `wfa_<PAIR>.json` to `mage_optimizer_dump/`. |
| `mage_synthesizer.ts` | Post-optimizer synthesis step. Reads all `state_<PAIR>.json` files, ranks configs by OOS Net R, filters by minimum trade count, and produces a clean `mage_portfolio.json` ready for injection. |
| `mage_optimizer_dump/` | Output directory. Contains one `state_<PAIR>.json` (array of alphas sorted by Net R) and one `wfa_<PAIR>.json` (window-by-window OOS results) per pair. |

#### `/server/trading/optimizer/sage/`

| File | Role |
|------|------|
| `sage_optimizer.ts` | Main Sage optimizer. Same Worker-thread architecture as Mage. Optimizes reversal parameters per pair/session. Dumps to `sage_optimizer_dump/`. |
| `sage_synthesizer.ts` | Sage post-synthesis. Produces `sage_portfolio.json`. |
| `sage_optimizer_dump/` | Output dump directory for Sage alphas. |

#### `/server/trading/optimizer/seer/`

| File | Role |
|------|------|
| `seer_cluster_optimizer.ts` | Seer parameter optimizer. Simulates mathematical setups (without Vision) to find good entry/ORB parameter candidates. |
| `seer_synthesizer.ts` | Seer synthesis step. |
| `inject_seer_grandmaster.ts` | Injects the Seer synthesized portfolio into the live system's state files. |
| `seer_optimizer_dump/` | Output dump directory for Seer alphas. |

#### `/server/trading/optimizer/grandmaster/`

The Grandmaster is the meta-optimizer — it selects the best portfolio of alphas *across* all pairs optimally.

| File | Role |
|------|------|
| `grandmaster_synthesizer.ts` | The master orchestrator of the whole pipeline. Reads all individual optimizer dumps, runs CPCV + PLWFO validation, and produces the final `grandmaster_portfolio.json`. |
| `GrandmasterGA.ts` | A second-level GA that selects the optimal *combination* of alphas (not just per pair, but cross-portfolio) to maximize Sharpe and minimize drawdown. |
| `GrandmasterMetrics.ts` | Calculates advanced portfolio metrics: Sharpe Ratio, Sortino Ratio, CPCV (Combinatorial Purged Cross-Validation), PLWFO (Probabilistic Lookahead-free Walk-Forward Optimization). |
| `GrandmasterPreProcessor.ts` | Pre-processes raw alpha dumps before feeding to the GA: deduplication, Z-score normalization, outlier pruning. |
| `grandmaster_cpcv.ts` | Implementation of Combinatorial Purged Cross-Validation for portfolio overfitting detection. |
| `grandmaster_plwfo.ts` | Probabilistic Walk-Forward Optimization runner. |
| `GrandmasterGpuBridge.ts` | GPU bridge specifically for Grandmaster portfolio fitness evaluation. |
| `grandmaster_gpu_evaluator.py` | Python GPU evaluator for the Grandmaster GA. |
| `inject_grandmaster.ts` | **The final injection step.** Takes the validated `grandmaster_portfolio.json` and writes each pair's top configuration into the `server/trading/output/` state files. These are the configs the live bot reads at runtime. |
| `inject_blackswan.ts` | Same injection step for the Black Swan bot's portfolio. |
| `test_grandmaster_parity.ts` | Validates Grandmaster-produced configs against Tier 1 and Tier 2 for parity. |

#### `/server/trading/optimizer/pipelines/`

| File | Role |
|------|------|
| `master_pipeline.ts` | **The single command to run the entire optimization pipeline end-to-end:** Mage optimizer → Sage optimizer → Grandmaster synthesis → Grandmaster injection. One script to rule them all. |

---

### `/server/trading/testing/` — Parity Verification Suite

| File | Role |
|------|------|
| `parity/core_parity_engine.ts` | The parity workhorse. Takes `<BOT> <PAIR> <START> <END>`, runs Tier 1 (MathBacktester) and Tier 2 (ShadowBacktester) sequentially, outputs a `PIPELINE VERIFICATION RESULTS` table. |
| `parity/test_all_parity.ts` | Runs `core_parity_engine.ts` across all bots and top pairs. The pre-commit gate. |
| `parity/quick_parity.ts` | Abbreviated parity check on recent 3 months of data only. For fast local validation. |
| `parity/print_discrepancies.ts` | Detailed discrepancy reporter when parity fails. Prints trade-by-trade diffs. |
| `parity/run_last_6mo.ts` | Parity check on the most recent 6 months of data. |

**Commands:**
```bash
# Full suite parity check
npx tsx server/trading/testing/parity/test_all_parity.ts

# Targeted debug
npx tsx server/trading/testing/parity/core_parity_engine.ts MAGE GBPJPY 2024-01-01 2025-01-01
```

---

### `/server/trading/output/` — Live State Isolation Zone

This directory holds the JSON state files that the live bot reads at runtime. They are the **only** files that should ever be written to by `inject_grandmaster.ts`. The engine reads from here — never from the optimizer dumps directly.

---

## 🔄 The Configuration Lifecycle: From Optimizer to Live Trade

Below is the complete journey of a trading configuration, from its first birth in the optimizer to the moment it executes a live trade.

```
Step 1: RAW GRID DEFINITION
  mage_optimizer.ts defines pair-specific grids:
  minSlGrid, maxSlGrid, minBodyGrid, trailingTriggersGrid, orbMinutesGrid, etc.

Step 2: CHROMOSOME ENCODING
  ChromosomeMapper.ts encodes every combination of grid values
  as an integer index array → [2, 4, 1, 0, 3, ...]

Step 3: GENETIC ALGORITHM BREEDING
  HybridGeneticOptimizer.ts
  ├── Population: 300 random chromosomes
  ├── 80 Generations of evolution
  ├── Fitness = WFA Out-of-Sample Net R
  └── Survivor selection → crossover → mutation → repeat

Step 4: WALK-FORWARD VALIDATION
  WalkForwardEngine.ts creates windows:
  ├── In-Sample (IS): 6 months → GA finds best params
  └── Out-of-Sample (OOS): next 2 months → fitness measured
  Windows roll forward by 2 months each iteration

Step 5: MATH CORE EVALUATION (Tier 1 Truth)
  MageMathCore.evaluateExits() runs on M1 TypedArrays
  Returns: { totalNetR, trades, winRate, maxDrawdown, records[] }

Step 6: DUMP TO STATE FILE
  mage_optimizer_dump/state_GBPJPY.json
  → Array of alphas sorted by totalNetR descending
  → Each entry: { setup: "london_60%_MinSL10_...", totalNetR, trades, ... }

Step 7: SYNTHESIS & RANKING
  mage_synthesizer.ts reads all state_*.json files
  Filters: minTrades >= threshold, OOS Win% > 40%
  Outputs: mage_portfolio.json

Step 8: GRANDMASTER META-SELECTION
  GrandmasterGA.ts selects optimal cross-pair portfolio
  GrandmasterMetrics.ts validates: Sharpe, CPCV, PLWFO
  Outputs: grandmaster_portfolio.json

Step 9: INJECTION INTO LIVE STATE
  inject_grandmaster.ts writes each pair's config to:
  server/trading/output/state_<PAIR>.json

Step 10: RUNTIME BOOT
  LiveOrchestrator.ts reads state files on startup
  Populates orbStates (Mage) and sageStates (Sage) per pair

Step 11: LIVE EXECUTION
  TickFeed.ts receives real-time M1 ticks from MetaApi
  → LiveOrchestrator fans ticks to MageEngine/SageEngine
  → Engine evaluates entry criteria using injected config
  → Signal routed to metaApiHandler.ts → Live trade placed
```

---

## 🟢 Mage Trade Lifecycle — From Tick to Close

Mage trades **Open Range Breakouts**. It builds a range during a defined time window, then enters when price breaks out convincingly.

### BUY Setup (Bullish Breakout)

```
1. SESSION START (e.g., London 3:00 AM EST)
   MageEngine detects candle timestamp matches orbStartHour:orbStartMin
   → Resets orHigh = -Infinity, orLow = +Infinity, orBuilt = false

2. ORB BUILDING PHASE (orbMinutes duration, e.g., 30 mins)
   Every M5 candle: orHigh = max(orHigh, candle.high)
                    orLow  = min(orLow,  candle.low)
   After orbMinutes: orBuilt = true

3. ACTION WINDOW (up to 4 hours after ORB built)
   For each M5 candle closing ABOVE orHigh by >= minBody pips:
   
   [FILTER 1] candle.body >= minBodyPips (breakout must be real momentum)
   [FILTER 2] spread <= maxSpreadPips (avoid gapping markets)
   [FILTER 3] not in EOD session (not 4:45–5:05 PM EST)
   [FILTER 4] no high-impact news (NFP, CPI, FOMC blackout)
   [FILTER 5] DailyContextTracker: not a flat/dead day
   [FILTER 6] one trade per session per pair maximum

4. ENTRY
   Entry = candle.close (market order on breakout candle close)
   Stop Loss (SL) = orLow - spread (below the opposite boundary)
   slDist = Entry - SL (in pips)
   if slDist < minSlDist → reject
   if slDist > maxSlDist → reject

5. TRADE MANAGEMENT (tick-by-tick M1)
   Break-Even Trigger: when price moves trailingSlTrigger × R in profit
     → Move SL to Entry + small buffer
   Trailing Stop: once break-even hit, SL trails by trailingStep × R below
     highest price reached
   Force Close: if trade still open after forceCloseHours → close at market

6. EXIT (one of)
   ✅ Take Profit hit (if exitMode = OPPOSITE_BOUNDARY → TP = orHigh + boxSize)
   ✅ Trailing SL hit after runner
   ✅ Force close timer expired (forceCloseHours)
   ❌ Stop Loss hit (loser)
```

### SELL Setup (Bearish Breakout)
Identical lifecycle, mirrored direction:
- Entry triggered when M5 candle closes BELOW `orLow - minBody`
- SL placed above `orHigh + spread`
- TP = `orLow - boxSize` (if OPPOSITE_BOUNDARY mode)

---

## 🔵 Sage Trade Lifecycle — From Sweep to Reversal

Sage trades **Liquidity Sweep Reversals**. It waits for price to aggressively poke outside the ORB range (sweeping liquidity orders), then fades the move back into the range via a limit order.

### BUY Setup (High Sweep → Reversal Down → Wait → BUY the Return)

```
1. ORB BUILDING PHASE
   Same as Mage — builds orHigh and orLow during orbMinutes window.

2. SWEEP DETECTION (4-hour window after ORB built)
   For each M5 candle:
   
   [DETECT] actionCandle = getActionCandle(m5Candles, i-1, actionMinutes)
            actionMinutes can be 5, 10, 15, or 30 (the N-minute action candle)
   
   SWEEP LOW triggered if:
     actionCandle.low <= orLow - sweepPips × pipSize
   
   [CONFIRM] actionCandle.close > orLow   ← Price MUST close back inside range
             (If it stays below = trend, not a sweep. Reject.)
   
   [FILTER]  actionCandle.body <= maxBodyPips ← Not a massive trend candle
   [FILTER]  no high-impact news
   [FILTER]  not in rollover window

3. LIMIT ORDER PLACEMENT
   limitBuyPrice = orLow + boxSize × entryPenetrationPct
   proposedSL    = orLow - sweepPips × pipSize (just below the sweep low)
   slDist = limitBuyPrice - proposedSL
   if slDist < minSlDist → expand SL to minimum
   if slDist > maxSlDist → reject setup entirely
   
   → Place LIMIT BUY at limitBuyPrice with SL at proposedSL

4. LIMIT ORDER FILL (M1 tick evaluation)
   Wait for price to pull back and fill the limit order.
   If session ends (5 PM EST) before fill → cancel and discard.

5. TRADE MANAGEMENT (identical to Mage once filled)
   Break-even trigger → trailing stop → force close timer

6. EXIT (one of)
   ✅ TP hit (exitMode = MIDPOINT → TP = midpoint of ORB box)
   ✅ TP hit (exitMode = OPPOSITE_BOUNDARY → TP = orHigh)
   ✅ TP hit (exitMode = ORB_EXTENSION → TP = limitPrice + 2×boxSize)
   ✅ Trailing SL captured a runner
   ✅ Force close (forceCloseHours)
   ❌ SL hit
```

### SELL Setup (Low Sweep → Reversal Up → Wait → SELL the Return)
Identical lifecycle, mirrored:
- Sweep triggered when price pokes ABOVE `orHigh + sweepPips`
- Confirm: `actionCandle.close < orHigh` (closes back inside)
- Place LIMIT SELL at `orHigh - boxSize × entryPenetrationPct`
- SL above `orHigh + sweepPips`

---

## 📐 Mage Optimizer Grid Reference

All values below are **New York Local Time (EST/EDT)**. Session hours are not UTC, not MT5 server time.

### Session Start Times Searched (EST)
| Session | Start Times |
|---------|-------------|
| Asia | 6:00 PM, 8:00 PM, 8:30 PM, 8:45 PM, 9:00 PM, 9:30 PM |
| London | 2:00 AM, 3:00 AM, 3:15 AM, 3:30 AM, 4:00 AM |
| NY Forex | 8:30 AM, 9:00 AM, 9:15 AM, 9:30 AM, 10:00 AM |
| NY Indices | 8:00 AM, 9:00 AM, 9:30 AM, 9:45 AM, 10:00 AM |

### Per-Pair Grid Constraints

| Pair / Group | minSlGrid (pips) | maxSlGrid (pips) | minBodyGrid (pips) | trailingTriggersGrid | Notes |
|---|---|---|---|---|---|
| **SLOW_FOREX** (USDCAD, USDCHF, NZDUSD, AUDUSD) | 3, 4, 6, 8, 10 | 15, 20, 25, 30, 40 | 2, 3, 5, 8 | 0.5, 1.0, 1.5, 2.0 | Small ORBs. No 999. |
| **USDJPY** | 5, 8, 10, 12, 15 | 15, 20, 25, 30, 40, 50 | 2, 3, 5 (default) | 0.5, 1.0, 1.5, 2.0 | Cleanest trailing pair. |
| **GBPAUD** | 8, 12, 15, 20, 25, 30 | 40, 50, 60, 80, 100, 120 | 10, 12, 15, 20 | 0.5, 1.0, 1.5, 2.0 | ⛔ No Trig999. Heavy wicks. |
| **EUR_CROSSES** (EURAUD, EURCAD, EURNZD) | 7.5, 10, 15, 20, 25 | 30, 40, 50, 60, 80 | 10, 12, 15, 20 | 0.5, 1.0, 1.5, 2.0 | High spread. Require true momentum. |
| **GBP_MAJORS** (GBPUSD, GBPNZD) | 5, 7.5, 10, 15, 20, 30 | 30, 40, 50, 60, 80, 100 | 10, 12, 15, 20, 25 | 0.5, 1.0, 1.5, 2.0 | ⛔ No Trig999. Overtrading risk. |
| **VOLATILE_CROSSES** (GBPJPY, CADJPY, CHFJPY) | 5, 7.5, 10, 15, 20, 30 | 20, 30, 40, 50, 60, 80, 100 | 6, 8, 10, 12, 15 | default | — |
| **US30, NAS100, GER40** | 20, 30, 50, 80, 120 | 80, 100, 140, 180, 250, 350 | 20, 24, 30 | default | — |
| **SPX500** | 10, 15, 20, 30, 40 | 60, 80, 100, 150, 200, 300 | 5, 8, 10, 15, 20 | default | Extremely volatile NY open. |
| **JPN225** | 40, 60, 80, 100, 120 | 160, 200, 240, 280, 350 | 40, 48, 60 | default | — |
| **XAUUSD, XTIUSD** | 10, 15, 20, 30, 40 | 40, 60, 80, 100, 150 | 25, 30, 40, 50 | 1.5, 2.0, 3.0, 4.0, 999 | 1-min noise filter. Loose trailing. |
| **BTCUSD** | 15, 20, 30, 50, 80, 150 | 100, 150, 200, 300, 400, 600 | 50, 75, 100 | default | — |
| **ETHUSD** | 20, 30, 50, 80, 100 | 100, 150, 200, 300, 400 | 30, 50, 70 | default | — |

---

## 📐 Sage Optimizer Grid Reference

### Per-Pair Grid Constraints

| Pair / Group | minSlGrid | maxSlGrid | sweepGrid | actionMinutesGrid | maxBodyGrid | trailingTriggersGrid |
|---|---|---|---|---|---|---|
| **SLOW_FOREX** (USDCAD, USDCHF, NZDUSD, AUDUSD) | 5, 10, 15 | 20, 35, 50 | default `[0, 5]` | 5, 10, 15, 60 | 3, 8, ∞ | 0.5, 1.0 |
| **VOLATILE_CROSSES** (GBPAUD, GBPJPY, CADJPY, CHFJPY) | 10, 20, 30 | 40, 60, 90, 120, 150 | 0, 10, 20 | 5, 10, 30, 120 | 5, 15, 25, ∞ | 0.5, 1.0, 1.5, 2.0 |
| **US30, NAS100, GER40** | 30, 70, 120 | 100, 200, 300 | 0, 10, 30 | 5, 10, 15, 60 | 12, 22, ∞ | 0.5, 1.0 |
| **SPX500** | 10, 20, 30 | 40, 80, 120, 200 | 0, 10, 25, 40 | 5, 10, 15, 60 | 2, 4, ∞ | 0.5, 1.0, 1.5, 2.0 |
| **JPN225** | 40, 80 | 150, 250 | 0, 10, 20 | 5, 10, 15, 60 | 10, 20, ∞ | 0.5, 1.0 |
| **XAUUSD, XTIUSD** | 15, 30, 40 | 40, 80, 120, 160 | 0, 10, 25, 40 | 5, 10, 15, 30 | 50, 125, ∞ | 0.5, 1.0 |
| **BTCUSD** | 30, 60, 100 | 150, 300, 500 | 0, 20, 50 | default | 9, 20, ∞ | default |
| **ETHUSD** | 20, 50, 80 | 100, 200, 300 | 0, 20, 50 | default | 8, 19, ∞ | default |
| **GBPAUD, EURAUD, EURNZD** | default | default | default | default | 5, 10, ∞ | default |
| **GBPJPY** | default | default | default | default | 5, 10, ∞ | default |
| **Default Forex** | 10, 15, 20, 25, 30 | 20, 30, 40, 50, 60, 70 | 0, 5 | 15, 30, 60 | 3, 8, ∞ | 0.5, 1.0 |

> **∞ in maxBodyGrid** = `undefined` (no upper body limit — allow any size candle to be the sweep candle)

> **actionMinutes** in Sage = the **timeframe of the action candle** used for sweep detection, NOT the window duration. `actionMinutes = 5` means the sweep is detected on a 5-minute closing candle. The session sweep window is always a hardcoded 4 hours.

---

## 🛡️ Engineering Policies

### 1. The No Duct Tape Rule
Never use `as any`, `@ts-ignore`, or `@ts-nocheck` inside `server/trading/`. Trace the interface mismatch to `server/trading/config/types.ts` and fix the root cause.

### 2. The Air-Gap Rule
`server/trading/engine/` → **MUST NEVER** import from `backtester/` or `stubs/`. Production engine is sacred.

### 3. The Stub Sync Rule
Every interface change in a production module must be mirrored in its corresponding stub file. No inline duplicate interfaces in stubs or backtesters. Always import from `types.ts`.

### 4. The Daily Drawdown Circuit Breaker (DWCB)
- Tracked via `dwcb_enabled` + `dwcb_peak_balance` in the `trading_profiles` DB table.
- `DwcbCalculator.ts` computes if the limit has been reached.
- When triggered, `GlobalTradeGate.ts` blocks all new trades system-wide until manually reset.
- High-frequency API endpoints must use `deduplicateRequest` in `server/core/auth.ts` to prevent DB pool exhaustion (max 20 connections).

### 5. Bot Isolation Rule
When working on one bot, **strictly focus only on that bot's files**. Do NOT touch, read, or modify logic from another bot unless explicitly instructed.

### 6. The Parity-First Development Rule
Before merging any logic change: run `npx tsx server/trading/testing/parity/core_parity_engine.ts <BOT> <PAIR>`. If `PARITY BROKEN` — stop, present findings, wait for user approval.

---

## 🔒 Key Decision Log (Session Memory)

- **DST/Timezone:** The entire system uses `America/New_York` locale via `Intl` API. All session hours are EST/EDT. MT5 server time is irrelevant — it is always converted.
- **Sage `actionMinutes`:** This is the timeframe of the **sweep detection candle** (5, 10, 15, or 30 min), NOT the observation window duration. The observation window is always 4 hours. Backup 11 used a hardcoded 5-minute candle, which proved most effective for fast sweep confirmation.
- **GBPAUD Mage:** Was overtrading on 4-pip bodies (604 trades). Fixed to require 10-pip minimum body and mandatory trailing stop (no Trig999).
- **SPX500 Mage:** Was starved because maxSL of 100 was too tight for NY open volatility. Expanded to 300.
- **Gold Mage:** 214R achieved with 16% win rate using Trig999 on tiny 20-pip bodies. Fixed: raised minBody to 25-50 pips; added loose trailing grid `[1.5, 2.0, 3.0, 4.0, 999]`.
- **Pending Order Recovery:** `LiveOrchestrator.ts` on server restart re-attaches pending orders using `PairConfigManager.getBaseSymbol(order.symbol)` and maps to `orbStates` (Mage) or `sageStates` (Sage). Never use client ID string parsing for symbol resolution.
