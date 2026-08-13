import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });
await client.connect();
const profiles = await client.query("SELECT id, automation_active, active_bots FROM trading_profiles WHERE id IN (40, 42, 43)");
console.table(profiles.rows);
await client.end();
