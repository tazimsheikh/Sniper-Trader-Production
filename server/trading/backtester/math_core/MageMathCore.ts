import { DailyContextTracker } from '../../market/DailyContextTracker.js';
import { HTFContextTracker } from '../../market/HTFContextTracker.js';
import { OPTIMIZER_CONFIG } from '../../config/OptimizerPairConfig.js';
import { PairConfigManager } from '../../config/PairConfig.js';
import { TriggerEvent, M1TypedArrays, PairConfig, TradeRecord } from '../../config/types.js';
import { isNewsForceClose } from '../../market/historicalNews.js';
import { isRolloverCircuitBreaker } from '../../market/MathFilters.js';
import { buildAtrArray } from '../../market/Indicators.js';


export function preComputeTriggers(
  m5Candles: any[],
  m1Rows: any[],
  pair: string,
  spreadPts: number,
  sessionName: string,
  isForex: boolean,
  pipSize: number,
  orbTimeHour: number,
  orbTimeMin: number,
  orbMinutes: number = 15,
  actionMinutes: number = 5,
  minBodyPips?: number,
): TriggerEvent[] {
  const startMins = orbTimeHour * 60 + orbTimeMin;

  let day3High = -Infinity;
  let day3Low = Infinity;
  let lastEstHour = -1;
  let orHigh = -Infinity;
  let orLow = Infinity;
  let orBuilt = false;
  let mageTradeTaken = false;
  let wasBuilding = false;
  let orStartTimestamp = 0;

  const triggers: TriggerEvent[] = [];
  const dailyTracker = new DailyContextTracker();
  const atrArr = buildAtrArray(m5Candles, 14);
  const htfData = HTFContextTracker.precomputeHTFData(m5Candles);
  let m1Idx = 0;

  for (let i = 2; i < m5Candles.length - 1; i++) {
    const c = m5Candles[i];
    dailyTracker.processCandle(c);

    while (m1Idx < m1Rows.length && m1Rows[m1Idx].timestamp < c.timestamp) {
      m1Idx++;
    }

    if (
      lastEstHour !== -1 &&
      ((lastEstHour < 17 && c.estHour >= 17) ||
        (lastEstHour > c.estHour && c.estHour >= 17))
    ) {
      day3High = -Infinity;
      day3Low = Infinity;
      orHigh = -Infinity;
      orLow = Infinity;
      orBuilt = false;
      mageTradeTaken = false;
    }
    if (c.high > day3High) day3High = c.high;
    if (c.low < day3Low) day3Low = c.low;
    lastEstHour = c.estHour;

    const estMin = new Date(c.timestamp).getUTCMinutes();
    const currentMins = c.estHour * 60 + estMin;

    const isBuildingORB = currentMins >= startMins && currentMins < startMins + orbMinutes;
    if (isBuildingORB && !wasBuilding) {
      orHigh = -Infinity;
      orLow = Infinity;
      orBuilt = false;
      mageTradeTaken = false;
      orStartTimestamp = c.timestamp;
    }
    wasBuilding = isBuildingORB;

    if (isBuildingORB) {
      if (c.high > orHigh) orHigh = c.high;
      if (c.low < orLow) orLow = c.low;
    }
    if (currentMins >= startMins + orbMinutes) {
      orBuilt = true;
    }

    const prevC = i > 0 ? m5Candles[i - 1] : null;

    if (
      orBuilt &&
      currentMins >= startMins &&
      currentMins < startMins + orbMinutes + (actionMinutes || 180) &&
      !mageTradeTaken &&
      prevC
    ) {
      // 🚫 Prop Firm Compliance: Blackout Windows 🚫
      const dateStr = new Date(c.timestamp).toISOString().split("T")[0];
      if (
        isRolloverCircuitBreaker(c.estHour, estMin) ||
        isNewsForceClose(dateStr, c.estHour, estMin)
      ) {
        continue;
      }

      const mageCfgs = PairConfigManager.getMageConfigs(pair);
      const mCfg = mageCfgs.find(c => c.session === sessionName) || mageCfgs[0];
      const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const candleDate = new Date(c.timestamp);
      const utcDay = candleDate.getUTCDay();
      const monthNum = candleDate.getUTCMonth() + 1;
        if (mCfg) {
        if (mCfg.toxicHours && mCfg.toxicHours.includes(c.estHour)) continue;
      }

      // MATHEMATICAL PARITY FIX: Use closed M5 candle c (matches MageEngine.ts:L359 state.m5Buffer[len-1])
      const actionCandle = c;
      const actionCandleMins = actionCandle.estHour * 60 + (actionCandle.estMin || 0);
      if (actionCandleMins < startMins + orbMinutes) continue;

      const buyTriggered = isForex
        ? actionCandle.close > orHigh
        : actionCandle.high >= (orHigh + spreadPts);

      const sellTriggered = isForex
        ? actionCandle.close < orLow
        : actionCandle.low <= orLow;

      if (!buyTriggered && !sellTriggered) continue;
      if (buyTriggered && sellTriggered) continue;

      if (buyTriggered && Math.max(actionCandle.open, actionCandle.close) < orHigh) continue;
      if (sellTriggered && Math.min(actionCandle.open, actionCandle.close) > orLow) continue;

        const cBodyPips = parseFloat((Math.abs(actionCandle.close - actionCandle.open) / pipSize).toFixed(1));
        
        const dateIso = new Date(actionCandle.timestamp).toISOString();
        const isApril9 = dateIso.includes('2026-04-09') && buyTriggered;
        
        if (isApril9 && (global as any).__SIM_ENABLE_TRACE__) {
            console.log(`[TRACE April 9] trigger reached. cBodyPips=${cBodyPips}, minBodyPips=${minBodyPips}`);
        }

        if (minBodyPips !== undefined && typeof minBodyPips === 'number' && cBodyPips < minBodyPips) {
            if (isApril9 && (global as any).__SIM_ENABLE_TRACE__) console.log(`[TRACE April 9] SKIPPED BY minBodyPips`);
            continue;
        }

        const minRatio = 0.35;
        const maxRatio = 1.5;
        const orPips = (orHigh - orLow) / pipSize;
        
        // ATR-Relative OR filter: use pre-built ATR array (closed candles only, i-1 = last closed)
        const atrVal = i >= 1 ? atrArr[i - 1] : 0;
        if (atrVal > 0) {
          const atr14Pips = atrVal / pipSize;
          const ratio = Math.round((orPips / atr14Pips) * 100) / 100;
          if (ratio < minRatio || ratio > maxRatio) {
            if (isApril9 && (global as any).__SIM_ENABLE_TRACE__) console.log(`[TRACE April 9] SKIPPED BY ATR RATIO: ratio=${ratio}, atr14Pips=${atr14Pips}, orPips=${orPips}`);
            continue;
          }
        } else {
            if (isApril9 && (global as any).__SIM_ENABLE_TRACE__) console.log(`[TRACE April 9] atrVal is 0! i=${i}`);
        }

        if (mCfg && mCfg.maxSlDist !== undefined) {
          const maxSlPips = mCfg.maxSlDist;
          if (orPips + (spreadPts / pipSize) > maxSlPips) {
            if (isApril9 && (global as any).__SIM_ENABLE_TRACE__) console.log(`[TRACE April 9] SKIPPED BY maxSlDist: orPips=${orPips}, maxSlPips=${maxSlPips}`);
            continue;
          }
          if (isForex && (orPips + 10) > maxSlPips + 0.001) {
            if (isApril9 && (global as any).__SIM_ENABLE_TRACE__) console.log(`[TRACE April 9] SKIPPED BY maxSlDist+10: orPips=${orPips}, maxSlPips=${maxSlPips}`);
            continue;
          }
        }

        if (isApril9 && (global as any).__SIM_ENABLE_TRACE__) console.log(`[TRACE April 9] Passed all filters! mageTradeTaken=${mageTradeTaken}`);

        mageTradeTaken = true;

        const rOrHigh = roundPrice(orHigh, pair);
        const rOrLow  = roundPrice(orLow, pair);
        const boxSize = roundPrice(Math.abs(rOrHigh - rOrLow), pair);

        triggers.push({
          m5Index: i,
          m1Index: Math.min(m1Rows.length - 1, m1Idx + 5),
          direction: buyTriggered ? "BUY" : "SELL",
          orHigh: rOrHigh,
          orLow: rOrLow,
          boxSize,
          cBodyPips,
          orStartTimestamp,
        } as any);
      }
    }
  return triggers;
}

function getDigitsForPair(pair: string): number {
  const optCfg = OPTIMIZER_CONFIG[pair.replace(".Daily", "")];
  const tickSize = optCfg?.tickSize ?? 0.00001;
  const tickStr = tickSize.toString();
  return tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
}

function roundPrice(val: number, pair: string): number {
  return Number(val.toFixed(getDigitsForPair(pair)));
}


export function evaluateExits(
  m1: M1TypedArrays,
  m5Candles: any[],
  triggers: TriggerEvent[],
  pair: string,
  config: PairConfig,
  sessionName: string,
  isForex: boolean,
  slippagePips: number = 0,
) {
  const optCfg = OPTIMIZER_CONFIG[pair.replace(".Daily", "")];
  const pipSize = optCfg ? optCfg.pipSize : 0.0001;
  const spreadPts = optCfg ? optCfg.spread * pipSize : 0;

  let totalTrades = 0;
  let winningTrades = 0;
  let dailyNetR: Record<string, number> = {};
  const records: TradeRecord[] = [];
  const isCrypto = pair.includes("BTC") || pair.includes("ETH");
  let lastTradeExitMs = 0;
  let lastTradeCloseTimeMs = 0;

  for (const t of triggers) {
    if (m5Candles[t.m5Index] && m5Candles[t.m5Index].timestamp <= Math.max(lastTradeExitMs, lastTradeCloseTimeMs)) {
      continue;
    }

    if (config.minBodyPips !== undefined && t.cBodyPips < config.minBodyPips)
      continue;

    // M-4 Parity: ORB range circuit breaker
    const orRangePips = t.boxSize / pipSize;
    if (
      isForex &&
      config.maxSlDist !== undefined &&
      orRangePips + 10 > config.maxSlDist + 0.001
    ) {
      continue;
    }

    const direction = t.direction;
    const pbPct = config.orbPullbackPct ?? 0.0;
    const limitBuyPrice = roundPrice(t.orHigh - t.boxSize * pbPct, pair);
    const limitSellPrice = roundPrice(t.orLow + t.boxSize * pbPct, pair);
    let entryPrice = direction === "BUY" ? limitBuyPrice : limitSellPrice;
    const slBuffer = 0;

    let proposedSl =
      direction === "BUY"
        ? t.orLow - slBuffer
        : t.orHigh + spreadPts + slBuffer;

    if (config.minSlDist !== undefined) {
      if (
        direction === "SELL" &&
        proposedSl < entryPrice + (config.minSlDist - 0.001) * pipSize
      )
        proposedSl = entryPrice + config.minSlDist * pipSize;
      if (
        direction === "BUY" &&
        proposedSl > entryPrice - (config.minSlDist - 0.001) * pipSize
      )
        proposedSl = entryPrice - config.minSlDist * pipSize;
    }

    const slPrice = roundPrice(proposedSl, pair);
    let initialRisk = Math.abs(entryPrice - slPrice);

    if (config.maxSlDist !== undefined && initialRisk > (config.maxSlDist + 0.001) * pipSize) {
      continue; // SKIPPED
    }

    let tpPrice = roundPrice(
      direction === "BUY" ? entryPrice + 50.0 * initialRisk : entryPrice - 50.0 * initialRisk,
      pair
    );

    if (config.exitMode === "MIDPOINT") {
      tpPrice = roundPrice((t.orHigh + t.orLow) / 2, pair);
    } else if (config.exitMode === "OPPOSITE_BOUNDARY") {
      tpPrice = roundPrice(direction === "BUY" ? t.orHigh : t.orLow, pair);
    } else if (config.exitMode === "ORB_EXTENSION") {
      const ext = t.boxSize * 2;
      tpPrice = roundPrice(direction === "BUY" ? entryPrice + ext : entryPrice - ext, pair);
    }

    let missedTrade = false;
    let currentSL = roundPrice(slPrice, pair);
    let lastTrailingLevel = 0;
    let tradeActive = false;
    let outcome: "SKIPPED" | "TP" | "SL" | "EOD" | "EXPIRED" | "NEWS_CLOSE" | null = null;
    let rMultiple = 0;
    let entryTimeMs = 0;

    // isInstantFill logic matching MageEngine (fallback to market)
    const proximityBuffer = spreadPts * 1.5;
    const currentM5Close = m5Candles[t.m5Index].close;
    const m5CurrentPrice = direction === "BUY" ? currentM5Close + spreadPts : currentM5Close;
    let isInstantFill = false;
    if (direction === "BUY" && m5CurrentPrice <= entryPrice + proximityBuffer) isInstantFill = true;
    if (direction === "SELL" && m5CurrentPrice >= entryPrice - proximityBuffer) isInstantFill = true;

    let exitTimeMs = 0;
    // Using M1 Precision! Max 5000 minutes (approx 1000 M5 candles)
    for (
      let j = t.m1Index;
      j < Math.min(m1.length, t.m1Index + 5000);
      j++
    ) {
      if (tradeActive) exitTimeMs = m1.timestamp[j];
      const isEOD = false; // Mage holds overnight until SL, TP, or forceCloseHours

      if (isEOD) {
        if (tradeActive) {
          outcome = "EOD";
          const exitPrice =
            direction === "BUY" ? m1.close[j] : m1.close[j] + spreadPts;
          rMultiple =
            (direction === "BUY"
              ? exitPrice - entryPrice
              : entryPrice - exitPrice) / initialRisk;
        } else {
          outcome = "SKIPPED";
          rMultiple = 0;
        }
        break;
      }

        if (!tradeActive && !missedTrade) {
          const fcHours = config.forceCloseHours;
          const limitPlacedAt = m5Candles[t.m5Index].timestamp; // M5 trigger time
          if (fcHours !== undefined && m1.timestamp[j] - limitPlacedAt >= fcHours * 60 * 60 * 1000) {
            missedTrade = true;
            outcome = "SKIPPED";
            rMultiple = 0;
            break;
          }

          // Cancel dangling limit order from the previous day at 17:00 EST rollover
          if (m1.isSessionReset[j] === 1) {
            missedTrade = true;
            outcome = "SKIPPED";
            rMultiple = 0;
            break;
          }

          const isAsiaSession = config.session === "asia" || (config.orbStartHour !== undefined && config.orbStartHour >= 18);
          if (!isAsiaSession && m1.isMidnightExpiry[j] === 1) {
            missedTrade = true;
            outcome = "SKIPPED";
            break;
          }

          if (m1.isNewsForceClose[j] === 1) {
            missedTrade = true;
            outcome = "SKIPPED";
            break;
          }

          const pbPct = config.orbPullbackPct ?? 0.0;
          const isInstant = pbPct === 0 || isInstantFill;

          if (direction === "BUY") {
            if (isInstant || m1.open[j] + spreadPts <= limitBuyPrice) {
              entryTimeMs = m1.timestamp[j];
              const filledPrice = isInstant ? m1.open[j] + spreadPts : Math.min(m1.open[j] + spreadPts, limitBuyPrice);
              if (filledPrice <= slPrice) { tradeActive = true; outcome = "SL"; rMultiple = -1.0; break; }
              else { tradeActive = true; entryPrice = filledPrice; initialRisk = Math.abs(entryPrice - slPrice); }
            } else if (m1.low[j] + spreadPts <= limitBuyPrice) {
              entryTimeMs = m1.timestamp[j];
              const filledPrice = Math.min(m1.open[j] + spreadPts, limitBuyPrice);
              if (filledPrice <= slPrice) { tradeActive = true; outcome = "SL"; rMultiple = -1.0; break; }
              else { tradeActive = true; entryPrice = filledPrice; initialRisk = Math.abs(entryPrice - slPrice); }
            }
          } else if (direction === "SELL") {
            if (isInstant || m1.open[j] >= limitSellPrice) {
              entryTimeMs = m1.timestamp[j];
              const filledPrice = isInstant ? m1.open[j] : Math.max(m1.open[j], limitSellPrice);
              if (filledPrice + spreadPts >= slPrice) { tradeActive = true; outcome = "SL"; rMultiple = -1.0; break; }
              else { tradeActive = true; entryPrice = filledPrice; initialRisk = Math.abs(entryPrice - slPrice); }
            } else if (m1.high[j] >= limitSellPrice) {
              entryTimeMs = m1.timestamp[j];
              const filledPrice = Math.max(m1.open[j], limitSellPrice);
              if (filledPrice + spreadPts >= slPrice) { tradeActive = true; outcome = "SL"; rMultiple = -1.0; break; }
              else { tradeActive = true; entryPrice = filledPrice; initialRisk = Math.abs(entryPrice - slPrice); }
            }
          }

          // M-4 Parity: Cancel limit order if TP boundary is swept before fill
          if (!tradeActive) {
            if (direction === "BUY" && m1.high[j] >= tpPrice) {
              missedTrade = true;
              outcome = "SKIPPED";
              rMultiple = 0;
              break;
            }
            if (direction === "SELL" && m1.low[j] + spreadPts <= tpPrice) {
              missedTrade = true;
              outcome = "SKIPPED";
              rMultiple = 0;
              break;
            }
          }
        }

      if (tradeActive) {
        let slHit = false;
        let tpHit = false;

        if (direction === "BUY") {
          slHit = m1.low[j] <= currentSL;
          tpHit = m1.high[j] >= tpPrice;
          if (slHit && tpHit) {
            slHit = true;
            tpHit = false;
          }

          if (slHit) {
            outcome = "SL";
            const exitPrice = Math.min(m1.open[j], currentSL); // Handle slippage on SL
            rMultiple = (exitPrice - entryPrice) / initialRisk;
            break;
          }

          const currentR = (m1.high[j] - entryPrice) / initialRisk;
          const tTrig = config.trailingSlTrigger;
          const tStep = config.trailingSlStep;

          if (tTrig !== undefined && currentR >= tTrig && currentSL < entryPrice) {
            currentSL = roundPrice(entryPrice, pair);
            lastTrailingLevel = 0;
          }
          if (tTrig !== undefined && tStep !== undefined && currentR >= tTrig + tStep) {
            const numSteps = Math.floor((currentR - tTrig) / tStep);
            const rLevelToLock = numSteps * tStep;
            if (rLevelToLock > lastTrailingLevel) {
              lastTrailingLevel = rLevelToLock;
              const bd = getDigitsForPair(pair);
              const proposedSL = Number((entryPrice + rLevelToLock * initialRisk).toFixed(bd));
              if (proposedSL > currentSL) currentSL = roundPrice(proposedSL, pair);
            }
          }

          if (tpHit) {
            outcome = "TP";
            rMultiple = (tpPrice - entryPrice) / initialRisk;
            break;
          }
        } else {
          slHit = m1.high[j] + spreadPts >= currentSL;
          tpHit = m1.low[j] + spreadPts <= tpPrice;
          if (slHit && tpHit) {
            slHit = true;
            tpHit = false;
          }

          if (slHit) {
            outcome = "SL";
            const exitPrice = Math.max(m1.open[j] + spreadPts, currentSL); // Handle slippage on SL
            rMultiple = (entryPrice - exitPrice) / initialRisk;
            break;
          }

          const currentR = (entryPrice - (m1.low[j] + spreadPts)) / initialRisk;
          const tTrig = config.trailingSlTrigger;
          const tStep = config.trailingSlStep;

          if (tTrig !== undefined && currentR >= tTrig && currentSL > entryPrice) {
            currentSL = roundPrice(entryPrice, pair);
            lastTrailingLevel = 0;
          }
          if (tTrig !== undefined && tStep !== undefined && currentR >= tTrig + tStep) {
            const numSteps = Math.floor((currentR - tTrig) / tStep);
            const rLevelToLock = numSteps * tStep;
            if (rLevelToLock > lastTrailingLevel) {
              lastTrailingLevel = rLevelToLock;
              const bd = getDigitsForPair(pair);
              const proposedSL = Number((entryPrice - rLevelToLock * initialRisk).toFixed(bd));
              if (proposedSL < currentSL) currentSL = roundPrice(proposedSL, pair);
            }
          }

          if (tpHit) {
            outcome = "TP";
            rMultiple = (entryPrice - tpPrice) / initialRisk;
            break;
          }
        }

        const isNewsForceClose = m1.isNewsForceClose[j] === 1;

        const fcHours = config.forceCloseHours;
        if ((fcHours !== undefined && m1.timestamp[j] - entryTimeMs >= fcHours * 60 * 60 * 1000) || isNewsForceClose) {
          outcome = isNewsForceClose ? "NEWS_CLOSE" : "EOD";
          const exitPrice =
            direction === "BUY" ? m1.close[j] : m1.close[j] + spreadPts;
          rMultiple =
            (direction === "BUY"
              ? exitPrice - entryPrice
              : entryPrice - exitPrice) / initialRisk;
          break;
        }
      }
    }

    if (outcome === null) {
      if (tradeActive) {
        outcome = "EOD";
        const final_j = Math.min(m1.length - 1, t.m1Index + 5000 - 1);
        const exitPrice =
          direction === "BUY" ? m1.close[final_j] : m1.close[final_j] + spreadPts;
        rMultiple =
          (direction === "BUY"
            ? exitPrice - entryPrice
            : entryPrice - exitPrice) / initialRisk;
        exitTimeMs = m1.timestamp[final_j];
      } else {
        outcome = "SKIPPED";
        rMultiple = 0;
      }
    }

    const dateStr = new Date(m5Candles[t.m5Index].timestamp)
      .toISOString()
      .split("T")[0];
    records.push({
      timestamp: entryTimeMs || m5Candles[t.m5Index].timestamp,
      date: dateStr,
      pair: pair,
      setupType: "ORB_MATH",
      sessionName: sessionName,
      decision: "TRADE",
      confidence: 1.0,
      setupQuality: "N/A",
      reasoning: "MATH_SIMULATION",
      outcome: outcome || "SKIPPED",
      pips: rMultiple ? (rMultiple * initialRisk) / pipSize : null,
      rMultiple,
      entry: entryPrice,
      stopLoss: slPrice,
      takeProfit: tpPrice,
      riskPips: initialRisk / pipSize,
      orHigh: t.orHigh,
      orLow: t.orLow,
      entryTimeMs: entryTimeMs,
      exitTimeMs: exitTimeMs
    });

    if (outcome !== "SKIPPED") {
      dailyNetR[dateStr] = (dailyNetR[dateStr] || 0) + rMultiple;
      totalTrades++;
      if (rMultiple > 0) winningTrades++;
      lastTradeExitMs = exitTimeMs;
      lastTradeCloseTimeMs = exitTimeMs;
    }
  }

  const totalNetR = Object.values(dailyNetR).reduce((a, b) => a + b, 0);
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  const pbStr =
    config.orbPullbackPct !== undefined
      ? `${config.orbPullbackPct * 100}%`
      : "0%";
  const setupStr = `${sessionName === "ny" ? "NY_Forex" : sessionName}_${pbStr}_MinSL${config.minSlDist}_MaxSL${config.maxSlDist}_Body${config.minBodyPips}_Trig${config.trailingSlTrigger}_Step${config.trailingSlStep}_FC${config.forceCloseHours}_StartH${config.orbStartHour}_StartM${config.orbStartMin}_OrbMins${config.orbMinutes}_ActMins${config.actionMinutes ?? 5}_Exit${config.exitMode}`;

  return {
    setup: setupStr,
    dailyNetR,
    trades: totalTrades,
    winRate,
    totalNetR,
    records,
  };
}

