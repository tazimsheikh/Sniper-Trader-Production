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

const OPTIMIZER_DIR = path.join(process.cwd(), "server", "trading", "optimizer");
const MAGE_DUMP_DIR_BASE = path.join(OPTIMIZER_DIR, "mage", "mage_optimizer_dump");
const SAGE_DUMP_DIR_BASE = path.join(OPTIMIZER_DIR, "sage", "sage_optimizer_dump");

const MAGE_DUMP_DIR = MAGE_DUMP_DIR_BASE;
const SAGE_DUMP_DIR = SAGE_DUMP_DIR_BASE;

const SYNTHESIS_OUT_FILE = path.join(OPTIMIZER_DIR, "grandmaster_synthesis_results.md");
const HOLY_GRAIL_OUT_FILE = path.join(OPTIMIZER_DIR, "grandmaster_holy_grail_portfolios.md");

function safeWriteFileSync(filePath: string, content: string) {
  try {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, content, "utf-8");
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {}
    fs.renameSync(tmpPath, filePath);
  } catch (e: any) {
    try {
      fs.writeFileSync(filePath, content, { flag: "w" });
    } catch (e2: any) {}
  }
}

const MIN_TRADES = 20; // Minimum 20 trades across 3-year lookback to preserve high-expectancy session setups
const MAX_DRAWDOWN = 70; // Updated to match GrandmasterMetrics.ts — inverse-variance sizing handles high-DD at portfolio level
const BLACK_SWAN_MAX_DD = 20.0;
const BLACK_SWAN_MIN_TRADES = 50;
// Minimum total OOS Net R for a config to enter the Black Swan pool.
// Prevents noise-level performers (e.g. XTIUSD 6.5R) from entering even if
// their structural metrics (Sortino, Recovery) look clean.
const BLACK_SWAN_MIN_NET_R = 15;


async function runSynthesis() {
  console.log(`=======================================================`);
  console.log(`🏆 DETERMINISTIC CLUSTERED RISK PARITY SYNTHESIS 🏆`);
  console.log(`=======================================================`);

  if (!fs.existsSync(MAGE_DUMP_DIR) || !fs.existsSync(SAGE_DUMP_DIR)) {
    console.error("Optimizer dump directories not found.");
    return;
  }

  function getFlatStateFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
      throw new Error(`❌ FATAL: Dump directory not found: ${dir}\n   Run the optimizer first before the synthesizer.`);
    }
    // FLAT read only — never descend into subdirectories (e.g. last_optimization_run).
    // If we recurse, stale backup files contaminate the synthesis with old/999 setups.
    let files = fs.readdirSync(dir)
      .filter(f => f.startsWith("state_") && f.endsWith(".json"))
      .map(f => path.join(dir, f));

    const currentSymbols = new Set(files.map(f => path.basename(f).replace('state_', '').replace('.json', '')));
    const fallbackDir = path.join(dir, "last_optimization_run");
    
    if (fs.existsSync(fallbackDir)) {
      const fallbackFiles = fs.readdirSync(fallbackDir)
        .filter(f => f.startsWith("state_") && f.endsWith(".json"));
      
      for (const f of fallbackFiles) {
        const sym = f.replace('state_', '').replace('.json', '');
        if (!currentSymbols.has(sym)) {
          files.push(path.join(fallbackDir, f));
        }
      }
    }

    if (files.length === 0) {
      throw new Error(`❌ FATAL: No state_*.json files found in: ${dir}\n   The optimizer dump is empty. Run the optimizer first.`);
    }
    return files;
  }

  const allMageFiles = getFlatStateFiles(MAGE_DUMP_DIR);
  const allSageFiles = getFlatStateFiles(SAGE_DUMP_DIR);

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

  const getCoreSignature = (setup: string, botType: "Mage" | "Sage") => {
    const parts = setup.split("_");
    let session = parts[0];
    if (parts[0] === "NY") {
      session = `NY_${parts[1]}`;
    }

    const fcPart = parts.find((p) => p.startsWith("FC")) || "NoFC";

    if (botType === "Sage") {
      const sweepPart = parts.find((p) => p.startsWith("Sweep")) || "NoSweep";
      const exitPart = parts.find((p) => p.startsWith("Exit")) || "NoExit";
      return `${session}_${sweepPart}_${exitPart}_${fcPart}`;
    } else {
      const bodyPart = parts.find((p) => p.startsWith("Body")) || "NoBody";
      const bypassPart = parts.find((p) => p.endsWith("%")) || "0%";
      return `${session}_${bypassPart}_${bodyPart}_${fcPart}`;
    }
  };

  const stitchOOSSlices = (rawData: any[], botType: "Mage" | "Sage") => {
    const mergedMap = new Map<string, any>();
    for (const item of rawData) {
      if (!item.setup) continue;
      
      const coreSig = getCoreSignature(item.setup, botType);
      const existing = mergedMap.get(coreSig);
      if (existing) {
        existing.trades = (existing.trades || 0) + (item.trades || 0);
        existing.totalNetR = (existing.totalNetR || 0) + (item.totalNetR || 0);
        existing.oosNetR = (existing.oosNetR || 0) + (item.oosNetR || 0);
        existing.dailyNetR = { ...(existing.dailyNetR || {}), ...(item.dailyNetR || {}) };
      } else {
        mergedMap.set(coreSig, {
          ...item,
          dailyNetR: { ...(item.dailyNetR || {}) }
        });
      }
    }
    return Array.from(mergedMap.values());
  };

  for (const symbol of allSymbols) {
    const mageDataRaw = loadStateData(allMageFiles, symbol);
    const sageDataRaw = loadStateData(allSageFiles, symbol);

    const mageDataStitched = stitchOOSSlices(mageDataRaw, "Mage");
    const sageDataStitched = stitchOOSSlices(sageDataRaw, "Sage");

    const mageData = deduplicateConfigs(mageDataStitched, "Mage", 3);
    const sageData = deduplicateConfigs(sageDataStitched, "Sage", 3);

    const { normalList, rawValidCount } = await preProcessData(
      symbol,
      mageData,
      sageData,
      globalDates,
      MIN_TRADES,
    );

    totalRawValidCount += rawValidCount || 0;

    // Hydrate list
    const hydrateList = (list: IndependentSynthesisComponent[]) =>
      list.map((p) => {
        const dataList = p.botType === "Mage" ? mageData : sageData;
        const state = dataList.find((s: any) => s.setup === p.setup);
        const hyd = evaluateComponent(state as any, symbol, p.botType, globalDates, true);
        if (hyd) {
          hyd.hedgeScore = p.hedgeScore;
          return hyd;
        }
        return p;
      });

    rawNormalPool = rawNormalPool.concat(hydrateList(normalList));
  }

  console.log(`[PHASE 1] Raw Normal Pool (Elites): ${rawNormalPool.length} (from ${totalRawValidCount} raw valid configs)`);

  // Run individual Monte Carlo evaluations to set basic metrics
  for (const p of rawNormalPool) {
    const dailyReturnsArray: number[] = [];
    for (const d of globalDates) dailyReturnsArray.push(p.dailyReturns[d] || 0);
    p.monteCarloDrawdown99 = runMonteCarlo(dailyReturnsArray, 10000);
  }
  // PHASE 2: Clustering & Selection (De-correlation)
  console.log(`\n⚙️ PHASE 2: DETERMINISTIC DE-CORRELATION CLUSTERING (Relaxed for Inverse-Variance)`);
  
  const normalBannedSessions = new Set<string>();
  const selectedNormal = admitAllWithCorrelationPenalty(rawNormalPool, globalDates, 1, normalBannedSessions);

  console.log(`Selected Holy Grail Portfolio: ${selectedNormal.length} configs`);

  const normalSizing = computeMasterRiskSizing(selectedNormal, globalDates, 1.0, 0.10);
  console.log(`[SIZING] 🌌 Holy Grail Portfolio Master MC DD 99%: ${normalSizing.masterMcDrawdown99.toFixed(2)} R. Global Risk Factor: ${normalSizing.globalRiskPct.toFixed(3)}.`);

  console.log(`\n⚙️ PHASE 4: PORTFOLIO CPCV VALIDATION`);
  const windows = generateRollingWindows(globalDates.length, 6, 560, 140, 5);
  
  const normalCpcv = runCPCV(selectedNormal, globalDates, "The Holy Grail", windows);

  console.log(`[CPCV] Normal Pool CPCV Passed: ${normalCpcv.passed} (${normalCpcv.pathsPassed}/${normalCpcv.totalPaths} paths, Min Sharpe: ${normalCpcv.minSharpe.toFixed(2)}, Max DD: ${normalCpcv.maxDD.toFixed(2)}R)`);

  // Write synthesis report
  let markdown = `# 🏆 ENTERPRISE INDEPENDENT SYNTHESIS REPORT\n\n`;
  markdown += `This report outlines the institutional-grade components.\n`;
  markdown += `**Quantitative Constraints:** Min Trades ≥ ${MIN_TRADES} | Max DD ≤ ${MAX_DRAWDOWN}R | Last 6 Months ≥ 0R (regime guard)\n\n`;
  
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
