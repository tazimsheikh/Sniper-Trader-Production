import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== PROFILE 40 (Fiber 2-step) US30 LOGS ===");
  const logs = await client.query(`
    SELECT action, details, created_at
    FROM bot_logs
    WHERE profile_id = 40 AND symbol LIKE '%US30%'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.table(logs.rows);

  console.log("=== PROFILE 40 (Fiber 2-step) GBPJPY LOGS ===");
  const gbpjpyLogs = await client.query(`
    SELECT action, details, created_at
    FROM bot_logs
    WHERE profile_id = 40 AND symbol LIKE '%GBPJPY%'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.table(gbpjpyLogs.rows);
  
  await client.end();
}

run().catch(console.error);
