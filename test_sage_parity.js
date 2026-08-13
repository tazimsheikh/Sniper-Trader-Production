import { runMathBacktest as sageBacktest } from './server/trading/backtester/SageMathBacktester.js';
import { runShadowBacktest } from './server/trading/backtester/OrchestratorShadowBacktester.js';
import { PairConfigManager } from './server/trading/config/PairConfig.js';

const startDate = '2026-04-01';
const endDate = '2026-04-30';

async function testSageParity() {
    let failedPairs = [];
    const pairs = PairConfigManager.getAllPairs();
    for (const pair of pairs) {
        console.log('Testing SAGE ' + pair + '...');
        const mathStats = await sageBacktest(pair, startDate, endDate, true, undefined, undefined, null, undefined, false);
        const shadowStats = await runShadowBacktest(pair, startDate, endDate, 'SAGE');
        if (!mathStats || !shadowStats) continue;

        let ok = true;
        if (mathStats.totalTrades !== shadowStats.totalTrades) {
            console.log('[MISMATCH] Trades: Math=' + mathStats.totalTrades + ' Shadow=' + shadowStats.totalTrades);
            ok = false;
        }
        if (Math.abs(mathStats.netR - shadowStats.netR) > 0.01) {
            console.log('[MISMATCH] Net R: Math=' + mathStats.netR.toFixed(2) + ' Shadow=' + shadowStats.netR.toFixed(2));
            ok = false;
        }
        if (!ok) failedPairs.push(pair);
        else console.log('[PASS] ' + pair);
    }
    console.log('Failed SAGE Pairs:', failedPairs);
}
testSageParity().catch(console.error);
