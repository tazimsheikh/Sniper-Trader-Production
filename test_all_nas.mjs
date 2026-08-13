import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });
await client.connect();
const trades = await client.query("SELECT profile_id, bot_id, broker_symbol, meta_order_id, status FROM bot_trade_states WHERE broker_symbol = 'NAS100' AND status = 'OPEN'");
console.table(trades.rows);
await client.end();
