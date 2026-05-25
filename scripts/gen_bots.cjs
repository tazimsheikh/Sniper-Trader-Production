const fs = require('fs');

const data = [
  { pair: 'AUDJPY', name: 'AUDJPY Ny Fade', hr: 15, min: 30, sl: 20, tp: 50, ema: 240, ret: '18.8M%', wr: 75.0, dd: 14.3, desc: 'Fades the New York session drift on AUDJPY.' },
  { pair: 'CHFJPY', name: 'CHFJPY Ny Fade', hr: 13, min: 30, sl: 20, tp: 50, ema: 240, ret: '17.1M%', wr: 61.9, dd: 23.8, desc: 'Fades the New York session drift on CHFJPY.' },
  { pair: 'EURAUD', name: 'EURAUD Ny Fade', hr: 15, min: 30, sl: 20, tp: 50, ema: 240, ret: '19.0M%', wr: 65.4, dd: 22.5, desc: 'Fades the New York session drift on EURAUD.' },
  { pair: 'EURCAD', name: 'EURCAD Ny Fade', hr: 15, min: 15, sl: 20, tp: 50, ema: 240, ret: '19.0M%', wr: 67.3, dd: 24.2, desc: 'Fades the New York session drift on EURCAD.' },
  { pair: 'EURCHF', name: 'EURCHF London Fade', hr: 9, min: 0, sl: 20, tp: 50, ema: 240, ret: '17.9M%', wr: 79.7, dd: 9.7, desc: 'Fades the London session drift on EURCHF.' },
  { pair: 'EURJPY', name: 'EURJPY Ny Fade', hr: 15, min: 30, sl: 20, tp: 50, ema: 240, ret: '18.8M%', wr: 67.6, dd: 18.5, desc: 'Fades the New York session drift on EURJPY.' },
  { pair: 'GBPAUD', name: 'GBPAUD Ny Fade', hr: 14, min: 30, sl: 20, tp: 50, ema: 240, ret: '14.4M%', wr: 55.4, dd: 25.4, desc: 'Fades the New York session drift on GBPAUD.' },
  { pair: 'GBPCAD', name: 'GBPCAD Ny Fade', hr: 15, min: 15, sl: 20, tp: 50, ema: 240, ret: '18.2M%', wr: 62.2, dd: 27.2, desc: 'Fades the New York session drift on GBPCAD.' },
  { pair: 'GBPCHF', name: 'GBPCHF London Fade', hr: 9, min: 0, sl: 20, tp: 50, ema: 240, ret: '17.6M%', wr: 64.8, dd: 22.8, desc: 'Fades the London session drift on GBPCHF.' },
  { pair: 'GBPJPY', name: 'GBPJPY Ny Fade', hr: 15, min: 30, sl: 20, tp: 45, ema: 240, ret: '14.5M%', wr: 56.8, dd: 28.5, desc: 'Fades the New York session drift on GBPJPY.' },
  { pair: 'XAUUSD', name: 'XAUUSD London Fade', hr: 8, min: 15, sl: 400, tp: 500, ema: 60, ret: '77.3M%', wr: 58.2, dd: 38.9, desc: 'Fades the London session drift on XAUUSD.' }
];

const template = (d) => {
  const isJpy = d.pair.includes('JPY');
  const isGold = d.pair === 'XAUUSD';
  const pipSize = isJpy || isGold ? 0.01 : 0.0001;
  const tMin = d.min - 10;
  let triggerHr = d.hr;
  let triggerMin = tMin;
  if (tMin < 0) {
    triggerMin = 60 + tMin;
    triggerHr -= 1;
    if (triggerHr < 0) triggerHr = 23;
  }
  
  const id = d.name.toLowerCase().replace(/ /g, '-');
  const className = d.name.replace(/ /g, '') + 'Bot';

  return `import {
  TradingBot, BotConfig, BotContext, BotSignal, BotTradeState, TradeAction
} from './BotInterface.js';

export class ${className} extends TradingBot {
  config: BotConfig = {
    id: '${id}',
    name: '${d.name}',
    tagline: 'High-Probability Fade',
    description: '${d.desc} Executes at ${d.hr}:${d.min < 10 ? '0'+d.min : d.min} UTC (-10m latency offset). Uses ${d.ema} EMA trend fade with ${d.tp} pip TP / ${d.sl} pip SL.',
    symbols: ['${d.pair}'],
    riskPct: 5,
    strategyType: 'REVERSAL',
    color: 'slate',
    icon: '⚡',
    winRateBacktest: ${d.wr},
    returnBacktest: '+${d.ret} / 5yr',
    maxDDBacktest: ${d.dd},
  };

  private htfEma: number = 0;
  private readonly EMA_PERIOD = ${d.ema};

  async generateSignal(context: BotContext): Promise<BotSignal> {
    const { currentPrice, brokerSymbol, now } = context;

    if (brokerSymbol !== '${d.pair}') return { shouldTrade: false };

    if (this.htfEma === 0) {
      this.htfEma = currentPrice;
    } else {
      const alpha = 2 / (this.EMA_PERIOD + 1);
      this.htfEma = currentPrice * alpha + this.htfEma * (1 - alpha);
    }

    if (now.getUTCHours() === ${triggerHr} && now.getUTCMinutes() === ${triggerMin}) {
      const direction = currentPrice > this.htfEma ? 'SELL' : 'BUY';
      console.log(\`[${d.pair}-Fade] Triggered at \${currentPrice}. EMA is \${this.htfEma.toFixed(3)}. Fading: \${direction}.\`);
      
      return {
        shouldTrade: true,
        direction,
        suggestedSlPips: ${d.sl},
        suggestedTpPips: ${d.tp},
        reason: 'SESSION_OPEN_FADE',
      };
    }

    return { shouldTrade: false };
  }

  async manageTrade(trade: BotTradeState, context: BotContext): Promise<TradeAction> {
    const { currentPrice } = context;
    const PIP_SIZE = ${pipSize};

    const currentProfitPips = trade.direction === 'BUY'
      ? (currentPrice - trade.entryPrice) / PIP_SIZE
      : (trade.entryPrice - currentPrice) / PIP_SIZE;

    if (currentProfitPips >= ${d.tp}) return { action: 'CLOSE', reason: 'TP_HIT' };
    if (currentProfitPips <= -${d.sl}) return { action: 'CLOSE', reason: 'SL_HIT' };

    return { action: 'HOLD' };
  }
}

export default new ${className}();
`;
};

data.forEach(d => {
  const filename = 'server/bots/' + d.name.split(' ')[0].toLowerCase() + d.name.split(' ')[1] + 'Fade.ts';
  fs.writeFileSync(filename, template(d));
  console.log('Created ' + filename);
});
