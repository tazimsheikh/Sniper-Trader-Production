import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== HALT/KILLSWITCH LOGS PROFILE 40 ===");
  const logs = await client.query(`
    SELECT action, details, created_at
    FROM bot_logs
    WHERE profile_id = 40 AND (action LIKE '%HALT%' OR action LIKE '%KILLSWITCH%')
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.table(logs.rows);
  
  await client.end();
}

run().catch(console.error);
