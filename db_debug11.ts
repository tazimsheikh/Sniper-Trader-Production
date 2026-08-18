import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== PROFILE 40 OPEN TRADES ===");
  const states = await client.query(`
    SELECT profile_id, bot_id, broker_symbol, direction, entry_price, status, to_timestamp(open_time/1000) as open_date
    FROM bot_trade_states
    WHERE profile_id = 40 AND status = 'OPEN'
  `);
  console.table(states.rows);

  console.log("=== PROFILE 42 OPEN TRADES ===");
  const states42 = await client.query(`
    SELECT profile_id, bot_id, broker_symbol, direction, entry_price, status, to_timestamp(open_time/1000) as open_date
    FROM bot_trade_states
    WHERE profile_id = 42 AND status = 'OPEN'
  `);
  console.table(states42.rows);

  await client.end();
}

run().catch(console.error);
