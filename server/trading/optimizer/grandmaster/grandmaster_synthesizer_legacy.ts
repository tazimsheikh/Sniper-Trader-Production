import {
  IndependentSynthesisComponent,
  evaluateComponent,
} from "./GrandmasterMetrics.js";
import { runMonteCarlo, calculatePearsonCorrelation, computeMasterRiskSizing, buildHedgingUnits, admitHedgingUnitsWithCorrelationPenalty, HedgingUnit, hashStringToSeed } from "./utils/GrandmasterMath.js";
import { deduplicateConfigs, preProcessData, getRollingMonthKeys } from "./GrandmasterPreProcessor.js";
import { generateRollingWindows } from "./grandmaster_plwfo.js";
import { runCPCV } from "./grandmaster_cpcv.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getAllOptimizationRunDirs, getAllStateFiles } from "../core/DumpScanner.js";

const OPTIMIZER_DIR = path.join(process.cwd(), "server", "trading", "optimizer");
const MAGE_DUMP_DIR_BASE = path.join(OPTIMIZER_DIR, "mage", "mage_optimizer_dump");
const SAGE_DUMP_DIR_BASE = path.join(OPTIMIZER_DIR, "sage", "sage_optimizer_dump");

const MAGE_DUMP_DIR = MAGE_DUMP_DIR_BASE;
const SAGE_DUMP_DIR = SAGE_DUMP_DIR_BASE;

const SYNTHESIS_OUT_FILE = path.join(OPTIMIZER_DIR, "grandmaster_synthesis_results.md");
const HOLY_GRAIL_OUT_FILE = path.join(OPTIMIZER_DIR, "grandmaster_holy_grail_portfolios.md");

function safeWriteFileSync(filePath: string, content: string) {
  try {
    fs.writeFileSync(filePath, content, "utf-8");
  } catch (e: any) {
    console.warn(`⚠️ Error writing file ${filePath}: ${e.message}`);
  }
}

const MIN_TRADES = 3;
const MAX_DRAWDOWN = 70;
const BLACK_SWAN_MAX_DD = 20.0;
const BLACK_SWAN_MIN_TRADES = 30;
const BLACK_SWAN_MIN_NET_R = 10;

async function runSynthesis() {
  console.log(`=======================================================`);
  console.log(`🏆 DETERMINISTIC CLUSTERED RISK PARITY SYNTHESIS 🏆`);
  console.log(`=======================================================`);

  if (!fs.existsSync(MAGE_DUMP_DIR) && !fs.existsSync(SAGE_DUMP_DIR)) {
    console.error("Optimizer dump directories not found.");
    return;
  }

  function getFlatStateFiles(dir: string, botName: string): string[] {
    if (!fs.existsSync(dir)) {
      throw new Error(`❌ FATAL: Dump directory not found: ${dir}\n   Run the optimizer first before the synthesizer.`);
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

  const extractSymbol = (file: string) => {
    const filename = path.basename(file);
    const match = filename.match(/(AUDJPY|AUDUSD|BTCUSD|CADJPY|CHFJPY|ETHUSD|EURAUD|EURCAD|EURJPY|EURNZD|EURUSD|GBPAUD|GBPCAD|GBPJPY|GBPNZD|GBPUSD|GER40|JPN225|NAS100|NZDUSD|SPX500|US30|USDCAD|USDCHF|USDJPY|XAUUSD|XTIUSD)/i);
    return match ? match[1].toUpperCase() : null;
  };

  const symbolSet = new Set<string>();
  for (const f of [...allMageFiles, ...allSageFiles]) {
    const sym = extractSymbol(f);
    if (sym && sym !== "BTCUSD" && sym !== "ETHUSD" && !sym.includes("JPN225")) symbolSet.add(sym);
  }
  const allSymbols = Array.from(symbolSet).sort();

  // Build global dates map
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
    for (const d of [...mData, ...sData]) {
      if (d.dailyNetR) Object.keys(d.dailyNetR).forEach((k) => globalDatesSet.add(k));
    }
  }
  const globalDates = Array.from(globalDatesSet).sort();
  console.log(`[INFO] Global calendar built: ${globalDates.length} total trading days across ${allSymbols.length} symbols.`);

  let rawNormalPool: IndependentSynthesisComponent[] = [];
  let totalRawValidCount = 0;

  // Exact-setup lossless stitcher: preserves full parameter tuples across multi-slice OOS windows
  const stitchOOSSlices = (rawData: any[], botType: "Mage" | "Sage") => {
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
          dailyNetR: { ...(item.dailyNetR || {}) }
        });
      }
    }
    return Array.from(mergedMap.values());
  };

  console.log(`[PHASE 1] Pre-processing & auditing candidate configs across ${allSymbols.length} symbols with concurrency = 4...`);

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

    const mageDataStitched = stitchOOSSlices(mageDataRaw, "Mage");
    const sageDataStitched = stitchOOSSlices(sageDataRaw, "Sage");

    const mageData = mageDataStitched;
    const sageData = sageDataStitched;

    const { normalList, rawValidCount } = await preProcessData(
      symbol,
      mageData,
      sageData,
      globalDates,
      MIN_TRADES,
    );

    // Hydrate list — evaluateComponent(hydrate=true) aligns the component onto the
    // global date universe (building dailyRArray), but also overwrites dailyReturns
    // with dump-based data. We restore the clean CSV audit returns below (Fix 1).
    const hydratedList = normalList.map((p) => {
      const dataList = p.botType === "Mage" ? mageData : sageData;
      const state = dataList.find((s: any) => s.setup === p.setup);
      const hyd = evaluateComponent(state as any, symbol, p.botType, globalDates, true);
      if (hyd) {
        hyd.hedgeScore = p.hedgeScore;
        hyd.threeYearNetR = p.threeYearNetR;
        hyd.threeYearMaxDrawdown = p.threeYearMaxDrawdown;
        hyd.threeYearTrades = p.threeYearTrades;
        hyd.threeYearWinRate = p.threeYearWinRate;
        hyd.threeYearProfitFactor = p.threeYearProfitFactor;
        hyd.profitFactor = p.profitFactor;
        hyd.regimeConsistency = p.regimeConsistency;
        if (p.threeYearNetR !== undefined) {
          hyd.totalTotalR = p.threeYearNetR;
        }

        // FIX 1: Restore CSV audit dailyReturns — the hydration step above rebuilt
        // dailyReturns from state.dailyRArray (OOS dump data). We restore the clean
        // 3-year CSV-audited returns so Phase 2 clustering, Phase 3 pruning, and
        // computeMasterRiskSizing all operate on verified data, not slice dump data.
        if (p.dailyReturns && Object.keys(p.dailyReturns).length > 0) {
          hyd.dailyReturns = p.dailyReturns;
          // Rebuild periodReturns chronologically from the restored dailyReturns
          hyd.periodReturns = Object.entries(p.dailyReturns)
            .filter(([, v]) => v !== 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, v]) => v as number);
        }

        return hyd;
      }
      return p;
    });

    completedSymbols++;
    const mageCount = hydratedList.filter(p => p.botType === 'Mage').length;
    const sageCount = hydratedList.filter(p => p.botType === 'Sage').length;
    console.log(`  ✨ [${completedSymbols.toString().padStart(2, ' ')}/${allSymbols.length}] ${symbol.padEnd(12)}: ${hydratedList.length.toString().padStart(2, ' ')} elite candidates admitted 🚀 (Mage:${mageCount}, Sage:${sageCount}) (from ${rawValidCount.toString().padStart(3, ' ')} audited)`);

    return { hydratedList, rawValidCount };
  });

  for (const res of symbolResults) {
    rawNormalPool.push(...res.hydratedList);
    totalRawValidCount += res.rawValidCount;
  }

  console.log(`[PHASE 1] Raw Normal Pool (Elites): ${rawNormalPool.length} (from ${totalRawValidCount} raw valid configs)`);

  // Run individual Monte Carlo evaluations using only the IS portion (first 80% of dates)
  // to avoid future tail-risk events from the OOS window contaminating position sizing decisions.
  const mcCutoffIdx = Math.floor(globalDates.length * 0.80);
  const mcDates = globalDates.slice(0, mcCutoffIdx);
  for (const p of rawNormalPool) {
    const dailyReturnsArray: number[] = [];
    for (const d of mcDates) dailyReturnsArray.push(p.dailyReturns[d] || 0);
    const candidateSeed = hashStringToSeed(`${p.symbol}_${p.botType}_${p.setup}`);
    p.monteCarloDrawdown99 = runMonteCarlo(dailyReturnsArray, 10000, candidateSeed);
  }

  // Prune toxic candidates that carry unacceptable tail risk before clustering
  const MAX_MC_DD_ALLOWED = 32.0; // Enforce a cap of 32.0R max historical tail risk (allows high-frequency alphas)
  const beforePoolCount = rawNormalPool.length;
  rawNormalPool = rawNormalPool.filter(p => (p.monteCarloDrawdown99 ?? 0) <= MAX_MC_DD_ALLOWED);
  console.log(`[PRUNING] Removed ${beforePoolCount - rawNormalPool.length} candidates with > ${MAX_MC_DD_ALLOWED}R tail risk.`);

  // PHASE 2: Natural Hedging Clustering (Self-Hedging & Cross-Asset Residual Pairing)
  console.log(`\n⚙️ PHASE 2: NATURAL HEDGING CLUSTERING (Self-Hedging & Cross-Asset Pairing)`);
  const allUnits = buildHedgingUnits(rawNormalPool, globalDates);
  console.log(`[HEDGING] Formed ${allUnits.length} candidate Hedging Units:`);
  console.log(`  🔗 Self-Pairs (Same Symbol): ${allUnits.filter(u => u.type === "SELF_PAIR").length}`);
  console.log(`  🌐 Cross-Pairs (Synthetic): ${allUnits.filter(u => u.type === "CROSS_PAIR").length}`);
  console.log(`  ⭐ Singletons: ${allUnits.filter(u => u.type === "SINGLETON").length}`);

  let selectedUnits = admitHedgingUnitsWithCorrelationPenalty(allUnits, globalDates, 100, 100);
  console.log(`[HEDGING] Admitted ${selectedUnits.length} diverse Hedging Units`);

  let selectedNormal: IndependentSynthesisComponent[] = [];
  for (const u of selectedUnits) {
    selectedNormal.push(...u.components);
  }
  console.log(`Selected Holy Grail Portfolio: ${selectedNormal.length} configs across ${selectedUnits.length} Hedging Units`);

  // Build active calendar strictly from dates where selected components traded
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
  console.log(`[SIZING] 🌌 Holy Grail Portfolio Master MC DD 99%: ${normalSizing.masterMcDrawdown99.toFixed(2)} R. Global Risk Factor: ${normalSizing.globalRiskPct.toFixed(3)}.`);

  console.log(`\n⚙️ PHASE 3: COUPLED-UNIT MONTHLY PROFITABILITY AUDIT`);
  const lastDateStr = globalDates[globalDates.length - 1] || "2026-08-01";
  const recentTargetMonths = getRollingMonthKeys(lastDateStr, 6);

  // FIX 6: Adaptive monthly floor — scales with portfolio size so a larger portfolio
  // naturally requires more aggregate monthly profit. Clamped 0.5R–2.0R.
  const MONTHLY_WEIGHTED_FLOOR = Math.min(2.0, Math.max(0.5, 0.08 * selectedNormal.length));
  console.log(`  [PHASE 3] Adaptive monthly floor: ${MONTHLY_WEIGHTED_FLOOR.toFixed(2)}R for ${selectedNormal.length} components`);

  // FIX 7: Safety brake — pruning halts when units drop to 50% of starting count (min 6)
  const MIN_UNITS_AFTER_PRUNING = Math.max(6, Math.floor(selectedUnits.length * 0.5));

  const dampedUnits = new Map<string, number>();
  let pruneRounds = 0;
  while (pruneRounds < 10 && selectedUnits.length > MIN_UNITS_AFTER_PRUNING) {
    const portfolioMonthlyWeightedR: Record<string, number> = {};
    for (const c of selectedNormal) {
      const weight = c.riskPct || 1.0;
      for (const [dateStr, r] of Object.entries(c.dailyReturns || {})) {
        const m = dateStr.substring(0, 7);
        portfolioMonthlyWeightedR[m] = (portfolioMonthlyWeightedR[m] || 0) + ((r as number) * weight);
      }
    }

    const losingMonths = recentTargetMonths.filter(m => (portfolioMonthlyWeightedR[m] !== undefined && portfolioMonthlyWeightedR[m] < MONTHLY_WEIGHTED_FLOOR));
    if (losingMonths.length === 0) {
      console.log(`  ✅ All recent target months (${recentTargetMonths.join(", ")}) satisfy the ≥ +${MONTHLY_WEIGHTED_FLOOR.toFixed(2)}R portfolio floor!`);
      break;
    }

    console.log(`  ⚠️ Detected monthly sub-target drag in: [${losingMonths.join(", ")}]. Evaluating Coupled Units...`);
    
    // FIX 3: Worst-unit scoring reads c.dailyReturns × riskPct (not stale combinedDailyReturns)
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
        // Heavily weight recency penalty for the last 2 months
        const isRecentTwo = m === recentTargetMonths[recentTargetMonths.length - 1] || m === recentTargetMonths[recentTargetMonths.length - 2];
        const recencyMultiplier = isRecentTwo ? 2.0 : 1.0;
        if (mR < 0) unitLossSum += (mR * recencyMultiplier);
      }
      if (unitLossSum < worstUnitLoss) {
        worstUnitLoss = unitLossSum;
        worstUnit = unit;
      }
    }

    // Only damp/prune if unit causes meaningful drag (> 1.5R active loss), preventing dropping champions over tiny noise (-0.11R)
    if (worstUnit && worstUnitLoss < -1.5) {
      const currentDamp = dampedUnits.get(worstUnit.unitId) || 1.0;
      if (currentDamp > 0.5) {
        // First strike: Damp weight by 50%
        dampedUnits.set(worstUnit.unitId, 0.5);
        for (const c of worstUnit.components) {
          c.riskPct = (c.riskPct || 1.0) * 0.5;
          // Scale component dailyReturns so the Phase 3 monthly tally reflects the damp.
          for (const d of Object.keys(c.dailyReturns || {})) {
            (c.dailyReturns as Record<string, number>)[d] *= 0.5;
          }
        }
        // Also halve unit-level combinedDailyReturns
        for (const d of Object.keys(worstUnit.combinedDailyReturns || {})) {
          worstUnit.combinedDailyReturns[d] *= 0.5;
        }
        console.log(`  [DAMPING] 📉 Damped Unit [${worstUnit.unitId}] (${worstUnit.type}) weight to 50% (retaining alpha while mitigating ${worstUnitLoss.toFixed(2)}R drag)`);
        pruneRounds++;
      } else {
        // Second strike: Outright drop if still persistent drag after damping
        console.log(`  [PRUNING] ❌ Dropping Unit [${worstUnit.unitId}] (${worstUnit.type}) — persistent ${worstUnitLoss.toFixed(2)}R drag across [${losingMonths.join(", ")}]`);
        selectedUnits = selectedUnits.filter(u => u !== worstUnit);
        selectedNormal = [];
        for (const u of selectedUnits) selectedNormal.push(...u.components);
        pruneRounds++;
      }
    } else {
      // No unit has meaningful negative drag in these months — accept portfolio as-is
      console.log(`  ✅ No single unit identified as active drag (>1.5R loss). Accepting portfolio as-is.`);
      break;
    }
  }

  if (selectedUnits.length <= MIN_UNITS_AFTER_PRUNING) {
    console.log(`  ⚠️ [PHASE 3] Pruning halted at minimum unit count (${selectedUnits.length}). Accepting remaining portfolio.`);
  }

  // Final post-pruning master risk sizing — enforces portfolio MC DD ≤ 1.0R
  const finalSizing = computeMasterRiskSizing(selectedNormal, portfolioDates, 1.0, 0.10);
  console.log(`[FINAL SIZING] 🌌 Holy Grail Portfolio Master MC DD 99%: ${finalSizing.masterMcDrawdown99.toFixed(2)} R. Global Risk Factor: ${finalSizing.globalRiskPct.toFixed(3)}.`);

  console.log(`\n⚙️ PHASE 4: PORTFOLIO CPCV VALIDATION`);
  const windows = generateRollingWindows(portfolioDates.length, 6, 560, 140, 5);

  
  const normalCpcv = runCPCV(selectedNormal, portfolioDates, "The Holy Grail", windows);

  console.log(`[CPCV] Normal Pool CPCV Passed: ${normalCpcv.passed} (${normalCpcv.pathsPassed}/${normalCpcv.totalPaths} paths, Min Sharpe: ${normalCpcv.minSharpe.toFixed(2)}, Max DD: ${normalCpcv.maxDD.toFixed(2)}R)`);

  // ── CPCV Hard Gate ──────────────────────────────────────────────────────────
  // If the portfolio fails CPCV structural validation, abort the JSON/MD output.
  // No stale or curve-fitted portfolio should ever be deployed without passing this gate.
  if (!normalCpcv.passed) {
    console.error(`\n🛑 CPCV GATE FAILED: The Holy Grail portfolio did not pass CPCV validation.`);
    console.error(`   Paths passed: ${normalCpcv.pathsPassed}/${normalCpcv.totalPaths} (need ≥ 10)`);
    console.error(`   Max DD: ${normalCpcv.maxDD.toFixed(2)}R (need < 12.0R)`);
    console.error(`   The portfolio JSON will NOT be written. Re-run the optimizer with updated data.`);
    return;
  }
  // ────────────────────────────────────────────────────────────────────────────
  // Write synthesis report
  let markdown = `# 🏆 ENTERPRISE INDEPENDENT SYNTHESIS REPORT\n\n`;
  markdown += `This report outlines the institutional-grade components.\n`;
  markdown += `**Quantitative Constraints:** Min Trades ≥ ${MIN_TRADES} | Max DD ≤ ${MAX_DRAWDOWN}R | Continuous Soft Confidence & HRP\n\n`;
  
  markdown += `## 📊 Portfolio-Level CPCV Performance Gates\n`;
  markdown += `- **Normal Portfolio CPCV**: ${normalCpcv.passed ? 'PASSED' : 'FAILED'} (${normalCpcv.pathsPassed}/${normalCpcv.totalPaths} paths passed, Min Sharpe: ${normalCpcv.minSharpe.toFixed(2)}, Max DD: ${normalCpcv.maxDD.toFixed(2)}R)\n\n`;

  for (let i = 0; i < selectedNormal.length; i++) {
    const p = selectedNormal[i];
    markdown += `## Rank #${i + 1}: ${p.symbol} (${p.botType})\n`;
    markdown += `- **Hedge Score**: ${p.hedgeScore.toFixed(4)}\n`;
    markdown += `- **Total Net R**: ${p.totalTotalR.toFixed(2)} R\n`;
    markdown += `- **True Intraday Max DD (Historical)**: ${p.maxDrawdown.toFixed(2)} R\n`;
    markdown += `- **True Intraday Max DD (Monte Carlo 99%)**: ${p.monteCarloDrawdown99?.toFixed(2)} R\n`;
    markdown += `- **Sortino Ratio**: ${p.sortinoRatio.toFixed(3)}\n`;
    markdown += `- **Total Trades**: ${p.totalTrades}\n`;
    markdown += `- **Config**: \`${p.setup}\`\n\n`;
  }
  try {
    safeWriteFileSync(SYNTHESIS_OUT_FILE, markdown);
  } catch (e: any) {
    console.warn(`⚠️ Could not write synthesis results markdown: ${e.message}`);
  }

  // Write Holy Grail Markdown Portfolio (expected by inject_grandmaster.ts)
  let holyGrailMd = `# 🌌 GRANDMASTER PORTFOLIO-LEVEL WALK-FORWARD (PLWFO)\n\n`;
  holyGrailMd += `Generated: **${selectedNormal.length}** Normal configs selected.\n`;
  holyGrailMd += `**Methodology:** Deterministic Clustered Risk Parity (DCRP).\n\n`;
  
  holyGrailMd += `## 🧪 CPCV Structural Validation\n`;
  holyGrailMd += `- **Normal Portfolio CPCV**: ${normalCpcv.passed ? 'PASSED' : 'FAILED'} (${normalCpcv.pathsPassed}/${normalCpcv.totalPaths} paths, Min Sharpe: ${normalCpcv.minSharpe.toFixed(2)}, Max DD: ${normalCpcv.maxDD.toFixed(2)}R)\n\n`;
  holyGrailMd += `---\n\n`;

  holyGrailMd += `# 🏦 SECTION 1: NORMAL ARCHETYPES (Mage & Sage)\n\n`;
  holyGrailMd += `# 🏆 The Holy Grail (Maximum Optimization)\n\n`;
  holyGrailMd += `## Rank #1\n`;
  const scaledPortfolioNetR = selectedNormal.reduce((sum, p) => sum + (p.totalTotalR * (p.riskPct || 1.0)), 0);
  const rawPortfolioNetR = selectedNormal.reduce((sum, p) => sum + p.totalTotalR, 0);

  holyGrailMd += `- **Total Scaled Portfolio Net R**: ${scaledPortfolioNetR.toFixed(2)} R (Raw Unscaled Net R: ${rawPortfolioNetR.toFixed(2)} R)\n`;
  holyGrailMd += `- **Scaled Portfolio Max DD (99% MC)**: ${finalSizing?.masterMcDrawdown99.toFixed(2) ?? '0.00'} R\n`;
  holyGrailMd += `- **Components in Portfolio**: ${selectedNormal.length}\n`;
  holyGrailMd += `\n**Component Setups (${selectedNormal.length} total):**\n`;
  for (const item of selectedNormal) {
    const scaledItemR = item.totalTotalR * (item.riskPct || 1.0);
    holyGrailMd += `  - **${item.symbol} (${item.botType})**: Setup=\`${item.setup}\` | Scaled Net R: ${scaledItemR.toFixed(1)}R (Raw: ${item.totalTotalR.toFixed(1)}R) | Risk Multiplier: ${(item.riskPct ?? 0).toFixed(3)}x\n`;
  }
  holyGrailMd += `\n---\n\n`;

  const HOLY_GRAIL_JSON_FILE = path.join(path.dirname(HOLY_GRAIL_OUT_FILE), "grandmaster_holy_grail_portfolios.json");
  const jsonOutput = selectedNormal.map(item => ({
    symbol: item.symbol,
    botType: item.botType,
    setup: item.setup,
    totalTotalR: item.threeYearNetR !== undefined ? item.threeYearNetR : item.totalTotalR,
    threeYearTrades: item.threeYearTrades ?? item.totalTrades,
    threeYearWinRate: item.threeYearWinRate ?? item.winRate,
    profitFactor: item.threeYearProfitFactor ?? item.profitFactor,
    monteCarloDrawdown99: item.monteCarloDrawdown99,
    riskPct: item.riskPct ?? 1.0,
  }));

  try {
    safeWriteFileSync(HOLY_GRAIL_JSON_FILE, JSON.stringify(jsonOutput, null, 2));
    console.log(`\n🌌 Portfolio JSON saved: ${HOLY_GRAIL_JSON_FILE}`);
  } catch (e: any) {
    console.warn(`⚠️ Could not write holy grail portfolio JSON: ${e.message}`);
  }

  try {
    safeWriteFileSync(HOLY_GRAIL_OUT_FILE, holyGrailMd);
    console.log(`\n🌌 Portfolio Markdown saved: ${HOLY_GRAIL_OUT_FILE}`);
  } catch (e: any) {
    console.warn(`⚠️ Could not write holy grail portfolio markdown: ${e.message}`);
  }

  // ── Auto-Inject into PairConfig.ts ──────────────────────────
  // Injection is now strictly handled by the orchestrator (master_pipeline.ts)
  // to prevent race conditions and duplicate execution.
  if (selectedNormal.length === 0) {
    console.warn(`\n⚠️  No portfolio configs selected.`);
  }

  console.log(`🎉 Grandmaster Synthesis Complete!`);
}

runSynthesis().catch(console.error);
