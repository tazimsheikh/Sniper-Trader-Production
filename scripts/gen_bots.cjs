const fs = require('fs');

// optimal configs
const optimal = [
  { "pair": "GBPJPY", "name": "GBPJPY Ny Fade", "hr": 14, "min": 30, "sl": 30, "tp": 60, "ret": "169.0", "wr": 47.4, "dd": 5.8, "tier": "Apex" },
  { "pair": "XAUUSD", "name": "XAUUSD London Fade", "hr": 9, "min": 0, "sl": 200, "tp": 600, "ret": "422.7", "wr": 35.5, "dd": 21.6, "tier": "Apex" },
  { "pair": "GBPUSD", "name": "GBPUSD London Fade", "hr": 7, "min": 30, "sl": 25, "tp": 50, "ret": "195.5", "wr": 67.6, "dd": 10.1, "tier": "Apex" },
  { "pair": "GBPCHF", "name": "GBPCHF London Fade", "hr": 7, "min": 30, "sl": 20, "tp": 60, "ret": "150.2", "wr": 63.6, "dd": 10.4, "tier": "Apex" },
  { "pair": "GBPAUD", "name": "GBPAUD Ny Fade", "hr": 14, "min": 30, "sl": 20, "tp": 30, "ret": "149.2", "wr": 55.6, "dd": 10.4, "tier": "Institutional" },
  { "pair": "AUDJPY", "name": "AUDJPY Ny Fade", "hr": 13, "min": 0, "sl": 40, "tp": 80, "ret": "78.1", "wr": 68.2, "dd": 6.1, "tier": "Institutional" },
  { "pair": "USDJPY", "name": "USDJPY Ny Fade", "hr": 13, "min": 0, "sl": 25, "tp": 37.5, "ret": "137.0", "wr": 48.8, "dd": 11.0, "tier": "Institutional" },
  { "pair": "USDCHF", "name": "USDCHF Ny Fade", "hr": 13, "min": 0, "sl": 25, "tp": 37.5, "ret": "65.8", "wr": 48.0, "dd": 5.3, "tier": "Institutional" },
  { "pair": "EURJPY", "name": "EURJPY London Fade", "hr": 9, "min": 30, "sl": 30, "tp": 30, "ret": "96.3", "wr": 59.2, "dd": 8.5, "tier": "Prop" },
  { "pair": "AUDUSD", "name": "AUDUSD London Fade", "hr": 9, "min": 15, "sl": 40, "tp": 40, "ret": "38.7", "wr": 65.5, "dd": 3.7, "tier": "Prop" },
  { "pair": "GBPCAD", "name": "GBPCAD Ny Fade", "hr": 13, "min": 30, "sl": 30, "tp": 90, "ret": "248.1", "wr": 51.8, "dd": 24.2, "tier": "Prop" },
  { "pair": "EURAUD", "name": "EURAUD London Fade", "hr": 8, "min": 0, "sl": 30, "tp": 30, "ret": "92.1", "wr": 53.8, "dd": 10.2, "tier": "Prop" },
  { "pair": "NZDUSD", "name": "NZDUSD London Fade", "hr": 9, "min": 15, "sl": 30, "tp": 90, "ret": "93.7", "wr": 60.0, "dd": 10.9, "tier": "Scout" },
  { "pair": "CHFJPY", "name": "CHFJPY Ny Fade", "hr": 13, "min": 30, "sl": 30, "tp": 30, "ret": "76.3", "wr": 67.6, "dd": 9.4, "tier": "Scout" },
  { "pair": "EURCHF", "name": "EURCHF London Fade", "hr": 7, "min": 15, "sl": 40, "tp": 40, "ret": "19.2", "wr": 60.6, "dd": 2.4, "tier": "Scout" },
  { "pair": "EURCAD", "name": "EURCAD London Fade", "hr": 9, "min": 45, "sl": 25, "tp": 50, "ret": "95.4", "wr": 51.4, "dd": 13.0, "tier": "Scout" },
  { "pair": "USDCAD", "name": "USDCAD London Fade", "hr": 9, "min": 30, "sl": 30, "tp": 60, "ret": "66.9", "wr": 61.3, "dd": 9.9, "tier": "Scout" }
];

const template = (d) => {
  const id = d.name.toLowerCase().replace(/ /g, '-');
  const className = d.name.replace(/ /g, '') + 'Bot';

  return `import {
  TradingBot, BotConfig, BotContext, BotSignal, BotTradeState, TradeAction
} from './BotInterface.js';

export class ${className} extends TradingBot {
  config: BotConfig = {
    id: '${id}',
    name: '${d.name}',
    tagline: 'Sniper AI Authorization Switch',
    description: 'Toggle this on to authorize the Master Sniper System AI to trade ${d.pair} automatically at ${d.hr}:${d.min < 10 ? '0'+d.min : d.min} UTC.',
    symbols: ['${d.pair}'],
    riskPct: 5,
    strategyType: 'REVERSAL',
    color: 'slate',
    icon: '🔐',
    tier: '${d.tier}',
    winRateBacktest: ${d.wr},
    returnBacktest: '+${d.ret}%',
    maxDDBacktest: ${d.dd},
  };

  async generateSignal(context: BotContext): Promise<BotSignal> {
    // This is purely a UI toggle switch. The logic is executed by SniperSystemAI.
    return { shouldTrade: false };
  }

  async manageTrade(trade: BotTradeState, context: BotContext): Promise<TradeAction> {
    return { action: 'HOLD' };
  }
}

export default new ${className}();
`;
};

optimal.forEach(d => {
  const filename = 'server/bots/' + d.name.split(' ')[0].toLowerCase() + d.name.split(' ')[1] + 'Fade.ts';
  fs.writeFileSync(filename, template(d));
  console.log('Created ' + filename);
});
