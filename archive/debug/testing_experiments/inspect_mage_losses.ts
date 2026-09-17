// ============================================================
// inspect_mage_losses.ts
//
// Deep dive into individual losing trades for Mage's highest loss pairs:
// XAUUSD, NAS100, and GBPJPY.
// ============================================================

import { runMathBacktest, clearMageBacktestCache } from "../backtester/MageMathBacktester.js";
import { PairConfigManager } from "../config/PairConfig.js";

const START_DATE = "2025-09-02";
const END_DATE = "2026-09-02";

async function inspectPair(pair: string) {
  const configs = PairConfigManager.getMageConfigs(pair);
  console.log(`\n========================================================================`);
  console.log(` 🔎 INSPECTING MAGE LOSSES FOR ${pair} (Config count: ${configs.length})`);
  console.log(`========================================================================`);

  for (const cfg of configs) {
    console.log(`Config: session=${cfg.session} Start=${cfg.orbStartHour}:${cfg.orbStartMin} Trig=${cfg.trailingSlTrigger} Step=${cfg.trailingSlStep} FC=${cfg.forceCloseHours} MinSL=${cfg.minSlDist} MaxSL=${cfg.maxSlDist}`);
    const res = await runMathBacktest(pair, START_DATE, END_DATE, false, undefined, undefined, null, [cfg], false);
    const valid = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
    const losses = valid.filter((r: any) => (r.rMultiple ?? 0) < 0);
    const wins = valid.filter((r: any) => (r.rMultiple ?? 0) > 0);

    console.log(`Total Trades: ${valid.length} | Wins: ${wins.length} | Losses: ${losses.length}`);
    const totalWinR = wins.reduce((s: number, r: any) => s + (r.rMultiple ?? 0), 0);
    const totalLossR = losses.reduce((s: number, r: any) => s + (r.rMultiple ?? 0), 0);
    console.log(`Win R: +${totalWinR.toFixed(2)}R | Loss R: ${totalLossR.toFixed(2)}R | Net R: ${(totalWinR + totalLossR).toFixed(2)}R`);

    // Group losses by MFE (excursion)
    const mfeUnder025 = losses.filter((r: any) => (r.mfeR ?? 0) < 0.25);
    const mfe025To08 = losses.filter((r: any) => (r.mfeR ?? 0) >= 0.25 && (r.mfeR ?? 0) < 0.8);
    const mfeOver08 = losses.filter((r: any) => (r.mfeR ?? 0) >= 0.8);

    console.log(`\nLoss Breakdown:`);
    console.log(`  - Instant Rejection (MFE < 0.25R) : ${mfeUnder025.length} losses`);
    console.log(`  - Choppy Stall (0.25 <= MFE < 0.8): ${mfe025To08.length} losses`);
    console.log(`  - Reversal from Profit (MFE >= 0.8): ${mfeOver08.length} losses`);

    console.log(`\nSample of 10 Losses with their characteristics:`);
    losses.slice(0, 10).forEach((l: any, idx: number) => {
      const durMins = l.exitTimeMs && l.timestamp ? Math.round((l.exitTimeMs - l.timestamp) / 60000) : "?";
      console.log(`  #${idx + 1} Date: ${l.date} | ${l.direction || (l.entry > l.stopLoss ? "BUY" : "SELL")} | Entry: ${l.entry} | SL: ${l.stopLoss} | RiskPips: ${l.riskPips?.toFixed(1)} | Outcome: ${l.outcome} | R: ${l.rMultiple?.toFixed(2)} | Dur: ${durMins}m`);
    });
    clearMageBacktestCache(pair);
  }
}

async function main() {
  await inspectPair("XAUUSD");
  await inspectPair("NAS100.DAILY");
  await inspectPair("GBPJPY");
}

main();
