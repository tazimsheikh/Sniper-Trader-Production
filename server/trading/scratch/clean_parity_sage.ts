import { runSageMathBacktest } from "../backtester/SageMathBacktester.js";
import { runShadowBacktest } from "../backtester/OrchestratorShadowBacktester.js";
import { PairConfigManager } from "../config/PairConfig.js";

async function main() {
    const pair = "AUDUSD";
    const startDate = "2026-07-06";
    const endDate = "2026-07-08";

    (global as any).__SIM_ENABLE_TRACE__ = true;
    
    // Disable noisy logs
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};

    const configs = PairConfigManager.getSageConfigs(pair);
    const mathRes = await runSageMathBacktest(pair, startDate, endDate, false, undefined, configs, true);
    
    const t2Config = { enableMage: false, enableSage: true };
    const shadowRes = await runShadowBacktest(pair, startDate, endDate, t2Config);
    
    const origLog = process.stdout.write.bind(process.stdout);
    origLog("--- MATH T1 TRADES ---\n");
    origLog(JSON.stringify(mathRes.records.filter(r => r.outcome !== "SKIPPED"), null, 2) + "\n");
    
    origLog("--- SHADOW T2 TRADES ---\n");
    origLog(JSON.stringify(shadowRes.tradeLog, null, 2) + "\n");
}
main().catch(() => {});
