import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== TRADING PROFILES 40 & 42 ===");
  const p = await client.query(`
    SELECT * FROM trading_profiles
    WHERE id IN (40, 42, 43)
  `);
  console.log(p.rows);

  await client.end();
}

run().catch(console.error);
