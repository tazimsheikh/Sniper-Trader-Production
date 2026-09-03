import realDb, { addBotLog as realAddBotLog } from '../../core/db.js';
import { calculateDwcb } from "../../utils/DwcbCalculator.js";
import { VisionDecision } from '../config/types.js';
const db: any = new Proxy({}, {
  get(_target, prop) {
    const activeDb = (global as any).__SIM_DB__ || realDb;
    return activeDb[prop];
  }
});
const addBotLog = (...args: any[]) =>
  (((global as any).__SIM_DB__ && typeof (global as any).__SIM_DB__.addBotLog === 'function') ? (global as any).__SIM_DB__.addBotLog : realAddBotLog)(...args);
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
logger.info("[SEER ENGINE TS LOADED!]");
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
import { PairConfigManager, SEER_PAIR_CONFIG } from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG, getDynamicPipSize } from "../config/OptimizerPairConfig.js";
import { PromptVault } from "../ai/PromptVault.js";
import { HTFContextTracker } from "../market/HTFContextTracker.js";
import { enqueueMetaApiRequest as realQueue } from "../../utils/MetaApiQueue.js";
const enqueueMetaApiRequest = (...args: any[]) =>
  ((global as any).__SIM_QUEUE__?.enqueueMetaApiRequest || realQueue)(...args);
import { isNewsBlackout as realNews } from '../../news/newsStore.js';
const isNewsBlackout = (...args: any[]) =>
  ((global as any).__SIM_NEWS__?.isNewsBlackout || realNews)(...args);
import { globalTradeGate as realGate } from "../../utils/GlobalTradeGate.js";
const globalTradeGate = (global as any).__SIM_TRADE_GATE__ || realGate;
import {
  isTradeAllowed,
  isSeerRolloverHalt
} from "../market/MathFilters.js";
import { buildBollingerArray, buildRsiArray } from "../market/Indicators.js";
import { evaluateStacyBurkeSetup } from "../market/SeerMathCore.js";
import { getIO } from '../../core/socket.js';
import { renderChart, getChartWindow } from "../ai/ChartRenderer.js";
import { isEncrypted as realIsEncrypted, decrypt as realDecrypt } from '../../core/crypto.js';
const isEncrypted = (...args: any[]) => ((global as any).__SIM_CRYPTO__?.isEncrypted || realIsEncrypted)(...args);
const decrypt = (...args: any[]) => ((global as any).__SIM_CRYPTO__?.decrypt || realDecrypt)(...args);
import { generateMagicNumber } from "../../utils/magicNumber.js";


function isConnectionError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || "").toUpperCase();
  return (
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("TIMEOUT") ||
    msg.includes("DISCONNECTED") ||
    msg.includes("SOCKET") ||
    msg.includes("NETWORK_ERROR") ||
    msg.includes("GATEWAY") ||
    msg.includes("RATE LIMIT") ||
    msg.includes("TOO MANY REQUESTS") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

function getFixedEstDate(date = new Date()) {
  if ((global as any).__SIM_TIME_PROVIDER__) {
    return (global as any).__SIM_TIME_PROVIDER__(date);
  }
  // Explicitly calculate New York time (EST/EDT) to avoid ICU timezone data bugs on Linux VMs.
  // Matches implementation in LiveOrchestrator, MageEngine, and SageEngine exactly.
  const y = date.getUTCFullYear();
  const marchFirst = new Date(Date.UTC(y, 2, 1));
  const daysToFirstSunday = (7 - marchFirst.getUTCDay()) % 7;
  const secondSundayMarch = new Date(Date.UTC(y, 2, 1 + daysToFirstSunday + 7, 7, 0, 0)); // 2:00 AM EST = 7:00 AM UTC
  const novFirst = new Date(Date.UTC(y, 10, 1));
  const daysToFirstSunNov = (7 - novFirst.getUTCDay()) % 7;
  const firstSundayNov = new Date(Date.UTC(y, 10, 1 + daysToFirstSunNov, 6, 0, 0)); // 2:00 AM EDT = 6:00 AM UTC
  const t = date.getTime();
  const isDST = t >= secondSundayMarch.getTime() && t < firstSundayNov.getTime();
  const offsetHours = isDST ? -4 : -5;
  return new Date(t + offsetHours * 60 * 60 * 1000);
}


export async function runPreFlightFilter(
  orch: any,
  symbol: string,
  state: any,
  prevDay: any,
  setupType: string,
) {
  const seerConfigArray = (orch as any).__CUSTOM_SEER_CONFIGS__ || PairConfigManager.getSeerConfigs(symbol);
  const seerConfig = (seerConfigArray && seerConfigArray.length > 0) ? seerConfigArray[0] : state.config;
  const botId = orch.getBotIdForSetup(setupType);
  if (!orch.activeBots.has(botId)) return;
  if (state.m5Buffer.length < 2) return;
  const c = state.m5Buffer[state.m5Buffer.length - 1];
  if (!c) return;

  if (state.seerLastEstHour !== undefined) {
    if (
      (state.seerLastEstHour < 17 && c.estHour >= 17) ||
      (state.seerLastEstHour > c.estHour && c.estHour >= 17)
    ) {
      state.seerTradeTakenToday = false;
    }
  }
  state.seerLastEstHour = c.estHour;
  state.currentDateStr = c.dateStr;

  if ((global as any).__SIM_WARMUP__) return;
  if (state.activeTrade || state.isPlacing) return;
  if (state.seerTradeTakenToday) return;

  const optCfg = OPTIMIZER_CONFIG[symbol.replace(".Daily", "")];
  const pipSize = getDynamicPipSize(symbol);
  const ema20 = state.emaArr[state.emaArr.length - 1] ?? 0;
  const prevC = state.m5Buffer[state.m5Buffer.length - 2];

  const bbArr = seerConfig.bbStdDev !== undefined ? buildBollingerArray(state.m5Buffer, 20, 2.0) : null;
  const bbValues = bbArr && bbArr.length >= 2 ? bbArr[bbArr.length - 2] : undefined;

  const rsiArr = seerConfig.rsiThreshold !== undefined ? buildRsiArray(state.m5Buffer, 14) : null;
  const rsiValue = rsiArr && rsiArr.length >= 2 ? rsiArr[rsiArr.length - 2] : undefined;

  let day3High = -Infinity;
  let day3Low = Infinity;
  const currentDay = state.dailyTracker.getCurrentDaily();
  if (currentDay) {
    for (let i = state.m5Buffer.length - 2; i >= 0; i--) {
      const pastC = state.m5Buffer[i];
      if (pastC.timestamp < currentDay.startTime) break;
      if (pastC.high > day3High) day3High = pastC.high;
      if (pastC.low < day3Low) day3Low = pastC.low;
    }
  }

  let orbStartHour = seerConfig.orbStartHour !== undefined ? seerConfig.orbStartHour : 9;
  if (seerConfig.orbStartHour === undefined) {
    if (symbol.includes('JPY')) orbStartHour = 20;
    else if (symbol === 'GER40') orbStartHour = 3;
    else if (symbol.includes('EUR') || symbol.includes('GBP')) orbStartHour = 3;
    else if (symbol === 'XAUUSD') orbStartHour = 8;
  }
  const estH = c.estHour;
  const isAsia = estH >= 20 && estH < 23;
  const isLondon = estH >= 2 && estH < 5;
  const isNY = estH >= 9 && estH < 13;
  let sessions = seerConfig.sessions || (seerConfig.session ? [seerConfig.session] : undefined);
  if (!sessions) {
    if (symbol.includes("JPY")) sessions = ["asia", "london"];
    else if (symbol.includes("EUR") || symbol.includes("GBP"))
      sessions = ["london", "NY_Forex"];
    else if (symbol.includes("XAUUSD")) sessions = ["london", "NY_Forex"];
    else sessions = [seerConfig.session || "NY_Forex"];
  }

  let inWindow = false;
  for (const sess of sessions) {
    if (sess === "asia" && isAsia) inWindow = true;
    if (sess === "london" && isLondon) inWindow = true;
    if ((sess === "NY_Forex" || sess === "NY_Indices" || sess === "ny" || sess === "newyork") && isNY) inWindow = true;
  }

  const baseSymbol = PairConfigManager.getBaseSymbol(symbol);
  const dateStr = c.dateStr.split(" ")[0];
  const windowName = isLondon
    ? "london"
    : isNY
      ? seerConfig.session || "ny"
      : isAsia
        ? "asia"
        : "default";

  let isCatchUp = false;
  let catchUpLeadTrade: any = null;

  // ── CROSS-ACCOUNT SMART TRADE CATCH-UP ──
  const leadTrade = globalTradeGate.getActiveLeadTrade("SEER", baseSymbol, windowName, dateStr);
  if (
    leadTrade &&
    (!leadTrade.session || leadTrade.session === windowName) &&
    leadTrade.leadProfileId !== orch.profileId &&
    !state.seerTradeTakenToday &&
    !state.activeTrade &&
    !state.isEvaluating
  ) {
    const isBuy = leadTrade.direction === "BUY";
    const currentPrice = c.close;
    const proximityThreshold = Math.max(2.5 * pipSize, 0.10 * Math.abs(leadTrade.entryPrice - leadTrade.slPrice));
    const distFromLead = isBuy ? (currentPrice - leadTrade.entryPrice) : (leadTrade.entryPrice - currentPrice);
    const totalTpDist = Math.abs(leadTrade.tpPrice - leadTrade.entryPrice);
    const pctTowardsTp = distFromLead > 0 ? (distFromLead / (totalTpDist || 1)) : 0;
    const hitSl = isBuy ? (currentPrice <= leadTrade.slPrice) : (currentPrice >= leadTrade.slPrice);

    if (!hitSl && pctTowardsTp < 0.10 && distFromLead <= proximityThreshold) {
      logger.info(
        `[SeerEngine][P#${orch.profileId}] 🔄 Cross-Account Smart Catch-Up triggered for ${baseSymbol} ${leadTrade.direction} (Lead from P#${leadTrade.leadProfileId} at ${leadTrade.entryPrice}, Live: ${currentPrice}, Slippage: ${(distFromLead / pipSize).toFixed(1)} pips)`,
      );
      isCatchUp = true;
      catchUpLeadTrade = leadTrade;
      inWindow = true;
    }
  }

  if (!inWindow) return;

  let mathResult: any = null;
  let expectedDirection: "BUY" | "SELL" | null = null;

  if (isCatchUp && catchUpLeadTrade) {
    expectedDirection = catchUpLeadTrade.direction;
    setupType = "CATCH_UP";
  } else {
    mathResult = evaluateStacyBurkeSetup(
      c,
      prevC,
      ema20,
      prevDay,
      setupType,
      seerConfig,
      pipSize,
      symbol,
      false,
      day3High,
      day3Low,
      bbValues,
      rsiValue
    );

    if (!mathResult) return;
    expectedDirection = mathResult.direction;
    setupType = mathResult.setupType;
  }

  // Strict Execution Window Enforcement
  if (inWindow && seerConfig.delayStartMinutes !== undefined) {
    const isStartHour =
      (isNY && estH === 8) ||
      (isLondon && estH === 2) ||
      (isAsia && estH === 20);
    if (isStartHour && c.estMin < seerConfig.delayStartMinutes)
      inWindow = false;
  }
  if (inWindow && seerConfig.cutoffHour !== undefined) {
    if (estH >= seerConfig.cutoffHour) inWindow = false;
  }
  if (!inWindow) return;
  if (orch.activeBots.size === 0) return;
  if (state.isEvaluating) return;

  if (orch.apiLockouts.has(symbol) && c.timestamp < orch.apiLockouts.get(symbol))
    return;
  const gateCheck = globalTradeGate.canTrade(
    orch.profileId,
    symbol,
    expectedDirection,
    "DISC",
  );
  // --- HTF Parabolic Trend Filter ---
  const maxSlopePips = seerConfig.maxH1EmaSlope;
  if (maxSlopePips && state.m5Buffer.length > 500) {
    const isParabolic = HTFContextTracker.isTrendParabolic(
      state.m5Buffer,
      expectedDirection as any,
      maxSlopePips,
      seerConfig.pipSize,
    );
    if (isParabolic) {
      logger.verbose(`[SeerEngine] ${symbol} Rejected: HTF Trend Parabolic (maxH1EmaSlope=${maxSlopePips}) - Dir: ${expectedDirection}`);
      return;
    }
  }
  // ----------------------------------
  if (!gateCheck.approved) {
    return;
  }
  state.isEvaluating = true;
  globalTradeGate.markDiscEvaluating(orch.profileId, symbol);
  try {
    const io = (global as any).__SIM_MOCK_ACCOUNT__ ? null : getIO();
    if (io) {
      io.to(`profile_${orch.profileId}`).emit(
        "discretionary_trader:eval_start",
        { symbol, setupType, time: c.dateStr },
      );
    }
    logger.verbose(`[SeerEngine] Pre-flight passed for ${symbol} ${setupType}. Consulting Vision AI...`);
    const dailyCandles = state.dailyTracker.dailyCandles;
    const prevDay2 =
      dailyCandles.length > 0 ? dailyCandles[dailyCandles.length - 1] : null;
    const day3 =
      dailyCandles.length > 1 ? dailyCandles[dailyCandles.length - 2] : null;
    const currentDay = state.dailyTracker.getCurrentDaily();
    const estH2 = c.estHour;
    const inLondon = estH2 >= 2 && estH2 < 6;
    const inNY = estH2 >= 8 && estH2 < 13;
    const inAsia = estH2 >= 20;
    const windowName = inLondon
      ? "london"
      : inNY
        ? seerConfig.session || "NY_Forex"
        : inAsia
          ? "asia"
          : "Off-Hours";
    const { candles: windowCandles, startIdx } = getChartWindow(
      state.m5Buffer,
      state.m5Buffer.length - 2,
      40,
    );
    const windowEmas = state.emaArr.slice(startIdx, state.m5Buffer.length - 1);
    const sessionStartOffset = windowCandles.findIndex((wc) => {
      if (inLondon) return wc.estHour >= 1;
      if (inNY) return wc.estHour >= 7;
      if (inAsia) return wc.estHour >= 19;
      return false;
    });
    // SMART CATCH-UP / MATH-ONLY AUTO APPROVAL
    const result: VisionDecision = {
      decision: expectedDirection as "BUY" | "SELL",
      confidence: 100,
      setupQuality: 100,
      reasoning: isCatchUp ? "Cross-Account Smart Catch-Up from Lead Profile" : "Math-only mode auto-approval",
      stopLoss: isCatchUp && catchUpLeadTrade?.slPrice ? catchUpLeadTrade.slPrice : undefined,
      takeProfit: isCatchUp && catchUpLeadTrade?.tpPrice ? catchUpLeadTrade.tpPrice : undefined,
    };
    logger.info(`[DiscretionaryTrader] \u{1F52E} Result for ${symbol}: ${result.decision} (${result.confidence}%)`,);
    if (io) {
      io.to(`profile_${orch.profileId}`).emit(
        "discretionary_trader:eval_result",
        {
          symbol,
          setupType,
          decision: result.decision,
          confidence: result.confidence,
        },
      );
    }
    const botId2 = orch.getBotIdForSetup(setupType);
    if (result.decision === "NO_TRADE") {
      let signalDir = "WAIT";
      if (
        setupType === "FGD" ||
        setupType === "DAY3_SHORT" ||
        setupType === "LHF_LONG"
      )
        signalDir = "BUY";
      if (
        setupType === "FRD" ||
        setupType === "DAY3_LONG" ||
        setupType === "LHF_SHORT"
      )
        signalDir = "SELL";
      const msg = `Setup: ${setupType} | Reason: ${result.reasoning || "Confidence too low"}`;
      addBotLog(
        orch.profileId,
        botId2,
        symbol,
        `Vision AI Rejected ${signalDir}`,
        msg,
      );
      orch.apiLockouts.set(symbol, c.timestamp + 15 * 6e4);
      logger.info(`[DiscretionaryTrader] \u{1F6D1} ${symbol} AI Rejected Trade. Applied 15-minute lockout.`,);
      orch.addEyeFeedEvent({
        type: "EVAL_RESULT",
        bot_id: botId2,
        data: {
          symbol,
          decision: `REJECTED ${signalDir}`,
          detail: result.reasoning,
        },
      });
      return;
    }
    if (result.decision !== expectedDirection) {
      logger.info(`[DiscretionaryTrader] \u{1F6A8} AI Hallucination detected on ${symbol}! Expected ${expectedDirection} for ${setupType}, but AI said ${result.decision}. Forcing NO_TRADE.`,);
      result.decision = "NO_TRADE";
      addBotLog(
        orch.profileId,
        botId2,
        symbol,
        `Vision AI Hallucinated`,
        `Expected ${expectedDirection} but AI returned ${result.decision}. Trade blocked.`,
      );
      orch.addEyeFeedEvent({
        type: "EVAL_RESULT",
        bot_id: orch.getBotIdForSetup(setupType),
        data: {
          symbol,
          decision: `BLOCKED HALLUCINATION`,
          detail: `Expected ${expectedDirection}`,
        },
      });
      return;
    }
    if (result.decision === "BUY" || result.decision === "SELL") {
      const optCfg = OPTIMIZER_CONFIG[symbol.replace(".Daily", "")];
      const pipSize3 = getDynamicPipSize(symbol);
      const askSpread = (seerConfig.spread ?? optCfg?.spread ?? 0) * pipSize3;
      const e = result.decision === "BUY" ? c.close + askSpread : c.close;
      const isVolatile =
        symbol.includes("XAU") ||
        symbol.includes("NAS") ||
        symbol.includes("US30") ||
        symbol.includes("GER40") ||
        symbol.includes("GBPJPY") ||
        symbol.includes("GBPNZD") ||
        symbol.includes("GBPCAD") ||
        symbol.includes("EURNZD");
      let minSlDist = (isVolatile ? 40 : 20) * pipSize3;
      if (seerConfig.minSlDist !== void 0)
        minSlDist = seerConfig.minSlDist * pipSize3;
      let maxPips = 40;
      if (symbol.includes("BTC")) maxPips = 250;
      else if (symbol.includes("ETH")) maxPips = 150;
      if (symbol.includes("XAU")) maxPips = 100;
      else if (
        symbol.includes("NAS") ||
        symbol.includes("US30") ||
        symbol.includes("GER40")
      )
        maxPips = 250;
      let maxSlDist = maxPips * pipSize3;
      if (seerConfig.maxSlDist !== void 0)
        maxSlDist = seerConfig.maxSlDist * pipSize3;
      let calculatedSl = (isCatchUp && catchUpLeadTrade?.slPrice)
        ? catchUpLeadTrade.slPrice
        : (result.decision === "BUY"
            ? c.low - (2 * pipSize3)
            : c.high + (2 * pipSize3) + askSpread);

      const slDistPips = Math.abs(e - calculatedSl) / pipSize3;
      const minSlVal = minSlDist / pipSize3;
      const maxSlVal = maxSlDist / pipSize3;
      if (slDistPips < minSlVal) {
        calculatedSl = result.decision === "BUY"
          ? e - (minSlVal * pipSize3)
          : e + (minSlVal * pipSize3);
      } else if (slDistPips > maxSlVal) {
        calculatedSl = result.decision === "BUY"
          ? e - (maxSlVal * pipSize3)
          : e + (maxSlVal * pipSize3);
      }

      const tpDist = 100 * pipSize3;
      let calculatedTp = (isCatchUp && catchUpLeadTrade?.tpPrice)
        ? catchUpLeadTrade.tpPrice
        : (result.decision === "BUY" ? e + tpDist : e - tpDist);

      const adjustedRiskPips = Math.abs(e - calculatedSl) / pipSize3;
      result.stopLoss = calculatedSl;
      result.takeProfit = calculatedTp;
      result.riskPips = adjustedRiskPips;
      const profile = await db
        .prepare(
          "SELECT t.risk_multiplier, t.automation_active, t.ai_sniper_active, COALESCE(t.metaapi_token, u.metaapi_token) as metaapi_token, t.metaapi_account_id, t.dwcb_enabled, t.dwcb_peak_balance, t.base_risk_balance, t.broker_symbol_map, t.institutional_enabled, t.institutional_daily_start_balance, t.institutional_daily_date, t.institutional_peak_balance FROM trading_profiles t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?",
        )
        .get(orch.profileId);
      if (!profile || !profile.automation_active || profile.ai_sniper_active === 0) {
        logger.info(`[DiscretionaryTrader] \u{1F52E} Skipping execution for ${symbol}: Automation/AI Sniper disabled for profile ${orch.profileId}`,);
      } else {
        let brokerSymbol = symbol;
        let dbId = void 0;
        try {
          const rolloverDate = getFixedEstDate(new Date(c.timestamp));
          const rolloverH = rolloverDate.getUTCHours();
          const rolloverM = rolloverDate.getUTCMinutes();
          if (isSeerRolloverHalt(rolloverH, rolloverM)) {
            logger.info(`[DiscretionaryTrader] \u26D4 ${symbol} \u2014 Blocked: Rollover halt window active (16:50 - 17:15 EST).`,);
            addBotLog(
              orch.profileId,
              botId2,
              symbol,
              `Trade Blocked`,
              `Rollover halt window active.`,
            );
            return;
          }
          
          const token = isEncrypted(profile.metaapi_token)
            ? decrypt(profile.metaapi_token)
            : profile.metaapi_token;
          const accountId = safeDecryptAccountId(profile.metaapi_account_id);
          let customMap = null;
          try {
            if (profile.broker_symbol_map) customMap = JSON.parse(profile.broker_symbol_map);
          } catch(e) {}
          brokerSymbol = await getBrokerSymbol(symbol, customMap);
          const accountInfo = await enqueueMetaApiRequest(
            async () =>
              (
                await getSharedConnection(orch.token, orch.accountId)
              ).getAccountInformation(),
            `AccountInfo:${symbol}`,
            undefined,
            undefined,
            orch.profileId
          );
          if (
            accountInfo &&
            accountInfo.marginLevel !== void 0 &&
            accountInfo.marginLevel < 300
          ) {
            logger.info(`[DiscretionaryTrader] \u26D4 ${brokerSymbol} \u2014 Blocked: Margin level is low (${accountInfo.marginLevel.toFixed(1)}%).`,);
            addBotLog(
              orch.profileId,
              botId2,
              brokerSymbol,
              `Trade Blocked`,
              `Margin level low (${accountInfo.marginLevel.toFixed(1)}%).`,
            );
            return;
          }
          const conn = await getSharedConnection(orch.token, orch.accountId);
          const freshQuote = await conn.getSymbolPrice(brokerSymbol);
          const spec = getSymbolSpec(symbol.split("_")[0]);
          const freshEntry = (global as any).__SIM_TIME_PROVIDER__
            ? roundPrice(e, symbol)
            : (result.decision === "BUY" ? freshQuote.ask : freshQuote.bid);
          const slippagePips = Math.abs(freshQuote.bid - e) / spec.pipSize;
          if (!(global as any).__SIM_TIME_PROVIDER__ && slippagePips > 4) {
            logger.info(`[DiscretionaryTrader] \u26D4 ${brokerSymbol} \u2014 Slippage exceeded 4 pips (${slippagePips.toFixed(1)} pips) during AI eval. Trade aborted. freshQuote.bid=${freshQuote.bid} e=${e} spec.pipSize=${spec.pipSize}`,);
            addBotLog(
              orch.profileId,
              botId2,
              brokerSymbol,
              `Trade Aborted`,
              `Slippage exceeded 4 pips during AI eval (${slippagePips.toFixed(1)} pips).`,
            );
            orch.apiLockouts.set(symbol, c.timestamp + 5 * 6e4);
            return;
          }
          // 🔍 Fetch live broker spec — broker-agnostic pip value (no hardcoded getPipValue assumptions)
          const liveSpec = await getLiveBrokerSpec(
            brokerSymbol,
            token,
            accountId,
          );
          const pipValuePerLot =
            seerConfig.pipValuePerLot ?? liveSpec.pipValuePerLot;
          const actualSlPips =
            Math.abs(freshEntry - result.stopLoss) / spec.pipSize;
          
          if (!(global as any).__SIM_MOCK_ACCOUNT__ && (!orch.cachedEquity || orch.cachedEquity <= 0)) {
            try {
              const rawToken = isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token;
              const conn = await getSharedConnection(rawToken, accountId);
              const accInfo = await conn.getAccountInformation();
              if (accInfo && accInfo.equity > 0) {
                orch.cachedEquity = accInfo.equity;
                console.log(`[SeerEngine] 🔄 Emergency live fetch account equity: $${orch.cachedEquity.toFixed(2)}`);
              }
            } catch (e: any) {}
          }
          
          if (!(global as any).__SIM_MOCK_ACCOUNT__ && (!orch.cachedEquity || orch.cachedEquity <= 0)) {
            logger.warn(`[SeerEngine] ⚠️ Cached equity is 0 or missing. Aborting trade to prevent DWCB corruption.`);
            return;
          }
          const effectiveBalance = orch.cachedEquity > 0
            ? orch.cachedEquity
            : Math.min(accountInfo.balance, accountInfo.equity);

          const { dwcbMultiplier, drawdown } = await calculateDwcb(
            orch.profileId,
            profile.dwcb_enabled,
            profile.dwcb_peak_balance,
            effectiveBalance,
          );
          if (profile.dwcb_enabled === 1 && dwcbMultiplier < 1) {
            logger.info(`[DiscretionaryTrader] 🛡️ DWCB Active: Peak=$$${(profile.dwcb_peak_balance || effectiveBalance).toFixed(2)}, Curr=$$${effectiveBalance.toFixed(2)}, DD=${(drawdown * 100).toFixed(2)}%, Multiplier=${dwcbMultiplier.toFixed(2)}x`);
          }

          // Institutional Drawdowns
          let institutionalMultiplier = 1.0;
          if (profile.institutional_enabled === 1) {
            const dailyCapPct = profile.institutional_daily_cap ? profile.institutional_daily_cap / 100 : 0.025;
            const peakToDrawPct = profile.institutional_peak_to_draw ? profile.institutional_peak_to_draw / 100 : 0.055;
            const estDate = getFixedEstDate();
            const tradingDayDate = new Date(estDate.getTime() + 7 * 60 * 60 * 1000);
            const brokerTradingDayStr = tradingDayDate.toISOString().split('T')[0];
            
            // Absolute Drawdown Limit
            let currentInstPeak = profile.institutional_peak_balance;
            if (!currentInstPeak || effectiveBalance > currentInstPeak) {
              currentInstPeak = effectiveBalance;
              await db.prepare("UPDATE trading_profiles SET institutional_peak_balance = ? WHERE id = ?").run(currentInstPeak, orch.profileId);
            } else {
              const absDrawdown = (currentInstPeak - effectiveBalance) / currentInstPeak;
              if (absDrawdown >= peakToDrawPct) {
                logger.error(`[DiscretionaryTrader] 🛑 Institutional halt: ${(peakToDrawPct * 100).toFixed(1)}% Absolute Drawdown Reached on Seer for ${brokerSymbol}. Trade aborted.`);
                addBotLog(orch.profileId, botId2, brokerSymbol, `Trade Aborted`, `Institutional halt: ${(peakToDrawPct * 100).toFixed(1)}% Absolute Drawdown Reached.`);
                orch.addEyeFeedEvent({
                  type: "REJECT",
                  bot_id: botId2,
                  data: {
                    symbol: brokerSymbol,
                    decision: "NO_TRADE",
                    setupType: "Vision Candidate",
                    reasoning: `Institutional halt: ${(peakToDrawPct * 100).toFixed(1)}% Absolute Drawdown Reached.`,
                  }
                });
                return;
              }

              // 🛡️ Dynamic Trailing Proximity Scaling (Adaptive Drawdown De-risking)
              const rho = absDrawdown / peakToDrawPct; // 0.0 at peak -> 1.0 at limit
              if (rho >= 0.85) {
                institutionalMultiplier = 0.15;
                logger.warn(`[SeerEngine] ⚠️ Institutional Proximity Scaling: Drawdown is ${(rho * 100).toFixed(1)}% of max trailing limit on ${brokerSymbol}. Contracting risk to 15%.`);
              } else if (rho >= 0.70) {
                institutionalMultiplier = 0.30;
                logger.warn(`[SeerEngine] ⚠️ Institutional Proximity Scaling: Drawdown is ${(rho * 100).toFixed(1)}% of max trailing limit on ${brokerSymbol}. Contracting risk to 30%.`);
              } else if (rho >= 0.50) {
                institutionalMultiplier = 0.50;
                logger.warn(`[SeerEngine] ⚠️ Institutional Proximity Scaling: Drawdown is ${(rho * 100).toFixed(1)}% of max trailing limit on ${brokerSymbol}. Contracting risk to 50%.`);
              }
            }

            // Daily Loss Limit
            let dailyStartBal = profile.institutional_daily_start_balance;
            let dailyDate = profile.institutional_daily_date;
            if (dailyDate !== brokerTradingDayStr || !dailyStartBal) {
              dailyStartBal = effectiveBalance;
              dailyDate = brokerTradingDayStr;
              await db.prepare("UPDATE trading_profiles SET institutional_daily_start_balance = ?, institutional_daily_date = ? WHERE id = ?").run(dailyStartBal, dailyDate, orch.profileId);
            } else {
              const dailyDrawdown = (dailyStartBal - effectiveBalance) / dailyStartBal;
              if (dailyDrawdown >= dailyCapPct) {
                logger.error(`[DiscretionaryTrader] 🛑 Institutional halt: ${(dailyCapPct * 100).toFixed(1)}% Daily Loss Limit Reached on Seer for ${brokerSymbol}. Trade aborted.`);
                addBotLog(orch.profileId, botId2, brokerSymbol, `Trade Aborted`, `Institutional halt: ${(dailyCapPct * 100).toFixed(1)}% Daily Loss Limit Reached.`);
                orch.addEyeFeedEvent({
                  type: "REJECT",
                  bot_id: botId2,
                  data: {
                    symbol: brokerSymbol,
                    decision: "NO_TRADE",
                    setupType: "Vision Candidate",
                    reasoning: `Institutional halt: ${(dailyCapPct * 100).toFixed(1)}% Daily Loss Limit Reached.`,
                  }
                });
                return;
              }
            }
          }

          if (profile.dwcb_enabled === 1 && dwcbMultiplier <= 0) {
            logger.info(`[DiscretionaryTrader] \u{1F6D1} DWCB halt triggered (dwcbMultiplier <= 0) on ${brokerSymbol}. Trade aborted.`,);
            addBotLog(
              orch.profileId,
              botId2,
              brokerSymbol,
              `Trade Aborted`,
              `DWCB halt triggered (dwcbMultiplier <= 0).`,
            );
            orch.addEyeFeedEvent({
              type: "REJECT",
              bot_id: botId2,
              data: {
                symbol: brokerSymbol,
                decision: "NO_TRADE",
                setupType: "Vision Candidate",
                reasoning: `DWCB halt triggered.`,
              }
            });
            return;
          }
          const baseMonteCarloRisk = seerConfig.riskPct ?? 0.01;
          const userRiskDial = state.botConfigs.get(botId2)?.risk ?? state.riskPct ?? 1;
          let riskPct2 = baseMonteCarloRisk * userRiskDial * (profile.risk_multiplier || 1);
          const MAX_PERMITTED_RISK_PCT = 3.0;
          if (riskPct2 > MAX_PERMITTED_RISK_PCT) {
            riskPct2 = MAX_PERMITTED_RISK_PCT;
          }
          // Base Risk: use fixed user-defined balance if set, otherwise live equity
          const riskBasis =
            profile.base_risk_balance && Number(profile.base_risk_balance) > 0
              ? Number(profile.base_risk_balance)
              : effectiveBalance;
          if (!riskBasis || riskBasis <= 0) {
            logger.error(`[SeerEngine] ❌ Invalid balance / live equity (${riskBasis}). Aborting trade placement for safety on ${brokerSymbol}.`);
            return;
          }
          const riskFraction = riskPct2 / 100;
          const riskAmountUsd = riskBasis * riskFraction * dwcbMultiplier * institutionalMultiplier;
          const rawLots = riskAmountUsd / (actualSlPips * pipValuePerLot);
          let safeLots = quantizeLots(
            rawLots,
            liveSpec.volumeStep,
            liveSpec.minVolume,
            liveSpec.maxVolume,
          );
          safeLots = parseFloat(safeLots.toFixed(2));
          logger.info(`[DiscretionaryTrader] ⚔️ Executing ${result.decision} on ${brokerSymbol} | Lots: ${safeLots} | SL Pips: ${actualSlPips.toFixed(1)}`,);
          state.isPlacing = true;
          state.seerTradeTakenToday = true;
          const clientId = `SEER_${orch.profileId}_${Date.now().toString(36)}`;
          const magic = generateMagicNumber("SEER", seerConfig.signature || symbol);
          try {
            const tp = await db
              .prepare("SELECT user_id FROM trading_profiles WHERE id = ?")
              .get(orch.profileId);
            const actualUserId = tp ? tp.user_id : 0;
            const insertTrade = await db.prepare(`
                INSERT INTO bot_trade_states
                  (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, original_sl, tp_price,
                   lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, initial_risk_pips, status, client_id, manages_own_trailing)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, 'PLACING', ?, 1)
              `);
            const openTimeMs = c.timestamp;
            dbId = (
              await insertTrade.run(
                actualUserId,
                orch.profileId,
                orch.getBotIdForSetup(setupType),
                brokerSymbol,
                result.decision,
                freshEntry,
                result.stopLoss,
                result.stopLoss,
                result.takeProfit,
                safeLots,
                openTimeMs,
                freshEntry,
                freshEntry,
                actualSlPips,
                clientId,
              )
            ).lastInsertRowid;
          } catch (dbErr) {
            logger.error(`[DiscretionaryTrader] \u274C Failed to insert trade state into DB for ${brokerSymbol}:`,
              dbErr.message,);
            addBotLog(
              orch.profileId,
              botId2,
              brokerSymbol,
              "Error",
              `Failed to insert DB trade state: ${dbErr.message}`,
            );
            throw dbErr;
          }
          const logFailedTrade = async (dbId2, reason) => {
            await db
              .prepare(
                "UPDATE bot_trade_states SET status = 'FAILED' WHERE id = ?",
              )
              .run(dbId2);
            const tp = await db
              .prepare("SELECT user_id FROM trading_profiles WHERE id = ?")
              .get(orch.profileId);
            if (tp) {
              await db
                .prepare(
                  `
                  INSERT INTO trade_diary 
                    (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, exit_price, lots, pips, profit, status, open_time, close_time) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                )
                .run(
                  tp.user_id,
                  orch.profileId,
                  orch.getBotIdForSetup(setupType),
                  brokerSymbol,
                  result.decision,
                  0,
                  0,
                  safeLots,
                  0,
                  0,
                  "FAILED",
                  c.timestamp,
                  c.timestamp,
                );
            }
          };
          let orderResult;
          let cleanSl: number | undefined;
          let cleanTp: number | undefined;
          try {
            cleanSl = result.stopLoss
              ? roundPrice(result.stopLoss, brokerSymbol)
              : void 0;
            cleanTp = result.takeProfit
              ? roundPrice(result.takeProfit, brokerSymbol)
              : void 0;

            // ── BROKER STOPS LEVEL VALIDATION ──
            const digits = spec?.digits || 5;
            const minDistance =
              (spec?.stopsLevel || 0) *
              (spec?.tickSize || Math.pow(10, -digits));
            const currentPrice = result.decision === "BUY" ? c.ask : c.bid;
            if (cleanSl && Math.abs(currentPrice - cleanSl) < minDistance) {
              cleanSl =
                result.decision === "BUY"
                  ? currentPrice - minDistance
                  : currentPrice + minDistance;
              cleanSl = roundPrice(cleanSl, brokerSymbol);
              logger.info(`[DiscretionaryTrader] Widen SL for ${brokerSymbol} to meet broker stopsLevel (${spec?.stopsLevel}). New SL: ${cleanSl}`,);
            }
            if (cleanTp && Math.abs(currentPrice - cleanTp) < minDistance) {
              cleanTp =
                result.decision === "BUY"
                  ? currentPrice + minDistance
                  : currentPrice - minDistance;
              cleanTp = roundPrice(cleanTp, brokerSymbol);
              logger.info(`[DiscretionaryTrader] Widen TP for ${brokerSymbol} to meet broker stopsLevel (${spec?.stopsLevel}). New TP: ${cleanTp}`,);
            }
            if (result.decision === "BUY") {
              orderResult = await enqueueMetaApiRequest(
                async () => {
                  
                  const rawToken = isEncrypted(profile.metaapi_token)
                    ? decrypt(profile.metaapi_token)
                    : profile.metaapi_token;
                  const freshConn = await getSharedConnection(
                    rawToken,
                    profile.metaapi_account_id,
                  );
                  const isSim = (global as any).isSimulator || (global as any).__SIM_MOCK_ACCOUNT__;
                  const orderOpts = isSim ? { clientId, magic, entryPrice: freshEntry } : { clientId, magic };
                  return freshConn.createMarketBuyOrder(
                    brokerSymbol,
                    safeLots,
                    cleanSl,
                    cleanTp || undefined,
                    orderOpts,
                  );
                },
                `MarketBuy:${symbol}`,
                3,
                async () => {
                  
                  const rawToken = isEncrypted(profile.metaapi_token)
                    ? decrypt(profile.metaapi_token)
                    : profile.metaapi_token;
                  /* skipped reboot in sim */
                },
                orch.profileId
              );
            } else if (result.decision === "SELL") {
              orderResult = await enqueueMetaApiRequest(
                async () => {
                  
                  const rawToken = isEncrypted(profile.metaapi_token)
                    ? decrypt(profile.metaapi_token)
                    : profile.metaapi_token;
                  const freshConn = await getSharedConnection(
                    rawToken,
                    profile.metaapi_account_id,
                  );
                  const isSim = (global as any).isSimulator || (global as any).__SIM_MOCK_ACCOUNT__;
                  const orderOpts = isSim ? { clientId, magic, entryPrice: freshEntry } : { clientId, magic };
                  return freshConn.createMarketSellOrder(
                    brokerSymbol,
                    safeLots,
                    cleanSl,
                    cleanTp || undefined,
                    orderOpts,
                  );
                },
                `MarketSell:${symbol}`,
                3,
                async () => {
                  
                  const rawToken = isEncrypted(profile.metaapi_token)
                    ? decrypt(profile.metaapi_token)
                    : profile.metaapi_token;
                  /* skipped reboot in sim */
                },
                orch.profileId
              );
            }
          } catch (err) {
            if (err.message && err.message.includes("split")) {
              logger.error(`[DiscretionaryTrader] 🧹 Self-healing: Cleared cached connection for profile ${orch.profileId} due to MetaAPI split error.`,);
              try {
                const profile = await db
                  .prepare(
                    "SELECT COALESCE(t.metaapi_token, u.metaapi_token) as metaapi_token, t.metaapi_account_id FROM trading_profiles t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?",
                  )
                  .get(orch.profileId);
                if (profile) {
                  
                  const rawToken = isEncrypted(profile.metaapi_token)
                    ? decrypt(profile.metaapi_token)
                    : profile.metaapi_token;
                  clearSharedConnection(rawToken, profile.metaapi_account_id);
                }
              } catch (e) {}
            }
            if (isBrokerPriceOrStopsError(err)) {
              logger.info(`[DiscretionaryTrader] Order/Stops rejected by broker for ${brokerSymbol} (${err.message}). Retrying with StopsLevel safe prices...`,);
              const staticSpec = getSymbolSpec(symbol.split("_")[0]);
              const stopsLevelPts = liveSpec?.stopsLevel || (staticSpec as any).stopsLevel || 0;
              const safePrices = calculateStopsLevelSafePrices(
                result.decision as "BUY" | "SELL",
                c.close,
                cleanSl,
                cleanTp,
                stopsLevelPts,
                liveSpec?.tickSize || staticSpec.tickSize || 0.00001,
                liveSpec?.digits || staticSpec.digits || 5
              );
              const safeRoundedSl = roundPrice(safePrices.pSl, brokerSymbol);
              const safeRoundedTp = safePrices.pTp ? roundPrice(safePrices.pTp, brokerSymbol) : undefined;
              if (result.decision === "BUY") {
                orderResult = await enqueueMetaApiRequest(
                  async () =>
                    (
                      await getSharedConnection(orch.token, orch.accountId)
                    ).createMarketBuyOrder(
                      brokerSymbol,
                      safeLots,
                      safeRoundedSl,
                      safeRoundedTp,
                      { clientId, magic },
                    ),
                  `MarketBuy:${symbol}`,
                  3,
                  async () => {},
                  orch.profileId
                );
              } else {
                orderResult = await enqueueMetaApiRequest(
                  async () =>
                    (
                      await getSharedConnection(orch.token, orch.accountId)
                    ).createMarketSellOrder(
                      brokerSymbol,
                      safeLots,
                      safeRoundedSl,
                      safeRoundedTp,
                      { clientId, magic },
                    ),
                  `MarketSell:${symbol}`,
                  3,
                  async () => {},
                  orch.profileId
                );
              }
            } else if (isConnectionError(err)) {
              throw err;
            } else {
              await logFailedTrade(dbId, err.message);
              throw err;
            }
          }
          if (!orderResult?.orderId) {
            await logFailedTrade(dbId, "No orderId");
            throw new Error("No orderId returned from MetaAPI");
          }
          let filledLots = safeLots;
          try {
            const posId = orderResult.positionId || orderResult.orderId;
            if (posId) {
              if (conn.getPosition) {
                const actualPos = await conn.getPosition(posId);
                if (actualPos && typeof actualPos.volume === "number") {
                  filledLots = actualPos.volume;
                  logger.info(`[DiscretionaryTrader] Verified filled volume from MetaAPI position: ${filledLots} lots.`,);
                }
              }
            }
          } catch (posErr) {
            logger.error(`[DiscretionaryTrader] Could not fetch position ${orderResult.positionId || orderResult.orderId} to verify filled lots, defaulting to safeLots. Error:`,
              posErr.message,);
          }
          await db
            .prepare(
              "UPDATE bot_trade_states SET meta_order_id = ?, status = 'OPEN', lots = ? WHERE id = ?",
            )
            .run(orderResult.orderId, filledLots, dbId);
          state.seerTradeTakenToday = true;
          state.activeTrade = {
            dbId,
            metaOrderId: orderResult.orderId,
            clientId,
            magic,
            botId: orch.getBotIdForSetup(setupType),
            direction: result.decision,
            entryPrice: freshEntry,
            slPrice: result.stopLoss,
            originalSl: result.stopLoss,
            tpPrice: result.takeProfit,
            riskPips: actualSlPips,
            highestPrice: freshEntry,
            lowestPrice: freshEntry,
            isTrailing: false,
            volume: filledLots,
            hasTakenPartial: false,
            unconfirmedSwingLow: null,
            unconfirmedSwingHigh: null,
            lastSwingHigh: null,
            lastSwingLow: null,
            lastConfirmedSL: cleanSl,
            secondLastConfirmedSL: cleanSl,
            lastConfirmedSH: cleanSl,
            secondLastConfirmedSH: cleanSl,
            openTime: c.timestamp,
            lastFcEstHour: c.estHour,
          };
          globalTradeGate.register(
            orch.profileId,
            orderResult.orderId,
            brokerSymbol,
            result.decision,
            "DISC",
          );
          const baseSymbol = PairConfigManager.getBaseSymbol(symbol);
          const dateStr = c.dateStr.split(" ")[0];
          globalTradeGate.registerSessionDirection({
            botId: "SEER",
            symbol: baseSymbol,
            direction: result.decision as "BUY" | "SELL",
            entryPrice: freshEntry,
            slPrice: cleanSl,
            tpPrice: cleanTp,
            session: windowName,
            dateStr: dateStr,
            leadProfileId: orch.profileId,
            isFilled: true
          });
          logger.info(`[DiscretionaryTrader] ✅ Order ${orderResult.orderId} placed successfully for ${brokerSymbol}.`,);
        } catch (execErr) {
          if (isConnectionError(execErr)) {
            logger.error(`[DiscretionaryTrader] Connection error during trade execution for ${brokerSymbol}: ${execErr.message}. Transitioning trade ${dbId} to PENDING_VERIFICATION.`,);
            await db
              .prepare(
                "UPDATE bot_trade_states SET status = 'PENDING_VERIFICATION' WHERE id = ?",
              )
              .run(dbId);
            addBotLog(
              orch.profileId,
              botId2,
              brokerSymbol,
              `Execution Warning`,
              `Connection error: ${execErr.message}. Set to PENDING_VERIFICATION.`,
            );
          } else {
            logger.error(`[DiscretionaryTrader] \u274C Execution failed for ${brokerSymbol}:`,
              execErr.message,);
            addBotLog(
              orch.profileId,
              botId2,
              brokerSymbol,
              "Error",
              `Trade Execution Failed: ${execErr.message}`,
            );
          }
        }
      }
    }
  } catch (e: any) {
    logger.error(`[DiscretionaryTrader] ❌ AI Eval Error:`, e.stack);
    addBotLog(
      orch.profileId,
      orch.getBotIdForSetup(setupType),
      symbol,
      "Error",
      `AI Eval Error: ${e.stack}`,
    );
  } finally {
    state.isEvaluating = false;
    state.isPlacing = false;
    globalTradeGate.clearDiscEvaluating(orch.profileId, symbol);
  }
}

export async function runSeerBot(
  orch: any,
  symbol: string,
  state: any,
  prevDay2: any,
) {
  if (!prevDay2) return;

  // Build the list of setup types active for today's daily context.
  // Order matters: FRD/FGD first (highest conviction), then DAY3, then LHF/INSIDE_DAY.
  const setupTypes: string[] = [];
  if (prevDay2.isFirstRedDay)        setupTypes.push("FRD");
  if (prevDay2.isFirstGreenDay)      setupTypes.push("FGD");
  if (prevDay2.isDay3BreakoutLongs)  setupTypes.push("DAY3_LONG");
  if (prevDay2.isDay3BreakoutShorts) setupTypes.push("DAY3_SHORT");
  if (prevDay2.isInsideDay)          setupTypes.push("INSIDE_DAY");
  if (prevDay2.isTrendingLong)       setupTypes.push("LHF_LONG");
  if (prevDay2.isTrendingShort)      setupTypes.push("LHF_SHORT");

  // Fall back to FRD if no daily context has been classified yet.
  if (setupTypes.length === 0) setupTypes.push("FRD");

  for (const setupType of setupTypes) {
    // One trade per day per symbol — stop as soon as one fires.
    if (state.seerTradeTakenToday) break;
    await runPreFlightFilter(orch, symbol, state, prevDay2, setupType);
  }
}

export async function evaluateSeerTrailingOnTick(orch, symbol, state) {

  const seerConfigArray = (orch as any).__CUSTOM_SEER_CONFIGS__ || PairConfigManager.getSeerConfigs(symbol);
  const seerConfig = (seerConfigArray && seerConfigArray.length > 0) ? seerConfigArray[0] : state.config;
  if (state.activeTrade?.manuallyModified) return;
  const trade = state.activeTrade;
  if (!trade) return;

  const len = state.m5Buffer.length;
  if (len < 5) return;
  const c0 = state.m5Buffer[len - 1];
  const c1 = state.m5Buffer[len - 2];
  const c2 = state.m5Buffer[len - 3];
  const c3 = state.m5Buffer[len - 4];
  const c4 = state.m5Buffer[len - 5];

  const currentTime = c0.timestamp;
  const newsCheck = isNewsBlackout(symbol, new Date(currentTime));
  const isNewsForceClose = newsCheck.blocked;

  const prevFcHour = trade.lastFcEstHour !== undefined ? trade.lastFcEstHour : c0.estHour;
  trade.lastFcEstHour = c0.estHour;
  const is1700Rollover = prevFcHour !== -1 && ((prevFcHour < 17 && c0.estHour >= 17) || (prevFcHour > c0.estHour && c0.estHour >= 17));

  if (isNewsForceClose || is1700Rollover) {
      const closeReason = isNewsForceClose ? `News Force Close: ${newsCheck.reason}` : `EOD Rollover Force Close`;
      logger.info(`[DiscretionaryTrader] ⛔ SEER Force Close (${isNewsForceClose ? 'News' : 'EOD'}) for ${symbol}.`);
      try {
        await enqueueMetaApiRequest(
          async () => (await getSharedConnection(orch.token, orch.accountId)).closePosition(trade.metaOrderId),
          `SeerForceClose:${symbol}`,
          undefined,
          undefined,
          orch.profileId
        );
        db.prepare("UPDATE bot_trade_states SET status = 'CLOSED' WHERE id = ?").run(trade.dbId);
        orch.addEyeFeedEvent({
          type: "FORCE_CLOSE",
          symbol,
          bot_id: trade.botId,
          data: { decision: "CLOSE", setupType: "Seer", reasoning: closeReason }
        });
        state.activeTrade = undefined;
      } catch(e) {}
      return;
  }
  let shouldUpdateSl = false;
  let newSl = trade.slPrice;
  const optCfg = OPTIMIZER_CONFIG[symbol.replace(".Daily", "")];
    const pipSize = getDynamicPipSize(symbol);
    const askSpread = (optCfg ? optCfg.spread : 0) * pipSize;
  if (!trade.hasTakenPartial) {
    const isBuy = trade.direction === "BUY";
    const profitPips = isBuy
      ? (c0.high - trade.entryPrice) / pipSize
      : (trade.entryPrice - (c0.low + askSpread)) / pipSize;
    const profitR = profitPips / trade.riskPips;
    if (profitR >= 1.5) {
      trade.hasTakenPartial = true;
      let swap = 0;
      let commission = 0;
      try {
        await enqueueMetaApiRequest(async () => {
          const conn = await getSharedConnection(orch.token, orch.accountId);
          if (conn.getPosition) {
            const pos = await conn.getPosition(trade.metaOrderId);
            if (pos) {
              swap = pos.swap || 0;
              commission = pos.commission || 0;
            }
          }
        }, `SeerGetPosition:${symbol}`, undefined, undefined, orch.profileId);
      } catch (e) {
        logger.info(`[DiscretionaryTrader] Could not fetch position ${trade.metaOrderId} to get swap/commissions:`,
          e.message,);
      }
      const totalFees = swap + commission;
      let feeOffsetPips = 0;
      if (totalFees < 0) {
        const spec = getSymbolSpec(symbol);
        const pipValue = pipSize * (trade.volume * spec.pipValuePerLot);
        feeOffsetPips = Math.abs(totalFees) / pipValue;
      }
      const beOffset = (2 + feeOffsetPips) * pipSize;
      let bePrice = isBuy
        ? trade.entryPrice + beOffset
        : trade.entryPrice - beOffset;
      let moveSl = false;
      if (isBuy && trade.slPrice < bePrice) moveSl = true;
      else if (!isBuy && trade.slPrice > bePrice) moveSl = true;
      try {
        const conn = await getSharedConnection(orch.token, orch.accountId);
        if (trade.volume >= 0.02) {
          const halfVolume = Math.floor((trade.volume / 2) * 100) / 100;
          if (halfVolume >= 0.01) {
            const partialResult = await enqueueMetaApiRequest(
              async () =>
                (
                  await getSharedConnection(orch.token, orch.accountId)
                ).closePositionPartially(trade.metaOrderId, halfVolume, {}),
              `ClosePartial:${symbol}`,
              undefined,
              undefined,
              orch.profileId
            );
            if (
              partialResult?.positionId &&
              partialResult.positionId !== trade.metaOrderId
            ) {
              const newTicket = partialResult.positionId;
              logger.info(`[DiscretionaryTrader] \u26A0\uFE0F ${symbol} MT4 ticket split! Old: ${trade.metaOrderId} \u2192 New: ${newTicket}. Re-hydrating.`,);
              const oldTicket = trade.metaOrderId;
              trade.metaOrderId = newTicket;
              const db2 = db;
              await db2
                .prepare(
                  "UPDATE bot_trade_states SET meta_order_id = ? WHERE meta_order_id = ?",
                )
                .run(newTicket, oldTicket);
            }
            logger.info(`[DiscretionaryTrader] \u{1F4B0} ${symbol} hit 1.5R! Took partial profit of ${halfVolume} lots.`,);
          }
        } else {
          logger.info(`[DiscretionaryTrader] \u{1F6E1}\uFE0F ${symbol} hit 1.5R! Volume ${trade.volume} is too small to split. Moving SL to BE+2.`,);
        }
        if (moveSl) {
          trade.slPrice = bePrice;
          trade.lastConfirmedSL = bePrice;
          trade.secondLastConfirmedSL = bePrice;
          trade.lastConfirmedSH = bePrice;
          trade.secondLastConfirmedSH = bePrice;
          newSl = bePrice;
          const roundedBe = roundPrice(bePrice, symbol);
          if (!trade.isVirtualSlMode) {
            await enqueueMetaApiRequest(
              async () =>
                (
                  await getSharedConnection(orch.token, orch.accountId)
                ).modifyPosition(
                  trade.metaOrderId,
                  roundedBe,
                  trade.tpPrice,
                ),
              `ModifyPos:${symbol}`,
              undefined,
              undefined,
              orch.profileId
            );
          }
          const db2 = db;
          await db2
            .prepare(
              "UPDATE bot_trade_states SET sl_price = ?, t1_hit = 1 WHERE meta_order_id = ?",
            )
            .run(roundedBe, trade.metaOrderId);
          logger.info(`[DiscretionaryTrader] \u{1F6E1}\uFE0F ${symbol} Stop Loss moved to Break-Even + 2 pips (${roundedBe}).`,);
        } else {
          const db2 = db;
          await db2
            .prepare(
              "UPDATE bot_trade_states SET t1_hit = 1 WHERE meta_order_id = ?",
            )
            .run(trade.metaOrderId);
        }
      } catch (e) {
        logger.error(`[DiscretionaryTrader] \u274C Failed to apply 1.5R Partial Profit / BE for ${symbol}:`,
          e.message,);
        addBotLog(
          orch.profileId,
          trade.botId || "seer",
          symbol,
          "Error",
          `Partial profit execution failed: ${e.message}`,
        );
      }
    }
  }
  if (trade.direction === "BUY") {
    if (
      c2.low < c0.low &&
      c2.low < c1.low &&
      c2.low < c3.low &&
      c2.low < c4.low
    ) {
      trade.unconfirmedSwingLow = c2.low;
    }
    if (
      c2.high > c0.high &&
      c2.high > c1.high &&
      c2.high > c3.high &&
      c2.high > c4.high
    ) {
      trade.lastSwingHigh = c2.high;
    }
    if (trade.lastSwingHigh !== null && trade.unconfirmedSwingLow !== null) {
      if (c0.close > trade.lastSwingHigh) {
        if (trade.unconfirmedSwingLow !== trade.lastConfirmedSL) {
          trade.secondLastConfirmedSL = trade.lastConfirmedSL;
          trade.lastConfirmedSL = trade.unconfirmedSwingLow;
          if (trade.secondLastConfirmedSL > trade.slPrice) {
            newSl = trade.secondLastConfirmedSL - pipSize;
            shouldUpdateSl = true;
          }
        }
      }
    }
  } else if (trade.direction === "SELL") {
    if (
      c2.high > c0.high &&
      c2.high > c1.high &&
      c2.high > c3.high &&
      c2.high > c4.high
    ) {
      trade.unconfirmedSwingHigh = c2.high;
    }
    if (
      c2.low < c0.low &&
      c2.low < c1.low &&
      c2.low < c3.low &&
      c2.low < c4.low
    ) {
      trade.lastSwingLow = c2.low;
    }
    if (trade.lastSwingLow !== null && trade.unconfirmedSwingHigh !== null) {
      if (c0.close < trade.lastSwingLow) {
        if (trade.unconfirmedSwingHigh !== trade.lastConfirmedSH) {
          trade.secondLastConfirmedSH = trade.lastConfirmedSH;
          trade.lastConfirmedSH = trade.unconfirmedSwingHigh;
          if (trade.secondLastConfirmedSH < trade.slPrice) {
            newSl = trade.secondLastConfirmedSH + pipSize;
            shouldUpdateSl = true;
          }
        }
      }
    }
  }
  if (shouldUpdateSl) {
    const roundedNewSl = roundPrice(newSl, symbol);
    trade.slPrice = roundedNewSl;
    try {
      if (!trade.isVirtualSlMode) {
        await enqueueMetaApiRequest(
          async () =>
            (
              await getSharedConnection(orch.token, orch.accountId)
            ).modifyPosition(
              trade.metaOrderId,
              roundedNewSl,
              trade.tpPrice,
            ),
          `ModifyPos:${symbol}`,
          undefined,
          undefined,
          orch.profileId
        );
      }
      const db2 = db;
      const seerHighest = trade.direction === "BUY"
        ? Math.max(trade.highestPrice || trade.entryPrice, c0.high)
        : (trade.highestPrice || trade.entryPrice);
      const seerLowest = trade.direction === "SELL"
        ? Math.min(trade.lowestPrice || trade.entryPrice, c0.low)
        : (trade.lowestPrice || trade.entryPrice);
      trade.highestPrice = seerHighest;
      trade.lowestPrice = seerLowest;
      await db2
        .prepare(
          "UPDATE bot_trade_states SET sl_price = ?, highest_price = ?, lowest_price = ? WHERE meta_order_id = ?",
        )
        .run(newSl, seerHighest, seerLowest, trade.metaOrderId);
      logger.info(`[DiscretionaryTrader] \u{1F6E1}\uFE0F ${symbol} Structural BOS Confirmed! Trailing SL moved to ${newSl}`,);
    } catch (e) {
      logger.error(`[DiscretionaryTrader] \u274C Failed to structurally trail SL for ${symbol}:`,
        e.message,);
      addBotLog(
        orch.profileId,
        trade.botId || "seer",
        symbol,
        "Error",
        `Trailing SL execution failed: ${e.message}`,
      );
    }
  }
}
