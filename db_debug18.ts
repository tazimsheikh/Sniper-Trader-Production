import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== PROFILE 42 LOGS AROUND 23:42 YESTERDAY ===");
  const logs = await client.query(`
    SELECT action, details, created_at
    FROM bot_logs
    WHERE profile_id = 42
    AND created_at >= '2026-08-17T20:00:00Z'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.table(logs.rows);
  
  await client.end();
}

run().catch(console.error);
