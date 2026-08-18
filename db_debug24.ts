import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== CHECKING FOR HALTS OR ERRORS ===");
  const logs = await client.query(`
    SELECT profile_id, action, symbol, details, created_at
    FROM bot_logs
    WHERE profile_id IN (40, 42, 43)
    AND (
      action ILIKE '%halt%' 
      OR action ILIKE '%error%'
      OR action ILIKE '%block%'
      OR details ILIKE '%halt%'
      OR details ILIKE '%block%'
    )
    AND created_at >= '2026-08-17T20:00:00Z'
    ORDER BY created_at ASC
  `);
  
  for (const row of logs.rows) {
    console.log("[" + row.created_at.toISOString() + "] Prof " + row.profile_id + " | " + row.action + " | " + row.symbol + " | " + row.details);
  }

  await client.end();
}

run().catch(console.error);
