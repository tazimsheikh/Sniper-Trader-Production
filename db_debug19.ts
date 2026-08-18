import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== ACTIVE BOTS ACROSS PROFILES ===");
  const logs = await client.query(`
    SELECT id, profile_name, active_bots
    FROM trading_profiles
    WHERE id IN (40, 42, 43)
  `);
  console.table(logs.rows);
  
  await client.end();
}

run().catch(console.error);
