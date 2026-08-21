import * as fs from "fs";
import * as path from "path";
import { PairConfigManager, SAGE_PAIR_CONFIG, MAGE_PAIR_CONFIG } from "../../config/PairConfig.js";
import { runSageMathBacktest } from "../../backtester/SageMathBacktester.js";
import { runMathBacktest as runMageMathBacktest } from "../../backtester/MageMathBacktester.js";
import { getFixedEstDate } from "../../engine/LiveOrchestrator.js";

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

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function runDynamicToxicFilterInjection() {
  console.log(`\n☠️  [Toxic Filter Injector] Starting Constant Toxicity Analysis (Hours & Days)...`);
  
  const allPairs = Array.from(new Set([
    ...Object.keys(SAGE_PAIR_CONFIG),
    ...Object.keys(MAGE_PAIR_CONFIG)
  ]));
  
  const pairBannedHours: Record<string, number[]> = {};
  const pairBannedDays: Record<string, number[]> = {};

  for (const pair of allPairs) {
    let startDate1Yr = "2025-05-01";
    let endDate1Yr = "2026-05-01";

    const csvDir = path.join(process.cwd(), "data", "csv");
    const csvFiles = fs.readdirSync(csvDir).filter((f) => f.startsWith(`${pair.split("_")[0]}`) && f.endsWith(".csv"));
    if (csvFiles.length > 0) {
      const { getLatestDate } = await import("../../backtester/loadCsv.js");
      const latestDate = getLatestDate(path.join(csvDir, csvFiles[0]));
      
      endDate1Yr = latestDate.toISOString().substring(0, 10);
      
      const sd1 = new Date(latestDate.getTime());
      sd1.setFullYear(sd1.getFullYear() - 1);
      startDate1Yr = sd1.toISOString().substring(0, 10);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE A: Constant Toxicity (Hour & Day) — 1-Year Window (12-Month Grid)
    // ─────────────────────────────────────────────────────────────────────────
    // 24 hours x 12 calendar months (1-12)
    const hourlyMonthStats: Record<number, Record<number, { trades: number; totalR: number }>> = {};
    for (let h = 0; h < 24; h++) {
      hourlyMonthStats[h] = {};
      for (let m = 1; m <= 12; m++) hourlyMonthStats[h][m] = { trades: 0, totalR: 0 };
    }

    // 7 days x 12 calendar months (1-12)
    const dailyMonthStats: Record<number, Record<number, { trades: number; totalR: number }>> = {};
    for (let d = 0; d < 7; d++) {
      dailyMonthStats[d] = {};
      for (let m = 1; m <= 12; m++) dailyMonthStats[d][m] = { trades: 0, totalR: 0 };
    }

    let hasData1Yr = false;

    // 1. Evaluate Sage configs for 1-Yr Window
    const sageConfigs = PairConfigManager.getSageConfigs(pair);
    if (sageConfigs && sageConfigs.length > 0) {
      const backtestResult = await runSageMathBacktest(pair, startDate1Yr, endDate1Yr, true, {});
      for (const record of backtestResult.records) {
        if (record.outcome === "SKIPPED") continue;
        const r = record.pips ? (record.pips / (record.riskPips || 1)) : 0;
        const d = new Date(record.timestamp);

        const estDate = getFixedEstDate(d);
        const hour = estDate.getUTCHours();
        const calMonth = estDate.getUTCMonth() + 1; // 1-12
        const dow = estDate.getUTCDay();

        hourlyMonthStats[hour][calMonth].trades++;
        hourlyMonthStats[hour][calMonth].totalR += r;

        dailyMonthStats[dow][calMonth].trades++;
        dailyMonthStats[dow][calMonth].totalR += r;
        hasData1Yr = true;
      }
    }

    // 2. Evaluate Mage configs for 1-Yr Window
    const mageConfigs = PairConfigManager.getMageConfigs(pair);
    if (mageConfigs && mageConfigs.length > 0) {
      const mageResult = await runMageMathBacktest(pair, startDate1Yr, endDate1Yr, true);
      for (const record of mageResult.records) {
        if (record.outcome === "SKIPPED") continue;
        const r = record.pips ? (record.pips / (record.riskPips || 1)) : 0;
        const d = new Date(record.timestamp);

        const estDate = getFixedEstDate(d);
        const hour = estDate.getUTCHours();
        const calMonth = estDate.getUTCMonth() + 1;
        const dow = estDate.getUTCDay();

        hourlyMonthStats[hour][calMonth].trades++;
        hourlyMonthStats[hour][calMonth].totalR += r;

        dailyMonthStats[dow][calMonth].trades++;
        dailyMonthStats[dow][calMonth].totalR += r;
        hasData1Yr = true;
      }
    }

    const bannedHours: number[] = [];
    const bannedDays: number[] = [];

    if (hasData1Yr) {
      const activeEntryHours = new Set<number>();
      for (const cfg of [...sageConfigs, ...mageConfigs]) {
        const startH = cfg.orbStartHour ?? (cfg as any).startHour;
        if (typeof startH === "number") activeEntryHours.add(startH);
      }

      console.log(`\n--- Constant Toxicity Analysis (1-Year Window: ${startDate1Yr} to ${endDate1Yr}) : ${pair} ---`);

      // Evaluate Hour Persistence
      for (let h = 0; h < 24; h++) {
        if (activeEntryHours.has(h)) continue; // Never ban strategy's primary entry hour

        let activeMonths = 0;
        let losingMonths = 0;
        let totalNetR = 0;

        for (let m = 1; m <= 12; m++) {
          const stat = hourlyMonthStats[h][m];
          if (stat.trades > 0) {
            activeMonths++;
            totalNetR += stat.totalR;
            if (stat.totalR < 0) losingMonths++;
          }
        }

        if (totalNetR < 0 && activeMonths >= 3) {
          const losingRatio = losingMonths / activeMonths;
          if (losingRatio >= 0.65) {
            bannedHours.push(h);
            console.log(` 🚫 Constant Toxic Hour ${String(h).padStart(2, "0")}:00 EST | Net R: ${totalNetR.toFixed(2)} | Active M: ${activeMonths} | Losing M: ${losingMonths} (${(losingRatio * 100).toFixed(0)}%)`);
          }
        }
      }

      // Evaluate Day Persistence
      for (let d = 0; d < 7; d++) {
        let activeMonths = 0;
        let losingMonths = 0;
        let totalNetR = 0;

        for (let m = 1; m <= 12; m++) {
          const stat = dailyMonthStats[d][m];
          if (stat.trades > 0) {
            activeMonths++;
            totalNetR += stat.totalR;
            if (stat.totalR < 0) losingMonths++;
          }
        }

        if (totalNetR < 0 && activeMonths >= 3) {
          const losingRatio = losingMonths / activeMonths;
          if (losingRatio >= 0.65) {
            bannedDays.push(d);
            console.log(` 🚫 Constant Toxic Day [${DAY_NAMES[d]}] | Net R: ${totalNetR.toFixed(2)} | Active M: ${activeMonths} | Losing M: ${losingMonths} (${(losingRatio * 100).toFixed(0)}%)`);
          }
        }
      }
    }

    pairBannedHours[pair] = bannedHours;
    pairBannedDays[pair] = bannedDays;

    console.log(` Summary for ${pair} -> Toxic Hours: [${bannedHours.join(", ")}], Toxic Days: [${bannedDays.map(d => DAY_NAMES[d]).join(", ")}]`);
  }

  // Inject into PairConfig.ts
  const PAIR_CONFIG_PATH = path.join(process.cwd(), "server", "trading", "config", "PairConfig.ts");
  if (!fs.existsSync(PAIR_CONFIG_PATH)) {
    console.error(`❌ CRITICAL: PairConfig.ts not found!`);
    process.exit(1);
  }

  let content = fs.readFileSync(PAIR_CONFIG_PATH, "utf8");
  
  for (const pair of allPairs) {
    const bannedHours = pairBannedHours[pair] || [];
    const bannedDays = pairBannedDays[pair] || [];

    const pairBlockRegex = new RegExp(`('${pair}':\\s*\\[)([\\s\\S]*?)(\\n\\s*\\])`, "g");

    content = content.replace(pairBlockRegex, (match, openTag, innerContent, closeTag) => {
      let cleaned = innerContent;
      cleaned = cleaned.replace(/"toxicHours":\s*\[.*?\](,\n?\s*)?/g, "");
      cleaned = cleaned.replace(/"toxicDays":\s*\[.*?\](,\n?\s*)?/g, "");

      let injections = "";
      if (bannedHours.length > 0) {
        injections += `"toxicHours": [${bannedHours.join(", ")}],\n      `;
      }
      if (bannedDays.length > 0) {
        injections += `"toxicDays": [${bannedDays.join(", ")}],\n      `;
      }

      const updated = cleaned.replace(/"session":/g, `${injections}"session":`);
      return `${openTag}${updated}${closeTag}`;
    });

    if (bannedHours.length > 0 || bannedDays.length > 0) {
      console.log(`✅ Successfully injected toxic filters into PairConfig.ts for ${pair}!`);
    }
  }

  safeWriteFileSync(PAIR_CONFIG_PATH, content);
  console.log(`\n✅ Constant Toxic Hours & Toxic Days safely updated in PairConfig.ts!`);
}

runDynamicToxicFilterInjection().catch(console.error);
