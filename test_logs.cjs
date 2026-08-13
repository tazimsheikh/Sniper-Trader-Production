const fs = require('fs');
const lines = fs.readFileSync('logs/app-2026-08-12.log', 'utf8').split('\n');
const recent = lines.slice(-2000);
console.log(recent.filter(l => l.includes('US30') && (l.includes('fail') || l.includes('reject') || l.includes('error') || l.includes('MAGE') || l.includes('Mage'))).join('\n'));
