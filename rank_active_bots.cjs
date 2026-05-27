const fs = require('fs');
const path = require('path');

const projectDir = 'C:\\Users\\tazim\\antigravity\\Sniper-Trading-Analyst---by-Tazim-Sheikh';
const botsDir = path.join(projectDir, 'server', 'bots');

// Read botManager.ts to extract active registry keys and imports
const botManagerPath = path.join(projectDir, 'server', 'botManager.ts');
const botManagerContent = fs.readFileSync(botManagerPath, 'utf-8');

// Find all imported bots
const importRegex = /import\s+(\w+)\s+from\s+['"]\.\/bots\/(\w+)\.js['"]/g;
const imports = {};
let match;
while ((match = importRegex.exec(botManagerContent)) !== null) {
  imports[match[1]] = match[2];
}

// Find registry keys
const registryRegex = /'([^']+)':\s*(\w+)/g;
const registryKeys = [];
const registryContent = botManagerContent.split('export const BOT_REGISTRY')[1].split('};')[0];
let regMatch;
while ((regMatch = registryRegex.exec(registryContent)) !== null) {
  const variableName = regMatch[2];
  const fileName = imports[variableName];
  if (fileName) {
    registryKeys.push({
      key: regMatch[1],
      fileName: fileName + '.ts'
    });
  }
}

console.log('Active registry keys and files:', registryKeys);

function parseReturn(str) {
  // e.g. "+224k% average return one year" or similar
  const clean = str.replace(/[+%]/g, '').split('average')[0].trim().toLowerCase();
  if (clean.endsWith('m')) {
    return parseFloat(clean.slice(0, -1)) * 1000000;
  }
  if (clean.endsWith('k')) {
    return parseFloat(clean.slice(0, -1)) * 1000;
  }
  return parseFloat(clean);
}

const bots = [];

for (const reg of registryKeys) {
  const filePath = path.join(botsDir, reg.fileName);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const idMatch = content.match(/id:\s*['"`](.*?)['"`]/);
  const nameMatch = content.match(/name:\s*['"`](.*?)['"`]/);
  const winRateMatch = content.match(/winRateBacktest:\s*([\d.]+)/);
  const returnMatch = content.match(/returnBacktest:\s*['"`](.*?)['"`]/);
  const maxDDMatch = content.match(/maxDDBacktest:\s*([\d.]+)/);

  if (nameMatch && returnMatch) {
    const rawReturn1Yr = parseReturn(returnMatch[1]);
    bots.push({
      key: reg.key,
      fileName: reg.fileName,
      id: idMatch ? idMatch[1] : '',
      name: nameMatch[1],
      winRate: winRateMatch ? parseFloat(winRateMatch[1]) : 0,
      returnStr: returnMatch[1],
      return1YrRaw: rawReturn1Yr,
      maxDD: maxDDMatch ? parseFloat(maxDDMatch[1]) : 0,
    });
  }
}

// Rank by Win Rate (descending)
const sortedByWinRate = [...bots].sort((a, b) => b.winRate - a.winRate);
sortedByWinRate.forEach((b, index) => {
  b.winRateRank = index + 1;
});

// Rank by Return (descending)
const sortedByReturn = [...bots].sort((a, b) => b.return1YrRaw - a.return1YrRaw);
sortedByReturn.forEach((b, index) => {
  b.returnRank = index + 1;
});

// Rank by Max DD (ascending - lower is better)
const sortedByMaxDD = [...bots].sort((a, b) => a.maxDD - b.maxDD);
sortedByMaxDD.forEach((b, index) => {
  b.maxDDRank = index + 1;
});

// Calculate overall score (lower rank sum is better)
bots.forEach(b => {
  b.rankSum = b.winRateRank + b.returnRank + b.maxDDRank;
});

const sortedOverall = [...bots].sort((a, b) => a.rankSum - b.rankSum);
sortedOverall.forEach((b, index) => {
  b.overallRank = index + 1;
});

console.log('\nFINAL ACTIVE BOTS RANKING:');
console.log(JSON.stringify(sortedOverall.map(b => ({
  rank: b.overallRank,
  name: b.name,
  winRate: `${b.winRate}% (Rank ${b.winRateRank})`,
  return1Yr: `${b.returnStr} (Rank ${b.returnRank})`,
  maxDD: `${b.maxDD}% (Rank ${b.maxDDRank})`,
  rankSum: b.rankSum
})), null, 2));
