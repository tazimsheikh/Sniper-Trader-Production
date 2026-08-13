import { runTier2Parity } from './server/trading/testing/core_parity_engine.js';

async function test() {
    await runTier2Parity('NAS100', '2026-04-15', '2026-04-17', 'MAGE', undefined, undefined, true);
}
test().catch(console.error);
