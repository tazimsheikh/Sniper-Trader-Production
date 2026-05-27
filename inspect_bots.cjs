const fs = require('fs');
const path = require('path');

const botsDir = 'C:\\Users\\tazim\\antigravity\\Sniper-Trading-Analyst---by-Tazim-Sheikh\\server\\bots';
const files = fs.readdirSync(botsDir);

const bots = [];

for (const file of files) {
  if (file === 'BotInterface.ts' || !file.endsWith('.ts')) continue;
  const filePath = path.join(botsDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Extract configuration fields
  const idMatch = content.match(/id:\s*['"`](.*?)['"`]/);
  const nameMatch = content.match(/name:\s*['"`](.*?)['"`]/);
  const winRateMatch = content.match(/winRateBacktest:\s*([\d.]+)/);
  const returnMatch = content.match(/returnBacktest:\s*['"`](.*?)['"`]/);
  const maxDDMatch = content.match(/maxDDBacktest:\s*([\d.]+)/);

  if (nameMatch && returnMatch) {
    bots.push({
      file,
      id: idMatch ? idMatch[1] : '',
      name: nameMatch[1],
      winRate: winRateMatch ? parseFloat(winRateMatch[1]) : 0,
      returnStr: returnMatch[1],
      maxDD: maxDDMatch ? parseFloat(maxDDMatch[1]) : 0,
    });
  } else {
    console.log(`Skipped or partial match for ${file}`);
  }
}

console.log(JSON.stringify(bots, null, 2));
