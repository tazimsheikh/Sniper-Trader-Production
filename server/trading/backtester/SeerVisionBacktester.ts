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
import path from "path";
import fs from "fs";
import { loadCsv } from "./loadCsv.js";
import { aggregateCandles } from "../market/CandleAggregator.js";
import { buildEmaArray } from "../market/Indicators.js";
import { DailyContextTracker } from "../market/DailyContextTracker.js";
import { PromptVault } from "../ai/PromptVault.js";
import { renderChart, getChartWindow } from "../ai/ChartRenderer.js";
import { VisionEvaluator, VisionDecision } from "../ai/VisionEvaluator.js";
import { SEER_PAIR_CONFIG } from "../config/PairConfig.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { isTradeAllowed } from "../market/MathFilters.js";
import { getFixedEstDate } from "./math_core/MathCoreUtils.js";

interface VisionTradeRecord {
  timestamp: number; // Precise epoch ms of the trigger candle — used for chronological cross-pair compounding
  date: string;
  pair: string;
  setupType: string;
  sessionName: string;
  decision: VisionDecision["decision"];
  confidence: number;
  setupQuality: string;
  reasoning: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskPips: number | null;
  // Simulated outcome
  outcome: "TP" | "SL" | "EOD" | "SKIPPED" | null;
  pips: number | null;
  mfePips?: number | null;
}

const CONFIDENCE_THRESHOLD = 0.7; // Only trade if AI is >= 70% confident
const CHART_WINDOW_BARS = 120; // Expanded to 10 hours of M5 candles to capture macro PDH/PDL

export async function runVisionBacktest(
  pair: string,
  apiKey: string,
  startDate?: string, // e.g. '2025-01-01'
  endDate?: string, // e.g. '2025-12-31'
) {
  const config = SEER_PAIR_CONFIG[pair]?.[0];
  if (!config) throw new Error(`Unknown pair: ${pair}`);

  const baseSymbol = pair.replace(/\.daily$/i, "");
  const optConfig = OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[baseSymbol] || OPTIMIZER_CONFIG[baseSymbol.toUpperCase()];
  if (!optConfig) throw new Error(`No OPTIMIZER_CONFIG found for ${pair}`);

  const tickSize = optConfig.tickSize !== undefined ? optConfig.tickSize : 0.0001;
  const pipSize = optConfig.pipSize !== undefined ? optConfig.pipSize : tickSize * 10;
  const spread = optConfig.spread !== undefined ? optConfig.spread : 1.5;
  const askSpread = spread * pipSize;

  // Load data
  const csvFiles = fs
    .readdirSync(path.join(process.cwd(), "data", "csv"))
    .filter((f) => f.startsWith(pair) && f.endsWith(".csv"));
  if (!csvFiles.length) throw new Error(`No CSV data found for ${pair}`);

  console.log(`🔱 Vision AI Backtest — ${pair}`);
  console.log(`📁 Loading: ${csvFiles[0]}`);
  const startD = startDate
    ? new Date(new Date(startDate).getTime() - 15 * 24 * 60 * 60 * 1000)
    : undefined;
  const endD = endDate ? new Date(endDate) : undefined;
  const m1Rows = await loadCsv(
    path.join(process.cwd(), "data", "csv", csvFiles[0]),
    spread,
    startD,
    endD,
  );
  let m5Candles = aggregateCandles(m1Rows, 5);
  let emaArr = buildEmaArray(m5Candles, 20);

  // Filter to date range if specified
  let globalStartIdx = 0;
  let globalEndIdx = m5Candles.length - 1;
  if (startDate || endDate) {
    const start = startDate ? new Date(startDate).getTime() : 0;
    const end = endDate ? new Date(endDate).getTime() + 86400000 : Infinity;
    globalStartIdx = m5Candles.findIndex((c) => c.timestamp >= start);
    if (globalStartIdx === -1) globalStartIdx = 0;

    globalEndIdx = m5Candles.length - 1;
    while (globalEndIdx >= 0 && m5Candles[globalEndIdx].timestamp >= end)
      globalEndIdx--;

    console.log(
      `📅 Date range: ${startDate || "start"} → ${endDate || "end"} (Trading starts at index ${globalStartIdx})`,
    );
  }

  console.log(`🕯️  ${m5Candles.length.toLocaleString()} M5 candles loaded`);

  const dailyTracker = new DailyContextTracker();
  const evaluator = new VisionEvaluator(apiKey);

  const records: VisionTradeRecord[] = [];
  let day3High = -Infinity;
  let day3Low = Infinity;
  let lastEstHour = -1;
  let sessionTradeTaken = false;
  let aiLockoutUntil = 0;

  // Local DWCB Tracking (Per-Pair for Backtester)
  let localBalance = 10000;
  let localPeak = 10000;
  let dwcbTriggered = false;

  const isJpyOrGold = pair.includes("JPY") || pair === "XAUUSD";
  const isEurOrGbp =
    pair.includes("EUR") || pair.includes("GBP") || pair.includes("CHF");
  const isUsd = pair.includes("USD") || pair.includes("CAD");
  const isIndex = !isJpyOrGold && !isEurOrGbp && !isUsd; // NAS100, US30, etc.

  for (let i = 20; i < m5Candles.length - 50; i++) {
    const c = m5Candles[i];
    dailyTracker.processCandle(c);

    // If we have a startDate filter, skip trading until we reach the correct index,
    // but we still process the dailyTracker above to build historical context.
    if (i < globalStartIdx || i > globalEndIdx) continue;

    // Day rollover at 5 PM EST (17:00)
    if (
      lastEstHour !== -1 &&
      ((lastEstHour < 17 && c.estHour >= 17) ||
        (lastEstHour > c.estHour && c.estHour >= 17))
    ) {
      day3High = -Infinity;
      day3Low = Infinity;
      sessionTradeTaken = false;
    }
    const day3HighBeforeC = day3High;
    const day3LowBeforeC = day3Low;
    if (c.high > day3High) day3High = c.high;
    if (c.low < day3Low) day3Low = c.low;
    lastEstHour = c.estHour;

    if (sessionTradeTaken) continue; // One trade per session

    const prevDay = dailyTracker.getPreviousDayContext();
    if (!prevDay) continue;
    // if (!prevDay.isFirstRedDay && !prevDay.isFirstGreenDay) continue; // Removed to allow DAY3, INSIDE_DAY, LHF

    // ── SESSION WINDOW CHECK — dynamic check from config ────────
    const isAsia = c.estHour >= 20 && c.estHour < 23; // 8PM-11PM EST (Tokyo/Sydney)
    const isLondon = c.estHour >= 2 && c.estHour < 5; // 2AM-5AM EST (Frankfurt/London open)
    const isNY = c.estHour >= 8 && c.estHour < 11; // 8AM-11AM EST (NY open)

    let inWindow = false;
    const sessList = config.sessions || [config.session];
    for (const session of sessList) {
      if (session === "asia" && isAsia) inWindow = true;
      if (session === "london" && isLondon) inWindow = true;
      if (session === "NY_Forex" && isNY) inWindow = true;
    }

    if (!inWindow) continue;
    if (c.timestamp < aiLockoutUntil) continue; // 🛡️ 15-minute cooldown after any AI eval

    let setupType: string | null = null;
    if (prevDay.isFirstRedDay) setupType = "FRD";
    else if (prevDay.isFirstGreenDay) setupType = "FGD";
    else if (prevDay.isDay3BreakoutLongs) setupType = "DAY3_LONG";
    else if (prevDay.isDay3BreakoutShorts) setupType = "DAY3_SHORT";
    else if (prevDay.isInsideDay) setupType = "INSIDE_DAY";
    else if (prevDay.isTrendingLong) setupType = "LHF_LONG";
    else if (prevDay.isTrendingShort) setupType = "LHF_SHORT";

    if (!setupType) continue;

    // 🔪 SURGICAL PAIR BANS 🔪
    // Reversals (FRD, FGD) strictly banned for Indices and Gold
    if (
      (setupType === "FRD" || setupType === "FGD") &&
      (pair.includes("NAS100") || pair.includes("XAUUSD"))
    )
      continue;
    // Inside Day strictly banned for Gold
    if (setupType === "INSIDE_DAY" && pair.includes("XAUUSD")) continue;

    // ── SURGICAL PAIR BANS (From PromptVault.ts) ────────
    // 1. GBPJPY & GBPCAD Inside Day false breaks strictly banned.
    if (setupType === "INSIDE_DAY" && (pair === "GBPJPY" || pair === "GBPCAD"))
      continue;
    // 2. USDJPY, EURJPY Asia session banned.
    if (isAsia && (pair === "USDJPY" || pair === "EURJPY")) continue;
    // 3. EURUSD NY afternoon dead zone (after 14:00 EST) banned.
    if (c.estHour >= 14 && pair === "EURUSD") continue;

    const ema20 = emaArr[i];
    const prevC = m5Candles[i - 1];
    if (!ema20 || !prevC) continue;

    // Load dynamically from config, fallback to default calculations
    let minBodyPips = config.minBodyPips;
    if (minBodyPips === undefined) {
      minBodyPips = 3.0; // Default for GBPUSD/EURUSD
      if (pair.includes("XAU")) minBodyPips = 20.0;
      else if (pair.includes("NAS")) minBodyPips = 20.0;
      else if (pair.includes("US30") || pair.includes("GER40"))
        minBodyPips = 20.0;
      else if (pair.includes("BTC")) minBodyPips = 7.5;
      else if (pair.includes("ETH")) minBodyPips = 2.0;
      else if (
        pair.includes("JPY") ||
        pair.includes("AUD") ||
        pair.includes("NZD") ||
        pair.includes("CAD")
      )
        minBodyPips = 5.0;
    }

    const pinBarWickBodyRatio =
      config.pinBarWickBodyRatio !== undefined
        ? config.pinBarWickBodyRatio
        : 1.5;

    const cTotalPips = Math.abs(c.high - c.low) / pipSize;
    const cBodyPips = Math.abs(c.close - c.open) / pipSize;
    const upperWickPips = (c.high - Math.max(c.open, c.close)) / pipSize;
    const lowerWickPips = (Math.min(c.open, c.close) - c.low) / pipSize;

    // Engulfing definitions
    const isBearishEngulfing =
      c.close < c.open &&
      prevC.close > prevC.open &&
      c.open >= prevC.close &&
      c.close <= prevC.open &&
      cBodyPips >= minBodyPips;
    const isBullishEngulfing =
      c.close > c.open &&
      prevC.close < prevC.open &&
      c.open <= prevC.close &&
      c.close >= prevC.open &&
      cBodyPips >= minBodyPips;

    // Pin Bar definitions
    const isBearishPin =
      upperWickPips >= cBodyPips * pinBarWickBodyRatio &&
      upperWickPips >= minBodyPips &&
      lowerWickPips <= Math.max(2.0, cBodyPips);
    const isBullishPin =
      lowerWickPips >= cBodyPips * pinBarWickBodyRatio &&
      lowerWickPips >= minBodyPips &&
      upperWickPips <= Math.max(2.0, cBodyPips);

    const isBearishTrigger = isBearishEngulfing || isBearishPin;
    const isBullishTrigger = isBullishEngulfing || isBullishPin;

    let isEngulfing = false;
    let expectedDirection = "";

    const peakTolerance = 10 * pipSize; // Loosened from 1 pip to 10 pips

    if (setupType === "FRD" || setupType === "DAY3_LONG") {
      if (isBearishTrigger) {
        expectedDirection = "SELL";
        if (setupType === "DAY3_LONG") {
          if (
            day3HighBeforeC !== -Infinity &&
            (prevC.high >= day3HighBeforeC - peakTolerance ||
              c.high >= day3HighBeforeC - peakTolerance)
          )
            isEngulfing = true;
        } else {
          if (c.high > prevDay.high - (prevDay.high - prevDay.low) * 0.3)
            isEngulfing = true;
        }
      }
      // SUPPORT DELIBERATE FRD REVERSALS AT THE LOW
      if (setupType === "FRD" && isBullishTrigger) {
        expectedDirection = "BUY";
        if (c.low < prevDay.low + (prevDay.high - prevDay.low) * 0.3)
          isEngulfing = true;
      }
    } else if (setupType === "FGD" || setupType === "DAY3_SHORT") {
      if (isBullishTrigger) {
        expectedDirection = "BUY";
        if (setupType === "DAY3_SHORT") {
          if (
            day3LowBeforeC !== Infinity &&
            (prevC.low <= day3LowBeforeC + peakTolerance ||
              c.low <= day3LowBeforeC + peakTolerance)
          )
            isEngulfing = true;
        } else {
          if (c.low < prevDay.low + (prevDay.high - prevDay.low) * 0.3)
            isEngulfing = true;
        }
      }
      // SUPPORT DELIBERATE FGD REVERSALS AT THE HIGH
      if (setupType === "FGD" && isBearishTrigger) {
        expectedDirection = "SELL";
        if (c.high > prevDay.high - (prevDay.high - prevDay.low) * 0.3)
          isEngulfing = true;
      }
    } else if (setupType === "INSIDE_DAY") {
      if (isBearishTrigger) {
        if (prevC.high > prevDay.high || c.high > prevDay.high) {
          isEngulfing = true;
          expectedDirection = "SELL";
        }
      } else if (isBullishTrigger) {
        if (prevC.low < prevDay.low || c.low < prevDay.low) {
          isEngulfing = true;
          expectedDirection = "BUY";
        }
      }
    } else if (setupType === "LHF_LONG") {
      expectedDirection = "BUY";
      if (isBullishTrigger && c.low <= ema20 && c.close > ema20) {
        isEngulfing = true;
      }
    } else if (setupType === "LHF_SHORT") {
      expectedDirection = "SELL";
      if (isBearishTrigger && c.high >= ema20 && c.close < ema20) {
        isEngulfing = true;
      }
    }

    if (!isEngulfing) continue;

    if (!isTradeAllowed({ pair, setupType, timestamp: c.timestamp })) continue;

    // ── Generate chart image ────────────────────────────────────
    const { candles: windowCandles, startIdx } = getChartWindow(
      m5Candles,
      i,
      CHART_WINDOW_BARS,
    );
    const windowEmas = emaArr.slice(startIdx, i + 1);

    // Find session start/end indices within the window
    const sessionStartOffset = windowCandles.findIndex((wc) => {
      if (isLondon) return wc.estHour >= 1;
      if (isNY) return wc.estHour >= 7;
      if (isAsia) return wc.estHour >= 19;
      return false;
    });

    const chartBuffer = renderChart({
      candles: windowCandles,
      emaValues: Array.from(windowEmas),
      prevDayHigh: prevDay.high,
      prevDayLow: prevDay.low,
      currentDayHigh: day3High,
      currentDayLow: day3Low,
      setupType: setupType as any,
      pair,
      sessionName: isLondon
        ? "London Open"
        : isNY
          ? "New York Open"
          : "Asia Open",
      sessionStartIdx: sessionStartOffset,
      sessionEndIdx: windowCandles.length - 1,
    });

    // ── Ask Vision AI ───────────────────────────────────────────
    console.log(
      `\n👁️  [${getFixedEstDate(new Date(c.timestamp)).toISOString().split("T")[0]}] ${pair} ${setupType} — Asking Vision AI...`,
    );

    const sessionLabel = isLondon
      ? "London Open"
      : isNY
        ? "New York Open"
        : "Asia Open";
    const candleTimeEST = `${String(c.estHour).padStart(2, "0")}:${String(new Date(c.timestamp).getUTCMinutes()).padStart(2, "0")} EST`;

    // INJECT THE SURGICAL PROMPT
    const surgicalSystemPrompt = PromptVault.getSurgicalPrompt(pair, setupType);

    // CALCULATE MATHEMATICAL CONTEXT
    const currentPrice = c.close;
    const distanceToPdhPips = Math.abs(prevDay.high - currentPrice) / pipSize;
    const distanceToPdlPips = Math.abs(currentPrice - prevDay.low) / pipSize;
    const distanceToSessionHighPips =
      Math.abs(day3High - currentPrice) / pipSize;
    const distanceToSessionLowPips = Math.abs(currentPrice - day3Low) / pipSize;

    let dailyMacroBias = "NEUTRAL";
    if (prevDay.isTrendingShort || prevDay.isFirstRedDay)
      dailyMacroBias = "STRONG_BEARISH";
    if (prevDay.isTrendingLong || prevDay.isFirstGreenDay)
      dailyMacroBias = "STRONG_BULLISH";

    const evalDecision = await evaluator.evaluate(
      chartBuffer,
      {
        pair,
        setupType,
        sessionName: sessionLabel,
        candleTimeEST,
        prevDayHigh: prevDay.high,
        prevDayLow: prevDay.low,
        currentDayHigh: day3High,
        currentDayLow: day3Low,
        ema20Current: ema20,
        tickSize,
        currentPrice,
        dailyMacroBias,
        distanceToPdhPips,
        distanceToPdlPips,
        distanceToSessionHighPips,
        distanceToSessionLowPips,
      },
      surgicalSystemPrompt,
    );

    // ── Simulate hypothetical trade outcome ─────────────────────
    if (!evalDecision) {
      console.log(`   ❌ Vision AI failed or timed out. Skipping.`);
      aiLockoutUntil = c.timestamp + 15 * 60_000; // Still lockout on API failure to prevent retry spam
      continue;
    }

    aiLockoutUntil = c.timestamp + 15 * 60_000; // 🛡️ 15-minute cooldown applied immediately

    console.log(
      `   Decision: ${evalDecision.decision} | Confidence: ${(evalDecision.confidence * 100).toFixed(0)}% | Quality: ${evalDecision.setupQuality}`,
    );
    console.log(`   "${evalDecision.reasoning}"`);

    const record: VisionTradeRecord & {
      hypotheticalOutcome?: string;
      hypotheticalPips?: number;
    } = {
      timestamp: c.timestamp,
      date: getFixedEstDate(new Date(c.timestamp)).toISOString().split("T")[0],
      pair,
      setupType,
      sessionName: isLondon
        ? "London Open"
        : isNY
          ? "New York Open"
          : "Asia Open",
      decision: evalDecision.decision,
      confidence: evalDecision.confidence,
      setupQuality: String(evalDecision.setupQuality),
      reasoning: evalDecision.reasoning,
      entry: evalDecision.entry,
      stopLoss: evalDecision.stopLoss,
      takeProfit: evalDecision.takeProfit,
      riskPips: evalDecision.riskPips,
      outcome: null,
      pips: null,
    };

    const direction =
      evalDecision.decision === "NO_TRADE"
        ? expectedDirection
        : evalDecision.decision;
    let isSkipped =
      evalDecision.decision === "NO_TRADE" ||
      evalDecision.confidence < CONFIDENCE_THRESHOLD;
    const entry = direction === "SELL" ? c.close : c.close + askSpread;
    // Dynamic Volatility Scaling (Gold and Indices move more than Forex)
    const isVolatile =
      pair.includes("XAU") ||
      pair.includes("NAS") ||
      pair.includes("US30") ||
      pair.includes("GER40") ||
      pair.includes("GBPJPY") ||
      pair.includes("GBPCAD");
    let minSlDist =
      config.minSlDist !== undefined
        ? config.minSlDist * pipSize
        : (isVolatile ? 40 : 20) * pipSize;
    let maxPips = 40;
    if (pair.includes("XAU")) maxPips = 100;
    else if (
      pair.includes("NAS") ||
      pair.includes("US30") ||
      pair.includes("GER40")
    )
      maxPips = 250;
    const maxSlDist = maxPips * pipSize;

    // --- Smart Structural Stop Loss (Matches DiscretionaryTraderOrchestrator.ts) ---
    // Uses the local trap peak (the actual Mouse/Engulfing formation), plus a 10 pip buffer.
    const trapPrevC = m5Candles[i - 1];
    const trapHigh = Math.max(c.high, trapPrevC.high);
    const trapLow = Math.min(c.low, trapPrevC.low);
    let sl =
      direction === "SELL"
        ? trapHigh + askSpread + 10 * pipSize
        : trapLow - 10 * pipSize;

    // Smart Cascading Take Profit
    const minTpDist = (isVolatile ? 40 : 20) * pipSize;
    const defaultTpDist = (isVolatile ? 100 : 40) * pipSize;
    const maxTpDist = (isVolatile ? 100 : 50) * pipSize;
    let tp = entry;

    if (direction === "SELL") {
      if (entry - day3Low >= minTpDist)
        tp = Math.max(day3Low, entry - maxTpDist);
      else if (entry - prevDay.low >= minTpDist)
        tp = Math.max(prevDay.low, entry - maxTpDist);
      else tp = entry - defaultTpDist;
    } else {
      if (day3High - entry >= minTpDist)
        tp = Math.min(day3High, entry + maxTpDist);
      else if (prevDay.high - entry >= minTpDist)
        tp = Math.min(prevDay.high, entry + maxTpDist);
      else tp = entry + defaultTpDist;
    }

    // Reject if structural SL is too wide (> 40 pips)
    const slDist = Math.abs(entry - sl);
    if (!isSkipped && slDist > maxSlDist) {
      console.log(
        `   [REJECTED] Structural SL is too wide: ${(slDist / pipSize).toFixed(1)} pips (> ${maxSlDist / pipSize} pips). Skipping trade.`,
      );
      isSkipped = true;
    }

    // Enforce minimum 20 pip SL
    if (direction === "SELL" && sl < entry + minSlDist) sl = entry + minSlDist;
    if (direction === "BUY" && sl > entry - minSlDist) sl = entry - minSlDist;

    const riskPips = Math.abs(entry - sl) / pipSize;

    let outcome: "TP" | "SL" | "EOD" = "EOD";
    let exitPrice = entry;

    // Structural Trailing Stop Tracking
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

      // EOD close at 16:50 EST (Death Zone Sweeper)
      const fcMin = new Date(fc.timestamp).getUTCMinutes();
      if (fc.estHour >= 17 || (fc.estHour === 16 && fcMin >= 50)) {
        outcome = "EOD";
        exitPrice = direction === "SELL" ? fc.close + askSpread : fc.close;
        break;
      }

      // Fix Bid/Ask Asymmetry
      const profitPips =
        direction === "SELL"
          ? (entry - (fc.low + askSpread)) / pipSize
          : (fc.high - entry) / pipSize;
      if (profitPips > highestProfitPips) highestProfitPips = profitPips;

      if (!hasTakenPartial && profitPips >= 1.5 * riskPips) {
        hasTakenPartial = true;
        const bePips = 2.0; // Break even + 2 pips
        const bePrice =
          direction === "SELL"
            ? entry - bePips * pipSize
            : entry + bePips * pipSize;

        let moveSl = false;
        if (direction === "BUY" && sl < bePrice) moveSl = true;
        else if (direction === "SELL" && sl > bePrice) moveSl = true;

        if (moveSl) {
          sl = bePrice;
          currentSl = bePrice; // <-- Crucial Fix!
          lastConfirmedSL = sl;
          secondLastConfirmedSL = sl;
          lastConfirmedSH = sl;
          secondLastConfirmedSH = sl;
          console.log(
            `   [1.5R HIT] Partial 50% secured. SL moved to BE+2 (${sl.toFixed(5)}).`,
          );
        } else {
          console.log(
            `   [1.5R HIT] Partial 50% secured. (SL already better than BE).`,
          );
        }
      }

      // ── STRUCTURAL TRAILING STOP (Dow Theory BOS) ──
      if (j >= 4) {
        const c0 = m5Candles[j];
        const c1 = m5Candles[j - 1];
        const c2 = m5Candles[j - 2];
        const c3 = m5Candles[j - 3];
        const c4 = m5Candles[j - 4];

        if (direction === "BUY") {
          if (
            c2.low < c0.low &&
            c2.low < c1.low &&
            c2.low < c3.low &&
            c2.low < c4.low
          ) {
            unconfirmedSwingLow = c2.low;
          }
          if (
            c2.high > c0.high &&
            c2.high > c1.high &&
            c2.high > c3.high &&
            c2.high > c4.high
          ) {
            lastSwingHigh = c2.high;
          }
          if (lastSwingHigh !== null && unconfirmedSwingLow !== null) {
            if (c0.close > lastSwingHigh) {
              // BOS Confirmed
              if (unconfirmedSwingLow !== lastConfirmedSL) {
                secondLastConfirmedSL = lastConfirmedSL;
                lastConfirmedSL = unconfirmedSwingLow;
                if (secondLastConfirmedSL > currentSl) {
                  currentSl = secondLastConfirmedSL - pipSize;
                }
              }
            }
          }
        } else if (direction === "SELL") {
          if (
            c2.high > c0.high &&
            c2.high > c1.high &&
            c2.high > c3.high &&
            c2.high > c4.high
          ) {
            unconfirmedSwingHigh = c2.high;
          }
          if (
            c2.low < c0.low &&
            c2.low < c1.low &&
            c2.low < c3.low &&
            c2.low < c4.low
          ) {
            lastSwingLow = c2.low;
          }
          if (lastSwingLow !== null && unconfirmedSwingHigh !== null) {
            if (c0.close < lastSwingLow) {
              // BOS Confirmed
              if (unconfirmedSwingHigh !== lastConfirmedSH) {
                secondLastConfirmedSH = lastConfirmedSH;
                lastConfirmedSH = unconfirmedSwingHigh;
                if (secondLastConfirmedSH < currentSl) {
                  currentSl = secondLastConfirmedSH + askSpread + pipSize;
                }
              }
            }
          }
        }
      }

      // PESSIMISTIC EXECUTION (Schrödinger's Candle Fix)
      if (direction === "SELL") {
        if (fc.high + askSpread >= currentSl) {
          outcome = "SL";
          exitPrice = currentSl;
          break;
        }
        if (fc.low + askSpread <= tp) {
          outcome = "TP";
          exitPrice = tp;
          break;
        }
      } else {
        if (fc.low <= currentSl) {
          outcome = "SL";
          exitPrice = currentSl;
          break;
        }
        if (fc.high >= tp) {
          outcome = "TP";
          exitPrice = tp;
          break;
        }
      }
    }

    let finalPips =
      direction === "SELL"
        ? (entry - exitPrice) / pipSize
        : (exitPrice - entry) / pipSize;

    let blendedPips = finalPips;
    if (hasTakenPartial) {
      const partialPips = 1.5 * riskPips;
      blendedPips = partialPips * 0.5 + finalPips * 0.5;
    }

    // Process DWCB Compounding locally
    const rMultiple = blendedPips / riskPips;
    const currentDd = localPeak > 0 ? (localPeak - localBalance) / localPeak : 0;
    const boundedDD = Math.max(0, Math.min(currentDd, 0.29));
    const dwcbMultiplier = Math.max(0, 1 - Math.pow(boundedDD / 0.29, 2));
    const riskAmount = localBalance * 0.1 * dwcbMultiplier;
    const profit = riskAmount * rMultiple;

    localBalance += profit;
    if (localBalance > localPeak) localPeak = localBalance;

    if (isSkipped) {
      record.outcome = "SKIPPED";
      record.hypotheticalOutcome = outcome;
      record.hypotheticalPips = blendedPips;
      record.mfePips = highestProfitPips;
      console.log(
        `   [SKIPPED] Hypothetical: ${outcome} | ${blendedPips > 0 ? "+" : ""}${blendedPips.toFixed(1)} pips (MFE: +${highestProfitPips.toFixed(1)})`,
      );
    } else {
      record.outcome = outcome;
      record.pips = blendedPips;
      record.mfePips = highestProfitPips;
      sessionTradeTaken = true; // Only set to true if an ACTUAL trade is taken!
      console.log(
        `   → ${outcome} | ${blendedPips > 0 ? "+" : ""}${blendedPips.toFixed(1)} pips (MFE: +${highestProfitPips.toFixed(1)})`,
      );
    }

    records.push(record as any);
  }

  // ── Results summary ─────────────────────────────────────────
  const tradedRecords = records.filter((r) => r.outcome !== "SKIPPED");
  const skipped = records.filter((r) => r.outcome === "SKIPPED").length;
  const wins = tradedRecords.filter((r) => (r.pips ?? 0) > 0).length;
  const losses = tradedRecords.filter((r) => (r.pips ?? 0) <= 0).length;
  const netPips = tradedRecords.reduce((sum, r) => sum + (r.pips ?? 0), 0);
  const winRate =
    tradedRecords.length > 0 ? (wins / tradedRecords.length) * 100 : 0;
  const aiStats = evaluator.getStats();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔱 VISION AI BACKTEST COMPLETE — ${pair}`);
  console.log(`   Total setups identified: ${records.length}`);
  console.log(`   AI filtered out (NO_TRADE): ${skipped}`);
  console.log(`   Trades taken: ${tradedRecords.length}`);
  console.log(`   Wins: ${wins} | Losses: ${losses}`);
  console.log(`   Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`   Net Pips: ${netPips.toFixed(1)}`);
  console.log(
    `   AI API Calls: ${aiStats.calls} | Cost: $${aiStats.totalCostUSD.toFixed(4)}`,
  );
  console.log(`${"=".repeat(60)}`);

  // Save results to JSON
  const outputPath = path.join(process.cwd(), `vision_backtest_${pair}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(records, null, 2));
  console.log(`\n📄 Full trade log saved to: ${outputPath}`);

  return { records, wins, losses, netPips, winRate, skipped };
}
