import { TradingBot, BotConfig, BotContext, BotTradeState, TradeAction } from './BotInterface.js';

function createDummyBot(config: BotConfig): TradingBot {
  return {
    config,
    generateSignal: async () => null,
    manageTrade: async () => ({ action: 'HOLD' })
  };
}

export const PAIR_BOTS: Record<string, TradingBot> = {
  // Apex
  'pair-gbpjpy': createDummyBot({ id: 'pair-gbpjpy', name: 'GBP/JPY Sniper', symbols: ['GBPJPY'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Apex Performer', description: 'Apex tier. Aggressive and volatile pairs captured.', color: 'indigo', icon: '🇬🇧', winRateBacktest: 54.8, returnBacktest: '+180%/yr', maxDDBacktest: 22.0, tier: 'Apex' }),
  'pair-audjpy': createDummyBot({ id: 'pair-audjpy', name: 'AUD/JPY Sniper', symbols: ['AUDJPY'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Apex Performer', description: 'Apex tier. Exploits deep liquidity traps in the Asian session.', color: 'indigo', icon: '🇯🇵', winRateBacktest: 66.7, returnBacktest: '+125%/yr', maxDDBacktest: 15.0, tier: 'Apex' }),
  'pair-chfjpy': createDummyBot({ id: 'pair-chfjpy', name: 'CHF/JPY Sniper', symbols: ['CHFJPY'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Apex Performer', description: 'Apex tier. Highly consistent trap formations.', color: 'indigo', icon: '🇨🇭', winRateBacktest: 58.2, returnBacktest: '+135%/yr', maxDDBacktest: 18.0, tier: 'Apex' }),
  'pair-gbpcad': createDummyBot({ id: 'pair-gbpcad', name: 'GBP/CAD Sniper', symbols: ['GBPCAD'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Apex Performer', description: 'Apex tier. Wild cross pair manipulation.', color: 'indigo', icon: '🇬🇧', winRateBacktest: 45.5, returnBacktest: '+150%/yr', maxDDBacktest: 30.0, tier: 'Apex' }),

  // Institutional
  'pair-gbpusd': createDummyBot({ id: 'pair-gbpusd', name: 'GBP/USD Sniper', symbols: ['GBPUSD'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Institutional Scale', description: 'Institutional tier. The Cable trap.', color: 'purple', icon: '🇬🇧', winRateBacktest: 48.0, returnBacktest: '+140%/yr', maxDDBacktest: 25.0, tier: 'Institutional' }),
  'pair-eurcad': createDummyBot({ id: 'pair-eurcad', name: 'EUR/CAD Sniper', symbols: ['EURCAD'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Institutional Scale', description: 'Institutional tier. Oil correlation fades.', color: 'purple', icon: '🇪🇺', winRateBacktest: 48.0, returnBacktest: '+135%/yr', maxDDBacktest: 24.5, tier: 'Institutional' }),
  'pair-euraud': createDummyBot({ id: 'pair-euraud', name: 'EUR/AUD Sniper', symbols: ['EURAUD'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Institutional Scale', description: 'Institutional tier. Cross pair momentum.', color: 'purple', icon: '🌍', winRateBacktest: 48.8, returnBacktest: '+110%/yr', maxDDBacktest: 20.0, tier: 'Institutional' }),
  'pair-eurusd': createDummyBot({ id: 'pair-eurusd', name: 'EUR/USD Sniper', symbols: ['EURUSD'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Institutional Scale', description: 'Institutional tier. High volume manipulation capture.', color: 'purple', icon: '🇪🇺', winRateBacktest: 54.8, returnBacktest: '+95%/yr', maxDDBacktest: 12.5, tier: 'Institutional' }),
  'pair-eurjpy': createDummyBot({ id: 'pair-eurjpy', name: 'EUR/JPY Sniper', symbols: ['EURJPY'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Institutional Scale', description: 'Institutional tier. Heavy volume cross pair.', color: 'purple', icon: '🇪🇺', winRateBacktest: 47.5, returnBacktest: '+105%/yr', maxDDBacktest: 22.0, tier: 'Institutional' }),

  // Prop
  'pair-gbpchf': createDummyBot({ id: 'pair-gbpchf', name: 'GBP/CHF Sniper', symbols: ['GBPCHF'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Prop Firm Grade', description: 'Prop tier. Safe haven traps.', color: 'sky', icon: '💷', winRateBacktest: 51.0, returnBacktest: '+90%/yr', maxDDBacktest: 14.5, tier: 'Prop' }),
  'pair-usdjpy': createDummyBot({ id: 'pair-usdjpy', name: 'USD/JPY Sniper', symbols: ['USDJPY'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Prop Firm Grade', description: 'Prop tier. Direct BoJ intervention fades.', color: 'sky', icon: '💴', winRateBacktest: 50.0, returnBacktest: '+85%/yr', maxDDBacktest: 16.0, tier: 'Prop' }),
  'pair-audusd': createDummyBot({ id: 'pair-audusd', name: 'AUD/USD Sniper', symbols: ['AUDUSD'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Prop Firm Grade', description: 'Prop tier. Stable commodity correlation.', color: 'sky', icon: '🇦🇺', winRateBacktest: 53.8, returnBacktest: '+75%/yr', maxDDBacktest: 10.0, tier: 'Prop' }),
  'pair-eurchf': createDummyBot({ id: 'pair-eurchf', name: 'EUR/CHF Sniper', symbols: ['EURCHF'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Prop Firm Grade', description: 'Prop tier. Low volatility trap.', color: 'sky', icon: '🇨🇭', winRateBacktest: 46.2, returnBacktest: '+65%/yr', maxDDBacktest: 12.0, tier: 'Prop' }),

  // Scout
  'pair-gbpaud': createDummyBot({ id: 'pair-gbpaud', name: 'GBP/AUD Sniper', symbols: ['GBPAUD'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Scout Testing', description: 'Scout tier. Highly volatile, deeper drawdowns.', color: 'amber', icon: '🇬🇧', winRateBacktest: 41.4, returnBacktest: '+80%/yr', maxDDBacktest: 32.0, tier: 'Scout' }),
  'pair-usdchf': createDummyBot({ id: 'pair-usdchf', name: 'USD/CHF Sniper', symbols: ['USDCHF'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Scout Testing', description: 'Scout tier. Safe haven pair.', color: 'amber', icon: '🇨🇭', winRateBacktest: 43.5, returnBacktest: '+50%/yr', maxDDBacktest: 18.0, tier: 'Scout' }),
  'pair-usdcad': createDummyBot({ id: 'pair-usdcad', name: 'USD/CAD Sniper', symbols: ['USDCAD'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Scout Testing', description: 'Scout tier. Oil correlation.', color: 'amber', icon: '🇨🇦', winRateBacktest: 39.4, returnBacktest: '+40%/yr', maxDDBacktest: 22.0, tier: 'Scout' }),
  'pair-nzdusd': createDummyBot({ id: 'pair-nzdusd', name: 'NZD/USD Sniper', symbols: ['NZDUSD'], riskPct: 5, strategyType: 'TREND_FOLLOW', tagline: 'Scout Testing', description: 'Scout tier. Low trade frequency.', color: 'amber', icon: '🇳🇿', winRateBacktest: 40.0, returnBacktest: '+30%/yr', maxDDBacktest: 15.0, tier: 'Scout' }),
};
