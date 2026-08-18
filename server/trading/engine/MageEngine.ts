import realDb, { addBotLog as realAddBotLog } from '../../core/db.js';
import { logger } from "../../utils/logger.js";
import { calculateDwcb } from "../../utils/DwcbCalculator.js";
const db: any = new Proxy({}, {
  get(_target, prop) {
    const activeDb = (global as any).__SIM_DB__ || realDb;
    return activeDb[prop];
  }
});
const addBotLog = (...args: any[]) => (((global as any).__SIM_DB__ && typeof (global as any).__SIM_DB__.addBotLog === 'function') ? (global as any).__SIM_DB__.addBotLog : realAddBotLog)(...args);
import {
  getSharedConnection as r1,
  getSharedAccount as r2,
  getSymbolSpec as r3,
  safeDecryptAccountId as r4,
  getBrokerSymbol as r5,
  clearSharedConnection as r6,
  getLiveBrokerSpec as r7,
  quantizeLots as r8,
  roundPrice as r9,
  isBrokerPriceOrStopsError as r10,
  calculateStopsLevelSafePrices as r11,
} from '../broker/metaApiHandler.js';

logger.info("[MAGE ENGINE TS LOADED!]");
const getSharedConnection = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.getSharedConnection || r1)(...args);
const getSharedAccount = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.getSharedAccount || r2)(...args);
const getSymbolSpec = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.getSymbolSpec || r3)(...args);
const safeDecryptAccountId = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.safeDecryptAccountId || r4)(...args);
const getBrokerSymbol = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.getBrokerSymbol || r5)(...args);
const clearSharedConnection = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.clearSharedConnection || r6)(...args);
const getLiveBrokerSpec = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.getLiveBrokerSpec || r7)(...args);
const quantizeLots = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.quantizeLots || r8)(...args);
const roundPrice = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.roundPrice || r9)(...args);
const isBrokerPriceOrStopsError = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.isBrokerPriceOrStopsError || r10)(...args);
const calculateStopsLevelSafePrices = (...args: any[]) =>
  ((global as any).__SIM_METAAPI__?.calculateStopsLevelSafePrices || r11)(...args);
import { OPTIMIZER_CONFIG, getDynamicPipSize } from "../config/OptimizerPairConfig.js";
import { PairConfigManager } from "../config/PairConfig.js";
import { enqueueMetaApiRequest as realQueue } from "../../utils/MetaApiQueue.js";
const enqueueMetaApiRequest = (...args: any[]) =>
  ((global as any).__SIM_QUEUE__?.enqueueMetaApiRequest || realQueue)(...args);
import { isNewsBlackout as realNews } from '../../news/newsStore.js';
const isNewsBlackout = (...args: any[]) =>
  ((global as any).__SIM_NEWS__?.isNewsBlackout || realNews)(...args);
import { globalTradeGate as realGate } from "../../utils/GlobalTradeGate.js";
const globalTradeGate = (global as any).__SIM_TRADE_GATE__ || realGate;
import { isTradeAllowed, isRolloverCircuitBreaker, isToxicDay } from "../market/MathFilters.js";
import { buildAtrArray } from "../market/Indicators.js";
import { HTFContextTracker } from "../market/HTFContextTracker.js";
import { getShortHash } from "../../core/crypto.js";

function getFixedEstDate(date = /* @__PURE__ */ new Date()) {
  if ((global as any).__SIM_TIME_PROVIDER__) {
    return (global as any).__SIM_TIME_PROVIDER__(date);
  }
  const y = date.getUTCFullYear();
  const marchFirst = new Date(Date.UTC(y, 2, 1));
  const daysToFirstSunday = (7 - marchFirst.getUTCDay()) % 7;
  const secondSundayMarch = new Date(Date.UTC(y, 2, 1 + daysToFirstSunday + 7, 7, 0, 0));
  const novFirst = new Date(Date.UTC(y, 10, 1));
  const daysToFirstSunNov = (7 - novFirst.getUTCDay()) % 7;
  const firstSundayNov = new Date(Date.UTC(y, 10, 1 + daysToFirstSunNov, 6, 0, 0));
  const t = date.getTime();
  const isDST = t >= secondSundayMarch.getTime() && t < firstSundayNov.getTime();
  const offsetHours = isDST ? -4 : -5;
  return new Date(t + offsetHours * 60 * 60 * 1000);
}
async function runMageBot(orch: any, symbol: string, state: any, c: any) {
  const mageConfigs = PairConfigManager.getMageConfigs(symbol);
  if (!mageConfigs || mageConfigs.length === 0) return;

  let cfgIdx = 0;
  for (const config of mageConfigs) {
    const sig = config.signature || `default_${cfgIdx}`;
    await _runMageBotForConfig(orch, symbol, state, c, sig, config);
    cfgIdx++;
  }
}

export async function _runMageBotForConfig(orch: any, symbol: string, state: any, c: any, sig: string, config: any, botId: string = "mage") {
  const _dbgEstHour =
    typeof c.estHour === "number"
      ? c.estHour
      : new Date(c.timestamp).getUTCHours();
  const _sessionPair = symbol;
  const _mCfg = config;
  if (!state.orbStates) state.orbStates = {};
  if (!state.orbStates[sig]) {
    state.orbStates[sig] = {
      orHigh: -Infinity,
      orLow: Infinity,
      orBuilt: false,
      breakoutDir: null,
      limitPrice: 0,
      slPrice: 0,
      tpPrice: 0,
      limitOrderId: null,
      visionApproved: false,
      fired: false,
      currentDateStr: "",
      currentOrbDateStr: "",
      tradeTakenDate: "",
      lastEstHour: undefined,
      mageTradeTakenToday: false,
    };
  }
  const estDate = getFixedEstDate(new Date(c.timestamp));
  const estHour = estDate.getUTCHours();
  const estMin = estDate.getUTCMinutes();
  const yyyy = estDate.getUTCFullYear();
  const mm = String(estDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(estDate.getUTCDate()).padStart(2, "0");
  const dateStr = yyyy + "-" + mm + "-" + dd;
  const os = state.orbStates[sig];

  const startMins = config.orbStartHour! * 60 + config.orbStartMin!;
  const orDurationMins = config.orbMinutes!;
  const currentMins = estHour * 60 + estMin;
  const isBuildingORB = currentMins >= startMins && currentMins < startMins + orDurationMins;
  const isStartMinsReset = isBuildingORB && !os.wasBuildingORB;
  os.wasBuildingORB = isBuildingORB;

  let isDayChangeReset = false;
  if (os.lastEstHour !== undefined) {
      if ((os.lastEstHour < 17 && estHour >= 17) || (os.lastEstHour > estHour && estHour >= 17)) {
          isDayChangeReset = true;
      }
  }
  os.lastEstHour = estHour;

  if (isDayChangeReset || isStartMinsReset) {
    // Cancel any dangling pending limit order from the previous ORB session
    if (os.limitOrderId) {
      try {
        const conn = await getSharedConnection(orch.token, orch.accountId);
        await enqueueMetaApiRequest(
          async () => await conn.cancelOrder(os.limitOrderId),
          `CancelStaleLimit:${symbol}`,
          undefined,
          undefined,
          orch.profileId
        );
        logger.info(
          `[DiscretionaryTrader] ðŸ§¹ MAGE cancelled stale limit order ${os.limitOrderId} on ${symbol} (new ORB session: ${dateStr}).`,
        );
      } catch (_e) {
        /* ignore cancel errors on day rollover */
      }
    }
    os.orHigh = -Infinity;
    os.orLow = Infinity;
    os.orBuilt = false;
    os.breakoutDir = null;
    os.limitPrice = 0;
    os.slPrice = 0;
    os.tpPrice = 0;
    os.limitOrderId = null;
    os.limitPlacedAt = 0;
    os.visionApproved = false;
    os.fired = false;
    os.mageTradeTakenToday = false;

    // NEW MID-SESSION HYDRATION SAFETY CHECK
    // If we just woke up IN THE MIDDLE of the ORB window, we've already missed the crucial opening minutes!
    // Building an ORB now would result in a "small recent ORB", causing catastrophic false breakouts.
    if (isStartMinsReset && currentMins > startMins + 5) {
      logger.error(`[MageEngine] 🚨 FATAL MID-SESSION REBOOT: Woke up during the ORB window for ${symbol} but missed the opening ${currentMins - startMins} minutes. Locking bot for remainder of session to prevent catastrophic false entries from a partial ORB.`);
      os.orBuilt = true; 
      os.fired = true;
      os.mageTradeTakenToday = true;
      return;
    }
  }
  
  const optCfg = OPTIMIZER_CONFIG[symbol.replace(".Daily", "")];
  const pipSize = getDynamicPipSize(symbol);
  const spreadPts = (optCfg && optCfg.spread !== undefined) ? optCfg.spread * pipSize : 0;
  const fcHours = config.forceCloseHours;

  if (os.limitOrderId && os.limitPlacedAt) {
      let shouldCancel = false;
      let cancelReason = "";

      if (isRolloverCircuitBreaker(estHour, estMin)) {
          shouldCancel = true;
          cancelReason = "rollover circuit breaker (15:00 EST / 2h pre-close)";
      } else if (fcHours !== undefined && c.timestamp - os.limitPlacedAt >= fcHours * 3600000) {
          shouldCancel = true;
          cancelReason = `expired after ${fcHours} hours`;
      } else if (os.breakoutDir === "BUY" && c.high >= os.tpPrice) {
          shouldCancel = true;
          cancelReason = `take profit boundary swept before fill (high:${c.high}, tp:${os.tpPrice})`;
      } else if (os.breakoutDir === "SELL" && (c.low + spreadPts) <= os.tpPrice) {
          shouldCancel = true;
          cancelReason = `take profit boundary swept before fill (low+spread:${c.low + spreadPts}, tp:${os.tpPrice})`;
      }

      if (shouldCancel) {
          try {
              const conn = await getSharedConnection(orch.token, orch.accountId);
              await enqueueMetaApiRequest(
                async () => await conn.cancelOrder(os.limitOrderId),
                `CancelOppositeLimit:${symbol}`,
                undefined,
                undefined,
                orch.profileId
              );
              logger.info(`[DiscretionaryTrader] ðŸ›‘ MAGE cancelled limit order (${cancelReason})`);
          } catch(_e) {}
          os.limitOrderId = null;
          os.limitPlacedAt = 0;
          os.fired = true;
          os.mageTradeTakenToday = true;
          os.tradeTakenOnOrbDay = dateStr;
      }
  }

  os.lastEstHour = estHour;
  os.lastEstDateStr = dateStr;
  os.currentDateStr = dateStr;
  if (symbol.includes("XTIUSD") && dateStr === "2026-06-01" && estHour === 7) {
    console.log(`[DEBUG XTI TICK 06-01 07:xx] min=${estMin}, currentDateStr=${os.currentDateStr}, orBuilt=${os.orBuilt}, fired=${os.fired}, limitOrderId=${os.limitOrderId}, tradeTaken=${os.mageTradeTakenToday}`);
  }
  if (os.mageTradeTakenToday) return;
  if (os.fired || os.limitOrderId) return;

  // ── CROSS-ACCOUNT SMART TRADE CATCH-UP ──
  const sessionName = config?.session || "default";
  const leadTrade = globalTradeGate.getActiveLeadTrade("MAGE", symbol, sessionName, dateStr);
  if (
    leadTrade &&
    leadTrade.leadProfileId !== orch.profileId &&
    !os.fired &&
    !os.limitOrderId &&
    (!state.activeTrades || !state.activeTrades.find((t: any) => t.clientId === sig))
  ) {
    const isBuy = leadTrade.direction === "BUY";
    const optCfg = PairConfigManager.getRepresentativeConfig(symbol);
    const pipSize = config?.pipSize || optCfg?.pipSize || getDynamicPipSize(symbol.split("_")[0]);
    const spreadPts = (optCfg && optCfg.spread !== undefined) ? optCfg.spread * pipSize : 0;
    const currentPrice = isBuy ? c.close + spreadPts : c.close;
    const proximityThreshold = Math.max(2.5 * pipSize, (optCfg?.spread || 1) * 2.5 * pipSize, 0.10 * Math.abs(leadTrade.entryPrice - leadTrade.slPrice));
    
    const distFromLead = isBuy ? (currentPrice - leadTrade.entryPrice) : (leadTrade.entryPrice - currentPrice);
    const totalTpDist = Math.abs(leadTrade.tpPrice - leadTrade.entryPrice);
    const pctTowardsTp = distFromLead > 0 ? (distFromLead / (totalTpDist || 1)) : 0;
    const hitSl = isBuy ? (currentPrice <= leadTrade.slPrice) : (currentPrice >= leadTrade.slPrice);

    if (!hitSl && pctTowardsTp < 0.10 && distFromLead <= proximityThreshold) {
      logger.info(
        `[MageEngine][P#${orch.profileId}] 🔄 Cross-Account Smart Catch-Up triggered for ${symbol} ${leadTrade.direction} (Lead from P#${leadTrade.leadProfileId} at ${leadTrade.entryPrice}, Live: ${currentPrice}, Slippage: ${(distFromLead / pipSize).toFixed(1)} pips)`,
      );
      os.breakoutDir = leadTrade.direction;
      os.limitPrice = leadTrade.entryPrice;
      os.slPrice = leadTrade.slPrice;
      os.tpPrice = leadTrade.tpPrice;
      os.visionApproved = true;
      placeMageLimitOrder(orch, symbol, state, c, sig, config, botId).catch((e) => {
        logger.error("[MageEngine CatchUp Error]", e);
      });
      return;
    }
  }

  if (
    !isTradeAllowed({
      pair: symbol,
      setupType: "ORB",
      timestamp: c.timestamp,
    })
  ) {
    return;
  }
  const requiredMageProps = [
    "orbStartHour",
    "orbStartMin",
    "orbMinutes",
    "orbPullbackPct",
    "minSlDist",
    "maxSlDist",
    "minBodyPips",
    "trailingSlTrigger",
    "trailingSlStep",
    "forceCloseHours",
    "exitMode",
  ];
  for (const prop of requiredMageProps) {
    if ((_mCfg as any)[prop] === undefined) {
      throw new Error(
        `[STRICT MODE ERROR] Missing required attribute '${prop}' in Mage config for ${_sessionPair}`,
      );
    }
  }

  if (currentMins >= startMins && currentMins < startMins + orDurationMins) {
    os.orHigh = Math.max(os.orHigh, c.high);
    os.orLow = Math.min(os.orLow, c.low);
    return;
  }
  
  if (currentMins >= startMins + orDurationMins && (!os.orBuilt || os.currentOrbDateStr !== dateStr)) {
    if (os.currentOrbDateStr !== "" && os.currentOrbDateStr !== dateStr) {
      // Missed the live ORB building window for a new calendar day.
      // Force a full rebuild from the historical M5 buffer for today's ORB.
      if (os.limitOrderId) {
        try {
          const conn = await getSharedConnection(orch.token, orch.accountId);
          await enqueueMetaApiRequest(
            async () => await conn.cancelOrder(os.limitOrderId),
            `CancelStaleLimitLateDay:${symbol}`,
            undefined,
            undefined,
            orch.profileId
          );
          logger.info(`[DiscretionaryTrader] 🧹 MAGE cancelled stale limit order ${os.limitOrderId} on ${symbol} (Late day rollover).`);
        } catch (_e) {}
      }
      os.orHigh = -Infinity;
      os.orLow = Infinity;
      os.orBuilt = false;
      os.limitOrderId = null;
      os.limitPrice = 0;
      os.slPrice = 0;
      os.tpPrice = 0;
      os.breakoutDir = null;
      os.visionApproved = false;
      os.fired = false;
      os.mageTradeTakenToday = false;
      os.tradeTakenOnOrbDay = undefined;
    }

    if (os.orHigh === -Infinity && state.m5Buffer && state.m5Buffer.length > 0) {
      const windowStartMs = c.timestamp - (currentMins - startMins) * 60_000;
      const windowEndMs = windowStartMs + orDurationMins * 60_000;
      const orbCandles = state.m5Buffer.filter((candle: any) => candle.timestamp >= windowStartMs && candle.timestamp < windowEndMs);
      if (orbCandles.length > 0) {
        // NEW SAFETY CHECK: Ensure we didn't wake up mid-session missing the opening action
        const firstCandleTime = orbCandles[0].timestamp;
        const toleranceMs = 5 * 60_000; // 5 minutes tolerance
        if (firstCandleTime > windowStartMs + toleranceMs) {
          logger.error(`[MageEngine] 🚨 FATAL ORB HYDRATION: Cannot build ORB for ${symbol}. Server rebooted mid-session and gap hydration missed the crucial opening minutes (Window started: ${new Date(windowStartMs).toISOString()}, First candle: ${new Date(firstCandleTime).toISOString()}). Locking bot for remainder of session to prevent catastrophic false entries.`);
          os.orBuilt = true;
          os.fired = true;
          os.mageTradeTakenToday = true;
          return;
        }

        let maxH = -Infinity;
        let minL = Infinity;
        for (const candle of orbCandles) {
          if (candle.high > maxH) maxH = candle.high;
          if (candle.low < minL) minL = candle.low;
        }
        os.orHigh = maxH;
        os.orLow = minL;
      }
    }
    if (os.orHigh === -Infinity) {
      return; // Wait for historical M5 buffer to populate
    }
    os.orBuilt = true;
    os.currentOrbDateStr = dateStr;
    os.tradeTakenOnOrbDay = undefined;
    logger.info(`[MageEngine] ORB Built for ${_sessionPair} at ${dateStr} (High: ${os.orHigh.toFixed(5)}, Low: ${os.orLow.toFixed(5)})`);
    orch.addEyeFeedEvent({
      type: "EVAL_RESULT",
      bot_id: botId,
      data: {
        symbol,
        decision: "SCANNING",
        setupType: "ORB Breakout",
        reasoning: `ORB Built (High: ${os.orHigh.toFixed(5)}, Low: ${os.orLow.toFixed(5)})`,
      },
    });
  }
  if (!os.orBuilt || os.orHigh === -Infinity || os.currentOrbDateStr !== dateStr) return;

  const thisConfigActive = (state.activeTrades ?? []).some((t: any) => {
    if (t.clientId === sig) return true;
    if (orch.sigMap && orch.sigMap[t.clientId] === sig) return true;
    if (t.clientId?.startsWith("M_" + getShortHash(sig))) return true;
    return false;
  });
  if (thisConfigActive) return;

  // 🚫 Check Rollover Circuit Breaker + Pair-Specific Toxic Hours/Days (No entry allowed)
  if (isRolloverCircuitBreaker(estHour, estMin)) return;
  if (config.toxicHours && config.toxicHours.includes(estHour)) return;
  const candleDate = new Date(c.timestamp);
  const dow = getFixedEstDate(candleDate).getDay();
  if (config.toxicDays && isToxicDay(dow, config.toxicDays)) return;
  const orRangePips = (os.orHigh - os.orLow) / pipSize;
  const normalizedSymbol = symbol
    .split("_")[0]
    .split(".")[0]
    .trim()
    .toUpperCase();
  const isForex = PairConfigManager.isForex(normalizedSymbol);
  const maxSlPips = _mCfg.maxSlDist!;
  if (orRangePips + (spreadPts / pipSize) > maxSlPips) {
    if (symbol.includes("XTIUSD")) console.log(`[DEBUG XTI REJECT] Range too large: ${orRangePips} + ${spreadPts / pipSize} > ${maxSlPips}`);
    logger.verbose(`[MageEngine] ${symbol} Rejected: ORB Range (${orRangePips.toFixed(1)}) + spread (${spreadPts / pipSize}) > maxSlPips (${maxSlPips}) at ${new Date(c.timestamp).toISOString()}`);
    orch.addEyeFeedEvent({
      type: "REJECT",
      bot_id: botId,
      data: {
        symbol,
        decision: "NO_TRADE",
        setupType: "ORB Breakout",
        reasoning: `ORB Range (${orRangePips.toFixed(1)} pips) is too large (max: ${maxSlPips - 10}).`,
      }
    });
    return;
  }
  const endMins =
    _mCfg.orbEndHour !== void 0
      ? _mCfg.orbEndHour * 60 + (_mCfg.orbEndMin || 0)
      : startMins + orDurationMins + (_mCfg.actionMinutes || 180);

  let isInsideActionWindow = false;
  if (endMins >= 1440) {
    isInsideActionWindow = currentMins >= (startMins + orDurationMins) || currentMins < (endMins % 1440);
  } else {
    isInsideActionWindow = currentMins >= (startMins + orDurationMins) && currentMins < endMins;
  }

  if (!isInsideActionWindow) {
    if (os.orBuilt) os.fired = true;
    return;
  }
  if (os.tradeTakenOnOrbDay && os.tradeTakenOnOrbDay === os.currentOrbDateStr) {
    return;
  }
  if (!os.breakoutDir && currentMins >= startMins) {
    const len = state.m5Buffer?.length || 0;
    if (len === 0) { 
      logger.verbose(`[MageEngine] ${symbol} Wait: M5 buffer is empty at ${new Date(c.timestamp).toISOString()}`);
      return; 
    }
    const lastM5 = state.m5Buffer[len - 1];

    if (os.lastEvaluatedM5Time === lastM5.timestamp) {
      return;
    }

    if (len < 1) return;
    const prevM5 = state.m5Buffer[len - 1];
    const prevEstDate = getFixedEstDate(new Date(prevM5.timestamp));
    const prevM5Mins = prevEstDate.getUTCHours() * 60 + prevEstDate.getUTCMinutes();

    if (prevM5Mins < startMins + orDurationMins) {
      logger.verbose(`[MageEngine] ${symbol} Wait: Let ORB finish building (prevM5Mins=${prevM5Mins} < req=${startMins + orDurationMins})`);
      return;
    }

    os.lastEvaluatedM5Time = lastM5.timestamp;

    const actionCandle = lastM5;

    let buyTriggered = false;
    let sellTriggered = false;

    if (isForex) {
      if (actionCandle.close > os.orHigh) buyTriggered = true;
      if (actionCandle.close < os.orLow) sellTriggered = true;
    } else {
      const reqBuyHigh = roundPrice(os.orHigh + spreadPts, symbol);
      if (actionCandle.high >= reqBuyHigh) buyTriggered = true;
      if (actionCandle.low <= os.orLow) sellTriggered = true;
    }

    if (symbol.includes("XTIUSD") && dateStr === "2026-06-01" && estHour === 7) {
      console.log(`[DEBUG XTI EVAL 06-01] isForex: ${isForex}, actHigh: ${actionCandle.high}, actLow: ${actionCandle.low}, actClose: ${actionCandle.close}, orHigh: ${os.orHigh}, orLow: ${os.orLow}, spreadPts: ${spreadPts}, buyTrig: ${buyTriggered}, sellTrig: ${sellTriggered}`);
    }

    // Log scanning activity for visibility on dev console
    if (!(global as any).isSimulator) {
      logger.info(`[MageEngine][P${orch.profileId}] 🔍 Scanning ${_sessionPair} Breakout [${new Date(actionCandle.timestamp).toISOString().substring(11, 16)} EST] | ` +
        `Candle [High/Low/Close]: [${actionCandle.high}/${actionCandle.low}/${actionCandle.close}] | ` +
        `ORB [High/Low]: [${os.orHigh.toFixed(5)}/${os.orLow.toFixed(5)}]`);
    }

    if (buyTriggered || sellTriggered) {
      if ((global as any).__SIM_WARMUP__) return;
      if (buyTriggered && sellTriggered) { 
        return; 
      }
      if (buyTriggered && Math.max(actionCandle.open, actionCandle.close) < os.orHigh) return;
      if (sellTriggered && Math.min(actionCandle.open, actionCandle.close) > os.orLow) return;

      const minRatio = 0.35;
      const maxRatio = 1.5;
      const orPips = (os.orHigh - os.orLow) / pipSize;
      if (!state.m5Buffer || state.m5Buffer.length < 14) {
        if (!(global as any).isSimulator) {
          logger.info(`[MageEngine][P${orch.profileId}] ATR-Relative OR filter skipped breakout for ${symbol}: Insufficient M5 history buffer (${state.m5Buffer?.length || 0}/14).`);
        }
        return;
      }
      // ATR-Relative OR filter: use 14-period Wilder ATR (closed candles only, atrArr[len-1])
      const atrArr = buildAtrArray(state.m5Buffer, 14);
      // Use candle prior to action candle (atrArr[len-2]) for exact parity with MageMathCore (atrArr[i-1])
      const atrVal = atrArr.length >= 2 ? atrArr[atrArr.length - 2] : (atrArr.length >= 1 ? atrArr[atrArr.length - 1] : 0);
      if (atrVal > 0) {
        const atr14Pips = atrVal / pipSize;
        const ratio = Math.round((orPips / atr14Pips) * 100) / 100;
        if (ratio < minRatio || ratio > maxRatio) {
          if (!(global as any).isSimulator) {
            logger.info(`[MageEngine][P${orch.profileId}] ATR-Relative OR filter blocked breakout for ${symbol}. OR/ATR ratio: ${ratio.toFixed(2)}`);
          }
          return;
        }
      }
      if (_mCfg.minBodyPips !== void 0) {
        const bodySize = parseFloat((Math.abs(actionCandle.close - actionCandle.open) / pipSize).toFixed(1));
        if (bodySize < _mCfg.minBodyPips) {
          logger.info(
            `[DiscretionaryTrader] â›” Mage aborted on ${symbol} at ${new Date(actionCandle.timestamp).toISOString()}: Breakout action body (${bodySize.toFixed(1)} pips) < minBodyPips (${_mCfg.minBodyPips}).`,
          );
          orch.addEyeFeedEvent({
            type: "REJECT",
            bot_id: botId,
            data: {
              symbol,
              decision: "NO_TRADE",
              setupType: "ORB Breakout",
              reasoning: `Breakout action body (${bodySize.toFixed(1)} pips) < minBodyPips (${_mCfg.minBodyPips}).`,
            }
          });
          return;
        }
      }
      const direction = buyTriggered ? "BUY" : "SELL";

      if (_mCfg && _mCfg.maxOpposingWickRatio !== undefined) {
        const bodySize = parseFloat((Math.abs(actionCandle.close - actionCandle.open) / pipSize).toFixed(1));
        const bodyTop = Math.max(actionCandle.open, actionCandle.close);
        const bodyBottom = Math.min(actionCandle.open, actionCandle.close);
        const opposingWickPips = buyTriggered
          ? (actionCandle.high - bodyTop) / pipSize
          : (bodyBottom - actionCandle.low) / pipSize;
        const wbr = opposingWickPips / Math.max(bodySize, 0.1);
        if (wbr > _mCfg.maxOpposingWickRatio) {
          logger.info(`[MageEngine] ⛔ Aborted on ${symbol}: Opposing wick ratio (${wbr.toFixed(2)}) > maxOpposingWickRatio (${_mCfg.maxOpposingWickRatio}).`);
          return;
        }
      }

      if (_mCfg && _mCfg.htfAlignmentRequired) {
        if (HTFContextTracker.isTrendParabolic(state.m5Buffer as any, direction, _mCfg.maxH1EmaSlope ?? 30, pipSize)) {
          logger.info(`[MageEngine] ⛔ Aborted on ${symbol}: HTF alignment check failed (parabolic counter-trend slope).`);
          return;
        }
      }
      os.breakoutDir = direction;
      os.mageTradeTakenToday = true;
      os.tradeTakenOnOrbDay = os.currentOrbDateStr;
      os.triggerCandleHigh = actionCandle.high;
      os.triggerCandleLow = actionCandle.low;
      orch.addEyeFeedEvent({
        type: "EVAL_RESULT",
        bot_id: botId,
        data: {
          symbol,
          decision: `${direction} BREAKOUT`,
          setupType: "ORB Breakout",
          reasoning: `Awaiting limit pullback execution.`,
        },
      });
      const rOrHigh = roundPrice(os.orHigh, PairConfigManager.getBaseSymbol(symbol));
      const rOrLow = roundPrice(os.orLow, PairConfigManager.getBaseSymbol(symbol));
      const boxSize = roundPrice(Math.abs(rOrHigh - rOrLow), PairConfigManager.getBaseSymbol(symbol));
      const orRangePips = boxSize / pipSize;
      if (isForex && _mCfg.maxSlDist !== undefined && (orRangePips + 10) > _mCfg.maxSlDist + 0.001) {
        logger.info(`[MageEngine] ⛔ Aborted on ${symbol}: OR range + 10 (${(orRangePips + 10).toFixed(1)}) > maxSlDist (${_mCfg.maxSlDist}).`);
        return;
      }
      const pullbackPct = _mCfg.orbPullbackPct!;
      const entryPriceRaw =
        direction === "BUY"
          ? rOrHigh - boxSize * pullbackPct
          : rOrLow + boxSize * pullbackPct;
      const entryPrice = roundPrice(entryPriceRaw, PairConfigManager.getBaseSymbol(symbol));
      os.limitPrice = entryPrice;
      const slBuffer = 0;
      let proposedSl =
        direction === "BUY"
          ? rOrLow - slBuffer
          : rOrHigh + spreadPts + slBuffer;
      if (_mCfg.minSlDist !== void 0) {
        if (
          direction === "SELL" &&
          proposedSl < entryPrice + (_mCfg.minSlDist - 0.001) * pipSize
        )
          proposedSl = entryPrice + _mCfg.minSlDist * pipSize;
        if (
          direction === "BUY" &&
          proposedSl > entryPrice - (_mCfg.minSlDist - 0.001) * pipSize
        )
          proposedSl = entryPrice - _mCfg.minSlDist * pipSize;
      }
      os.slPrice = roundPrice(proposedSl, PairConfigManager.getBaseSymbol(symbol));
      const risk = Math.abs(entryPrice - os.slPrice);
      const slDist = risk / pipSize;
      const _ts =
        state.m5Buffer?.[state.m5Buffer.length - 1]?.timestamp || Date.now();
      if (_mCfg.minSlDist !== void 0 && slDist < _mCfg.minSlDist - 0.001) {
        orch.addEyeFeedEvent({
          type: "REJECT",
          bot_id: botId,
          data: {
            symbol,
            decision: "NO_TRADE",
            setupType: "ORB Breakout",
            reasoning: `Mage aborted on ${symbol} at ${new Date(_ts).toISOString()}: SL risk (${slDist.toFixed(1)} pips) < minSlDist (${_mCfg.minSlDist}).`,
          }
        });
        os.fired = true;
        return;
      }
      if (_mCfg.maxSlDist !== void 0 && slDist > _mCfg.maxSlDist + 0.001) {
        orch.addEyeFeedEvent({
          type: "REJECT",
          bot_id: botId,
          data: {
            symbol,
            decision: "NO_TRADE",
            setupType: "ORB Breakout",
            reasoning: `Mage aborted on ${symbol} at ${new Date(_ts).toISOString()}: SL risk (${slDist.toFixed(1)} pips) > maxSlDist (${_mCfg.maxSlDist}).`,
          }
        });
        os.fired = true;
        return;
      }

      if (_mCfg.exitMode === "MIDPOINT") {
        os.tpPrice = roundPrice((rOrHigh + rOrLow) / 2, PairConfigManager.getBaseSymbol(symbol));
      } else if (_mCfg.exitMode === "OPPOSITE_BOUNDARY") {
        os.tpPrice = roundPrice(direction === "BUY" ? rOrHigh : rOrLow, PairConfigManager.getBaseSymbol(symbol));
      } else if (_mCfg.exitMode === "ORB_EXTENSION") {
        const ext = boxSize * 2;
        os.tpPrice = roundPrice(direction === "BUY" ? entryPrice + ext : entryPrice - ext, PairConfigManager.getBaseSymbol(symbol));
      } else {
        os.tpPrice = roundPrice(
          direction === "BUY"
            ? entryPrice + 50 * risk
            : entryPrice - 50 * risk,
          PairConfigManager.getBaseSymbol(symbol)
        );
      }
      os.visionApproved = true;
      placeMageLimitOrder(orch, symbol, state, c, sig, config, botId).catch((e) => {
        console.error("[MAGE LIMIT ORDER EXCEPTION]", e);
        logger.error("Swallowed error caught: ", e);
      });
    }
  }
}

async function placeMageLimitOrder(orch: any, symbol: string, state: any, c: any, sig: string, config: any, botId: string = "mage") {
  const _sessionStr = state.config?.session ? "_" + state.config.session : "";
  const _sessionPair = symbol + _sessionStr;
  const _mCfg = config;
  const os = state.orbStates[sig];
  if (!os || !os.visionApproved || os.fired || os.limitOrderId) return;
  if ((global as any).__SIM_WARMUP__) {
    os.fired = false;
    os.visionApproved = false;
    os.mageTradeTakenToday = false;
    return;
  }
  if (state.botConfigs.get(botId)?.enabled === false) {
    logger.info(`[DiscretionaryTrader] â›” Trade blocked â€” Pair ${symbol} is disabled for bot ${botId}`);
    return;
  }
  const newsCheck = isNewsBlackout(symbol, new Date(c.timestamp));
  if (newsCheck.blocked) {
    logger.info(`[DiscretionaryTrader] â›” Trade blocked â€” News Blackout Window active for ${symbol}: ${newsCheck.reason}`);
    return;
  }
  try {
    const profile = await db
      .prepare(
        "SELECT t.risk_multiplier, COALESCE(t.metaapi_token, u.metaapi_token) as metaapi_token, t.metaapi_account_id, t.dwcb_enabled, t.dwcb_peak_balance, t.base_risk_balance, t.broker_symbol_map, t.institutional_enabled, t.institutional_daily_start_balance, t.institutional_daily_date, t.institutional_peak_balance FROM trading_profiles t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?",
      )
      .get(orch.profileId);
    if (!profile) return;
    let token = profile.metaapi_token || orch.token;
    let accId = profile.metaapi_account_id || orch.accountId;

    if (!(global as any).__SIM_MOCK_ACCOUNT__ && (!orch.cachedEquity || orch.cachedEquity <= 0)) {
      try {
        const conn = await getSharedConnection(token, accId);
        const accInfo = await conn.getAccountInformation();
        if (accInfo && accInfo.equity > 0) {
          orch.cachedEquity = accInfo.equity;
          console.log(`[MageEngine] 🔄 Emergency live fetch account equity: $${orch.cachedEquity.toFixed(2)}`);
        }
      } catch (e: any) {}
    }

    if (!(global as any).__SIM_MOCK_ACCOUNT__ && (!orch.cachedEquity || orch.cachedEquity <= 0)) {
      logger.warn(`[MageEngine] ⚠️ Cached equity is 0 or missing. Aborting trade to prevent DWCB corruption.`);
      return;
    }
    const effectiveBalance = (global as any).__SIM_MOCK_ACCOUNT__
      ? (orch.cachedEquity || state.equity || 1e5)
      : orch.cachedEquity;

    let dwcbMultiplier = 1.0;
    if (
      profile.dwcb_enabled === 1 &&
      profile.dwcb_peak_balance &&
      profile.dwcb_peak_balance > 0
    ) {
      const res = await calculateDwcb(
        orch.profileId,
        profile.dwcb_enabled,
        profile.dwcb_peak_balance,
        effectiveBalance
      );
      dwcbMultiplier = res.dwcbMultiplier;
    }

    let institutionalMultiplier = 1.0;
    if (profile.institutional_enabled === 1) {
      const dailyCapPct = profile.institutional_daily_cap ? profile.institutional_daily_cap / 100 : 0.025;
      const peakToDrawPct = profile.institutional_peak_to_draw ? profile.institutional_peak_to_draw / 100 : 0.055;

      const estDate = getFixedEstDate(new Date(c.timestamp));
      const tradingDayDate = new Date(estDate.getTime() + 7 * 60 * 60 * 1000);
      const brokerTradingDayStr = tradingDayDate.toISOString().split('T')[0];

      let currentInstPeak = profile.institutional_peak_balance;
      if (!currentInstPeak || effectiveBalance > currentInstPeak) {
        currentInstPeak = effectiveBalance;
        await db.prepare("UPDATE trading_profiles SET institutional_peak_balance = ? WHERE id = ?").run(currentInstPeak, orch.profileId);
      } else {
        const absDrawdown = (currentInstPeak - effectiveBalance) / currentInstPeak;
        if (absDrawdown >= peakToDrawPct) {
          logger.error(`[DiscretionaryTrader] 🛑 Institutional halt: ${(peakToDrawPct * 100).toFixed(1)}% Absolute Drawdown Reached on Mage for ${symbol}. Trade aborted.`);
          orch.addEyeFeedEvent({
            type: "REJECT",
            bot_id: botId,
            data: {
              symbol,
              decision: "NO_TRADE",
              setupType: "ORB Breakout",
              reasoning: `Institutional halt: ${(peakToDrawPct * 100).toFixed(1)}% Absolute Drawdown Reached.`,
            }
          });
          return;
        }

        // 🛡️ Dynamic Trailing Proximity Scaling (Adaptive Drawdown De-risking)
        const rho = absDrawdown / peakToDrawPct; // 0.0 at peak -> 1.0 at limit
        if (rho >= 0.85) {
          institutionalMultiplier = 0.15;
          logger.warn(`[MageEngine] ⚠️ Institutional Proximity Scaling: Drawdown is ${(rho * 100).toFixed(1)}% of max trailing limit on ${symbol}. Contracting risk to 15%.`);
        } else if (rho >= 0.70) {
          institutionalMultiplier = 0.30;
          logger.warn(`[MageEngine] ⚠️ Institutional Proximity Scaling: Drawdown is ${(rho * 100).toFixed(1)}% of max trailing limit on ${symbol}. Contracting risk to 30%.`);
        } else if (rho >= 0.50) {
          institutionalMultiplier = 0.50;
          logger.warn(`[MageEngine] ⚠️ Institutional Proximity Scaling: Drawdown is ${(rho * 100).toFixed(1)}% of max trailing limit on ${symbol}. Contracting risk to 50%.`);
        }
      }

      let dailyStartBal = profile.institutional_daily_start_balance;
      let dailyDate = profile.institutional_daily_date;
      if (dailyDate !== brokerTradingDayStr || !dailyStartBal) {
        dailyStartBal = effectiveBalance;
        dailyDate = brokerTradingDayStr;
        await db.prepare("UPDATE trading_profiles SET institutional_daily_start_balance = ?, institutional_daily_date = ? WHERE id = ?").run(dailyStartBal, dailyDate, orch.profileId);
      } else {
        const dailyDrawdown = (dailyStartBal - effectiveBalance) / dailyStartBal;
        if (dailyDrawdown >= dailyCapPct) {
          logger.error(`[DiscretionaryTrader] 🛑 Institutional halt: ${(dailyCapPct * 100).toFixed(1)}% Daily Loss Limit Reached on Mage for ${symbol}. Trade aborted.`);
          orch.addEyeFeedEvent({
            type: "REJECT",
            bot_id: botId,
            data: {
              symbol,
              decision: "NO_TRADE",
              setupType: "ORB Breakout",
              reasoning: `Institutional halt: ${(dailyCapPct * 100).toFixed(1)}% Daily Loss Limit Reached.`,
            }
          });
          return;
        }
      }
    }

    if (profile.dwcb_enabled === 1 && dwcbMultiplier <= 0) {
      logger.error(`[DiscretionaryTrader] 🛑 DWCB halt triggered on Mage (dwcbMultiplier <= 0) on ${symbol}. Trade aborted.`);
      return;
    }
    const { isEncrypted, decrypt } = await import('../../core/crypto.js').then(
      (s) => {
        return { isEncrypted: s.isEncrypted, decrypt: s.decrypt };
      },
    );
    token = isEncrypted(profile.metaapi_token)
      ? decrypt(profile.metaapi_token)
      : profile.metaapi_token;
    accId = safeDecryptAccountId(profile.metaapi_account_id);
    let customMap = null;
    try {
      if (profile.broker_symbol_map) customMap = JSON.parse(profile.broker_symbol_map);
    } catch(e) {}
    const baseSymbol = PairConfigManager.getBaseSymbol(symbol);
    const brokerSymbol = await getBrokerSymbol(baseSymbol, customMap);
    const liveSpec = await getLiveBrokerSpec(brokerSymbol, token, accId);
    const pipSize = getDynamicPipSize(symbol);
    const baseMonteCarloRisk = _mCfg.riskPct !== undefined ? _mCfg.riskPct : 1.0;
    const userRiskDial = state.botConfigs.get(botId)?.risk ?? state.riskPct ?? 1;

    let riskPct = baseMonteCarloRisk * userRiskDial * (profile.risk_multiplier || 1);
    if (riskPct > 0.50 && baseMonteCarloRisk <= 1.0) {
      riskPct = 0.50;
    } else if (riskPct > 50 && baseMonteCarloRisk > 1.0) {
      riskPct = 50;
    }

    const riskFraction = riskPct / 100;
    const balance = effectiveBalance;
    if (!balance || balance <= 0) {
      logger.error(`[MageEngine] ❌ Invalid live equity (${balance}). Aborting trade placement for safety on ${symbol}.`);
      return;
    }
    const riskAmount = balance * riskFraction * dwcbMultiplier * institutionalMultiplier;
    const slDistPips = Math.abs(os.limitPrice - os.slPrice) / pipSize;
    if (slDistPips <= 0) {
      logger.error(`[DiscretionaryTrader] âŒ Mage: SL distance is ${slDistPips} pips on ${symbol}. Aborting to prevent infinite lot size.`);
      return;
    }
    const rawVolume = riskAmount / (slDistPips * liveSpec.pipValuePerLot);
    const calculatedVolume = quantizeLots(
      rawVolume,
      liveSpec.volumeStep,
      liveSpec.minVolume,
      liveSpec.maxVolume,
    );
    const sessionName = state.config?.session || config?.session || "default";
    const dateStr = os.currentDateStr || new Date(c.timestamp).toISOString().split("T")[0];
    const consensusCheck = globalTradeGate.checkSessionDirection(
      botId,
      symbol,
      sessionName,
      dateStr,
      os.breakoutDir,
    );
    if (!consensusCheck.approved) {
      logger.info(`[MageEngine] 🛡️ ${consensusCheck.reason}`);
      return;
    }

    const check = globalTradeGate.canTrade(
      orch.profileId,
      symbol,
      os.breakoutDir,
      "ALGO",
    );
    if (!check.approved) {
      logger.info(`[DiscretionaryTrader] ⛔ Global Trade Gate blocked Mage on ${symbol}: ${check.reason}`);
      return;
    }
    
    // Pre-register immediately to close the race window between canTrade() and the
    // async broker call. A second concurrent candle event hitting canTrade() for the
    // same pair+direction will now be blocked by Rule 4 (duplicate block).
    // Key format: PRE_{sig} — swapped to real orderId on broker confirmation.
    const preRegKey = `PRE_${sig}`;
    globalTradeGate.register(orch.profileId, preRegKey, symbol, os.breakoutDir, "ALGO");

    enqueueMetaApiRequest(
      async () => {
        const conn = await getSharedConnection(token, accId);
        if (!conn) throw new Error("No shared connection available.");
        const pEntry = roundPrice(os.limitPrice, PairConfigManager.getBaseSymbol(symbol));
        const pSl = roundPrice(os.slPrice, PairConfigManager.getBaseSymbol(symbol));
        const pTp = roundPrice(os.tpPrice, PairConfigManager.getBaseSymbol(symbol));
        
        let res: any;
        const pullbackPct = _mCfg.orbPullbackPct || 0;
        const shortClientId = "M_" + getShortHash(sig) + "_" + Date.now();
        (global as any).__SIM_ORCH_STATE__ = state;

        const isBuy = os.breakoutDir === "BUY";
        
        try {
          const tp = await db.prepare("SELECT user_id FROM trading_profiles WHERE id = ?").get(orch.profileId);
          const actualUserId = tp ? tp.user_id : 0;
          await db.prepare(`
            INSERT INTO bot_trade_states
              (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, original_sl, tp_price,
               lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, initial_risk_pips, status, client_id, manages_own_trailing)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, 'PLACING', ?, 1)
          `).run(
            actualUserId, orch.profileId, botId.toUpperCase(), brokerSymbol, os.breakoutDir,
            pEntry, pSl, pSl, pTp, calculatedVolume, Date.now(),
            pEntry, pEntry, Math.abs(pEntry - pSl) / pipSize, shortClientId
          );
        } catch (dbErr: any) {
          logger.error(`[MageEngine] Failed to insert PLACING state for ${brokerSymbol}: ${dbErr.message}`);
        }

        const optCfg = PairConfigManager.getRepresentativeConfig(symbol);
        const spreadPts = (optCfg && optCfg.spread !== undefined) ? optCfg.spread * pipSize : 0;
        const currentPrice = isBuy ? c.close + spreadPts : c.close;
        const proximityThreshold = Math.max(2.5 * pipSize, (optCfg?.spread || 1) * 2.5 * pipSize, 0.10 * Math.abs(pEntry - pSl));
        const distFromEntry = isBuy ? (currentPrice - pEntry) : (pEntry - currentPrice);
        const isWithinProximity = Math.abs(distFromEntry) <= proximityThreshold || (isBuy ? currentPrice <= pEntry : currentPrice >= pEntry);

        const executeAsMarket = pullbackPct === 0 || isWithinProximity;

        if (executeAsMarket) {
          logger.info(`[MageEngine] ⚡ Executing direct MARKET ${os.breakoutDir} on ${brokerSymbol} (Proximity: ${(distFromEntry / pipSize).toFixed(1)} pips <= ${(proximityThreshold / pipSize).toFixed(1)} threshold, Target: ${pEntry}, Live: ${currentPrice})`);
          if (os.breakoutDir === "BUY") {
            res = await conn.createMarketBuyOrder(brokerSymbol, calculatedVolume, pSl, pTp, { clientId: shortClientId });
          } else {
            res = await conn.createMarketSellOrder(brokerSymbol, calculatedVolume, pSl, pTp, { clientId: shortClientId });
          }
        } else {
          try {
            if (os.breakoutDir === "BUY") {
              res = await conn.createLimitBuyOrder(brokerSymbol, calculatedVolume, pEntry, pSl, pTp, { clientId: shortClientId });
            } else {
              res = await conn.createLimitSellOrder(brokerSymbol, calculatedVolume, pEntry, pSl, pTp, { clientId: shortClientId });
            }
          } catch (err: any) {
            if (isBrokerPriceOrStopsError(err)) {
              logger.info(`[MageEngine] ⚠️ Broker rejected limit order on ${brokerSymbol} (${err.message}). Executing Smart Market Fallback...`);

              // --- Smart Fallback Safety Checks ---
              const elapsed = Date.now() - (os.limitPlacedAt || Date.now()); // Fallback start time approximation
              if (elapsed > 2500) {
                logger.info(`[MageEngine] 🛑 Smart Market Fallback Aborted: Broker took ${elapsed}ms to reject limit order, market may have moved.`);
                globalTradeGate.release(orch.profileId, preRegKey);
                return;
              }

              const latestPrice = isBuy ? c.close + spreadPts : c.close;
              const hitSl = isBuy ? (latestPrice <= pSl) : (latestPrice >= pSl);
              const hitTp = isBuy ? (latestPrice >= pTp) : (latestPrice <= pTp);
              if (hitSl || hitTp) {
                logger.info(`[MageEngine] 🛑 Smart Market Fallback Aborted: Live price already hit ${hitSl ? 'Stop Loss' : 'Take Profit'}!`);
                globalTradeGate.release(orch.profileId, preRegKey);
                return;
              }
              
              const totalDist = Math.abs(pTp - pEntry);
              const currentDist = isBuy ? (latestPrice - pEntry) : (pEntry - latestPrice);
              const pctTowardsTp = currentDist / totalDist;
              
              if (pctTowardsTp >= 0.10) {
                 logger.info(`[MageEngine] 🛑 Smart Market Fallback Aborted: Live price slipped ${Math.round(pctTowardsTp * 100)}% towards TP (Threshold: 10%)`);
                 globalTradeGate.release(orch.profileId, preRegKey);
                 return;
              }
              // ------------------------------------

              const staticSpec = getSymbolSpec(symbol.split("_")[0]);
              const stopsLevelPts = liveSpec?.stopsLevel || (staticSpec as any).stopsLevel || 0;
              const safePrices = calculateStopsLevelSafePrices(
                os.breakoutDir as "BUY" | "SELL",
                latestPrice,
                pSl,
                pTp,
                stopsLevelPts,
                liveSpec?.tickSize || staticSpec.tickSize || 0.00001,
                liveSpec?.digits || staticSpec.digits || 5
              );
              logger.info(`[MageEngine] 🛡️ Smart Market Fallback Prices: Entry=${latestPrice}, SL=${safePrices.pSl}, TP=${safePrices.pTp} (stopsLevel=${stopsLevelPts}pts)`);
              res = os.breakoutDir === "BUY"
                ? await conn.createMarketBuyOrder(brokerSymbol, calculatedVolume, safePrices.pSl, safePrices.pTp, { clientId: shortClientId })
                : await conn.createMarketSellOrder(brokerSymbol, calculatedVolume, safePrices.pSl, safePrices.pTp, { clientId: shortClientId });
            } else {
              throw err;
            }
          }
        }
        
        // Save limitOrderId only for pending limit orders (null for direct market fills)
        os.limitOrderId = executeAsMarket ? null : res.orderId;
        os.limitPlacedAt = c.timestamp;
        
        os.fired = true;  // Set only after successful broker confirmation
        os.tradeTakenDate = os.currentDateStr;
        os.tradeTakenOnOrbDay = os.currentDateStr;
        os.mageTradeTakenToday = true;
        // Swap pre-registration to real broker order ID
        globalTradeGate.release(orch.profileId, preRegKey);
        globalTradeGate.register(
          orch.profileId,
          res.orderId,
          symbol,
          os.breakoutDir,
          "ALGO",
        );

        // Immediate Trailing & Active Trade Attachment for Direct Market Orders
        if (executeAsMarket && res && res.orderId) {
          const openPrice = isBuy ? (c.close + spreadPts) : c.close;
          const openTimeMs = c.timestamp || Date.now();
          try {
            await db.prepare(`
              UPDATE bot_trade_states 
              SET status = 'OPEN', meta_order_id = ?, entry_price = ?, sl_price = ?, tp_price = ?, lots = ?
              WHERE (client_id = ? OR meta_order_id = ?) AND status = 'PLACING'
            `).run(res.orderId, openPrice, pSl, pTp, calculatedVolume, shortClientId, res.orderId);
          } catch (e: any) {}

          if (!state.activeTrades) state.activeTrades = [];
          const newTradeRec = {
            dbId: 0,
            metaOrderId: res.orderId,
            clientId: sig,
            botId: botId.toUpperCase(),
            direction: os.breakoutDir,
            entryPrice: openPrice,
            slPrice: pSl,
            originalSl: pSl,
            tpPrice: pTp,
            riskPips: Math.abs(openPrice - pSl) / pipSize,
            highestPrice: openPrice,
            lowestPrice: openPrice,
            isTrailing: false,
            volume: calculatedVolume,
            hasTakenPartial: false,
            openTime: openTimeMs,
          };
          if (!state.activeTrades.some((t: any) => t.metaOrderId === res.orderId)) {
            state.activeTrades.push(newTradeRec);
          }
          if (!state.activeTrade) state.activeTrade = newTradeRec;
          logger.info(`[MageEngine] ⚡ Market Order OPEN & Attached for Trailing on ${brokerSymbol} at ${openPrice}`);
        }

        // Register Canonical Session Direction in GlobalTradeGate for Consensus & Cross-Account Catch-Up
        globalTradeGate.registerSessionDirection({
          botId: botId.toUpperCase(),
          symbol,
          session: sessionName,
          dateStr,
          direction: os.breakoutDir,
          entryPrice: pEntry,
          slPrice: pSl,
          tpPrice: pTp,
          timestamp: Date.now(),
          sig,
          leadProfileId: orch.profileId,
        });

        logger.info(`[DiscretionaryTrader] 🚀 ${os.breakoutDir} ${executeAsMarket ? 'MARKET' : 'LIMIT'} PLACED on ${brokerSymbol} via Mage at ${os.limitPrice} at ${new Date(c.timestamp).toISOString()}`);
        orch.addEyeFeedEvent({
          type: "TRADE_ENTERED",
          bot_id: botId,
          data: {
            symbol,
            direction: os.breakoutDir,
            setupType: "ORB Breakout",
            price: os.limitPrice,
            volume: calculatedVolume,
            sl: os.slPrice,
            tp: os.tpPrice,
            reasoning: `M5 candle broke ORB range. Placed ${os.breakoutDir} ${executeAsMarket ? 'market' : 'limit'} order.`,
          },
        });
        const summary = `Mage ${executeAsMarket ? 'Market' : 'Limit'} Placed: ${os.breakoutDir} ${symbol}
Entry: ${os.limitPrice}
SL: ${os.slPrice}
TP: ${os.tpPrice}
Vol: ${calculatedVolume}
Risk: ${riskPct.toFixed(2)}%`;
        addBotLog(orch.profileId, botId, symbol, "TRADE_ENTERED", summary);
      },
      "MageLimitOrder",
      5,
      undefined,
      orch.profileId
    ).catch((err) => {
      logger.error(`[PLACE_LIMIT_MAGE] ERROR:`, err);
      // Release the pre-registration lock so future retries/setups can proceed
      globalTradeGate.release(orch.profileId, preRegKey);
      // Reset fired flag so the day is not permanently locked on broker failure
      os.fired = false;
      os.mageTradeTakenToday = false;
      addBotLog(
        orch.profileId,
        botId,
        symbol,
        "ERROR",
        `Failed to place limit: ${err.message} ${err.details ? JSON.stringify(err.details) : (err.stringifiedDetails || '')}`
      );
    });
  } catch (e) {
    logger.error(`[DiscretionaryTrader] Limit Placement Error:`, e);
  }
}

export async function checkMageLimitFill(orch: any, sessionPair: string, state: any, c: any, targetBotId: string = "MAGE") {
  if (!state.orbStates) return;
  for (const sig of Object.keys(state.orbStates)) {
    const os = state.orbStates[sig];
    if (os && os.limitOrderId && (!state.activeTrades || !state.activeTrades.find((t: any) => t.clientId === sig || t.metaOrderId === os.limitOrderId))) {
      try {
        const baseSymbol = PairConfigManager.getBaseSymbol(sessionPair);
        let positions: any[] = [];
        if (orch.account) {
          positions = await orch.account.getPositions();
        } else {
          const conn = await getSharedConnection(orch.token, orch.accountId);
          positions = await enqueueMetaApiRequest(
            async () => await conn.getPositions(),
            `Positions:${baseSymbol}`,
            undefined,
            undefined,
            orch.profileId
          );
        }
        const dirType = os.breakoutDir === "BUY" ? "POSITION_TYPE_BUY" : "POSITION_TYPE_SELL";
        const pos = positions.find(
          (p: any) => {
            if (p.symbol !== baseSymbol || p.type !== dirType) return false;
            if (p.id === os.limitOrderId) return true;
            if (p.clientId === sig) return true;
            if (orch.sigMap && orch.sigMap[p.clientId] === sig) return true;
            if (p.clientId?.startsWith("M_" + getShortHash(sig))) return true;
            return false;
          }
        );
        if (pos) {
          os.limitOrderId = null;
          const mageConfigs = PairConfigManager.getMageConfigs(sessionPair);
          const config = mageConfigs.find((c: any) => c.signature === sig) || mageConfigs[0] || state.config;
          const pipSize = config?.pipSize || PairConfigManager.getRepresentativeConfig(sessionPair)?.pipSize || getDynamicPipSize(baseSymbol);
          const intendedLimit = os.limitPrice || pos.openPrice;
          const riskPips = Math.abs(intendedLimit - os.slPrice) / pipSize;
          const openTimeMs = c.timestamp || Date.now();

          let dbId = 0;
          try {
            // First try to upgrade a PLACING record
            const upgradeRes = await db.prepare(`
              UPDATE bot_trade_states 
              SET status = 'OPEN', meta_order_id = ?, entry_price = ?, sl_price = ?, tp_price = ?, lots = ? 
              WHERE (client_id = ? OR meta_order_id = ?) AND status = 'PLACING' RETURNING id
            `).all(pos.id, pos.openPrice, os.slPrice, os.tpPrice, pos.volume, pos.clientId || sig, os.limitOrderId);
            
            if (upgradeRes && upgradeRes.length > 0) {
              dbId = upgradeRes[0].id;
            } else {
              const tp = await db.prepare("SELECT user_id FROM trading_profiles WHERE id = ?").get(orch.profileId);
              const actualUserId = tp ? tp.user_id : 0;
              const insertTrade = await db.prepare(`
                INSERT INTO bot_trade_states
                  (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, tp_price,
                   lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, initial_risk_pips, status, client_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'OPEN', ?)
              `);
              const runResult = await insertTrade.run(
                actualUserId, orch.profileId, targetBotId.toUpperCase(), baseSymbol, os.breakoutDir,
                pos.openPrice, os.slPrice, os.tpPrice, pos.volume, openTimeMs,
                pos.id, pos.openPrice, pos.openPrice, riskPips, pos.clientId || sig
              );
              dbId = runResult.lastInsertRowid;
            }
          } catch(e: any) {
            logger.error(`[MageEngine] DB Insert/Upgrade error: ${e.message}`);
          }

          if (!state.activeTrades) state.activeTrades = [];
          const newTradeRec = {
            dbId,
            metaOrderId: pos.id,
            clientId: sig,
            botId: targetBotId.toUpperCase(),
            direction: os.breakoutDir,
            entryPrice: pos.openPrice,
            slPrice: os.slPrice,
            originalSl: os.slPrice,
            tpPrice: os.tpPrice,
            riskPips,
            highestPrice: pos.openPrice,
            lowestPrice: pos.openPrice,
            isTrailing: false,
            volume: pos.volume,
            hasTakenPartial: false,
            openTime: openTimeMs,
          };
          if (!state.activeTrades.some((t: any) => t.metaOrderId === pos.id)) {
            state.activeTrades.push(newTradeRec);
          }
          if (!state.activeTrade) state.activeTrade = newTradeRec;
          logger.info(`[DiscretionaryTrader] ✅ Mage Limit Filled on ${baseSymbol} (Config: ${sig}) at ${pos.openPrice}`);
        }
      } catch (e) {
        logger.error(`[DiscretionaryTrader] Error checking Mage limit for ${sig}:`, e);
      }
    }
  }
}

export async function evaluateMageTrailingOnTick(
  orch: any,
  sessionPair: string,
  state: any,
  c: any,
  targetBotId: string = "MAGE"
) {
  const mageConfigs = PairConfigManager.getMageConfigs(sessionPair);

  // M-4 PARITY: Check pending limit orders for TP sweeps on every tick to match MageMathCore
  if (state.orbStates) {
    for (const sig of Object.keys(state.orbStates)) {
      const os = state.orbStates[sig];
      // Check if it's a pending limit order with no active trade attached
      if (os && os.limitOrderId && (!state.activeTrades || !state.activeTrades.find((t: any) => t.clientId === sig || t.metaOrderId === os.limitOrderId))) {
        let tpSwept = false;
        let slSwept = false;
        
        // M-4 PARITY: Check TP sweeps using candle extremes
        if (os.breakoutDir === "SELL" && c.low <= os.tpPrice) {
          tpSwept = true;
        } else if (os.breakoutDir === "BUY" && c.high >= os.tpPrice) {
          tpSwept = true;
        }
        
        // MISSING FILL SL SWEEP: Check SL sweeps using live ticks (c.close) to avoid polluting from pre-breakout wicks
        if (os.breakoutDir === "SELL" && c.close >= os.slPrice) {
          slSwept = true;
        } else if (os.breakoutDir === "BUY" && c.close <= os.slPrice) {
          slSwept = true;
        }

        if (tpSwept || slSwept) {
          try {
            const conn = await getSharedConnection(orch.profileId);
            const cancelPromise = enqueueMetaApiRequest(
              async () => await conn.cancelOrder(os.limitOrderId),
              `CancelSweptMageLimitOrder:${sessionPair}:${sig}`
            );
            if (orch.pendingPromises) orch.pendingPromises.push(cancelPromise);
          } catch (_e) { /* ignore cancel errors */ }
          os.limitOrderId = null;
          os.limitPlacedAt = 0;
          os.fired = true;
          os.mageTradeTakenToday = true;
          if (!(global as any).testParitySuppressLogging) {
            logger.info(`[MageEngine] ${sessionPair} Cancelled pending limit order — ${tpSwept ? 'TP' : 'SL'} boundary swept before fill.`);
          }
        }
      }
    }
  }

  const allTracked = (state.activeTrades || []).slice();
  if (state.activeTrade && !allTracked.some((t: any) => t.metaOrderId === state.activeTrade.metaOrderId)) {
    allTracked.push(state.activeTrade);
  }
  const mageTrades = allTracked.filter((t: any) => {
    const id = t.botId?.toUpperCase() || "";
    if (id === "DISCRETIONARY_TRADER") return true;
    return id.startsWith(targetBotId.toUpperCase());
  });
  if (mageTrades.length === 0) return;

  for (const trade of mageTrades) {
    const sig = trade.botId;
    const cid = trade.clientId || "";
    const searchConfigs = mageConfigs;

    let config = state.config;
    // Bug 9 Fix: Check clientId first (it IS the signature), then short hash, then botId as last resort.
    // trade.botId is the generic string "MAGE", not the per-pair config signature.
    let found: any = null;
    if (cid) {
      // 1. Exact match on clientId (covers backtester signatures)
      found = searchConfigs.find((c: any) => cid.toLowerCase() === c.signature!.toLowerCase());
      // 2. clientId starts with or contains signature
      if (!found) found = searchConfigs.find((c: any) => cid.toLowerCase().startsWith(c.signature!.toLowerCase()) || cid.toLowerCase().includes(c.signature!.toLowerCase()));
      // 3. Short hash lookup (covers live hashed clientIds like M_<hash12>_<ts>)
      if (!found) found = searchConfigs.find((c: any) => cid.includes(getShortHash(c.signature!)));
    }
    if (!found && sig) {
      // 4. Fallback: match on botId string (usually just "MAGE", but handles legacy)
      found = searchConfigs.find((c: any) => c.signature.toLowerCase() === sig.toLowerCase() || sig.toLowerCase().includes(c.signature!.toLowerCase()));
    }
    if (found) config = found;
    if (!config) continue;
    const baseSymbol = PairConfigManager.getBaseSymbol(sessionPair);
    if (baseSymbol === "XAUUSD") {
      const clog = (global as any).__ORIGINAL_LOG__ || console.log;
      clog(`[DEBUG CONFIG IN TRAIL] config=${JSON.stringify(config)}`);
    }



    const pipSize = OPTIMIZER_CONFIG[baseSymbol]?.pipSize || getSymbolSpec(baseSymbol).pipSize;
    const isBuy = trade.direction === "BUY";
    const originalSl = trade.originalSl || trade.slPrice;
    const riskPips = Math.abs(trade.entryPrice - originalSl) / pipSize;

    if (riskPips <= 0) continue;

    const currentTime = c.timestamp || Date.now();
    const openTime = Number.isFinite(Number(trade.openTime)) ? Number(trade.openTime) : (trade.openTime ? new Date(trade.openTime).getTime() : 0);
    const fcHours = config.forceCloseHours;

    const estDate = getFixedEstDate(new Date(currentTime));
    const newsCheck = isNewsBlackout(baseSymbol, new Date(currentTime));
    const isNewsForceClose = newsCheck.blocked;
    if (
      openTime &&
      ((fcHours !== undefined && fcHours > 0 && currentTime - openTime >= fcHours * 60 * 60 * 1e3) || isNewsForceClose)
    ) {
      const closeReason = isNewsForceClose
        ? `Mage High-Impact News Blackout Force Close.`
        : `Mage Timeout Close (${fcHours}h max duration reached).`;
        
      logger.info(`[DiscretionaryTrader] ⛔ MAGE M1 Force Close (${isNewsForceClose ? "News Blackout" : fcHours + "h"}) for ${baseSymbol}.`);
      try {
        await enqueueMetaApiRequest(async () => {
          const conn = await getSharedConnection(orch.token, orch.accountId);
          await conn.closePosition(trade.metaOrderId);
        }, `ClosePos:${baseSymbol}`, undefined, undefined, orch.profileId);
        const updateStmt = db.prepare(
          "UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ?",
        );
        updateStmt.run(trade.dbId);
        orch.addEyeFeedEvent({
          type: "FORCE_CLOSE",
          symbol: baseSymbol,
          bot_id: trade.botId || targetBotId,
          data: {
            decision: "CLOSE",
            setupType: "ORB Breakout",
            reasoning: closeReason
          }
        });
        if (state.activeTrade?.metaOrderId === trade.metaOrderId) {
          delete state.activeTrade;
        }
        if (state.activeTrades) {
          state.activeTrades = state.activeTrades.filter((t: any) => String(t.metaOrderId) !== String(trade.metaOrderId));
        }
        continue;
      } catch (e: any) {
        const errMsg = e?.message || e?.toString() || "";
        if (errMsg.includes("Position not found") || errMsg.includes("Order not found")) {
          console.log(`[MageEngine] â„¹ï¸  Position ${trade.metaOrderId} (${baseSymbol}) already closed on broker. Marking as CLOSED in DB.`);
          await db
            .prepare("UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ?")
            .run(trade.dbId);
          if (state.activeTrade?.metaOrderId === trade.metaOrderId) {
            delete state.activeTrade;
          }
          if (state.activeTrades) {
            state.activeTrades = state.activeTrades.filter((t: any) => String(t.metaOrderId) !== String(trade.metaOrderId));
          }
        } else {
          logger.error(`[DiscretionaryTrader] Failed to force close Mage position for ${baseSymbol}:`, e);
        }
        continue;
      }
    }

    const brokerDigits = getSymbolSpec(baseSymbol.split("_")[0]).digits || 5;
    const spread = OPTIMIZER_CONFIG[baseSymbol.replace(".Daily", "")]?.spread; 
    const spreadPts = spread !== undefined ? spread * pipSize : 0;
    const highestReached = isBuy ? c.high : c.low + spreadPts;
    const actualRisk = Math.abs(trade.entryPrice - originalSl);

    const currentR = isBuy
      ? (highestReached - trade.entryPrice) / actualRisk
      : (trade.entryPrice - highestReached) / actualRisk;

    const tTrig = config.trailingSlTrigger;

    const clog = (global as any).__ORIGINAL_LOG__ || console.log;
    const botLabel = trade.botId === "discretionary_trader" ? "MANUAL" : "MAGE";
    clog(`📈 Trailing Eval (${botLabel}) ${baseSymbol}: FloatingR=${currentR >= 0 ? "+" : ""}${currentR.toFixed(2)}R | BreakEvenTrigger=${tTrig}R | Step=${config.trailingSlStep}R | CurrentSL=${trade.slPrice} | Entry=${trade.entryPrice}`);

    if (trade.lastTrailingLevel === undefined) trade.lastTrailingLevel = -1;
    let mageShouldUpdate = false;
    let mageNewSl = trade.slPrice;
    const tStep = config.trailingSlStep!;

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
      if (currentR >= beTrig && trade.lastTrailingLevel < beLock) {
        trade.lastTrailingLevel = beLock;
        const proposedSL = Number((isBuy ? trade.entryPrice + beLock * actualRisk : trade.entryPrice - beLock * actualRisk).toFixed(brokerDigits));
        if (isBuy ? proposedSL > trade.slPrice && proposedSL > mageNewSl : proposedSL < trade.slPrice && proposedSL < mageNewSl) {
          mageNewSl = proposedSL;
          mageShouldUpdate = true;
        }
      }
      // Tier 2: Mid-profit lock
      if (currentR >= pTrig1 && trade.lastTrailingLevel < pLock1) {
        trade.lastTrailingLevel = pLock1;
        const proposedSL = Number((isBuy ? trade.entryPrice + pLock1 * actualRisk : trade.entryPrice - pLock1 * actualRisk).toFixed(brokerDigits));
        if (isBuy ? proposedSL > trade.slPrice && proposedSL > mageNewSl : proposedSL < trade.slPrice && proposedSL < mageNewSl) {
          mageNewSl = proposedSL;
          mageShouldUpdate = true;
        }
      }
      // Tier 3: High-profit lock
      if (currentR >= pTrig2 && trade.lastTrailingLevel < pLock2) {
        trade.lastTrailingLevel = pLock2;
        const proposedSL = Number((isBuy ? trade.entryPrice + pLock2 * actualRisk : trade.entryPrice - pLock2 * actualRisk).toFixed(brokerDigits));
        if (isBuy ? proposedSL > trade.slPrice && proposedSL > mageNewSl : proposedSL < trade.slPrice && proposedSL < mageNewSl) {
          mageNewSl = proposedSL;
          mageShouldUpdate = true;
        }
      }
      // Tier 4: Stepped trailing beyond Tier 3
      if (currentR >= pTrig2 + aStep) {
        const steps = Math.floor((currentR - pTrig2) / aStep);
        const level = pLock2 + steps * aStep;
        if (level > trade.lastTrailingLevel) {
          trade.lastTrailingLevel = level;
          const proposedSL = Number((isBuy ? trade.entryPrice + level * actualRisk : trade.entryPrice - level * actualRisk).toFixed(brokerDigits));
          if (isBuy ? proposedSL > trade.slPrice && proposedSL > mageNewSl : proposedSL < trade.slPrice && proposedSL < mageNewSl) {
            mageNewSl = proposedSL;
            mageShouldUpdate = true;
          }
        }
      }
    } else if (config.trailingSlStep === 999) {
      if (currentR >= tTrig && (isBuy ? trade.slPrice < trade.entryPrice : trade.slPrice > trade.entryPrice)) {
        mageNewSl = trade.entryPrice;
        mageShouldUpdate = true;
        clog(`[DEBUG MAGE TRAIL TRIGGERED 999] newSl=${mageNewSl}`);
      }
    } else if (isBuy) {
      if (currentR >= tTrig && trade.slPrice < trade.entryPrice) {
        mageNewSl = trade.entryPrice;
        mageShouldUpdate = true;
        trade.lastTrailingLevel = 0;
      }
      if (currentR >= tTrig + tStep) {
        const numSteps = Math.floor((currentR - tTrig) / tStep);
        const rLevelToLock = numSteps * tStep;
        if (rLevelToLock > trade.lastTrailingLevel) {
          trade.lastTrailingLevel = rLevelToLock;
          const proposedSL = Number((trade.entryPrice + rLevelToLock * actualRisk).toFixed(brokerDigits));
          if (proposedSL > trade.slPrice && proposedSL > mageNewSl) {
            mageNewSl = proposedSL;
            mageShouldUpdate = true;
          }
        }
      }
    } else {
      if (currentR >= tTrig && trade.slPrice > trade.entryPrice) {
        mageNewSl = trade.entryPrice;
        mageShouldUpdate = true;
        trade.lastTrailingLevel = 0;
      }
      if (currentR >= tTrig + tStep) {
        const numSteps = Math.floor((currentR - tTrig) / tStep);
        const rLevelToLock = numSteps * tStep;
        if (rLevelToLock > trade.lastTrailingLevel) {
          trade.lastTrailingLevel = rLevelToLock;
          const proposedSL = Number((trade.entryPrice - rLevelToLock * actualRisk).toFixed(brokerDigits));
          if (proposedSL < trade.slPrice && proposedSL < mageNewSl) {
            mageNewSl = proposedSL;
            mageShouldUpdate = true;
          }
        }
      }
    }

    if (mageShouldUpdate && mageNewSl !== trade.slPrice) {
      const lastSent = (trade as any).lastSentSlPrice || trade.slPrice;
      const dist = Math.abs(mageNewSl - lastSent);
      const isSim = !!(global as any).__SIM_MOCK_ACCOUNT__ || !!(global as any).__SIM_CURRENT_TIME__;
      const minTrailUpdatePips = isSim ? 0 : ((config as any).minTrailUpdatePips || 1.0);

      if (dist < minTrailUpdatePips * pipSize) {
        return;
      }

      const roundedSl = roundPrice(mageNewSl, baseSymbol);
      trade.slPrice = roundedSl;
      (trade as any).lastSentSlPrice = roundedSl;
      try {
        if (!trade.isVirtualSlMode) {
          await enqueueMetaApiRequest(async () => {
            const conn = await getSharedConnection(orch.token, orch.accountId);
            await conn.modifyPosition(trade.metaOrderId, roundedSl, trade.tpPrice || null);
          }, `TrailMAGE:${sessionPair}`, undefined, undefined, orch.profileId);
        }
        logger.info(`[DiscretionaryTrader] ðŸ›¡ï¸  MAGE Continuous 0.5R Trail: ${sessionPair} SL updated to ${roundedSl}`);
        orch.addEyeFeedEvent({
          type: "TRAILING_SL",
          bot_id: trade.botId || targetBotId,
          data: {
            symbol: baseSymbol,
            decision: "TRAIL",
            setupType: "ORB Breakout",
            sl: roundedSl,
            reasoning: `ðŸ›¡ï¸  MAGE Continuous Trail SL updated to ${roundedSl}`
          }
        });

        const updateStmt = db.prepare(
          "UPDATE bot_trade_states SET sl_price = ?, highest_price = ?, lowest_price = ? WHERE id = ?",
        );
        const newHighest = trade.direction === "BUY"
          ? Math.max(trade.highestPrice || trade.entryPrice, c.high)
          : (trade.highestPrice || trade.entryPrice);
        const newLowest = trade.direction === "SELL"
          ? Math.min(trade.lowestPrice || trade.entryPrice, c.low)
          : (trade.lowestPrice || trade.entryPrice);
        trade.highestPrice = newHighest;
        trade.lowestPrice = newLowest;
        updateStmt.run(roundedSl, newHighest, newLowest, trade.dbId);
      } catch (err: any) {
        logger.error(`[DiscretionaryTrader] âš ï¸  Failed to update MAGE 0.5R Trail for ${sessionPair}:`, err.message);
      }
    }
  }
}

export async function cancelMagePendingOnNews(orch: any, sessionPair: string, state: any, c: any) {
  if (!state.orbStates) return;
  const baseSymbol = PairConfigManager.getBaseSymbol(sessionPair);
  const newsCheck = isNewsBlackout(baseSymbol, new Date(c.timestamp));
  if (!newsCheck.blocked) return;

  for (const sig of Object.keys(state.orbStates)) {
    const os = state.orbStates[sig];
    if (os && os.limitOrderId && (!state.activeTrades || !state.activeTrades.find(t => t.clientId === sig))) {
      try {
        const conn = await getSharedConnection(orch.token, orch.accountId);
        const orderId = os.limitOrderId;
        os.limitOrderId = null;
        await enqueueMetaApiRequest(
          async () => conn.cancelOrder(orderId),
          `CancelMageNewsBlackout:${baseSymbol}`,
          undefined,
          undefined,
          orch.profileId
        );
        logger.info(`[DiscretionaryTrader] ðŸ§¹ MAGE cancelled pending limit order ${orderId} on ${baseSymbol} due to News Blackout: ${newsCheck.reason}.`);
      } catch (e) {
        logger.error(`[DiscretionaryTrader] Failed to cancel MAGE limit order on news:`, e);
      }
    }
  }
}

export { placeMageLimitOrder, runMageBot };

