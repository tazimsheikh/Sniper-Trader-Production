import db from './core/db.js';
async function run() {
  try {
    const res = await db.prepare("SELECT meta_order_id, status FROM bot_trade_states WHERE profile_id=40 AND broker_symbol='US30' ORDER BY id DESC LIMIT 1").all();
    console.log(res);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
