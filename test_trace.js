import fs from 'fs';
let content = fs.readFileSync('server/trading/backtester/math_core/MageMathCore.ts', 'utf8');
content = content.replace(/dateIso.includes\('2026-04-09'\)/g, "dateIso.includes('2026-04-16')");
content = content.replace(/TRACE April 9/g, "TRACE April 16");
fs.writeFileSync('server/trading/backtester/math_core/MageMathCore.ts', content, 'utf8');
