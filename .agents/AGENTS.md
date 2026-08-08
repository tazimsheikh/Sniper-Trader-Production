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

## 🤖 The 3-Bot Framework

The system is divided into three **completely isolated** automated bots. Each bot runs its own structural trailing and DB logging via `LiveOrchestrator.ts`. **Never intertwine their logic.**

| Bot | Strategy | Vision? | Engine File |
|-----|----------|---------|-------------|
| **MAGE** | Open Range Breakout (ORB) | ❌ | `MageEngine.ts` |
| **SAGE** | Liquidity Sweep Reversals | ❌ | `SageEngine.ts` |
| **SEER** | Stacy Burke Liquidity Hunts + False Breakouts | ✅ | `SeerEngine.ts` |

---

## 🛡️ The Margin Defender (Safety Net)

The file `server/manager/tradeManager.ts` runs on a standalone polling loop. **It is strictly a safety net.**
- **Margin Defender**: Monitors account equity and halts trading if margin drops below safe levels (closing the worst losing trade if < 110%).
- **Ghost Trade Reconciliation**: Rescues orphaned `PLACING` or `PENDING_VERIFICATION` trades if the broker connection drops.
- **News Ejection / Death Zone**: Sweeps the portfolio and force-closes trades 5 minutes before High-Impact News or during the 16:50 EST rollover.
- **RESTRICTION**: `tradeManager.ts` is explicitly **BLOCKED** from applying trailing stops to Mage, Sage, Seer, or Black Swan trades. This prevents fatal double-logic race conditions with `LiveOrchestrator.ts`.

---

## 🔑 MetaAPI v4+ SDK Strict Rules & Order Options

All orders executed via `metaApiHandler.ts` must comply with MetaAPI Cloud SDK v4+ specifications:

1. **Allowed Order Options**: The ONLY valid keys inside the `options` object passed to `createMarketBuyOrder`, `createMarketSellOrder`, `createLimitBuyOrder`, `createLimitSellOrder` are:
   - `clientId` (string, max 32 characters)
   - `magic` (integer, MetaTrader magic number)
   - `comment` (string, max 31 characters)
   - `slippage` (number, maximum slippage in pips)
   
   ⚠️ **CRITICAL**: Custom parameters such as `botId`, `orHigh`, `orLow`, or `limitPrice` MUST NEVER be passed in the MetaApi options object. Passing undocumented keys causes immediate broker `Validation failed` rejections.

2. **Client ID Length & Hash Format**:
   - MetaTrader 5 strictly enforces a 32-character limit on the order `clientId` (comment field).
   - Long strategy signatures are hashed using `getShortHash(sig)` from `server/core/crypto.ts` (12-char MD5 hex prefix).
   - Format: `M_<hash12>_<timestamp>` (Mage) and `S_<hash12>_<timestamp>` (Sage).
   - `LiveOrchestrator` maintains a reverse lookup map (`sigMap`) on boot to resolve 12-char short hashes back to full strategy signatures for state re-hydration.

---

## 🗂️ Complete Codebase File Map

### `/server/core/` — Platform Infrastructure

| File | Role |
|------|------|
| `auth.ts` | All HTTP authentication endpoints, session management, `deduplicateRequest` Promise cache to prevent DB pool exhaustion (max 20 connections). |
| `db.ts` | Database connection module. Owns `trading_profiles` table with `dwcb_enabled`, `dwcb_peak_balance`, `institutional_enabled`, `institutional_peak_balance`, etc. |
| `socket.ts` | WebSocket server. Broadcasts real-time trade updates per profile (`io.to('profile_' + profileId)`). |
| `crypto.ts` | AES-256-GCM encryption for MetaApi Account IDs. Exports `getShortHash(sig: string): string` to format compliant 12-character hashes for order client IDs. |
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
| `GlobalTradeGate.ts` | The global concurrency gate. Prevents two bots from placing trades simultaneously on the same account. Profile-isolated via `Map<profileId, Map<string, ActiveEntry>>`. |
| `MetaApiQueue.ts` | Serial queue for all MetaApi broker calls. Isolated per-profile using `Map<profileId, ProfileQueueState>`. Prevents rate-limit drops and cross-profile queue throttling. |
| `VisionApiQueue.ts` | Serial queue for Gemini Vision API calls (Seer bot only). |
| `DwcbCalculator.ts` | Calculates whether the Daily Drawdown Circuit Breaker has been hit for a given profile. Sandboxed with `(global).__SIM_DB__` for backtester compatibility. |
| `PropFirmRiskMonitor.ts` | Monitors prop firm rule compliance (max daily loss, max total drawdown). |
| `discoverSymbols.ts` | On startup, discovers all available symbols from the connected MetaApi account. |
| `ensureMetaApiReliability.ts` | Wraps MetaApi calls with retry logic and timeout handling. |
| `logger.ts` | Structured console logger with timestamps and log levels. |
| `magicNumber.ts` | Encodes/decodes the MetaTrader "magic number" embedded in each live order to identify which bot placed it and on which pair. |
| `trade_cleanup.ts` | Utility to remove orphaned/stale trade records from the database. |
| `fetch_live_balance.ts` | Utility script to fetch live broker account equity and balance. |
| `enable_dwcb.ts` | Utility script to bulk-enable DWCB on all user profiles. |

---

### `/server/trading/config/` — Immutable Configuration Layer

| File | Role |
|------|------|
| `types.ts` | **The single source of truth for all TypeScript interfaces.** `TradeRecord`, `AggregatedCandle`, `MageConfig`, `SageConfig`, `SageOptimizerConfig`, `M1Row`, `M1TypedArrays`, `TriggerEvent`. **Never re-declare these interfaces anywhere else.** |
| `OptimizerPairConfig.ts` | Locked, immutable per-pair constants: `pipSize`, `spread` (in pips), `contractSize`. Includes entries for `GER40`, `DAX40`, `DE40`. |
| `PairConfig.ts` | Runtime configuration loader. Exports `PairConfigManager` class with helpers: `getRepresentativeConfig(pair)`, `isForex(pair)`, `getBaseSymbol(order.symbol)`. `isForex()` excludes indices (`US30`, `NAS100`, `SPX500`, `GER30`, `GER40`, `DAX40`, `DE40`, `DE30`, `UK100`, `JPN225`). |

---

### `/server/trading/market/` — Market Pre-Filters & Context

| File | Role |
|------|------|
| `CandleAggregator.ts` | Aggregates M1 rows into M5 or N-minute candles. Calculates `estHour` using DST-aware `Intl.DateTimeFormat("en-US", { timeZone: "America/New_York" })`. Attaches `m1StartIndex` to each candle. |
| `DailyContextTracker.ts` | Tracks rolling 3-day high/low, day-of-week, and daily open. Used by MageEngine to filter low-context days. |
| `HTFContextTracker.ts` | Higher Timeframe context tracker. Monitors weekly/daily trend bias using `computeEma` from `Indicators.ts`. |
| `Indicators.ts` | Pure math indicator library: ATR, EMA (`computeEma`), RSI, Bollinger Bands, ADX. Exports `SessionFilter` type. |
| `MathFilters.ts` | Shared pre-trade filters: `isEODSession()`, `isRolloverCircuitBreaker()`, `isSeerRolloverHalt()`. |
| `historicalNews.ts` | Static `Set<string>` objects: `NFP_DATES`, `CPI_DATES`, `FOMC_DATES`. Used by backtesters. |

---

### `/server/trading/broker/` — Broker Interface

| File | Role |
|------|------|
| `metaApiHandler.ts` | The sole interface to MetaTrader 5 via MetaApi. Handles order execution, SL modifications, order cancellation, and account balance fetching. All calls routed through `MetaApiQueue.ts`. |

---

### `/server/trading/ai/` — Vision Intelligence (Seer Only)

| File | Role |
|------|------|
| `VisionEvaluator.ts` | Sends chart image to Gemini Vision API and parses response to approve/reject Seer setups. |
| `ChartRenderer.ts` | Generates PNG chart image from candle data using `canvas` for `VisionEvaluator`. |
| `PromptVault.ts` | Library of pre-written Gemini prompts for different market conditions. |
| `StacyBurkePrompt.ts` | Stacy Burke–specific prompt templates for liquidity hunt and false breakout evaluation. |

---

### `/server/trading/engine/` — The Live Production Engine (Tier 2-A)

> ⚠️ **Air-Gap Rule:** Files in this directory MUST NEVER import from `backtester/` or `stubs/`. Production-critical only.

| File | Role |
|------|------|
| `LiveOrchestrator.ts` | Central event-driven state machine. Manages `cachedEquity` (updated live via `TickFeed.onAccountInformationUpdated`). Evaluates DWCB using `cachedEquity`. If `cachedEquity === 0` in live mode, trade is aborted for safety. Exports `getFixedEstDate()`. |
| `MageEngine.ts` | Mage ORB breakout logic. Builds ORB range per pair per session. Executes market/limit breakout orders. |
| `SageEngine.ts` | Sage reversal logic. Detects M5 sweeps of ORB range, confirms rejection via action candle, places limit/market orders. Awaits all MetaAPI cancellations to prevent unhandled promise rejections. |
| `SeerEngine.ts` | Seer liquidity hunt logic. Generates mathematical candidates → calls `ChartRenderer` → calls `VisionEvaluator` → routes approved setups using `orch.cachedEquity`. |
| `TickFeed.ts` | Connects to MetaApi streaming. Receives real-time ticks and account updates (`onAccountInformationUpdated` updates `orch.cachedEquity`). Feeds ticks to `LiveOrchestrator`. |

#### `getFixedEstDate()` — Timezone Cornerstone
```typescript
export function getFixedEstDate(date = new Date()) {
  if ((global as any).__SIM_TIME_PROVIDER__) {
    return (global as any).__SIM_TIME_PROVIDER__(date);
  }
  const estStr = date.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(estStr + " UTC");
}
```
Converts any timestamp into **New York Local Time (EST/EDT)** handling DST transitions year-round. All session hours are **New York Local Time**.

---

### `/server/trading/backtester/` — Simulation & Parity Layer (Tier 1-B & 2-B)

| File | Role |
|------|------|
| `loadCsv.ts` | Parses MetaTrader 5 CSV M1 data. Calculates EET/EST offsets per candle via `Intl.DateTimeFormat`. |
| `MageMathBacktester.ts` | Lightweight loop-based Mage backtester calling `MageMathCore`. |
| `MageMathBacktesterExp.ts` | Experimental Mage backtester with extra diagnostic instrumentation. Marked experimental. |
| `SageMathBacktester.ts` | Lightweight loop-based Sage backtester calling `SageMathCore`. |
| `OrchestratorShadowBacktester.ts` | **The Parity Bridge.** Re-uses `LiveOrchestrator.ts` verbatim with injected stubs (`__SIM_TIME_PROVIDER__`, `MockBrokerAccount`). |
| `SeerMathBacktester.ts` | Mathematical Seer backtester without Vision API calls. |
| `SeerVisionBacktester.ts` | Full Seer backtester calling `VisionEvaluator`. |

#### `/server/trading/backtester/math_core/`

| File | Role |
|------|------|
| `MageMathCore.ts` | Canonical Mage math algorithm (`preComputeTriggers`, `evaluateExits`). |
| `SageMathCore.ts` | Canonical Sage math algorithm (`preComputeTriggers`, `evaluateExits`, `getActionCandle`). |
| `MathCoreUtils.ts` | Shared math helpers: `roundPrice()`, `buildM1TypedArrays()`. |

#### `/server/trading/backtester/stubs/`

| File | Mirrors |
|------|---------|
| `MockBrokerAccount.ts` | `metaApiHandler.ts` — Simulates order book, fills, SL/TP execution. |
| `crypto.stub.ts` | `server/core/crypto.ts` — Implements `isEncrypted`, `decrypt`, `getShortHash`. |
| `db.stub.ts` | `server/core/db.ts` — Mocks DB with complete `trading_profiles` columns (`dwcb_enabled`, `dwcb_peak_balance`). |
| `globalTradeGate.stub.ts` | `server/utils/GlobalTradeGate.ts` |
| `metaApiHandler.stub.ts` | `server/trading/broker/metaApiHandler.ts` — Intercepts broker calls, cleans options. |
| `metaApiQueue.stub.ts` | `server/utils/MetaApiQueue.ts` |
| `newsStore.stub.ts` | `server/news/newsStore.ts` |
| `socket.stub.ts` | `server/core/socket.ts` |

---

### `/server/trading/optimizer/` — Alpha Generation Pipeline (Tier 1-A)

#### `/server/trading/optimizer/core/`
`ChromosomeMapper.ts`, `HybridGeneticOptimizer.ts`, `WalkForwardEngine.ts`, `GpuFitnessBridge.ts`, `gpu_evaluator.py`, `gpu_setup_check.py`, `gpu_parity_test.ts`, `test_all_gpu_parity.ts`.

#### `/server/trading/optimizer/mage/` & `/sage/` & `/seer/`
`mage_optimizer.ts`, `mage_synthesizer.ts`, `sage_optimizer.ts`, `sage_synthesizer.ts`, `seer_cluster_optimizer.ts`, `seer_synthesizer.ts`.

#### `/server/trading/optimizer/grandmaster/`
`grandmaster_synthesizer.ts`, `GrandmasterGA.ts`, `GrandmasterMetrics.ts`, `GrandmasterPreProcessor.ts`, `grandmaster_cpcv.ts`, `grandmaster_plwfo.ts`, `inject_grandmaster.ts`, `test_grandmaster_parity.ts`.

#### `/server/trading/optimizer/pipelines/`
`master_pipeline.ts` — End-to-end optimization runner.

---

### `/server/trading/testing/` — Verification Suite

| File | Role |
|------|------|
| `parity/core_parity_engine.ts` | Compares MathBacktester (Tier 1) vs ShadowBacktester (Tier 2) outputs. |
| `parity/test_all_parity.ts` | Full suite pre-commit parity gate. |
| `parity/quick_parity.ts` | 3-month fast parity check. |
| `parity/print_discrepancies.ts` | Detailed trade diff reporter. |
| `parity/run_last_6mo.ts` | 6-month parity check. |
| `monthly_backtest.ts` | Monthly portfolio performance simulation. |

**NPM Scripts:**
```bash
npm run test:parity        # Full parity check across all pairs/bots
npm run test:parity:quick  # Fast 3-month parity check
npm run test:parity:6mo    # 6-month parity check
npm run optimize:all       # Run end-to-end optimization pipeline
```

---

## 🧹 Codebase Hygiene & Cleanup Log (July 2026 Audit)

The following stale directories and scratch files were permanently removed from the repository to maintain a pristine workspace:
- **Directories Deleted**: `/server/scratch/`, `/scratch/`, `/vision_backtest_results/`, `/scripts/` (relocated operational tools to `server/trading/testing/` and `server/utils/`), and all `.agents/` scratch subdirectories (150+ folders of old evaluation reports).
- **Optimizer Dumps**: Retained `mage_optimizer_dump/` and `sage_optimizer_dump/` per user directive.
- **Files Deleted**: 47+ root-level files including stale `.txt` data dumps (`10pct_modes.txt`, `5pct_modes.txt`, `xauusd*.txt`, `parity*.txt`), root compilation lists (`all_ts_files.txt`, `source_files.txt`), debug logs (`debug_parity.txt`, `parity_debug*.log`), scratch scripts (`scratch_*.ts`, `test_math*.ts`), obsolete utilities (`check_syntax.py`, `2026_monthly_backtest_results.json`), and stale backups (`PairConfig.ts.bak`).

---

## 🛡️ Core Engineering Policies

### 1. The No Duct Tape Rule
Never use `as any`, `@ts-ignore`, or `@ts-nocheck` inside `server/trading/`. Fix root interface types in `types.ts`.

### 2. The Air-Gap Rule
`server/trading/engine/` → **MUST NEVER** import from `backtester/` or `stubs/`.

### 3. Daily Drawdown Circuit Breaker (DWCB) Peak Balance Safety
- `DwcbCalculator.ts` is the single source of truth for updating `dwcb_peak_balance` in the database.
- Live equity is continuously updated in `LiveOrchestrator.cachedEquity` via `TickFeed.onAccountInformationUpdated`.
- If `orch.cachedEquity === 0` at trade time in live mode, the trade is **aborted** to prevent defaulting to 100,000 and corrupting the database peak balance.

### 4. Per-Profile Queue & Gate Isolation
- `MetaApiQueue.ts` isolates rate limits per profile using `Map<profileId, ProfileQueueState>`.
- `GlobalTradeGate.ts` isolates trade counts per profile using `Map<profileId, Map<string, ActiveEntry>>`.

---

## 🔒 Key Decision Log

- **DST/Timezone**: All session hours use `America/New_York` via `Intl` API (EST/EDT). Broker server time is converted on ingestion.
- **Sage `actionMinutes`**: Defines the sweep detection candle timeframe (5, 10, 15, or 30 min), NOT the observation window. The session sweep window is always 4 hours.
- **Pending Order Recovery**: `LiveOrchestrator.ts` re-attaches pending orders on boot using 12-char MD5 short hash lookup maps (`sigMap`).
- **Seer Math-Only Mode**: Seer's Gemini Vision API is bypassed to auto-approve math-derived setups with 100% confidence, accumulating 6 months of live OOS data before visual mode evaluation.
- **ATR-Relative OR Filter**: Mage breakout triggers skip setups where the OR-to-ATR(14) ratio is < 0.35 (noise OR) or > 1.5 (exhausted OR).
- **Wick-to-Body Ratio (WBR)**: Sage reversal triggers enforce a minimum Wick-to-Body ratio of 1.5 (`wickPips / bodyPips >= 1.5`) on rejection candles.
- **Half-Kelly Dynamic Sizing**: `KellyCalculator.ts` dynamically scales per-trade risk (clamped between 0.25x and 1.5x) based on the rolling 30-trade win rate and R-ratio.
- **Drawdown Velocity Soft Halt**: `DwcbCalculator.ts` applies a 0.5x risk multiplier if profile drawdown exceeds 5% in a short period to prevent rapid equity decay.
