import * as fs from "fs";
import * as path from "path";

const args = process.argv.slice(2);
let categoryTarget =
  "The Ultimate Trifecta (Recent Momentum + Low DD + Net Profit)";
let rankTarget = 1;

for (let idx = 0; idx < args.length; idx++) {
  const arg = args[idx];
  if (arg.startsWith("--category=")) {
    categoryTarget = arg.split("=")[1].replace(/^["']|["']$/g, "");
  } else if (arg === "--category" && idx + 1 < args.length) {
    categoryTarget = args[++idx].replace(/^["']|["']$/g, "");
  } else if (arg.startsWith("--rank=")) {
    rankTarget = parseInt(arg.split("=")[1], 10);
  } else if (arg === "--rank" && idx + 1 < args.length) {
    rankTarget = parseInt(args[++idx], 10);
  }
}

console.log(
  `\n💉 [Seer Grandmaster Injector] Initializing Safe Injection Protocol`,
);
console.log(`   🏆 Archetype Category : "${categoryTarget}"`);
console.log(`   🏅 Target Rank        : ${rankTarget}\n`);

const SEER_MD_PATH = path.join(
  process.cwd(),
  "server",
  "trading",
  "optimizer",
  "seer_monte_carlo_portfolios.md",
);
const PAIR_CONFIG_PATH = path.join(
  process.cwd(),
  "server",
  "trading",
  "config",
  "PairConfig.ts",
);

if (!fs.existsSync(PAIR_CONFIG_PATH)) {
  console.error("❌ CRITICAL: PairConfig.ts not found!");
  process.exit(1);
}

if (!fs.existsSync(SEER_MD_PATH)) {
  console.error(
    `❌ CRITICAL: seer_monte_carlo_portfolios.md not found at ${SEER_MD_PATH}`,
  );
  process.exit(1);
}

const pairConfigContent = fs.readFileSync(PAIR_CONFIG_PATH, "utf8");

function extractBaseProperties(pair: string) {
  const blockRegex = new RegExp(`'${pair}'[\\s\\S]*?:\\s*{([^}]*)}`);
  const match = pairConfigContent.match(blockRegex);

  if (!match) return null;

  const block = match[1];
  const extractNum = (key: string) => {
    const r = new RegExp(`"${key}"\\s*:\\s*([\\d.]+)`, "i");
    const m =
      block.match(r) ||
      block.match(new RegExp(`${key}\\s*:\\s*([\\d.]+)`, "i"));
    return m ? parseFloat(m[1]) : null;
  };

  return {
    tickSize: extractNum("tickSize"),
    pipSize: extractNum("pipSize"),
    spread: extractNum("spread"),
  };
}

function parseSeerMarkdown(
  filePath: string,
  categoryName: string,
  targetRank: number = 1,
) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  let inCategory = false;
  let inRankList = false;
  let currentRank = 0;

  const seerConfigs: { pair: string; setup: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("# 🏆 ")) {
      if (line.toLowerCase().includes(categoryName.toLowerCase())) {
        inCategory = true;
      } else if (inCategory) {
        break;
      }
    }

    if (inCategory) {
      if (line.startsWith("## Rank #")) {
        currentRank = parseInt(line.replace("## Rank #", "").trim(), 10);
      }

      if (currentRank === targetRank && line.includes("**Component Pairs (")) {
        inRankList = true;
        continue;
      }

      if (inRankList) {
        if (
          line.trim() === "" ||
          line.startsWith("#") ||
          line.startsWith("---")
        ) {
          if (seerConfigs.length > 0) {
            break;
          }
        }

        // Parse:   - **XAUUSD**: Seer=`Seer_Body20_Wick1.5_MinTP40_DefTP100_MaxSL100` (80.50 R)
        const match = line.match(/\s*-\s*\*\*(.*?)\*\*:\s*Seer=`([^`]+)`/);
        if (match) {
          const pairRaw = match[1];
          const setup = match[2];
          seerConfigs.push({ pair: pairRaw, setup: setup });
        }
      }
    }
  }

  return seerConfigs;
}

const seerConfigs = parseSeerMarkdown(SEER_MD_PATH, categoryTarget, rankTarget);

if (seerConfigs.length === 0) {
  console.error(
    `❌ ERROR: Could not find Seer configurations for Category="${categoryTarget}" at Rank=${rankTarget}.`,
  );
  process.exit(1);
}

console.log(
  `✅ Found a Seer Portfolio with ${seerConfigs.length} component pairs! Generating code block...`,
);

function parseSetupString(pair: string, setupStr: string, baseProps: any) {
  // Format: Seer_Body20_Wick1.5_MinTP40_DefTP100_MaxSL100
  const parts = setupStr.split("_");

  let i = 1; // Skip "Seer"
  const body = parseInt(parts[i++].replace("Body", ""), 10);
  const wick = parseFloat(parts[i++].replace("Wick", ""));
  const minTp = parseInt(parts[i++].replace("MinTP", ""), 10);
  const defTp = parseInt(parts[i++].replace("DefTP", ""), 10);
  const maxSl = parseInt(parts[i++].replace("MaxSL", ""), 10);

  let output = `  '${pair}': {\n`;
  if (baseProps.tickSize !== null)
    output += `    "tickSize": ${baseProps.tickSize},\n`;
  if (baseProps.pipSize !== null)
    output += `    "pipSize": ${baseProps.pipSize},\n`;
  if (baseProps.spread !== null)
    output += `    "spread": ${baseProps.spread},\n`;

  // Always use NY_Forex for Seer legacy parity
  output += `    "session": 'NY_Forex',\n`;
  output += `    "minSlDist": ${pair.includes("XAU") || pair.includes("NAS") ? 40 : 20},\n`;
  output += `    maxSlDist: ${maxSl},\n`;
  output += `    trailingSlTrigger: 1.5,\n`;
  output += `    trailingSlStep: 1.0,\n`;
  output += `    minBodyPips: ${body},\n`;
  output += `    pinBarWickBodyRatio: ${wick},\n`;
  output += `    minTpDist: ${minTp},\n`;
  output += `    defaultTpDist: ${defTp},\n`;
  output += `    forceCloseHours: 23,\n`;

  if (pair.includes("NAS")) {
    output += `    orbStartHour: 9,\n`;
    output += `    cutoffHour: 11,\n`;
  } else if (pair.includes("XAU")) {
    output += `    delayStartMinutes: 30,\n`;
    output += `    cutoffHour: 10,\n`;
  }

  output += `  }`;
  return output;
}

function generateObjectBlock(configList: { pair: string; setup: string }[]) {
  let block = `{\n`;
  for (let k = 0; k < configList.length; k++) {
    const pair = configList[k].pair;
    const setupStr = configList[k].setup;

    // Determine base props
    let baseProps: any =
      extractBaseProperties(pair) ||
      extractBaseProperties(pair + "_NY_Forex") ||
      extractBaseProperties(pair + "_london") ||
      extractBaseProperties(pair + "_asia");
    if (!baseProps) baseProps = { tickSize: null, pipSize: null, spread: null };

    if (baseProps.tickSize === null) {
      if (pair.includes("JPY")) baseProps.tickSize = 0.001;
      else if (
        pair.includes("XAU") ||
        pair.includes("BTC") ||
        pair.includes("NAS")
      )
        baseProps.tickSize = 0.1;
      else baseProps.tickSize = 0.00001;
    }
    if (baseProps.pipSize === null) {
      if (pair.includes("JPY")) baseProps.pipSize = 0.01;
      else if (pair.includes("XAU")) baseProps.pipSize = 0.1;
      else if (pair.includes("BTC") || pair.includes("NAS"))
        baseProps.pipSize = 1.0;
      else baseProps.pipSize = 0.0001;
    }
    if (baseProps.spread === null) {
      if (pair.includes("XAU")) baseProps.spread = 1.0;
      else baseProps.spread = 2.0;
    }

    block += parseSetupString(pair, setupStr, baseProps);
    if (k < configList.length - 1) block += ",\n";
    else block += "\n";
  }
  block += `}`;
  return block;
}

const seerReplacementString =
  `export const SEER_PAIR_CONFIG: Record<string, PairConfig> = ` +
  generateObjectBlock(seerConfigs) +
  `;`;

// Safely inject into PairConfig.ts
let finalContent = pairConfigContent;

const seerStartIdx = finalContent.indexOf("export const SEER_PAIR_CONFIG");
if (seerStartIdx !== -1) {
  const nextExportIdx = finalContent.indexOf(
    "export const ",
    seerStartIdx + 10,
  );
  const beforeSeer = finalContent.substring(0, seerStartIdx);
  const afterSeer =
    nextExportIdx !== -1 ? finalContent.substring(nextExportIdx) : "";

  finalContent =
    beforeSeer +
    seerReplacementString +
    "\n\n// Default fallback configuration for legacy orchestrators\n" +
    afterSeer.replace(
      /\/\/ Default fallback configuration for legacy orchestrators\n/,
      "",
    );
} else {
  console.error("Could not find SEER_PAIR_CONFIG block in PairConfig.ts");
  process.exit(1);
}

// Create Backup
const backupPath = PAIR_CONFIG_PATH + ".seer.bak";
fs.writeFileSync(backupPath, pairConfigContent, "utf8");
console.log(`📦 Backup created safely at ${backupPath}`);

fs.writeFileSync(PAIR_CONFIG_PATH, finalContent, "utf8");

console.log(
  `🚀 INJECTION COMPLETE! PairConfig.ts has been updated with Seer ${categoryTarget} (Rank ${rankTarget}) configurations.`,
);
