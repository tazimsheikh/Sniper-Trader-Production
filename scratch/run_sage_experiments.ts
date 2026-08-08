import { runSageMathBacktest } from "../server/trading/backtester/SageMathBacktester.js";
async function test() {
  const r = await runSageMathBacktest("EURUSD", "2026-04-01", "2026-04-30");
  console.log(`Sage EURUSD Trades: ${r.tradeCount} | Net R: ${r.netR}`);
}
test();
