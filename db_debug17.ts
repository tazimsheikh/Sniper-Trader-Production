import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== NZDUSD LOGS ACROSS ALL PROFILES ===");
  const logs = await client.query(`
    SELECT profile_id, action, details, created_at
    FROM bot_logs
    WHERE symbol LIKE '%NZDUSD%'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.table(logs.rows);
  
  console.log("=== NZDUSD TRADES ACROSS ALL PROFILES ===");
  const trades = await client.query(`
    SELECT profile_id, broker_symbol, direction, entry_price, lots, profit, status, to_timestamp(open_time/1000) as open_time
    FROM trade_diary
    WHERE broker_symbol LIKE '%NZDUSD%'
    ORDER BY open_time DESC
    LIMIT 20
  `);
  console.table(trades.rows);

  await client.end();
}

run().catch(console.error);
