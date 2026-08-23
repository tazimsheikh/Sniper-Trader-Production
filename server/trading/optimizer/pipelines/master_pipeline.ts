import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import db from '../../../core/db.js';
import {
  MAGE_PAIR_CONFIG,
  SAGE_PAIR_CONFIG,
  PairConfigManager
} from '../../config/PairConfig.js';
import { getSharedConnection, getSymbolSpec, getBrokerSymbol, getSharedAccount, safeDecryptAccountId } from '../../broker/metaApiHandler.js';
import { isEncrypted, decrypt } from '../../../core/crypto.js';

// Setup directories
const OPTIMIZER_DIR = path.join(
  process.cwd(),
  "server",
  "trading",
  "optimizer",
);
const CSV_DIR = path.join(process.cwd(), "data", "csv");
const DUMP_DIRS = [
  path.join(OPTIMIZER_DIR, "mage", "mage_optimizer_dump"),
  path.join(OPTIMIZER_DIR, "sage", "sage_optimizer_dump"),
  path.join(OPTIMIZER_DIR, "seer", "seer_optimizer_dump"),
];

// Configuration
const CHUNK_SIZE = 1000;

function runCommand(
  command: string,
  args: string[],
  name: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(
      `\n================================================================`,
    );
    console.log(`🚀 [${name}] Starting...`);
    console.log(
      `================================================================`,
    );

    const isNode = command.toLowerCase() === "node";
    const cmd = (process.platform === "win32" && !isNode) ? `${command}.cmd` : command;
    const child = spawn(cmd, args, {
      stdio: "inherit",
      cwd: process.cwd(),
      shell: true,
      env: { ...process.env, CONCURRENCY: "8", NODE_OPTIONS: "--max-old-space-size=8192" },
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ [${name}] Completed successfully.\n`);
        resolve();
      } else {
        reject(new Error(`❌ [${name}] Failed with exit code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`❌ [${name}] Error: ${err.message}`));
    });
  });
}

function cleanOldDumps() {
  console.log(`\n[1/7] 🧹 Archiving previous dump files to last_optimization_run (if older than 20 days)...`);
  let moved = 0;
  const now = Date.now();
  const TWENTY_DAYS_MS = 20 * 24 * 60 * 60 * 1000;

  for (const dir of DUMP_DIRS) {
    if (!fs.existsSync(dir)) continue;
    
    const backupDir = path.join(dir, "last_optimization_run");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const fullPath = path.join(dir, file);
      
      try {
        const stats = fs.statSync(fullPath);
        const ageMs = now - stats.mtimeMs;
        if (ageMs > TWENTY_DAYS_MS) {
          const destPath = path.join(backupDir, file);
          fs.renameSync(fullPath, destPath);
          moved++;
        }
      } catch (err) {
        console.error(`Error processing stats for ${file}:`, err);
      }
    }
  }
  console.log(`✅ Cleanup complete. Archived ${moved} dump files to last_optimization_run.`);
}

async function fetchHistoricalData() {
  console.log(`\n[2/7] 📈 Hydrating CSVs from MetaApi...`);

  // Find active accounts
  const profiles = (await db
    .prepare(
      `SELECT p.*, COALESCE(p.metaapi_token, u.metaapi_token) as metaapi_token 
       FROM trading_profiles p 
       LEFT JOIN users u ON p.user_id = u.id 
       WHERE COALESCE(p.metaapi_token, u.metaapi_token) IS NOT NULL 
       AND p.metaapi_account_id IS NOT NULL`,
    )
    .all()) as any[];

  if (!profiles || profiles.length === 0) {
    console.log(
      `⚠️ No configured MetaApi accounts found. Skipping hydration.`,
    );
    return;
  }

  let account = null;
  let activeProfile = null;

  for (const profile of profiles) {
    const token = profile.metaapi_token ? (isEncrypted(profile.metaapi_token) ? decrypt(profile.metaapi_token) : profile.metaapi_token) : "";
    const accountId = safeDecryptAccountId(profile.metaapi_account_id);

    console.log(`🔌 Attempting to connect to MetaApi Account: ${accountId}...`);
    try {
      account = await getSharedAccount(token, accountId);
      activeProfile = profile;
      console.log(`✅ Successfully connected to ${accountId}!`);
      break;
    } catch (err: any) {
      console.error(`❌ MetaApi Connection Failed for ${accountId}: ${err.message}. Trying next account if available...`);
    }
  }

  if (!account) {
    console.log(
      `⚠️ Giving up on MetaApi hydration after failing all active accounts. Skipping hydration step...`,
    );
    return;
  }

  const profile = activeProfile;

  const csvFiles = fs.readdirSync(CSV_DIR).filter((f) => f.endsWith(".csv"));

  for (const file of csvFiles) {
    const symbol = file.split("_")[0];
    let customMap = null;
    try {
      if (profile.broker_symbol_map) customMap = JSON.parse(profile.broker_symbol_map);
    } catch (e) {}
    let brokerSymbol = (await getBrokerSymbol(symbol, customMap)) || symbol;
    const filePath = path.join(CSV_DIR, file);

    // Find last timestamp
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    let lastDate = new Date("2023-01-01T00:00:00Z");
    if (lines.length > 1) {
      const lastLine = lines[lines.length - 1];
      let parts = lastLine.indexOf('\t') !== -1 ? lastLine.split('\t') : lastLine.split(',');
      if (parts.length > 1) {
        let datePart = parts[0];
        let timePart = parts[1];
        let dateStr = "";
        if (lastLine.indexOf('\t') !== -1) {
           dateStr = datePart.replace(/\./g, "-") + "T" + timePart + "Z";
        } else {
           dateStr = datePart.replace(/\./g, "-").replace(" ", "T") + "Z";
        }
        lastDate = new Date(dateStr);
      }
    }

    const now = new Date();
    const diffHours = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
    
    let shouldSkip = false;
    if (diffHours < 12) {
      shouldSkip = true;
    }

    if (shouldSkip) {
      console.log(`✅ ${symbol} is already up to date (last candle: ${lastDate.toISOString()}, diff: ${Math.round(diffHours)}h). Skipping hydration to save time...`);
      continue;
    }

    console.log(
      `🔄 Hydrating ${symbol} from ${lastDate.toISOString()} to Present...`,
    );
    let totalAdded = 0;
    let currentEndTime = new Date();
    let allNewCandles: any[] = [];

    while (true) {
      try {
        // Fetch 1000 candles backwards
        let candles: any[] = [];
        try {
          candles = await account.getHistoricalCandles(
            brokerSymbol,
            "1m",
            currentEndTime,
            CHUNK_SIZE,
          );
        } catch (candleErr: any) {
          if (
            candleErr.message?.includes("does not exist") &&
            brokerSymbol !== symbol
          ) {
            console.log(
              `⚠️ Mapped symbol ${brokerSymbol} doesn't exist, retrying with symbol ${symbol.replace(".Daily", "")}...`,
            );
            candles = await account.getHistoricalCandles(symbol.replace(".Daily", ""),
              "1m",
              currentEndTime,
              CHUNK_SIZE,
            );
            // Overwrite the brokerSymbol for future chunks in this loop to avoid re-triggering the catch block
            brokerSymbol = symbol;
          } else {
            throw candleErr;
          }
        }
        if (!candles || candles.length === 0) break;

        const validCandles = candles.filter((c: any) => new Date(c.time) > lastDate);
        allNewCandles = validCandles.concat(allNewCandles);

        if (candles.some((c: any) => new Date(c.time) <= lastDate)) break;

        const oldestCandleTime = new Date(candles[0].time);
        currentEndTime = new Date(oldestCandleTime.getTime() - 60000);
        
        if (Date.now() - currentEndTime.getTime() > 2 * 365 * 24 * 60 * 60 * 1000) break; // sanity cap 2 yrs
        
        await new Promise((r) => setTimeout(r, 500));
      } catch (err: any) {
        console.log(`⚠️ MetaApi Error on ${symbol}: ${err.message}. Moving to next pair.`);
        break;
      }
    }

    if (allNewCandles.length > 0) {
        allNewCandles.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
        
        const uniqueCandles = [];
        let lastTime = 0;
        for (const c of allNewCandles) {
           const t = new Date(c.time).getTime();
           if (t > lastTime) {
              uniqueCandles.push(c);
              lastTime = t;
           }
        }
        
        let newLines = [];
        for (const c of uniqueCandles) {
          const cTime = new Date(c.time);
          const datePart = cTime.toISOString().substring(0, 10).replace(/-/g, ".");
          const timePart = cTime.toISOString().substring(11, 19);
          newLines.push(
            `${datePart}\t${timePart}\t${c.open}\t${c.high}\t${c.low}\t${c.close}\t${c.tickVolume}\t0\t${c.spread}`
          );
        }
        let appendStr = newLines.join("\n") + "\n";
        if (!content.endsWith("\n")) {
            appendStr = "\n" + appendStr;
        }
        fs.appendFileSync(filePath, appendStr);
        totalAdded = newLines.length;
    }
    console.log(`✅ ${symbol} Hydrated. Added ${totalAdded} candles.`);
  }
}

async function runMasterPipeline() {
  console.log(
    `\n================================================================`,
  );
  console.log(`👑 GRANDMASTER PIPELINE ORCHESTRATOR`);
  console.log(
    `================================================================`,
  );

  try {
    cleanOldDumps();
    await fetchHistoricalData();

    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/pipelines/update_historical_news.ts"],
      "Update Historical News",
    );

    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/cull_dna_banks.ts"],
      "DNA Bank Culler (Mage + Sage)",
    );

    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/mage/mage_optimizer.ts"],
      "Mage Optimizer",
    );
    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/sage/sage_optimizer.ts"],
      "Sage Optimizer",
    );

    /*
    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/mage/mage_synthesizer.ts"],
      "Mage Synthesizer",
    );
    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/sage/sage_synthesizer.ts"],
      "Sage Synthesizer",
    );
    */

    /*
    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/seer/seer_cluster_optimizer.ts"],
      "Seer Optimizer",
    );
    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/seer/seer_synthesizer.ts"],
      "Seer Synthesizer",
    );
    */

    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/grandmaster/grandmaster_synthesizer.ts"],
      "Grandmaster Synthesizer",
    );

    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/grandmaster/inject_grandmaster.ts"],
      "Inject Grandmaster (Mage/Sage)",
    );

    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/grandmaster/inject_toxic_hours.ts"],
      "Inject Toxic Hours",
    );

    await runCommand(
      "npx",
      ["tsx", "server/trading/optimizer/grandmaster/generate_ist_schedule.ts"],
      "Generate IST Schedule Markdown",
    );

    await runCommand(
      "node",
      ["server/trading/optimizer/grandmaster/generate_pdf_fast.cjs"],
      "Generate Holy Grail PDF (Instant)",
    );


    console.log(`\n🎉 MASTER PIPELINE COMPLETED SUCCESSFULLY!`);
    console.log(`🏆 Holy Grail Portfolio injected to PairConfig.ts (Mage + Sage)`);
    process.exit(0);

  } catch (err: any) {
    console.error(`\n🔥 FATAL PIPELINE ERROR: ${err.message}`);
    process.exit(1);
  }
}

runMasterPipeline();
