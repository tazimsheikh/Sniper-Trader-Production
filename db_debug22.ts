import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== ALL TRADES (Since Aug 17 21:00 UTC) ===");
  const trades = await client.query(`
    SELECT 
      profile_id, broker_symbol, direction, lots, profit, status, to_timestamp(open_time/1000) as open_time
    FROM trade_diary
    WHERE open_time >= extract(epoch from timestamp '2026-08-17 21:00:00') * 1000
    ORDER BY open_time DESC
  `);
  console.table(trades.rows);
  
  await client.end();
}

run().catch(console.error);
