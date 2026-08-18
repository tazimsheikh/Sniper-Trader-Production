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
import { isNewsForceClose } from "../../market/historicalNews.js";
import { isEODSession } from "../../market/MathFilters.js";
import { M1TypedArrays, TriggerEvent } from "../../config/types.js";
import { preComputeTriggers, evaluateExits } from "../../backtester/math_core/MageMathCore.js";
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

// Define the grids
const MIN_SL_VALS = [1.5, 2.5, 5, 7.5, 10, 15, 20];
const MAX_SL_VALS = [25, 30, 40, 50, 60, 80, 100, 150, 200];
const MIN_BODY_VALS = [5, 6, 7.5, 10, 15, 20]; // Removed 3-pip (doji): minimum meaningful breakout body
const TRAILING_TRIGGERS = [0.5, 1.0, 1.5, 2.0]; // Clean active trailing triggers
const TRAILING_STEPS = [0.5, 1.0, 1.5, 2.0]; // Clean real trailing steps (0.5R, 1.0R, 1.5R, 2.0R)
const FORCE_CLOSE_HOURS = [8, 12, 16, 24]; // Added sub-24h options to discover same-session exits
const EXIT_MODES = ["TRAILING", "MIDPOINT", "OPPOSITE_BOUNDARY", "ADTEL_AGGRESSIVE", "ADTEL_MODERATE", "ADTEL_CONSERVATIVE"];
const PULLBACK_PERCENTAGES = [0.0, 0.3, 0.6]; // Removed 1.0 & 1.5: beyond 0.6 is mean-reversion, not breakout
const ORB_MINUTES_GRID = [10, 15, 30, 45, 60];
const ACTION_MINUTES_GRID = [60, 120, 180]; // Capped at 180 min: beyond this bleeds pre-market data into trigger
const SIM_YEARS = 3.0; // Dynamic 3-year lookback from latest date

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

function decodeMageSetup(
  setupStr: string, session: string,
  minSlGrid: any[], maxSlGrid: any[], minBodyGrid: any[],
  trailingTriggersGrid: any[], trailingStepsGrid: any[], forceCloseHoursGrid: any[],
  pullbackPercentagesGrid: any[], exitModesGrid: any[], startTimesForSession: {h: number, m: number}[],
  orbMinutesGrid: any[], actionMinutesGrid: any[]
): number[] | null {
  try {
    const m = setupStr.match(
      /^(\w+)_([\d.]+)%_MinSL([\d.]+)_MaxSL([\d.]+)_Body([\d.]+)_Trig([\d.]+)_Step([\d.]+)_FC(\d+)_StartH(\d+)_StartM(\d+)_OrbMins(\d+)_ActMins(\d+)_Exit(\w+)$/
    );
    if (!m) return null;
    const [, sSession, sPb, sMinSL, sMaxSL, sBody, sTrig, sStep, sFC, sH, sM, sOrb, sAct, sExit] = m;
    const normSession = sSession === "NY_Forex" ? "ny" : sSession;
    if (normSession !== session) return null;
    const startTimeIdx = startTimesForSession.findIndex(t => t.h === parseInt(sH) && t.m === parseInt(sM));
    if (startTimeIdx === -1) return null;

    return [
      findClosestIndex(parseFloat(sMinSL), minSlGrid),
      findClosestIndex(parseFloat(sMaxSL), maxSlGrid),
      findClosestIndex(parseFloat(sBody), minBodyGrid),
      findClosestIndex(parseFloat(sTrig), trailingTriggersGrid),
      findClosestIndex(parseFloat(sStep), trailingStepsGrid),
      findClosestIndex(parseInt(sFC), forceCloseHoursGrid),
      findClosestIndex(parseFloat(sPb) / 100, pullbackPercentagesGrid),
      findClosestIndex(sExit, exitModesGrid),
      startTimeIdx,
      findClosestIndex(parseInt(sOrb), orbMinutesGrid),
      findClosestIndex(parseInt(sAct), actionMinutesGrid),
    ];
  } catch {
    return null;
  }
}
const dumpDir = path.join(
  process.cwd(),
  "server",
  "trading",
  "optimizer",
  "mage",
  "mage_optimizer_dump",
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

if (isMainThread && process.argv[1] === currentFile) {
  const runOptimizationMaster = async () => {
    console.log(
      `\n================================================================`,
    );
    console.log(`⚔️ Mage ORB Hybrid GA / WFA Optimizer 🔥`);
    console.log(
      `================================================================`,
    );
    console.log(`⚡ Spawning Worker Pool with Max Concurrency: 8`);

    let activeWorkers = 0;
    let index = 0;

    return new Promise<void>((resolve) => {
      function spawnNext() {
        if (index >= ALL_PAIRS.length && activeWorkers === 0) {
          console.log(
            `\n🎉 Mage GA Optimization Complete! All state JSON files generated.`,
          );
          resolve();
          return;
        }
        while (activeWorkers < 8 && index < ALL_PAIRS.length) {
          const symbol = ALL_PAIRS[index++];
          activeWorkers++;
          const worker = new Worker(currentFile, {
            workerData: { symbol },
            execArgv: process.execArgv,
          });

          worker.on("message", (msg) => {
            console.log(msg);
          });
          worker.on("error", (err) => {
            console.error(`[MAGE WORKER ERROR] on ${symbol}:`, err);
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
    const dumpFileExists = path.join(dumpDir, `state_${symbol}.json`);
    if (fs.existsSync(dumpFileExists)) {
      parentPort?.postMessage(
        `[SKIP] state_${symbol}.json already exists. Skipping ${symbol}.`,
      );
      return;
    }

    const basePair = OPTIMIZER_CONFIG[symbol] ? symbol : (OPTIMIZER_CONFIG[symbol.replace(".Daily", "")] ? symbol.replace(".Daily", "") : symbol + ".Daily");
    let configTemplate = OPTIMIZER_CONFIG[basePair];
    
    // Structural filters moved into the session loop below

    if (!configTemplate) {
      parentPort?.postMessage(
        `[WARN] Skipping ${symbol} - No OPTIMIZER_CONFIG found.`,
      );
      return;
    }

    const isForex = PairConfigManager.isForex(symbol);

    let minSlGrid = MIN_SL_VALS;
    let maxSlGrid = MAX_SL_VALS;
    let trailingTriggersGrid = TRAILING_TRIGGERS;

    let minBodyGrid = MIN_BODY_VALS;

    const MAJORS = ["GBPUSD", "EURUSD"];
    const JPY_CROSSES = ["GBPJPY", "CHFJPY", "CADJPY", "EURJPY", "AUDJPY", "USDJPY"];
    const VOLATILE_CROSSES = ["GBPAUD", "EURAUD", "EURCAD", "GBPCAD", "EURNZD", "GBPNZD"];
    const MINOR_PAIRS = ["AUDUSD", "NZDUSD", "USDCAD", "USDCHF"];
    
    if (MAJORS.includes(symbol)) {
      minSlGrid = [5, 7.5, 10, 12.5, 15]; // Pruned unfillable micro-SLs <5.0 pips; retained empirical wins
      maxSlGrid = [20, 30, 40, 50, 60, 80];
      minBodyGrid = [5, 8, 10, 12, 15, 20];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0];
    } else if (JPY_CROSSES.includes(symbol)) {
      minSlGrid = [15, 20, 25, 30, 40]; // Pruned micro-SLs <15 pips (stopped out by spread); retained empirical wins
      maxSlGrid = [30, 40, 50, 60, 70, 80, 100, 150];
      minBodyGrid = [4, 5, 6, 8, 10, 12, 15, 20];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0, 3.0];
    } else if (VOLATILE_CROSSES.includes(symbol)) {
      minSlGrid = [15, 20, 25, 30, 40]; // Minimum 15.0 pips prevents live spread-trapping
      maxSlGrid = [20, 30, 40, 50, 60, 70, 80, 100, 150];
      minBodyGrid = [4, 5, 6, 7.5, 10, 12, 15];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0]; 
    } else if (MINOR_PAIRS.includes(symbol)) {
      minSlGrid = [8, 10, 12.5, 15, 20]; // Pruned micro-SLs <8.0 pips
      maxSlGrid = [15, 20, 25, 30, 40, 50, 70, 100, 120];
      minBodyGrid = [4, 5, 8, 10, 12];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0]; 
    } else if (symbol.includes("BTC")) {
      minSlGrid = [20, 25, 30, 40, 50]; // Pruned unfillable micro-SLs <20 pips ($20.00)
      maxSlGrid = [100, 150, 200, 300];
      minBodyGrid = [30, 40, 50, 60];
    } else if (symbol.includes("ETH")) {
      minSlGrid = [20, 25, 30, 40, 50]; // Aligned to BTC floor: ETH has equivalent volatility
      maxSlGrid = [80, 100, 150, 250];
      minBodyGrid = [15, 20, 30, 40];
    } else if (symbol.includes("JPN")) {
      minSlGrid = [30, 40, 60, 80, 120, 150];
      maxSlGrid = [120, 140, 160, 200, 250, 350];
      minBodyGrid = [10, 15, 20, 30, 40, 60];
      trailingTriggersGrid = [1.0, 2.0];
    } else if (
      symbol.includes("US30") ||
      symbol.includes("NAS") ||
      symbol.includes("GER")
    ) {
      minSlGrid = [15, 20, 30, 50, 120]; // Pruned dead minSl 40/60 on NAS100; retained empirical wins
      maxSlGrid = [60, 80, 100, 140, 180, 200, 250, 350];
      minBodyGrid = [10, 12, 15, 20, 30, 40];
      trailingTriggersGrid = [0.5, 1.0, 1.5, 2.0, 3.0];
    } else if (symbol.includes("SPX")) {
      minSlGrid = [5, 7, 10, 15, 20, 30, 40]; // Pruned micro-SLs <5.0 pips
      maxSlGrid = [40, 80, 120, 150, 200];
      minBodyGrid = [5, 10, 15, 20, 25, 30];
      trailingTriggersGrid = [1.0, 2.0];
    } else if (symbol.includes("XAU") || symbol.includes("XTI")) {
      minSlGrid = [10, 12, 15, 20, 30, 40]; // 10 pips = $1.00 on Gold; exact dump match
      maxSlGrid = [40, 60, 80, 120, 150, 200];
      minBodyGrid = [15, 20, 24, 35, 50];
      trailingTriggersGrid = [1.0, 1.5, 2.0, 3.0];
    }

    const sessions = ["asia", "london", "ny"];
    const startTimesMap: Record<string, {h: number, m: number}[]> = {
      asia: [
        { h: 17, m: 0 },
        { h: 18, m: 0 },
        { h: 20, m: 0 },
        { h: 20, m: 30 },
        { h: 20, m: 45 },
        { h: 21, m: 0 },
        { h: 21, m: 30 },
        { h: 0, m: 0 },
      ],
      london: [
        { h: 2, m: 0 },
        { h: 3, m: 0 },
        { h: 3, m: 15 },
        { h: 3, m: 30 },
        { h: 4, m: 0 },
        { h: 5, m: 0 },
      ],
      ny: symbol.includes("US30") || symbol.includes("NAS") || symbol.includes("SPX")
        ? [
            { h: 8, m: 0 },
            { h: 9, m: 0 },
            { h: 9, m: 30 },
            { h: 9, m: 45 },
            { h: 10, m: 0 },
          ]
        : [
            { h: 8, m: 30 },
            { h: 9, m: 0 },
            { h: 9, m: 30 },
            { h: 9, m: 45 },
            { h: 10, m: 0 },
          ]
    };

    // Symbol-specific session overrides
    if (symbol.includes("XTI")) {
      startTimesMap.london = [
        { h: 3, m: 0 },
        { h: 3, m: 30 },
        { h: 4, m: 0 },
        { h: 7, m: 0 },
        { h: 8, m: 0 },
      ];
    }
    if (symbol === "EURNZD" || symbol === "GBPNZD" || symbol === "EURAUD" || symbol === "GBPAUD" || symbol === "AUDUSD") {
      startTimesMap.asia = [
        ...startTimesMap.asia,
        { h: 22, m: 0 },
        { h: 23, m: 0 },
        { h: 0, m: 0 },
      ];
    }
    if (symbol === "USDCAD") {
      startTimesMap.asia = [
        { h: 20, m: 0 },
        { h: 20, m: 30 },
        { h: 21, m: 0 },
        { h: 21, m: 30 },
      ];
    }

    const csvFiles = fs
      .readdirSync(csvDir)
      .filter((f) => f.startsWith(symbol) && f.endsWith(".csv"));
    if (!csvFiles.length) return;

    const csvFilePath = path.join(csvDir, csvFiles[0]);
    const endDate = getLatestDate(csvFilePath);
    const startDate = new Date(endDate.getTime());
    startDate.setFullYear(startDate.getFullYear() - SIM_YEARS);

    parentPort?.postMessage(
      `[1] Loading ${csvFiles[0]} into RAM (${startDate.getUTCFullYear()}-${endDate.getUTCFullYear()}) for ${symbol}...`,
    );

    const m1Rows = await loadCsv(
      csvFilePath,
      configTemplate.spread,
      startDate,
      endDate,
    );
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
        m1Typed.isSessionReset[i] = ((prevH < 15 && h >= 15) || (prevH > h && h >= 15) || (h === 15 && m === 0)) ? 1 : 0;
        m1Typed.isMidnightExpiry[i] = (prevH > h && h < 15) ? 1 : 0;
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

    const dnaFile = path.join(dnaDir, `mage_dna_${symbol}.json`);
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
      const isAsiaSession = session === "asia";
      const isCrypto = symbol.includes("BTC") || symbol.includes("ETH");
      const isIndex = ["US30", "NAS100", "SPX500", "GER40", "UK100", "JPN225"].some(idx => symbol.includes(idx));
      const isJpyCross = symbol.includes("JPY");

      let useHtfSar = true;
      if (isCrypto) useHtfSar = false;
      if (isIndex && isAsiaSession) useHtfSar = false;
      if (isJpyCross && !symbol.includes("GBP")) useHtfSar = false; // CHFJPY false, GBPJPY true
      if (symbol === "NZDUSD") useHtfSar = false;

      let reqCloseHalf = false;
      if (isIndex && !isAsiaSession) reqCloseHalf = true;
      if (symbol === "USDCAD" || symbol === "GBPJPY" || symbol === "BTCUSD") reqCloseHalf = true;

      const wbr = (symbol.includes("EURUSD") || (symbol.includes("CHFJPY") && !isAsiaSession)) ? 1.75 : 1.5;

      const liveStaticValues = {
        useHtfSarFilter: useHtfSar,
        requireCloseLocationHalf: reqCloseHalf,
        minWbr: wbr,
        maxH1EmaSlope: 20
      };

      const startTimes = startTimesMap[session];
      
      // Build parameters grid definition
      const grids = [
        minSlGrid,             // 0
        maxSlGrid,             // 1
        minBodyGrid,           // 2
        trailingTriggersGrid,  // 3
        TRAILING_STEPS,        // 4
        FORCE_CLOSE_HOURS,     // 5
        PULLBACK_PERCENTAGES,  // 6
        EXIT_MODES,            // 7: categorical
        startTimes,            // 8: categorical
        ORB_MINUTES_GRID,      // 9: discrete
        ACTION_MINUTES_GRID,   // 10: discrete
      ];

      const mapper = new ChromosomeMapper(grids);
      const numericIndices = [0, 1, 2, 3, 4, 5, 6];

      // Trigger caches to prevent recalculating preComputeTriggers
      const triggerCache = new Map<string, TriggerEvent[]>();
      function getCachedTriggers(
        m5: any[],
        m1: any[],
        tSpec: { h: number; m: number },
        orbMins: number,
        actMins: number
      ) {
        const cacheKey = `${tSpec.h}_${tSpec.m}_${orbMins}_${actMins}`;
        if (!triggerCache.has(cacheKey)) {
          const t = preComputeTriggers(
            m5,
            m1,
            symbol,
            configTemplate.spread * configTemplate.pipSize,
            session,
            isForex,
            configTemplate.pipSize,
            tSpec.h,
            tSpec.m,
            orbMins,
            actMins
          );
          triggerCache.set(cacheKey, t);
        }
        return triggerCache.get(cacheKey)!;
      }

      // Run Walk-Forward validation across windows
      for (const window of wfaWindows) {
        parentPort?.postMessage(`[3] Running GA on Window ${window.windowIndex + 1}/${wfaWindows.length} for ${session}...`);

        // Slice the data for the In-Sample window
        const isM5 = m5Candles.filter(c => c.timestamp >= window.inSampleStart.getTime() && c.timestamp <= window.inSampleEnd.getTime());
        const isM1 = m1Rows.filter(r => r.timestamp >= window.inSampleStart.getTime() && r.timestamp <= window.inSampleEnd.getTime());
        const isTyped = WalkForwardEngine.sliceTypedArrays(m1Typed, window.inSampleStartIndex, window.inSampleEndIndex);

        // Native evaluation doesn't need to load data on GPU

        // Clear cache for new window data
        triggerCache.clear();

        // Define fitness function for this IS window (for local search single fallback if needed)
        const fitnessFn = (params: any[]): FitnessResult => {
          const [
            minSl, maxSl, minBody, trailTrig, trailStep, fcHours, pullbackPct,
            exitMode, startTime, orbMinutes, actionMinutes
          ] = params;

          const triggers = getCachedTriggers(isM5, isM1, startTime, orbMinutes, actionMinutes);
          const overrideConfig: PairConfig = {
            ...liveStaticValues,
            minSlDist: minSl,
            maxSlDist: maxSl,
            minBodyPips: minBody,
            trailingSlTrigger: trailTrig,
            trailingSlStep: trailStep,
            forceCloseHours: fcHours,
            orbPullbackPct: pullbackPct,
            exitMode: exitMode,
            orbEnabled: true,
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
        // NOTE: chromosome positions → [minSl, maxSl, body, trailTrig, trailStep, fc, pullback, exitMode, startTime, orbMins, actionMins]
        const seedChromosomes = [
          // 1. The Trend Rider (BE-Runner): Tight MinSL, Wide MaxSL, Small body, REAL trig at 1R→BE, long action
          // Fix: trailTrig was incorrectly set to index LAST (=999), making BE never fire. Now uses mid index (real 1R trigger).
          // Dump confirms: step=999 dominates 100% of top configs across ALL pairs. trailTrig should be a real R-value.
          [
            0,                                                        // minSl = smallest
            maxSlGrid.length - 1,                                     // maxSl = largest
            0,                                                        // body  = smallest (capture more breakouts)
            Math.floor(trailingTriggersGrid.length / 2),              // trailTrig = mid (~1.0-1.5R real trigger, NOT 999)
            TRAILING_STEPS.length - 1,                                // trailStep = 999 (BE-only — confirmed by dumps)
            FORCE_CLOSE_HOURS.length - 1,                             // fc = 24h (hold all day)
            0,                                                        // pullback = 0%
            0,                                                        // exitMode = TRAILING
            0,                                                        // startTime = first slot in session
            0,                                                        // orbMins = smallest (tight ORB)
            ACTION_MINUTES_GRID.length - 1                            // actionMins = largest (full session window)
          ],

          // 2. The Session Scalper: Mid SL range, mid body, 1R trigger, medium action window
          // Rationale: EURUSD/GBPUSD top configs cluster at minSl=2.5, maxSl=30-60, body=8-10
          [
            0,                                                        // minSl = smallest
            Math.floor(maxSlGrid.length * 0.4),                       // maxSl = ~40th pct (mid-tight)
            Math.floor(minBodyGrid.length / 2),                       // body = mid value
            1,                                                        // trailTrig = idx 1 (1.0R explicit trigger)
            TRAILING_STEPS.length - 1,                                // trailStep = 999 (BE-only)
            FORCE_CLOSE_HOURS.length - 1,                             // fc = 24h
            0,                                                        // pullback = 0%
            0,                                                        // exitMode = TRAILING
            0,                                                        // startTime = first
            1,                                                        // orbMins = idx 1 (15 min)
            Math.floor(ACTION_MINUTES_GRID.length / 2)                // actionMins = mid (180 min)
          ],

          // 3. The Wide-Body Filter: Mid SL, strict body requirement (strongest breakouts only)
          // Rationale: Indices (NAS100, GER40) and Crypto need larger body thresholds to filter noise
          [
            Math.floor(minSlGrid.length / 2),                         // minSl = mid
            Math.floor(maxSlGrid.length * 0.6),                       // maxSl = 60th pct
            minBodyGrid.length - 1,                                   // body = largest (strictest filter)
            1,                                                        // trailTrig = 1.0R
            TRAILING_STEPS.length - 1,                                // trailStep = 999
            FORCE_CLOSE_HOURS.length - 1,                             // fc = 24h
            0,                                                        // pullback = 0%
            0,                                                        // exitMode = TRAILING
            0,                                                        // startTime = first
            1,                                                        // orbMins = 15 min
            1                                                         // actionMins = idx 1 (120 min)
          ]
        ];

        // Decode diverse champions from previous dump for this session
        // Temporal DNA filter: only use DNA entries discovered BEFORE this window's IS start.
        // This prevents DNA from later windows seeding earlier windows in next run (temporal leakage).
        const windowIsStartStr = window.inSampleStart.toISOString().split("T")[0];
        const temporallyValidDna = prevDumpAlphas.filter((a: any) =>
          !a.oosEndDate || a.oosEndDate < windowIsStartStr
        );
        const championChromosomes: number[][] = [];
        for (const alpha of temporallyValidDna) {
          if (championChromosomes.length >= 10) break;
          const chrom = decodeMageSetup(
            alpha.setup, session,
            minSlGrid, maxSlGrid, minBodyGrid,
            trailingTriggersGrid, TRAILING_STEPS, FORCE_CLOSE_HOURS,
            PULLBACK_PERCENTAGES, EXIT_MODES, startTimes,
            ORB_MINUTES_GRID, ACTION_MINUTES_GRID
          );
          if (chrom) {
            championChromosomes.push(chrom);
          }
        }

        const finalSeedChromosomes = [...seedChromosomes, ...championChromosomes];

        // Instantiate Hybrid GA Optimizer (300 pop × 80 gen = 24,000 evals/window)
        const optimizer = new HybridGeneticOptimizer(mapper, fitnessFn, {
          populationSize: 300,
          generations: 80,
          mutationRate: 0.15,
          fitnessMode: 'blended',
          seedChromosomes: finalSeedChromosomes,
          epochs: [
            { generations: 30, activeGenes: [0, 1, 2, 9, 10] }, // Tier 1 & 2: Session, SL, ORB/Act Mins
            { generations: 30, activeGenes: [5, 6, 7] },        // Tier 3: ExitModes, Trigger, Step
            { generations: 20, activeGenes: [3, 4, 8] }         // Tier 4 & 5: Pre-filters, FC
          ],
          fitnessFnBatch: async (paramsBatch: any[][]) => {
            const groups = new Map<string, { chromosomes: any[], indices: number[], triggers: any[] }>();
            for (let idx = 0; idx < paramsBatch.length; idx++) {
              const params = paramsBatch[idx];
              const [
                minSl, maxSl, minBody, trailTrig, trailStep, fcHours, pullbackPct,
                exitMode, startTime, orbMinutes, actionMinutes
              ] = params;
              
              const key = `${startTime.h}_${startTime.m}_${orbMinutes}_${actionMinutes}`;
              if (!groups.has(key)) {
                const triggers = getCachedTriggers(isM5, isM1, startTime, orbMinutes, actionMinutes);
                groups.set(key, { chromosomes: [], indices: [], triggers });
              }
              const group = groups.get(key)!;
              group.chromosomes.push({
                minSlDist: minSl,
                maxSlDist: maxSl,
                minBodyPips: minBody,
                trailingSlTrigger: trailTrig,
                trailingSlStep: trailStep,
                forceCloseHours: fcHours,
                orbPullbackPct: pullbackPct,
                exitMode: exitMode,
                orbStartHour: startTime.h,
                orbStartMin: startTime.m,
                orbMinutes: orbMinutes,
                actionMinutes: actionMinutes,
              });
              group.indices.push(idx);
            }

            const results: FitnessResult[] = new Array(paramsBatch.length);
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
                const res = evaluateExits(
                  isTyped,
                  isM5,
                  group.triggers,
                  symbol,
                  {
                    ...liveStaticValues,
                    ...chromo,
                    orbEnabled: true,
                  },
                  session,
                  isForex
                );

                let peak = 0;
                let runningR = 0;
                let maxDD = 0;
                for (const date of Object.keys(res.dailyNetR)) {
                  runningR += res.dailyNetR[date];
                  if (runningR > peak) peak = runningR;
                  const dd = peak - runningR;
                  if (dd > maxDD) maxDD = dd;
                }

                results[idx] = {
                  totalNetR: res.totalNetR,
                  trades: res.trades,
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
            const oosM5 = m5Candles.filter(c => c.timestamp > window.outOfSampleStart.getTime() && c.timestamp <= window.outOfSampleEnd.getTime());
            const oosM1 = m1Rows.filter(r => r.timestamp > window.outOfSampleStart.getTime() && r.timestamp <= window.outOfSampleEnd.getTime());
            const oosTyped = WalkForwardEngine.sliceTypedArrays(m1Typed, window.outOfSampleStartIndex, window.outOfSampleEndIndex);

            const [
              minSl, maxSl, minBody, trailTrig, trailStep, fcHours, pullbackPct,
              exitMode, startTime, orbMinutes, actionMinutes
            ] = topIS.params;

            const oosTriggers = preComputeTriggers(
              oosM5, oosM1, symbol,
              configTemplate.spread * configTemplate.pipSize,
              session, isForex, configTemplate.pipSize,
              startTime.h, startTime.m, orbMinutes, actionMinutes
            );

            const overrideConfig: PairConfig = {
              ...liveStaticValues,
              minSlDist: minSl,
              maxSlDist: maxSl,
              minBodyPips: minBody,
              trailingSlTrigger: trailTrig,
              trailingSlStep: trailStep,
              forceCloseHours: fcHours,
              orbPullbackPct: pullbackPct,
              exitMode: exitMode,
              orbEnabled: true,
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
            const minOosTrades = isLowFreqAsset ? 1 : 3;
            if (oosRes.trades >= minOosTrades) {
              validAlphas.push({
                setup: oosRes.setup,
                dailyNetR: oosRes.dailyNetR,      // OOS slice only — strictly unbiased
                trades: oosRes.trades,
                totalNetR: oosRes.totalNetR,      // 2-month OOS Net R (for Grandmaster)
                oosNetR: oosRes.totalNetR,        // Schema compatibility
                isNetR: topIS.result.totalNetR,   // IS Net R — used to rank DNA seeds
                isMaxDd: topIS.result.maxDrawdown, // IS Max DD — used to compute IS Calmar for seeding
                oosEndDate: window.outOfSampleEnd.toISOString().split("T")[0], // temporal tag for DNA filtering
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
      const topAlphas = validAlphas.slice(0, 2500);
      fs.writeFileSync(
        dumpFileExists,
        JSON.stringify(topAlphas, null, 2),
        "utf8",
      );
      
      const wfaReportFile = path.join(dumpDir, `wfa_${symbol}.json`);
      fs.writeFileSync(
        wfaReportFile,
        JSON.stringify(wfaLog, null, 2),
        "utf8",
      );

      // Evolutionary Assimilation: Merge Top 50 Alphas into DNA Vault
      const dnaFile = path.join(dnaDir, `mage_dna_${symbol}.json`);
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
      parentPort?.postMessage(`[4] No viable WFA-compliant Alphas found for ${symbol}. Writing empty dump to prevent infinite re-runs.`);
      fs.writeFileSync(dumpFileExists, "[]", "utf8");
      const wfaReportFile = path.join(dumpDir, `wfa_${symbol}.json`);
      fs.writeFileSync(wfaReportFile, "[]", "utf8");
    }
  };

  runWorker().catch((err) => {
    parentPort?.postMessage(
      `[MAGE ERROR] on ${workerData.symbol}: ${err.message}`,
    );
  });
}
