import { SHADOW_MAGE_CONFIG, SHADOW_SAGE_CONFIG } from "../server/trading/config/ShadowPortfolioConfig.js";
import { runMathBacktest as runMageMathBacktest } from "../server/trading/backtester/MageMathBacktester.js";
import { runSageMathBacktest } from "../server/trading/backtester/SageMathBacktester.js";
import fs from "fs";
import path from "path";

const START_DATE = new Date(new Date().getTime() - 6 * 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
const END_DATE = new Date().toISOString().substring(0, 10);

async function main() {
  console.log(`=========================================`);
  console.log(`    SHADOW PORTFOLIO BACKTEST (6 MONTHS) `);
  console.log(`=========================================\n`);

  const pairs = Object.keys(SHADOW_MAGE_CONFIG);
  let totalPortfolioR = 0;
  let totalPortfolioTrades = 0;
  
  const breakdown: any[] = [];

  for (const pair of pairs) {
    const csvFiles = fs.readdirSync(path.join(process.cwd(), "data", "csv"))
      .filter(f => f.startsWith(pair) && f.endsWith(".csv"));
    if (!csvFiles.length) {
      console.log(`\n--- Testing ${pair} --- [SKIPPED - NO CSV DATA]`);
      continue;
    }

    console.log(`\n--- Testing ${pair} ---`);
    const mageCfgs = SHADOW_MAGE_CONFIG[pair].filter((c: any) => !c.dummy);
    const sageCfgs = SHADOW_SAGE_CONFIG[pair].filter((c: any) => !c.dummy);

    let pairNetR = 0;
    let pairTrades = 0;

    // Run MAGE
    if (mageCfgs.length > 0) {
      try {
        const mageRes = await runMageMathBacktest(pair, START_DATE, END_DATE, false, undefined, undefined, null, mageCfgs, false);
        const records = mageRes.records || [];
        let curNetR = 0;
        let curTrades = 0;
        for (const r of records) {
          if (r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE") {
            curNetR += (r.rMultiple || 0);
            curTrades++;
          }
        }
        pairNetR += curNetR;
        pairTrades += curTrades;
        console.log(`  MAGE: ${curNetR.toFixed(2)}R | ${curTrades} trades`);
      } catch (err: any) {
        console.log(`  MAGE Error for ${pair}:\n${err.stack}`);
      }
    } else {
      console.log(`  MAGE: Skipped (No valid configs)`);
    }

    // Run SAGE
    if (sageCfgs.length > 0) {
      try {
        const sageRes = await runSageMathBacktest(pair, START_DATE, END_DATE, false, undefined, sageCfgs, false);
        const records = sageRes.records || [];
        let curNetR = 0;
        let curTrades = 0;
        for (const r of records) {
          if (r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE") {
            curNetR += (r.rMultiple || 0);
            curTrades++;
          }
        }
        pairNetR += curNetR;
        pairTrades += curTrades;
        console.log(`  SAGE: ${curNetR.toFixed(2)}R | ${curTrades} trades`);
      } catch (err: any) {
        console.log(`  SAGE Error for ${pair}:\n${err.stack}`);
      }
    } else {
      console.log(`  SAGE: Skipped (No valid configs)`);
    }

    totalPortfolioR += pairNetR;
    totalPortfolioTrades += pairTrades;
    breakdown.push({ pair, netR: pairNetR, trades: pairTrades });
  }

  console.log(`\n=========================================`);
  console.log(`PORTFOLIO TOTAL: ${totalPortfolioR.toFixed(2)}R`);
  console.log(`PORTFOLIO TRADES: ${totalPortfolioTrades}`);
  console.log(`=========================================\n`);

  let md = `# Shadow Portfolio Exhaustive Backtest (Last 6 Months)\n\n`;
  md += `**Total Net R:** ${totalPortfolioR.toFixed(2)}R\n`;
  md += `**Total Trades:** ${totalPortfolioTrades}\n\n`;
  md += `| Pair | Net R | Trades |\n`;
  md += `|------|-------|--------|\n`;
  
  breakdown.sort((a, b) => b.netR - a.netR);
  for (const b of breakdown) {
    md += `| ${b.pair} | ${b.netR.toFixed(2)}R | ${b.trades} |\n`;
  }

  fs.writeFileSync("C:/Users/tazim/.gemini/antigravity/brain/b2f5fb21-b306-4513-8cf6-5dacb6d1c255/shadow_portfolio_results.md", md);
  console.log(`Results written to shadow_portfolio_results.md artifact.`);
}

main().catch(console.error);
