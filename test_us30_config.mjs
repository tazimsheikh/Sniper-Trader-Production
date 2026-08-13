import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true' });
await client.connect();
const configs = await client.query("SELECT * FROM profile_pair_configs WHERE profile_id = 43 AND pair = 'US30'");
console.table(configs.rows);
await client.end();
