import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });
await client.connect();
const profile = await client.query("SELECT broker_symbol_map FROM trading_profiles WHERE id = 43");
console.log(profile.rows[0].broker_symbol_map);
await client.end();
