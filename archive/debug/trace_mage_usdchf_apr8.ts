/**
 * Trace MAGE USDCHF April 8 2026 - bar-by-bar currentR
 * Run: npx tsx server/trading/testing/trace_mage_usdchf_apr8.ts
 */
import { runMathBacktest } from '../backtester/MageMathBacktester.js';

async function main() {
  // Enable per-bar trace in MageMathCore
  (global as any).__MAGE_TRACE__ = true;

  console.log('=== MAGE USDCHF MAGE_USDCHF_2 (first failing config) Apr 8 trace ===\n');

  const results = await runMathBacktest(
    'USDCHF',
    '2026-04-08',
    '2026-04-09',
    false,
    undefined,
    undefined,
    null,
    undefined,
    false, // enableTrace (we have our own)
  );

  console.log('\n=== T1 Summary ===');
  for (const r of results.records.filter((r: any) => r.outcome !== 'SKIPPED')) {
    const d = new Date(r.timestamp).toISOString().slice(0, 10);
    console.log(`  [T1] ${d} sig=${r.clientId} Entry=${(r.entry||0).toFixed(5)} SL=${(r.stopLoss||0).toFixed(5)} R=${(r.rMultiple||0).toFixed(4)} Out=${r.outcome}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
