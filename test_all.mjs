import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });
await client.connect();
const trades = await client.query("SELECT id, profile_id, bot_id, broker_symbol, status, open_time, lots FROM bot_trade_states ORDER BY open_time DESC LIMIT 10");
console.table(trades.rows);
await client.end();
