import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://postgres.wfumcesezszoyyquqryy:TAZIMsheikh1%23@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  console.log("=== US30 TRADES TODAY (Profile 40 vs 42) ===");
  const today = new Date();
  today.setUTCHours(0,0,0,0);
  
  const diary = await client.query(`
    SELECT profile_id, broker_symbol, direction, entry_price, lots, profit, status, to_timestamp(open_time/1000) as open_date, to_timestamp(close_time/1000) as close_date
    FROM trade_diary
    WHERE broker_symbol LIKE '%US30%' 
      AND (profile_id = 40 OR profile_id = 42 OR profile_id = 43)
      AND open_time > $1
    ORDER BY open_time ASC
  `, [today.getTime()]);
  console.table(diary.rows);

  console.log("=== US30 BOT STATES TODAY ===");
  const states = await client.query(`
    SELECT profile_id, broker_symbol, direction, entry_price, status, to_timestamp(open_time/1000) as open_date
    FROM bot_trade_states
    WHERE broker_symbol LIKE '%US30%'
      AND (profile_id = 40 OR profile_id = 42 OR profile_id = 43)
      AND open_time > $1
    ORDER BY open_time ASC
  `, [today.getTime()]);
  console.table(states.rows);

  await client.end();
}

run().catch(console.error);
