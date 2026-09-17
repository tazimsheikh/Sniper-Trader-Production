import {
  IndependentSynthesisComponent,
  evaluateComponent,
} from "./GrandmasterMetrics.js";
import {
  runMonteCarlo,
  hashStringToSeed,
  buildNextGenHedgingUnits,
  selectUnitsByMarginalUtility,
  computeNextGenMasterRiskSizing,
  HedgingUnit
} from "./utils/GrandmasterMath.js";
import { preProcessData, BANNED_GRANDMASTER_PAIRS } from "./GrandmasterPreProcessor.js";
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
const HOLY_GRAIL_JSON_FILE = path.join(OPTIMIZER_OUT_DIR, "grandmaster_portfolio.json");
const GM_JSON_PATH = path.join(BASE_OPTIMIZER_DIR, "grandmaster_holy_grail_portfolios.json");
const HOLY_GRAIL_OUT_FILE = path.join(OPTIMIZER_OUT_DIR, "grandmaster_holy_grail.md");
const GM_MD_PATH = path.join(BASE_OPTIMIZER_DIR, "grandmaster_holy_grail_portfolios.md");

function safeWriteFileSync(filePath: string, content: string) {
  try {
    fs.writeFileSync(filePath, content, "utf-8");
  } catch (e: any) {
    console.warn(`⚠️ Error writing file ${filePath}: ${e.message}`);
  }
}

const MIN_TRADES = 3;

function isBannedPair(sym: string): boolean {
  const clean = sym.replace(/\.daily$/i, "").toUpperCase();
  return BANNED_GRANDMASTER_PAIRS.has(clean);
}

async function runSynthesis() {
  console.log(`=======================================================`);
  console.log(`👑 GRANDMASTER PORTFOLIO SYNTHESIZER 👑`);
  console.log(`   (Dual-Track Sieve + Marginal Utility + MC DD 6.0R)`);
  console.log(`=======================================================`);

  function getFlatStateFiles(dir: string, botName: string): string[] {
    if (!fs.existsSync(dir)) {
      console.warn(`⚠️ Dump directory not found for ${botName}: ${dir}`);
      return [];
    }
    const runDirs = getAllOptimizationRunDirs(dir);
    console.log(`[DumpScanner] Discovered ${runDirs.length} run folder(s) for ${botName}`);
    const files = getAllStateFiles(dir);

    // Also include permanent curated DNA banks
    const dnaDir = path.join(path.dirname(dir), "dna_bank");
    if (fs.existsSync(dnaDir)) {
      const dnaFiles = fs.readdirSync(dnaDir)
        .filter(f => f.endsWith(".json"))
        .map(f => path.join(dnaDir, f));
      files.push(...dnaFiles);
    }

    console.log(`[DumpScanner] Total ${botName} state & DNA files loaded: ${files.length}`);
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
    const match = filename.match(/(?:state_|mage_dna_|sage_dna_|seer_dna_)([A-Za-z0-9._]+)\.json/i);
    return match ? match[1].toUpperCase() : null;
  };

  const symbolSet = new Set<string>();
  for (const f of [...allMageFiles, ...allSageFiles, ...allSeerFiles]) {
    const sym = extractSymbol(f);
    if (sym && !isBannedPair(sym)) {
      symbolSet.add(sym);
    }
  }
  const allSymbols = Array.from(symbolSet).sort();
  console.log(`[BAN FILTER] Permanently excluded: ${Array.from(BANNED_GRANDMASTER_PAIRS).join(", ")}`);
  console.log(`[BAN FILTER] Traded universe set to ${allSymbols.length} active symbols.`);

  // Build global calendar dates map
  const globalDatesSet = new Set<string>();

  const loadDumpMap = (files: string[]) => {
    const map = new Map<string, any[]>();
    for (const file of files) {
      const sym = extractSymbol(file);
      if (!sym || isBannedPair(sym)) continue;
      try {
        const content = fs.readFileSync(file, "utf-8");
        const json = JSON.parse(content);
        if (Array.isArray(json)) {
          if (!map.has(sym)) map.set(sym, []);
          map.get(sym)!.push(...json);
          for (const item of json) {
            if (item.dailyNetR) {
              for (const d of Object.keys(item.dailyNetR)) globalDatesSet.add(d);
            }
          }
        }
      } catch (err: any) {
        console.warn(`⚠️ Failed reading ${file}: ${err.message}`);
      }
    }
    return map;
  };

  console.log(`\n⏳ Ingesting optimizer dumps into memory...`);
  const mageMap = loadDumpMap(allMageFiles);
  const sageMap = loadDumpMap(allSageFiles);
  const seerMap = loadDumpMap(allSeerFiles);

  const globalDates = Array.from(globalDatesSet).sort();
  console.log(`📅 Synchronized calendar spanning ${globalDates.length} distinct trading days (${globalDates[0]} -> ${globalDates[globalDates.length - 1]}).`);

  // PHASE 1: Pre-Process & Filter Alphas via Dual-Track Sieve
  console.log(`\n⚙️ PHASE 1: DUAL-TRACK SIEVE PRE-PROCESSING (MAGE + SAGE + SEER)`);
  const rawNormalPool: IndependentSynthesisComponent[] = [];

  let totalRawAudited = 0;
  let totalAdmittedCandidates = 0;

  for (const sym of allSymbols) {
    const symMage = mageMap.get(sym) || [];
    const symSage = sageMap.get(sym) || [];
    const symSeer = seerMap.get(sym) || [];

    // Audit Mage, Sage, and Seer via Unified Dual-Track Sieve
    if (symMage.length > 0 || symSage.length > 0 || symSeer.length > 0) {
      try {
        const { normalList: triBotList, rawValidCount: tbCount } = await preProcessData(
          sym,
          symMage,
          symSage,
          symSeer,
          globalDates,
          MIN_TRADES
        );
        totalRawAudited += tbCount;
        totalAdmittedCandidates += triBotList.length;
        rawNormalPool.push(...triBotList);

        const mCount = triBotList.filter(c => c.botType === "Mage").length;
        const sCount = triBotList.filter(c => c.botType === "Sage").length;
        const eCount = triBotList.filter(c => c.botType === "Seer").length;
        console.log(`  [${sym.padEnd(12)}] Mage: ${mCount.toString().padStart(2, ' ')} | Sage: ${sCount.toString().padStart(2, ' ')} | Seer: ${eCount.toString().padStart(2, ' ')} candidate archetypes`);
      } catch (err: any) {
        console.error(`❌ Error in PreProcessor for ${sym}: ${err.message}`);
      }
    }
  }

  console.log(`\n📊 Candidate Pool Summary:`);
  console.log(`   - Raw Valid Alphas Evaluated: ${totalRawAudited}`);
  console.log(`   - Elite Candidates Admitted: ${rawNormalPool.length}`);
  console.log(`   - Mage Candidates: ${rawNormalPool.filter(c => c.botType === "Mage").length}`);
  console.log(`   - Sage Candidates: ${rawNormalPool.filter(c => c.botType === "Sage").length}`);
  console.log(`   - Seer Candidates: ${rawNormalPool.filter(c => c.botType === "Seer").length}`);

  if (rawNormalPool.length === 0) {
    console.error(`❌ FATAL: Candidate pool is empty. Aborting synthesis.`);
    return;
  }

  // PHASE 2: Build Tri-Bot Hedging Units
  console.log(`\n⚙️ PHASE 2: GENERATING TRI-BOT HEDGING UNITS`);
  const allUnits = buildNextGenHedgingUnits(rawNormalPool, globalDates);
  console.log(`[Hedging Engine] Synthesized ${allUnits.length} candidate hedging units:`);
  console.log(`   - Tri-Pair (Mage + Sage + Seer): ${allUnits.filter(u => u.type === "TRI_PAIR").length}`);
  console.log(`   - Self-Pair Dual Hedges: ${allUnits.filter(u => u.type === "SELF_PAIR").length}`);
  console.log(`   - Cross-Tri Macro Hedges: ${allUnits.filter(u => u.type === "CROSS_TRI").length}`);
  console.log(`   - Cross-Pair Macro Hedges: ${allUnits.filter(u => u.type === "CROSS_PAIR").length}`);
  console.log(`   - Singletons: ${allUnits.filter(u => u.type === "SINGLETON").length}`);

  // PHASE 3: Marginal Portfolio Utility Forward Selection (Option B: Pure Meritocracy)
  console.log(`\n⚙️ PHASE 3: MARGINAL UTILITY FORWARD SELECTION (OPTION B: PURE MERITOCRACY)`);
  const selectedUnits = selectUnitsByMarginalUtility(
    allUnits,
    globalDates,
    35,  // Max 35 hedging units
    50   // Max 50 total individual components
  );

  console.log(`\n🏆 Selected ${selectedUnits.length} Hedging Units across the portfolio:`);
  const selectedNormal: IndependentSynthesisComponent[] = [];
  for (const u of selectedUnits) {
    for (const c of u.components) {
      if (!selectedNormal.some(existing => existing.symbol === c.symbol && existing.setup === c.setup && existing.botType === c.botType)) {
        selectedNormal.push(c);
      }
    }
  }

  console.log(`   - Total Component Alphas: ${selectedNormal.length}`);
  console.log(`   - Mage Components: ${selectedNormal.filter(c => c.botType === "Mage").length}`);
  console.log(`   - Sage Components: ${selectedNormal.filter(c => c.botType === "Sage").length}`);
  console.log(`   - Seer Components: ${selectedNormal.filter(c => c.botType === "Seer").length}`);
  console.log(`   - Active Traded Symbols: ${new Set(selectedNormal.map(c => c.symbol)).size}`);

  // Calculate synchronized portfolio dates
  const portfolioDatesSet = new Set<string>();
  for (const c of selectedNormal) {
    if (c.dailyReturns) {
      for (const d of Object.keys(c.dailyReturns)) portfolioDatesSet.add(d);
    }
  }
  const portfolioDates = Array.from(portfolioDatesSet).sort();

  for (const c of selectedNormal) {
    c.dailyRArray = new Float64Array(portfolioDates.length);
    for (let i = 0; i < portfolioDates.length; i++) {
      c.dailyRArray[i] = c.dailyReturns[portfolioDates[i]] || 0;
    }
  }

  // PHASE 4: Institutional Monte Carlo Risk Sizing (Option A: Target MC DD = 6.0R)
  console.log(`\n⚙️ PHASE 4: INSTITUTIONAL MONTE CARLO RISK SIZING (OPTION A: TARGET MC DD = 6.0R)`);
  const sizingResult = computeNextGenMasterRiskSizing(
    selectedNormal,
    portfolioDates,
    6.0,   // Target MC DD = 6.0R (Prop firm safe envelope)
    0.008, // Min risk 0.8%
    0.025  // Max risk 2.5%
  );

  // PHASE 5: Combinatorial Purged Cross-Validation (CPCV)
  console.log(`\n⚙️ PHASE 5: COMBINATORIAL PURGED CROSS-VALIDATION (CPCV)`);
  const windows = generateRollingWindows(portfolioDates.length, 6, 560, 140, 5);
  const normalCpcv = runCPCV(selectedNormal, portfolioDates, "Grandmaster Portfolio", windows);

  console.log(`[CPCV] Portfolio CPCV Passed: ${normalCpcv.passed} (${normalCpcv.pathsPassed}/${normalCpcv.totalPaths} paths, Min Sharpe: ${normalCpcv.minSharpe.toFixed(2)}, Max DD: ${normalCpcv.maxDD.toFixed(2)}R)`);

  // Write JSON to both destinations
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

  safeWriteFileSync(HOLY_GRAIL_JSON_FILE, JSON.stringify(finalJson, null, 2));
  safeWriteFileSync(GM_JSON_PATH, JSON.stringify(finalJson, null, 2));
  console.log(`\n✅ Saved Grandmaster Portfolio JSON to:\n   - ${HOLY_GRAIL_JSON_FILE}\n   - ${GM_JSON_PATH}`);

  // Calculate combined metrics
  let sumWeightedNetR = 0;
  let totalTradesCount = 0;
  for (const c of selectedNormal) {
    const r = c.totalTotalR || c.threeYearNetR || 0;
    sumWeightedNetR += r * (c.riskPct || 0.01);
    totalTradesCount += (c.threeYearTrades || c.totalTrades || 0);
  }

  // Write Markdown Summary (compatible with inject_grandmaster.ts)
  let md = `# 🏆 Tri-Bot Grandmaster Holy Grail Portfolio (MAGE + SAGE + SEER)\n\n`;
  md += `## 🏆 The Holy Grail (Maximum Optimization)\n\n`;
  md += `**Total Components:** ${selectedNormal.length}\n`;
  md += `**Mage Components:** ${selectedNormal.filter(c => c.botType === "Mage").length}\n`;
  md += `**Sage Components:** ${selectedNormal.filter(c => c.botType === "Sage").length}\n`;
  md += `**Seer Components:** ${selectedNormal.filter(c => c.botType === "Seer").length}\n`;
  md += `**Hedging Units:** ${selectedUnits.length}\n`;
  md += `**Active Symbols:** ${new Set(selectedNormal.map(c => c.symbol)).size}\n`;
  md += `**Total Historical Trades:** ${totalTradesCount}\n`;
  md += `**Master MC DD 99%:** ${sizingResult.masterMcDrawdown99.toFixed(2)} R\n`;
  md += `**Average Trade Risk:** ${(sizingResult.averageComponentRiskPct * 100).toFixed(2)}%\n`;
  md += `**Global Risk Multiplier:** ${sizingResult.globalRiskPct.toFixed(3)}x\n`;
  md += `**CPCV Path Pass Rate:** ${normalCpcv.pathsPassed}/${normalCpcv.totalPaths} (${((normalCpcv.pathsPassed / normalCpcv.totalPaths) * 100).toFixed(1)}%)\n`;
  md += `**CPCV Min Sharpe:** ${normalCpcv.minSharpe.toFixed(2)}\n\n`;

  md += `### Component Setups\n\n`;
  md += `| Symbol | Bot | Setup | 3-Year Net R | Win Rate | Risk % | Unit ID | Unit Type |\n`;
  md += `|:---|:---|:---|:---:|:---:|:---:|:---|:---|\n`;
  for (const c of selectedNormal) {
    md += `| **${c.symbol}** | ${c.botType} | \`${c.setup}\` | +${(c.totalTotalR || 0).toFixed(1)}R | ${(c.threeYearWinRate || c.winRate || 0).toFixed(1)}% | ${((c.riskPct || 0.01) * 100).toFixed(2)}% | ${(c as any).unitId} | ${(c as any).unitType} |\n`;
  }

  safeWriteFileSync(HOLY_GRAIL_OUT_FILE, md);
  safeWriteFileSync(GM_MD_PATH, md);
  console.log(`✅ Saved Grandmaster Holy Grail Summary to:\n   - ${HOLY_GRAIL_OUT_FILE}\n   - ${GM_MD_PATH}`);

  console.log(`\n🎉 Grandmaster Portfolio Synthesis Complete!\n`);
}

runSynthesis();
