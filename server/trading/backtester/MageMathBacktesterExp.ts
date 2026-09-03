// ============================================================
// VISION BACKTESTER (MAGE PURE ORB MATH)
// Strictly mirrors mage_optimizer.ts
// ============================================================
import path from "path";
import fs from "fs";
import { loadCsv } from "./loadCsv.js";
import { aggregateCandles } from "../market/CandleAggregator.js";
import { buildEmaArray, buildAtrArray } from "../market/Indicators.js";
import { MAGE_PAIR_CONFIG, PairConfigManager } from "../config/PairConfig.js";
import { TradeRecord, TradeOutcome } from "../config/types.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { NFP_DATES, CPI_DATES, FOMC_DATES } from "../market/historicalNews.js";
import { getFixedEstDate } from "./math_core/MathCoreUtils.js";

function getDigitsForPair(pair: string): number {
  const optCfg = OPTIMIZER_CONFIG[pair.replace(".Daily", "")];
  const tickSize = optCfg?.tickSize ?? 0.00001;
  const tickStr = tickSize.toString();
  return tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
}
function roundPrice(val: number, pair: string): number {
  return Number(val.toFixed(getDigitsForPair(pair)));
}


const backtestCache = new Map<
  string,
  { m5Candles: any[]; emaArr: any; ema200Arr: any; atrArr: any; m1Rows: any[] }
>();

export async function runMageMathBacktestExp(
  pair: string,
  startDate?: string,
  endDate?: string,
  ignoreFilters: boolean = false,
  minSlOverride?: number,
  maxSlOverride?: number,
  extremeFilter: string | null = null,
  overrideConfigs?: any[],
) {
  for (const key of backtestCache.keys()) {
    if (!key.startsWith(pair)) {
      backtestCache.delete(key);
    }
  }

  const normalizedPair = pair.split("_")[0].split(".")[0].trim().toUpperCase();
  const isForex = PairConfigManager.isForex(normalizedPair);
  const isCrypto = pair.includes("BTC") || pair.includes("ETH");

  const configs = overrideConfigs || PairConfigManager.getMageConfigs(pair);
  if (!configs || configs.length === 0) throw new Error(`Unknown pair: ${pair}`);

  const baseConfig = configs[0];
  const { tickSize, spread } = baseConfig;
  const pipSize = baseConfig.pipSize !== undefined ? baseConfig.pipSize : tickSize * 10;
  const spreadPts = spread * pipSize;

  const cacheKey = `${pair}_${spread}_${startDate || ""}_${endDate || ""}`;
  let m5Candles: any[];
  let m1Rows: any[];
  let emaArr: any;
  let ema200Arr: any;
  let atrArr: any;

  const cached = backtestCache.get(cacheKey);

  if (cached) {
    console.log(`[Cache Hit] Using cached m5Candles for ${pair}`);
    m5Candles = cached.m5Candles;
    emaArr = cached.emaArr;
    ema200Arr = cached.ema200Arr;
    atrArr = cached.atrArr;
    m1Rows = cached.m1Rows;
  } else {
    // Load data
    const basePrefix = pair.split("_")[0].split(".")[0];
    const csvFiles = fs
      .readdirSync(path.join(process.cwd(), "data", "csv"))
      .filter((f) => (f.toLowerCase().startsWith(pair.split("_")[0].toLowerCase()) || f.toLowerCase().startsWith(basePrefix.toLowerCase())) && f.endsWith(".csv"));
    if (!csvFiles.length) throw new Error(`No CSV data found for ${pair}`);

    console.log(`🔱 Mage Math Backtest — ${pair}`);
    const startD = startDate
      ? new Date(new Date(startDate).getTime() - 15 * 24 * 60 * 60 * 1000)
      : undefined;
    const endD = endDate ? new Date(new Date(endDate).getTime() + 86400000 - 1) : undefined;

    m1Rows = [];
    for (const f of csvFiles) {
      console.log(`📁 Loading: ${f}`);
      m1Rows = m1Rows.concat(
        await loadCsv(
          path.join(process.cwd(), "data", "csv", f),
          spread,
          startD,
          endD,
        ),
      );
    }

    m5Candles = aggregateCandles(m1Rows, 5);
    emaArr = buildEmaArray(m5Candles, 50); // M5 50 EMA
    ema200Arr = buildEmaArray(m5Candles, 200); // M5 200 EMA
    atrArr = buildAtrArray(m5Candles, 14);

    backtestCache.set(cacheKey, {
      m5Candles,
      emaArr,
      ema200Arr,
      atrArr,
      m1Rows,
    });
  }

  let globalStartIdx = 0;
  let globalEndIdx = m5Candles.length - 1;
  if (startDate || endDate) {
    const start = startDate ? new Date(startDate).getTime() - 86400000 * 2 : 0; // 2 days warmup
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

  const allRecords: TradeRecord[] = [];
  let cfgIdx = 0;
  for (const config of configs) {
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
      if ((config as any)[prop] === undefined) {
        throw new Error(
          `[STRICT MODE ERROR] Missing required attribute '${prop}' in Mage config for ${pair}`,
        );
      }
    }

    const records: TradeRecord[] = [];
  let lastEstHour = -1;
  let sessionTradeTaken = false;

  let orHigh = -Infinity;
  let orLow = Infinity;
  let orBuilt = false;
  let mageTradeTaken = false;

  let dailyOpen = -1;
  let sessionHigh = -Infinity;
  let sessionLow = Infinity;
  let orbLowSwept = false;
  let orbHighSwept = false;

  let asianHigh = -Infinity;
  let asianLow = Infinity;
  let asianLowSwept = false;
  let asianHighSwept = false;

  let m1Idx = 0;

  for (let i = 2; i < m5Candles.length - 1; i++) {
    const c = m5Candles[i];

    while (m1Idx < m1Rows.length && m1Rows[m1Idx].timestamp < c.timestamp) {
      m1Idx++;
    }

    if (i < globalStartIdx || i > globalEndIdx) continue;

    if (
      lastEstHour !== -1 &&
      ((lastEstHour < 17 && c.estHour >= 17) ||
        (lastEstHour > c.estHour && c.estHour >= 17))
    ) {
      sessionTradeTaken = false;
      orHigh = -Infinity;
      orLow = Infinity;
      orBuilt = false;
      mageTradeTaken = false;
      dailyOpen = c.open;
      sessionHigh = c.high;
      sessionLow = c.low;
      orbLowSwept = false;
      orbHighSwept = false;
      asianHigh = -Infinity;
      asianLow = Infinity;
      asianLowSwept = false;
      asianHighSwept = false;
    }
    lastEstHour = c.estHour;

    if (dailyOpen === -1) {
       dailyOpen = c.open;
    }
    if (c.high > sessionHigh) sessionHigh = c.high;
    if (c.low < sessionLow) sessionLow = c.low;

    if (c.estHour >= 17 || c.estHour <= 1) {
       if (c.high > asianHigh) asianHigh = c.high;
       if (c.low < asianLow) asianLow = c.low;
    } else {
       if (c.low <= asianLow) asianLowSwept = true;
       if (c.high >= asianHigh) asianHighSwept = true;
    }

    const sessionName = config.session || "ny";
    const orbStartH = config.orbStartHour!;
    const orbStartM = config.orbStartMin!;
    const startMins = orbStartH * 60 + orbStartM;
    const orbDuration = config.orbMinutes!;
    const estMin = new Date(c.timestamp).getUTCMinutes();
    const currentMins = c.estHour * 60 + estMin;

    let resetMins = startMins - 60;
    if (resetMins < 0) resetMins += 1440;
    if (currentMins === resetMins) {
      orHigh = -Infinity;
      orLow = Infinity;
      orBuilt = false;
      mageTradeTaken = false;
      orbLowSwept = false;
      orbHighSwept = false;
    }

    if (currentMins >= startMins && currentMins < startMins + orbDuration) {
      if (c.high > orHigh) orHigh = c.high;
      if (c.low < orLow) orLow = c.low;
    }
    if (currentMins === startMins + orbDuration) {
      orBuilt = true;
    }
    
    if (orBuilt && currentMins >= startMins + orbDuration) {
      if (c.low < orLow) orbLowSwept = true;
      if (c.high > orHigh) orbHighSwept = true;
    }

    const minBodyPips: number | undefined = config.minBodyPips;

    let triggerSetup: {
      direction: "BUY" | "SELL";
      orHigh: number;
      orLow: number;
      boxSize: number;
      cBodyPips: number;
    } | null = null;

    const endMins =
      config.orbEndHour !== undefined
        ? config.orbEndHour * 60 + (config.orbEndMin || 0)
        : startMins + 180;

    // M-2: Use previously closed M5 for breakout (no look-ahead bias, matches MageEngine)
    const prevC = i > 0 ? m5Candles[i - 1] : null;

    if (
      orBuilt &&
      currentMins >= startMins &&
      currentMins < endMins &&
      !mageTradeTaken &&
      prevC
    ) {
      // MATHEMATICAL PARITY FIX: Prevent the last candle of the ORB from falsely triggering itself.
      const prevCMins = prevC.estHour * 60 + (prevC.estMin || 0);
      if (prevCMins < startMins + orbDuration) continue;

      const orRangePips = (orHigh - orLow) / pipSize;
      const maxSlPips = config.maxSlDist!;
      const rangeTooBig = isForex && orRangePips + 10 > maxSlPips;

      if (!rangeTooBig) {
        const reqBuyHigh = roundPrice(orHigh + spreadPts, pair);
        let buyTriggered = isForex
          ? prevC.close > orHigh
          : prevC.high >= reqBuyHigh;
        let sellTriggered = isForex
          ? prevC.close < orLow
          : prevC.low <= orLow;

        // --- EXPERIMENTAL FILTERS ---
        const anyConfig = config as any;
        
        // Filter 1: Trap and Go (Opposite Sweep)
        if (anyConfig.filter1_OppositeSweep) {
           if (buyTriggered && !orbLowSwept && sessionLow >= orLow) {
              buyTriggered = false; // Must have swept the ORB Low OR Asian Low earlier
           }
           if (sellTriggered && !orbHighSwept && sessionHigh <= orHigh) {
              sellTriggered = false;
           }
        }

        // Filter 2: True Blue Sky (HOD/LOD Confluence)
        if (anyConfig.filter2_TrueBlueSky) {
           // We only buy if the ORB High *was* the HOD before the breakout candle
           if (buyTriggered && orHigh < sessionHigh - 2 * pipSize) {
              buyTriggered = false; // There is a higher peak from earlier in the session
           }
           if (sellTriggered && orLow > sessionLow + 2 * pipSize) {
              sellTriggered = false;
           }
        }

        // Filter 3: Midnight Open (Daily Bias)
        if (anyConfig.filter3_MidnightOpen) {
           if (buyTriggered && prevC.close < dailyOpen) {
              buyTriggered = false; // Must breakout ABOVE the daily open
           }
           if (sellTriggered && prevC.close > dailyOpen) {
              sellTriggered = false; // Must breakout BELOW the daily open
           }
        }

        // Filter 4: Asian Sweep
        if (anyConfig.filter4_AsianSweep) {
           if (buyTriggered && !asianLowSwept) {
              buyTriggered = false;
           }
           if (sellTriggered && !asianHighSwept) {
              sellTriggered = false;
           }
        }
        if (!(buyTriggered && sellTriggered)) {
          if (buyTriggered || sellTriggered) {
            // 🚫 Prop Firm Compliance: Blackout Windows 🚫
            const dateStr = getFixedEstDate(new Date(c.timestamp)).toISOString().split("T")[0];
            const isNFP = NFP_DATES.has(dateStr);
            const isCPI = CPI_DATES.has(dateStr);
            const isFOMC = FOMC_DATES.has(dateStr);

            if (
              (c.estHour === 16 && estMin >= 55) || (c.estHour === 17 && estMin <= 5) || // Rollover
              ((isNFP || isCPI) && c.estHour === 8 && estMin >= 25 && estMin <= 45) || // Macro News NFP/CPI
              (isFOMC && ((c.estHour === 13 && estMin >= 55) || (c.estHour === 14 && estMin <= 15)))   // Macro News FOMC
            ) {
              continue;
            }
            mageTradeTaken = true;
            const dir: "BUY" | "SELL" = buyTriggered ? "BUY" : "SELL";
            const cBodyPips = Math.abs(prevC.open - prevC.close) / pipSize;
            triggerSetup = {
              direction: dir,
              orHigh,
              orLow,
              boxSize: Math.abs(orHigh - orLow),
              cBodyPips,
            };
          }
        }
      }
    }

    if (!triggerSetup) continue;

    const direction = triggerSetup.direction;
    const orHighVal = triggerSetup.orHigh;
    const orLowVal = triggerSetup.orLow;
    const boxSize = triggerSetup.boxSize;
    const cBodyPips = triggerSetup.cBodyPips;

    let outcome: TradeOutcome | "SKIPPED" | null = null;
    let exitPrice = 0;
    let rMultiple = 0;
    let entryTimeMs = 0;
    let entryPrice = 0;
    let slPrice = 0;
    let tpPrice = 0;

    if (minBodyPips !== undefined && cBodyPips < minBodyPips) {
      if (c.timestamp > 1704067200000)
        console.log(
          `[MATH SKIPPED] time: ${new Date(c.timestamp).toISOString()} cBodyPips: ${cBodyPips} < min: ${minBodyPips}`,
        );
      mageTradeTaken = true;
      outcome = "SKIPPED";
    }

    const pullbackPct = config.orbPullbackPct!;
    const slBuffer = 0; // Removed physical SL buffer for parity

    let limitBuyPrice = orHighVal - boxSize * pullbackPct;
    let limitSellPrice = orLowVal + boxSize * pullbackPct;

    entryPrice = direction === "BUY" ? limitBuyPrice : limitSellPrice;
    let proposedSl =
      direction === "BUY"
        ? orLowVal - slBuffer
        : orHighVal + spreadPts + slBuffer;

    if (config.minSlDist !== undefined) {
      if (
        direction === "SELL" &&
        proposedSl < entryPrice + config.minSlDist * pipSize
      )
        proposedSl = entryPrice + config.minSlDist * pipSize;
      if (
        direction === "BUY" &&
        proposedSl > entryPrice - config.minSlDist * pipSize
      )
        proposedSl = entryPrice - config.minSlDist * pipSize;
    }

    slPrice = proposedSl;
    let risk = Math.abs(entryPrice - slPrice);

    if (config.maxSlDist !== undefined && risk > config.maxSlDist * pipSize) {
      outcome = "SKIPPED";
      rMultiple = 0;
    }

    tpPrice =
      direction === "BUY" ? entryPrice + 50.0 * risk : entryPrice - 50.0 * risk;

    if (config.exitMode === "MIDPOINT") {
      tpPrice = (orHighVal + orLowVal) / 2;
    } else if (config.exitMode === "OPPOSITE_BOUNDARY") {
      tpPrice = direction === "BUY" ? orHighVal : orLowVal;
    } else if (config.exitMode === "ORB_EXTENSION") {
      const ext = boxSize * 2;
      tpPrice = direction === "BUY" ? entryPrice + ext : entryPrice - ext;
    }

    let missedTrade = false;
    let currentSL = slPrice;
    let lastTrailingLevel = 0;
    let tradeActive = false;

    if (outcome === null) {
      for (
        let j = m1Idx + 1;
        j < Math.min(m1Rows.length, m1Idx + 1 + 1750);
        j++
      ) {
        const fc = m1Rows[j];
        const isEOD =
          !isCrypto &&
          config.session !== "asia" &&
          ((fc.estHour === 16 && fc.minute >= 45) ||
            (fc.estHour >= 17 && fc.estHour < 19));

        if (isEOD) {
          if (tradeActive) {
            outcome = "EOD";
            exitPrice = direction === "BUY" ? fc.close : fc.close + spreadPts;
            rMultiple =
              (direction === "BUY"
                ? exitPrice - entryPrice
                : entryPrice - exitPrice) / risk;
          } else {
            outcome = "SKIPPED";
            rMultiple = 0;
          }
          break;
        }

        if (!tradeActive && !missedTrade) {
          const fcHours = config.forceCloseHours || 8;

          const limitPlacedAt = c.timestamp;
          if (fc.timestamp - limitPlacedAt >= fcHours * 60 * 60 * 1000) {
            // Expired based on forceCloseHours
            outcome = "SKIPPED";
            rMultiple = 0;
            break;
          }

          // Cancel dangling limit order from the previous day at 17:00 EST rollover
          // This perfectly matches MageEngine.ts rollover logic
          if (!tradeActive && ((c.estHour < 17 && fc.estHour >= 17) || (c.estHour > fc.estHour && fc.estHour >= 17))) {
            outcome = "SKIPPED";
            rMultiple = 0;
            break;
          }

          if (direction === "BUY" && fc.low + spreadPts <= limitBuyPrice) {
            tradeActive = true;
            entryTimeMs = fc.timestamp;
            entryPrice = Math.min(fc.open + spreadPts, limitBuyPrice);
            risk = Math.abs(entryPrice - slPrice);
            console.log(
              `[MATH FILLED LIMIT] at ${new Date(fc.timestamp).toISOString()} low: ${fc.low} limit: ${limitBuyPrice}`,
            );
          } else if (direction === "SELL" && fc.high >= limitSellPrice) {
            tradeActive = true;
            entryTimeMs = fc.timestamp;
            entryPrice = Math.max(fc.open, limitSellPrice);
            risk = Math.abs(entryPrice - slPrice);
            console.log(
              `[MATH FILLED LIMIT] at ${new Date(fc.timestamp).toISOString()} high: ${fc.high} limit: ${limitSellPrice}`,
            );
          }

          if (!tradeActive && !missedTrade) {
            if (direction === "BUY" && (fc.high >= tpPrice || fc.low <= slPrice)) {
              missedTrade = true;
              outcome = "SKIPPED";
              rMultiple = 0;
              break;
            } else if (
              direction === "SELL" &&
              (fc.low + spreadPts <= tpPrice || fc.high >= slPrice)
            ) {
              missedTrade = true;
              outcome = "SKIPPED";
              rMultiple = 0;
              break;
            }
          }
        }

        if (tradeActive) {
          const dateStr = getFixedEstDate(new Date(fc.timestamp)).toISOString().split("T")[0];
          const isNFP = NFP_DATES.has(dateStr);
          const isCPI = CPI_DATES.has(dateStr);
          const isFOMC = FOMC_DATES.has(dateStr);

          const isNewsForceClose =
            ((isNFP || isCPI) && fc.estHour === 8 && fc.minute >= 25 && fc.minute <= 45) || // NFP/CPI
            (isFOMC && ((fc.estHour === 13 && fc.minute >= 55) || (fc.estHour === 14 && fc.minute <= 15))); // FOMC

          const fcHours = config.forceCloseHours || 8;
          if (fc.timestamp - entryTimeMs >= fcHours * 60 * 60 * 1000 || isNewsForceClose) {
            outcome = isNewsForceClose ? "NEWS_CLOSE" : "EOD";
            exitPrice = direction === "BUY" ? fc.close : fc.close + spreadPts;
            rMultiple =
              (direction === "BUY"
                ? exitPrice - entryPrice
                : entryPrice - exitPrice) / risk;
            break;
          }

          let slHit = false;
          let tpHit = false; if (currentSL > entryPrice) { const r = (entryPrice - (fc.low + spreadPts)) / risk; if (r > (global as any).maxR) (global as any).maxR = r; }

          if (direction === "BUY") {
            slHit = fc.low <= currentSL;
            tpHit = fc.high >= tpPrice;
            if (slHit && tpHit) {
              slHit = true;
              tpHit = false;
            }

            if (slHit) { console.log("MATH HIT SL AT", fc.timestamp, "fc.high=", fc.high, "spread=", spreadPts, "currentSL=", currentSL); 
              outcome = "SL";
              rMultiple = (currentSL - entryPrice) / risk;
              break;
            }

            const currentR = (fc.high - entryPrice) / risk;
            const tTrig = config.trailingSlTrigger!;
            const tStep = config.trailingSlStep!;

            if (currentR >= tTrig && currentSL < entryPrice) {
              currentSL = entryPrice;
              lastTrailingLevel = 0;
            }
            if (currentR >= tTrig + tStep) {
              const numSteps = Math.floor((currentR - tTrig) / tStep);
              const rLevelToLock = numSteps * tStep;
              if (rLevelToLock > lastTrailingLevel) {
                lastTrailingLevel = rLevelToLock;
                const bd = pair.includes('JPY') ? 3 : (pair.includes('XAU') || pair.includes('BTC') || pair.includes('ETH') || pair.includes('US30') || pair.includes('NAS') || pair.includes('SPX') || pair.includes('GER') || pair.includes('UK') || pair.includes('US100') ? 2 : 5); const proposedSL = Number((entryPrice + rLevelToLock * risk).toFixed(bd));
                if (proposedSL > currentSL) currentSL = proposedSL;
              }
            }

            if (tpHit) {
              outcome = "TP";
              exitPrice = tpPrice;
              rMultiple =
                (direction === "BUY"
                  ? exitPrice - entryPrice
                  : entryPrice - exitPrice) / risk;
              break;
            }
          } else {
            slHit = fc.high + spreadPts >= currentSL;
            tpHit = fc.low + spreadPts <= tpPrice;
            if (slHit && tpHit) {
              slHit = true;
              tpHit = false;
            }

            if (slHit) { console.log("MATH HIT SL AT", fc.timestamp, "fc.high=", fc.high, "spread=", spreadPts, "currentSL=", currentSL); 
              outcome = "SL";
              rMultiple = (entryPrice - currentSL) / risk;
              break;
            }

            const currentR = (entryPrice - (fc.low + spreadPts)) / risk;
            const tTrig = config.trailingSlTrigger!;
            const tStep = config.trailingSlStep!;

            if (currentR >= tTrig && currentSL > entryPrice) {
              currentSL = entryPrice;
              lastTrailingLevel = 0;
            }
            if (currentR >= tTrig + tStep) {
              const numSteps = Math.floor((currentR - tTrig) / tStep);
              const rLevelToLock = numSteps * tStep;
              if (rLevelToLock > lastTrailingLevel) {
                lastTrailingLevel = rLevelToLock;
                const bd = pair.includes('JPY') ? 3 : (pair.includes('XAU') || pair.includes('BTC') || pair.includes('ETH') || pair.includes('US30') || pair.includes('NAS') || pair.includes('SPX') || pair.includes('GER') || pair.includes('UK') || pair.includes('US100') ? 2 : 5); const proposedSL = Number((entryPrice - rLevelToLock * risk).toFixed(bd));
                if (proposedSL < currentSL) currentSL = proposedSL;
              }
            }

            if (tpHit) {
              outcome = "TP";
              exitPrice = tpPrice;
              rMultiple = (entryPrice - exitPrice) / risk;
              break;
            }
          }
        }
      }
    }

    if (outcome === null) {
      if (tradeActive) {
        outcome = "EOD";
        const fcLast = m1Rows[Math.min(m1Rows.length - 1, m1Idx + 1750)];
        exitPrice =
          direction === "BUY" ? fcLast.close : fcLast.close + spreadPts;
        rMultiple =
          (direction === "BUY"
            ? exitPrice - entryPrice
            : entryPrice - exitPrice) / risk;
      } else {
        outcome = "SKIPPED";
      }
    }

    const pips = outcome === "SKIPPED" ? null : (rMultiple * risk) / pipSize;

    records.push({
      timestamp: c.timestamp,
      date: getFixedEstDate(new Date(c.timestamp)).toISOString().split("T")[0],
      pair: pair,
      setupType: "MAGE_ORB",
      sessionName: config.session || "ny",
      decision: "TRADE",
      confidence: 1,
      setupQuality: "N/A",
      reasoning: "Math Match",
      entry: entryPrice,
      stopLoss: slPrice,
      takeProfit: tpPrice,
      riskPips: Math.abs(entryPrice - slPrice) / pipSize,
      outcome,
      pips: rMultiple
        ? rMultiple * (Math.abs(entryPrice - slPrice) / pipSize)
        : null,
      rMultiple,
      orHigh: orHighVal,
      orLow: orLowVal,
      atrPips: atrArr[i] / pipSize,
      ema50: emaArr[i],
      ema200: ema200Arr[i],
      close: c.close,
    });

    if (outcome !== "SKIPPED") {
      console.log(
        `[MATH TOOK TRADE] date: ${getFixedEstDate(new Date(c.timestamp)).toISOString().split("T")[0]} time: ${new Date(c.timestamp).toISOString()} cBodyPips: ${cBodyPips} outcome: ${outcome}`,
      );
      }
    } // End inner loop
    
    // Inject signature into trade records to match LiveOrchestrator parity
    const sig = config.signature || `default_${cfgIdx}`;
    for (const r of records) {
      r.botId = `MAGE_${sig}`;
    }

    allRecords.push(...records);
    cfgIdx++;
  } // End config loop
  
  // Sort chronologically across all configs
  allRecords.sort((a, b) => a.timestamp - b.timestamp);


  const startMs = startDate ? new Date(startDate).getTime() : null;
  const endMs = endDate ? new Date(endDate).getTime() + 86400000 : null;
  const filteredRecords = allRecords.filter((r) => {
    return (!startMs || r.timestamp >= startMs) && (!endMs || r.timestamp <= endMs);
  });

  const tradedRecords = filteredRecords.filter((r) => r.outcome !== "SKIPPED");
  const skipped = filteredRecords.filter((r) => r.outcome === "SKIPPED").length;
  const wins = tradedRecords.filter((r) => (r.pips ?? 0) > 0).length;
  const losses = tradedRecords.filter((r) => (r.pips ?? 0) <= 0).length;
  const netPips = tradedRecords.reduce((sum, r) => sum + (r.pips ?? 0), 0);
  const winRate =
    tradedRecords.length > 0 ? (wins / tradedRecords.length) * 100 : 0;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📈  MAGE MATH BACKTEST RESULTS: ${pair}`);
  console.log(`📅  ${startDate || "ALL"} to ${endDate || "ALL"}`);
  console.log(`   Trades skipped (NO_TRADE): ${skipped}`);
  console.log(`   Trades taken: ${tradedRecords.length}`);
  return {
    records: filteredRecords,
    m5Candles,
    wins,
    losses,
    netPips,
    winRate,
    skipped,
  };
}
