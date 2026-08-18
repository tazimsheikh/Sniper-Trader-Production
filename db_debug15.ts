import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== NZDUSD LOGS ACROSS ALL PROFILES ===");
  const logs = await client.query(`
    SELECT profile_id, action, details, created_at
    FROM bot_logs
    WHERE broker_symbol LIKE '%NZDUSD%'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.table(logs.rows);
  
  await client.end();
}

run().catch(console.error);
