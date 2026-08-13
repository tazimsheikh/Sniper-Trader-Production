import { runMathBacktest } from './server/trading/backtester/MageMathBacktester.js';
import { runShadowBacktest } from './server/trading/backtester/OrchestratorShadowBacktester.js';

async function test() {
    console.log('\nRunning Tier 2...');
    const originalLog = console.log;
    console.log = (...args: any[]) => {
        const msg = args.join(' ');
        if (msg.includes('NAS100') && msg.includes('MageEngine') && msg.includes('ATR-Relative')) {
            originalLog(msg);
        }
        if (msg.includes('LimitPlaced')) {
            originalLog(msg);
        }
    };
    await runShadowBacktest('NAS100', '2026-04-15', '2026-04-17', { enableMage: true, enableSage: false, enableSeer: false });
}
test().catch(console.error);
