import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== BOT TRADE STATES (US30 & GBPJPY TODAY) ===");
  const trades = await client.query(`
    SELECT profile_id, broker_symbol, direction, entry_price, lots, meta_order_id, status, created_at
    FROM bot_trade_states
    WHERE (broker_symbol LIKE '%US30%' OR broker_symbol LIKE '%GBPJPY%')
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.table(trades.rows);

  console.log("=== ERRORS/WARNINGS LOGS TODAY ===");
  const errors = await client.query(`
    SELECT profile_id, symbol, action, details, created_at
    FROM bot_logs
    WHERE (action LIKE '%ERROR%' OR action LIKE '%REJECT%' OR details LIKE '%error%' OR details LIKE '%fail%')
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.table(errors.rows);

  await client.end();
}

run().catch(console.error);
