// ============================================================
// test_portfolio_parity_comparison.ts
//
// Cross-compares Tier 1 Math Backtesters (Mage, Sage) for all active pairs
// against Tier 2 Portfolio Shadow Backtester (multi-pair LiveOrchestrator),
// and cross-references trade counts, Net R, and trade-by-trade alignment.
//
// Usage:
//   npx tsx server/trading/testing/test_portfolio_parity_comparison.ts [START_DATE] [END_DATE]
// Example:
//   npx tsx server/trading/testing/test_portfolio_parity_comparison.ts 2026-04-01 2026-04-30
// ============================================================

import { runMathBacktest } from '../backtester/MageMathBacktester.js';
import { runSageMathBacktest } from '../backtester/SageMathBacktester.js';
import { runPortfolioShadowBacktest } from './portfolio_shadow_engine.js';
import { MAGE_PAIR_CONFIG, SAGE_PAIR_CONFIG, PairConfigManager } from '../config/PairConfig.js';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  const args = process.argv.slice(2);
  let startDate = args[0] || '2026-04-01';
  let endDate = args[1] || '2026-04-30';

  if (!args[0] || !args[1]) {
    const csvDir = path.join(process.cwd(), 'data', 'csv');
    if (fs.existsSync(csvDir)) {
      const csvFiles = fs.readdirSync(csvDir).filter((f) => f.endsWith('.csv') && f.includes('_M1_'));
      if (csvFiles.length > 0) {
        const { getLatestDate } = await import('../backtester/loadCsv.js');
        const latestDate = getLatestDate(path.join(csvDir, csvFiles[0]));
        endDate = latestDate.toISOString().substring(0, 10);
        const sd = new Date(latestDate.getTime());
        sd.setMonth(sd.getMonth() - 1);
        startDate = sd.toISOString().substring(0, 10);
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`📊 PORTFOLIO PARITY COMPARISON (${startDate} to ${endDate})`);
  console.log(`======================================================`);

  const magePairs = Object.keys(MAGE_PAIR_CONFIG);
  const sagePairs = Object.keys(SAGE_PAIR_CONFIG || {});

  // ── Step 1: Run Tier 1 Math Backtesters per Pair ──
  console.log(`\n1️⃣  Running Tier 1 Math Backtesters...`);
  
  interface MathTrade {
    bot: string;
    pair: string;
    date: string;
    timestamp: number;
    entry: number;
    sl: number;
    tp: number;
    exitPrice: number;
    outcome: string;
    rMultiple: number;
  }

  const allMathTrades: MathTrade[] = [];
  const mathPairSummary: Record<string, { trades: number; netR: number }> = {};

  for (const pair of magePairs) {
    const configs = PairConfigManager.getMageConfigs(pair);
    try {
      const res = await runMathBacktest(pair, startDate, endDate, false, undefined, undefined, null, configs, false);
      const trades = (res.records || []).filter((r: any) => r.outcome !== 'SKIPPED' && r.outcome !== 'NO_TRADE');
      const netR = trades.reduce((a: number, b: any) => a + (b.rMultiple || 0), 0);
      const key = `MAGE_${pair}`;
      mathPairSummary[key] = { trades: trades.length, netR };

      for (const t of trades) {
        allMathTrades.push({
          bot: 'MAGE',
          pair: pair.replace('.Daily', ''),
          date: t.date || new Date(t.timestamp).toISOString().split('T')[0],
          timestamp: t.timestamp || new Date(t.date).getTime(),
          entry: Number(t.entry),
          sl: Number(t.stopLoss),
          tp: Number(t.takeProfit || 0),
          exitPrice: Number(t.exitPrice || 0),
          outcome: t.outcome,
          rMultiple: Number(t.rMultiple || 0)
        });
      }
    } catch (e: any) {
      console.warn(`   ⚠️ Error running Mage Math Backtest for ${pair}:`, e?.message);
    }
  }

  for (const pair of sagePairs) {
    const configs = PairConfigManager.getSageConfigs(pair);
    try {
      const res = await runSageMathBacktest(pair, startDate, endDate, false, undefined, configs, false);
      const trades = (res.records || []).filter((r: any) => r.outcome !== 'SKIPPED' && r.outcome !== 'NO_TRADE');
      const netR = trades.reduce((a: number, b: any) => a + (b.rMultiple || 0), 0);
      const key = `SAGE_${pair}`;
      mathPairSummary[key] = { trades: trades.length, netR };

      for (const t of trades) {
        allMathTrades.push({
          bot: 'SAGE',
          pair: pair.replace('.Daily', ''),
          date: t.date || new Date(t.timestamp).toISOString().split('T')[0],
          timestamp: t.timestamp || new Date(t.date).getTime(),
          entry: Number(t.entry),
          sl: Number(t.stopLoss),
          tp: Number(t.takeProfit || 0),
          exitPrice: Number(t.exitPrice || 0),
          outcome: t.outcome,
          rMultiple: Number(t.rMultiple || 0)
        });
      }
    } catch (e: any) {
      console.warn(`   ⚠️ Error running Sage Math Backtest for ${pair}:`, e?.message);
    }
  }

  const totalMathCount = allMathTrades.length;
  const totalMathNetR = allMathTrades.reduce((a, b) => a + b.rMultiple, 0);

  console.log(`   ✅ Tier 1 Math Backtests Complete: Total Trades = ${totalMathCount}, Total Net R = ${totalMathNetR.toFixed(2)}R`);

  // ── Step 2: Run Tier 2 Portfolio Shadow Backtester ──
  console.log(`\n2️⃣  Running Tier 2 Portfolio Shadow Backtester...`);
  const shadowTradesRaw = await runPortfolioShadowBacktest(startDate, endDate, 0);

  const shadowPairSummary: Record<string, { trades: number; netR: number }> = {};
  const allShadowTrades: any[] = shadowTradesRaw || [];

  for (const t of allShadowTrades) {
    const botIdUpper = (t.botId || '').toUpperCase();
    const isMage = botIdUpper.includes('MAGE') || t.clientId?.toUpperCase().startsWith('M_');
    const isSage = botIdUpper.includes('SAGE') || t.clientId?.toUpperCase().startsWith('S_');
    const botStr = isMage ? 'MAGE' : isSage ? 'SAGE' : 'UNKNOWN';
    const cleanPair = t.symbol.replace('.Daily', '');
    const key = `${botStr}_${cleanPair}`;

    if (!shadowPairSummary[key]) {
      shadowPairSummary[key] = { trades: 0, netR: 0 };
    }
    shadowPairSummary[key].trades++;
    shadowPairSummary[key].netR += t.rMultiple || 0;
  }

  const totalShadowCount = allShadowTrades.length;
  const totalShadowNetR = allShadowTrades.reduce((a: number, b: any) => a + (b.rMultiple || 0), 0);

  console.log(`   ✅ Tier 2 Portfolio Shadow Backtest Complete: Total Trades = ${totalShadowCount}, Total Net R = ${totalShadowNetR.toFixed(2)}R`);

  // ── Step 3: Comparative Analysis & Trade-by-Trade Alignment ──
  console.log(`\n======================================================`);
  console.log(`🔬 PER-PAIR / BOT SUMMARY & PARITY AUDIT`);
  console.log(`======================================================`);

  let reportStr = `PORTFOLIO PARITY REPORT (${startDate} to ${endDate})\n======================================================\n`;

  const allKeys = Array.from(new Set([...Object.keys(mathPairSummary), ...Object.keys(shadowPairSummary)])).sort();
  
  let overallPass = true;
  let totalDiscrepancies = 0;

  for (const key of allKeys) {
    const mathData = mathPairSummary[key] || { trades: 0, netR: 0 };
    const shadowData = shadowPairSummary[key] || { trades: 0, netR: 0 };

    const countDiff = Math.abs(mathData.trades - shadowData.trades);
    const rDiff = Math.abs(mathData.netR - shadowData.netR);
    const match = countDiff === 0 && rDiff <= Math.max(0.1, mathData.trades * 0.035);

    if (!match) overallPass = false;

    const line = `[${key.padEnd(15)}]: Math = ${String(mathData.trades).padStart(3)}T / ${mathData.netR.toFixed(2).padStart(6)}R | Shadow = ${String(shadowData.trades).padStart(3)}T / ${shadowData.netR.toFixed(2).padStart(6)}R | Status: ${match ? '✅ MATCH' : '❌ DISCREPANCY'}`;
    console.log(line);
    reportStr += line + '\n';

    // Detailed per-pair trade alignment check
    const [botStr, pairStr] = key.split('_');
    const pairMathTrades = allMathTrades.filter(t => t.bot === botStr && (t.pair === pairStr || t.pair === `${pairStr}.Daily`));
    const pairShadowTrades = allShadowTrades.filter(t => {
      const bUpper = (t.botId || '').toUpperCase();
      const isBotMatch = botStr === 'MAGE' 
        ? (bUpper.includes('MAGE') || t.clientId?.toUpperCase().startsWith('M_'))
        : (bUpper.includes('SAGE') || t.clientId?.toUpperCase().startsWith('S_'));
      return isBotMatch && (t.symbol === pairStr || t.symbol === `${pairStr}.Daily`);
    });

    pairMathTrades.sort((a, b) => a.timestamp - b.timestamp);
    pairShadowTrades.sort((a, b) => a.openTime - b.openTime);

    let mIdx = 0;
    let sIdx = 0;

    while (mIdx < pairMathTrades.length || sIdx < pairShadowTrades.length) {
      const mT = pairMathTrades[mIdx];
      const sT = pairShadowTrades[sIdx];

      if (!mT && sT) {
        const msg = `   ❌ [GHOST TRADE] Shadow took trade at ${new Date(sT.openTime).toISOString()} (${sT.symbol}) that Math did not.`;
        console.log(msg);
        reportStr += msg + '\n';
        sIdx++;
        totalDiscrepancies++;
        continue;
      }
      if (mT && !sT) {
        const msg = `   ❌ [MISSED TRADE] Math took trade at ${new Date(mT.timestamp).toISOString()} (${mT.pair}) that Shadow missed.`;
        console.log(msg);
        reportStr += msg + '\n';
        mIdx++;
        totalDiscrepancies++;
        continue;
      }

      const tDiffMs = Math.abs(mT.timestamp - sT.openTime);
      if (tDiffMs > 5 * 60 * 1000) {
        if (mT.timestamp < sT.openTime) {
          const msg = `   ❌ [MISSED TRADE] Math took trade at ${new Date(mT.timestamp).toISOString()} that Shadow missed.`;
          console.log(msg);
          reportStr += msg + '\n';
          mIdx++;
        } else {
          const msg = `   ❌ [GHOST TRADE] Shadow took trade at ${new Date(sT.openTime).toISOString()} that Math did not.`;
          console.log(msg);
          reportStr += msg + '\n';
          sIdx++;
        }
        totalDiscrepancies++;
        continue;
      }

      const tradeRDiff = Math.abs(mT.rMultiple - sT.rMultiple);
      if (tradeRDiff > 0.05) {
        const msg = `   ⚠️ [R DIFF] ${mT.date} ${mT.pair} ${botStr}: Math R = ${mT.rMultiple.toFixed(2)}, Shadow R = ${sT.rMultiple.toFixed(2)} (diff: ${(mT.rMultiple - sT.rMultiple).toFixed(2)})`;
        console.log(msg);
        reportStr += msg + '\n';
        totalDiscrepancies++;
      }

      mIdx++;
      sIdx++;
    }
  }

  console.log(`------------------------------------------------------`);
  console.log(`TOTAL MATH TRADES   : ${totalMathCount} | TOTAL MATH NET R   : ${totalMathNetR.toFixed(2)}R`);
  console.log(`TOTAL SHADOW TRADES : ${totalShadowCount} | TOTAL SHADOW NET R : ${totalShadowNetR.toFixed(2)}R`);
  console.log(`OVERALL PARITY STATUS: ${overallPass && totalDiscrepancies === 0 ? '✅ FLAWLESS PARITY' : '❌ DISCREPANCIES DETECTED (' + totalDiscrepancies + ' total)'}`);
  console.log(`======================================================`);

  const reportPath = path.join(process.cwd(), 'server', 'trading', 'testing', 'portfolio_parity_report.txt');
  fs.writeFileSync(reportPath, reportStr, 'utf-8');
  console.log(`\n[i] Full detailed report saved to: ${reportPath}\n`);
}

main().catch(console.error);
