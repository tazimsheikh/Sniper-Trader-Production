import fs from "fs";
import path from "path";

/**
 * Checks whether a folder name corresponds to a historical optimization run folder.
 * Matches:
 *  - last_optimization_run
 *  - last_optimization_run 8_15_2026
 *  - last_optimization_run_2026-08-15
 *  - Last Optimization Run - 2026-08-16
 *  - last_optimization_run - Copy
 *  - etc.
 */
export function isLastOptimizationRunDir(dirName: string): boolean {
  if (!dirName || typeof dirName !== "string") return false;
  // Case-insensitive match for "last", optional separators, "optimization", optional separators, "run"
  const pattern = /last[_\s-]*optimization[_\s-]*run/i;
  return pattern.test(dirName);
}

/**
 * Returns all active and historical optimization run directories within a base dump folder.
 * Always includes the base dump folder itself, plus all subdirectories matching "last_optimization_run"
 * (or any subdirectories that contain state_*.json / wfa_*.json files).
 */
export function getAllOptimizationRunDirs(baseDumpDir: string): string[] {
  if (!fs.existsSync(baseDumpDir)) return [];

  const runDirs: string[] = [baseDumpDir];

  try {
    const entries = fs.readdirSync(baseDumpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDirPath = path.join(baseDumpDir, entry.name);
      
      // Match directory name pattern OR check if the folder contains optimization JSON dump files
      if (isLastOptimizationRunDir(entry.name)) {
        runDirs.push(subDirPath);
      } else {
        try {
          const subFiles = fs.readdirSync(subDirPath);
          if (subFiles.some(f => f.startsWith("state_") && f.endsWith(".json"))) {
            runDirs.push(subDirPath);
          }
        } catch {
          // Ignore unreadable directory
        }
      }
    }
  } catch (err: any) {
    console.warn(`[DumpScanner] Error scanning ${baseDumpDir}: ${err.message}`);
  }

  return runDirs;
}

/**
 * Returns all state_*.json file paths across the base dump directory and all Last Optimization Run folders.
 */
export function getAllStateFiles(baseDumpDir: string): string[] {
  const dirs = getAllOptimizationRunDirs(baseDumpDir);
  const stateFiles: string[] = [];

  for (const d of dirs) {
    try {
      const files = fs.readdirSync(d)
        .filter(f => f.startsWith("state_") && f.endsWith(".json"))
        .map(f => path.join(d, f));
      stateFiles.push(...files);
    } catch {
      // Ignore unreadable directory
    }
  }

  return stateFiles;
}

/**
 * Returns all wfa_*.json file paths across the base dump directory and all Last Optimization Run folders.
 */
export function getAllWfaFiles(baseDumpDir: string): string[] {
  const dirs = getAllOptimizationRunDirs(baseDumpDir);
  const wfaFiles: string[] = [];

  for (const d of dirs) {
    try {
      const files = fs.readdirSync(d)
        .filter(f => f.startsWith("wfa_") && f.endsWith(".json"))
        .map(f => path.join(d, f));
      wfaFiles.push(...files);
    } catch {
      // Ignore unreadable directory
    }
  }

  return wfaFiles;
}

/**
 * Finds a state dump file for a specific symbol/pair across:
 * 1. Base dump directory
 * 2. All last_optimization_run* subdirectories
 * 3. Permanent DNA bank (dna_bank/state_*.json or dna_bank/dna_*.json)
 */
export function findStateFileForPair(baseDumpDir: string, pair: string): string | null {
  const symbolVariants = [pair, `${pair}.Daily`, pair.replace(".Daily", "")];
  const dirs = getAllOptimizationRunDirs(baseDumpDir);
  
  // Also check dna_bank if present
  const dnaDir = path.join(path.dirname(baseDumpDir), "dna_bank");
  if (fs.existsSync(dnaDir)) dirs.push(dnaDir);

  for (const d of dirs) {
    for (const sym of symbolVariants) {
      const p1 = path.join(d, `state_${sym}.json`);
      if (fs.existsSync(p1)) return p1;
      const p2 = path.join(d, `wfa_${sym}.json`);
      if (fs.existsSync(p2)) return p2;
    }
  }

  return null;
}

/**
 * Scans permanent DNA bank AND all Last Optimization Run folders to load and curate
 * historical champion alphas for seeding the Walk-Forward Genetic Optimizer.
 */
export function loadHistoricalAlphasForSymbol(
  botType: "Mage" | "Sage",
  symbol: string,
  minSlFloor: number = 0
): any[] {
  const baseDir = path.join(
    process.cwd(),
    "server",
    "trading",
    "optimizer",
    botType.toLowerCase(),
    `${botType.toLowerCase()}_optimizer_dump`
  );
  const dnaDir = path.join(process.cwd(), "server", "trading", "optimizer", botType.toLowerCase(), "dna_bank");
  
  const filesToRead: string[] = [];

  // 1. Permanent DNA bank file
  const dnaPrefix = botType === "Mage" ? "mage_dna_" : "sage_dna_";
  const dnaFile = path.join(dnaDir, `${dnaPrefix}${symbol}.json`);
  if (fs.existsSync(dnaFile)) filesToRead.push(dnaFile);

  // 2. State files from base dump dir and all last_optimization_run* folders
  const allRunDirs = getAllOptimizationRunDirs(baseDir);
  const symbolVariants = [symbol, `${symbol}.Daily`, symbol.replace(".Daily", "")];
  for (const d of allRunDirs) {
    for (const sym of symbolVariants) {
      const stateFile = path.join(d, `state_${sym}.json`);
      if (fs.existsSync(stateFile) && !filesToRead.includes(stateFile)) {
        filesToRead.push(stateFile);
      }
    }
  }

  const collectedAlphas: any[] = [];

  for (const file of filesToRead) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      let items: any[] = [];
      if (Array.isArray(raw)) items = raw;
      else if (raw && Array.isArray(raw.validAlphas)) items = raw.validAlphas;

      for (const a of items) {
        if (!a || typeof a !== "object") continue;
        const setup = a.setup || a.params || a.signature;
        if (typeof setup !== "string") continue;
        
        // Filter broken setups (e.g. legacy 999 sentinel values)
        if (setup.includes("Trig999") || setup.includes("Step999")) continue;
        
        // Filter SL floor
        const minSlMatch = setup.match(/MinSL([\d\.]+)/i);
        if (minSlMatch) {
          const minSlVal = parseFloat(minSlMatch[1]);
          if (minSlVal < minSlFloor) continue;
        }

        collectedAlphas.push({
          ...a,
          setup,
        });
      }
    } catch {
      // Ignore corrupt or unreadable files
    }
  }

  // Deduplicate by setup
  const uniqueMap = new Map<string, any>();
  for (const a of collectedAlphas) {
    if (!uniqueMap.has(a.setup)) {
      uniqueMap.set(a.setup, a);
    }
  }
  const uniqueAlphas = Array.from(uniqueMap.values());

  // Sort by IS Calmar ratio (or Total Net R / Max DD) — NOT OOS NetR — to eliminate look-ahead bias
  uniqueAlphas.sort((a, b) => {
    const isNetA = typeof a.isNetR === "number" ? a.isNetR : (a.totalNetR || 0);
    const isNetB = typeof b.isNetR === "number" ? b.isNetR : (b.totalNetR || 0);
    const maxDdA = typeof a.isMaxDd === "number" ? a.isMaxDd : (a.maxDd || 1);
    const maxDdB = typeof b.isMaxDd === "number" ? b.isMaxDd : (b.maxDd || 1);
    const calmarA = isNetA / Math.max(0.1, maxDdA);
    const calmarB = isNetB / Math.max(0.1, maxDdB);
    return calmarB - calmarA;
  });

  return uniqueAlphas;
}
