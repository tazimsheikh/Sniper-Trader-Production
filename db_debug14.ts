import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== PROFILE 40 TRADE DIARY ===");
  const logs = await client.query(`
    SELECT broker_symbol, direction, entry_price, lots, profit, initial_risk_pips, status, to_timestamp(open_time/1000) as open_time, to_timestamp(close_time/1000) as close_time
    FROM trade_diary
    WHERE profile_id = 40
    ORDER BY close_time DESC
    LIMIT 10
  `);
  console.table(logs.rows);
  
  await client.end();
}

run().catch(console.error);
