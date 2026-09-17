import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const r = await pool.query(`
    SELECT id, profile_id, bot_id, symbol, action, details, created_at
    FROM bot_logs
    WHERE created_at >= '2026-09-14T00:00:00Z'
      AND (symbol LIKE '%XAU%' OR symbol LIKE '%NZD%' OR symbol LIKE '%US30%' OR symbol LIKE '%USDJPY%')
    ORDER BY created_at ASC
  `);
  console.log('Found logs:', r.rows.length);
  for (const row of r.rows) {
    console.log(`[${new Date(row.created_at).toISOString()}] [P#${row.profile_id}] [${row.bot_id}] [${row.symbol}] ${row.action}: ${row.details}`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
