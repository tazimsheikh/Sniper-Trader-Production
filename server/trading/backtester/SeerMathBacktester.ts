// ============================================================
// VISION BACKTESTER
// Runs Stacy Burke's FRD/FGD setups through the Vision AI
// on HISTORICAL data to prove the edge before going live.
//
// How it works:
// 1. Loads M5 historical candles
// 2. Uses DailyContextTracker to detect FRD/FGD days
// 3. At each trigger point (EMA crossover during session), 
//    renders the chart as it looked at that EXACT moment
// 4. Sends the chart to Vision AI for evaluation
// 5. If AI says TRADE, simulates the outcome
// 6. Reports P&L and win rate
// ============================================================
import path from 'path';
import fs from 'fs';
import { loadCsv } from './loadCsv.js';
import { aggregateCandles } from '../market/CandleAggregator.js';
import { buildEmaArray } from '../market/Indicators.js';
import { DailyContextTracker } from '../market/DailyContextTracker.js';
import { HTFContextTracker } from '../market/HTFContextTracker.js';

import { evaluateStacyBurkeSetup } from './math_core/SeerMathCore.js';
import { isNewsForceClose } from "../market/historicalNews.js";
import { isSeerRolloverHalt } from "../market/MathFilters.js";
import { getFixedEstDate } from "./math_core/MathCoreUtils.js";
import type { VisionDecision } from '../ai/VisionEvaluator.js';
import { SEER_PAIR_CONFIG, PairConfigManager } from '../config/PairConfig.js';
import { OPTIMIZER_CONFIG } from '../config/OptimizerPairConfig.js';
import { isTradeAllowed } from '../market/MathFilters.js';

interface VisionTradeRecord {
  timestamp: number;   // Precise epoch ms of the trigger candle — used for chronological cross-pair compounding
  date: string;
  pair: string;
  setupType: string;
  sessionName: string;
  decision: VisionDecision['decision'];
  confidence: number;
  setupQuality: string;
  reasoning: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskPips: number | null;
  // Simulated outcome
  outcome: 'TP' | 'SL' | 'EOD' | 'NEWS_CLOSE' | 'SKIPPED' | null;
  pips: number | null;
  mfePips?: number | null;
  rMultiple?: number;
  orHigh?: number;
  orLow?: number;
}

const CONFIDENCE_THRESHOLD = 0.70; // Only trade if AI is >= 70% confident
const CHART_WINDOW_BARS = 120;      // Expanded to 10 hours of M5 candles to capture macro PDH/PDL


const backtestCache = new Map<string, { m5Candles: any[]; emaArr: any }>();

export async function runMathBacktest(
  pair: string, 
  startDate?: string, 
  endDate?: string, 
  ignoreFilters: boolean = false,
  minSlOverride?: number,
  maxSlOverride?: number,
  extremeFilter: string | null = null
) {
  for (const key of backtestCache.keys()) {
    if (!key.startsWith(pair)) {
      backtestCache.delete(key);
    }
  }

  const normalizedPair = pair.split('.')[0].trim().toUpperCase();
  const isForex = PairConfigManager.isForex(normalizedPair);

  const configArr = SEER_PAIR_CONFIG[pair];
  if (!configArr || configArr.length === 0) throw new Error(`Unknown pair: ${pair}`);
  const config = configArr[0];

  const baseSymbol = pair.replace(".Daily", "");
  const optConfig = OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[baseSymbol];
  if (!optConfig) throw new Error(`No OPTIMIZER_CONFIG found for ${pair}`);

  const { tickSize, pipSize, spread } = optConfig;
  const askSpread = spread * pipSize;

  const cacheKey = `${pair}_${spread}_${startDate || ''}_${endDate || ''}`;
  let m5Candles: any[];
  let emaArr: any;

  if (backtestCache.has(cacheKey)) {
    const cached = backtestCache.get(cacheKey)!;
    m5Candles = cached.m5Candles;
    emaArr = cached.emaArr;
  } else {
    // Load data
    const csvFiles = fs.readdirSync(path.join(process.cwd(), 'data', 'csv'))
      .filter(f => f.startsWith(pair) && f.endsWith('.csv'));
    if (!csvFiles.length) throw new Error(`No CSV data found for ${pair}`);

    console.log(`🔱 Vision AI Backtest — ${pair}`);
    console.log(`📁 Loading: ${csvFiles[0]}`);
    const startD = startDate ? new Date(new Date(startDate).getTime() - 15 * 24 * 60 * 60 * 1000) : undefined;
    const endD = endDate ? new Date(endDate) : undefined;
    const m1Rows = await loadCsv(path.join(process.cwd(), 'data', 'csv', csvFiles[0]), spread, startD, endD);
    m5Candles = aggregateCandles(m1Rows, 5);
    emaArr = buildEmaArray(m5Candles, 20);
    
    backtestCache.set(cacheKey, { m5Candles, emaArr });
  }

  // Filter to date range if specified
  let globalStartIdx = 0;
  let globalEndIdx = m5Candles.length - 1;
  if (startDate || endDate) {
    const start = startDate ? new Date(startDate).getTime() : 0;
    const end = endDate ? new Date(endDate).getTime() + 86400000 : Infinity;
    globalStartIdx = m5Candles.findIndex(c => c.timestamp >= start);
    if (globalStartIdx === -1) globalStartIdx = 0;
    
    globalEndIdx = m5Candles.length - 1;
    while (globalEndIdx >= 0 && m5Candles[globalEndIdx].timestamp >= end) globalEndIdx--;
    
    console.log(`📅 Date range: ${startDate || 'start'} → ${endDate || 'end'} (Trading starts at index ${globalStartIdx})`);
  }
  
  console.log(`🕯️  ${m5Candles.length.toLocaleString()} M5 candles loaded`);

  const dailyTracker = new DailyContextTracker();
  
  const records: VisionTradeRecord[] = [];
  let day3High = -Infinity;
  let day3Low = Infinity;
  let lastEstHour = -1;
  let sessionTradeTaken = false;
  let aiLockoutUntil = 0;

  let orHigh = -Infinity;
  let orLow = Infinity;
  let orBuilt = false;
  let mageTradeTaken = false;

  const isJpyOrGold = pair.includes('JPY') || pair === 'XAUUSD';
  const isEurOrGbp = pair.includes('EUR') || pair === 'GBP' || pair === 'CHF';
  const isUsd = pair.includes('USD') || pair === 'CAD';
  const isIndex = !isJpyOrGold && !isEurOrGbp && !isUsd; 

  // Local DWCB Tracking (Per-Pair for Backtester)
  let localBalance = 10000;
  let localPeak = 10000;
  let dwcbTriggered = false;

  for (let i = 2; i < m5Candles.length - 1; i++) {
    const c = m5Candles[i];
    dailyTracker.processCandle(c);

    // If we have a startDate filter, skip trading until we reach the correct index,
    // but we still process the dailyTracker above to build historical context.
    if (i < globalStartIdx || i > globalEndIdx) continue;

    // Day rollover at 5 PM EST (17:00)
    if (lastEstHour !== -1 && ((lastEstHour < 17 && c.estHour >= 17) || (lastEstHour > c.estHour && c.estHour >= 17))) {
      day3High = -Infinity;
      day3Low = Infinity;
      sessionTradeTaken = false;
      orHigh = -Infinity;
      orLow = Infinity;
      orBuilt = false;
      mageTradeTaken = false;
    }
    const day3HighBeforeC = day3High;
    const day3LowBeforeC = day3Low;
    if (c.high > day3High) day3High = c.high;
    if (c.low < day3Low) day3Low = c.low;
    lastEstHour = c.estHour;

    let orbStartHour = config.orbStartHour !== undefined ? config.orbStartHour : 9;
    if (config.orbStartHour === undefined) {
      if (pair.includes('JPY')) orbStartHour = 20;
      else if (pair === 'GER40') orbStartHour = 3;
      else if (pair.includes('EUR') || pair.includes('GBP')) orbStartHour = 3;
      else if (pair === 'XAUUSD') orbStartHour = 8;
    }

    const isNY     = c.estHour >= (orbStartHour < 8 ? orbStartHour : 8) && c.estHour < 13; // (NY open)

    let sessions = config.sessions;
      if (!sessions) {
        if (pair.includes('JPY')) sessions = ['asia', 'london'];
        else if (pair.includes('EUR') || pair.includes('GBP')) sessions = ['london', 'NY_Forex'];
        else if (pair === 'XAUUSD') sessions = ['london', 'NY_Forex'];
        else sessions = ['NY_Forex'];
      }

    const isAsia   = c.estHour >= 20 && c.estHour < 23; // 8PM-11PM EST (Tokyo/Sydney)
    const isLondon = c.estHour >= 2  && c.estHour < 5;  // 2AM-5AM EST (Frankfurt/London open)

    let inWindow = false;
    for (const session of sessions) {
      if (session === 'asia' && isAsia) inWindow = true;
      if (session === 'london' && isLondon) inWindow = true;
      if (session === 'NY_Forex' && isNY) inWindow = true;
    }

    const prevDay = dailyTracker.getPreviousDayContext();
    let minBodyPips = config.minBodyPips;
    if (minBodyPips === undefined) {
      minBodyPips = 3.0; // Default for GBPUSD/EURUSD
      if (pair.includes('XAU')) minBodyPips = 20.0;
      else if (pair.includes('NAS')) minBodyPips = 20.0;
      else if (pair.includes('US30') || pair.includes('GER40')) minBodyPips = 20.0;
      else if (pair.includes('XTI')) minBodyPips = 1.5;
      else if (pair.includes('BTC')) minBodyPips = 7.5;
      else if (pair.includes('ETH')) minBodyPips = 2.0;
      else if (pair.includes('JPY') || pair.includes('AUD') || pair.includes('NZD') || pair.includes('CAD')) minBodyPips = 5.0;
    }
    const peakTolerance = 10 * pipSize;

    let triggerSetup: {
      setupType: string;
      direction: 'BUY' | 'SELL';
      isMage: boolean;
      orHigh?: number;
      orLow?: number;
      trapHigh?: number;
      trapLow?: number;
    } | null = null;

    // Coven Macro Bias Setup
    let covenBias: 'BUY' | 'SELL' | null = null;
    let covenSetup: string | null = null;
    if (prevDay) {
        if (prevDay.isFirstRedDay) { covenBias = 'SELL'; covenSetup = 'FRD'; }
        else if (prevDay.isFirstGreenDay) { covenBias = 'BUY'; covenSetup = 'FGD'; }
        else if (prevDay.isDay3BreakoutLongs) { covenBias = 'SELL'; covenSetup = 'DAY3_SHORT'; }
        else if (prevDay.isDay3BreakoutShorts) { covenBias = 'BUY'; covenSetup = 'DAY3_LONG'; }
        else if (prevDay.isTrendingLong) { covenBias = 'BUY'; covenSetup = 'LHF_LONG'; }
        else if (prevDay.isTrendingShort) { covenBias = 'SELL'; covenSetup = 'LHF_SHORT'; }
    }

    // 2. Evaluate Stacy Burke "Four Heads"
    let mathResult: { setupType: string; direction: 'BUY' | 'SELL'; isMage: boolean } | null = null;
    if (!extremeFilter && !triggerSetup && inWindow && !sessionTradeTaken && prevDay) {
      const ema20 = emaArr[i];
      const prevC = m5Candles[i - 1];
      if (ema20 && prevC) {
        // Coven macro bias logic is calculated earlier
        let safeCovenSetup = covenSetup || 'NONE';
        mathResult = evaluateStacyBurkeSetup(c, prevC, ema20, prevDay, safeCovenSetup, config, pipSize, pair, false, day3High, day3Low);
        if (!mathResult) {
          // If no Coven macro setup match, we also need to check pure price action setups like INSIDE_DAY and LHF
          const setupsToTest = [];
          if (prevDay.isInsideDay) setupsToTest.push('INSIDE_DAY');
          if (prevDay.isTrendingLong) setupsToTest.push('LHF_LONG');
          if (prevDay.isTrendingShort) setupsToTest.push('LHF_SHORT');
          
          for (const s of setupsToTest) {
            mathResult = evaluateStacyBurkeSetup(c, prevC, ema20, prevDay, s, config, pipSize, pair, false, day3High, day3Low);
            if (mathResult) break;
          }
        }
      }
    }

    if (mathResult) {
      let setupType = mathResult.setupType;
      let direction = mathResult.direction;

      if (setupType) {
        let banned = false;

        if (!banned) {
          const ema20 = emaArr[i];
          const prevC = m5Candles[i - 1];
          if (ema20 && prevC) {
            const pinBarWickBodyRatio = config.pinBarWickBodyRatio !== undefined ? config.pinBarWickBodyRatio : 1.5;
            const cBodyPips = Math.abs(c.close - c.open) / pipSize;
            const upperWickPips = (c.high - Math.max(c.open, c.close)) / pipSize;
            const lowerWickPips = (Math.min(c.open, c.close) - c.low) / pipSize;

            if (setupType === 'FRD' || setupType === 'FGD') {
               console.log(`[C DEBUG] ${c.dateStr} c.close=${c.close} c.open=${c.open} pipSize=${pipSize} type=${typeof c.close}`);
            }
            const isBearishEngulfing = c.close < c.open && prevC.close > prevC.open && c.open >= prevC.close && c.close <= prevC.open && cBodyPips >= minBodyPips;
            const isBullishEngulfing = c.close > c.open && prevC.close < prevC.open && c.open <= prevC.close && c.close >= prevC.open && cBodyPips >= minBodyPips;

            const isBearishPin = upperWickPips >= cBodyPips * pinBarWickBodyRatio && upperWickPips >= minBodyPips && lowerWickPips <= Math.max(2.0, cBodyPips);
            const isBullishPin = lowerWickPips >= cBodyPips * pinBarWickBodyRatio && lowerWickPips >= minBodyPips && upperWickPips <= Math.max(2.0, cBodyPips);

            const isBearishTrigger = isBearishEngulfing || isBearishPin;
            const isBullishTrigger = isBullishEngulfing || isBullishPin;

            let isEngulfing = false;
            let expectedDirection = '';

            if (setupType === 'FRD' || setupType === 'DAY3_LONG') {
              if (isBearishTrigger) {
                expectedDirection = 'SELL';
                if (setupType === 'DAY3_LONG') {
                  if (day3HighBeforeC !== -Infinity && (prevC.high >= day3HighBeforeC - peakTolerance || c.high >= day3HighBeforeC - peakTolerance)) isEngulfing = true;
                } else {
                  if (c.high > (prevDay.high - (prevDay.high - prevDay.low) * 0.3)) isEngulfing = true;
                }
              }
              if (setupType === 'FRD' && isBullishTrigger) {
                expectedDirection = 'BUY';
                if (c.low < (prevDay.low + (prevDay.high - prevDay.low) * 0.3)) isEngulfing = true;
              }
            } else if (setupType === 'FGD' || setupType === 'DAY3_SHORT') {
              if (isBullishTrigger) {
                expectedDirection = 'BUY';
                if (setupType === 'DAY3_SHORT') {
                  if (day3LowBeforeC !== Infinity && (prevC.low <= day3LowBeforeC + peakTolerance || c.low <= day3LowBeforeC + peakTolerance)) isEngulfing = true;
                } else {
                  if (c.low < (prevDay.low + (prevDay.high - prevDay.low) * 0.3)) isEngulfing = true;
                }
              }
              if (setupType === 'FGD' && isBearishTrigger) {
                expectedDirection = 'SELL';
                if (c.high > (prevDay.high - (prevDay.high - prevDay.low) * 0.3)) isEngulfing = true;
              }
            } else if (setupType === 'INSIDE_DAY') {
              if (isBearishTrigger && (prevC.high > prevDay.high || c.high > prevDay.high)) {
                isEngulfing = true;
                expectedDirection = 'SELL';
              } else if (isBullishTrigger && (prevC.low < prevDay.low || c.low < prevDay.low)) {
                isEngulfing = true;
                expectedDirection = 'BUY';
              }
            } else if (setupType === 'LHF_LONG') {
              if (isBullishTrigger && c.low <= ema20 && c.close > ema20) {
                isEngulfing = true;
                expectedDirection = 'BUY';
              }
            } else if (setupType === 'LHF_SHORT') {
              if (isBearishTrigger && c.high >= ema20 && c.close < ema20) {
                isEngulfing = true;
                expectedDirection = 'SELL';
              }
            }

            if (isEngulfing) {
              const emaDistance = Math.abs(c.close - ema20) / pipSize;
              let emaFilterPassed = true;
              if (config.maxEmaDistance !== undefined && config.maxEmaDistance > 0 && emaDistance > config.maxEmaDistance) emaFilterPassed = false;
              if (config.minEmaDistance !== undefined && config.minEmaDistance > 0 && emaDistance < config.minEmaDistance) emaFilterPassed = false;

              let allowed = true;
              if (!ignoreFilters) {
                allowed = isTradeAllowed({ pair, setupType, timestamp: c.timestamp });
              }

              if (emaFilterPassed && allowed) {
                triggerSetup = {
                  setupType,
                  direction: expectedDirection as 'BUY' | 'SELL',
                  isMage: false
                };
              }
            }
          }
        }
      }
    }

    if (!triggerSetup) continue;

      const setupType = triggerSetup.setupType;
      const expectedDirection = triggerSetup.direction;

      // DWCB Pre-Flight Check
      const currentDd = (localPeak - localBalance) / localPeak;
      if (currentDd >= 0.29) {
         if (!dwcbTriggered) {
            console.log(`[DWCB] 🛑 ${pair} hit 29% Drawdown (${(currentDd*100).toFixed(1)}%). Halting all future trades.`);
            dwcbTriggered = true;
         }
         continue;
      }

      // === MATH BOT BYPASS ===
      // We completely bypass the Vision AI and just accept the mathematical setup.
      const evalDecision = {
        decision: expectedDirection as 'BUY' | 'SELL' | 'NO_TRADE',
        confidence: 1.0,
        setupQuality: 'A',
        reasoning: 'Math strictly valid',
        entry: null as number | null,
        stopLoss: null as number | null,
        takeProfit: null as number | null,
        riskPips: null as number | null
      };

      const record: VisionTradeRecord & { hypotheticalOutcome?: string, hypotheticalPips?: number } = {
        timestamp: c.timestamp,
        date: getFixedEstDate(new Date(c.timestamp)).toISOString().split('T')[0],
        pair,
        setupType,
        sessionName: isLondon ? 'London Open' : isNY ? 'New York Open' : 'Asia Open',
        decision: evalDecision.decision,
        confidence: evalDecision.confidence,
        setupQuality: evalDecision.setupQuality,
        reasoning: evalDecision.reasoning,
        entry: evalDecision.entry,
        stopLoss: evalDecision.stopLoss,
        takeProfit: evalDecision.takeProfit,
        riskPips: evalDecision.riskPips,
        outcome: null,
        pips: null,
      };

      const direction = evalDecision.decision === 'NO_TRADE' ? expectedDirection : evalDecision.decision;
      let isSkipped = evalDecision.decision === 'NO_TRADE' || evalDecision.confidence < CONFIDENCE_THRESHOLD;
      const entry = evalDecision.entry || (direction === 'SELL' ? c.close : c.close + askSpread);
      const isVolatile = pair.includes('XAU') || pair.includes('NAS') || pair.includes('US30') || pair.includes('GER40') || pair.includes('GBPJPY') || pair.includes('GBPCAD') || pair.includes('GBPNZD') || pair.includes('EURNZD');

      // Resolve Stop Loss distances dynamically
      let minSlDist: number;
      if (config.minSlDist !== undefined) {
        minSlDist = config.minSlDist * pipSize;
      } else {
        minSlDist = (isVolatile ? 40 : 20) * pipSize;
        if (pair.includes('XTI')) minSlDist = 15.0 * pipSize;
      }

      let maxSlDist: number;
      if (config.maxSlDist !== undefined) {
        maxSlDist = config.maxSlDist * pipSize;
      } else {
        let maxPips = 40;
        if (pair.includes('BTC')) maxPips = 250;
        else if (pair.includes('ETH')) maxPips = 150;
        if (pair.includes('XAU')) maxPips = 100;
        else if (pair.includes('NAS') || pair.includes('US30') || pair.includes('GER40')) maxPips = 250;
        maxSlDist = maxPips * pipSize;
      }

      const trapPrevC = m5Candles[i-1];
      const trapHigh = Math.max(c.high, trapPrevC.high);
      const trapLow = Math.min(c.low, trapPrevC.low);
      let sl = direction === 'SELL' ? (trapHigh + askSpread + (10 * pipSize)) : (trapLow - (10 * pipSize));

      const minTpDist = config.minTpDist !== undefined ? config.minTpDist * pipSize : (isVolatile ? 40 : 20) * pipSize;
      const defaultTpDist = config.defaultTpDist !== undefined ? config.defaultTpDist * pipSize : (isVolatile ? 100 : 40) * pipSize;
      const maxTpDist = config.maxTpDist !== undefined ? config.maxTpDist * pipSize : (isVolatile ? 100 : 50) * pipSize;
      let tp = entry;

      const pDay = prevDay!;
      if (direction === 'SELL') {
        if (entry - day3Low >= minTpDist) tp = Math.max(day3Low, entry - maxTpDist);
        else if (entry - pDay.low >= minTpDist) tp = Math.max(pDay.low, entry - maxTpDist);
        else tp = entry - defaultTpDist;
      } else {
        if (day3High - entry >= minTpDist) tp = Math.min(day3High, entry + maxTpDist);
        else if (pDay.high - entry >= minTpDist) tp = Math.min(pDay.high, entry + maxTpDist);
        else tp = entry + defaultTpDist;
      }

      const slDist = Math.abs(entry - sl);
      if (!isSkipped && slDist > maxSlDist) {
          console.log(`   [REJECTED] Structural SL is too wide: ${(slDist / pipSize).toFixed(1)} pips (> ${maxSlDist / pipSize} pips). Skipping trade.`);
          isSkipped = true;
      }

      if (direction === 'SELL' && sl < entry + minSlDist) sl = entry + minSlDist;
      if (direction === 'BUY' && sl > entry - minSlDist) sl = entry - minSlDist;

      const riskPips = Math.abs(entry - sl) / (pipSize);

      let outcome: 'TP' | 'SL' | 'EOD' | 'NEWS_CLOSE' = 'EOD';
      let exitPrice = entry;

      let currentSl = sl;
      let unconfirmedSwingLow: number | null = null;
      let unconfirmedSwingHigh: number | null = null;
      let lastSwingHigh: number | null = null;
      let lastSwingLow: number | null = null;
      let lastConfirmedSL = sl;
      let secondLastConfirmedSL = sl;
      let lastConfirmedSH = sl;
      let secondLastConfirmedSH = sl;
      let highestProfitPips = 0;
      let hasTakenPartial = false;

      for (let j = i + 1; j < Math.min(i + 200, m5Candles.length); j++) {
        const fc = m5Candles[j];

        const fcMin = new Date(fc.timestamp).getUTCMinutes();
        const dateStr = getFixedEstDate(new Date(fc.timestamp)).toISOString().split("T")[0];
        const isNewsForceCloseLocal = isNewsForceClose(dateStr, fc.estHour, fc.minute);

        if (fc.estHour >= 17 || isSeerRolloverHalt(fc.estHour, fcMin) || isNewsForceCloseLocal) { 
          outcome = isNewsForceCloseLocal ? 'NEWS_CLOSE' : 'EOD'; 
          exitPrice = direction === 'SELL' ? fc.close + askSpread : fc.close; 
          break; 
        }

        const profitPips = direction === 'SELL' ? (entry - (fc.low + askSpread)) / (pipSize) : (fc.high - entry) / (pipSize);
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
             console.log(`   [1.5R HIT] Partial 50% secured. SL moved to BE+2 (${sl.toFixed(5)}).`);
          } else {
             console.log(`   [1.5R HIT] Partial 50% secured. (SL already better than BE).`);
          }
        }

        if (j >= 4) {
          const c0 = m5Candles[j];
          const c1 = m5Candles[j-1];
          const c2 = m5Candles[j-2];
          const c3 = m5Candles[j-3];
          const c4 = m5Candles[j-4];

          if (direction === 'BUY') {
            if (c2.low < c0.low && c2.low < c1.low && c2.low < c3.low && c2.low < c4.low) {
              unconfirmedSwingLow = c2.low;
            }
            if (c2.high > c0.high && c2.high > c1.high && c2.high > c3.high && c2.high > c4.high) {
              lastSwingHigh = c2.high;
            }
            if (lastSwingHigh !== null && unconfirmedSwingLow !== null) {
              if (c0.close > lastSwingHigh) {
                if (unconfirmedSwingLow !== lastConfirmedSL) {
                  secondLastConfirmedSL = lastConfirmedSL;
                  lastConfirmedSL = unconfirmedSwingLow;
                  if (secondLastConfirmedSL > currentSl) {
                    currentSl = secondLastConfirmedSL - (pipSize);
                  }
                }
              }
            }
          } else if (direction === 'SELL') {
            if (c2.high > c0.high && c2.high > c1.high && c2.high > c3.high && c2.high > c4.high) {
              unconfirmedSwingHigh = c2.high;
            }
            if (c2.low < c0.low && c2.low < c1.low && c2.low < c3.low && c2.low < c4.low) {
              lastSwingLow = c2.low;
            }
            if (lastSwingLow !== null && unconfirmedSwingHigh !== null) {
              if (c0.close < lastSwingLow) {
                if (unconfirmedSwingHigh !== lastConfirmedSH) {
                  secondLastConfirmedSH = lastConfirmedSH;
                  lastConfirmedSH = unconfirmedSwingHigh;
                  if (secondLastConfirmedSH < currentSl) {
                    currentSl = secondLastConfirmedSH + askSpread + (pipSize);
                  }
                }
              }
            }
          }
        }

        if (direction === 'SELL') {
          if (fc.high + askSpread >= currentSl) { outcome = 'SL'; exitPrice = currentSl; break; }
          if (fc.low + askSpread <= tp) { outcome = 'TP'; exitPrice = tp; break; }
        } else {
          if (fc.low <= currentSl) { outcome = 'SL'; exitPrice = currentSl; break; }
          if (fc.high >= tp) { outcome = 'TP'; exitPrice = tp; break; }
        }
      }

      let finalPips = direction === 'SELL'
        ? (entry - exitPrice) / (pipSize)
        : (exitPrice - entry) / (pipSize);

      let blendedPips = finalPips;
      if (hasTakenPartial) {
         const partialPips = 1.5 * riskPips;
         blendedPips = (partialPips * 0.5) + (finalPips * 0.5);
      }

      const rMultiple = blendedPips / riskPips;
      const boundedDD = Math.max(0, Math.min(currentDd, 0.29));
      const dwcbMultiplier = Math.max(0, 1 - Math.pow(boundedDD / 0.29, 2));
      const riskAmount = localBalance * 0.10 * dwcbMultiplier;
      const profit = riskAmount * rMultiple;

      localBalance += profit;
      if (localBalance > localPeak) localPeak = localBalance;

      if (isSkipped) {
        record.outcome = 'SKIPPED';
        record.hypotheticalOutcome = outcome;
        record.hypotheticalPips = blendedPips;
        record.mfePips = highestProfitPips;
        console.log(`   [SKIPPED] Hypothetical: ${outcome} | ${blendedPips > 0 ? '+' : ''}${blendedPips.toFixed(1)} pips (MFE: +${highestProfitPips.toFixed(1)})`);
      } else {
        record.entry = entry;
        record.stopLoss = sl;
        record.takeProfit = tp;
        record.outcome = outcome as any;
        record.pips = blendedPips;
        record.mfePips = highestProfitPips;
        record.rMultiple = rMultiple;
        record.riskPips = riskPips;
        sessionTradeTaken = true;
        console.log(`   → ${outcome} | ${blendedPips > 0 ? '+' : ''}${blendedPips.toFixed(1)} pips (${rMultiple > 0 ? '+' : ''}${rMultiple.toFixed(2)} R)`);
      }

      records.push(record as any);
  }

  // ── Results summary ─────────────────────────────────────────
  const tradedRecords = records.filter(r => r.outcome !== 'SKIPPED');
  const skipped = records.filter(r => r.outcome === 'SKIPPED').length;
  const wins = tradedRecords.filter(r => (r.pips ?? 0) > 0).length;
  const losses = tradedRecords.filter(r => (r.pips ?? 0) <= 0).length;
  const netPips = tradedRecords.reduce((sum, r) => sum + (r.pips ?? 0), 0);
  const winRate = tradedRecords.length > 0 ? (wins / tradedRecords.length * 100) : 0;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📈  MATH BACKTEST RESULTS: ${pair}`);
  console.log(`📅  ${startDate || 'ALL'} to ${endDate || 'ALL'}`);
  console.log(`   AI filtered out (NO_TRADE): ${skipped}`);
  console.log(`   Trades taken: ${tradedRecords.length}`);
  return {
    records,
    m5Candles,
    wins,
    losses,
    netPips,
    winRate,
    skipped
  };
}
