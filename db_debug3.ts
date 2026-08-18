import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== WHY US30 DID NOT EXECUTE ON 40 (2-step)? ===");
  const us30Logs = await client.query(`
    SELECT profile_id, symbol, action, details, created_at 
    FROM bot_logs 
    WHERE symbol LIKE '%US30%' 
    ORDER BY created_at DESC 
    LIMIT 20
  `);
  console.table(us30Logs.rows);

  console.log("=== WHY GBPJPY DID NOT EXECUTE ON 42 (1-step)? ===");
  const gbpjpyLogs = await client.query(`
    SELECT profile_id, symbol, action, details, created_at 
    FROM bot_logs 
    WHERE symbol LIKE '%GBPJPY%' 
    ORDER BY created_at DESC 
    LIMIT 20
  `);
  console.table(gbpjpyLogs.rows);

  console.log("=== OCTAFX (43) PAIR CONFIGS ===");
  const octaConfigs = await client.query(`
    SELECT pair, enabled, mage_enabled, sage_enabled, seer_enabled
    FROM profile_pair_configs
    WHERE profile_id = 43
  `);
  console.table(octaConfigs.rows);

  await client.end();
}

run().catch(console.error);
