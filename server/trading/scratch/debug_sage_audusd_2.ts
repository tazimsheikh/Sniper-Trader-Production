import { runSageMathBacktest } from "../backtester/SageMathBacktester.js";
import { PairConfigManager } from "../config/PairConfig.js";

async function main() {
    const pair = "AUDUSD";
    const startDate = "2026-06-01"; // Use early start date to ensure EMA stabilization
    const endDate = "2026-07-08";
    const configs = PairConfigManager.getSageConfigs(pair);
    (global as any).__SIM_ENABLE_TRACE__ = true;
    
    // Override console.log temporarily to capture internal logging
    const oldLog = console.log;
    const logs: string[] = [];
    console.log = (...args) => {
        const msg = args.join(" ");
        if (msg.includes("2026-07-07") || msg.includes("sweepHigh") || msg.includes("orHigh")) {
            logs.push(msg);
        }
        oldLog(...args);
    };

    const res = await runSageMathBacktest(pair, startDate, endDate, false, undefined, configs, true);
    
    console.log = oldLog;
    
    // Print captured logs
    for (const l of logs) {
        if (l.includes("2026-07-07")) console.log("LOG:", l);
    }
    
    const trade0707 = res.records.find(r => r.date === "2026-07-07" && r.outcome !== "SKIPPED");
    console.log("TRADE 07-07:", JSON.stringify(trade0707, null, 2));
}
main().catch(console.error);
