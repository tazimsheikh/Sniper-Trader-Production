import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== PROFILE 40 (Fiber 2-step) LOCKOUTS ===");
  const lockouts = await client.query(`
    SELECT profile_id, symbol, bot_id, session_losses, last_session
    FROM profile_symbol_lockouts
    WHERE profile_id = 40
  `);
  console.table(lockouts.rows);

  console.log("=== PROFILE 40 (Fiber 2-step) TRADING PROFILES DATA (DWCB, etc) ===");
  const profile40 = await client.query(`
    SELECT id, profile_name, dwcb_enabled, dwcb_peak_balance, risk_multiplier
    FROM trading_profiles
    WHERE id IN (40, 42)
  `);
  console.table(profile40.rows);

  await client.end();
}

run().catch(console.error);
