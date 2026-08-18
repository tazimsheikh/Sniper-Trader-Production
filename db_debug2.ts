import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  
  const profilesRes = await client.query('SELECT id, profile_name, locked_pairs, active_bots, broker_symbol_map FROM trading_profiles');
  console.log("=== TRADING PROFILES ===");
  profilesRes.rows.forEach(r => console.log(r.id, r.profile_name, r.locked_pairs, r.active_bots, r.broker_symbol_map));

  const configsRes = await client.query(`
    SELECT profile_id, pair, enabled, mage_enabled, sage_enabled, seer_enabled
    FROM profile_pair_configs
    WHERE pair LIKE '%US30%' OR pair LIKE '%GBPJPY%' OR pair LIKE '%.Daily%'
  `);
  console.log("\n=== PAIR CONFIGS ===");
  configsRes.rows.forEach(r => console.log(r));

  await client.end();
}

run().catch(console.error);
