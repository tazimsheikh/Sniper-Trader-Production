import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
const currentFile = typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url);
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { loadCsv, getLatestDate } from "../../backtester/loadCsv.js";
import { aggregateCandles } from "../../market/CandleAggregator.js";
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";
import { PairConfig, PairConfigManager } from "../../config/PairConfig.js";
import { isNewsForceClose } from "../../market/historicalNews.js";
import { M1TypedArrays } from "../../config/types.js";
import { WalkForwardEngine } from "../core/WalkForwardEngine.js";
import { ChromosomeMapper } from "../core/ChromosomeMapper.js";
import { HybridGeneticOptimizer, FitnessResult } from "../core/HybridGeneticOptimizer.js";

import { buildEmaArray, buildBollingerArray, buildRsiArray } from "../../market/Indicators.js";
import { DailyContextTracker } from "../../market/DailyContextTracker.js";
import { evaluateStacyBurkeSetup } from "../../market/SeerMathCore.js";
import { getFixedEstDate } from "../../backtester/math_core/MathCoreUtils.js";

function getDigitsForPair(pair: string): number {
  const optCfg = OPTIMIZER_CONFIG[pair.replace(".Daily", "")];
  const tickSize = optCfg?.tickSize ?? 0.00001;
  const tickStr = tickSize.toString();
  return tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
}
function roundPrice(val: number, pair: string): number {
  return Number(val.toFixed(getDigitsForPair(pair)));
}

export function parseSeerConfig(setupStr: string): { session: string; config: PairConfig } | null {
  if (setupStr.includes("Trig999")) return null;
  const m = setupStr.match(/^(\w+)_Body([\d.]+)_Wick([\d.]+)_MinSL([\d.]+)_MaxSL([\d.]+)_Trig([\d.]+)_Step([\d.]+)_FC(\d+)_Exit(\w+)$/);
  if (!m) return null;
  const [, sSession, sBody, sWick, sMinSL, sMaxSL, sTrig, sStep, sFC, sExit] = m;
  const stepVal = parseFloat(sStep);
  if (stepVal <= 0) return null;

  return {
    session: sSession === "NY_Forex" ? "ny" : sSession,
    config: {
      minBodyPips: parseFloat(sBody),
      pinBarWickBodyRatio: parseFloat(sWick),
      minSlDist: parseFloat(sMinSL),
      maxSlDist: parseFloat(sMaxSL),
      trailingSlTrigger: parseFloat(sTrig),
      trailingSlStep: stepVal,
      forceCloseHours: parseInt(sFC),
      exitMode: sExit as any,
    } as PairConfig
  };
}

const BASE_MIN_SL_VALS = [5, 7.5, 10, 15, 20, 30, 40];
const BASE_MAX_SL_VALS = [25, 30, 40, 50, 60, 80, 100, 150, 200];
const BASE_MIN_BODY_VALS = [3, 4, 5, 6, 8, 10, 12, 15, 20, 30];
const PIN_BAR_WICK_BODY_RATIOS = [1.2, 1.5, 2.0];
const TRAILING_TRIGGERS = [0.5]; // Dummy for Seer format
const TRAILING_STEPS = [0.5]; // Dummy for Seer format
const FORCE_CLOSE_HOURS = [4, 8, 12, 16, 24];
const EXIT_MODES = ["TRAILING"]; // Dummy for Seer format
const SIM_YEARS = 3.0;

const dumpDir = path.join(process.cwd(), "server", "trading", "optimizer", "seer", "seer_optimizer_dump");
if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });

const csvDir = path.join(process.cwd(), "data", "csv");
const ALL_PAIRS = Array.from(
  new Set(fs.readdirSync(csvDir).filter((f) => f.endsWith(".csv")).map((f) => f.split("_")[0])),
).filter((p) => !p.includes("BTC") && !p.includes("ETH"))
 .sort((a, b) => {
    const priority = ["XAUUSD", "NAS100.Daily", "EURUSD", "GBPJPY", "GBPAUD", "EURCAD", "XTIUSD"];
    const indexA = priority.indexOf(a);
    const indexB = priority.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });

const cliArgs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const PAIRS_TO_RUN = cliArgs.length > 0 ? ALL_PAIRS.filter((p) => cliArgs.includes(p)) : ALL_PAIRS;

if (isMainThread && process.argv[1] && (process.argv[1] === currentFile || path.resolve(process.argv[1]) === path.resolve(currentFile))) {
  if (process.argv.includes("--overwrite")) process.env.OVERWRITE = "true";
  const runOptimizationMaster = async () => {
    console.log(`\n================================================================`);
    console.log(` SEER Hybrid GA / WFA Optimizer (Stacy Burke Logic) `);
    console.log(`================================================================`);
    const maxWorkersPrint = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 8;
    console.log(`Spawning Worker Pool with Max Concurrency: ${maxWorkersPrint}`);

    let activeWorkers = 0;
    let index = 0;

    return new Promise<void>((resolve) => {
      function spawnNext() {
        if (index >= PAIRS_TO_RUN.length && activeWorkers === 0) {
          console.log(`\n SEER GA Optimization Complete! All state JSON files generated.`);
          resolve();
          return;
        }
        const maxWorkers = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 8;
        while (activeWorkers < maxWorkers && index < PAIRS_TO_RUN.length) {
          const symbol = PAIRS_TO_RUN[index++];
          activeWorkers++;
          const worker = new Worker(currentFile, {
            workerData: { symbol, isOverwrite: process.env.OVERWRITE === "true" },
            execArgv: process.execArgv,
          });

          worker.on("message", (msg) => console.log(msg));
          worker.on("error", (err) => console.error(`[SEER WORKER ERROR] on ${symbol}:`, err));
          worker.on("exit", () => {
            activeWorkers--;
            spawnNext();
          });
        }
      }
      spawnNext();
    });
  };
  runOptimizationMaster().catch(console.error);
} else if (!isMainThread) {
  const runWorker = async () => {
    const { symbol, isOverwrite } = workerData;
    const dumpFileExists = path.join(dumpDir, `state_${symbol}.json`);
    const wfaFilePath = path.join(dumpDir, `wfa_${symbol}.json`);

    if (!isOverwrite && fs.existsSync(dumpFileExists)) {
      parentPort?.postMessage(`[SKIP] state_${symbol}.json already exists. Skipping ${symbol}.`);
      return;
    }

    const basePair = OPTIMIZER_CONFIG[symbol] ? symbol : (OPTIMIZER_CONFIG[symbol.replace(".Daily", "")] ? symbol.replace(".Daily", "") : symbol + ".Daily");
    let configTemplate = OPTIMIZER_CONFIG[basePair];

    if (!configTemplate) {
      parentPort?.postMessage(`[WARN] Skipping ${symbol} - No OPTIMIZER_CONFIG found.`);
      return;
    }

    let minSlGrid = BASE_MIN_SL_VALS;
    let maxSlGrid = BASE_MAX_SL_VALS;
    let minBodyGrid = BASE_MIN_BODY_VALS;
    let trailingTriggersGrid = TRAILING_TRIGGERS;
    let trailingStepsGrid = TRAILING_STEPS;
    let forceCloseHoursGrid = FORCE_CLOSE_HOURS;
    let pinBarWickBodyRatioGrid = PIN_BAR_WICK_BODY_RATIOS;
    let exitModesGrid = EXIT_MODES;

    const MAJORS = ["GBPUSD", "EURUSD"];
    const JPY_CROSSES = ["GBPJPY", "CHFJPY", "CADJPY", "EURJPY", "AUDJPY", "USDJPY"];
    const VOLATILE_CROSSES = ["GBPAUD", "EURAUD", "EURCAD", "GBPCAD", "EURNZD", "GBPNZD"];
    const MINOR_PAIRS = ["AUDUSD", "NZDUSD", "USDCAD", "USDCHF"];
    
    if (MAJORS.includes(symbol)) {
      minSlGrid = [5, 7.5, 10, 12.5, 15];
      maxSlGrid = [20, 30, 40, 50, 60, 80];
      minBodyGrid = [3, 4, 5, 8, 10];
    } else if (JPY_CROSSES.includes(symbol)) {
      minSlGrid = [15, 20, 25, 30, 40];
      maxSlGrid = [30, 40, 50, 60, 70, 80, 100, 150];
      minBodyGrid = [4, 5, 6, 8, 10, 15];
    } else if (VOLATILE_CROSSES.includes(symbol)) {
      minSlGrid = [15, 20, 25, 30, 40];
      maxSlGrid = [30, 40, 50, 60, 70, 80, 100, 150];
      minBodyGrid = [4, 5, 6, 7.5, 10, 15];
    } else if (MINOR_PAIRS.includes(symbol)) {
      minSlGrid = [8, 10, 12.5, 15, 20];
      maxSlGrid = [15, 20, 25, 30, 40, 50, 70, 100];
      minBodyGrid = [3, 4, 5, 8, 10];
    } else if (symbol.includes("BTC")) {
      minSlGrid = [20, 25, 30, 40, 50];
      maxSlGrid = [100, 150, 200, 300];
      minBodyGrid = [15, 20, 30, 40];
    } else if (symbol.includes("ETH")) {
      minSlGrid = [20, 25, 30, 40, 50];
      maxSlGrid = [80, 100, 150, 250];
      minBodyGrid = [10, 15, 20, 30];
    } else if (symbol.includes("US30") || symbol.includes("NAS") || symbol.includes("GER")) {
      minSlGrid = [15, 20, 30, 50, 100];
      maxSlGrid = [60, 80, 100, 140, 180, 200, 250];
      minBodyGrid = [10, 15, 20, 30, 40];
    } else if (symbol.includes("SPX")) {
      minSlGrid = [5, 7, 10, 15, 20, 30];
      maxSlGrid = [40, 80, 120, 150, 200];
      minBodyGrid = [5, 10, 15, 20];
    } else if (symbol.includes("XAU") || symbol.includes("XTI")) {
      minSlGrid = [10, 12, 15, 20, 30, 40];
      maxSlGrid = [40, 60, 80, 120, 150, 200];
      minBodyGrid = [10, 15, 20, 25, 35];
    }

    const sessions = ["london", "ny", "asia"];

    const csvFiles = fs.readdirSync(csvDir).filter((f) => f.startsWith(symbol) && f.endsWith(".csv"));
    if (!csvFiles.length) return;

    const csvFilePath = path.join(csvDir, csvFiles[0]);
    const endDate = getLatestDate(csvFilePath);
    const startDate = new Date(endDate.getTime());
    startDate.setFullYear(startDate.getFullYear() - SIM_YEARS);

    parentPort?.postMessage(`[1] Loading ${csvFiles[0]} into RAM (${startDate.getUTCFullYear()}-${endDate.getUTCFullYear()}) for ${symbol}...`);

    const m1Rows = await loadCsv(csvFilePath, configTemplate.spread, startDate, endDate);
    const m5Candles = aggregateCandles(m1Rows, 5);
    const emaArr = buildEmaArray(m5Candles, 20);
    const bbArr = buildBollingerArray(m5Candles, 20, 2.0);
    const rsiArr = buildRsiArray(m5Candles, 14);

    const m1Length = m1Rows.length;
    const m1Typed: M1TypedArrays = {
      open: new Float64Array(m1Length),
      high: new Float64Array(m1Length),
      low: new Float64Array(m1Length),
      close: new Float64Array(m1Length),
      timestamp: new Float64Array(m1Length),
      estHour: new Int32Array(m1Length),
      minute: new Int32Array(m1Length),
      isEOD_standard: new Uint8Array(m1Length),
      isSessionReset: new Uint8Array(m1Length),
      isMidnightExpiry: new Uint8Array(m1Length),
      isNewsForceClose: new Uint8Array(m1Length),
      length: m1Length,
    };
    for (let i = 0; i < m1Length; i++) {
      const r = m1Rows[i];
      m1Typed.open[i] = r.open;
      m1Typed.high[i] = r.high;
      m1Typed.low[i] = r.low;
      m1Typed.close[i] = r.close;
      m1Typed.timestamp[i] = r.timestamp;
      
      const h = r.estHour;
      const m = r.minute;
      m1Typed.estHour[i] = h;
      m1Typed.minute[i] = m;
      
      if ((h === 16 && m >= 55) || (h === 17 && m <= 5)) m1Typed.isEOD_standard[i] = 1;
      const tDate = getFixedEstDate(new Date(r.timestamp));
      const tStr = tDate.toISOString().split("T")[0];
      if (isNewsForceClose(tStr, h, m)) m1Typed.isNewsForceClose[i] = 1;
    }

    const chromosomeMapper = new ChromosomeMapper([
      minSlGrid,
      maxSlGrid,
      minBodyGrid,
      pinBarWickBodyRatioGrid,
      trailingTriggersGrid,
      trailingStepsGrid,
      forceCloseHoursGrid,
      exitModesGrid,
    ]);

    const windows = WalkForwardEngine.generateWindows(m1Typed);
    parentPort?.postMessage(`[2] WFA Generated ${windows.length} rolling windows. Optimizing sessions...`);

    const wfaResults: any[] = [];
    const validAlphas: any[] = [];
    const pipSize = configTemplate.pipSize;
    const askSpread = configTemplate.spread * pipSize;

    const findM5Index = (timestampMs: number): number => {
      let low = 0;
      let high = m5Candles.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (m5Candles[mid].timestamp < timestampMs) {
          low = mid + 1;
        } else if (m5Candles[mid].timestamp > timestampMs) {
          high = mid - 1;
        } else {
          return mid;
        }
      }
      return Math.min(low, m5Candles.length - 1);
    };

    for (const session of sessions) {
      for (const window of windows) {
        const isStartIdx = findM5Index(window.inSampleStart.getTime());
        const isEndIdx = findM5Index(window.inSampleEnd.getTime());
        const oosStartIdx = findM5Index(window.outOfSampleStart.getTime());
        const oosEndIdx = findM5Index(window.outOfSampleEnd.getTime());

        const isM5 = m5Candles.slice(isStartIdx, isEndIdx + 1);
        const oosM5 = m5Candles.slice(oosStartIdx, oosEndIdx + 1);
        
        // Use casting here because Float64Array slicing returns Float64Array, which is fine, 
        // but the argument typing needs it passed down smoothly.
        const isEma = emaArr.slice(isStartIdx, isEndIdx + 1) as any;
        const oosEma = emaArr.slice(oosStartIdx, oosEndIdx + 1) as any;
        const isBb = bbArr.slice(isStartIdx, isEndIdx + 1);
        const oosBb = bbArr.slice(oosStartIdx, oosEndIdx + 1);
        const isRsi = rsiArr.slice(isStartIdx, isEndIdx + 1);
        const oosRsi = rsiArr.slice(oosStartIdx, oosEndIdx + 1);

        const triggerCache = new Map<string, any[]>();
        
        const getCachedTriggers = (minBody: number, wickRatio: number, candles: any[], ema: any, bb: any, rsi: any, isOos: boolean = false) => {
          const key = `${isOos ? 'OOS' : 'IS'}_${minBody}_${wickRatio}`;
          if (!triggerCache.has(key)) {
            const t = [];
            const dailyTracker = new DailyContextTracker();
            let day3High = -Infinity;
            let day3Low = Infinity;
            let lastEstHour = -1;
            let sessionTradeTaken = false;

            for (let i = 2; i < candles.length - 1; i++) {
              const c = candles[i];
              dailyTracker.processCandle(c);

              if (lastEstHour !== -1 && ((lastEstHour < 17 && c.estHour >= 17) || (lastEstHour > c.estHour && c.estHour >= 17))) {
                day3High = -Infinity;
                day3Low = Infinity;
                sessionTradeTaken = false;
              }
              if (c.high > day3High) day3High = c.high;
              if (c.low < day3Low) day3Low = c.low;
              lastEstHour = c.estHour;

              const isNY = c.estHour >= 9 && c.estHour < 13;
              const isAsia = c.estHour >= 20 && c.estHour < 23;
              const isLondon = c.estHour >= 2 && c.estHour < 5;

              let inWindow = false;
              if (session === 'asia' && isAsia) inWindow = true;
              if (session === 'london' && isLondon) inWindow = true;
              if (session === 'ny' && isNY) inWindow = true;

              if (inWindow && !sessionTradeTaken) {
                const prevDay = dailyTracker.getPreviousDayContext();
                if (prevDay) {
                  let covenSetup = 'NONE';
                  if (prevDay.isFirstRedDay) covenSetup = 'FRD';
                  else if (prevDay.isFirstGreenDay) covenSetup = 'FGD';
                  else if (prevDay.isDay3BreakoutLongs) covenSetup = 'DAY3_LONG';
                  else if (prevDay.isDay3BreakoutShorts) covenSetup = 'DAY3_SHORT';
                  else if (prevDay.isInsideDay) covenSetup = 'INSIDE_DAY';
                  else if (prevDay.isTrendingLong) covenSetup = 'LHF_LONG';
                  else if (prevDay.isTrendingShort) covenSetup = 'LHF_SHORT';

                  const prevC = candles[i - 1];
                  const cfg = { minBodyPips: minBody, pinBarWickBodyRatio: wickRatio };
                  const mathResult = evaluateStacyBurkeSetup(c, prevC, ema[i], prevDay, covenSetup, cfg as any, pipSize, symbol, false, day3High, day3Low, bb[i-1], rsi[i-1]);

                  if (mathResult) {
                    sessionTradeTaken = true;
                    t.push({ m5Index: i, direction: mathResult.direction, c });
                  }
                }
              }
            }
            triggerCache.set(key, t);
          }
          return triggerCache.get(key)!;
        };

        const evaluateSeerExits = (triggers: any[], candles: any[], minSl: number, maxSl: number, fcHours: number) => {
          let totalTrades = 0;
          let winningTrades = 0;
          let dailyNetR: Record<string, number> = {};
          let totalNetR = 0;
          let peak = 0;
          let maxDrawdown = 0;

          for (const t of triggers) {
            const { m5Index: i, direction, c } = t;
            const entry = direction === 'BUY' ? c.close + askSpread : c.close;
            let proposedSl = direction === 'BUY' ? c.low - (2 * pipSize) : c.high + (2 * pipSize) + askSpread;

            const slDistPips = Math.abs(entry - proposedSl) / pipSize;
            if (slDistPips < minSl) {
              proposedSl = direction === 'BUY' ? entry - (minSl * pipSize) : entry + (minSl * pipSize);
            } else if (slDistPips > maxSl) {
              proposedSl = direction === 'BUY' ? entry - (maxSl * pipSize) : entry + (maxSl * pipSize);
            }

            const riskPips = Math.abs(entry - proposedSl) / pipSize;
            const tpDist = 100 * pipSize;
            const tp = direction === 'BUY' ? entry + tpDist : entry - tpDist;

            let sl = proposedSl;
            let currentSl = sl;
            let lastConfirmedSL = sl;
            let secondLastConfirmedSL = sl;
            let unconfirmedSwingLow: number | null = null;
            let lastSwingHigh: number | null = null;

            let lastConfirmedSH = sl;
            let secondLastConfirmedSH = sl;
            let unconfirmedSwingHigh: number | null = null;
            let lastSwingLow: number | null = null;

            let outcome = '';
            let exitPrice = 0;
            let lastFcEstHour = c.estHour;
            let hasTakenPartial = false;
            let highestProfitPips = 0;

            for (let j = i + 1; j < Math.min(i + Math.floor((fcHours * 60) / 5), candles.length); j++) {
              const fc = candles[j];
              const dateStr = getFixedEstDate(new Date(fc.timestamp)).toISOString().split("T")[0];
              const isNewsForceCloseLocal = isNewsForceClose(dateStr, fc.estHour, fc.minute);
              const is1700Rollover = lastFcEstHour !== -1 && ((lastFcEstHour < 17 && fc.estHour >= 17) || (lastFcEstHour > fc.estHour && fc.estHour >= 17));
              lastFcEstHour = fc.estHour;

              if (is1700Rollover || isNewsForceCloseLocal) { 
                outcome = isNewsForceCloseLocal ? 'NEWS_CLOSE' : 'EOD'; 
                exitPrice = direction === 'SELL' ? fc.close + askSpread : fc.close; 
                break; 
              }

              if (direction === 'SELL') {
                if (fc.high + askSpread >= currentSl) { outcome = 'SL'; exitPrice = currentSl; break; }
                if (fc.low + askSpread <= tp) { outcome = 'TP'; exitPrice = tp; break; }
              } else {
                if (fc.low <= currentSl) { outcome = 'SL'; exitPrice = currentSl; break; }
                if (fc.high >= tp) { outcome = 'TP'; exitPrice = tp; break; }
              }

              const profitPips = direction === 'SELL' ? (entry - (fc.low + askSpread)) / pipSize : (fc.high - entry) / pipSize;
              if (profitPips > highestProfitPips) highestProfitPips = profitPips;

              if (!hasTakenPartial && profitPips >= (1.5 * riskPips)) {
                hasTakenPartial = true;
                const bePips = 2.0;
                const bePrice = direction === 'SELL' ? entry - (bePips * pipSize) : entry + (bePips * pipSize);
                let moveSl = false;
                if (direction === 'BUY' && sl < bePrice) moveSl = true;
                else if (direction === 'SELL' && sl > bePrice) moveSl = true;
                if (moveSl) {
                   sl = bePrice;
                   currentSl = bePrice;
                   lastConfirmedSL = sl;
                   secondLastConfirmedSL = sl;
                   lastConfirmedSH = sl;
                   secondLastConfirmedSH = sl;
                }
              }

              if (j >= 4) {
                const c0 = candles[j];
                const c1 = candles[j-1];
                const c2 = candles[j-2];
                const c3 = candles[j-3];
                const c4 = candles[j-4];

                if (direction === 'BUY') {
                  if (c2.low < c0.low && c2.low < c1.low && c2.low < c3.low && c2.low < c4.low) unconfirmedSwingLow = c2.low;
                  if (c2.high > c0.high && c2.high > c1.high && c2.high > c3.high && c2.high > c4.high) lastSwingHigh = c2.high;
                  if (lastSwingHigh !== null && unconfirmedSwingLow !== null) {
                    if (c0.close > lastSwingHigh) {
                      if (unconfirmedSwingLow !== lastConfirmedSL) {
                        secondLastConfirmedSL = lastConfirmedSL;
                        lastConfirmedSL = unconfirmedSwingLow;
                        if (secondLastConfirmedSL > currentSl) {
                          currentSl = secondLastConfirmedSL - pipSize;
                        }
                      }
                    }
                  }
                } else {
                  if (c2.high > c0.high && c2.high > c1.high && c2.high > c3.high && c2.high > c4.high) unconfirmedSwingHigh = c2.high;
                  if (c2.low < c0.low && c2.low < c1.low && c2.low < c3.low && c2.low < c4.low) lastSwingLow = c2.low;
                  if (lastSwingLow !== null && unconfirmedSwingHigh !== null) {
                    if (c0.close < lastSwingLow) {
                      if (unconfirmedSwingHigh !== lastConfirmedSH) {
                        secondLastConfirmedSH = lastConfirmedSH;
                        lastConfirmedSH = unconfirmedSwingHigh;
                        if (secondLastConfirmedSH < currentSl) {
                          currentSl = secondLastConfirmedSH + pipSize;
                        }
                      }
                    }
                  }
                }
              }
            }

            if (!outcome) {
              outcome = 'FORCE_CLOSE';
              exitPrice = direction === 'SELL' ? candles[Math.min(i + Math.floor((fcHours * 60) / 5) - 1, candles.length - 1)].close + askSpread : candles[Math.min(i + Math.floor((fcHours * 60) / 5) - 1, candles.length - 1)].close;
            }

            const finalPips = direction === 'SELL' ? (entry - exitPrice) / pipSize : (exitPrice - entry) / pipSize;
            let blendedPips = finalPips;
            if (hasTakenPartial) {
               const partialPips = 1.5 * riskPips;
               blendedPips = (partialPips * 0.5) + (finalPips * 0.5);
            }

            const rMultiple = blendedPips / riskPips;
            const dateStr = getFixedEstDate(new Date(c.timestamp)).toISOString().split("T")[0];
            dailyNetR[dateStr] = (dailyNetR[dateStr] || 0) + rMultiple;
            totalNetR += rMultiple;
            totalTrades++;
            if (rMultiple > 0) winningTrades++;

            if (totalNetR > peak) peak = totalNetR;
            const dd = peak - totalNetR;
            if (dd > maxDrawdown) maxDrawdown = dd;
          }

          return { totalNetR, trades: totalTrades, maxDrawdown, dailyNetR, rawResult: null };
        };

        const fitnessFn = (params: any[]): FitnessResult => {
          const [minSl, maxSl, minBody, wickRatio, trailTrig, trailStep, fcHours, exitMode] = params;
          if (minSl >= maxSl) return { totalNetR: 0, trades: 0, maxDrawdown: 0, rawResult: null };

          const triggers = getCachedTriggers(minBody, wickRatio, isM5, isEma, isBb, isRsi);
          if (triggers.length === 0) return { totalNetR: 0, trades: 0, maxDrawdown: 0, rawResult: null };

          const res = evaluateSeerExits(triggers, isM5, minSl, maxSl, fcHours);
          return {
            totalNetR: res.totalNetR,
            trades: res.trades,
            maxDrawdown: res.maxDrawdown,
            rawResult: res
          };
        };

        const optimizer = new HybridGeneticOptimizer(chromosomeMapper, fitnessFn, {
          populationSize: 100,
          generations: 40,
          mutationRate: 0.15,
          elitismRatio: 0.1,
          stagnationLimit: 15,
        });

          // Optimize Exhaustive Search by EXCLUDING parameters that Seer doesn't use for math
          // (trailTrig=4, trailStep=5, exitMode=7 are ignored by Stacy Burke math)
          // 3^5 = 243 combinations instead of 3^8 = 6561 combinations!
          const numericIndices = [0, 1, 2, 3, 6];
        
        const bestIS = await optimizer.optimize(numericIndices);
        const top3 = bestIS.slice(0, 3);
        for (const candidate of top3) {
          const params = candidate.params;
          const [minSl, maxSl, minBody, wickRatio, trailTrig, trailStep, fcHours, exitMode] = params;
          const topIS = fitnessFn(params);

          if (topIS.totalNetR > 0 && topIS.trades >= 5) {
            const oosTriggers = getCachedTriggers(minBody, wickRatio, oosM5, oosEma, oosBb, oosRsi, true);
            if (oosTriggers.length === 0) continue;

            const oosRes = evaluateSeerExits(oosTriggers, oosM5, minSl, maxSl, fcHours);

            const setupString = `${session}_Body${minBody}_Wick${wickRatio}_MinSL${minSl}_MaxSL${maxSl}_Trig${trailTrig}_Step${trailStep}_FC${fcHours}_Exit${exitMode}`;

            validAlphas.push({
              symbol,
              setup: setupString,
              session,
              windowIndex: window.windowIndex,
              isNetR: topIS.totalNetR,
              isTrades: topIS.trades,
              oosNetR: oosRes.totalNetR,
              oosTrades: oosRes.trades,
              oosMaxDd: oosRes.maxDrawdown,
              oosWinRate: oosRes.trades > 0 ? (Object.values(oosRes.dailyNetR as Record<string, number>).filter(v => v > 0).length / oosRes.trades) * 100 : 0,
              totalNetR: oosRes.totalNetR,
              trades: oosRes.trades,
              winRate: oosRes.trades > 0 ? (Object.values(oosRes.dailyNetR as Record<string, number>).filter(v => v > 0).length / oosRes.trades) * 100 : 0,
              dailyNetR: oosRes.dailyNetR
            });
          }
        }
      }
    }

    const sortedAlphas = validAlphas.sort((a, b) => b.totalNetR - a.totalNetR);
    fs.writeFileSync(dumpFileExists, JSON.stringify(sortedAlphas, null, 2));
    fs.writeFileSync(wfaFilePath, JSON.stringify(wfaResults, null, 2));

    parentPort?.postMessage(`[3] ${symbol} Optimization complete. Found ${sortedAlphas.length} alphas.`);
  };

  runWorker().catch((err) => {
    console.error(`Worker error on ${workerData.symbol}:`, err);
    process.exit(1);
  });
}
