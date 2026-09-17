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

## 🤖 The 3-Bot Framework

The system is divided into three **completely isolated** bots. Never intertwine their logic.

| Bot | Strategy | Vision? | Engine File |
|-----|----------|---------|-------------|
| **MAGE** | Open Range Breakout (ORB) | ❌ | `MageEngine.ts` |
| **SAGE** | Liquidity Sweep Reversals | ❌ | `SageEngine.ts` |
| **SEER** | Stacy Burke Liquidity Hunts + False Breakouts | ✅ | `SeerEngine.ts` |


---

## 🗂️ Complete Codebase File Map

> ⚠️ AUTO-GENERATED EXHAUSTIVE BLUEPRINT. EVERY FILE IS DOCUMENTED HERE.

### `/server/core/`

| File | Technical Role & Exports |
|------|--------------------------|
| `auth.ts` | Exports: const authRouter, interface AuthRequest, const authLimiter, const calendarLimiter, const tradeLimiter, const requireAuth |
| `candleDb.ts` | Exports: function loadCachedM5CandlesLocal, function saveM5CandlesToCacheLocal, function pruneOldM5CandlesLocal, default candleDb<br/>*Purpose: candleDb.ts     Local SQLite store for M5 candle cache.   This keeps bulk candle data OFF Supabase (cross-cloud, high latency)   and on the local VM d...* |
| `crypto.ts` | Exports: function encrypt, function decrypt, function isEncrypted, function getShortHash<br/>*Purpose: Encrypts a plaintext string using AES-256-GCM.   Returns a colon-delimited string: iv:authTag:ciphertext (all hex-encoded)....* |
| `db.ts` | Exports: default db |
| `email.ts` | Internal logic / Config<br/>*Purpose: Sends a 6-digit verification code (OTP) to the specified email address.   If SMTP environment variables are not configured, it will log the OTP direct...* |
| `settings.ts` | Exports: const settingsRouter |
| `socket.ts` | Exports: function startProfileBalanceInterval, function initSocket, function getIO, function broadcastTradeOpened, function broadcastTradeClosed, function broadcastEngineStatus, function broadcastNewsUpdate |

### `/server/manager/`

| File | Technical Role & Exports |
|------|--------------------------|
| `tradeManager.ts` | Exports: function deleteProfileTradeState |
| `tradeUtils.ts` | Exports: interface SafetyStatus, const safetyStatusMap, function deleteProfileBotInstances, const BOT_REGISTRY, const ALL_BOT_CONFIGS, interface SwingPoint, function detectSwingPoints<br/>*Purpose: Bill Williams 5-Bar Fractal Algorithm   A Swing Low is strictly lower than 2 candles left and right.   A Swing High is strictly higher than 2 candles ...* |

### `/server/news/`

| File | Technical Role & Exports |
|------|--------------------------|
| `newsFetcher.ts` | Internal logic / Config<br/>*Purpose: Fetches the economic calendar directly from Forex Factory using the   open-source forexfactory-scraper package. This bypasses the need for   any API k...* |
| `newsStore.ts` | Exports: interface CalendarEvent, function setCachedEventsForTesting, function getSyntheticCalendarFallback, function isNewsBlackout, function shouldForceCloseForNews, function getUpcomingNewsForPair<br/>*Purpose: Get the set of pairs that should be blocked for a given event.   Systemic events block ALL traded pairs.   Direct events block only pairs that contain...* |

### `/server/trading/ai/`

| File | Technical Role & Exports |
|------|--------------------------|
| `ChartRenderer.ts` | Exports: function renderChart, function getChartWindow<br/>*Purpose: Determine which candles to include in the chart.   Shows the last `windowBars` M5 candles ending at index `currentIdx`....* |
| `PromptVault.ts` | Exports: const PROMPT_OVERRIDES, const PAIR_WIDE_OVERRIDES, class PromptVault<br/>*Purpose: A registry of surgical prompt overrides for specific pairs and setups.   Structure: OVERRIDES[pair][setupType] = string...* |
| `StacyBurkePrompt.ts` | Exports: const STACY_BURKE_SYSTEM_PROMPT, function buildSystemPrompt, const buildChartAnalysisPrompt |
| `VisionEvaluator.ts` | Exports: class VisionEvaluator |

### `/server/trading/backtester/`

| File | Technical Role & Exports |
|------|--------------------------|
| `loadCsv.ts` | Exports: function clearCsvCache, function getLatestDate |
| `MageMathBacktester.ts` | Exports: function clearMageBacktestCache |
| `MageMathBacktesterExp.ts` | Internal logic / Config |
| `OrchestratorShadowBacktester.ts` | Internal logic / Config |
| `SageMathBacktester.ts` | Exports: function clearSageBacktestCache |
| `SeerMathBacktester.ts` | Exports: function clearSeerBacktestCache |
| `SeerVisionBacktester.ts` | Internal logic / Config |

### `/server/trading/backtester/math_core/`

| File | Technical Role & Exports |
|------|--------------------------|
| `MageMathCore.ts` | Exports: function preComputeTriggers, function evaluateExits |
| `MathCoreUtils.ts` | Exports: const PRICE_EPSILON, const gte, const lte, function getFixedEstDate, function buildM1TypedArrays |
| `SageMathCore.ts` | Exports: function getActionCandle, function preComputeTriggers, function evaluateExits |
| `SeerMathCore.ts` | Internal logic / Config |

### `/server/trading/backtester/stubs/`

| File | Technical Role & Exports |
|------|--------------------------|
| `crypto.stub.ts` | Exports: function isEncrypted, function decrypt, function getShortHash, default |
| `db.stub.ts` | Exports: function setSimulatedTime, function getSimulatedTime, function addBotLog, default db |
| `globalTradeGate.stub.ts` | Exports: const globalTradeGate, default |
| `metaApiHandler.stub.ts` | Exports: function getSharedConnection, function getSharedAccount, function getSymbolSpec, function safeDecryptAccountId, function getBrokerSymbol, function clearSharedConnection, function forceRebootMetaApi, function getFallbackPipValue... |
| `metaApiQueue.stub.ts` | Exports: default |
| `MockBrokerAccount.ts` | Exports: interface SimPosition, interface PendingLimitOrder, interface TradeRecord, class MockBrokerAccount<br/>*Purpose: Called before each M1 tick is fed to the orchestrator...* |
| `newsStore.stub.ts` | Exports: function isNewsBlackout, default |
| `PortfolioMockBrokerAccount.ts` | Exports: interface SimPosition, interface PendingLimitOrder, interface TradeRecord, class PortfolioMockBrokerAccount<br/>*Purpose: Called before each M1 tick is fed to the orchestrator...* |
| `socket.stub.ts` | Exports: function getIO, default |

### `/server/trading/broker/`

| File | Technical Role & Exports |
|------|--------------------------|
| `metaApiHandler.ts` | Exports: const BROKER_SYMBOL_MAP, function getFallbackPipValue, function getSymbolSpec, function roundPrice, function isBrokerPriceOrStopsError, function calculateStopsLevelSafePrices, function clearApiCacheForToken, function quantizeLots...<br/>*Purpose: Canonical price rounding utility — the SINGLE source of truth for all MetaApi price fields.     ALL price values sent to MetaApi (entry, SL, TP, tra...* |

### `/server/trading/config/`

| File | Technical Role & Exports |
|------|--------------------------|
| `OptimizerPairConfig.ts` | Exports: const OPTIMIZER_CONFIG, function getDynamicPipSize |
| `PairConfig.ts` | Exports: class PairConfigManager, const MAGE_PAIR_CONFIG, const SAGE_PAIR_CONFIG, const SEER_PAIR_CONFIG |
| `ShadowPortfolioConfig.ts` | Exports: const SHADOW_MAGE_CONFIG, const SHADOW_SAGE_CONFIG |
| `types.ts` | Exports: interface M1TypedArrays, type TradeDirection, type TraderType, interface ActiveEntry, interface SessionLeadTrade, type TradeOutcome, type SessionFilter, type Timeframe...<br/>*Purpose: Core Definitions & Types Registry     This file serves as the absolute source of truth for the backend trading logic.   Do not scatter interface de...* |

### `/server/trading/engine/`

| File | Technical Role & Exports |
|------|--------------------------|
| `LiveOrchestrator.ts` | Exports: function getFixedEstDate, const DISCRETIONARY_TRADER_PAIRS, function isConnectionError, function updateOrchestratorIndicators, class LiveOrchestrator<br/>*Purpose: ⚡ Sub-Millisecond Reactive In-Memory Lead Trade Broadcast to all peer orchestrators...* |
| `MageEngine.ts` | Internal logic / Config |
| `SageEngine.ts` | Internal logic / Config |
| `SeerEngine.ts` | Internal logic / Config |
| `TickFeed.ts` | Exports: class TickFeed<br/>*Purpose: Called on every price update (bid/ask tick).         We synthesise M1 bars from these ticks....* |

### `/server/trading/`

| File | Technical Role & Exports |
|------|--------------------------|
| `index.ts` | Internal logic / Config |

### `/server/trading/market/`

| File | Technical Role & Exports |
|------|--------------------------|
| `CandleAggregator.ts` | Exports: type Timeframe, function aggregateCandles, function buildTimeframeIndex<br/>*Purpose: Minutes per timeframe...* |
| `DailyContextTracker.ts` | Exports: class DailyContextTracker<br/>*Purpose: Tracks the "Stacy Burke Daily Context" by grouping M5 candles into Daily candles   that strictly roll over at 5 PM EST (17:00 EST)....* |
| `fetch_news_calendar.ts` | Exports: interface NewsCalendarCache<br/>*Purpose: 📰 Historical News Calendar Auto-Generator   Fetches and caches high-impact news event dates (NFP, CPI, FOMC)....* |
| `historicalNews.ts` | Exports: const NFP_DATES, const CPI_DATES, const FOMC_DATES, function isHistoricalNews, function isNewsForceClose |
| `HTFContextTracker.ts` | Exports: interface HTFPrecomputedData, class HTFContextTracker<br/>*Purpose: Helper to compute the H1 50 EMA and its steepness from an array of M5 candles.     Calculates the steepness (in pips per hour) of the 50 EMA over the...* |
| `Indicators.ts` | Exports: function computeEma, function buildEmaArray, function buildAtrArray, function buildRsiArray, function buildBollingerArray, function buildBbwPercentileArray, function buildVwapArray, function isVolumeSpike... |
| `KellyCalculator.ts` | Internal logic / Config<br/>*Purpose: Calculates the Half-Kelly multiplier based on the last 30 closed trades for a given bot/symbol.   Half-Kelly formula: f = (p  b - q) / b / 2   Where: ...* |
| `MathFilters.ts` | Exports: class MathFilterManager, function isTradeAllowed, function isRolloverCircuitBreaker, function isSeerRolloverHalt, function isEODSession, function isToxicDay, function getVolatilityRegimeMultiplier<br/>*Purpose: MathFilters.ts — Production Trade Filtering Utilities   Session-level math filters: rollover circuit breaker, EOD window,   toxic-day detection, and v...* |
| `SeerMathCore.ts` | Exports: function getDigitsForPair, function roundPrice, function evaluateStacyBurkeSetup |

### `/server/trading/optimizer/core/`

| File | Technical Role & Exports |
|------|--------------------------|
| `ChromosomeMapper.ts` | Exports: class ChromosomeMapper<br/>*Purpose: Generates a random chromosome (array of indices) matching the grid dimensions....* |
| `DumpScanner.ts` | Exports: function isLastOptimizationRunDir, function getAllOptimizationRunDirs, function getAllStateFiles, function getAllWfaFiles, function findStateFileForPair, function loadHistoricalAlphasForSymbol<br/>*Purpose: Checks whether a folder name corresponds to a historical optimization run folder.   Matches:    - last_optimization_run    - last_optimization_run 8_1...* |
| `HybridGeneticOptimizer.ts` | Exports: interface FitnessResult, interface GeneticOptimizerOptions, class HybridGeneticOptimizer<br/>*Purpose: Consecutive generations with <0.01% best-fitness improvement before early exit. Default: 15...* |
| `MonthlyConsistencyValidator.ts` | Exports: interface MonthlyValidationResult, function validateMonthlyConsistency, interface AnomalyValidationResult, function validateAnomalyConcentration<br/>*Purpose: ============================================================   MONTHLY CONSISTENCY & ANTI-ANOMALY VALIDATOR   ========================================...* |
| `WalkForwardEngine.ts` | Exports: interface WfaWindow, class WalkForwardEngine<br/>*Purpose: Generates rolling 6-month In-Sample and 2-month Out-Of-Sample windows.     Steps forward by 2 months....* |

### `/server/trading/optimizer/`

| File | Technical Role & Exports |
|------|--------------------------|
| `cull_dna_banks.ts` | Exports: interface EvaluatedAlpha, function parseMageConfig, function parseSageConfig, function getMageNiche, function getSageNiche, function curateMapElitesArchive<br/>*Purpose: Classifies a Mage setup into a MAP-Elites Behavioral Niche...* |
| `grandmaster_holy_grail_portfolios.json` | Internal logic / Config |

### `/server/trading/optimizer/grandmaster/`

| File | Technical Role & Exports |
|------|--------------------------|
| `correlation_pre_filter.ts` | Exports: interface AlphaItem, function extractCurrencies, function filterCorrelatedClusters<br/>*Purpose: 🔗 Correlation Pre-Filter   Groups trading pairs by currency cluster and caps cluster representation   before grandmaster synthesis to prevent correla...* |
| `generate_ist_schedule.ts` | Internal logic / Config |
| `generate_pdf_fast.cjs` | Internal logic / Config |
| `GrandmasterMetrics.ts` | Exports: function evaluateComponent, function evaluatePortfolio, function calculateDeflatedSharpeRatio<br/>*Purpose: Marcos López de Prado's Deflated Sharpe Ratio (DSR)   Calculates the probability that an observed Sharpe Ratio is true (not a false discovery / overf...* |
| `GrandmasterPreProcessor.ts` | Exports: function getRollingMonthKeys, function getMinAllowedSl, function parseSetupToConfig, function deduplicateConfigs, function isSessionValidForAsset, const PAIR_MIN_SL_FLOOR, function loadAuditCache, function flushAuditCache... |
| `grandmaster_cpcv.ts` | Exports: interface CPCVResult, function runCPCV |
| `grandmaster_plwfo.ts` | Exports: interface PLWFOWindow, interface PLWFOResult, function generateRollingWindows, function runPLWFO |
| `grandmaster_portfolio.json` | Internal logic / Config |
| `grandmaster_synthesizer.ts` | Internal logic / Config |
| `inject_grandmaster.ts` | Exports: function parseSetupString, const SAGE_PAIR_CONFIG, const MAGE_PAIR_CONFIG, const SEER_PAIR_CONFIG, const MAGE_PAIR_CONFIG, class PairConfigManager, const MAGE_PAIR_CONFIG, const SAGE_PAIR_CONFIG... |
| `inject_toxic_hours.ts` | Internal logic / Config |
| `monte_carlo_validator.ts` | Exports: interface MonteCarloResult, function validateMonteCarlo<br/>*Purpose: 🎲 Monte Carlo Robustness Validator   Resamples daily P&L streams with replacement (bootstrapping)   to evaluate portfolio drawdown distributions and ...* |

### `/server/trading/optimizer/grandmaster/utils/`

| File | Technical Role & Exports |
|------|--------------------------|
| `GrandmasterMath.ts` | Exports: function calculateCorrelation, function calculatePearsonCorrelation, function calculateDailyCalendarCorrelation, function rankPercentile, function hashStringToSeed, function createMulberry32, function runMonteCarlo, interface HedgingUnit...<br/>*Purpose: Calculates calendar-synchronized Pearson correlation between two daily returns maps.   Evaluates identical calendar dates across globalDates....* |
| `mage_params_parser.ts` | Exports: default function |
| `sage_params_parser.ts` | Exports: default function |
| `seer_params_parser.ts` | Exports: default function |

### `/server/trading/optimizer/mage/dna_bank/`

| File | Technical Role & Exports |
|------|--------------------------|
| `mage_dna_AUDJPY.json` | Internal logic / Config |
| `mage_dna_AUDUSD.json` | Internal logic / Config |
| `mage_dna_BTCUSD.Daily.json` | Internal logic / Config |
| `mage_dna_CADJPY.json` | Internal logic / Config |
| `mage_dna_CHFJPY.json` | Internal logic / Config |
| `mage_dna_ETHUSD.Daily.json` | Internal logic / Config |
| `mage_dna_EURAUD.json` | Internal logic / Config |
| `mage_dna_EURCAD.json` | Internal logic / Config |
| `mage_dna_EURJPY.json` | Internal logic / Config |
| `mage_dna_EURNZD.json` | Internal logic / Config |
| `mage_dna_EURUSD.json` | Internal logic / Config |
| `mage_dna_GBPAUD.json` | Internal logic / Config |
| `mage_dna_GBPCAD.json` | Internal logic / Config |
| `mage_dna_GBPJPY.json` | Internal logic / Config |
| `mage_dna_GBPNZD.json` | Internal logic / Config |
| `mage_dna_GBPUSD.json` | Internal logic / Config |
| `mage_dna_GER40.Daily.json` | Internal logic / Config |
| `mage_dna_JPN225.Daily.json` | Internal logic / Config |
| `mage_dna_NAS100.Daily.json` | Internal logic / Config |
| `mage_dna_NZDUSD.json` | Internal logic / Config |
| `mage_dna_SPX500.Daily.json` | Internal logic / Config |
| `mage_dna_US30.Daily.json` | Internal logic / Config |
| `mage_dna_USDCAD.json` | Internal logic / Config |
| `mage_dna_USDCHF.json` | Internal logic / Config |
| `mage_dna_USDJPY.json` | Internal logic / Config |
| `mage_dna_XAUUSD.json` | Internal logic / Config |
| `mage_dna_XTIUSD.json` | Internal logic / Config |

### `/server/trading/optimizer/mage/`

| File | Technical Role & Exports |
|------|--------------------------|
| `mage_optimizer.ts` | Exports: function parseMageConfig |

### `/server/trading/optimizer/pipelines/`

| File | Technical Role & Exports |
|------|--------------------------|
| `master_pipeline.ts` | Internal logic / Config |
| `update_historical_news.ts` | Exports: const NFP_DATES, const CPI_DATES, const FOMC_DATES, const NFP_DATES, const CPI_DATES, const FOMC_DATES, function isHistoricalNews, function isNewsForceClose |

### `/server/trading/optimizer/sage/dna_bank/`

| File | Technical Role & Exports |
|------|--------------------------|
| `sage_dna_AUDJPY.json` | Internal logic / Config |
| `sage_dna_AUDUSD.json` | Internal logic / Config |
| `sage_dna_BTCUSD.Daily.json` | Internal logic / Config |
| `sage_dna_CADJPY.json` | Internal logic / Config |
| `sage_dna_CHFJPY.json` | Internal logic / Config |
| `sage_dna_ETHUSD.Daily.json` | Internal logic / Config |
| `sage_dna_EURAUD.json` | Internal logic / Config |
| `sage_dna_EURCAD.json` | Internal logic / Config |
| `sage_dna_EURJPY.json` | Internal logic / Config |
| `sage_dna_EURNZD.json` | Internal logic / Config |
| `sage_dna_EURUSD.json` | Internal logic / Config |
| `sage_dna_GBPAUD.json` | Internal logic / Config |
| `sage_dna_GBPCAD.json` | Internal logic / Config |
| `sage_dna_GBPJPY.json` | Internal logic / Config |
| `sage_dna_GBPNZD.json` | Internal logic / Config |
| `sage_dna_GBPUSD.json` | Internal logic / Config |
| `sage_dna_GER40.Daily.json` | Internal logic / Config |
| `sage_dna_JPN225.Daily.json` | Internal logic / Config |
| `sage_dna_NAS100.Daily.json` | Internal logic / Config |
| `sage_dna_NZDUSD.json` | Internal logic / Config |
| `sage_dna_SPX500.Daily.json` | Internal logic / Config |
| `sage_dna_US30.Daily.json` | Internal logic / Config |
| `sage_dna_USDCAD.json` | Internal logic / Config |
| `sage_dna_USDCHF.json` | Internal logic / Config |
| `sage_dna_USDJPY.json` | Internal logic / Config |
| `sage_dna_XAUUSD.json` | Internal logic / Config |
| `sage_dna_XTIUSD.json` | Internal logic / Config |

### `/server/trading/optimizer/sage/`

| File | Technical Role & Exports |
|------|--------------------------|
| `sage_optimizer.ts` | Exports: function parseSageConfig |

### `/server/trading/optimizer/seer/`

| File | Technical Role & Exports |
|------|--------------------------|
| `inject_seer_grandmaster.ts` | Exports: const SEER_PAIR_CONFIG, const SEER_PAIR_CONFIG |
| `inject_seer_toxic_hours.ts` | Internal logic / Config |
| `seer_grandmaster_portfolio.json` | Internal logic / Config |
| `seer_optimizer.ts` | Exports: function parseSeerConfig |
| `seer_pre_processor.ts` | Exports: function getRollingMonthKeys, function extractSeerSetupSignature, function deduplicateConfigs |

### `/server/trading/testing/`

| File | Technical Role & Exports |
|------|--------------------------|
| `analyze_portfolio_losses.ts` | Internal logic / Config |
| `analyze_portfolio_losses_shadow.ts` | Internal logic / Config |
| `portfolio_shadow_engine.ts` | Internal logic / Config |
| `run_seer_math_audit.ts` | Internal logic / Config |
| `simulate_portfolio_risk_math.ts` | Internal logic / Config |
| `simulate_portfolio_risk_shadow.ts` | Internal logic / Config |
| `test_all_pairs_parity.ts` | Internal logic / Config |
| `test_live_vs_shadow_execution.ts` | Internal logic / Config |
| `test_portfolio_parity_comparison.ts` | Internal logic / Config |
| `test_single_pair_parity.ts` | Internal logic / Config |

### `/server/utils/`

| File | Technical Role & Exports |
|------|--------------------------|
| `BrokerMetricsEngine.ts` | Exports: interface BrokerMetrics, function calculateBrokerTradingDayStr, function getCachedBrokerMetrics |
| `discoverSymbols.ts` | Internal logic / Config |
| `DwcbCalculator.ts` | Exports: interface DwcbResult<br/>*Purpose: Calculates the Daily Drawdown Circuit Breaker (DWCB) multiplier based on profile settings and current balance.   Updates the peak balance in the datab...* |
| `ensureMetaApiReliability.ts` | Internal logic / Config<br/>*Purpose: Calls POST /users/current/accounts/:accountId/increase-reliability   for a single account. Returns true if successful....* |
| `GlobalTradeGate.ts` | Exports: const MAX_CONCURRENT_TRADES, const globalTradeGate<br/>*Purpose: Called by DiscretionaryTrader when it starts evaluating a pair (AI call in-flight)...* |
| `logger.ts` | Exports: const profileContext, function registerProfileName, function getProfileLabel, class ProfileLogger, const logger, function hijackConsole |
| `magicNumber.ts` | Exports: function generateMagicNumber, function isMageMagic, function isSageMagic, function isSeerMagic<br/>*Purpose: Generates a determinisitc 32-bit integer magic number from a string signature.   Uses FNV-1a hash algorithm to ensure the same signature always maps t...* |
| `MetaApiQueue.ts` | Internal logic / Config<br/>*Purpose: Enqueues an async task for MetaAPI execution with full resilience.   - Concurrent limiting (max 2 active per profile)   - Exponential backoff retries ...* |
| `PropFirmRiskMonitor.ts` | Exports: class PropFirmRiskMonitor, const propFirmRiskMonitor |
| `trade_cleanup.ts` | Internal logic / Config |
| `VisionApiQueue.ts` | Internal logic / Config<br/>*Purpose: Acquire a concurrency slot. Callers block here until a slot is free....* |

### `/src/`

| File | Technical Role & Exports |
|------|--------------------------|
| `App.tsx` | Exports: const MAGE_BOT, const SEER_BOT, const SAGE_BOT, default function |
| `main.tsx` | Internal logic / Config |
| `types.ts` | Exports: type TradeDirection, type TradeOutcome, type SessionFilter, type Timeframe, type SetupType, interface SymbolSpec, interface OHLCVTick, interface AggregatedCandle...<br/>*Purpose: Core Definitions & Types Registry      This file serves as the absolute source of truth for the backend trading logic.   Do not scatter interface defi...* |

### `/src/components/`

| File | Technical Role & Exports |
|------|--------------------------|
| `BotDashboard.tsx` | Exports: default function |
| `ErrorBoundary.tsx` | Exports: default class |
| `GlobalSettings.tsx` | Exports: default function |
| `LoginScreen.tsx` | Exports: default function |
| `TradeAnalytics.tsx` | Exports: default React |

### `/src/context/`

| File | Technical Role & Exports |
|------|--------------------------|
| `WebSocketContext.tsx` | Exports: const useWebSocket, const WebSocketProvider |

### `/src/hooks/`

| File | Technical Role & Exports |
|------|--------------------------|
| `useEconomicNews.tsx` | Exports: interface NewsEvent, function useEconomicNews |
| `useSound.ts` | Exports: function useSound |

### `/src/utils/`

| File | Technical Role & Exports |
|------|--------------------------|
| `timezone.ts` | Exports: const TZ_MAP, function getIanaTz, function formatDateTime, function formatTime, function formatDate, function getTzLabel, function getBrokerTradingDayStr<br/>*Purpose: ============================================================   TIMEZONE UTILITY — Central timestamp formatter   ======================================...* |

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
  ├── Population: 100 chromosomes (12% smart-seeded from archetypes)
  ├── 40 Generations (stagnation exit after 15 gens of <0.01% improvement)
  ├── Fitness = Calmar Ratio × Trade Significance × Win Rate Floor × Consistency
  ├── Adaptive hyper-mutation (50%) when top-3 elites converge
  └── Top 3 unique solutions refined via local exhaustive grid search

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

Step 7: GRANDMASTER SYNTHESIS (Deterministic Clustered Risk Parity)
  grandmaster_synthesizer.ts reads all state_*.json from both Mage + Sage dumps
  ├── OOS slice stitching (merges multi-window results per setup)
  ├── Deduplication (max 3 configs per signature group)
  ├── 3-Year CSV Audit (re-backtests every candidate on 3 years of data)
  │   └── Rejects: NetR ≤ 0, trades < 20, WR < 22%, regime consistency < 50%
  ├── Calendar Year Guard: rejects any setup losing money in ANY calendar year
  ├── Deflated Sharpe Ratio (DSR) — penalizes multiple-testing selection bias
  ├── Monte Carlo 99% Drawdown simulation (10,000 paths)
  └── Hierarchical Risk Parity de-correlation clustering

Step 8: CPCV HARD GATE (Combinatorial Purged Cross-Validation)
  grandmaster_cpcv.ts validates the final portfolio:
  ├── 6 rolling windows (IS=560 days, OOS=140 days)
  ├── All C(6,2)=15 combinatorial paths evaluated
  ├── 5-day embargo buffer prevents autocorrelation leakage
  ├── Pass criteria: ≥10/15 paths profitable + Max DD < 12.0R
  └── If CPCV FAILS → portfolio JSON is NOT written. Pipeline aborts.
  Outputs: grandmaster_holy_grail_portfolios.json

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
   Stop Loss (SL) determined by slMode:
     - OPPOSITE_BOUNDARY (default): orLow - spread (below opposite boundary)
     - MIDPOINT: (orHigh + orLow) / 2 (cuts risk distance by 50% for high-volatility pairs like GBPJPY, XAUUSD, GER40)
     - BREAKOUT_BAR_LOW: actionCandle.low - 2 pips
     - BOX_30PCT: orHigh - 0.30 * boxSize
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
- SL placed according to `slMode`:
  - OPPOSITE_BOUNDARY: above `orHigh + spread`
  - MIDPOINT: `(orHigh + orLow) / 2 + spread`
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

   [DOUBLE-SWEEP SUB-TICK RESOLUTION]
     If BOTH High and Low are swept during the action window:
     Inspect sub-tick M1 arrival sequence:
     - If High swept first, Low swept last → fade final low sweep → BUY
     - If Low swept first, High swept last → fade final high sweep → SELL
     - If sequence indeterminate → skip per Parity Rule.

   [CONFIRM: REQUIRE CLOSE INSIDE]
     If requireCloseInside is true:
       actionCandle.close > orLow   ← Price MUST close strictly back inside range
       (If it stays below = trend breakout, not a sweep. Reject.)
   
   [FILTER: CLOSE LOCATION HALF]
     If requireCloseLocationHalf is true:
       (actionCandle.close - actionCandle.low) / (actionCandle.high - actionCandle.low) >= 0.50
       (Rejection candle must close in top half of its total range for BUY. Reject full-body dump candles.)

   [FILTER]  actionCandle.body <= maxBodyPips ← Not a massive trend candle
   [FILTER]  wickPips / bodyPips >= minWbr (default 1.5) ← Rejection wick confirmation
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
- Double-Sweep Resolution: If both swept, inspect M1 ticks $\rightarrow$ fade the final touch (Low first, High last $\rightarrow$ SELL).
- Confirm: `actionCandle.close < orHigh` (closes back inside range)
- Close Location Half: `(actionCandle.close - actionCandle.low) / (actionCandle.high - actionCandle.low) <= 0.50` (closes in bottom half)
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
Before merging any logic change: run `npx tsx server/trading/testing/test_single_pair_parity.ts <BOT> <PAIR>`. If `PARITY BROKEN` — stop, present findings, wait for user approval.

---

## 🔒 Key Decision Log (Session Memory)

- **DST/Timezone:** The entire system uses `America/New_York` locale via `Intl` API. All session hours are EST/EDT. MT5 server time is irrelevant — it is always converted.
- **MAGE Portfolio Forensics & Midpoint SL Polish (+216.76R):** Volatile instruments (`GBPJPY`, `XAUUSD`, `GER40`) suffered catastrophic losses when setting SL at opposite ORB boundaries during wide ranges. Added `slMode: "MIDPOINT"` to cut risk distance in half while preserving profit potential, lifting Mage portfolio net return to +216.76R with 0 parity divergence.
- **SAGE Double-Sweep Sub-Tick Resolution (+1.35R, 2.35 PF):** When both `orHigh` and `orLow` are swept during the action window, Sage does not discard the setup; it inspects the M1 tick arrival times and trades opposite the final swept boundary (High hit first, Low hit last → BUY; Low hit first, High hit last → SELL).
- **SAGE Portfolio Polish (+162.82R, +103.85R lift, 78.00R losses slashed):**
  - **USDCHF:** Set `requireCloseInside: true`, `requireCloseLocationHalf: true`, and `trailingSlTrigger: 0.5` (step 0.5) — turned USDCHF from -61.00R (PF 0.10) to +8.50R (PF 1.71), eliminating 56 losses (-56.0R capital saved).
  - **AUDJPY:** Expanded `minSlDist` to 30 pips and enforced `requireCloseLocationHalf: true` — lifted Net R to +30.00R (PF 1.58), cutting 9 catastrophic stopouts.
  - **USDCAD & EURNZD:** Tightened trailing stop triggers (1.0R / 0.5R step) and enforced `requireCloseLocationHalf: true`, boosting USDCAD to +11.50R (PF 1.82) and EURNZD to +32.00R (PF 2.23).
- **5-Layer Upstream Automation Synchronization:** All improvements are permanently wired into:
  1. `sage_optimizer.ts` / `mage_optimizer.ts` (bounded parameter grids and `liveStaticValues`)
  2. `cull_dna_banks.ts` (MAP-Elites 3-year survival evaluation with double sweep)
  3. `GrandmasterPreProcessor.ts` (`PAIR_MIN_SL_FLOOR`, `parseSetupToConfig`)
  4. `inject_grandmaster.ts` (Dynamic TypeScript code generation for `PairConfig.ts`)
  5. JSON Interchange stores (`grandmaster_portfolio.json`, `grandmaster_holy_grail_portfolios.json`, `grandmaster_holy_grail.md`).
- **Pending Order Recovery:** `LiveOrchestrator.ts` on server restart re-attaches pending orders using `PairConfigManager.getBaseSymbol(order.symbol)` and maps to `orbStates` (Mage) or `sageStates` (Sage). Never use client ID string parsing for symbol resolution.

---

## 📅 Optimizer Re-Run Schedule & Frequency

### The Rule: Bimonthly (Every 8 Weeks)

The optimizer should be re-run **every 2 months (bimonthly)**. This is not arbitrary — it is dictated by the WFA architecture:

- The WFA step size is **2 months**. A new Walk-Forward OOS window is only created when ≥2 months of new data accumulates.
- Running more frequently than bimonthly produces **zero new WFA windows** — the GA re-solves the identical problem with minor random seed noise, which can destabilize CPCV path pass/fail decisions.
- Running less frequently than quarterly risks deploying stale configs into shifted macro regimes.

### Concrete Schedule: September 2026 → August 2028

| # | Exact Date | Day | Macro Context Captured |
|:-:|:----------:|:---:|------------------------|
| 1 | **Sep 1, 2026** | Tue | Jul–Aug summer lull + Jackson Hole aftermath |
| 2 | **Nov 2, 2026** | Mon | Sep–Oct volatility spike + Q3 earnings |
| 3 | **Jan 4, 2027** | Mon | Nov–Dec holiday regime + year-end rebalancing |
| 4 | **Mar 1, 2027** | Mon | Jan–Feb new-year momentum + BOJ/ECB decisions |
| 5 | **May 3, 2027** | Mon | Mar–Apr earnings season + spring volatility |
| 6 | **Jul 1, 2027** | Thu | May–Jun pre-summer + FOMC dot plot |
| 7 | **Sep 1, 2027** | Wed | Jul–Aug summer lull + Jackson Hole aftermath |
| 8 | **Nov 1, 2027** | Mon | Sep–Oct volatility spike + Q3 earnings |
| 9 | **Jan 3, 2028** | Mon | Nov–Dec holiday regime + year-end rebalancing |
| 10 | **Mar 1, 2028** | Wed | Jan–Feb new-year momentum + BOJ/ECB decisions |
| 11 | **May 1, 2028** | Mon | Mar–Apr earnings season + spring volatility |
| 12 | **Jul 3, 2028** | Mon | May–Jun pre-summer + FOMC dot plot |

> **Tip:** Run the pipeline on a weekend (Saturday/Sunday) before the listed date so CSV data includes the full Friday close. The dates above are the *latest* acceptable run dates — running the prior weekend is ideal.

### Emergency Re-Run Triggers

Re-run immediately (outside the bimonthly schedule) if:
- A major central bank makes a surprise policy change (e.g., BOJ abandons YCC, Fed emergency cut)
- CPCV validation starts failing on the latest data
- More than 3 pairs simultaneously hit negative Net R in live trading over 2+ consecutive weeks
- A new pair is added to or removed from the trading universe

### Why NOT Weekly or Monthly?

| Frequency | New WFA Windows | Risk |
|-----------|:-:|---|
| Weekly | 0 | 🔴 GA seed noise destabilizes CPCV. Actively harmful. |
| Biweekly | 0 | 🟠 Same problem, slightly diluted. Wasteful compute. |
| Monthly | 0 | 🟡 Still below 1 WFA step. Suboptimal. |
| **Bimonthly** | **1** | 🟢 **Exactly 1 new OOS window. Optimal.** |
| Quarterly | 1+ | 🟢 Safe but risks being late to regime shifts. |
| Semi-Annual | 2–3 | 🟠 Too infrequent for live prop firm trading. |

### Pipeline Command
```bash
npx tsx server/trading/optimizer/pipelines/master_pipeline.ts
```
Total runtime: ~5–9 hours. The pipeline automatically: hydrates CSVs → culls old DNA banks → runs Mage optimizer → runs Sage optimizer → synthesizes Grandmaster portfolio → validates CPCV → injects into PairConfig.ts → generates PDF report.


## 👁️ Seer Engine (Vision Intelligence) Pipeline

The Seer bot is uniquely capable of analyzing visual structure using Gemini Vision AI.

1. **Setup Generation (Math Core):** `SeerMathCore.ts` pre-computes valid structural setups (e.g., Stacy Burke liquidity hunts).
2. **Chart Rendering:** `ChartRenderer.ts` generates a pixel-perfect HTML5 Canvas image of the M5/M1 structure.
3. **Prompt Vault Selection:** `PromptVault.ts` and `StacyBurkePrompt.ts` select the precise LLM instructions based on the market pattern.
4. **Vision Evaluation:** `VisionEvaluator.ts` dispatches the image + prompt to Gemini via `VisionApiQueue.ts`.
5. **Execution:** If Gemini responds with "APPROVE", `SeerEngine.ts` executes the trade immediately.

## 🖥️ Frontend Dashboard Architecture

The React Vite frontend (`/src/`) provides real-time visibility into the trading engines.

*   **State Management:** Real-time data streams via WebSockets (`WebSocketContext.tsx`).
*   **Routing & Auth:** `App.tsx` and `LoginScreen.tsx` control access.
*   **Key Views:**
    *   `BotDashboard.tsx`: Real-time tracking of Mage, Sage, and Seer bots. Displays equity curves, PnL, open trades, and system status (DWCB).
    *   `TradeAnalytics.tsx`: Post-trade historical analytics.
    *   `GlobalSettings.tsx`: Modifies system configurations, bot risk parameters, and toggles execution.
*   **Audio Alerts:** `useSound.ts` triggers auditory feedback on trade execution or circuit breaker hits.
*   **News Integration:** `useEconomicNews.tsx` tracks high-impact calendar events to visualize blackout periods on the UI.
