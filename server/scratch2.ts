import db from './core/db.js';
async function run() {
  try {
    const res = await db.prepare("SELECT id, user_id, profile_name, active_bots, dwcb_enabled FROM trading_profiles").all();
    console.log(res);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
