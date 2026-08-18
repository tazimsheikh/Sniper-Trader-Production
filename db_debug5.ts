import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== TRADE DIARY (US30 & GBPJPY TODAY) ===");
  const diary = await client.query(`
    SELECT profile_id, broker_symbol, direction, entry_price, lots, profit, status
    FROM trade_diary
    WHERE (broker_symbol LIKE '%US30%' OR broker_symbol LIKE '%GBPJPY%')
    ORDER BY close_time DESC
    LIMIT 20
  `);
  console.table(diary.rows);

  await client.end();
}

run().catch(console.error);
