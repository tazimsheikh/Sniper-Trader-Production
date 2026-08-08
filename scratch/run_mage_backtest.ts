import { runMathBacktest } from "../server/trading/backtester/MageMathBacktester.js";
import { MAGE_PAIR_CONFIG } from "../server/trading/config/PairConfig.js";

async function run() {
  const start = "2026-02-01";
  const end = "2026-08-01";
  
  let totalTrades = 0;
  let totalR = 0;

  for (const symbol of Object.keys(MAGE_PAIR_CONFIG)) {
    try {
      const result = await runMathBacktest(symbol, start, end);
      const trades = result.records.filter((r: any) => r.outcome !== "NO_TRADE");
      let netR = 0;
      for (const t of trades) {
        if (t.riskPips && t.riskPips > 0 && t.pips) {
          netR += t.pips / t.riskPips;
        }
      }
      console.log(`[${symbol}] Trades: ${trades.length} | Net R: ${netR.toFixed(2)}`);
      totalTrades += trades.length;
      totalR += netR;
    } catch (e: any) {
      console.log(`[${symbol}] Error: ${e.message}`);
    }
  }
  
  console.log(`\n=== TOTAL MAGE PORTFOLIO (WITH ATR) ===`);
  console.log(`Total Trades: ${totalTrades}`);
  console.log(`Total Net R: ${totalR.toFixed(2)}`);
}

run().catch(console.error);
