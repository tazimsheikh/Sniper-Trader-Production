import fs from 'fs';
import path from 'path';

interface ConfigItem {
  bot: string;
  symbol: string;
  setup: string;
  trades: number;
  totalNetR: number;
  maxDrawdown: number;
  rToDd: number;
  winDays: number;
  lossDays: number;
  winRateDays: number;
  maxSingleDayR: number;
  singleDayDomination: number;
  monthlyConsistencyScore: number;
  sourceFile: string;
}

const dumpDirs = [
  'E:/Antigrav projects/BACKUP TRADING/server 4.8/trading/optimizer/mage/mage_optimizer_dump',
  'E:/Antigrav projects/BACKUP TRADING/server 4.8/trading/optimizer/sage/sage_optimizer_dump'
];

function getAllFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath));
    } else {
      results.push(filePath);
    }
  }
  return results;
}

let allFiles: string[] = [];
for (const d of dumpDirs) {
  allFiles = allFiles.concat(getAllFiles(d));
}

const candidateConfigs: ConfigItem[] = [];

function processObject(obj: any, file: string, bot: string) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) processObject(item, file, bot);
    return;
  }
  if (obj.validAlphas) processObject(obj.validAlphas, file, bot);
  if (obj.alphas) processObject(obj.alphas, file, bot);
  if (obj.wfaLog) processObject(obj.wfaLog, file, bot);
  if (obj.dna) processObject(obj.dna, file, bot);

  const setup = obj.setup || obj.params || obj.signature || obj.configStr;
  if (!setup || typeof setup !== 'string' || setup.length < 5) return;

  const trades = obj.trades || (obj.inSample ? obj.inSample.trades : 0) || 0;
  const totalNetR = obj.totalNetR || obj.netR || (obj.inSample ? obj.inSample.netR : 0) || 0;
  const dailyNetR = obj.dailyNetR;

  if (trades < 80 || totalNetR <= 10) return;

  let maxDD = obj.maxDrawdown || (obj.inSample ? obj.inSample.maxDrawdown : 0) || 0;
  let maxSingleDayR = 0;
  let winDays = 0;
  let lossDays = 0;
  let monthlyReturns: { [key: string]: number } = {};

  if (dailyNetR && typeof dailyNetR === 'object') {
    let peak = 0;
    let cum = 0;
    let dd = 0;
    const dates = Object.keys(dailyNetR).sort();
    for (const d of dates) {
      const val = dailyNetR[d];
      if (typeof val !== 'number') continue;
      cum += val;
      if (cum > peak) peak = cum;
      const currentDd = peak - cum;
      if (currentDd > dd) dd = currentDd;

      if (val > maxSingleDayR) maxSingleDayR = val;
      if (val > 0) winDays++;
      else if (val < 0) lossDays++;

      const monthKey = d.substring(0, 7);
      monthlyReturns[monthKey] = (monthlyReturns[monthKey] || 0) + val;
    }
    if (dd > 0) maxDD = dd;
  }

  const singleDayDomination = totalNetR > 0 ? (maxSingleDayR / totalNetR) : 1;
  const months = Object.keys(monthlyReturns);
  let winningMonths = 0;
  for (const m of months) {
    if (monthlyReturns[m] > 0) winningMonths++;
  }
  const monthlyConsistencyScore = months.length > 0 ? (winningMonths / months.length) : 0;

  if (singleDayDomination > 0.35) return;
  if (maxDD <= 0) maxDD = 1;

  const rToDd = totalNetR / maxDD;
  const winRateDays = (winDays + lossDays) > 0 ? (winDays / (winDays + lossDays)) * 100 : 0;

  let symbol = 'UNKNOWN';
  const filename = path.basename(file);
  const match = (file + setup).match(/(AUDJPY|AUDUSD|BTCUSD|CADJPY|CHFJPY|ETHUSD|EURAUD|EURCAD|EURJPY|EURNZD|EURUSD|GBPAUD|GBPCAD|GBPJPY|GBPNZD|GBPUSD|GER40|JPN225|NAS100|NZDUSD|SPX500|US30|USDCAD|USDCHF|USDJPY|XAUUSD|XTIUSD)/i);
  if (match) symbol = match[1].toUpperCase();

  candidateConfigs.push({
    bot,
    symbol,
    setup,
    trades,
    totalNetR,
    maxDrawdown: maxDD,
    rToDd,
    winDays,
    lossDays,
    winRateDays,
    maxSingleDayR,
    singleDayDomination,
    monthlyConsistencyScore,
    sourceFile: filename
  });
}

for (const file of allFiles) {
  if (!file.endsWith('.json') && !file.endsWith('.txt')) continue;
  const isMage = file.includes('mage_optimizer_dump');
  const bot = isMage ? 'MAGE' : 'SAGE';
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw || raw.length < 5) continue;
    processObject(JSON.parse(raw), file, bot);
  } catch (e) {}
}

// Group by Symbol
const symbolMap = new Map<string, ConfigItem[]>();
for (const c of candidateConfigs) {
  if (!symbolMap.has(c.symbol)) symbolMap.set(c.symbol, []);
  symbolMap.get(c.symbol)!.push(c);
}

let mdContent = `# Exhaustive Dump Analysis — Top Configs per Pair\n\n`;
mdContent += `This document contains the absolute top non-anomalous configurations discovered across all 216 JSON files in \`mage_optimizer_dump\` and \`sage_optimizer_dump\` for **all 27 symbols** in the codebase.\n\n`;

const sortedSymbols = Array.from(symbolMap.keys()).sort();

for (const sym of sortedSymbols) {
  const configs = symbolMap.get(sym)!;
  // Deduplicate by setup
  const uniqueMap = new Map<string, ConfigItem>();
  for (const c of configs) {
    if (!uniqueMap.has(c.setup) || uniqueMap.get(c.setup)!.totalNetR < c.totalNetR) {
      uniqueMap.set(c.setup, c);
    }
  }
  const unique = Array.from(uniqueMap.values());
  unique.sort((a, b) => {
    const scoreA = (a.rToDd * 1.5) + (a.totalNetR * 0.05) + (a.monthlyConsistencyScore * 20) + (a.trades * 0.02);
    const scoreB = (b.rToDd * 1.5) + (b.totalNetR * 0.05) + (b.monthlyConsistencyScore * 20) + (b.trades * 0.02);
    return scoreB - scoreA;
  });

  mdContent += `## 📈 ${sym}\n\n`;
  const topConfigs = unique.slice(0, 3);
  topConfigs.forEach((c, idx) => {
    mdContent += `### ${idx + 1}. [${c.bot}] ${c.setup}\n`;
    mdContent += `- **Total Net R:** +${c.totalNetR.toFixed(2)} R\n`;
    mdContent += `- **Total Trades:** ${c.trades}\n`;
    mdContent += `- **Max Drawdown:** ${c.maxDrawdown.toFixed(2)} R\n`;
    mdContent += `- **Return / Drawdown Ratio:** ${c.rToDd.toFixed(2)}\n`;
    mdContent += `- **Monthly Consistency Win Rate:** ${(c.monthlyConsistencyScore * 100).toFixed(1)}%\n`;
    mdContent += `- **Single-Day Max Impact:** ${c.maxSingleDayR.toFixed(2)} R (${(c.singleDayDomination * 100).toFixed(1)}% of total profit)\n`;
    mdContent += `- **Source Dump File:** \`${c.sourceFile}\` \n\n`;
  });
  mdContent += `---\n\n`;
}

fs.writeFileSync('C:/Users/tazim/.gemini/antigravity/brain/b2f5fb21-b306-4513-8cf6-5dacb6d1c255/all_top_configs_by_symbol.md', mdContent, 'utf8');
console.log('Artifact all_top_configs_by_symbol.md written successfully.');
