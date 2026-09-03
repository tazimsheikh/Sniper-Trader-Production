import * as fs from "fs";
import * as path from "path";
import paramsToConfig from "../grandmaster/utils/seer_params_parser.js";
import { PairConfig } from "../../config/PairConfig.js";

const PORTFOLIO_JSON_PATH = path.join(
  process.cwd(),
  "server",
  "trading",
  "optimizer",
  "grandmaster",
  "grandmaster_portfolio.json"
);

const PAIR_CONFIG_PATH = path.join(
  process.cwd(),
  "server",
  "trading",
  "config",
  "PairConfig.ts"
);

if (!fs.existsSync(PAIR_CONFIG_PATH)) {
  console.error("❌ CRITICAL: PairConfig.ts not found!");
  process.exit(1);
}

if (!fs.existsSync(PORTFOLIO_JSON_PATH)) {
  console.error(`❌ CRITICAL: seer_grandmaster_portfolio.json not found at ${PORTFOLIO_JSON_PATH}`);
  process.exit(1);
}

console.log(`\n💉 [Seer Grandmaster Injector] Initializing Safe Injection Protocol...`);
const portfolioData: Array<{
  symbol: string;
  botType: string;
  setup: string;
  totalTotalR: number;
  threeYearTrades: number;
  threeYearWinRate: number;
  profitFactor: number;
  monteCarloDrawdown99: number;
  riskPct: number;
}> = JSON.parse(fs.readFileSync(PORTFOLIO_JSON_PATH, "utf8"));

console.log(`Loaded ${portfolioData.length} configurations from SEER Grandmaster Portfolio.`);

const groupedConfigs: Record<string, PairConfig[]> = {};

for (const item of portfolioData) {
  if (item.botType && item.botType !== "Seer") continue;
  const symbol = item.symbol;
  const baseConfig = paramsToConfig(item.setup, item.symbol);
  
  const finalConfig: PairConfig = {
    ...baseConfig,
    riskPct: item.riskPct
  };

  if (!groupedConfigs[symbol]) {
    groupedConfigs[symbol] = [];
  }
  groupedConfigs[symbol].push(finalConfig);
}

const symbols = Object.keys(groupedConfigs).sort();
console.log(`Grouped into ${symbols.length} distinct symbols: ${symbols.join(", ")}`);

// Format into TypeScript code string
let seerBlock = `// ============================================================\n`;
seerBlock += `// SEER OPTIMIZED CONFIGURATIONS\n`;
seerBlock += `// ============================================================\n`;
seerBlock += `export const SEER_PAIR_CONFIG: Record<string, PairConfig[]> = {\n`;

for (let i = 0; i < symbols.length; i++) {
  const sym = symbols[i];
  const configs = groupedConfigs[sym];
  seerBlock += `  "${sym}": [\n`;
  for (let j = 0; j < configs.length; j++) {
    const jsonStr = JSON.stringify(configs[j], null, 4);
    const indented = jsonStr.split("\n").map((line) => `    ${line}`).join("\n");
    seerBlock += indented;
    if (j < configs.length - 1) seerBlock += `,\n`;
    else seerBlock += `\n`;
  }
  seerBlock += `  ]`;
  if (i < symbols.length - 1) seerBlock += `,\n`;
  else seerBlock += `\n`;
}

seerBlock += `};\n`;

// Safely replace in PairConfig.ts
const originalContent = fs.readFileSync(PAIR_CONFIG_PATH, "utf8");

const seerAnchor = "export const SEER_PAIR_CONFIG";
const anchorIdx = originalContent.indexOf(seerAnchor);

if (anchorIdx === -1) {
  console.error("❌ CRITICAL: Could not find SEER_PAIR_CONFIG in PairConfig.ts!");
  process.exit(1);
}

// Find preceding separator comment and header if any
const marker = "// SEER OPTIMIZED CONFIGURATIONS";
let replaceStart = originalContent.lastIndexOf(marker, anchorIdx);
if (replaceStart !== -1) {
  const sep = "// ============================================================";
  const sepIdx = originalContent.lastIndexOf(sep, replaceStart);
  if (sepIdx !== -1 && (replaceStart - sepIdx < 80)) {
    replaceStart = sepIdx;
  }
} else {
  replaceStart = anchorIdx;
}

const beforeSeer = originalContent.substring(0, replaceStart);

// Create Backup
const backupPath = PAIR_CONFIG_PATH + ".seer.bak";
fs.writeFileSync(backupPath, originalContent, "utf8");
console.log(`📦 Backup created safely at ${backupPath}`);

const finalContent = beforeSeer + seerBlock;
fs.writeFileSync(PAIR_CONFIG_PATH, finalContent, "utf8");

console.log(`\n🎉 SUCCESS: PairConfig.ts updated with ${symbols.length} SEER Grandmaster symbol configurations!`);

