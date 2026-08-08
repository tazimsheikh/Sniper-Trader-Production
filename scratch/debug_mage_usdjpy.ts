import { runShadowBacktest } from '../server/trading/backtester/OrchestratorShadowBacktester.js';
import { runMathBacktest } from '../server/trading/backtester/MageMathBacktester.js';

(global as any).__SIM_ENABLE_TRACE__ = true;

async function main() {
    const start = "2026-04-07";
    const end = "2026-04-08";
    console.log("Running T1...");
    const res1 = await runMathBacktest("USDJPY", start, end);
    console.log("T1 Records:", res1.records);

    console.log("Running Shadow...");
    const res2 = await runShadowBacktest("USDJPY", start, end, { enableMage: true, enableSage: false });
    console.log("T2 Records:", res2.tradeLog);
}
main().catch(console.error);
