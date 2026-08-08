import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { runMathBacktest } from "../../backtester/SeerMathBacktester.js";
import { SEER_PAIR_CONFIG } from "../../config/PairConfig.js";
import { getLatestDate } from "../../backtester/loadCsv.js";

// @ts-ignore
const currentFile =
  typeof __filename !== "undefined"
    ? __filename
    : fileURLToPath(import.meta.url);

const dumpDir = path.join(
  process.cwd(),
  "server",
  "trading",
  "optimizer",
  "seer_optimizer_dump",
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
);

import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";

// Helper to determine basic pair config based on symbol name
function getBasicPairConfig(pair: string) {
  const baseSymbol = pair.replace(".Daily", "");
  const baseConfig = OPTIMIZER_CONFIG[baseSymbol];
  if (!baseConfig) {
    throw new Error(`CRITICAL: No OPTIMIZER_CONFIG found for ${pair}. Cannot optimize without physical limits.`);
  }

  return {
    session: "NY_Forex",
    minSlDist: pair.includes("XAU") || pair.includes("NAS") ? 40 : 20,
    maxSlDist: pair.includes("XAU") || pair.includes("NAS") ? 100 : 50,
    trailingSlTrigger: 1.5,
    trailingSlStep: 0.5,
    minBodyPips: pair.includes("XAU") || pair.includes("NAS") ? 20 : 5,
    pinBarWickBodyRatio: 1.5,
    forceCloseHours: 8,
    liquidityHuntMins: 30,
    liqMode: "ALL" as "LIQ_HUNT" | "ALL",
  };
}

if (isMainThread && process.argv[1] === currentFile) {
  const runOptimizationMaster = async () => {
    console.log(
      `\n================================================================`,
    );
    console.log(`⚔️ Seer Master Optimizer (MULTI-THREADED CLUSTER) 🔥`);
    console.log(
      `================================================================`,
    );
    const os = await import("os");
    const defaultConcurrency = Math.min(4, Math.max(2, Math.floor(os.cpus().length)));
    const MAX_CONCURRENCY = process.env.CONCURRENCY
      ? parseInt(process.env.CONCURRENCY, 10)
      : defaultConcurrency;

    console.log(`⚡ Spawning Worker Pool with Max Concurrency: ${MAX_CONCURRENCY}`);

    let activeWorkers = 0;
    let index = 0;

    return new Promise<void>((resolve) => {
      function spawnNext() {
        if (index >= ALL_PAIRS.length && activeWorkers === 0) {
          console.log(
            `\n🎉 Seer Cluster GA Optimization Complete! All state JSON files generated.`,
          );
          resolve();
          return;
        }
        while (activeWorkers < MAX_CONCURRENCY && index < ALL_PAIRS.length) {
          const symbol = ALL_PAIRS[index++];
          activeWorkers++;
          const workerExecArgv = process.execArgv.filter(arg => !arg.startsWith('--max-old-space-size'));
          const worker = new Worker(currentFile, {
            workerData: { symbol },
            execArgv: workerExecArgv,
            resourceLimits: { maxOldGenerationSizeMb: 3072 },
          });

          worker.on("message", (msg) => {
            console.log(msg);
          });
          worker.on("error", (err) => {
            console.error(`[SEER WORKER ERROR] on ${symbol}:`, err);
          });
          worker.on("exit", (code) => {
            if (code !== 0) {
              console.error(`❌ [SEER WORKER CRASH] Symbol ${symbol} failed with exit code ${code}`);
            }
            activeWorkers--;
            spawnNext();
          });
        }
      }
      spawnNext();
    });
  };
  runOptimizationMaster().catch(console.error);
} else {
  const runWorker = async () => {
    const { pair } = workerData;
    const dumpFileExists = path.join(dumpDir, `state_${pair}.json`);
    if (fs.existsSync(dumpFileExists)) {
      parentPort?.postMessage(
        `[SKIP] state_${pair}.json already exists. Skipping ${pair}.`,
      );
      return;
    }

    const configTemplate = getBasicPairConfig(pair);
    SEER_PAIR_CONFIG[pair] = [configTemplate] as any;
    
    const baseSymbol = pair.replace(".Daily", "");
    const optConfig = OPTIMIZER_CONFIG[baseSymbol];
    if (!optConfig) throw new Error("No optimizer config");

    const minBodyPipsGrid =
      optConfig.pipSize === 1.0 || optConfig.pipSize === 0.1
        ? [10, 20, 30]
        : [3, 5, 8];
    const minWickRatioGrid = [1.2, 1.5, 2.0];
    const minTpDistGrid =
      optConfig.pipSize === 1.0 || optConfig.pipSize === 0.1
        ? [20, 30, 40]
        : [10, 20, 30];
    const defaultTpDistGrid =
      optConfig.pipSize === 1.0 || optConfig.pipSize === 0.1
        ? [60, 100, 150]
        : [30, 50, 80];
    const maxSlGrid =
      optConfig.pipSize === 1.0 || optConfig.pipSize === 0.1
        ? [80, 100, 150]
        : [40, 60, 80];

    parentPort?.postMessage(`[1] Starting optimization grid for ${pair}...`);
    
    const csvDir = path.join(process.cwd(), "data", "csv");
    const csvFiles = fs.readdirSync(csvDir).filter(f => f.startsWith(`${pair}_M1_`) && f.endsWith(".csv"));
    if (csvFiles.length === 0) {
      parentPort?.postMessage(`[SKIP] No CSV found for ${pair}`);
      return;
    }
    const endDateDate = getLatestDate(path.join(csvDir, csvFiles[0]));
    const startDateDate = new Date(endDateDate.getTime());
    startDateDate.setFullYear(startDateDate.getFullYear() - 3);

    const startDate = startDateDate.toISOString().substring(0, 10);
    const endDate = endDateDate.toISOString().substring(0, 10);

    let validAlphas: any[] = [];
    let evalCount = 0;

    for (const bodyPips of minBodyPipsGrid) {
      for (const wickRatio of minWickRatioGrid) {
        for (const minTp of minTpDistGrid) {
          for (const defaultTp of defaultTpDistGrid) {
            for (const maxSl of maxSlGrid) {
              if (minTp > defaultTp) continue;

              evalCount++;
              SEER_PAIR_CONFIG[pair][0].minBodyPips = bodyPips;
              SEER_PAIR_CONFIG[pair][0].pinBarWickBodyRatio = wickRatio;
              SEER_PAIR_CONFIG[pair][0].minTpDist = minTp;
              SEER_PAIR_CONFIG[pair][0].defaultTpDist = defaultTp;
              SEER_PAIR_CONFIG[pair][0].maxSlDist = maxSl;

              const res = await runMathBacktest(pair, startDate, endDate, true);
              const trades = res.records
                ? res.records.filter(
                    (r: any) => r.outcome !== "SKIPPED" && r.outcome !== null,
                  )
                : [];

              if (trades.length >= 5) {
                const totalNetR = trades.reduce(
                  (sum: number, r: any) => sum + (r.rMultiple || 0),
                  0,
                );
                if (totalNetR > 0) {
                  // Generate dailyNetR exactly like Mage/Sage
                  const dailyNetR: Record<string, number> = {};
                  for (const r of trades) {
                    dailyNetR[r.date] =
                      (dailyNetR[r.date] || 0) + (r.rMultiple || 0);
                  }

                  const setupStr = `Seer_Body${bodyPips}_Wick${wickRatio}_MinTP${minTp}_DefTP${defaultTp}_MaxSL${maxSl}`;

                  validAlphas.push({
                    setup: setupStr,
                    dailyNetR,
                    trades: trades.length,
                    winRate: res.winRate || 0,
                    totalNetR,
                    records: trades,
                  });
                }
              }
            }
          }
        }
      }
    }

    if (validAlphas.length > 0) {
      validAlphas.sort((a, b) => b.totalNetR - a.totalNetR);
      const topAlphas = validAlphas.slice(0, 10000);
      fs.writeFileSync(
        dumpFileExists,
        JSON.stringify(topAlphas, null, 2),
        "utf8",
      );
      parentPort?.postMessage(
        `[4] Saved ${topAlphas.length} viable Alphas for ${pair} (Total found: ${validAlphas.length}). (Top: ${validAlphas[0].totalNetR.toFixed(2)} R)`,
      );
      validAlphas = [];
    } else {
      parentPort?.postMessage(`[4] No viable Alphas found for ${pair}.`);
    }
  };

  runWorker().catch((err) => {
    parentPort?.postMessage(
      `[SEER ERROR] on ${workerData.pair}: ${err.message}`,
    );
  });
}
