/**
 * ATR Filter Comparison — MAGE Bot
 * Tests different maxRatio values for the ATR-Relative OR filter.
 */

import path from "path";
import fs from "fs";
import { loadCsv } from "../../../server/trading/backtester/loadCsv.js";
import { aggregateCandles } from "../../../server/trading/market/CandleAggregator.js";
import { buildAtrArray } from "../../../server/trading/market/Indicators.js";
import { OPTIMIZER_CONFIG } from "../../../server/trading/config/OptimizerPairConfig.js";
import { evaluateExits } from "../../../server/trading/backtester/math_core/MageMathCore.js";
import { isEODSession } from "../../../server/trading/market/MathFilters.js";
import { buildM1TypedArrays } from "../../../server/trading/backtester/math_core/MathCoreUtils.js";
import { SHADOW_MAGE_CONFIG } from "../../../server/trading/config/ShadowPortfolioConfig.js";
import { PairConfigManager } from "../../../server/trading/config/PairConfig.js";

const END_DATE   = new Date().toISOString().substring(0, 10);
const startRaw   = new Date();
startRaw.setMonth(startRaw.getMonth() - 6);
const START_DATE = startRaw.toISOString().substring(0, 10);

const ALL_MAGE_PAIRS = Object.keys(SHADOW_MAGE_CONFIG);

function preComputeTriggersWithRatio(
  m5Candles: any[],
  m1Rows: any[],
  atrArr: number[],
  pair: string,
  configs: any[],
  isForex: boolean,
  spreadPts: number,
  pipSize: number,
  maxRatio: number,
): any[] {
  const triggers: any[] = [];

  for (const mCfg of configs) {
    const startMins   = mCfg.orbStartHour! * 60 + mCfg.orbStartMin!;
    const orbMinutes  = mCfg.orbMinutes!;
    const minBodyPips = mCfg.minBodyPips;
    const sig = mCfg.signature || "default";

    let orHigh = -Infinity;
    let orLow  =  Infinity;
    let orStartTimestamp = 0;
    let mageTradeTaken   = false;

    for (let i = 0; i < m5Candles.length; i++) {
      const c = m5Candles[i];
      const estDate = new Date(c.timestamp);
      const estStr  = estDate.toLocaleString("en-US", { timeZone: "America/New_York" });
      const est     = new Date(estStr + " UTC");
      const h = est.getUTCHours();
      const m = est.getUTCMinutes();
      const currentMins = h * 60 + m;

      if (i > 0) {
        const prev = m5Candles[i - 1];
        const prevStr  = new Date(prev.timestamp).toLocaleString("en-US", { timeZone: "America/New_York" });
        const prevEst  = new Date(prevStr + " UTC");
        const prevH    = prevEst.getUTCHours();
        if ((prevH < 17 && h >= 17) || (prevH > h && h >= 17)) {
          orHigh = -Infinity;
          orLow  =  Infinity;
          orStartTimestamp = 0;
          mageTradeTaken   = false;
        }
      }

      if (mageTradeTaken) continue;

      if (currentMins >= startMins && currentMins < startMins + orbMinutes) {
        if (orHigh === -Infinity) orStartTimestamp = c.timestamp;
        if (c.high > orHigh) orHigh = c.high;
        if (c.low  < orLow)  orLow  = c.low;
        continue;
      }

      if (orHigh === -Infinity) continue;

      const actionCandleMins = currentMins;
      if (actionCandleMins < startMins + orbMinutes) continue;

      const endMins = mCfg.orbEndHour !== undefined
        ? mCfg.orbEndHour * 60 + (mCfg.orbEndMin || 0)
        : startMins + orbMinutes + (mCfg.actionMinutes || 180);
      const inWindow = endMins >= 1440
        ? (currentMins >= startMins + orbMinutes || currentMins < endMins % 1440)
        : (currentMins >= startMins + orbMinutes && currentMins < endMins);
      if (!inWindow) continue;

      const m1Idx = c.m1StartIndex ?? 0;

      const buyTriggered  = isForex ? c.close > orHigh : c.high >= (orHigh + spreadPts);
      const sellTriggered = isForex ? c.close < orLow  : c.low  <= orLow;

      if (!buyTriggered && !sellTriggered) continue;
      if (buyTriggered && sellTriggered)   continue;
      if (buyTriggered  && Math.max(c.open, c.close) < orHigh) continue;
      if (sellTriggered && Math.min(c.open, c.close) > orLow)  continue;

      const cBodyPips = parseFloat((Math.abs(c.close - c.open) / pipSize).toFixed(1));
      if (minBodyPips !== undefined && cBodyPips < minBodyPips) continue;

      // ATR-Relative OR Filter
      const minRatio = 0.35;
      const orPips   = (orHigh - orLow) / pipSize;
      const atrVal   = i >= 1 ? atrArr[i - 1] : 0;
      if (atrVal > 0) {
        const atr14Pips = atrVal / pipSize;
        const ratio     = Math.round((orPips / atr14Pips) * 100) / 100;
        if (ratio < minRatio || ratio > maxRatio) continue;
      }

      if (mCfg.maxSlDist !== undefined) {
        const orPips = (orHigh - orLow) / pipSize;
        if (orPips + (spreadPts / pipSize) > mCfg.maxSlDist) continue;
      }

      mageTradeTaken = true;

      const digits    = pipSize < 0.001 ? 5 : (pipSize < 0.01 ? 3 : (pipSize < 0.1 ? 2 : 1));
      const rOrHigh   = parseFloat(orHigh.toFixed(digits));
      const rOrLow    = parseFloat(orLow.toFixed(digits));
      const boxSize   = parseFloat(Math.abs(rOrHigh - rOrLow).toFixed(digits));

      triggers.push({
        m5Index: i,
        m1Index: Math.min(m1Rows.length - 1, m1Idx + 5),
        direction: buyTriggered ? "BUY" : "SELL",
        orHigh: rOrHigh,
        orLow: rOrLow,
        boxSize,
        cBodyPips,
        orStartTimestamp,
        signature: sig,
      });
    }
  }
  return triggers;
}


interface RunResult {
  pair: string;
  trades: number;
  netR: number;
}

async function runSinglePair(pair: string, maxRatio: number): Promise<RunResult> {
  const configs = SHADOW_MAGE_CONFIG[pair]?.filter((c: any) => !c.dummy);
  if (!configs || configs.length === 0) return { pair, trades: 0, netR: 0 };

  const baseSymbol = pair.replace(".Daily", "");
  const optConfig  = OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[baseSymbol];
  if (!optConfig) return { pair, trades: 0, netR: 0 };

  const { pipSize, spread } = optConfig;
  const spreadPts  = spread * pipSize;
  const isForex    = PairConfigManager.isForex(pair);

  const csvDir   = path.join(process.cwd(), "data", "csv");
  if (!fs.existsSync(csvDir)) {
      console.error(`CSV dir not found at ${csvDir}`);
      return { pair, trades: 0, netR: 0 };
  }
  const csvFiles = fs.readdirSync(csvDir).filter((f: string) => f.startsWith(pair.split("_")[0]) && f.endsWith(".csv"));
  if (!csvFiles.length) { return { pair, trades: 0, netR: 0 }; }

  const startD = new Date(new Date(START_DATE).getTime() - 15 * 86400000);
  const endD   = new Date(END_DATE + "T23:59:59Z");

  const m1Rows   = await loadCsv(path.join(csvDir, csvFiles[0]), spread, startD, endD);
  const m5Candles = aggregateCandles(m1Rows, 5);
  const atrArr    = buildAtrArray(m5Candles, 14);
  const m1Typed   = buildM1TypedArrays(m1Rows);

  const targetStartMs = new Date(START_DATE).getTime();

  const triggers = preComputeTriggersWithRatio(
    m5Candles, m1Rows, atrArr, pair, configs, isForex, spreadPts, pipSize, maxRatio
  );

  const resultObj = evaluateExits(
    m1Typed, m5Candles, triggers, pair, configs[0], pair.split("_")[1], isForex, 0
  );

  const validRecords = resultObj.records.filter((r: any) => r.outcome !== "SKIPPED" && r.outcome !== "NO_TRADE" && new Date(r.date).getTime() >= targetStartMs);
  let netR = 0;
  for (const r of validRecords) netR += (r.rMultiple || 0);

  return {
    pair,
    trades: validRecords.length,
    netR,
  };
}

async function main() {
  const maxRatios = [1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5];
  
  console.log(`Starting ATR Filter Optimization Analysis for MAGE (last 6 months)`);
  console.log(`Testing Max Ratios: ${maxRatios.join(", ")}\n`);

  const resultsByRatio: Record<number, { totalNetR: number, totalTrades: number, pairs: any[] }> = {};
  for (const r of maxRatios) {
    resultsByRatio[r] = { totalNetR: 0, totalTrades: 0, pairs: [] };
  }

  for (const pair of ALL_MAGE_PAIRS) {
    process.stdout.write(`Evaluating ${pair}...`);
    for (const ratio of maxRatios) {
      const res = await runSinglePair(pair, ratio);
      resultsByRatio[ratio].pairs.push(res);
      resultsByRatio[ratio].totalNetR += res.netR;
      resultsByRatio[ratio].totalTrades += res.trades;
    }
    process.stdout.write(` Done.\n`);
  }

  console.log(`\n================= RESULTS =================`);
  for (const ratio of maxRatios) {
    const data = resultsByRatio[ratio];
    console.log(`ATR Max Ratio: ${ratio.toFixed(1)} | Total Net R: ${data.totalNetR.toFixed(2)} | Total Trades: ${data.totalTrades}`);
  }

  console.log(`\n--- Best Performers ---`);
  let bestRatio = 1.5;
  let bestR = resultsByRatio[1.5].totalNetR;
  for (const ratio of maxRatios) {
      if (resultsByRatio[ratio].totalNetR > bestR) {
          bestR = resultsByRatio[ratio].totalNetR;
          bestRatio = ratio;
      }
  }
  
  console.log(`BEST RATIO: ${bestRatio.toFixed(1)} with ${bestR.toFixed(2)}R`);

  let md = `# MAGE ATR Filter Max Ratio Optimization (Last 6 Months)\n\n`;
  md += `| Max Ratio | Total Net R | Total Trades |\n`;
  md += `|-----------|-------------|--------------|\n`;
  for (const ratio of maxRatios) {
    const data = resultsByRatio[ratio];
    md += `| **${ratio.toFixed(1)}**${ratio === bestRatio ? ' 🏆' : ''} | ${data.totalNetR.toFixed(2)}R | ${data.totalTrades} |\n`;
  }
  md += `\n## Pair Breakdown\n\n`;
  
  md += `| Pair |`;
  for (const ratio of maxRatios) md += ` ${ratio.toFixed(1)} Net R |`;
  md += `\n|---|`;
  for (const ratio of maxRatios) md += `---|`;
  md += `\n`;

  for (const pair of ALL_MAGE_PAIRS) {
      md += `| ${pair} |`;
      for (const ratio of maxRatios) {
          const pData = resultsByRatio[ratio].pairs.find(p => p.pair === pair);
          md += ` ${pData ? pData.netR.toFixed(2) + 'R (' + pData.trades + ')' : 'N/A'} |`;
      }
      md += `\n`;
  }

  fs.writeFileSync("C:/Users/tazim/.gemini/antigravity/brain/b2f5fb21-b306-4513-8cf6-5dacb6d1c255/atr_max_ratio_results.md", md);
  console.log("\nResults written to atr_max_ratio_results.md artifact.");
}

main().catch(console.error);
