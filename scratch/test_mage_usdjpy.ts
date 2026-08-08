import { runMageMathBacktest } from "../server/trading/backtester/MageMathBacktester.js";
import { runOrchestratorShadowBacktester } from "../server/trading/backtester/OrchestratorShadowBacktester.js";
async function test() {
  const r1 = await runMageMathBacktest("USDJPY", "2026-04-01", "2026-04-30");
  const r2 = await runOrchestratorShadowBacktester("USDJPY", "2026-04-01", "2026-04-30");
  console.log(`T1: ${r1.tradeCount}T, ${r1.netR}R`);
  console.log(`T2: ${r2.tradeCount}T, ${r2.netR}R`);
}
test();
