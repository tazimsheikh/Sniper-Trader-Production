const fs = require('fs');
const path = require('path');

const projectDir = 'C:\\Users\\tazim\\antigravity\\Sniper-Trading-Analyst---by-Tazim-Sheikh';
const botsDir = path.join(projectDir, 'server', 'bots');

const botManagerPath = path.join(projectDir, 'server', 'botManager.ts');
const botManagerContent = fs.readFileSync(botManagerPath, 'utf-8');

const importRegex = /import\s+(\w+)\s+from\s+['"]\.\/bots\/(\w+)\.js['"]/g;
const imports = {};
let match;
while ((match = importRegex.exec(botManagerContent)) !== null) {
  imports[match[1]] = match[2];
}

const registryRegex = /'([^']+)':\s*(\w+)/g;
const registryKeys = [];
const registryContent = botManagerContent.split('export const BOT_REGISTRY')[1].split('};')[0];
let regMatch;
while ((regMatch = registryRegex.exec(registryContent)) !== null) {
  const variableName = regMatch[2];
  const fileName = imports[variableName];
  if (fileName) {
    registryKeys.push({ key: regMatch[1], fileName: fileName + '.ts' });
  }
}

function parseReturn(str) {
  const clean = str.replace(/[+%]/g, '').split('average')[0].trim().toLowerCase();
  if (clean.endsWith('m')) return parseFloat(clean.slice(0, -1)) * 1000000;
  if (clean.endsWith('k')) return parseFloat(clean.slice(0, -1)) * 1000;
  return parseFloat(clean);
}

const bots = [];
for (const reg of registryKeys) {
  const filePath = path.join(botsDir, reg.fileName);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const winRateMatch = content.match(/winRateBacktest:\s*([\d.]+)/);
  const returnMatch = content.match(/returnBacktest:\s*['"`](.*?)['"`]/);
  const maxDDMatch = content.match(/maxDDBacktest:\s*([\d.]+)/);

  if (returnMatch) {
    bots.push({
      fileName: reg.fileName,
      winRate: winRateMatch ? parseFloat(winRateMatch[1]) : 0,
      return1YrRaw: parseReturn(returnMatch[1]),
      maxDD: maxDDMatch ? parseFloat(maxDDMatch[1]) : 0,
    });
  }
}

// Ranks
const sortedByWinRate = [...bots].sort((a, b) => b.winRate - a.winRate);
sortedByWinRate.forEach((b, index) => b.winRateRank = index + 1);

const sortedByReturn = [...bots].sort((a, b) => b.return1YrRaw - a.return1YrRaw);
sortedByReturn.forEach((b, index) => b.returnRank = index + 1);

const sortedByMaxDD = [...bots].sort((a, b) => a.maxDD - b.maxDD);
sortedByMaxDD.forEach((b, index) => b.maxDDRank = index + 1);

bots.forEach(b => b.rankSum = b.winRateRank + b.returnRank + b.maxDDRank);
const sortedOverall = [...bots].sort((a, b) => a.rankSum - b.rankSum);

sortedOverall.forEach((b, index) => {
  const rank = index + 1;
  let newTier = '';
  if (rank <= 4) newTier = 'Apex';
  else if (rank <= 9) newTier = 'Institutional';
  else if (rank <= 14) newTier = 'Prop';
  else newTier = 'Scout';

  const filePath = path.join(botsDir, b.fileName);
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(/tier:\s*['"`].*?['"`]/, `tier: '${newTier}'`);
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Updated ${b.fileName} (Rank ${rank}) to tier: ${newTier}`);
});
