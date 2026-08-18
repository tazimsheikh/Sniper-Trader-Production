import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== CHECK AUTOMATION_ACTIVE ===");
  const p = await client.query(`
    SELECT id, profile_name, automation_active FROM trading_profiles
    WHERE id = 40
  `);
  console.log(p.rows);
  
  await client.end();
}

run().catch(console.error);
