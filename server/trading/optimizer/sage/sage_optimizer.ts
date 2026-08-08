import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const currentFile =
  typeof __filename !== "undefined"
    ? __filename
    : fileURLToPath(import.meta.url);
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { loadCsv, getLatestDate } from "../../backtester/loadCsv.js";
import { aggregateCandles } from "../../market/CandleAggregator.js";
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";
import { PairConfig, PairConfigManager } from "../../config/PairConfig.js";
import { TriggerEvent, M1TypedArrays, SageOptimizerConfig } from "../../config/types.js";
import { isNewsForceClose } from "../../market/historicalNews.js";
import { isEODSession } from "../../market/MathFilters.js";
import { preComputeTriggers, evaluateExits, hasSevereLosingWeek } from "../../backtester/math_core/SageMathCore.js";
import { WalkForwardEngine } from "../core/WalkForwardEngine.js";
import { ChromosomeMapper } from "../core/ChromosomeMapper.js";
import { HybridGeneticOptimizer, FitnessResult } from "../core/HybridGeneticOptimizer.js";

// Helper for rounding prices
function getDigitsForPair(pair: string): number {
  const optCfg = OPTIMIZER_CONFIG[pair.replace(".Daily", "")];
  const tickSize = optCfg?.tickSize ?? 0.00001;
  const tickStr = tickSize.toString();
  return tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
}
function roundPrice(val: number, pair: string): number {
  return Number(val.toFixed(getDigitsForPair(pair)));
}

// Define default grid parameters
const BASE_MIN_SL_VALS = [10, 15, 20, 30, 40, 60];
const BASE_MAX_SL_VALS = [35, 40, 50, 80, 100, 150, 200, 250, 300];
const SWEEP_BUFFERS = [2, 3, 5, 10, 20, 30]; // Removed 50, added 2
const ENTRY_PENETRATIONS = [0, 20];
const TRAILING_TRIGGERS = [0.25, 0.5, 1.0, 1.5, 2.0]; // Added 0.25
const TRAILING_STEPS = [0.5, 1.0, 2.0];
const FORCE_CLOSE_HOURS = [8, 12, 16];
const EXIT_MODES = ["MIDPOINT", "OPPOSITE_BOUNDARY", "TRAILING"];
const ORB_MINUTES_GRID = [15, 30, 60, 120];
const ACTION_MINUTES_GRID = [5, 10, 15, 30];
const MAX_SWEEP_MULTIPLIERS = [1.5, 2, 3];
const REQUIRE_CLOSE_INSIDE = [true, false];
const SIM_YEARS = 3.0; // Dynamic 3-year lookback

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Champion Seed Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function findClosestIndex(value: any, grid: any[]): number {
  const exact = grid.indexOf(value);
  if (exact !== -1) return exact;
  if (typeof value === 'number') {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < grid.length; i++) {
      if (typeof grid[i] === 'number') {
        const d = Math.abs(grid[i] - value);
        if (d < bestDist) { bestDist = d; best = i; }
      }
    }
    return best;
  }
  return 0;
}

function hammingDistance(a: number[], b: number[]): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff;
}

function decodeSageSetup(
  setupStr: string, session: string,
  minSlGrid: any[], maxSlGrid: any[], sweepGrid: any[], maxBodyGrid: any[],
  entryPenetrationGrid: any[], trailingTriggersGrid: any[], trailingStepsGrid: any[],
  forceCloseHoursGrid: any[], exitModesGrid: any[], startTimesForSession: {h: number, m: number}[],
  orbMinutesGrid: any[], actionMinutesGrid: any[], maxSweepMultipliersGrid: any[], requireCloseInsideGrid: any[]
): number[] | null {
  try {
    const m = setupStr.match(
      /^(\w+)_([\d.]+)%_MinSL([\d.]+)_MaxSL([\d.]+)_Sweep([\d.]+)_MaxSwp([\d.]+)_ReqCls(true|false)_Exit(\w+)_Trig([\d.]+)_Step([\d.]+)_FC(\d+)_StartH(\d+)_StartM(\d+)_OrbMins(\d+)_ActMins(\d+)(?:_MaxBody([\d.]+))?$/
    );
    if (!m) return null;
    const [, sSession, sPen, sMinSL, sMaxSL, sSweep, sMaxSwp, sReqCls, sExit, sTrig, sStep, sFC, sH, sM, sOrb, sAct, sMaxBody] = m;
    if (sSession !== session) return null;
    const startTimeIdx = startTimesForSession.findIndex(t => t.h === parseInt(sH) && t.m === parseInt(sM));
    if (startTimeIdx === -1) return null;
    
    const maxBodyVal = sMaxBody !== undefined ? parseFloat(sMaxBody) : undefined;

    return [
      findClosestIndex(parseFloat(sMinSL), minSlGrid),
      findClosestIndex(parseFloat(sMaxSL), maxSlGrid),
      findClosestIndex(parseFloat(sSweep), sweepGrid),
      findClosestIndex(maxBodyVal, maxBodyGrid),
      findClosestIndex(parseFloat(sPen), entryPenetrationGrid),
      findClosestIndex(parseFloat(sTrig), trailingTriggersGrid),
      findClosestIndex(parseFloat(sStep), trailingStepsGrid),
      findClosestIndex(parseInt(sFC), forceCloseHoursGrid),
      findClosestIndex(sExit, exitModesGrid),
      startTimeIdx,
      findClosestIndex(parseInt(sOrb), orbMinutesGrid),
      findClosestIndex(parseInt(sAct), actionMinutesGrid),
      findClosestIndex(parseFloat(sMaxSwp), maxSweepMultipliersGrid),
      findClosestIndex(sReqCls === 'true', requireCloseInsideGrid),
    ];
  } catch { return null; }
}
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const dumpDir = path.join(
  process.cwd(),
  "server",
  "trading",
  "optimizer",
  "sage",
  "sage_optimizer_dump",
);
if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });

const csvDir = path.join(process.cwd(), "data", "csv");
const ALL_PAIRS = Array.from(
  new Set(
    fs
      .readdirSync(csvDir)
      .filter((f) => f.endsWith(".csv"))
      .map((f) => f.split("_")[0]),
  ),
).sort((a, b) => {
  const priority = [
    "XAUUSD",
    "NAS100.Daily",
    "EURUSD",
    "GBPJPY",
    "GBPAUD",
    "EURCAD",
    "XTIUSD",
    "BTCUSD.Daily",
    "ETHUSD.Daily"
  ];
  const indexA = priority.indexOf(a);
  const indexB = priority.indexOf(b);
  if (indexA !== -1 && indexB !== -1) return indexA - indexB;
  if (indexA !== -1) return -1;
  if (indexB !== -1) return 1;
  return a.localeCompare(b);
});

const cliArgs = process.argv.slice(2).filter(a => !a.startsWith('-'));
const PAIRS_TO_RUN = cliArgs.length > 0 ? ALL_PAIRS.filter(p => cliArgs.includes(p)) : ALL_PAIRS;

if (isMainThread && process.argv[1] && (process.argv[1] === currentFile || path.resolve(process.argv[1]) === path.resolve(currentFile))) {
  const runOptimizationMaster = async () => {
    console.log(
      `\n================================================================`,
    );
    console.log(`Ã°Å¸Â§Â  Sage Reversal Walk-Forward GA Optimizer Ã°Å¸â€Â¥`);
    console.log(
      `================================================================`,
    );
    const maxWorkersPrint = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 8;
    console.log(`Ã¢Å¡Â¡ Spawning Worker Pool with Max Concurrency: ${maxWorkersPrint}`);

    let activeWorkers = 0;
    let index = 0;

    return new Promise<void>((resolve) => {
      function spawnNext() {
        if (index >= PAIRS_TO_RUN.length && activeWorkers === 0) {
          console.log(
            `\nÃ°Å¸Å½â€° Sage GA Optimization Complete! All state JSON files generated.`,
          );
          resolve();
          return;
        }
        const maxWorkers = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 8;
        while (activeWorkers < maxWorkers && index < PAIRS_TO_RUN.length) {
          const symbol = PAIRS_TO_RUN[index++];
          activeWorkers++;
          const worker = new Worker(currentFile, {
            workerData: { symbol },
            execArgv: process.execArgv,
          });

          worker.on("message", (msg) => {
            console.log(msg);
          });
          worker.on("error", (err) => {
            console.error(`[SAGE WORKER ERROR] on ${symbol}:`, err);
          });
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
    const { symbol } = workerData;
    console.log(`[WORKER START] Worker thread started for ${symbol}`);
    const dumpFilePath = path.join(dumpDir, `state_${symbol}.json`);
    const wfaFilePath = path.join(dumpDir, `wfa_${symbol}.json`);
    const lastRunDir = path.join(dumpDir, "last_optimization_run");
    if (!fs.existsSync(lastRunDir)) fs.mkdirSync(lastRunDir, { recursive: true });

    if (fs.existsSync(dumpFilePath)) {
      parentPort?.postMessage(
        `[SKIP] state_${symbol}.json already exists. Skipping ${symbol}.`,
      );
      return;
    }

    const basePair = OPTIMIZER_CONFIG[symbol] ? symbol : (OPTIMIZER_CONFIG[symbol.replace(".Daily", "")] ? symbol.replace(".Daily", "") : symbol + ".Daily");
    const configTemplate = OPTIMIZER_CONFIG[basePair];

    if (!configTemplate) {
      parentPort?.postMessage(
        `[WARN] Skipping ${symbol} - No OPTIMIZER_CONFIG found.`,
      );
      return;
    }

    const csvFiles = fs
      .readdirSync(csvDir)
      .filter((f) => f.startsWith(`${symbol}`) && f.endsWith(".csv"));
    if (csvFiles.length === 0) {
      parentPort?.postMessage(`[WARN] Skipping ${symbol} - No CSV data found.`);
      return;
    }

    const csvFilePath = path.join(csvDir, csvFiles[0]);
    let endDate;
    try {
      endDate = getLatestDate(csvFilePath);
    } catch (e: any) {
      console.log(`[WORKER] CSV load failed: ${e.message}`);
      parentPort?.postMessage(`[WARN] Skipping ${symbol} - Error determining latest date: ${e.message}`);
      return;
    }
    console.log(`[WORKER] CSV dates determined: ${endDate}`);

    const isCrypto = symbol.includes("BTC") || symbol.includes("ETH");
    console.log(`[WORKER] Config loaded for ${symbol}. isCrypto: ${isCrypto}`);
    const isIndex =
      symbol.includes("US30") ||
      symbol.includes("GER40") ||
      symbol.includes("XTIUSD") ||
      symbol.includes(".Daily") ||
      symbol.includes("SPX500") ||
      symbol.includes("NAS100") ||
      symbol.includes("JPN225");
    const isForex = PairConfigManager.isForex(symbol);

    let minSlGrid = BASE_MIN_SL_VALS;
    let maxSlGrid = BASE_MAX_SL_VALS;
    let sweepGrid = SWEEP_BUFFERS;
    let entryPenetrationsGrid = ENTRY_PENETRATIONS;
    let trailingTriggersGrid = TRAILING_TRIGGERS;
    let trailingStepsGrid = TRAILING_STEPS;
    let forceCloseHoursGrid = FORCE_CLOSE_HOURS;
    let exitModesGrid = EXIT_MODES;
    let orbMinutesGrid = ORB_MINUTES_GRID;
    let actionMinutesGrid = ACTION_MINUTES_GRID;

    const MAJORS = ["GBPUSD", "EURUSD"];
    const SLOW_FOREX = ["USDCAD", "USDCHF", "USDJPY"];
    const PACIFIC_PAIRS = ["AUDUSD", "NZDUSD"];
    const VOLATILE_CROSSES = ["GBPAUD", "GBPNZD", "GBPJPY", "CADJPY", "CHFJPY", "EURCAD", "GBPCAD", "EURNZD", "EURJPY", "AUDJPY"];

    if (MAJORS.includes(symbol)) {
      minSlGrid = [5, 7, 10, 15, 20];
      maxSlGrid = [30, 40, 50, 60, 80]; // Pruned 100 (dead)
      sweepGrid = [2, 3, 5, 20]; // Pruned 10, 30, 50
      orbMinutesGrid = [30, 60, 120];
      actionMinutesGrid = [10, 15, 30];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0]; // Pruned 999
    } else if (SLOW_FOREX.includes(symbol)) {
      minSlGrid = [5, 10, 15, 20, 25, 30]; // Pruned 40, 60, 100+
      maxSlGrid = [25, 30, 35, 50, 80]; // Pruned 20, 100, 150, 200+
      sweepGrid = [2, 3, 5, 10]; // Pruned 20, 30, 50
      orbMinutesGrid = [15, 30, 60, 120];
      actionMinutesGrid = [10, 15, 30];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0]; // Pruned 999
    } else if (PACIFIC_PAIRS.includes(symbol)) {
      minSlGrid = [5, 10, 15, 20, 30];
      maxSlGrid = [30, 50, 80, 100];
      sweepGrid = [2, 3, 5, 10]; // Pruned 20, 30, 50
      orbMinutesGrid = [15, 30, 60, 120];
      actionMinutesGrid = [10, 15, 30];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0];
    } else if (VOLATILE_CROSSES.includes(symbol)) {
      minSlGrid = [20, 30, 40, 50, 60, 70, 80]; // Pruned 3, 5, 10 (<1%)
      maxSlGrid = [40, 60, 80, 100]; // Capped at 100 pips: beyond daily range on volatile crosses
      sweepGrid = [3, 5, 10, 20, 30, 50]; // Pruned 2 (dead)
      orbMinutesGrid = [15, 30, 60, 120];
      actionMinutesGrid = [15, 30];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0];
    } else if (symbol.includes("BTC")) {
      minSlGrid = [20, 30, 60, 100]; // Added 20 — extend lower
      maxSlGrid = [150, 300, 500];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0];
      trailingStepsGrid = [0.5, 1.0, 2.0];
    } else if (symbol.includes("ETH")) {
      minSlGrid = [20, 30, 50, 80]; // Raised floor to 20 pips — aligned with BTC volatility class
      maxSlGrid = [100, 200, 300];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0];
      trailingStepsGrid = [0.5, 1.0, 2.0];
    } else if (
      symbol.includes("US30") ||
      symbol.includes("GER40") ||
      symbol.includes("NAS100")
    ) {
      minSlGrid = [10, 15, 20, 40, 70, 120]; // Added 10,15 — boundary pressure at 20
      maxSlGrid = [80, 150, 200, 300]; // Realigned
      orbMinutesGrid = [15, 30, 60]; // Added 60
    } else if (symbol.includes("SPX")) {
      minSlGrid = [5, 10, 20, 30]; // Added 5 — boundary at 10
      maxSlGrid = [40, 80, 120, 200];
      orbMinutesGrid = [15, 30, 60];
      actionMinutesGrid = [5, 10, 15, 30, 60, 90]; // Added 90
      entryPenetrationsGrid = [0.0, 0.2];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0]; // Pruned 999
    } else if (symbol.includes("JPN")) {
      minSlGrid = [30, 50, 80, 120];
      maxSlGrid = [100, 150, 200, 250];
      orbMinutesGrid = [15, 30, 60, 120];
      actionMinutesGrid = [5, 10, 15, 30, 60];
      entryPenetrationsGrid = [0.0, 0.2];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0]; // Pruned 999
    } else if (symbol.includes("XAU") || symbol.includes("XTI")) {
      minSlGrid = [10, 15, 30, 40];
      maxSlGrid = [40, 80, 120, 160, 200, 250]; // Added 200,250 — XAUUSD boundary at 160
      actionMinutesGrid = [5, 10, 15, 30, 60, 90, 120]; // Added 90,120
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0]; // Pruned 999
    }

    sweepGrid = SWEEP_BUFFERS;
    if (VOLATILE_CROSSES.includes(symbol)) {
      sweepGrid = [3, 5, 10, 20, 30, 50]; // Added 3
    } else if (symbol.includes("BTC")) {
      sweepGrid = [5, 10, 20, 50]; // Added 5
    } else if (symbol.includes("ETH")) {
      sweepGrid = [5, 10, 20, 50]; // Added 5
    } else if (
      symbol.includes("US30") ||
      symbol.includes("GER40") ||
      symbol.includes("NAS100")
    ) {
      sweepGrid = [5, 10, 20, 30, 50]; // Added 5
    } else if (symbol.includes("SPX")) {
      sweepGrid = [10, 20, 30, 50]; // Realigned
    } else if (symbol.includes("JPN")) {
      sweepGrid = [10, 20, 30, 50]; // Realigned
    } else if (symbol.includes("XAU") || symbol.includes("XTI")) {
      sweepGrid = [3, 5, 7, 10, 20, 30]; // Added 3,7
    }

    let maxBodyGrid = [3, 8, undefined]; // Default Forex
    if (VOLATILE_CROSSES.includes(symbol)) {
      maxBodyGrid = [5, 15, 25, undefined]; // GBP crosses can have large sweep wicks that DO reverse — added 25
    } else if (symbol.includes("BTC")) {
      maxBodyGrid = [9, 20, undefined];
    } else if (symbol.includes("ETH")) {
      maxBodyGrid = [8, 19, undefined];
    } else if (symbol.includes("US30") || symbol.includes("GER40")) {
      maxBodyGrid = [12, 22, undefined];
    } else if (symbol.includes("NAS100")) {
      maxBodyGrid = [6, 15, undefined];
    } else if (symbol.includes("SPX500")) {
      maxBodyGrid = [4, 8, 12, undefined];
    } else if (symbol.includes("JPN225")) {
      maxBodyGrid = [10, 20, undefined];
    } else if (symbol.includes("XAU")) {
      maxBodyGrid = [50, 125, undefined];
    } else if (
      symbol.includes("GBPAUD") ||
      symbol.includes("EURAUD") ||
      symbol.includes("EURNZD")
    ) {
      maxBodyGrid = [5, 10, undefined];
    } else if (symbol.includes("GBPJPY")) {
      maxBodyGrid = [5, 10, undefined];
    }

    let sessions = ["asia", "london", isIndex ? "NY_Indices" : "NY_Forex"];
    if (["CHFJPY", "CADJPY", "AUDJPY", "EURJPY", "GBPJPY", "USDJPY"].includes(symbol)) {
      sessions = ["asia", "london"]; // JPY pairs sweep best in Tokyo/London. NY is dead liquidity.
    }
    const startTimesMap: Record<string, {h: number, m: number}[]> = {
      asia: [
        { h: 18, m: 0 },
        { h: 20, m: 0 },
        { h: 20, m: 30 },
        { h: 20, m: 45 },
        { h: 21, m: 0 },
        { h: 21, m: 30 },
      ],
      london: [
        { h: 2, m: 0 },
        { h: 3, m: 0 },
        { h: 3, m: 15 },
        { h: 3, m: 30 },
        { h: 4, m: 0 },
      ],
      NY_Indices: [
        { h: 8, m: 0 },
        { h: 9, m: 0 },
        { h: 9, m: 30 },
        { h: 9, m: 45 },
        { h: 10, m: 0 },
      ],
      NY_Forex: [
        { h: 8, m: 30 },
        { h: 9, m: 0 },
        { h: 9, m: 30 },
        { h: 9, m: 45 },
        { h: 10, m: 0 },
      ]
    };

    // Session overrides for JPY Crosses (bias to Asia)
    if (["CHFJPY", "CADJPY", "AUDJPY", "EURJPY"].includes(symbol)) {
      startTimesMap.asia = [
        { h: 18, m: 0 },
        { h: 20, m: 0 },
        { h: 20, m: 30 },
        { h: 21, m: 0 },
        { h: 21, m: 30 },
        { h: 22, m: 0 },
      ];
    }

    // Session overrides for USDJPY (bias to Asia)
    if (symbol === "USDJPY") {
      startTimesMap.asia = [
        { h: 18, m: 0 },
        { h: 20, m: 0 },
        { h: 21, m: 0 },
        { h: 21, m: 30 },
      ];
    }

    // Session overrides for NZD and AUD crosses (add early Asia Sydney/Wellington open)
    if (symbol === "EURNZD" || symbol === "GBPNZD" || symbol === "EURAUD" || symbol === "GBPAUD") {
      startTimesMap.asia = [
        ...startTimesMap.asia,
        { h: 22, m: 0 },
        { h: 23, m: 0 },
        { h: 0, m: 0 },
      ];
    }

    const startDate = new Date(endDate.getTime());
    startDate.setFullYear(startDate.getFullYear() - SIM_YEARS);

    parentPort?.postMessage(
      `[1] Loading ${csvFiles[0]} into RAM (${startDate.getUTCFullYear()}-${endDate.getUTCFullYear()}) for ${symbol}...`,
    );

    let m1Rows: any[] = [];
    for (const f of csvFiles) {
      const p = path.join(csvDir, f);
      m1Rows = m1Rows.concat(
        await loadCsv(
          p,
          configTemplate.spread,
          startDate,
          endDate
        ),
      );
    }
    const m5Candles = aggregateCandles(m1Rows, 5);

    parentPort?.postMessage(
      `[1.5] Parsing ${m1Rows.length} candles into High-Speed TypedArrays...`,
    );

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
      
      m1Typed.isEOD_standard[i] = isEODSession(h, m) ? 1 : 0;
      if (i > 0) {
        const prevH = m1Rows[i-1].estHour;
        m1Typed.isSessionReset[i] = ((prevH < 17 && h >= 17) || (prevH > h && h >= 17)) ? 1 : 0;
        m1Typed.isMidnightExpiry[i] = (prevH > h && h < 17) ? 1 : 0;
      }
      
      const dateStr = new Date(r.timestamp).toISOString().split('T')[0];
      m1Typed.isNewsForceClose[i] = isNewsForceClose(dateStr, h, m) ? 1 : 0;
    }

    // Generate Walk-Forward windows
    const wfaWindows = WalkForwardEngine.generateWindows(m1Typed);
    parentPort?.postMessage(`[2] Generated ${wfaWindows.length} Walk-Forward windows.`);

    let validAlphas: any[] = [];
    const wfaLog: any[] = [];

    // Load best OOS champions from permanent DNA bank for seeding
    let prevDumpAlphas: any[] = [];
    const dnaDir = path.join(path.dirname(currentFile), "dna_bank");
    if (!fs.existsSync(dnaDir)) fs.mkdirSync(dnaDir, { recursive: true });

    const dnaFile = path.join(dnaDir, `sage_dna_${symbol}.json`);
    if (fs.existsSync(dnaFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(dnaFile, "utf8"));
        if (Array.isArray(raw)) {
          prevDumpAlphas = raw
            .filter((a: any) => typeof a.isNetR === "number" && a.isNetR > 0 && typeof a.setup === "string")
            // Hard reject any legacy 999 setups — these are broken sentinel values from a prior bug
            .filter((a: any) => !a.setup.includes("Trig999") && !a.setup.includes("Step999"))
            .filter((a: any) => {
              const minSlMatch = a.setup.match(/MinSL([\d\.]+)/i);
              if (!minSlMatch) return true;
              const minSlVal = parseFloat(minSlMatch[1]);
              return minSlVal >= (minSlGrid[0] ?? 0);
            })
            // Sort by IS Calmar ratio — NOT OOS NetR — to eliminate look-ahead bias in seeding
            .sort((a: any, b: any) => {
              const calmarA = a.isNetR / Math.max(0.1, a.isMaxDd ?? 1);
              const calmarB = b.isNetR / Math.max(0.1, b.isMaxDd ?? 1);
              return calmarB - calmarA;
            });
        }
      } catch { /* DNA file corrupt or missing */ }
    }

    for (const session of sessions) {
      const startTimes = startTimesMap[session];

      // --- CROSS-WINDOW FULL-YEAR CACHES ---
      // These persist across all 14 WFA windows for this session.
      // Same trigger-param combo or same complete setup need only be computed ONCE,
      // regardless of how many WFA windows discover it as a winner.
      const fullYearTriggerCache = new Map<string, TriggerEvent[]>();
      const fullYearResultCache = new Map<string, any>();
      // -------------------------------------
      
      // Build parameters grid definition (using pair-specific SL grids defined above)

      const grids = [
        minSlGrid,             // 0
        maxSlGrid,             // 1
        sweepGrid,             // 2
        maxBodyGrid,           // 3
        entryPenetrationsGrid,  // 4
        trailingTriggersGrid,  // 5
        trailingStepsGrid,     // 6
        forceCloseHoursGrid,   // 7
        exitModesGrid,         // 8: categorical
        startTimes,            // 9: categorical
        orbMinutesGrid,        // 10: discrete
        actionMinutesGrid,     // 11: discrete
        MAX_SWEEP_MULTIPLIERS, // 12: discrete
        REQUIRE_CLOSE_INSIDE,  // 13: discrete (boolean)
      ];

      const mapper = new ChromosomeMapper(grids);
      const numericIndices = [0, 1, 2, 3, 4, 5, 6, 7, 12];

      // Run Walk-Forward validation across windows
      for (const window of wfaWindows) {
        parentPort?.postMessage(`[3] Running GA on Window ${window.windowIndex + 1}/${wfaWindows.length} for ${session}...`);

        // Slice the data for the In-Sample window
        const isM5 = m5Candles.filter(c => c.timestamp >= window.inSampleStart.getTime() && c.timestamp <= window.inSampleEnd.getTime());
        const isM1 = m1Rows.filter(r => r.timestamp >= window.inSampleStart.getTime() && r.timestamp <= window.inSampleEnd.getTime());
        const isTyped = WalkForwardEngine.sliceTypedArrays(m1Typed, window.inSampleStartIndex, window.inSampleEndIndex);

        // Window-scoped Trigger Cache (persists across all 60 GA generations for this IS window)
        const triggerCache = new Map<string, TriggerEvent[]>();
        function getCachedTriggers(
          tSpec: { h: number; m: number },
          orbMins: number,
          sweepPipsVal: number,
          actMins: number,
          maxSweepMult: number,
          reqCloseInside: boolean
        ) {
          const cacheKey = `${tSpec.h}_${tSpec.m}_${orbMins}_${sweepPipsVal}_${actMins}_${maxSweepMult}_${reqCloseInside}`;
          if (!triggerCache.has(cacheKey)) {
            const t = preComputeTriggers(
              isM5,
              isM1,
              symbol,
              configTemplate.spread * configTemplate.pipSize,
              session,
              isForex,
              configTemplate.pipSize,
              tSpec.h,
              tSpec.m,
              orbMins,
              sweepPipsVal,
              actMins,
              maxSweepMult,
              reqCloseInside
            );
            triggerCache.set(cacheKey, t);
          }
          return triggerCache.get(cacheKey)!;
        }

        // Define fitness function for this IS window (for local search fallback)
        const fitnessFn = (params: any[]): FitnessResult => {
          const [
            minSl, maxSl, sweepPips, maxBodyPips, entryPenetration,
            trailTrig, trailStep, fcHours, exitMode, startTime,
            orbMinutes, actionMinutes, maxSweepMult, reqCloseInside
          ] = params;

          if (minSl >= maxSl || actionMinutes > orbMinutes) {
            return { totalNetR: 0, trades: 0, maxDrawdown: 0, rawResult: null };
          }

          const triggers = getCachedTriggers(startTime, orbMinutes, sweepPips, actionMinutes, maxSweepMult, reqCloseInside);
          const overrideConfig: SageOptimizerConfig = {
            minSlDist: minSl,
            maxSlDist: maxSl,
            sweepPips: sweepPips,
            maxSweepMultiplier: maxSweepMult,
            requireCloseInside: reqCloseInside,
            maxBodyPips: maxBodyPips,
            entryPenetrationPct: entryPenetration,
            trailingSlTrigger: trailTrig,
            trailingSlStep: trailStep,
            forceCloseHours: fcHours,
            exitMode: exitMode,
            reversalEnabled: true,
            orbStartHour: startTime.h,
            orbStartMin: startTime.m,
            orbMinutes: orbMinutes,
            actionMinutes: actionMinutes,
          };

          const res = evaluateExits(isTyped, isM5, triggers, symbol, overrideConfig, session, isForex);
          
          let peak = 0;
          let runningR = 0;
          let maxDD = 0;
          for (const date of Object.keys(res.dailyNetR)) {
            runningR += res.dailyNetR[date];
            if (runningR > peak) peak = runningR;
            const dd = peak - runningR;
            if (dd > maxDD) maxDD = dd;
          }

          return {
            totalNetR: res.totalNetR,
            trades: res.trades,
            maxDrawdown: maxDD,
            rawResult: res
          };
        };

        // Heuristic Initialization Archetypes (Smart Seeding)
        // NOTE: chromosome positions (14 total) Ã¢â€ â€™
        //   [0]minSl [1]maxSl [2]sweep [3]maxBody [4]ep [5]trailTrig [6]trailStep
        //   [7]fc [8]exitMode [9]startTime [10]orbMins [11]actionMins [12]maxSweepMult [13]reqCloseInside
        const seedChromosomes = [
          // 1. The Deep Sweep Fader (BE-Runner): Wide SL, Large sweep, BE exit, long ORB, MID action
          // Fix: was 12 elements (missing indices 12,13 Ã¢â€ â€™ undefined behavior).
          // Fix: actionMins was idx 0 (MIN=10min) with orbMins=MAX(120min) Ã¢â€ â€™ near-zero trades. Now actionMins=MID.
          // Rationale: XAUUSD, USDJPY top Sage configs use wide sweep, BE step (999), long ORB.
          [
            0,                                                          // [0] minSl = smallest
            maxSlGrid.length - 1,                                       // [1] maxSl = largest
            sweepGrid.length - 1,                                       // [2] sweep = largest (deep sweep confirm)
            0,                                                          // [3] maxBody = smallest (no body cap)
            0,                                                          // [4] ep = 0% penetration
            trailingTriggersGrid.length - 1,                            // [5] trailTrig = largest (2.0R Ã¢â€ â€™ move to BE after 2R profit)
            trailingStepsGrid.length - 1,                               // [6] trailStep = 999 (BE-only Ã¢â‚¬â€ dump-confirmed dominant)
            forceCloseHoursGrid.length - 1,                             // [7] fc = max (8h for Sage)
            0,                                                          // [8] exitMode = MIDPOINT (idx 0)
            0,                                                          // [9] startTime = first slot
            orbMinutesGrid.length - 1,                                  // [10] orbMins = LARGEST (long ORB builds meaningful range)
            Math.floor(actionMinutesGrid.length / 2),                   // [11] actionMins = MID (NOT min Ã¢â‚¬â€ gives real trade opportunities)
            Math.floor(MAX_SWEEP_MULTIPLIERS.length / 2),               // [12] maxSweepMult = mid (3x)
            1                                                           // [13] requireCloseInside = false (idx 1, more lenient entry)
          ],

          // 2. The Quick Reversal Scalper: Tight SL, Small sweep, strict close-inside, short windows
          // Rationale: USDCAD/USDCHF/USDJPY patterns Ã¢â‚¬â€ small precise setups, fast confirmation
          // Fix: was 12 elements (missing [12] and [13]).
          [
            0,                                                          // [0] minSl = smallest
            Math.floor(maxSlGrid.length * 0.4),                         // [1] maxSl = ~40th pct (tight)
            0,                                                          // [2] sweep = smallest (tight sweep threshold)
            0,                                                          // [3] maxBody = smallest
            0,                                                          // [4] ep = 0%
            0,                                                          // [5] trailTrig = smallest (0.5R Ã¢â€ â€™ fast BE)
            trailingStepsGrid.length - 1,                               // [6] trailStep = 999 (BE-only)
            forceCloseHoursGrid.length - 1,                             // [7] fc = max
            0,                                                          // [8] exitMode = MIDPOINT
            0,                                                          // [9] startTime = first
            0,                                                          // [10] orbMins = smallest
            0,                                                          // [11] actionMins = smallest
            0,                                                          // [12] maxSweepMult = smallest (2x)
            0                                                           // [13] requireCloseInside = true (strict)
          ],

          // 3. The Trailing Sweep Trend-Follower: Mid everything, TRAILING exit, medium windows
          // Rationale: EURJPY/GBPJPY/GBPAUD Sage setups where sweeps become sustained trends
          [
            0,                                                          // [0] minSl = smallest
            Math.floor(maxSlGrid.length * 0.6),                         // [1] maxSl = 60th pct
            Math.floor(sweepGrid.length / 2),                           // [2] sweep = mid
            Math.floor(maxBodyGrid.length / 2),                         // [3] maxBody = mid
            0,                                                          // [4] ep = 0%
            Math.floor(trailingTriggersGrid.length / 2),                // [5] trailTrig = mid (1.0R)
            Math.floor(trailingStepsGrid.length / 2),                   // [6] trailStep = mid (2.0)
            forceCloseHoursGrid.length - 1,                             // [7] fc = max
            2,                                                          // [8] exitMode = TRAILING (idx 2)
            0,                                                          // [9] startTime = first
            Math.floor(orbMinutesGrid.length / 2),                      // [10] orbMins = mid
            Math.floor(actionMinutesGrid.length / 2),                   // [11] actionMins = mid
            1,                                                          // [12] maxSweepMult = mid (3x)
            1                                                           // [13] requireCloseInside = false
          ]
        ];

        // Decode diverse champions from previous dump for this session
        const championChromosomes: number[][] = [];
        for (const alpha of prevDumpAlphas) {
          if (championChromosomes.length >= 10) break;
          const chrom = decodeSageSetup(
            alpha.setup, session,
            minSlGrid, maxSlGrid, sweepGrid, maxBodyGrid,
            entryPenetrationsGrid, trailingTriggersGrid, trailingStepsGrid,
            forceCloseHoursGrid, exitModesGrid, startTimesMap[session],
            orbMinutesGrid, actionMinutesGrid, MAX_SWEEP_MULTIPLIERS, REQUIRE_CLOSE_INSIDE
          );
          if (!chrom) continue;
          const isDiverse = championChromosomes.every(e => hammingDistance(chrom, e) >= 3);
          if (isDiverse) championChromosomes.push(chrom);
        }
        const allSeedChromosomes = [...championChromosomes, ...seedChromosomes];

        // === WFA-INTEGRATED FITNESS: Pre-compute OOS slices before the GA runs ===
        const oosM5_wfa = m5Candles.filter(c => c.timestamp >= window.outOfSampleStart.getTime() && c.timestamp <= window.outOfSampleEnd.getTime());
        const oosM1_wfa = m1Rows.filter(r => r.timestamp >= window.outOfSampleStart.getTime() && r.timestamp <= window.outOfSampleEnd.getTime());
        const oosTyped_wfa = WalkForwardEngine.sliceTypedArrays(m1Typed, window.outOfSampleStartIndex, window.outOfSampleEndIndex);

        // Removed unused oosTriggerCache and getOosCachedTriggers

        // Instantiate Hybrid GA Optimizer (150 pop Ãƒâ€” 60 gen = 9,000 evals/window)
        const optimizer = new HybridGeneticOptimizer(mapper, fitnessFn, {
          populationSize: 150,
          generations: 60,
          mutationRate: 0.15,
          fitnessMode: 'calmar',
          seedChromosomes: allSeedChromosomes,
          fitnessFnBatch: async (paramsBatch: any[][]) => {
            const results: FitnessResult[] = new Array(paramsBatch.length);
            const groups = new Map<string, { chromosomes: any[], indices: number[], triggers: any[] }>();
            for (let idx = 0; idx < paramsBatch.length; idx++) {
              const params = paramsBatch[idx];
              const [
                minSl, maxSl, sweepPips, maxBodyPips, entryPenetration,
                trailTrig, trailStep, fcHours, exitMode, startTime,
                orbMinutes, actionMinutes, maxSweepMult, reqCloseInside
              ] = params;

              if (minSl >= maxSl || actionMinutes > orbMinutes) {
                results[idx] = { totalNetR: 0, trades: 0, maxDrawdown: 0, rawResult: null };
                continue;
              }
              
              const key = `${startTime.h}_${startTime.m}_${orbMinutes}_${sweepPips}_${actionMinutes}_${maxSweepMult}_${reqCloseInside}`;
              if (!groups.has(key)) {
                const triggers = getCachedTriggers(startTime, orbMinutes, sweepPips, actionMinutes, maxSweepMult, reqCloseInside);
                groups.set(key, { chromosomes: [], indices: [], triggers });
              }
              const group = groups.get(key)!;
              group.chromosomes.push({
                minSlDist: minSl,
                maxSlDist: maxSl,
                sweepPips: sweepPips,
                maxSweepMultiplier: maxSweepMult,
                requireCloseInside: reqCloseInside,
                maxBodyPips: maxBodyPips,
                entryPenetrationPct: entryPenetration,
                trailingSlTrigger: trailTrig,
                trailingSlStep: trailStep,
                forceCloseHours: fcHours,
                exitMode: exitMode,
                orbStartHour: startTime.h,
                orbStartMin: startTime.m,
                orbMinutes: orbMinutes,
                actionMinutes: actionMinutes,
              });
              group.indices.push(idx);
            }

            for (const [key, group] of groups.entries()) {
              if (group.triggers.length === 0) {
                for (const idx of group.indices) {
                  results[idx] = { totalNetR: 0, trades: 0, maxDrawdown: 0, rawResult: null };
                }
                continue;
              }

              for (let i = 0; i < group.chromosomes.length; i++) {
                const idx = group.indices[i];
                const chromo = group.chromosomes[i];
                const configObj = { ...chromo, reversalEnabled: true };

                // --- IS Evaluation ---
                const isRes = evaluateExits(isTyped, isM5, group.triggers, symbol, configObj, session, isForex);

                let peak = 0, runningR = 0, maxDD = 0;
                for (const date of Object.keys(isRes.dailyNetR)) {
                  runningR += isRes.dailyNetR[date];
                  if (runningR > peak) peak = runningR;
                  const dd = peak - runningR;
                  if (dd > maxDD) maxDD = dd;
                }

                // --- Strict IS Fitness: OOS Evaluation is completely removed from breeding ---
                let blendedNetR = isRes.totalNetR;


                results[idx] = {
                  totalNetR: blendedNetR,
                  trades: isRes.trades,
                  maxDrawdown: maxDD,
                  rawResult: null,
                };
              }
            }
            return results;
          }
        });

        // Run optimization
        const bestIS = await optimizer.optimize(numericIndices);
        if (bestIS.length > 0) {
          // Take the top 3 best candidates from the In-Sample search
          const topCandidates = bestIS.slice(0, 3);
          
          for (const topIS of topCandidates) {
            if (topIS.fitness <= 0) continue;
            
            // Evaluate Out-Of-Sample
            const oosM5 = m5Candles.filter(c => c.timestamp >= window.outOfSampleStart.getTime() && c.timestamp <= window.outOfSampleEnd.getTime());
            const oosM1 = m1Rows.filter(r => r.timestamp >= window.outOfSampleStart.getTime() && r.timestamp <= window.outOfSampleEnd.getTime());
            const oosTyped = WalkForwardEngine.sliceTypedArrays(m1Typed, window.outOfSampleStartIndex, window.outOfSampleEndIndex);

            const [
              minSl, maxSl, sweepPips, maxBodyPips, entryPenetration,
              trailTrig, trailStep, fcHours, exitMode, startTime,
              orbMinutes, actionMinutes, maxSweepMult, reqCloseInside
            ] = topIS.params;

            const oosTriggers = preComputeTriggers(
              oosM5, oosM1, symbol,
              configTemplate.spread * configTemplate.pipSize,
              session, isForex, configTemplate.pipSize,
              startTime.h, startTime.m, orbMinutes, sweepPips, actionMinutes, maxSweepMult, reqCloseInside
            );

            const overrideConfig: SageOptimizerConfig = {
              minSlDist: minSl,
              maxSlDist: maxSl,
              sweepPips: sweepPips,
              maxSweepMultiplier: maxSweepMult,
              requireCloseInside: reqCloseInside,
              maxBodyPips: maxBodyPips,
              entryPenetrationPct: entryPenetration,
              trailingSlTrigger: trailTrig,
              trailingSlStep: trailStep,
              forceCloseHours: fcHours,
              exitMode: exitMode,
              reversalEnabled: true,
              orbStartHour: startTime.h,
              orbStartMin: startTime.m,
              orbMinutes: orbMinutes,
              actionMinutes: actionMinutes,
            };

            const oosRes = evaluateExits(oosTyped, oosM5, oosTriggers, symbol, overrideConfig, session, isForex);
            
            wfaLog.push({
              windowIndex: window.windowIndex,
              session,
              inSample: {
                netR: topIS.result.totalNetR,
                trades: topIS.result.trades,
                maxDrawdown: topIS.result.maxDrawdown,
              },
              outOfSample: {
                netR: oosRes.totalNetR,
                trades: oosRes.trades,
              },
              params: topIS.result.rawResult?.setup,
            });

            // ✅ UNBIASED WFA: Store OOS-slice result with IS Calmar metadata.
            // OOS trade gate prevents single-trade flukes from contaminating the DNA bank.
            // isNetR + isMaxDd allow DNA bank to seed future IS runs by IS Calmar (not OOS luck).
            const isLowFreqAsset = /BTC|ETH|JPN|GER|NAS|SPX|US30|XAU|XTI/i.test(symbol);
            const minOosTrades = isLowFreqAsset ? 1 : 2;
            if (oosRes.trades >= minOosTrades) {
              validAlphas.push({
                setup: oosRes.setup,
                dailyNetR: oosRes.dailyNetR,      // OOS slice only — strictly unbiased
                trades: oosRes.trades,
                totalNetR: oosRes.totalNetR,      // 2-month OOS Net R (for Grandmaster)
                oosNetR: oosRes.totalNetR,        // Schema compatibility
                isNetR: topIS.result.totalNetR,   // IS Net R — used to rank DNA seeds
                isMaxDd: topIS.result.maxDrawdown, // IS Max DD — used to compute IS Calmar for seeding
                records: []
              });
            }
          }
        }
      }
    }

    // Save final report & top Alphas
    if (validAlphas.length > 0) {
      // Sort dump by IS Calmar ratio — ensures Grandmaster sees IS-robust configs first
      validAlphas.sort((a, b) => {
        const calmarA = a.isNetR / Math.max(0.1, a.isMaxDd ?? 1);
        const calmarB = b.isNetR / Math.max(0.1, b.isMaxDd ?? 1);
        return calmarB - calmarA;
      });
      const topAlphas = validAlphas.slice(0, 3200);

      const wfaReportFile = path.join(dumpDir, `wfa_${symbol}.json`);
      fs.writeFileSync(
        wfaReportFile,
        JSON.stringify(wfaLog, null, 2),
        "utf8",
      );
      fs.writeFileSync(
        dumpFilePath,
        JSON.stringify(topAlphas, null, 2),
        "utf8",
      );

      // Evolutionary Assimilation: Merge Top 50 Alphas into DNA Vault
      const dnaFile = path.join(dnaDir, `sage_dna_${symbol}.json`);
      let existingDna: any[] = [];
      if (fs.existsSync(dnaFile)) {
        try {
          existingDna = JSON.parse(fs.readFileSync(dnaFile, "utf8"));
        } catch { /* ignore */ }
      }
      
      const combinedDna = [...existingDna, ...validAlphas.slice(0, 50)];
      
      // Deduplicate by signature
      const uniqueDna = Array.from(new Map(combinedDna.map(item => [item.setup, item])).values());
      // Sort DNA bank by IS Calmar — future IS runs seed from IS-robust champions, not OOS lucky winners
      uniqueDna.sort((a: any, b: any) => {
        const calmarA = (a.isNetR ?? a.totalNetR) / Math.max(0.1, a.isMaxDd ?? 1);
        const calmarB = (b.isNetR ?? b.totalNetR) / Math.max(0.1, b.isMaxDd ?? 1);
        return calmarB - calmarA;
      });
      
      // Keep best 150 historical alphas forever
      fs.writeFileSync(dnaFile, JSON.stringify(uniqueDna.slice(0, 150), null, 2), "utf8");

      const bestOosNetR = Math.max(...validAlphas.map(a => a.totalNetR));
      parentPort?.postMessage(
        `[4] Saved ${topAlphas.length} viable OOS-slice Alphas for ${symbol}. Best OOS NetR: ${bestOosNetR.toFixed(2)} R`,
      );
      if (global.gc) global.gc();
    } else {
      parentPort?.postMessage(`[WARN] No viable WFA-compliant Alphas found for ${symbol}. Writing empty dump to prevent infinite re-runs.`);
      fs.writeFileSync(dumpFilePath, "[]", "utf8");
      const wfaReportFile = path.join(dumpDir, `wfa_${symbol}.json`);
      fs.writeFileSync(wfaReportFile, "[]", "utf8");
      // DNA Vault remains untouched, preserving evolutionary history
    }
  };

  runWorker().catch((err) => {
    parentPort?.postMessage(
      `[SAGE ERROR] on ${workerData.symbol}: ${err.stack || err.message}`,
    );
  });
}
