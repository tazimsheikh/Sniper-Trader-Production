import {
  TradingBot, BotConfig, BotContext, BotSignal, BotTradeState, TradeAction
} from './BotInterface.js';

export class GBPJPYNyFadeBot extends TradingBot {
  config: BotConfig = {
    id: 'gbpjpy-ny-fade',
    name: 'GBPJPY Ny Fade',
    tagline: 'High-Probability Fade',
    description: 'Fades the New York session drift on GBPJPY. Executes at 15:30 UTC (-10m latency offset). Uses 240 EMA trend fade with 45 pip TP / 20 pip SL.',
    symbols: ['GBPJPY'],
    riskPct: 5,
    strategyType: 'REVERSAL',
    color: 'slate',
    icon: '⚡',
    winRateBacktest: 56.8,
    returnBacktest: '+14.5M% / 5yr',
    maxDDBacktest: 28.5,
  };

  private htfEma: number = 0;
  private readonly EMA_PERIOD = 240;

  async generateSignal(context: BotContext): Promise<BotSignal> {
    const { currentPrice, brokerSymbol, now } = context;

    if (brokerSymbol !== 'GBPJPY') return { shouldTrade: false };

    if (this.htfEma === 0) {
      this.htfEma = currentPrice;
    } else {
      const alpha = 2 / (this.EMA_PERIOD + 1);
      this.htfEma = currentPrice * alpha + this.htfEma * (1 - alpha);
    }

    if (now.getUTCHours() === 15 && now.getUTCMinutes() === 20) {
      const direction = currentPrice > this.htfEma ? 'SELL' : 'BUY';
      console.log(`[GBPJPY-Fade] Triggered at ${currentPrice}. EMA is ${this.htfEma.toFixed(3)}. Fading: ${direction}.`);
      
      return {
        shouldTrade: true,
        direction,
        suggestedSlPips: 20,
        suggestedTpPips: 45,
        reason: 'SESSION_OPEN_FADE',
      };
    }

    return { shouldTrade: false };
  }

  async manageTrade(trade: BotTradeState, context: BotContext): Promise<TradeAction> {
    const { currentPrice } = context;
    const PIP_SIZE = 0.01;

    const currentProfitPips = trade.direction === 'BUY'
      ? (currentPrice - trade.entryPrice) / PIP_SIZE
      : (trade.entryPrice - currentPrice) / PIP_SIZE;

    if (currentProfitPips >= 45) return { action: 'CLOSE', reason: 'TP_HIT' };
    if (currentProfitPips <= -20) return { action: 'CLOSE', reason: 'SL_HIT' };

    return { action: 'HOLD' };
  }
}

export default new GBPJPYNyFadeBot();
