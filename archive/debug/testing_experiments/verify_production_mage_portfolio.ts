import { runMathBacktest, clearMageBacktestCache } from "../backtester/MageMathBacktester.js";
import { PairConfigManager } from "../config/PairConfig.js";

const START_DATE = "2025-09-02";
const END_DATE = "2026-09-02";

const MAGE_PAIRS = ["GBPJPY", "NAS100.DAILY", "SPX500.DAILY", "XAUUSD", "GER40.DAILY"];

async function main() {
  let totalTrades = 0, totalWins = 0, totalLoss = 0, totalWinR = 0, totalLossR = 0;

  console.log(`\n====================================================================================================`);
  console.log(` 🏆 PRODUCTION MAGE PORTFOLIO VERIFICATION (1-YEAR BACKTEST: 2025-09-02 -> 2026-09-02)`);
  console.log(`====================================================================================================\n`);

  console.log(`  SYMBOL       | TRADES | WINS | LOSS |  WIN%  |   WIN_R   |   LOSS_R  |   NET_R   |   PF`);
  console.log(`  ` + "-".repeat(80));

  for (const pair of MAGE_PAIRS) {
    const cleanSym = pair.replace(/\.daily$/i, "");
    const liveCfgs = PairConfigManager.getMageConfigs(cleanSym);

    const res = await runMathBacktest(cleanSym, START_DATE, END_DATE, false, undefined, undefined, null, liveCfgs, false);
    const valid = res.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE");
    let pairWins = 0, pairLoss = 0, pairWinR = 0, pairLossR = 0;
    for (const r of valid) {
      totalTrades++;
      const rm = r.rMultiple ?? 0;
      if (rm > 0.05) { totalWins++; pairWins++; totalWinR += rm; pairWinR += rm; }
      else if (rm < -0.05) { totalLoss++; pairLoss++; totalLossR += rm; pairLossR += rm; }
    }
    const netR = pairWinR + pairLossR;
    const pf = Math.abs(pairLossR) > 0 ? (pairWinR / Math.abs(pairLossR)).toFixed(2) : "N/A";
    const wr = valid.length > 0 ? ((pairWins / valid.length) * 100).toFixed(1) : "0.0";
    clearMageBacktestCache(cleanSym);

    console.log(`  ${cleanSym.padEnd(12)} | ${String(valid.length).padStart(6)} | ${String(pairWins).padStart(4)} | ${String(pairLoss).padStart(4)} | ${wr.padStart(5)}% | +${pairWinR.toFixed(2).padStart(7)}R | ${pairLossR.toFixed(2).padStart(8)}R | +${netR.toFixed(2).padStart(7)}R | ${pf.padStart(5)}`);
  }

  const grandNetR = totalWinR + totalLossR;
  const grandPF = Math.abs(totalLossR) > 0 ? (totalWinR / Math.abs(totalLossR)).toFixed(2) : "N/A";
  console.log(`  ` + "-".repeat(80));
  console.log(`  TOTAL MAGE   | ${String(totalTrades).padStart(6)} | ${String(totalWins).padStart(4)} | ${String(totalLoss).padStart(4)} | ${((totalWins / totalTrades) * 100).toFixed(1)}% | +${totalWinR.toFixed(2).padStart(7)}R | ${totalLossR.toFixed(2).padStart(8)}R | +${grandNetR.toFixed(2).padStart(7)}R | ${grandPF.padStart(5)}`);
  console.log(`====================================================================================================\n`);
}

main();
