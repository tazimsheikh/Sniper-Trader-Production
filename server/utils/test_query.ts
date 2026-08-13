import db from '../core/db.js';

async function run() {
  try {
    // 3:30 AM EST to 5:00 AM EST on Aug 13, 2026.
    // EST is UTC-4 right now (EDT). So 3:30 AM EDT = 07:30 UTC. 5:00 AM EDT = 09:00 UTC.
    // Let's just fetch all candles for NAS100 for today.
    const startMs = new Date("2026-08-13T00:00:00Z").getTime();
    const candles = await db.prepare("SELECT timestamp, open, high, low, close, tick_volume FROM m5_candles_cache WHERE symbol = 'NAS100' AND timestamp > ? ORDER BY timestamp ASC").all(startMs);
    console.log(`Found ${candles.length} candles for NAS100 today`);
    if (candles.length > 0) {
      console.log('First:', new Date(candles[0].timestamp).toISOString(), candles[0]);
      console.log('Last:', new Date(candles[candles.length - 1].timestamp).toISOString(), candles[candles.length - 1]);
    }
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
run();
