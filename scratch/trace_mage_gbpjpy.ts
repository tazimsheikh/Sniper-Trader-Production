import { MAGE_PAIR_CONFIG, PairConfigManager } from '../server/trading/config/PairConfig.js';
import { runMathBacktest } from '../server/trading/backtester/MageMathBacktester.js';
import { OPTIMIZER_CONFIG } from '../server/trading/config/OptimizerPairConfig.js';

async function main() {
  const pair = 'GBPJPY';
  const start = '2026-04-09';
  const end = '2026-04-10'; // Just april 9
  const config = MAGE_PAIR_CONFIG[pair];
  
  (global as any).__SIM_ENABLE_TRACE__ = true;
  
  const mOptCfg = OPTIMIZER_CONFIG[pair];
  const spread = mOptCfg ? mOptCfg.spread : 1.5;
  
  const res = await runMathBacktest(pair, start, end, false, undefined, undefined, null, config, true);
  console.log("Trades:", res.trades.length);
  for (const t of res.trades) {
    console.log(`Date: ${t.date} | Outcome: ${t.outcome}`);
  }
}

main().catch(console.error);
