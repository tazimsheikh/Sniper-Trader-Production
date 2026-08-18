import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("Fetching all trade entries for Profiles 40, 42, 43 in the last 48 hours...");
  
  // Get all TRADE_ENTERED logs
  const logs = await client.query(`
    SELECT profile_id, action, symbol, details, created_at
    FROM bot_logs
    WHERE profile_id IN (40, 42, 43)
    AND action IN ('TRADE_ENTERED', 'TRADE_REJECTED', 'TRADE_ABORTED', 'ERROR')
    AND created_at >= '2026-08-16T22:00:00Z'
    ORDER BY created_at ASC
  `);
  
  const tradeMap = new Map();
  
  for (const log of logs.rows) {
    const timeBucket = log.created_at.toISOString().substring(0, 13); // Group by hour
    const key = timeBucket + "_" + log.symbol;
    
    if (!tradeMap.has(key)) {
      tradeMap.set(key, { symbol: log.symbol, time: timeBucket, events: [] });
    }
    tradeMap.get(key).events.push({
      profileId: log.profile_id,
      action: log.action,
      time: log.created_at.toISOString()
    });
  }

  console.log("\\n=== DETECTED MISMATCHES ===");
  for (const [key, data] of tradeMap.entries()) {
    const enteredProfs = new Set(data.events.filter((e: any) => e.action === 'TRADE_ENTERED').map((e: any) => e.profileId));
    
    if (enteredProfs.size > 0 && enteredProfs.size < 3) {
      const missing = [40, 42, 43].filter(p => !enteredProfs.has(p));
      console.log("Mismatch on " + data.symbol + " around " + data.time + " UTC:");
      console.log("  -> Entered by: " + Array.from(enteredProfs).join(', '));
      console.log("  -> Missed by: " + missing.join(', '));
    }
  }

  await client.end();
}

run().catch(console.error);
