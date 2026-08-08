import { runMathBacktest } from "../backtester/MageMathBacktester.js";
import { runSageMathBacktest } from "../backtester/SageMathBacktester.js";
import { PairConfigManager, MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG } from "../config/PairConfig.js";

async function checkAugusts() {
  const years = [2021, 2022, 2023, 2024, 2025];
  
  for (const year of years) {
    const start = `${year}-08-01`;
    const end = `${year}-08-31`;

    console.log(`\n============================================================`);
    console.log(` 📅 AUGUST ${year} PERFORMANCE`);
    console.log(`============================================================`);
    
    let totalMageR = 0;
    let totalSageR = 0;
    let totalMageTrades = 0;
    let totalSageTrades = 0;

    for (const pair of Object.keys(MAGE_PAIR_CONFIG)) {
      const configs = PairConfigManager.getMageConfigs(pair);
      if (configs.length > 0) {
        try {
          const res = await runMathBacktest(pair, start, end, false, undefined, undefined, null, configs, false);
          const valid = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
          const netR = valid.reduce((sum: number, r: any) => sum + (r.rMultiple || 0), 0);
          if (valid.length > 0) {
            console.log(`MAGE ${pair.padEnd(8)} : ${valid.length.toString().padStart(3)} trades, Net R = ${netR.toFixed(2)}R`);
          }
          totalMageR += netR;
          totalMageTrades += valid.length;
        } catch (e: any) {
          // Silent on error (no data for that year)
        }
      }
    }

    for (const pair of Object.keys(SAGE_PAIR_CONFIG || {})) {
      const configs = PairConfigManager.getSageConfigs(pair);
      if (configs.length > 0) {
        try {
          const res = await runSageMathBacktest(pair, start, end, false, {}, configs, false);
          const valid = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
          const netR = valid.reduce((sum: number, r: any) => sum + (r.rMultiple || 0), 0);
          if (valid.length > 0) {
            console.log(`SAGE ${pair.padEnd(8)} : ${valid.length.toString().padStart(3)} trades, Net R = ${netR.toFixed(2)}R`);
          }
          totalSageR += netR;
          totalSageTrades += valid.length;
        } catch (e: any) {
          // Silent on error (no data for that year)
        }
      }
    }
    
    console.log(`------------------------------------------------------------`);
    console.log(`SUMMARY AUGUST ${year}:`);
    console.log(`Mage: ${totalMageTrades} trades | Net R = ${totalMageR.toFixed(2)}R`);
    console.log(`Sage: ${totalSageTrades} trades | Net R = ${totalSageR.toFixed(2)}R`);
    console.log(`TOTAL PORTFOLIO NET R: ${(totalMageR + totalSageR).toFixed(2)}R`);
  }
}

checkAugusts().catch(console.error);
