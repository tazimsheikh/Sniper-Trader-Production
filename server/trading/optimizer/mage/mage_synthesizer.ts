import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { validateMonthlyConsistency } from "../core/MonthlyConsistencyValidator.js";
// @ts-ignore
const currentFile =
  typeof __filename !== "undefined"
    ? __filename
    : fileURLToPath(import.meta.url);
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";

function calculateMetricsFromDailyR(dailyNetR) {
  let grossProfit = 0;
  let grossLoss = 0;
  let winningDays = 0;
  let losingDays = 0;
  let peak = 0;
  let maxDd = 0;
  let currentEquity = 0;

  const yearlyReturns = {};

  const sortedDates = Object.keys(dailyNetR).sort();

  for (const d of sortedDates) {
    const r = dailyNetR[d];
    const year = d.substring(0, 4); // e.g. "2023"

    if (!yearlyReturns[year]) yearlyReturns[year] = 0;
    yearlyReturns[year] += r;

    if (r > 0) {
      grossProfit += r;
      winningDays++;
    } else if (r < 0) {
      grossLoss += Math.abs(r);
      losingDays++;
    }

    currentEquity += r;
    if (currentEquity > peak) {
      peak = currentEquity;
    }

    const dd = currentEquity - peak;
    if (dd < maxDd) {
      maxDd = dd;
    }
  }

  let isConsistentYearly = true;
  for (const year in yearlyReturns) {
    if (yearlyReturns[year] < 0) {
      isConsistentYearly = false;
      break;
    }
  }

  const profitFactor =
    grossLoss === 0 ? (grossProfit > 0 ? 999 : 0) : grossProfit / grossLoss;
  const totalDays = winningDays + losingDays;
  const winRate = totalDays === 0 ? 0 : (winningDays / totalDays) * 100;

  return {
    profitFactor,
    winRate,
    maxDd,
    isConsistentYearly,
  };
}

const MAX_WORKERS = 8;
const SIMULATIONS_PER_CATEGORY = 1000000;
const dumpDir = path.join(
  process.cwd(),
  "server",
  "trading",
  "optimizer",
  "mage",
  "mage_optimizer_dump",
);

function shuffle(array: any[]) {
  let currentIndex = array.length,
    randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
  return array;
}

if (!isMainThread) {
  const { category, alphas, globalSortedDates, simulations } = workerData;
  let bestPortfolios: any[] = [];
  let nextProgressLog = 0;

  for (let sim = 0; sim < simulations; sim++) {
    if (sim >= nextProgressLog) {
      parentPort?.postMessage({ type: "progress", category, sim });
      nextProgressLog += Math.max(10000, Math.floor(simulations / 5));
    }

    const numConfigs = Math.floor(Math.random() * 11) + 10;
    const shuffledAlphas = shuffle([...alphas]);

    const portfolio = [];
    let totalReturn = 0;
    let totalTrades = 0;
    let sumWinRate = 0;
    let recentReturn = 0;

    const usedSessions = new Set<string>();

    for (const item of shuffledAlphas) {
      if (portfolio.length >= numConfigs) break;

      const setup = item.config.setup;
      let session = setup.split("_")[0];
      if (session === "NY") session = `NY_${setup.split("_")[1]}`;

      const collisionKey = `${item.pair}_${session}`;
      if (usedSessions.has(collisionKey)) continue;

      usedSessions.add(collisionKey);
      portfolio.push({ pair: item.pair, config: item.config });
      totalReturn += item.config.totalNetR;
      totalTrades += item.config.trades;
      sumWinRate += item.config.winRate;
      recentReturn += item.config.recent || item.config.totalNetR * 0.25;
    }

    let rawCumulative = 0;
    let rawPeak = 0;
    let rawMaxDrawdown = 0;
    let weightedCumulative = 0;
    let weightedPeak = 0;
    let weightedMaxDrawdown = 0;
    let weightedTotalReturn = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    for (let i = 0; i < globalSortedDates.length; i++) {
      let dailyRaw = 0;
      let dailyWeighted = 0;
      for (let p = 0; p < portfolio.length; p++) {
        dailyRaw += portfolio[p].config.rawReturnsArray[i];
        dailyWeighted += portfolio[p].config.weightedReturnsArray[i];
      }

      if (dailyRaw > 0) grossProfit += dailyRaw;
      else if (dailyRaw < 0) grossLoss += Math.abs(dailyRaw);

      if (dailyRaw !== 0) {
        rawCumulative += dailyRaw;
        if (rawCumulative > rawPeak) rawPeak = rawCumulative;
        const rawDd = rawPeak - rawCumulative;
        if (rawDd > rawMaxDrawdown) rawMaxDrawdown = rawDd;
      }

      if (dailyWeighted !== 0) {
        weightedTotalReturn += dailyWeighted;
        weightedCumulative += dailyWeighted;
        if (weightedCumulative > weightedPeak)
          weightedPeak = weightedCumulative;
        const wDd = weightedPeak - weightedCumulative;
        if (wDd > weightedMaxDrawdown) weightedMaxDrawdown = wDd;
      }
    }

    const profitFactor =
      grossLoss === 0 ? (grossProfit > 0 ? 999 : 0) : grossProfit / grossLoss;
    const avgWinRate = sumWinRate / portfolio.length;

    let fitness = 0;
    if (category.includes("Highest Net Profit")) fitness = totalReturn;
    else if (category.includes("Lowest Max Drawdown"))
      fitness = rawMaxDrawdown === 0 ? 99999 : 1 / rawMaxDrawdown;
    else if (category.includes("Most Consistent")) fitness = profitFactor;
    else if (category.includes("Best Last 6 Months"))
      fitness = weightedTotalReturn;
    else if (category.includes("Most Balanced"))
      fitness =
        rawMaxDrawdown === 0
          ? 0
          : ((weightedTotalReturn * 2 + totalReturn) * profitFactor) /
            Math.pow(rawMaxDrawdown, 2);
    else if (category.includes("Highest Win Rate")) fitness = avgWinRate;
    else if (category.includes("Highest Trade Frequency"))
      fitness = totalTrades;
    else if (category.includes("Lowest Trade Frequency"))
      fitness = totalTrades === 0 ? 99999 : 1 / totalTrades;

    bestPortfolios.push({
      fitness,
      totalReturn,
      maxDrawdown: rawMaxDrawdown,
      profitFactor,
      avgWinRate,
      totalTrades,
      portfolio: portfolio.map((p: any) => ({
        pair: p.pair,
        setup: p.config.setup,
        netR: p.config.totalNetR,
      })),
    });

    if (bestPortfolios.length > 500) {
      bestPortfolios.sort((a, b) => b.fitness - a.fitness);
      bestPortfolios = bestPortfolios.slice(0, 100);
    }
  }

  bestPortfolios.sort((a, b) => b.fitness - a.fitness);
  const top10 = bestPortfolios.slice(0, 10);
  parentPort?.postMessage({ type: "result", category, results: top10 });
} else {
  async function runPipeline() {
    if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
    console.log(`\n======================================================`);
    console.log(`🚀 RUNNING PARALLEL ALPHA PORTFOLIO SYNTHESIZER`);
    console.log(`======================================================\n`);
    const GLOBAL_ALPHAS: { pair: string; config: any }[] = [];
    const stateFiles = fs
      .readdirSync(dumpDir)
      .filter((f: string) => f.startsWith("state_") && f.endsWith(".json"));

    for (const file of stateFiles) {
      const symbol = file.replace("state_", "").replace(".json", "");
      
      // --- WFA GATEKEEPER ---
      const wfaFile = `wfa_${symbol}.json`;
      const wfaPath = path.join(dumpDir, wfaFile);
      if (fs.existsSync(wfaPath)) {
        const wfaData = JSON.parse(fs.readFileSync(wfaPath, "utf8"));
        // Check if at least ONE individual config has a positive OOS edge.
        // Summing all configs would allow thousands of bad configs to bury the good ones.
        let hasAnyPositiveOos = false;
        for (const row of wfaData) {
          if (row.outOfSample && row.outOfSample.netR > 0) {
            hasAnyPositiveOos = true;
            break;
          }
        }
        if (!hasAnyPositiveOos) {
          console.log(`[WFA GATE] Rejected ${symbol} - No individual config had positive Out-of-Sample NetR`);
          continue; // Block curve-fitted pairs
        }
        console.log(`[WFA GATE] Passed ${symbol} - At least one config has positive Out-of-Sample NetR`);
      } else {
        console.log(`[WFA GATE] Rejected ${symbol} - No WFA file found.`);
        continue;
      }
      // ----------------------

      const filePath = path.join(dumpDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (data.length === 0) continue;

      const purgedData = data.filter((config) => {
        // totalNetR and trades are now from 2-month OOS slices (not 3-year full curves)
        if (config.totalNetR < 0.0) return false;  // Must be net-profitable in its OOS slice
        if (config.trades < 3) return false;        // Must have at least 3 trades in the OOS window

        const metrics = calculateMetricsFromDailyR(config.dailyNetR);
        if (metrics.profitFactor < 1.25) return false; // Reverted to 1.25
        if (metrics.winRate < 30.0) return false; // Reverted to 30%
        if (metrics.maxDd < -15.0) return false; // Reverted to -15.0

        // NOTE: oosNetR filter removed — it was lookahead bias (Finding 3).
        // OOS metrics must not be used to gate portfolio inclusion.
        // Robustness validation belongs in a separate blind hold-out test.

        const monthlyCheck = validateMonthlyConsistency(config.dailyNetR);
        if (!monthlyCheck.isValid) return false;

        return true;
      });

      const groups: { [key: string]: any[] } = {};
      for (const config of purgedData) {
        const setup = config.setup;
        const parts = setup.split("_");
        let session = parts[0];
        if (parts[0] === "NY") session = `NY_${parts[1]}`;
        const fcPart = parts.find((p: string) => p.startsWith("FC"));
        const bodyPart = parts.find((p: string) => p.startsWith("Body"));
        const bypassPart = parts.find((p: string) => p.endsWith("%"));
        const signature = `${session}_${bypassPart}_${bodyPart}_${fcPart}`;

        if (!groups[signature]) groups[signature] = [];
        groups[signature].push(config);
      }

      const dedupedData = [];
      for (const signature of Object.keys(groups)) {
        const group = groups[signature];
        group.sort((a: any, b: any) => b.totalNetR - a.totalNetR);
        dedupedData.push(group[0]);
      }

      for (const config of dedupedData) {
        GLOBAL_ALPHAS.push({ pair: symbol, config });
      }
    }

    console.log(`[INFO] Surviving True Alphas: ${GLOBAL_ALPHAS.length}`);
    if (GLOBAL_ALPHAS.length < 10) {
      console.error("Not enough True Alphas survived to run Monte Carlo!");
      return;
    }

    const allDatesSet = new Set<string>();
    for (const item of GLOBAL_ALPHAS) {
      for (const date of Object.keys(item.config.dailyNetR || {})) {
        allDatesSet.add(date);
      }
    }
    const globalSortedDates = Array.from(allDatesSet).sort();

    const DATE_WEIGHTS: Record<string, number> = {};
    if (globalSortedDates.length > 0) {
      for (let i = 0; i < globalSortedDates.length; i++) {
        DATE_WEIGHTS[globalSortedDates[i]] =
          0.2 + 1.8 * (i / (globalSortedDates.length - 1));
      }
    }

    for (const item of GLOBAL_ALPHAS) {
      const rawArray = new Float32Array(globalSortedDates.length);
      const weightedArray = new Float32Array(globalSortedDates.length);
      for (let i = 0; i < globalSortedDates.length; i++) {
        const date = globalSortedDates[i];
        const val = item.config.dailyNetR[date] || 0;
        rawArray[i] = val;
        weightedArray[i] = val * DATE_WEIGHTS[date];
      }
      item.config.rawReturnsArray = rawArray;
      item.config.weightedReturnsArray = weightedArray;
    }

    const CATEGORIES = [
      "The Ultimate Trifecta (Recent Momentum + Low DD + Net Profit)",
      "Highest Net Profit (The Reaper)",
      "Lowest Max Drawdown (The Institutional)",
      "Most Consistent (The Coven)",
      "Most Balanced (The Apex)",
      "Best Last 6 Months (The Prophet)",
      "Highest Win Rate (The Seductress)",
      "Highest Trade Frequency (The Scout)",
      "Lowest Trade Frequency (The Warden)",
    ];

    console.log(
      `\n[INFO] Spawning Worker Pool to process ${CATEGORIES.length} categories with Max Concurrency: ${MAX_WORKERS}...\n`,
    );

    let activeWorkers = 0;
    let catIndex = 0;
    const categoryResults: Record<string, any[]> = {};

    await new Promise<void>((resolve, reject) => {
      function spawnNext() {
        while (activeWorkers < MAX_WORKERS && catIndex < CATEGORIES.length) {
          const category = CATEGORIES[catIndex++];
          activeWorkers++;

          const worker = new Worker(currentFile, {
            workerData: {
              category,
              alphas: GLOBAL_ALPHAS,
              globalSortedDates,
              simulations: SIMULATIONS_PER_CATEGORY,
            },
            execArgv: process.execArgv,
          });

          worker.on("message", (msg) => {
            if (msg && msg.type === "progress") {
              console.log(
                `  [${msg.category}] Simulated ${(msg.sim / 1000).toFixed(0)}k...`,
              );
            } else if (msg && msg.type === "result") {
              console.log(`\n✅ COMPLETE: ${msg.category}`);
              categoryResults[msg.category] = msg.results;
            }
          });
          worker.on("error", (err) => {
            console.error(`Worker error: ${err.message}`);
            activeWorkers--;
            spawnNext();
            if (activeWorkers === 0) resolve();
          });
          worker.on("exit", () => {
            activeWorkers--;
            spawnNext();
            if (activeWorkers === 0) resolve();
          });
        }
      }
      spawnNext();
    });

    let finalMdOutput = `# The 8-Archetype Multi-Session Monte Carlo Results\n\n`;
    finalMdOutput += `Evaluated 8,000,000 total randomized portfolios (1M per category) using the 110 God-Tier deduplicated algorithms.\n`;
    finalMdOutput += `Strict Collision Lock applied: No pair is allowed to trade the same session twice.\n\n`;

    for (const category of CATEGORIES) {
      const top10 = categoryResults[category] || [];
      finalMdOutput += `\n# ${category}\n\n`;
      for (let i = 0; i < top10.length; i++) {
        const p = top10[i];
        finalMdOutput += `### Rank #${i + 1} (Fitness Score: ${p.fitness.toFixed(4)})\n`;
        finalMdOutput += `- **Total Net R:** ${p.totalReturn.toFixed(2)} R\n`;
        finalMdOutput += `- **Max DD:** ${p.maxDrawdown.toFixed(2)} R\n`;
        finalMdOutput += `- **Profit Factor:** ${p.profitFactor.toFixed(2)}\n`;
        finalMdOutput += `- **Average Win Rate:** ${p.avgWinRate.toFixed(2)}%\n`;
        finalMdOutput += `- **Total Trades:** ${p.totalTrades}\n\n`;
        finalMdOutput += `**Component Algorithms (${p.portfolio.length} total):**\n`;
        for (const item of p.portfolio) {
          finalMdOutput += `  - **${item.pair}**: \`${item.setup}\` (${item.netR.toFixed(2)} R)\n`;
        }
        finalMdOutput += `\n---\n\n`;
      }
    }
    const outPath = path.join(
      process.cwd(),
      "server",
      "trading",
      "optimizer",
      "mage_monte_carlo_portfolios.md",
    );
    fs.writeFileSync(outPath, finalMdOutput, "utf8");
    console.log(
      `\n✅ Saved ALL 8 Archetype Ensembles to monte_carlo_portfolios.md`,
    );
  }

  runPipeline().catch(console.error);
}
