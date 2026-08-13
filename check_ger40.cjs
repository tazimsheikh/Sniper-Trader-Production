require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const res1 = await pool.query(
    "SELECT id, meta_order_id, broker_symbol, status, bot_id, direction, entry_price, sl_price, manages_own_trailing FROM bot_trade_states WHERE profile_id = 43 ORDER BY id DESC LIMIT 20"
  );
  console.log('=== Profile 43 Recent Trades ===');
  console.table(res1.rows);

  const res2 = await pool.query(
    "SELECT id, dwcb_enabled, dwcb_peak_balance, institutional_enabled, institutional_peak_balance, risk_per_trade, prop_firm_type, broker_symbol_map, enabled_bots FROM trading_profiles WHERE id = 43"
  );
  console.log('=== Profile 43 Settings ===');
  console.table(res2.rows);

  pool.end();
}
run().catch(console.error);
