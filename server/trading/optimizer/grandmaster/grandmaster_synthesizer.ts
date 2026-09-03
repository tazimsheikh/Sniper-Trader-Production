import {
  IndependentSynthesisComponent,
  evaluateComponent,
} from "./GrandmasterMetrics.js";
import {
  runMonteCarlo,
  computeMasterRiskSizing,
  buildHedgingUnits,
  admitHedgingUnitsWithCorrelationPenalty,
  HedgingUnit,
  hashStringToSeed
} from "./utils/GrandmasterMath.js";
import { preProcessData as preProcessDataMageSage } from "./GrandmasterPreProcessor.js";
import { deduplicateConfigs, preProcessData as preProcessDataSeer, getRollingMonthKeys } from "../seer/seer_pre_processor.js";
import { generateRollingWindows } from "./grandmaster_plwfo.js";
import { runCPCV } from "./grandmaster_cpcv.js";
import { getAllOptimizationRunDirs, getAllStateFiles } from "../core/DumpScanner.js";
import fs from "fs";
import path from "path";

const BASE_OPTIMIZER_DIR = path.join(process.cwd(), "server", "trading", "optimizer");
const MAGE_DUMP_DIR = path.join(BASE_OPTIMIZER_DIR, "mage", "mage_optimizer_dump");
const SAGE_DUMP_DIR = path.join(BASE_OPTIMIZER_DIR, "sage", "sage_optimizer_dump");
const SEER_DUMP_DIR = path.join(BASE_OPTIMIZER_DIR, "seer", "seer_optimizer_dump");

const OPTIMIZER_OUT_DIR = path.join(BASE_OPTIMIZER_DIR, "grandmaster");
const SYNTHESIS_OUT_FILE = path.join(OPTIMIZER_OUT_DIR, "grandmaster_synthesis_results.md");
const HOLY_GRAIL_OUT_FILE = path.join(OPTIMIZER_OUT_DIR, "grandmaster_holy_grail.md");
const HOLY_GRAIL_JSON_FILE = path.join(OPTIMIZER_OUT_DIR, "grandmaster_portfolio.json");

function safeWriteFileSync(filePath: string, content: string) {
  try {
    fs.writeFileSync(filePath, content, "utf-8");
  } catch (e: any) {
    console.warn(`⚠️ Error writing file ${filePath}: ${e.message}`);
  }
}

const MIN_TRADES = 3;
const MAX_DRAWDOWN = 10.0;

async function runSynthesis() {
  console.log(`=======================================================`);
  console.log(`👑 UNIFIED TRI-BOT GRANDMASTER SYNTHESIZER 👑`);
  console.log(`   (MAGE ORB + SAGE REVERSAL + SEER LIQUIDITY HUNTS)`);
  console.log(`=======================================================`);

  function getFlatStateFiles(dir: string, botName: string): string[] {
    if (!fs.existsSync(dir)) {
      console.warn(`⚠️ Dump directory not found for ${botName}: ${dir}`);
      return [];
    }
    const runDirs = getAllOptimizationRunDirs(dir);
    console.log(`[DumpScanner] Discovered ${runDirs.length} run folder(s) for ${botName}:`);
    for (const d of runDirs) {
      const folderName = d === dir ? "Root Dump" : path.basename(d);
      const count = fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.startsWith("state_") && f.endsWith(".json")).length : 0;
      console.log(`  📁 ${folderName}: ${count} state files`);
    }

    const files = getAllStateFiles(dir);
    console.log(`[DumpScanner] Total ${botName} state files loaded: ${files.length}`);
    return files;
  }

  const allMageFiles = getFlatStateFiles(MAGE_DUMP_DIR, "Mage");
  const allSageFiles = getFlatStateFiles(SAGE_DUMP_DIR, "Sage");
  const allSeerFiles = getFlatStateFiles(SEER_DUMP_DIR, "Seer");

  if (allMageFiles.length === 0 && allSageFiles.length === 0 && allSeerFiles.length === 0) {
    console.error(`❌ FATAL: No optimizer dump state files found across Mage, Sage, or Seer.`);
    return;
  }

  const extractSymbol = (file: string) => {
    const filename = path.basename(file);
    const match = filename.match(/state_([A-Za-z0-9._]+)\.json/i);
    return match ? match[1].toUpperCase() : null;
  };

  const symbolSet = new Set<string>();
  for (const f of [...allMageFiles, ...allSageFiles, ...allSeerFiles]) {
    const sym = extractSymbol(f);
    if (sym && !sym.includes("BTC") && !sym.includes("ETH") && !sym.includes("JPN225")) {
      symbolSet.add(sym);
    }
  }
  const allSymbols = Array.from(symbolSet).sort();

  // Build global dates map across all three bots
  const globalDatesSet = new Set<string>();
  const loadStateData = (files: string[], sym: string) => {
    let combined: any[] = [];
    const matching = files.filter(f => extractSymbol(f) === sym && path.basename(f).startsWith("state_"));
    for (const f of matching) {
      try {
        const parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
        let items: any[] = [];
        if (Array.isArray(parsed)) items = parsed;
        else if (parsed.validAlphas && Array.isArray(parsed.validAlphas)) items = parsed.validAlphas;

        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          item.setup = item.setup || item.params || item.signature;
          if (item.setup && typeof item.setup === "string" && item.dailyNetR && Object.keys(item.dailyNetR).length > 0) {
            combined.push(item);
          }
        }
      } catch (e) {}
    }
    return combined;
  };

  for (const symbol of allSymbols) {
    const mData = loadStateData(allMageFiles, symbol);
    const sData = loadStateData(allSageFiles, symbol);
    const eData = loadStateData(allSeerFiles, symbol);
    for (const d of [...mData, ...sData, ...eData]) {
      if (d.dailyNetR) Object.keys(d.dailyNetR).forEach((k) => globalDatesSet.add(k));
    }
  }
  const globalDates = Array.from(globalDatesSet).sort();
  console.log(`[INFO] Global calendar built: ${globalDates.length} total trading days across ${allSymbols.length} symbols.`);

  let rawNormalPool: IndependentSynthesisComponent[] = [];
  let totalRawValidCount = 0;

  const stitchOOSSlices = (rawData: any[], botType: string) => {
    const mergedMap = new Map<string, any>();
    for (const item of rawData) {
      if (!item.setup) continue;

      const setupKey = item.setup.trim();
      const existing = mergedMap.get(setupKey);
      if (existing) {
        existing.trades = (existing.trades || 0) + (item.trades || 0);
        existing.totalNetR = (existing.totalNetR || 0) + (item.totalNetR || 0);
        existing.oosNetR = (existing.oosNetR || 0) + (item.oosNetR || 0);
        existing.dailyNetR = { ...(existing.dailyNetR || {}), ...(item.dailyNetR || {}) };
      } else {
        mergedMap.set(setupKey, {
          ...item,
          botType,
          dailyNetR: { ...(item.dailyNetR || {}) }
        });
      }
    }
    // Strict Out-Of-Sample minimum: only retain candidates with stitched oosNetR > 0
    return Array.from(mergedMap.values()).filter(item => {
      const oosVal = item.oosNetR !== undefined ? item.oosNetR : item.totalNetR;
      return (oosVal || 0) > 0 && (item.totalNetR === undefined || item.totalNetR > 0);
    });
  };

  console.log(`\n[PHASE 1] Pre-processing & auditing candidate configs across ${allSymbols.length} symbols with concurrency = 6...`);

  async function asyncPool<T, R>(
    concurrency: number,
    items: T[],
    fn: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let currentIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (currentIndex < items.length) {
        const idx = currentIndex++;
        results[idx] = await fn(items[idx], idx);
      }
    });
    await Promise.all(workers);
    return results;
  }

  let completedSymbols = 0;
  const symbolResults = await asyncPool(6, allSymbols, async (symbol) => {
    const mageDataRaw = loadStateData(allMageFiles, symbol);
    const sageDataRaw = loadStateData(allSageFiles, symbol);
    const seerDataRaw = loadStateData(allSeerFiles, symbol);

    const mageDataStitched = stitchOOSSlices(mageDataRaw, "Mage");
    const sageDataStitched = stitchOOSSlices(sageDataRaw, "Sage");
    const seerDataStitched = stitchOOSSlices(seerDataRaw, "Seer");

    const symbolComponents: IndependentSynthesisComponent[] = [];
    let symbolRawCount = 0;

    // 1. Audit Mage & Sage
    if (mageDataStitched.length > 0 || sageDataStitched.length > 0) {
      try {
        const { normalList: mageSageList, rawValidCount: msCount } = await preProcessDataMageSage(
          symbol,
          mageDataStitched,
          sageDataStitched,
          globalDates,
          MIN_TRADES
        );
        symbolComponents.push(...mageSageList);
        symbolRawCount += msCount;
      } catch (e: any) {
        console.warn(`  ⚠️ Error auditing Mage/Sage on ${symbol}: ${e.message}`);
      }
    }

    // 2. Audit Seer (Strict Math Backtester Audit: checks true OOS performance > 0R)
    if (seerDataStitched.length > 0) {
      try {
        const { normalList: seerList, rawValidCount: sCount } = await preProcessDataSeer(
          symbol,
          seerDataStitched,
          globalDates,
          MIN_TRADES,
          false // skipAudit: false to strictly audit Seer via runSeerMathBacktest
        );

        const hydratedSeer = seerList.map((p) => {
          const state = seerDataStitched.find((s: any) => s.setup === p.setup);
          const hyd = evaluateComponent(state as any, symbol, "Seer", globalDates, true);
          if (hyd) {
            hyd.hedgeScore = p.hedgeScore;
            hyd.threeYearNetR = p.threeYearNetR ?? p.totalTotalR;
            hyd.threeYearMaxDrawdown = p.threeYearMaxDrawdown ?? p.maxDrawdown;
            hyd.threeYearTrades = p.threeYearTrades ?? p.totalTrades;
            hyd.threeYearWinRate = p.threeYearWinRate ?? p.winRate;
            hyd.threeYearProfitFactor = p.threeYearProfitFactor ?? p.profitFactor;
            hyd.profitFactor = p.profitFactor;
            hyd.regimeConsistency = p.regimeConsistency ?? 100;
            hyd.totalTotalR = p.threeYearNetR ?? p.totalTotalR;
            if (p.dailyReturns && Object.keys(p.dailyReturns).length > 0) {
              hyd.dailyReturns = p.dailyReturns;
              hyd.periodReturns = Object.entries(p.dailyReturns)
                .filter(([, v]) => v !== 0)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([, v]) => v as number);
            }
            return hyd;
          }
          return p;
        });

        symbolComponents.push(...hydratedSeer);
        symbolRawCount += sCount;
      } catch (e: any) {
        console.warn(`  ⚠️ Error auditing Seer on ${symbol}: ${e.message}`);
      }
    }

    completedSymbols++;
    const mageCount = symbolComponents.filter(p => p.botType === 'Mage').length;
    const sageCount = symbolComponents.filter(p => p.botType === 'Sage').length;
    const seerCount = symbolComponents.filter(p => p.botType === 'Seer').length;
    console.log(`  ✨ [${completedSymbols.toString().padStart(2, ' ')}/${allSymbols.length}] ${symbol.padEnd(12)}: ${symbolComponents.length.toString().padStart(2, ' ')} elite candidates admitted 🚀 (Mage: ${mageCount}, Sage: ${sageCount}, Seer: ${seerCount}) (from ${symbolRawCount.toString().padStart(3, ' ')} audited)`);

    return { symbolComponents, symbolRawCount };
  });

  for (const res of symbolResults) {
    rawNormalPool.push(...res.symbolComponents);
    totalRawValidCount += res.symbolRawCount;
  }

  console.log(`\n[PHASE 1] Raw Tri-Bot Normal Pool (Elites): ${rawNormalPool.length} (from ${totalRawValidCount} raw valid configs)`);
  console.log(`  🔹 Mage candidates : ${rawNormalPool.filter(c => c.botType === "Mage").length}`);
  console.log(`  🔹 Sage candidates : ${rawNormalPool.filter(c => c.botType === "Sage").length}`);
  console.log(`  🔹 Seer candidates : ${rawNormalPool.filter(c => c.botType === "Seer").length}`);

  const mcCutoffIdx = Math.floor(globalDates.length * 0.80);
  const mcDates = globalDates.slice(0, mcCutoffIdx);
  for (const p of rawNormalPool) {
    const dailyReturnsArray: number[] = [];
    for (const d of mcDates) dailyReturnsArray.push(p.dailyReturns[d] || 0);
    const candidateSeed = hashStringToSeed(`${p.symbol}_${p.botType}_${p.setup}`);
    p.monteCarloDrawdown99 = runMonteCarlo(dailyReturnsArray, 10000, candidateSeed);
  }

  const MAX_MC_DD_ALLOWED = 32.0;
  const beforePoolCount = rawNormalPool.length;
  rawNormalPool = rawNormalPool.filter(p => {
    const dd = p.threeYearMaxDrawdown || p.maxDrawdown || 0;
    const r = p.threeYearNetR !== undefined ? p.threeYearNetR : (p.totalTotalR || 0);
    const calmar = dd > 0 ? r / dd : r;
    const oneYrDd = (p as any).oneYearMaxDrawdown !== undefined ? (p as any).oneYearMaxDrawdown : dd;
    const r1Yr = (p as any).r1Year !== undefined ? (p as any).r1Year : r;
    const oneYrCalmar = oneYrDd > 0 ? r1Yr / oneYrDd : r1Yr;
    const oneYrCalmarFloor = (r >= 80.0 && r1Yr >= 15.0) ? 1.30 : 2.0;
    const mcDd = p.monteCarloDrawdown99 ?? 0;
    const maxDdCeiling = (p.botType === "Mage" || p.botType === "Seer") ? 14.0 : 10.0;
    const maxMcDdAllowed = (p.botType === "Mage" || p.botType === "Seer") ? 50.0 : 32.0;
    if (dd > maxDdCeiling || calmar < 2.0 || oneYrDd > maxDdCeiling || r1Yr < 2.0 || oneYrCalmar < oneYrCalmarFloor || mcDd > maxMcDdAllowed) {
      return false;
    }
    // Hard rejection for unsupported Mage exits
    if (p.botType === "Mage" && (p.setup.includes("ExitADTEL") || !p.setup.includes("ExitTRAILING"))) {
      return false;
    }
    return true;
  });
  console.log(`[PRUNING] Removed ${beforePoolCount - rawNormalPool.length} candidates failing Max DD gate (<=14R Mage/Seer, <=10R Sage), 3Y Calmar >= 2.0, 1Y NetR >= 2.0R, 1Y Calmar >= 2.0, or MC tail risk.`);

  // --- DYNAMIC PAIR PRUNING ---
  console.log(`\n⚙️ [PRUNING] Dynamic Pair-Level Drag Elimination`);
  const pairStats = new Map<string, { trades: number; netR: number; configs: number }>();
  for (const c of rawNormalPool) {
    const normSym = c.symbol.replace(/\.daily$/i, "").toUpperCase();
    if (!pairStats.has(normSym)) {
      pairStats.set(normSym, { trades: 0, netR: 0, configs: 0 });
    }
    const stats = pairStats.get(normSym)!;
    stats.configs++;
    stats.trades += c.threeYearTrades !== undefined ? c.threeYearTrades : (c.totalTrades || 0);
    stats.netR += c.threeYearNetR !== undefined ? c.threeYearNetR : (c.totalTotalR || 0);
  }

  const DRAGGING_PAIRS = new Set<string>();
  for (const [sym, stats] of pairStats.entries()) {
    const rPerTrade = stats.trades > 0 ? stats.netR / stats.trades : 0;
    console.log(`  [Stats] ${sym.padEnd(10)} : ${stats.configs} configs, ${stats.trades} trades, ${stats.netR.toFixed(2)} R, Exp: ${rPerTrade.toFixed(3)} R/trade`);
    // Hard gate: Disallow any pair with net non-positive R or sub-par expectancy
    if (stats.netR <= 0 || rPerTrade < 0.05) {
      console.log(`  🧨 Dropping ${sym.padEnd(8)}: Dragging pair detected! (NetR=${stats.netR.toFixed(2)}R, Exp=${rPerTrade.toFixed(3)}R)`);
      DRAGGING_PAIRS.add(sym);
    }
  }

  const beforePruning = rawNormalPool.length;
  rawNormalPool = rawNormalPool.filter(c => {
    const normSym = c.symbol.replace(/\.daily$/i, "").toUpperCase();
    return !DRAGGING_PAIRS.has(normSym);
  });
  console.log(`[PRUNING] Removed ${beforePruning - rawNormalPool.length} dragging configs from ${DRAGGING_PAIRS.size} rejected pairs.`);
  // -----------------------------

  // PHASE 2: Tri-Bot Natural Hedging Clustering (2-Unit Dyads & 3-Unit Triads)
  console.log(`\n⚙️ PHASE 2: TRI-BOT HEDGING CLUSTERING (2-Unit Dyads & 3-Unit Triads)`);
  const allUnits = buildHedgingUnits(rawNormalPool, globalDates);
  console.log(`[HEDGING] Formed ${allUnits.length} candidate Hedging Units:`);
  console.log(`  🔺 Tri-Hedges (Same-Symbol 3-Unit: Mage+Sage+Seer): ${allUnits.filter(u => u.type === "TRI_PAIR").length}`);
  console.log(`  🌐 Cross-Asset Triads (3-Unit: 1 Mage+1 Sage+1 Seer): ${allUnits.filter(u => u.type === "CROSS_TRI").length}`);
  console.log(`  🔗 Self-Pairs (Same-Symbol 2-Unit): ${allUnits.filter(u => u.type === "SELF_PAIR").length}`);
  console.log(`  🌐 Cross-Pairs (Synthetic 2-Unit): ${allUnits.filter(u => u.type === "CROSS_PAIR").length}`);
  console.log(`  ⭐ Singletons: ${allUnits.filter(u => u.type === "SINGLETON").length}`);

function getCanonicalSession(setupStr: string): "asia" | "london" | "newyork" {
  const lower = setupStr.toLowerCase().trim();
  if (lower.startsWith("asia") || lower.includes("session=asia")) return "asia";
  if (lower.startsWith("london") || lower.includes("session=london")) return "london";
  if (
    lower.startsWith("ny") ||
    lower.startsWith("newyork") ||
    lower.startsWith("new_york") ||
    lower.includes("session=ny") ||
    lower.includes("session=newyork") ||
    lower.includes("session=ny_forex") ||
    lower.includes("session=ny_indice")
  ) {
    return "newyork";
  }
  return "london";
}

  // Use organic adaptive thresholding to admit top distinct units (accommodating maximum Seer inclusion)
  let selectedUnits = admitHedgingUnitsWithCorrelationPenalty(allUnits, globalDates, 25, 45);
  console.log(`[HEDGING] Admitted ${selectedUnits.length} diverse Hedging Units`);

  let selectedNormal: IndependentSynthesisComponent[] = [];
  for (const u of selectedUnits) {
    selectedNormal.push(...u.components);
  }
  console.log(`Selected Tri-Bot Grandmaster Portfolio: ${selectedNormal.length} configs across ${selectedUnits.length} Hedging Units`);
  console.log(`  🔹 Mage components : ${selectedNormal.filter(c => c.botType === "Mage").length}`);
  console.log(`  🔹 Sage components : ${selectedNormal.filter(c => c.botType === "Sage").length}`);
  console.log(`  🔹 Seer components : ${selectedNormal.filter(c => c.botType === "Seer").length}`);

  const portfolioDatesSet = new Set<string>();
  for (const c of selectedNormal) {
    for (const d of Object.keys(c.dailyReturns || {})) {
      portfolioDatesSet.add(d);
    }
  }
  const portfolioDates = Array.from(portfolioDatesSet).sort();

  for (const c of selectedNormal) {
    c.dailyRArray = new Float64Array(portfolioDates.length);
    for (let i = 0; i < portfolioDates.length; i++) {
      c.dailyRArray[i] = c.dailyReturns[portfolioDates[i]] || 0;
    }
  }

  const normalSizing = computeMasterRiskSizing(selectedNormal, portfolioDates, 1.0, 0.10);
  console.log(`[SIZING] 🌌 Master MC DD 99%: ${normalSizing.masterMcDrawdown99.toFixed(2)} R. Global Risk Factor: ${normalSizing.globalRiskPct.toFixed(3)}.`);

  // PHASE 3: Coupled-Unit Monthly Profitability Audit
  console.log(`\n⚙️ PHASE 3: COUPLED-UNIT MONTHLY PROFITABILITY AUDIT (ROLLING 12 MONTHS)`);
  // Audit the most recent 12 calendar months present in portfolioDates to guarantee positive recent returns
  const allMonthsSet = Array.from(new Set(portfolioDates.map(d => d.substring(0, 7)))).sort();
  const allTargetMonths = allMonthsSet.slice(-12);
  console.log(`  [PHASE 3] Auditing ${allTargetMonths.length} recent calendar months: ${allTargetMonths[0]} → ${allTargetMonths[allTargetMonths.length - 1]}`);

  const MONTHLY_WEIGHTED_FLOOR = Math.min(1.5, Math.max(0.2, 0.05 * selectedNormal.length));
  console.log(`  [PHASE 3] Adaptive monthly floor: +${MONTHLY_WEIGHTED_FLOOR.toFixed(2)}R for ${selectedNormal.length} components`);

  const MIN_UNITS_AFTER_PRUNING = Math.max(6, Math.floor(selectedUnits.length * 0.4));

  const dampedUnits = new Map<string, number>();
  let pruneRounds = 0;
  while (pruneRounds < 15 && selectedUnits.length > MIN_UNITS_AFTER_PRUNING) {
    const portfolioMonthlyWeightedR: Record<string, number> = {};
    for (const c of selectedNormal) {
      const weight = c.riskPct || 1.0;
      for (const [dateStr, r] of Object.entries(c.dailyReturns || {})) {
        const m = dateStr.substring(0, 7);
        portfolioMonthlyWeightedR[m] = (portfolioMonthlyWeightedR[m] || 0) + ((r as number) * weight);
      }
    }

    const losingMonths = allTargetMonths.filter(m => (portfolioMonthlyWeightedR[m] !== undefined && portfolioMonthlyWeightedR[m] < MONTHLY_WEIGHTED_FLOOR));
    if (losingMonths.length === 0) {
      console.log(`  ✅ All historical months satisfy the ≥ +${MONTHLY_WEIGHTED_FLOOR.toFixed(2)}R portfolio floor!`);
      break;
    }

    console.log(`  ⚠️ Detected monthly sub-target drag in: [${losingMonths.join(", ")}]. Evaluating Coupled Units...`);

    let worstUnit: HedgingUnit | null = null;
    let worstUnitLoss = 0;

    for (const unit of selectedUnits) {
      let unitLossSum = 0;
      for (const m of losingMonths) {
        let mR = 0;
        for (const c of unit.components) {
          for (const [dateStr, r] of Object.entries(c.dailyReturns || {})) {
            if (dateStr.substring(0, 7) === m) mR += (r as number) * (c.riskPct || 1.0);
          }
        }
        if (mR < 0) unitLossSum += mR;
      }
      if (unitLossSum < worstUnitLoss) {
        worstUnitLoss = unitLossSum;
        worstUnit = unit;
      }
    }

    if (worstUnit && worstUnitLoss < -0.3) {
      const curDamp = dampedUnits.get(worstUnit.unitId) || 0;
      if (curDamp === 0) {
        console.log(`  📉 Damping unit ${worstUnit.unitId} (${worstUnit.type}) by 50% risk (drag: ${worstUnitLoss.toFixed(2)}R)`);
        for (const c of worstUnit.components) {
          if (c.riskPct) c.riskPct *= 0.5;
        }
        dampedUnits.set(worstUnit.unitId, 1);
      } else {
        console.log(`  ✂️ Pruning persistent drag unit ${worstUnit.unitId} (${worstUnit.type}) (drag: ${worstUnitLoss.toFixed(2)}R)`);
        selectedUnits = selectedUnits.filter(u => u.unitId !== worstUnit!.unitId);
        selectedNormal = [];
        for (const u of selectedUnits) selectedNormal.push(...u.components);
      }
      pruneRounds++;
    } else {
      console.log(`  💡 No single unit causes disproportionate drag. Coupled audit complete.`);
      break;
    }
  }

  // Final risk re-scaling
  computeMasterRiskSizing(selectedNormal, portfolioDates, 1.0, 0.10);

  // PHASE 4: CPCV Validation
  console.log(`\n⚙️ PHASE 4: COMBINATORIAL PURGED CROSS-VALIDATION (CPCV)`);
  const windows = generateRollingWindows(portfolioDates.length, 6, 560, 140, 5);
  const normalCpcv = runCPCV(selectedNormal, portfolioDates, "The Holy Grail", windows);

  console.log(`[CPCV] Normal Pool CPCV Passed: ${normalCpcv.passed} (${normalCpcv.pathsPassed}/${normalCpcv.totalPaths} paths, Min Sharpe: ${normalCpcv.minSharpe.toFixed(2)}, Max DD: ${normalCpcv.maxDD.toFixed(2)}R)`);

  // Write JSON
  const finalJson = selectedNormal.map(c => ({
    symbol: c.symbol,
    botType: c.botType,
    setup: c.setup,
    totalTotalR: c.totalTotalR,
    threeYearTrades: c.threeYearTrades,
    threeYearWinRate: c.threeYearWinRate,
    profitFactor: c.profitFactor,
    monteCarloDrawdown99: c.monteCarloDrawdown99,
    riskPct: c.riskPct,
    unitId: (c as any).unitId,
    unitType: (c as any).unitType
  }));

  const GM_JSON_PATH = path.join(BASE_OPTIMIZER_DIR, "grandmaster_holy_grail_portfolios.json");
  const GM_MD_PATH = path.join(BASE_OPTIMIZER_DIR, "grandmaster_holy_grail_portfolios.md");

  safeWriteFileSync(HOLY_GRAIL_JSON_FILE, JSON.stringify(finalJson, null, 2));
  safeWriteFileSync(GM_JSON_PATH, JSON.stringify(finalJson, null, 2));
  console.log(`\n✅ Saved Tri-Bot Grandmaster Portfolio JSON to ${HOLY_GRAIL_JSON_FILE} & ${GM_JSON_PATH}`);

  // Write Markdown Summary (compatible with inject_grandmaster.ts)
  let md = `# 🏆 Tri-Bot Grandmaster Holy Grail Portfolio (MAGE + SAGE + SEER)\n\n`;
  md += `## 🏆 The Holy Grail (Maximum Optimization)\n\n`;
  md += `**Total Components:** ${selectedNormal.length}\n`;
  md += `**Mage Components:** ${selectedNormal.filter(c => c.botType === "Mage").length}\n`;
  md += `**Sage Components:** ${selectedNormal.filter(c => c.botType === "Sage").length}\n`;
  md += `**Seer Components:** ${selectedNormal.filter(c => c.botType === "Seer").length}\n`;
  md += `**Hedging Units:** ${selectedUnits.length}\n`;
  md += `**Master MC DD 99%:** ${normalSizing.masterMcDrawdown99.toFixed(2)} R\n`;
  md += `**CPCV Path Pass Rate:** ${normalCpcv.pathsPassed}/${normalCpcv.totalPaths} (${((normalCpcv.pathsPassed / normalCpcv.totalPaths) * 100).toFixed(1)}%)\n\n`;

  md += `| Symbol | Bot | Setup | 3-Year Net R | Win Rate | Risk % | Unit ID | Unit Type |\n`;
  md += `|:---|:---|:---|:---:|:---:|:---:|:---|:---|\n`;
  for (const c of selectedNormal) {
    md += `| **${c.symbol}** | ${c.botType} | \`${c.setup}\` | +${(c.totalTotalR || 0).toFixed(1)}R | ${(c.threeYearWinRate || c.winRate || 0).toFixed(1)}% | ${((c.riskPct || 1.0) * 100).toFixed(2)}% | ${(c as any).unitId} | ${(c as any).unitType} |\n`;
  }

  safeWriteFileSync(HOLY_GRAIL_OUT_FILE, md);
  safeWriteFileSync(GM_MD_PATH, md);
  console.log(`✅ Saved Tri-Bot Holy Grail Summary to ${HOLY_GRAIL_OUT_FILE} & ${GM_MD_PATH}`);

  console.log(`\n🎉 Tri-Bot Grandmaster Synthesis Complete!\n`);
}

runSynthesis();
