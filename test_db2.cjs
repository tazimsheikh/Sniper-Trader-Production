
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT id, profile_name, institutional_daily_cap, institutional_peak_to_draw FROM trading_profiles WHERE id IN (40, 42, 43)')
  .then(res => { console.table(res.rows); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });

