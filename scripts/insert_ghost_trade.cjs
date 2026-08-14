const { Client } = require('pg');
require('dotenv').config();
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(async () => {
  try {
    const res = await client.query(
      `INSERT INTO bot_trade_states 
      (user_id, profile_id, bot_id, broker_symbol, direction, entry_price, sl_price, original_sl, tp_price, lots, open_time, meta_order_id, t1_hit, highest_price, lowest_price, initial_risk_pips, status, client_id) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, $13, $14, $15, 'OPEN', $16) 
      RETURNING id`, 
      [6, 40, 'SAGE', 'NAS100', 'SELL', 30076.86, 30189.7, 30189.7, 24069.7, 0.05, 1786675561617, '589280117', 30076.86, 30076.86, 120, 'S_608c98702d36_1786675561123']
    );
    console.log('Inserted Ghost Trade ID:', res.rows[0]?.id);
  } catch (e) {
    console.error(e);
  } finally {
    client.end();
  }
});
