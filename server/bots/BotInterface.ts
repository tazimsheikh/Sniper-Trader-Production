// ────────────────────────────────────────────────────────────────────────────
// Bot Interface — Every trading bot must implement this contract.
// The BotManager iterates over registered bots and calls tick() every cycle.
// ────────────────────────────────────────────────────────────────────────────

export type BotId = string;

export interface BotConfig {
  id: BotId;
  name: string;
  tagline: string;
  description: string;
  symbols: string[];           // Broker symbol(s) this bot exclusively trades (e.g. ['XAUUSD'])
  riskPct: number;             // Base risk % per trade (e.g. 5 = 5%)
  strategyType: 'TREND_FOLLOW' | 'REVERSAL' | 'BREAKOUT' | 'SCALP';
  tier?: 'Scout' | 'Prop' | 'Institutional' | 'Apex'; // New tier system for future monetization
  color: string;               // UI accent color class
  icon: string;                // Emoji icon for the bot card
  winRateBacktest: number;     // From backtesting (shown in UI)
  returnBacktest: string;      // String like "+9,073% / 2yr"
  maxDDBacktest: number;       // Max drawdown % from backtesting
  thumbnailUrl?: string;       // Path to the custom generated thumbnail
}

export interface BotTradeState {
  botId: BotId;
  userId: number;
  profileId: number;
  brokerSymbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  lots: number;
  openTime: number;           // Unix ms
  metaOrderId?: string;       // ID returned by MetaAPI after placing order
  t1Hit: boolean;             // Partial close target hit
  highestPrice: number;       // For trailing stop calculation
  lowestPrice: number;
  pyramidCount?: number;      // How many times this trade has pyramided
}

export interface BotSignal {
  shouldTrade: boolean;
  direction?: 'BUY' | 'SELL';
  brokerSymbol?: string;
  suggestedSlPips?: number;
  suggestedTpPips?: number;
  reason?: string;
}

// Each bot implements this class
export abstract class TradingBot {
  abstract config: BotConfig;

  // Called every polling cycle with market context.
  // Returns a BotSignal if the bot wants to open a new trade.
  abstract generateSignal(context: BotContext): Promise<BotSignal>;

  // Called each cycle for trade management (trailing stops, partial closes).
  // Returns updated state (or null if trade should be closed).
  abstract manageTrade(state: BotTradeState, context: BotContext): Promise<TradeAction>;
}

export interface BotContext {
  currentPrice: number;
  bid: number;
  ask: number;
  spread: number;             // In pips
  brokerSymbol: string;
  now: Date;
  // Rolling candle history (last 14 daily candles)
  recentDailyCandles: { open: number; high: number; low: number; close: number; date: string }[];
  last15MSwingHigh?: number;
  last15MSwingLow?: number;
}

export type TradeAction =
  | { action: 'HOLD' }
  | { action: 'CLOSE'; reason: string }
  | { action: 'MODIFY_SL'; newSlPrice: number }
  | { action: 'PARTIAL_CLOSE'; closePercent: number; newSlPrice: number }
  | { action: 'PYRAMID'; newSlPrice: number };
