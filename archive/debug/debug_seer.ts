import fs from "fs";
import path from "path";
import { loadCsv, getLatestDate } from "../../backtester/loadCsv.js";
import { aggregateCandles } from "../../market/CandleAggregator.js";
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";
import { isNewsForceClose } from "../../market/historicalNews.js";
import { getFixedEstDate } from "../../backtester/math_core/MathCoreUtils.js";
import { buildEmaArray, buildBollingerArray, buildRsiArray } from "../../market/Indicators.js";
import { DailyContextTracker } from "../../market/DailyContextTracker.js";
import { evaluateStacyBurkeSetup } from "../../market/SeerMathCore.js";
import { parseSeerConfig } from "./seer_optimizer.js";

async function run() {
  const symbol = "XAUUSD";
  const stateFile = path.join(process.cwd(), "server/trading/optimizer/seer/seer_optimizer_dump/state_XAUUSD.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  const best = state[0];
  console.log("Testing setup:", best.setup);

  const parsed = parseSeerConfig(best.setup);
  if (!parsed) return;
  const { session, config } = parsed;
  const { minBodyPips, pinBarWickBodyRatio, minSlDist: minSl, maxSlDist: maxSl, forceCloseHours: fcHours } = config;

  const csvFile = path.join(process.cwd(), `data/csv/${symbol}_M1.csv`);
  const optCfg = OPTIMIZER_CONFIG[symbol];
  const endDate = getLatestDate(csvFile);
  const startDate = new Date(endDate.getTime());
  startDate.setFullYear(startDate.getFullYear() - 3.0);
  
  const m1Rows = await loadCsv(csvFile, optCfg.spread, startDate, endDate);
  const m5Candles = aggregateCandles(m1Rows, 5);
  const emaArr = buildEmaArray(m5Candles, 20);
  const bbArr = buildBollingerArray(m5Candles, 20, 2.0);
  const rsiArr = buildRsiArray(m5Candles, 14);

  const pipSize = optCfg.pipSize;
  const askSpread = optCfg.spread * pipSize;

  const t = [];
  const dailyTracker = new DailyContextTracker();
  let day3High = -Infinity;
  let day3Low = Infinity;
  let lastEstHour = -1;
  let sessionTradeTaken = false;

  for (let i = 2; i < m5Candles.length - 1; i++) {
    const c = m5Candles[i];
    dailyTracker.processCandle(c);

    if (lastEstHour !== -1 && ((lastEstHour < 17 && c.estHour >= 17) || (lastEstHour > c.estHour && c.estHour >= 17))) {
      day3High = -Infinity;
      day3Low = Infinity;
      sessionTradeTaken = false;
    }
    if (c.high > day3High) day3High = c.high;
    if (c.low < day3Low) day3Low = c.low;
    lastEstHour = c.estHour;

    const isNY = c.estHour >= 9 && c.estHour < 13;
    const isAsia = c.estHour >= 20 && c.estHour < 23;
    const isLondon = c.estHour >= 2 && c.estHour < 5;

    let inWindow = false;
    if (session === 'asia' && isAsia) inWindow = true;
    if (session === 'london' && isLondon) inWindow = true;
    if (session === 'ny' && isNY) inWindow = true;

    if (inWindow && !sessionTradeTaken) {
      const prevDay = dailyTracker.getPreviousDayContext();
      if (prevDay) {
        let covenSetup = 'NONE';
        if (prevDay.isFirstRedDay) covenSetup = 'FRD';
        else if (prevDay.isFirstGreenDay) covenSetup = 'FGD';
        else if (prevDay.isDay3BreakoutLongs) covenSetup = 'DAY3_LONG';
        else if (prevDay.isDay3BreakoutShorts) covenSetup = 'DAY3_SHORT';
        else if (prevDay.isInsideDay) covenSetup = 'INSIDE_DAY';
        else if (prevDay.isTrendingLong) covenSetup = 'LHF_LONG';
        else if (prevDay.isTrendingShort) covenSetup = 'LHF_SHORT';

        const prevC = m5Candles[i - 1];
        const cfg = { minBodyPips, pinBarWickBodyRatio };
        const mathResult = evaluateStacyBurkeSetup(c, prevC, emaArr[i] as any, prevDay, covenSetup, cfg as any, pipSize, symbol, false, day3High, day3Low, bbArr[i-1], rsiArr[i-1]);

        if (mathResult) {
          sessionTradeTaken = true;
          t.push({ m5Index: i, direction: mathResult.direction, c });
        }
      }
    }
  }

  for (const tr of t) {
    const { m5Index: i, direction, c } = tr;
    const entry = direction === 'BUY' ? c.close + askSpread : c.close;
    let proposedSl = direction === 'BUY' ? c.low - (2 * pipSize) : c.high + (2 * pipSize) + askSpread;

    const slDistPips = Math.abs(entry - proposedSl) / pipSize;
    if (slDistPips < minSl) {
      proposedSl = direction === 'BUY' ? entry - (minSl * pipSize) : entry + (minSl * pipSize);
    } else if (slDistPips > maxSl) {
      proposedSl = direction === 'BUY' ? entry - (maxSl * pipSize) : entry + (maxSl * pipSize);
    }

    const riskPips = Math.abs(entry - proposedSl) / pipSize;
    const tpDist = 100 * pipSize;
    const tp = direction === 'BUY' ? entry + tpDist : entry - tpDist;

    let sl = proposedSl;
    let currentSl = sl;
    let lastConfirmedSL = sl;
    let secondLastConfirmedSL = sl;
    let unconfirmedSwingLow: number | null = null;
    let lastSwingHigh: number | null = null;

    let lastConfirmedSH = sl;
    let secondLastConfirmedSH = sl;
    let unconfirmedSwingHigh: number | null = null;
    let lastSwingLow: number | null = null;

    let outcome = '';
    let exitPrice = 0;
    let lastFcEstHour = c.estHour;
    let hasTakenPartial = false;
    let highestProfitPips = 0;

    for (let j = i + 1; j < Math.min(i + Math.floor((fcHours * 60) / 5), m5Candles.length); j++) {
      const fc = m5Candles[j];
      const dateStr = getFixedEstDate(new Date(fc.timestamp)).toISOString().split("T")[0];
      const isNewsForceCloseLocal = isNewsForceClose(dateStr, fc.estHour, fc.minute);
      const is1700Rollover = lastFcEstHour !== -1 && ((lastFcEstHour < 17 && fc.estHour >= 17) || (lastFcEstHour > fc.estHour && fc.estHour >= 17));
      lastFcEstHour = fc.estHour;

      if (is1700Rollover || isNewsForceCloseLocal) { 
        outcome = isNewsForceCloseLocal ? 'NEWS_CLOSE' : 'EOD'; 
        exitPrice = direction === 'SELL' ? fc.close + askSpread : fc.close; 
        break; 
      }

      if (direction === 'SELL') {
        if (fc.high + askSpread >= currentSl) { outcome = 'SL'; exitPrice = currentSl; break; }
        if (fc.low + askSpread <= tp) { outcome = 'TP'; exitPrice = tp; break; }
      } else {
        if (fc.low <= currentSl) { outcome = 'SL'; exitPrice = currentSl; break; }
        if (fc.high >= tp) { outcome = 'TP'; exitPrice = tp; break; }
      }

      const profitPips = direction === 'SELL' ? (entry - (fc.low + askSpread)) / pipSize : (fc.high - entry) / pipSize;
      if (profitPips > highestProfitPips) highestProfitPips = profitPips;

      if (!hasTakenPartial && profitPips >= (1.5 * riskPips)) {
        hasTakenPartial = true;
        const bePips = 2.0;
        const bePrice = direction === 'SELL' ? entry - (bePips * pipSize) : entry + (bePips * pipSize);
        let moveSl = false;
        if (direction === 'BUY' && sl < bePrice) moveSl = true;
        else if (direction === 'SELL' && sl > bePrice) moveSl = true;
        if (moveSl) {
           sl = bePrice;
           currentSl = bePrice;
           lastConfirmedSL = sl;
           secondLastConfirmedSL = sl;
           lastConfirmedSH = sl;
           secondLastConfirmedSH = sl;
        }
      }

      if (j >= 4) {
        const c0 = m5Candles[j];
        const c1 = m5Candles[j-1];
        const c2 = m5Candles[j-2];
        const c3 = m5Candles[j-3];
        const c4 = m5Candles[j-4];

        if (direction === 'BUY') {
          if (c2.low < c0.low && c2.low < c1.low && c2.low < c3.low && c2.low < c4.low) unconfirmedSwingLow = c2.low;
          if (c2.high > c0.high && c2.high > c1.high && c2.high > c3.high && c2.high > c4.high) lastSwingHigh = c2.high;
          if (lastSwingHigh !== null && unconfirmedSwingLow !== null) {
            if (c0.close > lastSwingHigh) {
              if (unconfirmedSwingLow !== lastConfirmedSL) {
                secondLastConfirmedSL = lastConfirmedSL;
                lastConfirmedSL = unconfirmedSwingLow;
                if (secondLastConfirmedSL > currentSl) {
                  currentSl = secondLastConfirmedSL - pipSize;
                }
              }
            }
          }
        } else {
          if (c2.high > c0.high && c2.high > c1.high && c2.high > c3.high && c2.high > c4.high) unconfirmedSwingHigh = c2.high;
          if (c2.low < c0.low && c2.low < c1.low && c2.low < c3.low && c2.low < c4.low) lastSwingLow = c2.low;
          if (lastSwingLow !== null && unconfirmedSwingHigh !== null) {
            if (c0.close < lastSwingLow) {
              if (unconfirmedSwingHigh !== lastConfirmedSH) {
                secondLastConfirmedSH = lastConfirmedSH;
                lastConfirmedSH = unconfirmedSwingHigh;
                if (secondLastConfirmedSH < currentSl) {
                  currentSl = secondLastConfirmedSH + pipSize;
                }
              }
            }
          }
        }
      }
    }

    if (!outcome) {
      outcome = 'FORCE_CLOSE';
      exitPrice = direction === 'SELL' ? m5Candles[Math.min(i + Math.floor((fcHours * 60) / 5) - 1, m5Candles.length - 1)].close + askSpread : m5Candles[Math.min(i + Math.floor((fcHours * 60) / 5) - 1, m5Candles.length - 1)].close;
    }

    const finalPips = direction === 'SELL' ? (entry - exitPrice) / pipSize : (exitPrice - entry) / pipSize;
    let blendedPips = finalPips;
    if (hasTakenPartial) {
       const partialPips = 1.5 * riskPips;
       blendedPips = (partialPips * 0.5) + (finalPips * 0.5);
    }

    const rMultiple = blendedPips / riskPips;
    const dateStr = getFixedEstDate(new Date(c.timestamp)).toISOString().split("T")[0];
    
    console.log(`[TRADE] ${dateStr} ${direction} | rMultiple: ${rMultiple} | riskPips: ${riskPips} | entry: ${entry} | exitPrice: ${exitPrice} | outcome: ${outcome} | slDistPips: ${slDistPips}`);
    console.log(`   finalPips: ${finalPips} | blendedPips: ${blendedPips} | minSl: ${minSl} | proposedSl: ${proposedSl}`);
  }
}

run();
