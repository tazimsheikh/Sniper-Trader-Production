const fs = require('fs');
const path = require('path');

const botsDir = 'C:\\Users\\tazim\\antigravity\\Sniper-Trading-Analyst---by-Tazim-Sheikh\\server\\bots';
const files = fs.readdirSync(botsDir);

const bots = [];

function parseReturn(str) {
  // e.g. "+1.12M% / 5yr" or "+351k% / 5yr"
  const clean = str.replace(/[+%]/g, '').split('/')[0].trim().toLowerCase();
  if (clean.endsWith('m')) {
    return parseFloat(clean.slice(0, -1)) * 1000000;
  }
  if (clean.endsWith('k')) {
    return parseFloat(clean.slice(0, -1)) * 1000;
  }
  return parseFloat(clean);
}

for (const file of files) {
  if (file === 'BotInterface.ts' || !file.endsWith('.ts')) continue;
  const filePath = path.join(botsDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const idMatch = content.match(/id:\s*['"`](.*?)['"`]/);
  const nameMatch = content.match(/name:\s*['"`](.*?)['"`]/);
  const winRateMatch = content.match(/winRateBacktest:\s*([\d.]+)/);
  const returnMatch = content.match(/returnBacktest:\s*['"`](.*?)['"`]/);
  const maxDDMatch = content.match(/maxDDBacktest:\s*([\d.]+)/);

  if (nameMatch && returnMatch) {
    const rawReturn5Yr = parseReturn(returnMatch[1]);
    const rawReturn1Yr = rawReturn5Yr / 5;
    bots.push({
      file,
      id: idMatch ? idMatch[1] : '',
      name: nameMatch[1],
      winRate: winRateMatch ? parseFloat(winRateMatch[1]) : 0,
      return5YrStr: returnMatch[1],
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

console.log('RANKING RESULT:');
console.log(JSON.stringify(sortedOverall.map(b => ({
  rank: b.overallRank,
  name: b.name,
  winRate: `${b.winRate}% (Rank ${b.winRateRank})`,
  return1Yr: `${(b.return1YrRaw / 1000).toFixed(1)}k% (Rank ${b.returnRank})`,
  maxDD: `${b.maxDD}% (Rank ${b.maxDDRank})`,
  rankSum: b.rankSum
})), null, 2));
