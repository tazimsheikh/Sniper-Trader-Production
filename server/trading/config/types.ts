/**
 * Core Definitions & Types Registry
 *
 * This file serves as the absolute source of truth for the backend trading logic.
 * Do not scatter interface definitions or magic strings. Use this registry.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Trading Primitives
// ─────────────────────────────────────────────────────────────────────────────
export interface M1TypedArrays {
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  timestamp: Float64Array;
  estHour: Int32Array;
  minute: Int32Array;
  isEOD_standard: Uint8Array;
  isSessionReset: Uint8Array;
  isMidnightExpiry: Uint8Array;
  isNewsForceClose: Uint8Array;
  length: number;
}

export type TradeDirection = "BUY" | "SELL";
export type TraderType = "ALGO" | "DISC";

export interface ActiveEntry {
  pair: string;
  direction: TradeDirection;
  traderType: TraderType;
}

export interface SessionLeadTrade {
  direction: TradeDirection;
  timestamp: number;
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  botId: string;
  symbol: string;
  session: string;
  dateStr: string;
  sig: string;
  leadProfileId: number;
}

export type TradeOutcome = "TP" | "SL" | "EOD" | "EOD_CLOSE" | "SKIPPED" | "EXPIRED" | "NEWS_CLOSE" | null;
export type SessionFilter =
  | "ALL_DAY"
  | "ASIA"
  | "LONDON"
  | "LONDON_NY_OVERLAP"
  | "NY_Forex"
  | "NY_Indices";
export type Timeframe = 5 | 15 | 30 | 60 | 240;

export type SetupType =
  "FRD" | "FGD" | "DAY3_SHORT" | "DAY3_LONG" | "LHF_SHORT" | "LHF_LONG";

export interface ActiveTrade {
  dbId?: number;
  metaOrderId: string;
  clientId?: string;
  magic?: number;
  botId: string;
  direction: TradeDirection;
  entryPrice: number;
  intendedEntryPrice?: number;
  entrySlippage?: number;
  slPrice: number;
  originalSl?: number;
  tpPrice: number;
  head2_risk_pct?: number;
  head3_risk_pct?: number;
  base_risk_balance?: number;
  riskPips: number;
  highestPrice?: number;
  lowestPrice?: number;
  isTrailing?: boolean;
  volume?: number;
  hasTakenPartial?: boolean;
  unconfirmedSwingLow?: number | null;
  unconfirmedSwingHigh?: number | null;
  lastSwingHigh?: number | null;
  lastSwingLow?: number | null;
  openTime?: number;
  manuallyModified?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Data Types
// ─────────────────────────────────────────────────────────────────────────────
export interface SymbolSpec {
  pipSize: number;
  tickSize: number;
  pipValuePerLot: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  digits?: number;
}

export interface OHLCVTick {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // NOTE: Fixed from tickVolume in some files
  tickVolume?: number;
}

export interface AggregatedCandle extends OHLCVTick {
  dateStr: string;
  estHour: number;
  estMin?: number;
  isNY?: boolean;
  isLondon?: boolean;
  maxSpread?: number;
  m1StartIndex?: number; // Support for CandleAggregator logic
  m1Count?: number;
  isPartial?: boolean;
}

export interface M1Row {
  dateStr: string; // YYYY-MM-DD
  hour: number;
  minute: number;
  utcMonth: number;
  dow: number;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVol: number;
  spread: number;
  timestamp: number;
  estHour: number;
}

export interface M1Acc {
  periodMs: number; // Floor of current M1 period (UTC ms)
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
  ticks: number;
}

export interface StacyDailyCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  startTime: number;
  dateStr: string; // the calendar date the daily candle represents

  weeklyHigh: number;
  weeklyLow: number;

  asianHigh: number;
  asianLow: number;

  // Context state
  isFirstRedDay: boolean;
  isFirstGreenDay: boolean;
  isInsideDay: boolean;
  isPumpDay: boolean;
  isDumpDay: boolean;

  isDay2BreakoutLongs: boolean;
  isDay2BreakoutShorts: boolean;

  isDay3BreakoutLongs: boolean;
  isDay3BreakoutShorts: boolean;

  isTrendingLong: boolean;
  isTrendingShort: boolean;

  dayCount: 1 | 2 | 3;
}

export interface BollingerBands {
  upper: number;
  lower: number;
  middle: number; // SMA
  width: number; // (upper - lower) / middle
  stdDev: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Types
// ─────────────────────────────────────────────────────────────────────────────
export interface BasePhysicalConfig {
  tickSize: number;
  pipSize: number;
  spread: number;
  maxSpreadLimit?: number;
}

export interface PairConfig {
  pipSize?: number;
  tickSize?: number;
  risk?: number;
  spread?: number;
  actionMinutes?: number;
  minBodyPips?: number;
  maxBodyPips?: number;
  maxDailyRangePips?: number;
  minSlDist?: number;
  maxSlDist?: number;
  slAtrMultiplier?: number;
  tpAtrMultiplier?: number;
  trailingSlTrigger?: number;
  trailingSlStep?: number;
  forceCloseHours?: number;
  orbEnabled?: boolean;
  orbStartHour?: number;
  orbStartMin?: number;
  orbEndHour?: number;
  orbEndMin?: number;
  orbMinutes?: number;
  orbPullbackPct?: number;
  rangeFilterPct?: number;
  sweepPips?: number;
  maxSweepMultiplier?: number;
  requireCloseInside?: boolean;
  entryPenetrationPct?: number;
  reversalEnabled?: boolean;
  exitMode?: string;
  pinBarWickBodyRatio?: number;
  minEmaDistance?: number;
  maxEmaDistance?: number;
  minTpDist?: number;
  defaultTpDist?: number;
  maxTpDist?: number;
  session?: "NY_Forex" | "NY_Indices" | "london" | "asia" | "ny";
  sessions?: ("NY_Forex" | "NY_Indices" | "london" | "asia" | "ny")[];
  maxH1EmaSlope?: number;
  delayStartMinutes?: number;
  cutoffHour?: number;
  riskMultiplier?: number;
  signature?: string;
  riskPct?: number;
  activeBots?: string[];

  toxicHours?: number[];
  toxicDays?: (number | string)[];
  htfAlignmentRequired?: boolean;
  minWbr?: number;
  requireCloseLocationHalf?: boolean;
  useHtfSarFilter?: boolean;
  useAdtelTrailing?: boolean;
  adtelBeTrigger?: number;
  adtelBeLock?: number;
  adtelProfitLockTrigger?: number;
  adtelProfitLockLevel?: number;
  adtelProfitLockTrigger2?: number;
  adtelProfitLockLevel2?: number;
  adtelStep?: number;
  adtelEnabled?: boolean;
  slMode?: "midpoint" | "opposite_boundary" | "MIDPOINT" | "OPPOSITE_BOUNDARY" | "breakout_bar_low" | "BREAKOUT_BAR_LOW" | "box_30pct" | "BOX_30PCT" | string;
  minBodyRatio?: number;
  minCloseLoc?: number;
  requireCloseExtremity?: boolean;
  htfTrendFilter?: boolean;
  useHtfEma?: boolean;
  useHtfSar?: boolean;
  minAtrRatio?: number;
  maxAtrRatio?: number;
  maxWbr?: number;
  dummy?: boolean;
  comment?: string;
}

export interface MageConfig extends PairConfig {}
export interface SageConfig extends PairConfig {}
export interface SageOptimizerConfig extends PairConfig {}

export interface MathFilterConfig {
  blockedHours?: number[];
  blockedDaysOfWeek?: string[];
  blockedPairDays?: Array<{ pair: string; dayOfWeek: string }>;
  blockedPairSetups?: Array<{ pair: string; setupType: string }>;
  drawdownLimitPct?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimizer & Backtester Records
// ─────────────────────────────────────────────────────────────────────────────
export interface TriggerEvent {
  m5Index: number;
  m1Index: number;
  direction: "BUY" | "SELL" | "PENDING";
  orHigh: number;
  orLow: number;
  boxSize: number;
  cBodyPips: number;
  dateStr: string;
  tradingDayId: number;
  slBaseHigh?: number;
  slBaseLow?: number;
  actionCandleHigh?: number;
  actionCandleLow?: number;
  actionCandleOpen?: number;
  actionCandleClose?: number;
  sweepBuffer?: number;
  // Pre-baked metadata so evaluateExits never calls getActionCandle() in the hot path
  actionCandleTimestamp?: number;
  actionCandleEstHour?: number;
  actionCandleUtcDay?: number;
  actionCandleMonth?: number;
  orStartTimestamp?: number;
}

export interface TradeRecord {
  botId?: string;
  clientId?: string;
  openTime?: number;
  entryTimeMs?: number;
  exitTimeMs?: number;
  timestamp: number;
  date: string;
  pair: string;
  setupType: SetupType | string;
  sessionName: string;
  decision: "TRADE" | "NO_TRADE" | "BUY" | "SELL";
  confidence: number;
  setupQuality: number | string;
  reasoning: string;
  entry: number;
  intendedEntryPrice?: number;
  entrySlippage?: number;
  stopLoss: number;
  takeProfit: number;
  riskPips: number;
  outcome: TradeOutcome;
  pips: number | null;
  rMultiple?: number;
  mfePips?: number;
  exitTimestamp?: number;
  exitPrice?: number;
  hypotheticalOutcome?: string;
  hypotheticalPips?: number;
  orHigh?: number;
  orLow?: number;
  atrPips?: number;
  ema50?: number;
  ema200?: number;
  close?: number;
}

export interface BasicTrade {
  pair: string;
  setupType: string;
  timestamp: number; // UTC epoch ms
  pips?: number;
  riskPips?: number;
  outcome?: string;
}

export interface ShadowResult {
  pair: string;
  totalNetR: number;
  wins: number;
  losses: number;
  eod: number;
  winRate: number;
  maxDrawdown: number;
  tradeCount: number;
  tradeLog: any[]; // populated by mockAccount.tradeLog
  finalBalance?: number; // To support legacy wrappers
}

export interface ShadowOptions {
  enableMage?: boolean;
  enableSage?: boolean;
  enableSeer?: boolean;

  startingBalance?: number;
  riskPct?: number;
  activeBots?: string[];
}

export interface LiveBacktestOptions {
  botType: "SAGE" | "MAGE" | "SEER" | "BLACK_SWAN";
  initialBalance: number;
  riskPct: number;
  sessionPair: string;
  startDate: Date;
  endDate?: Date;
  csvPath: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulator Execution Types
// ─────────────────────────────────────────────────────────────────────────────
export interface SimPosition {
  botId?: string;
  id: string;
  symbol: string;
  type: "POSITION_TYPE_BUY" | "POSITION_TYPE_SELL";
  volume: number;
  openPrice: number;
  sl: number;
  originalSl?: number;
  tp: number;
  isStopOrder?: boolean;
  time: string;
  brokerComment?: string;
}

export interface PendingLimitOrder {
  id: string;
  symbol: string;
  type?: "ORDER_TYPE_BUY_LIMIT" | "ORDER_TYPE_SELL_LIMIT";
  direction?: "BUY" | "SELL";
  limitPrice?: number;
  volume: number;
  openPrice?: number;
  sl: number;
  tp: number;
  placedAt?: number;
  isStopOrder?: boolean; // Resolves mock broker errors
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Vision Evaluator Types
// ─────────────────────────────────────────────────────────────────────────────
export interface VisionDecision {
  decision: "TRADE" | "NO_TRADE" | "BUY" | "SELL";
  confidence: number;
  setupQuality: number | string;
  reasoning: string;
  direction?: "BUY" | "SELL";
  takeProfit?: number | null;
  stopLoss?: number | null;
  entry?: number | null;
  riskPips?: number | null;
  patternVisible?: boolean;
  rawResponse?: string;
}

export interface ChartRenderOptions {
  candles: AggregatedCandle[];
  emaValues: number[];
  prevDayHigh: number;
  prevDayLow: number;
  currentDayHigh: number;
  currentDayLow: number;
  setupType: "FRD" | "FGD" | string;
  pair: string;
  sessionName: string;
  sessionStartIdx: number;
  sessionEndIdx: number;
  drawTrapBox?: boolean;
  mainTitle?: string;
  timeframe?: string;
  chartType?: string;
  orbHigh?: number;
  orbLow?: number;
}

export interface VisionEvalContext {
  pair: string;
  setupType: string;
  sessionName: string;
  candleTimeEST: string;
  prevDayHigh: number;
  prevDayLow: number;
  currentDayHigh: number;
  currentDayLow: number;
  ema20Current: number;
  tickSize: number;
  currentPrice: number;
  dailyMacroBias: string;
  distanceToPdhPips: number;
  distanceToPdlPips: number;
  distanceToSessionHighPips: number;
  distanceToSessionLowPips: number;
  direction?: "BUY" | "SELL";
}

export interface MageEvalContext {
  pair: string;
  orHigh: number;
  orLow: number;
  direction: "BUY" | "SELL";
  limitPrice: number;
  slPrice: number;
  tpPrice: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesizer Types
// ─────────────────────────────────────────────────────────────────────────────
export interface OptimizationResults {
  setup: string;
  dailyNetR: Record<string, number>;
  trades: number;
  winRate: number;
  totalNetR: number;
}

export interface OptimizerState {
  completedPairs: string[];
  portfolioRecord: string[];
}

export interface GrandmasterPairing {
  pair: string;
  setup: string;
}

export interface MockTradeRecord {
  symbol: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  slPrice: number;
  outcome: "SL" | "EOD" | "TP";
  rMultiple: number;
  openTime: number;
  closeTime: number;
}

export interface SynthesizerTradeRecord {
  timestamp: number;
  rMultiple: number;
}

export interface GrandmasterOptimizerState {
  setup: string;
  tradeRecords?: SynthesizerTradeRecord[];
  dailyNetR: Record<string, number>;
  trades: number;
  winRate: number;
  totalNetR: number;
  profitFactor?: number;
  maxDd?: number;
  recentNetR?: number;
  /** Populated at runtime by GrandmasterPreProcessor for vectorized scoring */
  dailyRArray?: Float64Array;
}


export interface GrandmasterSynthesisPairing {
  symbol: string;
  mageSetup: string;
  sageSetup: string;

  combinedTrades: number;
  combinedTotalR: number;
  combinedMaxDrawdown: number;
  correlation: number;
  sharpeRatio: number;
  sortinoRatio: number;
  recoveryFactor: number;
  hedgeScore: number;
  monteCarloDrawdown99?: number;
  dailyReturns?: number[];
}

export interface SeerOptimizationResults {
  pair: string;
  baseline: {
    trades: number;
    wins: number;
    losses: number;
    netPips: number;
    winRate: number;
    maxDrawdown: number;
  };
  optimized: {
    trades: number;
    wins: number;
    losses: number;
    netPips: number;
    winRate: number;
    maxDrawdown: number;
    params: {
      minBodyPips: number;
      minWickBodyRatio: number;
    };
  };
}
export interface TrapSignal {
  id: string;
  symbol: string;
  direction: TradeDirection;
  pattern: string;
  triggerPrice: number;
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
  details?: string;
  levelType?: string;
  keyLevel?: number;
  grade?: number;
  timingGate?: string;
  timestamp?: string;
}
