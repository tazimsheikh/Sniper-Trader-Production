import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { loadCsv, getLatestDate } from "../backtester/loadCsv.js";
import { aggregateCandles } from "../market/CandleAggregator.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { PairConfig, M1TypedArrays } from "../config/types.js";
import { isNewsForceClose } from "../market/historicalNews.js";
import { isEODSession } from "../market/MathFilters.js";
import { preComputeTriggers as magePreCompute, evaluateExits as mageEval } from "../backtester/math_core/MageMathCore.js";
import { preComputeTriggers as sagePreCompute, evaluateExits as sageEval } from "../backtester/math_core/SageMathCore.js";

const currentFile = typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url);
const OPTIMIZER_DIR = path.join(process.cwd(), "server", "trading", "optimizer");
const CSV_DIR = path.join(process.cwd(), "data", "csv");
const MAGE_DNA_DIR = path.join(OPTIMIZER_DIR, "mage", "dna_bank");
const SAGE_DNA_DIR = path.join(OPTIMIZER_DIR, "sage", "dna_bank");

// Macro Multi-Year Evaluation Parameters
const HORIZON_YEARS = 3;
const MIN_MACRO_TRADES = 15;
const MAX_MACRO_DRAWDOWN = 20.0; // Max 20R drawdown over 3 full years
const MIN_MACRO_CALMAR = 1.5;
const MAX_ELITES_PER_NICHE = 3;  // MAP-Elites capacity per niche

export interface EvaluatedAlpha {
  setup: string;
  niche: string;
  threeYearNetR: number;
  threeYearTrades: number;
  threeYearWinRate: number;
  threeYearMaxDD: number;
  threeYearCalmar: number;
  sixMoNetR: number;
  sixMoTrades: number;
  dailyNetR: Record<string, number>;
  rawItem: any;
}

export function parseMageConfig(setupStr: string): { session: string; config: PairConfig } | null {
  if (setupStr.includes("Trig999") || setupStr.includes("Step999")) return null;
  const m = setupStr.match(/^(\w+)_([\d.]+)%_MinSL([\d.]+)_MaxSL([\d.]+)_Body([\d.]+)_Trig([\d.]+)_Step([\d.]+)_FC(\d+)_StartH(\d+)_StartM(\d+)_OrbMins(\d+)_ActMins(\d+)_Exit(\w+)$/);
  if (!m) return null;
  const [, sSession, sPb, sMinSL, sMaxSL, sBody, sTrig, sStep, sFC, sH, sM, sOrb, sAct, sExit] = m;
  const stepVal = parseFloat(sStep);
  if (stepVal < 1.0) return null; // Reject choking 0.5R trailing steps

  return {
    session: sSession === "NY_Forex" ? "ny" : sSession,
    config: {
      orbEnabled: true,
      orbPullbackPct: parseFloat(sPb) / 100,
      minSlDist: parseFloat(sMinSL),
      maxSlDist: parseFloat(sMaxSL),
      minBodyPips: parseFloat(sBody),
      trailingSlTrigger: parseFloat(sTrig),
      trailingSlStep: stepVal,
      forceCloseHours: parseInt(sFC),
      orbStartHour: parseInt(sH),
      orbStartMin: parseInt(sM),
      orbMinutes: parseInt(sOrb),
      actionMinutes: parseInt(sAct),
      exitMode: sExit as any,
    } as PairConfig
  };
}

export function parseSageConfig(setupStr: string): { session: string; config: PairConfig } | null {
  if (setupStr.includes("Trig999") || setupStr.includes("Step999")) return null;
  const m = setupStr.match(/^(\w+)_([\d.]+)%_MinSL([\d.]+)_MaxSL([\d.]+)_Sweep([\d.]+)_MaxSwp([\d.]+)_ReqCls(true|false)_Exit(\w+)_Trig([\d.]+)_Step([\d.]+)_FC(\d+)_StartH(\d+)_StartM(\d+)_OrbMins(\d+)_ActMins(\d+)(?:_MaxBody([\d.]+))?$/);
  if (!m) return null;
  const [, sSession, sPen, sMinSL, sMaxSL, sSweep, sMaxSwp, sReqCls, sExit, sTrig, sStep, sFC, sH, sM, sOrb, sAct, sMaxBody] = m;
  const stepVal = parseFloat(sStep);
  if (stepVal < 1.0) return null; // Reject choking 0.5R trailing steps

  return {
    session: sSession,
    config: {
      sageEnabled: true,
      entryPenetrationPct: parseFloat(sPen),
      minSlDist: parseFloat(sMinSL),
      maxSlDist: parseFloat(sMaxSL),
      sweepPips: parseFloat(sSweep),
      maxSweepMultiplier: parseFloat(sMaxSwp),
      requireCloseInside: sReqCls === 'true',
      exitMode: sExit as any,
      trailingSlTrigger: parseFloat(sTrig),
      trailingSlStep: stepVal,
      forceCloseHours: parseInt(sFC),
      orbStartHour: parseInt(sH),
      orbStartMin: parseInt(sM),
      orbMinutes: parseInt(sOrb),
      actionMinutes: parseInt(sAct),
      maxBodyPips: sMaxBody ? parseFloat(sMaxBody) : 999,
    } as PairConfig
  };
}

/**
 * Classifies a Mage setup into a MAP-Elites Behavioral Niche
 */
export function getMageNiche(parsed: { session: string; config: PairConfig }): string {
  const s = parsed.session;
  const slBand = (parsed.config.minSlDist ?? 0) <= 15 ? "TightSL" : "WideSL";
  const exit = parsed.config.exitMode || "TRAILING";
  return `${s}_${slBand}_${exit}`;
}

/**
 * Classifies a Sage setup into a MAP-Elites Behavioral Niche
 */
export function getSageNiche(parsed: { session: string; config: PairConfig }): string {
  const s = parsed.session;
  const swpBand = (parsed.config.sweepPips ?? 0) <= 5 ? "ShallowSweep" : "DeepSweep";
  const exit = parsed.config.exitMode || "TRAILING";
  return `${s}_${swpBand}_${exit}`;
}

/**
 * Quality-Diversity MAP-Elites Curation Algorithm
 */
export function curateMapElitesArchive(evaluated: EvaluatedAlpha[]): { survivors: EvaluatedAlpha[]; purgedCount: number } {
  // Group by Behavioral Niche
  const nicheMap = new Map<string, EvaluatedAlpha[]>();
  for (const alpha of evaluated) {
    if (!nicheMap.has(alpha.niche)) {
      nicheMap.set(alpha.niche, []);
    }
    nicheMap.get(alpha.niche)!.push(alpha);
  }

  const survivors: EvaluatedAlpha[] = [];

  for (const [niche, candidates] of nicheMap.entries()) {
    // 1. Sort by Macro Calmar & Return (Fitness)
    candidates.sort((a, b) => b.threeYearCalmar - a.threeYearCalmar);

    // 2. Select diverse non-dominated champions up to MAX_ELITES_PER_NICHE
    const eliteNiche: EvaluatedAlpha[] = [];
    for (const cand of candidates) {
      if (eliteNiche.length >= MAX_ELITES_PER_NICHE) break;

      const isClone = eliteNiche.some(existing => {
        const netRDiff = Math.abs(existing.threeYearNetR - cand.threeYearNetR);
        const tradesDiff = Math.abs(existing.threeYearTrades - cand.threeYearTrades);
        return netRDiff < 0.2 && tradesDiff <= 2;
      });

      if (!isClone) {
        eliteNiche.push(cand);
      }
    }

    survivors.push(...eliteNiche);
  }

  survivors.sort((a, b) => b.threeYearCalmar - a.threeYearCalmar);
  const purgedCount = evaluated.length - survivors.length;
  return { survivors, purgedCount };
}

if (isMainThread) {
  const runMaster = async () => {
    const isDryRun = process.argv.includes("--dry-run");
    const targetSymbolArg = process.argv.find((_, i, arr) => arr[i - 1] === "--symbol");

    console.log(`\n================================================================================`);
    console.log(`🧬 QUALITY-DIVERSITY (MAP-ELITES) DNA ARCHIVE CURATOR`);
    console.log(`================================================================================`);
    console.log(`Mode: ${isDryRun ? "🔍 DRY RUN (Simulation Only - No Files Modified)" : "⚡ LIVE APPLY (Curating DNA Banks)"}`);
    console.log(`Evaluation: ${HORIZON_YEARS}-Year Full Macro Horizon (2023-2026) | Min Trades: ${MIN_MACRO_TRADES} | Max DD: ${MAX_MACRO_DRAWDOWN}R | Min Calmar: ${MIN_MACRO_CALMAR}`);
    console.log(`Biodiversity Engine: Multi-Dimensional MAP-Elites Grid (Capacity: ${MAX_ELITES_PER_NICHE} Elites/Niche)\n`);

    const symbols = new Set<string>();
    if (fs.existsSync(MAGE_DNA_DIR)) {
      fs.readdirSync(MAGE_DNA_DIR).filter(f => f.endsWith('.json')).forEach(f => {
        const m = f.match(/mage_dna_(.+)\.json/);
        if (m) symbols.add(m[1]);
      });
    }
    if (fs.existsSync(SAGE_DNA_DIR)) {
      fs.readdirSync(SAGE_DNA_DIR).filter(f => f.endsWith('.json')).forEach(f => {
        const m = f.match(/sage_dna_(.+)\.json/);
        if (m) symbols.add(m[1]);
      });
    }

    let allPairs = Array.from(symbols).sort();
    if (targetSymbolArg) {
      allPairs = allPairs.filter(p => p.toLowerCase() === targetSymbolArg.toLowerCase());
      console.log(`🎯 Filtering single target symbol: ${targetSymbolArg}`);
    }

    let activeWorkers = 0;
    let index = 0;
    let totalMageInput = 0, totalMageSurvived = 0;
    let totalSageInput = 0, totalSageSurvived = 0;

    return new Promise<void>((resolve) => {
      function spawnNext() {
        if (index >= allPairs.length && activeWorkers === 0) {
          console.log(`\n================================================================================`);
          console.log(`🎉 MAP-ELITES DNA CURATION COMPLETE!`);
          console.log(`================================================================================`);
          console.log(`📊 MAGE DNA BANK: Preserved ${totalMageSurvived}/${totalMageInput} high-quality multi-year elite setups across all niches.`);
          console.log(`📊 SAGE DNA BANK: Preserved ${totalSageSurvived}/${totalSageInput} high-quality multi-year elite setups across all niches.`);
          if (isDryRun) {
            console.log(`\n💡 To apply this curation permanently to the DNA banks, run without --dry-run:`);
            console.log(`   npx tsx server/trading/optimizer/cull_dna_banks.ts\n`);
          }
          resolve();
          return;
        }
        while (activeWorkers < 8 && index < allPairs.length) {
          const symbol = allPairs[index++];
          activeWorkers++;
          const worker = new Worker(currentFile, {
            workerData: { symbol, isDryRun },
            execArgv: process.execArgv,
          });

          worker.on("message", (msg) => {
            if (msg.type === "log") console.log(msg.data);
            if (msg.type === "result") {
              totalMageInput += msg.mageInput;
              totalMageSurvived += msg.mageSurvived;
              totalSageInput += msg.sageInput;
              totalSageSurvived += msg.sageSurvived;
            }
          });
          worker.on("error", (err) => {
            console.error(`[CULL WORKER ERROR] on ${symbol}:`, err);
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
  runMaster().catch(console.error);
} else if (!isMainThread) {
  const runWorker = async () => {
    const { symbol, isDryRun } = workerData;
    const baseSymbol = symbol.replace('.Daily', '').split('_')[0];
    const configTemplate = OPTIMIZER_CONFIG[baseSymbol] || OPTIMIZER_CONFIG[symbol];

    if (!configTemplate) {
      parentPort?.postMessage({ type: "log", data: `[WARN] Skipping ${symbol} - No OPTIMIZER_CONFIG found.` });
      parentPort?.postMessage({ type: "result", mageInput: 0, mageSurvived: 0, sageInput: 0, sageSurvived: 0 });
      return;
    }

    let csvFiles = fs.readdirSync(CSV_DIR).filter(f => f.startsWith(`${symbol}_M1`) && f.endsWith(".csv"));
    if (!csvFiles.length) {
      csvFiles = fs.readdirSync(CSV_DIR).filter(f => f.startsWith(symbol) && f.endsWith(".csv"));
    }
    if (!csvFiles.length) {
      parentPort?.postMessage({ type: "result", mageInput: 0, mageSurvived: 0, sageInput: 0, sageSurvived: 0 });
      return;
    }

    const csvFilePath = path.join(CSV_DIR, csvFiles[0]);
    const endDate = getLatestDate(csvFilePath);
    const startDate = new Date(endDate.getTime() - HORIZON_YEARS * 365.25 * 86400000);
    const sixMoMs = new Date(endDate.getTime() - 180 * 86400000).getTime();

    const m1Rows = await loadCsv(csvFilePath, configTemplate.spread, startDate, endDate);
    if (!m1Rows || m1Rows.length === 0) {
      parentPort?.postMessage({ type: "result", mageInput: 0, mageSurvived: 0, sageInput: 0, sageSurvived: 0 });
      return;
    }

    const m5Candles = aggregateCandles(m1Rows, 5);
    const m1Length = m1Rows.length;
    const m1Typed = {
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
    } as M1TypedArrays;

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
      
      m1Typed.isNewsForceClose[i] = isNewsForceClose(r.dateStr, h, m) ? 1 : 0;
    }

    const isForex = !symbol.includes("US30") && !symbol.includes("NAS") && !symbol.includes("SPX") && !symbol.includes("GER") && !symbol.includes("JPN") && !symbol.includes("XAU") && !symbol.includes("XTI") && !symbol.includes("BTC") && !symbol.includes("ETH");
    const spreadPts = configTemplate.spread * configTemplate.pipSize;

    const MAGE_DUMP_DIR = path.join(OPTIMIZER_DIR, "mage", "mage_optimizer_dump");
    const SAGE_DUMP_DIR = path.join(OPTIMIZER_DIR, "sage", "sage_optimizer_dump");

    let mageInput = 0, mageSurvived = 0;
    let sageInput = 0, sageSurvived = 0;

    // ==========================================
    // ⚔️ 1. EVALUATE MAGE CANDIDATES
    // ==========================================
    const mageDnaFile = path.join(MAGE_DNA_DIR, `mage_dna_${symbol}.json`);
    const mageDumpFile = path.join(MAGE_DUMP_DIR, `state_${symbol}.json`);
    let rawMage: any[] = [];
    if (fs.existsSync(mageDnaFile)) {
      try {
        const d = JSON.parse(fs.readFileSync(mageDnaFile, "utf8"));
        if (Array.isArray(d)) rawMage.push(...d);
      } catch {}
    }
    if (fs.existsSync(mageDumpFile)) {
      try {
        const d = JSON.parse(fs.readFileSync(mageDumpFile, "utf8"));
        if (Array.isArray(d)) rawMage.push(...d);
      } catch {}
    }

    const uniqueMage = Array.from(new Map(rawMage.filter(c => c && c.setup).map(c => [c.setup, c])).values());
    if (uniqueMage.length > 0) {
      try {
        mageInput = uniqueMage.length;
        const evaluatedMage: EvaluatedAlpha[] = [];

        for (const item of uniqueMage) {
          if (!item || !item.setup) continue;
          const parsed = parseMageConfig(item.setup);
          if (!parsed) continue;
          const { session, config } = parsed;

          const triggers = magePreCompute(
            m5Candles,
            m1Rows,
            symbol,
            spreadPts,
            session,
            isForex,
            configTemplate.pipSize,
            config.orbStartHour!,
            config.orbStartMin!,
            config.orbMinutes!,
            config.actionMinutes!,
            config.minBodyPips!
          );
          const res = mageEval(m1Typed, m5Candles, triggers, symbol, config, session, isForex);

          let peak = 0, runningR = 0, maxDD = 0;
          let sixMoNetR = 0, sixMoTrades = 0;

          for (const date of Object.keys(res.dailyNetR)) {
            const dayR = res.dailyNetR[date];
            runningR += dayR;
            if (runningR > peak) peak = runningR;
            const dd = peak - runningR;
            if (dd > maxDD) maxDD = dd;

            const dMs = new Date(date).getTime();
            if (dMs >= sixMoMs) {
              sixMoNetR += dayR;
              sixMoTrades++;
            }
          }

          if (res.totalNetR >= 15.0 && res.trades >= MIN_MACRO_TRADES && maxDD <= MAX_MACRO_DRAWDOWN) {
            const calmar = res.totalNetR / Math.max(0.5, maxDD);
            if (calmar >= MIN_MACRO_CALMAR && sixMoNetR >= 0) {
              const niche = getMageNiche(parsed);
              evaluatedMage.push({
                setup: item.setup,
                niche,
                threeYearNetR: res.totalNetR,
                threeYearTrades: res.trades,
                threeYearWinRate: res.winRate,
                threeYearMaxDD: maxDD,
                threeYearCalmar: calmar,
                sixMoNetR,
                sixMoTrades,
                dailyNetR: res.dailyNetR,
                rawItem: item
              });
            }
          }
        }

        const { survivors, purgedCount } = curateMapElitesArchive(evaluatedMage);
        mageSurvived = survivors.length;

        const curatedOutput = survivors.map(s => {
          return {
            setup: s.setup,
            dailyNetR: s.dailyNetR,
            trades: s.threeYearTrades,
            totalNetR: s.threeYearNetR,
            oosNetR: s.threeYearNetR,
            isNetR: s.threeYearNetR,
            isMaxDd: s.threeYearMaxDD,
            oosEndDate: endDate.toISOString().split("T")[0],
            records: []
          };
        });

        if (!isDryRun) {
          fs.writeFileSync(mageDnaFile, JSON.stringify(curatedOutput, null, 2), "utf8");
        }

        const topCalmar = survivors[0] ? survivors[0].threeYearCalmar.toFixed(2) : "N/A";
        const topR = survivors[0] ? `+${survivors[0].threeYearNetR.toFixed(1)}R` : "N/A";
        parentPort?.postMessage({
          type: "log",
          data: `[MAGE] ${symbol.padEnd(12)}: Preserved ${mageSurvived.toString().padStart(2, " ")}/${mageInput.toString().padStart(2, " ")} setups across ${new Set(survivors.map(s => s.niche)).size} niches (Top: ${topR}, Calmar: ${topCalmar})`
        });
      } catch (e: any) {
        parentPort?.postMessage({ type: "log", data: `[MAGE ERROR] ${symbol}: ${e.message}` });
      }
    }

    // ==========================================
    // 🧙‍♂️ 2. EVALUATE SAGE CANDIDATES
    // ==========================================
    const sageDnaFile = path.join(SAGE_DNA_DIR, `sage_dna_${symbol}.json`);
    const sageDumpFile = path.join(SAGE_DUMP_DIR, `state_${symbol}.json`);
    let rawSage: any[] = [];
    if (fs.existsSync(sageDnaFile)) {
      try {
        const d = JSON.parse(fs.readFileSync(sageDnaFile, "utf8"));
        if (Array.isArray(d)) rawSage.push(...d);
      } catch {}
    }
    if (fs.existsSync(sageDumpFile)) {
      try {
        const d = JSON.parse(fs.readFileSync(sageDumpFile, "utf8"));
        if (Array.isArray(d)) rawSage.push(...d);
      } catch {}
    }

    const uniqueSage = Array.from(new Map(rawSage.filter(c => c && c.setup).map(c => [c.setup, c])).values());
    if (uniqueSage.length > 0) {
      try {
        sageInput = uniqueSage.length;
        const evaluatedSage: EvaluatedAlpha[] = [];

        for (const item of uniqueSage) {
          if (!item || !item.setup) continue;
          const parsed = parseSageConfig(item.setup);
          if (!parsed) continue;
          const { session, config } = parsed;

            const triggers = sagePreCompute(
              m5Candles,
              m1Rows,
              symbol,
              spreadPts,
              session,
              isForex,
              configTemplate.pipSize,
              config.orbStartHour!,
              config.orbStartMin!,
              config.orbMinutes!,
              config.sweepPips!,
              config.actionMinutes!,
              config.maxSweepMultiplier!,
              config.requireCloseInside!
            );
            const res = sageEval(m1Typed, m5Candles, triggers, symbol, config, session, isForex);

            let peak = 0, runningR = 0, maxDD = 0;
            let sixMoNetR = 0, sixMoTrades = 0;

            for (const date of Object.keys(res.dailyNetR)) {
              const dayR = res.dailyNetR[date];
              runningR += dayR;
              if (runningR > peak) peak = runningR;
              const dd = peak - runningR;
              if (dd > maxDD) maxDD = dd;

              const dMs = new Date(date).getTime();
              if (dMs >= sixMoMs) {
                sixMoNetR += dayR;
                sixMoTrades++;
              }
            }

            if (res.totalNetR >= 15.0 && res.trades >= MIN_MACRO_TRADES && maxDD <= MAX_MACRO_DRAWDOWN) {
              const calmar = res.totalNetR / Math.max(0.5, maxDD);
              if (calmar >= MIN_MACRO_CALMAR && sixMoNetR >= 0) {
                const niche = getSageNiche(parsed);
                evaluatedSage.push({
                  setup: item.setup,
                  niche,
                  threeYearNetR: res.totalNetR,
                  threeYearTrades: res.trades,
                  threeYearWinRate: res.winRate,
                  threeYearMaxDD: maxDD,
                  threeYearCalmar: calmar,
                  sixMoNetR,
                  sixMoTrades,
                  dailyNetR: res.dailyNetR,
                  rawItem: item
                });
              }
            }
          }

          const { survivors, purgedCount } = curateMapElitesArchive(evaluatedSage);
          sageSurvived = survivors.length;

          const curatedOutput = survivors.map(s => {
            return {
              setup: s.setup,
              dailyNetR: s.dailyNetR,
              trades: s.threeYearTrades,
              totalNetR: s.threeYearNetR,
              oosNetR: s.threeYearNetR,
              isNetR: s.threeYearNetR,
              isMaxDd: s.threeYearMaxDD,
              oosEndDate: endDate.toISOString().split("T")[0],
              records: []
            };
          });

          if (!isDryRun) {
            fs.writeFileSync(sageDnaFile, JSON.stringify(curatedOutput, null, 2), "utf8");
          }

          const topCalmar = survivors[0] ? survivors[0].threeYearCalmar.toFixed(2) : "N/A";
          const topR = survivors[0] ? `+${survivors[0].threeYearNetR.toFixed(1)}R` : "N/A";
          parentPort?.postMessage({
            type: "log",
            data: `[SAGE] ${symbol.padEnd(12)}: Preserved ${sageSurvived.toString().padStart(2, " ")}/${sageInput.toString().padStart(2, " ")} setups across ${new Set(survivors.map(s => s.niche)).size} niches (Top: ${topR}, Calmar: ${topCalmar})`
          });
        } catch (e: any) {
          parentPort?.postMessage({ type: "log", data: `[SAGE ERROR] ${symbol}: ${e.message}` });
        }
      }

    parentPort?.postMessage({
      type: "result",
      mageInput,
      mageSurvived,
      sageInput,
      sageSurvived,
    });
  };

  runWorker().catch((e: any) => {
    parentPort?.postMessage({ type: "log", data: `[WORKER ERROR] ${workerData.symbol}: ${e.message}` });
  });
}
