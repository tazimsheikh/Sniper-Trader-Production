import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== PROFILE STATE ===");
  const profiles = await client.query(`
    SELECT 
      id, 
      profile_name, 
      active_bots, 
      institutional_enabled, 
      institutional_daily_cap, 
      institutional_daily_start_balance,
      institutional_peak_balance,
      institutional_peak_to_draw
    FROM trading_profiles
    WHERE id IN (40, 42, 43)
  `);
  console.table(profiles.rows);
  
  // Calculate today's PnL from trade_diary
  // 17:00 EST yesterday was 21:00 UTC yesterday.
  // We can just query trades opened after 2026-08-17 21:00:00 UTC
  console.log("=== TODAY'S PNL (Since Aug 17 21:00 UTC) ===");
  const pnl = await client.query(`
    SELECT 
      profile_id, 
      SUM(profit) as total_pnl, 
      COUNT(*) as trades_taken
    FROM trade_diary
    WHERE open_time >= extract(epoch from timestamp '2026-08-17 21:00:00') * 1000
    AND status IN ('CLOSED_WON', 'CLOSED_LOSS')
    GROUP BY profile_id
  `);
  console.table(pnl.rows);
  
  await client.end();
}

run().catch(console.error);
