
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT id, dwcb_enabled, institutional_enabled FROM trading_profiles WHERE id IN (40, 42, 43)')
  .then(res => { console.table(res.rows); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });

