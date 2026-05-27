import {
  TradingBot, BotConfig, BotContext, BotSignal, BotTradeState, TradeAction
} from './BotInterface.js';
import fs from 'fs';
import path from 'path';

// Optimal configurations discovered by the global scanner
const OPTIMAL_CONFIGS: Record<string, any> = {
  "GBPJPY": { "hr": 14, "min": 30, "reverse": true, "sl": 30, "tp": 60, "ema": 100, "breakeven": true, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "XAUUSD": { "hr": 9, "min": 0, "reverse": true, "sl": 200, "tp": 600, "ema": 240, "breakeven": true, "manualCloseHrs": 4, "confirmation": "engulfing" },
  "GBPUSD": { "hr": 7, "min": 30, "reverse": false, "sl": 25, "tp": 50, "ema": 50, "breakeven": false, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "GBPCHF": { "hr": 7, "min": 30, "reverse": true, "sl": 20, "tp": 60, "ema": 50, "breakeven": false, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "GBPAUD": { "hr": 14, "min": 30, "reverse": true, "sl": 20, "tp": 30, "ema": 50, "breakeven": true, "manualCloseHrs": 4, "confirmation": "engulfing" },
  "AUDJPY": { "hr": 13, "min": 0, "reverse": false, "sl": 40, "tp": 80, "ema": 240, "breakeven": true, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "USDJPY": { "hr": 13, "min": 0, "reverse": false, "sl": 25, "tp": 37.5, "ema": 240, "breakeven": true, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "USDCHF": { "hr": 13, "min": 0, "reverse": true, "sl": 25, "tp": 37.5, "ema": 50, "breakeven": true, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "EURJPY": { "hr": 9, "min": 30, "reverse": true, "sl": 30, "tp": 30, "ema": 240, "breakeven": true, "manualCloseHrs": 4, "confirmation": "engulfing" },
  "AUDUSD": { "hr": 9, "min": 15, "reverse": false, "sl": 40, "tp": 40, "ema": 100, "breakeven": false, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "GBPCAD": { "hr": 13, "min": 30, "reverse": false, "sl": 30, "tp": 90, "ema": 50, "breakeven": true, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "EURAUD": { "hr": 8, "min": 0, "reverse": true, "sl": 30, "tp": 30, "ema": 100, "breakeven": true, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "NZDUSD": { "hr": 9, "min": 15, "reverse": false, "sl": 30, "tp": 90, "ema": 240, "breakeven": false, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "CHFJPY": { "hr": 13, "min": 30, "reverse": true, "sl": 30, "tp": 30, "ema": 50, "breakeven": false, "manualCloseHrs": 4, "confirmation": "engulfing" },
  "EURCHF": { "hr": 7, "min": 15, "reverse": false, "sl": 40, "tp": 40, "ema": 50, "breakeven": false, "manualCloseHrs": 4, "confirmation": "engulfing" },
  "EURCAD": { "hr": 9, "min": 45, "reverse": true, "sl": 25, "tp": 50, "ema": 240, "breakeven": false, "manualCloseHrs": 8, "confirmation": "engulfing" },
  "USDCAD": { "hr": 9, "min": 30, "reverse": true, "sl": 30, "tp": 60, "ema": 100, "breakeven": true, "manualCloseHrs": 8, "confirmation": "engulfing" }
};

export class SniperSystemAI extends TradingBot {
  config: BotConfig = {
    id: 'sniper-system-ai',
    name: 'Sniper System AI',
    tagline: 'Master Automated Trader',
    description: 'The master AI that handles all executing trades. It requires individual pairs to be switched on for authorization.',
    symbols: Object.keys(OPTIMAL_CONFIGS),
    riskPct: 5,
    strategyType: 'REVERSAL',
    color: 'emerald',
    icon: '🎯',
    winRateBacktest: 65,
    returnBacktest: '+120% / 1yr',
    maxDDBacktest: 15.0,
  };

  private htfEma: Record<string, number> = {};

  async generateSignal(context: BotContext): Promise<BotSignal> {
    // V5 System-Wide Integration:
    // The Bot no longer generates mathematically random signals.
    // Signal generation (M1 Engulfing, Session Extremes, 00/50 levels) is fully centralized in marketStore.ts
    // which then calls metaApiHandler to instantly execute dual trades.
    return { shouldTrade: false };
  }

  async manageTrade(trade: BotTradeState, context: BotContext): Promise<TradeAction> {
    const { currentPrice, brokerSymbol, now } = context;

    const isGold = brokerSymbol.includes('XAU');
    const isJpy = brokerSymbol.includes('JPY');
    const PIP_SIZE = isGold || isJpy ? 0.01 : 0.0001;

    const currentProfitPips = trade.direction === 'BUY'
      ? (currentPrice - trade.entryPrice) / PIP_SIZE
      : (trade.entryPrice - currentPrice) / PIP_SIZE;

    // 1. Time-Based Manual Bailout (1-Hour Limit)
    // If trade is floating in drawdown after 1 hour, exit to protect capital.
    const openTime = new Date(trade.openTime);
    const hrsOpen = (now.getTime() - openTime.getTime()) / (1000 * 60 * 60);
    if (hrsOpen >= 1.0 && currentProfitPips < 0) {
      return { action: 'CLOSE', reason: 'TIME_BAILOUT_1HR' };
    }

    // 2. Breakeven Trailing Stop (No Early Breakeven until +30 pips)
    if (currentProfitPips >= 30) {
      const isBuy = trade.direction === 'BUY';
      // Move SL to Break Even (Entry Price + a tiny spread buffer to ensure strict BE)
      const buffer = 2 * PIP_SIZE;
      const bePrice = isBuy ? (trade.entryPrice + buffer) : (trade.entryPrice - buffer);
      
      if (isBuy && trade.slPrice < trade.entryPrice) {
        return { action: 'MODIFY_SL', newSlPrice: bePrice };
      } else if (!isBuy && trade.slPrice > trade.entryPrice) {
        return { action: 'MODIFY_SL', newSlPrice: bePrice };
      }
    }

    // TP and Hard SL are handled automatically by MetaAPI server-side execution.
    // If the position still exists here, it means TP/SL hasn't been hit yet.

    return { action: 'HOLD' };
  }
}

export default new SniperSystemAI();
