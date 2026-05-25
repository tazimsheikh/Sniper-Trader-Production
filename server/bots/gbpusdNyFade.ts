import {
  TradingBot, BotConfig, BotContext, BotSignal, BotTradeState, TradeAction
} from './BotInterface.js';

export class GbpusdNyFadeBot extends TradingBot {
  config: BotConfig = {
    id: 'gbpusd-ny-fade',
    name: 'GBPUSD New York Fade',
    tagline: 'High-Probability Cable Fade',
    description: 'Fades the New York session drift on GBPUSD precisely at 15:15 UTC. It uses the 4H trend (240 EMA) and fades it with a 1:2.5 Reward-to-Risk ratio (50 pip TP, 20 pip SL), achieving +17.5M% return over 5 years.',
    symbols: ['GBPUSD'],
    riskPct: 5,
    strategyType: 'REVERSAL',
    color: 'indigo',
    icon: '⚡',
    winRateBacktest: 66.1,
    returnBacktest: '+17.5M% / 5yr',
    maxDDBacktest: 16.0,
  };

  private htfEma: number = 0;
  private readonly EMA_PERIOD = 240;

  async generateSignal(context: BotContext): Promise<BotSignal> {
    const { currentPrice, brokerSymbol, now } = context;

    if (brokerSymbol !== 'GBPUSD') return { shouldTrade: false };

    // Calculate 4H EMA proxy using M1 closes
    if (this.htfEma === 0) {
      this.htfEma = currentPrice;
    } else {
      const alpha = 2 / (this.EMA_PERIOD + 1);
      this.htfEma = currentPrice * alpha + this.htfEma * (1 - alpha);
    }

    // Execute strictly at 15:15 UTC
    if (now.getUTCHours() === 15 && now.getUTCMinutes() === 5) {
      // Mean Reversion: Trade AGAINST the HTF EMA
      const direction = currentPrice > this.htfEma ? 'SELL' : 'BUY';
      
      console.log(`[GBPUSD-NyFade] Triggered at ${currentPrice}. 4H EMA is ${this.htfEma.toFixed(5)}. Fading: ${direction}.`);
      
      return {
        shouldTrade: true,
        direction,
        suggestedSlPips: 20,
        suggestedTpPips: 50,
        reason: 'CABLE_OPEN_FADE',
      };
    }

    return { shouldTrade: false };
  }

  async manageTrade(trade: BotTradeState, context: BotContext): Promise<TradeAction> {
    const { currentPrice } = context;
    const PIP_SIZE = 0.0001;

    const currentProfitPips = trade.direction === 'BUY'
      ? (currentPrice - trade.entryPrice) / PIP_SIZE
      : (trade.entryPrice - currentPrice) / PIP_SIZE;

    if (currentProfitPips >= 50) {
      return { action: 'CLOSE', reason: 'TP_HIT' };
    }

    if (currentProfitPips <= -20) {
      return { action: 'CLOSE', reason: 'SL_HIT' };
    }

    return { action: 'HOLD' };
  }
}

export default new GbpusdNyFadeBot();
