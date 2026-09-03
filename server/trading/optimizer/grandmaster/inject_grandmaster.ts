import * as fs from "fs";
import * as path from "path";

// Parse command line arguments
const args = process.argv.slice(2);
let categoryTarget = "The Holy Grail (Maximum Optimization)"; // Default shared target
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

console.log(`\n💉 [Grandmaster Injector] Initializing Safe Injection Protocol`);
console.log(`   🏆 Archetype Category : "${categoryTarget}"`);
console.log(`   🏅 Target Rank        : ${rankTarget}\n`);

const GRANDMASTER_MD_PATH = path.join(
  process.cwd(),
  "server",
  "trading",
  "optimizer",
  "grandmaster",
  "grandmaster_holy_grail.md",
);

// Resolve SAGE dump dir the same way the synthesizer does:
// prefer last_optimization_run/ subdirectory if it exists, otherwise use root.
const SAGE_DUMP_DIR_BASE = path.join(process.cwd(), "server", "trading", "optimizer", "sage", "sage_optimizer_dump");
const SAGE_DUMP_DIR = fs.existsSync(path.join(SAGE_DUMP_DIR_BASE, "last_optimization_run"))
  ? path.join(SAGE_DUMP_DIR_BASE, "last_optimization_run")
  : SAGE_DUMP_DIR_BASE;
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

if (!fs.existsSync(GRANDMASTER_MD_PATH)) {
  console.error(
    `❌ CRITICAL: grandmaster_holy_grail_portfolios.md not found at ${GRANDMASTER_MD_PATH}`,
  );
  process.exit(1);
}

// 1. Read existing PairConfig to extract tickSize, pipSize, spread
const pairConfigContent = fs.readFileSync(PAIR_CONFIG_PATH, "utf8");

// Helper to extract existing base properties for a pair
function extractBaseProperties(pair: string) {
  const blockRegex = new RegExp(`'${pair}':\\s*{([^}]*)}`);
  const match = pairConfigContent.match(blockRegex);

  if (!match) return null;

  const block = match[1];
  const extractNum = (key: string) => {
    const r = new RegExp(`"${key}":\\s*([\\d.]+)`);
    const m = block.match(r);
    return m ? parseFloat(m[1]) : null;
  };

  return {
    tickSize: extractNum("tickSize"),
    pipSize: extractNum("pipSize"),
    spread: extractNum("spread"),
  };
}

// 2. Parse Grandmaster Markdown Helper
function parseGrandmasterMarkdown(
  filePath: string,
  categoryName: string,
  targetRank: number = 1,
) {
  const jsonPath = path.join(path.dirname(filePath), "grandmaster_portfolio.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const jsonData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      if (Array.isArray(jsonData) && jsonData.length > 0) {
        const mageConfigs: { pair: string; setup: string; riskPct?: number }[] = [];
        const sageConfigs: { pair: string; setup: string; riskPct?: number }[] = [];
        const seerConfigs: { pair: string; setup: string; riskPct?: number }[] = [];
        for (const item of jsonData) {
          if (item.botType === "Mage") mageConfigs.push({ pair: item.symbol, setup: item.setup, riskPct: item.riskPct });
          else if (item.botType === "Sage") sageConfigs.push({ pair: item.symbol, setup: item.setup, riskPct: item.riskPct });
          else if (item.botType === "Seer") seerConfigs.push({ pair: item.symbol, setup: item.setup, riskPct: item.riskPct });
        }
        console.log(`📦 Loaded ${jsonData.length} portfolio components directly from JSON interchange!`);
        return { mageConfigs, sageConfigs, seerConfigs };
      }
    } catch (e: any) {
      console.warn(`⚠️ JSON fallback parse error: ${e.message}, falling back to markdown...`);
    }
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  let inCategory = false;
  let inRankList = false;
  let currentRank = 0;

  const sageConfigs: { pair: string; setup: string; riskPct?: number }[] = [];
  const mageConfigs: { pair: string; setup: string; riskPct?: number }[] = [];
  const seerConfigs: { pair: string; setup: string; riskPct?: number }[] = [];

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

      if (currentRank === targetRank && (line.includes("**Component Pairs (") || line.includes("**Component Setups ("))) {
        inRankList = true;
        continue;
      }

      if (inRankList) {
        if (
          line.trim() === "" ||
          line.startsWith("#") ||
          line.startsWith("---")
        ) {
          if (sageConfigs.length > 0 || mageConfigs.length > 0 || seerConfigs.length > 0) {
            break;
          }
        }

        const matchSingle = line.match(
          /\s*-\s*\*\*(.*?)\s+\((Mage|Sage|Seer)\)\*\*:\s*Setup=`([^`]+)`(?:.*Risk\s*(?:Multiplier)?:\s*([\d.]+)[x%]?)?/
        );
        if (matchSingle) {
          const pairRaw = matchSingle[1];
          const botType = matchSingle[2];
          const setup = matchSingle[3];
          const riskRaw = matchSingle[4];
          const riskPct = riskRaw ? parseFloat(riskRaw) : undefined;
          if (botType === "Mage") {
            if (!mageConfigs.some((c) => c.pair === pairRaw)) {
              mageConfigs.push({ pair: pairRaw, setup, riskPct });
            }
          } else if (botType === "Sage") {
            if (!sageConfigs.some((c) => c.pair === pairRaw)) {
              sageConfigs.push({ pair: pairRaw, setup, riskPct });
            }
          } else if (botType === "Seer") {
            if (!seerConfigs.some((c) => c.pair === pairRaw)) {
              seerConfigs.push({ pair: pairRaw, setup, riskPct });
            }
          }
        } else {
          // Fallback for legacy paired format
          const matchLegacy = line.match(
            /\s*-\s*\*\*(.*?)\*\*:\s*Mage=`([^`]+)`\s*\|\s*Sage=`([^`]+)`/
          );
          if (matchLegacy) {
            const pairRaw = matchLegacy[1];
            mageConfigs.push({ pair: pairRaw, setup: matchLegacy[2], riskPct: undefined });
            sageConfigs.push({ pair: pairRaw, setup: matchLegacy[3], riskPct: undefined });
          }
        }
      }
    }
  }

  return { mageConfigs, sageConfigs, seerConfigs };
}

// 3. Build Configuration Strings
function getDefaultMinBodyPips(pair: string): number {
  if (pair.includes("BTC")) return 15.0;
  if (pair.includes("ETH")) return 5.0;
  if (pair.includes("XAU") || pair.includes("GOLD")) return 20.0;
  if (pair.includes("NAS") || pair.includes("US30") || pair.includes("GER40"))
    return 20.0;
  if (pair.includes("XTI")) return 2.0;
  if (
    pair.includes("JPY") ||
    pair.includes("AUD") ||
    pair.includes("NZD") ||
    pair.includes("CAD")
  )
    return 5.0;
  return 3.0;
}

export function parseSetupString(
  pair: string,
  setupStr: string,
  isSage: boolean,
  baseProps: any,
) {
  const parts = setupStr.split("_");

  let sessionRaw = parts[0];
  let i = 1;
  if (parts[1] === "Forex" || parts[1] === "Indices") {
    sessionRaw = parts[0] + "_" + parts[1];
    i = 2;
  }

  let sessionName = sessionRaw;
  if (sessionRaw === "NY_Forex") sessionName = "NY_Forex";
  else if (sessionRaw === "NY_Indices") sessionName = "NY_Indices";
  else if (sessionRaw === "london") sessionName = "london";
  else if (sessionRaw === "asia") sessionName = "asia";

  const pairKey = pair;
  const pctStr = parts[i++]; // "0%"
  const pct = parseInt(pctStr.replace("%", ""), 10);

  const minSlStr = parts[i++]; // "MinSL30"
  const minSl = parseInt(minSlStr.replace("MinSL", ""), 10);

  const maxSlStr = parts[i++]; // "MaxSL40"
  const maxSl = parseInt(maxSlStr.replace("MaxSL", ""), 10);

  let output = `  '${pairKey}': {\n`;
  if (baseProps.tickSize !== null)
    output += `    "tickSize": ${baseProps.tickSize},\n`;
  if (baseProps.pipSize !== null)
    output += `    "pipSize": ${baseProps.pipSize},\n`;
  if (baseProps.spread !== null)
    output += `    "spread": ${baseProps.spread},\n`;

  if (isSage) {
    const sweepStr = parts[i++];
    const sweep = parseInt(sweepStr.replace("Sweep", ""), 10);

    const maxSwpStr = parts[i++];
    const maxSwp = maxSwpStr.startsWith("MaxSwp") ? parseInt(maxSwpStr.replace("MaxSwp", ""), 10) : 3;
    
    let reqClsStr = maxSwpStr.startsWith("MaxSwp") ? parts[i++] : maxSwpStr;
    const reqCls = reqClsStr.startsWith("ReqCls") ? reqClsStr.replace("ReqCls", "") === "true" : false;

    const exitStr = reqClsStr.startsWith("ReqCls") ? parts[i++] : reqClsStr;
    let exitModeStr = exitStr.replace("Exit", "");
    if (parts[i] && !parts[i].startsWith("Trig")) {
      exitModeStr += "_" + parts[i];
      i++;
    }

    const trigStr = parts[i++];
    const stepStr = parts[i++];
    const fcStr = parts[i++];
    const startHStr = parts[i++];
    const startMStr = parts[i++];
    const orbMinsStr = parts[i++];
    const actMinsStr = parts[i++];

    const trig = parseFloat(trigStr.replace("Trig", ""));
    const step = parseFloat(stepStr.replace("Step", ""));
    const fc = parseInt(fcStr.replace("FC", ""), 10);
    const startH = parseInt(startHStr.replace("StartH", ""), 10);
    const startM = parseInt(startMStr.replace("StartM", ""), 10);
    const orbMins = parseInt(orbMinsStr.replace("OrbMins", ""), 10);
    const actMins = actMinsStr ? parseInt(actMinsStr.replace("ActMins", ""), 10) : 5;

    const maxBodyPart = parts.find((p) => p.startsWith("MaxBody"));
    const maxBody =
      maxBodyPart &&
      maxBodyPart !== "MaxBodyNone" &&
      maxBodyPart !== "MaxBodyundefined"
        ? parseInt(maxBodyPart.replace("MaxBody", ""), 10)
        : undefined;

    const htfPart = parts.find((p) => p.startsWith("Htf"));
    const htfReq = htfPart ? htfPart.replace("Htf", "") === "true" : undefined;

    output += `      "session": "${sessionName}",\n`;
    output += `      "orbEnabled": true,\n`;
    output += `      "orbStartHour": ${startH},\n`;
    output += `      "orbStartMin": ${startM},\n`;
    output += `      "orbMinutes": ${orbMins},\n`;
    output += `      "actionMinutes": ${actMins},\n`;
    output += `      "minSlDist": ${minSl},\n`;
    output += `      "maxSlDist": ${maxSl},\n`;
    output += `      "entryPenetrationPct": ${pct},\n`;
    output += `      "sweepPips": ${sweep},\n`;
    output += `      "maxSweepMultiplier": ${maxSwp},\n`;
    output += `      "requireCloseInside": ${reqCls},\n`;
    if (maxBody !== undefined) {
      output += `      "maxBodyPips": ${maxBody},\n`;
    }
    if (htfReq !== undefined && htfReq) {
      output += `      "htfAlignmentRequired": true,\n`;
    }
    output += `      "exitMode": "${exitModeStr}",\n`;
    output += `      "trailingSlTrigger": ${trig},\n`;
    output += `      "trailingSlStep": ${step},\n`;
    output += `      "forceCloseHours": ${fc},\n`;
    output += `      "maxOrbToAdrRatio": 0.65,\n`;
    output += `      "rvrThresholds": { "lowCompression": 0.80, "goldenZoneMin": 1.25, "goldenZoneMax": 1.50 }\n`;
  } else {
    const bodyStr = parts[i++];
    const body = parseInt(bodyStr.replace("Body", ""), 10);

    const trigStr = parts[i++];
    const stepStr = parts[i++];
    const fcStr = parts[i++];
    const startHStr = parts[i++];
    const startMStr = parts[i++];
    const orbMinsStr = parts[i++];
    const actMinsStr = parts[i++];

    const exitStr = parts[i++];
    let exitModeStr = exitStr ? exitStr.replace("Exit", "") : "TRAILING";
    if (parts[i]) {
      exitModeStr += "_" + parts[i];
      i++;
    }

    const trig = parseFloat(trigStr.replace("Trig", ""));
    const step = parseFloat(stepStr.replace("Step", ""));
    const fc = parseInt(fcStr.replace("FC", ""), 10);
    const startH = parseInt(startHStr.replace("StartH", ""), 10);
    const startM = parseInt(startMStr.replace("StartM", ""), 10);
    const orbMins = parseInt(orbMinsStr.replace("OrbMins", ""), 10);
    const actMins = actMinsStr ? parseInt(actMinsStr.replace("ActMins", ""), 10) : 5;

    output += `      "session": "${sessionName}",\n`;
    output += `      "orbEnabled": true,\n`;
    output += `      "orbStartHour": ${startH},\n`;
    output += `      "orbStartMin": ${startM},\n`;
    output += `      "orbMinutes": ${orbMins},\n`;
    output += `      "actionMinutes": ${actMins},\n`;
    output += `      "minSlDist": ${minSl},\n`;
    output += `      "maxSlDist": ${maxSl},\n`;
    output += `      "minBodyPips": ${body},\n`;
    output += `      "orbPullbackPct": ${pct / 100},\n`;
    output += `      "exitMode": "${exitModeStr}",\n`;
    output += `      "trailingSlTrigger": ${trig},\n`;
    output += `      "trailingSlStep": ${step},\n`;
    output += `      "forceCloseHours": ${fc},\n`;
    output += `      "maxOrbToAdrRatio": 0.65,\n`;
    output += `      "rvrThresholds": { "lowCompression": 0.80, "goldenZoneMin": 1.25, "goldenZoneMax": 1.50 }\n`;
  }

  output += `  }`;
  return output;
}

// 4. Generate Replacement Blocks
const { mageConfigs, sageConfigs, seerConfigs } = parseGrandmasterMarkdown(
  GRANDMASTER_MD_PATH,
  categoryTarget,
  rankTarget,
);

if (mageConfigs.length === 0 && sageConfigs.length === 0 && seerConfigs.length === 0) {
  console.error(
    `❌ ERROR: Could not find Grandmaster algorithms for Category="${categoryTarget}" at Rank=${rankTarget}.`,
  );
  process.exit(1);
}

  console.log(
    `✅ Found a Holy Grail Portfolio with ${mageConfigs.length + sageConfigs.length + seerConfigs.length} component pairs! Generating code blocks...`,
  );

import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";

function parseSetupStringBody(
  pair: string,
  setupString: string,
  isSage: boolean,
  isSeer: boolean,
  baseProps: any,
): { key: string; body: string } {
  if (isSeer) {
    let output = `{\n`;
    if (baseProps.tickSize !== null) output += `    "tickSize": ${baseProps.tickSize},\n`;
    if (baseProps.pipSize !== null) output += `    "pipSize": ${baseProps.pipSize},\n`;
    if (baseProps.spread !== null) output += `    "spread": ${baseProps.spread},\n`;

    const getNum = (label: string) => {
      const match = setupString.match(new RegExp(`${label}=([\\d\\.]+)`));
      return match ? parseFloat(match[1]) : 0;
    };
    const getStr = (label: string) => {
      const match = setupString.match(new RegExp(`${label}=([^=]+)(?:_|$)`));
      if (match) {
        if (label === 'session') {
            const sessMatch = setupString.match(/session=(.+)$/);
            return sessMatch ? sessMatch[1] : match[1];
        }
        return match[1].split("_")[0];
      }
      return "london";
    };

    const minBodyPips = getNum("minBodyPips");
    const pinBarWickBodyRatio = getNum("wickRatio");
    const minTpDist = getNum("minTpDist");
    const defaultTpDist = getNum("defaultTpDist");
    const maxSlDist = getNum("maxSlDist");
    const trailingSlTrigger = getNum("trailingTrig");
    const trailingSlStep = getNum("trailingStep");
    const forceCloseHours = getNum("forceClose");
    let maxBodyPips: number | undefined = getNum("maxBodyPips");
    if (!setupString.includes("maxBodyPips=") || isNaN(maxBodyPips) || maxBodyPips === 0) maxBodyPips = undefined;
    const sessionName = getStr("session");

    output += `      "session": "${sessionName}",\n`;
    output += `      "sessions": ["${sessionName}"],\n`;
    output += `      "minBodyPips": ${minBodyPips},\n`;
    output += `      "pinBarWickBodyRatio": ${pinBarWickBodyRatio},\n`;
    output += `      "minTpDist": ${minTpDist},\n`;
    output += `      "defaultTpDist": ${defaultTpDist},\n`;
    output += `      "maxSlDist": ${maxSlDist},\n`;
    if (trailingSlTrigger > 0) output += `      "trailingSlTrigger": ${trailingSlTrigger},\n`;
    if (trailingSlStep > 0) output += `      "trailingSlStep": ${trailingSlStep},\n`;
    output += `      "forceCloseHours": ${forceCloseHours}`;
    if (maxBodyPips !== undefined) output += `,\n      "maxBodyPips": ${maxBodyPips}`;
    
    if ((baseProps as any).riskPct !== undefined) {
      output += `,\n      "riskPct": ${(baseProps as any).riskPct}\n`;
    } else {
      output += `\n`;
    }
    
    output += `    }`;
    return { key: pair, body: output };
  }

  let rawMaxBody: number | undefined = undefined;
  let rawEntryPenetration: number | undefined = undefined;
  let rawMinWick: number | undefined = undefined;
  let rawHtfAlign: boolean | undefined = undefined;

  if (isSage) {
    try {
      let dumpPath = path.join(SAGE_DUMP_DIR_BASE, `state_${pair}.json`);
      if (!fs.existsSync(dumpPath)) dumpPath = path.join(SAGE_DUMP_DIR_BASE, `state_${pair}.Daily.json`);
      if (!fs.existsSync(dumpPath)) dumpPath = path.join(process.cwd(), "server", "trading", "optimizer", "sage", "dna_bank", `state_${pair}.json`);
      if (!fs.existsSync(dumpPath)) dumpPath = path.join(process.cwd(), "server", "trading", "optimizer", "sage", "dna_bank", `state_${pair}.Daily.json`);
      if (!fs.existsSync(dumpPath)) dumpPath = path.join(SAGE_DUMP_DIR_BASE, `wfa_${pair}.json`);
      if (!fs.existsSync(dumpPath)) dumpPath = path.join(SAGE_DUMP_DIR_BASE, `wfa_${pair}.Daily.json`);
      if (fs.existsSync(dumpPath)) {
        const rawData = fs.readFileSync(dumpPath, "utf8");
        const jsonList = JSON.parse(rawData);
        const match = jsonList.find((item: any) => item.setup === setupString);
        if (match) {
          if (match.config) {
            rawMaxBody = match.config.maxBodyPips;
            rawEntryPenetration = match.config.entryPenetrationPct;
            rawHtfAlign = match.config.htfAlignmentRequired;
            const fieldsFound = [
              rawMaxBody !== undefined ? `maxBodyPips=${rawMaxBody}` : null,
              rawHtfAlign !== undefined ? `htfAlign=${rawHtfAlign}` : null,
            ].filter(Boolean).join(", ");
            if (fieldsFound) console.log(`   [SAGE CONFIG] ${pair}: loaded extra dump fields (${fieldsFound})`);
          }
        }
      }
    } catch (e: any) {
      console.warn(`   ⚠️ Could not read sage dump for ${pair}: ${e.message}`);
    }
  }

  const parts = setupString.split("_");
  
  let sessionName = parts[0];
  if (["NY", "Indices", "Forex"].includes(sessionName) && (parts[1] === "Forex" || parts[1] === "Indices")) {
    sessionName += "_" + parts[1];
  }
  
  const findNum = (prefix: string, isSuffix = false): number | undefined => {
    const p = isSuffix 
      ? parts.find((item) => item.endsWith(prefix))
      : parts.find((item) => item.startsWith(prefix));
    if (!p) return undefined;
    const raw = isSuffix ? p.slice(0, -prefix.length) : p.slice(prefix.length);
    const num = parseFloat(raw);
    return isNaN(num) ? undefined : num;
  };

  const findStr = (prefix: string): string | undefined => {
    const p = parts.find((item) => item.startsWith(prefix));
    return p ? p.slice(prefix.length) : undefined;
  };

  const parsedPct = findNum("%", true) ?? 0;
  const minSl = findNum("MinSL") ?? 10;
  const maxSl = findNum("MaxSL") ?? 100;

  let output = `{\n`;
  if (baseProps.tickSize !== null)
    output += `    "tickSize": ${baseProps.tickSize},\n`;
  if (baseProps.pipSize !== null)
    output += `    "pipSize": ${baseProps.pipSize},\n`;
  if (baseProps.spread !== null)
    output += `    "spread": ${baseProps.spread},\n`;

  if (isSage) {
    const sweep = findNum("Sweep") ?? 0;
    const maxSwp = findNum("MaxSwp") ?? 3;
    const reqCls = findStr("ReqCls") === "true";
    let exitModeStr = findStr("Exit") ?? "TRAILING";
    const exitTokenIdx = parts.findIndex(p => p.startsWith("Exit"));
    if (exitTokenIdx >= 0 && exitTokenIdx + 1 < parts.length && parts[exitTokenIdx + 1] === "BOUNDARY") {
      exitModeStr += "_BOUNDARY";
    }
    const trig = findNum("Trig") ?? 0;
    const step = findNum("Step") ?? 0;
    const fc = findNum("FC") ?? 0;
    const startH = findNum("StartH") ?? 0;
    const startM = findNum("StartM") ?? 0;
    const orbMins = findNum("OrbMins") ?? 15;
    const actMins = findNum("ActMins");

    const maxBodyPart = parts.find((p) => p.startsWith("MaxBody"));
    const maxBody =
      maxBodyPart &&
      maxBodyPart !== "MaxBodyNone" &&
      maxBodyPart !== "MaxBodyundefined"
        ? parseFloat(maxBodyPart.replace("MaxBody", ""))
        : undefined;

    const pct = rawEntryPenetration !== undefined ? rawEntryPenetration : parsedPct;

    output += `      "session": "${sessionName}",\n`;
    output += `      "orbEnabled": true,\n`;
    output += `      "orbStartHour": ${startH},\n`;
    output += `      "orbStartMin": ${startM},\n`;
    output += `      "orbMinutes": ${orbMins},\n`;
    if (actMins !== undefined && !isNaN(actMins)) output += `      "actionMinutes": ${actMins},\n`;
    output += `      "minSlDist": ${minSl},\n`;
    output += `      "maxSlDist": ${maxSl},\n`;
    output += `      "entryPenetrationPct": ${pct},\n`;
    output += `      "sweepPips": ${sweep},\n`;
    output += `      "maxSweepMultiplier": ${maxSwp},\n`;
    output += `      "requireCloseInside": ${reqCls},\n`;
    output += `      "exitMode": "${exitModeStr}",\n`;
    output += `      "trailingSlTrigger": ${trig},\n`;
    output += `      "trailingSlStep": ${step},\n`;
    output += `      "forceCloseHours": ${fc}`;
    
    const finalMaxBody = rawMaxBody !== undefined ? rawMaxBody : maxBody;
    if (finalMaxBody !== undefined && !isNaN(finalMaxBody)) {
       output += `,\n      "maxBodyPips": ${finalMaxBody}`;
    }
    if (rawHtfAlign !== undefined) {
       output += `,\n      "htfAlignmentRequired": ${rawHtfAlign}`;
    } else {
       output += `,\n      "htfAlignmentRequired": true`;
    }

    const isCrypto = pair.includes("BTC") || pair.includes("ETH");
    const isIndex = ["US30", "NAS100", "SPX500", "GER40", "UK100", "JPN225"].some(idx => pair.includes(idx));
    const isJpyCross = pair.includes("JPY");
    const isAsiaSession = sessionName === "asia";

    let useHtfSar = true;
    if (isCrypto) useHtfSar = false;
    if (isIndex && isAsiaSession) useHtfSar = false;
    if (isJpyCross && !pair.includes("GBP")) useHtfSar = false;
    if (pair === "NZDUSD") useHtfSar = false;
    
    let reqCloseHalf = false;
    if (isIndex && !isAsiaSession) reqCloseHalf = true;
    if (pair === "USDCAD" || pair === "GBPJPY" || pair === "BTCUSD") reqCloseHalf = true;
    
    const wbr = (pair.includes("EURUSD") || (pair.includes("CHFJPY") && !isAsiaSession)) ? 1.75 : 1.5;

    output += `,\n      "maxH1EmaSlope": 20`;
    output += `,\n      "useHtfSarFilter": ${useHtfSar}`;
    output += `,\n      "requireCloseLocationHalf": ${reqCloseHalf}`;
    output += `,\n      "minWbr": ${wbr}`;
    output += `\n`;
  } else {
    const body = findNum("Body") ?? 0;
    const trig = findNum("Trig") ?? 0;
    const step = findNum("Step") ?? 0;
    const fc = findNum("FC") ?? 0;
    const startH = findNum("StartH") ?? 0;
    const startM = findNum("StartM") ?? 0;
    const orbMins = findNum("OrbMins") ?? 15;
    const actMins = findNum("ActMins");
    let exitModeStr = findStr("Exit") ?? "TRAILING";
    const exitTokenIdx = parts.findIndex(p => p.startsWith("Exit"));
    if (exitTokenIdx >= 0 && exitTokenIdx + 1 < parts.length) {
      const nextToken = parts[exitTokenIdx + 1];
      if (nextToken === "BOUNDARY" || nextToken === "AGGRESSIVE" || nextToken === "MODERATE" || nextToken === "CONSERVATIVE") {
        exitModeStr += "_" + nextToken;
      }
    }

    output += `      "session": "${sessionName}",\n`;
    output += `      "orbEnabled": true,\n`;
    output += `      "orbStartHour": ${startH},\n`;
    output += `      "orbStartMin": ${startM},\n`;
    output += `      "orbMinutes": ${orbMins},\n`;
    if (actMins !== undefined && !isNaN(actMins)) output += `      "actionMinutes": ${actMins},\n`;
    output += `      "minSlDist": ${minSl},\n`;
    output += `      "maxSlDist": ${maxSl},\n`;
    output += `      "minBodyPips": ${body},\n`;
    output += `      "orbPullbackPct": ${parsedPct / 100},\n`;
    output += `      "exitMode": "${exitModeStr}",\n`;
    output += `      "trailingSlTrigger": ${trig},\n`;
    output += `      "trailingSlStep": ${step},\n`;
    output += `      "forceCloseHours": ${fc}\n`;
  }

  if ((baseProps as any).riskPct !== undefined) {
    if (output.endsWith("\n")) {
      output = output.slice(0, -1) + ",\n";
    }
    output += `      "riskPct": ${(baseProps as any).riskPct}\n`;
  }

  output += `    }`;
  
  return { key: pair, body: output };
}

function generateObjectBlock(
  configList: { pair: string; setup: string; riskPct?: number }[],
  isSage: boolean,
  isSeer: boolean = false,
) {
  let groups: Record<string, string[]> = {};
  
  for (let k = 0; k < configList.length; k++) {
    const pair = configList[k].pair;
    const setupStr = configList[k].setup;
    const riskPct = configList[k].riskPct;

    let baseProps: any = { tickSize: null, pipSize: null, spread: null, riskPct };
    const baseSymbol = pair.replace(/\.daily$/i, "");
    const optConfig = OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[baseSymbol] || OPTIMIZER_CONFIG[baseSymbol.toUpperCase()];

    if (optConfig) {
      baseProps.tickSize = optConfig.tickSize;
      baseProps.pipSize = optConfig.pipSize;
      baseProps.spread = optConfig.spread;
    } else {
      throw new Error(`CRITICAL: No OPTIMIZER_CONFIG found for ${pair}. Cannot resolve mechanical stats.`);
    }

    const parsed = parseSetupStringBody(pair, setupStr, isSage, isSeer, baseProps);
    if (!groups[parsed.key]) groups[parsed.key] = [];
    groups[parsed.key].push(parsed.body);
  }
  
  let block = `{\n`;
  const keys = Object.keys(groups);
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const bodies = groups[key];
    block += `  '${key}': [\n    ` + bodies.join(`,\n    `) + `\n  ]`;
    if (k < keys.length - 1) block += ",\n";
    else block += "\n";
  }
  block += `}`;
  return block;
}

const sageReplacementString =
  `export const SAGE_PAIR_CONFIG: Record<string, PairConfig[]> = ` +
  generateObjectBlock(sageConfigs, true, false) +
  `;`;
const mageReplacementString =
  `export const MAGE_PAIR_CONFIG: Record<string, PairConfig[]> = ` +
  generateObjectBlock(mageConfigs, false, false) +
  `;`;
const seerReplacementString =
  `export const SEER_PAIR_CONFIG: Record<string, PairConfig[]> = ` +
  generateObjectBlock(seerConfigs, false, true) +
  `;`;

// 5. Safely inject into PairConfig.ts\n
let finalContent = pairConfigContent;

function replaceConfigObject(
  fileContent: string,
  objectName: string,
  replacementBlock: string,
): string {
  let cutIdx = fileContent.indexOf("// MAGE OPTIMIZED CONFIGURATIONS");
  if (cutIdx === -1) cutIdx = fileContent.indexOf("export const MAGE_PAIR_CONFIG");
  
  if (cutIdx !== -1) {
    // Also remove any preceding '=' line or newline
    const eqIdx = fileContent.lastIndexOf("// ============================================================", cutIdx);
    if (eqIdx !== -1 && (cutIdx - eqIdx) < 100) {
      cutIdx = eqIdx;
    }
  }
  
  const cleanTop =
    cutIdx !== -1 ? fileContent.substring(0, cutIdx) : fileContent;
  return cleanTop.trimEnd();
}

finalContent = replaceConfigObject(finalContent, "MAGE_PAIR_CONFIG", "");
finalContent += "\n// ============================================================\n";
finalContent += "// MAGE OPTIMIZED CONFIGURATIONS\n";
finalContent += "// ============================================================\n";
finalContent += mageReplacementString + "\n\n";
finalContent += "// ============================================================\n";
finalContent += "// SAGE OPTIMIZED CONFIGURATIONS\n";
finalContent += "// ============================================================\n";
finalContent += sageReplacementString + "\n\n";
finalContent += "// ============================================================\n";
finalContent += "// SEER OPTIMIZED CONFIGURATIONS\n";
finalContent += "// ============================================================\n";
finalContent += seerReplacementString + "\n\n";

// ── Pre-Write Structural Integrity Validator ──────────────────
function validateFinalContent(content: string): void {
  const REQUIRED = [
    { label: "PairConfigManager class",           marker: "export class PairConfigManager" },
    { label: "MAGE_PAIR_CONFIG export",           marker: "export const MAGE_PAIR_CONFIG" },
    { label: "SAGE_PAIR_CONFIG export",           marker: "export const SAGE_PAIR_CONFIG" },
    { label: "SEER_PAIR_CONFIG export",           marker: "export const SEER_PAIR_CONFIG" },
    { label: "MAGE OPTIMIZED CONFIGURATIONS comment", marker: "// MAGE OPTIMIZED CONFIGURATIONS" },
    { label: "SAGE OPTIMIZED CONFIGURATIONS comment", marker: "// SAGE OPTIMIZED CONFIGURATIONS" },
  ];
  const failures: string[] = [];
  for (const { label, marker } of REQUIRED) {
    if (!content.includes(marker)) {
      failures.push(`  ❌ MISSING: "${label}" (marker: '${marker}'`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n🔥 PRE-WRITE VALIDATION FAILED — Aborting injection to protect PairConfig.ts!`);
    console.error(`   The following required sections were missing from generated output:`);
    for (const f of failures) console.error(f);
    console.error(`   PairConfig.ts has NOT been modified.`);
    process.exit(1);
  }

  console.log(`✅ Pre-write validation passed: All 5 config sections and PairConfigManager class present.`);
}

validateFinalContent(finalContent);

fs.copyFileSync(PAIR_CONFIG_PATH, PAIR_CONFIG_PATH + ".bak");
console.log(`📦 Backup created safely at ${PAIR_CONFIG_PATH}.bak`);

fs.writeFileSync(PAIR_CONFIG_PATH, finalContent, "utf8");

console.log(
  `🚀 INJECTION COMPLETE! PairConfig.ts has been updated with Grandmaster ${categoryTarget} (Rank ${rankTarget}) configurations.`,
);
