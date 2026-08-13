import { runSageMathBacktest } from './server/trading/backtester/SageMathBacktester.js';
import { runShadowBacktest } from './server/trading/backtester/OrchestratorShadowBacktester.js';

const pair = 'NAS100';
const startDate = '2026-04-01';
const endDate = '2026-04-30';

async function run() {
  console.log('=== TIER 1 ===');
  const t1 = await runSageMathBacktest(pair, startDate, endDate, true, undefined, undefined, null, undefined, false);
  console.log('\n\n=== TIER 1 TRADES ===');
  if (t1?.records) {
    const traded = t1.records.filter((r: any) => r.outcome !== 'SKIPPED');
    for (const r of traded) {
      console.log(`[T1] Date: ${r.date} | Entry: ${r.entryPrice} | SL: ${r.slPrice} | Outcome: ${r.outcome} | R: ${(r.R ?? 0).toFixed(2)}`);
    }
    console.log(`T1 Total: ${traded.length} trades`);
  }

  console.log('\n\n=== TIER 2 ===');
  const t2 = await runShadowBacktest(pair, startDate, endDate, 'SAGE');
  console.log(`T2 Total: ${t2?.totalTrades} trades | Net R: ${t2?.netR?.toFixed(2)}`);
}
run().catch(console.error);
