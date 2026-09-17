import { HTFContextTracker } from '../../market/HTFContextTracker.js';
import { OPTIMIZER_CONFIG } from '../../config/OptimizerPairConfig.js';
import { PairConfigManager } from '../../config/PairConfig.js';
import { TriggerEvent, M1TypedArrays, PairConfig, TradeRecord } from '../../config/types.js';
import { isNewsForceClose } from '../../market/historicalNews.js';
import { isRolloverCircuitBreaker, isToxicDay } from '../../market/MathFilters.js';
import { buildAtrArray } from '../../market/Indicators.js';
import { getFixedEstDate, gte, lte, PRICE_EPSILON } from './MathCoreUtils.js';


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

      const estDay = getFixedEstDate(new Date(c.timestamp)).getUTCDay();
      if (mCfg) {
        if (mCfg.toxicHours && mCfg.toxicHours.includes(c.estHour)) continue;
        if (mCfg.toxicDays && isToxicDay(estDay, mCfg.toxicDays)) continue;
      }

      // Action candle: closed M5 candle c
      const actionCandle = c;
      const actionCandleMins = actionCandle.estHour * 60 + (actionCandle.estMin || 0);
      const judasDelay = mCfg?.judasDelayMins ?? 0;
      if (actionCandleMins < startMins + orbMinutes + judasDelay) continue;

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
      if (_htfTrendFilter && h1Idx !== undefined && h1Idx >= 50 && htfData.h1Candles && htfData.ema50) {
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
  const optCfg = OPTIMIZER_CONFIG[pair.replace(".Daily", "").split("_")[0]];
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
  let lastTradedSessionTimestamp = -1;

  for (const t of triggers) {
    if (t.orStartTimestamp === lastTradedSessionTimestamp) continue;
    const triggerTs = m5Candles[t.m5Index].timestamp;
    if (triggerTs < lastTradeCloseTimeMs) continue;

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
    const currentM5Close = m5Candles[t.m5Index].close;
    let entryPrice = (pbPct > 0)
      ? (direction === "BUY" ? limitBuyPrice : limitSellPrice)
      : roundPrice(direction === "BUY" ? currentM5Close + spreadPts : currentM5Close, pair);
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
      continue;
    }

    lastTradedSessionTimestamp = t.orStartTimestamp;

    if (config.splitEntryEnabled) {
      const marketWeight = config.splitEntryMarketRiskPct ?? 0.50;
      const limitWeight = config.splitEntryLimitRiskPct ?? 0.50;

      // Tranche 1 (Market Momentum Entry)
      const t1Entry = roundPrice(direction === "BUY" ? currentM5Close + spreadPts : currentM5Close, pair);
      const t1Sl = slPrice;
      let t1CurrentSL = roundPrice(t1Sl, pair);
      const t1InitialRisk = Math.abs(t1Entry - t1Sl);
      if (t1InitialRisk <= 0) continue;

      let t1Tp = roundPrice(
        direction === "BUY" ? t1Entry + 50.0 * t1InitialRisk : t1Entry - 50.0 * t1InitialRisk,
        pair
      );
      if (config.exitMode === "MIDPOINT") {
        t1Tp = roundPrice((t.orHigh + t.orLow) / 2, pair);
      } else if (config.exitMode === "OPPOSITE_BOUNDARY") {
        t1Tp = roundPrice(direction === "BUY" ? t.orHigh : t.orLow, pair);
      } else if (config.exitMode === "ORB_EXTENSION") {
        const mult = config.tpAtrMultiplier ?? 2.0;
        const ext = t.boxSize * mult;
        t1Tp = roundPrice(direction === "BUY" ? t1Entry + ext : t1Entry - ext, pair);
      } else if (config.exitMode === "FIXED_R") {
        const mult = config.tpAtrMultiplier ?? 1.0;
        t1Tp = roundPrice(direction === "BUY" ? t1Entry + mult * t1InitialRisk : t1Entry - mult * t1InitialRisk, pair);
      }

      let t1Active = true;
      let t1Outcome: "SKIPPED" | "TP" | "SL" | "EOD" | "EXPIRED" | "NEWS_CLOSE" | null = null;
      let t1R = 0;
      let t1EntryTimeMs = m1.timestamp[t.m1Index];
      let t1ExitTimeMs = 0;
      let t1HighestReached = -Infinity;
      let t1LowestReached = Infinity;
      let t1HasTakenPartial = false;
      let t1PartialR = 0;
      let t1LastTrailingLevel = 0;

      // Tranche 2 (Limit Retest Entry)
      const retestPct = config.splitEntryRetestPct ?? (pbPct > 0 ? pbPct : 0.0);
      const limitBuyPrice2 = roundPrice(t.orHigh - t.boxSize * retestPct, pair);
      const limitSellPrice2 = roundPrice(t.orLow + t.boxSize * retestPct, pair);
      const t2LimitTarget = direction === "BUY" ? limitBuyPrice2 : limitSellPrice2;
      const t2Sl = slPrice;
      let t2CurrentSL = roundPrice(t2Sl, pair);
      let t2InitialRisk = Math.abs(t2LimitTarget - t2Sl);
      if (t2InitialRisk <= 0) t2InitialRisk = t1InitialRisk;

      let t2Tp = roundPrice(
        direction === "BUY" ? t2LimitTarget + 50.0 * t2InitialRisk : t2LimitTarget - 50.0 * t2InitialRisk,
        pair
      );
      if (config.exitMode === "MIDPOINT") {
        t2Tp = roundPrice((t.orHigh + t.orLow) / 2, pair);
      } else if (config.exitMode === "OPPOSITE_BOUNDARY") {
        t2Tp = roundPrice(direction === "BUY" ? t.orHigh : t.orLow, pair);
      } else if (config.exitMode === "ORB_EXTENSION") {
        const mult = config.tpAtrMultiplier ?? 2.0;
        const ext = t.boxSize * mult;
        t2Tp = roundPrice(direction === "BUY" ? t2LimitTarget + ext : t2LimitTarget - ext, pair);
      } else if (config.exitMode === "FIXED_R") {
        const mult = config.tpAtrMultiplier ?? 1.0;
        t2Tp = roundPrice(direction === "BUY" ? t2LimitTarget + mult * t2InitialRisk : t2LimitTarget - mult * t2InitialRisk, pair);
      }

      let t2Pending = true;
      let t2Active = false;
      let t2Entry = t2LimitTarget;
      let t2Outcome: "SKIPPED" | "TP" | "SL" | "EOD" | "EXPIRED" | "NEWS_CLOSE" | null = null;
      let t2R = 0;
      let t2EntryTimeMs = 0;
      let t2ExitTimeMs = 0;
      let t2HighestReached = -Infinity;
      let t2LowestReached = Infinity;
      let t2HasTakenPartial = false;
      let t2PartialR = 0;
      let t2LastTrailingLevel = 0;

      const isSplitRunner = !!config.splitRunnerEnabled || config.exitMode === "SPLIT_RUNNER";
      const splitTargetR = config.splitRunnerTargetR ?? 1.5;
      const splitBankPct = config.splitRunnerBankPct ?? 0.50;
      const splitBeLock = config.splitRunnerBeLock ?? 0.10;

      const isAdtel = !!(config.adtelEnabled || config.useAdtelTrailing || config.exitMode?.startsWith("ADTEL"));
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

      const limitPlacedAt = m5Candles[t.m5Index].timestamp;
      const startJ = t.m1Index;

      for (let j = startJ; j < Math.min(m1.length, t.m1Index + 5000); j++) {
        if (t1Active) t1ExitTimeMs = m1.timestamp[j];
        if (t2Active) t2ExitTimeMs = m1.timestamp[j];

        // ── Step A: Check Pending Tranche 2 ──
        if (t2Pending) {
          const fcHours = config.forceCloseHours;
          const isTimedOut = fcHours !== undefined && (m1.timestamp[j] - limitPlacedAt >= fcHours * 3600000);
          const isRollover = m1.isSessionReset[j] === 1 || isRolloverCircuitBreaker(m1.estHour[j], m1.minute[j]);
          const isNewsClose = m1.isNewsForceClose[j] === 1;
          const isAsiaSession = config.session === "asia" || (config.orbStartHour !== undefined && config.orbStartHour >= 18);
          const isMidnight = !isAsiaSession && m1.isMidnightExpiry[j] === 1;

          // Cancellation: If Tranche 1 closed, or reached BE, or TP swept, or market close/rollover
          const t1ReachedBE = t1HasTakenPartial || t1LastTrailingLevel >= (isSplitRunner ? splitBeLock : beLock);
          const t1Closed = !t1Active;
          const tpSwept = direction === "BUY" ? m1.high[j] >= t2Tp : (m1.low[j] + spreadPts <= t2Tp);

          if (isTimedOut || isRollover || isNewsClose || isMidnight || t1ReachedBE || t1Closed || tpSwept) {
            t2Pending = false;
            t2Outcome = "SKIPPED";
            t2R = 0;
          } else {
            // Check fill
            if (direction === "BUY") {
              if (lte(m1.open[j] + spreadPts, t2LimitTarget) || lte(m1.low[j] + spreadPts, t2LimitTarget)) {
                t2EntryTimeMs = m1.timestamp[j];
                const filledPrice = Math.min(m1.open[j] + spreadPts, t2LimitTarget);
                t2Pending = false;
                if (filledPrice <= t2Sl) {
                  t2Active = false;
                  t2Outcome = "SL";
                  t2R = -1.0;
                  t2ExitTimeMs = m1.timestamp[j];
                } else {
                  t2Active = true;
                  t2Entry = roundPrice(filledPrice, pair);
                  t2InitialRisk = Math.abs(t2Entry - t2Sl);
                }
              }
            } else {
              if (gte(m1.open[j], t2LimitTarget) || gte(m1.high[j], t2LimitTarget)) {
                t2EntryTimeMs = m1.timestamp[j];
                const filledPrice = Math.max(m1.open[j], t2LimitTarget);
                t2Pending = false;
                if (filledPrice + spreadPts >= t2Sl) {
                  t2Active = false;
                  t2Outcome = "SL";
                  t2R = -1.0;
                  t2ExitTimeMs = m1.timestamp[j];
                } else {
                  t2Active = true;
                  t2Entry = roundPrice(filledPrice, pair);
                  t2InitialRisk = Math.abs(t2Entry - t2Sl);
                }
              }
            }
          }
        }

        // ── Step B: Evaluate Tranche 1 ──
        if (t1Active) {
          // SL / TP Check
          let slHit = false;
          let tpHit = false;
          if (direction === "BUY") {
            slHit = m1.low[j] <= t1CurrentSL;
            tpHit = m1.high[j] >= t1Tp;
            if (slHit && tpHit) { slHit = true; tpHit = false; }
            if (slHit) {
              t1Outcome = "SL";
              const exitPrice = Math.min(m1.open[j], t1CurrentSL);
              const exitR = (exitPrice - t1Entry) / t1InitialRisk;
              t1R = t1HasTakenPartial ? (t1PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
              t1Active = false;
              t1ExitTimeMs = m1.timestamp[j];
            } else if (tpHit) {
              t1Outcome = "TP";
              const exitR = (t1Tp - t1Entry) / t1InitialRisk;
              t1R = t1HasTakenPartial ? (t1PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
              t1Active = false;
              t1ExitTimeMs = m1.timestamp[j];
            }
          } else {
            slHit = gte(m1.high[j] + spreadPts, t1CurrentSL);
            tpHit = m1.low[j] + spreadPts <= t1Tp;
            if (slHit && tpHit) { slHit = true; tpHit = false; }
            if (slHit) {
              t1Outcome = "SL";
              const exitPrice = Math.max(m1.open[j] + spreadPts, t1CurrentSL);
              const exitR = (t1Entry - exitPrice) / t1InitialRisk;
              t1R = t1HasTakenPartial ? (t1PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
              t1Active = false;
              t1ExitTimeMs = m1.timestamp[j];
            } else if (tpHit) {
              t1Outcome = "TP";
              const exitR = (t1Entry - t1Tp) / t1InitialRisk;
              t1R = t1HasTakenPartial ? (t1PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
              t1Active = false;
              t1ExitTimeMs = m1.timestamp[j];
            }
          }

          // Trailing Update for Tranche 1
          if (t1Active) {
            if (direction === "BUY") {
              t1HighestReached = Math.max(t1HighestReached === -Infinity ? t1Entry : t1HighestReached, m1.high[j]);
            } else {
              t1LowestReached = Math.min(t1LowestReached === Infinity ? t1Entry : t1LowestReached, m1.low[j]);
            }
            const actualR = direction === "BUY"
              ? (t1HighestReached - t1Entry) / t1InitialRisk
              : (t1Entry - (t1LowestReached + spreadPts)) / t1InitialRisk;
            const currentR = actualR;

            if (isSplitRunner && !t1HasTakenPartial && gte(currentR, splitTargetR)) {
              t1HasTakenPartial = true;
              t1PartialR = splitTargetR;
              const bePrice = direction === "BUY" ? t1Entry + splitBeLock * t1InitialRisk : t1Entry - splitBeLock * t1InitialRisk;
              const roundedBe = roundPrice(bePrice, pair);
              if (direction === "BUY" ? roundedBe > t1CurrentSL : roundedBe < t1CurrentSL) {
                t1CurrentSL = roundedBe;
                t1LastTrailingLevel = splitBeLock;
              }
            }

            if (isAdtel) {
              if (gte(currentR, beTrig) && t1LastTrailingLevel < beLock) {
                t1LastTrailingLevel = beLock;
                const proposed = direction === "BUY" ? t1Entry + beLock * t1InitialRisk : t1Entry - beLock * t1InitialRisk;
                t1CurrentSL = roundPrice(proposed, pair);
              }
              if (gte(currentR, pTrig1) && t1LastTrailingLevel < pLock1) {
                t1LastTrailingLevel = pLock1;
                const proposed = direction === "BUY" ? t1Entry + pLock1 * t1InitialRisk : t1Entry - pLock1 * t1InitialRisk;
                t1CurrentSL = roundPrice(proposed, pair);
              }
              if (gte(currentR, pTrig2) && t1LastTrailingLevel < pLock2) {
                t1LastTrailingLevel = pLock2;
                const proposed = direction === "BUY" ? t1Entry + pLock2 * t1InitialRisk : t1Entry - pLock2 * t1InitialRisk;
                t1CurrentSL = roundPrice(proposed, pair);
              }
              if (gte(currentR, pTrig2 + aStep)) {
                const steps = Math.floor((currentR - pTrig2 + PRICE_EPSILON) / aStep);
                const level = pLock2 + steps * aStep;
                if (level > t1LastTrailingLevel) {
                  t1LastTrailingLevel = level;
                  const proposed = direction === "BUY" ? t1Entry + level * t1InitialRisk : t1Entry - level * t1InitialRisk;
                  t1CurrentSL = roundPrice(proposed, pair);
                }
              }
            } else {
              const tTrig = config.trailingSlTrigger;
              const tStep = config.trailingSlStep;
              if (direction === "BUY") {
                if (tTrig !== undefined && gte(currentR, tTrig) && t1CurrentSL < t1Entry) {
                  t1CurrentSL = roundPrice(t1Entry, pair);
                  t1LastTrailingLevel = 0;
                }
                if (tTrig !== undefined && tStep !== undefined && gte(currentR, tTrig + tStep)) {
                  const numSteps = Math.floor((currentR - tTrig) / tStep);
                  const rLevelToLock = numSteps * tStep;
                  if (rLevelToLock > t1LastTrailingLevel) {
                    t1LastTrailingLevel = rLevelToLock;
                    const bd = getDigitsForPair(pair);
                    const proposedSL = Number((t1Entry + rLevelToLock * t1InitialRisk).toFixed(bd));
                    if (proposedSL > t1CurrentSL) t1CurrentSL = roundPrice(proposedSL, pair);
                  }
                }
              } else {
                if (tTrig !== undefined && gte(currentR, tTrig) && t1CurrentSL > t1Entry) {
                  t1CurrentSL = roundPrice(t1Entry, pair);
                  t1LastTrailingLevel = 0;
                }
                if (tTrig !== undefined && tStep !== undefined && gte(currentR, tTrig + tStep)) {
                  const numSteps = Math.floor((currentR - tTrig) / tStep);
                  const rLevelToLock = numSteps * tStep;
                  if (rLevelToLock > t1LastTrailingLevel) {
                    t1LastTrailingLevel = rLevelToLock;
                    const bd = getDigitsForPair(pair);
                    const proposedSL = Number((t1Entry - rLevelToLock * t1InitialRisk).toFixed(bd));
                    if (proposedSL < t1CurrentSL) t1CurrentSL = roundPrice(proposedSL, pair);
                  }
                }
              }
            }

            // Force close check for Tranche 1
            const isNewsForceClose = m1.isNewsForceClose[j] === 1;
            const fcHours = config.forceCloseHours;
            if ((fcHours !== undefined && m1.timestamp[j] - t1EntryTimeMs >= fcHours * 3600000) || isNewsForceClose) {
              t1Outcome = isNewsForceClose ? "NEWS_CLOSE" : "EOD";
              const exitPrice = direction === "BUY" ? m1.close[j] : m1.close[j] + spreadPts;
              const exitR = (direction === "BUY" ? exitPrice - t1Entry : t1Entry - exitPrice) / t1InitialRisk;
              t1R = t1HasTakenPartial ? (t1PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
              t1Active = false;
              t1ExitTimeMs = m1.timestamp[j];
            }
          }
        }

        // ── Step C: Evaluate Tranche 2 (if active) ──
        if (t2Active) {
          // SL / TP Check
          let slHit = false;
          let tpHit = false;
          if (direction === "BUY") {
            slHit = m1.low[j] <= t2CurrentSL;
            tpHit = m1.high[j] >= t2Tp;
            if (slHit && tpHit) { slHit = true; tpHit = false; }
            if (slHit) {
              t2Outcome = "SL";
              const exitPrice = Math.min(m1.open[j], t2CurrentSL);
              const exitR = (exitPrice - t2Entry) / t2InitialRisk;
              t2R = t2HasTakenPartial ? (t2PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
              t2Active = false;
              t2ExitTimeMs = m1.timestamp[j];
            } else if (tpHit) {
              t2Outcome = "TP";
              const exitR = (t2Tp - t2Entry) / t2InitialRisk;
              t2R = t2HasTakenPartial ? (t2PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
              t2Active = false;
              t2ExitTimeMs = m1.timestamp[j];
            }
          } else {
            slHit = gte(m1.high[j] + spreadPts, t2CurrentSL);
            tpHit = m1.low[j] + spreadPts <= t2Tp;
            if (slHit && tpHit) { slHit = true; tpHit = false; }
            if (slHit) {
              t2Outcome = "SL";
              const exitPrice = Math.max(m1.open[j] + spreadPts, t2CurrentSL);
              const exitR = (t2Entry - exitPrice) / t2InitialRisk;
              t2R = t2HasTakenPartial ? (t2PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
              t2Active = false;
              t2ExitTimeMs = m1.timestamp[j];
            } else if (tpHit) {
              t2Outcome = "TP";
              const exitR = (t2Entry - t2Tp) / t2InitialRisk;
              t2R = t2HasTakenPartial ? (t2PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
              t2Active = false;
              t2ExitTimeMs = m1.timestamp[j];
            }
          }

          // Trailing Update for Tranche 2
          if (t2Active) {
            if (direction === "BUY") {
              t2HighestReached = Math.max(t2HighestReached === -Infinity ? t2Entry : t2HighestReached, m1.high[j]);
            } else {
              t2LowestReached = Math.min(t2LowestReached === Infinity ? t2Entry : t2LowestReached, m1.low[j]);
            }
            const actualR = direction === "BUY"
              ? (t2HighestReached - t2Entry) / t2InitialRisk
              : (t2Entry - (t2LowestReached + spreadPts)) / t2InitialRisk;
            const currentR = actualR;

            if (isSplitRunner && !t2HasTakenPartial && gte(currentR, splitTargetR)) {
              t2HasTakenPartial = true;
              t2PartialR = splitTargetR;
              const bePrice = direction === "BUY" ? t2Entry + splitBeLock * t2InitialRisk : t2Entry - splitBeLock * t2InitialRisk;
              const roundedBe = roundPrice(bePrice, pair);
              if (direction === "BUY" ? roundedBe > t2CurrentSL : roundedBe < t2CurrentSL) {
                t2CurrentSL = roundedBe;
                t2LastTrailingLevel = splitBeLock;
              }
            }

            if (isAdtel) {
              if (gte(currentR, beTrig) && t2LastTrailingLevel < beLock) {
                t2LastTrailingLevel = beLock;
                const proposed = direction === "BUY" ? t2Entry + beLock * t2InitialRisk : t2Entry - beLock * t2InitialRisk;
                t2CurrentSL = roundPrice(proposed, pair);
              }
              if (gte(currentR, pTrig1) && t2LastTrailingLevel < pLock1) {
                t2LastTrailingLevel = pLock1;
                const proposed = direction === "BUY" ? t2Entry + pLock1 * t2InitialRisk : t2Entry - pLock1 * t2InitialRisk;
                t2CurrentSL = roundPrice(proposed, pair);
              }
              if (gte(currentR, pTrig2) && t2LastTrailingLevel < pLock2) {
                t2LastTrailingLevel = pLock2;
                const proposed = direction === "BUY" ? t2Entry + pLock2 * t2InitialRisk : t2Entry - pLock2 * t2InitialRisk;
                t2CurrentSL = roundPrice(proposed, pair);
              }
              if (gte(currentR, pTrig2 + aStep)) {
                const steps = Math.floor((currentR - pTrig2 + PRICE_EPSILON) / aStep);
                const level = pLock2 + steps * aStep;
                if (level > t2LastTrailingLevel) {
                  t2LastTrailingLevel = level;
                  const proposed = direction === "BUY" ? t2Entry + level * t2InitialRisk : t2Entry - level * t2InitialRisk;
                  t2CurrentSL = roundPrice(proposed, pair);
                }
              }
            } else {
              const tTrig = config.trailingSlTrigger;
              const tStep = config.trailingSlStep;
              if (direction === "BUY") {
                if (tTrig !== undefined && gte(currentR, tTrig) && t2CurrentSL < t2Entry) {
                  t2CurrentSL = roundPrice(t2Entry, pair);
                  t2LastTrailingLevel = 0;
                }
                if (tTrig !== undefined && tStep !== undefined && gte(currentR, tTrig + tStep)) {
                  const numSteps = Math.floor((currentR - tTrig) / tStep);
                  const rLevelToLock = numSteps * tStep;
                  if (rLevelToLock > t2LastTrailingLevel) {
                    t2LastTrailingLevel = rLevelToLock;
                    const bd = getDigitsForPair(pair);
                    const proposedSL = Number((t2Entry + rLevelToLock * t2InitialRisk).toFixed(bd));
                    if (proposedSL > t2CurrentSL) t2CurrentSL = roundPrice(proposedSL, pair);
                  }
                }
              } else {
                if (tTrig !== undefined && gte(currentR, tTrig) && t2CurrentSL > t2Entry) {
                  t2CurrentSL = roundPrice(t2Entry, pair);
                  t2LastTrailingLevel = 0;
                }
                if (tTrig !== undefined && tStep !== undefined && gte(currentR, tTrig + tStep)) {
                  const numSteps = Math.floor((currentR - tTrig) / tStep);
                  const rLevelToLock = numSteps * tStep;
                  if (rLevelToLock > t2LastTrailingLevel) {
                    t2LastTrailingLevel = rLevelToLock;
                    const bd = getDigitsForPair(pair);
                    const proposedSL = Number((t2Entry - rLevelToLock * t2InitialRisk).toFixed(bd));
                    if (proposedSL < t2CurrentSL) t2CurrentSL = roundPrice(proposedSL, pair);
                  }
                }
              }
            }

            // Force close check for Tranche 2
            const isNewsForceClose = m1.isNewsForceClose[j] === 1;
            const fcHours = config.forceCloseHours;
            if ((fcHours !== undefined && m1.timestamp[j] - t2EntryTimeMs >= fcHours * 3600000) || isNewsForceClose) {
              t2Outcome = isNewsForceClose ? "NEWS_CLOSE" : "EOD";
              const exitPrice = direction === "BUY" ? m1.close[j] : m1.close[j] + spreadPts;
              const exitR = (direction === "BUY" ? exitPrice - t2Entry : t2Entry - exitPrice) / t2InitialRisk;
              t2R = t2HasTakenPartial ? (t2PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
              t2Active = false;
              t2ExitTimeMs = m1.timestamp[j];
            }
          }
        }

        // Break if both are done
        if (!t1Active && !t2Active && !t2Pending) {
          break;
        }
      }

      // Handle EOD fallback if loop finished while still active
      const final_j = Math.min(m1.length - 1, t.m1Index + 5000 - 1);
      if (t1Active && t1Outcome === null) {
        t1Outcome = "EOD";
        const exitPrice = direction === "BUY" ? m1.close[final_j] : m1.close[final_j] + spreadPts;
        const exitR = (direction === "BUY" ? exitPrice - t1Entry : t1Entry - exitPrice) / t1InitialRisk;
        t1R = t1HasTakenPartial ? (t1PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
        t1ExitTimeMs = m1.timestamp[final_j];
      }
      if (t2Active && t2Outcome === null) {
        t2Outcome = "EOD";
        const exitPrice = direction === "BUY" ? m1.close[final_j] : m1.close[final_j] + spreadPts;
        const exitR = (direction === "BUY" ? exitPrice - t2Entry : t2Entry - exitPrice) / t2InitialRisk;
        t2R = t2HasTakenPartial ? (t2PartialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
        t2ExitTimeMs = m1.timestamp[final_j];
      }

      const dateStr = getFixedEstDate(new Date(m5Candles[t.m5Index].timestamp))
        .toISOString()
        .split("T")[0];

      // Record Tranche 1
      const finalT1R = t1R * marketWeight;
      records.push({
        timestamp: t1EntryTimeMs || m5Candles[t.m5Index].timestamp,
        date: dateStr,
        pair: pair,
        setupType: "ORB_MATH_T1",
        sessionName: sessionName,
        decision: "TRADE",
        confidence: 1.0,
        setupQuality: "N/A",
        reasoning: "MATH_SIMULATION_T1",
        outcome: t1Outcome || "SKIPPED",
        pips: finalT1R ? (finalT1R * t1InitialRisk) / pipSize : null,
        rMultiple: finalT1R,
        entry: t1Entry,
        stopLoss: t1Sl,
        takeProfit: t1Tp,
        riskPips: t1InitialRisk / pipSize,
        orHigh: t.orHigh,
        orLow: t.orLow,
        entryTimeMs: t1EntryTimeMs,
        exitTimeMs: t1ExitTimeMs,
        riskWeight: marketWeight,
      });

      if (t1Outcome !== "SKIPPED") {
        dailyNetR[dateStr] = (dailyNetR[dateStr] || 0) + finalT1R;
        totalTrades++;
        if (finalT1R > 0) winningTrades++;
        lastTradeExitMs = Math.max(lastTradeExitMs, t1ExitTimeMs);
        lastTradeCloseTimeMs = Math.max(lastTradeCloseTimeMs, t1ExitTimeMs);
      }

      // Record Tranche 2 (only if filled)
      if (t2Outcome !== "SKIPPED" && t2Outcome !== null) {
        const finalT2R = t2R * limitWeight;
        records.push({
          timestamp: t2EntryTimeMs || m5Candles[t.m5Index].timestamp,
          date: dateStr,
          pair: pair,
          setupType: "ORB_MATH_T2",
          sessionName: sessionName,
          decision: "TRADE",
          confidence: 1.0,
          setupQuality: "N/A",
          reasoning: "MATH_SIMULATION_T2",
          outcome: t2Outcome,
          pips: finalT2R ? (finalT2R * t2InitialRisk) / pipSize : null,
          rMultiple: finalT2R,
          entry: t2Entry,
          stopLoss: t2Sl,
          takeProfit: t2Tp,
          riskPips: t2InitialRisk / pipSize,
          orHigh: t.orHigh,
          orLow: t.orLow,
          entryTimeMs: t2EntryTimeMs,
          exitTimeMs: t2ExitTimeMs,
          riskWeight: limitWeight,
        });

        dailyNetR[dateStr] = (dailyNetR[dateStr] || 0) + finalT2R;
        totalTrades++;
        if (finalT2R > 0) winningTrades++;
        lastTradeExitMs = Math.max(lastTradeExitMs, t2ExitTimeMs);
        lastTradeCloseTimeMs = Math.max(lastTradeCloseTimeMs, t2ExitTimeMs);
      }

      continue;
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
    let highestReached = -Infinity;
    let lowestReached = Infinity;

    const isSplitRunner = !!config.splitRunnerEnabled || config.exitMode === "SPLIT_RUNNER";
    const splitTargetR = config.splitRunnerTargetR ?? 1.5;
    const splitBankPct = config.splitRunnerBankPct ?? 0.50;
    const splitBeLock = config.splitRunnerBeLock ?? 0.10;
    let hasTakenPartial = false;
    let partialR = 0;

    // isInstantFill logic matching MageEngine (fallback to market)
    const proximityThreshold = Math.max(2.5 * pipSize, (optCfg?.spread || 1) * 2.5 * pipSize, 0.10 * Math.abs(entryPrice - slPrice));
    const m5CurrentPrice = direction === "BUY" ? currentM5Close + spreadPts : currentM5Close;
    const distFromEntry = direction === "BUY" ? (m5CurrentPrice - entryPrice) : (entryPrice - m5CurrentPrice);
    const isWithinProximity = Math.abs(distFromEntry) <= proximityThreshold || (direction === "BUY" ? m5CurrentPrice <= entryPrice : m5CurrentPrice >= entryPrice);
    let isInstantFill = (pbPct === 0) || isWithinProximity;

    let exitTimeMs = 0;
    const isPyramiding = !!config.pyramidingEnabled;
    const pyrTriggerR = config.pyramidingTriggerR ?? 1.5;
    const pyrLockR = config.pyramidingLockR ?? ((config.pyramidingTriggerR ?? 1.5) - 1.0 > 0 ? (config.pyramidingTriggerR ?? 1.5) - 1.0 : 0.5);
    const pyrWeight = config.pyramidingRiskPct ?? 0.50;
    let hasPyramided = false;
    let t2Active = false;
    let t2Entry = 0;
    let t2EntryTimeMs = 0;
    let t2ExitTimeMs = 0;
    let t2Outcome: "SKIPPED" | "TP" | "SL" | "EOD" | "NEWS_CLOSE" | null = null;
    let t2R = 0;

    const startJ = t.m1Index;
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

          // Cancel dangling limit order from the previous day at 17:00 EST rollover or 15:00 EST circuit breaker
          if (m1.isSessionReset[j] === 1 || (!isInstantFill && isRolloverCircuitBreaker(m1.estHour[j], m1.minute[j]))) {
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
            if (isInstantFill || lte(m1.open[j] + spreadPts, limitBuyPrice) || lte(m1.low[j] + spreadPts, limitBuyPrice)) {
              entryTimeMs = m1.timestamp[j];
              const filledPrice = isInstantFill ? m1.open[j] + spreadPts : Math.min(m1.open[j] + spreadPts, limitBuyPrice);
              if (filledPrice <= slPrice) { tradeActive = true; outcome = "SL"; rMultiple = -1.0; break; }
              else { tradeActive = true; entryPrice = roundPrice(filledPrice, pair); initialRisk = Math.abs(entryPrice - slPrice); }
            }
          } else if (direction === "SELL") {
            if (isInstantFill || gte(m1.open[j], limitSellPrice) || gte(m1.high[j], limitSellPrice)) {
              entryTimeMs = m1.timestamp[j];
              const filledPrice = isInstantFill ? m1.open[j] : Math.max(m1.open[j], limitSellPrice);
              if (filledPrice + spreadPts >= slPrice) { tradeActive = true; outcome = "SL"; rMultiple = -1.0; break; }
              else { tradeActive = true; entryPrice = roundPrice(filledPrice, pair); initialRisk = Math.abs(entryPrice - slPrice); }
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
            const exitR = (exitPrice - entryPrice) / initialRisk;
            rMultiple = hasTakenPartial ? (partialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
            if (t2Active) {
              t2Outcome = "SL";
              t2ExitTimeMs = m1.timestamp[j];
              t2R = ((exitPrice - t2Entry) / initialRisk) * pyrWeight;
              t2Active = false;
            }
            break;
          }

          if (tpHit) {
            outcome = "TP";
            const exitR = (tpPrice - entryPrice) / initialRisk;
            rMultiple = hasTakenPartial ? (partialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
            if (t2Active) {
              t2Outcome = "TP";
              t2ExitTimeMs = m1.timestamp[j];
              t2R = ((tpPrice - t2Entry) / initialRisk) * pyrWeight;
              t2Active = false;
            }
            break;
          }
        } else {
          slHit = gte(m1.high[j] + spreadPts, currentSL);
          tpHit = m1.low[j] + spreadPts <= tpPrice;
          if (slHit && tpHit) {
            slHit = true;
            tpHit = false;
          }

          if (slHit) {
            outcome = "SL";
            const exitPrice = Math.max(m1.open[j] + spreadPts, currentSL); // Handle slippage on SL
            const exitR = (entryPrice - exitPrice) / initialRisk;
            rMultiple = hasTakenPartial ? (partialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
            if (t2Active) {
              t2Outcome = "SL";
              t2ExitTimeMs = m1.timestamp[j];
              t2R = ((t2Entry - exitPrice) / initialRisk) * pyrWeight;
              t2Active = false;
            }
            break;
          }

          if (tpHit) {
            outcome = "TP";
            const exitR = (entryPrice - tpPrice) / initialRisk;
            rMultiple = hasTakenPartial ? (partialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
            if (t2Active) {
              t2Outcome = "TP";
              t2ExitTimeMs = m1.timestamp[j];
              t2R = ((t2Entry - tpPrice) / initialRisk) * pyrWeight;
              t2Active = false;
            }
            break;
          }
        }

        // ─── STEP 2: FORCE-CLOSE CHECKS (News / Time-based) ──────────────────
        const isNewsForceClose = m1.isNewsForceClose[j] === 1;
        const fcHours = config.forceCloseHours;
        if ((fcHours !== undefined && m1.timestamp[j] - entryTimeMs >= fcHours * 60 * 60 * 1000) || isNewsForceClose) {
          outcome = isNewsForceClose ? "NEWS_CLOSE" : "EOD";
          const exitPrice =
            direction === "BUY" ? m1.close[j] : m1.close[j] + spreadPts;
          const exitR =
            (direction === "BUY"
              ? exitPrice - entryPrice
              : entryPrice - exitPrice) / initialRisk;
          rMultiple = hasTakenPartial ? (partialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
          if (t2Active) {
            t2Outcome = outcome;
            t2ExitTimeMs = m1.timestamp[j];
            t2R = ((direction === "BUY" ? exitPrice - t2Entry : t2Entry - exitPrice) / initialRisk) * pyrWeight;
            t2Active = false;
          }
          break;
        }

        // ─── STEP 3: UPDATE TRAILING STOP & PYRAMIDING FOR FUTURE BARS ───────
        // Only reached if trade is still alive. The SL update here only affects
        // bars AFTER this one.
        if (direction === "BUY") {
          highestReached = Math.max(highestReached === -Infinity ? entryPrice : highestReached, m1.high[j]);
        } else {
          lowestReached = Math.min(lowestReached === Infinity ? entryPrice : lowestReached, m1.low[j]);
        }

        const intendedEntry = (pbPct > 0)
          ? (direction === "BUY" ? limitBuyPrice : limitSellPrice)
          : entryPrice;
        const intendedRisk = Math.abs(intendedEntry - slPrice);

        const actualR = direction === "BUY"
          ? (highestReached - entryPrice) / initialRisk
          : (entryPrice - (lowestReached + spreadPts)) / initialRisk;

        const theoreticalR = direction === "BUY"
          ? (highestReached - intendedEntry) / (intendedRisk > 0 ? intendedRisk : initialRisk)
          : (intendedEntry - (lowestReached + spreadPts)) / (intendedRisk > 0 ? intendedRisk : initialRisk);

        const currentR = Math.max(actualR, theoreticalR);

        if (isPyramiding && !hasPyramided && gte(currentR, pyrTriggerR)) {
          hasPyramided = true;
          // Lock profit on Tranche 1
          const lockPrice = roundPrice(
            direction === "BUY" ? entryPrice + pyrLockR * initialRisk : entryPrice - pyrLockR * initialRisk,
            pair
          );
          if (direction === "BUY" ? lockPrice > currentSL : lockPrice < currentSL) {
            currentSL = lockPrice;
            lastTrailingLevel = pyrLockR;
          }
          // Enter Tranche 2 at market close of this M1 bar
          t2Active = true;
          t2Entry = roundPrice(direction === "BUY" ? m1.close[j] + spreadPts : m1.close[j], pair);
          t2EntryTimeMs = m1.timestamp[j];
        }

        if (isSplitRunner && !hasTakenPartial && gte(currentR, splitTargetR)) {
          hasTakenPartial = true;
          partialR = splitTargetR;
          const bePrice = direction === "BUY"
            ? entryPrice + splitBeLock * initialRisk
            : entryPrice - splitBeLock * initialRisk;
          const roundedBe = roundPrice(bePrice, pair);
          if (direction === "BUY" ? roundedBe > currentSL : roundedBe < currentSL) {
            currentSL = roundedBe;
            lastTrailingLevel = splitBeLock;
          }
        }

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
          if (gte(currentR, beTrig) && lastTrailingLevel < beLock) {
            lastTrailingLevel = beLock;
            const proposed = direction === "BUY" ? entryPrice + beLock * initialRisk : entryPrice - beLock * initialRisk;
            currentSL = roundPrice(proposed, pair);
          }
          // Tier 2: Mid-profit lock
          if (gte(currentR, pTrig1) && lastTrailingLevel < pLock1) {
            lastTrailingLevel = pLock1;
            const proposed = direction === "BUY" ? entryPrice + pLock1 * initialRisk : entryPrice - pLock1 * initialRisk;
            currentSL = roundPrice(proposed, pair);
          }
          // Tier 3: High-profit lock
          if (gte(currentR, pTrig2) && lastTrailingLevel < pLock2) {
            lastTrailingLevel = pLock2;
            const proposed = direction === "BUY" ? entryPrice + pLock2 * initialRisk : entryPrice - pLock2 * initialRisk;
            currentSL = roundPrice(proposed, pair);
          }
          // Tier 4: Stepped trailing beyond Tier 3
          if (gte(currentR, pTrig2 + aStep)) {
            const steps = Math.floor((currentR - pTrig2 + PRICE_EPSILON) / aStep);
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
          const tickSize = OPTIMIZER_CONFIG[pair.replace('.Daily','').split('_')[0]]?.tickSize ?? 0.00001;

          if (direction === "BUY") {
            if (tTrig !== undefined && gte(currentR, tTrig) && currentSL < entryPrice) {
              currentSL = roundPrice(entryPrice, pair);
              lastTrailingLevel = 0;
            }
            if (tTrig !== undefined && tStep !== undefined && gte(currentR, tTrig + tStep)) {
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
            if (tTrig !== undefined && gte(currentR, tTrig) && currentSL > entryPrice) {
              currentSL = roundPrice(entryPrice, pair);
              lastTrailingLevel = 0;
            }
            if (tTrig !== undefined && tStep !== undefined && gte(currentR, tTrig + tStep)) {
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
      }
    }

    if (outcome === null) {
      if (tradeActive) {
        outcome = "EOD";
        const final_j = Math.min(m1.length - 1, t.m1Index + 5000 - 1);
        const exitPrice =
          direction === "BUY" ? m1.close[final_j] : m1.close[final_j] + spreadPts;
        const exitR =
          (direction === "BUY"
            ? exitPrice - entryPrice
            : entryPrice - exitPrice) / initialRisk;
        rMultiple = hasTakenPartial ? (partialR * splitBankPct + exitR * (1 - splitBankPct)) : exitR;
        exitTimeMs = m1.timestamp[final_j];
        if (t2Active) {
          t2Outcome = "EOD";
          t2ExitTimeMs = exitTimeMs;
          t2R = ((direction === "BUY" ? exitPrice - t2Entry : t2Entry - exitPrice) / initialRisk) * pyrWeight;
          t2Active = false;
        }
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
      setupType: isPyramiding ? "ORB_MATH_T1" : "ORB_MATH",
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
      exitTimeMs: exitTimeMs,
      hasPyramided,
    });

    if (outcome !== "SKIPPED") {
      dailyNetR[dateStr] = (dailyNetR[dateStr] || 0) + rMultiple;
      totalTrades++;
      if (rMultiple > 0) winningTrades++;
      lastTradeExitMs = exitTimeMs;
      lastTradeCloseTimeMs = exitTimeMs;
    }

    if (hasPyramided && t2Outcome !== null && t2Outcome !== "SKIPPED") {
      records.push({
        timestamp: t2EntryTimeMs,
        date: dateStr,
        pair: pair,
        setupType: "ORB_MATH_PYR",
        sessionName: sessionName,
        decision: "TRADE",
        confidence: 1.0,
        setupQuality: "N/A",
        reasoning: "MATH_SIMULATION_PYR",
        outcome: t2Outcome,
        pips: t2R ? (t2R * initialRisk) / pipSize : null,
        rMultiple: t2R,
        entry: t2Entry,
        stopLoss: currentSL,
        takeProfit: tpPrice,
        riskPips: initialRisk / pipSize,
        orHigh: t.orHigh,
        orLow: t.orLow,
        entryTimeMs: t2EntryTimeMs,
        exitTimeMs: t2ExitTimeMs,
        riskWeight: pyrWeight,
        isPyramidChild: true,
      });

      dailyNetR[dateStr] = (dailyNetR[dateStr] || 0) + t2R;
      totalTrades++;
      if (t2R > 0) winningTrades++;
      lastTradeExitMs = Math.max(lastTradeExitMs, t2ExitTimeMs);
      lastTradeCloseTimeMs = Math.max(lastTradeCloseTimeMs, t2ExitTimeMs);
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

