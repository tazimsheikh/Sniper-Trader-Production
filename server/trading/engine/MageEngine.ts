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

// ── Epsilon-aware floating-point comparison helpers (inline to respect engine air-gap rule) ──
const PRICE_EPSILON = 1e-9;
const gte = (a: number, b: number): boolean => (a - b) >= -PRICE_EPSILON;
const lte = (a: number, b: number): boolean => (b - a) >= -PRICE_EPSILON;

import { OPTIMIZER_CONFIG, getDynamicPipSize } from "../config/OptimizerPairConfig.js";
import { PairConfigManager } from "../config/PairConfig.js";
import { enqueueMetaApiRequest as realQueue } from "../../utils/MetaApiQueue.js";
const enqueueMetaApiRequest = (...args: any[]) =>
  ((global as any).__SIM_QUEUE__?.enqueueMetaApiRequest || realQueue)(...args);
import { isNewsBlackout as realNews } from '../../news/newsStore.js';
const isNewsBlackout = (...args: any[]) =>
  ((global as any).__SIM_NEWS__?.isNewsBlackout || realNews)(...args);
import { globalTradeGate as realGate } from "../../utils/GlobalTradeGate.js";
const globalTradeGate: any = new Proxy({}, {
  get(_target, prop) {
    const target = (global as any).__SIM_TRADE_GATE__ || realGate;
    const val = (target as any)[prop];
    return typeof val === "function" ? val.bind(target) : val;
  }
});
import { isTradeAllowed, isRolloverCircuitBreaker, isToxicDay } from "../market/MathFilters.js";
import { HTFContextTracker } from "../market/HTFContextTracker.js";
import { generateMagicNumber } from "../../utils/magicNumber.js";


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
  const mageConfigs = (orch as any).__CUSTOM_MAGE_CONFIGS__ || PairConfigManager.getMageConfigs(symbol);
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
  const is1700Reset = os.lastEstHour !== undefined && ((os.lastEstHour < 17 && estHour >= 17) || (os.lastEstHour > estHour && estHour >= 17));
  const isAsiaSession = config.session === "asia" || (config.orbStartHour !== undefined && config.orbStartHour >= 18);
  const isMidnightExpiry = !isAsiaSession && os.lastEstHour !== undefined && os.lastEstHour > estHour && estHour < 17;
  const isStartMinsReset = isBuildingORB && !os.wasBuildingORB;

  os.wasBuildingORB = isBuildingORB;

  if (is1700Reset || isMidnightExpiry || isStartMinsReset) {
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
          `[DiscretionaryTrader] 🧹 MAGE cancelled stale limit order ${os.limitOrderId} on ${symbol} (new ORB session: ${dateStr}).`,
        );
      } catch (_e) {
        /* ignore cancel errors on day rollover */
      }
    }
    
    // MID-SESSION HYDRATION CHECK
    // If waking up mid-ORB, reconstruct true ORB from historical m5Buffer candles
    if (isStartMinsReset && currentMins > startMins + 5) {
      const openingCandles = (state.m5Buffer || []).filter((bc: any) => {
        if (bc.dateStr !== dateStr) return false;
        const cm = bc.estHour * 60 + bc.estMinute;
        return cm >= startMins && cm <= currentMins;
      });

      const hasStartCandle = openingCandles.some((bc: any) => {
        const cm = bc.estHour * 60 + bc.estMinute;
        return cm >= startMins && cm <= startMins + 5;
      });

      if (hasStartCandle && openingCandles.length > 0) {
        let maxH = -Infinity;
        let minL = Infinity;
        for (const oc of openingCandles) {
          if (oc.high > maxH) maxH = oc.high;
          if (oc.low < minL) minL = oc.low;
        }
        os.orHigh = Math.max(maxH, c.high);
        os.orLow = Math.min(minL, c.low);
        os.orBuilt = false;
        os.wasBuildingORB = true;
        logger.info(`[MageEngine] 🔄 Mid-session reboot gracefully reconstructed ORB for ${symbol} using ${openingCandles.length} cached candles (High: ${os.orHigh}, Low: ${os.orLow}).`);
      } else {
        // HYDRATION TRAP REMOVED: Do not lock bot for the entire session! Just reset and wait for next day.
        logger.error(`[MageEngine] 🚨 FATAL MID-SESSION REBOOT: Woke up during the ORB window for ${symbol} but missed opening ${currentMins - startMins} mins with no cached data. Waiting for next session.`);
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
      }
    } else {
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
              logger.info(`[DiscretionaryTrader] 🛑 MAGE cancelled limit order (${cancelReason})`);
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
  const magic = generateMagicNumber("MAGE", sig);
  const activeTrade = (state.activeTrades || []).find((t: any) => t.magic === magic || t.clientId === sig);
  if (activeTrade) {
    if (activeTrade.dateStr === dateStr || os.tradeTakenOnOrbDay === dateStr) {
      os.fired = true;
      os.mageTradeTakenToday = true;
    }
    return;
  }
  // ── CROSS-ACCOUNT SMART TRADE CATCH-UP ──
  const sessionName = config?.session || state.config?.session || "default";
  const leadTrade = globalTradeGate.getActiveLeadTrade("MAGE", symbol, sessionName, dateStr);
  if (
    leadTrade &&
    (!leadTrade.session || leadTrade.session === sessionName) &&
    leadTrade.leadProfileId !== orch.profileId &&
    !os.limitOrderId &&
    !os.isPlacing &&
    !os.fired &&
    !os.mageTradeTakenToday &&
    (!state.activeTrades || !state.activeTrades.find((t: any) => t.clientId === sig || t.magic === magic))
  ) {
    const isBuy = leadTrade.direction === "BUY";
    const optCfg = PairConfigManager.getRepresentativeConfig(symbol);
    const pipSize = config?.pipSize || optCfg?.pipSize || getDynamicPipSize(symbol.split("_")[0]);
    const spreadPts = (optCfg && optCfg.spread !== undefined) ? optCfg.spread * pipSize : 0;
    const currentPrice = isBuy ? c.close + spreadPts : c.close;
    const proximityThreshold = Math.max(3.5 * pipSize, (optCfg?.spread || 1) * 2.5 * pipSize, 0.15 * Math.abs(leadTrade.entryPrice - leadTrade.slPrice));
    
    const distFromLead = isBuy ? (currentPrice - leadTrade.entryPrice) : (leadTrade.entryPrice - currentPrice);
    const totalTpDist = Math.abs(leadTrade.tpPrice - leadTrade.entryPrice);
    const pctTowardsTp = distFromLead > 0 ? (distFromLead / (totalTpDist || 1)) : 0;
    const hitSl = isBuy ? (currentPrice <= leadTrade.slPrice) : (currentPrice >= leadTrade.slPrice);

    const isWithinSafeProximity = !hitSl && pctTowardsTp < 0.15 && (distFromLead <= proximityThreshold || (isBuy ? currentPrice <= leadTrade.entryPrice : currentPrice >= leadTrade.entryPrice));

    if (isWithinSafeProximity) {
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

  if (os.mageTradeTakenToday) return;
  if (os.fired || os.limitOrderId || os.isPlacing) return;

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
    return false;
  });
  if (thisConfigActive) return;

  // 🚫 Check Rollover Circuit Breaker + Pair-Specific Toxic Hours/Days (No entry allowed)
  if (isRolloverCircuitBreaker(estHour, estMin)) return;
  if (config.toxicHours && config.toxicHours.includes(estHour)) return;
  const candleDate = new Date(c.timestamp);
  const dow = getFixedEstDate(candleDate).getUTCDay();
  if (config.toxicDays && isToxicDay(dow, config.toxicDays)) return;
  const orRangePips = (os.orHigh - os.orLow) / pipSize;
  const normalizedSymbol = symbol
    .split("_")[0]
    .split(".")[0]
    .trim()
    .toUpperCase();
  const isForex = PairConfigManager.isForex(normalizedSymbol);
  const maxSlPips = _mCfg.maxSlDist!;
  if (!_mCfg.slMode && orRangePips + (spreadPts / pipSize) > maxSlPips) {
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
      : startMins + orDurationMins + (_mCfg.actionMinutes ?? 180);

  let isInsideActionWindow = false;
  if (endMins >= 1440) {
    isInsideActionWindow = currentMins >= (startMins + orDurationMins) || currentMins < (endMins % 1440);
  } else {
    isInsideActionWindow = currentMins >= (startMins + orDurationMins) && currentMins < endMins;
  }

  if (!isInsideActionWindow) {
    // FIX: Do NOT set os.fired = true. This prevents multi-session configurations from executing on subsequent windows.
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

    const prevEstDate = getFixedEstDate(new Date(lastM5.timestamp));
    const prevM5Mins = prevEstDate.getUTCHours() * 60 + prevEstDate.getUTCMinutes();

    const judasDelay = _mCfg.judasDelayMins ?? 0;
    const reqMins = startMins + orDurationMins + judasDelay;
    if (prevM5Mins < reqMins) {
      logger.verbose(`[MageEngine] ${symbol} Wait: Let ORB finish building (prevM5Mins=${prevM5Mins} < req=${reqMins})`);
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
      if (gte(actionCandle.high, reqBuyHigh)) buyTriggered = true;
      if (lte(actionCandle.low, os.orLow)) sellTriggered = true;
    }

    // Log scanning activity for visibility on dev console
    if (!(global as any).isSimulator) {
      logger.info(`[MageEngine][P${orch.profileId}] 🔍 Scanning ${_sessionPair} Breakout [${new Date(actionCandle.timestamp).toISOString().substring(11, 16)} EST] | ` +
        `Candle [High/Low/Close]: [${actionCandle.high}/${actionCandle.low}/${actionCandle.close}] | ` +
        `ORB [High/Low]: [${os.orHigh.toFixed(5)}/${os.orLow.toFixed(5)}]`);
    }

    if ((global as any).isSimulator && symbol.includes("USDCHF")) {
    }

    if (buyTriggered || sellTriggered) {
      if ((global as any).__SIM_WARMUP__) return;
      if (buyTriggered && sellTriggered) { 
        return; 
      }
      if (buyTriggered && Math.max(actionCandle.open, actionCandle.close) < os.orHigh) {
          return;
      }
      if (sellTriggered && Math.min(actionCandle.open, actionCandle.close) > os.orLow) {
          return;
      }

      const minRatio = _mCfg.minAtrRatio ?? 0.35;
      const maxRatio = _mCfg.maxAtrRatio ?? 1.5;
      const orPips = (os.orHigh - os.orLow) / pipSize;
      if (!state.m5Buffer || state.m5Buffer.length < 14) {
        if (!(global as any).isSimulator) {
          logger.info(`[MageEngine][P${orch.profileId}] ATR-Relative OR filter skipped breakout for ${symbol}: Insufficient M5 history buffer (${state.m5Buffer?.length || 0}/14).`);
        }
        return;
      }
      // ATR-Relative OR filter: use 14-period Wilder ATR from state
      const atrArr = state.atrArr || [];
      // Use candle prior to action candle (atrArr[len-2]) for exact parity with MageMathCore (atrArr[i-1])
      const atrVal = atrArr.length >= 2 ? atrArr[atrArr.length - 2] : (atrArr.length >= 1 ? atrArr[atrArr.length - 1] : 0);
      if (atrVal > 0) {
        const atr14Pips = atrVal / pipSize;
        const ratio = (orPips / atr14Pips);
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
            `[DiscretionaryTrader] ⛔ Mage aborted on ${symbol} at ${new Date(actionCandle.timestamp).toISOString()}: Breakout action body (${bodySize.toFixed(1)} pips) < minBodyPips (${_mCfg.minBodyPips}).`,
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
      if (isForex && !_mCfg.slMode && _mCfg.maxSlDist !== undefined && (orRangePips + 10) > _mCfg.maxSlDist + 0.001) {
        logger.info(`[MageEngine] ⛔ Aborted on ${symbol}: OR range + 10 (${(orRangePips + 10).toFixed(1)}) > maxSlDist (${_mCfg.maxSlDist}).`);
        return;
      }
      const pullbackPct = _mCfg.orbPullbackPct ?? 0;
      const breakoutPrice = direction === "BUY" ? actionCandle.close + spreadPts : actionCandle.close;
      const entryPriceRaw =
        pullbackPct > 0
          ? (direction === "BUY" ? rOrHigh - boxSize * pullbackPct : rOrLow + boxSize * pullbackPct)
          : breakoutPrice;
      const entryPrice = roundPrice(entryPriceRaw, PairConfigManager.getBaseSymbol(symbol));
      os.limitPrice = entryPrice;
      const slBuffer = 0;
      const slMode = (_mCfg.slMode || "OPPOSITE_BOUNDARY").toUpperCase();
      let proposedSl = 0;
      if (slMode === "MIDPOINT") {
        const midpoint = (rOrHigh + rOrLow) / 2.0;
        proposedSl = direction === "BUY" ? midpoint : midpoint + spreadPts;
      } else if (slMode === "BREAKOUT_BAR_LOW") {
        const buffer = 2 * pipSize;
        const barLow = actionCandle.low ?? rOrLow;
        const barHigh = actionCandle.high ?? rOrHigh;
        proposedSl = direction === "BUY" ? barLow - buffer : barHigh + buffer + spreadPts;
      } else if (slMode === "BOX_30PCT") {
        proposedSl = direction === "BUY" ? rOrHigh - 0.30 * boxSize : rOrLow + 0.30 * boxSize + spreadPts;
      } else {
        // Default: "OPPOSITE_BOUNDARY"
        proposedSl =
          direction === "BUY"
            ? rOrLow - slBuffer
            : rOrHigh + spreadPts + slBuffer;
      }
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
      os.breakoutDir = direction;
      os.mageTradeTakenToday = true;
      os.tradeTakenOnOrbDay = os.currentOrbDateStr;
      os.visionApproved = true;
      await placeMageLimitOrder(orch, symbol, state, c, sig, config, botId).catch((e) => {
        console.error("[MAGE LIMIT ORDER EXCEPTION]", e);
        logger.error("Swallowed error caught: ", e);
      });
    }
  }
}

async function placeMageLimitOrder(orch: any, symbol: string, state: any, c: any, sig: string, config: any, botId: string = "mage", forceLimit: boolean = false) {
  const _sessionStr = state.config?.session ? "_" + state.config.session : "";
  const _sessionPair = symbol + _sessionStr;
  const _mCfg = config;
  const os = state.orbStates[sig];
  if (!os || !os.visionApproved || os.fired || os.limitOrderId || os.isPlacing) return;
  os.isPlacing = true;

  const abortPlacement = () => {
    os.isPlacing = false;
  };

  const magic = generateMagicNumber('MAGE', sig);
  if (state.activeTrades && state.activeTrades.some((t: any) => t.magic === magic || t.clientId === sig)) {
    os.fired = true;
    os.mageTradeTakenToday = true;
    abortPlacement();
    return;
  }
  if ((global as any).__SIM_WARMUP__) {
    os.fired = false;
    os.visionApproved = false;
    os.mageTradeTakenToday = false;
    abortPlacement();
    return;
  }
  if (state.botConfigs.get(botId)?.enabled === false) {
    logger.info(`[DiscretionaryTrader] ⛔ Trade blocked — Pair ${symbol} is disabled for bot ${botId}`);
    abortPlacement();
    return;
  }
  const newsCheck = isNewsBlackout(symbol, new Date(c.timestamp));
  if (newsCheck.blocked) {
    logger.info(`[DiscretionaryTrader] ⛔ Trade blocked — News Blackout Window active for ${symbol}: ${newsCheck.reason}`);
    abortPlacement();
    return;
  }
  try {
    const profile = typeof orch.getProfileData === 'function' 
      ? await orch.getProfileData()
      : await db.prepare("SELECT t.risk_multiplier, COALESCE(t.metaapi_token, u.metaapi_token) as metaapi_token, t.metaapi_account_id, t.dwcb_enabled, t.dwcb_peak_balance, t.base_risk_balance, t.broker_symbol_map, t.institutional_enabled, t.institutional_daily_cap, t.institutional_peak_to_draw, t.institutional_daily_start_balance, t.institutional_daily_date, t.institutional_peak_balance FROM trading_profiles t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?").get(orch.profileId);
    if (!profile) {
      abortPlacement();
      return;
    }
    const cryptoModule: any = await import('../../core/crypto.js');
    const { isEncrypted, decrypt } = cryptoModule;
    let token = profile.metaapi_token || orch.token;
    let accId = profile.metaapi_account_id || orch.accountId;
    if (isEncrypted(token)) token = decrypt(token);
    if (isEncrypted(accId)) accId = decrypt(accId);

    if (!(global as any).__SIM_MOCK_ACCOUNT__ && (!orch.cachedEquity || orch.cachedEquity <= 0)) {
      try {
        const rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
        const conn = await getSharedConnection(rawToken, accId);
        const accInfo = await conn.getAccountInformation();
        if (accInfo && accInfo.equity > 0) {
          orch.cachedEquity = accInfo.equity;
          console.log(`[MageEngine] 🔄 Emergency live fetch account equity: $${orch.cachedEquity.toFixed(2)}`);
        }
      } catch (e: any) {}
    }

    if (!(global as any).__SIM_MOCK_ACCOUNT__ && (!orch.cachedEquity || orch.cachedEquity <= 0)) {
      logger.warn(`[MageEngine] ⚠️ Cached equity is 0 or missing. Aborting trade to prevent DWCB corruption.`);
      abortPlacement();
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
        profile.institutional_peak_balance = currentInstPeak;
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
          abortPlacement();
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
        profile.institutional_daily_start_balance = dailyStartBal;
        profile.institutional_daily_date = dailyDate;
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
          abortPlacement();
          return;
        }
      }
    }

    if (profile.dwcb_enabled === 1 && dwcbMultiplier <= 0) {
      logger.error(`[DiscretionaryTrader] 🛑 DWCB halt triggered on Mage (dwcbMultiplier <= 0) on ${symbol}. Trade aborted.`);
      abortPlacement();
      return;
    }
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
    const MAX_PERMITTED_RISK_PCT = 3.0;
    if (riskPct > MAX_PERMITTED_RISK_PCT) {
      riskPct = MAX_PERMITTED_RISK_PCT;
    }

    const riskFraction = riskPct / 100;
    const balance = (profile.base_risk_balance && Number(profile.base_risk_balance) > 0)
      ? Number(profile.base_risk_balance)
      : effectiveBalance;
    if (!balance || balance <= 0) {
      logger.error(`[MageEngine] ❌ Invalid live equity (${balance}). Aborting trade placement for safety on ${symbol}.`);
      abortPlacement();
      return;
    }
    const riskAmount = balance * riskFraction * dwcbMultiplier * institutionalMultiplier;
    const slDistPips = Math.abs(os.limitPrice - os.slPrice) / pipSize;
    if (slDistPips <= 0) {
      logger.error(`[DiscretionaryTrader] ❌ Mage: SL distance is ${slDistPips} pips on ${symbol}. Aborting to prevent infinite lot size.`);
      return;
    }
    const rawVolume = riskAmount / (slDistPips * liveSpec.pipValuePerLot);
    const calculatedVolume = quantizeLots(
      rawVolume,
      liveSpec.volumeStep,
      liveSpec.minVolume,
      liveSpec.maxVolume,
    );
    const sessionName = config?.session || state.config?.session || "default";
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
      abortPlacement();
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
      abortPlacement();
      return;
    }
    
    // Pre-register immediately to close the race window between canTrade() and the
    // async broker call. A second concurrent candle event hitting canTrade() for the
    // same pair+direction will now be blocked by Rule 4 (duplicate block).
    // Key format: PRE_{sig} — swapped to real orderId on broker confirmation.
    const preRegKey = `PRE_${sig}`;
    globalTradeGate.register(orch.profileId, preRegKey, symbol, os.breakoutDir, "ALGO");

    // 🔒 SYNCHRONOUS IN-FLIGHT MUTEX: Immediately lock this configuration state synchronously
    // so any fast-arriving ticks during the async broker queue wait cannot duplicate-fire.
    os.fired = true;
    os.mageTradeTakenToday = true;
    os.isPlacing = true;

    const magic = generateMagicNumber('MAGE', sig);
    const shortClientId = `MAGE_${orch.profileId}_${Date.now().toString(36)}`;
    if (!orch.sigMap) orch.sigMap = {};
    orch.sigMap[shortClientId] = sig;

    await enqueueMetaApiRequest(
      async () => {
        const conn = await getSharedConnection(token, accId);
        if (!conn) throw new Error("No shared connection available.");
        const pEntry = roundPrice(os.limitPrice, brokerSymbol);
        const pSl = roundPrice(os.slPrice, brokerSymbol);
        const pTp = roundPrice(os.tpPrice, brokerSymbol);
        
        let res: any;
        const pullbackPct = _mCfg.orbPullbackPct || 0;
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
        const currentPrice = roundPrice(isBuy ? c.close + spreadPts : c.close, brokerSymbol);
        const proximityThreshold = Math.max(3.5 * pipSize, (optCfg?.spread || 1) * 2.5 * pipSize, 0.15 * Math.abs(pEntry - pSl));
        const distFromEntry = isBuy ? (currentPrice - pEntry) : (pEntry - currentPrice);
        const isWithinProximity = Math.abs(distFromEntry) <= proximityThreshold || (isBuy ? currentPrice <= pEntry : currentPrice >= pEntry);

        const isSplitEntry = !!_mCfg.splitEntryEnabled;
        if (isSplitEntry) {
          const marketWeight = _mCfg.splitEntryMarketRiskPct ?? 0.50;
          const limitWeight = _mCfg.splitEntryLimitRiskPct ?? 0.50;

          // 1. Tranche 1 (Market Momentum Entry)
          const slDistPips1 = Math.abs(currentPrice - pSl) / pipSize;
          const rawVolume1 = (riskAmount * marketWeight) / (slDistPips1 * liveSpec.pipValuePerLot);
          const calculatedVolume1 = quantizeLots(rawVolume1, liveSpec.volumeStep, liveSpec.minVolume, liveSpec.maxVolume);

          // 2. Tranche 2 (Limit Retest Entry)
          const rOrHigh = roundPrice(os.orHigh, brokerSymbol);
          const rOrLow = roundPrice(os.orLow, brokerSymbol);
          const boxSize = roundPrice(Math.abs(rOrHigh - rOrLow), brokerSymbol);
          const retestPct = _mCfg.splitEntryRetestPct ?? (_mCfg.orbPullbackPct > 0 ? _mCfg.orbPullbackPct : 0.0);
          const pLimitEntryRaw = isBuy ? (rOrHigh - boxSize * retestPct) : (rOrLow + boxSize * retestPct);
          const pLimitEntry = roundPrice(pLimitEntryRaw, brokerSymbol);
          const slDistPips2 = Math.abs(pLimitEntry - pSl) / pipSize;
          const rawVolume2 = (riskAmount * limitWeight) / (slDistPips2 * liveSpec.pipValuePerLot);
          const calculatedVolume2 = quantizeLots(rawVolume2, liveSpec.volumeStep, liveSpec.minVolume, liveSpec.maxVolume);

          const staticSpec = getSymbolSpec(brokerSymbol);
          const stopsLevelPts = liveSpec?.stopsLevel || (staticSpec as any).stopsLevel || 0;
          const safePrices1 = calculateStopsLevelSafePrices(
            os.breakoutDir as "BUY" | "SELL",
            currentPrice,
            pSl,
            pTp,
            stopsLevelPts,
            liveSpec?.tickSize || staticSpec.tickSize || 0.00001,
            liveSpec?.digits ?? staticSpec.digits ?? 5
          );
          const roundedSafeSl1 = roundPrice(safePrices1.pSl, brokerSymbol);
          const roundedSafeTp1 = roundPrice(safePrices1.pTp, brokerSymbol);

          const isSim = (global as any).isSimulator || (global as any).__SIM_MOCK_ACCOUNT__;
          const t1ClientId = `${shortClientId}_T1`;
          const t2ClientId = `${shortClientId}_T2`;
          if (!orch.sigMap) orch.sigMap = {};
          orch.sigMap[t1ClientId] = sig;
          orch.sigMap[t2ClientId] = sig;

          // Place Market Order (Tranche 1)
          const marketOpts = isSim
            ? { magic, clientId: t1ClientId, entryPrice: currentPrice, limitPrice: currentPrice, riskWeight: marketWeight }
            : { magic, clientId: t1ClientId, riskWeight: marketWeight };

          logger.info(`[MageEngine] ⚡ Executing Dual-Tranche MARKET T1 ${os.breakoutDir} on ${brokerSymbol} (Lots: ${calculatedVolume1}, Weight: ${marketWeight}, Live: ${currentPrice}, SL: ${roundedSafeSl1}, TP: ${roundedSafeTp1})`);
          let resMarket: any;
          if (os.breakoutDir === "BUY") {
            resMarket = await conn.createMarketBuyOrder(brokerSymbol, calculatedVolume1, roundedSafeSl1, roundedSafeTp1 || undefined, marketOpts);
          } else {
            resMarket = await conn.createMarketSellOrder(brokerSymbol, calculatedVolume1, roundedSafeSl1, roundedSafeTp1 || undefined, marketOpts);
          }

          // Place Limit Order (Tranche 2)
          logger.info(`[MageEngine] ⏳ Executing Dual-Tranche LIMIT T2 ${os.breakoutDir} on ${brokerSymbol} (Lots: ${calculatedVolume2}, Weight: ${limitWeight}, Target: ${pLimitEntry}, SL: ${pSl}, TP: ${pTp})`);
          let resLimit: any;
          const limitOpts = { magic, clientId: t2ClientId, riskWeight: limitWeight };
          if (os.breakoutDir === "BUY") {
            resLimit = await conn.createLimitBuyOrder(brokerSymbol, calculatedVolume2, pLimitEntry, pSl, pTp || undefined, limitOpts);
          } else {
            resLimit = await conn.createLimitSellOrder(brokerSymbol, calculatedVolume2, pLimitEntry, pSl, pTp || undefined, limitOpts);
          }

          os.isPlacing = false;
          os.limitOrderId = resLimit?.orderId || null;
          os.limitPlacedAt = c.timestamp;
          os.fired = true;
          os.tradeTakenDate = os.currentDateStr;
          os.tradeTakenOnOrbDay = os.currentDateStr;
          os.mageTradeTakenToday = true;

          globalTradeGate.release(orch.profileId, preRegKey);
          if (resMarket?.orderId) {
            globalTradeGate.register(orch.profileId, resMarket.orderId, symbol, os.breakoutDir, "ALGO");
          }
          if (resLimit?.orderId) {
            globalTradeGate.register(orch.profileId, resLimit.orderId, symbol, os.breakoutDir, "ALGO");
          }

          // Attach Tranche 1 to activeTrades
          if (resMarket && resMarket.orderId) {
            if (!state.activeTrades) state.activeTrades = [];
            const newTradeRec = {
              dbId: 0,
              metaOrderId: resMarket.orderId,
              clientId: t1ClientId,
              botId: botId.toUpperCase(),
              direction: os.breakoutDir,
              entryPrice: currentPrice,
              intendedEntryPrice: currentPrice,
              entrySlippage: 0,
              slPrice: roundedSafeSl1,
              originalSl: roundedSafeSl1,
              tpPrice: roundedSafeTp1,
              riskPips: slDistPips1,
              highestPrice: currentPrice,
              lowestPrice: currentPrice,
              isTrailing: false,
              volume: calculatedVolume1,
              hasTakenPartial: false,
              openTime: c.timestamp || Date.now(),
            };
            state.activeTrades.push(newTradeRec);
            state.activeTrade = newTradeRec;
          }

          return; // Placement complete for Dual-Tranche!
        }

        const executeAsMarket = !forceLimit && (pullbackPct === 0 || isWithinProximity);

        if (executeAsMarket) {
          const hitSl = isBuy ? (currentPrice <= pSl) : (currentPrice >= pSl);
          const hitTp = isBuy ? (currentPrice >= pTp) : (currentPrice <= pTp);
          if (hitSl || hitTp) {
            logger.info(`[MageEngine] 🛑 Direct Market Order Aborted: Live price (${currentPrice}) already hit ${hitSl ? 'Stop Loss' : 'Take Profit'}!`);
            globalTradeGate.release(orch.profileId, preRegKey);
            abortPlacement();
            return;
          }

          const staticSpec = getSymbolSpec(brokerSymbol);
          const stopsLevelPts = liveSpec?.stopsLevel || (staticSpec as any).stopsLevel || 0;
          const safePrices = calculateStopsLevelSafePrices(
            os.breakoutDir as "BUY" | "SELL",
            currentPrice,
            pSl,
            pTp,
            stopsLevelPts,
            liveSpec?.tickSize || staticSpec.tickSize || 0.00001,
            liveSpec?.digits ?? staticSpec.digits ?? 5
          );
          const roundedSafeSl = roundPrice(safePrices.pSl, brokerSymbol);
          const roundedSafeTp = roundPrice(safePrices.pTp, brokerSymbol);

          logger.info(`[MageEngine] ⚡ Executing direct MARKET ${os.breakoutDir} on ${brokerSymbol} (Proximity: ${(distFromEntry / pipSize).toFixed(1)} pips <= ${(proximityThreshold / pipSize).toFixed(1)} threshold, Target: ${pEntry}, Live: ${currentPrice}, SL: ${roundedSafeSl}, TP: ${roundedSafeTp})`);
          const isSim = (global as any).isSimulator || (global as any).__SIM_MOCK_ACCOUNT__;
          const marketOpts = isSim
            ? { magic, clientId: shortClientId, entryPrice: currentPrice, limitPrice: pEntry }
            : { magic, clientId: shortClientId };
          if (os.breakoutDir === "BUY") {
            res = await conn.createMarketBuyOrder(brokerSymbol, calculatedVolume, roundedSafeSl, roundedSafeTp || undefined, marketOpts);
          } else {
            res = await conn.createMarketSellOrder(brokerSymbol, calculatedVolume, roundedSafeSl, roundedSafeTp || undefined, marketOpts);
          }
        } else {
          try {
            if (os.breakoutDir === "BUY") {
              res = await conn.createLimitBuyOrder(brokerSymbol, calculatedVolume, pEntry, pSl, pTp || undefined, { magic, clientId: shortClientId });
            } else {
              res = await conn.createLimitSellOrder(brokerSymbol, calculatedVolume, pEntry, pSl, pTp || undefined, { magic, clientId: shortClientId });
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

              const latestPrice = roundPrice(isBuy ? c.close + spreadPts : c.close, brokerSymbol);
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

              const staticSpec = getSymbolSpec(brokerSymbol);
              const stopsLevelPts = liveSpec?.stopsLevel || (staticSpec as any).stopsLevel || 0;
              const safePrices = calculateStopsLevelSafePrices(
                os.breakoutDir as "BUY" | "SELL",
                latestPrice,
                pSl,
                pTp,
                stopsLevelPts,
                liveSpec?.tickSize || staticSpec.tickSize || 0.00001,
                liveSpec?.digits ?? staticSpec.digits ?? 5
              );
              const roundedSafeSl = roundPrice(safePrices.pSl, brokerSymbol);
              const roundedSafeTp = roundPrice(safePrices.pTp, brokerSymbol);
              logger.info(`[MageEngine] 🛡️ Smart Market Fallback Prices: Entry=${latestPrice}, SL=${roundedSafeSl}, TP=${roundedSafeTp} (stopsLevel=${stopsLevelPts}pts)`);
              const isSim = (global as any).isSimulator || (global as any).__SIM_MOCK_ACCOUNT__;
              const fallbackOpts = isSim
                ? { magic, clientId: shortClientId, entryPrice: latestPrice, limitPrice: pEntry }
                : { magic, clientId: shortClientId };
              res = os.breakoutDir === "BUY"
                ? await conn.createMarketBuyOrder(brokerSymbol, calculatedVolume, roundedSafeSl, roundedSafeTp || undefined, fallbackOpts)
                : await conn.createMarketSellOrder(brokerSymbol, calculatedVolume, roundedSafeSl, roundedSafeTp || undefined, fallbackOpts);
            } else {
              throw err;
            }
          }
        }
        
        // Save limitOrderId only for pending limit orders (null for direct market fills)
        os.isPlacing = false;
        os.limitOrderId = executeAsMarket ? null : res.orderId;
        os.limitPlacedAt = c.timestamp;

        if (!executeAsMarket && res && res.orderId) {
          try {
            await db.prepare(`
              UPDATE bot_trade_states 
              SET meta_order_id = ? 
              WHERE client_id = ? AND status = 'PLACING'
            `).run(res.orderId, shortClientId);
          } catch (e: any) {
            logger.error(`[MageEngine] Failed to update meta_order_id for limit order: ${e.message}`);
          }
        }
        
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
          let matchedPos: any = null;
          try {
            const currentPositions = await conn.getPositions();
            matchedPos = currentPositions.find((p: any) => String(p.id) === String(res.orderId));
            const stillOpen = !!matchedPos;
            if (!stillOpen && currentPositions.length > 0) {
              logger.info(`[MageEngine] ⚡ Market Order ${res.orderId} was already closed by broker on entry candle.`);
              return;
            }
          } catch (_e) {}

          const realFillPrice = matchedPos?.openPrice 
            ? roundPrice(matchedPos.openPrice, brokerSymbol) 
            : (isBuy ? (c.close + spreadPts) : c.close);
          const openPrice = realFillPrice;
          const openTimeMs = matchedPos?.time ? new Date(matchedPos.time).getTime() : (c.timestamp || Date.now());
          const actualRiskPips = Math.abs(openPrice - pSl) / pipSize;
          try {
            await db.prepare(`
              UPDATE bot_trade_states 
              SET status = 'OPEN', meta_order_id = ?, entry_price = ?, sl_price = ?, tp_price = ?, lots = ?, initial_risk_pips = ?
              WHERE (client_id = ? OR meta_order_id = ?) AND status = 'PLACING'
            `).run(res.orderId, openPrice, pSl, pTp, calculatedVolume, actualRiskPips, shortClientId, res.orderId);
          } catch (e: any) {}

          if (!state.activeTrades) state.activeTrades = [];
          const newTradeRec = {
            dbId: 0,
            metaOrderId: res.orderId,
            clientId: sig,
            botId: botId.toUpperCase(),
            direction: os.breakoutDir,
            entryPrice: openPrice,
            realFillPrice: openPrice,
            intendedEntryPrice: pEntry,
            entrySlippage: isBuy ? (openPrice - pEntry) : (pEntry - openPrice),
            slPrice: pSl,
            originalSl: pSl,
            tpPrice: pTp,
            riskPips: actualRiskPips,
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
          logger.info(`[MageEngine] ⚡ Market Order OPEN & Attached for Trailing on ${brokerSymbol} at ${openPrice} (Real Fill, Risk: ${actualRiskPips.toFixed(1)} pips)`);
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
          isFilled: executeAsMarket,
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
      const errMsg = err?.message || err?.toString() || "";
      const isTimeout = errMsg.includes("Timeout") || errMsg.includes("timed out") || errMsg.includes("15s");
      logger.error(`[PLACE_LIMIT_MAGE] ERROR:`, err);
      // Release the pre-registration lock so future retries/setups can proceed
      globalTradeGate.release(orch.profileId, preRegKey);

      if (isTimeout) {
        // 🛡️ CRITICAL: MetaApi RPC timeout does NOT mean broker failed.
        // Keep fired = true & mageTradeTakenToday = true to prevent rapid duplicate retry loops!
        os.fired = true;
        os.mageTradeTakenToday = true;
        os.isPlacing = false;
        db.prepare("UPDATE bot_trade_states SET status = 'PENDING_VERIFICATION' WHERE client_id = ? AND status = 'PLACING'").run(shortClientId).catch(() => {});
        logger.warn(`[MageEngine] ⏳ Order placement timed out on broker RPC for ${brokerSymbol}. Marked PENDING_VERIFICATION to prevent duplicate orders.`);
        addBotLog(orch.profileId, botId, symbol, "WARNING", `Order timed out (15s). Marked PENDING_VERIFICATION for broker reconciliation: ${errMsg}`);
      } else {
        // Non-timeout fatal broker error (e.g. invalid lot size, market closed)
        os.fired = false;
        os.mageTradeTakenToday = false;
        os.isPlacing = false;
        db.prepare("UPDATE bot_trade_states SET status = 'FAILED' WHERE client_id = ? AND status = 'PLACING'").run(shortClientId).catch(() => {});
        addBotLog(
          orch.profileId,
          botId,
          symbol,
          "ERROR",
          `Failed to place limit: ${errMsg} ${err.details ? JSON.stringify(err.details) : (err.stringifiedDetails || '')}`
        );
      }
    });
  } catch (e) {
    logger.error(`[DiscretionaryTrader] Limit Placement Error:`, e);
  }
}

export async function checkMageLimitFill(orch: any, sessionPair: string, state: any, c: any, targetBotId: string = "MAGE") {
  if (!state.orbStates) return;
  for (const sig of Object.keys(state.orbStates)) {
    const os = state.orbStates[sig];
    if (os && os.limitOrderId && (!state.activeTrades || !state.activeTrades.find((t: any) => String(t.metaOrderId) === String(os.limitOrderId)))) {
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
            if (String(p.id) === String(os.limitOrderId)) return true;
            if (p.clientId === sig || p.clientId === `${sig}_T2`) return true;
            if (orch.sigMap && (orch.sigMap[p.clientId] === sig || orch.sigMap[p.clientId] === `${sig}_T2`)) return true;
            return false;
          }
        );
        if (pos) {
          os.limitOrderId = null;
          const mageConfigs = (orch as any).__CUSTOM_MAGE_CONFIGS__ || PairConfigManager.getMageConfigs(sessionPair);
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
              WHERE (client_id = ? OR meta_order_id = ?) AND status IN ('PLACING', 'FAILED', 'PENDING_VERIFICATION') RETURNING id
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
            magic: pos.magic || generateMagicNumber("MAGE", sig),
            botId: targetBotId.toUpperCase(),
            direction: os.breakoutDir,
            entryPrice: pos.openPrice,
            intendedEntryPrice: os.limitPrice || pos.openPrice,
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

          // Register canonical filled status in GlobalTradeGate for peer accounts
          const sessionName = config?.session || state.config?.session || "default";
          const dateStr = os.currentDateStr || new Date(c.timestamp).toISOString().split("T")[0];
          globalTradeGate.registerSessionDirection({
            botId: targetBotId.toUpperCase(),
            symbol: baseSymbol,
            session: sessionName,
            dateStr,
            direction: os.breakoutDir,
            entryPrice: pos.openPrice,
            slPrice: os.slPrice,
            tpPrice: os.tpPrice,
            timestamp: Date.now(),
            sig,
            leadProfileId: orch.profileId,
            isFilled: true,
          });

          // Explicitly update existing lead trade object in GlobalTradeGate
          globalTradeGate.markLeadTradeFilled(targetBotId.toUpperCase(), baseSymbol, sessionName, dateStr, pos.openPrice);
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
  const mageConfigs = (orch as any).__CUSTOM_MAGE_CONFIGS__ || PairConfigManager.getMageConfigs(sessionPair);

  // M-4 PARITY: Check pending limit orders for TP sweeps on every tick to match MageMathCore
  if (state.orbStates) {
    for (const sig of Object.keys(state.orbStates)) {
      const os = state.orbStates[sig];
      // Check if it's a pending limit order with no active trade attached
      if (os && os.limitOrderId && (!state.activeTrades || !state.activeTrades.find((t: any) => String(t.metaOrderId) === String(os.limitOrderId)))) {
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

        const searchConfigs = (orch as any).__CUSTOM_MAGE_CONFIGS__ || PairConfigManager.getMageConfigs(sessionPair) || (state.config?.mageConfig ? [state.config.mageConfig] : []);
        const sigCfg = searchConfigs.find((x: any) => x.signature === sig || (x.signature && sig.includes(x.signature))) || searchConfigs[0];

        // Dual-Tranche Retest Cancellation: If Tranche 1 has reached BE or closed
        if (sigCfg?.splitEntryEnabled) {
          const t1Trade = (state.activeTrades || []).find((t: any) =>
            (t.clientId === `${sig}_T1` || (orch.sigMap && orch.sigMap[t.clientId] === `${sig}_T1`) || (orch.sigMap && orch.sigMap[t.clientId] === sig) || (t.clientId && t.clientId.endsWith('_T1')))
            && String(t.metaOrderId) !== String(os.limitOrderId)
          );
          if (t1Trade) {
            const splitBeLock = sigCfg.splitRunnerBeLock ?? 0.10;
            let beLock = sigCfg.adtelBeLock ?? 0.10;
            if (sigCfg.exitMode === "ADTEL_AGGRESSIVE") beLock = 0.05;
            else if (sigCfg.exitMode === "ADTEL_MODERATE") beLock = 0.10;
            else if (sigCfg.exitMode === "ADTEL_CONSERVATIVE") beLock = 0.25;
            const targetBe = (sigCfg.splitRunnerEnabled || sigCfg.exitMode === "SPLIT_RUNNER") ? splitBeLock : beLock;
            if (t1Trade.hasTakenPartial || t1Trade.lastTrailingLevel >= targetBe || (os.breakoutDir === "BUY" ? t1Trade.slPrice >= t1Trade.entryPrice : t1Trade.slPrice <= t1Trade.entryPrice)) {
              tpSwept = true;
            }
          }
        }
        const fcHours = sigCfg?.forceCloseHours;
        let isTimedOut = false;
        if (fcHours !== undefined && os.limitPlacedAt && (c.timestamp - os.limitPlacedAt >= fcHours * 3600000)) {
          isTimedOut = true;
        }

        const estDate = getFixedEstDate(new Date(c.timestamp));
        const estHour = estDate.getUTCHours();
        const estMin = estDate.getUTCMinutes();
        const isRollover = isRolloverCircuitBreaker(estHour, estMin);

        if (tpSwept || slSwept || isTimedOut || isRollover) {
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
            const reason = tpSwept ? 'TP boundary swept' : slSwept ? 'SL boundary swept' : isTimedOut ? `expired after ${fcHours}h` : 'rollover circuit breaker';
            logger.info(`[MageEngine] ${sessionPair} Cancelled pending limit order — ${reason}.`);
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
      found = searchConfigs.find((c: any) => c.signature && cid.toLowerCase() === c.signature.toLowerCase());
      // 2. clientId starts with or contains signature
      if (!found) found = searchConfigs.find((c: any) => c.signature && (cid.toLowerCase().startsWith(c.signature.toLowerCase()) || cid.toLowerCase().includes(c.signature.toLowerCase())));
      // 2.5. Resolve shortClientId → real sig via orch.sigMap (covers production + shadow where clientId = "MAGE_0_<hash>")
      if (!found && orch.sigMap && orch.sigMap[cid]) {
        const resolvedSig = orch.sigMap[cid];
        found = searchConfigs.find((c: any) => c.signature && c.signature.toLowerCase() === resolvedSig.toLowerCase());
      }
    }
    if (!found && sig) {
      // 3. Fallback: match on botId string
      found = searchConfigs.find((c: any) => c.signature && (c.signature.toLowerCase() === sig.toLowerCase() || sig.toLowerCase().includes(c.signature.toLowerCase())));
    }
    if (!found && searchConfigs.length > 0) {
      found = searchConfigs[0];
    }
    if (found) config = found;
    if (!config) continue;
    const baseSymbol = PairConfigManager.getBaseSymbol(sessionPair);

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
      const pyrClientId = `${trade.clientId || cid}_PYR`;
      const childTrade = (state.activeTrades || []).find((t: any) => t.isPyramidChild && t.clientId === pyrClientId);
      try {
        await enqueueMetaApiRequest(async () => {
          const conn = await getSharedConnection(orch.token, orch.accountId);
          await conn.closePosition(trade.metaOrderId);
          if (childTrade) {
            await conn.closePosition(childTrade.metaOrderId).catch(() => {});
          }
        }, `ClosePos:${baseSymbol}`, undefined, undefined, orch.profileId);
        const updateStmt = db.prepare(
          "UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ? OR meta_order_id = ?",
        );
        updateStmt.run(trade.dbId, String(trade.metaOrderId));
        if (childTrade) {
          updateStmt.run(childTrade.dbId, String(childTrade.metaOrderId));
        }
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
        if (state.activeTrade?.metaOrderId === trade.metaOrderId || (childTrade && state.activeTrade?.metaOrderId === childTrade.metaOrderId)) {
          delete state.activeTrade;
        }
        if (state.activeTrades) {
          state.activeTrades = state.activeTrades.filter((t: any) => 
            String(t.metaOrderId) !== String(trade.metaOrderId) && (!childTrade || String(t.metaOrderId) !== String(childTrade.metaOrderId))
          );
        }
        continue;
      } catch (e: any) {
        const errMsg = e?.message || e?.toString() || "";
        if (errMsg.includes("Position not found") || errMsg.includes("Order not found")) {
          console.log(`[MageEngine] ℹ️ Position ${trade.metaOrderId} (${baseSymbol}) already closed on broker. Marking as CLOSED in DB.`);
          await db
            .prepare("UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ? OR meta_order_id = ?")
            .run(trade.dbId, String(trade.metaOrderId));
          if (childTrade) {
            await db
              .prepare("UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ? OR meta_order_id = ?")
              .run(childTrade.dbId, String(childTrade.metaOrderId));
          }
          if (state.activeTrade?.metaOrderId === trade.metaOrderId || (childTrade && state.activeTrade?.metaOrderId === childTrade.metaOrderId)) {
            delete state.activeTrade;
          }
          if (state.activeTrades) {
            state.activeTrades = state.activeTrades.filter((t: any) => 
              String(t.metaOrderId) !== String(trade.metaOrderId) && (!childTrade || String(t.metaOrderId) !== String(childTrade.metaOrderId))
            );
          }
        } else {
          logger.error(`[DiscretionaryTrader] Failed to force close Mage position for ${baseSymbol}:`, e);
        }
        continue;
      }
    }

    const brokerDigits = getSymbolSpec(baseSymbol).digits ?? 5;
    const spread = OPTIMIZER_CONFIG[baseSymbol.replace(".Daily", "")]?.spread; 
    const spreadPts = spread !== undefined ? spread * pipSize : 0;
    const peakHigh = Math.max(trade.highestPrice || trade.entryPrice, c.high);
    const peakLow = Math.min(trade.lowestPrice || trade.entryPrice, c.low);
    trade.highestPrice = peakHigh;
    trade.lowestPrice = peakLow;
    const highestReached = isBuy ? peakHigh : peakLow + spreadPts;
    const effectiveEntry = trade.realFillPrice || trade.entryPrice;
    const actualRisk = Math.abs(effectiveEntry - originalSl);
    const actualR = isBuy
      ? (highestReached - effectiveEntry) / (actualRisk > 0 ? actualRisk : pipSize)
      : (effectiveEntry - highestReached) / (actualRisk > 0 ? actualRisk : pipSize);

    const isSim = (global as any).isSimulator || (global as any).__SIM_MOCK_ACCOUNT__;
    const currentR = isSim && trade.intendedEntryPrice !== undefined
      ? Math.max(actualR, isBuy ? (highestReached - trade.intendedEntryPrice) / (Math.abs(trade.intendedEntryPrice - originalSl) || pipSize) : (trade.intendedEntryPrice - highestReached) / (Math.abs(trade.intendedEntryPrice - originalSl) || pipSize))
      : actualR;

    const tTrig = config.trailingSlTrigger;
    const botLabel = trade.botId === "discretionary_trader" ? "MANUAL" : "MAGE";
    logger.verbose(`📈 Trailing Eval (${botLabel}) ${baseSymbol}: FloatingR=${currentR >= 0 ? "+" : ""}${currentR.toFixed(2)}R | BreakEvenTrigger=${tTrig}R | Step=${config.trailingSlStep}R | CurrentSL=${trade.slPrice} | Entry=${effectiveEntry}`);

    const nowMs = Date.now();
    if (!trade._lastTrailLogAt || nowMs - trade._lastTrailLogAt >= 60000) {
      trade._lastTrailLogAt = nowMs;
      const profitPts = isBuy ? (highestReached - trade.entryPrice) : (trade.entryPrice - highestReached);
      logger.info(`[MageEngine] 📊 Tracking Trade ${trade.metaOrderId} on ${baseSymbol} (${trade.direction}): Entry = ${trade.entryPrice}, Live = ${c.close} | Floating = ${currentR >= 0 ? "+" : ""}${currentR.toFixed(2)}R (${profitPts >= 0 ? "+" : ""}${profitPts.toFixed(1)} pts / ${actualRisk.toFixed(1)} pts) | Target BE = +${tTrig}R | SL = ${trade.slPrice}`);
    }

    if (trade.isPyramidChild) {
      continue;
    }

    if (trade.lastTrailingLevel === undefined) trade.lastTrailingLevel = -1;
    let mageShouldUpdate = false;
    let mageNewSl = trade.slPrice;
    const tStep = config.trailingSlStep!;

    const isPyramiding = !!config.pyramidingEnabled;
    const pyrTriggerR = config.pyramidingTriggerR ?? 1.5;
    const pyrLockR = config.pyramidingLockR ?? ((config.pyramidingTriggerR ?? 1.5) - 1.0 > 0 ? (config.pyramidingTriggerR ?? 1.5) - 1.0 : 0.5);
    const pyrWeight = config.pyramidingRiskPct ?? 0.50;

    if (isPyramiding && !trade.hasPyramided && gte(currentR, pyrTriggerR)) {
      trade.hasPyramided = true;
      // 1. Lock profit on Tranche 1
      const lockPriceRaw = isBuy ? trade.entryPrice + pyrLockR * actualRisk : trade.entryPrice - pyrLockR * actualRisk;
      const roundedLock = Number(lockPriceRaw.toFixed(brokerDigits));

      if (isBuy ? roundedLock > trade.slPrice : roundedLock < trade.slPrice) {
        mageNewSl = roundedLock;
        trade.slPrice = roundedLock;
        mageShouldUpdate = true;
        trade.lastTrailingLevel = pyrLockR;
      }

      // 2. Execute Market Scale-In Tranche 2
      const staticSpec = getSymbolSpec(baseSymbol);
      const liveSpec = getLiveBrokerSpec(baseSymbol) || staticSpec;
      const rawVolume2 = (trade.volume || 1.0) * pyrWeight;
      const calculatedVolume2 = quantizeLots(rawVolume2, liveSpec?.volumeStep ?? 0.01, liveSpec?.minVolume ?? 0.01, liveSpec?.maxVolume ?? 100.0);
      const currentPrice = roundPrice(isBuy ? c.close + spreadPts : c.close, baseSymbol);
      const pyrClientId = `${trade.clientId || cid}_PYR`;
      if (!orch.sigMap) orch.sigMap = {};
      orch.sigMap[pyrClientId] = sig;
      const magic = generateMagicNumber('MAGE', sig);

      const isSim = (global as any).isSimulator || (global as any).__SIM_MOCK_ACCOUNT__;
      const pyrOpts = isSim
        ? { magic, clientId: pyrClientId, entryPrice: currentPrice, limitPrice: currentPrice, riskWeight: pyrWeight, intendedRiskPips: riskPips, isPyramidChild: true, hasPyramided: true }
        : { magic, clientId: pyrClientId, riskWeight: pyrWeight, isPyramidChild: true, hasPyramided: true };

      try {
        const simBroker = (global as any).__SIM_MOCK_ACCOUNT__;
        let resPyr: any;
        if (simBroker) {
          if (isBuy) {
            resPyr = await simBroker.createMarketBuyOrder(baseSymbol, calculatedVolume2, roundedLock, trade.tpPrice || undefined, pyrOpts);
          } else {
            resPyr = await simBroker.createMarketSellOrder(baseSymbol, calculatedVolume2, roundedLock, trade.tpPrice || undefined, pyrOpts);
          }
        } else {
          const profile = typeof orch.getProfileData === 'function' ? await orch.getProfileData() : null;
          const token = profile?.metaapi_token || orch.token;
          const accId = profile?.metaapi_account_id || orch.accountId;
          const conn = await getSharedConnection(token, accId);
          if (isBuy) {
            resPyr = await conn.createMarketBuyOrder(baseSymbol, calculatedVolume2, roundedLock, trade.tpPrice || undefined, pyrOpts);
          } else {
            resPyr = await conn.createMarketSellOrder(baseSymbol, calculatedVolume2, roundedLock, trade.tpPrice || undefined, pyrOpts);
          }
        }

        if (resPyr?.orderId) {
          const newPyrTrade = {
            dbId: 0,
            metaOrderId: resPyr.orderId,
            clientId: pyrClientId,
            botId: trade.botId || "MAGE",
            direction: trade.direction,
            entryPrice: currentPrice,
            intendedEntryPrice: currentPrice,
            entrySlippage: 0,
            slPrice: roundedLock,
            originalSl: roundedLock,
            tpPrice: trade.tpPrice,
            riskPips: riskPips,
            highestPrice: currentPrice,
            lowestPrice: currentPrice,
            isTrailing: true,
            volume: calculatedVolume2,
            hasTakenPartial: false,
            openTime: c.timestamp || Date.now(),
            isPyramidChild: true,
            hasPyramided: true,
            riskWeight: pyrWeight
          };
          if (!state.activeTrades) state.activeTrades = [];
          if (!state.activeTrades.some((t: any) => String(t.metaOrderId) === String(resPyr.orderId))) {
            state.activeTrades.push(newPyrTrade);
          }
          globalTradeGate.register(orch.profileId, resPyr.orderId, sessionPair, trade.direction, "ALGO");
          logger.info(`[MageEngine] 🚀 Free-Roll Pyramiding Scale-In executed for ${baseSymbol} (${trade.direction}) at ${currentPrice}, SL locked at ${roundedLock} (+${pyrLockR}R), Volume=${calculatedVolume2}`);
        }
      } catch (pyrErr: any) {
        logger.error(`[MageEngine] Failed to execute Pyramiding Scale-In order for ${baseSymbol}: ${pyrErr.message}`);
      }
    }

    const isSplitRunner = !!config.splitRunnerEnabled || config.exitMode === "SPLIT_RUNNER";
    const splitTargetR = config.splitRunnerTargetR ?? 1.5;
    const splitBankPct = config.splitRunnerBankPct ?? 0.50;
    const splitBeLock = config.splitRunnerBeLock ?? 0.10;

    if (isSplitRunner && !trade.hasTakenPartial && currentR >= splitTargetR) {
      trade.hasTakenPartial = true;
      trade.partialR = splitTargetR;
      trade.bankPct = splitBankPct;

      const bePrice = isBuy
        ? trade.entryPrice + splitBeLock * actualRisk
        : trade.entryPrice - splitBeLock * actualRisk;
      const roundedBe = Number(bePrice.toFixed(brokerDigits));

      if (isBuy ? roundedBe > trade.slPrice : roundedBe < trade.slPrice) {
        mageNewSl = roundedBe;
        mageShouldUpdate = true;
        trade.lastTrailingLevel = splitBeLock;
      }

      const simBroker = (global as any).__SIM_MOCK_ACCOUNT__;
      const spec = getSymbolSpec(baseSymbol);
      const volStep = spec?.volumeStep ?? 0.01;
      const minVol = spec?.minVolume ?? 0.01;
      const maxVol = spec?.maxVolume ?? 100.0;
      const rawCloseVol = (trade.volume || 1.0) * splitBankPct;
      const partialVol = quantizeLots(rawCloseVol, volStep, minVol, maxVol);

      if (simBroker && typeof simBroker.closePositionPartially === "function" && trade.metaOrderId) {
        simBroker.closePositionPartially(trade.metaOrderId, partialVol, { partialR: splitTargetR, bankPct: splitBankPct }).catch(() => {});
      } else if (trade.metaOrderId) {
        (async () => {
          try {
            const profile = typeof orch.getProfileData === 'function' ? await orch.getProfileData() : null;
            const token = profile?.metaapi_token || orch.token;
            const accId = profile?.metaapi_account_id || orch.accountId;
            const conn = await getSharedConnection(token, accId);
            await conn.closePositionPartially(trade.metaOrderId, partialVol);
          } catch (e: any) {
            logger.error(`[MageEngine] Failed to partially close live position ${trade.metaOrderId}: ${e.message}`);
          }
        })().catch(() => {});
      }

      logger.info(`[MageEngine] 🎯 Split Runner Target (${splitTargetR}R) reached on ${baseSymbol}! Banked ${(splitBankPct * 100).toFixed(0)}% volume, moved SL to BE+${splitBeLock}R (${roundedBe}).`);
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
      if (currentR >= tTrig && (isBuy ? trade.slPrice < effectiveEntry : trade.slPrice > effectiveEntry)) {
        mageNewSl = effectiveEntry;
        mageShouldUpdate = true;
      }
    } else if (isBuy) {
      if (currentR >= tTrig && trade.slPrice < effectiveEntry) {
        mageNewSl = effectiveEntry;
        mageShouldUpdate = true;
        trade.lastTrailingLevel = 0;
      }
      if (currentR >= tTrig + tStep) {
        const numSteps = Math.floor((currentR - tTrig) / tStep);
        const rLevelToLock = numSteps * tStep;
        if (rLevelToLock > trade.lastTrailingLevel) {
          trade.lastTrailingLevel = rLevelToLock;
          const proposedSL = Number((effectiveEntry + rLevelToLock * actualRisk).toFixed(brokerDigits));
          if (proposedSL > trade.slPrice && proposedSL > mageNewSl) {
            mageNewSl = proposedSL;
            mageShouldUpdate = true;
          }
        }
      }
    } else {
      if (currentR >= tTrig && trade.slPrice > effectiveEntry) {
        mageNewSl = effectiveEntry;
        mageShouldUpdate = true;
        trade.lastTrailingLevel = 0;
      }
      if (currentR >= tTrig + tStep) {
        const numSteps = Math.floor((currentR - tTrig) / tStep);
        const rLevelToLock = numSteps * tStep;
        if (rLevelToLock > trade.lastTrailingLevel) {
          trade.lastTrailingLevel = rLevelToLock;
          const proposedSL = Number((effectiveEntry - rLevelToLock * actualRisk).toFixed(brokerDigits));
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
      if (state.activeTrade && String(state.activeTrade.metaOrderId) === String(trade.metaOrderId)) {
        state.activeTrade.slPrice = roundedSl;
      }
      (trade as any).lastSentSlPrice = roundedSl;
      try {
        if (!trade.isVirtualSlMode) {
          await enqueueMetaApiRequest(async () => {
            const conn = await getSharedConnection(orch.token, orch.accountId);
            await conn.modifyPosition(trade.metaOrderId, roundedSl, trade.tpPrice || null);
          }, `TrailMAGE:${sessionPair}`, undefined, undefined, orch.profileId);
        }

        const pyrClientId = `${trade.clientId || cid}_PYR`;
        const childTrade = (state.activeTrades || []).find((t: any) => t.isPyramidChild && t.clientId === pyrClientId);
        if (childTrade && childTrade.slPrice !== roundedSl) {
          childTrade.slPrice = roundedSl;
          (childTrade as any).lastSentSlPrice = roundedSl;
          if (isSim) {
            const simBroker = (global as any).__SIM_MOCK_ACCOUNT__;
            if (simBroker && typeof simBroker.modifyPosition === "function") {
              simBroker.modifyPosition(childTrade.metaOrderId, roundedSl, childTrade.tpPrice).catch(() => {});
            }
          } else {
            enqueueMetaApiRequest(async () => {
              const conn = await getSharedConnection(orch.token, orch.accountId);
              await conn.modifyPosition(childTrade.metaOrderId, roundedSl, childTrade.tpPrice || null);
            }, `TrailMAGE_PYR:${sessionPair}`, undefined, undefined, orch.profileId).catch(() => {});
          }
        }
        logger.info(`[DiscretionaryTrader] 🛡️ MAGE Continuous 0.5R Trail: ${sessionPair} SL updated to ${roundedSl}`);
        orch.addEyeFeedEvent({
          type: "TRAILING_SL",
          bot_id: trade.botId || targetBotId,
          data: {
            symbol: baseSymbol,
            decision: "TRAIL",
            setupType: "ORB Breakout",
            sl: roundedSl,
            reasoning: `🛡️ MAGE Continuous Trail SL updated to ${roundedSl}`
          }
        });

        const updateStmt = db.prepare(
          "UPDATE bot_trade_states SET sl_price = ?, highest_price = ?, lowest_price = ? WHERE (id = ? OR meta_order_id = ?)",
        );
        const newHighest = trade.direction === "BUY"
          ? Math.max(trade.highestPrice || trade.entryPrice, c.high)
          : (trade.highestPrice || trade.entryPrice);
        const newLowest = trade.direction === "SELL"
          ? Math.min(trade.lowestPrice || trade.entryPrice, c.low)
          : (trade.lowestPrice || trade.entryPrice);
        trade.highestPrice = newHighest;
        trade.lowestPrice = newLowest;
        updateStmt.run(roundedSl, newHighest, newLowest, trade.dbId, String(trade.metaOrderId));
      } catch (err: any) {
        const errMsg = err?.message || err?.toString() || "";
        if (errMsg.includes("Position not found") || errMsg.includes("Order not found") || errMsg.includes("Invalid position") || errMsg.includes("not found")) {
          logger.info(`[MageEngine] ℹ️ Position ${trade.metaOrderId} (${baseSymbol}) already closed on broker. Clearing from active state.`);
          if (typeof orch.onBrokerPositionClosed === "function") {
            orch.onBrokerPositionClosed(trade.metaOrderId);
          }
          if (state.activeTrade?.metaOrderId === trade.metaOrderId) {
            delete state.activeTrade;
          }
          if (state.activeTrades) {
            state.activeTrades = state.activeTrades.filter((t: any) => String(t.metaOrderId) !== String(trade.metaOrderId));
          }
          try {
            db.prepare("UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ? OR meta_order_id = ?").run(trade.dbId, String(trade.metaOrderId));
          } catch (_) {}
        } else {
          logger.error(`[DiscretionaryTrader] ⚠️ Failed to update MAGE 0.5R Trail for ${sessionPair}:`, err.message);
        }
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
    if (os && os.limitOrderId && (!state.activeTrades || !state.activeTrades.find(t => String(t.metaOrderId) === String(os.limitOrderId)))) {
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
        logger.info(`[DiscretionaryTrader] 🧹 MAGE cancelled pending limit order ${orderId} on ${baseSymbol} due to News Blackout: ${newsCheck.reason}.`);
      } catch (e) {
        logger.error(`[DiscretionaryTrader] Failed to cancel MAGE limit order on news:`, e);
      }
    }
  }
}

export { placeMageLimitOrder, runMageBot };

