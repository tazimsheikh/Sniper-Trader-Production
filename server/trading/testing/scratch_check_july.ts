import { runMathBacktest } from "../backtester/MageMathBacktester.js";
import { runSageMathBacktest } from "../backtester/SageMathBacktester.js";
import { PairConfigManager, MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG } from "../config/PairConfig.js";

async function checkJuly() {
  console.log("Checking July 2026 Performance (2026-07-01 to 2026-07-31) for Current Portfolio");
  console.log("--------------------------------------------------------------------------------");

  const start = "2026-07-01";
  const end = "2026-07-31";

  for (const pair of Object.keys(MAGE_PAIR_CONFIG)) {
    const configs = PairConfigManager.getMageConfigs(pair);
    if (configs.length > 0) {
      const res = await runMathBacktest(pair, start, end, false, undefined, undefined, null, configs, false);
      const netR = res.records
        .filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE")
        .reduce((sum: number, r: any) => sum + (r.rMultiple || 0), 0);
      console.log(`MAGE ${pair.padEnd(8)} : Net R = ${netR.toFixed(2)}R`);
    }
  }

  for (const pair of Object.keys(SAGE_PAIR_CONFIG || {})) {
    const configs = PairConfigManager.getSageConfigs(pair);
    if (configs.length > 0) {
      const res = await runSageMathBacktest(pair, start, end, false, {}, configs, false);
      const netR = res.records
        .filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE")
        .reduce((sum: number, r: any) => sum + (r.rMultiple || 0), 0);
      console.log(`SAGE ${pair.padEnd(8)} : Net R = ${netR.toFixed(2)}R`);
    }
  }
}

checkJuly().catch(console.error);
