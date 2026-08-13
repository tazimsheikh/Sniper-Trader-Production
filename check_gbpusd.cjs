require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  // All GBPUSD trades across all profiles - any stale open/placing rows?
  const r1 = await pool.query(
    "SELECT id, profile_id, meta_order_id, broker_symbol, status, bot_id, direction, entry_price, sl_price, open_time FROM bot_trade_states WHERE broker_symbol ILIKE '%GBP%' ORDER BY id DESC LIMIT 20"
  );
  console.log('=== GBPUSD Trades (all profiles) ===');
  console.table(r1.rows);

  // Which profiles are active with mage enabled?
  const r2 = await pool.query(
    'SELECT id, profile_name, automation_active, ai_sniper_active, active_bots, locked_pairs, broker_symbol_map FROM trading_profiles WHERE automation_active = 1 ORDER BY id'
  );
  console.log('=== Active Profiles ===');
  r2.rows.forEach(r => {
    console.log('Profile', r.id, '|', r.profile_name,
      '| active_bots:', JSON.stringify(r.active_bots),
      '| locked_pairs:', JSON.stringify(r.locked_pairs),
      '| symbol_map:', r.broker_symbol_map ? r.broker_symbol_map.substring(0, 80) : 'null');
  });

  pool.end();
}
run().catch(console.error);
