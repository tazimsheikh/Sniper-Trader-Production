import { runMathBacktest } from "../backtester/MageMathBacktester.js";
import { runSageMathBacktest } from "../backtester/SageMathBacktester.js";
import { runPortfolioShadowBacktest } from "./portfolio_shadow_backtester.js";
import { MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG } from "../config/PairConfig.js";

async function compare() {
  const start = "2026-04-01";
  const end = "2026-04-30";

  console.log(`\n======================================================`);
  console.log(`🔎 STARTING TRADE-BY-TRADE PARITY DIAGNOSTIC FOR APRIL`);
  console.log(`======================================================`);

  console.log("1. Running MageMathBacktester for GER40...");
  const mageMathGER40 = await runMathBacktest("GER40", start, end);
  const mathTrades = mageMathGER40.records.filter((t:any) => t.outcome !== 'NO_TRADE');
  console.log(`   -> Math Backtester (MAGE GER40) generated ${mathTrades.length} trades. Net R: ${mathTrades.reduce((a:number,b:any)=>a+b.rMultiple, 0).toFixed(2)}`);

  console.log("\n2. Running Full Portfolio Shadow Backtester...");
  const shadowTradesAll = await runPortfolioShadowBacktest(start, end);
  
  if (!shadowTradesAll) {
      console.log("Error: Shadow Backtester returned undefined.");
      return;
  }
  
  const shadowMageGER40 = shadowTradesAll.filter((t:any) => t.symbol === "GER40" && (t.botId === "mage" || t.botId === "MAGE" || t.clientId?.startsWith("M_")));
  console.log(`   -> Shadow Backtester (MAGE GER40) generated ${shadowMageGER40.length} trades. Net R: ${shadowMageGER40.reduce((a:number,b:any)=>a+b.rMultiple, 0).toFixed(2)}`);

  console.log(`\n======================================================`);
  console.log(`🔬 CROSS-REFERENCING EVERY TRADE IN GER40`);
  console.log(`======================================================`);

  // Sort both by open time
  mathTrades.sort((a:any, b:any) => a.timestamp - b.timestamp);
  shadowMageGER40.sort((a:any, b:any) => a.openTime - b.openTime);

  let mathIdx = 0;
  let shadowIdx = 0;
  let diffCount = 0;
  
  const formatDate = (ts: number) => {
    return new Date(ts).toISOString().replace('T', ' ').substring(0, 19);
  };

  while (mathIdx < mathTrades.length || shadowIdx < shadowMageGER40.length) {
      const mT = mathTrades[mathIdx];
      const sT = shadowMageGER40[shadowIdx];
      
      if (!mT && sT) {
          console.log(`❌ [GHOST TRADE] Shadow Backtester took trade at ${formatDate(sT.openTime)} that Math Backtester did not.`);
          shadowIdx++;
          diffCount++;
          continue;
      }
      if (mT && !sT) {
          console.log(`❌ [MISSED TRADE] Math Backtester took trade at ${formatDate(mT.timestamp)} that Shadow Backtester missed.`);
          mathIdx++;
          diffCount++;
          continue;
      }
      
      // Match timestamp roughly (within a few minutes)
      const tDiff = Math.abs(mT.timestamp - sT.openTime);
      if (tDiff > 5 * 60 * 1000) {
          if (mT.timestamp < sT.openTime) {
             console.log(`❌ [MISSED TRADE] Math Backtester took trade at ${formatDate(mT.timestamp)} that Shadow Backtester missed.`);
             mathIdx++;
          } else {
             console.log(`❌ [GHOST TRADE] Shadow Backtester took trade at ${formatDate(sT.openTime)} that Math Backtester did not.`);
             shadowIdx++;
          }
          diffCount++;
          continue;
      }
      
      // R Multiple Diff
      const rDiff = Math.abs(mT.rMultiple - sT.rMultiple);
      if (rDiff > 0.05) {
          console.log(`⚠️ [R DIFF] Trade at ${formatDate(mT.timestamp)} -> Math R: ${mT.rMultiple.toFixed(2)}, Shadow R: ${sT.rMultiple.toFixed(2)} | Diff: ${(mT.rMultiple - sT.rMultiple).toFixed(2)}`);
          diffCount++;
      }
      
      mathIdx++;
      shadowIdx++;
  }
  
  if (diffCount === 0) {
      console.log(`✅ GER40 PARITY IS FLAWLESS! The discrepancy must be originating from cross-pair collisions (e.g. GlobalTradeGate or DWCB) blocking trades across the portfolio.`);
  } else {
      console.log(`🚨 FOUND ${diffCount} DISCREPANCIES IN GER40 ALONE!`);
  }
}
compare().catch(console.error);
