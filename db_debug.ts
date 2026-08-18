import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  
  // 1. Get profiles to identify Fiber 1-step, Fiber 2-step, and OctaFX
  const profilesRes = await client.query('SELECT id, profile_name, locked_pairs, active_bots, broker_symbol_map FROM trading_profiles');
  console.log("=== TRADING PROFILES ===");
  console.table(profilesRes.rows);

  const profileIds = profilesRes.rows.map(r => r.id);

  if (profileIds.length > 0) {
    // 2. Check bot_logs for these profiles to see why trades were skipped (US30 on Fiber 2-step, GBPJPY on Fiber 1-step, OctaFX daily pairs)
    const logsRes = await client.query(`
      SELECT profile_id, symbol, action, details, created_at 
      FROM bot_logs 
      ORDER BY created_at DESC 
      LIMIT 100
    `);
    console.log("\n=== RECENT BOT LOGS ===");
    console.table(logsRes.rows);

    // 3. Check profile pair configs
    const configsRes = await client.query(`
      SELECT profile_id, pair, enabled, mage_enabled, sage_enabled, seer_enabled
      FROM profile_pair_configs
    `);
    console.log("\n=== PROFILE PAIR CONFIGS ===");
    console.table(configsRes.rows);
  }

  await client.end();
}

run().catch(console.error);
