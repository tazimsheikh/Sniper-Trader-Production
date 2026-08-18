import { DailyContextTracker } from '../../market/DailyContextTracker.js';
import { HTFContextTracker } from '../../market/HTFContextTracker.js';
import { OPTIMIZER_CONFIG } from '../../config/OptimizerPairConfig.js';
import { PairConfigManager } from '../../config/PairConfig.js';
import { TriggerEvent, M1TypedArrays, PairConfig, TradeRecord } from '../../config/types.js';
import { isNewsForceClose } from '../../market/historicalNews.js';
import { isRolloverCircuitBreaker, isToxicDay } from '../../market/MathFilters.js';
import { buildAtrArray } from '../../market/Indicators.js';
import { getFixedEstDate } from './MathCoreUtils.js';


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
  minBodyRatio?: number,
  minCloseLoc?: number,
  htfTrendFilter?: boolean,
  useHtfSar?: boolean,
  config?: PairConfig,
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

  const mageCfgs = PairConfigManager.getMageConfigs(pair);
  const mCfg = config || mageCfgs.find(c => c.session === sessionName) || mageCfgs[0];

  const _minBodyRatio = minBodyRatio ?? mCfg?.minBodyRatio;
  const _minCloseLoc = minCloseLoc ?? mCfg?.minCloseLoc;
  const _requireCloseExtremity = mCfg?.requireCloseExtremity;
  const _htfTrendFilter = htfTrendFilter ?? mCfg?.htfTrendFilter ?? mCfg?.useHtfEma;
  const _useHtfSar = useHtfSar ?? mCfg?.useHtfSar ?? mCfg?.useHtfSarFilter;
  const _minAtrRatio = mCfg?.minAtrRatio ?? 0.35;
  const _maxAtrRatio = mCfg?.maxAtrRatio ?? 1.50;
  const _maxWbr = mCfg?.maxWbr;

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
      const dateStr = getFixedEstDate(new Date(c.timestamp)).toISOString().split("T")[0];
      if (
        isRolloverCircuitBreaker(c.estHour, estMin) ||
        isNewsForceClose(dateStr, c.estHour, estMin)
      ) {
        continue;
      }

      const candleDate = new Date(c.timestamp);
      const utcDay = candleDate.getUTCDay();
      if (mCfg) {
        if (mCfg.toxicHours && mCfg.toxicHours.includes(c.estHour)) continue;
        if (mCfg.toxicDays && isToxicDay(utcDay, mCfg.toxicDays)) continue;
      }

      // Action candle: closed M5 candle c
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

      const direction: "BUY" | "SELL" = buyTriggered ? "BUY" : "SELL";

      // ── HTF Trend Filter (H1 50 EMA) ──
      const h1Idx = htfData.h1IndexMap[i];
      if (_htfTrendFilter && h1Idx >= 50 && htfData.h1Candles && htfData.ema50) {
        const h1Close = htfData.h1Candles[h1Idx]?.close;
        const h1Ema = htfData.ema50[h1Idx];
        if (direction === "BUY" && h1Close < h1Ema) continue;
        if (direction === "SELL" && h1Close > h1Ema) continue;
      }

      // ── HTF Parabolic SAR Anti-Acceleration Veto ──
      if (_useHtfSar && HTFContextTracker.isSarAcceleratingFast(htfData, i, direction)) {
        continue;
      }

      // ── Action Candle Quality Gate ──
      const candleRange = actionCandle.high - actionCandle.low;
      const bodyTop = Math.max(actionCandle.open, actionCandle.close);
      const bodyBottom = Math.min(actionCandle.open, actionCandle.close);
      const candleBody = Math.abs(actionCandle.close - actionCandle.open);
      const cBodyPips = parseFloat((candleBody / pipSize).toFixed(1));

      if (_minBodyRatio !== undefined && _minBodyRatio > 0 && candleRange > 0) {
        if ((candleBody / candleRange) < _minBodyRatio) continue;
      } else if (minBodyPips !== undefined && typeof minBodyPips === 'number' && cBodyPips < minBodyPips) {
        continue;
      }

      if (_maxWbr !== undefined) {
        const bodyPips = Math.max(cBodyPips, 0.1); // prevent division by zero
        const breakoutWick = direction === "BUY" ? actionCandle.high - bodyTop : bodyBottom - actionCandle.low;
        const breakoutWickPips = breakoutWick / pipSize;
        if ((breakoutWickPips / bodyPips) > _maxWbr) {
          continue;
        }
      }

      // Close Location Ratio (minCloseLoc or requireCloseExtremity)
      if (_minCloseLoc !== undefined && candleRange > 0) {
        const closePercentile = (actionCandle.close - actionCandle.low) / candleRange;
        const buyMin = _minCloseLoc > 0.5 ? _minCloseLoc : (1 - _minCloseLoc);
        const sellMax = _minCloseLoc < 0.5 ? _minCloseLoc : (1 - _minCloseLoc);
        if (direction === "BUY" && closePercentile < buyMin) continue;
        if (direction === "SELL" && closePercentile > sellMax) continue;
      } else if (_requireCloseExtremity && candleRange > 0) {
        const closePercentile = (actionCandle.close - actionCandle.low) / candleRange;
        if (direction === "BUY" && closePercentile < 0.70) continue;
        if (direction === "SELL" && closePercentile > 0.30) continue;
      }

      // ── ATR-Relative OR Filter ──
      const orPips = (orHigh - orLow) / pipSize;
      const atrVal = i >= 1 ? atrArr[i - 1] : 0;
      if (atrVal > 0) {
        const ratio = (orPips / (atrVal / pipSize));
        if (ratio < _minAtrRatio || ratio > _maxAtrRatio) {
          continue;
        }
      }

      // ── Max SL Distance Check (for legacy mode) ──
      if (mCfg && mCfg.maxSlDist !== undefined && !mCfg.slMode) {
        const maxSlPips = mCfg.maxSlDist;
        if (orPips + (spreadPts / pipSize) > maxSlPips) {
          continue;
        }
        if (isForex && (orPips + 10) > maxSlPips + 0.001) {
          continue;
        }
      }

      mageTradeTaken = true;

      const rOrHigh = roundPrice(orHigh, pair);
      const rOrLow  = roundPrice(orLow, pair);
      const boxSize = roundPrice(Math.abs(rOrHigh - rOrLow), pair);

      triggers.push({
        m5Index: i,
        m1Index: Math.min(m1Rows.length - 1, m1Idx + 5),
        direction,
        orHigh: rOrHigh,
        orLow: rOrLow,
        boxSize,
        cBodyPips,
        orStartTimestamp,
        actionCandleHigh: actionCandle.high,
        actionCandleLow: actionCandle.low,
        actionCandleOpen: actionCandle.open,
        actionCandleClose: actionCandle.close,
        dateStr: getFixedEstDate(new Date(actionCandle.timestamp)).toISOString().split("T")[0],
        tradingDayId: 0,
      });
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

    if (!config.slMode && config.minBodyPips !== undefined && t.cBodyPips < config.minBodyPips)
      continue;

    // M-4 Parity: ORB range circuit breaker (only for legacy full-box SL mode)
    const orRangePips = t.boxSize / pipSize;
    if (
      !config.slMode &&
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

    // Configurable Stop Loss Geometry
    const slMode = (config.slMode || "OPPOSITE_BOUNDARY").toUpperCase();
    let proposedSl = 0;
    if (slMode === "MIDPOINT") {
      const midpoint = (t.orHigh + t.orLow) / 2.0;
      proposedSl = direction === "BUY" ? midpoint : midpoint + spreadPts;
    } else if (slMode === "BREAKOUT_BAR_LOW") {
      const buffer = 2 * pipSize;
      const barLow = t.actionCandleLow ?? t.orLow;
      const barHigh = t.actionCandleHigh ?? t.orHigh;
      proposedSl = direction === "BUY" ? barLow - buffer : barHigh + buffer + spreadPts;
    } else if (slMode === "BOX_30PCT") {
      proposedSl = direction === "BUY" ? t.orHigh - 0.30 * t.boxSize : t.orLow + 0.30 * t.boxSize + spreadPts;
    } else {
      // Default: "OPPOSITE_BOUNDARY"
      proposedSl =
        direction === "BUY"
          ? t.orLow - slBuffer
          : t.orHigh + spreadPts + slBuffer;
    }

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

    if (initialRisk <= 0 || (config.maxSlDist !== undefined && initialRisk > (config.maxSlDist + 0.001) * pipSize)) {
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
      const mult = config.tpAtrMultiplier ?? 2.0;
      const ext = t.boxSize * mult;
      tpPrice = roundPrice(direction === "BUY" ? entryPrice + ext : entryPrice - ext, pair);
    } else if (config.exitMode === "FIXED_R") {
      const mult = config.tpAtrMultiplier ?? 1.0;
      tpPrice = roundPrice(direction === "BUY" ? entryPrice + mult * initialRisk : entryPrice - mult * initialRisk, pair);
    }

    let missedTrade = false;
    let currentSL = roundPrice(slPrice, pair);
    let lastTrailingLevel = 0;
    let tradeActive = false;
    let outcome: "SKIPPED" | "TP" | "SL" | "EOD" | "EXPIRED" | "NEWS_CLOSE" | null = null;
    let rMultiple = 0;
    let entryTimeMs = 0;

    // isInstantFill logic matching MageEngine (fallback to market)
    const proximityThreshold = Math.max(1.5 * pipSize, (optCfg?.spread || 1) * 2.5 * pipSize, 0.10 * Math.abs(entryPrice - slPrice));
    const currentM5Close = m5Candles[t.m5Index].close;
    const m5CurrentPrice = direction === "BUY" ? currentM5Close + spreadPts : currentM5Close;
    const distFromEntry = direction === "BUY" ? (m5CurrentPrice - entryPrice) : (entryPrice - m5CurrentPrice);
    const isWithinProximity = Math.abs(distFromEntry) <= proximityThreshold || (direction === "BUY" ? m5CurrentPrice <= entryPrice : m5CurrentPrice >= entryPrice);
    let isInstantFill = (pbPct === 0) || isWithinProximity;

    let exitTimeMs = 0;
    const startJ = isInstantFill ? t.m1Index : t.m1Index + 1;
    // Using M1 Precision! Max 5000 minutes (approx 1000 M5 candles)
    for (
      let j = startJ;
      j < Math.min(m1.length, t.m1Index + 5000);
      j++
    ) {
      if (tradeActive) exitTimeMs = m1.timestamp[j];

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

          if (direction === "BUY") {
            if (isInstantFill || m1.open[j] + spreadPts <= limitBuyPrice || m1.low[j] + spreadPts <= limitBuyPrice) {
              entryTimeMs = m1.timestamp[j];
              const filledPrice = isInstantFill ? m1.open[j] + spreadPts : Math.min(m1.open[j] + spreadPts, limitBuyPrice);
              if (filledPrice <= slPrice) { tradeActive = true; outcome = "SL"; rMultiple = -1.0; break; }
              else { tradeActive = true; entryPrice = filledPrice; initialRisk = Math.abs(entryPrice - slPrice); }
            }
          } else if (direction === "SELL") {
            if (isInstantFill || m1.open[j] >= limitSellPrice || m1.high[j] >= limitSellPrice) {
              entryTimeMs = m1.timestamp[j];
              const filledPrice = isInstantFill ? m1.open[j] : Math.max(m1.open[j], limitSellPrice);
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

        const isEntryBar = (entryTimeMs === m1.timestamp[j]);

        // ─── STEP 1: CHECK SL/TP AGAINST THE PRE-UPDATE STOP ─────────────────
        // For non-entry bars, SL hit is strictly checked against the pre-update stop.
        // For the entry bar of a directional breakout (close >= open for BUY),
        // the impulse happens first, matching LiveOrchestrator tick execution.
        if (direction === "BUY") {
          const isBullishEntry = isEntryBar && m1.close[j] >= m1.open[j];
          if (!isBullishEntry) {
            slHit = m1.low[j] <= currentSL;
          }
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

          if (tpHit) {
            outcome = "TP";
            rMultiple = (tpPrice - entryPrice) / initialRisk;
            break;
          }
        } else {
          const isBearishEntry = isEntryBar && m1.close[j] <= m1.open[j];
          if (!isBearishEntry) {
            slHit = m1.high[j] + spreadPts >= currentSL;
          }
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

          if (tpHit) {
            outcome = "TP";
            rMultiple = (entryPrice - tpPrice) / initialRisk;
            break;
          }
        }

        // ─── STEP 2: UPDATE TRAILING STOP FOR FUTURE BARS ────────────────────
        // Only reached if trade is still alive. The SL update here only affects
        // bars AFTER this one.
        const currentR = direction === "BUY"
          ? (m1.high[j] - entryPrice) / initialRisk
          : (entryPrice - (m1.low[j] + spreadPts)) / initialRisk;

        const isAdtel = !!(config.adtelEnabled || config.useAdtelTrailing || config.exitMode?.startsWith("ADTEL"));

        if (isAdtel) {
          let beTrig = config.adtelBeTrigger ?? 0.25;
          let beLock = config.adtelBeLock ?? 0.10;
          let pTrig1 = config.adtelProfitLockTrigger ?? 0.75;
          let pLock1 = config.adtelProfitLockLevel ?? 0.50;
          let pTrig2 = config.adtelProfitLockTrigger2 ?? 1.10;
          let pLock2 = config.adtelProfitLockLevel2 ?? 0.80;
          let aStep = config.adtelStep ?? 0.25;

          if (config.exitMode === "ADTEL_AGGRESSIVE") {
            beTrig = 0.25; beLock = 0.05; pTrig1 = 0.6; pLock1 = 0.4; pTrig2 = 1.5; pLock2 = 1.2; aStep = 0.5;
          } else if (config.exitMode === "ADTEL_MODERATE") {
            beTrig = 0.50; beLock = 0.10; pTrig1 = 1.0; pLock1 = 0.75; pTrig2 = 2.0; pLock2 = 1.5; aStep = 0.5;
          } else if (config.exitMode === "ADTEL_CONSERVATIVE") {
            beTrig = 0.75; beLock = 0.25; pTrig1 = 1.5; pLock1 = 1.0; pTrig2 = 2.5; pLock2 = 2.0; aStep = 1.0;
          }

          // Tier 1: Early Break-Even trigger
          if (currentR >= beTrig && lastTrailingLevel < beLock) {
            lastTrailingLevel = beLock;
            const proposed = direction === "BUY" ? entryPrice + beLock * initialRisk : entryPrice - beLock * initialRisk;
            currentSL = roundPrice(proposed, pair);
          }
          // Tier 2: Mid-profit lock
          if (currentR >= pTrig1 && lastTrailingLevel < pLock1) {
            lastTrailingLevel = pLock1;
            const proposed = direction === "BUY" ? entryPrice + pLock1 * initialRisk : entryPrice - pLock1 * initialRisk;
            currentSL = roundPrice(proposed, pair);
          }
          // Tier 3: High-profit lock
          if (currentR >= pTrig2 && lastTrailingLevel < pLock2) {
            lastTrailingLevel = pLock2;
            const proposed = direction === "BUY" ? entryPrice + pLock2 * initialRisk : entryPrice - pLock2 * initialRisk;
            currentSL = roundPrice(proposed, pair);
          }
          // Tier 4: Stepped trailing beyond Tier 3
          if (currentR >= pTrig2 + aStep) {
            const steps = Math.floor((currentR - pTrig2) / aStep);
            const level = pLock2 + steps * aStep;
            if (level > lastTrailingLevel) {
              lastTrailingLevel = level;
              const proposed = direction === "BUY" ? entryPrice + level * initialRisk : entryPrice - level * initialRisk;
              currentSL = roundPrice(proposed, pair);
            }
          }
        } else {
          const tTrig = config.trailingSlTrigger;
          const tStep = config.trailingSlStep;

          if (direction === "BUY") {
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
          } else {
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
          }
        }

        // ─── STEP 3: FORCE-CLOSE CHECKS (News / Time-based) ──────────────────
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

    const dateStr = getFixedEstDate(new Date(m5Candles[t.m5Index].timestamp))
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

