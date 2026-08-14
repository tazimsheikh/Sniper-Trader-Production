import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'trading_profiles'");
  console.table(res.rows);
  const res2 = await pool.query("SELECT id, profile_name, dwcb_peak_balance, dwcb_drawdown_percent, institutional_daily_cap, institutional_peak_to_draw FROM trading_profiles");
  console.table(res2.rows);
  pool.end();
}
run();
