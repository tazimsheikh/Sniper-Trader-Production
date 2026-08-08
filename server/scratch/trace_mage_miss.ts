import { parseCsvM1Data } from "../trading/backtester/loadCsv.js";
import { buildM1TypedArrays } from "../trading/backtester/math_core/MathCoreUtils.js";
import { aggregateCandles } from "../trading/market/CandleAggregator.js";
import { preComputeTriggers } from "../trading/backtester/math_core/MageMathCore.js";
import { PairConfigManager } from "../trading/config/PairConfig.js";

async function run() {
  const symbol = "NAS100";
  console.log(`Loading CSV for ${symbol}...`);
  const m1Rows = parseCsvM1Data(symbol);
  
  // Filter to just 07-17 and 07-24 to save time
  const filteredRows = m1Rows.filter(r => r.dateStr === "2026-07-17" || r.dateStr === "2026-07-24");
  
  const m1 = buildM1TypedArrays(filteredRows);
  const m5Candles = aggregateCandles(filteredRows, 5);
  
  // mock ATR array (dummy, we'll bypass ATR if needed or set it to 100)
  const atrArr = new Float32Array(m5Candles.length).fill(100);
  
  const mCfgs = PairConfigManager.getMageConfigs(symbol);
  const asiaCfg = mCfgs.find(c => c.session === "asia")!;
  
  console.log(`Testing Asia Config: orbPullbackPct = ${asiaCfg.orbPullbackPct}`);
  
  const triggers = preComputeTriggers(
    filteredRows, m1, m5Candles, symbol, asiaCfg, "asia", false, atrArr
  );
  
  console.log("TRIGGERS FOUND:");
  for (const t of triggers) {
    const triggerCandle = m5Candles[t.m5Index];
    console.log(`Date: ${triggerCandle.dateStr} | Time: ${new Date(triggerCandle.timestamp).toISOString()} | Dir: ${t.direction}`);
  }
}

run().catch(console.error);
