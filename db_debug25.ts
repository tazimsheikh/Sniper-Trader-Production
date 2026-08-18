import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  const logs = await client.query(`
    SELECT profile_id, action, symbol, details, created_at
    FROM bot_logs
    WHERE created_at >= '2026-08-18T07:00:00Z'
    ORDER BY created_at ASC
  `);
  
  for (const row of logs.rows) {
    console.log("[" + row.created_at.toISOString() + "] P" + row.profile_id + " | " + row.action + " | " + row.symbol + " | " + row.details.substring(0, 80));
  }

  await client.end();
}

run().catch(console.error);
