const fs = require('fs');
const lines = fs.readFileSync('logs/app-2026-08-12.log', 'utf8').split('\n');
const naked = lines.filter(l => l.includes('NAKED TRADE DETECTED'));
const ids = naked.map(l => {
  const match = l.match(/Position (\d+) on/);
  return match ? match[1] : null;
}).filter(id => id);
console.log('Found Position IDs:', ids.join(', '));
