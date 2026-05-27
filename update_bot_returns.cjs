const fs = require('fs');
const path = require('path');

const botsDir = 'C:\\Users\\tazim\\antigravity\\Sniper-Trading-Analyst---by-Tazim-Sheikh\\server\\bots';
const files = fs.readdirSync(botsDir);

function parseReturn(str) {
  const clean = str.replace(/[+%]/g, '').split('/')[0].trim().toLowerCase();
  if (clean.endsWith('m')) {
    return parseFloat(clean.slice(0, -1)) * 1000000;
  }
  if (clean.endsWith('k')) {
    return parseFloat(clean.slice(0, -1)) * 1000;
  }
  return parseFloat(clean);
}

function formatReturn(val) {
  if (val >= 1000000) {
    const mVal = val / 1000000;
    if (mVal % 1 === 0) {
      return `+${mVal}M% average return one year`;
    } else {
      return `+${Number(mVal.toFixed(2))}M% average return one year`;
    }
  } else if (val >= 1000) {
    const kVal = val / 1000;
    if (kVal % 1 === 0) {
      return `+${kVal}k% average return one year`;
    } else {
      return `+${Number(kVal.toFixed(1))}k% average return one year`;
    }
  } else {
    return `+${val}% average return one year`;
  }
}

for (const file of files) {
  if (file === 'BotInterface.ts' || !file.endsWith('.ts')) continue;
  const filePath = path.join(botsDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // Find returnBacktest line
  const returnMatch = content.match(/returnBacktest:\s*['"`](.*?)['"`]/);
  if (returnMatch) {
    const oldVal = returnMatch[1];
    if (oldVal.includes('/ 5yr') || oldVal.includes('/5yr')) {
      const rawReturn5Yr = parseReturn(oldVal);
      const rawReturn1Yr = rawReturn5Yr / 5;
      const newVal = formatReturn(rawReturn1Yr);
      
      console.log(`Updating ${file}: "${oldVal}" -> "${newVal}"`);
      
      // Replace in content
      const regex = new RegExp(`returnBacktest:\\s*['"\`]${oldVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'g');
      content = content.replace(regex, `returnBacktest: '${newVal}'`);
      
      fs.writeFileSync(filePath, content, 'utf-8');
    } else {
      console.log(`Skipping ${file} - already updated or mismatch: "${oldVal}"`);
    }
  }
}
