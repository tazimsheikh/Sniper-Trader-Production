import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });
await client.connect();
const trades = await client.query("SELECT * FROM bot_trade_states WHERE profile_id = 43 ORDER BY open_time DESC LIMIT 10");
console.log('Total trades for profile 43:', trades.rowCount);
await client.end();
