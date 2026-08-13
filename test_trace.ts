import { runMathBacktest } from './server/trading/backtester/MageMathBacktester.js';
import * as fs from 'fs';

(global as any).__SIM_ENABLE_TRACE__ = true;
let coreContent = fs.readFileSync('server/trading/backtester/math_core/MageMathCore.ts', 'utf8');
coreContent = coreContent.replace(
    'const atrVal = i >= 1 ? atrArr[i - 1] : 0;',
    'if (dateIso.includes("2026-04-16") && mCfg.session === "NY_Forex") console.log([ORB CHECK] orHigh= + orHigh +  orLow= + orLow +  m1StartIndex= + m1StartIndex +  len= + m5Length);\n        const atrVal = i >= 1 ? atrArr[i - 1] : 0;'
);
fs.writeFileSync('server/trading/backtester/math_core/MageMathCore.ts', coreContent);

async function test() {
    await runMathBacktest('NAS100', '2026-04-16', '2026-04-16', true, undefined, undefined, null, undefined, true);
    // Revert
    let content = fs.readFileSync('server/trading/backtester/math_core/MageMathCore.ts', 'utf8');
    content = content.replace('if (dateIso.includes("2026-04-16") && mCfg.session === "NY_Forex") console.log([ORB CHECK] orHigh= + orHigh +  orLow= + orLow +  m1StartIndex= + m1StartIndex +  len= + m5Length);\n        const atrVal = i >= 1 ? atrArr[i - 1] : 0;', 'const atrVal = i >= 1 ? atrArr[i - 1] : 0;');
    fs.writeFileSync('server/trading/backtester/math_core/MageMathCore.ts', content);
}
test().catch(console.error);
