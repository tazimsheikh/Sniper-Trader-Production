import {
  IndependentSynthesisComponent,
  evaluateComponent,
} from "./GrandmasterMetrics.js";
import { runMonteCarlo, calculatePearsonCorrelation, admitAllWithCorrelationPenalty, computeMasterRiskSizing } from "./utils/GrandmasterMath.js";
import { deduplicateConfigs, preProcessData } from "./GrandmasterPreProcessor.js";
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

  if (!fs.existsSync(MAGE_DUMP_DIR) || !fs.existsSync(SAGE_DUMP_DIR)) {
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

    if (files.length === 0) {
      throw new Error(`❌ FATAL: No state_*.json files found in: ${dir}\n   The optimizer dump is empty. Run the optimizer first.`);
    }
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
    if (sym) symbolSet.add(sym);
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
  const symbolResults = await asyncPool(3, allSymbols, async (symbol) => {
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

    // Hydrate list
    const hydratedList = normalList.map((p) => {
      const dataList = p.botType === "Mage" ? mageData : sageData;
      const state = dataList.find((s: any) => s.setup === p.setup);
      const hyd = evaluateComponent(state as any, symbol, p.botType, globalDates, true);
      if (hyd) {
        hyd.hedgeScore = p.hedgeScore;
        return hyd;
      }
      return p;
    });

    completedSymbols++;
    console.log(`  ✨ [${completedSymbols.toString().padStart(2, ' ')}/${allSymbols.length}] ${symbol.padEnd(12)}: ${hydratedList.length.toString().padStart(2, ' ')} elite candidates admitted 🚀 (from ${rawValidCount.toString().padStart(3, ' ')} audited)`);

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
    p.monteCarloDrawdown99 = runMonteCarlo(dailyReturnsArray, 10000);
  }
  // PHASE 2: Clustering & Selection (De-correlation)
  console.log(`\n⚙️ PHASE 2: DETERMINISTIC DE-CORRELATION CLUSTERING (Hierarchical Risk Parity)`);
  
  const normalBannedSessions = new Set<string>();
  let selectedNormal = admitAllWithCorrelationPenalty(rawNormalPool, globalDates, 1, normalBannedSessions, [], 20);

  console.log(`Selected Holy Grail Portfolio: ${selectedNormal.length} configs`);

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

  // ── Fix 2: Minimum Allocation Floor ─────────────────────────────────────────
  // Configs carrying less than 1.5% final allocation are "parasites" — they
  // contribute negligible returns while still adding correlation drag, complexity,
  // and CPCV overhead. Drop them before validation so CPCV evaluates only
  // configs that materially affect portfolio performance.
  const MIN_ALLOC_PCT = 0.015;
  const beforeCount = selectedNormal.length;
  selectedNormal = selectedNormal.filter(c => {
    if ((c.riskPct ?? 0) < MIN_ALLOC_PCT) {
      console.log(`  [ALLOC GATE] ❌ Dropped ${c.symbol} (${c.botType}) — allocation ${((c.riskPct ?? 0) * 100).toFixed(2)}% below ${(MIN_ALLOC_PCT * 100).toFixed(1)}% floor`);
      return false;
    }
    return true;
  });
  if (selectedNormal.length < beforeCount) {
    console.log(`  [ALLOC GATE] Cleaned portfolio: ${beforeCount} → ${selectedNormal.length} configs`);
  }


  // ── PHASE 3: PORTFOLIO-LEVEL ZERO-LOSS RECENT MONTHS AUDIT & PRUNING ──────────
  console.log(`\n⚙️ PHASE 3: PORTFOLIO-LEVEL MONTHLY PROFITABILITY AUDIT (Zero-Loss Constraint)`);
  const recentTargetMonths = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  
  let pruneRounds = 0;
  while (pruneRounds < 5 && selectedNormal.length > 5) {
    const portfolioMonthlyWeightedR: Record<string, number> = {};
    for (const c of selectedNormal) {
      const weight = c.riskPct || (1 / selectedNormal.length);
      for (const [dateStr, r] of Object.entries(c.dailyReturns || {})) {
        const m = dateStr.substring(0, 7);
        portfolioMonthlyWeightedR[m] = (portfolioMonthlyWeightedR[m] || 0) + ((r as number) * weight);
      }
    }

    const losingMonths = recentTargetMonths.filter(m => (portfolioMonthlyWeightedR[m] !== undefined && portfolioMonthlyWeightedR[m] < -0.01));
    if (losingMonths.length === 0) {
      console.log(`  ✅ All recent target months (${recentTargetMonths.join(", ")}) are strictly non-negative!`);
      break;
    }

    console.log(`  ⚠️ Detected monthly drag in: [${losingMonths.join(", ")}]. Identifying and pruning drag contributors...`);
    
    // Find the worst drag contributor across these losing months
    let worstComp: IndependentSynthesisComponent | null = null;
    let worstLoss = 0;

    for (const c of selectedNormal) {
      let compLossSum = 0;
      for (const m of losingMonths) {
        let mR = 0;
        for (const [dateStr, r] of Object.entries(c.dailyReturns || {})) {
          if (dateStr.substring(0, 7) === m) mR += (r as number);
        }
        if (mR < 0) compLossSum += mR;
      }
      if (compLossSum < worstLoss) {
        worstLoss = compLossSum;
        worstComp = c;
      }
    }

    if (worstComp && worstLoss < -0.1) {
      console.log(`  [PRUNING] ❌ Dropping ${worstComp.symbol} (${worstComp.botType}) — contributed ${worstLoss.toFixed(2)}R drag across [${losingMonths.join(", ")}]`);
      selectedNormal = selectedNormal.filter(c => c !== worstComp);
      pruneRounds++;
      // Re-calculate sizing after pruning
      computeMasterRiskSizing(selectedNormal, portfolioDates, 1.0, 0.10);
    } else {
      break;
    }
  }

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
  holyGrailMd += `- **Scaled Portfolio Max DD (99% MC)**: ${normalSizing?.masterMcDrawdown99.toFixed(2) ?? '0.00'} R\n`;
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
    totalTotalR: item.totalTotalR,
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
