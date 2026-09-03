import { PairConfigManager, SAGE_PAIR_CONFIG } from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG, getDynamicPipSize } from "../config/OptimizerPairConfig.js";
import { calculateDwcb } from "../../utils/DwcbCalculator.js";
import { enqueueMetaApiRequest as realQueue } from "../../utils/MetaApiQueue.js";
import { generateMagicNumber, isSageMagic } from "../../utils/magicNumber.js";
import { isNewsBlackout as realNews } from '../../news/newsStore.js';
import { isTradeAllowed, isEODSession, isRolloverCircuitBreaker, isToxicDay } from "../market/MathFilters.js";
import { HTFContextTracker } from "../market/HTFContextTracker.js";
import { globalTradeGate as realGate } from '../../utils/GlobalTradeGate.js';
import realDb, { addBotLog as realAddBotLog } from '../../core/db.js';
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
import { logger } from "../../utils/logger.js";


const db: any = new Proxy({}, {
  get(_target, prop) {
    const activeDb = (global as any).__SIM_DB__ || realDb;
    return activeDb[prop];
  }
});
const addBotLog = (...args: any[]) => (((global as any).__SIM_DB__ && typeof (global as any).__SIM_DB__.addBotLog === 'function') ? (global as any).__SIM_DB__.addBotLog : realAddBotLog)(...args);
const enqueueMetaApiRequest = (...args: any[]) => (global.__SIM_QUEUE__?.enqueueMetaApiRequest || realQueue)(...args);
const isNewsBlackout = (...args: any[]) => ((global as any).__SIM_NEWS__?.isNewsBlackout || realNews)(...args);
const globalTradeGate = (global as any).__SIM_TRADE_GATE__ || realGate;

const getSharedConnection = (...args: any[]) => ((global as any).__SIM_METAAPI__?.getSharedConnection || r1)(...args);
const getSharedAccount = (...args: any[]) => ((global as any).__SIM_METAAPI__?.getSharedAccount || r2)(...args);
const getSymbolSpec = (...args: any[]) => ((global as any).__SIM_METAAPI__?.getSymbolSpec || r3)(...args);
const safeDecryptAccountId = (...args: any[]) => ((global as any).__SIM_METAAPI__?.safeDecryptAccountId || r4)(...args);
const getBrokerSymbol = (...args: any[]) => ((global as any).__SIM_METAAPI__?.getBrokerSymbol || r5)(...args);
const clearSharedConnection = (...args: any[]) => ((global as any).__SIM_METAAPI__?.clearSharedConnection || r6)(...args);
const getLiveBrokerSpec = (...args: any[]) => ((global as any).__SIM_METAAPI__?.getLiveBrokerSpec || r7)(...args);
const quantizeLots = (...args: any[]) => ((global as any).__SIM_METAAPI__?.quantizeLots || r8)(...args);
const roundPrice = (...args: any[]) => ((global as any).__SIM_METAAPI__?.roundPrice || r9)(...args);
const isBrokerPriceOrStopsError = (...args: any[]) => ((global as any).__SIM_METAAPI__?.isBrokerPriceOrStopsError || r10)(...args);
const calculateStopsLevelSafePrices = (...args: any[]) => ((global as any).__SIM_METAAPI__?.calculateStopsLevelSafePrices || r11)(...args);

// ── Epsilon-aware floating-point comparison helpers (inline to respect engine air-gap rule) ──
const PRICE_EPSILON = 1e-9;
const gte = (a: number, b: number): boolean => (a - b) >= -PRICE_EPSILON;
const lte = (a: number, b: number): boolean => (b - a) >= -PRICE_EPSILON;

logger.info("[SAGE ENGINE TS LOADED!]");

function getFixedEstDate(date = new Date()) {
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

export async function runSageBot(orch, sessionPair, state, c) {

  if (!state) return;

  const sageConfigs = PairConfigManager.getSageConfigs(sessionPair);
  if (!sageConfigs || sageConfigs.length === 0) {
    return;
  }


  for (const config of sageConfigs) {
    const sig = config.signature || "default";
    await _runSageBotForConfig(orch, sessionPair, state, c, sig, config);
  }
}

export async function _runSageBotForConfig(orch: any, sessionPair: string, state: any, c: any, sig: string, config: any, botId: string = "sage") {
  const symbol = sessionPair;
    if (!state.sageStates) state.sageStates = {};
    const requiredSageProps = [
      "orbStartHour",
      "orbStartMin",
      "orbMinutes",
      "sweepPips",
      "forceCloseHours",
      "trailingSlTrigger",
      "trailingSlStep",
      "entryPenetrationPct",
      "exitMode",
      "minSlDist",
      "maxSlDist",
    ];
    for (const prop of requiredSageProps) {
      if ((config as any)[prop] === undefined) {
        throw new Error(
          `[STRICT MODE ERROR] Missing required attribute '${prop}' in Sage config for ${sessionPair}`,
        );
      }
    }

    if (!state.sageStates[sig]) {
      state.sageStates[sig] = {
        sessionHigh: -Infinity,
        sessionLow: Infinity,
        orHigh: 0,
        orLow: 0,
        orBuilt: false,
        wasBuildingORB: false,
        sessionActive: false,
        limitPrice: 0,
        slPrice: 0,
        tpPrice: 0,
        limitOrderId: null,
        fired: false,
        currentDateStr: "",
        direction: null,
      };
    }

    const estDateUTC = getFixedEstDate(new Date(c.timestamp));

    const estHour = estDateUTC.getUTCHours();
    const estMin = estDateUTC.getUTCMinutes();
    const yyyy = estDateUTC.getUTCFullYear();
    const mm = String(estDateUTC.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(estDateUTC.getUTCDate()).padStart(2, "0");
    const dateStr = yyyy + "-" + mm + "-" + dd;
    const ss = state.sageStates[sig];
    const currentMins = estHour * 60 + estMin;

    const startMins = config.orbStartHour! * 60 + config.orbStartMin!;

    const orDurationMins = config.orbMinutes!;
    const isBuildingORB = currentMins >= startMins && currentMins < startMins + orDurationMins;
    
    const is1700Reset = ss.lastEstHour !== undefined && ((ss.lastEstHour < 17 && estHour >= 17) || (ss.lastEstHour > estHour && estHour >= 17));
    const isAsiaSession = config.session === "asia" || (config.orbStartHour !== undefined && config.orbStartHour >= 18);
    const isMidnightExpiry = !isAsiaSession && ss.lastEstHour !== undefined && ss.lastEstHour > estHour && estHour < 17;
    const isStartMinsReset = isBuildingORB && !ss.wasBuildingORB;
    
    ss.wasBuildingORB = isBuildingORB;

    if (is1700Reset || isMidnightExpiry || isStartMinsReset) {
      // Cancel any dangling pending order from the previous session before resetting.
      if (ss.limitOrderId) {
        try {
          const conn = await getSharedConnection(orch.token, orch.accountId);
          await enqueueMetaApiRequest(
            async () => await conn.cancelOrder(ss.limitOrderId),
            `CancelStaleLimitSage:${sessionPair}`
          );
        } catch (_e) {
          /* ignore cancel errors after retries exhausted */
        }
      }
      ss.limitPrice = 0;
      ss.slPrice = 0;
      ss.tpPrice = 0;
      ss.limitOrderId = null;
      ss.fired_fill_check = false;
      ss.direction = null;
    }

    if (is1700Reset || isMidnightExpiry || isStartMinsReset) {
      ss.sessionHigh = -Infinity;
      ss.sessionLow = Infinity;
      ss.orBuilt = false;
      ss.sessionActive = false;
      ss.fired = false;
      
      // Reset the daily trade gate so new sessions can trade again.
      if (!state.sageTradeTakenToday) state.sageTradeTakenToday = {};
      state.sageTradeTakenToday[sig] = false;
      
      if (sessionPair.includes("GBPUSD")) {
         logger.info(`[SAGE SESSION RESET] GBPUSD at estHour=${estHour} lastEstHour=${ss.lastEstHour} timestamp=${c.timestamp}`);
      }
    }
    ss.lastEstHour = estHour;

    // Build or accumulate ORB during building window
    if (currentMins >= startMins && currentMins < startMins + orDurationMins) {
      ss.sessionHigh = Math.max(ss.sessionHigh, c.high);
      ss.sessionLow = Math.min(ss.sessionLow, c.low);
    }
    if (currentMins >= startMins + orDurationMins && !ss.orBuilt) {
      if (ss.sessionHigh === -Infinity && state.m5Buffer && state.m5Buffer.length > 0) {
        const windowStartMs = c.timestamp - (currentMins - startMins) * 60_000;
        const windowEndMs = windowStartMs + orDurationMins * 60_000;
        // FIX: Use strictly exclusive upper bound (<) to match Tier 1 SageMathCore which uses
        // mcMins < startMins + orbMinutes. M5 timestamps are candle-open times, so the candle
        // that opens exactly at windowEndMs is the FIRST candle AFTER the ORB, not part of it.
        const orbCandles = state.m5Buffer.filter((candle: any) => candle.timestamp >= windowStartMs && candle.timestamp < windowEndMs);
        if (orbCandles.length > 0) {
          let maxH = -Infinity;
          let minL = Infinity;
          for (const candle of orbCandles) {
            if (candle.high > maxH) maxH = candle.high;
            if (candle.low < minL) minL = candle.low;
          }
          ss.sessionHigh = maxH;
          ss.sessionLow = minL;
        }
      }
      if (ss.sessionHigh === -Infinity) {
        return; // Wait for historical M5 buffer to populate
      }
      ss.orBuilt = true;
      ss.currentOrbDateStr = dateStr;
      const loggerTag = "SageEngine";
      logger.info(`[${loggerTag}] ORB Built for ${sessionPair} at ${dateStr} (High: ${ss.sessionHigh.toFixed(5)}, Low: ${ss.sessionLow.toFixed(5)})`);
      orch.addEyeFeedEvent({
        type: "EVAL_RESULT",
        bot_id: botId,
        data: {
          symbol,
          decision: "SCANNING",
          setupType: "Liquidity Sweep",
          reasoning: `ORB Built (High: ${ss.sessionHigh.toFixed(5)}, Low: ${ss.sessionLow.toFixed(5)})`,
        },
      });
    }

    // Calculate session window up here so we can cancel before early returns!
    const endMins = startMins + orDurationMins + 4 * 60; // Match optimizer's dynamic 4-hour sweep window after ORB
    let isInsideSession = false;
    let actualEndMins = endMins % 1440;
    // Store on ss so cancel path has session window info
    ss.sessionEndMins = actualEndMins;
    ss.sessionStartMins = startMins;
    // FIX: use >= 1440 to handle midnight-boundary sessions (e.g. StartH20 + 4h = exactly 1440)
    ss.sessionOvernight = endMins >= 1440;
    if (ss.sessionOvernight) {
      isInsideSession = currentMins >= startMins || currentMins <= actualEndMins;
    } else {
      isInsideSession = currentMins >= startMins && currentMins <= endMins;
    }

    // PARITY: T2 discards unfilled limit orders once the session sweep window ends.
    // Without this, live could fill stale orders after session close on next M1 tick.
    if (!isInsideSession && ss.limitOrderId && !ss.fired_fill_check) {
      try {
        const conn = await getSharedConnection(orch.token, orch.accountId);
        const cancelPromise = enqueueMetaApiRequest(
          async () => await conn.cancelOrder(ss.limitOrderId),
          `CancelExpiredSageLimitOrder:${sessionPair}:${sig}`
        );
        if (orch.pendingPromises) orch.pendingPromises.push(cancelPromise);
      } catch (_e) { /* ignore cancel errors */ }
      ss.limitPrice = 0;
      ss.slPrice = 0;
      ss.tpPrice = 0;
      ss.limitOrderId = null;
      ss.fired_fill_check = false;
      ss.direction = null;
      if (!(global as any).testParitySuppressLogging) {
        logger.info(`[SageEngine] ${sessionPair} Cancelled stale limit order — session sweep window expired.`);
      }
    }

    // Check the daily trade gate AFTER the session reset so the reset can clear it.
    if (state.sageTradeTakenToday && state.sageTradeTakenToday[sig]) {
      return;
    }

    if (ss.fired || ss.limitOrderId || ss.isPlacing) {
      /* silently ignore to avoid spam */ return;
    }

    const baseSymbol = PairConfigManager.getBaseSymbol(sessionPair);
    const sessionName = config?.session || state.config?.session || "default";

    // ── CROSS-ACCOUNT SMART TRADE CATCH-UP ──
    const leadTrade = globalTradeGate.getActiveLeadTrade(botId.toUpperCase(), baseSymbol, sessionName, dateStr);
    if (
      leadTrade &&
      (!leadTrade.session || leadTrade.session === sessionName) &&
      leadTrade.leadProfileId !== orch.profileId &&
      !ss.fired &&
      !ss.limitOrderId &&
      (!state.activeTrades || !state.activeTrades.find((t: any) => t.clientId === sig))
    ) {
      const isBuy = leadTrade.direction === "BUY";
      const optCfg = PairConfigManager.getRepresentativeConfig(sessionPair);
      const pipSize = config?.pipSize || optCfg?.pipSize || getDynamicPipSize(baseSymbol);
      const currentPrice = c.close;
      const proximityThreshold = Math.max(2.5 * pipSize, (optCfg?.spread || 1) * 2.5 * pipSize, 0.10 * Math.abs(leadTrade.entryPrice - leadTrade.slPrice));
      
      const distFromLead = isBuy ? (currentPrice - leadTrade.entryPrice) : (leadTrade.entryPrice - currentPrice);
      const totalTpDist = Math.abs(leadTrade.tpPrice - leadTrade.entryPrice);
      const pctTowardsTp = distFromLead > 0 ? (distFromLead / (totalTpDist || 1)) : 0;
      const hitSl = isBuy ? (currentPrice <= leadTrade.slPrice) : (currentPrice >= leadTrade.slPrice);

      if (!hitSl && pctTowardsTp < 0.10 && distFromLead <= proximityThreshold) {
        logger.info(
          `[SageEngine][P#${orch.profileId}] 🔄 Cross-Account Smart Catch-Up triggered for ${baseSymbol} ${leadTrade.direction} (Lead from P#${leadTrade.leadProfileId} at ${leadTrade.entryPrice}, Live: ${currentPrice}, Slippage: ${(distFromLead / pipSize).toFixed(1)} pips)`,
        );
        ss.direction = leadTrade.direction;
        ss.limitPrice = leadTrade.entryPrice;
        ss.slPrice = leadTrade.slPrice;
        ss.tpPrice = leadTrade.tpPrice;
        ss.fired = true;
        placeSageLimitOrder(orch, sessionPair, state, config, sig, c, botId).catch((e) => {
          logger.error("[SageEngine CatchUp Error]", e);
        });
        return;
      }
    }

    // 🚫 Prop Firm Compliance: Rollover Circuit Breaker (16:55 to 17:05 EST) + Toxic Filters 🚫
    if (isRolloverCircuitBreaker(estHour, estMin)) {
      return;
    }
    if (
      !isTradeAllowed({
        pair: baseSymbol,
        setupType: "SAGE",
        timestamp: c.timestamp,
      })
    ) {
      return;
    }

    if (!ss.orBuilt || !isInsideSession) {
      return;
    }

    // 🚫 Prop Firm Compliance: Rollover Circuit Breaker (16:55 to 17:05 EST) + Toxic Filters 🚫
    if (isRolloverCircuitBreaker(estHour, estMin)) return;

    const m5Len = state.m5Buffer?.length ?? 0;
    const lastM5 = m5Len > 0 ? state.m5Buffer[m5Len - 1] : null;

    if (!lastM5) {
      return;
    }
    const actionEstDate = getFixedEstDate(new Date(lastM5.timestamp));
    const actionEstHour = actionEstDate.getUTCHours();
    const actionDow = actionEstDate.getUTCDay();
    if (config.toxicHours && config.toxicHours.includes(actionEstHour)) return;
    if (config.toxicDays && isToxicDay(actionDow, config.toxicDays)) return;

    ss.sessionActive = true;

  const pipSize = config.pipSize || state.config?.pipSize || getDynamicPipSize(baseSymbol);
  const sweepBuffer = config.sweepPips! * pipSize;
  const spreadPts = OPTIMIZER_CONFIG[baseSymbol.replace(".Daily", "")]?.spread * pipSize || 0;
  const isCrypto = baseSymbol.includes("BTC") || baseSymbol.includes("ETH");
  const isIndex =
    baseSymbol.includes("NAS") ||
    baseSymbol.includes("US30") ||
    baseSymbol.includes("GER40") ||
    baseSymbol.includes("XTIUSD") ||
    
    baseSymbol.includes("SPX500") ||
    baseSymbol.includes("JPN225");
  const isForex = !isCrypto && !isIndex;

  if (ss.lastEvaluatedM5Timestamp === lastM5.timestamp) {
    return;
  }

  const actionMinutes = config.actionMinutes || 5;
  const N = actionMinutes / 5;
  if (m5Len < N) {
    return;
  }

  ss.lastEvaluatedM5Timestamp = lastM5.timestamp;

  // Aggregate N M5 candles into actionCandle
  const startIndex = m5Len - N;
  let actionHigh = -Infinity;
  let actionLow = Infinity;
  for (let idx = startIndex; idx < m5Len; idx++) {
    const mc = state.m5Buffer[idx];
    if (mc.high > actionHigh) actionHigh = mc.high;
    if (mc.low < actionLow) actionLow = mc.low;
  }
  const actionCandle = {
    open: state.m5Buffer[startIndex].open,
    high: actionHigh,
    low: actionLow,
    close: lastM5.close,
    timestamp: lastM5.timestamp
  };

  // Evaluate the sweep using the CLOSED Action Candle to prevent look-ahead bias (Parity with MathBacktester)
  if ((global as any).__SIM_WARMUP__) return;
  const rSessionHigh = roundPrice(ss.sessionHigh, sessionPair);
  const rSessionLow = roundPrice(ss.sessionLow, sessionPair);

  const reqSweepHigh = isForex
    ? rSessionHigh + sweepBuffer
    : rSessionHigh + sweepBuffer + spreadPts;
  const reqSweepLow = isForex
    ? rSessionLow - sweepBuffer
    : rSessionLow - sweepBuffer;

  const sweepHighTriggered = gte(roundPrice(actionCandle.high, sessionPair), reqSweepHigh);
  const sweepLowTriggered = lte(roundPrice(actionCandle.low, sessionPair), reqSweepLow);

  // Log scanning activity for visibility on dev console
  logger.info(`[SageEngine] 🔍 Scanning ${sessionPair} [${new Date(actionCandle.timestamp).toISOString().substring(11, 16)} EST] | ` +
    `Candle [High/Low/Close]: [${actionCandle.high}/${actionCandle.low}/${actionCandle.close}] | ` +
    `ORB [High/Low]: [${rSessionHigh}/${rSessionLow}] | ` +
    `Target Sweep [High >= ${reqSweepHigh.toFixed(5)} / Low <= ${reqSweepLow.toFixed(5)}]`);

  if (sweepHighTriggered && sweepLowTriggered) {
    logger.info(`[SageEngine] 🛑 Double sweep detected on ${sessionPair} at ${new Date(actionCandle.timestamp).toISOString()} - Skipping per Parity Rule.`);
    return;
  }
  if (!sweepHighTriggered && !sweepLowTriggered) {
    return;
  }



  // Log sweep details whenever a potential sweep is triggered
  logger.info(`[SageEngine] 🔍 Evaluating Sweep for ${sessionPair} at ${new Date(actionCandle.timestamp).toISOString()}: ` +
    `ActionCandle [High/Low]: [${actionCandle.high}/${actionCandle.low}] | ` +
    `Required [High/Low]: [${reqSweepHigh}/${reqSweepLow}] | ` +
    `Session [High/Low]: [${ss.sessionHigh}/${ss.sessionLow}] | ` +
    `sweepHighTriggered: ${sweepHighTriggered}, sweepLowTriggered: ${sweepLowTriggered}`);

  let triggeredDir = null;
  if (sweepHighTriggered) triggeredDir = "SELL";
  else if (sweepLowTriggered) triggeredDir = "BUY";

  if (triggeredDir) {
    let validSweep = true;

    const reqSweepHigh = isForex
      ? rSessionHigh + sweepBuffer
      : rSessionHigh + sweepBuffer + spreadPts;
    const maxSweepMultiplier = config.maxSweepMultiplier ?? 2.0;
    const maxSweepBuffer = sweepBuffer * maxSweepMultiplier;

    if (triggeredDir === "BUY" && actionCandle.low < rSessionLow - maxSweepBuffer) {
      validSweep = false;
      logger.info(`[SageEngine] ${sessionPair} Rejected: Sweep Low (${actionCandle.low}) exceeded maxSweepBuffer.`);
    }
    if (triggeredDir === "SELL" && actionCandle.high > rSessionHigh + maxSweepBuffer) {
      validSweep = false;
      logger.info(`[SageEngine] ${sessionPair} Rejected: Sweep High (${actionCandle.high}) exceeded maxSweepBuffer.`);
    }

    if (config.requireCloseInside) {
      if (triggeredDir === "BUY" && actionCandle.close < rSessionLow) {
        validSweep = false;
        logger.info(`[SageEngine] ${sessionPair} Rejected: Candle close (${actionCandle.close}) not inside ORB Low (${rSessionLow}).`);
      }
      if (triggeredDir === "SELL" && actionCandle.close > rSessionHigh) {
        validSweep = false;
        logger.info(`[SageEngine] ${sessionPair} Rejected: Candle close (${actionCandle.close}) not inside ORB High (${rSessionHigh}).`);
      }
    }

    // WBR Filter: wickPips / bodyPips >= minWbr (Canonical Parity Rule — in sync with SageMathCore.ts)
    {
      const acOpen = actionCandle.open;
      const acClose = actionCandle.close;
      const bodyTop = Math.max(acOpen, acClose);
      const bodyBottom = Math.min(acOpen, acClose);
      const bodyPips = Math.max((bodyTop - bodyBottom) / pipSize, 0.1);
      const wickPips = triggeredDir === "SELL"
        ? (actionCandle.high - bodyTop) / pipSize
        : (bodyBottom - actionCandle.low) / pipSize;

      const minWbr = config.minWbr ?? 1.5;
      const wbr = wickPips / bodyPips;
      if (wbr < minWbr) {
        logger.info(`[SageEngine] ${sessionPair} Rejected: WBR (${wbr.toFixed(2)}) < ${minWbr}`);
        validSweep = false;
      }
    }

    // Close Location Half Filter: Rejection candle close must be in top half for BUY or bottom half for SELL
    if (config.requireCloseLocationHalf) {
      const candleRange = actionCandle.high - actionCandle.low;
      if (candleRange > 0) {
        const closePercentile = (actionCandle.close - actionCandle.low) / candleRange;
        if (triggeredDir === "SELL" && closePercentile > 0.50) {
          logger.info(`[SageEngine] ${sessionPair} Rejected: Close percentile (${closePercentile.toFixed(2)}) > 0.50 for SELL`);
          validSweep = false;
        }
        if (triggeredDir === "BUY" && closePercentile < 0.50) {
          logger.info(`[SageEngine] ${sessionPair} Rejected: Close percentile (${closePercentile.toFixed(2)}) < 0.50 for BUY`);
          validSweep = false;
        }
      }
    }

    // HTF Alignment & Parabolic SAR / EMA slope veto
    if (config.htfAlignmentRequired && state.m5Buffer && state.m5Buffer.length >= 24) {
      const htfData = HTFContextTracker.precomputeHTFData(state.m5Buffer);
      const m5Idx = state.m5Buffer.length - 1;
      const maxH1EmaSlope = config.maxH1EmaSlope ?? 20;
      if (HTFContextTracker.isTrendParabolicFast(htfData, m5Idx, triggeredDir, maxH1EmaSlope, pipSize)) {
        logger.info(`[SageEngine] ${sessionPair} Rejected: Parabolic trend momentum opposing ${triggeredDir}`);
        validSweep = false;
      }
      if (config.useHtfSarFilter && HTFContextTracker.isSarAcceleratingFast(htfData, m5Idx, triggeredDir)) {
        logger.info(`[SageEngine] ${sessionPair} Rejected: Parabolic SAR accelerating opposing ${triggeredDir}`);
        validSweep = false;
      }
    }

    // FIX: Round cBodyPips to 1 decimal to match Tier 1 SageMathCore which uses
    // parseFloat(toFixed(1)) when pre-baking cBodyPips. Raw float vs rounded can diverge at boundaries.
    if (config.maxBodyPips !== undefined) {
      const cBodyPips = parseFloat((Math.abs(actionCandle.close - actionCandle.open) / pipSize).toFixed(1));
      if (cBodyPips > config.maxBodyPips) {
        logger.info(`[SageEngine] ${sessionPair} Rejected: Candle body (${cBodyPips.toFixed(1)}) > maxBodyPips (${config.maxBodyPips}).`);
        orch.addEyeFeedEvent({
          type: "REJECT",
          bot_id: botId,
          data: {
            symbol: sessionPair,
            decision: "NO_TRADE",
            setupType: "Reversal Setup",
            reasoning: `Candle body (${cBodyPips.toFixed(1)} pips) > maxBodyPips (${config.maxBodyPips}).`,
          }
        });
        validSweep = false;
      }
    }

    // 🚫 PARITY: Mirror SageMathBacktester NFP/CPI/FOMC blackout windows in Tier 4 live engine.
    // Without this, live could fire trades at news events that Tier 2 mathematically blocked.
    {
      const m5EstDate = getFixedEstDate(new Date(actionCandle.timestamp));
      const m5EstHour = m5EstDate.getUTCHours();
      const m5EstMin = m5EstDate.getUTCMinutes();
      const m5DateStr = new Date(actionCandle.timestamp).toISOString().split("T")[0];
      
      const newsCheck = isNewsBlackout(baseSymbol, new Date(actionCandle.timestamp));
      if (
        isRolloverCircuitBreaker(m5EstHour, m5EstMin) ||
        newsCheck.blocked
      ) {
        logger.info(`[SageEngine] ${sessionPair} Rejected: News or Rollover blackout on ${m5DateStr}`);
        validSweep = false;
      }
    }

    if (!validSweep) {
      // PARITY FIX: Math Backtester DOES NOT lock the session if a sweep fails rejection filters.
      // It continues scanning the next M5 candles for a valid sweep.
      return;
    }

    const rHigh = roundPrice(ss.sessionHigh, sessionPair);
    const rLow = roundPrice(ss.sessionLow, sessionPair);
    const boxSize = roundPrice(Math.abs(rHigh - rLow), sessionPair);
    const entryPenetration = config.entryPenetrationPct! / 100.0;
    const slBuffer = 0; // Removed physical SL buffer for parity
    let limitPriceRaw =
      triggeredDir === "BUY"
        ? rLow + boxSize * entryPenetration
        : rHigh - boxSize * entryPenetration;
    const limitPrice = roundPrice(limitPriceRaw, symbol.split("_")[0]);
    logger.info(`[ENTRY_CALC] sessionHigh=${ss.sessionHigh}, sessionLow=${ss.sessionLow}, boxSize=${boxSize}, entryPenetration=${entryPenetration}, limitPrice=${limitPrice}`,);
    const proposedSl =
      triggeredDir === "BUY"
        ? rLow - sweepBuffer - slBuffer
        : rHigh + sweepBuffer + spreadPts + slBuffer;

    const slDistPips = Math.abs(limitPrice - proposedSl) / pipSize;
    let finalSl = proposedSl;
    if (config.minSlDist !== undefined && slDistPips < config.minSlDist) {
      finalSl =
        triggeredDir === "BUY"
          ? limitPrice - config.minSlDist * pipSize
          : limitPrice + config.minSlDist * pipSize;
    } else if (
      config.maxSlDist !== undefined &&
      slDistPips > config.maxSlDist
    ) {
      finalSl =
        triggeredDir === "BUY"
          ? limitPrice - config.maxSlDist * pipSize
          : limitPrice + config.maxSlDist * pipSize;
    }

    ss.direction = triggeredDir;
    ss.limitPrice = limitPrice;
    ss.slPrice = roundPrice(finalSl, symbol.split("_")[0]);

    const initialRisk = Math.abs(limitPrice - finalSl);
    if (config.exitMode === "MIDPOINT") {
      ss.tpPrice = roundPrice((ss.sessionHigh + ss.sessionLow) / 2.0, symbol.split("_")[0]);
    } else if (config.exitMode === "OPPOSITE_BOUNDARY") {
      ss.tpPrice = roundPrice(triggeredDir === "BUY" ? ss.sessionHigh : ss.sessionLow, symbol.split("_")[0]);
    } else if (config.exitMode === "ORB_EXTENSION") {
      const ext = boxSize * 2;
      ss.tpPrice = roundPrice(triggeredDir === "BUY" ? limitPrice + ext : limitPrice - ext, symbol.split("_")[0]);
    } else {
      ss.tpPrice = roundPrice(
        triggeredDir === "BUY"
          ? limitPrice + initialRisk * 50
          : limitPrice - initialRisk * 50, symbol.split("_")[0]);
    }
    ss.fired = true;
    if (!state.sageTradeTakenToday) state.sageTradeTakenToday = {};
    state.sageTradeTakenToday[sig] = true;

    logger.info(`[SageEngine] Sweep Triggered ${triggeredDir} on ${sessionPair}. Limit Price: ${limitPrice}`);
    await placeSageLimitOrder(orch, sessionPair, state, config, sig, c, botId);
  }
}

export async function placeSageLimitOrder(orch: any, sessionPair: string, state: any, config: any, sig: string, c: any, botId: string = "sage") {
  const symbol = sessionPair;
  const ss = state.sageStates[sig];
  if (!ss || !ss.fired || ss.limitOrderId) return;
  if (state.botConfigs && state.botConfigs.get(botId)?.enabled === false) {
    logger.info(`[DiscretionaryTrader] ⛔ Trade blocked — Pair ${sessionPair} is disabled for bot ${botId}`);
    return;
  }
  const baseSymbol = PairConfigManager.getBaseSymbol(sessionPair);
  const preRegKey = `PRE_${sig}`;
  const shortClientId = `SAGE_${orch.profileId}_${Date.now().toString(36)}`;
  if (!orch.sigMap) orch.sigMap = {};
  orch.sigMap[shortClientId] = sig;

  let orderRes: any = null;
  const newsCheck = isNewsBlackout(baseSymbol, new Date(c.timestamp));
  if (newsCheck.blocked) return;

  try {
    const profile = typeof orch.getProfileData === 'function' 
      ? await orch.getProfileData()
      : await db.prepare("SELECT t.risk_multiplier, COALESCE(t.metaapi_token, u.metaapi_token) as metaapi_token, t.metaapi_account_id, t.dwcb_enabled, t.dwcb_peak_balance, t.base_risk_balance, t.broker_symbol_map, t.institutional_enabled, t.institutional_daily_start_balance, t.institutional_daily_date, t.institutional_peak_balance FROM trading_profiles t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?").get(orch.profileId);
    if (!profile) {
      logger.info("[PLACE_LIMIT] no profile");
      return;
    }

    const cryptoModule: any = await import('../../core/crypto.js');
    const { isEncrypted, decrypt } = cryptoModule;
    const token = isEncrypted(profile.metaapi_token)
      ? decrypt(profile.metaapi_token)
      : profile.metaapi_token;
    const accId = safeDecryptAccountId(profile.metaapi_account_id);
    let customMap = null;
    try {
      if (profile.broker_symbol_map) customMap = JSON.parse(profile.broker_symbol_map);
    } catch(e) {}
    const brokerSymbol = await getBrokerSymbol(baseSymbol, customMap);
    // 🔍 Fetch live broker spec (pipValuePerLot, tickSize, volumeStep, etc.) — broker-agnostic
    const liveSpec = await getLiveBrokerSpec(brokerSymbol, token, accId);
    const sageCfg =
      config || state.config;
    // ⚠️ Use PairConfig pipSize OR SYMBOL_SPECS pipSize — NOT liveSpec.tickSize
    // (tickSize = 0.00001 for 5-decimal brokers, but pip size = 0.0001 — they are different!)
    const staticSpec = getSymbolSpec(brokerSymbol);
    const pipSize = sageCfg.pipSize || staticSpec.pipSize || 0.0001;

    const currentSpreadPips = state.spreadPts;
    const maxSpread = sageCfg.maxSpreadLimit;
    if (currentSpreadPips > maxSpread) {
      logger.info("[PLACE_LIMIT] spread too high");
      orch.addEyeFeedEvent({
        type: "REJECT",
        bot_id: botId,
        data: {
          symbol: sessionPair,
          decision: "NO_TRADE",
          setupType: "Reversal Setup",
          reasoning: `Spread (${currentSpreadPips.toFixed(1)} pips) > maxSpreadLimit (${maxSpread}).`,
        }
      });
      return;
    }

    if (!(global as any).__SIM_MOCK_ACCOUNT__ && (!orch.cachedEquity || orch.cachedEquity <= 0)) {
      try {
        const conn = await getSharedConnection(token, accId);
        const accInfo = await conn.getAccountInformation();
        if (accInfo && accInfo.equity > 0) {
          orch.cachedEquity = accInfo.equity;
          console.log(`[SageEngine] 🔄 Emergency live fetch account equity: $${orch.cachedEquity.toFixed(2)}`);
        }
      } catch (e: any) {}
    }

    if (!(global as any).__SIM_MOCK_ACCOUNT__ && (!orch.cachedEquity || orch.cachedEquity <= 0)) {
      logger.warn(`[SageEngine] ⚠️ Cached equity is 0 or missing. Aborting trade to prevent DWCB corruption.`);
      return;
    }
    const effectiveBalance = (global as any).__SIM_MOCK_ACCOUNT__
      ? (orch.cachedEquity || state.equity || 1e5)
      : orch.cachedEquity;
    const sageProfile = profile;
    const { dwcbMultiplier } = await calculateDwcb(
      orch.profileId,
      sageProfile.dwcb_enabled,
      sageProfile.dwcb_peak_balance,
      effectiveBalance,
    );

    // Institutional Drawdowns
    let institutionalMultiplier = 1.0;
    if (sageProfile && sageProfile.institutional_enabled === 1) {
      const dailyCapPct = sageProfile.institutional_daily_cap ? sageProfile.institutional_daily_cap / 100 : 0.025;
      const peakToDrawPct = sageProfile.institutional_peak_to_draw ? sageProfile.institutional_peak_to_draw / 100 : 0.055;

      const estDate = getFixedEstDate(new Date(c.timestamp));
      const tradingDayDate = new Date(estDate.getTime() + 7 * 60 * 60 * 1000);
      const brokerTradingDayStr = tradingDayDate.toISOString().split('T')[0];
      
      // Absolute Drawdown Limit & Peak Update
      let currentInstPeak = sageProfile.institutional_peak_balance;
      if (!currentInstPeak || effectiveBalance > currentInstPeak) {
        currentInstPeak = effectiveBalance;
        await db.prepare("UPDATE trading_profiles SET institutional_peak_balance = ? WHERE id = ?").run(currentInstPeak, orch.profileId);
      } else {
        const absDrawdown = (currentInstPeak - effectiveBalance) / currentInstPeak;
        if (absDrawdown >= peakToDrawPct) {
          logger.error(`[DiscretionaryTrader] 🛑 Institutional halt: ${(peakToDrawPct * 100).toFixed(1)}% Absolute Drawdown Reached on Sage for ${sessionPair}. Trade aborted.`);
          orch.addEyeFeedEvent({
            type: "REJECT",
            bot_id: botId,
            data: {
              symbol: sessionPair,
              decision: "NO_TRADE",
              setupType: "Reversal Setup",
              reasoning: `Institutional halt: ${(peakToDrawPct * 100).toFixed(1)}% Absolute Drawdown Reached.`,
            }
          });
          return;
        }

        // 🛡️ Dynamic Trailing Proximity Scaling (Adaptive Drawdown De-risking)
        const rho = absDrawdown / peakToDrawPct; // 0.0 at peak -> 1.0 at limit
        if (rho >= 0.85) {
          institutionalMultiplier = 0.15;
          logger.warn(`[SageEngine] ⚠️ Institutional Proximity Scaling: Drawdown is ${(rho * 100).toFixed(1)}% of max trailing limit on ${sessionPair}. Contracting risk to 15%.`);
        } else if (rho >= 0.70) {
          institutionalMultiplier = 0.30;
          logger.warn(`[SageEngine] ⚠️ Institutional Proximity Scaling: Drawdown is ${(rho * 100).toFixed(1)}% of max trailing limit on ${sessionPair}. Contracting risk to 30%.`);
        } else if (rho >= 0.50) {
          institutionalMultiplier = 0.50;
          logger.warn(`[SageEngine] ⚠️ Institutional Proximity Scaling: Drawdown is ${(rho * 100).toFixed(1)}% of max trailing limit on ${sessionPair}. Contracting risk to 50%.`);
        }
      }

      // Daily Loss Limit
      let dailyStartBal = sageProfile.institutional_daily_start_balance;
      let dailyDate = sageProfile.institutional_daily_date;
      if (dailyDate !== brokerTradingDayStr || !dailyStartBal) {
        dailyStartBal = effectiveBalance;
        dailyDate = brokerTradingDayStr;
        await db.prepare("UPDATE trading_profiles SET institutional_daily_start_balance = ?, institutional_daily_date = ? WHERE id = ?").run(dailyStartBal, dailyDate, orch.profileId);
      } else {
        const dailyDrawdown = (dailyStartBal - effectiveBalance) / dailyStartBal;
        if (dailyDrawdown >= dailyCapPct) {
          logger.error(`[DiscretionaryTrader] 🛑 Institutional halt: ${(dailyCapPct * 100).toFixed(1)}% Daily Loss Limit Reached on Sage for ${sessionPair}. Trade aborted.`);
          orch.addEyeFeedEvent({
            type: "REJECT",
            bot_id: botId,
            data: {
              symbol: sessionPair,
              decision: "NO_TRADE",
              setupType: "Reversal Setup",
              reasoning: `Institutional halt: ${(dailyCapPct * 100).toFixed(1)}% Daily Loss Limit Reached.`,
            }
          });
          return;
        }
      }
    }

    if (
      sageProfile &&
      sageProfile.dwcb_enabled === 1 &&
      dwcbMultiplier <= 0
    )
      return;

    // DYNAMIC MONTE CARLO RISK SIZING
    const baseMonteCarloRisk = sageCfg.riskPct !== undefined ? sageCfg.riskPct : 0.01;
    const userRiskDial = state.botConfigs.get(botId)?.risk ?? state.riskPct ?? 1;
    
    let sageRisk = baseMonteCarloRisk * userRiskDial * (profile.risk_multiplier || 1);
    if (sageRisk > 0.50 && baseMonteCarloRisk <= 1.0) sageRisk = 0.50;
    else if (sageRisk > 50 && baseMonteCarloRisk > 1.0) sageRisk = 50;

    // Base Risk: use fixed user-defined balance if set, otherwise fall back to live equity (compounding)
    const riskBasis =
      sageProfile?.base_risk_balance > 0
        ? sageProfile.base_risk_balance
        : effectiveBalance;
    const riskFraction = sageRisk / 100;
    const riskAmountUsd = riskBasis * riskFraction * dwcbMultiplier * institutionalMultiplier;

    const slDistPips = Math.abs(ss.limitPrice - ss.slPrice) / pipSize;
    if (slDistPips <= 0) {
      logger.error(`[PLACE_LIMIT] ❌ SL distance is ${slDistPips} pips. Aborting to prevent infinite lot size.`,);
      return;
    }

    // 🟢 Broker-agnostic lot calculation: riskAmount / (slPips * pipValuePerLot)
    const rawLots = riskAmountUsd / (slDistPips * liveSpec.pipValuePerLot);
    const lots = quantizeLots(
      rawLots,
      liveSpec.volumeStep,
      liveSpec.minVolume,
      liveSpec.maxVolume,
    );

    const clientId = sig;
    const magic = generateMagicNumber('SAGE', sig);

    const sessionName = sageCfg?.session || state.config?.session || "default";
    const dateStr = new Date(c.timestamp).toISOString().split("T")[0];
    const consensusCheck = globalTradeGate.checkSessionDirection(
      botId,
      baseSymbol,
      sessionName,
      dateStr,
      ss.direction,
    );
    if (!consensusCheck.approved) {
      logger.info(`[SageEngine] 🛡️ ${consensusCheck.reason}`);
      return;
    }

    const check = globalTradeGate.canTrade(
      orch.profileId,
      symbol,
      ss.direction,
      "ALGO",
    );
    if (!check.approved) {
      logger.info(`[DiscretionaryTrader] ⛔ Global Trade Gate blocked Sage on ${symbol}: ${check.reason}`);
      return;
    }

    globalTradeGate.register(orch.profileId, preRegKey, symbol, ss.direction, "ALGO");

    // 🔒 SYNCHRONOUS IN-FLIGHT MUTEX: Immediately lock this configuration state synchronously
    // so any fast-arriving ticks during the async broker queue wait cannot duplicate-fire.
    ss.fired = true;
    if (!state.sageTradeTakenToday) state.sageTradeTakenToday = {};
    state.sageTradeTakenToday[sig] = true;
    ss.isPlacing = true;

    const conn = await getSharedConnection(token, accId);
    
    // Fallback timer
    const attemptStart = Date.now();
    // Round all prices to exact broker decimal precision (SYMBOL_SPECS.digits)
    // This prevents hard 'Validation failed' rejections on BTCUSD (2dp), XAUUSD (2dp), etc.
    const pEntry = roundPrice(ss.limitPrice, brokerSymbol);
    const pSl = roundPrice(ss.slPrice, brokerSymbol);
    const pTp = roundPrice(ss.tpPrice, brokerSymbol);

    const penetrationPct = sageCfg.entryPenetrationPct ?? 0;
    const optCfg = PairConfigManager.getRepresentativeConfig(symbol);
    const proximityThreshold = Math.max(2.5 * pipSize, (optCfg?.spread || 1) * 2.5 * pipSize, 0.10 * Math.abs(pEntry - pSl));
    const distFromEntry = ss.direction === "BUY" ? (c.close - pEntry) : (pEntry - c.close);
    const isWithinProximity = Math.abs(distFromEntry) <= proximityThreshold || (ss.direction === "BUY" ? c.close <= pEntry : c.close >= pEntry);

    const executeAsMarket = penetrationPct === 0 || isWithinProximity;

    let orderRes: any;
    let placingDbId = 0;
    try {
      const tp = await db.prepare("SELECT user_id FROM trading_profiles WHERE id = ?").get(orch.profileId);
      const actualUserId = tp ? tp.user_id : 0;
      const insertRun = await db.prepare(`
        INSERT INTO bot_trade_states
          (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, original_sl, tp_price,
           lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, initial_risk_pips, status, client_id, manages_own_trailing)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, 'PLACING', ?, 1)
      `).run(
        actualUserId, orch.profileId, botId.toUpperCase(), brokerSymbol, ss.direction,
        pEntry, pSl, pSl, pTp, lots, Date.now(),
        pEntry, pEntry, Math.abs(pEntry - pSl) / (sageCfg.pipSize || getDynamicPipSize(symbol.split("_")[0])), shortClientId
      );
      if (insertRun && insertRun.lastInsertRowid) {
        placingDbId = Number(insertRun.lastInsertRowid);
      }
    } catch (dbErr: any) {
      logger.error(`[SageEngine] Failed to insert PLACING state for ${brokerSymbol}: ${dbErr.message}`);
    }

    try {
      if (executeAsMarket) {
        const isBuy = ss.direction === "BUY";
        const latestPrice = roundPrice(c.close, brokerSymbol);
        const hitSl = isBuy ? (latestPrice <= pSl) : (latestPrice >= pSl);
        const hitTp = isBuy ? (latestPrice >= pTp) : (latestPrice <= pTp);
        if (hitSl || hitTp) {
          logger.info(`[SageEngine] 🛑 Direct Market Order Aborted: Live price (${latestPrice}) already hit ${hitSl ? 'Stop Loss' : 'Take Profit'}!`);
          globalTradeGate.release(orch.profileId, preRegKey);
          return;
        }

        const staticSpec = getSymbolSpec(brokerSymbol);
        const stopsLevelPts = liveSpec?.stopsLevel || (staticSpec as any).stopsLevel || 0;
        const safePrices = calculateStopsLevelSafePrices(
          ss.direction as "BUY" | "SELL",
          latestPrice,
          pSl,
          pTp,
          stopsLevelPts,
          liveSpec?.tickSize || staticSpec.tickSize || 0.00001,
          liveSpec?.digits ?? staticSpec.digits ?? 5
        );
        const roundedSafeSl = roundPrice(safePrices.pSl, brokerSymbol);
        const roundedSafeTp = roundPrice(safePrices.pTp, brokerSymbol);

        logger.info(`[SageEngine] ⚡ Executing direct MARKET ${ss.direction} on ${brokerSymbol} (Proximity: ${(distFromEntry / pipSize).toFixed(1)} pips <= ${(proximityThreshold / pipSize).toFixed(1)} threshold, Target: ${pEntry}, Live: ${latestPrice}, SL: ${roundedSafeSl}, TP: ${roundedSafeTp})`);
        orderRes = await enqueueMetaApiRequest(
          async () =>
            isBuy
              ? conn.createMarketBuyOrder(
                  brokerSymbol,
                  lots,
                  roundedSafeSl,
                  roundedSafeTp || undefined,
                  { magic, clientId: shortClientId },
                )
              : conn.createMarketSellOrder(
                  brokerSymbol,
                  lots,
                  roundedSafeSl,
                  roundedSafeTp || undefined,
                  { magic, clientId: shortClientId },
                ),
          `CreateSageMarketOrder:${brokerSymbol}`,
        );
      } else {
        orderRes = await enqueueMetaApiRequest(
          async () =>
            ss.direction === "BUY"
              ? conn.createLimitBuyOrder(
                  brokerSymbol,
                  lots,
                  pEntry,
                  pSl,
                  pTp || undefined,
                  { magic, clientId: shortClientId },
                )
              : conn.createLimitSellOrder(
                  brokerSymbol,
                  lots,
                  pEntry,
                  pSl,
                  pTp || undefined,
                  { magic, clientId: shortClientId },
                ),
          `CreateSageLimitOrder:${brokerSymbol}`,
        );
      }
    } catch (err: any) {
      if (isBrokerPriceOrStopsError(err)) {
        logger.info(`[SageEngine] ⚠️ Broker rejected limit order on ${brokerSymbol} (${err.message}). Executing Smart Market Fallback...`);

        const elapsed = Date.now() - attemptStart;
        if (elapsed > 2500) {
          logger.info(`[SageEngine] 🛑 Smart Market Fallback Aborted: Broker took ${elapsed}ms to reject, market may have moved.`);
          globalTradeGate.release(orch.profileId, preRegKey);
          return;
        }

        const isBuy = ss.direction === "BUY";
        const latestPrice = roundPrice(c.close, brokerSymbol);
        const hitSl = isBuy ? (latestPrice <= pSl) : (latestPrice >= pSl);
        const hitTp = isBuy ? (latestPrice >= pTp) : (latestPrice <= pTp);
        if (hitSl || hitTp) {
          logger.info(`[SageEngine] 🛑 Smart Market Fallback Aborted: Live price already hit ${hitSl ? 'Stop Loss' : 'Take Profit'}!`);
          globalTradeGate.release(orch.profileId, preRegKey);
          return;
        }

        const totalDist = Math.abs(pTp - pEntry);
        const currentDist = isBuy ? (latestPrice - pEntry) : (pEntry - latestPrice);
        const pctTowardsTp = currentDist / totalDist;

        if (pctTowardsTp >= 0.10) {
          logger.info(`[SageEngine] 🛑 Smart Market Fallback Aborted: Live price slipped ${Math.round(pctTowardsTp * 100)}% towards TP (Threshold: 10%)`);
          globalTradeGate.release(orch.profileId, preRegKey);
          return;
        }

        const staticSpec = getSymbolSpec(brokerSymbol);
        const stopsLevelPts = liveSpec?.stopsLevel || (staticSpec as any).stopsLevel || 0;
        const safePrices = calculateStopsLevelSafePrices(
          ss.direction as "BUY" | "SELL",
          latestPrice,
          pSl,
          pTp,
          stopsLevelPts,
          liveSpec?.tickSize || staticSpec.tickSize || 0.00001,
          liveSpec?.digits ?? staticSpec.digits ?? 5
        );
        const roundedSafeSl = roundPrice(safePrices.pSl, brokerSymbol);
        const roundedSafeTp = roundPrice(safePrices.pTp, brokerSymbol);
        logger.info(`[SageEngine] 🛡️ Smart Market Fallback Prices: Entry=${latestPrice}, SL=${roundedSafeSl}, TP=${roundedSafeTp} (stopsLevel=${stopsLevelPts}pts)`);
        orderRes = isBuy
          ? await conn.createMarketBuyOrder(brokerSymbol, lots, roundedSafeSl, roundedSafeTp || undefined, { magic, clientId: shortClientId })
          : await conn.createMarketSellOrder(brokerSymbol, lots, roundedSafeSl, roundedSafeTp || undefined, { magic, clientId: shortClientId });
      } else {
        globalTradeGate.release(orch.profileId, preRegKey);
        throw err;
      }
    }

    if (orderRes && orderRes.orderId) {
      ss.isPlacing = false;
      ss.limitOrderId = executeAsMarket ? null : orderRes.orderId;
      
      if (!executeAsMarket && orderRes && orderRes.orderId) {
        try {
          await db.prepare(`
            UPDATE bot_trade_states 
            SET meta_order_id = ? 
            WHERE client_id = ? AND status = 'PLACING'
          `).run(orderRes.orderId, shortClientId);
        } catch (e: any) {
          logger.error(`[SageEngine] Failed to update meta_order_id for limit order: ${e.message}`);
        }
      }

      ss.fired = true;
      globalTradeGate.release(orch.profileId, preRegKey);
      globalTradeGate.register(
        orch.profileId,
        orderRes.orderId,
        symbol,
        ss.direction,
        "ALGO",
      );

      // Immediate Trailing & Active Trade Attachment for Direct Market Orders
      if (executeAsMarket) {
        const openPrice = c.close;
        const openTimeMs = c.timestamp || Date.now();
        try {
          const updateRes = await db.prepare(`
            UPDATE bot_trade_states 
            SET status = 'OPEN', meta_order_id = ?, entry_price = ?, sl_price = ?, tp_price = ?, lots = ?
            WHERE (client_id = ? OR meta_order_id = ?) AND status = 'PLACING'
            RETURNING id
          `).all(orderRes.orderId, openPrice, pSl, pTp, lots, shortClientId, orderRes.orderId);
          if (updateRes && updateRes.length > 0 && updateRes[0].id) {
            placingDbId = Number(updateRes[0].id);
          }
        } catch (e: any) {}

        if (!state.activeTrades) state.activeTrades = [];
        const newTradeRec = {
          dbId: placingDbId,
          metaOrderId: orderRes.orderId,
          clientId: sig,
          magic: magic,
          botId: botId.toUpperCase(),
          direction: ss.direction,
          entryPrice: openPrice,
          intendedEntryPrice: pEntry,
          entrySlippage: ss.direction === "BUY" ? (openPrice - pEntry) : (pEntry - openPrice),
          slPrice: pSl,
          originalSl: pSl,
          tpPrice: pTp,
          riskPips: Math.abs(openPrice - pSl) / pipSize,
          highestPrice: openPrice,
          lowestPrice: openPrice,
          isTrailing: false,
          volume: lots,
          hasTakenPartial: false,
          openTime: openTimeMs,
        };
        if (!state.activeTrades.some((t: any) => t.metaOrderId === orderRes.orderId)) {
          state.activeTrades.push(newTradeRec);
        }
        if (!state.activeTrade) state.activeTrade = newTradeRec;
        logger.info(`[SageEngine] ⚡ Market Order OPEN & Attached for Trailing on ${brokerSymbol} at ${openPrice}`);
      }

      // Register Canonical Session Direction in GlobalTradeGate
      globalTradeGate.registerSessionDirection({
        botId: botId.toUpperCase(),
        symbol: baseSymbol,
        session: sessionName,
        dateStr,
        direction: ss.direction,
        entryPrice: pEntry,
        slPrice: pSl,
        tpPrice: pTp,
        timestamp: Date.now(),
        sig,
        leadProfileId: orch.profileId,
      });

      logger.info(`[DiscretionaryTrader] Sage placed ${executeAsMarket ? 'MARKET' : 'LIMIT'} ${ss.direction} for ${baseSymbol} at ${ss.limitPrice}. OrderId: ${ss.limitOrderId}`);
      const summary = `Sage ${executeAsMarket ? 'Market' : 'Limit'} Placed: ${ss.direction} ${baseSymbol}\nEntry: ${ss.limitPrice}\nSL: ${ss.slPrice}\nTP: ${ss.tpPrice}\nVol: ${lots}\nRisk: ${sageRisk.toFixed(2)}%`;
      addBotLog(orch.profileId, botId, brokerSymbol, "TRADE_ENTERED", summary);
    } else {
      ss.fired = false;
      if (state.sageTradeTakenToday) state.sageTradeTakenToday[sig] = false;
      ss.isPlacing = false;
      globalTradeGate.release(orch.profileId, preRegKey);
      db.prepare("UPDATE bot_trade_states SET status = 'FAILED' WHERE client_id = ? AND status = 'PLACING'").run(shortClientId).catch(() => {});
      logger.error(`[PLACE_LIMIT] FAILED order placement: ${JSON.stringify(orderRes)}`);
      addBotLog(orch.profileId, botId, baseSymbol, "ERROR", `Failed to place limit: ${JSON.stringify(orderRes)}`);
    }
  } catch (err: any) {
    ss.fired = false;
    if (state.sageTradeTakenToday) state.sageTradeTakenToday[sig] = false;
    ss.isPlacing = false;
    globalTradeGate.release(orch.profileId, preRegKey);
    db.prepare("UPDATE bot_trade_states SET status = 'FAILED' WHERE client_id = ? AND status = 'PLACING'").run(shortClientId).catch(() => {});
    logger.error(`[PLACE_LIMIT] ERROR:`, err);
    addBotLog(orch.profileId, botId, baseSymbol, "ERROR", `Error in place stop: ${err.message}`);
  }
}



export async function evaluateSageTrailingOnTick(
  orch: any,
  sessionPair: string,
  state: any,
  tick: any,
  targetBotId: string = "SAGE"
) {
  // SAGE PENDING ORDER SWEEP GUARD
  if (state.sageStates) {
    for (const sig of Object.keys(state.sageStates)) {
      const ss = state.sageStates[sig];
      if (ss && ss.limitOrderId && (!state.activeTrades || !state.activeTrades.find((t: any) => t.clientId === sig || t.metaOrderId === ss.limitOrderId))) {
        let tpSwept = false;
        let slSwept = false;
        const c = tick; // Tick object acts as M1 candle in TickFeed

        // TP Sweep using extremes
        if (ss.direction === "SELL" && c.low <= ss.tpPrice) tpSwept = true;
        else if (ss.direction === "BUY" && c.high >= ss.tpPrice) tpSwept = true;

        // SL Sweep using live ticks (c.close)
        if (ss.direction === "SELL" && c.close >= ss.slPrice) slSwept = true;
        else if (ss.direction === "BUY" && c.close <= ss.slPrice) slSwept = true;

        // PARITY FIX: Do NOT cancel if the limit price was also touched on the same candle.
        // In that case checkSageLimitFill will handle the fill (and TP/SL exit on same candle).
        // SageMathCore fills then exits in the same M1 bar — cancelling here breaks parity.
        if (tpSwept || slSwept) {
          const limitAlsoTouched = ss.limitPrice !== undefined && (
            (ss.direction === "SELL" && c.high >= ss.limitPrice) ||
            (ss.direction === "BUY"  && c.low  <= ss.limitPrice)
          );
          if (limitAlsoTouched) {
            // Let checkSageLimitFill process the fill on this candle instead
            tpSwept = false;
            slSwept = false;
          }
        }

        if (tpSwept || slSwept) {
          try {
            const conn = await getSharedConnection(orch.profileId);
            const cancelPromise = enqueueMetaApiRequest(
              async () => await conn.cancelOrder(ss.limitOrderId),
              `CancelSweptSageLimitOrder:${sessionPair}:${sig}`
            );
            if (orch.pendingPromises) orch.pendingPromises.push(cancelPromise);
          } catch (_e) { /* ignore cancel errors */ }
          ss.limitOrderId = null;
          ss.fired = true;
          if (!(global as any).testParitySuppressLogging) {
            logger.info(`[SageEngine] ${sessionPair} Cancelled pending limit order — ${tpSwept ? 'TP' : 'SL'} boundary swept before fill.`);
          }
        }
      }
    }
  }

  if (!state.activeTrades || state.activeTrades.length === 0) return;
  for (const trade of state.activeTrades) {
    const tBotId = trade.botId?.toUpperCase() || "";
    const baseSymbol = PairConfigManager.getBaseSymbol(sessionPair);
    const sageConfigs = PairConfigManager.getSageConfigs(sessionPair);
    const mageConfigs = PairConfigManager.getMageConfigs(sessionPair);
    const isSagePairOnly = sageConfigs.length > 0 && mageConfigs.length === 0;

    if (tBotId !== targetBotId.toUpperCase() && !isSagePairOnly) continue;

    const cid = trade.clientId || "";
    const botId = trade.botId || "";

    // Layer 1: Deterministic magic number (bot + config identity encoded at order placement)
    let config = trade.magic
      ? sageConfigs.find(c => generateMagicNumber("SAGE", c.signature!) === trade.magic)
      : undefined;

    // Layer 2: Exact clientId or signature match
    if (!config && cid) {
      config = sageConfigs.find(c => c.signature === cid || cid.startsWith(c.signature!) || cid.includes(c.signature!));
    }

    // Layer 3: BotId match
    if (!config && botId) {
      config = sageConfigs.find(c => c.signature === botId || botId.includes(c.signature!));
    }

    // Layer 4: Safe fallback to state.config
    if (!config) config = state.config;
    if (!config) continue;

    const currentTime = tick.timestamp || Date.now();
    const openTime = Number.isFinite(Number(trade.openTime)) ? Number(trade.openTime) : (trade.openTime ? new Date(trade.openTime).getTime() : 0);
    const fcHours = config.forceCloseHours;

    const estDateUTC = getFixedEstDate(new Date(currentTime));

    const isCrypto = baseSymbol.includes("BTC") || baseSymbol.includes("ETH");
    const isEOD =
      !isCrypto &&
      config.session !== "asia" &&
      (isEODSession(estDateUTC.getUTCHours(), estDateUTC.getUTCMinutes()) || isRolloverCircuitBreaker(estDateUTC.getUTCHours(), estDateUTC.getUTCMinutes()));

    const newsCheck = isNewsBlackout(baseSymbol, new Date(currentTime));
    const isNewsForceClose = newsCheck.blocked;

    if (
      openTime &&
      ((fcHours !== undefined && currentTime - openTime >= fcHours * 60 * 60 * 1e3) || isEOD || isNewsForceClose)
    ) {
      const closeReason = `Sage EOD/Timeout Close (${fcHours}h max duration reached).`;

      logger.info(`[DiscretionaryTrader] ⛔ SAGE M1 Force Close (${fcHours}h) for ${baseSymbol}.`,);
      try {
        await enqueueMetaApiRequest(
          async () =>
            (await getSharedConnection(orch.token, orch.accountId)).closePosition(
              trade.metaOrderId,
            ),
          `ClosePos:${baseSymbol}`,
        );
        await db
          .prepare("UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ?")
          .run(trade.dbId);

        orch.addEyeFeedEvent({
          type: "FORCE_CLOSE",
          symbol: baseSymbol,
          bot_id: targetBotId,
          data: {
            decision: "CLOSE",
            setupType: "Reversal Sweep",
            reasoning: closeReason
          }
        });
       if (state.activeTrades) {
        state.activeTrades = state.activeTrades.filter((t: any) => String(t.metaOrderId) !== String(trade.metaOrderId));
      }  // Clear sageState so the next session starts fresh.
        // If we don't do this, ss.limitOrderId persists and blocks new signals on every subsequent tick.
        if (state.sageStates && state.sageStates[trade.clientId]) {
          state.sageStates[trade.clientId].limitOrderId = null;
        }
        continue;
      } catch (e) {
        logger.error(`[DiscretionaryTrader] Failed to force close Sage position for ${baseSymbol}:`,
          e,);
        continue;
      }
    }
    // --- M1 TRAILING STOP MATH ---
    const pipSize2 = config.pipSize || state.config?.pipSize || getDynamicPipSize(baseSymbol);
    const isBuy = trade.direction === "BUY";
    const brokerDigits = getSymbolSpec(baseSymbol).digits ?? 5;
    if (!trade.originalSl) trade.originalSl = trade.slPrice;
    if (!trade.riskPips) trade.riskPips = Math.abs(trade.entryPrice - trade.originalSl) / pipSize2;
    const actualRisk = Math.abs(trade.entryPrice - trade.originalSl);
    const originalSl = trade.originalSl;
    const riskPips = trade.riskPips;
    const optCfg = OPTIMIZER_CONFIG[baseSymbol.replace(".Daily", "")];
    const spreadPts = (optCfg?.spread || 0) * pipSize2;
    const peakHigh = Math.max(trade.highestPrice || trade.entryPrice, tick.high);
    const peakLow = Math.min(trade.lowestPrice || trade.entryPrice, tick.low);
    trade.highestPrice = peakHigh;
    trade.lowestPrice = peakLow;
    const highestReached = isBuy ? peakHigh : peakLow + spreadPts;
    
    const tTrig = config.trailingSlTrigger!;
    const tStep = config.trailingSlStep!;
    const exitMode = config.exitMode;

    const intendedEntry = trade.intendedEntryPrice !== undefined ? trade.intendedEntryPrice : trade.entryPrice;
    const intendedRisk = Math.abs(intendedEntry - originalSl);

    const actualR = isBuy
      ? (highestReached - trade.entryPrice) / (actualRisk > 0 ? actualRisk : pipSize2)
      : (trade.entryPrice - highestReached) / (actualRisk > 0 ? actualRisk : pipSize2);

    const theoreticalR = isBuy
      ? (highestReached - intendedEntry) / (intendedRisk > 0 ? intendedRisk : actualRisk)
      : (intendedEntry - highestReached) / (intendedRisk > 0 ? intendedRisk : actualRisk);

    const currentR = Math.max(actualR, theoreticalR);

    const clog = (global as any).__ORIGINAL_LOG__ || console.log;
    const botLabel = trade.botId === "discretionary_trader" ? "MANUAL" : "SAGE";
    clog(`📈 Trailing Eval (${botLabel}) ${baseSymbol}: FloatingR=${currentR >= 0 ? "+" : ""}${currentR.toFixed(2)}R | BreakEvenTrigger=${tTrig}R | Step=${tStep}R | CurrentSL=${trade.slPrice} | Entry=${trade.entryPrice}`);

    const isTrailingEnabled = exitMode === "TRAILING" || exitMode === "MIDPOINT" || exitMode === "OPPOSITE_BOUNDARY" || exitMode === "ADTEL" || exitMode === undefined || (tTrig !== undefined && tTrig > 0);
    if (isTrailingEnabled) {
      if (tTrig !== undefined && tStep !== undefined) {
        let sageShouldUpdate = false;
        let sageNewSl = trade.slPrice;

        if (isBuy) {
          if (tTrig !== undefined && tTrig > 0 && gte(currentR, tTrig) && trade.slPrice < trade.entryPrice) {
            sageNewSl = trade.entryPrice;
            sageShouldUpdate = true;
          }
          if (tTrig !== undefined && tTrig > 0 && tStep !== undefined && tStep > 0 && gte(currentR, tTrig + tStep)) {
            const numSteps = Math.floor((currentR - tTrig + PRICE_EPSILON) / tStep);
            const rLevelToLock = numSteps * tStep;
            const proposedSL = Number((trade.entryPrice + rLevelToLock * actualRisk).toFixed(brokerDigits));
            if (proposedSL > trade.slPrice && proposedSL > sageNewSl) {
              sageNewSl = proposedSL;
              sageShouldUpdate = true;
            }
          }
        } else {
          if (tTrig !== undefined && tTrig > 0 && gte(currentR, tTrig) && trade.slPrice > trade.entryPrice) {
            sageNewSl = trade.entryPrice;
            sageShouldUpdate = true;
          }
          if (tTrig !== undefined && tTrig > 0 && tStep !== undefined && tStep > 0 && gte(currentR, tTrig + tStep)) {
            const numSteps = Math.floor((currentR - tTrig + PRICE_EPSILON) / tStep);
            const rLevelToLock = numSteps * tStep;
            const proposedSL = Number((trade.entryPrice - rLevelToLock * actualRisk).toFixed(brokerDigits));
            if (proposedSL < trade.slPrice && proposedSL < sageNewSl) {
              sageNewSl = proposedSL;
              sageShouldUpdate = true;
            }
          }
        }

        if (sageShouldUpdate) {
          const roundedSl = roundPrice(sageNewSl, baseSymbol);

          trade.slPrice = roundedSl;
          const sageHighest = trade.direction === "BUY"
            ? Math.max(trade.highestPrice || trade.entryPrice, tick.high)
            : (trade.highestPrice || trade.entryPrice);
          const sageLowest = trade.direction === "SELL"
            ? Math.min(trade.lowestPrice || trade.entryPrice, tick.low)
            : (trade.lowestPrice || trade.entryPrice);
          trade.highestPrice = sageHighest;
          trade.lowestPrice = sageLowest;
          db.prepare("UPDATE bot_trade_states SET sl_price = ?, highest_price = ?, lowest_price = ? WHERE id = ?").run(
            roundedSl,
            sageHighest,
            sageLowest,
            trade.dbId,
          );
          try {
            if (!trade.isVirtualSlMode) {
              const roundedTp = trade.tpPrice ? roundPrice(trade.tpPrice, baseSymbol) : null;
              await enqueueMetaApiRequest(
                async () =>
                  (
                    await getSharedConnection(orch.token, orch.accountId)
                  ).modifyPosition(
                    trade.metaOrderId,
                    roundedSl,
                    roundedTp,
                  ),
                `TrailSL:${baseSymbol}`,
              );
            }
            trade.slPrice = roundedSl;
            logger.info(`[DiscretionaryTrader] 🛡️ ${baseSymbol} SAGE Trailing SL moved to ${roundedSl.toFixed(brokerDigits)}`,);
            orch.addEyeFeedEvent({
              type: "TRAILING_SL",
              bot_id: trade.botId || targetBotId,
              data: {
                symbol: baseSymbol,
                decision: "TRAIL",
                setupType: "Reversal Sweep",
                sl: roundedSl,
                reasoning: `🛡️ SAGE Trailing SL moved to ${roundedSl.toFixed(brokerDigits)}`
              }
            });
          } catch (e: any) {
            const errMsg = e?.message || e?.toString() || "";
            if (errMsg.includes("Position not found") || errMsg.includes("Order not found") || errMsg.includes("Invalid position") || errMsg.includes("not found")) {
              logger.info(`[SageEngine] ℹ️ Position ${trade.metaOrderId} (${baseSymbol}) already closed on broker. Clearing from active state.`);
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
                db.prepare("UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ?").run(trade.dbId);
              } catch (_) {}
            } else {
              logger.error(`[DiscretionaryTrader] SAGE Trailing SL execution failed: ${e.message}`,);
            }
          }
        }
      }
    }
  }
}

export async function checkSageLimitFill(orch, sessionPair, state, c, targetBotId = "SAGE") {
  if (!state.sageStates) return;
  for (const sig of Object.keys(state.sageStates)) {
    const ss = state.sageStates[sig];
    if (ss && ss.limitOrderId && (!state.activeTrades || !state.activeTrades.find(t => t.clientId === sig)) && !ss.fired_fill_check) {
      try {
        const profile = await db.prepare("SELECT broker_symbol_map FROM trading_profiles WHERE id = ?").get(orch.profileId);
        let customMap = null;
        try { if (profile?.broker_symbol_map) customMap = JSON.parse(profile.broker_symbol_map); } catch(e) {}
        const baseSymbol = PairConfigManager.getBaseSymbol(sessionPair);
        const brokerSymbol = await getBrokerSymbol(baseSymbol, customMap);
        const positions = await enqueueMetaApiRequest(
          async () =>
            (
              await getSharedConnection(orch.token, orch.accountId)
            ).getPositions(),
          `Positions:${baseSymbol}`,
        );
        const dirType =
          ss.direction === "BUY" ? "POSITION_TYPE_BUY" : "POSITION_TYPE_SELL";
        const pos = positions.find(
          (p: any) => {
            if (p.symbol !== brokerSymbol || p.type !== dirType) return false;
            if (p.id === ss.limitOrderId) return true;
            if (p.clientId === sig) return true;
            if (orch.sigMap && orch.sigMap[p.clientId] === sig) return true;
            return false;
          }
        );

        if (pos) {
          ss.fired_fill_check = true;
          logger.info(`[DiscretionaryTrader] ⚠️ SAGE Fallback Poller detected missed OrderFill for ${baseSymbol}!`,);

          const sageConfigs = PairConfigManager.getSageConfigs(sessionPair);
          const sageCfg = sageConfigs.find(c => c.signature === sig) || sageConfigs[0] || state.config;
          const pipSize = sageCfg?.pipSize || PairConfigManager.getRepresentativeConfig(sessionPair)?.pipSize || getDynamicPipSize(baseSymbol);
          const intendedLimit = ss.limitPrice || pos.openPrice;
          const riskPips = Math.abs(intendedLimit - ss.slPrice) / pipSize;

          let dbId = 0;
          try {
            // First try to upgrade a PLACING record
            const upgradeRes = await db.prepare(`
              UPDATE bot_trade_states 
              SET status = 'OPEN', meta_order_id = ?, entry_price = ?, sl_price = ?, tp_price = ?, lots = ? 
              WHERE (client_id = ? OR meta_order_id = ?) AND status IN ('PLACING', 'FAILED', 'PENDING_VERIFICATION') RETURNING id
            `).all(pos.id, pos.openPrice, ss.slPrice, ss.tpPrice, pos.volume, pos.clientId || sig, ss.limitOrderId);
            
            if (upgradeRes && upgradeRes.length > 0) {
              dbId = upgradeRes[0].id;
            } else {
              const tp = await db
                .prepare("SELECT user_id FROM trading_profiles WHERE id = ?")
                .get(orch.profileId);
              const actualUserId = tp ? tp.user_id : 0;
              const insertTrade = await db.prepare(`
                INSERT INTO bot_trade_states
                  (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, original_sl, tp_price,
                   lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, initial_risk_pips, status, client_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'OPEN', ?)
              `);
              const openTimeMs = pos.time
                ? new Date(pos.time).getTime()
                : Date.now();
              const runResult = await insertTrade.run(
                actualUserId,
                orch.profileId,
                targetBotId.toUpperCase(),
                baseSymbol,
                ss.direction,
                pos.openPrice,
                ss.slPrice,
                ss.slPrice,
                ss.tpPrice || 0,
                pos.volume,
                openTimeMs,
                pos.id,
                pos.openPrice,
                pos.openPrice,
                riskPips,
                pos.clientId || sig
              );
              dbId = runResult.lastInsertRowid;
            }
          } catch(e: any) {
            logger.error(`[SageEngine] DB Insert/Upgrade error: ${e.message}`);
          }

          if (!state.activeTrades) state.activeTrades = [];
          state.activeTrades.push({
            dbId,
            metaOrderId: pos.id,
            clientId: sig,
            botId: targetBotId.toUpperCase(),
            direction: ss.direction,
            entryPrice: pos.openPrice,
            intendedEntryPrice: ss.limitPrice || pos.openPrice,
            entrySlippage: ss.direction === "BUY" ? (pos.openPrice - (ss.limitPrice || pos.openPrice)) : ((ss.limitPrice || pos.openPrice) - pos.openPrice),
            slPrice: ss.slPrice,
            originalSl: ss.slPrice,
            tpPrice: ss.tpPrice || 0,
            riskPips: riskPips,
            highestPrice: pos.openPrice,
            lowestPrice: pos.openPrice,
            isTrailing: false,
            volume: pos.volume,
            hasTakenPartial: false,
            openTime: pos.time ? new Date(pos.time).getTime() : Date.now(),
          });
          orch.addEyeFeedEvent({
            type: "TRADE_ENTERED",
            bot_id: "sage",
            data: {
              symbol: baseSymbol,
              decision: "ENTRY",
              setupType: "Reversal Sweep",
              price: pos.openPrice,
              volume: pos.volume,
              sl: ss.slPrice,
              tp: ss.tpPrice,
              reasoning: `SAGE Poller caught missed entry at ${pos.openPrice}`,
            }
          });
        }
      } catch (e) {
        logger.error(`[DiscretionaryTrader] SAGE limit fill check failed:`, e);
      }
    }
  }
}

export async function cancelSagePendingOnNews(orch, sessionPair, state, c, targetBotId = "SAGE") {
  if (!state.sageStates) return;
  const baseSymbol = PairConfigManager.getBaseSymbol(sessionPair);
  const newsCheck = isNewsBlackout(baseSymbol, new Date(c.timestamp));
  if (!newsCheck.blocked) return;

  for (const sig of Object.keys(state.sageStates)) {
    const ss = state.sageStates[sig];
    if (ss && ss.limitOrderId && (!state.activeTrades || !state.activeTrades.find(t => t.clientId === sig))) {
      try {
        const conn = await getSharedConnection(orch.token, orch.accountId);
        await conn.cancelOrder(ss.limitOrderId);
        logger.info(`[DiscretionaryTrader] 🧹 SAGE cancelled pending limit order ${ss.limitOrderId} on ${baseSymbol} due to News Blackout: ${newsCheck.reason}.`);
        ss.limitOrderId = null;
        ss.fired = false;
      } catch (e) {
        logger.error(`[DiscretionaryTrader] Failed to cancel SAGE limit order ${ss.limitOrderId} on news:`, e);
      }
    }
  }
}
