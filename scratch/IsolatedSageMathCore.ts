import { DailyContextTracker } from '../server/trading/market/DailyContextTracker.js';
import { OPTIMIZER_CONFIG } from '../server/trading/config/OptimizerPairConfig.js';
import { PairConfigManager } from '../server/trading/config/PairConfig.js';
import { buildAtrArray, buildEmaArray } from '../server/trading/market/Indicators.js';
import { TriggerEvent, SageOptimizerConfig, M1TypedArrays } from '../server/trading/config/types.js';
import { isNewsForceClose } from '../server/trading/market/historicalNews.js';
import { isRolloverCircuitBreaker } from '../server/trading/market/MathFilters.js';

function getDigitsForPair(pair: string): number {
  const optCfg = OPTIMIZER_CONFIG[pair.replace(".Daily", "")];
  const tickSize = optCfg?.tickSize ?? 0.00001;
  const tickStr = tickSize.toString();
  return tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
}

function roundPrice(val: number, pair: string): number {
  return Number(val.toFixed(getDigitsForPair(pair)));
}


export function getActionCandle(
  m5Candles: any[],
  endIndex: number,
  actionMinutes: number = 5
) {
  const N = actionMinutes / 5;
  const prevC = m5Candles[endIndex];
  if (N <= 1) {
    return {
      open: prevC.open,
      high: prevC.high,
      low: prevC.low,
      close: prevC.close,
      estHour: prevC.estHour,
      estMin: prevC.estMin,
      timestamp: prevC.timestamp
    };
  }

  const startIndex = endIndex - N + 1;
  if (startIndex < 0) return null;

  let actionHigh = -Infinity;
  let actionLow = Infinity;
  for (let idx = startIndex; idx <= endIndex; idx++) {
    const c = m5Candles[idx];
    if (c.high > actionHigh) actionHigh = c.high;
    if (c.low < actionLow) actionLow = c.low;
  }

  return {
    open: m5Candles[startIndex].open,
    high: actionHigh,
    low: actionLow,
    close: prevC.close,
    estHour: prevC.estHour,
    estMin: prevC.estMin,
    timestamp: prevC.timestamp
  };
}

export function preComputeTriggers(
  m5Candles: any[],
  m1Rows: any[],
  pair: string,
  spreadPts: number,
  sessionName: string,
  isForex: boolean,
  pipSize: number,
  orbStartHour: number,
  orbStartMin: number,
  orbMinutes: number,
  sweepPips: number = 0,
  actionMinutes: number = 5,
  maxSweepMultiplier: number = 3,
  requireCloseInside: boolean = false,
): TriggerEvent[] {
  const startMins = orbStartHour * 60 + orbStartMin;
  const atrArr = buildAtrArray(m5Candles, 14);
  const ema200Arr = buildEmaArray(m5Candles, 200, (c) => c.close);

  let lastEstHour = -1;
  let orHigh = -Infinity;
  let orLow = Infinity;
  let orBuilt = false;
  let wasBuildingORB = false;
  let tradingDayId = 0;
  const orbSessionTriggered: Record<string, boolean> = {};

  const triggers: TriggerEvent[] = [];
  const sessionTradeTaken = false;
  const dailyTracker = new DailyContextTracker();
  let m1Idx = 0;

  for (let i = 2; i < m5Candles.length - 1; i++) {
    const c = m5Candles[i];
    dailyTracker.processCandle(c);

    while (m1Idx < m1Rows.length && m1Rows[m1Idx].timestamp < c.timestamp) {
      m1Idx++;
    }

    const estMin = new Date(c.timestamp).getUTCMinutes();
    const currentMins = c.estHour * 60 + estMin;
    const isBuildingORB = currentMins >= startMins && currentMins < startMins + orbMinutes;

    const is1700Reset = lastEstHour !== -1 && ((lastEstHour < 17 && c.estHour >= 17) || (lastEstHour > c.estHour && c.estHour >= 17));
    const isAsiaSession = sessionName === "asia" || orbStartHour >= 18;
    const isMidnightExpiry = !isAsiaSession && lastEstHour !== -1 && lastEstHour > c.estHour && c.estHour < 17;
    const isStartMinsReset = isBuildingORB && !wasBuildingORB;

    wasBuildingORB = isBuildingORB;

    if (is1700Reset || isMidnightExpiry || isStartMinsReset) {
      orHigh = -Infinity;
      orLow = Infinity;
      orBuilt = false;
      tradingDayId++;
      for (const k of Object.keys(orbSessionTriggered))
        delete orbSessionTriggered[k];
    }

    lastEstHour = c.estHour;

    if (isBuildingORB) {
      if (c.high > orHigh) orHigh = c.high;
      if (c.low < orLow) orLow = c.low;
    }
    // Set orBuilt = true when the build window ends (when it is no longer building but was building)
    if (!isBuildingORB && currentMins >= startMins + orbMinutes && currentMins < startMins + 4 * 60) {
      orBuilt = true;
    }

    const endMins = startMins + orbMinutes + 4 * 60; // 4 hour window to trigger sweep AFTER ORB finishes
    let isInsideSession = false;
    let actualEndMins = endMins % 1440;
    if (endMins >= 1440) {
      isInsideSession = currentMins >= startMins || currentMins <= actualEndMins;
    } else {
      isInsideSession = currentMins >= startMins && currentMins <= endMins;
    }

    // 🚫 Prop Firm Compliance: Blackout Windows 🚫
    const dateStr = c.dateStr || new Date(c.timestamp).toISOString().split("T")[0];
    if (
      isRolloverCircuitBreaker(c.estHour, estMin) ||
      isNewsForceClose(dateStr, c.estHour, estMin)
    ) {
      continue;
    }

    // S-4: Use previously closed N-minute Action Candle for sweep detection (matches SageMathBacktester + SageEngine)
    if (orBuilt && isInsideSession && i > 0) {
      const prevC = m5Candles[i - 1];
      const actionCandle = getActionCandle(m5Candles, i - 1, actionMinutes);
      if (!actionCandle) continue;

      const sweepBuffer = sweepPips * pipSize;
      const m5SweepHigh = isForex
        ? actionCandle.high >= orHigh + sweepBuffer
        : actionCandle.high >= orHigh + spreadPts + sweepBuffer;
      const m5SweepLow = isForex
        ? actionCandle.low <= orLow - sweepBuffer
        : actionCandle.low <= orLow - sweepBuffer;

      if (!m5SweepHigh && !m5SweepLow) continue;

      const actionDateStr = prevC.dateStr || new Date(prevC.timestamp).toISOString().slice(0, 10);
      const cBodyPips = parseFloat((Math.abs(actionCandle.close - actionCandle.open) / pipSize).toFixed(1));
      const rOrHigh = roundPrice(orHigh, pair);
      const rOrLow  = roundPrice(orLow, pair);
      const boxSize = roundPrice(Math.abs(rOrHigh - rOrLow), pair);

      let startM1Idx = m1Idx;

      triggers.push({
        m5Index: i,
        m1Index: startM1Idx, // Start evaluating on the FIRST M1 tick of the current candle
        direction: "PENDING",
        orHigh: rOrHigh,
        orLow: rOrLow,
        boxSize,
        cBodyPips,
        dateStr: actionDateStr,
        tradingDayId,
        actionCandleHigh: actionCandle.high,
        actionCandleLow: actionCandle.low,
        actionCandleClose: actionCandle.close,
        sweepBuffer,
        // Pre-baked metadata — eliminates getActionCandle() call in evaluateExits hot path
        actionCandleTimestamp: actionCandle.timestamp,
        actionCandleEstHour: actionCandle.estHour,
        actionCandleUtcDay: new Date(actionCandle.timestamp).getUTCDay(),
        actionCandleMonth: new Date(actionCandle.timestamp).getUTCMonth() + 1,
      });
    }
  }
  return triggers;
}

const weekCache: Record<string, string> = {};

export function hasSevereLosingWeek(
  dailyNetR: Record<string, number>,
  maxLossR: number,
): boolean {
  const weeklySums: Record<string, number> = {};
  for (const dateStr in dailyNetR) {
    const returnVal = dailyNetR[dateStr];
    let weekStr = weekCache[dateStr];
    if (!weekStr) {
      const d = new Date(dateStr);
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setUTCDate(diff);
      weekStr = monday.toISOString().split("T")[0];
      weekCache[dateStr] = weekStr;
    }
    weeklySums[weekStr] = (weeklySums[weekStr] || 0) + returnVal;
  }
  for (const weekStr in weeklySums) {
    if (weeklySums[weekStr] <= maxLossR) return true;
  }
  return false;
}

export function evaluateExits(
  m1: M1TypedArrays,
  m5Candles: any[],
  triggers: TriggerEvent[],
  pair: string,
  config: SageOptimizerConfig,
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
  let tradeRecords: any[] = [];
  let tradedDates: Record<number, boolean> = {};

  let lastTradeCloseTimeMs = 0;

  const slBuffer = 0; // Removed physical SL buffer for parity
  const isCrypto = pair.includes("BTC") || pair.includes("ETH");
  const sweepBuffer = ((config as any).sweepPips ?? 0) * pipSize;

  for (const t of triggers) {

    if (tradedDates[t.tradingDayId]) continue;

    // PARITY: Match live engine's maxSpreadLimit filter
    if ((config as any).maxSpreadLimit !== undefined && (spreadPts / pipSize) > (config as any).maxSpreadLimit) {
      continue;
    }

    // PARITY: Match live engine's toxicHours, toxicDays, toxicMonths filters
    // Use pre-baked metadata from trigger — avoids O(N) getActionCandle() call per evaluation
    const estHour = t.actionCandleEstHour ?? 0;
    

    if (config.toxicHours && config.toxicHours.includes(estHour)) continue;

    // Use pre-baked timestamp for lastTradeCloseTimeMs comparison
    const actionCandleTs = t.actionCandleTimestamp ?? 0;
    if (actionCandleTs < lastTradeCloseTimeMs) continue;

    const sweepHigh = t.actionCandleHigh ?? -Infinity;
    const sweepLow = t.actionCandleLow ?? Infinity;
    const sweepHighTriggered = isForex
      ? sweepHigh >= t.orHigh + sweepBuffer
      : sweepHigh >= t.orHigh + sweepBuffer + spreadPts;
    const sweepLowTriggered = isForex
      ? sweepLow <= t.orLow - sweepBuffer
      : sweepLow <= t.orLow - sweepBuffer;

    if (sweepHighTriggered && sweepLowTriggered) continue; // Parity: ignore if both swept
    if (!sweepHighTriggered && !sweepLowTriggered) continue;

    const direction = sweepHighTriggered ? "SELL" : "BUY";
    const testMode = (global as any).TEST_MODE;
    const atrArr = (config as any)._atrArr;
    const emaArr = (config as any)._emaArr;
    
    let m5Idx = -1;
    for (let i = Math.max(0, m5Candles.length - 200); i < m5Candles.length; i++) {
        if (m5Candles[i].timestamp === actionCandleTs) { m5Idx = i; break; }
    }
    
    if (testMode === "FILTER_1_ATR" && m5Idx >= 1) {
      const atrVal = atrArr ? atrArr[m5Idx - 1] : 0;
      if (atrVal > 0) {
        const atr14Pips = atrVal / pipSize;
        const orPips = (t.orHigh - t.orLow) / pipSize;
        const ratio = Math.round((orPips / atr14Pips) * 100) / 100;
        if (ratio < 0.35 || ratio > 1.5) continue;
      }
    }
    
    if (testMode === "FILTER_2_HTF" && m5Idx >= 1) {
      const emaVal = emaArr ? emaArr[m5Idx - 1] : 0;
      if (emaVal > 0) {
        if (direction === "BUY" && t.orLow < emaVal) continue;
        if (direction === "SELL" && t.orHigh > emaVal) continue;
      }
    }
    
    if (testMode === "FILTER_3_DEPTH" && m5Idx >= 1) {
      const atrVal = atrArr ? atrArr[m5Idx - 1] : 0;
      if (atrVal > 0) {
        const atr14Pips = atrVal / pipSize;
        if (direction === "BUY") {
           const sweepDepthPips = (t.orLow - (t.actionCandleLow ?? t.orLow)) / pipSize;
           if (sweepDepthPips > atr14Pips * 1.0) continue;
        } else {
           const sweepDepthPips = ((t.actionCandleHigh ?? t.orHigh) - t.orHigh) / pipSize;
           if (sweepDepthPips > atr14Pips * 1.0) continue;
        }
      }
    }



    if (config.maxBodyPips !== undefined && t.cBodyPips > config.maxBodyPips)
      continue;

    const maxSweepMultiplier = (config as any).maxSweepMultiplier ?? 3;
    const sweepBufferVal = t.sweepBuffer ?? (sweepBuffer);
    const maxSweepBuffer = sweepBufferVal * maxSweepMultiplier;

    if (direction === "BUY" && t.actionCandleLow !== undefined && t.actionCandleLow < t.orLow - maxSweepBuffer) continue;
    if (direction === "SELL" && t.actionCandleHigh !== undefined && t.actionCandleHigh > t.orHigh + maxSweepBuffer) continue;

    if ((config as any).requireCloseInside && t.actionCandleClose !== undefined) {
      if (direction === "BUY" && t.actionCandleClose < t.orLow) continue;
      if (direction === "SELL" && t.actionCandleClose > t.orHigh) continue;
    }

    // Reversal Entry Thresholds
    const pct =
      (config as any).rangeFilterPct ??
      (config as any).entryPenetrationPct ??
      0;
    const entryPenetration = pct / 100;

    const limitBuyPrice = roundPrice(t.orLow + t.boxSize * entryPenetration, pair);
    const limitSellPrice = roundPrice(t.orHigh - t.boxSize * entryPenetration, pair);

    // Initial proposed SL (Option A/B)
    let proposedSl =
      direction === "BUY"
        ? t.orLow - sweepBuffer - slBuffer
        : t.orHigh + sweepBuffer + spreadPts + slBuffer;

    let limitPrice = direction === "BUY" ? limitBuyPrice : limitSellPrice;
    const slDistPips = Math.abs(limitPrice - proposedSl) / pipSize;

    if (config.minSlDist !== undefined && slDistPips < config.minSlDist) {
      proposedSl =
        direction === "BUY"
          ? limitPrice - config.minSlDist * pipSize
          : limitPrice + config.minSlDist * pipSize;
    } else if (
      config.maxSlDist !== undefined &&
      slDistPips > config.maxSlDist
    ) {
      proposedSl =
        direction === "BUY"
          ? limitPrice - config.maxSlDist * pipSize
          : limitPrice + config.maxSlDist * pipSize;
    }

    // ALIGNMENT FIX: The Live Engine sets sageTradeTakenToday = true when it places the limit order,
    // not when the trade activates. Even if the limit order expires/misses, it locks out the day.
    tradedDates[t.tradingDayId] = true;

    let missedTrade = false;
    let tradeActive = false;
    let actualEntryPrice = 0;
    let actualSlPrice = 0;
    let actualTpPrice = 0;
    let actualRisk = 0;
    let currentSL = 0;
    let lastTrailingLevel = 0;

    let outcome: "SKIPPED" | "TP" | "SL" | "EOD" | "NEWS_CLOSE" | null = null;
    let rMultiple = 0;
    let entryTimeMs = 0;

    // MathBacktester starts checking for entry immediately on the sweep M1 candle!
    let startM1Idx = t.m1Index;
    let j_final = startM1Idx;
    for (
      let j = startM1Idx;
      j < Math.min(m1.length, startM1Idx + 5000);
      j++
    ) {
      j_final = j;
      const isEOD = !isCrypto && sessionName !== "asia" && m1.isEOD_standard[j] === 1;
      
      if (isEOD) {
        if (tradeActive) {
          tradedDates[t.tradingDayId] = true;
          outcome = "EOD";
          const exitPrice =
            direction === "BUY" ? m1.close[j] : m1.close[j] + spreadPts;
          rMultiple =
            (direction === "BUY"
              ? exitPrice - actualEntryPrice
              : actualEntryPrice - exitPrice) / actualRisk;
        } else {
          outcome = "SKIPPED";
          rMultiple = 0;
        }
        break;
      }

      if (!tradeActive && !missedTrade) {
        // Session reset A: estHour crosses 5 PM EST (17:00) — the daily boundary.
        if (j > startM1Idx && m1.isSessionReset[j] === 1) {
          missedTrade = true;
          outcome = "SKIPPED";
          break;
        }

        // Session reset B: Midnight EST boundary — cancel dangling limit orders (skip for Asia sessions spanning across midnight)
        if (j > startM1Idx && m1.isMidnightExpiry[j] === 1 && sessionName !== "asia" && (config.orbStartHour || 0) < 18) {
          missedTrade = true;
          outcome = "SKIPPED";
          break;
        }

        // PARITY: Cancel pending orders when the 4-hour session sweep window expires
        // This matches Live Engine which discards unfilled limit orders after the 4-hour sweep window
        const orbStartMins = config.orbStartHour * 60 + config.orbStartMin;
        const orbDurationMins = config.orbMinutes || 60; // fallback to 60 if missing
        const endSweepMins = orbStartMins + orbDurationMins + 4 * 60; // 4 hours after ORB finishes
        
        const currentMins = m1.estHour[j] * 60 + m1.minute[j];
        let isInsideSession = false;
        if (endSweepMins >= 1440) {
          isInsideSession = currentMins >= orbStartMins || currentMins <= endSweepMins % 1440;
        } else {
          isInsideSession = currentMins >= orbStartMins && currentMins <= endSweepMins;
        }
        
        if (!isInsideSession) {
          missedTrade = true;
          outcome = "SKIPPED";
          break;
        }

        if (m1.isNewsForceClose[j] === 1) {
          missedTrade = true;
          outcome = "SKIPPED";
          break;
        }



        if (!config.entryPenetrationPct || config.entryPenetrationPct === 0) {
          entryTimeMs = m1.timestamp[j];
          const filledPrice = direction === "BUY" ? m1.open[j] + spreadPts : m1.open[j];
          if ((direction === "BUY" && filledPrice <= proposedSl) || (direction === "SELL" && filledPrice >= proposedSl)) {
            tradeActive = true;
            outcome = "SL";
            rMultiple = -1.0;
            break;
          } else {
            tradeActive = true;
            actualEntryPrice = filledPrice;
          }
        } else if (direction === "BUY") {
          if (m1.open[j] + spreadPts <= limitBuyPrice) {
            entryTimeMs = m1.timestamp[j];
            const filledPrice = Math.min(m1.open[j] + spreadPts, limitBuyPrice);
            if (filledPrice <= proposedSl) {
              // Immediately stopped out at the gap price
              tradeActive = true;
              outcome = "SL";
              rMultiple = -1.0;
              break;
            } else {
              tradeActive = true;
              actualEntryPrice = filledPrice;
            }
          } else if (m1.low[j] + spreadPts <= limitBuyPrice) {
            tradeActive = true;
            entryTimeMs = m1.timestamp[j];
            actualEntryPrice = limitBuyPrice;
          }
        } else {
          if (m1.open[j] >= limitSellPrice) {
            entryTimeMs = m1.timestamp[j];
            const filledPrice = Math.max(m1.open[j], limitSellPrice);
            if (filledPrice >= proposedSl) {
              // Immediately stopped out at the gap price
              tradeActive = true;
              outcome = "SL";
              rMultiple = -1.0;
              break;
            } else {
              tradeActive = true;
              actualEntryPrice = filledPrice;
            }
          } else if (m1.high[j] >= limitSellPrice) {
            tradeActive = true;
            entryTimeMs = m1.timestamp[j];
            actualEntryPrice = limitSellPrice;
          }
        }

          if (tradeActive) {
            // Use clampedSl fixed at order placement, penalizing gap-fills correctly.
            actualSlPrice = roundPrice(proposedSl, pair);
            currentSL = actualSlPrice;
            const limitPrice = direction === "BUY" ? limitBuyPrice : limitSellPrice;
            const initialRisk = (!config.entryPenetrationPct || config.entryPenetrationPct === 0)
              ? Math.abs(actualEntryPrice - proposedSl)
              : Math.abs(limitPrice - proposedSl);

            if (config.exitMode === "MIDPOINT") {
              actualTpPrice = roundPrice((t.orHigh + t.orLow) / 2.0, pair);
            } else if (config.exitMode === "OPPOSITE_BOUNDARY") {
              actualTpPrice = roundPrice(direction === "BUY" ? t.orHigh : t.orLow, pair);
            } else if (config.exitMode === "ORB_EXTENSION") {
              const ext = t.boxSize * 2;
              actualTpPrice = roundPrice(
                direction === "BUY"
                  ? limitBuyPrice + ext
                  : limitSellPrice - ext,
                pair
              );
            } else {
              actualTpPrice = roundPrice(
                direction === "BUY"
                  ? limitPrice + 50.0 * initialRisk
                  : limitPrice - 50.0 * initialRisk,
                pair
              );
            }

            // Assign initialRisk to actualRisk for backwards-compatibility in struct fields
            actualRisk = initialRisk;
          }
        }

      if (tradeActive) {
        let slHit = false;
        let tpHit = false;

        if (direction === "BUY") {
          slHit = m1.low[j] <= currentSL;
          tpHit = m1.high[j] >= actualTpPrice;
          if (slHit && tpHit) {
            slHit = true;
            tpHit = false;
          }

          if (slHit) {
            outcome = "SL";
            const exitPrice = Math.min(m1.open[j], currentSL);
            rMultiple = (exitPrice - actualEntryPrice) / actualRisk;
            break;
          }

          const currentR = (m1.high[j] - actualEntryPrice) / actualRisk;
          const tTrig = config.trailingSlTrigger;
          const tStep = config.trailingSlStep;

          if (config.exitMode === "TRAILING") {
            if (tTrig !== undefined && currentR >= tTrig && currentSL < actualEntryPrice) {
              currentSL = roundPrice(actualEntryPrice, pair);
              lastTrailingLevel = 0;
            }
            if (tTrig !== undefined && tStep !== undefined && currentR >= tTrig + tStep) {
              const numSteps = Math.floor((currentR - tTrig) / tStep);
              const rLevelToLock = numSteps * tStep;
              if (rLevelToLock > lastTrailingLevel) {
                lastTrailingLevel = rLevelToLock;
                const bd = getDigitsForPair(pair);
                const proposedSL = Number((actualEntryPrice + rLevelToLock * actualRisk).toFixed(bd));
                if (proposedSL > currentSL) currentSL = roundPrice(proposedSL, pair);
              }
            }
          }

          if (tpHit) {
            outcome = "TP";
            rMultiple = (actualTpPrice - actualEntryPrice) / actualRisk;
            break;
          }
        } else {
          slHit = m1.high[j] + spreadPts >= currentSL;
          tpHit = m1.low[j] + spreadPts <= actualTpPrice; // Match Shadow: SELL TP fires on ask
          if (slHit && tpHit) {
            slHit = true;
            tpHit = false;
          }

          if (slHit) {
            outcome = "SL";
            const exitPrice = Math.max(m1.open[j] + spreadPts, currentSL);
            rMultiple = (actualEntryPrice - exitPrice) / actualRisk;
            break;
          }

          const currentR =
            (actualEntryPrice - (m1.low[j] + spreadPts)) / actualRisk;
          const tTrig = config.trailingSlTrigger;
          const tStep = config.trailingSlStep;

          if (config.exitMode === "TRAILING") {
            if (tTrig !== undefined && currentR >= tTrig && currentSL > actualEntryPrice) {
              currentSL = roundPrice(actualEntryPrice, pair);
              lastTrailingLevel = 0;
            }
            if (tTrig !== undefined && tStep !== undefined && currentR >= tTrig + tStep) {
              const numSteps = Math.floor((currentR - tTrig) / tStep);
              const rLevelToLock = numSteps * tStep;
              if (rLevelToLock > lastTrailingLevel) {
                lastTrailingLevel = rLevelToLock;
                const bd = getDigitsForPair(pair);
                const proposedSL = Number((actualEntryPrice - rLevelToLock * actualRisk).toFixed(bd));
                if (proposedSL < currentSL) currentSL = roundPrice(proposedSL, pair);
              }
            }
          }

          if (tpHit) {
            outcome = "TP";
            rMultiple = (actualEntryPrice - actualTpPrice) / actualRisk;
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
              ? exitPrice - actualEntryPrice
              : actualEntryPrice - exitPrice) / actualRisk;
          break;
        }
      }
    } // End M1 Check

    if (outcome === null) {
      if (tradeActive) {
        outcome = "EOD";
        const final_j = Math.min(m1.length - 1, startM1Idx + 5000 - 1);
        const exitPrice =
          direction === "BUY" ? m1.close[final_j] : m1.close[final_j] + spreadPts;
        rMultiple =
          (direction === "BUY"
            ? exitPrice - actualEntryPrice
            : actualEntryPrice - exitPrice) / actualRisk;
      } else {
        outcome = "SKIPPED";
        rMultiple = 0;
      }
    }

    // Even a SKIPPED/missed order locks out new sweeps until session resets (Live Engine parity)
    tradedDates[t.tradingDayId] = true;

    if (outcome !== "SKIPPED") {
      const dateStr = new Date(m1.timestamp[t.m1Index])
        .toISOString()
        .split("T")[0];
      dailyNetR[dateStr] = (dailyNetR[dateStr] || 0) + rMultiple;
      totalTrades++;
      if (rMultiple > 0) winningTrades++;
      tradeRecords.push({
        timestamp: entryTimeMs,
        rMultiple,
        entryPrice: actualEntryPrice,
        slPrice: actualSlPrice,
        tpPrice: actualTpPrice,
        risk: actualRisk,
        outcome: outcome || "SKIPPED",
        orHigh: t.orHigh,
        orLow: t.orLow,
      });
      
      // Record the exit time for cross-session overlap detection
      const loopEndIdx = Math.min(m1.length - 1, j_final);
      lastTradeCloseTimeMs = m1.timestamp[loopEndIdx] ?? 0;
    }
  }

  const totalNetR = Object.values(dailyNetR).reduce((a, b) => a + b, 0);
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  const pbStr =
    config.entryPenetrationPct !== undefined
      ? `${config.entryPenetrationPct}%`
      : "0%";
  const setupStr = `${sessionName}_${pbStr}_MinSL${config.minSlDist}_MaxSL${config.maxSlDist}_Sweep${(config as any).sweepPips}_MaxSwp${(config as any).maxSweepMultiplier ?? 3}_ReqCls${(config as any).requireCloseInside ?? false}_Exit${config.exitMode}_Trig${config.trailingSlTrigger}_Step${config.trailingSlStep}_FC${(config as any).forceCloseHours}_StartH${(config as any).orbStartHour}_StartM${(config as any).orbStartMin}_OrbMins${(config as any).orbMinutes}_ActMins${config.actionMinutes ?? 5}`;

  return {
    setup: setupStr,
    config: config,
    dailyNetR,
    trades: totalTrades,
    winRate,
    totalNetR,
    tradeRecords,
  };
}

