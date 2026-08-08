import { runSageMathBacktest } from "../backtester/SageMathBacktester.js";
import { PairConfigManager } from "../config/PairConfig.js";

async function main() {
    const pair = "AUDUSD";
    const startDate = "2026-07-06";
    const endDate = "2026-07-08";
    const configs = PairConfigManager.getSageConfigs(pair);
    (global as any).__SIM_ENABLE_TRACE__ = true;
    const res = await runSageMathBacktest(pair, startDate, endDate, false, undefined, configs, true);
    console.log(JSON.stringify(res.records.filter(r => r.outcome !== "SKIPPED"), null, 2));
}
main().catch(console.error);
