const fs = require('fs');
const lines = fs.readFileSync('logs/app-2026-08-12.log', 'utf8').split('\n');
console.log(lines.filter(l => l.includes('588139342')).join('\n'));
