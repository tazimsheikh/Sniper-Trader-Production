import { buildBollingerArray, buildRsiArray } from '../market/Indicators.js';
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
  timestamp: number;
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
  outcome: 'TP' | 'SL' | 'EOD' | 'NEWS_CLOSE' | 'SKIPPED' | null;
  pips: number | null;
  mfePips?: number | null;
  rMultiple?: number;
  orHigh?: number;
  orLow?: number;
  exitPrice?: number;
}

const CONFIDENCE_THRESHOLD = 0.70;

const backtestCache = new Map<string, { m5Candles: any[]; emaArr: any; bbArr?: any; rsiArr?: any }>();

export function clearSeerBacktestCache(pair?: string) {
  if (pair) {
    for (const k of backtestCache.keys()) {
      if (k.startsWith(pair)) backtestCache.delete(k);
    }
  } else {
    backtestCache.clear();
  }
}

export async function runSeerMathBacktest(
  pair: string,
  startDate?: string,
  endDate?: string,
  ignoreFilters: boolean = false,
  overrideParams: any = {},
  overrideConfigs?: any[],
  enableTrace: boolean = false
) {
  return runMathBacktest(pair, startDate, endDate, ignoreFilters, undefined, undefined, null, overrideConfigs, enableTrace, overrideParams);
}

export async function runMathBacktest(
  pair: string, 
  startDate?: string, 
  endDate?: string, 
  ignoreFilters: boolean = false,
  minSlOverride?: number,
  maxSlOverride?: number,
  extremeFilter: string | null = null,
  overrideConfigs?: any[],
  enableTrace: boolean = false,
  overrideParams: any = {},
  precomputedData?: { m5Candles: any[], emaArr: any[], bbArr?: any[], rsiArr?: any[] }
) {
  for (const key of backtestCache.keys()) {
    if (!key.startsWith(pair)) {
      backtestCache.delete(key);
    }
  }

  const normalizedPair = pair.split('.')[0].trim().toUpperCase();
  const isForex = PairConfigManager.isForex(normalizedPair);

  const configArr = overrideConfigs || PairConfigManager.getSeerConfigs(pair) || SEER_PAIR_CONFIG[pair];
  if (!configArr || configArr.length === 0) throw new Error(`Unknown pair: ${pair}`);
  const config = configArr[0];

  const baseSymbol = pair.replace(/\.daily$/i, "").split("_")[0].toUpperCase();
  const optConfig = OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[baseSymbol] || OPTIMIZER_CONFIG[baseSymbol.toUpperCase()] || OPTIMIZER_CONFIG[normalizedPair];
  if (!optConfig) throw new Error(`No OPTIMIZER_CONFIG found for ${pair}`);

  const { tickSize, pipSize, spread } = optConfig;
  const askSpread = spread * pipSize;

  const cacheKey = `${pair}_${spread}_${startDate || ''}_${endDate || ''}`;
  let m5Candles: any[];
  let emaArr: any;
  let bbArr: any;
  let rsiArr: any;

  if (precomputedData) {
    m5Candles = precomputedData.m5Candles;
    emaArr = precomputedData.emaArr;
    bbArr = precomputedData.bbArr;
    rsiArr = precomputedData.rsiArr;
  } else if (backtestCache.has(cacheKey)) {
    const cached = backtestCache.get(cacheKey)!;
    m5Candles = cached.m5Candles;
    emaArr = cached.emaArr;
    bbArr = cached.bbArr;
    rsiArr = cached.rsiArr;
  } else {
    const csvFiles = fs.readdirSync(path.join(process.cwd(), 'data', 'csv'))
      .filter(f => f.toLowerCase().startsWith(baseSymbol.toLowerCase()) && f.endsWith('.csv'));
    if (!csvFiles.length) throw new Error(`No CSV data found for ${pair}`);

    console.log(`🔱 Vision AI Backtest — ${pair}`);
    const startD = startDate ? new Date(new Date(startDate).getTime() - 30 * 24 * 60 * 60 * 1000) : undefined;
    const endD = endDate ? new Date(new Date(endDate).getTime() + 86400000 - 1) : undefined;
    const m1Rows = await loadCsv(path.join(process.cwd(), 'data', 'csv', csvFiles[0]), spread, startD, endD);
    m5Candles = aggregateCandles(m1Rows, 5);
    emaArr = buildEmaArray(m5Candles, 20);
    
    bbArr = buildBollingerArray(m5Candles, 20, 2.0);
    rsiArr = buildRsiArray(m5Candles, 14);
    backtestCache.set(cacheKey, { m5Candles, emaArr, bbArr, rsiArr });
  }

  let globalStartIdx = 0;
  let globalEndIdx = m5Candles.length - 1;
  if (startDate || endDate) {
    const start = startDate ? new Date(startDate).getTime() : 0;
    const end = endDate ? new Date(endDate).getTime() + 86400000 : Infinity;
    globalStartIdx = m5Candles.findIndex(c => c.timestamp >= start);
    if (globalStartIdx === -1) globalStartIdx = 0;
    
    globalEndIdx = m5Candles.length - 1;
    while (globalEndIdx >= 0 && m5Candles[globalEndIdx].timestamp >= end) globalEndIdx--;
    
    if (enableTrace) console.log(`📅 Date range: ${startDate || 'start'} → ${endDate || 'end'} (Trading starts at index ${globalStartIdx})`);
  }
  
  if (enableTrace) console.log(`🕯️  ${m5Candles.length.toLocaleString()} M5 candles loaded`);

  const dailyTracker = new DailyContextTracker();
  
  const records: VisionTradeRecord[] = [];
  let day3High = -Infinity;
  let day3Low = Infinity;
  let lastEstHour = -1;
  let sessionTradeTaken = false;

  for (let i = 2; i < m5Candles.length - 1; i++) {
    const c = m5Candles[i];
    dailyTracker.processCandle(c);

    if (i < globalStartIdx || i > globalEndIdx) continue;

    // Day rollover at 5 PM EST (17:00)
    if (lastEstHour !== -1 && ((lastEstHour < 17 && c.estHour >= 17) || (lastEstHour > c.estHour && c.estHour >= 17))) {
      day3High = -Infinity;
      day3Low = Infinity;
      sessionTradeTaken = false;
    }
    const day3HighBeforeC = day3High;
    const day3LowBeforeC = day3Low;
    if (c.high > day3High) day3High = c.high;
    if (c.low < day3Low) day3Low = c.low;
    lastEstHour = c.estHour;

    const isNY     = c.estHour >= 9 && c.estHour < 13;
    const isAsia   = c.estHour >= 20 && c.estHour < 23;
    const isLondon = c.estHour >= 2  && c.estHour < 5;

    let sessions = config.sessions || (config.session ? [config.session] : undefined);
    if (!sessions) {
      if (pair.includes('JPY')) sessions = ['asia', 'london'];
      else if (pair.includes('EUR') || pair.includes('GBP')) sessions = ['london', 'ny'];
      else if (pair === 'XAUUSD') sessions = ['london', 'ny'];
      else sessions = ['ny'];
    }

    let inWindow = false;
    for (const session of sessions) {
      if (session === 'asia' && isAsia) inWindow = true;
      if (session === 'london' && isLondon) inWindow = true;
      if ((session === 'NY_Forex' || session === 'ny') && isNY) inWindow = true;
    }

    if (inWindow && config.delayStartMinutes !== undefined) {
      const isStartHour =
        (isNY && c.estHour === (orbStartHour < 8 ? orbStartHour : 8)) ||
        (isLondon && c.estHour === 2) ||
        (isAsia && c.estHour === 20);
      if (isStartHour && c.minute < config.delayStartMinutes) inWindow = false;
    }
    if (inWindow && config.cutoffHour !== undefined) {
      if (c.estHour >= config.cutoffHour) inWindow = false;
    }

    const prevDay = dailyTracker.getPreviousDayContext();

    let triggerSetup: {
      setupType: string;
      direction: 'BUY' | 'SELL';
      isMage: boolean;
    } | null = null;

    let covenSetup: string | null = null;
    if (prevDay) {
      if (prevDay.isFirstRedDay) covenSetup = 'FRD';
      else if (prevDay.isFirstGreenDay) covenSetup = 'FGD';
      else if (prevDay.isDay3BreakoutLongs) covenSetup = 'DAY3_LONG';
      else if (prevDay.isDay3BreakoutShorts) covenSetup = 'DAY3_SHORT';
      else if (prevDay.isInsideDay) covenSetup = 'INSIDE_DAY';
      else if (prevDay.isTrendingLong) covenSetup = 'LHF_LONG';
      else if (prevDay.isTrendingShort) covenSetup = 'LHF_SHORT';
    }

    let mathResult: { setupType: string; direction: 'BUY' | 'SELL'; isMage: boolean } | null = null;
    if (!extremeFilter && !triggerSetup && inWindow && !sessionTradeTaken && prevDay) {
      const ema20 = emaArr[i];
      const prevC = m5Candles[i - 1];
      if (ema20 && prevC) {
        let safeCovenSetup = covenSetup || 'NONE';
        mathResult = evaluateStacyBurkeSetup(c, prevC, ema20, prevDay, safeCovenSetup, config, pipSize, pair, false, day3High, day3Low, bbArr ? bbArr[i - 1] : undefined, rsiArr ? rsiArr[i - 1] : undefined);
      }
    }

    if (mathResult) {
      sessionTradeTaken = true;
      triggerSetup = {
        setupType: mathResult.setupType,
        direction: mathResult.direction,
        isMage: false
      };
    }

    if (!triggerSetup) continue;

    const setupType = triggerSetup.setupType;
    const expectedDirection = triggerSetup.direction;

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

    let sl = direction === 'BUY' ? c.low - (2 * pipSize) : c.high + (2 * pipSize) + askSpread;

    const slDistPips = Math.abs(entry - sl) / pipSize;
    const minSlVal = minSlDist / pipSize;
    const maxSlVal = maxSlDist / pipSize;
    if (slDistPips < minSlVal) {
      sl = direction === 'BUY' ? entry - (minSlVal * pipSize) : entry + (minSlVal * pipSize);
    } else if (slDistPips > maxSlVal) {
      sl = direction === 'BUY' ? entry - (maxSlVal * pipSize) : entry + (maxSlVal * pipSize);
    }

    const tpDist = 100 * pipSize;
    const tp = direction === 'BUY' ? entry + tpDist : entry - tpDist;
    const riskPips = Math.abs(entry - sl) / pipSize;

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
    let lastFcEstHour = c.estHour;

    for (let j = i + 1; j < Math.min(i + 200, m5Candles.length); j++) {
      const fc = m5Candles[j];

      const fcMin = new Date(fc.timestamp).getUTCMinutes();
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
        if (fc.high + askSpread >= currentSl) { outcome = 'SL'; exitPrice = Math.max(fc.open + askSpread, currentSl); break; }
        if (fc.low + askSpread <= tp) { outcome = 'TP'; exitPrice = tp; break; }
      } else {
        if (fc.low <= currentSl) { outcome = 'SL'; exitPrice = Math.min(fc.open, currentSl); break; }
        if (fc.high >= tp) { outcome = 'TP'; exitPrice = tp; break; }
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
           if (enableTrace) console.log(`   [1.5R HIT] Partial 50% secured. SL moved to BE+2 (${sl.toFixed(5)}).`);
        } else {
           if (enableTrace) console.log(`   [1.5R HIT] Partial 50% secured. (SL already better than BE).`);
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
                  currentSl = secondLastConfirmedSH + (pipSize);
                }
              }
            }
          }
        }
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

    if (isSkipped) {
      record.outcome = 'SKIPPED';
      record.hypotheticalOutcome = outcome;
      record.hypotheticalPips = blendedPips;
      record.mfePips = highestProfitPips;
    } else {
      record.entry = entry;
      record.stopLoss = sl;
      record.takeProfit = tp;
      record.exitPrice = exitPrice;
      record.outcome = outcome as any;
      record.pips = blendedPips;
      record.mfePips = highestProfitPips;
      record.rMultiple = rMultiple;
      record.riskPips = riskPips;
      sessionTradeTaken = true;
    }

    records.push(record as any);
  }

  const tradedRecords = records.filter(r => r.outcome !== 'SKIPPED');
  const skipped = records.filter(r => r.outcome === 'SKIPPED').length;
  const wins = tradedRecords.filter(r => (r.pips ?? 0) > 0).length;
  const losses = tradedRecords.filter(r => (r.pips ?? 0) <= 0).length;
  const netPips = tradedRecords.reduce((sum, r) => sum + (r.pips ?? 0), 0);
  const totalNetR = tradedRecords.reduce((sum, r) => sum + (r.rMultiple ?? 0), 0);
  const winRate = tradedRecords.length > 0 ? (wins / tradedRecords.length * 100) : 0;

  if (enableTrace) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📈  MATH BACKTEST RESULTS: ${pair}`);
    console.log(`📅  ${startDate || 'ALL'} to ${endDate || 'ALL'}`);
    console.log(`   AI filtered out (NO_TRADE): ${skipped}`);
    console.log(`   Trades taken: ${tradedRecords.length}`);
  }
  return {
    trades: tradedRecords.length,
    netR: totalNetR,
    totalNetR,
    records,
    m5Candles,
    wins,
    losses,
    netPips,
    winRate,
    skipped
  };
}
